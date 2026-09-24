import path from 'node:path';
import crypto from 'node:crypto';
import exifr from 'exifr';
import sharp from 'sharp';
import { EventEmitter } from 'node:events';
import { RAW_EXT, JPEG_EXT } from './config.js';
import { db } from './db.js';
import { getLibrary, type Library } from './library.js';

export const events = new EventEmitter();

export const SHOOT_RE = /^(\d{4})-(\d{2})-(\d{2})\s+(.+)$/;
const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
const posix = path.posix;

export const progress = { phase: 'idle' as 'idle' | 'scanning' | 'done', count: 0, current: '', error: '', shoots: 0, shootsDone: 0 };

interface Found { key: 'edited' | 'camera' | 'raw'; label: string; fmt: string; size: number; file: string; mtime: number }

const safeList = async (lib: Library, p: string) => { try { return await lib.storage.list(p); } catch { return []; } };

// Same stem across ARW / JPG / Export/jpg → one photo with up to three versions.
async function scanShoot(lib: Library, folder: string) {
  const groups = new Map<string, { name: string; versions: Found[] }>();
  const add = (rel: string, size: number, mtime: number, key: Found['key'], label: string, fmt: string) => {
    const stem = posix.parse(rel).name;
    const g = groups.get(stem.toLowerCase()) ?? { name: stem, versions: [] };
    g.versions.push({ key, label, fmt, size, file: rel, mtime });
    groups.set(stem.toLowerCase(), g);
  };
  for (const e of await safeList(lib, posix.join(lib.base, folder))) {
    if (e.isDir) continue;
    const ext = posix.extname(e.name).toLowerCase();
    if (JPEG_EXT.has(ext)) add(e.name, e.size, e.mtime, 'camera', 'Camera', 'JPEG');
    else if (RAW_EXT[ext]) add(e.name, e.size, e.mtime, 'raw', 'Original', RAW_EXT[ext]);
  }
  for (const e of await safeList(lib, posix.join(lib.base, folder, 'Export')))
    if (!e.isDir && JPEG_EXT.has(posix.extname(e.name).toLowerCase())) add(`Export/${e.name}`, e.size, e.mtime, 'edited', 'Edited', 'JPEG');
  return [...groups.values()];
}

/** EXIF + dimensions from the head of the file only, so remote sources don't download whole photos. */
export async function readMeta(lib: Library, rel: string, isRaw: boolean) {
  try {
    const buf = await lib.storage.read(posix.join(lib.base, rel), isRaw ? 1_000_000 : 400_000);
    const x: any = (await exifr.parse(buf, ['Make', 'Model', 'LensModel', 'FocalLength', 'FNumber', 'ExposureTime', 'ISO', 'DateTimeOriginal', 'ExifImageWidth', 'ExifImageHeight'])) ?? {};
    if (!x.ExifImageWidth && !isRaw) {
      const m = await sharp(buf).metadata().catch(() => null);
      if (m?.width && m?.height) { const rot = (m.orientation ?? 1) >= 5; x.ExifImageWidth = rot ? m.height : m.width; x.ExifImageHeight = rot ? m.width : m.height; }
    }
    return x;
  } catch { return {}; }
}

const fmtShutter = (t?: number) => !t ? null : t >= 1 ? `${t}s` : `1/${Math.round(1 / t)}`;
const ORDER = { edited: 0, camera: 1, raw: 2 } as const;

