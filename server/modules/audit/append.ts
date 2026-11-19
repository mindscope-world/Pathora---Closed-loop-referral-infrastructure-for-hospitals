import type { Prisma } from '../../db/generated/client';
import { computeAuditHash, GENESIS_HASH, type AuditHashInput } from '../../lib/auditHash';

export type AuditEventInput = Omit<AuditHashInput, 'at'> & { at?: Date };

/**
 * The ONLY write path for AuditEvent. Must be called inside the transaction that performs the
 * audited change, so the change and its audit record commit or roll back together.
 *
 * A transaction-scoped advisory lock per organisation serialises appends so the hash chain
 * (each row commits to the previous row's hash) cannot fork under concurrency.
 */
export async function appendAudit(tx: Pick<Prisma.TransactionClient, '$executeRaw' | 'auditEvent'>, input: AuditEventInput) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'audit:' + input.orgId}, 0))`;

  const last = await tx.auditEvent.findFirst({
    where: { orgId: input.orgId },
    orderBy: { id: 'desc' },
    select: { hash: true },
  });
  const prevHash = last?.hash ?? GENESIS_HASH;

  // Postgres timestamps here are millisecond-precision; truncate so the hashed value matches what is stored.
  const at = new Date(input.at?.getTime() ?? Date.now());
  const hash = computeAuditHash(prevHash, { ...input, at });

  return tx.auditEvent.create({ data: { ...input, at, prevHash, hash } });
}

/**
 * Appends many events (all for one organisation) as one contiguous stretch of the chain with a
 * single lock, a single read of the chain tip and a single INSERT. Used by bulk operations such as
 * CSV import; produces exactly the same chain as appending them one at a time.
 */
export async function appendAuditBatch(tx: Pick<Prisma.TransactionClient, '$executeRaw' | 'auditEvent'>, inputs: AuditEventInput[]) {
  if (inputs.length === 0) return;
  const orgId = inputs[0].orgId;
  if (inputs.some((i) => i.orgId !== orgId)) throw new Error('appendAuditBatch: all events must belong to one organisation');

  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'audit:' + orgId}, 0))`;
  const last = await tx.auditEvent.findFirst({ where: { orgId }, orderBy: { id: 'desc' }, select: { hash: true } });

  let prevHash = last?.hash ?? GENESIS_HASH;
  const rows = inputs.map((input) => {
    const at = new Date(input.at?.getTime() ?? Date.now());
    const hash = computeAuditHash(prevHash, { ...input, at });
    const row = { ...input, at, prevHash, hash };
    prevHash = hash;
    return row;
  });
  // A single multi-row INSERT assigns ids in row order, which the chain verifier relies on.
  await tx.auditEvent.createMany({ data: rows });
}

/** Walks an organisation's chain; returns the first broken event id, or null if intact. */
export async function verifyAuditChain(
  db: Pick<Prisma.TransactionClient, 'auditEvent'>,
  orgId: string,
): Promise<{ ok: true; count: number } | { ok: false; brokenAtId: bigint; reason: string }> {
  let prev = GENESIS_HASH;
  let count = 0;
  let cursor: bigint | undefined;
  for (;;) {
    const page = await db.auditEvent.findMany({
      where: { orgId },
      orderBy: { id: 'asc' },
      take: 500,
      ...(cursor !== undefined ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (page.length === 0) return { ok: true, count };
    for (const ev of page) {
      if (ev.prevHash !== prev) return { ok: false, brokenAtId: ev.id, reason: 'prevHash does not match previous event' };
      const expected = computeAuditHash(prev, ev);
      if (ev.hash !== expected) return { ok: false, brokenAtId: ev.id, reason: 'hash does not match event contents' };
      prev = ev.hash;
      count++;
    }
    cursor = page[page.length - 1].id;
  }
}
