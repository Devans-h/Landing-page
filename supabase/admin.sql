-- Admin list for /admin. The function checks the login itself and runs as the owner,
-- so the public key still cannot read the table directly.
create or replace function public.admin_registrations(u text, p text)
returns setof public.webinar_registrations
language plpgsql security definer
set search_path = public
as $$
begin
  if u is distinct from 'admin' or p is distinct from 'tringtring00#' then
    perform pg_sleep(0.5);
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  return query select * from public.webinar_registrations order by created_at desc;
end $$;

revoke all on function public.admin_registrations(text, text) from public;
grant execute on function public.admin_registrations(text, text) to anon;
