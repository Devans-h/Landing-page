// POST /api/ekqr-webhook?t=<WEBHOOK_TOKEN>
// EkQR calls this when an order changes. The payload is never trusted by itself:
// we look the session up and confirm with EkQR's status API before registering anyone.
const { env, assertEnv, rpc, syncSession, json } = require('./_lib');

function parseBody(req) {
  const b = req.body;
  if (!b) return {};
  if (typeof b === 'object') return b;
  const s = String(b);
  try { return JSON.parse(s); } catch (e) { /* not json */ }
  return Object.fromEntries(new URLSearchParams(s));
}

module.exports = async (req, res) => {
  try {
    assertEnv();
    if (env.WEBHOOK_TOKEN && String(req.query.t || '') !== env.WEBHOOK_TOKEN) return json(res, 401, { ok: false });
    if (req.method !== 'POST') return json(res, 200, { ok: true, note: 'webhook endpoint' });
    const body = parseBody(req);
    const txn = String(body.client_txn_id || body.clientTxnId || body.txn_id || '');
    console.log('webhook', JSON.stringify(body).slice(0, 500));
    if (!txn) return json(res, 200, { ok: false, note: 'no client_txn_id' });
    const s = await rpc('pay_session_get', { txn });
    if (!s) return json(res, 200, { ok: false, note: 'unknown txn' });
    const r = await syncSession(s);
    return json(res, 200, { ok: true, paid: r.paid, status: r.status });
  } catch (e) {
    console.error('webhook', e);
    return json(res, 200, { ok: false });
  }
};
