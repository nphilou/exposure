import type { Photo } from './api';

export type Item =
  | { type: 'header'; title: string; sub: string; height: number }
  | { type: 'row'; photos: { p: Photo; w: number }[]; height: number };

const GAP = 6;

/** Justified rows: each row is scaled so its photos exactly fill the container width. */
export function layout(photos: Photo[], width: number, target: number): Item[] {
  const items: Item[] = [];
  let i = 0;
  while (i < photos.length) {
    const p0 = photos[i];
    const head = { title: p0.shootTitle, sub: new Date(p0.takenAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) };
    const group: Photo[] = [];
    while (i < photos.length && photos[i].shootId === p0.shootId) group.push(photos[i++]);
    items.push({ type: 'header', ...head, height: 64 });
    for (let s = 0; s < group.length;) {
      let e = s, sum = 0;
      do { sum += group[e++].ar; } while (e < group.length && sum * target + GAP * (e - s - 1) < width);
      const slice = group.slice(s, e);
      let h = (width - GAP * (slice.length - 1)) / sum;
      if (e >= group.length && h > target) h = target; // don't blow up a short last row
      items.push({ type: 'row', height: h + GAP, photos: slice.map(p => ({ p, w: p.ar * h })) });
      s = e;
    }
  }
  return items;
}
