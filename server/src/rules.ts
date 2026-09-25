import crypto from 'node:crypto';
import path from 'node:path';
import { db } from './db.js';
import {
  EDIT_CANDIDATES, EVENT_CANDIDATES, IMAGE_EXT, KNOWN_EXT, RAW_EXT, compileEvent, compileFile, matchEvent, matchFile, type Role,
} from './patterns.js';

export { IMAGE_EXT, KNOWN_EXT, RAW_EXT, type Role };

/**
 * Library rules: how files on disk become photos, versions and shoots.
 * Everything that used to be a hard-coded convention (Export = edited, RAW folders, dated folder
 * names…) is a pattern here, visible and editable in Settings → Library.
 */
export interface Rules {
  eventPatterns: string[];          // "{date} {title}": "2016-01-25 Paris" is a shoot named "Paris" on that date
  onlyDated: boolean;               // skip photos that aren't inside a folder matching a shoot pattern
  versions: Record<Role, string[]>; // file patterns per version, relative to the photo's folder: "Export*/{name}.*"
  preferred: Role[];                // which version represents a photo in the grid
  exclude: string[];                // folder names to skip (wildcards allowed)
  defaultView: 'all' | 'edited';
  styledCameras: string[];          // EXIF models whose own JPEGs count as edited (Fujifilm film simulations…)
}

export const ROLES: Role[] = ['edited', 'raw', 'camera'];   // when patterns tie, the first role wins

export const GENERIC: Rules = {
  eventPatterns: ['{date} {title}'], onlyDated: false,
  versions: { raw: ['{name}.*'], camera: ['{name}.*'], edited: [] },
  preferred: ['edited', 'camera', 'raw'], exclude: [], defaultView: 'all', styledCameras: [],
};
/** What Exposure did before rules existed; applied to libraries indexed by an older version. */
export const PHOTOGRAPHER: Rules = {
  ...GENERIC, onlyDated: true,
  versions: {
    raw: ['{name}.*', 'RAW/{name}.*'],
    camera: ['{name}.{jpg,jpeg}', 'JPG/{name}.{jpg,jpeg}'],
    edited: ['Export*/{name}.{jpg,jpeg}', 'Export*/{name}-{n}.{jpg,jpeg}', '{name}-{n}.{jpg,jpeg}'],
  },
};

/** Rules saved before version patterns existed: folder rules, file types and edit-name switches. */
interface Legacy {
  folders?: { name: string; role: Role }[]; types?: string[]; editPatterns?: string[]; editSuffix?: boolean; datedFolders?: boolean;
}
function fromLegacy(o: Legacy): Record<Role, string[]> {
  const types = o.types ?? [...KNOWN_EXT];
  const raws = Object.keys(RAW_EXT).filter(t => types.includes(t)), images = IMAGE_EXT.filter(t => types.includes(t));
  const ext = (have: string[], all: string[]) => have.length === all.length ? '*' : have.length === 1 ? have[0] : `{${have.join(',')}}`;
  const re = ext(raws, Object.keys(RAW_EXT)), ie = ext(images, IMAGE_EXT);
  const edits = (o.editPatterns ?? (o.editSuffix ? ['{name}-{n}'] : [])).filter(e => !e.startsWith('/'));
  const v: Record<Role, string[]> = { raw: [], camera: [], edited: [] };
  if (raws.length) v.raw.push(`{name}.${re}`);
  if (images.length) v.camera.push(`{name}.${ie}`);
  for (const f of o.folders ?? []) {
    if (f.role === 'raw') { if (raws.length) v.raw.push(`${f.name}/{name}.${re}`); }
    else if (images.length) v[f.role].push(`${f.name}/{name}.${ie}`, ...(f.role === 'edited' ? edits.map(e => `${f.name}/${e}.${ie}`) : []));
  }
  if (images.length) v.edited.push(...edits.map(e => `${e}.${ie}`));
  return v;
}

