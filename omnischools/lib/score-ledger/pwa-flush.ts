/**
 * The Score Ledger PWA flush orchestration, extracted from PwaLedger so it is unit-testable in
 * node with the server actions MOCKED (INCR-4 rework). The pure buffer reducer (pwa-buffer.ts) was
 * well-tested, but this async wiring — transport-failure vs domain-`{ok:false}` routing, the rerun
 * latch, the mid-flight snapshot compare, and bufferConfirm vs bufferReject — had no test, which is
 * how a `{ ok:true, saved:0 }` silently-dropped out-of-range score slipped through as a false save
 * (Quinn MAJOR). Pure of React: every piece of component state is reached through injected deps.
 */
import {
  bufferConfirm,
  bufferHold,
  bufferReject,
  pendingStudentIds,
  studentOfCell,
  type PendingBuffer,
  type PwaCat,
} from "./pwa-buffer";

/** The two save actions share this result shape (SaveDirectResult / SavePortfolioResult). */
export type SaveResult = { ok: true; saved: number } | { ok: false; error: string };

/** Only the fields the flush needs off a PwaClass — its id and its capture path. */
export interface FlushClass {
  classId: string;
  path: "AUTO_COMPILE" | "SCAN_EXTRACT" | "DIRECT_ENTRY";
}

/** Re-entrancy latch, owned by the component as a ref so it persists across flush calls: a flush
 *  attempted while one is inFlight sets rerun, and the running loop drains again before exiting. */
export interface FlushLatch {
  inFlight: boolean;
  rerun: boolean;
}

export interface FlushDeps {
  latch: FlushLatch;
  getBuffer: () => PendingBuffer;
  setBuffer: (updater: (s: PendingBuffer) => PendingBuffer) => void;
  getCell: (studentId: string, cat: PwaCat) => string;
  classOf: (studentId: string) => FlushClass | undefined;
  isOnline: () => boolean;
  saveDirect: (input: {
    classId: string;
    subjectId: string;
    periodId: string;
    scores: {
      studentId: string;
      asgn: string;
      midSem: string;
      endSem: string;
      project: string;
      portfolio: string;
    }[];
  }) => Promise<SaveResult>;
  savePortfolio: (input: {
    classId: string;
    subjectId: string;
    periodId: string;
    scores: { studentId: string; value: string }[];
  }) => Promise<SaveResult>;
  subjectId: string;
  periodId: string;
  now: () => number;
}

/**
 * Drain the pending buffer. Pending cells can span classes (edited class1, switched, edited
 * class2), so group by class and call each class's save action independently:
 *   - a THROW (fetch rejected) or offline → bufferHold: cells stay pending + gold, retried on `online`.
 *   - `{ ok:false }` (domain error — closed period, wrong path, out-of-range) → bufferReject: cells
 *     move to errored/red and the message surfaces; never parked silently as pending (R4 / B6).
 *   - `{ ok:true }` → bufferConfirm: only the cells whose value the teacher hasn't changed since we
 *     sent them clear; a cell re-edited mid-flight stays pending and the rerun latch resends it.
 */
export async function flushPending(deps: FlushDeps): Promise<void> {
  const { latch } = deps;
  if (latch.inFlight) {
    latch.rerun = true; // a flush is already running — make it drain again after
    return;
  }
  latch.inFlight = true;
  try {
    do {
      latch.rerun = false;
      const ids = pendingStudentIds(deps.getBuffer());
      if (ids.length === 0) break;
      if (!deps.isOnline()) {
        deps.setBuffer((s) => bufferHold(s)); // offline — keep held, retry on `online`
        break;
      }
      const byClass = new Map<string, { cls: FlushClass; sids: string[] }>();
      for (const sid of ids) {
        const c = deps.classOf(sid);
        if (!c) continue;
        const g = byClass.get(c.classId) ?? { cls: c, sids: [] };
        g.sids.push(sid);
        byClass.set(c.classId, g);
      }
      for (const { cls, sids } of Array.from(byClass.values())) {
        // Snapshot exactly the cells being flushed for this student group, with their values.
        const groupCells = Object.keys(deps.getBuffer().pending).filter((id) =>
          sids.includes(studentOfCell(id)),
        );
        const snapshot = new Map(groupCells.map((id) => [id, deps.getBuffer().pending[id]]));
        const val = (sid: string, cat: PwaCat) => deps.getCell(sid, cat);
        let res: SaveResult;
        try {
          res =
            cls.path === "DIRECT_ENTRY"
              ? await deps.saveDirect({
                  classId: cls.classId,
                  subjectId: deps.subjectId,
                  periodId: deps.periodId,
                  scores: sids.map((sid) => ({
                    studentId: sid,
                    asgn: val(sid, "asgn"),
                    midSem: val(sid, "midSem"),
                    endSem: val(sid, "endSem"),
                    project: val(sid, "project"),
                    portfolio: val(sid, "portfolio"),
                  })),
                })
              : await deps.savePortfolio({
                  classId: cls.classId,
                  subjectId: deps.subjectId,
                  periodId: deps.periodId,
                  scores: sids.map((sid) => ({ studentId: sid, value: val(sid, "portfolio") })),
                });
        } catch {
          deps.setBuffer((s) => bufferHold(s)); // transport failure → hold + retry (R4)
          continue;
        }
        // Only clear cells whose value the teacher hasn't changed since we sent them — a cell
        // re-edited mid-flight stays pending and the rerun loop resends its new value.
        const settled = groupCells.filter(
          (id) => deps.getBuffer().pending[id] === snapshot.get(id),
        );
        if (res.ok) deps.setBuffer((s) => bufferConfirm(s, settled, deps.now()));
        else deps.setBuffer((s) => bufferReject(s, settled, res.error)); // domain error → surface (R4)
      }
    } while (latch.rerun);
  } finally {
    latch.inFlight = false;
  }
}
