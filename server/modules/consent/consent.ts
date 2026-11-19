import type { Channel, Prisma } from '../../db/generated/client';

/**
 * The append-only consent operations, shared by every way consent can change: the Data Protection
 * Contact in the UI, and a patient replying STOP or START. Rows are only ever added; the current
 * state is derived from them (see cases/dto.ts consentState).
 */
export const OPT_OUT_CHANNELS: Channel[] = ['SMS', 'WHATSAPP', 'VOICE'];
/** Voice calls are made by people, so they are never automatically re-enabled. */
export const RESTORE_CHANNELS: Channel[] = ['SMS', 'WHATSAPP'];

/** Anything that can add a consent row: a plain or tenant-scoped transaction client. */
export interface ConsentWriter {
  consent: { create(args: { data: Prisma.ConsentUncheckedCreateInput }): PromiseLike<unknown> };
}

type Row = { channel: Channel; granted: boolean; event: string; recordedAt: Date };

/** A timestamp strictly later than anything already recorded, so the newest row is unambiguous. */
export function nextConsentTime(rows: Pick<Row, 'recordedAt'>[], now: Date): Date {
  const newest = rows.reduce((m, r) => Math.max(m, r.recordedAt.getTime()), 0);
  return new Date(Math.max(now.getTime(), newest + 1));
}

export async function recordOptOut(
  tx: ConsentWriter,
  a: { patientId: string; userId: string | null; basis: string; at: Date },
) {
  for (const channel of OPT_OUT_CHANNELS) {
    await tx.consent.create({
      data: { patientId: a.patientId, channel, granted: false, event: 'OPTED_OUT', recordedById: a.userId, recordedAt: a.at, lawfulBasis: a.basis },
    });
  }
}

/** Channels the patient had actually granted before opting out: the only ones that can be restored. */
export function restorableChannels(rows: Row[]): Channel[] {
  return RESTORE_CHANNELS.filter((ch) => rows.some((r) => r.channel === ch && r.granted && r.event !== 'OPTED_OUT'));
}

export async function recordRestore(
  tx: ConsentWriter,
  a: { patientId: string; channels: Channel[]; userId: string | null; basis: string; at: Date },
) {
  for (const channel of a.channels) {
    await tx.consent.create({
      data: { patientId: a.patientId, channel, granted: true, event: 'RESTORED', recordedById: a.userId, recordedAt: a.at, lawfulBasis: a.basis },
    });
  }
}
