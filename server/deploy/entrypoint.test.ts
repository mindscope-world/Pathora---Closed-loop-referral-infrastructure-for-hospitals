import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SCRIPT = path.resolve('docker-entrypoint.sh');
let dir: string;
let log: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'pathora-entrypoint-'));
  log = path.join(dir, 'calls.log');
  // A stand-in for `npx` that records how it was called and exits with FAKE_NPX_EXIT.
  const npx = path.join(dir, 'npx');
  writeFileSync(npx, '#!/bin/sh\necho "npx $*" >> "$CALL_LOG"\nexit "${FAKE_NPX_EXIT:-0}"\n');
  chmodSync(npx, 0o755);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function run(env: Record<string, string>, ...cmd: string[]) {
  writeFileSync(log, '');
  const r = spawnSync('sh', [SCRIPT, ...cmd], { env: { PATH: `${dir}:/usr/bin:/bin`, CALL_LOG: log, ...env }, encoding: 'utf8' });
  return { status: r.status, out: r.stdout + r.stderr, calls: readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) };
}
const APP = ['sh', '-c', 'echo "APP started" >> "$CALL_LOG"'];

describe('docker-entrypoint.sh', () => {
  it('is executable and stops on the first error', () => {
    expect(statSync(SCRIPT).mode & 0o111).not.toBe(0);
    expect(readFileSync(SCRIPT, 'utf8')).toMatch(/^set -eu$/m);
  });

  it('by default does not touch the database: it just starts the app', () => {
    const r = run({}, ...APP);
    expect(r.status).toBe(0);
    expect(r.calls).toEqual(['APP started']);
  });

  it('with MIGRATE_ON_START=true it applies migrations first, then starts the app', () => {
    const r = run({ MIGRATE_ON_START: 'true' }, ...APP);
    expect(r.status).toBe(0);
    expect(r.calls).toEqual(['npx --no-install prisma migrate deploy', 'APP started']); // in that order
    expect(r.out).toContain('migrations are up to date');
  });

  it('if migrations FAIL, the container exits and the app is never started', () => {
    const r = run({ MIGRATE_ON_START: 'true', FAKE_NPX_EXIT: '1' }, ...APP);
    expect(r.status).not.toBe(0);
    expect(r.calls).toEqual(['npx --no-install prisma migrate deploy']);
    expect(r.out).not.toContain('up to date');
  });

  it.each(['false', 'TRUE', '1', 'yes', ''])('only the exact value "true" turns it on (not %j)', (v) => {
    expect(run({ MIGRATE_ON_START: v }, ...APP).calls).toEqual(['APP started']);
  });

  it('hands the command over exactly as given, including arguments with spaces, and keeps its exit code', () => {
    const r = run({}, 'sh', '-c', 'printf "%s|" "$0" "$1" >> "$CALL_LOG"; exit 7', 'a b', 'c  d');
    expect(r.status).toBe(7);
    expect(r.calls).toEqual(['a b|c  d|']);
  });

  it('REPLACES itself with the app (exec), so the app is the container\'s main process and receives its shutdown signal', () => {
    writeFileSync(log, '');
    const r = spawnSync('sh', [SCRIPT, 'sh', '-c', 'echo $$'], { env: { PATH: `${dir}:/usr/bin:/bin`, CALL_LOG: log }, encoding: 'utf8' });
    // With exec the app has the SAME process id the entrypoint had; without it, the entrypoint would stay in between.
    expect(Number(r.stdout.trim())).toBe(r.pid);
  });

  it('works as a pre-deploy command wrapper: the migration command given to it runs and its failure is reported', () => {
    expect(run({}, 'npx', 'prisma', 'migrate', 'deploy').calls).toEqual(['npx prisma migrate deploy']);
    expect(run({ FAKE_NPX_EXIT: '3' }, 'npx', 'prisma', 'migrate', 'deploy').status).toBe(3);
  });
});
