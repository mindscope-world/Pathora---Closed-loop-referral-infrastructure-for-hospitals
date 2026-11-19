import { describe, expect, it } from 'vitest';
import { ackDeadline, barrierDeadline, deriveStatus, evaluationDeadline, slaHoursRemaining, type PackSla } from './sla';

const H = 3_600_000;
const pack: PackSla = { ackSlaHours: 24, contactSlaHours: 12, evalTargetDays: 7 };
const issued = new Date('2026-11-17T09:20:00+03:00');
const at = (offsetHours: number, base = issued) => new Date(base.getTime() + offsetHours * H);

describe('deadlines', () => {
  it('ack deadline = issued + ack SLA', () => expect(ackDeadline(issued, pack)).toEqual(at(24)));
  it('evaluation deadline = issued + eval target days', () => expect(evaluationDeadline(issued, pack)).toEqual(at(7 * 24)));
  it('barrier deadline = now + contact SLA', () => {
    const now = new Date('2026-11-19T10:00:00Z');
    expect(barrierDeadline(now, pack)).toEqual(new Date(now.getTime() + 12 * H));
  });
});

describe('deriveStatus', () => {
  const due = at(24);
  const s = (stage: Parameters<typeof deriveStatus>[0]['stage'], hasAcknowledged: boolean, now: Date) =>
    deriveStatus({ stage, hasAcknowledged, slaDueAt: due }, now);

  it('awaiting ack: handed off, within SLA, not acknowledged', () => {
    expect(s('HANDOFF_SENT', false, at(1))).toBe('AWAITING_ACK');
  });
  it('overdue: unacknowledged past the deadline', () => {
    expect(s('HANDOFF_SENT', false, at(25))).toBe('OVERDUE_SLA');
  });
  it('active: acknowledged and within its deadline', () => {
    expect(s('ACKNOWLEDGED', true, at(1))).toBe('ACTIVE');
    expect(s('ATTENDED', true, at(1))).toBe('ACTIVE');
  });
  it('overdue: acknowledged but the evaluation deadline passed', () => {
    expect(s('ACKNOWLEDGED', true, at(48))).toBe('OVERDUE_SLA');
  });
  it('a deadline exactly equal to now is NOT overdue; one millisecond later is', () => {
    expect(s('HANDOFF_SENT', false, due)).toBe('AWAITING_ACK');
    expect(s('HANDOFF_SENT', false, new Date(due.getTime() + 1))).toBe('OVERDUE_SLA');
  });
  it('escalated is overdue regardless of the clock, acknowledged or not', () => {
    expect(s('ESCALATED', false, at(1))).toBe('OVERDUE_SLA');
    expect(s('ESCALATED', true, at(1))).toBe('OVERDUE_SLA');
  });
  it('closed is closed-verified even long after the deadline', () => {
    expect(s('CLOSED', true, at(10_000))).toBe('CLOSED_VERIFIED');
  });
});

describe('slaHoursRemaining', () => {
  const r = (now: Date, stage: 'HANDOFF_SENT' | 'CLOSED' = 'HANDOFF_SENT') => slaHoursRemaining({ stage, slaDueAt: at(24) }, now);
  it('positive before, negative after, rounded to whole hours', () => {
    expect(r(at(6))).toBe(18);
    expect(r(at(38))).toBe(-14);
    expect(r(new Date(at(6).getTime() + 20 * 60_000))).toBe(18); // 17h40m → 18
  });
  it('is 0 at the deadline (never -0) and for closed cases', () => {
    expect(Object.is(r(at(24)), 0)).toBe(true);
    expect(Object.is(r(new Date(at(24).getTime() + 10 * 60_000)), 0)).toBe(true); // -10min rounds to -0 → 0
    expect(r(at(500), 'CLOSED')).toBe(0);
  });
});
