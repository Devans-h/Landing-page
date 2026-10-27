-- Admin delete. kind = 'registration' (paid row + its payment sessions) or 'attempt' (unpaid session).
create or replace function public.admin_delete(u text, p text, kind text, rid bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n int := 0;
begin
  if u is distinct from 'admin' or p is distinct from 'tringtring00#' then
    perform pg_sleep(0.5);
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  if kind = 'registration' then
    delete from public.payment_sessions where registration_id = rid;
    delete from public.webinar_registrations where webinar_registrations.id = rid;
    get diagnostics n = row_count;
  elsif kind = 'attempt' then
    delete from public.payment_sessions where payment_sessions.id = rid and registration_id is null;
    get diagnostics n = row_count;
  else
    raise exception 'bad kind';
  end if;
  return jsonb_build_object('deleted', n);
end $$;
revoke all on function public.admin_delete(text, text, text, bigint) from public;
grant execute on function public.admin_delete(text, text, text, bigint) to anon, authenticated;
