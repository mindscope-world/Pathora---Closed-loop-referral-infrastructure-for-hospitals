import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalFileStore } from './fileStore';

let dir: string;
let store: LocalFileStore;
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'pathora-store-'));
  store = new LocalFileStore(dir);
});
afterAll(() => rm(dir, { recursive: true, force: true }));

const exists = (p: string) => stat(p).then(() => true, () => false);

describe('LocalFileStore', () => {
  it('writes, reports size + sha256, and reads back identical bytes (incl. multibyte)', async () => {
    const text = 'Wanjiru Kamau · Habari 🌍\r\nline2\r\n';
    const w = await store.open('org1/job1.csv');
    await w.write(text.slice(0, 5));
    await w.write(text.slice(5));
    const { bytes, sha256 } = await w.finish();
    expect(bytes).toBe(Buffer.byteLength(text));
    expect(sha256).toBe(createHash('sha256').update(text).digest('hex'));
    expect(await readFile(path.join(dir, 'org1/job1.csv'), 'utf8')).toBe(text);
    expect(await store.size('org1/job1.csv')).toBe(bytes);
    let read = '';
    for await (const chunk of store.read('org1/job1.csv')) read += chunk;
    expect(read).toBe(text);
  });

  it('publishes atomically: nothing is visible at the final key until finish()', async () => {
    const w = await store.open('org1/atomic.csv');
    await w.write('partial');
    expect(await exists(path.join(dir, 'org1/atomic.csv'))).toBe(false);
    await w.finish();
    expect(await exists(path.join(dir, 'org1/atomic.csv'))).toBe(true);
    expect(await exists(path.join(dir, 'org1/atomic.csv.part'))).toBe(false);
  });

  it('abort() leaves nothing behind, and is safe to call twice', async () => {
    const w = await store.open('org1/aborted.csv');
    await w.write('half a file');
    await w.abort();
    await w.abort();
    expect(await readdir(path.join(dir, 'org1'))).not.toContain('aborted.csv');
    expect(await readdir(path.join(dir, 'org1'))).not.toContain('aborted.csv.part');
  });

  it('creates files readable only by the owner (exports hold patient data)', async () => {
    const w = await store.open('org1/perm.csv');
    await w.write('x');
    await w.finish();
    expect((await stat(path.join(dir, 'org1/perm.csv'))).mode & 0o077).toBe(0);
  });

  it('handles large writes with backpressure', async () => {
    const w = await store.open('org1/large.csv');
    const line = 'x'.repeat(1023) + '\n';
    for (let i = 0; i < 4000; i++) await w.write(line); // ~4 MB
    const { bytes } = await w.finish();
    expect(bytes).toBe(4000 * 1024);
    expect(await store.size('org1/large.csv')).toBe(bytes);
  });

  it('remove() deletes, and is idempotent', async () => {
    const w = await store.open('org1/gone.csv');
    await w.write('x');
    await w.finish();
    await store.remove('org1/gone.csv');
    await store.remove('org1/gone.csv');
    expect(await exists(path.join(dir, 'org1/gone.csv'))).toBe(false);
  });

  it.each(['../escape.csv', '../../etc/passwd', '/etc/passwd', 'org1/../../escape', 'a//b', '.hidden', 'org1/\0x', '', 'a b', 'org1/..'])(
    'rejects the unsafe key %j',
    async (key) => {
      await expect(store.open(key)).rejects.toThrow(/Invalid storage key/);
      expect(() => store.read(key)).toThrow(/Invalid storage key/);
      await expect(store.remove(key)).rejects.toThrow(/Invalid storage key/);
    },
  );

  it('never writes outside its root', async () => {
    const parent = path.dirname(dir);
    const before = await readdir(parent);
    await store.open('../outside.csv').catch(() => undefined);
    expect(await readdir(parent)).toEqual(before);
  });
});
