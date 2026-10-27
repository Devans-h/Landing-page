# Deploying on an Ubuntu server (webinar.tringtringai.com)

Target: Ubuntu 22.04/24.04, Node 20, PostgreSQL, nginx on port 80/443 with a Let's Encrypt certificate.
The app is a small Node server (`server.js`) that serves the pages and the `/api/*` routes on port 3000;
nginx proxies the domain to it.

## 1. DNS

Point `webinar.tringtringai.com` (A record, and AAAA if you use IPv6) at the server's public IP before
running certbot; the certificate step needs the domain to resolve to this machine.

## 2. Server packages

```bash
sudo apt update && sudo apt install -y nginx postgresql postgresql-contrib git curl certbot python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # v20.x
```

## 3. Database (PostgreSQL)

Any PostgreSQL 13+ works: the local one installed above, or a managed one (Neon, RDS, Railway, Supabase).
The app only needs a connection string in `DATABASE_URL`.

Local PostgreSQL on the same server:

```bash
sudo -u postgres psql <<'SQL'
create user webinar with password 'CHANGE_ME_DB_PASSWORD';
create database webinar owner webinar;
SQL
```

Create the schema. `db/schema.sql` has two placeholders you must replace first:

| Placeholder          | Value                                                             |
|----------------------|-------------------------------------------------------------------|
| `__PAY_SECRET__`     | a long random string; the same value goes in `.env` as PAY_SECRET  |
| `__ADMIN_PASSWORD__` | the password for `/admin` (username is `admin`)                   |

```bash
PAY_SECRET=$(openssl rand -hex 24)
sed -e "s/__PAY_SECRET__/$PAY_SECRET/" -e "s/__ADMIN_PASSWORD__/CHANGE_ME_ADMIN_PASSWORD/" db/schema.sql \
  | sudo -u postgres psql -v ON_ERROR_STOP=1 -d webinar
echo "PAY_SECRET=$PAY_SECRET"   # keep this for .env
```

For the local database the connection string is
`postgres://webinar:CHANGE_ME_DB_PASSWORD@127.0.0.1:5432/webinar`.
For a managed database use the string its dashboard gives you (usually ending in `?sslmode=require`);
the app enables TLS automatically for any host other than localhost.

The schema is idempotent (`create ... if not exists`, `create or replace function`), so re-running it
after a code update is safe.

## 4. Application

```bash
sudo useradd -r -m -d /var/www/webinar -s /usr/sbin/nologin webinar
sudo git clone https://github.com/Devans-h/Landing-page.git /var/www/webinar
cd /var/www/webinar
sudo cp .env.example .env
sudo nano .env            # fill in the values below
sudo chown -R webinar:webinar /var/www/webinar
sudo -u webinar npm ci --omit=dev
```

`.env` values:

| Variable          | Value                                                                                       |
|-------------------|---------------------------------------------------------------------------------------------|
| `DATABASE_URL`    | the PostgreSQL connection string from step 3                                                |
| `PAY_SECRET`      | the value used in place of `__PAY_SECRET__`                                                 |
| `WEBHOOK_TOKEN`   | any random string (`openssl rand -hex 16`); part of the EkQR webhook URL                    |
| `EKQR_KEY`        | API key from portal.ekqr.in                                                                 |
| `MERCHANT_UPI_ID` | UPI ID of the merchant connected in EkQR (lowercase)                                        |
| `AMOUNT`          | registration fee in rupees, `21`                                                            |
| `SITE_URL`        | `https://webinar.tringtringai.com`                                                          |

Leave `SUPABASE_URL` and `SUPABASE_ANON_KEY` empty; they are only used when `DATABASE_URL` is not set.

Run as a service:

```bash
sudo cp deploy/webinar.service /etc/systemd/system/webinar.service
sudo systemctl daemon-reload
sudo systemctl enable --now webinar
sudo systemctl status webinar --no-pager
curl -s http://127.0.0.1:3000/api/status | head -c 100   # expect {"error":"invalid"}
```

## 5. nginx (port 80)

```bash
sudo cp deploy/webinar.tringtringai.com.conf /etc/nginx/sites-available/webinar.tringtringai.com
sudo ln -s /etc/nginx/sites-available/webinar.tringtringai.com /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

At this point `http://webinar.tringtringai.com` serves the site.

## 6. SSL with certbot

```bash
sudo certbot --nginx -d webinar.tringtringai.com --redirect -m ai@globalvoxinc.com --agree-tos -n
sudo certbot renew --dry-run
```

Certbot edits the nginx file to add the 443 server block, installs the certificate and the HTTP to HTTPS
redirect, and sets up automatic renewal (systemd timer). Verify with `https://webinar.tringtringai.com`.

## 7. EkQR webhook

In portal.ekqr.in set the webhook URL to:

```
https://webinar.tringtringai.com/api/ekqr-webhook?t=<WEBHOOK_TOKEN>
```

using the `WEBHOOK_TOKEN` value from `.env`. The server never trusts the webhook body by itself; it
re-checks the order with EkQR before marking anyone as registered.

## 8. Checks after deploy

1. Open `https://webinar.tringtringai.com/register`, fill the form, pay the fee by scanning the QR.
   The page should move to "Confirmed" by itself within a few seconds.
2. Open `https://webinar.tringtringai.com/admin`, log in with `admin` and the password you set.
   The test registration should be listed; delete it with the Delete button.
3. `sudo journalctl -u webinar -f` shows the server log, including webhook calls.

## Updating

```bash
cd /var/www/webinar
sudo -u webinar git pull
sudo -u webinar npm ci --omit=dev
sudo systemctl restart webinar
```

If `db/schema.sql` changed, re-run the schema command from step 3 (with the same placeholders).
