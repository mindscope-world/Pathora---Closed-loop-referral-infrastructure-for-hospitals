/**
 * Seeds a local database with the demo dataset the frontend used to hard-code
 * (snapshotted in ./seedData.json). DEVELOPMENT ONLY.
 *
 *   npm run db:seed          # seed an empty database
 *   npm run db:reset         # drop, re-migrate and re-seed
 *
 * Every user gets the same demo password (SEED_PASSWORD, default below). Never run in production.
 */
import { hash } from 'argon2';
import { env } from '../config/env';
import { aad, encryptField } from '../lib/crypto';
import { nameTokens } from '../lib/searchIndex';
import { ackDeadline, evaluationDeadline } from '../modules/cases/sla';
import { parseEat } from '../lib/time';
import { prisma } from './client';
import { appendAudit } from '../modules/audit/append';
import type {
  Channel,
  DeliveryStatus,
  FacilityType,
  InteropMethod,
  Lang,
  MilestoneType,
  Pathway,
  Role,
  RulePackStatus,
  Stage,
} from './generated/client';
import raw from './seedData.json';

const DEMO_PASSWORD = process.env.SEED_PASSWORD ?? 'Pathora-Demo-2026!';
const EMAIL_DOMAIN = 'demo.pathora.test';
const ORG_NAME = 'Nairobi Preventive Screening Network';

// ── Display string → enum maps ─────────────────────────────────────────────────────────────
function mapOf<T extends string>(name: string, table: Record<string, T>) {
  return (v: string): T => {
    const out = table[v];
    if (!out) throw new Error(`seed: unmapped ${name} value "${v}"`);
    return out;
  };
}
const pathway = mapOf<Pathway>('pathway', {
  'Cancer Screening': 'CANCER_SCREENING',
  'NCD Screening': 'NCD_SCREENING',
  'Male Reproductive Health': 'MALE_REPRODUCTIVE_HEALTH',
  'Maternal & Child Health': 'MATERNAL_CHILD_HEALTH',
});
const stage = mapOf<Stage>('stage', {
  Intake: 'INTAKE', Assigned: 'ASSIGNED', Contacted: 'CONTACTED', 'Handoff Sent': 'HANDOFF_SENT',
  Acknowledged: 'ACKNOWLEDGED', Attended: 'ATTENDED', Escalated: 'ESCALATED', Closed: 'CLOSED',
});
const facilityType = mapOf<FacilityType>('facility type', {
  'Public Referral': 'PUBLIC_REFERRAL', 'Faith-Based': 'FAITH_BASED',
  'Private Specialist': 'PRIVATE_SPECIALIST', 'County Diagnostic': 'COUNTY_DIAGNOSTIC',
});
const interop = mapOf<InteropMethod>('interop', {
  'Portal + CSV': 'PORTAL_CSV', 'API Ready': 'API_READY', 'Status-Return Desk': 'STATUS_RETURN_DESK',
});
const role = mapOf<Role>('role', {
  'Programme Manager': 'PROGRAMME_MANAGER', 'Programme Coordinator': 'PROGRAMME_COORDINATOR',
  'Receiving Facility Focal': 'FACILITY_FOCAL', 'Partner Clinical Lead': 'CLINICAL_LEAD',
  'Data Protection Contact': 'DPO',
});
const channel = mapOf<Channel>('channel', { SMS: 'SMS', WhatsApp: 'WHATSAPP', 'Voice Call': 'VOICE' });
const lang = mapOf<Lang>('language', { English: 'ENGLISH', Kiswahili: 'KISWAHILI' });
const delivery = mapOf<DeliveryStatus>('delivery status', {
  Delivered: 'DELIVERED', Read: 'READ', 'Blocked (Opt-out)': 'BLOCKED_OPTOUT', 'Human Routed': 'HUMAN_ROUTED',
});
const rulePackStatus = mapOf<RulePackStatus>('rule pack status', {
  Active: 'ACTIVE', Configured: 'CONFIGURED', 'Coming Soon': 'COMING_SOON',
});
const RULE_PACK_PATHWAY: Record<string, Pathway> = {
  'RP-CANCER': 'CANCER_SCREENING', 'RP-NCD': 'NCD_SCREENING',
  'RP-MALE': 'MALE_REPRODUCTIVE_HEALTH', 'RP-MCH': 'MATERNAL_CHILD_HEALTH',
};
const MILESTONES: Array<[keyof (typeof raw.cases)[number]['milestones'], MilestoneType]> = [
  ['referralIssuedAt', 'REFERRAL_ISSUED'],
  ['facilityAcknowledgedAt', 'FACILITY_ACKNOWLEDGED'],
  ['patientAttendedAt', 'PATIENT_ATTENDED'],
  ['evaluationCompletedAt', 'EVALUATION_COMPLETED'],
  ['outcomeDocumentedAt', 'OUTCOME_DOCUMENTED'],
];

const slug = (name: string) =>
  name.toLowerCase().replace(/\b(dr|sr)\.?\s/g, '').replace(/,.*$/, '').replace(/[^a-z\s]/g, '').trim().replace(/\s+/g, '.');

