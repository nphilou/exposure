import path from 'node:path';
import exifr from 'exifr';
import sharp from 'sharp';
import { EventEmitter } from 'node:events';
import { db } from './db.js';
import { getLibrary, type Library } from './library.js';
import { KNOWN_EXT, RAW_EXT, getRules, group, type FileRow, type GPhoto } from './rules.js';

export const events = new EventEmitter();
const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
const posix = path.posix;

// `shoots`/`shootsDone` drive the progress bar: folders walked, then photos whose metadata was read.
export const progress = { phase: 'idle' as 'idle' | 'scanning' | 'done', count: 0, current: '', error: '', shoots: 0, shootsDone: 0 };

const hidden = (n: string) => n.startsWith('.') || n.startsWith('@') || n.startsWith('#') || n === '$RECYCLE.BIN';
const LIST_CONCURRENCY = 6, META_CONCURRENCY = 8, MAX_DEPTH = 12;

/** Walks the whole library and records every image file (path, size, mtime) in `files`. */
async function walk(lib: Library) {
  const found: FileRow[] = [];
  const queue: { dir: string; depth: number }[] = [{ dir: '', depth: 0 }];
  let active = 0, done = 0;
  progress.shoots = 1; progress.shootsDone = 0;
  await new Promise<void>((resolve, reject) => {
    const pump = () => {
      if (!queue.length && !active) return resolve();
      while (active < LIST_CONCURRENCY && queue.length) {
        const { dir, depth } = queue.shift()!;
        active++;
        progress.current = `${lib.base.replace(/\/$/, '')}/${dir}`;
        lib.storage.list(posix.join(lib.base, dir)).then(entries => {
          for (const e of entries) {
            if (hidden(e.name)) continue;
            const rel = dir ? `${dir}/${e.name}` : e.name;
            if (e.isDir) { if (depth < MAX_DEPTH) { queue.push({ dir: rel, depth: depth + 1 }); progress.shoots++; } continue; }
            const ext = posix.extname(e.name).slice(1).toLowerCase();
            if (KNOWN_EXT.has(ext)) found.push({ path: rel, dir, name: e.name, ext, size: e.size, mtime: Math.round(e.mtime) });
          }
          progress.count = found.length;
        }, err => { if (!dir) reject(err); /* unreadable subfolder: skip it */ })
          .finally(() => { active--; done++; progress.shootsDone = done; pump(); });
      }
    };
    pump();
  });

  // Sync the files table: new/changed files lose their cached metadata, vanished files are removed.
  const prev = new Map((db.prepare('SELECT path, size, mtime FROM files').all() as { path: string; size: number; mtime: number }[]).map(r => [r.path, r]));
  const upsert = db.prepare(`INSERT INTO files (path, dir, name, ext, size, mtime, meta) VALUES (?,?,?,?,?,?,NULL)
    ON CONFLICT(path) DO UPDATE SET size=excluded.size, mtime=excluded.mtime, meta=NULL`);
  const del = db.prepare('DELETE FROM files WHERE path = ?');
  db.exec('BEGIN');
  try {
    for (const f of found) {
      const p = prev.get(f.path);
      prev.delete(f.path);
      if (!p || p.size !== f.size || p.mtime !== f.mtime) upsert.run(f.path, f.dir, f.name, f.ext, f.size, f.mtime);
    }
    for (const gone of prev.keys()) del.run(gone);
    seedMetaFromOldIndex();
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

/**
 * One-time upgrade from the pre-rules index: its photos already carry EXIF data, so copy it onto the
 * matching files instead of re-reading ~all photos from the NAS. Old version rows are the ones with mtime 0.
 */
function seedMetaFromOldIndex() {
  const old = db.prepare(`SELECT v.file, s.folder, p.taken_at, p.camera, p.lens, p.focal, p.fnum, p.shutter, p.iso, p.width, p.height
    FROM versions v JOIN photos p ON p.id = v.photo_id JOIN shoots s ON s.id = p.shoot_id WHERE v.mtime = 0`).all() as any[];
  if (!old.length) return;
  const set = db.prepare('UPDATE files SET meta = ? WHERE path = ? AND meta IS NULL');
  for (const o of old) {
    const m: Meta = { taken: o.taken_at, camera: o.camera ?? undefined, lens: o.lens ?? undefined, focal: o.focal ?? undefined, fnum: o.fnum ?? undefined,
      shutter: o.shutter ?? undefined, iso: o.iso ?? undefined, w: o.width ?? undefined, h: o.height ?? undefined };
    set.run(JSON.stringify(m), `${o.folder}/${o.file}`);
  }
  console.log(`[exposure] reused metadata for ${old.length} files from the previous index`);
}

interface Meta { taken?: string; camera?: string; lens?: string; focal?: number; fnum?: number; shutter?: string; iso?: number; w?: number; h?: number }
const fmtShutter = (t?: number) => !t ? undefined : t >= 1 ? `${t}s` : `1/${Math.round(1 / t)}`;

/** EXIF times carry no timezone: keep the camera's wall-clock time as-is, labelled "Z" and displayed as UTC by every client. */
function wallClock(v: unknown): string | undefined {
  const m = typeof v === 'string' && /^(\d{4})[:-](\d{2})[:-](\d{2})[T ](\d{2}):(\d{2}):(\d{2})/.exec(v);
  if (!m) return undefined;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z`;
  return isNaN(Date.parse(iso)) ? undefined : iso;
}

/** EXIF + dimensions from the head of the file only, so remote sources don't download whole photos. */
async function readMeta(lib: Library, rel: string, isRaw: boolean): Promise<Meta> {
  try {
    const buf = await lib.storage.read(posix.join(lib.base, rel), isRaw ? 1_000_000 : 400_000);
    // reviveValues:false keeps DateTimeOriginal as the raw "YYYY:MM:DD HH:MM:SS" string; reviving it would
    // interpret the camera's wall-clock time in the *server's* timezone.
    const x: any = (await exifr.parse(buf, { pick: ['Make', 'Model', 'LensModel', 'FocalLength', 'FNumber', 'ExposureTime', 'ISO', 'DateTimeOriginal', 'ExifImageWidth', 'ExifImageHeight'], reviveValues: false }).catch(() => null)) ?? {};
    if (!x.ExifImageWidth && !isRaw) {
      const m = await sharp(buf).metadata().catch(() => null);
      if (m?.width && m?.height) { const rot = (m.orientation ?? 1) >= 5; x.ExifImageWidth = rot ? m.height : m.width; x.ExifImageHeight = rot ? m.width : m.height; }
    }
    return {
      taken: wallClock(x.DateTimeOriginal),
      camera: x.Model ? String(x.Model) : undefined, lens: x.LensModel ?? undefined, focal: x.FocalLength ?? undefined,
      fnum: x.FNumber ?? undefined, shutter: fmtShutter(x.ExposureTime), iso: x.ISO ?? undefined, w: x.ExifImageWidth ?? undefined, h: x.ExifImageHeight ?? undefined,
    };
  } catch { return {}; }
}

/** The file we read EXIF from: a JPEG/TIFF if there is one (cheaper and usually complete), else the RAW. */
const metaSource = (p: GPhoto) => p.versions.find(v => v.role === 'camera') ?? p.versions.find(v => v.role !== 'raw') ?? p.versions[0];

let regrouping: Promise<void> | null = null, again = false;
/** Rebuilds photos/versions/shoots from `files` using the current rules. Cheap: no directory listing. */
export function regroup(): Promise<void> {
  if (regrouping) { again = true; return regrouping; }
  return regrouping = (async () => {
    try { do { again = false; await regroupOnce(); } while (again); }
    finally { regrouping = null; }
  })();
}

async function regroupOnce() {
  const lib = getLibrary();
  if (!lib) return;
  const t0 = Date.now();
  const rules = getRules();
  const files = db.prepare('SELECT path, dir, name, ext, size, mtime FROM files').all() as unknown as FileRow[];
  const photos = group(files, rules, posix.basename(lib.base) || lib.conn.name);

  // Read metadata for photos that don't have it yet (new files, or a different source after a rule change).
  const metas = new Map<string, Meta>();
  for (const r of db.prepare('SELECT path, meta FROM files WHERE meta IS NOT NULL').all() as { path: string; meta: string }[]) metas.set(r.path, JSON.parse(r.meta));
  const todo = [...new Set(photos.map(p => metaSource(p).file).filter(f => !metas.has(f)))];
  if (todo.length) {
    Object.assign(progress, { phase: 'scanning', shoots: todo.length, shootsDone: 0, current: 'Reading photo details…' });
    const save = db.prepare('UPDATE files SET meta = ? WHERE path = ?');
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(META_CONCURRENCY, todo.length) }, async () => {
      while (next < todo.length) {
        const f = todo[next++];
        const m = await readMeta(lib, f, !!RAW_EXT[posix.extname(f).slice(1).toLowerCase()]);
        metas.set(f, m); save.run(JSON.stringify(m), f);
        progress.shootsDone++;
      }
    }));
  }

  // Write everything in one transaction; favorites and albums reference photo ids, which are stable.
  const events = new Map<string, { id: string; folder: string; title: string; date: string | null; first: string; camera: string | null; count: number; edited: number }>();
  const insPhoto = db.prepare(`INSERT INTO photos (id, shoot_id, name, taken_at, camera, lens, focal, fnum, shutter, iso, width, height, has_edit, has_raw, sig, hay)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'',?)`);
  const insVersion = db.prepare('INSERT INTO versions (photo_id, key, label, fmt, size, file, mtime) VALUES (?,?,?,?,?,?,?)');
  const insShoot = db.prepare('INSERT INTO shoots (id, folder, title, date, camera, count, edited) VALUES (?,?,?,?,?,?,?)');
  const rows: { p: GPhoto; m: Meta; taken: string; hasEdit: boolean; hay: string }[] = [];
  const seen = new Set<string>();
  for (const p of photos) {
    if (seen.has(p.id)) continue; seen.add(p.id);
    const m = metas.get(metaSource(p).file) ?? {};
    const taken = m.taken ?? (p.event.date ? `${p.event.date}T12:00:00.000Z` : new Date(Math.max(...p.versions.map(v => v.mtime))).toISOString());
    const hasEdit = p.versions.some(v => v.role === 'edited');
    const [y, mo] = taken.split('-');
    const hay = [p.event.title, p.dir.replace(/\//g, ' '), m.camera, m.lens, m.focal && `${Math.round(m.focal)}mm`, MONTHS[+mo - 1], y, p.name, hasEdit ? 'edited' : '']
      .filter(Boolean).join(' ').toLowerCase();
    rows.push({ p, m, taken, hasEdit, hay });
    const e = events.get(p.event.id) ?? events.set(p.event.id, { ...p.event, first: taken, camera: null, count: 0, edited: 0 }).get(p.event.id)!;
    e.count++; if (hasEdit) e.edited++; if (taken < e.first) e.first = taken; e.camera ??= m.camera ?? null;
  }
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM versions; DELETE FROM photos; DELETE FROM shoots;');
    for (const e of events.values()) insShoot.run(e.id, e.folder, e.title, e.date ?? e.first.slice(0, 10), e.camera, e.count, e.edited);
    for (const { p, m, taken, hasEdit, hay } of rows) {
      insPhoto.run(p.id, p.event.id, p.name, taken, m.camera ?? null, m.lens ?? null, m.focal ?? null, m.fnum ?? null, m.shutter ?? null, m.iso ?? null,
        m.w ?? null, m.h ?? null, hasEdit ? 1 : 0, p.versions.some(v => v.role === 'raw') ? 1 : 0, hay);
      for (const v of p.versions) insVersion.run(p.id, v.role, v.label, v.fmt, v.size, v.file, v.mtime);
    }
    db.exec('COMMIT');
  } catch (err) { db.exec('ROLLBACK'); throw err; }
  console.log(`[exposure] grouped ${files.length} files into ${photos.length} photos in ${Date.now() - t0}ms`);
}

let running = false;
export async function scan() {
  const lib = getLibrary();
  if (running || !lib) return;
  running = true;
  Object.assign(progress, { phase: 'scanning', count: 0, current: '', error: '', shoots: 0, shootsDone: 0 });
  const t0 = Date.now();
  try {
    await walk(lib);
    await regroup();
    progress.phase = 'done';
    events.emit('indexed', { ms: Date.now() - t0 });
    console.log(`[exposure] indexed library in ${Date.now() - t0}ms`);
  } catch (err) {
    progress.phase = 'idle'; progress.error = (err as Error).message;
    console.error('[exposure] scan failed:', err);
  } finally { running = false; }
}

/** After a rules change: regroup from the files table and tell clients. */
export async function applyRules() {
  await regroup();
  events.emit('indexed', { rules: true });
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
    watcher = chokidar.watch(lib.storage.localPath(lib.base), { ignoreInitial: true, depth: MAX_DEPTH, awaitWriteFinish: { stabilityThreshold: 2000 }, usePolling: process.env.EXPOSURE_POLL === '1', interval: 30_000, binaryInterval: 30_000 })
      .on('all', () => { clearTimeout(timer); timer = setTimeout(() => void scan(), 3000); });
  } else {
    poll = setInterval(() => void scan(), 10 * 60_000);
  }
}
