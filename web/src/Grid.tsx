import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { api, type Photo } from './api';
import { layout } from './layout';
import { useStore } from './store';

/** The library grid, wired to the store. */
export function Grid({ photos }: { photos: Photo[] }) {
  const open = useStore(s => s.open);
  const loadMore = useStore(s => s.loadMore);
  return <PhotoRows photos={photos} thumb={api.thumb} onOpen={open} onEnd={loadMore} />;
}

type Tile = Parameters<typeof layout>[0][number] & { id: string; name: string; fav?: boolean };

/** Justified, virtualized rows grouped by shoot. Also used by shared album pages. */
export function PhotoRows<P extends Tile>({ photos, thumb, onOpen, onEnd }: {
  photos: P[]; thumb: (id: string, w: number) => string; onOpen: (id: string) => void; onEnd: () => void | Promise<void>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(ref.current!);
    return () => ro.disconnect();
  }, []);

  const items = useMemo(() => width ? layout(photos, width, width < 600 ? 130 : 210) : [], [photos, width]);
  const v = useVirtualizer({ count: items.length, getScrollElement: () => ref.current, estimateSize: i => items[i]?.height ?? 200, overscan: 4 });

  // Fetch the next page when the user scrolls near the end of what's loaded.
  const last = v.getVirtualItems().at(-1)?.index ?? 0;
  useEffect(() => { if (items.length && last >= items.length - 8) void onEnd(); }, [last, items.length, onEnd]);

  // Row heights depend on width; drop the virtualizer's cached sizes whenever the layout changes.
  useEffect(() => v.measure(), [items, v]);

  return (
    <div className="scroll" ref={ref}>
      <div style={{ height: v.getTotalSize(), position: 'relative' }}>
        {v.getVirtualItems().map(vi => {
          const it = items[vi.index];
          return (
            <div key={vi.key} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: it.height, transform: `translateY(${vi.start}px)` }}>
              {it.type === 'header'
                ? <div className="group"><b>{it.title}</b><span>{it.sub}</span></div>
                : <div className="row">{it.photos.map(({ p, w }) => (
                    <button key={p.id} className="tile" style={{ width: w, height: it.height - 6 }} onClick={() => onOpen(p.id)} aria-label={p.name}>
                      <img loading="lazy" src={thumb(p.id, w > 400 ? 800 : 480)} alt="" />
                      {p.fav && <span className="fav">★</span>}
                    </button>))}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
