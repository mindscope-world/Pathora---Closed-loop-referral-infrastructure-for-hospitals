/**
 * The current time, as the messaging rules see it. Production uses the real clock. Tests replace it so rules
 * that depend on the time of day (quiet hours) behave the same whenever the suite runs.
 */
let source: () => Date = () => new Date();
export const clock = (): Date => source();
export function setClock(fn: (() => Date) | undefined) {
  source = fn ?? (() => new Date());
}
