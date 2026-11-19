import { describe, expect, it } from 'vitest';
import { BOUNDS, describeChanges, parseRedFlagPolicy, redFlagPolicySchema, rulePackKey, timerProblem, updateRulePackSchema, type PackFields } from './rules';

const base: PackFields = {
  ackSlaHours: 24, contactSlaHours: 12, evalTargetDays: 7, redFlagRule: 'Escalate if unacknowledged > 24h', redFlagPolicy: { unacknowledgedHours: 24 },
  closureCriteria: 'Specialist evaluation documented', clinicalOwnerId: 'u1', status: 'ACTIVE',
};

describe('update schema bounds', () => {
  const ok = (v: object) => updateRulePackSchema.safeParse(v).success;
  it('accepts values at the limits and rejects values outside them', () => {
    expect(ok({ ackSlaHours: BOUNDS.ackSlaHours.min })).toBe(true);
    expect(ok({ ackSlaHours: BOUNDS.ackSlaHours.max })).toBe(true);
    expect(ok({ ackSlaHours: 0 })).toBe(false);
    expect(ok({ ackSlaHours: BOUNDS.ackSlaHours.max + 1 })).toBe(false);
    expect(ok({ contactSlaHours: 0 })).toBe(false);
    expect(ok({ evalTargetDays: BOUNDS.evalTargetDays.max })).toBe(true);
    expect(ok({ evalTargetDays: BOUNDS.evalTargetDays.max + 1 })).toBe(false);
    expect(ok({ evalTargetDays: 0 })).toBe(false);
  });
  it('rejects non-integers, text and negatives (the UI used to coerce these silently)', () => {
    for (const bad of [4.5, '24', -3, Number.NaN, null]) expect(ok({ ackSlaHours: bad }), String(bad)).toBe(false);
  });
  it('requires something to change, but does not count expectedVersion as a change', () => {
    expect(ok({})).toBe(false);
    expect(ok({ expectedVersion: 3 })).toBe(false);
    expect(ok({ ackSlaHours: 12, expectedVersion: 3 })).toBe(true);
  });
  it('rejects control characters and absurd lengths in wording', () => {
    expect(ok({ redFlagRule: 'ok text' })).toBe(true);
    expect(ok({ redFlagRule: 'two\nlines' })).toBe(false);
    expect(ok({ closureCriteria: 'x'.repeat(501) })).toBe(false);
    expect(ok({ redFlagRule: 'ab' })).toBe(false);
  });
  it('validates the red-flag timer, allowing "no timer"', () => {
    expect(redFlagPolicySchema.safeParse({ unacknowledgedHours: null }).success).toBe(true);
    expect(redFlagPolicySchema.safeParse({ unacknowledgedHours: 4 }).success).toBe(true);
    for (const bad of [0, 169, 1.5, '4', undefined]) expect(redFlagPolicySchema.safeParse({ unacknowledgedHours: bad }).success, String(bad)).toBe(false);
  });
  it('limits status to the known values', () => {
    expect(ok({ status: 'CONFIGURED' })).toBe(true);
    expect(ok({ status: 'LIVE' })).toBe(false);
  });
});

describe('rule pack keys', () => {
  it('accepts RP-… keys only', () => {
    for (const k of ['RP-CANCER', 'RP-NCD', 'RP-MCH-2']) expect(rulePackKey.safeParse(k).success, k).toBe(true);
    for (const k of ['cancer', 'RP-', 'RP-cancer', '../x', 'RP-' + 'A'.repeat(40), '']) expect(rulePackKey.safeParse(k).success, k).toBe(false);
  });
});

describe('timerProblem: a pack’s own timers must make sense together', () => {
  it('accepts the shipped defaults', () => {
    expect(timerProblem(base)).toBeNull();
    expect(timerProblem({ ...base, ackSlaHours: 48, contactSlaHours: 24, evalTargetDays: 10, redFlagPolicy: { unacknowledgedHours: 4 } })).toBeNull();
    expect(timerProblem({ ...base, redFlagPolicy: { unacknowledgedHours: null } })).toBeNull();
  });
  it('the contact window cannot exceed the acknowledgment window', () => {
    expect(timerProblem({ ...base, contactSlaHours: 25 })).toMatchObject({ field: 'contactSlaHours' });
    expect(timerProblem({ ...base, contactSlaHours: 24 })).toBeNull(); // equal is allowed
  });
  it('the evaluation target must fall after the acknowledgment deadline', () => {
    expect(timerProblem({ ...base, ackSlaHours: 48, contactSlaHours: 12, evalTargetDays: 2 })).toMatchObject({ field: 'evalTargetDays' }); // 48h == 48h
    expect(timerProblem({ ...base, ackSlaHours: 48, contactSlaHours: 12, evalTargetDays: 3 })).toBeNull();
  });
  it('the red-flag timer cannot be longer than the evaluation target', () => {
    expect(timerProblem({ ...base, evalTargetDays: 1, ackSlaHours: 12, contactSlaHours: 6, redFlagPolicy: { unacknowledgedHours: 25 } })).toMatchObject({ field: 'redFlagPolicy' });
  });
});

describe('parseRedFlagPolicy', () => {
  it('reads valid policies', () => {
    expect(parseRedFlagPolicy({ unacknowledgedHours: 24 })).toEqual({ unacknowledgedHours: 24 });
    expect(parseRedFlagPolicy({ unacknowledgedHours: null })).toEqual({ unacknowledgedHours: null });
  });
  it('treats anything malformed as "no timer" rather than throwing (the monitor must never crash on bad data)', () => {
    for (const bad of [null, undefined, 'x', 5, [], {}, { unacknowledgedHours: 'soon' }, { unacknowledgedHours: -1 }, { unacknowledgedHours: 1e9 }]) {
      expect(parseRedFlagPolicy(bad), JSON.stringify(bad)).toEqual({ unacknowledgedHours: null });
    }
  });
});

describe('describeChanges', () => {
  const names = new Map([['u1', 'Dr. One'], ['u2', 'Dr. Two']]);
  it('is empty when nothing changed', () => {
    expect(describeChanges(base, { ...base, redFlagPolicy: { unacknowledgedHours: 24 } }, names)).toEqual([]);
  });
  it('lists each change as before → after, with names for owners and "none" for no timer', () => {
    const after: PackFields = { ...base, ackSlaHours: 12, status: 'CONFIGURED', clinicalOwnerId: 'u2', redFlagPolicy: { unacknowledgedHours: null } };
    expect(describeChanges(base, after, names)).toEqual([
      'ackSlaHours: 24 → 12',
      'redFlagTimerHours: 24 → none',
      'clinicalOwner: Dr. One → Dr. Two',
      'status: "ACTIVE" → "CONFIGURED"',
    ]);
  });
});
