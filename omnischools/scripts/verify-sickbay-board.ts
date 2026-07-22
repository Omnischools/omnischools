import "./_dev-matron"; // MUST be first — pins the dev shim to MATRON before lib/env parses
import "@/db/_loadenv";
import { and, eq, inArray, isNull, like } from "drizzle-orm";
import { db } from "@/lib/db";
import { withSchool } from "@/lib/db/rls";
import { beginVisit, createVisit } from "@/lib/actions/sickbay-visit";
import { getSickbayConfig } from "@/lib/sickbay/config";
import { getSickbayBoard } from "@/lib/sickbay/board-reads";
import { openAdmissionBeds } from "@/lib/sickbay/visit-reads";
import { BOARD_ROW_KEYS } from "@/lib/sickbay/board-copy";
import {
  auditLog,
  schools,
  sickbayAdmission,
  sickbayVisit,
  sickbayVitalReading,
  students,
} from "@/db/schema";

/**
 * DB-backed proof of the INCR-22c invariants no unit test can show (AC B1–B6 · G1–G5 · Q · L).
 *
 *   B4 🔴 THE HEADLINE — an admitted student carries `working_impression = 'ZZTOKENIMP'` and a
 *        queued student carries `presenting_complaint = 'ZZTOKENCOMP'`. Served to a MATRON,
 *        `ZZTOKENCOMP` occurs EXACTLY ONCE in the board's HTML and `ZZTOKENIMP` ZERO times anywhere
 *        — including the flight payload — with the VISIT RECORD as the positive control (it must
 *        contain `ZZTOKENIMP`, or the negative is vacuous).
 *   G2 🔴 an ADMIN reader issues NO SQL AT ALL. `db.transaction` is counted, not inspected.
 *   B1    round trips are O(1): the same count with 1 queued visit and with 30.
 *   B3    the runtime key-set pin — `Object.keys(row).sort()` against the frozen lists.
 *
 * Run after `pnpm db:seed` + `pnpm db:seed-sickbay`. Every row it creates is deleted at the end,
 * scoped to the marker it wrote — nothing else is touched.
 *
 * The served-HTML half needs a running app whose session role is the one being asserted:
 *
 *   AUTH_DEV_ROLES=MATRON pnpm dev   → SERVED_ROLE=MATRON pnpm db:verify-sickbay-board
 *   AUTH_DEV_ROLES=ADMIN  pnpm dev   → SERVED_ROLE=ADMIN  pnpm db:verify-sickbay-board
 *
 * With `SERVED_ROLE` unset the DB half still runs and the HTTP checks are reported as SKIPPED —
 * they are never silently counted as passes.
 */
let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

const MARKER = "ZZ-VERIFY-22C";
const TOKEN_COMPLAINT = "ZZTOKENCOMP";
const TOKEN_IMPRESSION = "ZZTOKENIMP";
const BASE = process.env.BOARD_BASE_URL ?? "http://localhost:3000";
const SERVED_ROLE = process.env.SERVED_ROLE ?? "";

/** Count DB round trips through the ONE seam every tenant read goes through (lib/db/rls.ts). */
async function countRoundTrips<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; trips: number }> {
  const real = db.transaction.bind(db);
  let trips = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db as any).transaction = (...args: unknown[]) => {
    trips++;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (real as any)(...args);
  };
  try {
    return { result: await fn(), trips };
  } finally {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).transaction = real;
  }
}

const keysOf = (o: object) => Object.keys(o).sort();
const sameKeys = (o: object, frozen: readonly string[]) =>
  JSON.stringify(keysOf(o)) === JSON.stringify([...frozen].sort());

