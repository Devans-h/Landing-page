-- Webinar registrations. Run once in Supabase -> SQL Editor.
create table if not exists public.webinar_registrations (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  name        text not null,
  company     text not null,
  email       text not null,
  phone       text not null,
  attending   text not null check (attending in ('yes','maybe','no')),
  source      text,            -- ?src= in the link (e.g. linkedin, call)
  user_agent  text
);

alter table public.webinar_registrations enable row level security;

-- The public page may only INSERT. Nobody can read with the anon key;
-- view registrations in the Supabase dashboard (Table Editor) or with the service key.
drop policy if exists "anon can register" on public.webinar_registrations;
create policy "anon can register" on public.webinar_registrations
  for insert to anon with check (true);

-- Optional: block duplicate sign-ups from the same email.
create unique index if not exists webinar_registrations_email_idx
  on public.webinar_registrations (lower(email));
