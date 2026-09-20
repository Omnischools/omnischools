/**
 * Dev-only clock shim: start the process a fixed number of milliseconds before the next **UTC
 * midnight**, so a run that normally takes ~8s straddles the civil-date rollover.
 *
 * It exists to reproduce ONE defect on demand: `scripts/verify-sickbay-attendance.ts` pins
 * `today = civilDate(new Date())` at module load, while the server actions it drives compute their
 * own `civilDate(new Date())` at call time. A run that crosses UTC midnight therefore writes the
 * admission against one civil day and asserts the register save against the next — a red that is a
 * harness artefact, not a product defect. Dex's INCR-22b review saw it once in 14 runs, at ~01:00
 * BST (= 00:00 UTC).
 *
 * MUST be imported before anything that reads the clock. Opt-in and inert unless
 * `ROLLOVER_LEAD_MS` is set, so no normal run is affected. Postgres' own `now()` is NOT shifted —
 * that is fine and deliberate: every value this defect turns on is computed in JS.
 */
const lead = Number(process.env.ROLLOVER_LEAD_MS ?? 0);

if (lead > 0) {
  const Real = Date;
  const real = Real.now();
  const d = new Real(real);
  const nextUtcMidnight = Real.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  const shift = nextUtcMidnight - lead - real;

  class ShiftedDate extends Real {
    constructor(...args: ConstructorParameters<typeof Real> | []) {
      if (args.length === 0) super(Real.now() + shift);
      else super(...(args as ConstructorParameters<typeof Real>));
    }
    static now(): number {
      return Real.now() + shift;
    }
  }
  globalThis.Date = ShiftedDate as DateConstructor;
  console.log(
    `⏱  fake clock: now = ${new Date().toISOString()} (${lead}ms before the UTC rollover)`,
  );
}
