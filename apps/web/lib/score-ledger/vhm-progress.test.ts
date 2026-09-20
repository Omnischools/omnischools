import { describe, it, expect } from "vitest";
import { computeVhmTier, rollupBySubject, type VhmProgressRow } from "./vhm-progress";

const filled = (
  asgn: number,
  midSem: number,
  endSem: number,
  project: number,
  portfolio: number,
) => ({ asgn, midSem, endSem, project, portfolio });

describe("computeVhmTier — the STPSHS n/5 tier (completion, never scores)", () => {
  const roster = 37;

  it("all five categories entered by every student → Ready 5/5", () => {
    expect(computeVhmTier(filled(37, 37, 37, 37, 37), roster)).toEqual({
      categoriesDone: 5,
      status: "ready",
    });
  });

  it("no category fully entered → At risk 0/5 (the never-started case)", () => {
    expect(computeVhmTier(filled(0, 0, 0, 0, 0), roster)).toEqual({
      categoriesDone: 0,
      status: "at_risk",
    });
  });

  it("four of five categories fully entered → Behind 4/5 (portfolio pending)", () => {
    expect(computeVhmTier(filled(37, 37, 37, 37, 0), roster)).toEqual({
      categoriesDone: 4,
      status: "behind",
    });
  });

  it("a partially-entered category does NOT count toward n (§1.11)", () => {
    // asgn fully in (37), mid-sem only 30 of 37 → mid-sem is 'partial', not done.
    expect(computeVhmTier(filled(37, 30, 0, 0, 0), roster)).toEqual({
      categoriesDone: 1,
      status: "behind",
    });
  });

  it("a category counts only when EVERY student has it, not just some", () => {
    // Every category has 36 of 37 — none is fully done → 0/5, at risk.
    expect(computeVhmTier(filled(36, 36, 36, 36, 36), roster)).toEqual({
      categoriesDone: 0,
      status: "at_risk",
    });
  });

  it("an empty roster is at_risk 0/5, never divides or reads a phantom 'all done'", () => {
    expect(computeVhmTier(filled(0, 0, 0, 0, 0), 0)).toEqual({
      categoriesDone: 0,
      status: "at_risk",
    });
  });
});

// A VhmProgressRow with only the fields rollupBySubject reads set; the rest defaulted (the
// roll-up ignores counts/paths — it reduces status by subject×teacher).
const row = (
  subjectId: string,
  subjectName: string,
  teacherUserId: string | null,
  teacherName: string | null,
  status: VhmProgressRow["status"],
  daysInactive: number | null = null,
  classId = `${subjectId}-${teacherUserId}-${status}-${daysInactive}`,
): VhmProgressRow => ({
  classId,
  className: classId,
  classLevel: null,
  classProgramme: null,
  subjectId,
  subjectName,
  path: "AUTO_COMPILE",
  teacherUserId,
  teacherName,
  rosterSize: 37,
  filled: { asgn: 0, midSem: 0, endSem: 0, project: 0, portfolio: 0 },
  categoriesDone: 0,
  lastActivityAt: null,
  daysInactive,
  status,
  flags: [],
});

