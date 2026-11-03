import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { encode as encodePng } from 'fast-png';
import jpegJs from 'jpeg-js';

process.env.JWT_SECRET ??= 'x'.repeat(32);
process.env.INTEGRATIONS_ENCRYPTION_KEY ??= 'y'.repeat(32);
process.env.WORDPRESS_ENCRYPTION_KEY ??= 'z'.repeat(32);
process.env.BACKEND_PUBLIC_URL = 'https://app.example.com';

const store = await import('../src/server/mediaStore.ts');
const { createMemoryStorageDriver } = await import('../src/server/autopilot/assetStorage.ts');

// Memory driver reporting itself as s3, since only object storage qualifies.
function memoryS3() {
  const d = createMemoryStorageDriver('https://bucket.example.com');
  return Object.assign(d, { name: 's3' as const });
}

function rgbaPng(width: number, height: number, alpha = 255): Buffer {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) { data[i] = 200; data[i + 1] = 40; data[i + 2] = 10; data[i + 3] = alpha; }
  return Buffer.from(encodePng({ width, height, data, channels: 4, depth: 8 }));
}

test('media store: bytes are content-addressed and stored once', async () => {
  const driver = memoryS3();
  store.setMediaStorageForTests(driver as any);
  try {
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
    const a = await store.storeMediaBytes(jpg, 'application/octet-stream');
    const b = await store.storeMediaBytes(jpg, 'image/jpeg');
    const sha = createHash('sha256').update(jpg).digest('hex');
    assert.equal(a, `https://app.example.com/media/r2/${sha}.jpg`, 'sniffed as JPEG despite the generic type');
    assert.equal(a, b);
    assert.equal(driver.objects.size, 1);
    assert.ok(store.isStoredMediaUrl(a));
  } finally { store.setMediaStorageForTests(undefined); }
});

test('media store: PNG is stored as a decodable JPEG with alpha flattened onto white', async () => {
  const driver = memoryS3();
  store.setMediaStorageForTests(driver as any);
  try {
    const url = await store.storeMediaBytes(rgbaPng(16, 12, 0), 'image/png', 't', { jpeg: true });
    assert.match(url, /\.jpg$/);
    const [obj] = [...driver.objects.values()];
    assert.equal(obj.mimeType, 'image/jpeg');
    const decoded = jpegJs.decode(obj.body);
    assert.equal(decoded.width, 16);
    assert.equal(decoded.height, 12);
    assert.ok(decoded.data[0] > 240 && decoded.data[1] > 240, 'fully transparent pixels become white');
  } finally { store.setMediaStorageForTests(undefined); }
});

test('media store: data URL is copied; a stored PNG gets a JPEG twin on request', async () => {
  const driver = memoryS3();
  store.setMediaStorageForTests(driver as any);
  try {
    const png = rgbaPng(8, 8);
    const stored = await store.durableMediaUrl(`data:image/png;base64,${png.toString('base64')}`, 'u1');
    assert.match(stored, /^https:\/\/app\.example\.com\/media\/r2\/[a-f0-9]{64}\.png$/);
    const twin = await store.durableMediaUrl(stored, 'u1', { jpeg: true });
    assert.match(twin, /\.jpg$/);
    assert.equal(driver.objects.size, 2);
  } finally { store.setMediaStorageForTests(undefined); }
});

test('media store: storage failure and missing storage both return the input unchanged', async () => {
  const driver = memoryS3();
  driver.failNextPut = 1;
  store.setMediaStorageForTests(driver as any);
  try {
    const dataUrl = `data:image/png;base64,${rgbaPng(4, 4).toString('base64')}`;
    assert.equal(await store.durableMediaUrl(dataUrl), dataUrl);
  } finally { store.setMediaStorageForTests(undefined); }
  store.setMediaStorageForTests(null);
  try {
    assert.equal(await store.durableMediaUrl('https://cdn.example.com/a.png'), 'https://cdn.example.com/a.png');
  } finally { store.setMediaStorageForTests(undefined); }
});

test('media store route: redirects a stored file to the bucket, refuses anything else', async () => {
  const driver = memoryS3();
  store.setMediaStorageForTests(driver as any);
  try {
    const app = express();
    app.use(store.registerMediaStoreRoutes());
    const file = `${'a'.repeat(64)}.jpg`;
    const ok = await request(app).get(`/media/r2/${file}`);
    assert.equal(ok.status, 302);
    assert.match(ok.headers.location, new RegExp(`^https://bucket\\.example\\.com/media/${file}\\?exp=`));
    assert.equal(ok.headers['cross-origin-resource-policy'], 'cross-origin');
    for (const bad of ['..%2F..%2Fsecret', 'abc.jpg', `${'a'.repeat(64)}.exe`, `${'A'.repeat(64)}.jpg`]) {
      assert.equal((await request(app).get(`/media/r2/${bad}`)).status, 404, bad);
    }
    assert.equal(store.directMediaUrl(`https://app.example.com/media/r2/${file}`).startsWith('https://bucket.example.com/media/'), true);
    assert.equal(store.directMediaUrl('https://elsewhere.example.com/x.jpg'), 'https://elsewhere.example.com/x.jpg');
  } finally { store.setMediaStorageForTests(undefined); }
});

test('no object storage: media is kept in the database and served from the same public address', async () => {
  store.setMediaStorageForTests(null as any);
  const blobs = new Map<string, { bytes: Buffer; mime: string }>();
  store.setMediaBlobBackendForTests({
    available: () => true,
    put: async (file, bytes, mime) => { blobs.set(file, { bytes, mime }); },
    get: async (file) => blobs.get(file) ?? null,
  });
  try {
    // getMediaStorage() is null (no S3) but uploads still work.
    assert.equal(store.getMediaStorage(), null);
    assert.equal(store.mediaStorageAvailable(), true);
    const jpeg = Buffer.from(jpegJs.encode({ data: Buffer.alloc(4 * 4 * 4, 200), width: 4, height: 4 }, 90).data);
    const url = await store.storeMediaBytes(jpeg, 'image/jpeg', 'u1');
    assert.match(url, /\/media\/r2\/[a-f0-9]{64}\.jpg$/);
    assert.equal(blobs.size, 1);
    // Same bytes: stored once.
    assert.equal(await store.storeMediaBytes(jpeg, 'image/jpeg', 'u1'), url);
    assert.equal(blobs.size, 1);
    // Served publicly with its type, cacheable.
    const app = express();
    app.use(store.registerMediaStoreRoutes());
    const res = await request(app).get(url.slice(url.indexOf('/media/r2/')));
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'image/jpeg');
    assert.match(String(res.headers['cache-control']), /immutable/);
    assert.equal(Buffer.compare(res.body as Buffer, jpeg), 0);
    // Unknown files are 404, not an error.
    assert.equal((await request(app).get(`/media/r2/${'0'.repeat(64)}.jpg`)).status, 404);
    // Too big for the database fallback: a clear error.
    await assert.rejects(() => store.storeMediaBytes(Buffer.concat([jpeg, Buffer.alloc(store.DB_MAX_BYTES)]), 'image/jpeg'), /need object storage/);
  } finally {
    store.setMediaBlobBackendForTests(null);
    store.setMediaStorageForTests(undefined as any);
  }
});
