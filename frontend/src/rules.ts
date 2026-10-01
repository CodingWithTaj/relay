/** The incident rule, shared by the demo simulator and the explainer on the landing page.
 *  It mirrors relay/engine.py: an incident opens after `failAfter` failures in a row,
 *  dated from the first of them, and closes after `recoverAfter` successes in a row. */
export const FAIL_AFTER = 3;
export const RECOVER_AFTER = 2;

export interface Span { start: number; detected: number; end: number | null }

export function incidentsFrom(checks: boolean[], failAfter = FAIL_AFTER, recoverAfter = RECOVER_AFTER): Span[] {
  const spans: Span[] = [];
  let fails = 0, oks = 0, failingSince = -1, open: Span | null = null;
  checks.forEach((ok, i) => {
    if (ok) {
      fails = 0; failingSince = -1; oks++;
      if (open && oks >= recoverAfter) { open.end = i; open = null; }
    } else {
      oks = 0; fails++;
      if (failingSince < 0) failingSince = i;
      if (!open && fails >= failAfter) { open = { start: failingSince, detected: i, end: null }; spans.push(open); }
    }
  });
  return spans;
}
