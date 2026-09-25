export interface Version { key: 'edited' | 'camera' | 'raw'; label: string; fmt: string; size: number; file: string }
export interface Photo {
  id: string; name: string; shootId: string; shootTitle: string; folder: string; takenAt: string;
  camera: string | null; lens: string | null; focal: number | null; fnum: number | null; shutter: string | null; iso: number | null;
  ar: number; hasEdit: boolean; hasRaw: boolean; fav: boolean; best: Version['key']; versions: Version[];
}
export interface Shoot { id: string; folder: string; title: string; date: string; camera: string | null; count: number; edited: number; cover: string | null }
export interface Album { id: number; title: string; count: number }
/** A photo as a share-link guest sees it: no folders, versions or favorites. */
export type GuestPhoto = Pick<Photo, 'id' | 'name' | 'shootId' | 'shootTitle' | 'takenAt' | 'camera' | 'lens' | 'focal' | 'fnum' | 'shutter' | 'iso' | 'ar'>;
export interface SharedAlbum { title: string; count: number; allowOriginals: boolean }
export interface ShareLink { id: string; name: string; allowOriginals: boolean; createdAt: number; expiresAt: number | null; lastSeen: number | null }
export interface Stats { photos: number; shoots: number; cameras: number; edited: number }

export type Role = 'edited' | 'camera' | 'raw';
export interface Rules {
  eventPatterns: string[]; onlyDated: boolean; versions: Record<Role, string[]>;
  preferred: Role[]; exclude: string[]; defaultView: 'all' | 'edited'; styledCameras: string[];
}
export interface Suggestion { id: string; text: string; count: number; apply: Partial<Rules> }
export interface RulesSummary { files: number; photos: number; edited: number; events: number; skipped?: number }
export interface RulesPreview { summary: RulesSummary & { skipped: number };
  patterns: { events: PatternReport<{ folder: string; title: string; date: string }>; versions: Record<Role, PatternReport<{ file: string; name: string }>> } }
/** Per pattern (`sources`, as normalised by the server): how many folders/files it matched, or why it's invalid; plus examples and what nothing matched. */
export interface PatternReport<E> { sources: string[]; counts: number[]; errors: (string | null)[]; examples: (E & { pattern: number })[]; misses: { count: number; examples: string[] } }
const union = (a: string[], b: string[] = []) => [...a, ...b.filter(p => !a.some(x => x.toLowerCase() === p.toLowerCase()))];
/** Applies a suggestion on top of rules; patterns are merged rather than replaced. */
export const mergeRules = (r: Rules, apply: Partial<Rules>): Rules => ({
  ...r, ...apply,
  eventPatterns: union(r.eventPatterns, apply.eventPatterns),
  versions: { raw: union(r.versions.raw, apply.versions?.raw), camera: union(r.versions.camera, apply.versions?.camera), edited: union(r.versions.edited, apply.versions?.edited) },
});

export interface SetupState {
  configured: boolean; localAvailable: boolean; nasAddress: string | null; defaultView?: 'all' | 'edited';
  connection: { name: string; kind: 'local' | 'webdav'; libraryPath: string; host: string | null } | null;
}
export interface Session { claimed: boolean; authenticated: boolean; device: { id: string; name: string } | null; publicUrl: string | null }
export interface Device { id: string; name: string; createdAt: number; lastSeen: number; current: boolean }
export interface FolderRow { name: string; note: string; kids: string[] }
export interface FolderHere { looksLikePhotos: boolean; kids: string[] }
export interface Progress { phase: 'idle' | 'scanning' | 'done'; count: number; current: string; error: string; shoots: number; shootsDone: number; photos: number; shootsFound: number; cameras: number }
export class ApiError extends Error { details?: string[] }
export class AuthError extends Error {}

// Backup of the device cookie. localStorage is per host:port, so other apps on the NAS can't clear it.
const TOKEN = 'exposure_device';
export const savedToken = {
  get: () => { try { return localStorage.getItem(TOKEN); } catch { return null; } },
  set: (t: string) => { try { localStorage.setItem(TOKEN, t); } catch { /* private mode */ } },
  clear: () => { try { localStorage.removeItem(TOKEN); } catch { /* private mode */ } },
};
const keep = (r: { token: string }) => { savedToken.set(r.token); return r; };

