import path from 'node:path';
import crypto from 'node:crypto';
import exifr from 'exifr';
import sharp from 'sharp';
import { EventEmitter } from 'node:events';
import { RAW_EXT, JPEG_EXT } from './config.js';
import { db } from './db.js';
import { getLibrary, type Library } from './library.js';

export const events = new EventEmitter();

// "2016-01-25 Paris - Samsam", "2026-01-01", "2008-05 Allemagne"
export const SHOOT_RE = /^(\d{4})-(\d{2})(?:-(\d{2}))?(?:\s+(.+))?$/;
const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
const posix = path.posix;

export const progress = { phase: 'idle' as 'idle' | 'scanning' | 'done', count: 0, current: '', error: '', shoots: 0, shootsDone: 0 };

interface Found { key: 'edited' | 'camera' | 'raw'; label: string; fmt: string; size: number; file: string; mtime: number }

const safeList = async (lib: Library, p: string) => { try { return await lib.storage.list(p); } catch { return []; } };

// Subfolders that hold versions of the shoot's photos. Anything else inside a shoot is ignored.
const SUBDIRS: Record<string, Found['key']> = { export: 'edited', raw: 'raw', jpg: 'camera', jpeg: 'camera' };

/**
 * Groups a shoot's files into photos. Files belong together when they share a stem, e.g.
 *   DSC01234.ARW + DSC01234.JPG + Export/DSC01234.jpg
 * Lightroom-style exports with a copy suffix pair with their RAW too:
 *   RAW/_DSC9468.ARW + _DSC9468-1.jpg        (the -1 JPEG is the edit)
 */
async function scanShoot(lib: Library, folder: string) {
  type F = { rel: string; stem: string; ext: string; size: number; mtime: number; dir: Found['key'] | null };
  const files: F[] = [];
  const collect = async (sub: string, dir: Found['key'] | null) => {
    for (const e of await safeList(lib, posix.join(lib.base, folder, sub))) {
      if (e.isDir) {
        const k = sub ? undefined : SUBDIRS[e.name.toLowerCase()] ?? (/^export[ _-]/i.test(e.name) ? 'edited' : undefined);
        if (k) await collect(e.name, k);
        continue;
      }
      const ext = posix.extname(e.name).toLowerCase();
      if (!JPEG_EXT.has(ext) && !RAW_EXT[ext]) continue;
      files.push({ rel: sub ? `${sub}/${e.name}` : e.name, stem: posix.parse(e.name).name, ext, size: e.size, mtime: e.mtime, dir });
    }
  };
  await collect('', null);

  const rawStems = new Set(files.filter(f => RAW_EXT[f.ext]).map(f => f.stem.toLowerCase()));
  const groups = new Map<string, { name: string; versions: Found[] }>();
  for (const f of files) {
    let stem = f.stem, key: Found['key'];
    if (RAW_EXT[f.ext]) key = 'raw';
    else {
      const base = /^(.*?)[-_ ]\d{1,2}$/.exec(f.stem)?.[1];
      if (!rawStems.has(stem.toLowerCase()) && base && rawStems.has(base.toLowerCase())) { stem = base; key = 'edited'; }
      else key = f.dir === 'edited' ? 'edited' : 'camera';
    }
    const g = groups.get(stem.toLowerCase()) ?? { name: stem, versions: [] };
    const v: Found = { key, size: f.size, file: f.rel, mtime: f.mtime,
      label: key === 'edited' ? 'Edited' : key === 'raw' ? 'Original' : 'Camera', fmt: key === 'raw' ? RAW_EXT[f.ext] : 'JPEG' };
    // One version per kind; with several exports of the same photo, keep the most recent.
    const i = g.versions.findIndex(x => x.key === key);
    if (i < 0) g.versions.push(v); else if (v.mtime > g.versions[i].mtime) g.versions[i] = v;
    groups.set(stem.toLowerCase(), g);
  }
  return [...groups.values()];
}

/** Shoot folders at the top of the library, or one level down (e.g. year folders: 2016/2016-01-25 Paris). */
export async function findShoots(lib: Library) {
  const out: { folder: string; name: string }[] = [];
  for (const e of await lib.storage.list(lib.base)) {
    if (!e.isDir || e.name.startsWith('@') || e.name.startsWith('#')) continue;
    if (SHOOT_RE.test(e.name)) { out.push({ folder: e.name, name: e.name }); continue; }
    for (const c of await safeList(lib, posix.join(lib.base, e.name)))
      if (c.isDir && SHOOT_RE.test(c.name)) out.push({ folder: `${e.name}/${c.name}`, name: c.name });
  }
  return out.sort((a, b) => b.name.localeCompare(a.name));
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
    const found = await findShoots(lib);
    progress.shoots = found.length;
    for (const sh of found) {
      const [, y, mo, d = '01', title = sh.name] = SHOOT_RE.exec(sh.name)!;
      const e = { name: sh.folder };
      const shootId = crypto.createHash('sha1').update(sh.folder).digest('hex').slice(0, 12);
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
    watcher = chokidar.watch(lib.storage.localPath(lib.base), { ignoreInitial: true, depth: 4, awaitWriteFinish: { stabilityThreshold: 2000 }, usePolling: process.env.EXPOSURE_POLL === '1' })
      .on('all', () => { clearTimeout(timer); timer = setTimeout(() => void scan(), 3000); });
  } else {
    poll = setInterval(() => void scan(), 10 * 60_000);
  }
}
