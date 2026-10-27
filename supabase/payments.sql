-- Payment support. __PAY_SECRET__ is replaced at deploy time; the same value lives in
-- Vercel as PAY_SECRET. Only the serverless functions know it, so only they can
-- read or update registrations through these functions.

alter table public.webinar_registrations
  add column if not exists access_token  text not null default encode(gen_random_bytes(12), 'hex'),
  add column if not exists amount        numeric,
  add column if not exists paid          boolean not null default false,
  add column if not exists paid_at       timestamptz,
  add column if not exists pay_status    text,
  add column if not exists client_txn_id text,
  add column if not exists txn_date      text,
  add column if not exists ekqr_order_id bigint,
  add column if not exists payment_url   text,
  add column if not exists upi_txn_id    text,
  add column if not exists pay_error     text;

create index if not exists webinar_registrations_client_txn_idx on public.webinar_registrations (client_txn_id);

create or replace function public._pay_check(secret text) returns void
language plpgsql as $$
begin
  if secret is distinct from '__PAY_SECRET__' then
    perform pg_sleep(0.5);
    raise exception 'unauthorized' using errcode = '28000';
  end if;
end $$;

-- Upsert a registration by email; returns id, token and current paid state.
create or replace function public.pay_register(secret text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.webinar_registrations;
begin
  perform public._pay_check(secret);
  select * into r from public.webinar_registrations where lower(email) = lower(p->>'email');
  if found then
    update public.webinar_registrations set
      name = coalesce(nullif(p->>'name',''), name),
      company = coalesce(nullif(p->>'company',''), company),
      phone = coalesce(nullif(p->>'phone',''), phone),
      attending = coalesce(nullif(p->>'attending',''), attending),
      source = coalesce(source, p->>'source')
    where id = r.id returning * into r;
  else
    insert into public.webinar_registrations (name, company, email, phone, attending, source, user_agent)
    values (p->>'name', p->>'company', lower(p->>'email'), p->>'phone', coalesce(p->>'attending','yes'), p->>'source', p->>'user_agent')
    returning * into r;
  end if;
  return jsonb_build_object('id', r.id, 'token', r.access_token, 'paid', r.paid, 'name', r.name, 'email', r.email, 'phone', r.phone);
end $$;

-- Read one registration (by id + token, or by client_txn_id for the webhook).
create or replace function public.pay_get(secret text, reg_id bigint default null, token text default null, txn text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.webinar_registrations;
begin
  perform public._pay_check(secret);
  if txn is not null then
    select * into r from public.webinar_registrations where client_txn_id = txn;
  else
    select * into r from public.webinar_registrations where id = reg_id and access_token = token;
  end if;
  if not found then return null; end if;
  return to_jsonb(r);
end $$;

-- Update payment fields on a registration.
create or replace function public.pay_update(secret text, reg_id bigint, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._pay_check(secret);
  update public.webinar_registrations set
    amount        = coalesce((p->>'amount')::numeric, amount),
    paid          = coalesce((p->>'paid')::boolean, paid),
    paid_at       = case when (p->>'paid')::boolean then coalesce(paid_at, now()) else paid_at end,
    pay_status    = coalesce(p->>'pay_status', pay_status),
    client_txn_id = coalesce(p->>'client_txn_id', client_txn_id),
    txn_date      = coalesce(p->>'txn_date', txn_date),
    ekqr_order_id = coalesce((p->>'ekqr_order_id')::bigint, ekqr_order_id),
    payment_url   = coalesce(p->>'payment_url', payment_url),
    upi_txn_id    = coalesce(nullif(p->>'upi_txn_id',''), upi_txn_id),
    pay_error     = case when p ? 'pay_error' then p->>'pay_error' else pay_error end
  where id = reg_id;
end $$;

revoke all on function public._pay_check(text) from public;
revoke all on function public.pay_register(text, jsonb) from public;
revoke all on function public.pay_get(text, bigint, text, text) from public;
revoke all on function public.pay_update(text, bigint, jsonb) from public;
grant execute on function public.pay_register(text, jsonb) to anon;
grant execute on function public.pay_get(text, bigint, text, text) to anon;
grant execute on function public.pay_update(text, bigint, jsonb) to anon;
