// Generates a fake library in ./photos with the same layout as a real NAS:
//   YYYY-MM-DD Subject/{DSC0001.JPG, DSC0001.ARW, Export/DSC0001.jpg}
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const out = path.resolve(process.env.INIT_CWD ?? '.', process.argv[2] ?? './photos');
const shoots: [string, string, number, number][] = [
  ['2026-10-04', 'Geneva', 245, 24], ['2026-09-22', 'Akita Show', 55, 30], ['2026-09-20', 'Engadin', 200, 30],
  ['2026-08-30', 'Lake Thun', 215, 20], ['2026-08-11', 'Armenia', 45, 30], ['2026-04-12', 'Kyoto', 10, 26],
];
const ARS: [number, number][] = [[1200, 800], [1200, 800], [800, 1200], [1000, 1000]];
let n = 1180, seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

for (const [date, title, hue, count] of shoots) {
  const dir = path.join(out, `${date} ${title}`);
  await fs.mkdir(path.join(dir, 'Export'), { recursive: true });
  for (let i = 0; i < count; i++) {
    n += 1 + Math.floor(rnd() * 4);
    const name = `DSC0${n}`;
    const [w, h] = ARS[Math.floor(rnd() * ARS.length)];
    const l = 35 + rnd() * 30, hh = hue + rnd() * 30 - 15;
    const svg = (c: number) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <defs><pattern id="p" width="28" height="28" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="14" height="28" fill="hsl(${hh} ${c}% ${l}%)"/><rect x="14" width="14" height="28" fill="hsl(${hh} ${c}% ${l - 5}%)"/></pattern></defs>
      <rect width="100%" height="100%" fill="url(#p)"/><text x="30" y="${h - 30}" font-family="sans-serif" font-size="42" fill="white" opacity=".7">${name}</text></svg>`);
    await sharp(svg(25)).jpeg({ quality: 88 }).toFile(path.join(dir, `${name}.JPG`));
    if (rnd() < 0.35) await sharp(svg(55)).jpeg({ quality: 90 }).toFile(path.join(dir, 'Export', `${name}.jpg`));
    if (rnd() < 0.9) await fs.writeFile(path.join(dir, `${name}.ARW`), Buffer.alloc(1024)); // stand-in RAW
  }
}
console.log('seeded', out);
