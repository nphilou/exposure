// Builds stand-in RAW files with the same container layout as real ones (TIFF IFDs, embedded JPEGs,
// an opaque sensor-data strip), so the demo library and tests exercise the real preview extraction.
//   arw: IFD0 → large preview (0x0201), SubIFD → sensor data, IFD1 → 160 px thumbnail
//   nef: IFD0 → uncompressed thumbnail strip, SubIFD → full-size JpgFromRaw (0x0201) → sensor data, no IFD1
//   dng: IFD0 → reduced-resolution JPEG strip (NewSubFileType 1), SubIFD → lossless-JPEG sensor data

type Tag = [tag: number, type: number, values: number[]];

export function fakeRaw(kind: 'arw' | 'nef' | 'dng', preview: Buffer, thumb: Buffer, sensorBytes = 4096): Buffer {
  const sensor = Buffer.alloc(sensorBytes);
  if (kind === 'dng') Buffer.from([0xff, 0xd8, 0xff, 0xc3]).copy(sensor);   // lossless JPEG, not viewable
  // Layout: header | IFDs | sensor | preview | thumb. Offsets are known once IFD sizes are.
  const ifds: Tag[][] = [];
  const at = { sensor: 0, preview: 0, thumb: 0 };
  const build = () => {
    const P = (): Tag[] => [[0x0201, 4, [at.preview]], [0x0202, 4, [preview.length]]];
    const T = (): Tag[] => [[0x0201, 4, [at.thumb]], [0x0202, 4, [thumb.length]]];
    const S = (comp: number, sub: number): Tag[] => [[0x00fe, 4, [sub]], [0x0103, 3, [comp]], [0x0111, 4, [at.sensor]], [0x0117, 4, [sensor.length]]];
    if (kind === 'arw') return [[...P(), [0x014a, 4, [-1]]], S(32767, 0), T()];
    if (kind === 'nef') return [[[0x00fe, 4, [1]], [0x0103, 3, [1]], [0x0111, 4, [at.thumb]], [0x0117, 4, [thumb.length]], [0x014a, 4, [-1]]], [...P(), [0x0103, 3, [6]]], S(34713, 0)];
    return [[[0x00fe, 4, [1]], [0x0103, 3, [7]], [0x0111, 4, [at.preview]], [0x0117, 4, [preview.length]], [0x014a, 4, [-1]]], S(7, 0)];
  };
  // ifds[0] = IFD0, ifds[1] = its SubIFD, ifds[2] = arw: IFD1 (after IFD0), nef: the next IFD after the SubIFD
  ifds.push(...build());
  const ifdSize = (t: Tag[]) => 2 + t.length * 12 + 4;
  const offs: number[] = [];
  let pos = 8;
  for (const t of ifds) { offs.push(pos); pos += ifdSize(t); }
  at.sensor = pos; at.preview = at.sensor + sensor.length; at.thumb = at.preview + preview.length;
  const final = build();
  const buf = Buffer.alloc(at.thumb + thumb.length);
  buf.write('II', 0, 'latin1'); buf.writeUInt16LE(42, 2); buf.writeUInt32LE(8, 4);
  final.forEach((tags, i) => {
    const o = offs[i];
    const sorted = tags.map(([tag, type, v]): Tag => tag === 0x014a ? [tag, type, [offs[1]]] : [tag, type, v]).sort((a, b) => a[0] - b[0]);
    buf.writeUInt16LE(sorted.length, o);
    sorted.forEach(([tag, type, v], k) => {
      const e = o + 2 + k * 12;
      buf.writeUInt16LE(tag, e); buf.writeUInt16LE(type, e + 2); buf.writeUInt32LE(v.length, e + 4);
      type === 3 ? buf.writeUInt16LE(v[0], e + 8) : buf.writeUInt32LE(v[0], e + 8);
    });
    const next = (kind === 'arw' && i === 0) || (kind === 'nef' && i === 1) ? offs[2] : 0;
    buf.writeUInt32LE(next, o + 2 + sorted.length * 12);
  });
  sensor.copy(buf, at.sensor);
  preview.copy(buf, at.preview); thumb.copy(buf, at.thumb);
  return buf;
}
