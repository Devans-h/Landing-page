# Webinar landing page – "Earn with AI Powered Applications" (TringTring + LogBook360)

Static site, no build step.

- `index.html`    – landing page (hook, countdown, products, agenda, FAQ, CTA)
- `register.html` – short registration form (name, company, email, phone, attending)
- `config.js`     – Supabase URL/key, table name, event date/time, WhatsApp number
- `supabase/schema.sql` – creates the `webinar_registrations` table (insert-only for the public key)
- `assets/`       – background-free logos

## One-time setup (2 minutes)

1. Supabase dashboard -> SQL Editor -> paste `supabase/schema.sql` -> Run.
   (Project "Webinar", ref yinpxfkjbbhwvakgpxou; `config.js` already points to it.)
2. Deploy: `vercel` in this folder, or drag the folder into the Vercel dashboard.

Registrations appear in Supabase -> Table Editor -> `webinar_registrations`.
If saving ever fails, the form offers a WhatsApp fallback with the details pre-filled, so no lead is lost.

## Tracking where sign-ups come from

Share links with `?src=`: `https://your-domain/?src=linkedin`, `?src=call`, `?src=whatsapp`.
The value is stored in the `source` column.

## Changing date / time / number

Edit `window.EVENT` in `config.js` (countdown + calendar link) and the visible text in both HTML files
(search for "31 Oct").

## Local preview

    python3 -m http.server 8765   # then open http://localhost:8765

## Admin page

Each row has a **Delete** button (registrations and unpaid attempts). It calls `admin_delete` (supabase/delete.sql), which checks the admin login, removes the registration and its payment sessions, and frees the email/phone to register again.

`/admin` lists all registrations (search, counts, CSV download). Login: username `admin`,
password set inside `supabase/admin.sql` (the `admin_registrations` function checks it and
returns the rows; the public key alone still cannot read the table). To change the password,
edit that file and run it again in the SQL Editor.

## Payment (EkQR, ₹21 via UPI)

Flow: form -> `POST /api/register` (saves the lead, creates an EkQR order) -> UPI app buttons or
EkQR's QR page -> the page polls `GET /api/status` -> EkQR also calls `POST /api/ekqr-webhook?t=…`.
A row is only marked paid after our own server confirms it with EkQR's status API, and the amount
and merchant UPI ID are checked. `thanks.html` is where EkQR redirects after payment.

Vercel env vars (production): `EKQR_KEY`, `PAY_SECRET` (shared with the Postgres functions in
`supabase/payments.sql`), `WEBHOOK_TOKEN`, `MERCHANT_UPI_ID`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`AMOUNT`, `SITE_URL`. Change the fee with `AMOUNT` + `fee` in `config.js` + the visible "₹21" text.

### Atomic registration (27 Oct)
`POST /api/register` only creates a `payment_sessions` row and an EkQR order. The registration
row is inserted by `pay_confirm()` (supabase/sessions.sql) in the same transaction that marks the
session paid, after the server has verified the payment with EkQR. Unpaid attempts never appear
as registrations; admin has a separate "Unpaid attempts" view for follow-up calls.

> Admin password: the SQL files use the placeholder `<ADMIN_PASSWORD>`. Replace it with the real password before running them.
