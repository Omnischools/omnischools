# Senior (SHS) tier — build plan & task board

**Branch:** `senior-feat` off `main`. **Cadence:** milestone merges to `main`, one per module.
**Gates (every PR):** Quinn (QA) · Dex (architecture/portability) · Sarah (security/RLS/PII, holds merge).
**Spec authority:** `md files/INSTRUCTIONS_FOR_CLAUDE_CODE.md` §4 · `md files/SHS_SCORE_LEDGER_SPEC.md` §11.
**Surfaces:** `Surfaces/schoolup-shs-*.html`. **Tokens:** `md files/design-tokens.json`.

## Module order (dependency-correct)

1. **F0 — Senior foundations** · programme/house/residency on `student`, SHS class model (`programmeId` on `classes`), Houses. _size: S_
2. **4.1 Score Ledger** (root) · Items 1–8 sub-sequence. _size: XL_
3. **4.2 Boarding** (7 surfaces) — houses/dorms/exeat/discipline→billing. _size: L_
4. **4.3 WASSCE readiness** (5) — reads ledger trajectory. _size: L_
5. **4.4 Sickbay** (4) — sickbay→attendance "M" hook. _size: M_
6. **4.5 VLC** (5) · **4.6 PLC** (2) · **4.7 Forms & PTA**. _size: M_

## Score Ledger sub-sequence (§11)

