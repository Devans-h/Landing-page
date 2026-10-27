// GET /api/status?ref=<session id>&k=<token>  (or &txn=<client_txn_id>)  -> { paid, status, name }
const { assertEnv, rpc, syncSession, json } = require('./_lib');

module.exports = async (req, res) => {
  try {
    assertEnv();
    // Be forgiving: EkQR may append its own query to the return URL (e.g. "k=abc?client_txn_id=..").
    const id = parseInt(String(req.query.ref || ''), 10);
    const token = String(req.query.k || '').split(/[?&#]/)[0];
    const txn = String(req.query.txn || '').split(/[?&#]/)[0];
    if (req.query.raw) console.log('status raw query', String(req.query.raw).slice(0, 300));
    let s = null;
    if (id && token) s = await rpc('pay_session_get', { sid: id, token });
    if (!s && txn) s = await rpc('pay_session_get', { txn });
    if (!s && !id && !txn) return json(res, 400, { error: 'invalid' });
    if (!s) return json(res, 404, { error: 'not_found' });
    const r = await syncSession(s);
    return json(res, 200, { paid: r.paid, status: r.status, name: s.name, amount: s.amount, payment_url: s.payment_url });
  } catch (e) {
    console.error('status', e);
    return json(res, 500, { error: 'server' });
  }
};
