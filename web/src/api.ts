export interface Version { key: 'edited' | 'camera' | 'raw'; label: string; fmt: string; size: number; file: string }
export interface Photo {
  id: string; name: string; shootId: string; shootTitle: string; folder: string; takenAt: string;
  camera: string | null; lens: string | null; focal: number | null; fnum: number | null; shutter: string | null; iso: number | null;
  ar: number; hasEdit: boolean; hasRaw: boolean; fav: boolean; best: Version['key']; versions: Version[];
}
export interface Shoot { id: string; folder: string; title: string; date: string; camera: string | null; count: number; edited: number; cover: string | null }
export interface Album { id: number; title: string; count: number }
export interface Stats { photos: number; shoots: number; cameras: number; edited: number }

export interface SetupState {
  configured: boolean; localAvailable: boolean; nasAddress: string | null;
  connection: { name: string; kind: 'local' | 'webdav'; libraryPath: string; host: string | null } | null;
}
export interface Session { claimed: boolean; authenticated: boolean; device: { id: string; name: string } | null; publicUrl: string | null }
export interface Device { id: string; name: string; createdAt: number; lastSeen: number; current: boolean }
export interface FolderRow { name: string; note: string; kids: string[] }
export interface FolderHere { looksLikePhotos: boolean; kids: string[] }
export interface Progress { phase: 'idle' | 'scanning' | 'done'; count: number; current: string; error: string; shoots: number; shootsDone: number; photos: number; shootsFound: number; cameras: number }
export class ApiError extends Error { details?: string[] }
export class AuthError extends Error {}

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
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
  session: () => j<Session>('/api/session'),
  claim: (code: string, name: string) => j('/api/claim', post({ code, name })),
  redeem: (code: string, name: string) => j('/api/pair/redeem', post({ code, name })),
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
  shoots: () => j<Shoot[]>('/api/shoots'),
  albums: () => j<Album[]>('/api/albums'),
  photos: (p: Record<string, string | undefined>) =>
    j<Photo[]>('/api/photos?' + new URLSearchParams(Object.entries(p).filter(([, v]) => v) as [string, string][])),
  setFav: (id: string, fav: boolean) => j(`/api/photos/${id}/fav`, post({ fav })),
  thumb: (id: string, w = 480) => `/api/photos/${id}/thumb?w=${w}`,
  preview: (id: string, v?: string) => `/api/photos/${id}/preview${v ? `?v=${v}` : ''}`,
  file: (id: string, v: string) => `/api/photos/${id}/file?v=${v}`,
};