const strings = (list: unknown) => [...new Set((Array.isArray(list) ? list : []).map(s => String(s).trim()).filter(Boolean))];
export function normalize(input: Partial<Rules> & Legacy): Rules {
  const r = { ...input };
  if (r.eventPatterns === undefined && r.datedFolders !== undefined) r.eventPatterns = r.datedFolders ? ['{date} {title}'] : [];
  if (r.versions === undefined && (r.folders || r.types || r.editPatterns || r.editSuffix !== undefined)) r.versions = fromLegacy(r);
  const b = { ...GENERIC, ...r };
  const eventPatterns = strings(b.eventPatterns);
  const preferred = [...new Set((b.preferred ?? []).filter(x => ROLES.includes(x)))];
  for (const x of ['edited', 'camera', 'raw'] as Role[]) if (!preferred.includes(x)) preferred.push(x);
  return {
    eventPatterns, onlyDated: !!b.onlyDated && eventPatterns.length > 0,
    versions: { raw: strings(b.versions?.raw), camera: strings(b.versions?.camera), edited: strings(b.versions?.edited) },
    preferred,
    exclude: strings(b.exclude),
    defaultView: b.defaultView === 'edited' ? 'edited' : 'all',
    styledCameras: strings(b.styledCameras),
  };
}

/** The first invalid pattern, as a message for the person editing the rules. */
export function ruleError(r: Rules) {
  for (const src of r.eventPatterns) { const e = compileEvent(src).error; if (e) return `“${src}”: ${e}`; }
  for (const role of ROLES) for (const src of r.versions[role]) { const e = compileFile(role, src).error; if (e) return `“${src}”: ${e}`; }
  return null;
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

/** How the patterns matched, collected for the rules preview. */
export interface Trace {
  events: Map<string, { pattern: number; title: string; date: string }>;   // shoot folder → how it matched
  undated: Set<string>;                                                     // folders of photos no shoot pattern matched
  versions: Record<Role, { pattern: number; file: string; name: string }[]>;
  unmatched: string[];   // files no version pattern matched: not shown
  unpaired: string[];    // named like a nearby photo plus something no pattern recognises ("DSC1_final.jpg")
}
export const newTrace = (): Trace => ({ events: new Map(), undated: new Set(), versions: { edited: [], camera: [], raw: [] }, unmatched: [], unpaired: [] });

const hash = (s: string, n: number) => crypto.createHash('sha1').update(s).digest('hex').slice(0, n);
const glob = (pattern: string) => new RegExp('^' + pattern.toLowerCase().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');

export const roleLabel = (role: Role, hasRaw: boolean) => role === 'edited' ? 'Edited' : role === 'raw' ? 'Original' : hasRaw ? 'Camera' : 'Photo';
/** Edited: an edited version, or a camera JPEG from a camera whose JPEGs already carry a look (`cameraOf` reads a file's EXIF model). */
export function isEdited(p: GPhoto, rules: Rules, cameraOf: (file: string) => string | null | undefined) {
  if (p.versions.some(v => v.role === 'edited')) return true;
  if (!rules.styledCameras.length) return false;
  const styled = new Set(rules.styledCameras.map(c => c.toLowerCase()));
  return p.versions.some(v => v.role === 'camera' && styled.has(cameraOf(v.file)?.toLowerCase() ?? ''));
}
const fmtOf = (ext: string) => RAW_EXT[ext] ?? (ext === 'jpg' || ext === 'jpeg' ? 'JPEG' : ext === 'tif' ? 'TIFF' : ext.toUpperCase());

type Match = { role: Role; pattern: number; base: string; name: string; depth: number; plain: boolean };
const keyOf = (base: string, name: string) => `${base}\0${name.toLowerCase()}`;

/**
 * Every file's version: the pattern that places it deepest ("Export/{name}.jpg" over "{name}.jpg" for a file in Export/),
 * then a decorated name over a plain one ("{name}-{n}" over "{name}"), but only when another file really has that
 * name, so two unrelated "Paris-1.jpg" and "Paris-2.jpg" never merge.
 */
function assign(files: FileRow[], rules: Rules, extra?: { role: Role; src: string }) {
  const pats = ROLES.flatMap(role => [...rules.versions[role], ...(extra?.role === role ? [extra.src] : [])]
    .map((src, pattern) => ({ role, pattern, p: compileFile(role, src) })));
  const exclude = rules.exclude.map(glob);
  const rank = (m: Match) => ROLES.indexOf(m.role);
  const all: { f: FileRow; matches: Match[]; plain?: Match }[] = [];
  const plainCount = new Map<string, number>();
  for (const f of files) {
    const segs = f.dir ? f.dir.split('/') : [];
    if (segs.some(s => exclude.some(re => re.test(s.toLowerCase())))) continue;
    const stem = path.posix.parse(f.name).name;
    const matches: Match[] = [];
    for (const { role, pattern, p } of pats) {
      const m = matchFile(p, segs, stem, f.ext);
      if (m) matches.push({ role, pattern, ...m, depth: p.folders.length, plain: p.plain });
    }
    const plain = matches.filter(m => m.plain).sort((a, b) => b.depth - a.depth || rank(a) - rank(b))[0];
    if (plain) plainCount.set(keyOf(plain.base, plain.name), (plainCount.get(keyOf(plain.base, plain.name)) ?? 0) + 1);
    all.push({ f, matches, plain });
  }
  return all.map(({ f, matches, plain }) => {
    const own = plain ? keyOf(plain.base, plain.name) : null;
    const others = (k: string) => (plainCount.get(k) ?? 0) - (k === own ? 1 : 0);
    // "DSC1-1.jpg" is only an edit of "DSC1" if a file named DSC1 is there, and nothing else is also named DSC1-1.
    const ok = matches.filter(m => m.plain || (others(keyOf(m.base, m.name)) > 0 && !(own && others(own) > 0)));
    const best = ok.sort((a, b) => b.depth - a.depth || Number(a.plain) - Number(b.plain) || rank(a) - rank(b))[0];
    return { f, best, plain, others };
  });
}

/** Pure: files + rules → photos. Used for indexing, the live preview and suggestions. */
export function group(files: FileRow[], rules: Rules, libraryName = 'Library', trace?: Trace): GPhoto[] {
  const eventPatterns = rules.eventPatterns.map(compileEvent);
  const eventCache = new Map<string, GEvent | null>();
  const eventFor = (dir: string): GEvent | null => {
    if (eventCache.has(dir)) return eventCache.get(dir)!;
    const segs = dir ? dir.split('/') : [];
    let ev: GEvent | null = null;
    for (let i = segs.length - 1; i >= 0 && !ev; i--) {
      const m = matchEvent(eventPatterns, segs[i]);
      if (m) { const folder = segs.slice(0, i + 1).join('/'); ev = { id: hash(folder, 12), folder, title: m.title, date: m.date }; trace?.events.set(folder, m); }
    }
    if (!ev) trace?.undated.add(dir);
    if (!ev && !rules.onlyDated) ev = { id: hash(dir, 12), folder: dir, title: segs.at(-1) ?? libraryName, date: null };
    eventCache.set(dir, ev);
    return ev;
  };

  type C = { f: FileRow; m: Match; ev: GEvent };
  const photos = new Map<string, GPhoto & { byRole: Map<Role, C> }>();
  for (const { f, best: m, plain, others } of assign(files, rules)) {
    if (!m) { trace?.unmatched.push(f.path); continue; }
    const ev = eventFor(m.base);
    if (!ev) continue;
    if (trace) {
      trace.versions[m.role].push({ pattern: m.pattern, file: f.path, name: m.name });
      // "DSC1_final" next to "DSC1.ARW": a nearby photo's name, a separator and something no pattern knows.
      if (m === plain && m.role !== 'raw') for (let k = m.name.length - 1; k > 0; k--)
        if (/[^a-z0-9]/i.test(m.name[k]) && others(keyOf(m.base, m.name.slice(0, k))) > 0) { trace.unpaired.push(f.path); break; }
    }
    const key = keyOf(m.base, m.name);
    let p = photos.get(key);
    if (!p) photos.set(key, p = { id: hash(`${m.base}/${m.name.toLowerCase()}`, 16), name: m.name, dir: m.base, event: ev, versions: [], byRole: new Map() });
    const prev = p.byRole.get(m.role);
    if (!prev || f.mtime > prev.f.mtime) p.byRole.set(m.role, { f, m, ev });   // several exports of one photo: newest wins
  }
  const order = (r: Role) => rules.preferred.indexOf(r);
  return [...photos.values()].map(({ byRole, ...p }) => {
    const hasRaw = byRole.has('raw');
    p.versions = [...byRole.values()].sort((a, b) => order(a.m.role) - order(b.m.role)).map(c => ({
      role: c.m.role, label: roleLabel(c.m.role, hasRaw), fmt: fmtOf(c.f.ext), file: c.f.path, size: c.f.size, mtime: c.f.mtime,
    }));
    return p;
  });
}

/** Rules the library seems to call for, shown in onboarding and on the rules page. */
export function suggest(files: FileRow[], rules: Rules) {
  const dirs = new Set<string>(), segNames = new Set<string>();
  for (const f of files) {
    if (f.dir) dirs.add(f.dir);
    for (const s of f.dir ? f.dir.split('/') : []) segNames.add(s);
  }
  const out: { id: string; text: string; count: number; apply: Partial<Rules> }[] = [];
  const add = (role: Role, src: string) => ({ versions: { ...rules.versions, [role]: [...rules.versions[role], src] } });

  // Subfolders holding one kind of version: Export/, RAW/, JPG/.
  const folderPatterns = ROLES.flatMap(role => rules.versions[role]).filter(p => p.includes('/')).map(p => glob(p.split('/')[0]));
  const byName = new Map<string, number>();
  for (const d of dirs) { const n = d.split('/').at(-1)!.toLowerCase(); byName.set(n, (byName.get(n) ?? 0) + 1); }
  const folder = (id: string, re: RegExp, name: string, role: Role, label: string) => {
    const c = [...byName].filter(([n]) => re.test(n)).reduce((a, [, n]) => a + n, 0);
    const shown = name.replace('*', '');
    if (c && !folderPatterns.some(g => g.test(shown.toLowerCase()))) out.push({ id, count: c, apply: add(role, `${name}/{name}.*`),
      text: `${c} ${c === 1 ? 'folder is' : 'folders are'} named “${shown}”. Show ${c === 1 ? 'its' : 'their'} photos as the ${label} version?` });
  };
  folder('export', /^exports?([ _-].*)?$/, 'Export*', 'edited', 'edited');
  folder('edited', /^edit(ed|s)?$/, 'Edited', 'edited', 'edited');
  folder('raw', /^raws?$/, 'RAW', 'raw', 'original');
  folder('jpg', /^jpe?g$/, 'JPG', 'camera', 'camera');

  // Shoot folder conventions the current patterns miss, e.g. "20190704_Lyon" or "Paris 2016-01-25".
  const lower = (l: string[]) => l.map(p => p.toLowerCase());
  const events = rules.eventPatterns.map(compileEvent);
  for (const tpl of EVENT_CANDIDATES) {
    if (lower(rules.eventPatterns).includes(tpl.toLowerCase())) continue;
    const c = compileEvent(tpl);
    const hits = [...segNames].filter(n => matchEvent([c], n) && !matchEvent(events, n));
    events.push(c);   // later candidates don't count folders this one already covers
    if (hits.length) out.push({ id: `event:${tpl}`, count: hits.length, apply: { eventPatterns: [...rules.eventPatterns, tpl] },
      text: `${hits.length} ${hits.length === 1 ? 'folder is' : 'folders are'} named like “${hits[0]}”. Show ${hits.length === 1 ? 'it as a shoot' : 'them as shoots'}?` });
  }

  // Edited copies named after their original: "DSC1-1.jpg", "DSC1-Edit.jpg".
  const current = new Set(assign(files, rules).filter(a => a.best?.role === 'edited').map(a => a.f.path));
  for (const tpl of EDIT_CANDIDATES) {
    if (lower(rules.versions.edited).includes(tpl.toLowerCase())) continue;
    const n = rules.versions.edited.length;
    const hits = assign(files, rules, { role: 'edited', src: tpl }).filter(a => a.best?.role === 'edited' && a.best.pattern === n && !current.has(a.f.path));
    hits.forEach(h => current.add(h.f.path));
    if (hits.length) out.push({ id: `edit:${tpl}`, count: hits.length, apply: add('edited', tpl),
      text: `${hits.length} ${hits.length === 1 ? 'file is' : 'files are'} named like “${hits[0].f.name}” next to the original. Show ${hits.length === 1 ? 'it as its' : 'them as their'} edited version?` });
  }
  return out;
}
