// Album share links: a guest token opens one album and nothing else.
// Run with `npm -w server test`.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'exposure-shares-'));
process.env.EXPOSURE_DATA_DIR = path.join(tmp, 'data');
const photosDir = path.join(tmp, 'photos');

// Imported after the env is set: config and the DB are read at import time.
const { db } = await import('../src/db.js');
const { sha } = await import('../src/auth.js');
const { activate } = await import('../src/library.js');
const { initRules } = await import('../src/rules.js');
const { scan } = await import('../src/indexer.js');
const { build } = await import('../src/server.js');
const sharp = (await import('sharp')).default;

let app: Awaited<ReturnType<typeof build>>;
const OWNER = 'owner-token';
const owner = { authorization: `Bearer ${OWNER}` };
let shared: string, other: string, albumId: number;

before(async () => {
  for (const [dir, name] of [['2024-05-01 Paris', 'A.jpg'], ['2024-05-01 Paris', 'B.jpg'], ['2024-06-01 Rome', 'C.jpg']]) {
    fs.mkdirSync(path.join(photosDir, dir), { recursive: true });
    await sharp({ create: { width: 60, height: 40, channels: 3, background: '#888' } }).jpeg().toFile(path.join(photosDir, dir, name));
  }
  initRules();
  activate({ kind: 'local', name: 'Test', root: photosDir, libraryPath: '/' });
  await scan();
  db.prepare('INSERT INTO devices (id, name, token_hash, created_at, last_seen) VALUES (?,?,?,?,?)').run('d1', 'Owner', sha(OWNER), Date.now(), Date.now());
  app = await build();
  const ids = await app.inject({ url: '/api/photos', headers: owner }).then(r => r.json().map((p: any) => ({ id: p.id, name: p.name })));
  shared = ids.find((p: any) => p.name === 'A').id;
  other = ids.find((p: any) => p.name === 'C').id;
  albumId = (await app.inject({ method: 'POST', url: '/api/albums', headers: owner, payload: { title: 'Paris' } })).json().id;
  await app.inject({ method: 'POST', url: `/api/albums/${albumId}/photos`, headers: owner, payload: { photoIds: [shared] } });
});
after(async () => { await app.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const createLink = async (body: object = {}) => {
  const r = await app.inject({ method: 'POST', url: `/api/albums/${albumId}/shares`, headers: owner, payload: body });
  assert.equal(r.statusCode, 200);
  const s = r.json();
  return { ...s, token: s.path.slice('/s/'.length) as string };
};

test('only the owner can create and list links', async () => {
  assert.equal((await app.inject({ method: 'POST', url: `/api/albums/${albumId}/shares`, payload: {} })).statusCode, 401);
  const { token } = await createLink({ name: 'Mum' });
  // A share token is not a device token.
  assert.equal((await app.inject({ method: 'POST', url: `/api/albums/${albumId}/shares`, headers: { authorization: `Bearer ${token}` }, payload: {} })).statusCode, 401);
  const list = (await app.inject({ url: `/api/albums/${albumId}/shares`, headers: owner })).json();
  assert.ok(list.some((s: any) => s.name === 'Mum'));
  assert.ok(list.every((s: any) => !('path' in s) && !('token_hash' in s)));
  assert.equal((await app.inject({ method: 'POST', url: '/api/albums/9999/shares', headers: owner, payload: {} })).statusCode, 404);
});

test('a guest sees the album, its photos and nothing else', async () => {
  const { token } = await createLink();
  const info = (await app.inject({ url: `/api/s/${token}` })).json();
  assert.deepEqual(info, { title: 'Paris', count: 1, allowOriginals: false });

  const photos = (await app.inject({ url: `/api/s/${token}/photos` })).json();
  assert.deepEqual(photos.map((p: any) => p.id), [shared]);
  for (const key of ['folder', 'versions', 'fav', 'hasRaw']) assert.ok(!(key in photos[0]), `leaks ${key}`);

  const thumb = await app.inject({ url: `/api/s/${token}/photos/${shared}/thumb` });
  assert.equal(thumb.statusCode, 200);
  assert.equal(thumb.headers['content-type'], 'image/jpeg');
  assert.equal((await app.inject({ url: `/api/s/${token}/photos/${shared}/preview` })).statusCode, 200);
  assert.equal((await app.inject({ url: `/api/s/${token}/photos/${other}/thumb` })).statusCode, 404, 'photo outside the album');
  assert.equal((await app.inject({ url: `/api/s/${token}/photos/${shared}/original` })).statusCode, 403, 'originals are off by default');

  // Owner routes stay closed to the share token, however it's sent.
  for (const url of ['/api/photos', `/api/photos/${other}/thumb`, '/api/albums', '/api/devices', '/api/rules', `/api/s/${token}/../../photos`, `/api/s/${token}/%2e%2e/%2e%2e/devices`])
    for (const headers of [{ authorization: `Bearer ${token}` }, { cookie: `exposure_device=${token}` }])
      assert.ok([401, 404].includes((await app.inject({ url, headers })).statusCode), `${url} is open to a guest`);
});

test('downloads when allowed', async () => {
  const { token } = await createLink({ allowOriginals: true });
  const r = await app.inject({ url: `/api/s/${token}/photos/${shared}/original` });
  assert.equal(r.statusCode, 200);
  assert.match(String(r.headers['content-disposition']), /filename="A\.jpg"/);
  assert.equal((await app.inject({ url: `/api/s/${token}/photos/${other}/original` })).statusCode, 404);
});

test('revoked, expired and unknown links stop working', async () => {
  const a = await createLink();
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/shares/${a.id}`, headers: owner })).statusCode, 200);
  assert.equal((await app.inject({ url: `/api/s/${a.token}` })).statusCode, 404);
  assert.equal((await app.inject({ url: `/api/s/${a.token}/photos/${shared}/thumb` })).statusCode, 404);

  const b = await createLink({ expiresInDays: 7 });
  assert.equal((await app.inject({ url: `/api/s/${b.token}` })).statusCode, 200);
  db.prepare('UPDATE shares SET expires_at = ? WHERE id = ?').run(Date.now() - 1, b.id);
  assert.equal((await app.inject({ url: `/api/s/${b.token}` })).statusCode, 404);
});

test('guessing tokens gets rate limited', async () => {
  const codes = [];
  for (let i = 0; i < 10; i++) codes.push((await app.inject({ url: `/api/s/guess${i}`, remoteAddress: '10.9.9.9' })).statusCode);
  assert.equal(codes.at(-1), 429);
});

test('links go away with their album', async () => {
  const { token } = await createLink();
  db.prepare('DELETE FROM albums WHERE id = ?').run(albumId);
  assert.equal((await app.inject({ url: `/api/s/${token}` })).statusCode, 404);
});
