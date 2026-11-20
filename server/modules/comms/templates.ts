import { z } from 'zod';
import { ROLE_LABELS, type TemplateDto } from '../../../shared/types';
import type { MessageTemplate, Prisma } from '../../db/generated/client';
import { forOrg } from '../../db/tenant';
import { HttpError } from '../../lib/errors';
import { printableText } from '../../lib/validation';
import type { AuthContext } from '../../types';
import { appendAudit } from '../audit/append';
import { lintTemplateBody, placeholdersIn } from './template';

const asTx = (tx: unknown) => tx as Prisma.TransactionClient;
const pathway = z.enum(['CANCER_SCREENING', 'NCD_SCREENING', 'MALE_REPRODUCTIVE_HEALTH', 'MATERNAL_CHILD_HEALTH']);

const base = {
  name: printableText(3, 120, 'Give the template a name'),
  pathway: pathway.nullable(),
  channel: z.enum(['SMS', 'WHATSAPP']),
  language: z.enum(['ENGLISH', 'KISWAHILI']),
  // Newlines are fine in a message body, unlike in names.
  body: z.string().trim().min(5, 'Write the message').max(1000),
};
export const createTemplateSchema = z.object(base);
export const updateTemplateSchema = z
  .object({ name: base.name.optional(), pathway: base.pathway.optional(), channel: base.channel.optional(), language: base.language.optional(), body: base.body.optional() })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

const bodyProblems = (body: string) => {
  const problems = lintTemplateBody(body);
  if (problems.length) throw new HttpError(400, 'VALIDATION_ERROR', 'Request validation failed', problems.map((p) => ({ path: 'body', message: p.message })));
};

type Row = MessageTemplate;

export function toTemplateDto(t: Row, approver: string | null): TemplateDto {
  return {
    id: t.id, name: t.name, pathway: t.pathway, channel: t.channel as TemplateDto['channel'], language: t.language, body: t.body,
    status: t.retiredAt ? 'RETIRED' : t.approvedAt ? 'APPROVED' : 'DRAFT',
    reviewedBy: t.reviewedBy, approvedBy: approver, approvedAt: t.approvedAt?.toISOString() ?? null, placeholders: placeholdersIn(t.body),
  };
}

async function approverNames(auth: AuthContext, rows: Row[]) {
  const ids = [...new Set(rows.map((r) => r.approvedById).filter((i): i is string => Boolean(i)))];
  if (ids.length === 0) return new Map<string, string>();
  const users = await forOrg(auth.orgId).user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

const actor = (a: AuthContext) => ({ orgId: a.orgId, actorId: a.userId, actorLabel: a.name, actorRole: ROLE_LABELS[a.role] });
const exists = () => new HttpError(409, 'TEMPLATE_EXISTS', 'A template with this name already exists');

export async function listTemplates(auth: AuthContext): Promise<TemplateDto[]> {
  const rows = await forOrg(auth.orgId).messageTemplate.findMany({ orderBy: [{ retiredAt: { sort: 'asc', nulls: 'first' } }, { name: 'asc' }] });
  const names = await approverNames(auth, rows);
  return rows.map((t) => toTemplateDto(t, t.approvedById ? (names.get(t.approvedById) ?? null) : null));
}

async function one(auth: AuthContext, id: string): Promise<TemplateDto> {
  const t = await forOrg(auth.orgId).messageTemplate.findFirst({ where: { id } });
  if (!t) throw HttpError.notFound('Template not found');
  const names = await approverNames(auth, [t]);
  return toTemplateDto(t, t.approvedById ? (names.get(t.approvedById) ?? null) : null);
}

export async function createTemplate(auth: AuthContext, input: z.infer<typeof createTemplateSchema>): Promise<TemplateDto> {
  bodyProblems(input.body);
  try {
    const id = await forOrg(auth.orgId).$transaction(async (tx) => {
      const t = await tx.messageTemplate.create({ data: { orgId: auth.orgId, ...input, reviewedBy: 'Awaiting clinical approval' } });
      await appendAudit(asTx(tx), { ...actor(auth), action: 'TEMPLATE_CREATED', resourceType: 'MessageTemplate', resourceId: t.id, detail: `Drafted patient message template "${t.name}" (${t.channel}, ${t.language}).` });
      return t.id;
    });
    return one(auth, id);
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') throw exists();
    throw err;
  }
}

/** Editing the wording of an approved template withdraws its approval: the text that was reviewed is no longer the text that would be sent. */
export async function updateTemplate(auth: AuthContext, id: string, patch: z.infer<typeof updateTemplateSchema>): Promise<TemplateDto> {
  if (patch.body !== undefined) bodyProblems(patch.body);
  try {
    await forOrg(auth.orgId).$transaction(async (tx) => {
      const before = await tx.messageTemplate.findFirst({ where: { id } });
      if (!before) throw HttpError.notFound('Template not found');
      if (before.retiredAt) throw new HttpError(409, 'TEMPLATE_RETIRED', 'A retired template cannot be edited');
      const changed = (Object.keys(patch) as (keyof typeof patch)[]).filter((k) => patch[k] !== undefined && patch[k] !== before[k]);
      if (changed.length === 0) return;
      const withdraws = before.approvedAt !== null;
      await tx.messageTemplate.update({ where: { id }, data: { ...patch, ...(withdraws ? { approvedAt: null, approvedById: null, reviewedBy: 'Awaiting clinical approval' } : {}) } });
      await appendAudit(asTx(tx), {
        ...actor(auth), action: 'TEMPLATE_UPDATED', resourceType: 'MessageTemplate', resourceId: id,
        detail: `Edited "${before.name}" (${changed.join(', ')}).${withdraws ? ' Its approval was withdrawn: it must be approved again before it can be sent.' : ''}`,
      });
    });
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') throw exists();
    throw err;
  }
  return one(auth, id);
}

export async function approveTemplate(auth: AuthContext, id: string): Promise<TemplateDto> {
  await forOrg(auth.orgId).$transaction(async (tx) => {
    const t = await tx.messageTemplate.findFirst({ where: { id } });
    if (!t) throw HttpError.notFound('Template not found');
    if (t.retiredAt) throw new HttpError(409, 'TEMPLATE_RETIRED', 'A retired template cannot be approved');
    if (t.approvedAt) return; // already approved: nothing to do
    bodyProblems(t.body); // approval is a statement that the wording is discreet, so re-check it now
    await tx.messageTemplate.update({
      where: { id }, data: { approvedAt: new Date(), approvedById: auth.userId, reviewedBy: `${auth.name} · ${ROLE_LABELS[auth.role]}` },
    });
    await appendAudit(asTx(tx), { ...actor(auth), action: 'TEMPLATE_APPROVED', resourceType: 'MessageTemplate', resourceId: id, detail: `Approved patient message template "${t.name}" for sending.` });
  });
  return one(auth, id);
}

export async function retireTemplate(auth: AuthContext, id: string): Promise<TemplateDto> {
  await forOrg(auth.orgId).$transaction(async (tx) => {
    const t = await tx.messageTemplate.findFirst({ where: { id } });
    if (!t) throw HttpError.notFound('Template not found');
    if (t.retiredAt) return;
    await tx.messageTemplate.update({ where: { id }, data: { retiredAt: new Date() } });
    await appendAudit(asTx(tx), { ...actor(auth), action: 'TEMPLATE_RETIRED', resourceType: 'MessageTemplate', resourceId: id, detail: `Retired template "${t.name}": it can no longer be sent.` });
  });
  return one(auth, id);
}
