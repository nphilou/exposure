// Finds the JPEG previews a camera embeds in its RAW files, without decoding the RAW itself.
// exifr.thumbnail() only reads IFD1, which is ~160 px on Sony/Canon and missing on most Nikons;
// the large preview lives elsewhere: IFD0 or a SubIFD (ARW, NEF, CR2, DNG, PEF, SRW), JpgFromRaw
// (RW2), a fixed header offset (RAF) or the PRVW box (CR3).

export interface Preview { offset: number; length: number }

/** Every embedded JPEG we can locate from the first bytes of the file, largest first. */
export function findPreviews(head: Buffer): Preview[] {
  const out: Preview[] = [];
  if (head.subarray(0, 15).toString('latin1') === 'FUJIFILMCCD-RAW' && head.length >= 92)
    out.push({ offset: head.readUInt32BE(84), length: head.readUInt32BE(88) });
  else if (head.subarray(4, 8).toString('latin1') === 'ftyp') cr3(head, out);
  else tiff(head, out);
  const seen = new Set<number>();
  return out.filter(p => p.length > 0 && !seen.has(p.offset) && !!seen.add(p.offset)).sort((a, b) => b.length - a.length);
}

function tiff(b: Buffer, out: Preview[]) {
  const le = b.toString('latin1', 0, 2) === 'II';
  if (!le && b.toString('latin1', 0, 2) !== 'MM') return;
  const u16 = (o: number) => o + 2 <= b.length ? (le ? b.readUInt16LE(o) : b.readUInt16BE(o)) : -1;
  const u32 = (o: number) => o + 4 <= b.length ? (le ? b.readUInt32LE(o) : b.readUInt32BE(o)) : -1;
  const magic = u16(2);
  if (magic !== 42 && magic !== 0x4f52 && magic !== 0x5352 && magic !== 0x55) return; // TIFF, ORF, ORF, RW2
  const visited = new Set<number>();

  const ifd = (at: number, depth: number) => {
    if (at <= 0 || depth > 4 || visited.has(at)) return;
    visited.add(at);
    const n = u16(at);
    if (n <= 0 || n > 500) return;
    const tags = new Map<number, { type: number; count: number; at: number }>();
    for (let i = 0; i < n; i++) {
      const e = at + 2 + i * 12;
      if (e + 12 > b.length) break;
      tags.set(u16(e), { type: u16(e + 2), count: u32(e + 4), at: e + 8 });
    }
    const size = (t: number) => t === 3 ? 2 : t === 4 || t === 13 ? 4 : 1;
    // Values bigger than 4 bytes are stored elsewhere; `at` then holds their offset.
    const vals = (tag: number): number[] => {
      const t = tags.get(tag);
      if (!t || t.count <= 0 || t.count > 64) return [];
      const base = t.count * size(t.type) > 4 ? u32(t.at) : t.at;
      return Array.from({ length: t.count }, (_, k) => size(t.type) === 2 ? u16(base + k * 2) : u32(base + k * 4));
    };
    const one = (tag: number) => vals(tag)[0];

    const [jpg, jpgLen] = [one(0x0201), one(0x0202)];
    if (jpg > 0 && jpgLen > 0) out.push({ offset: jpg, length: jpgLen });
    // A single strip compressed as JPEG: CR2's full-size preview (6), DNG previews (7, reduced resolution only:
    // the main DNG image is also type 7 but lossless JPEG, which isn't a viewable picture).
    const comp = one(0x0103), strips = vals(0x0111), counts = vals(0x0117);
    if (strips.length === 1 && counts.length === 1 && (comp === 6 || (comp === 7 && one(0x00fe) === 1)))
      out.push({ offset: strips[0], length: counts[0] });
    const raw = tags.get(0x002e);  // RW2 JpgFromRaw: the JPEG is the tag's value
    if (raw && raw.count > 4) out.push({ offset: u32(raw.at), length: raw.count });

    for (const sub of vals(0x014a)) ifd(sub, depth + 1);
    ifd(u32(at + 2 + n * 12), depth);  // next IFD in the chain (IFD1, …)
  };
  ifd(u32(4), 0);
}

// CR3 (ISO media): the uuid box holds PRVW, a ~1620 px JPEG, with its byte length just before the data.
function cr3(b: Buffer, out: Preview[]) {
  for (let i = b.indexOf('PRVW', 0, 'latin1'); i > 0; i = b.indexOf('PRVW', i + 4, 'latin1')) {
    const soi = b.indexOf(Buffer.from([0xff, 0xd8, 0xff]), i);
    if (soi < 0 || soi - i > 64) continue;
    out.push({ offset: soi, length: b.readUInt32BE(soi - 4) });
  }
}
