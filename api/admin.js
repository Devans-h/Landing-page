// POST /api/admin { u, p, action: 'registrations' | 'attempts' | 'delete', kind?, rid? }
// The admin page talks only to this endpoint, so it works with any database backend.
const { call, isUnauthorized, assertDbEnv } = require('./_db');
const { json } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'method' });
  try {
    assertDbEnv();
    const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const u = String(b.u || ''), p = String(b.p || '');
    if (!u || !p) return json(res, 401, { error: 'unauthorized' });
    let out;
    if (b.action === 'registrations') out = await call('admin_registrations', { u, p });
    else if (b.action === 'attempts') out = await call('admin_attempts', { u, p });
    else if (b.action === 'delete') {
      const rid = parseInt(b.rid, 10), kind = b.kind === 'attempt' ? 'attempt' : 'registration';
      if (!rid) return json(res, 400, { error: 'invalid' });
      out = await call('admin_delete', { u, p, kind, rid });
    } else return json(res, 400, { error: 'invalid' });
    return json(res, 200, out);
  } catch (e) {
    if (isUnauthorized(e)) return json(res, 401, { error: 'unauthorized' });
    console.error('admin', e);
    return json(res, 500, { error: 'server' });
  }
};
