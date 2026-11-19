import { randomBytes } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { PATHWAY_LABELS, type ImportCasesRequest, type ImportCasesResponse, type ImportRowResult, type PathwayId } from '../../../shared/types';
import { forOrg } from '../../db/tenant';
import { HttpError } from '../../lib/errors';
import type { AuthContext } from '../../types';
import { bulkInsertCases, type BulkItem, type Tx } from './service';

export const MAX_IMPORT_ROWS = 500;
const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9-]{1,31}$/;
const DEFAULT_SOURCE = 'Secure CSV Intake';

/** Thrown after a dry run's rows are processed, purely to roll the transaction back. */
class DryRunRollback extends Error {}

const PATHWAY_LOOKUP = new Map<string, PathwayId>(
  (Object.entries(PATHWAY_LABELS) as [PathwayId, string][]).flatMap(([id, label]) => [
    [label.toLowerCase(), id],
    [id.toLowerCase(), id],
    [id.toLowerCase().replace(/_/g, ' '), id],
  ]),
);

type Rec = { record: string[]; info: { lines: number } };

function parseCsv(csv: string): Rec[] {
  let records: Rec[];
  try {
    records = parse(csv, { relax_column_count: true, skip_empty_lines: true, trim: true, bom: true, info: true }) as unknown as Rec[];
  } catch (err) {
    throw new HttpError(400, 'INVALID_CSV', `Could not read the CSV: ${(err as Error).message}`);
  }
  // Drop an optional header row.
  if (records[0] && /^patient\s*_?code$/i.test(records[0].record[0] ?? '')) records = records.slice(1);
  if (records.length === 0) throw new HttpError(400, 'INVALID_CSV', 'The CSV has no data rows');
  if (records.length > MAX_IMPORT_ROWS) {
    throw new HttpError(400, 'TOO_MANY_ROWS', `A single import is limited to ${MAX_IMPORT_ROWS} rows (got ${records.length})`);
  }
  return records;
}

/**
 * Columns: patientCode, cohortLabel, pathway, sourceProgram, owner, facility[, patientName]
 *
 * Valid rows are imported and invalid rows are reported with a reason, so one typo does not block a
 * 200-row batch. Validation and writing share one code path; a dry run executes it inside a
 * transaction that is rolled back, so it cannot disagree with what a real import would do.
 *
 * Cost is a fixed handful of queries regardless of batch size (see `bulkInsertCases`).
 */
