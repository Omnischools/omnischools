import { afterEach, describe, expect, it } from "vitest";
import { adminAnalytics, nationalOfficer } from "./helpers";
import { scopeFor } from "@/lib/db/rls";
import { formatAsOf, getLatestSuccessfulEtlRun } from "@/lib/oversight/etl-status";

/**
 * THE AS-OF BANNER (scope §8 slice exit: "the as-of banner shows a real timestamp instead of `—`";
 * task H20).
 *
 * `app/(oversight)/page.tsx` renders `formatAsOf(await getLatestSuccessfulEtlRun(...))` into the
 * "Data as of" card, and until this file existed that pair was the one part of the slice with no
 * executed check at all — a slice exit criterion asserted only by reading the code.
 *
 * The three behaviours below are the whole contract, and each of them is a way for a government
 * dashboard to lie about its own vintage:
 *   · NO SUCCESSFUL RUN YET → null, rendered as a sentence, not a dash. A dash could equally mean
 *     zero, loading, or broken.
 *   · RUNNING and FAILED ARE INVISIBLE. A FAILED run wrote nothing, so the numbers on screen are the
 *     PREVIOUS successful run's; dating them to tonight would misdate the data on the one night the
 *     pipeline broke — the night it matters.
 *   · THE LATEST SUCCESS WINS, by `finished_at`, not by insertion order.
 *
 * `etl_run` carries no jurisdiction (db/sql/policies.sql's "no jurisdiction column" list), so the
 * read is tier-independent; it still goes through `withJurisdiction()` because that is the app's only
 * sanctioned read path.
 */

const scope = scopeFor(nationalOfficer);

afterEach(async () => {
  const admin = adminAnalytics();
  try {
    await admin`delete from etl_run`;
  } finally {
    await admin.end({ timeout: 5 });
  }
});

describe("getLatestSuccessfulEtlRun", () => {
  it("returns null when no run has ever succeeded, and the banner says so in words", async () => {
    expect(await getLatestSuccessfulEtlRun(scope)).toBeNull();
    expect(formatAsOf(null)).toBe("No successful run yet");
  });

  it("ignores RUNNING and FAILED runs entirely", async () => {
    const admin = adminAnalytics();
    try {
      await admin`insert into etl_run (status) values ('RUNNING')`;
      await admin`insert into etl_run (status, finished_at, error_text)
                  values ('FAILED', now(), 'upstream timeout')`;
    } finally {
      await admin.end({ timeout: 5 });
    }
    expect(await getLatestSuccessfulEtlRun(scope)).toBeNull();
  });

  it("returns the latest SUCCESS by finished_at, and formats a real timestamp", async () => {
    const admin = adminAnalytics();
    let newerId: string;
    try {
      // Inserted NEWEST FIRST, so a query that ordered by insertion would pick the wrong one.
      const newer = await admin<{ run_id: string }[]>`
        insert into etl_run (status, finished_at) values ('SUCCESS', now())
        returning run_id::text as run_id`;
      await admin`insert into etl_run (status, finished_at)
                  values ('SUCCESS', now() - interval '2 days')`;
      await admin`insert into etl_run (status) values ('RUNNING')`;
      newerId = newer[0]!.run_id;
    } finally {
      await admin.end({ timeout: 5 });
    }

    const latest = await getLatestSuccessfulEtlRun(scope);
    expect(latest).not.toBeNull();
    expect(latest!.runId).toBe(newerId);
    expect(latest!.finishedAt).toBeInstanceOf(Date);

    const label = formatAsOf(latest);
    expect(label).not.toBe("No successful run yet");
    // "03 Oct 2026, 23:41" — a date AND a time, in Accra time. The banner prints a vintage, and a
    // date alone cannot distinguish last night's run from one that has not happened yet today.
    expect(label).toMatch(/^\d{2} \w{3} \d{4}, \d{2}:\d{2}$/);
  });
});
