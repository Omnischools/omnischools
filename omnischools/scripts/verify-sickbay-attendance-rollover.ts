import "./_fake-clock"; // MUST be first — shifts the clock before any module reads it
import "./verify-sickbay-attendance";

/**
 * `ROLLOVER_LEAD_MS=5000 pnpm db:verify-sickbay-attendance-rollover` — the attendance proof run so
 * that UTC midnight lands 5s into it. Used to reproduce (and then to keep out) the once-in-14-runs
 * red Dex reported on INCR-22b. See `scripts/_fake-clock.ts`.
 */
