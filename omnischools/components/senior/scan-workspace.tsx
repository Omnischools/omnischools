"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { commitScanLedger } from "@/lib/actions/score-ledger";
import { provisionalTotal, type CategoryScores, type CategoryWeights } from "@/lib/score-ledger/compute";
import {
  bandCell,
  diffCell,
  reasonRequiredForCommit,
  mapRosterRows,
  type CellBand,
  type ExtractedNameRow,
} from "@/lib/score-ledger/scan-diff";

/**
 * Path B verify-first workspace (INCR-2). The whole flow is client-held and TRANSIENT: the photo
 * becomes an in-memory object URL, its base64 is POSTed to /api/senior/ledger-extract (server-held
 * key), the extracted grid comes back, the teacher confirms the roster mapping + every low-confidence
 * cell + every diff, and commit writes senior_score_ledger. The image is released on commit and on
 * unmount — it is never persisted anywhere (owner ruling 3 / G1–G4). Nothing here writes the photo to
 * storage, a field, or a log; the only network calls are the extract POST (image out) and the commit
 * (numbers only — no image).
 */

type CatKey = "asgn" | "midSem" | "endSem" | "project" | "portfolio";
const CATS: { key: CatKey; label: string; cls: string }[] = [
  { key: "asgn", label: "Asg", cls: "text-green" },
  { key: "midSem", label: "MS", cls: "text-navy-2" },
  { key: "endSem", label: "ES", cls: "text-navy-2" },
  { key: "project", label: "Pj", cls: "text-green" },
  { key: "portfolio", label: "Pf", cls: "text-terra" },
];
const CAT_FULL: Record<CatKey, string> = {
  asgn: "Assignment",
  midSem: "Mid-sem",
  endSem: "End-of-sem",
  project: "Project",
  portfolio: "Portfolio",
};
const REASONS: { code: string; label: string }[] = [
  { code: "RE_GRADED", label: "Re-graded" },
  { code: "TRANSCRIPTION_ERROR", label: "Transcription error" },
  { code: "OTHER", label: "Other (add a note)" },
];

type ExtractCell = { raw: number | null; value: number | null; confidence: number };
type ExtractRow = { readName: string; studentId: string | null; cells: Record<CatKey, ExtractCell> };
export type RosterEntry = { id: string; name: string; code: string };

