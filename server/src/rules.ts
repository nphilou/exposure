import crypto from 'node:crypto';
import path from 'node:path';
import { db } from './db.js';

/**
 * Library rules: how files on disk become photos, versions and events.
 * Everything that used to be a hard-coded convention (Export = edited, RAW folders, dated folder
 * names…) is a rule here, visible and editable in Settings → Library rules.
 */
export type Role = 'edited' | 'camera' | 'raw';
export interface FolderRule { name: string; role: Role }   // `name` may use * as a wildcard, e.g. "Export*"
export interface Rules {
  folders: FolderRule[];     // subfolders whose files are versions of the photos in the parent folder
  editSuffix: boolean;       // "DSC1-1.jpg" next to "DSC1.ARW" is the edit of that RAW
  pairSameName: boolean;     // files sharing a name (DSC1.ARW + DSC1.JPG) are one photo
  preferred: Role[];         // which version represents a photo in the grid
  datedFolders: boolean;     // "2016-01-25 Paris" is an event named "Paris" on that date
  onlyDated: boolean;        // skip photos that aren't inside a dated folder
  exclude: string[];         // folder names to skip (wildcards allowed)
  types: string[];           // file extensions to include
  defaultView: 'all' | 'edited';
}

export const RAW_EXT: Record<string, string> = {
  arw: 'Sony RAW', raf: 'Fujifilm RAW', cr3: 'Canon RAW', cr2: 'Canon RAW', nef: 'Nikon RAW', dng: 'DNG',
  orf: 'Olympus RAW', rw2: 'Panasonic RAW', pef: 'Pentax RAW', srw: 'Samsung RAW',
};
export const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'tif', 'tiff', 'webp'];
/** Every extension the indexer records, so changing `types` never needs a rescan. */
export const KNOWN_EXT = new Set([...IMAGE_EXT, ...Object.keys(RAW_EXT)]);

export const GENERIC: Rules = {
  folders: [], editSuffix: false, pairSameName: true, preferred: ['edited', 'camera', 'raw'],
  datedFolders: true, onlyDated: false, exclude: [], types: [...IMAGE_EXT, ...Object.keys(RAW_EXT)], defaultView: 'all',
};
/** What Exposure did before rules existed; applied to libraries indexed by an older version. */
export const PHOTOGRAPHER: Rules = {
  ...GENERIC,
  folders: [{ name: 'Export*', role: 'edited' }, { name: 'RAW', role: 'raw' }, { name: 'JPG', role: 'camera' }],
  editSuffix: true, onlyDated: true, types: ['jpg', 'jpeg', ...Object.keys(RAW_EXT)],
};

const ROLES: Role[] = ['edited', 'camera', 'raw'];
export function normalize(r: Partial<Rules>): Rules {
  const b = { ...GENERIC, ...r };
  const preferred = [...new Set((b.preferred ?? []).filter(x => ROLES.includes(x)))];
  for (const x of ROLES) if (!preferred.includes(x)) preferred.push(x);
  return {
    folders: (b.folders ?? []).filter(f => f?.name?.trim() && ROLES.includes(f.role)).map(f => ({ name: f.name.trim(), role: f.role })),
    editSuffix: !!b.editSuffix, pairSameName: !!b.pairSameName, preferred,
    datedFolders: !!b.datedFolders, onlyDated: !!b.onlyDated && !!b.datedFolders,
    exclude: [...new Set((b.exclude ?? []).map(s => String(s).trim()).filter(Boolean))],
    types: [...new Set((b.types ?? []).map(s => String(s).toLowerCase().replace(/^\./, '')).filter(t => KNOWN_EXT.has(t)))],
    defaultView: b.defaultView === 'edited' ? 'edited' : 'all',
  };
}