let running = false;
export async function scan() {
  const lib = getLibrary();
  if (running || !lib) return;
  running = true;
  Object.assign(progress, { phase: 'scanning', count: 0, current: '', error: '', shoots: 0, shootsDone: 0 });
  const t0 = Date.now();
  try {
    const seen = new Set<string>(), shootIds = new Set<string>();
    const top = await lib.storage.list(lib.base);
    progress.shoots = top.filter(e => e.isDir && SHOOT_RE.test(e.name)).length;
    for (const e of top) {
      const m = e.isDir && SHOOT_RE.exec(e.name);
      if (!m) continue;
      const [, y, mo, d, title] = m;
      const shootId = crypto.createHash('sha1').update(e.name).digest('hex').slice(0, 12);
      shootIds.add(shootId);
      progress.current = `${lib.base.replace(/\/$/, '')}/${e.name}`;
      const groups = await scanShoot(lib, e.name);
      let camera: string | null = null;

      db.prepare(`INSERT INTO shoots (id, folder, title, date) VALUES (?,?,?,?)
                  ON CONFLICT(id) DO UPDATE SET folder=excluded.folder, title=excluded.title, date=excluded.date`)
        .run(shootId, e.name, title, `${y}-${mo}-${d}`);

      for (const g of groups) {
        g.versions.sort((a, b) => ORDER[a.key] - ORDER[b.key]);
        const id = crypto.createHash('sha1').update(`${e.name}/${g.name.toLowerCase()}`).digest('hex').slice(0, 16);
        seen.add(id);
        progress.count++;
        const sig = g.versions.map(v => `${v.file}:${v.size}:${v.mtime}`).join('|');
        const prev = db.prepare('SELECT sig, camera FROM photos WHERE id = ?').get(id) as { sig: string; camera: string | null } | undefined;
        if (prev?.sig === sig) { camera ??= prev.camera; continue; } // unchanged: skip EXIF

        const src = g.versions.find(v => v.key !== 'raw') ?? g.versions[0];
        const x = await readMeta(lib, `${e.name}/${src.file}`, src.key === 'raw');
        const taken = x.DateTimeOriginal instanceof Date ? x.DateTimeOriginal.toISOString() : `${y}-${mo}-${d}T12:00:00.000Z`;
        const cam = x.Model ? String(x.Model) : null;
        camera ??= cam;
        const hasEdit = g.versions.some(v => v.key === 'edited') ? 1 : 0;
        const hay = [title, cam, x.LensModel, x.FocalLength && `${Math.round(x.FocalLength)}mm`, MONTHS[+mo - 1], y, g.name, hasEdit ? 'edited' : '']
          .filter(Boolean).join(' ').toLowerCase();

        db.prepare(`INSERT INTO photos (id, shoot_id, name, taken_at, camera, lens, focal, fnum, shutter, iso, width, height, has_edit, has_raw, sig, hay)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET taken_at=excluded.taken_at, camera=excluded.camera, lens=excluded.lens, focal=excluded.focal,
            fnum=excluded.fnum, shutter=excluded.shutter, iso=excluded.iso, width=excluded.width, height=excluded.height,
            has_edit=excluded.has_edit, has_raw=excluded.has_raw, sig=excluded.sig, hay=excluded.hay`)
          .run(id, shootId, g.name, taken, cam, x.LensModel ?? null, x.FocalLength ?? null, x.FNumber ?? null, fmtShutter(x.ExposureTime),
            x.ISO ?? null, x.ExifImageWidth ?? null, x.ExifImageHeight ?? null, hasEdit, g.versions.some(v => v.key === 'raw') ? 1 : 0, sig, hay);
        db.prepare('DELETE FROM versions WHERE photo_id = ?').run(id);
        for (const v of g.versions)
          db.prepare('INSERT INTO versions (photo_id, key, label, fmt, size, file) VALUES (?,?,?,?,?,?)').run(id, v.key, v.label, v.fmt, v.size, v.file);
      }
      db.prepare(`UPDATE shoots SET camera = COALESCE(?, camera),
          count = (SELECT COUNT(*) FROM photos WHERE shoot_id = shoots.id),
          edited = (SELECT COUNT(*) FROM photos WHERE shoot_id = shoots.id AND has_edit = 1) WHERE id = ?`).run(camera, shootId);
      progress.shootsDone++;
    }
    for (const { id } of db.prepare('SELECT id FROM photos').all() as { id: string }[])
      if (!seen.has(id)) db.prepare('DELETE FROM photos WHERE id = ?').run(id);
    for (const { id } of db.prepare('SELECT id FROM shoots').all() as { id: string }[])
      if (!shootIds.has(id)) db.prepare('DELETE FROM shoots WHERE id = ?').run(id);
    progress.phase = 'done';
    events.emit('indexed', { ms: Date.now() - t0 });
    console.log(`[exposure] indexed ${seen.size} photos in ${Date.now() - t0}ms`);
  } catch (err) {
    progress.phase = 'idle'; progress.error = (err as Error).message;
    console.error('[exposure] scan failed:', err);
  } finally { running = false; }
}

let watcher: { close(): Promise<void> } | undefined, poll: NodeJS.Timeout | undefined;
/** Mounted folders are watched for changes; remote sources are re-scanned on a timer. */
export async function watch() {
  const lib = getLibrary();
  await watcher?.close(); watcher = undefined; clearInterval(poll);
  if (!lib) return;
  if (lib.storage.localPath) {
    const { default: chokidar } = await import('chokidar');
    let timer: NodeJS.Timeout | undefined;
    watcher = chokidar.watch(lib.storage.localPath(lib.base), { ignoreInitial: true, depth: 3, awaitWriteFinish: { stabilityThreshold: 2000 }, usePolling: process.env.EXPOSURE_POLL === '1' })
      .on('all', () => { clearTimeout(timer); timer = setTimeout(() => void scan(), 3000); });
  } else {
    poll = setInterval(() => void scan(), 10 * 60_000);
  }
}