export async function importCases(auth: AuthContext, req: ImportCasesRequest): Promise<ImportCasesResponse> {
  const dryRun = req.dryRun === true;
  if (!dryRun && req.consentAttested !== true) {
    throw new HttpError(422, 'CONSENT_ATTESTATION_REQUIRED',
      'Confirm that you hold the patients’ consent for SMS follow-up before importing');
  }
  const records = parseCsv(req.csv);
  const now = new Date();
  const slots: ImportRowResult[] = new Array(records.length);

  const run = async (tx: Tx) => {
    // ── lookups, once ──
    const facilities = new Map((await tx.facility.findMany({ select: { id: true, name: true } })).map((f) => [f.name.toLowerCase(), f]));
    const owners = await tx.user.findMany({
      where: { active: true, role: { in: ['PROGRAMME_MANAGER', 'PROGRAMME_COORDINATOR'] } },
      select: { id: true, name: true },
    });
    const ownersByName = new Map<string, string[]>();
    for (const o of owners) ownersByName.set(o.name.toLowerCase(), [...(ownersByName.get(o.name.toLowerCase()) ?? []), o.id]);
    const packs = new Map<PathwayId, Awaited<ReturnType<typeof tx.rulePack.findMany>>[number]>();
    for (const p of await tx.rulePack.findMany({ orderBy: { version: 'desc' } })) if (!packs.has(p.pathway)) packs.set(p.pathway, p);

    // ── pass 1: per-row validation (no queries) ──
    type Candidate = { idx: number; line: number; code: string; item: BulkItem };
    const candidates: Candidate[] = [];
    records.forEach(({ record: c, info }, idx) => {
      const line = info.lines;
      const code = (c[0] ?? '').trim();
      const fail = (error: string) => { slots[idx] = { line, patientCode: code, ok: false, error }; };

      if (!CODE_RE.test(code)) return fail('Patient code must be 2–32 letters, numbers or dashes');
      const pathway = PATHWAY_LOOKUP.get((c[2] ?? '').toLowerCase());
      if (!pathway) return fail(`Unknown pathway "${c[2] ?? ''}"`);
      const pack = packs.get(pathway);
      if (!pack || pack.status === 'COMING_SOON') return fail(`${PATHWAY_LABELS[pathway]} is not available for referrals yet`);
      const facility = facilities.get((c[5] ?? '').toLowerCase());
      if (!facility) return fail(`Unknown facility "${c[5] ?? ''}"`);
      const ownerIds = ownersByName.get((c[4] ?? '').toLowerCase()) ?? [];
      if (ownerIds.length === 0) return fail(`Unknown or inactive owner "${c[4] ?? ''}"`);
      if (ownerIds.length > 1) return fail(`Owner name "${c[4]}" is ambiguous`);

      candidates.push({
        idx, line, code: code.toUpperCase(),
        item: {
          refs: { facilityName: facility.name, coordinatorOk: true, pack },
          input: {
            patientCode: code.toUpperCase(), patientName: c[6] || undefined, patientLabel: c[1] || 'CSV imported cohort',
            pathway, sourceProgram: c[3] || DEFAULT_SOURCE, coordinatorId: ownerIds[0], facilityId: facility.id,
            redFlag: false, consentSms: true, consentBasis: 'Programme attestation of patient consent at CSV import',
            notes: 'Imported via secure CSV intake.',
          },
        },
      });
    });

    // ── pass 2: duplicate open referrals (two queries for the whole batch) ──
    const existing = await tx.patient.findMany({
      where: { patientCode: { in: [...new Set(candidates.map((c) => c.code))] } },
      select: { id: true, patientCode: true },
    });
    const codeById = new Map(existing.map((p) => [p.id, p.patientCode]));
    const open = existing.length === 0 ? [] : await tx.referralCase.findMany({
      where: { patientId: { in: existing.map((p) => p.id) }, stage: { not: 'CLOSED' }, isSynthetic: false },
      select: { patientId: true, pathway: true, refNumber: true },
    });
    const openRef = new Map(open.map((o) => [`${codeById.get(o.patientId)}|${o.pathway}`, o.refNumber]));

    const accepted: Candidate[] = [];
    const acceptedKeys = new Map<string, number>(); // key → line of the earlier row in this file
    for (const c of candidates) {
      const key = `${c.code}|${c.item.input.pathway}`;
      const label = PATHWAY_LABELS[c.item.input.pathway];
      if (openRef.has(key)) {
        slots[c.idx] = { line: c.line, patientCode: c.code, ok: false, error: `${c.code} already has an open ${label} referral (${openRef.get(key)})` };
      } else if (acceptedKeys.has(key)) {
        slots[c.idx] = { line: c.line, patientCode: c.code, ok: false, error: `${c.code} already has an open ${label} referral (row ${acceptedKeys.get(key)} of this file)` };
      } else {
        acceptedKeys.set(key, c.line);
        accepted.push(c);
      }
    }

    // ── write (or, for a dry run, write then roll back) ──
    const rejected = records.length - accepted.length;
    const refs = await bulkInsertCases(tx, auth, accepted.map((a) => a.item), now, accepted.length > 0 ? {
      resourceId: `BATCH-${randomBytes(4).toString('hex').toUpperCase()}`,
      detail: `Imported ${accepted.length} consented referral${accepted.length === 1 ? '' : 's'} via secure CSV intake` +
        `${rejected > 0 ? ` (${rejected} rejected)` : ''}.`,
    } : undefined);
    accepted.forEach((a, n) => {
      slots[a.idx] = { line: a.line, patientCode: a.code, ok: true, ...(dryRun ? {} : { caseId: refs[n] }) };
    });

    if (dryRun) throw new DryRunRollback();
  };

  try {
    await forOrg(auth.orgId).$transaction(run, { timeout: 60_000, maxWait: 10_000 });
  } catch (err) {
    if (!(err instanceof DryRunRollback)) throw err;
  }

  const imported = slots.filter((r) => r.ok).length;
  return { dryRun, imported, rejected: slots.length - imported, rows: slots };
}
