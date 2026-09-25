import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import fstatic from '@fastify/static';
import fsSync from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { db } from './db.js';
import { applyRules, events, scan } from './indexer.js';
import { GENERIC, PHOTOGRAPHER, ROLES, getRules, group, isEdited, newTrace, normalize, ruleError, saveRules, suggest, type FileRow, type Rules, type Trace } from './rules.js';
import { compileEvent, compileFile } from './patterns.js';
import { sendFile, sendOriginal, sendResized } from './images.js';
import { getLibrary } from './library.js';
import { setupRoutes } from './setup.js';
import { authRoutes } from './auth.js';
import { shareRoutes } from './shares.js';

const rows = <T,>(sql: string, ...args: any[]) => db.prepare(sql).all(...args) as T[];
const row = <T,>(sql: string, ...args: any[]) => db.prepare(sql).get(...args) as T | undefined;

const PHOTO_SELECT = `
  SELECT p.*, s.title AS shootTitle, s.folder, s.date AS shootDate,
         EXISTS(SELECT 1 FROM favorites f WHERE f.photo_id = p.id) AS fav
  FROM photos p JOIN shoots s ON s.id = p.shoot_id`;


/** Versions for many photos in one query instead of one query per photo. */
function versionsFor(ids: string[]) {
  const by = new Map<string, any[]>();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    for (const v of rows<any>(`SELECT photo_id, key, label, fmt, size, file FROM versions WHERE photo_id IN (${chunk.map(() => '?').join(',')})`, ...chunk)) {
      const { photo_id, ...rest } = v;
      (by.get(photo_id) ?? by.set(photo_id, []).get(photo_id)!).push(rest);
    }
  }
  const order = getRules().preferred;
  for (const list of by.values()) list.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  return by;
}

function shape(p: any, versions: any[] = versionsFor([p.id]).get(p.id) ?? []) {
  return {
    id: p.id, name: p.name, shootId: p.shoot_id, shootTitle: p.shootTitle, folder: p.folder, takenAt: p.taken_at,
    camera: p.camera, lens: p.lens, focal: p.focal, fnum: p.fnum, shutter: p.shutter, iso: p.iso,
    ar: p.width && p.height ? p.width / p.height : 1.5,
    hasEdit: !!p.has_edit, hasRaw: !!p.has_raw, fav: !!p.fav, best: versions[0]?.key, versions,
  };
}

