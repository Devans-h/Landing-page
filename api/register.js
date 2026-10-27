// POST /api/register -> opens a payment session and an EkQR order. Nothing is registered
// until the payment is confirmed (see pay_confirm in supabase/sessions.sql).
const { env, assertEnv, rpc, ekqr, istDate, upiHashMatches, json } = require('./_lib');

const clean = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'method' });
  try {
    assertEnv();
    const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const data = {
      name: clean(b.name, 120),
      company: clean(b.company, 160),
      email: clean(b.email, 160).toLowerCase(),
      phone: clean(b.phone, 20),
      attending: ['yes', 'maybe'].includes(b.attending) ? b.attending : 'yes',
      source: clean(b.source, 40) || null,
      user_agent: clean(req.headers['user-agent'], 250),
    };
    if (data.name.length < 2 || data.company.length < 2 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email) || data.phone.replace(/\D/g, '').length < 10) {
      return json(res, 400, { error: 'invalid', message: 'Please check your details.' });
    }

    const s = await rpc('pay_start', { p: data });
    if (s.already) return json(res, 200, { paid: true, already: true, by: s.by || 'email', name: s.name, amount: env.AMOUNT });

    const base = { id: s.id, token: s.token, amount: env.AMOUNT, name: s.name };
    const clientTxnId = 'WS' + s.id + '-' + Date.now().toString(36);
    const txnDate = istDate();
    const mobile = data.phone.replace(/\D/g, '').slice(-10);
    const order = await ekqr('create_order', {
      client_txn_id: clientTxnId,
      amount: String(env.AMOUNT),
      p_info: 'Webinar registration - TringTring & LogBook360',
      customer_name: data.name,
      customer_email: data.email,
      customer_mobile: mobile,
      redirect_url: env.SITE_URL + '/thanks?ref=' + s.id + '&k=' + s.token,
      udf1: String(s.id),
    });
    if (!order.status || !order.data) {
      await rpc('pay_session_update', { sid: s.id, p: { status: 'error', error: 'ekqr: ' + (order.msg || 'order failed') } });
      return json(res, 200, { ...base, paid: false, error: 'payment_unavailable', message: order.msg || 'Payment service unavailable' });
    }
    if (!upiHashMatches(order.data.upi_id_hash)) {
      await rpc('pay_session_update', { sid: s.id, p: { status: 'error', error: 'upi id hash mismatch' } });
      return json(res, 200, { ...base, paid: false, error: 'payment_unavailable', message: 'Payment verification failed' });
    }
    await rpc('pay_session_update', {
      sid: s.id,
      p: { amount: env.AMOUNT, status: 'created', client_txn_id: clientTxnId, txn_date: txnDate,
           ekqr_order_id: order.data.order_id, payment_url: order.data.payment_url, error: null },
    });

    const intents = order.data.upi_intent || {};
    // Plain link for GPay/PhonePe/others (pa must stay raw: an encoded "@" breaks the VPA).
    let plain = '';
    try {
      const p = new URL(intents.bhim_link).searchParams;
      plain = 'pa=' + p.get('pa') + '&pn=' + encodeURIComponent(p.get('pn') || 'GlobalVox') + '&am=' + p.get('am') + '&tn=' + (p.get('tn') || clientTxnId) + '&cu=INR';
    } catch (e) { /* fall back to EkQR links */ }
    return json(res, 200, {
      ...base, paid: false,
      payment_url: order.data.payment_url,
      qr: intents.bhim_link,
      intents: {
        gpay: plain ? 'tez://upi/pay?' + plain : intents.gpay_link,
        phonepe: plain ? 'phonepe://pay?' + plain : intents.phonepe_link,
        paytm: intents.paytm_link,
        upi: plain ? 'upi://pay?' + plain : intents.bhim_link,
      },
    });
  } catch (e) {
    console.error('register', e);
    return json(res, 500, { error: 'server', message: 'Something went wrong. Please try again.' });
  }
};