async function main() {
  const [school] = await db
    .select({ id: schools.id })
    .from(schools)
    .where(eq(schools.gesCode, "WR-WAW-014"));
  if (!school) throw new Error("seed the demo school first (pnpm db:seed)");

  const config = await getSickbayConfig(school.id);
  const occupied = new Set((await openAdmissionBeds(school.id)).map((o) => o.bedId));
  const freeBed = config.beds.find(
    (b) => b.active && !b.isIsolation && !occupied.has(b.id),
  );
  check("a free general bed exists to admit into", !!freeBed);
  if (!freeBed) return finish();

  // Students with NO open visit — `uniq_sickbay_open_visit_student` refuses a second one (R58).
  const roster = await db
    .select({ id: students.id, code: students.studentCode })
    .from(students)
    .where(and(eq(students.schoolId, school.id), eq(students.status, "ACTIVE")))
    .limit(40);
  const openVisits = await db
    .select({ studentId: sickbayVisit.studentId })
    .from(sickbayVisit)
    .where(
      and(
        eq(sickbayVisit.schoolId, school.id),
        isNull(sickbayVisit.disposition),
        isNull(sickbayVisit.voidedAt),
      ),
    );
  const admitted = await db
    .select({ studentId: sickbayAdmission.studentId })
    .from(sickbayAdmission)
    .where(
      and(
        eq(sickbayAdmission.schoolId, school.id),
        isNull(sickbayAdmission.dischargedAt),
      ),
    );
  const busy = new Set([...openVisits, ...admitted].map((v) => v.studentId));
  const pool = roster.filter((s) => !busy.has(s.id));
  check("enough active students for the fixture", pool.length >= 34, `${pool.length}`);
  if (pool.length < 34) return finish();

  const now = new Date();

  // ── the fixture: one QUEUED student with a token complaint, one ADMITTED with a token impression
  const queuedId = await withSchool(school.id, async (tx) => {
    const [row] = await tx
      .insert(sickbayVisit)
      .values({
        schoolId: school.id,
        studentId: pool[0].id,
        presentedAt: new Date(now.getTime() - 7 * 60_000),
        presentingComplaint: `${TOKEN_COMPLAINT} ${MARKER}`,
      })
      .returning({ id: sickbayVisit.id });
    return row.id;
  });

  const { admissionId, admittedVisitId } = await withSchool(school.id, async (tx) => {
    const at = new Date(now.getTime() - 5 * 3600_000);
    const [visit] = await tx
      .insert(sickbayVisit)
      .values({
        schoolId: school.id,
        studentId: pool[1].id,
        presentedAt: at,
        presentingComplaint: `${MARKER} admitted fixture`,
        startedAt: at,
        // The token the board must NEVER print, in the column R87 removed from the reader.
        workingImpression: TOKEN_IMPRESSION,
        hydrationStatus: `${TOKEN_IMPRESSION} hydration`,
        plan: `${TOKEN_IMPRESSION} plan`,
        disposition: "ADMIT",
        dispositionAt: at,
      })
      .returning({ id: sickbayVisit.id });
    const [adm] = await tx
      .insert(sickbayAdmission)
      .values({
        schoolId: school.id,
        visitId: visit.id,
        studentId: pool[1].id,
        bedId: freeBed.id,
        admittedAt: at,
        isIsolation: false,
        expectedDischargeAt: new Date(now.getTime() - 30 * 60_000), // already passed → overdue
        overnightPlan: `${MARKER} overnight`,
      })
      .returning({ id: sickbayAdmission.id });
    await tx.insert(sickbayVitalReading).values([
      {
        schoolId: school.id,
        visitId: visit.id,
        takenAt: at,
        tempC: "37.8",
        pulseBpm: 96,
        painScore: 7,
      },
      {
        schoolId: school.id,
        visitId: visit.id,
        takenAt: new Date(now.getTime() - 90 * 60_000),
        tempC: "37.1",
        systolic: 108,
        diastolic: 68,
        pulseBpm: 88,
        spo2Pct: 98,
        painScore: 4,
      },
    ]);
    return { admissionId: adm.id, admittedVisitId: visit.id };
  });

  // ── G1/G2 · the ADMIN reader: null, and NOT ONE query issued ─────────────────────────────────
  const admin = await countRoundTrips(() => getSickbayBoard(school.id, ["ADMIN"], now));
  check(
    "G1 an ADMIN gets null from the board reader (→ ClinicalRestricted, not a 404)",
    admin.result === null,
  );
  check(
    "🔴 G2 an ADMIN reader issues NO SQL AT ALL",
    admin.trips === 0,
    `${admin.trips} round trips`,
  );
  const hm = await countRoundTrips(() => getSickbayBoard(school.id, ["HEADMASTER"], now));
  check(
    "G1 the gate is not vacuous — a HEADMASTER DOES get a board",
    hm.result !== null,
    `${hm.trips} round trips`,
  );
  check(
    "G3 an unknown/empty role set gets null too",
    (await getSickbayBoard(school.id, [], now)) === null,
  );

  // ── B1 · O(1) round trips, flat as the queue grows ───────────────────────────────────────────
  const small = await countRoundTrips(() => getSickbayBoard(school.id, ["MATRON"], now));
  check("B1 the whole board costs ≤ 6 round trips", small.trips <= 6, `${small.trips}`);
  const board = small.result!;

  const extra = await withSchool(school.id, async (tx) =>
    tx
      .insert(sickbayVisit)
      .values(
        pool.slice(2, 32).map((s, i) => ({
          schoolId: school.id,
          studentId: s.id,
          presentedAt: new Date(now.getTime() - (10 + i) * 60_000),
          presentingComplaint: `${MARKER} load ${i}`,
        })),
      )
      .returning({ id: sickbayVisit.id }),
  );
  const big = await countRoundTrips(() => getSickbayBoard(school.id, ["MATRON"], now));
  check(
    "🔴 B1 the round-trip count is FLAT as the queue grows to 30+",
    big.trips === small.trips && big.result!.queue.length >= 31,
    `${small.trips} → ${big.trips} trips, ${big.result!.queue.length} queued`,
  );
  check(
    "B2 the reader never calls getVisitRecord (no N×9 per-row fetch)",
    big.trips <= 6,
    `${big.trips} trips for ${big.result!.queue.length} rows`,
  );

  // ── B3 · the runtime key-set pin, over REAL rows ─────────────────────────────────────────────
  const q = board.queue.find((r) => r.visitId === queuedId);
  const w = board.ward.find((r) => r.admissionId === admissionId);
  const bedTile = board.bedTiles.find((b) => b.bedNumber === freeBed.bedNumber);
  const rec = board.recent.find((r) => r.visitId === admittedVisitId);
  check("B3 fixture rows are all present on the board", !!q && !!w && !!bedTile && !!rec);
  if (!q || !w || !bedTile || !rec) return finish();

  check(
    "B3 SickbayQueueRow key set is EXACTLY the frozen list",
    sameKeys(q, BOARD_ROW_KEYS.queue),
    keysOf(q).join(","),
  );
  check(
    "B3 SickbayWardPatient key set is EXACTLY the frozen list",
    sameKeys(w, BOARD_ROW_KEYS.ward),
    keysOf(w).join(","),
  );
  check(
    "B3 SickbayBedTile key set is EXACTLY the frozen list",
    sameKeys(bedTile, BOARD_ROW_KEYS.bed),
    keysOf(bedTile).join(","),
  );
  check(
    "B3 SickbayRecentVisitRow key set is EXACTLY the frozen list",
    sameKeys(rec, BOARD_ROW_KEYS.recent),
    keysOf(rec).join(","),
  );
  check(
    "B3 the nested latestVital key set is EXACTLY the frozen list",
    !!w.latestVital && sameKeys(w.latestVital, BOARD_ROW_KEYS.latestVital),
  );
  check(
    "B3 the nested bed occupant key set is EXACTLY the frozen list",
    !!bedTile.occupant && sameKeys(bedTile.occupant, BOARD_ROW_KEYS.bedOccupant),
  );

  // ── B5/B6 · the payload itself carries no clinical assertion but the queue complaint ─────────
  const payload = JSON.stringify(board);
  check(
    "🔴 B6 the token impression is NOWHERE in the board payload",
    !payload.includes(TOKEN_IMPRESSION),
  );
  check(
    "B5 the token complaint IS in the payload, exactly once (the queue's A6 exception)",
    (payload.match(new RegExp(TOKEN_COMPLAINT, "g")) ?? []).length === 1,
  );
  check(
    "B6 the ward row carries the vitals grid and the bed, and nothing narrative",
    w.latestVital !== null && w.bedNumber === freeBed.bedNumber && !("plan" in w),
  );

  // ── A-block · the overdue branch, derived from the pinned instant ────────────────────────────
  check(
    "A-block the expected-discharge stamp survived to the ward row",
    w.expectedDischargeAt !== null,
  );
  check(
    "A-block it is in the PAST, so the page renders `reassessment overdue`",
    w.expectedDischargeAt!.getTime() < now.getTime(),
  );
  check(
    "A-block the pain trend has a first reading to compare against",
    w.firstPainScore === 7,
  );
  check("A-block the LATEST reading wins in the grid", w.latestVital!.painScore === 4);

  // ── B4 / G1 · SERVED HTML. It runs HERE, before the mutations below empty the queue: the token
  //    complaint only renders while its visit is still waiting, and a check that can only pass on a
  //    row that no longer exists is not a check. ────────────────────────────────────────────────
  await servedHtmlChecks({ admittedVisitId, wardStudentCode: w.studentCode });

  // ── N · counters: the partition invariant, and voided rows in NO counter ─────────────────────
  const t = big.result!.counts.today;
  check(
    "🔴 N the tile-3 terms SUM to the total",
    t.discharged + t.admitted + t.referred + t.awaiting === t.total,
    `${t.discharged}+${t.admitted}+${t.referred}+${t.awaiting} = ${t.total}`,
  );
  check(
    "N `Visits today` INCLUDES the students still standing in the queue",
    t.awaiting >= 31,
  );
  check(
    "N the bed board's total is the ACTIVE bed count",
    big.result!.counts.bedsTotal === config.bedCounts.total,
  );

  await withSchool(school.id, async (tx) => {
    await tx
      .update(sickbayVisit)
      .set({ voidedAt: new Date(), voidReason: MARKER })
      .where(and(eq(sickbayVisit.schoolId, school.id), eq(sickbayVisit.id, extra[0].id)));
  });
  const afterVoid = (await getSickbayBoard(school.id, ["MATRON"], now))!;
  check(
    "🔴 R78 a voided visit leaves the queue, §03 AND every counter",
    !afterVoid.queue.some((r) => r.visitId === extra[0].id) &&
      !afterVoid.recent.some((r) => r.visitId === extra[0].id) &&
      afterVoid.counts.today.total === t.total - 1,
  );

  // ── Q · `Begin visit` is a WRITE then a nav — R33's wait clock stops ─────────────────────────
  const begun = await beginVisit({ visitId: queuedId });
  check(
    "Q `Begin visit` writes through the real MATRON-gated action",
    begun.ok,
    begun.error ?? "",
  );
  const afterBegin = (await getSickbayBoard(school.id, ["MATRON"], now))!;
  check(
    "🔴 Q the begun visit LEAVES the queue (the wait clock stopped, R33)",
    !afterBegin.queue.some((r) => r.visitId === queuedId),
  );
  check(
    "Q …and it is still on §03 with the neutral `Open` state — it vanishes from nowhere",
    afterBegin.recent.some((r) => r.visitId === queuedId && r.disposition === null),
  );
  if (SERVED_ROLE === "MATRON") {
    // The round trip closed through the SERVED page, not just the reader: the row the matron
    // clicked is gone from the re-rendered board, and the token complaint went with it.
    const reloaded = await (await fetch(`${BASE}/senior/sickbay/today`)).text();
    check(
      "🔴 Q the SERVED board drops the begun row from the queue — the complaint goes with it",
      !reloaded.includes(TOKEN_COMPLAINT),
    );
    check(
      "Q …and the visit is still THERE, in §03 as `Open` — it moved, it did not vanish",
      reloaded.includes(queuedId),
    );
  }

  // ── L9 · the R75b enriched collision error ───────────────────────────────────────────────────
  // …against the student whose visit is STILL OPEN (the one just begun). The admitted student's
  // visit is closed as ADMIT, so `uniq_sickbay_open_visit_student` correctly does not fire for her.
  const collision = await createVisit({
    studentId: pool[0].id,
    presentingComplaint: `${MARKER} second open visit`,
  });
  check(
    "L9 a second open visit is refused",
    !collision.ok,
    collision.error ?? "(it COMMITTED)",
  );
  check(
    "🔴 L9 the refusal NAMES THE DAY and returns the blocking visit to link",
    (collision.error ?? "").startsWith(
      "This student already has an open sickbay visit",
    ) &&
      (collision.error ?? "").includes("opened ") &&
      collision.id === queuedId,
    collision.error ?? "",
  );

  // ── cleanup — MARKER-SCOPED, never a broad `where schoolId` (repo memory) ────────────────────
  const mine = await db
    .select({ id: sickbayVisit.id })
    .from(sickbayVisit)
    .where(
      and(
        eq(sickbayVisit.schoolId, school.id),
        like(sickbayVisit.presentingComplaint, `%${MARKER}%`),
      ),
    );
  await withSchool(school.id, async (tx) => {
    if (mine.length) {
      // admissions / vitals cascade with the visit (composite FK ON DELETE CASCADE).
      await tx.delete(sickbayVisit).where(
        inArray(
          sickbayVisit.id,
          mine.map((r) => r.id),
        ),
      );
    }
    await tx
      .delete(auditLog)
      .where(
        and(
          eq(auditLog.schoolId, school.id),
          inArray(auditLog.entityId, [queuedId, admittedVisitId]),
        ),
      );
  });
  const left = await db
    .select({ id: sickbayVisit.id })
    .from(sickbayVisit)
    .where(
      and(
        eq(sickbayVisit.schoolId, school.id),
        like(sickbayVisit.presentingComplaint, `%${MARKER}%`),
      ),
    );
  check(
    `cleanup removed only this script's ${mine.length} marker rows`,
    left.length === 0,
  );
  const boardAfter = (await getSickbayBoard(school.id, ["MATRON"], new Date()))!;
  check(
    "the dev DB is back in seed state (no fixture left on the board)",
    !boardAfter.ward.some((r) => r.admissionId === admissionId),
  );

  finish();
}

