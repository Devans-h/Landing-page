-- Atomic registration: a payment_session holds the form data while the person pays.
-- Only pay_confirm() creates a row in webinar_registrations, and it does so in the same
-- transaction that marks the session paid. No payment, no registration.

create table if not exists public.payment_sessions (
  id              bigint generated always as identity primary key,
  created_at      timestamptz not null default now(),
  token           text not null default encode(gen_random_bytes(12), 'hex'),
  name            text not null,
  company         text not null,
  email           text not null,
  phone           text not null,
  attending       text not null check (attending in ('yes','maybe','no')),
  source          text,
  user_agent      text,
  amount          numeric,
  status          text not null default 'new',   -- new | created | success | failed | error
  client_txn_id   text,
  txn_date        text,
  ekqr_order_id   bigint,
  payment_url     text,
  upi_txn_id      text,
  error           text,
  registration_id bigint references public.webinar_registrations(id)
);
create index if not exists payment_sessions_txn_idx on public.payment_sessions (client_txn_id);
create index if not exists payment_sessions_email_idx on public.payment_sessions (lower(email));
alter table public.payment_sessions enable row level security;   -- no policies: only definer functions touch it

-- Start a session. If this email already holds a paid registration, say so instead.
create or replace function public.pay_start(secret text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.webinar_registrations; s public.payment_sessions;
begin
  perform public._pay_check(secret);
  select * into r from public.webinar_registrations where lower(email) = lower(p->>'email') and paid;
  if found then
    return jsonb_build_object('already', true, 'name', r.name);
  end if;
  insert into public.payment_sessions (name, company, email, phone, attending, source, user_agent)
  values (p->>'name', p->>'company', lower(p->>'email'), p->>'phone', coalesce(p->>'attending','yes'), p->>'source', p->>'user_agent')
  returning * into s;
  return jsonb_build_object('id', s.id, 'token', s.token, 'name', s.name);
end $$;

create or replace function public.pay_session_get(secret text, sid bigint default null, token text default null, txn text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.payment_sessions;
begin
  perform public._pay_check(secret);
  if txn is not null then
    select * into s from public.payment_sessions where client_txn_id = txn;
  else
    select * into s from public.payment_sessions where id = sid and payment_sessions.token = pay_session_get.token;
  end if;
  if not found then return null; end if;
  return to_jsonb(s);
end $$;

create or replace function public.pay_session_update(secret text, sid bigint, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._pay_check(secret);
  update public.payment_sessions set
    amount        = coalesce((p->>'amount')::numeric, amount),
    status        = coalesce(p->>'status', status),
    client_txn_id = coalesce(p->>'client_txn_id', client_txn_id),
    txn_date      = coalesce(p->>'txn_date', txn_date),
    ekqr_order_id = coalesce((p->>'ekqr_order_id')::bigint, ekqr_order_id),
    payment_url   = coalesce(p->>'payment_url', payment_url),
    upi_txn_id    = coalesce(nullif(p->>'upi_txn_id',''), upi_txn_id),
    error         = case when p ? 'error' then p->>'error' else error end
  where id = sid;
end $$;

-- The atomic step: mark the session paid AND create the registration together.
create or replace function public.pay_confirm(secret text, sid bigint, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.payment_sessions; rid bigint;
begin
  perform public._pay_check(secret);
  select * into s from public.payment_sessions where id = sid for update;
  if not found then raise exception 'session not found'; end if;
  if s.registration_id is not null then
    return jsonb_build_object('registration_id', s.registration_id, 'name', s.name, 'already', true);
  end if;
  insert into public.webinar_registrations (name, company, email, phone, attending, source, user_agent,
                                            amount, paid, paid_at, pay_status, client_txn_id, txn_date, ekqr_order_id, payment_url, upi_txn_id)
  values (s.name, s.company, s.email, s.phone, s.attending, s.source, s.user_agent,
          coalesce((p->>'amount')::numeric, s.amount), true, now(), 'success', s.client_txn_id, s.txn_date, s.ekqr_order_id, s.payment_url, p->>'upi_txn_id')
  on conflict (lower(email)) do update set
    name = excluded.name, company = excluded.company, phone = excluded.phone, attending = excluded.attending,
    paid = true, paid_at = coalesce(public.webinar_registrations.paid_at, now()), pay_status = 'success',
    amount = excluded.amount, client_txn_id = excluded.client_txn_id, txn_date = excluded.txn_date,
    ekqr_order_id = excluded.ekqr_order_id, payment_url = excluded.payment_url, upi_txn_id = excluded.upi_txn_id
  returning id into rid;
  update public.payment_sessions set status = 'success', upi_txn_id = coalesce(p->>'upi_txn_id', upi_txn_id), registration_id = rid where id = sid;
  return jsonb_build_object('registration_id', rid, 'name', s.name);
end $$;

-- Admin view of unpaid attempts (these are NOT registrations).
create or replace function public.admin_attempts(u text, p text)
returns setof public.payment_sessions
language plpgsql security definer set search_path = public as $$
begin
  if u is distinct from 'admin' or p is distinct from 'tringtring00#' then
    perform pg_sleep(0.5);
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  return query select * from public.payment_sessions where registration_id is null order by created_at desc;
end $$;

-- Registrations are paid by definition now; the admin list only shows paid rows.
create or replace function public.admin_registrations(u text, p text)
returns setof public.webinar_registrations
language plpgsql security definer set search_path = public as $$
begin
  if u is distinct from 'admin' or p is distinct from 'tringtring00#' then
    perform pg_sleep(0.5);
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  return query select * from public.webinar_registrations where paid order by paid_at desc nulls last, created_at desc;
end $$;

revoke all on function public.pay_start(text, jsonb) from public;
revoke all on function public.pay_session_get(text, bigint, text, text) from public;
revoke all on function public.pay_session_update(text, bigint, jsonb) from public;
revoke all on function public.pay_confirm(text, bigint, jsonb) from public;
revoke all on function public.admin_attempts(text, text) from public;
grant execute on function public.pay_start(text, jsonb) to anon;
grant execute on function public.pay_session_get(text, bigint, text, text) to anon;
grant execute on function public.pay_session_update(text, bigint, jsonb) to anon;
grant execute on function public.pay_confirm(text, bigint, jsonb) to anon;
grant execute on function public.admin_attempts(text, text) to anon;