- Item 0 — period config ✅ shipped in Basic.
- Item 1 — 5-category model + Path A auto-compile ✅ merged (PR #131, migration 0038)
- Item 2 — Path C direct entry ✅ gates green (PR #134, migration 0039)
- Item 3 — VHM progress view ✅ merged (PR #137, migration 0040) · RBAC role-gating ✅ merged (PR #138)
  - Read-only dashboard `/senior/academic-progress`: per (class×subject) — completion counts per category, STPSHS `n/5` tier, path pill, teacher, last activity, ready/behind/at-risk. **Counts only, NEVER score values (§6.2).** Rows enumerate from the new `senior_subject_teacher` assignment table (LEFT JOIN progress) so never-started teachers appear. At-risk flags computed on-the-fly (inactive 14+ days, N-not-ready). Headmaster roll-up (§6.4) + full filter bar + role gating deferred.
- **Item 4 — Path B scan-and-extract** ← _next (INCR-2, below)_ · migration **0041**
- Item 5 — PWA phase 1 · Item 6 — paper ledger book · Item 7 — versioned diff · Item 8 — STPSHS sheet

## Current increment — INCR-1: F0 + Score Ledger Item 1

| Step | Owner | State |
|---|---|---|
| Surface map (ledger + SHS roster) | Lucy | ✅ `docs/senior/ledger-surface-map.md` |
| Schema design (F0 + ledger + weights, RLS) | Wells | ✅ `docs/senior/f0-ledger-schema.md` |
| Kofi rulings on the 9 open questions | Kofi | ✅ (in schema commit body) |
| Schema + migration 0036 + RLS (dev applied, verified) | Claude Code | ✅ commit `9081ca0` |
| prod-paste-0036 (hand-paste RLS for prod) | Claude Code | ✅ `db/sql/prod-paste-0038-senior-ledger.sql` |
| Compute core + vitest (22 tests green) | Claude Code | ✅ commit `a202293` |
| Compile orchestration (server actions + audit) | Claude Code | ▶ next |
| Path A UI (ledger grid, events, portfolio, compile) + F0 roster | Claude Code | ▶ next |
| Seed extension (houses, subjects, J.Manu/Y.Aidoo, weights, sample events) | Claude Code | ▶ next |
| Build · RLS test · preview round-trip | Claude Code | ✅ build/typecheck/26 tests/RLS ✓; live save proven |
| QA — ledger math, weights, tenant isolation | Quinn | ✅ PASS (1 MAJOR fixed) |
| Architecture/portability review | Dex | ✅ APPROVE |
| Security/RLS/PII review + merge gate | Sarah | ✅ APPROVE (prod-RLS parity PASS) |
| Gate fixes (overflow clamp, closed-guard, roster check, opacity) | Claude Code | ✅ commit `e2c3a2d` |

**INCR-1 COMPLETE — all three gates green.** Ready for the `senior-feat`→`main` milestone PR.
Deploy note: paste `db/sql/prod-paste-0038-senior-ledger.sql` on prod (RLS is not auto-applied).

**INCR-1 done when:** an SHS teacher can enter assignment/mid-sem/end-sem/project events for a class-subject-semester, compile the four computable categories, enter portfolio manually, and see the weighted total using per-(subject×school) weights (default 15/15/40/15/15) — all tenant-scoped, audit-logged, gates green.

---

## Next increment — INCR-2: Score Ledger Item 4 · Path B (scan-and-extract) · migration 0041

### Owner rulings — LOCKED (2026-07-14/15)

1. **OCR provider = Claude Vision, Haiku 4.5** (`claude-haiku-4-5-20251001`). Anthropic messages API,
   image as base64, behind a `LedgerExtractor` interface. Upgrade path to **Sonnet 5**
   (`claude-sonnet-5`) revisited after go-live once real teacher-ledger feedback lands — a one-constant
   swap, no rewrite. Implementation must consult the `claude-api` skill for the request shape.
2. **Cross-border PII consent: yes — the image is never persisted.** Sent to Claude Vision, not stored.
3. **Image lifecycle = transient.** Photo lives only in the browser + in-flight to Claude; **deleted
   after extraction** when the teacher clicks complete/done/keep. → **no `score-ledger-uploads` bucket,
   no storage RLS, no retention job, no image column.**
4. **Cross-path upload: yes.** A Path A/C teacher may upload a scan; diff runs against what's committed.
5. **Scale = school-defined per-category denominator** (e.g. portfolio /10, others /100). Raw number is
   scaled against its category denominator before it becomes the 0–100 stored value.
6. **Confidence numbers:** `LOW_CONF_FLAG = 0.85`, `LOW_CONF_FLOOR = 0.60` (named constants, retunable).
7. **Reason codes:** `RE_GRADED` · `TRANSCRIPTION_ERROR` · `OTHER` (free text mandatory on `OTHER`).
8. **Fallback path label:** `DIRECT_ENTRY` when nothing came from a scan, else `SCAN_EXTRACT`.

**INCR-2 done when:** an SHS teacher can photograph their handwritten paper ledger page, have Claude
Vision extract the five-category grid, see it side by side with the photo (in-session only), have every
low-confidence cell flagged and every row's student-mapping confirmed, work the four diff cases against
the committed values (blank→filled silent-accept · unchanged · score-down needing a reason ·
score-gone-missing) with each raw number scaled by its category's school-defined denominator, and commit
the verified grid — writing the same `senior_score_ledger` rows Paths A/C write, with
`path_used = SCAN_EXTRACT` and full audit trail. **The photograph is discarded on commit; nothing
persists the image** — all tenant-scoped, gates green.

### Step table

| Step | Owner | State |
|---|---|---|
| Rulings on the 7 open questions + acceptance criteria | Kofi | ✅ (rulings + AC below) |
| Surface map — scan §2 | Lucy | ✅ `docs/senior/path-b-scan-surface-map.md` |
| Schema — 5 denominator cols on `ref_assessment_weights` + `ledger_correction_reason` enum; migration **0041** applied to dev + verified; prod = column ALTER only (no new RLS) | Wells | ✅ `0041_little_human_torch.sql` · `db/sql/prod-paste-0041-ledger-denominators.sql` · `docs/senior/incr2-denominator-schema.md` |
| Extend `resolveWeights`→ also resolve denominators (`SYSTEM_DEFAULT_DENOMINATORS` = all 100; reuse `percent()`) | Claude Code | ⬜ |
| Extract API route — our endpoint proxies base64 → Claude Vision (Haiku 4.5) → grid + per-cell confidence; **image never persisted**; server-held `ANTHROPIC_API_KEY` | Claude Code | ⬜ |
| Extractor adapter — `LedgerExtractor` interface + Claude Vision impl (+ stub for tests) | Claude Code | ⬜ |
| Roster row-mapping — extracted name-row → `student_id`, teacher-confirmed (Q5) | Claude Code | ⬜ |
| Diff + scale engine — pure funcs in `lib/score-ledger/` (denominator scaling + 4 diff cases), vitest, no DB | Claude Code | ⬜ |
| Verification UI — side-by-side photo/grid (in-session), low-conf flags, 4 diff flags, keep-old/keep-new/manual, commit-and-discard | Claude Code | ⬜ |
| Commit path — writes `senior_score_ledger` `path_used = SCAN_EXTRACT` + `recordAudit` + reason codes; drops the image | Claude Code | ⬜ |
| Seed already set (Asankrangwa portfolio denom /10 in `db/seed/asankrangwa.ts`) | Wells | ✅ (not run — seed not idempotent) |
| Build · typecheck · tests · RLS test · preview round-trip (real photo → extract → commit) | Claude Code | ⬜ |
| QA — 4 diff cases, denominator scaling, confidence bands, roster mis-map, multi-page, tenant isolation | Quinn | ✅ PASS (build+typecheck+69 tests green; 3 MINOR, below) |
| Architecture/portability — provider swappable behind `LedgerExtractor`? model id a single constant? API key server-only? | Dex | ✅ APPROVE (3 MINOR, below) |
| Security — image truly never persisted, key server-side only, cross-tenant read, prod parity | Sarah | ✅ APPROVE (merge held for owner go) |
| Gate fixes (single aggregated rework brief) | Claude Code | ⬜ (MINOR only — see below) |
| Live-preview round-trip (real photo → extract → commit) | Claude Code | ⬜ still owed (DB/UI-layer criteria verified by code-read only) |
| Merge · verify it landed with `git log origin/main` | Sarah | ⬜ pending owner go |

**Gate findings (all MINOR / non-blocking — Sarah cleared the merge):**
- **Dex-1 — dead enum.** `ledgerCorrectionReasonEnum` documented as the reason-code source of truth but nothing imports it; the Zod domain + UI list are declared separately → 3-way drift risk. Fix: derive `REASON_CODES` from `ledgerCorrectionReasonEnum.enumValues` (1 line), or drop the enum (YAGNI).
- **Quinn-1 — scaler cap vs commit bound.** A scaled value >100 (bonus mark, e.g. 11/10 portfolio) seeds into the grid then is rejected by `commitScanLedger` (0–100), blocking commit. Safe (no corruption) but inconsistent with Path A (allows bonus to 999.99). **Kofi ruling needed:** should Path B allow bonus marks?
- **Quinn-2 — reason pre-baked.** Score-down / Case-D keep-blank pre-bakes `RE_GRADED` and commits (only `OTHER`-without-note blocks). A reason is always audited. **Kofi/Lucy confirm** this counts as "teacher-confirmed" for the highest-severity GONE_MISSING keep-blank.
- **Nits:** bare-surname → `unmapped` not `ambiguous` (still blocks); two `exhaustive-deps` suppressions want a "why safe" comment; `"__discard__"` magic string → named const.
- **Note (pre-existing, not this diff):** `SENIOR_LEDGER_ROLES` includes `VICE_HEADMASTER_ACADEMIC`, so a VHM can commit/see scores on the *edit* surface (shipped in #138; the completion-only rule targets the progress view).
- **Deploy:** prod needs `0041` (enum + 5 denominator columns + CHECK) via migrate or `prod-paste-0041-ledger-denominators.sql`. **No new RLS to paste** (no tenant table added).

### Kofi rulings on the gate findings (2026-07-15)

**Correction to the premise:** Path **C** also caps at 0–100 (shares `parseCat`). **Path A is the sole path admitting >100.** This is a 3-path consistency question, not a Path-B patch.

**Quinn-1 — bonus marks (>100).**
- **Kofi's call (settled, no owner needed): Path B's committer must accept the full range its own scaler emits (0–`MAX_PERCENT` 999.99) with a soft-warn (mirroring Path A `exceedsMax`), never a hard grid-wide block.** The scaler faithfully emits 110 for a `/10` portfolio read of 11; the committer currently rejects it — an internal self-contradiction that must be fixed regardless of policy. All three paths must share one bound.
- **OWNER CALL — bonus legitimacy direction:**
  - **Option A (Kofi-recommended):** bonus allowed; unify UP at 999.99 + soft-warn (Path A already ships this). Requires the STPSHS export + report-card boundary (§8) to tolerate/clamp totals >100.
  - **Option B:** no bonus; cap every category at 100 — **and also clamp Path A at 100** so all three agree (reverses shipped Path A behaviour, discards a faithful 11/10 read).
- **AC delta (Option A): A8** denom 10 + raw 11 → commits `portfolioScore = 110.00` with a pre-commit soft-warn, no hard block. **A9** one >100 cell never blocks the other rows. **A10** negative/non-numeric still rejected; scaled >999.99 caps at 999.99. **A11** same value commits identically via A/B/C. _(Option B inverts A8–A11 to per-cell reject naming student+category, plus a Path-A-clamp regression.)_

**Quinn-2 — pre-baked `RE_GRADED` reason.**
- **Score-down (76→73): CONFIRMED — pre-baked, changeable, always-audited `RE_GRADED` default is fine.** §7.3 asks only that the change be visible + timestamped; the surface itself pre-bakes it (`Keep 73 · re-graded` primary). No change.
- **GONE_MISSING keep-blank (82→blank): REJECTED as implemented — MUST fix before DoD closes.** §7.2 ("either way needs confirmation"), §7.3 (errors + deliberate alterations both live here), and the surface (primary action `Enter manually`, not remove) all require an **active** teacher choice. Required behaviour: removal reason **not pre-selected** and removal **not the default**; **server rejects `RE_GRADED` for a keep-blank** and requires `TRANSCRIPTION_ERROR` or `OTHER`+note (a re-grade yields a score, never a blank — incoherent for a removal). This structurally forces the teacher off the autopilot default.
- **AC delta: Q2-a** score-down commits with default `RE_GRADED` + audit row. **Q2-b** reason changeable → audit reflects it. **Q2-c** removal with default `RE_GRADED` → **blocked**, atomic, message "a removed score can't be re-graded." **Q2-d** client submitting `RE_GRADED` directly on a removal → **server** rejects. **Q2-e** removal + active `TRANSCRIPTION_ERROR` → commits, audit before=82/after=null. **Q2-f** score-up + blank→filled still commit with NO reason (B4/B8 unchanged).
- **OWNER CALL (minor, deferrable):** a dedicated removal code (`ENTERED_IN_ERROR`/`SCORE_VOIDED`) — not mandated, `TRANSCRIPTION_ERROR`/`OTHER`+note suffice today.

**Net:** Quinn-2 removal-reason fix + Quinn-1 committer-range fix ship together (both Kofi's call). The one open item is the owner's **bonus direction (Option A vs B)**, which gates the path-unification.

_INCR-2 (Item 4 · Path B) — MERGED to main (PR #139), all gates green, CodeQL false-positive dismissed. `senior-feat` synced level with main (`e546605`)._

---

## Next increment — INCR-3: Score Ledger Item 8 · STPSHS printable score sheet

**Payoff-first pick** (owner chose over Item 5 PWA). The printable-PDF workaround for STPSHS's
no-bulk-upload constraint (§8.1, §11 item 8). **Not blocked on the WAEC ICTD API** — ships as a PDF now.

**Reuse the existing PDF engine:** `@react-pdf/renderer` (Node runtime, portable — no puppeteer/Vercel PDF
service). Pattern is `app/api/receipts/[paymentId]/route.ts` + `lib/pdf/receipt-document.tsx` +
`lib/pdf/render-receipt.tsx` + `lib/data/receipt-data.ts` + `lib/pdf/fonts.ts`. Invent no new PDF path.

**Done when:** an authenticated SHS subject teacher / VHM / Headmaster can, from a class×subject×semester
ledger, download a print-ready PDF mirroring STPSHS's Capture-Per-Subject screen — one row per active
student in STPSHS column order (**tick · Ass't Ref ID · Student name · Asg · MS · ES · Proj · Port — NO
weighted-total column**, STPSHS computes GPA itself), values read tenant-scoped from `senior_score_ledger`,
paginated for a full roster, generation **audit-logged** as a regulator-submission artifact. Three gates green.

### Step table

| Step | Owner | State |
|---|---|---|
| Rulings on the 5 open questions + acceptance criteria | Kofi | ⬜ gates everything |
| Surface map — section 3 of `schoolup-shs-score-ledger.html` (STPSHS export) + Capture-Per-Subject layout | Lucy | ⬜ |
| Schema **IF Q1 = "store real STPSHS ID"** → nullable ref-ID column on `students`, migration **0042**, prod = column ALTER only (no new RLS). **ELSE confirm-only, no schema** | Wells | ⬜ (conditional) |
| STPSHS-sheet PDF document — `lib/pdf/stpshs-score-sheet-document.tsx` + `render-stpshs-sheet.tsx`, reuse `@react-pdf/renderer` + fonts (mirror receipt) | Claude Code | ⬜ |
| Tenant-scoped data builder — `lib/data/stpshs-sheet-data.ts` reading `senior_score_ledger` + name/REF/weights/period via `withSchool`, server-only, pre-formatted rows | Claude Code | ⬜ |
| Authenticated download route — mirror `app/api/receipts/[paymentId]/route.ts` (`requireSchool` + `assertAnyRole(SENIOR_LEDGER_ROLES)` + `withSchool`), keyed by class×subject×period, streams `application/pdf`, `private, no-store` | Claude Code | ⬜ |
| Wire the ledger surface "Generate STPSHS sheet →" button + status gating (per Q3) | Claude Code | ⬜ |
| Audit-log the export (`recordAudit`→`auditLog`: who / class×subject×period / when; no score values in payload) | Claude Code | ⬜ |
| Build · typecheck · tests · RLS test · preview round-trip (complete ledger → generate → open PDF; cross-tenant denied) | Claude Code | ⬜ |
| QA — column order exact, REF-ID render (present + null-placeholder), portfolio scale, pagination 37+ roster, incomplete gating, tenant isolation, >100 render per ruling | Quinn | ⬜ |
| Architecture/portability — stays on `@react-pdf/renderer`, data builder server-only (no client leak), reuses fonts/pattern | Dex | ⬜ |
| Security — tenant-scoped read, route auth + role gate, audit present, no PII in URL/logs, prod parity | Sarah | ⬜ |
| Gate fixes (single aggregated rework brief) | Claude Code | ⬜ |
| Merge · verify via `git log origin/main` | Sarah | ⬜ |

### Critical path
Kofi Q1 (REF-ID) gates the schema fork (Wells on-path → migration 0042, or one-line confirm). Everything
else parallelises: Kofi rulings ∥ Lucy map ∥ Wells (conditional). Claude Code path: data builder → PDF
document → download route → button → audit-log → self-verify → three gates → Sarah merge. PDF-document +
route are near-mechanical clones of the receipt path; the real work is the data builder (column mapping +
REF resolution + scale). No owner gate on the build path except Q5 (>100 renderer), which blocks *finalising
the cell renderer*, not starting.

### Open questions — Kofi rules before implementation (2 are OWNER CALLs)
1. **REF-2024-XXXX Assessment Reference ID scheme — OWNER CALL.** No column and no ingest path exist today
   (STPSHS assigns these at Year-1 bio-data registration, unbuilt). (a) store the real ID (nullable now,
   placeholder until bio-data ingest lands → **Wells migration 0042**), (b) render `student_code` as an
   interim key, or (c) deterministic placeholder. A manufactured ID that doesn't match STPSHS's real one
   mis-keys the teacher — worse than none. Uniqueness = per student for the 3-year cycle (§2), not per
   subject×period. May need WAEC confirmation of the format.
2. **Column order + portfolio scale.** Confirm no weighted-total column. **Resolve the scale ambiguity:**
   the surface renders portfolio as a single digit (`8`) while the other four are 0–100, but the ledger
   stores portfolio *scaled* to 0–100 (INCR-2 denominator rule: raw 8 /10 → stored 80). Does the sheet emit
   the stored 0–100 uniformly, or de-scale portfolio to its raw denominator to match what the teacher types
   into STPSHS? Changes the renderer.
3. **Which rows qualify:** only `STPSHS_READY`, all `COMPLETE`, or all-including-incomplete (and how blanks
   render / whether the button stays gated).
4. **Granularity:** one sheet per (class × subject × semester); pagination for 37+ roster.
5. **>100 → STPSHS render policy — OWNER CALL (specs silent).** Item 4 Option A lets a category/total exceed
   100 (bonus 11/10 → stored 110); that value can be in `senior_score_ledger` today. On a regulator-facing
   0–100 field: render as-is (110), clamp to 100, or flag/annotate? WAEC-scale compliance call — may warrant
   WAEC confirmation of what STPSHS's numeric field accepts. Blocks finalising the cell renderer only.

### Risk flags
- **>100 → STPSHS compliance (LIVE — was deferred in INCR-2).** A stored 110 must render somehow on a
  regulator artifact; no safe default without Q5. Highest attention.
- **PDF-engine portability** — stay on `@react-pdf/renderer` (no puppeteer/chromium/Vercel PDF service). Dex.
- **Tenant-scoping the read** — all reads via `withSchool` + role gate; consider assignment-scope
  (`senior_subject_teacher`) for a subject teacher vs VHM/Headmaster unrestricted. Sarah + Kofi.
- **Audit the export** — a regulator-submission artifact; log the generation, keep score values out of the
  payload + URL.
- **Server-only data builder** — `lib/data/stpshs-sheet-data.ts` imports the driver; the client button must
  trigger a route/download, never import the data module (only `pnpm build` catches the leak).

### Prerequisites / stop-and-ask
- ✅ `senior-feat` synced to `main` (`e546605`). · WAEC ICTD API is **not** a dependency (PDF now).
- **OWNER CALLs:** Q1 (REF-ID direction, possibly WAEC-confirmed) + Q5 (>100 render rule). Don't let any
  agent pick either silently.
- **Deploy:** IF Wells ships 0042 (stored ref-ID), prod needs the column ALTER (migrate/prod-paste) — **no
  new RLS** (`students` already tenant-RLS'd). IF derived/`student_code`, no migration.

### Critical path

Kofi ✅ + Lucy ✅ + Wells ✅ are done → **implementation is unblocked.** Claude Code: `resolveWeights`
extension → extract API route + adapter → diff/scale engine → roster mapping → verification UI → commit
path → self-verify → three gates → Sarah merge. No owner gate remains on the path.

### Kofi rulings (2026-07-14)

- **Q1 — diff-against-committed; no version/upload/history table in Item 4** (that's Item 7). The only
  new DDL is Q1b's denominator columns. Reason codes ride the existing `recordAudit`→`auditLog`.
- **Q1b — extend `ref_assessment_weights`** with 5 denominator cols (`smallint NOT NULL DEFAULT 100,
  CHECK > 0`); same resolution as weights (subject → school-default → system 100). No new table.
- **Q2 — confidence bands:** ≥0.85 accepted · 0.60–0.85 low-conf (shown, must review) · <0.60 dropped
  to blank (never show a possibly-wrong number).
- **Q3 — four diff cases binding; low-confidence overrides silent-accept; compound (changed AND
  low-conf) always forces review.**
- **Q4 — reason enum + optional free text; mandatory only on score-down and Case-D keep-blank.**
- **Q5 — roster mapping is a mandatory teacher-confirmed step** (§5.2 — highest-severity silent
  failure); never auto-pick an ambiguous name; an absent roster row is NOT a Case-D blank.
- **Q6 — 1..n images → one merged grid, atomic commit; partial coverage allowed but never silent.**
- **Q7 — extraction error degrades to Path C blank grid in place; never a hard failure.**

### INCR-2 · Acceptance criteria (for Quinn)

`raw` = number extracted · `denominator` = resolved per-category value (subject → school-default → 100) · `committed` = current `senior_score_ledger` cell.

**A · Denominator scaling** (🟡 own test class)
- A1 portfolio denom 10, raw 8 → store 80.00. · A2 assignment denom 100, raw 72 → 72.00. · A3 no denom → fall back 100; raw 8 → 8.00 (never inflated). · A4 subject override > school-default > 100. · A5 denom 10, raw 850 → cap MAX_PERCENT (999.99), no overflow. · A6 raw blank → null, not 0. · A7 denom 0 (blocked by CHECK) → insert fails; scaler returns null.

**B · Four diff cases** (§7.2)
- B1 committed blank + extracted ≥0.85 → silent-accept. · B2 committed==extracted → no flag. · B3 76→73 → flagged + reason required. · B4 71→74 @≥0.85 → review, NO reason. · B5 82→blank → highest severity, never auto-nulls, forces keep/re-upload/manual. · B6 71→74 @0.60–0.85 → forces review, not silent. · B7 blank→val @0.60–0.85 → review, not silent-accept. · B8 up/blank→filled/unchanged commit with NO reason; score-down + Case-D keep-blank blocked until reason. · B9 score-down w/ reason → auditLog row before/after + reason; no image in payload.

**C · Confidence bands** (Q2)
- C1 ≥0.85 normal. · C2 [0.60,0.85) low-conf, can't commit until reviewed. · C3 <0.60 blank must-enter. · C4 Path A/C context → no cell ever low-conf styled.

**D · Roster mapping** (🟡 own test class; §5.2)
- D1 "A. Boateng" w/ Akwasi+Abena → row unmapped, commit blocked, no auto-select. · D2 name matching no active student → no commit until mapped/discarded. · D3 active student absent from page → committed row untouched, flagged gap. · D4 two rows → same student → commit blocked. · D5 all rows mapped to exactly one active student → commit proceeds.

**E · Multi-page** (Q6)
- E1 2-page/37-student → one 37-row grid. · E2 commit atomic. · E3 page 2 missing → commit covered only; uncovered untouched + flagged, never blanked.

**F · Cross-path** (§7.4)
- F1 Path A committed values → scan diffs against them. · F2 Path C typed values → same. · F3 scan commit → rows `path_used = SCAN_EXTRACT`, appear in VHM view (regression-check). · F4 wholesale failure, teacher types blank grid → `path_used = DIRECT_ENTRY`.

**G · Transient-image guarantee** (🔴 Sarah gates)
- G1 after commit: no Storage object / column / auditLog payload references or contains the image; zero image columns. · G2 base64 server-side only, key never in client bundle. · G3 extraction error → image still discarded (no temp file, no retained base64, no log/Sentry). · G4 complete/done/keep → in-memory image released.

**H · Fallback** (Q7)
- H1 wholesale failure → blank five-category grid in place, no dead-end. · H2 single sub-0.60 cell → manual-entry blank inside a `SCAN_EXTRACT` grid; `path_used` stays `SCAN_EXTRACT`.

_INCR-2 (Item 4 · Path B) — MERGED to main (PR #139). Bonus marks = Owner Option A (0–999.99 unified across all 3 paths); gone-missing keep-blank requires an active non-`RE_GRADED` reason (server-enforced). All gates green; CodeQL false-positive dismissed. `senior-feat` synced level with main (`e546605`)._

---

## Next increment — INCR-3: Score Ledger Item 8 · STPSHS printable score sheet

**Payoff-first pick** (owner chose over Item 5 PWA). The printable-PDF workaround for STPSHS's
no-bulk-upload constraint (§8.1, §11 item 8). **Not blocked on the WAEC ICTD API** — ships as a PDF now.

**Reuse the existing PDF engine:** `@react-pdf/renderer` (Node runtime, portable — no puppeteer/Vercel PDF
service). Pattern is `app/api/receipts/[paymentId]/route.ts` + `lib/pdf/receipt-document.tsx` +
`lib/pdf/render-receipt.tsx` + `lib/data/receipt-data.ts` + `lib/pdf/fonts.ts`. Invent no new PDF path.

**Done when:** an authenticated SHS subject teacher / VHM / Headmaster can, from a class×subject×semester
ledger, download a print-ready PDF mirroring STPSHS's Capture-Per-Subject screen — one row per active
student in STPSHS column order (**tick · Ass't Ref ID · Student name · Asg · MS · ES · Proj · Port — NO
weighted-total column**, STPSHS computes GPA itself), values read tenant-scoped from `senior_score_ledger`
and **bounded to 0–100 for the regulator** (per Q5 below), paginated for a full roster, generation
**audit-logged** as a regulator-submission artifact. Three gates green.

### Owner decisions — LOCKED (2026-07-15)
- **Q1 REF-ID → add the nullable column now.** Wells ships **migration 0042**: a nullable `stpshs_ref`
  column on `students` (prod = column ALTER only, no new RLS — `students` already tenant-RLS'd). The sheet
  renders **"pending"** in the REF column until a future STPSHS bio-data-registration increment ingests the
  real IDs. Wells is **on the critical path**. Uniqueness = per student for the 3-year cycle (§2).
- **Q5 >100 → flag + block generation + cap to 100 (never silent).** An over-100 category/total is
  **flagged** in the ledger/verify UI; the teacher **cannot generate the STPSHS sheet** until every over-100
  value is resolved (corrected to ≤100, or explicitly acknowledged); the regulator export is **capped at
  100**. The cap only applies after the teacher was forced to see + act on the flag — never silent. The
  internal `senior_score_ledger` value (e.g. 110) is unchanged; only the STPSHS *export* is bounded. (Kofi
  formalises the exact "resolve" gesture + AC; may warrant WAEC confirmation of STPSHS's accepted range.)

### Step table

| Step | Owner | State |
|---|---|---|
| Rulings on the remaining questions (Q2/Q3/Q4) + acceptance criteria (incl. the Q1/Q5 owner decisions above) | Kofi | ⬜ gates everything |
| Surface map — section 3 of `schoolup-shs-score-ledger.html` (STPSHS export) + Capture-Per-Subject layout | Lucy | ⬜ |
| Schema — nullable `stpshs_ref` on `students`, **migration 0042**, dev applied + verified, prod-paste (column ALTER, no RLS) | Wells | ⬜ (on path per Q1) |
| STPSHS-sheet PDF document — `lib/pdf/stpshs-score-sheet-document.tsx` + `render-stpshs-sheet.tsx`, reuse `@react-pdf/renderer` + fonts (mirror receipt) | Claude Code | ⬜ |
| Tenant-scoped data builder — `lib/data/stpshs-sheet-data.ts` reading `senior_score_ledger` + name/REF/weights/period via `withSchool`, server-only, pre-formatted rows, **export values clamped 0–100** | Claude Code | ⬜ |
| Authenticated download route — mirror `app/api/receipts/[paymentId]/route.ts` (`requireSchool` + `assertAnyRole(SENIOR_LEDGER_ROLES)` + `withSchool`), keyed by class×subject×period, streams `application/pdf`, `private, no-store` | Claude Code | ⬜ |
| Over-100 flag + generation gate — flag over-100 cells in the ledger/verify UI; block "Generate STPSHS sheet" until resolved (per Q5) | Claude Code | ⬜ |
| Wire the "Generate STPSHS sheet →" button + status gating (per Q3) | Claude Code | ⬜ |
| Audit-log the export (`recordAudit`→`auditLog`: who / class×subject×period / when; no score values in payload) | Claude Code | ⬜ |
| Build · typecheck · tests · RLS test · preview round-trip (complete ledger → generate → open PDF; cross-tenant denied; over-100 blocks) | Claude Code | ⬜ |
| QA — column order exact, REF-ID render (present + null-placeholder), portfolio scale, pagination 37+ roster, incomplete gating, tenant isolation, over-100 flag+block+cap | Quinn | ⬜ |
| Architecture/portability — stays on `@react-pdf/renderer`, data builder server-only (no client leak), reuses fonts/pattern | Dex | ⬜ |
| Security — tenant-scoped read, route auth + role gate, audit present, no PII in URL/logs, prod parity | Sarah | ⬜ |
| Gate fixes (single aggregated rework brief) | Claude Code | ⬜ |
| Merge · verify via `git log origin/main` · then sync `senior-feat` ← `main` | Sarah + Pence | ⬜ |

### Critical path
Kofi (rules Q2/Q3/Q4 + AC) ∥ Lucy (surface map) ∥ Wells (migration 0042) — all parallel. Claude Code path:
schema-in-hand → data builder (clamp 0–100) → PDF document → download route → over-100 flag+gate → button →
audit-log → self-verify → three gates → Sarah merge → **Pence syncs senior-feat←main**. PDF-document + route
are near-mechanical clones of the receipt path; the real work is the data builder (column mapping + REF
resolution + scale) and the over-100 flag/gate.

### Open questions — Kofi rules before implementation (Q1/Q5 already owner-locked above)
2. **Column order + portfolio scale.** Confirm no weighted-total column. **Resolve the scale ambiguity:**
   the surface renders portfolio as a single digit (`8`) while the other four are 0–100, but the ledger
   stores portfolio *scaled* to 0–100 (INCR-2 denominator rule: raw 8 /10 → stored 80). Does the sheet emit
   the stored 0–100 uniformly, or de-scale portfolio to its raw denominator to match what the teacher types
   into STPSHS? Changes the renderer.
3. **Which rows qualify:** only `STPSHS_READY`, all `COMPLETE`, or all-including-incomplete (and how blanks
   render / whether the button stays gated).
4. **Granularity:** one sheet per (class × subject × semester); pagination for 37+ roster.

### Risk flags
- **>100 → STPSHS compliance (LOCKED via Q5).** Flag + block + cap-to-100; never silent. Quinn gates the
  full flag→block→cap behaviour.
- **PDF-engine portability** — stay on `@react-pdf/renderer` (no puppeteer/chromium/Vercel PDF service). Dex.
- **Tenant-scoping the read** — all reads via `withSchool` + role gate; consider assignment-scope
  (`senior_subject_teacher`) for a subject teacher vs VHM/Headmaster unrestricted. Sarah + Kofi.
- **Audit the export** — a regulator-submission artifact; log the generation, keep score values out of the
  payload + URL.
- **Server-only data builder** — `lib/data/stpshs-sheet-data.ts` imports the driver; the client button must
  trigger a route/download, never import the data module (only `pnpm build` catches the leak).

### Prerequisites
- ✅ `senior-feat` synced to `main` (`e546605`). · WAEC ICTD API is **not** a dependency (PDF now).
- **Deploy:** migration 0042 (nullable `stpshs_ref` on `students`) via migrate/prod-paste — **column ALTER
  only, no new RLS**.

### Prepared inputs — READY
- **Wells** ✅ migration `0042` (`stpshs_ref text` nullable on `students`), applied to dev, `db/sql/prod-paste-0042-stpshs-ref.sql` (column ALTER, no RLS), `docs/senior/incr3-stpshs-ref-schema.md`. Data builder reads `students.stpshsRef`; null → "pending".
- **Lucy** ✅ `docs/senior/stpshs-sheet-surface-map.md` (print/PDF map; gotcha: `✓`/`☐` glyphs tofu on core fonts → draw a bordered `View` for the tick cell; no weighted-total column).
- **Kofi** ✅ rulings + acceptance criteria (below).

### Kofi rulings (2026-07-15)
- **Q2a — column order CONFIRMED:** `✓ · Ass't Ref ID · Student name · Asg · MS · ES · Proj · Port` (8 cols, **no weighted-total column**, no weight sub-labels — STPSHS computes GPA itself).
- **Q2b — DE-SCALE each category:** `exportValue = round2(min(storedPercent,100) × denominator/100)`, denominator via `resolveDenominators` (subject → school-default → 100), trailing zeros stripped, **never round to integer**. Uniform per-category (portfolio `/10` stored 80 → prints `8`; `/100` identity → unchanged). Reproduces the teacher's paper-ledger raw mark (look-and-type parity).
- **Q3 — completeness gate (whole class):** button + **server** permit generation only when every ACTIVE student is `COMPLETE`/`STPSHS_READY` (all 5 categories). Any `DRAFT`/missing → disabled + endpoint rejects. Generated sheet has **no blank category cells** (only placeholder = REF "pending"). One row per active student; withdrawn excluded.
- **Q4 — granularity/pagination:** one sheet per (class × subject × semester); paginate by height; every page repeats header + thead + footer legend + `Page X of Y`; stable roster order. Period label = `academic_period.period_label` → **"Semester 2"/"S2"** (surface "T2" is a mock artifact — logic wins).
- **Q5 formalized — gate → cap → de-scale (server-enforced):** (1) flag over-100 cells in the ledger UI (Path-A `exceedsMax` style); (2) generation endpoint **rejects (4xx)** if any qualifying category `storedPercent > 100` and **no** acknowledgement param, naming offending student+category cells; (3) resolve by **correct-down** (audited edit ≤100) or **acknowledge-and-cap** (explicit param, stored value unchanged, ack in export audit row); (4) cap to 100 **before** de-scale (portfolio 110 /10 → cap 100 → `10`). Server-enforced, not UI-only.
- **Q1 (owner-locked) incorporated:** null `stpshs_ref` → literal `pending`; never gates generation; never manufacture a placeholder ID.

### INCR-3 · Acceptance criteria (for Quinn)
`storedPercent` = `senior_score_ledger` 0–100 · `denominator` = resolved per-category · `exportValue = round2(min(storedPercent,100)×denominator/100)`, trailing zeros stripped.

**A · Structure** — A1 header = `✓·Ass't Ref ID·Student name·Asg·MS·ES·Proj·Port` (8 cols). A2 no weighted-total column, no weight sub-labels. A3 every page: header block (school name/code `WR-WAW-014`/date/`Subject·Year·Semester`) + footer legend + `Page X of Y · Generated by Omnischools`. A4 period label → "Semester"/"S2" (never "Term"/"T"); year from class form (Form 2 → Y2).
**B · De-scale** — B1 portfolio /10 stored 80 → `8`. B2 asgn /100 stored 72 → `72`. B3 portfolio /10 stored 100 → `10`; 50 → `5`. B4 no denom → fall back 100 → identity (not a portfolio special-case). B5 project /20 stored 90 → `18`. B6 stored 71.43 /100 → `71.43` (2dp, not integer); 85 /10 → `8.5`.
**C · Ref ID** — C1 present → verbatim. C2 null → literal `pending`. C3 null REF never blocks generation.
**D · Qualifying gate** — D1 all active COMPLETE/STPSHS_READY → enabled, one row/active student. D2 any DRAFT/missing → disabled **and** endpoint rejects (4xx) if called directly. D3 STPSHS_READY qualifies like COMPLETE (no forced transition). D4 withdrawn excluded; row count = active roster.
**E · No blanks** — E1 every category numeric on a generated sheet. E2 only placeholder is REF `pending` (no `—` category cells).
**F · Granularity/pagination** — F1 one sheet per (class×subject×semester), download keyed by those 3. F2 37 roster → multi-page, header/thead/footer repeat, `Page X of Y`. F3 stable roster order, identical across regenerations.
**G · Over-100** — G1 stored >100 → ledger grid flags cell pre-generation. G2 qualifying category >100 + no ack → endpoint rejects (4xx), names cells, no PDF. G3 correct-down → block clears, generates without ack. G4 acknowledge-and-cap → generates; stored unchanged (110 stays 110); export caps then de-scales. G5 portfolio 110 /10 ack → `10`; asgn 105 ack → `100`. G6 first call unresolved+no-ack rejected **at server**. G7 acknowledged over-cap → ack in export audit row (who/which cells) **without** marks.
**H · Tenant/role** — H1 cross-tenant denied (403/404), reads `withSchool`. H2 route auth + `assertAnyRole(SENIOR_LEDGER_ROLES)`; STUDENT/PARENT/BURSAR denied. H3 TEACHER/FORM_MASTER only for `senior_subject_teacher`-assigned class×subject; HEADMASTER/VHM/ADMIN any within school (Sarah confirms). H4 no PII in URL; `application/pdf`, `private, no-store`.
**I · Audit** — I1 successful generate → one `auditLog` row (actor/class×subject×period/timestamp/`STPSHS_SHEET_GENERATED`). I2 payload no score values, no PII beyond class/subject/period (+ acknowledged cell keys per G7, never marks). I3 rejected generation → no audit row.

### Owner items left (deferrable — proceeding on Kofi's recommended defaults)
- No mandatory `STPSHS_READY` sign-off checkpoint (gate on completeness). — Say so if you want a hard pre-submission sign-off.
- WAEC confirmation of STPSHS's accepted per-mode numeric scale — de-scale-to-raw + cap-to-100 is the safe default meanwhile (fixable without a renderer rewrite).

_INCR-3 (Item 8 · STPSHS score sheet) — MERGED to main (PR #142). All gates green, CodeQL clean. `senior-feat` synced level with main (`3573f07`)._

---

## INCR-4 ✅ MERGED (PR #143, `ef8822f`+`683f7ff`) — Score Ledger Item 5 · PWA phase 1 · NO new migration

> **Scaffolding is a placeholder, not a PWA** (Phase-0 deliverable 7, confirmed): `public/manifest.webmanifest`
> has only a favicon (not installable); `public/sw.js` is a documented no-op pass-through; `components/
> pwa-register.tsx` **does** register `/sw.js` but production-only. Item 5 makes these functional; it does not
> create them.

### Goal
The installable, bad-connection-tolerant **phone** form factor for the score ledger (§5.1). Card/Grid view
toggle, the class-switcher bottom sheet with the "1 of N" pill, and a connection-drop UX that **holds pending
scores locally and retries on reconnect** — **Phase 1 only** (§5.4). The marketing/UX promise is **"works on
your phone, handles bad connections," never "works offline"** (§5.4/§5.5 — binding). Extended offline via
IndexedDB is Item 9; multi-device conflict resolution is Item 10 — both explicitly out of scope.

### Done when
A teacher can: install to the phone home screen (valid manifest + maskable 192/512 icons); open the current
(class×subject×semester) ledger **with no signal** from the SW cache; toggle **Card ↔ Grid** on the same data,
choice persisted per (teacher×subject×class×semester); switch classes via the **bottom sheet** (chevron + "1 of
N" pill, active class named on every screen, current-class default on open, chevron suppressed for single-class);
and, on a connection drop mid-entry, keep working — entered scores show **pending-tinted** under the gold sync
strip ("N scores held locally, will sync when reconnected") and **auto-sync on reconnect** with no lost work and
no false "saved" state. **No IndexedDB, no conflict resolution, no extended-offline promise, no historical-semester
caching.** Tenant-scoped, same auth/data/audit as the web app, three gates green.

### Architecture crux
The save path is the buffer intercept: `SeniorLedgerGrid` calls the server actions `saveDirectLedgerScores`/
`savePortfolioScores` directly. The Phase-1 pending buffer wraps **those calls client-side** (React state +
`online`-event retry) — **not** a service-worker Background Sync queue (RSC action POSTs don't replay cleanly
through the SW). No new schema (class list from `senior_subject_teacher`, chevron status from `ref_anomaly_rule`,
prefs/buffer in `localStorage`).

### Step table
| Step | Owner | State |
|---|---|---|
| Rulings on the 7 open questions + Phase-1 AC (buffer/cache/copy-honesty) | Kofi | ⬜ gates everything |
| Surface map — `Surfaces/schoolup-shs-score-ledger-pwa.html` (view-toggle · class-switcher bottom sheet + "1 of N" · connection-dropped gold sync strip + pending inputs · phased-roadmap panel) | Lucy | ⬜ |
| Confirm **no schema** (class list `senior_subject_teacher`, chevron `ref_anomaly_rule`, prefs/buffer `localStorage`) | Wells | ⬜ confirm-only |
| Make PWA install-complete — maskable 192/512 icons + fill `manifest.webmanifest`; verify `PwaRegister` picks up the real SW | Claude Code | ⬜ |
| SW cache — hand-rolled Cache API: app-shell + current ledger page for signal-less load; portable (no `next-pwa`/Vercel edge/ISR/KV); per-session scoped, cleared on logout (R3) | Claude Code | ⬜ |
| Phone Card/Grid view over the existing five-category data; choice persisted per (teacher×subject×class×semester); non-destructive switch (buffer + cursor preserved) | Claude Code | ⬜ |
| Class-switcher bottom sheet from `senior_subject_teacher` (name/subject/count/completion/status), "1 of N" pill, chevron suppressed for single-class | Claude Code | ⬜ |
| Pending buffer + sync — wrap `saveDirectLedgerScores`/`savePortfolioScores`; hold on failure, retry on `online`, gold strip + pending-tinted inputs, **visible-pending until server-confirmed** (R4), honest copy only (R1) | Claude Code | ⬜ |
| Build · lint · typecheck · self-verify (install on Android; DevTools offline/slow-3G: load-no-signal, drop-mid-entry, reconnect-sync) | Claude Code | ⬜ |
| QA — install/manifest, cache-loads-offline, Card↔Grid parity + persistence, class-switch non-destructive, buffer holds/retries/no-false-saved, **copy never says "offline"** | Quinn | ⬜ |
| Architecture/portability — SW host-agnostic (no `next-pwa`/Vercel), buffer client-side not SW-BackgroundSync, single cache-version constant, cache-bust on deploy | Dex | ⬜ |
| Security — cached authenticated ledger never leaks across sessions/tenants; SW cache cleared on logout; no PII persisted beyond the transient buffer; prod parity | Sarah | ⬜ holds merge |
| Gate fixes (single aggregated brief) | Claude Code | ⬜ |
| Merge · verify `git log origin/main` · **Pence syncs senior-feat←main** | Sarah + Pence | ⬜ |

### Critical path
Kofi ∥ Lucy ∥ Wells (all parallel). Claude Code: install-complete manifest/icons → SW cache → phone Card/Grid →
class-switcher → pending buffer+sync → self-verify → three gates → Sarah merge → Pence sync. Icon step is
soft-gated on Kofi Q4 (brand asset — owner input, below).

### Open questions — Kofi rules before implementation
1. **Buffer persistence boundary vs Item 9.** §5.4 promises "a small buffer that retries on the next connection" and "a drop mid-entry does not lose work." Survive a **tab reload/app-close** (→ `localStorage`), or only a **network drop with the tab open** (→ in-memory React state)? **Hard line: no IndexedDB in Phase 1 (Item 9).**
2. **Cache scope for "loads with no signal."** Confirm = app-shell + the **current** (class×subject×semester) ledger only; **no historical semesters** (§5.5).
3. **Buffer cap.** "Small buffer" / surface shows "3 scores held locally." Cap N? On overflow: block entry, or warn-and-keep? (Must not silently drop.)
4. **Install / manifest / icon assets — OWNER INPUT.** Installability needs maskable 192/512 icons; `public/img/` has none. Brand mark to generate from, or a Phase-1 placeholder icon? (Ties to the owner's outstanding branding items — stop-and-ask if a paid/trademark-sensitive mark.)
5. **View persistence store.** §5.2 Card→Grid default per (teacher×subject×class×semester) — confirm `localStorage`, no schema.
6. **Chevron status scope (creep risk).** §5.3 wants the chevron gold for an STPSHS deadline <7 days + warn-dot for teacher-inactive >14 days (via `ref_anomaly_rule`). Ship the anomaly-driven status in Item 5, or only the plain chevron + "1 of N" + bottom sheet, deferring gold/warn-dot with the rest of VHM anomaly surfacing? _Recommend defer if it balloons._
7. **Pending-sync semantics.** §5.1 "instantly in the web app" applies to **synced** scores only — a pending buffered score is device-local until server-confirmed, must never show as saved on another device (gates R4).

### Risk flags
- **R1 — Marketing honesty (BINDING, churn failure mode).** Never ship "works offline." Connection-dropped + roadmap copy promises only Phase 1. A pending score must **never** render as "saved."
- **R2 — Portability.** SW + manifest are standard web platform — keep them so. **No `next-pwa`** if it adds build-magic/Vercel coupling (hand-rolled SW is the portable choice). Cache API only — no Vercel edge/ISR/KV/Blob. Dex gates.
- **R3 — Caching authenticated content.** The ledger page is `force-dynamic` behind auth; the SW must never serve one user's cached scores to another session. Scope per-session, clear on logout. Sarah gates.
- **R4 — Buffer correctness.** A buffered score that silently fails to sync, or a reload that silently drops the buffer, must be impossible to mistake for saved. Pending stays visibly pending until server-confirmed. Quinn gates.
- **R5 — Scope creep.** The anomaly chevron status (Q6) and cross-view persistence can balloon past Phase 1. Hold the line: bottom sheet + "1 of N" + Card/Grid + buffer ship; anomaly chevron colour defers if it grows.

### Prerequisites / stop-and-ask
- ✅ `senior-feat` level with `main` (`3573f07`).
- **OWNER INPUT — Q4 icon assets:** do we have a brand mark for the 192/512 maskable app icons, or ship a placeholder now + swap later? (Not blocking — a placeholder makes it installable today.)

### Prepared inputs — READY
- **Lucy** ✅ `docs/senior/pwa-ledger-surface-map.md` (4 phone sections, marketing-honesty audit table; token-opacity trap: the pending-sync tint MUST be solid `bg-gold-bg`, verify in live preview).
- **Wells** ✅ confirm-only — **no schema** (class list `senior_subject_teacher`, chevron `ref_anomaly_rule`, view-prefs + buffer `localStorage`).
- **Kofi** ✅ rulings + acceptance criteria (below).

### Kofi rulings (2026-07-16)
- **Q1 — buffer = in-memory React state ONLY.** No `localStorage`, no IndexedDB (Item 9). Survives in-tab, non-destructive transitions (Card↔Grid, class switch); does NOT survive hard reload/app-close. Non-empty buffer → `beforeunload` warning; on reload, cells show last **server-confirmed** value (blank/old for never-synced), never a false "saved."
- **Q2 — cache = app-shell + CURRENT (class×subject×semester) ledger only.** No historical semesters (§5.5). A class not visited this session may not load offline — in-scope, not a bug (honest state, not a false empty roster).
- **Q3 — no hard cap; live count; warn-and-keep; never block, never silently drop.** Warn-threshold = OWNER CALL (recommend **none**).
- **Q4 — icons = OWNER CALL.** Recommend Phase-1 placeholder (gold "O" on navy, tokens `#C8975B`/`#1A2B47`, maskable 192+512) so install ships today; real/trademark mark = owner's swap-later item.
- **Q5 — view prefs = `localStorage`**, keyed (teacher×subject×class×semester); Card default first-use, Grid once chosen; no schema; per-device.
- **Q6 — HOLD the line.** SHIP: plain chevron + "1 of N" pill + bottom sheet (name·subject·count·path·completion, current highlighted, `ready` pill when 5 categories complete — reuse `computeVhmTier`, teacher-scoped) + single-class suppression. **DEFER the chevron *colour*** (gold <7-day STPSHS deadline, >14-day inactivity warn-dot) — it's VHM anomaly surfacing (§6.3, scope creep) AND **blocked on an unmodeled STPSHS-window date** (gold would be fabricated).
- **Q7 — pending ≠ saved anywhere until server-confirmed.** In-memory this device/tab only; never written to `senior_score_ledger`, never visible on desktop / another phone / VHM view / STPSHS sheet until the wrapped action returns `{ok:true}`. **Distinguish transport failure** (reject/offline → hold + retry on `online`, tint stays gold) **from domain `{ok:false}`** (closed period, wrong path, out-of-range → surface as error, never parked silently as "will sync").

### INCR-4 · Phase-1 acceptance criteria (for Quinn)
**INSTALL (Q4)** — I1 manifest declares name/start_url/`display:standalone`/theme+bg colors/192+512 icons incl. ≥1 maskable. I2 Chrome-Android install prompt available (Lighthouse "installable" passes). I3 launches standalone → ledger. I4 placeholder mark inside maskable safe zone.
**CACHE (Q2, R3)** — K1 current ledger opened online once → loads fully offline (shell + roster + last scores). K2 offline + tap unvisited class → honest "can't load without connection" (not blank/false-empty). K3 no historical/closed semester served offline. K4 teacher A logs out → teacher B never sees A's cached scores (per-session, cleared on logout).
**VIEW (Q5)** — V1 Card/Grid parity (same values+totals, one data set). V2 toggle non-destructive (pending buffer+cursor preserved, stay tinted). V3 first use → Card default. V4 chose Grid → reopens Grid (localStorage). V5 localStorage cleared → falls back to Card, no error.
**SWITCH (Q6)** — S1 2 classes → active name + "1 of 2" pill + chevron. S2 exactly 1 class → chevron+pill suppressed. S3 sheet lists all this-semester classes (name·subject·count·path·completion), current highlighted. S4 all-5-complete → `ready` pill; active → `current`. S5 tap class → sheet dismisses, reloads that roster in last layout, audit-logged. S6 pending in class1 → switch to class2 and back → class1 pending still buffered+tinted, cursor preserved. **S7 (deferred guard)** class within 7d of deadline / 14d+ inactive → chevron NOT gold, NO warn-dot in Item 5 (assert absence).
**BUFFER (Q1, Q7, R1, R4)** — B1 online save → strip green, input untinted. B2 drop mid-entry → input gold-tinted, strip gold "Connection lost · N scores held locally, will sync when reconnected", card badge, N = live pending count. B3 keep entering offline → count increments live, never blocked, total computed locally (no cap). B4 `online` fires → buffer auto-flushes via wrapped action; `{ok:true}` → tint clears, strip green, no loss/dup. **B5** non-empty buffer + reload/close → `beforeunload` warning; if proceed, reload shows last server-confirmed value, never "saved." **B6** buffered save returns `{ok:false}` → surfaced as error, not left silently pending. B7 mixed card → only pending cells gold-tinted. B8 no pending online → strip green, no gold UI.
**SYNC (Q7, §5.1)** — X1 device A pending → device B/desktop sees last confirmed value, not A's pending. X2 A confirms → B refresh now sees it. X3 pending not counted as entered in VHM view. X4 pending absent from STPSHS sheet.
**COPY (R1 — binding)** — H1 no user-facing string claims "works offline"/"offline mode"/"available offline" as a Phase-1 capability. H2 connection-drop strip = the honest line, not "offline". H3 roadmap: "offline" only in deferred Phase-2/3 or the negative "not 'works offline'" disclaimer; Phase-1 card claims only "works on your phone · handles bad connections". H4 v1 promise reads "works on your phone, handles bad connections". H5 sync strip always visible when online (green + last-synced).
**SECURITY/PORTABILITY (R2, R3 — Sarah)** — R-1 SW uses only Cache API + hand-rolled fetch (no `next-pwa`, no Vercel edge/ISR/KV/Blob). R-2 single cache-version constant → old cache busted on deploy. R-3 authenticated `force-dynamic` ledger cache cleared on logout, never served cross-session/tenant.

### Owner items (proceeding on Kofi defaults unless told otherwise)
- **Q4 icons:** ship placeholder gold-"O" mark now (installable today), swap real mark later.
- **Q3 warn-threshold:** none (rely on live pending count + `beforeunload`).

---

## INCR-5 ✅ MERGED (PR #144, `d14d8be`+`190888a`) — Score Ledger Item 6 · Omnischools-branded paper ledger book · NO new migration

**A print artifact, not a screen.** §11 item 6 ("design and (optionally) commission the printed
Omnischools ledger book · low-priority engineering, high-marketing-value · pairs with Path B").
The book is the standard template a teacher hand-writes scores into, which Path B then scans (§4.2):
a printed grid with known column positions to help OCR, pre-printed student names in the leftmost
column (Omnischools knows the roster), and a per-page class/subject/semester identifier. **Framed as
a feature, not a transitional artifact** (§4.4) — "Omnischools' name in every classroom."

> **No dedicated surface exists.** The book is described by **spec §4.2** + the Path-B **scan-mock
> corner-stamp** in `schoolup-shs-score-ledger.html` (`.scan-corner-stamp`, line 653:
> `PAGE 1/2 · F2 SCI · MATHS · T2`; line 733 confirms this text *is* the QR's metadata — class ·
> subject · semester · page). Lucy's map is **light**: from the spec + that stamp + brand tokens.

### Reuse the Item 8 (INCR-3) PDF stack — clone, invent nothing
Clone the just-merged STPSHS-sheet pattern one-for-one:
- **Route** — `app/api/senior/stpshs-sheet/route.ts` → `app/api/senior/ledger-book/route.ts`
  (`requireSchool` + role gate + `seniorSubjectTeacher` teacher-scope + `withSchool` tx +
  `runtime="nodejs"` + streams `application/pdf` `private, no-store` + `recordAudit`).
- **Data builder** — `lib/data/stpshs-sheet-data.ts` → `lib/data/ledger-book-data.ts`. Its **exact
  roster+period read is what Item 6 needs** (active students by `classId` ordered `lastName/firstName/id`,
  `academicPeriod.periodLabel`, class/subject/school names — **all existing columns**); strip the
  score columns + export/scale math (the book is blank).
- **Document + render** — `stpshs-score-sheet-document.tsx` + `render-stpshs-sheet.tsx` →
  `ledger-book-document.tsx` + `render-ledger-book.tsx`.
- **Fonts** — reuse `lib/pdf/fonts.ts` core fonts; brand-TTF stays the documented follow-up.

### Done when
An authenticated SHS subject teacher / VHM / Headmaster can, from a class×subject×semester, download a
print-ready **Omnischools-branded blank paper ledger book PDF** — brand header, **pre-printed active-student
roster rows** in the leftmost column, an **empty five-category handwriting grid** (Asg · MS · ES · Proj ·
Port, no weighted-total column), and a **per-page class/subject/semester identifier** (human-readable
corner-stamp mirroring the surface; scannable QR only per the owner ruling on Q2), paginated for a full
roster, the roster read **tenant-scoped**, generation **audit-logged**. **No schema, no migration.** Three gates green.

### Step table
| Step | Owner | State |
|---|---|---|
| Rulings on the 5 open questions + acceptance criteria | Kofi | ⬜ gates everything |
| Surface map (LIGHT) — spec §4.2 + `.scan-corner-stamp` + brand tokens; no dedicated surface | Lucy | ⬜ |
| **Confirm no schema** — roster + period reads already exist (proven by `stpshs-sheet-data.ts`); a QR over existing UUIDs needs no column | Wells | ⬜ confirm-only |
| Data builder — `lib/data/ledger-book-data.ts` (`server-only`), clone STPSHS roster+period read, **minus scores** | Claude Code | ⬜ |
| PDF document — `ledger-book-document.tsx` + `render-ledger-book.tsx`: brand header, pre-printed roster rows, empty 5-category grid, reuse `fonts.ts`, paginate | Claude Code | ⬜ |
| Per-page identifier — human-readable corner-stamp string; **scannable QR only if Kofi/owner require it (Q2)** | Claude Code | ⬜ (QR sub-step soft-gated on Q2) |
| Download route — `app/api/senior/ledger-book/route.ts`, clone STPSHS auth + teacher-scope + `withSchool` + nodejs + `application/pdf` `private, no-store` | Claude Code | ⬜ |
| Wire the ledger surface "Print ledger book →" button (keyed by class×subject×period) | Claude Code | ⬜ |
| Audit-log generation (`recordAudit`→`auditLog`: who / class×subject×period / when; **no PII, no scores**) | Claude Code | ⬜ |
| Build · typecheck · tests · RLS test · preview round-trip (generate → open PDF → cross-tenant denied) | Claude Code | ⬜ |
| QA — roster completeness+order, pagination 37+, blank grid (no scores leak), stamp/QR content, tenant isolation, brand header | Quinn | ⬜ |
| Architecture/portability — `@react-pdf/renderer` (nodejs, no puppeteer/PDF service); QR (if any) pure-JS dep-free via react-pdf primitives; data builder server-only | Dex | ⬜ |
| Security — tenant-scoped roster read, route auth + role gate, **QR/stamp = IDs only (no PII, no marks)**, audit present, prod parity | Sarah | ⬜ holds merge |
| Gate fixes (single aggregated rework brief) | Claude Code | ⬜ |
| Merge · verify via `git log origin/main` · **Pence syncs senior-feat ← main** | Sarah + Pence | ⬜ |

### Dependencies / critical path
Kofi ∥ Lucy ∥ Wells parallel (Wells confirm-only, off the critical path — no schema). Claude Code path:
data builder (clone, minus scores) → PDF document → corner-stamp/QR → download route → button → audit-log
→ self-verify → three gates → Sarah merge → Pence sync. **Document + route + data builder are
near-mechanical clones of the merged Item 8 stack** — the only genuinely new work is a *blank* grid and
the per-page identifier. No owner gate blocks the build path except Q2 (finalising the identifier
sub-step) and Q5 (the header art).

### Open questions — Kofi rules before implementation (Q2 + Q5 carry OWNER CALLs)
1. **Blank vs pre-filled.** _Recommend: blank grid + pre-printed roster names, no scores — the artifact teachers write into._
2. **QR content + format + Path-B consumption — OWNER CALL.** Corner-stamp encodes class × subject × period (the three UUIDs the route is keyed by) + page index. Is a **real scannable QR** required now, or is the human-readable stamp enough? (No QR lib is installed; the only "QR" is a non-functional navy placeholder square in `receipt-document.tsx` — a real QR is net-new.) Does Item 6 **wire Path B to consume** the QR, or is that a separate follow-up? (Item 4 deliberately did NOT OCR the stamp — context comes from the UI — so nothing consumes a QR today.) _Recommend: human-readable stamp only; scannable QR + Path-B consumption deferred to a later item._
3. **Layout.** _Recommend: pre-printed per-student rows, five empty category columns, no weighted-total column, paginate like the STPSHS sheet._
4. **Which roster + ordering.** _Recommend: reuse `stpshs-sheet-data`'s read — active students, ordered `lastName / firstName / id`, deterministic._
5. **Branding — OWNER CALL.** Final logo/trademark, or a token-based placeholder mark like Item 5's gold-"O"? _Recommend: placeholder now, swap the real mark before the print run is commissioned (same posture as INCR-4 Q4)._

### Risk flags
- **QR library portability (LIVE).** No QR dep installed; only precedent is a non-functional placeholder square. Do NOT add a heavy/native dep or hand-roll a spec-compliant encoder. If Q2 requires a real QR: small pure-JS no-native generator rendered via react-pdf `Svg`/`Rect` (mirror Item 5's dep-free icon posture). If stamp-only, the corner-stamp is dep-free and matches the surface.
- **PDF-engine portability.** Stay on `@react-pdf/renderer` `runtime="nodejs"` — no puppeteer/chromium/Vercel PDF service. Dex gates.
- **Tenant-scoping.** All reads via `withSchool` + role gate; teacher-scope via `seniorSubjectTeacher`; mirror the STPSHS route. Sarah + Dex.
- **QR/stamp = IDs only — no PII, no marks.** Book is blank (no scores to leak); identifier carries class/subject/period IDs only. Sarah asserts the roster query never pulls score columns.

### Prerequisites / stop-and-ask
- ✅ `senior-feat` level with `main` (`60a2a66`). · No new migration (Wells confirm-only). · WAEC ICTD not a dependency (paper artifact from data the school owns).
- **OWNER CALLs — don't let an agent pick silently:** Q2 (scannable-QR required? + Path-B consumption in scope?) and Q5 (branding mark).

### Kofi rulings + owner decisions (2026-07-16) — ALL 5 questions ruled
- **Q1 blank vs pre-filled → BLANK** (pre-printed ACTIVE names, no scores — the handwriting source Path B scans).
- **Q2 corner-stamp → OWNER: TEXT STAMP ONLY.** No scannable QR, no QR library; Path-B consumption is a separate later item. Nothing consumes a QR today.
- **Q3 layout → CONFIRM + label fix.** Name + 5 empty columns `Asg · MS · ES · Proj · Port`; NO weighted-total / tick / REF-ID columns; paginate like the STPSHS sheet (`wrap={false}` rows, fixed header/thead/footer). **Use `Proj`/`Port`, not the scan-mock's `Pj`/`Pf`** (match the shipped STPSHS sheet a teacher holds alongside).
- **Q4 roster → CONFIRM.** Reuse `stpshs-sheet-data`'s read verbatim — ACTIVE students of the class, ordered `lastName/firstName/id`, deterministic (reprint parity).
- **Q5 branding → OWNER: token placeholder** (gold-"O"-on-navy, Item-5 posture); real trademark swaps in before the print run is commissioned.
- **Spare rows → OWNER: YES, ~4 blank unlabeled rows** after the roster (AC §I) — hand-add late-enrolled students without reprinting; excluded from the audit/active count.
- **Semester wording (domain must-fix):** render `S2`/`Semester 2`, NEVER `T2`/`Term` (SHS = semesters; the mock's `T2` on line 653 is corrected to `S2` by the surface's own line-733 note). Reuse the existing `semLabel` helper.

### INCR-5 · Acceptance criteria (for Quinn)
Book is **blank** (no scores anywhere). "Roster" = ACTIVE students of the requested class. Stamp/header labels human-readable, never UUIDs.
- **A · Roster & ordering.** A1 one row per ACTIVE student of the class; A2 order `lastName→firstName→id`, byte-identical across regenerations (reprint parity); A3 non-ACTIVE get no row; A4 subject/period scope the book's identity, not who appears (an unenrolled-in-subject class member still gets a blank row — inherited Item-8 behaviour, acceptable for a blank book); A5 empty class renders header+stamp+thead, never 500.
- **B · Grid (blank, labelled).** B1 columns L→R: `Student name · Asg · MS · ES · Proj · Port`; B2 every category cell visually empty (no digit/`—`/`0`); B3 NO total/tick/REF-ID column, no weight sub-labels; B4 headers `Asg/MS/ES/Proj/Port` (never `Pj/Pf`), footer legend spells them out; B5 no score anywhere — the builder never touches `senior_score_ledger` (Sarah asserts).
- **C · Corner-stamp.** C1 every page `PAGE x/y · <class> · <subject> · <semester>` (mirrors surface); C2 semester renders `S2`/`Semester 2`, never `T2`/`Term`; C3 labels + page index ONLY — no name/score/teacher/raw-UUID; C4 plain text, NOT a QR and NOT the receipt doc's navy placeholder square (honesty gate); C5 page index correct (`PAGE 2/2` on page 2 of a 37-row book).
- **D · Pagination (37+).** D1 brand header repeats every page (fixed); D2 column-header row repeats every page; D3 footer (legend + `Page X of Y · Generated by Omnischools`) repeats; D4 rows never split (`wrap={false}`); D5 multi-page book fully formed each page, continuous ordering, no drop/dupe.
- **E · Brand header.** E1 gold strip + navy header + "Omnischools" + token placeholder mark; E2 school name + GES code + `Subject · Year · Sem`; E3 no real trademark asset required to generate.
- **F · Tenant/role.** F1 roster read inside `withSchool` + `eq(schoolId)`, another tenant's class → 404/403, zero rows; F2 route requires auth + `SENIOR_LEDGER_ROLES` (STUDENT/PARENT/BURSAR denied); F3 TEACHER/FORM_MASTER only for their `seniorSubjectTeacher` class×subject, HEADMASTER/VHM/ADMIN any class in own school; F4 no PII in URL, `application/pdf` `private, no-store`.
- **G · Audit.** G1 one `auditLog` row per success (actor / class×subject×period / ts / `LEDGER_BOOK_GENERATED`); G2 payload has NO names/scores; G3 denied/failed writes no PII-bearing row.
- **H · Honesty.** H1 no QR/scannable element (C4); H2 no total or other computed column; H3 no pre-filled scores, no "auto-graded/auto-read" copy; H4 medium-agnostic copy (never states the book is required or own-formats inferior).
- **I · Spare rows (owner-adopted).** I1 ~4 blank UNLABELED rows after the roster (final page), same 5 empty columns, empty name cell; I2 excluded from A1's active count and the audit payload.

### Domain traps (Kofi)
- **Trap 1 — "Term" vs "Semester" (must-fix):** SHS = 2 semesters; never print `T2`/`Term`. Enforced by C2 + `semLabel`.
- **Trap 2 — spare rows: RESOLVED** (owner: ~4 rows, AC §I).
- **Trap 3 — `Pj/Pf` vs `Proj/Port`: RESOLVED** (Q3 → `Proj/Port`; flagged so nobody re-corrects it from the mock).
- **No trap on** portfolio scale hint (`/10` on the header) — Path B reads the denominator from config at scan time, not the book; adding it re-introduces scale math we deliberately stripped. Leave plain labels.
- **No trap on** teacher identity in the stamp — keep the teacher OUT (needless staff PII; route already keyed by class×subject×period).

---

## INCR-6 ✅ MERGED (PR #145, `1a326d2`+`4fae2b5`) — Score Ledger Item 7 · versioned upload + supersedes-chain · migration 0043 · CLOSES MODULE 4.1
### CLOSES MODULE 4.1 (last of Items 1–8) — ⚠️ prod deploy: hand-paste `prod-paste-0043-ledger-versions.sql`

> **⛔ BLOCKED ON OWNER before Wells cuts schema.** Three questions are genuine OWNER CALLs that
> shape the table, not Kofi's to settle: **Q1 (version granularity)**, **Q3 (revert)**, **Q6
> (retention)**. Kofi + Lucy proceed in parallel meanwhile; Wells (heavy, critical path) does not
> start until Q1/Q3/Q6 land.

### What Item 4 built vs. what Item 7 adds (the deferred half of Path B)
Item 4 (INCR-2) ships **diff-against-committed**: `scan-diff.ts` compares each extracted cell to the
**single live `senior_score_ledger` row**, and `commitScanLedger` **overwrites** that row on commit
(`onConflictDoUpdate`). The only prior-value trace is `audit_log` — and only for *reasoned* corrections
(score-down + gone-missing); silent-accepts / score-ups / unchanged cells leave no snapshot. **There is
no retained version; the surface's "supersedes the 8 May mid-sem upload" provenance (surface line
638/729) is not backed by stored data.** Item 7 adds the **retained, immutable version snapshot +
supersedes self-FK** (§7.1). The diff *engine* is reused — the current row stays the latest-version
projection; the new work is persisting the snapshot + supersedes pointer on commit and making the
provenance real.

### Goal
Every ledger commit becomes a retained, immutable **version** of the record, linked to the version it
**supersedes** (self-referential, tenant-scoped). The latest verified version feeds downstream (STPSHS
sheet, VHM view, report cards); earlier versions are kept for audit + diff-comparison, backing the
surface's "uploaded <date> · supersedes the <date> upload" provenance.

### Done when
A teacher who uploads (Path B) a second time over an existing ledger sees a **real** provenance line
sourced from a stored prior version (not a fabricated string); the prior grid is retained immutably and
never overwritten; the diff still flags the four §7.2 cases against the prior version; the committed grid
becomes the new latest version with a supersedes pointer to its predecessor; downstream reads (STPSHS
sheet, VHM progress, report cards) draw the **latest** version, output unchanged; history is visible only
to roles Kofi/owner rule in (never student/parent churn, never score values in the VHM counts-only view
§6.2); Paths A/B/C write paths and the STPSHS completeness/over-100 gates are **not broken**; all history
logic in `lib/` (no DB triggers); tenant-scoped, audit-logged, three gates green. **Module 4.1 closes.**

### Step table
| Step | Owner | State |
|---|---|---|
| Rulings on the 7 open questions + acceptance criteria (**Q1 granularity gates the schema shape**) | Kofi | ⬜ gates Wells |
| Surface map — provenance lede (surface line 638) + "changes since prior upload" panel (lines 693–720). **Finding: NO dedicated history screen; reuse the shipped Path-B verify UI + make the provenance line real.** Confirm if Q4 wants a light "view versions" read | Lucy | ⬜ (light) |
| **Schema (HEAVY — critical path).** New tenant table `senior_score_ledger_version` (grain per Q1) snapshotting the five categories + weighted total + status + path_used + committed_by/at; **composite supersedes self-FK `(school_id, supersedes_id) → (school_id, id)`**; version-number uniqueness per grain; indexes; **`tenant_isolation` FORCE RLS**; migration **0043** dev-applied + verified; **prod-paste-0043 RLS SQL** | Wells | ⬜ blocked on Q1/Q3/Q6; blocks Claude Code |
| Versioned-write path — on every commit, persist an immutable version snapshot + set the supersedes pointer to the prior latest; the current `senior_score_ledger` row stays the "latest verified" projection; reuse `scan-diff.ts` diff engine unchanged | Claude Code | ⬜ blocked on Wells |
| Provenance surfacing — wire the real "uploaded <date> · supersedes the <date> upload · N changes" line + "changes since prior upload" from the version chain (replaces the mock string) | Claude Code | ⬜ |
| History read (CONDITIONAL on Q4) — list prior versions for a grain, role-gated; **never expose score churn to student/parent, never to the VHM counts-only view** | Claude Code | ⬜ (conditional) |
| Build · typecheck · tests (snapshot + supersedes-chain, pure lib) · RLS test · preview round-trip (two uploads → chain + diff + downstream reads latest; cross-tenant denied) | Claude Code | ⬜ |
| QA — version retained/immutable, supersedes-chain correct, diff still fires all 4 cases, latest feeds downstream, Paths A/B/C unbroken, gates re-evaluate per Q5, concurrency (two commits racing), tenant isolation | Quinn | ⬜ |
| Architecture/portability — history logic in `lib/` (no DB trigger); composite self-FK correct; version table (snapshot) not a dup of `audit_log` (event log); optimistic-version / last-writer concurrency guard | Dex | ⬜ |
| Security — version rows tenant-scoped (RLS FORCE), prod-paste RLS parity, no cross-tenant read, history role-gated, no score values leaked to VHM/student/parent, prod parity | Sarah | ⬜ holds merge |
| Gate fixes (single aggregated rework brief) | Claude Code | ⬜ |
| Merge · verify via `git log origin/main` · **Pence syncs senior-feat ← main** | Sarah + Pence | ⬜ |

### Dependencies / critical path
**Wells is ON the critical path (unlike Item 6).** Kofi (Q1/Q3/Q6 owner-ruled first) ∥ Lucy (light map)
in parallel, but **Claude Code's write path blocks on Wells's schema**, and Wells blocks on the owner
ruling Q1/Q3/Q6. Sequence: owner rules Q1/Q3/Q6 → Wells (table + composite self-FK + RLS + 0043 +
prod-paste) → Claude Code (versioned-write + provenance + conditional history) → self-verify → gates →
Sarah merge → Pence sync. The diff engine (`scan-diff.ts`) is **reused, not rewritten**.

### Open questions — Kofi rules before implementation (Q1/Q3/Q6 are OWNER CALLs)
1. **Granularity — OWNER CALL (schema-shaping).** Per cell / per `(student×subject×period)` row / per
   upload batch? §7.1 says "each *upload* is a version" (batch, surface line 638) but "a version of the
   *record*" (row). _Recommend: per-row snapshot grouped by a commit-batch id — batch gives the
   "supersedes the 8 May upload" line, per-row gives queryable history + diff at the ledger's grain._
2. **Supersede + immutability.** New commit supersedes the whole prior version; prior retained immutable
   (append-only)? _Recommend: append-only immutable; new version self-FKs the prior; current row = latest
   projection._
3. **Revert — OWNER CALL.** Can teacher/HM restore a superseded version, or read-only? _Recommend:
   read-only for Item 7 — a "revert" is a fresh commit of the old values through the same diff+audit, no
   special restore path._
4. **Who sees history.** Teacher/VHM/HM/admin/auditor; student/parent never see churn. Constraint: VHM
   view is counts-only, NEVER values (§6.2) — history-with-values must not leak there.
5. **Superseding commit re-open gates?** Re-pass Q3 completeness / Q5 over-100 / STPSHS_READY? _Note:
   those gates evaluate the current row at generate-time, so they re-evaluate naturally on the new latest —
   confirm no extra lock intended._ (Kofi rules, check-in.)
6. **Retention — OWNER CALL.** Keep all forever or cap/prune? _Recommend: keep all for the academic cycle;
   revisit prune only if volume bites (YAGNI)._
7. **STPSHS + Path A/C interaction.** (a) Can an already-`STPSHS_READY`/exported ledger still be
   superseded, and does that invalidate a generated sheet? (No export lock today.) (b) Do Path A/C also
   version, or only Path B? _If only B, the chain has cross-path gaps — decide if A/C snapshot too (touches
   shipped write paths)._ (Kofi rules, check-in.)

### Risk flags
- **Migration ORDERING + composite-FK rule.** Supersedes self-FK is intra-tenant → **composite
  `(school_id, supersedes_id) → (school_id, id)`**, needs the composite tenant UK `(school_id, id)` in
  place before the self-FK. Emit: table-create → tenant-UK → `ALTER TABLE ADD` self-FK (recall the 0033
  FK-before-UNIQUE class of bug). Wells verifies DDL ordering.
- **NEW tenant table ⇒ prod-paste RLS (explicit deploy step).** `db:policies` hits dev only; the new
  table needs `tenant_isolation` FORCE RLS hand-pasted on prod via `db/sql/prod-paste-0043-ledger-versions.sql`
  or it leaks across schools.
- **Write-path concurrency.** Two commits racing to supersede the same latest → collide on
  predecessor/version-number. Need last-writer / optimistic version check (unique `(grain, version_number)`
  or guarded read-then-write).
- **Don't break shipped Path A/B/C or the STPSHS gates.** `saveDirectLedgerScores`, `savePortfolioScores`,
  `commitScanLedger` all upsert `senior_score_ledger` today; version writes must be additive.
- **Portability.** Version + supersedes logic in `lib/` (mirror `compute.ts`/`scan-diff.ts`), NEVER a DB
  trigger. Dex gates.
- **Don't duplicate `audit_log`.** Version table = queryable full-grid snapshot; `audit_log` = append-only
  event log. Keep distinct.

### Prerequisites / stop-and-ask
- ✅ `senior-feat` level with `main`, ahead by `190888a` (Item-6 follow-ups). Next migration is **0043**
  (latest `0042`). New-tenant-table prod-paste pattern established (`prod-paste-0038/0039/0040`).
- **OWNER CALLs before Wells cuts schema — don't let an agent pick silently:** Q1 (granularity), Q3
  (revert), Q6 (retention). Q5 + Q7 are Kofi's with a check-in.
- **Deploy note (pre-write for merge):** migration 0043 (new table + composite self-FK + RLS) via migrate,
  **plus hand-paste `prod-paste-0043-ledger-versions.sql` on prod**.

### Owner decisions on the three schema-shaping calls (2026-07-16) — Wells UNBLOCKED
- **Q1 granularity → PER-ROW + BATCH TAG.** One immutable snapshot per `(student×subject×period)` per
  commit, tagged with a commit/upload `batch_id` — batch backs the "supersedes the <date> upload"
  provenance; per-row gives queryable per-student history + diff at the ledger's grain.
- **Q3 revert → READ-ONLY HISTORY.** No restore mutation path in Item 7; "undo" = a fresh commit of the
  correct values through the normal diff+audit (becomes a new version). A one-click restore can be added
  later with no schema change.
- **Q6 retention → PERIOD-SCOPED, PRUNE ON ROLLOVER.** Keep versions only for the **current semester/term**;
  **prune the prior period's version snapshots at the start of the next semester/term.** The version grain
  already carries `periodId`, so this is a period-scoped DELETE — **no retention column needed**; the
  finalised latest values stay in `senior_score_ledger` (only the version *history* snapshots are pruned).
  **OPEN (Kofi/Wells to pin, NOT an owner call):** what concrete event fires the prune — an academic-period
  activation/rollover action, period-close, or lazy prune-on-first-write-to-new-period? Find the existing
  period-rollover hook (or flag its absence) and attach the prune (a `lib/` function, never a DB trigger /
  external cron). Wells indexes the version table on `periodId` for an efficient prune.

### Kofi rulings + AC (2026-07-16) — Wells UNBLOCKED
**Q2 supersede/immutability → CONFIRM append-only immutable.** Each commit writes one new snapshot per
grain that self-FKs the *existing* prior latest for that grain (composite `(school_id, supersedes_id)→
(school_id, id)`), sharing one `batch_id`; snapshots never UPDATE/DELETE except the Q6 prune; live
`senior_score_ledger` row = latest projection.
**Q4 who sees history → inherits the ledger EDIT-surface gate; NOT a new surface.** `SENIOR_LEDGER_ROLES`
(ADMIN/HEADMASTER/VICE_HEADMASTER_ACADEMIC/TEACHER/FORM_MASTER); TEACHER/FORM_MASTER scoped to their
`senior_subject_teacher` class×subject. NEVER on the VHM counts-only progress view (§6.2), NEVER
student/parent. **No AUDITOR role exists** — `audit_log` serves that need; no new role/grant.
**Q5 gate re-open → CONFIRM natural re-evaluation, no explicit re-lock.** Completeness/over-100/
STPSHS_READY already evaluate the current row at generate-time = the new latest, so they re-evaluate
automatically; STPSHS_READY carry downgrades naturally if a supersede breaks completeness.
**Q7(a) STPSHS/export → an STPSHS_READY/exported ledger CAN be superseded while the period is OPEN;** the
real lock is `closedAt` (not export). A generated sheet is a point-in-time audit-logged artifact — a later
supersede doesn't mutate it; the next generation reflects the new latest. No hard export lock in Item 7.
**Q7(b) paths → VERSION ON PATH B (`commitScanLedger`) ONLY.** Path A (`compileLedgerContext`) + Path C
(`saveDirectLedgerScores`/`savePortfolioScores`) keep writing `senior_score_ledger` UNVERSIONED, as today.
**SCOPE-HOLD (deliberate):** routing A/C through a shared snapshot helper would mint a version on *every*
mark entry (`saveAssessmentScores`→compile), exploding volume + trivializing the §7.1 upload-checkpoint
provenance. The §7.4 cross-path case is still caught — the Path-B scan diffs against the live (A/C) values
before committing its own version. A versioned Path-C checkpoint, if ever wanted, is a distinct explicit
save gesture (NOT the incremental PWA save) — flagged, not built.

**PRUNE TRIGGER (pinned):** NO period-activation/rollover action exists; only `closeTerm`/`reopenTerm`
(`lib/actions/terms.ts`) + `updateAcademicPeriods` (`settings.ts`); "current period" is derived (date
windows), the ledger lifecycle gate is `academic_period.closedAt`. `closeTerm` is REVERSIBLE, so a
destructive prune-on-close is a footgun (close→prune→reopen loses history). → **Ruling: LAZY
prune-on-version-write keyed off `closedAt`.** `prunePriorPeriodVersions(tx, schoolId)` runs inside the
versioned-write helper (same tx), deletes `senior_score_ledger_version` rows whose `periodId` maps to an
`academic_period` with `closedAt IS NOT NULL`; a REOPENED period (`closedAt`→NULL) is spared; index on
`periodId`. `ponytail:` ceiling — a school that never closes a period never prunes (acceptable; no
corruption). Supersedes always resolved from the *existing* latest at write time (or NULL), so a prune can
never leave a dangling FK.

#### INCR-6 · Acceptance criteria (for Quinn)
`grain` = `(school×student×subject×period)`. `version` = a `senior_score_ledger_version` snapshot.
`latest` = the live `senior_score_ledger` row.
- **A · Snapshot retained + immutable.** A1 a Path-B commit changing ≥1 cell writes one new version per
  covered grain; prior row byte-unchanged. A2 second commit → BOTH snapshots present. A3 no path (but the
  Q6 prune) UPDATE/DELETEs a version; category values/`batch_id`/`committed_by/at`/`supersedes_id`
  write-once. A4 `senior_score_ledger` upsert unchanged from Item 4 (version write is purely additive).
- **B · Supersedes-chain (per-row + shared batch_id).** B1 first commit → `supersedes_id=NULL` (genesis),
  provenance shows "uploaded <date>" with NO supersedes clause. B2 second → `supersedes_id`=prior latest
  id, chain length 2. B3 all grains in one commit share one `batch_id`, distinct from any prior. B4
  `supersedes_id` references an existing version in the SAME grain+school (co-periodic) or NULL — never
  cross-grain/cross-tenant. B5 partial re-upload → only covered grains get a new version+supersedes; the
  `batch_id` spans only covered grains. B6 a no-op commit (payload == latest) writes a version only when
  the diff yields ≥1 accepted change (no empty churn; if impl snapshots unconditionally, provenance "N
  changes" must still read 0 honestly).
- **C · Diff still fires all four §7.2 cases (regression).** C1 blank→filled silent-accept, unchanged→no
  flag, score-down→reason, gone-missing→never-auto-null all fire as Item 4 (`scan-diff.ts` unchanged). C2
  score-down/gone-missing reasons still land on `audit_log` before/after.
- **D · Provenance from stored data (not fabricated).** D1 line fields: uploaded=new version
  `committed_at`; supersedes=superseded version's `committed_at`; N=cells differing new-vs-prior — all from
  stored rows. D2 genesis → omit supersedes clause (never a placeholder/mock date; retires surface
  line-638 mock). D3 "changes since prior upload" panel enumerates exactly the cells differing new-vs-
  immediately-superseded.
- **E · Downstream reads LATEST, output unchanged.** E1 STPSHS sheet/VHM/report cards read the new latest;
  a superseded version never feeds downstream. E2 downstream bytes/counts/totals identical to pre-Item-7.
- **F · Period-scoped prune.** F1 a version-write into an open period deletes only versions whose period is
  CLOSED; open-period snapshots survive. F2 prune never touches `senior_score_ledger`. F3 a REOPENED period
  is spared. F4 a commit into a grain whose priors were pruned → fresh genesis (supersedes NULL), no
  dangling FK. F5 prune tenant-scoped, `lib/` call in the write tx (no trigger/cron).
- **G · Role-gated history — no value leak.** G1 reachable only via the ledger edit surface,
  `assertAnyRole(SENIOR_LEDGER_ROLES)`; STUDENT/PARENT/BURSAR/boarding roles denied. G2 TEACHER/FORM_MASTER
  only their assigned class×subject; HM/VHM/ADMIN any in-school. G3 VHM counts-only view shows NO history/
  values/churn (§6.2). G4 report cards show only finalised latest.
- **H · Paths A/B/C + STPSHS gates unbroken.** H1 Path A/C produce identical `senior_score_ledger` to
  pre-Item-7 (no version per incremental write). H2 STPSHS completeness/over-100/STPSHS_READY behave as
  INCR-3 on the new latest. H3 closed-period guard still blocks every write (no version on a closed period).
- **I · Concurrency.** I1 two concurrent Path-B commits for the same grain → exactly one vN+1 persists;
  loser retries or fails cleanly; never two rows with the same `(grain, version_number)`, never a lost
  `senior_score_ledger` update (unique `(school_id,student_id,subject_id,period_id,version_number)` or
  guarded read-then-write). I2 no two versions share a `supersedes_id` pointing at the same prior.
- **J · Tenant isolation.** J1 version rows `tenant_isolation` FORCE RLS; cross-tenant read → 0 rows/403-404.
  J2 composite supersedes self-FK makes a cross-tenant supersedes structurally impossible. J3 prod-paste-0043
  parity verified.

#### Domain traps (Kofi)
- Trap 1 — batch_id on partial re-upload: HANDLED, test (B5); it groups only covered grains, not "all
  re-versioned". Trap 2 — first commit no predecessor: HANDLED (B1/D2), never fabricate a date. Trap 3 —
  pruned prior period + dangling FK: NO TRAP (supersedes is co-periodic; prune deletes whole co-periodic
  chains; resolved from existing rows at write time). Trap 4 — reopen-after-close: HANDLED by keying prune
  on `closedAt` (F3). Trap 5 — resit/withdrawal mid-history: minor, no special path (non-ACTIVE skipped;
  priors freeze until prune). No trap on §7.4 cross-path (Path-B-only still catches it).

#### Deferrable OWNER items (proceeding on Kofi defaults unless told otherwise)
- **Standalone multi-version history browser — NOT built** (YAGNI; the real lede + diff panel satisfy
  §7.1–7.3). Q4 conditional "view versions" screen is NOT designed.
- **STPSHS "sheet is stale" hint — NOT built in Item 7.** Recommend later a soft note ("ledger changed
  since the last STPSHS sheet on <date>", from `STPSHS_SHEET_GENERATED` audit ts vs latest `committed_at`)
  rather than a hard export lock. Owner may request the hard re-generate lock later.

### Lucy surface map (LIGHT) — no dedicated history screen
**CORRECTION to Pence:** the provenance lede is **NOT shipped** — `grep supersede` is zero hits in
`app/`+`components/`+`lib/` (docs only); the mock string lives ONLY in `Surfaces/schoolup-shs-score-
ledger.html` line 638. Shipped `scan/page.tsx` `Head` (228–249) renders crumb + h1, NO lede sub-line. So
Item 7's provenance work is **ADDITIVE — add a new server-fed lede element under the h1**, not swap a prop.
- **Provenance lede** (surface line 638 verbatim: `Uploaded 26 June 2026 · supersedes the 8 May mid-
  semester upload · 4 changes to review`). Tokens: `.lede` = `13px`, `navy-3 #5C6675`, `max-width:820px`;
  emphasis `navy-2 #2D3F5C` `font-weight:600`; Manrope; no gold; no slash-opacity. Add under the h1 in
  `scan/page.tsx` `Head` (~line 245). **Three fields, two sources:** `uploaded <date>` = new version
  `committedAt`; `supersedes the <date> upload` = prior latest version `committedAt` (NEW query in the
  `withSchool` block — the real work); `N changes` = the LIVE `changes.length` already computed in
  `ScanWorkspace` (scan-workspace.tsx 292–326), do NOT stale-duplicate it server-side.
  **First-upload state:** no predecessor → `Uploaded <date> · first upload for this semester`, suppress the
  supersedes clause entirely. **"mid-semester" honesty flag:** that descriptor is NOT a stored field at the
  per-row+batch grain — drop it; the honest line is `supersedes the <date> upload`.
- **"Changes since prior upload" diff panel — REUSE UNCHANGED.** Shipped `ChangesPanel` (scan-workspace.tsx
  715–818), baseline = the `committed` prop = current `senior_score_ledger` row = the latest-version
  projection, so it already diffs against "the prior upload" with zero change. Header keep the shipped
  honest neutral `Changes since the committed ledger · {N} to review` (surface's "mid-semester" is mock).
  The four §7.2 kinds already render: SILENT_ACCEPT (gold), REVIEW (warn), SCORE_DOWN (warn + reason),
  GONE_MISSING (terra + reason). Item 7 does NOT touch this panel.
- **Copy/honesty (binding):** no false supersede on a first upload; NO restore/undo language anywhere (Q3
  read-only — no "Restore v1" control; "undo" = a fresh commit); no stored mid-sem/end-sem claim unless
  derived; don't stale-duplicate the change count.

---

# MODULE 4.2 — BOARDING

**Branch:** `senior-feat` off `main`. **Cadence:** milestone merges, one per increment, independent branches off
`main` (not stacked — verify each landed via `git log origin/main`). **Spec authority:** `md files/BUILD_STACK.md`
"Boarding · architectural decisions worth preserving" (9 decisions — **constitution, wins on conflict**) ·
`INSTRUCTIONS_FOR_CLAUDE_CODE.md` §4.2 · `README.md` §"SHS · Boarding" (lines 372–427, ~15-table schema sketch).
**Cross-cutting rule (BUILD_STACK #1):** Boarding is **structurally adjacent** to the school module — the only join
is `residency_type` on the student; every boarding surface filters on it, every academic surface ignores it; a
day-only school flips the whole module off. **F0 partially shipped already:** `houses` table, `students.house_id`
(composite FK, SET NULL), `students.residency` enum (BOARDER/DAY/DEBOARDINIZED); roles HOUSEMASTER/DEAN_OF_BOARDING/
MATRON already in `appRoleEnum`. Next migration **0044**.

### Surface inventory (7-file `Surfaces/schoolup-boarding-*.html` batch)
| # | Surface | Screen |
|---|---|---|
| 01 | programme-setup | Config OS — 6 Houses (gender·colour·capacity·resident HM), daily rhythm template, 3 policy doctrines (exeat quota, visiting, deboardinization ladder), GES calendar |
| 02 | house-roster | Housemaster spatial view — House strip, 5 prefect cards, 8 dorms A–H × 15 bunks = 120 beds, **bunk = the unit**, drag-reassign (logged), bunk states, student detail card |
| 03 | resumption-day | Twice-a-year ops — staggered arrival windows by Form, prospectus 6-pip checklist, fee-owing flags; same surface flips to Vacation mode |
| 04 | daily-life | Housemaster live daily view ("used most") — half-hour timeline, morning inspection, prep, sick-bay/exeat counts |
| 05 | exeat-management | Exeat workflow — request→review→card→depart→return, approval chain, fee-owing-collect, return-by-16:00 + late SMS, printable card (PDF) |
| 06 | visiting-day | Digital Visitor's Book — 2nd-Sunday, parent RSVP via SMS, approved-visitor list (max 6), gate verification, zones |
| 07 | discipline | 5-rung append-only ladder (Note→Warning→Bond→Suspension→Deboardinization), DB-enforced co-signs, Board-review, **3× fee penalty → auto-invoice (first discipline→billing trigger)**, VLC pastoral bypass |

### Roadmap — INCR-7…13 (dependency graph)
```
INCR-7 (F0 spine + roster) ──┬─> INCR-8 (config OS) ──┬─> INCR-9  (Exeat)      [+billing read, +comms, +PDF]
   [gates EVERYTHING]        │   [config before        ├─> INCR-10 (Daily life) [+inspections]
                             │    its consumers]        └─> INCR-13 (Discipline) [+billing penalty, +VLC stub] ← CLOSER
                             ├─> INCR-11 (Resumption/Vacation)  [spine + billing read only]
                             └─> INCR-12 (Visiting day)         [spine + comms; near-independent]
```
- **Critical path:** INCR-7 → INCR-8 → INCR-13. **INCR-7 is the trunk** (all block on it). 9/10/13 hang off 8; 11/12 hang
  off 7 directly. 9/10/11/12 are independent siblings — branch each off `main` after its parent lands (orphan-PR trap).
- Payoff-first among siblings is a live reprioritisation lever once 7+8 merge.
- **Forward dep:** INCR-13's VLC pastoral bypass reads `vlc_pastoral_flags` (module **4.5**, after Boarding) → **stubbed** in 4.2.
- Draft each of INCR-8…13's board when its predecessor merges (roadmap one-liners suffice to sequence now).

## Next increment — INCR-7 · Boarding F0 — House→Dormitory→Bunk spine + residency + House Roster · migration 0044

> **Nothing blocks INCR-7.** Kofi + Lucy start now; Wells waits only on Kofi's OQ1 (residency/bunk schema shape —
> a Kofi call under BUILD_STACK authority, NOT an owner call). The 7 module-scope OWNER decisions (below) gate
> INCR-9/11/12/13, NOT F0 — rule them in parallel.

### Goal
The spatial/residency bedrock: the **House → Dormitory → Bunk** three-level hierarchy with the **bunk as primary
spatial key** (BUILD_STACK #2) + the residency join (BUILD_STACK #1). Ships **surface 02 (house-roster)** as the
first payoff so a Housemaster can see + manage where every boarder sleeps.

### Done when
An authenticated Housemaster (or Senior HM / Headmaster / Admin) opens their House roster: House identity strip
(gender·capacity·resident HM·filled/vacant), all **8 dormitories × 15 bunks**, each occupied bunk showing its
boarder + the four bunk states (prefect·pastoral-flag·moved-this-sem·vacant); click a bunk → the student;
**reassign a boarder within the House**, writing an **append-only allocation history** (from/to bunk, reason,
staff, timestamp); **one-student-per-bunk / one-bunk-per-student enforced at the DB** (partial unique on
`current_bunk_id WHERE NOT NULL`). Houses carry `gender`, `capacity`, resident HM. Residency is the only join; a
day student never appears; a day-only school renders the module empty/disabled. Tenant-scoped (composite
`(school_id,id)` FKs, `tenant_isolation` FORCE RLS on every new table + prod-paste), audit-logged, three gates green.

### Step table
| Step | Owner | State |
|---|---|---|
| Rulings on OQ1–OQ5 + acceptance criteria (**OQ1 residency/bunk shape gates Wells**) | Kofi | ⬜ gates Wells |
| Surface map — **02 house-roster** (identity strip · 5 prefect cards · 8-dorm×15-bunk grid · bunk states · student detail · swap log) + the House-config header of 01. Bunk-dot colours = **user House data via inline style**, NOT brand tokens (no-alpha-token discipline) | Lucy | ⬜ |
| **Schema (HEAVY — critical path).** Per OQ1: extend `houses` (`gender` enum, `capacity`, `hm_user_id`→users.id; backfill seeded houses' gender); NEW tenant tables `boarding_dormitory`, `boarding_bunk` (+nullable `prefect_role`), bunk-allocation history (append-only) + `current_bunk_id` live pointer; new enums `house_gender`/`prefect_role`; composite `(school_id,id)` UKs + composite intra-tenant FKs (dorm→house, bunk→dorm, allocation→student+bunk); **partial unique on `current_bunk_id WHERE NOT NULL`**; migration **0044** dev-applied; **prod-paste-0044 RLS** | Wells | ⬜ blocked on OQ1; blocks Claude Code |
| `BOARDING_ROLES` group in `lib/access.ts` (`ADMIN`, `HEADMASTER`, `DEAN_OF_BOARDING`, `HOUSEMASTER`) `as const satisfies readonly KnownAppRole[]`; no enum add | Claude Code | ⬜ |
| Roster read + reassign — `app/(app)/senior/boarding/…` route, roster builder (`withSchool`, boarders by house→dorm→bunk), reassign action (append history + move `current_bunk_id` atomically, guarded by partial-unique), `recordAudit` | Claude Code | ⬜ blocked on Wells |
| House Roster UI (surface 02) — identity strip, dorm/bunk grid, bunk states, student detail card, reassign gesture, swap-log panel | Claude Code | ⬜ |
| Seed — demo Asankrangwa dorms A–H × 15 bunks/House, prefects, boarder→bunk allocations, J. Manu in Aggrey D-03 (marker-scoped, re-run-safe) | Wells/Claude Code | ⬜ |
| Build · typecheck · tests (allocation invariant, move-history append, one-bunk-per-student race) · RLS test · preview round-trip | Claude Code | ⬜ |
| QA — dorm/bunk render vs surface, reassign writes history + moves pointer, one-bunk-per-student DB-enforced under race, residency filter (day student absent), tenant isolation | Quinn | ⬜ |
| Architecture/portability — composite FKs, allocation logic in `lib/` (no trigger), history ≠ `audit_log` dup, roster builder server-only | Dex | ⬜ |
| Security — every new tenant table `tenant_isolation` FORCE RLS, **prod-paste-0044 parity**, cross-tenant read denied, route auth + `BOARDING_ROLES`, no cross-tenant bunk ref possible | Sarah | ⬜ holds merge |
| Gate fixes (aggregated rework) | Claude Code | ⬜ |
| Merge · verify `git log origin/main` · **Pence syncs senior-feat ← main** | Sarah + Pence | ⬜ |

### Open questions — Kofi rules before implementation (OQ1 gates Wells; NONE are owner calls)
1. **OQ1 — residency/bunk schema shape (gates Wells).** BUILD_STACK #2 specs a separate `student_residency` table;
   F0 already shipped `students.residency`+`house_id`. Rule: (a) keep residency on `students`, add `current_bunk_id`
   + a `bunk_allocation` history table (leaner, reuses shipped columns — recommend, YAGNI on a 2nd residency store);
   or (b) build the full `student_residency` table per spec. BUILD_STACK wins on conflict, but the column is live —
   Kofi reconciles. The one call Wells waits on.
2. **OQ2 — House-config fields.** `gender` enum (one unified list, BUILD_STACK #3), `capacity`, resident-HM (`hm_user_id`
   → users.id, mirror `classes.class_teacher_user_id`); backfill seeded houses' gender.
3. **OQ3 — bunk invariant.** One-student-per-bunk / one-bunk-per-student via partial unique on `current_bunk_id WHERE
   NOT NULL`; reassign atomic (release old + claim new in one tx).
4. **OQ4 — prefect roles.** 5 designations (Head/Dining/Sanitation/Prep/SickBay) as nullable `prefect_role` enum;
   appointment display-only in F0 (workflow deferred).
5. **OQ5 — F0 UI scope.** F0 ships surface 02 (roster); House-config *editing* UI rides in INCR-8 (schema lands in 0044).
   Confirm the split + nav path.

### Risk flags
- **NEW tenant tables ⇒ prod-paste RLS** (`prod-paste-0044-boarding-spine.sql`; db:policies is dev-only). Sarah gates parity.
- **Composite intra-tenant FKs** (dorm→house, bunk→dorm, allocation→student+bunk) so a cross-tenant bunk ref is
  impossible; DDL order table→UK→ADD-FK (0033 class of bug). Wells verifies.
- **Allocation race** — partial-unique rejects the loser cleanly (atomic release-then-claim). Quinn tests.
- **Portability** — allocation/move-history in `lib/` (no trigger); history ≠ `audit_log`. Dex gates.
- **Residency-as-filter** (BUILD_STACK #1) — roster reads only BOARDER (+DEBOARDINIZED tile); DAY never appears;
  day-only school renders empty, not broken.
- **Seed not idempotent** — marker-scoped, re-run-safe, or prod-paste to shared dev DB.

### Prerequisites
- ✅ `senior-feat` level with `main` (`cec5659`); Module 4.1 closed. Next migration **0044**.
- No owner call gates INCR-7. **Deploy note:** migration 0044 + hand-paste `prod-paste-0044-boarding-spine.sql` on prod.

## MODULE 4.2 — OWNER decisions (surface at the module gate; NONE block INCR-7)
1. **v1 scope — all 7 surfaces, or operational core (7–10) first, deferring 11–13?** (gates roadmap tail) _Rec:
   sequence all 7, gate 13 on the billing/VLC calls below; reprioritise after 7+8._
2. **Discipline → billing penalty (BUILD_STACK #6) — writes into shipped, paying-customer billing.** (gates INCR-13)
   3× boarding-fee auto-invoice on infraction log. **STOP-AND-ASK — production financial write.** Auto-invoice vs
   review-queue; who adjusts; category naming.
3. **SMS + fee-owing via comms — SMS is a PAID external service.** (gates INCR-9/11/12) Exeat late-return, resumption
   reminders, visiting RSVP. **STOP-AND-ASK on the SMS *sends*** (billing reads are safe). Go-live vs stub/queue-not-sent.
4. **Sickbay (4.4) after Boarding — confirm counts-only placeholder** in surfaces 02/04. (gates INCR-10) Mostly settled by phase order.
5. **VLC pastoral bypass (BUILD_STACK #9) — forward dep on module 4.5.** (gates INCR-13) Stub in 4.2 (manual "escalate
   via Dean" + nullable flag), wire real VLC when 4.5 lands.
6. **Deboardinization "reversible only by Board" (BUILD_STACK #5) — no Board role exists.** (gates INCR-13 schema)
   Model Board review as a first-class record + guarded reinstatement (3 co-signs + logged decision), not a new RBAC role.
7. **"Senior Housemaster" == `DEAN_OF_BOARDING`?** (Kofi ruling; owner confirm only if titles differ) Fixes `BOARDING_ROLES`
   + co-sign checks; `MATRON` stays sickbay-only.
