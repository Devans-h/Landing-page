// Standalone server for non-Vercel hosting (Ubuntu + nginx, Docker, etc.).
// Serves the static pages with clean URLs and mounts the same handlers that Vercel runs from api/.
// Usage: PORT=3000 node server.js   (environment from .env, see .env.example)
const path = require('path');
const fs = require('fs');
const express = require('express');

// Load .env if present (no extra dependency).
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

// API routes: same files Vercel deploys as serverless functions.
const api = {
  register: require('./api/register'),
  status: require('./api/status'),
  'ekqr-webhook': require('./api/ekqr-webhook'),
  admin: require('./api/admin'),
};
for (const [name, handler] of Object.entries(api)) {
  app.all('/api/' + name, (req, res) => Promise.resolve(handler(req, res)).catch((e) => {
    console.error(name, e);
    if (!res.headersSent) res.status(500).json({ error: 'server' });
  }));
}

// Static site with clean URLs (/register -> register.html). HTML is never cached, assets for a day.
app.use((req, res, next) => {
  if (!/\.(png|jpg|jpeg|svg|ico|webp|woff2?)$/i.test(req.path)) res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  next();
});
app.use(express.static(__dirname, { extensions: ['html'], index: 'index.html', maxAge: '1d', setHeaders: (res, p) => { if (p.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache, must-revalidate'); } }));
app.use((req, res) => res.status(404).sendFile(path.join(__dirname, 'index.html')));

const port = Number(process.env.PORT || 3000);
app.listen(port, '127.0.0.1', () => console.log('webinar site listening on http://127.0.0.1:' + port));
