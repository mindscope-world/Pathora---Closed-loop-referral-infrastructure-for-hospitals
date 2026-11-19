import { describe, expect, it } from 'vitest';
import type { Stage } from '../../db/generated/client';
import { resumeStage, transition, type CaseEvent, type CaseFacts } from './stateMachine';

const STAGES: Stage[] = ['INTAKE', 'ASSIGNED', 'CONTACTED', 'HANDOFF_SENT', 'ACKNOWLEDGED', 'ATTENDED', 'ESCALATED', 'CLOSED'];
const EVENTS: CaseEvent[] = ['ACKNOWLEDGE', 'ATTEND', 'CLOSE', 'ESCALATE', 'RESOLVE_BARRIER'];

const f = (stage: Stage, hasAcknowledged = false, hasAttended = false): CaseFacts => ({ stage, hasAcknowledged, hasAttended });
const illegal = (facts: CaseFacts, event: CaseEvent) =>
  expect(() => transition(facts, event)).toThrowError(expect.objectContaining({ status: 409, code: 'ILLEGAL_TRANSITION' }));

describe('happy path', () => {
  it('HANDOFF_SENT → ACKNOWLEDGED → ATTENDED → CLOSED', () => {
    expect(transition(f('HANDOFF_SENT'), 'ACKNOWLEDGE')).toBe('ACKNOWLEDGED');
    expect(transition(f('ACKNOWLEDGED', true), 'ATTEND')).toBe('ATTENDED');
    expect(transition(f('ATTENDED', true, true), 'CLOSE')).toBe('CLOSED');
  });
});

describe('a closed case is terminal', () => {
  it.each(EVENTS)('rejects %s', (event) => illegal(f('CLOSED', true, true), event));
});

describe('milestones cannot be skipped (the old UI back-filled them)', () => {
  it('cannot confirm attendance before acknowledgment', () => {
    illegal(f('HANDOFF_SENT'), 'ATTEND');
    illegal(f('ESCALATED'), 'ATTEND');
  });
  it('cannot close before acknowledgment or before attendance', () => {
    illegal(f('HANDOFF_SENT'), 'CLOSE');
    illegal(f('ACKNOWLEDGED', true), 'CLOSE');
    illegal(f('ESCALATED', true), 'CLOSE');
  });
  it('explains what is missing', () => {
    expect(() => transition(f('ACKNOWLEDGED', true), 'CLOSE')).toThrow(/attendance must be confirmed/);
    expect(() => transition(f('HANDOFF_SENT'), 'ATTEND')).toThrow(/must acknowledge/);
  });
});

describe('acknowledge', () => {
  it('is allowed from HANDOFF_SENT and from ESCALATED when not yet acknowledged', () => {
    expect(transition(f('HANDOFF_SENT'), 'ACKNOWLEDGE')).toBe('ACKNOWLEDGED');
    expect(transition(f('ESCALATED'), 'ACKNOWLEDGE')).toBe('ACKNOWLEDGED');
  });
  it('is rejected twice, and before the referral is handed off', () => {
    illegal(f('ACKNOWLEDGED', true), 'ACKNOWLEDGE');
    illegal(f('ESCALATED', true), 'ACKNOWLEDGE');
    illegal(f('INTAKE'), 'ACKNOWLEDGE');
    illegal(f('ASSIGNED'), 'ACKNOWLEDGE');
    illegal(f('CONTACTED'), 'ACKNOWLEDGE');
  });
});

describe('attend / close from an escalated case', () => {
  it('lets facility progress clear an escalation', () => {
    expect(transition(f('ESCALATED', true), 'ATTEND')).toBe('ATTENDED');
    expect(transition(f('ESCALATED', true, true), 'CLOSE')).toBe('CLOSED');
  });
  it('attendance cannot be confirmed twice', () => illegal(f('ATTENDED', true, true), 'ATTEND'));
});

describe('escalate', () => {
  it.each(['CONTACTED', 'HANDOFF_SENT', 'ACKNOWLEDGED', 'ATTENDED'] as Stage[])('is allowed from %s', (stage) => {
    expect(transition(f(stage, stage === 'ACKNOWLEDGED' || stage === 'ATTENDED', stage === 'ATTENDED'), 'ESCALATE')).toBe('ESCALATED');
  });
  it('is rejected when already escalated or before first contact', () => {
    illegal(f('ESCALATED'), 'ESCALATE');
    illegal(f('INTAKE'), 'ESCALATE');
    illegal(f('ASSIGNED'), 'ESCALATE');
  });
});

describe('barrier resolution', () => {
  it('returns an escalated case to its real progress — never backwards', () => {
    expect(transition(f('ESCALATED'), 'RESOLVE_BARRIER')).toBe('HANDOFF_SENT');
    expect(transition(f('ESCALATED', true), 'RESOLVE_BARRIER')).toBe('ACKNOWLEDGED');
    expect(transition(f('ESCALATED', true, true), 'RESOLVE_BARRIER')).toBe('ATTENDED');
  });
  it('leaves a non-escalated case where it is (the clock is reset elsewhere)', () => {
    for (const s of ['INTAKE', 'ASSIGNED', 'CONTACTED', 'HANDOFF_SENT', 'ACKNOWLEDGED', 'ATTENDED'] as Stage[]) {
      expect(transition(f(s, s === 'ACKNOWLEDGED' || s === 'ATTENDED', s === 'ATTENDED'), 'RESOLVE_BARRIER')).toBe(s);
    }
  });
  it('resumeStage prefers the furthest milestone', () => {
    expect(resumeStage({ hasAcknowledged: false, hasAttended: false })).toBe('HANDOFF_SENT');
    expect(resumeStage({ hasAcknowledged: true, hasAttended: false })).toBe('ACKNOWLEDGED');
    expect(resumeStage({ hasAcknowledged: true, hasAttended: true })).toBe('ATTENDED');
  });
});

describe('property: random event sequences never reach an inconsistent state', () => {
  // Deterministic PRNG so failures reproduce.
  let seed = 12345;
  const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);

  it('stage always agrees with milestones, and CLOSED implies both milestones', () => {
    for (let run = 0; run < 500; run++) {
      let facts = f('HANDOFF_SENT');
      for (let step = 0; step < 12; step++) {
        const event = EVENTS[rand(EVENTS.length)];
        let next: Stage;
        try {
          next = transition(facts, event);
        } catch {
          continue; // illegal moves are rejected and change nothing
        }
        facts = {
          stage: next,
          hasAcknowledged: facts.hasAcknowledged || event === 'ACKNOWLEDGE',
          hasAttended: facts.hasAttended || event === 'ATTEND',
        };
        if (facts.hasAttended) expect(facts.hasAcknowledged).toBe(true);
        if (facts.stage === 'CLOSED') expect(facts.hasAttended && facts.hasAcknowledged).toBe(true);
        if (facts.stage === 'ATTENDED') expect(facts.hasAttended).toBe(true);
        if (facts.stage === 'ACKNOWLEDGED') expect(facts.hasAcknowledged && !facts.hasAttended).toBe(true);
      }
    }
  });

  it('every stage × event pair either returns a valid stage or a typed 409 (never another error)', () => {
    for (const stage of STAGES) {
      for (const ack of [false, true]) {
        for (const att of [false, true]) {
          for (const event of EVENTS) {
            try {
              expect(STAGES).toContain(transition(f(stage, ack, att), event));
            } catch (e) {
              expect(e).toMatchObject({ status: 409, code: 'ILLEGAL_TRANSITION' });
            }
          }
        }
      }
    }
  });
});