export async function build() {
  const app = Fastify({ logger: { level: 'warn' }, trustProxy: true });
  await app.register(cookie);

  authRoutes(app);
  shareRoutes(app);

  app.get('/api/stats', async () => ({
    photos: row<any>('SELECT COUNT(*) n FROM photos')!.n, shoots: row<any>('SELECT COUNT(*) n FROM shoots')!.n,
    cameras: row<any>('SELECT COUNT(DISTINCT camera) n FROM photos')!.n, edited: row<any>('SELECT COUNT(*) n FROM photos WHERE has_edit = 1')!.n,
  }));

  app.get('/api/shoots', async () => {
    // First photo per shoot (edited ones first) in a single pass.
    const covers = new Map(rows<any>(`SELECT shoot_id, id FROM (
        SELECT shoot_id, id, ROW_NUMBER() OVER (PARTITION BY shoot_id ORDER BY has_edit DESC, taken_at) AS rn FROM photos) WHERE rn = 1`)
      .map(r => [r.shoot_id, r.id]));
    return rows<any>('SELECT * FROM shoots ORDER BY date DESC').map(s => ({ ...s, cover: covers.get(s.id) ?? null }));
  });

  app.get<{ Querystring: { q?: string; shoot?: string; album?: string; fav?: string; edited?: string; limit?: string; offset?: string } }>('/api/photos', async (req) => {
    const { q, shoot, album, fav, edited } = req.query;
    const where: string[] = [], args: any[] = [];
    for (const term of (q ?? '').toLowerCase().split(/\s+/).filter(Boolean)) {
      if (term.startsWith('favorite')) { where.push('EXISTS(SELECT 1 FROM favorites f WHERE f.photo_id = p.id)'); continue; }
      where.push('p.hay LIKE ?'); args.push(`%${term}%`);
    }
    if (shoot) { where.push('p.shoot_id = ?'); args.push(shoot); }
    if (album) { where.push('p.id IN (SELECT photo_id FROM album_photos WHERE album_id = ?)'); args.push(album); }
    if (fav === '1') where.push('EXISTS(SELECT 1 FROM favorites f WHERE f.photo_id = p.id)');
    if (edited === '1') where.push('p.has_edit = 1');
    const limit = Math.min(Number(req.query.limit ?? 500), 2000), offset = Number(req.query.offset ?? 0);
    const sql = `${PHOTO_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.taken_at DESC, p.id LIMIT ? OFFSET ?`;
    const list = rows<any>(sql, ...args, limit, offset), versions = versionsFor(list.map(p => p.id));
    return list.map(p => shape(p, versions.get(p.id) ?? []));
  });

  app.get<{ Params: { id: string } }>('/api/photos/:id', async (req, reply) => {
    const p = row<any>(`${PHOTO_SELECT} WHERE p.id = ?`, req.params.id);
    return p ? shape(p) : reply.code(404).send({ error: 'not found' });
  });

  app.post<{ Params: { id: string }; Body: { fav: boolean } }>('/api/photos/:id/fav', async (req) => {
    if (req.body.fav) db.prepare('INSERT OR IGNORE INTO favorites (photo_id) VALUES (?)').run(req.params.id);
    else db.prepare('DELETE FROM favorites WHERE photo_id = ?').run(req.params.id);
    return { ok: true };
  });

  app.get('/api/albums', async () => rows(`SELECT a.id, a.title, (SELECT COUNT(*) FROM album_photos WHERE album_id = a.id) AS count,
      (SELECT p.id FROM album_photos ap JOIN photos p ON p.id = ap.photo_id WHERE ap.album_id = a.id ORDER BY p.has_edit DESC, p.taken_at LIMIT 1) AS cover
    FROM albums a ORDER BY a.title`));

  // "Try" suggestions for mobile search, drawn from the actual library.
  app.get('/api/search/suggest', async () => {
    const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const out: { label: string; kind: string }[] = [];
    const shoot = row<any>('SELECT title FROM shoots ORDER BY date DESC LIMIT 1');
    if (shoot) out.push({ label: shoot.title, kind: 'Shoot' });
    const cam = row<any>('SELECT camera, COUNT(*) n FROM photos WHERE camera IS NOT NULL GROUP BY camera ORDER BY n DESC LIMIT 1');
    if (cam) out.push({ label: cam.camera, kind: 'Camera' });
    const d = row<any>('SELECT date FROM shoots ORDER BY date DESC LIMIT 1');
    if (d) { const [y, m] = String(d.date).split('-'); out.push({ label: `${MONTHS[+m - 1]} ${y}`, kind: 'Date' }); }
    const lens = row<any>('SELECT CAST(ROUND(focal) AS INTEGER) f, COUNT(*) n FROM photos WHERE focal IS NOT NULL GROUP BY f ORDER BY n DESC LIMIT 1');
    if (lens) out.push({ label: `${lens.f}mm`, kind: 'Lens' });
    out.push({ label: 'Favorites', kind: 'Collection' });
    return out;
  });
  app.post<{ Body: { title: string } }>('/api/albums', async (req) =>
    ({ id: Number(db.prepare('INSERT INTO albums (title) VALUES (?)').run(req.body.title).lastInsertRowid) }));
  app.post<{ Params: { id: string }; Body: { photoIds: string[] } }>('/api/albums/:id/photos', async (req) => {
    for (const pid of req.body.photoIds) db.prepare('INSERT OR IGNORE INTO album_photos (album_id, photo_id) VALUES (?,?)').run(req.params.id, pid);
    return { ok: true };
  });

  app.get<{ Params: { id: string }; Querystring: { v?: string; w?: string } }>('/api/photos/:id/thumb', async (req, reply) =>
    sendResized(reply, req.params.id, req.query.v, Math.min(Number(req.query.w ?? 480), 1200)));
  app.get<{ Params: { id: string }; Querystring: { v?: string } }>('/api/photos/:id/preview', async (req, reply) => sendResized(reply, req.params.id, req.query.v, 2400));
  app.get<{ Params: { id: string }; Querystring: { v?: string } }>('/api/photos/:id/original', async (req, reply) => sendOriginal(reply, req.params.id, req.query.v));
  app.get<{ Params: { id: string }; Querystring: { v?: string } }>('/api/photos/:id/file', async (req, reply) => sendFile(reply, req.params.id, req.query.v));

  // Server-sent events: the UI refreshes when a rescan finishes ("Exposure is watching /Images…").
  app.get('/api/events', (req, reply) => {
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const send = (e: any) => reply.raw.write(`event: indexed\ndata: ${JSON.stringify(e)}\n\n`);
    events.on('indexed', send);
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), 25000);
    req.raw.on('close', () => { events.off('indexed', send); clearInterval(ping); });
  });
  // ── Library rules ──
  const allFiles = () => db.prepare('SELECT path, dir, name, ext, size, mtime FROM files').all() as unknown as FileRow[];
  const libName = () => path.posix.basename(getLibrary()?.base ?? '') || 'Library';
  const summary = (files: FileRow[], rules: Rules, trace?: Trace) => {
    const photos = group(files, rules, libName(), trace);
    const models = rules.styledCameras.length
      ? new Map(rows<{ path: string; camera: string }>("SELECT path, json_extract(meta, '$.camera') camera FROM files WHERE meta IS NOT NULL").map(r => [r.path, r.camera]))
      : new Map<string, string>();
    return {
      summary: { files: files.length, photos: photos.length, edited: photos.filter(p => isEdited(p, rules, f => models.get(f))).length,
        events: new Set(photos.map(p => p.event.id)).size },
      photos,
    };
  };
  app.get('/api/rules', async () => {
    const rules = getRules(), files = allFiles();
    // Cameras with their own JPEGs in the library, for "count these as edited".
    const cameras = rows<{ camera: string; n: number }>(`SELECT p.camera, COUNT(*) n FROM photos p WHERE p.camera IS NOT NULL
      AND EXISTS (SELECT 1 FROM versions v WHERE v.photo_id = p.id AND v.key = 'camera') GROUP BY p.camera ORDER BY n DESC`);
    return { rules, presets: { generic: GENERIC, photographer: PHOTOGRAPHER }, suggestions: suggest(files, rules), summary: summary(files, rules).summary, cameras };
  });
  app.put<{ Body: Partial<Rules> }>('/api/rules', async (req, reply) => {
    const error = ruleError(normalize(req.body ?? {}));
    if (error) return reply.code(400).send({ error });
    const rules = saveRules(req.body ?? {});
    void applyRules();
    return { rules };
  });
  // Live preview of draft rules: totals for the whole library and what each pattern matched.
  app.post<{ Body: { rules: Partial<Rules> } }>('/api/rules/preview', async req => {
    const rules = normalize(req.body?.rules ?? {}), files = allFiles(), trace = newTrace();
    const { summary: s, photos } = summary(files, rules, trace);
    const skipped = s.files - photos.reduce((n, p) => n + p.versions.length, 0);
    return { summary: { ...s, skipped }, patterns: patternReport(rules, trace) };
  });

  // What each pattern matched, and what none did: the misses show people which formats to add.
  const leaf = (p: string) => p.split('/').at(-1) || '(library folder)';
  const misses = (list: string[]) => {
    const names = [...new Set(list.map(leaf))];
    return { count: names.length, examples: names.sort((a, b) => Number(/\d/.test(b)) - Number(/\d/.test(a))).slice(0, 6) };
  };
  // Examples: one per pattern first, so each pattern shows what it did.
  const firstPerPattern = <T extends { pattern: number }>(list: T[], n: number) => {
    const seen = new Set<number>(), firsts: T[] = [];
    for (const x of list) if (!seen.has(x.pattern)) { seen.add(x.pattern); firsts.push(x); }
    return [...firsts, ...list.slice(0, n).filter(x => !firsts.includes(x))].slice(0, n);
  };
  const patternReport = (rules: Rules, t: Trace) => {
    const count = (n: number, hits: { pattern: number }[]) => { const c = Array<number>(n).fill(0); hits.forEach(h => c[h.pattern]++); return c; };
    const events = [...t.events].map(([folder, m]) => ({ ...m, folder: leaf(folder) }));
    const unmatched = misses(t.unmatched);
    const versions = Object.fromEntries(ROLES.map(role => {
      const srcs = rules.versions[role];
      // "Export/DSC1.jpg": as much of the path as the pattern describes.
      const hits = t.versions[role].map(h => ({ ...h, file: h.file.split('/').slice(-srcs[h.pattern].split('/').length).join('/') }));
      return [role, { sources: srcs, counts: count(srcs.length, hits), errors: srcs.map(s => compileFile(role, s).error ?? null),
        examples: firstPerPattern(hits, 3), misses: role === 'edited' ? misses(t.unpaired) : unmatched }];
    }));
    return {
      events: { sources: rules.eventPatterns, counts: count(rules.eventPatterns.length, events), errors: rules.eventPatterns.map(s => compileEvent(s).error ?? null),
        examples: firstPerPattern(events, 3), misses: misses([...t.undated]) },
      versions,
    };
  };

  setupRoutes(app);
  app.post('/api/rescan', async () => { void scan(); return { ok: true }; });

  if (config.webDir && fsSync.existsSync(config.webDir)) {
    await app.register(fstatic, { root: config.webDir });
    app.setNotFoundHandler((req, reply) => req.url.startsWith('/api/') ? reply.code(404).send({ error: 'not found' }) : reply.sendFile('index.html'));
  }
  return app;
}