const key = (id: string, k: CatKey) => `${id}:${k}`;
const num = (v: string | undefined): number | null => {
  if (v == null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const goldInput =
  "w-14 rounded-md border border-gold-soft bg-gold-bg px-1.5 py-1 text-center font-mono text-[12px] font-bold text-navy outline-none focus:border-gold";
const warnInput =
  "w-14 rounded-md border border-warn bg-warn-bg px-1.5 py-1 text-center font-mono text-[12px] font-bold text-warn outline-none focus:border-gold";
const emptyInput =
  "w-14 rounded-md border border-border-2 bg-bg px-1.5 py-1 text-center font-mono text-[12px] text-border-2 outline-none focus:border-gold";

export function ScanWorkspace({
  classId,
  subjectId,
  periodId,
  roster,
  committed,
  weights,
  isClosed,
  ledgerHref,
}: {
  classId: string;
  subjectId: string;
  periodId: string;
  roster: RosterEntry[];
  /** Current committed 0–100 ledger values per student — the diff baseline (Kofi Q1). */
  committed: Record<string, CategoryScores>;
  weights: CategoryWeights;
  isClosed: boolean;
  ledgerHref: string;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const appendRef = useRef(false); // true when the next upload adds a page to the current set
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "busy" | "verify">("idle");
  const [pageCount, setPageCount] = useState(0);
  const [extractOk, setExtractOk] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Verify-phase state.
  const [rows, setRows] = useState<ExtractRow[]>([]);
  const [assign, setAssign] = useState<string[]>([]); // per extraction row: studentId | "" | "__discard__"
  const [mappingConfirmed, setMappingConfirmed] = useState(false);
  const [cellVals, setCellVals] = useState<Record<string, string>>({});
  const [bands, setBands] = useState<Record<string, CellBand>>({});
  const [reviewed, setReviewed] = useState<Set<string>>(new Set());
  const [reasons, setReasons] = useState<Record<string, { code: string; note: string }>>({});
  const [committing, setCommitting] = useState(false);

  // Release the in-memory image on unmount (transient guarantee — G4).
  useEffect(() => {
    return () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [imageUrl]);

  const rosterById = useMemo(() => new Map(roster.map((r) => [r.id, r])), [roster]);
  const committedFor = (id: string): CategoryScores =>
    committed[id] ?? { asgn: null, midSem: null, endSem: null, project: null, portfolio: null };

  function reset() {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    setImageUrl(null);
    setPhase("idle");
    setPageCount(0);
    setExtractOk(true);
    setRows([]);
    setAssign([]);
    setMappingConfirmed(false);
    setCellVals({});
    setBands({});
    setReviewed(new Set());
    setReasons({});
    setError(null);
  }

  const rosterForMapping = useMemo(
    () =>
      roster.map((r) => {
        const [firstName, ...rest] = r.name.split(" ");
        return { id: r.id, firstName, lastName: rest.join(" ") };
      }),
    [roster],
  );

  async function onFile(file: File) {
    const append = appendRef.current;
    appendRef.current = false;
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError("Please choose a photo (JPEG or PNG) of your ledger page.");
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setImageUrl(objectUrl);
    setPhase("busy");

    let dataUrl: string;
    try {
      dataUrl = await readAsDataUrl(file);
    } catch {
      setPhase(append ? "verify" : "idle");
      setError("Could not read that file. Try another photo.");
      return;
    }

    try {
      const res = await fetch("/api/senior/ledger-extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ classId, subjectId, periodId, imageDataUrl: dataUrl }),
      });
      const body = (await res.json().catch(() => null)) as
        | { ok: true; rows: ExtractRow[] }
        | { ok: false; error: string }
        | null;
      if (body && body.ok) {
        if (append) mergePage(body.rows);
        else startVerify(body.rows, true);
        return;
      }
      // A page we can't read: on append, keep the pages so far; on the first page, degrade to a
      // blank Path-C grid IN PLACE — never a dead end (Q7 / H1). Nothing was persisted server-side.
      if (append) {
        setPhase("verify");
        if (body && body.error !== "extract_failed") setError(body.error);
        else setError("We couldn't read that page — the pages added so far are kept.");
        return;
      }
      if (body && body.error !== "extract_failed") {
        setError(body.error);
        setPhase("idle");
        return;
      }
      startVerify([], false);
    } catch {
      if (append) {
        setPhase("verify");
        setError("We couldn't read that page — the pages added so far are kept.");
      } else startVerify([], false);
    }
  }

  /** Append another page's rows to the current set — one merged grid, committed atomically
   * (Kofi Q6 / E1–E2). Re-opens the mapping step so the teacher confirms the combined roster. */
  function mergePage(newRows: ExtractRow[]) {
    const map = mapRosterRows(
      newRows.map<ExtractedNameRow>((r) => ({ readName: r.readName, studentId: r.studentId })),
      rosterForMapping,
    );
    setRows((prev) => [...prev, ...newRows]);
    setAssign((prev) => [...prev, ...map.rows.map((m) => (m.status === "mapped" ? m.studentId : ""))]);
    setMappingConfirmed(false);
    setPageCount((n) => n + 1);
    setPhase("verify");
  }

  /** Seed the verify state. ok=false → wholesale-failure fallback: blank Path-C grid, all roster
   * covered, seeded from committed so untouched cells never blank a committed score. */
  function startVerify(extractRows: ExtractRow[], ok: boolean) {
    setExtractOk(ok);
    setRows(extractRows);
    setPageCount(ok ? 1 : 0);
    if (ok) {
      const map = mapRosterRows(
        extractRows.map<ExtractedNameRow>((r) => ({ readName: r.readName, studentId: r.studentId })),
        rosterForMapping,
      );
      setAssign(
        map.rows.map((m) => (m.status === "mapped" ? m.studentId : "")),
      );
    } else {
      // Fallback: seed the blank grid from committed values (all roster covered).
      const vals: Record<string, string> = {};
      for (const r of roster) {
        const c = committedFor(r.id);
        for (const cat of CATS) vals[key(r.id, cat.key)] = c[cat.key] == null ? "" : String(c[cat.key]);
      }
      setCellVals(vals);
      setBands({});
      setMappingConfirmed(true);
    }
    setPhase("verify");
  }

  // ---- roster mapping validation (Kofi Q5 / D1–D5) ----
  const assignedIds = assign.filter((a) => a && a !== "__discard__");
  const dupIds = assignedIds.filter((id, i) => assignedIds.indexOf(id) !== i);
  const unresolvedRows = extractOk
    ? assign.filter((a) => a === "").length
    : 0;
  const mappingValid = extractOk ? unresolvedRows === 0 && dupIds.length === 0 : true;

  function confirmMapping() {
    if (!mappingValid) return;
    // Build covered cells from each assigned extraction row.
    const vals: Record<string, string> = {};
    const bnds: Record<string, CellBand> = {};
    rows.forEach((row, i) => {
      const sid = assign[i];
      if (!sid || sid === "__discard__") return;
      for (const cat of CATS) {
        const cell = row.cells[cat.key];
        const b = bandCell(cell.value, cell.confidence);
        vals[key(sid, cat.key)] = b.value == null ? "" : String(b.value);
        bnds[key(sid, cat.key)] = b.band;
      }
    });
    setCellVals(vals);
    setBands(bnds);
    setMappingConfirmed(true);
  }

  const coveredIds = useMemo(() => {
    if (!extractOk) return roster.map((r) => r.id);
    return assign.filter((a) => a && a !== "__discard__");
  }, [assign, extractOk, roster]);
  const coveredSet = useMemo(() => new Set(coveredIds), [coveredIds]);

  function setCell(id: string, k: CatKey, v: string) {
    setCellVals((m) => ({ ...m, [key(id, k)]: v }));
    setReviewed((s) => new Set(s).add(key(id, k)));
    setError(null);
  }
  function confirmCell(k: string) {
    setReviewed((s) => new Set(s).add(k));
  }
  function keepCommitted(id: string, k: CatKey) {
    const c = committedFor(id)[k];
    setCell(id, k, c == null ? "" : String(c));
  }
  function setReason(k: string, patch: Partial<{ code: string; note: string }>) {
    setReasons((m) => ({ ...m, [k]: { code: m[k]?.code ?? "RE_GRADED", note: m[k]?.note ?? "", ...patch } }));
  }

  // Per covered cell: current value, committed, and what's still blocking commit.
  const changes = useMemo(() => {
    const out: {
      id: string;
      cat: CatKey;
      committed: number | null;
      final: number | null;
      kind: string;
      severity: string;
      reasonRequired: boolean;
    }[] = [];
    for (const id of coveredIds) {
      const cm = committedFor(id);
      for (const cat of CATS) {
        const final = num(cellVals[key(id, cat.key)]);
        const committedVal = cm[cat.key];
        const same = final === committedVal;
        if (same) continue;
        const band = bands[key(id, cat.key)] ?? "ACCEPTED";
        const d = diffCell(committedVal, { band, value: final });
        out.push({
          id,
          cat: cat.key,
          committed: committedVal,
          final,
          kind: d.kind,
          severity: d.severity,
          reasonRequired: reasonRequiredForCommit(committedVal, final),
        });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cellVals, coveredIds, bands]);

  // Low-confidence cells still awaiting review (C2) — cannot commit until every one is reviewed.
  const unreviewedLowConf = useMemo(() => {
    let n = 0;
    for (const id of coveredIds) {
      for (const cat of CATS) {
        const k = key(id, cat.key);
        if (bands[k] === "LOW_CONF" && !reviewed.has(k)) n++;
      }
    }
    return n;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bands, reviewed, coveredIds]);

  // A required change defaults to RE_GRADED (the surface pre-bakes this — Lucy §4.1); only an
  // explicit OTHER without a note blocks commit.
  const missingReasons = changes.filter((c) => {
    if (!c.reasonRequired) return false;
    const r = reasons[key(c.id, c.cat)];
    return r?.code === "OTHER" && !r.note.trim();
  });

  const canCommit =
    !isClosed &&
    coveredIds.length > 0 &&
    unreviewedLowConf === 0 &&
    missingReasons.length === 0;

  function rowTotal(id: string): number | null {
    const cats: CategoryScores = {
      asgn: num(cellVals[key(id, "asgn")]),
      midSem: num(cellVals[key(id, "midSem")]),
      endSem: num(cellVals[key(id, "endSem")]),
      project: num(cellVals[key(id, "project")]),
      portfolio: num(cellVals[key(id, "portfolio")]),
    };
    if (!Object.values(cats).some((v) => v != null)) return null;
    return provisionalTotal(cats, weights).total;
  }

  async function commit() {
    if (!canCommit) {
      if (unreviewedLowConf > 0)
        setError(`${unreviewedLowConf} low-confidence cell(s) still marked ? — review them against the photo first.`);
      else if (missingReasons.length > 0)
        setError("Add a reason for every score that went down or was removed before committing.");
      return;
    }
    setCommitting(true);
    setError(null);
    const scores = coveredIds.map((id) => ({
      studentId: id,
      asgn: cellVals[key(id, "asgn")] ?? "",
      midSem: cellVals[key(id, "midSem")] ?? "",
      endSem: cellVals[key(id, "endSem")] ?? "",
      project: cellVals[key(id, "project")] ?? "",
      portfolio: cellVals[key(id, "portfolio")] ?? "",
    }));
    const reasonPayload = changes
      .filter((c) => c.reasonRequired)
      .map((c) => {
        const r = reasons[key(c.id, c.cat)];
        return {
          studentId: c.id,
          category: c.cat,
          code: r?.code ?? "RE_GRADED",
          note: r?.note?.trim() || undefined,
        };
      });
    const res = await commitScanLedger({
      classId,
      subjectId,
      periodId,
      origin: extractOk ? "SCAN_EXTRACT" : "DIRECT_ENTRY",
      scores,
      reasons: reasonPayload,
    });
    setCommitting(false);
    if (res.ok) {
      if (imageUrl) URL.revokeObjectURL(imageUrl); // discard the photo (G4)
      router.push(ledgerHref);
      router.refresh();
    } else {
      setError(res.error);
    }
  }

  // ------------------------------------------------------------------ render

  if (phase === "idle") {
    return (
      <div className="rounded-[10px] border-[1.5px] border-dashed border-border-2 bg-bg p-10 text-center">
        <p className="font-display text-lg italic text-navy">Photograph your ledger page.</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-navy-3">
          Take a clear, flat, well-lit photo. Omnischools reads the five category scores; you confirm
          each one against the photo before it commits. The photo is never saved — it is read once and
          discarded.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          disabled={isClosed}
          onClick={() => fileRef.current?.click()}
          className="mt-5 rounded-md bg-navy px-6 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-60"
        >
          Take or attach a photo
        </button>
        {error && <p className="mt-3 text-sm text-terra">{error}</p>}
      </div>
    );
  }

  if (phase === "busy") {
    return (
      <div className="rounded-xl border border-gold-soft bg-gold-bg p-10 text-center">
        <p className="font-display text-lg italic text-navy">Reading your ledger…</p>
        <p className="mt-1 text-sm text-navy-3">
          This usually takes a few seconds. The photo is read once and not saved.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Verify-phase file input — the idle-phase input is unmounted here (Add another page). */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onFile(f);
          e.target.value = "";
        }}
      />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-navy-3">
          {extractOk ? "Extracted ledger · verify the read" : "Extraction unavailable · enter directly (Path C)"}
          {extractOk && pageCount > 1 ? ` · ${pageCount} pages merged` : ""}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={reset}
            className="rounded-md border border-border-2 bg-transparent px-3 py-2 text-sm font-semibold text-navy-3"
          >
            Re-upload page
          </button>
          {mappingConfirmed && (
            <button
              type="button"
              onClick={commit}
              disabled={committing || !canCommit}
              className="rounded-md bg-navy px-5 py-2 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-60"
            >
              {committing ? "Committing…" : "Commit verified ledger →"}
            </button>
          )}
        </div>
      </div>

      {!extractOk && (
        <div className="mb-4 rounded-xl border border-terra bg-terra-bg px-4 py-3 text-sm text-terra">
          We couldn&apos;t read that photo. The grid below is blank for direct entry — type the five
          category scores and commit. (Nothing from the photo was saved.)
        </div>
      )}
      {error && <p className="mb-3 text-sm text-terra">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        {/* Photo pane — in-session object URL only, never persisted. */}
        <div className="rounded-[10px] border-[1.5px] border-dashed border-border-2 bg-bg p-3">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.1em] text-navy-3">
            Your ledger photo · in-session only
          </div>
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl} alt="Uploaded ledger page" className="w-full rounded-md border border-border" />
          ) : (
            <div className="grid h-40 place-items-center text-sm text-navy-3">No photo.</div>
          )}
        </div>

        <div>
          {/* Roster mapping confirm (Kofi Q5 / D1–D5) — mandatory before diff/commit. */}
          {extractOk && !mappingConfirmed && (
            <div className="mb-4 rounded-xl border border-gold-soft bg-gold-bg p-4">
              <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.1em] text-navy-3">
                Confirm which student each row belongs to
              </div>
              <p className="mb-3 text-[12px] text-navy-2">
                A right mark on the wrong student is the one error the eye misses. Confirm each row —
                ambiguous names (e.g. two students share a surname) are left blank for you to pick.
              </p>
              <div className="space-y-1.5">
                {rows.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 text-[12px]">
                    <span className="w-40 truncate font-mono text-navy-2">{r.readName || "—"}</span>
                    <span className="text-navy-3">→</span>
                    <select
                      value={assign[i] ?? ""}
                      onChange={(e) =>
                        setAssign((a) => a.map((v, j) => (j === i ? e.target.value : v)))
                      }
                      className={
                        "rounded-md border bg-surface px-2 py-1 text-navy " +
                        (assign[i] === "" ? "border-warn" : "border-border-2")
                      }
                    >
                      <option value="">— choose student —</option>
                      {roster.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                      <option value="__discard__">— not on the roster (discard row) —</option>
                    </select>
                  </div>
                ))}
              </div>
              {dupIds.length > 0 && (
                <p className="mt-2 text-[12px] text-terra">
                  Two rows point to the same student — each student can map to at most one row.
                </p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={confirmMapping}
                  disabled={!mappingValid}
                  className="rounded-md bg-navy px-4 py-1.5 text-[13px] font-semibold text-bg disabled:opacity-60"
                >
                  Confirm mapping →
                </button>
                <button
                  type="button"
                  onClick={() => {
                    appendRef.current = true;
                    fileRef.current?.click();
                  }}
                  className="rounded-md border border-border-2 bg-surface px-3 py-1.5 text-[13px] font-semibold text-navy-2"
                >
                  + Add another page{pageCount > 1 ? ` (${pageCount} so far)` : ""}
                </button>
              </div>
              <p className="mt-1.5 text-[11px] text-navy-3">
                Add every page of this class before confirming — they merge into one grid and commit
                together.
              </p>
            </div>
          )}

          {mappingConfirmed && (
            <>
              <div className="overflow-x-auto rounded-xl border border-border bg-surface">
                <table className="w-full text-sm">
                  <thead className="border-b-2 border-border-2 bg-bg text-center text-[9px] font-bold uppercase tracking-[0.1em] text-navy-3">
                    <tr>
                      <th className="sticky left-0 z-10 bg-bg px-3 py-2.5 text-left">Student</th>
                      {CATS.map((c) => (
                        <th key={c.key} className={`px-1.5 py-2.5 ${c.cls}`}>
                          {c.label}
                        </th>
                      ))}
                      <th className="px-1.5 py-2.5 text-navy-3">~Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {roster.map((r) => {
                      const isCovered = coveredSet.has(r.id);
                      const t = rowTotal(r.id);
                      const cm = committedFor(r.id);
                      return (
                        <tr key={r.id} className="hover:bg-gold-bg">
                          <td className="sticky left-0 z-10 bg-surface px-3 py-2 text-left">
                            <div className="text-[12px] font-semibold text-navy">{r.name}</div>
                            <div className="font-mono text-[9px] text-navy-3">
                              {r.code}
                              {!isCovered && " · not on this page"}
                            </div>
                          </td>
                          {CATS.map((c) => {
                            if (!isCovered) {
                              const v = cm[c.key];
                              return (
                                <td key={c.key} className="px-1.5 py-2 text-center font-mono text-[12px] text-border-2">
                                  {v == null ? "—" : v}
                                </td>
                              );
                            }
                            const k = key(r.id, c.key);
                            const v = cellVals[k] ?? "";
                            const low = bands[k] === "LOW_CONF" && !reviewed.has(k);
                            const cls = v.trim() === "" ? emptyInput : low ? warnInput : goldInput;
                            return (
                              <td key={c.key} className="px-1.5 py-2 text-center">
                                <div className="relative inline-block">
                                  <input
                                    type="number"
                                    min="0"
                                    max="100"
                                    step="0.01"
                                    placeholder="—"
                                    value={v}
                                    disabled={isClosed}
                                    onChange={(e) => setCell(r.id, c.key, e.target.value)}
                                    className={cls}
                                  />
                                  {low && (
                                    <button
                                      type="button"
                                      title="Confirm this reading"
                                      onClick={() => confirmCell(k)}
                                      className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-warn text-[9px] font-bold text-bg"
                                    >
                                      ?
                                    </button>
                                  )}
                                </div>
                              </td>
                            );
                          })}
                          <td className="px-1.5 py-2 text-center font-mono text-[11px] text-navy-3">
                            {t == null ? "—" : t.toFixed(1)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Legend — solid -bg tokens only (no slash-opacity on raw-hex tokens). */}
              <div className="mt-3 flex flex-wrap gap-4 text-[11px] text-navy-3">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-3 w-3 rounded bg-gold-bg" /> Read — confirm or correct
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-3 w-3 rounded bg-warn-bg" /> Low-confidence — check the photo
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-3 w-3 rounded border border-border-2 bg-bg" /> Blank — fill it in
                </span>
              </div>

              {/* Changes since the committed ledger (Kofi Q3 / §4). */}
              <ChangesPanel
                changes={changes}
                rosterById={rosterById}
                reasons={reasons}
                setReason={setReason}
                keepCommitted={keepCommitted}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ChangesPanel({
  changes,
  rosterById,
  reasons,
  setReason,
  keepCommitted,
}: {
  changes: {
    id: string;
    cat: CatKey;
    committed: number | null;
    final: number | null;
    kind: string;
    severity: string;
    reasonRequired: boolean;
  }[];
  rosterById: Map<string, RosterEntry>;
  reasons: Record<string, { code: string; note: string }>;
  setReason: (k: string, patch: Partial<{ code: string; note: string }>) => void;
  keepCommitted: (id: string, k: CatKey) => void;
}) {
  if (changes.length === 0) {
    return (
      <p className="mt-4 text-[12px] text-navy-3">
        No changes from the committed ledger yet — the read matches what is on record.
      </p>
    );
  }
  const tone: Record<string, string> = {
    gold: "border-gold bg-gold-bg",
    warn: "border-warn bg-warn-bg",
    terra: "border-terra bg-terra-bg",
    none: "border-border-2 bg-surface",
  };
  const fmt = (v: number | null) => (v == null ? "—" : String(v));
  return (
    <div className="mt-4">
      <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.1em] text-navy-3">
        Changes since the committed ledger · {changes.length} to review
      </div>
      <div className="space-y-2">
        {changes.map((c) => {
          const k = `${c.id}:${c.cat}`;
          const student = rosterById.get(c.id)?.name ?? c.id;
          const r = reasons[k] ?? { code: "RE_GRADED", note: "" };
          return (
            <div key={k} className={`rounded-[10px] border px-4 py-3 ${tone[c.severity] ?? tone.none}`}>
              <div className="text-[12px] text-navy-2">
                <b className="text-navy">{student}</b> · {CAT_FULL[c.cat]} score · committed{" "}
                <b className="text-navy">{fmt(c.committed)}</b> → this upload{" "}
                <b className="text-navy">{fmt(c.final)}</b>
                {c.kind === "GONE_MISSING" && " — score has gone missing; keep it or enter it by hand."}
                {c.kind === "SCORE_DOWN" && " — score went down; confirm with a reason."}
                {c.kind === "SILENT_ACCEPT" && " — new entry, accepted."}
                {c.kind === "REVIEW" && " — changed; review against the photo."}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => keepCommitted(c.id, c.cat)}
                  className="rounded-md border border-border-2 bg-surface px-2.5 py-[5px] text-[10px] font-semibold text-navy-2"
                >
                  Keep committed ({fmt(c.committed)})
                </button>
                {c.reasonRequired && (
                  <>
                    <select
                      value={r.code}
                      onChange={(e) => setReason(k, { code: e.target.value })}
                      className="rounded-md border border-border-2 bg-surface px-2 py-[5px] text-[10px] font-semibold text-navy-2"
                    >
                      {REASONS.map((o) => (
                        <option key={o.code} value={o.code}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    {r.code === "OTHER" && (
                      <input
                        type="text"
                        value={r.note}
                        placeholder="Reason (required)"
                        onChange={(e) => setReason(k, { note: e.target.value })}
                        className="rounded-md border border-border-2 bg-surface px-2 py-[5px] text-[11px] text-navy outline-none focus:border-gold"
                      />
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
