-- One seat per email AND per phone number. Checked before payment starts (pay_start)
-- and again inside the atomic confirm (pay_confirm), so a race cannot create a duplicate.

create or replace function public._phone_key(p text) returns text
language sql immutable as $$ select right(regexp_replace(coalesce(p,''), '\D', '', 'g'), 10) $$;

create unique index if not exists webinar_registrations_phone_idx
  on public.webinar_registrations (public._phone_key(phone)) where paid;

create or replace function public.pay_start(secret text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.webinar_registrations; s public.payment_sessions;
begin
  perform public._pay_check(secret);
  select * into r from public.webinar_registrations where paid and lower(email) = lower(p->>'email');
  if found then return jsonb_build_object('already', true, 'by', 'email', 'name', r.name); end if;
  select * into r from public.webinar_registrations where paid and public._phone_key(phone) = public._phone_key(p->>'phone');
  if found then return jsonb_build_object('already', true, 'by', 'phone', 'name', r.name); end if;
  insert into public.payment_sessions (name, company, email, phone, attending, source, user_agent)
  values (p->>'name', p->>'company', lower(p->>'email'), p->>'phone', coalesce(p->>'attending','yes'), p->>'source', p->>'user_agent')
  returning * into s;
  return jsonb_build_object('id', s.id, 'token', s.token, 'name', s.name);
end $$;

create or replace function public.pay_confirm(secret text, sid bigint, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.payment_sessions; r public.webinar_registrations; rid bigint;
begin
  perform public._pay_check(secret);
  select * into s from public.payment_sessions where id = sid for update;
  if not found then raise exception 'session not found'; end if;
  if s.registration_id is not null then
    return jsonb_build_object('registration_id', s.registration_id, 'name', s.name, 'already', true);
  end if;
  -- Same phone already registered under another email: attach to that seat instead of a second one.
  select * into r from public.webinar_registrations
   where paid and public._phone_key(phone) = public._phone_key(s.phone) and lower(email) <> lower(s.email);
  if found then
    update public.payment_sessions set status = 'success', upi_txn_id = coalesce(p->>'upi_txn_id', upi_txn_id),
           registration_id = r.id, error = 'duplicate phone: attached to registration ' || r.id where id = sid;
    return jsonb_build_object('registration_id', r.id, 'name', r.name, 'already', true, 'by', 'phone');
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
