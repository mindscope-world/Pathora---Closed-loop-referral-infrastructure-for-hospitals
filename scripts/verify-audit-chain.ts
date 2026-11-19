/**
 * Verifies every organisation's audit hash chain in the database named by SCRATCH_DB_URL (or DATABASE_URL).
 * Used by the backup/restore drill, and runnable on its own after any restore or migration. Exit code 1 on any break.
 */
import 'dotenv/config';
import { Client, types } from 'pg';
import { computeAuditHash, GENESIS_HASH } from '../server/lib/auditHash';

// Prisma stores timestamps as UTC in `timestamp without time zone` columns. node-pg would read them as LOCAL time, which
// changes the hashed value and makes every chain look broken on a machine that is not on UTC. Always read them as UTC.
types.setTypeParser(1114, (v: string) => new Date(`${v.replace(' ', 'T')}Z`));

async function main() {
  const client = new Client({ connectionString: process.env.SCRATCH_DB_URL ?? process.env.DATABASE_URL });
  await client.connect();
  const orgs = (await client.query<{ orgId: string }>('SELECT DISTINCT "orgId" FROM "AuditEvent"')).rows;
  let total = 0;
  let broken = 0;
  for (const { orgId } of orgs) {
    let prev = GENESIS_HASH;
    const { rows } = await client.query(
      'SELECT id, "orgId", at, "actorId", "actorLabel", "actorRole", action, "resourceType", "resourceId", detail, "prevHash", hash FROM "AuditEvent" WHERE "orgId" = $1 ORDER BY id',
      [orgId],
    );
    for (const e of rows) {
      const expected = computeAuditHash(prev, {
        orgId: e.orgId, at: e.at, actorId: e.actorId, actorLabel: e.actorLabel, actorRole: e.actorRole, action: e.action,
        resourceType: e.resourceType, resourceId: e.resourceId, detail: e.detail,
      });
      if (e.prevHash !== prev || e.hash !== expected) {
        console.error(`  BROKEN: organisation ${orgId}, event ${e.id}`);
        broken++;
        break;
      }
      prev = e.hash;
      total++;
    }
  }
  await client.end();
  console.log(`  checked ${total} events across ${orgs.length} organisation(s); ${broken === 0 ? 'all chains intact' : `${broken} chain(s) BROKEN`}`);
  process.exit(broken === 0 ? 0 : 1);
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
