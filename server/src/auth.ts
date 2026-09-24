import crypto from 'node:crypto';
import os from 'node:os';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config.js';
import { db } from './db.js';

// Model: the first person to enter the setup code (printed in the container logs) owns the server.
// From then on every browser/phone/app is a "device" holding its own revocable token, added by
// scanning a QR code (or typing a short code) shown on an already-paired device.

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const newCode = () => Array.from(crypto.randomBytes(8), b => ALPHABET[b % ALPHABET.length]).join('');
const norm = (c: string) => (c ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const pretty = (c: string) => `${c.slice(0, 4)}-${c.slice(4)}`;
const sha = (t: string) => crypto.createHash('sha256').update(t).digest('hex');
const same = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

const COOKIE = 'exposure_device';
const PAIR_TTL = 5 * 60_000;
const pairCodes = new Map<string, number>(); // code → expiry
let setupCode: string | null = null;

export const isClaimed = () => (db.prepare('SELECT COUNT(*) n FROM devices').get() as any).n > 0;

export function initAuth() {
  if (config.resetAuth) { db.exec('DELETE FROM devices'); console.log('[exposure] EXPOSURE_RESET_AUTH=1: all devices removed. Unset it after this start.'); }
  if (isClaimed()) return;
  setupCode = newCode();
  const urls = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => `http://${i!.address}:${config.port}`);
  const lines = ['', '  Welcome to Exposure. To set up this server:', '', `  1. Open  ${(config.publicUrl ? [config.publicUrl, ...urls] : urls.length ? urls : [`http://localhost:${config.port}`]).join('   or   ')}`,
    `  2. Enter the setup code:   ${pretty(setupCode)}`, ''];
  const w = Math.max(...lines.map(l => l.length)) + 2;
  console.log(['┌' + '─'.repeat(w) + '┐', ...lines.map(l => '│' + l.padEnd(w) + '│'), '└' + '─'.repeat(w) + '┘'].join('\n'));
}

function createDevice(name: string) {
  const token = crypto.randomBytes(32).toString('base64url'), id = crypto.randomUUID(), now = Date.now();
  db.prepare('INSERT INTO devices (id, name, token_hash, created_at, last_seen) VALUES (?,?,?,?,?)').run(id, (name || 'Device').slice(0, 60), sha(token), now, now);
  return { id, token };
}
const setCookie = (req: FastifyRequest, reply: FastifyReply, token: string) =>
  reply.setCookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/', secure: req.protocol === 'https', maxAge: 60 * 60 * 24 * 365 * 2 });

export interface Device { id: string; name: string }
export function authenticate(req: FastifyRequest): Device | null {
  const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
  const token = bearer ?? req.cookies?.[COOKIE];
  if (!token) return null;
  const d = db.prepare('SELECT id, name, last_seen FROM devices WHERE token_hash = ?').get(sha(token)) as (Device & { last_seen: number }) | undefined;
  if (!d) return null;
  if (Date.now() - d.last_seen > 3600_000) db.prepare('UPDATE devices SET last_seen = ? WHERE id = ?').run(Date.now(), d.id);
  return { id: d.id, name: d.name };
}

// Small brute-force guard for the two unauthenticated endpoints.
const fails = new Map<string, { n: number; reset: number }>();
function limited(req: FastifyRequest) {
  const f = fails.get(req.ip);
  return !!f && f.reset > Date.now() && f.n >= 8;
}
function fail(req: FastifyRequest) {
  const f = fails.get(req.ip);
  if (!f || f.reset < Date.now()) fails.set(req.ip, { n: 1, reset: Date.now() + 60_000 }); else f.n++;
}

const PUBLIC = ['/api/session', '/api/claim', '/api/pair/redeem'];

export function authRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/') || PUBLIC.some(p => req.url.startsWith(p))) return;
    if (!authenticate(req)) return reply.code(401).send({ error: 'auth' });
  });

  app.get('/api/session', async req => {
    const d = authenticate(req);
    return { claimed: isClaimed(), authenticated: !!d, device: d, publicUrl: config.publicUrl || null };
  });

  app.post<{ Body: { code: string; name?: string } }>('/api/claim', async (req, reply) => {
    if (isClaimed() || !setupCode) return reply.code(409).send({ error: 'This server is already set up.' });
    if (limited(req)) return reply.code(429).send({ error: 'Too many attempts. Wait a minute.' });
    if (!same(norm(req.body?.code), setupCode)) { fail(req); return reply.code(401).send({ error: 'That setup code is not right.' }); }
    const { token } = createDevice(req.body.name ?? 'First device');
    setupCode = null;
    setCookie(req, reply, token);
    return { ok: true, token };
  });

  // From a paired device: mint a short-lived one-time code (shown as QR + text).
  app.post('/api/pair/new', async () => {
    const lan = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => `http://${i!.address}:${config.port}`);
    for (const [c, exp] of pairCodes) if (exp < Date.now()) pairCodes.delete(c);
    const code = newCode();
    pairCodes.set(code, Date.now() + PAIR_TTL);
    return { code: pretty(code), expiresAt: Date.now() + PAIR_TTL, path: `/pair?code=${code}`, lanUrls: lan };
  });

  app.post<{ Body: { code: string; name?: string } }>('/api/pair/redeem', async (req, reply) => {
    if (limited(req)) return reply.code(429).send({ error: 'Too many attempts. Wait a minute.' });
    const code = norm(req.body?.code), exp = pairCodes.get(code);
    if (!exp || exp < Date.now()) { fail(req); return reply.code(401).send({ error: 'That code is not valid or has expired.' }); }
    pairCodes.delete(code); // one use only
    const { token } = createDevice(req.body.name ?? 'Device');
    setCookie(req, reply, token);
    return { ok: true, token };
  });

  app.get('/api/devices', async req => {
    const me = authenticate(req);
    return (db.prepare('SELECT id, name, created_at, last_seen FROM devices ORDER BY created_at').all() as any[])
      .map(d => ({ id: d.id, name: d.name, createdAt: d.created_at, lastSeen: d.last_seen, current: d.id === me?.id }));
  });

  app.delete<{ Params: { id: string } }>('/api/devices/:id', async (req, reply) => {
    const me = authenticate(req);
    const total = (db.prepare('SELECT COUNT(*) n FROM devices').get() as any).n;
    if (total <= 1) return reply.code(400).send({ error: 'This is the only paired device. Removing it would lock you out.' });
    db.prepare('DELETE FROM devices WHERE id = ?').run(req.params.id);
    if (me?.id === req.params.id) reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });
}
