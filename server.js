import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createStore, ValidationError } from './store.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DEFAULT_PIN = '1234';
const ADMIN_PIN = process.env.ADMIN_PIN || DEFAULT_PIN;
const DATA_FILE = process.env.DATA_FILE || path.join(ROOT, 'data', 'state.json');

const SESSION_MS = 12 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 100_000;
const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const LOGIN_MAX_FAILS = 8;

const store = createStore(DATA_FILE);
const sessions = new Map(); // token -> expiresAt
const loginFails = new Map(); // ip -> { count, resetAt }

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
};

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function isAdmin(req) {
  const token = parseCookies(req).sid;
  const expiresAt = token && sessions.get(token);
  if (!expiresAt) return false;
  if (expiresAt < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function pinMatches(input) {
  const digest = (value) => createHash('sha256').update(String(value)).digest();
  return timingSafeEqual(digest(input), digest(ADMIN_PIN));
}

function loginBlocked(ip) {
  const entry = loginFails.get(ip);
  if (!entry) return false;
  if (entry.resetAt < Date.now()) {
    loginFails.delete(ip);
    return false;
  }
  return entry.count >= LOGIN_MAX_FAILS;
}

function recordLoginFail(ip) {
  const entry = loginFails.get(ip);
  if (!entry || entry.resetAt < Date.now()) loginFails.set(ip, { count: 1, resetAt: Date.now() + LOGIN_WINDOW_MS });
  else entry.count += 1;
}

async function readJson(req) {
  if (!(req.headers['content-type'] || '').startsWith('application/json')) {
    throw new HttpError(415, 'Data harus dikirim sebagai JSON.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'Data terlalu besar.');
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error('bukan objek');
    return body;
  } catch {
    throw new HttpError(400, 'Format data tidak valid.');
  }
}

function openStream(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    ...SECURITY_HEADERS,
  });
  const push = (state) => res.write(`data: ${JSON.stringify(state)}\n\n`);
  res.write('retry: 2000\n\n');
  push(store.state);

  const unsubscribe = store.subscribe(push);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 20_000);
  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}

async function handleApi(req, res, pathname) {
  const method = req.method;

  if (pathname === '/api/state' && method === 'GET') return sendJson(res, 200, store.state);
  if (pathname === '/api/stream' && method === 'GET') return openStream(req, res);
  if (pathname === '/api/session' && method === 'GET') return sendJson(res, 200, { admin: isAdmin(req) });

  if (pathname === '/api/login' && method === 'POST') {
    const ip = req.socket.remoteAddress || 'unknown';
    if (loginBlocked(ip)) throw new HttpError(429, 'Terlalu banyak percobaan. Tunggu beberapa menit lalu coba lagi.');
    const { pin } = await readJson(req);
    if (typeof pin !== 'string' || !pinMatches(pin)) {
      recordLoginFail(ip);
      throw new HttpError(401, 'PIN salah.');
    }
    loginFails.delete(ip);
    const token = randomBytes(24).toString('hex');
    sessions.set(token, Date.now() + SESSION_MS);
    return sendJson(res, 200, { admin: true }, {
      'Set-Cookie': `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}`,
    });
  }

  if (pathname === '/api/logout' && method === 'POST') {
    const token = parseCookies(req).sid;
    if (token) sessions.delete(token);
    return sendJson(res, 200, { admin: false }, { 'Set-Cookie': 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }

  if (pathname === '/api/action' && method === 'POST') {
    if (!isAdmin(req)) throw new HttpError(401, 'Sesi admin habis. Masuk lagi dengan PIN.');
    const { type, ...payload } = await readJson(req);
    return sendJson(res, 200, store.dispatch(type, payload));
  }

  throw new HttpError(404, 'Alamat tidak ditemukan.');
}

function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Metode tidak didukung.');

  let relative;
  try {
    relative = decodeURIComponent(pathname);
  } catch {
    throw new HttpError(400, 'Alamat tidak valid.');
  }
  if (relative === '/') relative = '/index.html';
  if (relative === '/admin') relative = '/admin.html';

  const file = path.join(PUBLIC_DIR, path.normalize(relative));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) throw new HttpError(403, 'Dilarang.');

  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) return sendJson(res, 404, { error: 'Halaman tidak ditemukan.' });
    res.writeHead(200, {
      'Content-Type': CONTENT_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
      ...SECURITY_HEADERS,
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

function fail(res, err) {
  if (res.headersSent) return res.end();
  if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
  if (err instanceof ValidationError) return sendJson(res, 400, { error: err.message });
  console.error(err);
  sendJson(res, 500, { error: 'Terjadi kesalahan di server.' });
}

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname.startsWith('/api/')) await handleApi(req, res, pathname);
    else serveStatic(req, res, pathname);
  } catch (err) {
    fail(res, err);
  }
});

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((iface) => iface && iface.family === 'IPv4' && !iface.internal)
    .map((iface) => iface.address);
}

server.listen(PORT, HOST, () => {
  const lines = [
    '',
    'Papan skor berjalan.',
    `  Layar proyektor : http://localhost:${PORT}/`,
    `  Halaman admin   : http://localhost:${PORT}/admin`,
  ];
  const lan = lanAddresses();
  if (lan.length) {
    lines.push('  Dari perangkat lain di wifi yang sama:');
    for (const ip of lan) lines.push(`    http://${ip}:${PORT}/  (admin: /admin)`);
  }
  if (ADMIN_PIN === DEFAULT_PIN) {
    lines.push('', `  PIN admin masih bawaan (${DEFAULT_PIN}). Ganti dengan: ADMIN_PIN=angkaanda npm start`);
  }
  console.log(lines.join('\n'));
});
