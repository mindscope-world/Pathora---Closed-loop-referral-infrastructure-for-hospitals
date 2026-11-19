import type { Prisma } from '../db/generated/client';
import { yearInNairobi } from './time';

type Tx = Pick<Prisma.TransactionClient, '$queryRaw'>;

export function formatRefNumber(year: number, n: number): string {
  return `REF-${year}-${String(n).padStart(4, '0')}`;
}

/**
 * Issues the next human-facing case id (REF-YYYY-NNNN), per organisation per year.
 *
 * A single INSERT … ON CONFLICT DO UPDATE … RETURNING is atomic: concurrent callers serialise on
 * the row lock and each gets a distinct number. Call it inside the same transaction that inserts
 * the case, so a rolled-back creation does not burn a number.
 */
export async function nextRefNumber(tx: Tx, orgId: string, year: number = yearInNairobi()): Promise<string> {
  const rows = await tx.$queryRaw<{ lastValue: number }[]>`
    INSERT INTO "RefSequence" ("orgId", "year", "lastValue")
    VALUES (${orgId}, ${year}, 1)
    ON CONFLICT ("orgId", "year")
    DO UPDATE SET "lastValue" = "RefSequence"."lastValue" + 1
    RETURNING "lastValue"`;
  return formatRefNumber(year, rows[0].lastValue);
}

/**
 * Reserves `count` consecutive reference numbers in one atomic statement (bulk import).
 * Same guarantees as `nextRefNumber`: serialised per organisation/year, rolled back with the transaction.
 */
export async function reserveRefNumbers(tx: Tx, orgId: string, count: number, year: number = yearInNairobi()): Promise<string[]> {
  if (count <= 0) return [];
  const rows = await tx.$queryRaw<{ lastValue: number }[]>`
    INSERT INTO "RefSequence" ("orgId", "year", "lastValue")
    VALUES (${orgId}, ${year}, ${count})
    ON CONFLICT ("orgId", "year")
    DO UPDATE SET "lastValue" = "RefSequence"."lastValue" + ${count}
    RETURNING "lastValue"`;
  const last = rows[0].lastValue;
  return Array.from({ length: count }, (_, i) => formatRefNumber(year, last - count + 1 + i));
}

/**
 * Next pseudonymous patient code (PT-NNNN) for an organisation, used when the caller does not
 * supply one. Serialised per organisation with a transaction-scoped advisory lock so concurrent
 * creates cannot be handed the same number.
 */
export async function nextPatientCode(tx: Pick<Prisma.TransactionClient, '$queryRaw' | '$executeRaw'>, orgId: string): Promise<string> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'patientcode:' + orgId}, 0))`;
  const rows = await tx.$queryRaw<{ next: number }[]>`
    SELECT COALESCE(MAX(substring("patientCode" from '^PT-([0-9]+)$')::int), 8000) + 1 AS next
    FROM "Patient" WHERE "orgId" = ${orgId}`;
  return `PT-${rows[0].next}`;
}
