import type { Prisma } from '../../db/generated/client';

/**
 * A patient the system cannot (or must not) message has to reach a PERSON, never silently disappear.
 * This tells the case owner to make the contact themselves. The text carries only the referral number.
 * (If the owner has been deactivated, the programme managers are told instead.)
 */
export async function routeToHuman(
  tx: Pick<Prisma.TransactionClient, 'user' | 'notification'>,
  c: { orgId: string; coordinatorId: string; refNumber: string },
  reason: string,
  opts: { kind?: string; title?: string; closing?: string } = {},
): Promise<number> {
  const owner = await tx.user.findFirst({ where: { id: c.coordinatorId, active: true }, select: { id: true } });
  const recipients = owner
    ? [owner]
    : await tx.user.findMany({ where: { orgId: c.orgId, active: true, role: 'PROGRAMME_MANAGER' }, select: { id: true } });
  if (recipients.length === 0) return 0;
  await tx.notification.createMany({
    data: recipients.map((u) => ({
      orgId: c.orgId, userId: u.id, kind: opts.kind ?? 'HUMAN_FOLLOW_UP', caseRef: c.refNumber,
      title: opts.title ?? `${c.refNumber}: contact the patient directly`,
      body: `${reason}${opts.closing ?? ' Automated messages are not reaching this patient, so please follow up in person or by phone.'}`,
    })),
  });
  return recipients.length;
}