/**
 * 🔴 B4 / G1 — the served HTML, with the VISIT RECORD as the positive control. Two negatives are
 * asserted (`ZZTOKENIMP` absent for a MATRON, everything absent for an ADMIN) and each is paired
 * with a positive that proves the page rendered at all: a negative you cannot distinguish from an
 * empty page is not evidence. `fetch` returns the streamed document INCLUDING the RSC flight
 * payload, so a prop that was trimmed only in the JSX would still be caught here.
 */
async function servedHtmlChecks(fx: {
  admittedVisitId: string;
  wardStudentCode: string;
}) {
  if (!SERVED_ROLE) {
    console.log(
      "• SKIPPED (no SERVED_ROLE): the served-HTML checks B4 / G1 need a running app",
    );
    return;
  }
  const get = async (path: string) => {
    const res = await fetch(`${BASE}${path}`, {
      headers: { "cache-control": "no-cache" },
    });
    return { status: res.status, html: await res.text() };
  };
  const boardPage = await get("/senior/sickbay/today");
  const count = (h: string, t: string) => (h.match(new RegExp(t, "g")) ?? []).length;
  /**
   * A streamed RSC document carries each datum in BOTH channels — the rendered markup and the
   * flight payload that hydrates it — and the payload is chunked and escaped, so counting
   * occurrences across the concatenation measures the transport, not the board. "EXACTLY ONCE" is
   * therefore asserted on the two places where it is a statement about this increment: the rendered
   * MARKUP here, and the reader's own payload above (B5, `JSON.stringify(board)`). Every ABSENCE
   * check runs over the WHOLE document, chunking included — that is the strong direction and the
   * one that matters.
   */
  const markup = (h: string) => h.replace(/<script[\s\S]*?<\/script>/g, "");

  check(
    `HTTP the board renders 200 for ${SERVED_ROLE}`,
    boardPage.status === 200,
    `${boardPage.status}`,
  );

  if (SERVED_ROLE === "MATRON") {
    const record = await get(`/senior/sickbay/visits/${fx.admittedVisitId}`);
    check(
      "🔴 B4 `ZZTOKENCOMP` occurs EXACTLY ONCE in the served board's markup",
      count(markup(boardPage.html), TOKEN_COMPLAINT) === 1,
      `${count(markup(boardPage.html), TOKEN_COMPLAINT)}×`,
    );
    check(
      "B4 …and it is the QUEUE that carries it — §03's rows print no complaint at all (R76)",
      count(markup(boardPage.html).split("chronological")[1] ?? "", TOKEN_COMPLAINT) ===
        0,
    );
    check(
      "🔴 B4 `ZZTOKENIMP` occurs ZERO times anywhere in the served board (incl. the payload)",
      count(boardPage.html, TOKEN_IMPRESSION) === 0,
      `${count(boardPage.html, TOKEN_IMPRESSION)}×`,
    );
    check(
      "🔴 B4 POSITIVE CONTROL — the visit record DOES serve `ZZTOKENIMP`",
      count(record.html, TOKEN_IMPRESSION) > 0,
      `${count(record.html, TOKEN_IMPRESSION)}×`,
    );
    check(
      "B4 …and the admitted patient's own block IS on the board (so the negative is not vacuous)",
      boardPage.html.includes(fx.wardStudentCode) && boardPage.html.includes("on bed"),
    );
    check(
      "B4 the bed board and the 24h log both rendered",
      boardPage.html.includes("Beds ·") && boardPage.html.includes("chronological"),
    );
    check(
      "R90 the h1 does not carry the surface's wrong weekday",
      !boardPage.html.includes("Wed 14 May 2026"),
    );
  }

  if (SERVED_ROLE === "ADMIN") {
    check(
      "🔴 G1 an ADMIN gets the restriction panel, not a 404 and not a redirect",
      boardPage.html.includes("Clinical detail is") && boardPage.status === 200,
    );
    // React separates adjacent JSX text nodes with `<!-- -->`, so the crumb is only contiguous once
    // those are removed — matching the raw stream would fail on a page that renders correctly.
    const text = boardPage.html.replace(/<!-- -->/g, "");
    check(
      "G1 the crumb reads `Sickbay · Today` and keeps its setup link",
      text.includes(">Sickbay</a> · Today<") &&
        text.includes('href="/senior/sickbay/setup"'),
    );
    for (const t of [
      TOKEN_COMPLAINT,
      TOKEN_IMPRESSION,
      "Bed 0",
      "min wait",
      "on the ward",
      "on bed",
    ]) {
      check(`🔴 G1 the ADMIN page carries NO ${t}`, count(boardPage.html, t) === 0);
    }
  }
}

function finish(): never {
  console.log(
    failures === 0
      ? "\nAll sickbay board checks passed."
      : `\n${failures} check(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
