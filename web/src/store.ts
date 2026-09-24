import { create } from 'zustand';
import { api, AuthError, type Album, type Photo, type Shoot, type Stats, type SetupState, type Session } from './api';

export type View = { kind: 'settings' } | { kind: 'all' } | { kind: 'edited' } | { kind: 'fav' } | { kind: 'album'; id: number };

interface State {
  view: View; q: string; photos: Photo[]; shoots: Shoot[]; albums: Album[]; stats: Stats | null;
  openId: string | null; loading: boolean; session: Session | null;
  setup: SetupState | null; onboarding: boolean;
  boot(): Promise<void>; finishOnboarding(): Promise<void>; startOver(): Promise<void>;
  setView(v: View): void; setQuery(q: string): void; open(id: string | null): void;
  refresh(): Promise<void>; toggleFav(p: Photo): Promise<void>;
}

export const useStore = create<State>((set, get) => ({
  view: { kind: 'all' }, q: '', photos: [], shoots: [], albums: [], stats: null, openId: null, loading: true, session: null, setup: null, onboarding: false,
  async boot() {
    try {
      const session = await api.session();
      set({ session });
      if (!session.authenticated) { set({ loading: false }); return; }
      const setup = await api.setupState();
      set({ setup, onboarding: !setup.configured });
      if (setup.configured) await get().refresh(); else set({ loading: false });
    } catch (e) { set({ loading: false }); if (e instanceof AuthError) await get().boot(); }
  },
  async finishOnboarding() { set({ setup: await api.setupState(), onboarding: false, loading: true }); await get().refresh(); },
  async startOver() { await api.reset(); set({ onboarding: true, photos: [], shoots: [], albums: [], stats: null, view: { kind: 'all' }, q: '', setup: await api.setupState() }); },
  setView: v => { set({ view: v }); void get().refresh(); },
  setQuery: q => { set({ q }); void get().refresh(); },
  open: id => set({ openId: id }),
  async refresh() {
    const { view, q } = get();
    try {
      const filter = { q: q || undefined, edited: view.kind === 'edited' ? '1' : undefined, fav: view.kind === 'fav' ? '1' : undefined,
        album: view.kind === 'album' ? String(view.id) : undefined, limit: '2000' };
      const [photos, shoots, albums, stats] = await Promise.all([api.photos(filter), api.shoots(), api.albums(), api.stats()]);
      // Ignore stale responses if the user changed the view/query meanwhile.
      if (get().view === view && get().q === q) set({ photos, shoots, albums, stats, loading: false });
    } catch (e) {
      if (e instanceof AuthError) set({ session: { claimed: true, authenticated: false, device: null, publicUrl: null }, loading: false }); else set({ loading: false });
    }
  },
  async toggleFav(p) {
    set(s => ({ photos: s.photos.map(x => x.id === p.id ? { ...x, fav: !x.fav } : x) }));
    await api.setFav(p.id, !p.fav);
  },
}));