async function main() {
  if (env.NODE_ENV === 'production') throw new Error('Refusing to seed demo data in production');
  if ((await prisma.organization.count()) > 0) {
    console.log('Database already has data; nothing to do. Use `npm run db:reset` to start over.');
    return;
  }

  // ── Users needed by the demo data ───────────────────────────────────────────────────────
  // The frontend team list has 5 people; the cases, facilities and rule packs reference more.
  type UserSeed = { name: string; role: Role; affiliation: string; accessScope: string; facility?: string; active?: boolean };
  const facilityFocals: Record<string, string> = {
    'Sr. Beatrice Muthoni': 'Kenyatta Referral Outpatient Desk',
    'Dr. Daniel Kiprop': 'St. Luke Mission Diagnostic Centre',
    'Grace Atieno, RN': 'Kisumu County Specialty Clinic',
    'Dr. Hassan Bakari': 'Pwani Regional Care Hospital',
  };
  const users: UserSeed[] = raw.team.map((t) => ({
    name: t.name, role: role(t.role), affiliation: t.organization, accessScope: t.accessScope,
    facility: facilityFocals[t.name], active: t.active,
  }));
  const extras: UserSeed[] = [
    { name: 'Amina Salim', role: 'PROGRAMME_COORDINATOR', affiliation: 'Coastal Private Health Desk', accessScope: 'Coordinates active referral follow-up & SLA queues' },
    { name: 'Dr. Daniel Kiprop', role: 'FACILITY_FOCAL', affiliation: 'St. Luke Mission Diagnostic Centre', accessScope: 'Acknowledges incoming referrals & returns outcome status', facility: facilityFocals['Dr. Daniel Kiprop'] },
    { name: 'Grace Atieno, RN', role: 'FACILITY_FOCAL', affiliation: 'Kisumu County Specialty Clinic', accessScope: 'Acknowledges incoming referrals & returns outcome status', facility: facilityFocals['Grace Atieno, RN'] },
    { name: 'Dr. Hassan Bakari', role: 'FACILITY_FOCAL', affiliation: 'Pwani Regional Care Hospital', accessScope: 'Acknowledges incoming referrals & returns outcome status', facility: facilityFocals['Dr. Hassan Bakari'] },
    { name: 'Dr. Samuel Korir', role: 'CLINICAL_LEAD', affiliation: 'Partner Clinical Governance', accessScope: 'Approves pathway rules, red flags & closure criteria' },
  ];
  for (const e of extras) if (!users.some((u) => u.name === e.name)) users.push(e);

  const passwordHash = await hash(DEMO_PASSWORD);

  const result = await prisma.$transaction(
    async (tx) => {
      const org = await tx.organization.create({
        data: { name: ORG_NAME, type: 'PROGRAMME', retentionDays: 365, dpoContact: 'David Kamau (dpo@partner-network.org)' },
      });

      const facilityIds = new Map<string, string>();
      for (const f of raw.facilities) {
        const row = await tx.facility.create({
          data: { orgId: org.id, name: f.name, type: facilityType(f.type), city: f.city, interopMethod: interop(f.interopMethod) },
        });
        facilityIds.set(f.name, row.id);
      }

      const userIds = new Map<string, string>();
      for (const u of users) {
        const row = await tx.user.create({
          data: {
            orgId: org.id,
            email: `${slug(u.name)}@${EMAIL_DOMAIN}`,
            passwordHash,
            name: u.name,
            role: u.role,
            affiliation: u.affiliation,
            accessScope: u.accessScope,
            active: u.active ?? true,
            facilityId: u.facility ? facilityIds.get(u.facility) : undefined,
          },
        });
        userIds.set(u.name, row.id);
      }
      const userId = (name: string) => {
        const id = userIds.get(name);
        if (!id) throw new Error(`seed: no user named "${name}"`);
        return id;
      };

      // Rule packs. Version labels ("v2.1") become integer versions starting at 1.
      const rulePackByPathway = new Map<Pathway, { id: string; ackSlaHours: number; contactSlaHours: number; evalTargetDays: number }>();
      for (const rp of raw.rulePacks) {
        const ownerName = rp.clinicalOwner.split(' (')[0];
        const row = await tx.rulePack.create({
          data: {
            orgId: org.id, key: rp.id, pathway: RULE_PACK_PATHWAY[rp.id], name: rp.name, version: 1,
            status: rulePackStatus(rp.status), ackSlaHours: rp.ackSlaHours, contactSlaHours: rp.contactSlaHours,
            evalTargetDays: rp.evalTargetDays, clinicalOwnerId: userIds.get(ownerName) ?? null,
            redFlagRule: rp.redFlagRule, closureCriteria: rp.closureCriteria, effectiveFrom: parseEat('2026-11-01'),
          },
        });
        rulePackByPathway.set(RULE_PACK_PATHWAY[rp.id], {
          id: row.id, ackSlaHours: rp.ackSlaHours, contactSlaHours: rp.contactSlaHours, evalTargetDays: rp.evalTargetDays,
        });
      }

      const templateIds = new Map<string, string>();
      for (const t of raw.templates) {
        const row = await tx.messageTemplate.create({
          data: {
            orgId: org.id, name: t.name, pathway: t.pathway === 'All Pathways' ? null : pathway(t.pathway),
            channel: channel(t.channel), language: lang(t.language), body: t.body, reviewedBy: t.reviewedBy,
            approvedAt: parseEat('2026-11-01'),
          },
        });
        templateIds.set(t.name, row.id);
      }

      // Cases (+ patients, consent, milestones)
      let maxRef = 0;
      const caseIds = new Map<string, string>(); // demo id → db id
      for (const c of raw.cases) {
        const issuedAt = parseEat(c.milestones.referralIssuedAt);
        const pack = rulePackByPathway.get(pathway(c.pathway))!;
        const patient = await tx.patient.create({
          data: {
            orgId: org.id,
            patientCode: c.patientCode,
            nameEnc: encryptField(c.patientName, aad.patientName(org.id)),
            nameTokens: nameTokens(org.id, c.patientName),
            label: c.patientLabel,
          },
        });

        const consentBase = { patientId: patient.id, lawfulBasis: 'Explicit consent captured at screening', recordedAt: parseEat(c.createdAt) };
        if (c.consentSms) await tx.consent.create({ data: { ...consentBase, channel: 'SMS', granted: true } });
        if (c.consentWhatsApp) await tx.consent.create({ data: { ...consentBase, channel: 'WHATSAPP', granted: true } });
        if (c.optedOut) {
          // Opt-out is an appended revocation, never an edit of the earlier grant.
          for (const ch of ['SMS', 'WHATSAPP', 'VOICE'] as const) {
            await tx.consent.create({
              data: {
                patientId: patient.id, channel: ch, granted: false, event: 'OPTED_OUT',
                lawfulBasis: 'Patient opt-out; automated contact disabled, human coordinator only',
                recordedById: userIds.get(c.coordinator), recordedAt: parseEat('2026-11-16 09:30'),
              },
            });
          }
        }

        const row = await tx.referralCase.create({
          data: {
            refNumber: c.id, orgId: org.id, patientId: patient.id, pathway: pathway(c.pathway), rulePackId: pack.id,
            sourceProgram: c.sourceProgram, coordinatorId: userId(c.coordinator),
            facilityId: facilityIds.get(c.receivingFacility)!, stage: stage(c.stage), redFlag: c.redFlag, notes: c.notes,
            closureReason: c.closureReason ?? null, outcomeSource: c.outcomeSource ?? null,
            issuedAt, slaDueAt: c.milestones.facilityAcknowledgedAt ? evaluationDeadline(issuedAt, pack) : ackDeadline(issuedAt, pack),
            dueDate: parseEat(c.dueDate),
            closedAt: c.milestones.outcomeDocumentedAt ? parseEat(c.milestones.outcomeDocumentedAt) : null,
            createdAt: parseEat(c.createdAt),
          },
        });
        caseIds.set(c.id, row.id);
        maxRef = Math.max(maxRef, Number(c.id.split('-')[2]));

        for (const [key, type] of MILESTONES) {
          const at = (c.milestones as Record<string, string | undefined>)[key];
          if (at) await tx.caseMilestone.create({ data: { caseId: row.id, type, occurredAt: parseEat(at) } });
        }
      }
      await tx.refSequence.create({ data: { orgId: org.id, year: 2026, lastValue: maxRef } });

      for (const m of raw.commsLog) {
        await tx.commsLog.create({
          data: {
            orgId: org.id, caseId: caseIds.get(m.caseId)!, channel: channel(m.channel),
            templateId: templateIds.get(m.templateName) ?? null, templateName: m.templateName,
            status: delivery(m.deliveryStatus), sentAt: parseEat(m.timestamp),
          },
        });
      }

      // Audit events: oldest first, through the real hash-chain writer.
      const events = [...raw.auditEvents].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      for (const ev of events) {
        await appendAudit(tx, {
          orgId: org.id, at: parseEat(ev.timestamp), actorId: userIds.get(ev.actor) ?? null,
          actorLabel: ev.actor, actorRole: ev.role, action: ev.action,
          resourceType: ev.resourceId.startsWith('REF-') ? 'ReferralCase' : 'Unknown', resourceId: ev.resourceId, detail: ev.detail,
        });
      }

      return { orgId: org.id };
    },
    { timeout: 60_000, maxWait: 10_000 },
  );

  const counts = await Promise.all([
    prisma.user.count(), prisma.facility.count(), prisma.referralCase.count(), prisma.patient.count(),
    prisma.consent.count(), prisma.caseMilestone.count(), prisma.commsLog.count(), prisma.auditEvent.count(),
  ]);
  console.log(`Seeded org ${result.orgId}`);
  console.log(`  users=${counts[0]} facilities=${counts[1]} cases=${counts[2]} patients=${counts[3]} consent=${counts[4]} milestones=${counts[5]} comms=${counts[6]} audit=${counts[7]}`);
  console.log(`  Demo login: ${slug('Miriam Wanjiku')}@${EMAIL_DOMAIN}  /  ${DEMO_PASSWORD}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