async function j<T>(url: string, init: RequestInit = {}): Promise<T> {
  const t = savedToken.get();
  const r = await fetch(url, t ? { ...init, headers: { ...init.headers as Record<string, string>, authorization: `Bearer ${t}` } } : init);
  if (r.status === 401) throw new AuthError();
  if (!r.ok) {
    const body = (await r.json().catch(() => null)) as any;
    const e = new ApiError(body?.error ?? `${r.status} ${url}`);
    e.details = body?.details;
    throw e;
  }
  return r.json();
}
const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const api = {
  async session() {
    const t = savedToken.get();
    const s = await j<Session>('/api/session');
    if (t && s.claimed && !s.authenticated) savedToken.clear(); // revoked, or the server was reset
    return s;
  },
  claim: (code: string, name: string) => j<{ token: string }>('/api/claim', post({ code, name })).then(keep),
  redeem: (code: string, name: string) => j<{ token: string }>('/api/pair/redeem', post({ code, name })).then(keep),
  pairNew: () => j<{ code: string; expiresAt: number; path: string; lanUrls: string[] }>('/api/pair/new', post({})),
  devices: () => j<Device[]>('/api/devices'),
  revoke: (id: string) => j(`/api/devices/${id}`, { method: 'DELETE' }),
  setupState: () => j<SetupState>('/api/setup/state'),
  connect: (b: Record<string, unknown>) => j<{ pendingId: string; name: string; folders: FolderRow[]; here: FolderHere }>('/api/setup/connect', post(b)),
  folders: (pendingId: string, path: string) => j<{ folders: FolderRow[]; here: FolderHere }>('/api/setup/folders', post({ pendingId, path })),
  useFolder: (pendingId: string, path: string) => j('/api/setup/use', post({ pendingId, path })),
  progress: () => j<Progress>('/api/setup/progress'),
  reset: () => j('/api/setup/reset', post({})),
  rescan: () => j('/api/rescan', post({})),
  stats: () => j<Stats>('/api/stats'),
  rules: () => j<{ rules: Rules; presets: { generic: Rules; photographer: Rules }; suggestions: Suggestion[]; summary: RulesSummary; cameras: { camera: string; n: number }[] }>('/api/rules'),
  saveRules: (r: Rules) => j<{ rules: Rules }>('/api/rules', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(r) }),
  previewRules: (rules: Rules) => j<RulesPreview>('/api/rules/preview', post({ rules })),
  shoots: () => j<Shoot[]>('/api/shoots'),
  albums: () => j<Album[]>('/api/albums'),
  photos: (p: Record<string, string | undefined>) =>
    j<Photo[]>('/api/photos?' + new URLSearchParams(Object.entries(p).filter(([, v]) => v) as [string, string][])),
  setFav: (id: string, fav: boolean) => j(`/api/photos/${id}/fav`, post({ fav })),
  thumb: (id: string, w = 480) => `/api/photos/${id}/thumb?w=${w}`,
  preview: (id: string, v?: string) => `/api/photos/${id}/preview${v ? `?v=${v}` : ''}`,
  file: (id: string, v: string) => `/api/photos/${id}/file?v=${v}`,
  shares: (album: number) => j<ShareLink[]>(`/api/albums/${album}/shares`),
  createShare: (album: number, b: { name: string; expiresInDays: number | null; allowOriginals: boolean }) =>
    j<ShareLink & { path: string }>(`/api/albums/${album}/shares`, post(b)),
  deleteShare: (id: string) => j(`/api/shares/${id}`, { method: 'DELETE' }),
};

/** A share link's album, for guests. The token in the page URL is the only credential. */
export const guest = (token: string) => {
  const base = `/api/s/${encodeURIComponent(token)}`;
  return {
    album: () => j<SharedAlbum>(base),
    photos: (limit: number, offset: number) => j<GuestPhoto[]>(`${base}/photos?limit=${limit}&offset=${offset}`),
    thumb: (id: string, w = 480) => `${base}/photos/${id}/thumb?w=${w}`,
    preview: (id: string) => `${base}/photos/${id}/preview`,
    original: (id: string) => `${base}/photos/${id}/original`,
  };
};
