import { z } from 'zod';
import { env } from '../../config/env';
import { prisma } from '../../db/client';
import { logger } from '../../lib/logger';
import { getMailer, leadEmail } from '../../lib/mailer';
import { printableText } from '../../lib/validation';

/** Same shape check the walkthrough form has always applied, plus a length cap (RFC 5321 limit). */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const leadSchema = z.object({
  name: printableText(1, 120, 'Please enter your name'),
  organization: printableText(1, 160, 'Please enter your organization'),
  email: z.string().trim().max(254, 'Use at most 254 characters').regex(EMAIL, 'Please provide a valid work email address').transform((v) => v.toLowerCase()),
  pathway: printableText(1, 80, 'Please choose a pathway'),
  /** Honeypot: a visually hidden field people never fill. Bots that complete every input do. */
  website: z.string().max(500).optional(),
});
export type LeadInput = z.infer<typeof leadSchema>;

const DEDUPE_WINDOW_MS = 24 * 3_600_000;

/**
 * Stores a walkthrough request and tells the team. Always looks successful to the caller: a filled honeypot or a
 * repeat of the same request within a day is dropped silently, so neither bots nor impatient double-clicks learn
 * anything or create duplicate work.
 */
export async function submitLead(input: LeadInput, now: Date = new Date()): Promise<'created' | 'ignored'> {
  if (input.website) return 'ignored';

  const recent = await prisma.lead.findFirst({
    where: { email: input.email, pathway: input.pathway, createdAt: { gte: new Date(now.getTime() - DEDUPE_WINDOW_MS) } },
    select: { id: true },
  });
  if (recent) return 'ignored';

  const lead = await prisma.lead.create({ data: { name: input.name, organization: input.organization, email: input.email, pathway: input.pathway } });
  void notifyTeam(lead); // best effort: the lead is already saved, so a mail problem must not fail the request
  return 'created';
}

async function notifyTeam(lead: { name: string; organization: string; email: string; pathway: string }) {
  const to = env.LEADS_NOTIFY_EMAIL;
  const mailer = getMailer();
  if (!to || !mailer.configured) return;
  try {
    await mailer.send(leadEmail({ to, ...lead }));
  } catch (err) {
    logger.error({ err }, 'Could not email the team about a new walkthrough request');
  }
}
