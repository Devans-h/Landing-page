// Database adapter. Set DATABASE_URL to use any PostgreSQL directly (after running db/schema.sql).
// Without it, the functions are called through Supabase's REST layer (SUPABASE_URL + SUPABASE_ANON_KEY).
// Either way the SQL functions are the same; only the transport differs.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

let pool = null;
function getPool() {
  if (pool) return pool;
  const { Pool } = require('pg');
  const local = /localhost|127\.0\.0\.1/.test(DATABASE_URL);
  pool = new Pool({ connectionString: DATABASE_URL, max: 3, ssl: local ? false : { rejectUnauthorized: false } });
  return pool;
}

// Build "select * from public.fn(name => $1::type, ...)" from a params object.
function sqlFor(fn, params) {
  const keys = Object.keys(params).filter((k) => params[k] !== undefined);
  const args = keys.map((k, i) => {
    const v = params[k];
    const cast = v !== null && typeof v === 'object' ? 'jsonb' : typeof v === 'number' ? 'bigint' : 'text';
    return k + ' => $' + (i + 1) + '::' + cast;
  });
  const values = keys.map((k) => (params[k] !== null && typeof params[k] === 'object' ? JSON.stringify(params[k]) : params[k]));
  return { text: 'select * from public.' + fn + '(' + args.join(', ') + ')', values };
}

async function callPostgres(fn, params) {
  const q = sqlFor(fn, params);
  const r = await getPool().query(q.text, q.values);
  // A function returning jsonb/void yields one row with a single column named after the function.
  if (r.fields.length === 1 && r.fields[0].name === fn) return r.rows.length ? r.rows[0][fn] : null;
  return r.rows; // "returns setof <table>"
}

async function callSupabase(fn, params) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + fn, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const text = await res.text();
  if (!res.ok) { const e = new Error('rpc ' + fn + ' ' + res.status + ' ' + text.slice(0, 200)); e.status = res.status; throw e; }
  return text ? JSON.parse(text) : null;
}

function isUnauthorized(e) {
  return (e && (e.code === '28000' || e.status === 401 || e.status === 403)) || /unauthorized/i.test(String(e && e.message));
}

function assertDbEnv() {
  if (DATABASE_URL) return;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('missing env DATABASE_URL (or SUPABASE_URL + SUPABASE_ANON_KEY)');
}

// call('pay_start', { secret, p }) -> whatever the SQL function returns.
const call = (fn, params) => (DATABASE_URL ? callPostgres(fn, params) : callSupabase(fn, params));

module.exports = { call, sqlFor, isUnauthorized, assertDbEnv, provider: DATABASE_URL ? 'postgres' : 'supabase' };
