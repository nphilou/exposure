import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db } from './db.js';
import { fail, limited, sha } from './auth.js';
import { sendOriginal, sendResized } from './images.js';

// Album share links: /s/<token> opens one album read-only, without pairing a device.
// Guest routes live under /api/s/<token>/ and only ever look up photos inside that album, so the owner
// routes stay unreachable with a share token (it isn't a device token and the auth hook rejects it there).

interface Share { id: string; album_id: number; name: string; allow_originals: number; created_at: number; expires_at: number | null; last_seen: number | null }
const DAY = 86400_000;

const shareOf = (token: string) => db.prepare('SELECT * FROM shares WHERE token_hash = ?').get(sha(token)) as Share | undefined;

/** The share behind the URL's token, or a reply saying why not. */
function resolve(req: FastifyRequest<{ Params: { token: string } }>, reply: FastifyReply): Share | null {
  if (limited(req)) { reply.code(429).send({ error: 'Too many attempts. Wait a minute.' }); return null; }
  const s = shareOf(req.params.token);
  if (!s || (s.expires_at && s.expires_at < Date.now())) {
    fail(req);
    reply.code(404).send({ error: 'This link doesn’t work anymore. Ask for a new one.' });
    return null;
  }
  if (Date.now() - (s.last_seen ?? 0) > 3600_000) db.prepare('UPDATE shares SET last_seen = ? WHERE id = ?').run(Date.now(), s.id);
  return s;
}
const inAlbum = (s: Share, photoId: string) => !!db.prepare('SELECT 1 FROM album_photos WHERE album_id = ? AND photo_id = ?').get(s.album_id, photoId);

// Guests see what's in the picture, not where it lives on the NAS: no folders, file paths, versions or favorites.
const guestPhoto = (p: any) => ({
  id: p.id, name: p.name, shootId: p.shoot_id, shootTitle: p.shootTitle, takenAt: p.taken_at,
  camera: p.camera, lens: p.lens, focal: p.focal, fnum: p.fnum, shutter: p.shutter, iso: p.iso,
  ar: p.width && p.height ? p.width / p.height : 1.5,
});
const shareInfo = (s: Share) => ({
  id: s.id, name: s.name, allowOriginals: !!s.allow_originals, createdAt: s.created_at, expiresAt: s.expires_at, lastSeen: s.last_seen,
});

type Guest = { Params: { token: string } };
type GuestPhoto = { Params: { token: string; id: string }; Querystring: { w?: string } };

export function shareRoutes(app: FastifyInstance) {
  // ── Owner: manage the links of an album ──
  app.get<{ Params: { id: string } }>('/api/albums/:id/shares', async req =>
    (db.prepare('SELECT * FROM shares WHERE album_id = ? ORDER BY created_at').all(req.params.id) as unknown as Share[]).map(shareInfo));

  app.post<{ Params: { id: string }; Body: { name?: string; expiresInDays?: number | null; allowOriginals?: boolean } }>('/api/albums/:id/shares', async (req, reply) => {
    if (!db.prepare('SELECT 1 FROM albums WHERE id = ?').get(req.params.id)) return reply.code(404).send({ error: 'That album doesn’t exist.' });
    const days = Number(req.body?.expiresInDays);
    const token = crypto.randomBytes(32).toString('base64url'), id = crypto.randomUUID(), now = Date.now();
    db.prepare('INSERT INTO shares (id, album_id, token_hash, name, allow_originals, created_at, expires_at) VALUES (?,?,?,?,?,?,?)')
      .run(id, Number(req.params.id), sha(token), (req.body?.name ?? '').trim().slice(0, 60) || 'Link', req.body?.allowOriginals ? 1 : 0, now, days > 0 ? now + days * DAY : null);
    // The token is only returned now; the server keeps just its hash.
    return { ...shareInfo(shareOf(token)!), path: `/s/${token}` };
  });

  app.delete<{ Params: { id: string } }>('/api/shares/:id', async req => {
    db.prepare('DELETE FROM shares WHERE id = ?').run(req.params.id);
    return { ok: true };
  });

  // ── Guest: one album, read-only ──
  app.get<Guest>('/api/s/:token', async (req, reply) => {
    const s = resolve(req, reply);
    if (!s) return reply;
    const a = db.prepare(`SELECT a.title, (SELECT COUNT(*) FROM album_photos ap JOIN photos p ON p.id = ap.photo_id WHERE ap.album_id = a.id) AS count
      FROM albums a WHERE a.id = ?`).get(s.album_id) as { title: string; count: number };
    return { title: a.title, count: a.count, allowOriginals: !!s.allow_originals };
  });

  app.get<Guest & { Querystring: { limit?: string; offset?: string } }>('/api/s/:token/photos', async (req, reply) => {
    const s = resolve(req, reply);
    if (!s) return reply;
    const limit = Math.min(Number(req.query.limit ?? 500) || 500, 2000), offset = Number(req.query.offset ?? 0) || 0;
    return (db.prepare(`SELECT p.*, sh.title AS shootTitle FROM album_photos ap JOIN photos p ON p.id = ap.photo_id JOIN shoots sh ON sh.id = p.shoot_id
      WHERE ap.album_id = ? ORDER BY p.taken_at, p.id LIMIT ? OFFSET ?`).all(s.album_id, limit, offset) as any[]).map(guestPhoto);
  });

  // Images always use the preferred version: guests don't choose between edited, camera JPEG and RAW.
  const photo = (handler: (s: Share, req: FastifyRequest<GuestPhoto>, reply: FastifyReply) => unknown) =>
    async (req: FastifyRequest<GuestPhoto>, reply: FastifyReply) => {
      const s = resolve(req, reply);
      if (!s) return reply;
      if (!inAlbum(s, req.params.id)) return reply.code(404).send();
      return handler(s, req, reply);
    };
  app.get<GuestPhoto>('/api/s/:token/photos/:id/thumb', photo((_, req, reply) => sendResized(reply, req.params.id, undefined, Math.min(Number(req.query.w ?? 480) || 480, 1200))));
  app.get<GuestPhoto>('/api/s/:token/photos/:id/preview', photo((_, req, reply) => sendResized(reply, req.params.id, undefined, 2400)));
  app.get<GuestPhoto>('/api/s/:token/photos/:id/original', photo((s, req, reply) => {
    if (!s.allow_originals) return reply.code(403).send({ error: 'Downloads are off for this link.' });
    const name = (db.prepare('SELECT name FROM photos WHERE id = ?').get(req.params.id) as { name: string }).name;
    return sendOriginal(reply, req.params.id, undefined, name);
  }));
}