describe("rollupBySubject — the §6.4 Headmaster cascade (subject-only, distinct teachers)", () => {
  it("HM64-01 · English across Form 1A/1B/2A is exactly ONE 'English' unit, never split by form", () => {
    const out = rollupBySubject([
      row("eng", "English", "t1", "A. Owusu", "ready", 0, "1A"),
      row("eng", "English", "t1", "A. Owusu", "ready", 0, "1B"),
      row("eng", "English", "t2", "B. Mensah", "ready", 0, "2A"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].subjectId).toBe("eng");
  });

  it("HM64-02/03 · Akoto's 2 classes both behind = ONE not-complete teacher (N counts teachers, not rows)", () => {
    // One subject, one teacher, two class-subject rows both not ready → N=1, X=0, at risk.
    const out = rollupBySubject([
      row("gov", "Government", "akoto", "B. Akoto", "at_risk", 19, "3ArtsA"),
      row("gov", "Government", "akoto", "B. Akoto", "behind", 12, "3ArtsB"),
    ]);
    expect(out[0].teacherTotal).toBe(1); // N — one distinct teacher, not two rows
    expect(out[0].teacherComplete).toBe(0); // X — not complete: not EVERY row is ready
    expect(out[0].bucket).toBe("at_risk");
    // Escalation naming: two classes flagged, most-stale (19d) surfaced.
    expect(out[0].blockers).toEqual([
      { teacherName: "B. Akoto", classesAffected: 2, daysInactive: 19 },
    ]);
  });

  it("HM64-03 · a teacher is complete ONLY when EVERY row they own is ready (one behind ⇒ not complete)", () => {
    const out = rollupBySubject([
      row("bio", "Biology", "t1", "One", "ready", 0, "a"),
      row("bio", "Biology", "t1", "One", "behind", 5, "b"), // same teacher, one class behind
    ]);
    expect(out[0].teacherTotal).toBe(1);
    expect(out[0].teacherComplete).toBe(0);
    expect(out[0].bucket).toBe("at_risk");
  });

  it("HM64-05 · X==N (N>0) ⇒ fully_ready", () => {
    const out = rollupBySubject([
      row("phy", "Physics", "t1", "One", "ready"),
      row("phy", "Physics", "t2", "Two", "ready"),
    ]);
    expect(out[0]).toMatchObject({ teacherTotal: 2, teacherComplete: 2, bucket: "fully_ready" });
    expect(out[0].blockers).toEqual([]);
  });

  it("HM64-06 · X==0 ⇒ at_risk", () => {
    const out = rollupBySubject([
      row("gov", "Government", "t1", "One", "behind"),
      row("gov", "Government", "t2", "Two", "at_risk"),
    ]);
    expect(out[0]).toMatchObject({ teacherTotal: 2, teacherComplete: 0, bucket: "at_risk" });
  });

  it("HM64-07/08 · 0<X<N ⇒ partial; Mathematics with 6 teachers, 4 complete ⇒ exactly 4 of 6", () => {
    const rows: VhmProgressRow[] = [];
    for (let i = 1; i <= 4; i++) rows.push(row("math", "Mathematics", `c${i}`, `C${i}`, "ready"));
    rows.push(row("math", "Mathematics", "b1", "B1", "behind", 3));
    rows.push(row("math", "Mathematics", "b2", "B2", "at_risk", 20));
    const out = rollupBySubject(rows);
    expect(out[0]).toMatchObject({
      subjectName: "Mathematics",
      teacherTotal: 6,
      teacherComplete: 4,
      bucket: "partial",
    });
  });

  it("HM64-09/16 · partitions every subject into exactly one bucket, most-behind first (at_risk leads)", () => {
    const out = rollupBySubject([
      row("phy", "Physics", "p", "P", "ready"),
      row("math", "Mathematics", "m1", "M1", "ready"),
      row("math", "Mathematics", "m2", "M2", "behind", 2),
      row("gov", "Government", "g", "G", "at_risk", 19),
    ]);
    // Three distinct subjects (the "of {total} subjects" denominator).
    expect(out).toHaveLength(3);
    // Ordering: at_risk → partial → fully_ready.
    expect(out.map((s) => s.bucket)).toEqual(["at_risk", "partial", "fully_ready"]);
    expect(out[0].subjectName).toBe("Government"); // most urgent = escalation
  });

  it("HM64-16 · among at-risk subjects a never-touched blocker outranks a merely-stale one", () => {
    const out = rollupBySubject([
      row("gov", "Government", "g", "G", "at_risk", 19), // 19 days
      row("eco", "Economics", "e", "E", "at_risk", null), // never touched — most urgent
    ]);
    expect(out[0].subjectName).toBe("Economics");
    expect(out[0].blockers[0].daysInactive).toBeNull();
  });

  it("empty input rolls up to nothing (no fabricated zero subjects — HM64-17)", () => {
    expect(rollupBySubject([])).toEqual([]);
  });
});
