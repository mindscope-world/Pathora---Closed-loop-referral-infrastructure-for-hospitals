import { execFileSync } from 'node:child_process';
import pg from 'pg';

/**
 * Prepares the dedicated test database once per vitest run: recreates it empty, then applies
 * all migrations. Tests never touch the development database.
 */
export default async function setup() {
  const url = new URL(process.env.DATABASE_URL!);
  const dbName = url.pathname.slice(1);
  if (!/_test$/.test(dbName)) {
    throw new Error(`Refusing to run tests against "${dbName}": test database name must end in _test`);
  }

  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    // Start from an empty database every run. The audit table is append-only (so tests cannot clean
    // up after themselves) and constraints evolve; a fresh database keeps the suite hermetic.
    // Safe: the name was verified above to end in `_test`.
    await client.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await client.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await client.end();
  }

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: url.toString() },
  });
}