let cached: Rules | null = null;
/** Existing libraries (photos indexed before rules existed) keep their behaviour via the PHOTOGRAPHER preset. */
export function initRules() {
  if (db.prepare("SELECT 1 FROM settings WHERE key = 'rules'").get()) return;
  const existing = (db.prepare('SELECT COUNT(*) n FROM photos').get() as { n: number }).n > 0;
  saveRules(existing ? PHOTOGRAPHER : GENERIC);
}
export function getRules(): Rules {
  if (cached) return cached;
  const r = db.prepare("SELECT value FROM settings WHERE key = 'rules'").get() as { value: string } | undefined;
  return cached = normalize(r ? JSON.parse(r.value) : GENERIC);
}
export function saveRules(r: Partial<Rules>) {
  cached = normalize(r);
  db.prepare("INSERT INTO settings (key, value) VALUES ('rules', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(cached));
  return cached;
}

// ── Grouping ────────────────────────────────────────────────────────────────

export interface FileRow { path: string; dir: string; name: string; ext: string; size: number; mtime: number }
export interface GVersion { role: Role; label: string; fmt: string; file: string; size: number; mtime: number }
export interface GEvent { id: string; folder: string; title: string; date: string | null }
export interface GPhoto { id: string; name: string; dir: string; event: GEvent; versions: GVersion[] }

// "2016-01-25 Paris - Samsam", "2026-01-01", "2008-05 Allemagne"
export const DATED_RE = /^(\d{4})-(\d{2})(?:-(\d{2}))?(?:\s+(.+))?$/;
const hash = (s: string, n: number) => crypto.createHash('sha1').update(s).digest('hex').slice(0, n);
const glob = (pattern: string) => new RegExp('^' + pattern.toLowerCase().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');

export const roleLabel = (role: Role, hasRaw: boolean) => role === 'edited' ? 'Edited' : role === 'raw' ? 'Original' : hasRaw ? 'Camera' : 'Photo';
const fmtOf = (ext: string) => RAW_EXT[ext] ?? (ext === 'jpg' || ext === 'jpeg' ? 'JPEG' : ext === 'tif' ? 'TIFF' : ext.toUpperCase());

/** Pure: files + rules → photos. Used for indexing, the live preview and suggestions. */
export function group(files: FileRow[], rules: Rules, libraryName = 'Library'): GPhoto[] {
  const types = new Set(rules.types);
  const exclude = rules.exclude.map(glob);
  const folderRules = rules.folders.map(f => ({ re: glob(f.name), role: f.role }));
  const eventCache = new Map<string, GEvent | null>();

  const eventFor = (dir: string): GEvent | null => {
    if (eventCache.has(dir)) return eventCache.get(dir)!;
    const segs = dir ? dir.split('/') : [];
    let ev: GEvent | null = null;
    if (rules.datedFolders) {
      for (let i = segs.length - 1; i >= 0 && !ev; i--) {
        const m = DATED_RE.exec(segs[i]);
        if (m) { const folder = segs.slice(0, i + 1).join('/'); ev = { id: hash(folder, 12), folder, title: m[4] ?? segs[i], date: `${m[1]}-${m[2]}-${m[3] ?? '01'}` }; }
      }
    }
    if (!ev && !rules.onlyDated) ev = { id: hash(dir, 12), folder: dir, title: segs.at(-1) ?? libraryName, date: null };
    eventCache.set(dir, ev);
    return ev;
  };

  type C = { f: FileRow; dir: string; stem: string; role: Role; fromFolder: boolean; ev: GEvent };
  const cands: C[] = [];
  for (const f of files) {
    if (!types.has(f.ext)) continue;
    const segs = f.dir ? f.dir.split('/') : [];
    if (segs.some(s => exclude.some(re => re.test(s.toLowerCase())))) continue;
    let dir = f.dir, folderRole: Role | undefined;
    const last = segs.at(-1)?.toLowerCase();
    if (last !== undefined) {
      folderRole = folderRules.find(r => r.re.test(last))?.role;
      if (folderRole) dir = segs.slice(0, -1).join('/');   // Export/DSC1.jpg joins the photos of its parent folder
    }
    const ev = eventFor(dir);
    if (!ev) continue;
    const isRaw = !!RAW_EXT[f.ext];
    cands.push({ f, dir, stem: path.posix.parse(f.name).name, role: isRaw ? 'raw' : folderRole ?? 'camera', fromFolder: !!folderRole, ev });
  }

  if (rules.editSuffix) {
    // "DSC1-1.jpg" is the edit of "DSC1.ARW" in the same folder, a subfolder (RAW/) or the parent folder.
    const parent = (d: string) => d.includes('/') ? d.slice(0, d.lastIndexOf('/')) : '';
    const raws = new Map<string, string[]>();
    for (const c of cands) if (c.role === 'raw') { const k = c.stem.toLowerCase(); (raws.get(k) ?? raws.set(k, []).get(k)!).push(c.dir); }
    for (const c of cands) {
      if (c.role === 'raw' || raws.get(c.stem.toLowerCase())?.includes(c.dir)) continue;
      const base = /^(.*?)[-_ ]\d{1,2}$/.exec(c.stem)?.[1];
      const d = base && raws.get(base.toLowerCase())?.find(d => d === c.dir || parent(d) === c.dir || d === parent(c.dir));
      if (d !== undefined && d !== null && base) { c.stem = base; c.dir = d; if (!c.fromFolder) c.role = 'edited'; }
    }
  }

  const photos = new Map<string, GPhoto & { byRole: Map<Role, C> }>();
  for (const c of cands) {
    const key = rules.pairSameName ? `${c.dir}/${c.stem.toLowerCase()}` : c.f.path;
    let p = photos.get(key);
    if (!p) photos.set(key, p = { id: hash(key, 16), name: c.stem, dir: c.dir, event: c.ev, versions: [], byRole: new Map() });
    const prev = p.byRole.get(c.role);
    if (!prev || c.f.mtime > prev.f.mtime) p.byRole.set(c.role, c);   // several exports of one photo: newest wins
  }
  const order = (r: Role) => rules.preferred.indexOf(r);
  return [...photos.values()].map(({ byRole, ...p }) => {
    const hasRaw = byRole.has('raw');
    p.versions = [...byRole.values()].sort((a, b) => order(a.role) - order(b.role)).map(c => ({
      role: c.role, label: roleLabel(c.role, hasRaw), fmt: fmtOf(c.f.ext), file: c.f.path, size: c.f.size, mtime: c.f.mtime,
    }));
    return p;
  });
}

/** Rules the library seems to call for, shown in onboarding and on the rules page. */
export function suggest(files: FileRow[], rules: Rules) {
  const dirs = new Map<string, number>();
  const datedDirs = new Set<string>();
  for (const f of files) {
    const segs = f.dir ? f.dir.split('/') : [];
    const last = segs.at(-1);
    if (last) dirs.set(f.dir, (dirs.get(f.dir) ?? 0) + 1);
    segs.forEach((s, i) => { if (DATED_RE.test(s)) datedDirs.add(segs.slice(0, i + 1).join('/')); });
  }
  const has = (name: string) => rules.folders.some(r => glob(r.name).test(name.toLowerCase()));
  const byName = new Map<string, number>();
  for (const d of dirs.keys()) {
    const n = d.split('/').at(-1)!.toLowerCase();
    byName.set(n, (byName.get(n) ?? 0) + 1);
  }
  const count = (re: RegExp) => [...byName].filter(([n]) => re.test(n)).reduce((a, [, c]) => a + c, 0);
  const out: { id: string; text: string; count: number; apply: Partial<Rules> }[] = [];
  const folder = (id: string, re: RegExp, name: string, role: Role, label: string) => {
    const c = count(re);
    if (c && !has(name.replace('*', ''))) out.push({ id, count: c, text: `${c} ${c === 1 ? 'folder is' : 'folders are'} named “${name.replace('*', '')}”. Show ${c === 1 ? 'its' : 'their'} photos as the ${label} version?`,
      apply: { folders: [...rules.folders, { name, role }] } });
  };
  folder('export', /^exports?([ _-].*)?$/, 'Export*', 'edited', 'edited');
  folder('edited', /^edit(ed|s)?$/, 'Edited', 'edited', 'edited');
  folder('raw', /^raws?$/, 'RAW', 'raw', 'original');
  folder('jpg', /^jpe?g$/, 'JPG', 'camera', 'camera');
  if (!rules.datedFolders && datedDirs.size) out.push({ id: 'dated', count: datedDirs.size, text: `${datedDirs.size} folders start with a date. Show them as events?`, apply: { datedFolders: true } });
  if (!rules.editSuffix) {
    const parent = (d: string) => d.includes('/') ? d.slice(0, d.lastIndexOf('/')) : '';
    const raws = new Map<string, string[]>();   // stem → folders holding a RAW with that stem
    for (const f of files) if (RAW_EXT[f.ext]) { const k = path.posix.parse(f.name).name.toLowerCase(); (raws.get(k) ?? raws.set(k, []).get(k)!).push(f.dir); }
    let c = 0;
    for (const f of files) {
      if (RAW_EXT[f.ext]) continue;
      const stem = path.posix.parse(f.name).name.toLowerCase();
      const base = /^(.*?)[-_ ]\d{1,2}$/.exec(stem)?.[1];
      if (!base || raws.has(stem)) continue;
      if (raws.get(base)?.some(d => d === f.dir || parent(d) === f.dir || d === parent(f.dir))) c++;
    }
    if (c) out.push({ id: 'suffix', count: c, text: `${c} JPEGs are named like “DSC1-1.jpg” next to a RAW file. Treat them as its edited version?`, apply: { editSuffix: true } });
  }
  return out;
}
