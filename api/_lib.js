// Shared helpers for the payment functions. Runs only on Vercel (server side).
const crypto = require('crypto');

const env = {
  EKQR_KEY: process.env.EKQR_KEY,
  PAY_SECRET: process.env.PAY_SECRET,
  WEBHOOK_TOKEN: process.env.WEBHOOK_TOKEN,
  MERCHANT_UPI_ID: (process.env.MERCHANT_UPI_ID || '').toLowerCase(),
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  AMOUNT: Number(process.env.AMOUNT || 21),
  SITE_URL: (process.env.SITE_URL || 'https://webinar-earn-without-investing.vercel.app').replace(/\/$/, ''),
};

function assertEnv() {
  for (const k of ['EKQR_KEY', 'PAY_SECRET']) {
    if (!env[k]) throw new Error('missing env ' + k);
  }
  db.assertDbEnv();
}

// Call a database function (see api/_db.js for the backend selection). Every function checks PAY_SECRET itself.
const db = require('./_db');
async function rpc(fn, params) {
  return db.call(fn, { secret: env.PAY_SECRET, ...params });
}

async function ekqr(path, body) {
  const res = await fetch('https://api.ekqr.in/api/' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: env.EKQR_KEY, ...body }),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch (e) { throw new Error('ekqr ' + path + ' bad response ' + res.status); }
  return json;
}

// EkQR dates its orders in IST (dd-mm-yyyy).
function istDate(d = new Date()) {
  const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return p(ist.getUTCDate()) + '-' + p(ist.getUTCMonth() + 1) + '-' + ist.getUTCFullYear();
}

function upiHashMatches(hash) {
  if (!env.MERCHANT_UPI_ID) return true; // not configured: skip the check
  const mine = crypto.createHash('sha256').update(env.MERCHANT_UPI_ID).digest('hex');
  return mine === String(hash || '').toLowerCase();
}

// Ask EkQR for the state of a payment session's order. On a verified success the
// registration is created atomically (pay_confirm). Returns { paid, status, name }.
async function syncSession(s) {
  if (s.registration_id) return { paid: true, status: 'success', name: s.name };
  if (!s.client_txn_id) return { paid: false, status: s.status || 'new', name: s.name };
  const r = await ekqr('check_order_status', { client_txn_id: s.client_txn_id, txn_date: s.txn_date || istDate() });
  if (!r.status || !r.data) return { paid: false, status: s.status || 'unknown', name: s.name, msg: r.msg };
  const d = r.data;
  const status = String(d.status || '').toLowerCase();
  const success = status === 'success';
  // The money must match what we asked for and land in our own UPI ID.
  const amountOk = Number(d.amount) >= Number(s.amount || env.AMOUNT);
  const upiOk = !env.MERCHANT_UPI_ID || String((d.Merchant || {}).upi_id || '').toLowerCase() === env.MERCHANT_UPI_ID;
  if (success && amountOk && upiOk) {
    await rpc('pay_confirm', { sid: s.id, p: { upi_txn_id: d.upi_txn_id || null, amount: Number(d.amount) } });
    return { paid: true, status: 'success', name: s.name };
  }
  if (status !== s.status) {
    await rpc('pay_session_update', {
      sid: s.id,
      p: { status, upi_txn_id: d.upi_txn_id || null, error: success ? 'success reported but amount/upi mismatch' : undefined },
    });
  }
  return { paid: false, status, name: s.name };
}

function json(res, code, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(code).json(body);
}

module.exports = { env, assertEnv, rpc, ekqr, istDate, upiHashMatches, syncSession, json };
