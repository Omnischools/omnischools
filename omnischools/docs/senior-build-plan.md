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

## INCR-7 ✅ MERGED (PR #146, `2a5bda5`+`f2566fb`) — Boarding F0 · House→Dormitory→Bunk spine + residency + House Roster · migration 0044 · ⚠️ prod deploy: hand-paste `prod-paste-0044-boarding-spine.sql`

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

### Kofi rulings — INCR-7 (2026-07-16) — Wells UNBLOCKED
- **OQ1 → Option (a).** Keep residency on `students`; add `current_bunk_id` pointer + append-only `bunk_allocation`
  history table. NO `student_residency` table (BUILD_STACK #2's intent — hierarchy · bunk-as-key · live pointer +
  append-only history · DB-enforced one-per-bunk — is fully satisfied; the separate table adds no invariant. `became_*`
  lifecycle timestamps not load-bearing in F0). **Concrete schema for migration 0044:**
  - `ALTER houses` + `gender house_gender NULL` (BOYS/GIRLS/COED) + `capacity int NULL` (planning figure, not a hard cap)
    + `hm_user_id uuid NULL → users.id SET NULL` (mirror `classes.class_teacher_user_id`). Column ALTER only (already RLS'd).
  - `ALTER students` + `current_bunk_id uuid NULL`, composite FK `(school_id, current_bunk_id) → boarding_bunk(school_id, id)`
    SET NULL, **PARTIAL UNIQUE (current_bunk_id) WHERE current_bunk_id IS NOT NULL** (one-student-per-bunk, DB). Column ALTER only.
  - NEW `boarding_dormitory` (tenant): id, school_id, house_id, name (A–H), section_label NULL, bunk_count int DEFAULT 15,
    active, created_at · tenant UK (school_id,id) · composite FK (school_id,house_id)→house CASCADE · UNIQUE (school_id,house_id,name).
  - NEW `boarding_bunk` (tenant): id, school_id, dormitory_id, position_number, prefect_role prefect_role NULL, active,
    created_at · tenant UK (school_id,id) · composite FK (school_id,dormitory_id)→dorm CASCADE · UNIQUE (school_id,dormitory_id,position_number).
  - NEW `bunk_allocation` (tenant, APPEND-ONLY): id, school_id, student_id, bunk_id, from_at DEFAULT now, to_at NULL (open=current),
    reason text NOT NULL, allocated_by_user_id uuid→users.id SET NULL, created_at · composite FKs (school_id,student_id)→students,
    (school_id,bunk_id)→boarding_bunk · index (school_id,student_id).
  - NEW ENUMS `house_gender` (BOYS,GIRLS,COED), `prefect_role` (HEAD,DINING,SANITATION,PREP,SICKBAY). residency enum already exists.
  - RLS: `boarding_dormitory`+`boarding_bunk`+`bunk_allocation` → `tenant_isolation` FORCE + **prod-paste-0044-boarding-spine.sql**.
  - DDL order: table → tenant UK → ADD composite FK (0033 FK-before-UNIQUE class of bug).
- **OQ2/OQ3/OQ4/OQ5 → confirmed** (gender enum + capacity + hm_user_id; partial-unique invariant + atomic reassign;
  `prefect_role` nullable on the bunk, appointment workflow deferred; F0 ships surface 02, config-editing UI → INCR-8).
- **OQ7 → `BOARDING_ROLES = [ADMIN, HEADMASTER, DEAN_OF_BOARDING, HOUSEMASTER] as const satisfies readonly KnownAppRole[]`**
  (Senior HM = DEAN_OF_BOARDING; MATRON sickbay-only). No enum add.

#### INCR-7 · Acceptance criteria (for Quinn)
Roster = (school × house). "Active boarder of House H" = students where school=tenant, house_id=H, residency=BOARDER, status=ACTIVE.
- **A · Membership + ordering (residency-as-filter, BUILD_STACK #1).** A1 BOARDER of Aggrey ACTIVE → on roster (grid if
  bunked, else unallocated tray). A2 DAY → NEVER on any roster/count (the load-bearing filter). A3 DEBOARDINIZED → holds no
  bunk, absent from grid, only a house-level count/tile. A4 non-ACTIVE (WITHDRAWN/etc.) excluded. A5 order dormitory-major
  (A→H) then bunk 1→15, occupants by bunk position not alphabetical. A6 wrong-house boarder excluded.
- **B · House→Dorm→Bunk render + 4 states.** B1 8 dorms × 15 bunks = 120 slots **from data, not hard-coded 8×15**. B2
  occupied shows name, vacant shows dashed/italic. B3 four states from data: prefect (`prefect_role`≠null→gold), pastoral-flag
  (active flag→terra, stub source until 4.5), moved-this-sem (open `bunk_allocation.from_at` in current sem→green), vacant. B4
  click occupied→detail, click vacant→placement target. B5 prefect strip = the ≤5 tagged bunks; missing role renders empty.
- **C · Reassign — atomic history + pointer.** C1 one tx: set `current_bunk_id`, close prior open `bunk_allocation` (to_at=now),
  insert new open row (reason, allocated_by), all-or-nothing. C2 append-only (prior row not deleted; ≥2 rows after). C3 reassign
  to occupied → rejected, tx rolls back, no orphan row. C4 no `reason` → rejected before any write. C5 swap-log newest-first
  (from·to·reason·staff·ts).
- **D · One-per-bunk DB invariant under race (🔴 headline).** D1 partial unique exists + Postgres-enforced. D2 two concurrent
  reassigns to the same vacant bunk → exactly one commits, loser fails unique + whole-tx rollback + clean "bunk taken" error.
  D3 one-bunk-per-student inherent (single-valued pointer). D4 re-point to same bunk (no-op) → no dup open history row.
- **E · Residency-as-filter edges.** E1 zero BOARDER school → module empty/disabled, not 500. E2 no houses/dorms/bunks →
  "not configured" empty state. E3 house with boarders but no dorms → identity strip + unallocated state, no crash.
- **F · Tenant isolation.** F1 all 3 new tables `tenant_isolation` FORCE + prod-paste-0044 parity. F2 cross-tenant read/reassign
  denied. F3 cross-tenant bunk_id ref structurally impossible (composite FK).
- **G · Role-gating (BOARDING_ROLES).** G1 {ADMIN,HEADMASTER,DEAN_OF_BOARDING,HOUSEMASTER} load + reassign. G2
  STUDENT/PARENT/TEACHER/FORM_MASTER/BURSAR/MATRON/VHM denied. G3 reassign action re-checks server-side. **G4 (Kofi ruling —
  enforce in F0): plain HOUSEMASTER is house-scoped** (only where `houses.hm_user_id` = their user); ADMIN/HEADMASTER/DEAN
  school-scoped.
- **H · Audit.** H1 reassign writes one `auditLog` (actor·BUNK_REASSIGNED·student·from·to·reason·ts). H2 reads not logged. H3
  no PII beyond ids in payload. (`bunk_allocation` = operational history; `auditLog` = audit record — distinct.)
- **I · House-config fields (identity strip).** I1 strip: gender · capacity · resident-HM name · filled/vacant (filled=occupied
  bunks, vacant=total−filled). I2 backfill Aggrey/Guggisberg/Fraser=BOYS, Slessor/Kingsley/Aryee=GIRLS, capacity 120, Aggrey
  HM=Mr Mensah. I3 gender-null house renders strip without gender pill, no crash. I4 counts = BOARDER-with-bunk only.

#### Domain traps (Kofi)
- **J1 boarder-with-no-bunk (real):** BOARDER `current_bunk_id`=null → unallocated tray/count, occupies no cell, never dropped.
- **J2 deboardinized bunk:** on deboardinization `current_bunk_id`→null + open alloc closed; F0 doesn't perform it (INCR-13) but
  must render such a student bunk-less.
- **J3 gender-mismatch (🔴 LIVE must-fix seed):** house gender must match student sex (BOYS⇒MALE, GIRLS⇒FEMALE, COED⇒either),
  enforced at the **app reassign/placement action, NOT the DB** (cross-table check needs a trigger, which Dex bars). **The shipped
  seed violates this** (score-ledger science roster cross-assigned boarders ignoring sex — Abena Mensah FEMALE in Aggrey BOYS,
  Kwame Boakye MALE in Aryee GIRLS). The boarding seed MUST reassign demo boarders so each boarder's sex matches house gender
  before placing them; J. Manu (MALE, Aggrey D-03) is coherent. Assert reassign refuses a cross-gender target + seed is coherent.
- **J4 capacity overflow:** `capacity` is a planning figure (advisory flag), NOT a hard cap; the real limit is physical bunks
  (must exist + be free); a full house → next boarder to unallocated tray, never force-place/crash.
- **J5 dorm/bunk ≠ 8×15:** 8×15 is seed data not a constraint; render N dorms × M bunks from data (a 6-dorm house must render).
- **J-note pastoral state:** `vlc_pastoral_flags` is module 4.5 → stubbed; terra state renders on a seed stub, absent otherwise (honest).

### Lucy surface map (surface 02) — load-bearing build facts
- **🔴 House colour = USER DATA, inline `style`, NOT a brand token.** Identity-strip bg, crest text, setup 6px band all render
  `house.colour` inline. Hex collisions are coincidental (Guggisberg `#1A2B47` == brand navy, Fraser `#2F6B47` == brand green,
  Aggrey `#B43A2F` ≠ terra `#B84A39`) — NEVER recognise-and-swap a brand token; NEVER slash-opacity a raw hex (no-alpha discipline,
  verify tints in live preview). White House (`#FFFFFF`, Slessor) needs a `border-2` guard. Seeded colours: Aggrey `#B43A2F`,
  Guggisberg `#1A2B47`, Fraser `#2F6B47`, Slessor `#FFFFFF`, Kingsley `#E5C44A`, Aryee `#9B6FAA`.
- **Bunk grid geometry:** `.dorm-grid` = 2 dorms/row × 4 rows = 8 dorms A–H; each dorm `.bunks` = 5-wide, 15 bunks flow 3 deep.
  Bunk `pos` = zero-padded mono `01`–`15` per dorm; address `Dorm {L} bunk {NN}` (short `D-03`).
- **4 bunk states = BRAND tokens** (Tailwind classes, not house.colour): prefect `.prefect` gold (`bg-gold-bg`/`border-gold`/dot
  `bg-gold`/name ` *`), pastoral `.flagged` terra 1.5px (`bg-terra-bg`/`border-terra`), moved `.new` green (`bg-green-bg`), vacant
  `.empty` white dashed `border-2` italic. Badge dot only on prefect/flagged/new. **Precedence (Lucy rec, confirm):** flagged >
  prefect > moved > occupied > vacant. Gender pill = brand token keyed off enum (`.boys` navy, `.girls` terra), NOT house colour.
- **F0 BUILDS:** identity strip; summary strip (counts derived); prefect strip **display-only**; 8×15 grid + 4 states; bunk-click →
  student detail card; **within-House reassign** writing append-only history + moving `current_bunk_id`; last-swap summary;
  House-config fields surfaced **read-only**. Route `/senior/boarding` (roster at `/boarding/houses/[houseId]/roster`).
- **F0 does NOT build (render seeded/stub only):** House-config editing UI (INCR-8); prefect appointment workflow; **VLC
  cross-link / "Open VLC case file" / pastoral case copy (forward dep 4.5 — copy MUST NOT imply a working VLC system, stub it)**;
  inspection times / boarding-behaviour / exeat / visiting (INCR-9/10/12, display-only seeded strings); discipline; **swap→SMS to
  parents (comms, INCR-9+ — F0 writes history, sends NOTHING)**; history viewer; Print bed map; House-to-House transfer.
- **Open UI flags (team decisions, no owner call):** define the unassigned-boarder tray (J1); a selected-bunk state (rec
  `border-gold` ring); the unflagged detail-card default variant (rec neutral/navy, not terra); derive ALL counts/addresses from
  data (the mock's occupancy numbers don't reconcile — hardcode nothing).

---

## INCR-8 ✅ MERGED (PR #148, `d573b91`; docs #147) — Boarding programme config · surface 01 · migration 0045 · ⚠️ prod deploy: hand-paste `prod-paste-0045-boarding-config.sql`

> **Nothing blocks INCR-8.** `senior-feat` is level with `main` (`b6c9cce`); INCR-7/F0 merged. Kofi + Lucy
> start now; Wells waits only on Kofi's OQ1/OQ4 (config-table shapes + calendar model — Kofi calls under
> BUILD_STACK authority, **NONE are owner calls**). INCR-8 stores config and **sends nothing / writes no
> billing**, so the MODULE 4.2 owner decisions (#2 billing penalty, #3 SMS sends, #6 Board reversal) do **not**
> gate it — they gate INCR-9/11/12/13. Next migration **0045** (latest is 0044).

### Goal
The **config OS** every later boarding surface reads (the surface's own words: "everything else reads from
this"). What the Senior HM (`DEAN_OF_BOARDING`) + Admin configure once at start-of-session: the **House-config
editing UI F0 deferred** (create/rename House · set colour/gender/capacity · assign resident HM · provision
dorms/bunks), the **daily-rhythm template** (4:30 AM to 9:30 PM, weekday + separate Sat/Sun + F3 WASSCE
extension), the **three policy doctrines** (exeat · visiting · inspection), the **GES single-track calendar**
(resumption / vacation / visiting / exeat windows, F3 early post-WASSCE), and the **5-rung deboardinization
ladder** rendered from the canonical definition. Config lives in tables + `lib/` (portable, no hardcoding, no
triggers).

### Done when
A Dean/Headmaster/Admin opens `/senior/boarding/programme` and can: **edit House identity** (name, inline-style
colour, gender pill, capacity as a planning figure, resident HM) and **provision dormitories + bunks** for a
House; **edit the daily-rhythm template** per day_type (weekday / Saturday / Sunday) with the **F3 prep
extension** variant; **set exeat policy** (scheduled quota, return-by time, special-exeat + fee-owing rules),
**visiting policy** (2nd-Sunday cadence, hours, approved-visitor rule), and **inspection cadence** (daily /
weekly / mid-week scrubbing); **manage the boarding calendar** (resumption/vacation **derived from
`academic_period`** — SENIOR for F1/F2, **SENIOR_F3** for Form 3 — plus editable visiting + exeat event rows);
and **see the 5-rung ladder** read-only from the canonical definition. **Every config edit is audit-logged**
("audit catches everything"). Every downstream increment reads this config through **one stable typed contract**
(`lib/boarding/config.ts`). Tenant-scoped (each new config table `tenant_isolation` FORCE RLS + prod-paste),
role-gated (`BOARDING_ROLES`; write = Senior HM/Admin), three gates green.

### Config-read contract — the load-bearing deliverable (9–13 build against it)
`lib/boarding/config.ts`, server-only, `withSchool`, one stable typed shape per doctrine so later increments
never re-derive config. **Define + freeze this shape in INCR-8; a later change is a cross-increment break.**
- `getScheduleTemplate(schoolId, dayType, form?)` → INCR-10 (daily life) reads the rhythm + F3 variant.
- `getExeatPolicy(schoolId)` (quota · return-by · special-exeat · fee-owing) → INCR-9 (exeat) **enforces** it.
- `getVisitingPolicy(schoolId)` (cadence · hours · approved-visitor rule) → INCR-12 (visiting).
- `getInspectionPolicy(schoolId)` (daily/weekly/scrubbing times) → INCR-10.
- `getBoardingCalendar(schoolId, academicYear)` (resumption/vacation from `academic_period` + event rows) → INCR-11 + INCR-9/12.
- `getDeboardinizationLadder(schoolId)` → INCR-13 (discipline) reads the rung definition (co-sign counts stay DB-enforced there, BUILD_STACK #4).

### Step table
| Step | Owner | State |
|---|---|---|
| Rulings on OQ1–OQ6 + acceptance criteria (**OQ1 config-table shape + OQ4 calendar model gate Wells**) | Kofi | ⬜ gates Wells |
| Surface map — **surface 01** all 6 blocks: summary strip · **Houses config** (colour=user-data inline style, no-alpha discipline carried from F0) · **daily-rhythm** (weekday rows + `NOW` state · Sat/Sun separate · F3 ext) · **3 policy cards Exeat/Visiting/Inspection** · **GES calendar** · **deboardinization ladder** (navy card, 5 rungs). **NOTE the F0-orientation slip:** the 3 policy *cards* are Exeat/Visiting/**Inspection**; deboardinization is a *separate* ladder block — map both exactly | Lucy | ⬜ |
| **Schema (config tables — critical path).** Per OQ1/OQ4: NEW tenant `daily_schedule_template` (day_type enum × `activities_json` × active); NEW tenant `boarding_settings` **one-row-per-school, mirror `attendance_settings`** (school_id UNIQUE + typed exeat/visiting/inspection scalars + GES defaults — leaf table, single-col FK, no composite UK); boarding calendar = **derive resumption/vacation from `academic_period`** + NEW tenant `boarding_calendar_event` (visiting/exeat rows) **or** reuse `school_holiday` kind=EVENT (OQ4); new enum `boarding_day_type` (WEEKDAY/SAT/SUN/VISITING); **[conditional OQ5]** `founded_year`/`named_after` column ALTER on `houses`; migration **0045** dev-applied + **prod-paste-0045-boarding-config.sql** (FORCE RLS each new tenant table); DDL order table→UK→ADD-FK (0033 class) | Wells | ⬜ blocked on OQ1/OQ4; blocks Claude Code |
| **Config-read API** — `lib/boarding/config.ts` (the contract above), stable typed shape, server-only, `withSchool` | Claude Code | ⬜ blocked on Wells |
| House-config editing UI (F0-deferred) — create/rename House · colour/gender/capacity · assign HM · **provision dorms/bunks** (per OQ5) over existing `houses`/`boarding_dormitory`/`boarding_bunk` (no new tenant table) | Claude Code | ⬜ |
| Daily-rhythm template editor — weekday/Sat/Sun rows + **F3 extension** variant; seed canonical YAGSHS template | Claude Code | ⬜ |
| Policy editors — exeat/visiting/inspection over `boarding_settings` (typed fields + free-text notes) | Claude Code | ⬜ |
| Boarding calendar editor — resumption/vacation **read-only from `academic_period`**; add/edit visiting + exeat event rows | Claude Code | ⬜ |
| Deboardinization ladder — **read-only** render from `lib/boarding/` canonical constants (per OQ6; editable-text + Board-reversal model deferred to INCR-13) | Claude Code | ⬜ |
| Edit audit — every config write → `recordAudit`→`auditLog` ("audit catches everything"; **no versioning table** per OQ3) | Claude Code | ⬜ |
| Seed — Asankrangwa config (YAGSHS schedule, exeat 3/return-16:00, visiting 2nd-Sun 12–16:00, inspection cadence, GES calendar events), marker-scoped re-run-safe | Wells/Claude Code | ⬜ |
| Build · typecheck · tests (config-read shape, calendar-derivation-not-duplicated, day_type + F3 variants) · RLS test · preview round-trip (edit → persist → read via contract) | Claude Code | ⬜ |
| QA — config edit→persist→read, day_type/F3 variants, calendar derived (not duplicated) from `academic_period`, ladder read-only, tenant isolation, role-gate | Quinn | ⬜ |
| Architecture/portability — **config-read contract stable for 9–13**; `boarding_settings` reuses `attendance_settings`; calendar **extends `academic_period`, not duplicated**; no versioning over-build; logic in `lib/`, no trigger | Dex | ⬜ |
| Security — every NEW tenant table `tenant_isolation` FORCE + **prod-paste-0045 parity**, cross-tenant denied, editors role-gated (`BOARDING_ROLES`; Senior HM/Admin write) | Sarah | ⬜ holds merge |
| Gate fixes (single aggregated rework brief) | Claude Code | ⬜ |
| Merge · verify `git log origin/main` · **Pence syncs senior-feat ← main** | Sarah + Pence | ⬜ |

**Wells is on the critical path** (new config tenant tables: schedule template, `boarding_settings`, calendar
events) and is blocked on Kofi OQ1 + OQ4. **The House-config editing UI is NOT blocked on Wells** (houses/dorm/
bunk shipped in 0044) — Claude Code can build that surface in parallel with the schema cut.

### Dependencies / critical path
- **INCR-8 depends on F0's spine** (INCR-7, merged): `houses` (name/colour/gender/capacity/hm_user_id),
  `boarding_dormitory`/`boarding_bunk`/`bunk_allocation`, `students.residency`/`current_bunk_id`,
  `BOARDING_ROLES`, the `/senior/boarding` route.
- **INCR-8 depends on the existing academic-period model** for the calendar — `academic_period`
  (starts_on/ends_on, product lines **SENIOR + SENIOR_F3**), `school_holiday`, `lib/actions/terms.ts`. Do not
  re-model term dates.
- **INCR-9/10/11/12/13 READ this config** (roadmap: `INCR-8 → 9/10/13`; `11/12 hang off 7` but read 8's
  policy/calendar). The **config-read contract is the gate**: freeze `lib/boarding/config.ts` here so siblings
  build against a stable shape. Module critical path: **INCR-7 → INCR-8 → INCR-13**.

### Open questions — Kofi rules before implementation (**NONE are owner calls** — all Kofi/BUILD_STACK)
1. **OQ1 — config-table shapes (gates Wells).** `daily_schedule_template` = `activities_json` per day_type
   (surface rows are heterogeneous — JSON is the lazy fit) vs relational rows. `boarding_settings` =
   one-row-per-school typed columns (mirror `attendance_settings`) vs a policy blob. _Rec: JSON template + typed
   `boarding_settings`._
2. **OQ2 — schedule configurability.** Surface says "Configurable per school." Seed the canonical YAGSHS
   template + edit-times, or fully-editable rows? Weekday/Sat/Sun as `boarding_day_type` enum; **F3 extension =
   a per-template variant or a form-scoped flag** (drives how INCR-10 reads it). _Rec: seed canonical + editable,
   F3 as a variant on the weekday template._
3. **OQ3 — versioned edits.** The aside promises "capacity 120→132 creates a new version; prior stays in
   audit." Build point-in-time config versioning, or **`audit_log` the edits + defer true versioning**? No
   downstream increment reads *historical* config. _Rec: audit-only now (YAGNI on a versioning table);
   portability call for Dex._
4. **OQ4 — boarding calendar model (the "don't duplicate `academic_period`" call, gates Wells).**
   Resumption = `academic_period.starts_on`, vacation = `.ends_on` (**SENIOR_F3 already models F3's early
   post-WASSCE date**). Add only boarding-specific events (visiting Sundays, exeat windows) via a new
   `boarding_calendar_event` table **or** `school_holiday` kind=EVENT reuse. _Rec: derive resumption/vacation +
   add events; do not copy term dates into a boarding table._
5. **OQ5 — House-config editing scope.** Identity (name/colour/gender/capacity/HM) only, or **also dorm/bunk
   provisioning** (create/rename dorms, set bunk counts)? Add `founded_year`/`named_after` columns (surface
   shows them; **no downstream reader** — YAGNI) or omit? _Rec: identity + capacity + HM + dorm/bunk
   provisioning; omit founded/named unless the owner wants the decorative House-card fields (minor)._
6. **OQ6 — deboardinization ladder definition storage.** Store editable per-school ladder text/penalty in a
   config table now, or **render read-only from `lib/boarding/` canonical constants** and defer the editable
   store + Board-reversal model to **INCR-13** (its actual consumer)? Severity enum + co-sign counts are
   **already LOCKED** (BUILD_STACK #4); "reversible only by Board" is **MODULE 4.2 owner decision #6 → gates
   INCR-13, not 8**. _Rec: read-only render now, defer editable store to INCR-13._

**Genuine OWNER CALLs: none gate INCR-8.** Configurability ("Editable per school · GES default values shown")
and every table shape are settled by surface copy + the README schema sketch → Kofi rules under BUILD_STACK.
INCR-8 stores config, sends no SMS, writes no billing, models no Board reversal — so the module-gate owner
decisions stay at 9/11/12/13. The only owner-adjacent scrap is OQ5's decorative `founded_year`/`named_after`
columns (deferrable, non-blocking).

### Risk flags
- **NEW tenant tables ⇒ prod-paste RLS** (`prod-paste-0045-boarding-config.sql`; `db:policies` is dev-only).
  Each new config table gets `tenant_isolation` FORCE. `boarding_settings`, like `attendance_settings`, is a
  leaf (single-col `school_id`, no composite UK) but **still needs FORCE RLS**. Sarah gates parity.
- **Config-read contract is load-bearing** — 9/10/11/12/13 all consume `lib/boarding/config.ts`. Freeze the
  typed shape in INCR-8; a later shape change is a cross-increment break. Dex + Kofi gate the contract.
- **Don't duplicate the academic-period model** — resumption/vacation derive from `academic_period`
  (SENIOR + SENIOR_F3); the boarding calendar adds only boarding-specific events. Copying term dates diverges
  from the source of truth. Dex.
- **Sat/Sun/F3 variant modelling** — get the `boarding_day_type` axis + F3 extension right so INCR-10 reads the
  correct template per day/form. Kofi/Lucy.
- **Portability** — config in tables + `lib/`, no hardcoding, no DB triggers; schedule as JSON activities
  (heterogeneous rows). Dex.
- **House colours = USER DATA, inline `style`, NOT brand tokens** (no-alpha discipline carried from F0; White
  House needs the `border-2` guard). Lucy.
- **Seed not idempotent** — marker-scoped, re-run-safe, or prod-paste to the shared dev DB.

### Prerequisites / stop-and-ask
- ✅ `senior-feat` level with `main` (`b6c9cce`); INCR-7/F0 merged; `houses`/dorm/bunk/residency shipped in
  0044. Next migration **0045**.
- **No owner call gates INCR-8.** Kofi + Lucy start now; Wells waits on Kofi OQ1/OQ4; the House-config editing
  UI parallelises (no new table).
- **Deploy note:** migration 0045 + hand-paste `prod-paste-0045-boarding-config.sql` (FORCE RLS for each new
  tenant config table).
- **Still deferred to their own increments** (surface aside — do NOT build here): per-student bed = surface 02
  (F0 ✓); prep attendance = INCR-10; exeat in flight = INCR-9; visitors = INCR-12; bond/deboardinization ops =
  INCR-13. The MODULE 4.2 owner decisions (#2 billing, #3 SMS, #6 Board) surface at **those** increments.

### Kofi rulings — INCR-8 (2026-07-16, none owner) — Wells UNBLOCKED
- **OQ1 → three new tenant tables (migration 0045):**
  - `daily_schedule_template` — id, school_id (single-col FK, leaf), `day_type boarding_day_type NOT NULL`, `form_scope text NOT NULL DEFAULT 'ALL'`, `activities_json jsonb NOT NULL` (ordered block array `{kind:'section'|'activity', label?/range?/start?/end?/activity?/who?/note?}`), active, updated_at · UNIQUE(school_id,day_type,form_scope) · FORCE RLS. New enum `boarding_day_type = WEEKDAY|SATURDAY|SUNDAY|VISITING_SUNDAY`.
  - `boarding_settings` — one-row-per-school, **mirror `attendance_settings`** (single-col `school_id UNIQUE` FK, leaf, no composite UK, FORCE RLS). Typed scalar columns, all GES-default-seeded + editable: exeat (scheduled_per_term smallint DEFAULT 3, return_by text '16:00', fee_owing_must_collect bool, special_approver, parent_initiated, dress_code, card_signer), visiting (cadence, hours_start/end, lunch_time, dormitories_rule, approved_visitors, book_owner), inspection (daily_start/end, daily_scope, weekly, weekly_scope, scrubbing, washing_days, inspector). **No ladder columns.**
  - `boarding_calendar_event` — id, school_id (single-col, leaf), academic_year text, `event_type boarding_event_type NOT NULL` (enum `VISITING|EXEAT_WINDOW`), event_date date, label text, form_scope text NULL, sequence smallint NULL, created_at · UNIQUE(school_id,academic_year,event_type,event_date) · index(school_id,academic_year) · FORCE RLS. **Stores ONLY boarding events — never resumption/vacation.**
- **OQ2/OQ3 → every policy scalar editable-with-GES-default (all in `boarding_settings`); audit-only, NO versioning table** (no downstream reads historical config; `View change history` reads `auditLog`).
- **OQ4 → calendar DERIVES, doesn't duplicate.** resumption=`academic_period.starts_on`, vacation=`.ends_on`; F3 early post-WASSCE vac = the **SENIOR_F3** product-line period's `.ends_on` (already modelled). Reject `school_holiday` reuse (academic-calendar-shared, would pollute the day counter).
- **OQ5 → ADD `founded_year smallint NULL` + `named_after text NULL` to `houses`** (column ALTER, no RLS change; the surface renders them today + INCR-8 IS the House-config editor).
- **Deboardinization ladder → READ-ONLY from `lib/boarding/` canonical constants** (`getDeboardinizationLadder(schoolId)`); NO per-school store, NO Board-reversal model in INCR-8 — the editable store + co-sign enforcement + 3× fee billing write all defer to **INCR-13**. (schoolId stays in the signature for a future override.)
- **House-config editing UI → House identity (name/colour/gender/capacity/HM/founded/named) + dorm/bunk provisioning** (over the shipped 0044 tables, no new table); per-student bed assignment stays surface 02 (F0).
- **Role-gating → WRITE = `BOARDING_SCHOOL_SCOPED_ROLES` (ADMIN/HEADMASTER/DEAN_OF_BOARDING); READ = `BOARDING_ROLES`** (HOUSEMASTER read-only). Both consts already in `lib/access.ts`.

### Config-read contract — `lib/boarding/config.ts` (server-only, `withSchool`) — FROZEN COMPLETE (9–13 read it)
- `getScheduleTemplate(schoolId, dayType, form?)` → **INCR-10**: `{dayType, formScope, activities[], active}`; resolve `(dayType,form)` → else `(dayType,'ALL')`; absent day_type → `null` (never fabricate).
- `getExeatPolicy(schoolId)` → **INCR-9**: `{scheduledPerTerm, returnByTime, feeOwingMustCollect, specialApprover, parentInitiated, dressCode, cardSigner}`.
- `getVisitingPolicy(schoolId)` → **INCR-12**: `{cadence, hoursStart, hoursEnd, lunchTime, dormitoriesRule, approvedVisitors, bookOwner}`.
- `getInspectionPolicy(schoolId)` → **INCR-10**: `{dailyStart, dailyEnd, dailyScope, weekly, weeklyScope, scrubbing, washingDays, inspector}`.
- `getBoardingCalendar(schoolId, academicYear)` → **INCR-11/9/12**: `{resumption[], vacation[]}` derived from `academic_period` (`{productLine:'SENIOR'|'SENIOR_F3', periodLabel, date}`) + `events[]` from `boarding_calendar_event`; `nextVisiting` derived (never a settings column).
- `getDeboardinizationLadder(schoolId)` → **INCR-13**: `rungs[]` = `{stage 1..5, severity NOTE|WARNING|BOND|SUSPENSION|DEBOARDINIZATION, name, description, penaltyLabel, coSignCount, coSignRoles[], reversalNote}` from the `lib/` constant (co-sign ENFORCEMENT stays DB-enforced in INCR-13).
- **Readers coalesce a missing `boarding_settings` row to the GES-default constant** (never throw/empty); schedule is the exception (absent day_type → null).

#### INCR-8 · Acceptance criteria (for Quinn)
- **A · GES defaults.** A1 fresh boarding school seeds one `boarding_settings` GES-default row. A2 no row → readers return GES-default constant (never throw/empty). A3 day-only school never reaches readers (or coalesces to defaults). A4 schedule seeds WEEKDAY/SAT/SUN/VISITING_SUNDAY; unseeded day_type → `null` not a fabricated rhythm.
- **B · Policy persist/read-back.** B1 edit exeat quota 3→2 persists, `getExeatPolicy.scheduledPerTerm===2`, another tenant unchanged. B2 visiting/inspection round-trip verbatim. B3 every policy-card scalar round-trips per-school.
- **C · Schedule resolution.** C1 WEEKDAY/SATURDAY/SUNDAY return distinct templates. C2 SUNDAY ≠ VISITING_SUNDAY. C3 WEEKDAY/FORM_3 override returns 22:00 lights-out; FORM_1 with no row falls back to `'ALL'`. C4 `activities_json` preserves order + both block kinds.
- **D · Calendar derives.** D1 resumption/vacation == SENIOR `academic_period` dates, NO such row in `boarding_calendar_event`. D2 F3 vacation from SENIOR_F3 `.ends_on`, distinct from F1/F2. D3 only VISITING/EXEAT_WINDOW stored; formScope + sequence round-trip. D4 changing a term date shifts the calendar with no boarding-table edit.
- **E · House-config edits.** E1 create/rename House + colour/gender/capacity/HM persist. E2 founded_year/named_after persist + render 1:1. E3 provision dorm+bunks → rows created, Dorms/Beds reflect them (not hard-coded 8×15). E4 editing capacity doesn't alter occupancy (derived). E5 white House renders the `border-2` guard (inline style, no-alpha).
- **F · Ladder display.** F1 `getDeboardinizationLadder` returns 5 ordered rungs matching the navy block. F2 rung 5 = coSignCount 3, roles [HM, Senior HM, Headmaster], Board-only reversalNote — read-only (no store in INCR-8).
- **G · Tenant isolation.** G1 all 3 config tables FORCE RLS. G2 prod-paste-0045 re-applies. G3 cross-tenant config invisible.
- **H · Role-gating.** H1 ADMIN/HEADMASTER/DEAN edit all sections. H2 plain HOUSEMASTER views but every write rejected server-side. H3 STUDENT/PARENT/TEACHER/MATRON/BURSAR denied route. H4 server-enforced (page + action).
- **I · Audit.** I1 every config write → one `auditLog` row (actor/section/before→after/ts), no versioning table. I2 quota change logs before=3 after=2, live value new.

### Lucy surface map (surface 01) — load-bearing facts
- **Route** `/senior/boarding/programme`; write-gate `BOARDING_SCHOOL_SCOPED_ROLES`, read-gate `BOARDING_ROLES` (mirror `app/(app)/senior/boarding/page.tsx`).
- **🔴 TRAP 1 (House colour = user data):** `.h-band`/gender bands render `house.colour` inline `style`; white Slessor (`#FFFFFF`) needs the `isLightColour()` `border-2` guard. Never slash-opacity a raw hex.
- **🔴 TRAP 2 (navy ladder alpha tints):** the `.lad` rung tints are `rgba` on gold-soft/terra/warn → `border-gold-soft/15`, `bg-terra/15`, `bg-warn/12` **silently break** on raw-hex tokens. Use `opacity-N` / a `-bg` tint / `bg-white/[0.04]` (white is safe). Same on the featured-card sub + cal-foot. Verify in live preview.
- **Regions:** summary strip (5 cards, DERIVED reads — only exeat-quota is config, "board review pending" = INCR-13 count); Houses grid (F0-deferred editing UI, 6 cards, verbatim seed data in the map); daily rhythm (15 rows / 4 section-markers — weekday shown, Sat/Sun are separate templates the impl lays out as tabs/panels, **F3 is an inline form-variant not a separate template**); 3 policy cards Exeat/Visiting/Inspection; deboardinization = **separate navy ladder block, read-only**; calendar (12 events — resumption/vacation DERIVED from period, VISITING/EXEAT are config).
- **Provenance:** user-data (House identity, schedule rows, VISITING/EXEAT events) · GES-default-seeded-editable (all policy fields) · derived-from-period (resumption/vacation incl. SENIOR_F3, read-only) · derived-from-roster/clock (summary cards 1–4, occupancy %, `.now` marker, relative-time strings).
- **F0-slip:** `houses` has NO founded_year/named_after (Kofi OQ5 → add via 0045). Inspection window `06:10–06:20` appears in BOTH schedule + inspection card → read from ONE source (contract), never diverge.
- **Open UI (team, no owner call):** occupancy `.fill.warn` threshold undefined (don't hardcode 97 — compute from roster, confirm rule); Sat/Sun layout is implementer's inference (tabs vs stacked); `who`/policy values are free-text-with-suggestions, not hard enums — preserve the Ghanaian voice verbatim in seeds.

---

## Next increment — INCR-9 · Boarding exeat management — surface 05 (exeat-management) · migration 0046

> **Nothing structural blocks INCR-9.** `senior-feat` is level with `main` (`108b8e1`); INCR-7/F0 (the House→Dorm→Bunk spine + residency) and INCR-8 (config OS + the FROZEN `getExeatPolicy` contract) are merged. Kofi + Lucy start now; Wells waits only on Kofi's OQ1 (exeat-table shape — a Kofi call under BUILD_STACK, **not** an owner call). **One genuine OWNER CALL gates one slice, not the build:** MODULE 4.2 owner decision **#3 — do the late-return / reminder SMS go LIVE via Hubtel (real sends, real cost) or stay console-only (no real sends)?** Because `sendSms()` (`lib/sms/index.ts`) already degrades to the console provider when no `HUBTEL_CLIENT_ID/SECRET` env creds exist, Claude Code wires the whole SMS chain now and it **sends nothing real until the owner provisions Hubtel** — the owner gate blocks *provisioning creds / go-live*, never the build. **Billing reads are safe** (fee-owing is a pure READ of `invoices.balance_amount`). Next migration **0046** (latest 0045).

### Goal
The exeat lifecycle — the **request → HM review → (Senior HM sign) → depart → return** gate-crossing contract for a boarder, per surface 05. **Five timestamped stages**, three exeat kinds (**scheduled** 3/sem · **special** parent-initiated · **fee-collection** auto-routed for fee-owing), the **approval chain** (scheduled auto-approve-if-clean; special needs the Senior HM signature — a plain HM cannot approve a special), the **printable exeat card** (another `@react-pdf` artefact reusing the ledger-book stack), the **in-flight + upcoming-window + returns-today + overdue queues** with **bulk-approve**, and the **return-by-16:00 enforcement** with the **late-return SMS escalation chain**. Reads config through the frozen `getExeatPolicy` contract; reads billing live for fee-owing; sends nothing real until the owner go-lives Hubtel.

### Done when
A boarder's exeat moves **REQUESTED → HM-APPROVED (auto if scheduled + clean) → SR-HM-SIGNED (special only) → DEPARTED (gate sign-out) → RETURNED (gate sign-in)**, each stage **timestamped + actor-stamped**; the **scheduled quota** (`getExeatPolicy.scheduledPerTerm`, default 3) is **enforced per student per semester** with special exeats uncapped; a **fee-owing boarder** at a scheduled exeat is **routed to a fee-collection exeat** (never detained — GES rule) with the outstanding amount read live from `invoices.balance_amount`; a **print-ready exeat card PDF** (student · form · house · bunk · type · date-out/date-in · dress from `policy.dressCode` · fee status · Senior-HM signature from `policy.cardSigner`) downloads from an authenticated route **keyed by exeat id** (no PII in the URL); the **queues render from data** with **bulk-approve** for clean scheduled requests; and an **overdue return** (past `getExeatPolicy.returnByTime`) surfaces in the late queue and fires the **escalation SMS chain via `sendSms()`** (console provider — **no real send until Hubtel go-live**), with the +1hr formal-NOTE rung **stubbed as a forward dep on discipline (INCR-13)**. Tenant-scoped (composite `(school_id, id)` FKs, `tenant_isolation` FORCE RLS on the new exeat table + **prod-paste-0046**), per-boarder (residency = BOARDER), audit-logged, three gates green.

### Step table
| Step | Owner | State |
|---|---|---|
| Rulings on OQ1–OQ5 + acceptance criteria (**OQ1 exeat-table shape gates Wells**); surface the OWNER CALL on the SMS-send go-live (owner decision #3) — do NOT let Claude Code provision Hubtel without it | Kofi | ✅ (rulings + AC below) |
| Surface map — **surface 05** all blocks: summary strip (5 cards: in-flight · in-queue · awaiting-Senior-HM · returns-today · late-returns — DERIVED reads); the **in-flight card** (5-stage timeline, timestamped, per-stage actor) ∥ the **printable exeat-card artefact**; the **upcoming-window queue** (type pills sched/special/fee · fee-status clear/owed · approval state · bulk-approve + "approve all clean"); **returns-today** grid; the **late-return band** (3-stage 16:05/16:30/17:00 escalation). The surface's SMS/NOTE copy is the WIRING to build, not live sends | Lucy | ✅ (surface-map facts below) |
| **Schema (exeat table — critical path).** Per OQ1: NEW tenant `boarding_exeat` — `student_id`+`house_id` (composite FKs), `exeat_type` enum + fee-collection modelling per OQ2, `status` enum (REQUESTED/HM_APPROVED/SR_HM_SIGNED/DEPARTED/RETURNED/DECLINED), per-school `ref_code`, `academic_period_id` (quota-per-semester), nullable `calendar_event_id`→`boarding_calendar_event` (the scheduled window), `reason`, `parent_initiated`, planned `depart_at`/`return_by`, the **5 stage timestamps + actor user ids** (requested/hm_approved/sr_hm_signed/departed/returned) + `declined_at/by`, nullable `fee_owing_snapshot`; new enums `exeat_type`/`exeat_status`; composite `(school_id,id)` tenant UK + composite intra-tenant FKs; quota **derived by counting rows** (no counter column). Per OQ3, an append-only `exeat_notification` log for the SMS chain **or** ride `audit_log`. migration **0046** dev-applied + **prod-paste-0046-boarding-exeat.sql** (FORCE RLS); DDL order table→UK→ADD-FK (0033 class) | Wells | ✅ `0046_dazzling_misty_knight.sql` · `boarding.ts` · `prod-paste-0046` (dev applied) |
| Config + fee-owing reads — consume `getExeatPolicy(schoolId)` **READ-ONLY** (quota · returnByTime · feeOwingMustCollect · specialApprover · dressCode · cardSigner — never re-derive/re-model) + `getBoardingCalendar` EXEAT_WINDOW events (next scheduled window) + a **fee-owing read** (`SUM(invoices.balance_amount)` WHERE `status IN (ISSUED,PARTIAL,OVERDUE)` per student, `withSchool`, server-only — a READ, no billing write) | Claude Code | ✅ `lib/boarding/exeat-data.ts` (getExeatBoard · feeOwingForStudent · countQuotaUsed) |
| Exeat lifecycle server actions — request · HM-approve (auto-approve scheduled-if-clean: fees-clear-or-fee-routed, quota not exceeded, no discipline flag [stub INCR-13]) · Senior-HM-sign (special only; enforce specialApprover role server-side) · depart (gate sign-out) · return (gate sign-in; compute on-time vs late vs `returnByTime`) · decline · bulk-approve-clean; all in `lib/boarding/` (no trigger), each transition atomic + `recordAudit` | Claude Code | ✅ `lib/actions/boarding-exeat.ts` (atomic + audited; plain-HM rejected from special sign) |
| Exeat card PDF — `lib/pdf/exeat-card-document.tsx` + `render-exeat-card.tsx`, **reuse `@react-pdf/renderer` + `lib/pdf/fonts.ts`** (mirror `app/api/senior/ledger-book/route.ts`); authed route `runtime=nodejs`, `requireSchool` + `assertAnyRole(BOARDING_ROLES)` + house-scope for plain HM + `withSchool`, **keyed by exeat id only** (no PII in URL), streams `application/pdf` `private, no-store`, generation audit-logged | Claude Code | ✅ `lib/pdf/exeat-card-*` + `app/api/senior/exeat-card/route.ts` (PDF verified 5462B) |
| Queue + in-flight + returns + late UI (surface 05) — route `/senior/boarding/exeats` (Lucy confirms path); summary strip, in-flight 5-stage timeline + card preview, upcoming-window queue with type/fee/approval columns + **bulk-approve**, returns-today grid, late-return band; House filter; per-boarder detail | Claude Code | ✅ page + `components/boarding/exeat-console.tsx` (reached from Boarding landing, no new sidebar row) |
| Late-return SMS chain — wire the +5/+30/+60 escalation to `sendSms()` (**console provider, no real cost until Hubtel go-live per owner #3**); overdue **computed on-read** from `return_by` (defer a true timed background scheduler — see OQ5/risk); the +1hr NOTE rung **stubbed** (forward dep on INCR-13 discipline). NEVER provision Hubtel creds without the owner go-ahead | Claude Code | ✅ `lib/boarding/exeat-notify.ts` (console-only, idempotent, stage-3 STUB, no Hubtel creds) |
| Seed — Asankrangwa demo exeats (1 special in flight, a May-31 scheduled-window queue, returns-today, coherent with F0 boarders: J. Manu scheduled/clean), marker-scoped re-run-safe | Wells/Claude Code | ✅ `db/seed/boarding-exeat.ts` (`db:seed-exeat`, marker-scoped DEMO_REFS) |
| Build · typecheck · tests (lifecycle transitions, quota enforcement, fee-owing routing, on-time-vs-late, auto-approve gating, SMS-chain fires-console) · RLS test · preview round-trip (request → approve → sign → depart → return; print card; overdue → chain) | Claude Code | ✅ typecheck+lint+build+24 tests green; live round-trip proven (request→approve→depart→return, card PDF, overdue chain idempotent, plain-HM sign blocked) |
| QA — 5-stage transitions + timestamps, quota hard-cap vs special-uncapped, fee-owing route (not detained), auto-approve only-if-clean, special needs Senior HM, card PDF fields vs surface, bulk-approve, overdue detection + chain (console), tenant isolation, role/house-scope | Quinn | ⬜ |
| Architecture/portability — lifecycle in `lib/` (no trigger), card stays on `@react-pdf/renderer` (no puppeteer), SMS behind the existing `sendSms()` abstraction (console↔Hubtel by env), fee-owing a READ (no billing coupling/write), quota derived (no counter to drift) | Dex | ⬜ |
| Security — new exeat table `tenant_isolation` FORCE RLS + **prod-paste-0046 parity**, cross-tenant read/act denied, composite FKs (no cross-tenant student/bunk/event ref), route auth + `BOARDING_ROLES` + house-scope, **no PII in the card URL / SMS logs**, no real SMS send without owner go-live, `getExeatPolicy` contract only READ (frozen) | Sarah | ⬜ holds merge |
| Gate fixes (single aggregated rework brief) | Claude Code | ⬜ |
| Merge · verify `git log origin/main` · **Pence syncs senior-feat ← main** | Sarah + Pence | ⬜ |

**Wells is on the critical path** (the new `boarding_exeat` tenant table + enums + RLS + prod-paste) and is blocked on Kofi OQ1. **The exeat card PDF is a near-mechanical clone** of the ledger-book route — the real work is the lifecycle actions (approval chain + quota + fee routing) and the queue UI.

### Dependencies / critical path
- **Reads INCR-8's frozen contract** `getExeatPolicy(schoolId)` (`lib/boarding/config.ts`) — quota · return-by · fee-owing · special-approver · dress · card-signer. INCR-9 **enforces** it; it must **never** re-model or rename the shape (a cross-increment break) and must READ it, not re-derive from `boarding_settings`.
- **Reads INCR-8's `getBoardingCalendar`** for the EXEAT_WINDOW events (the next scheduled exeat date / "1 of 3" sequence) — do not re-model the calendar.
- **Sits on INCR-7's F0 spine** — exeats are **per-boarder** (`students.residency = BOARDER`), carry the House + bunk address (`current_bunk_id` → dorm/bunk for the card), and gate on `BOARDING_ROLES` / house-scope.
- **Reads the billing module** for fee-owing — `invoices.balance_amount` + `status` (`ISSUED`/`PARTIAL`/`OVERDUE` = owing), tenant-scoped, **READ ONLY** (no invoice write; auto-invoicing on infraction is INCR-13's owner-gated financial write, not here).
- **Reuses the `@react-pdf/renderer` stack** for the exeat card (`lib/pdf/*`, `fonts.ts`, the ledger-book route pattern) — invent no new PDF path.
- **Reuses the `sendSms()` abstraction** (`lib/sms/index.ts`) for the late-return chain — console until Hubtel creds exist.
- **Critical path:** Kofi OQ1 → Wells (0046) → Claude Code reads → lifecycle actions → card PDF ∥ queue UI → SMS chain → self-verify → 3 gates → Sarah merge → Pence sync. Kofi ∥ Lucy ∥ Wells parallelise up front.

### Open questions — Kofi rules before implementation (**#1 is the genuine OWNER CALL**)
1. **SMS sends — LIVE or stubbed (OWNER CALL · module decision #3 · the module STOP-AND-ASK).** Do the late-return / reminder / departure SMS go **LIVE via Hubtel** (real sends, real per-segment cost — `SMS_SEGMENT_RATE_GHS ~ 0.035`) or ship **console-only / queued-not-sent** until an SMS-provider go-live? Because `sendSms()` degrades to the console provider without Hubtel creds, **the build proceeds wired-to-`sendSms()` either way** — this gate is purely on **provisioning Hubtel creds** (`HUBTEL_CLIENT_ID`/`SECRET`/`SENDER_ID`). Claude Code must NOT provision them without the owner go-ahead. **Billing reads are safe and unblocked.** _(Sub-question for Kofi/Dex: build the true timed background scheduler for the +5/+30/+60 escalation now, or ship overdue-computed-on-read + a triggered/manual send and defer the cron? Rec: on-read + triggered send now — no scheduler infra exists; the timed auto-escalation is the over-build.)_
2. **Fee-owing gate — hard-block vs soft-warn+override (mostly Kofi under the GES rule; owner-adjacent on special exeats).** The surface + BUILD_STACK are explicit: **the school cannot detain a fee-owing student** (GES rule) — a fee-owing boarder at a *scheduled* exeat is **routed to a fee-collection exeat** (goes home to collect), never blocked. So the "gate" is a **route, not a block**, for scheduled. Open: does fee-owing **soft-warn** on a *special* exeat, and if an override is ever offered, **who** holds it (Senior HM / Dean)? Rec: never hard-block departure (GES); surface the owing amount + `feeOwingMustCollect` routing; no override needed because nothing is blocked.
3. **Quota enforcement (Kofi domain call).** Is the **3 scheduled/sem a hard cap**? Special exeats **uncapped** (confirm). **What counts against the quota** — do fee-collection exeats count against the 3 (rec: yes, they ARE scheduled exeats) and do specials count (rec: no)? And a **mid-term quota change** (INCR-8 edits `scheduledPerTerm`, audited) — does it apply to **in-flight/already-taken** exeats or only new requests (rec: forward-only; already-approved unaffected)?
4. **Approval chain (Kofi under BUILD_STACK — OWNER confirm only if titles differ, already settled OQ7).** Scheduled + clean → **auto-approved by the system (HM lane)**; **special → the Senior HM (`DEAN_OF_BOARDING`) signs, a plain `HOUSEMASTER` cannot approve a special** (surface: "HM alone cannot approve"). `specialApprover` from `getExeatPolicy` ("Senior HM only") drives the role check. Confirm plain-HM can approve *scheduled* within their House only (house-scope), Dean/Headmaster school-wide.
5. **Return enforcement beyond SMS (Kofi + architecture; forward dep on INCR-13).** At `returnByTime` overdue, besides the SMS chain: set an **overdue flag / `returned_late` bool** on the exeat (rec: yes, computed) — but the **+1hr formal NOTE on the student record is discipline (surface 07 = INCR-13, unbuilt)**. Rec: **stub** the NOTE rung (record the overdue state + audit; wire the real discipline NOTE when INCR-13 lands) — do NOT build a discipline record here.

**Genuine OWNER CALL: only #1 (SMS go-live).** #2–#5 are Kofi calls under BUILD_STACK / surface / GES authority with owner-confirm-only edges. #1 does not block the build — it blocks provisioning Hubtel.

### Risk flags
- **NEW tenant table ⇒ prod-paste RLS** (`prod-paste-0046-boarding-exeat.sql`; `db:policies` is dev-only). The exeat table (and any `exeat_notification` log) get `tenant_isolation` FORCE. Sarah gates parity.
- **SMS is a PAID external service (STOP-AND-ASK).** `sendSms()` sends real messages the moment Hubtel creds exist. **Never provision `HUBTEL_*` env creds without the owner go-ahead (#3).** The build wires `sendSms()` (console provider) and costs nothing until go-live. Sarah + Pence hold this.
- **Billing coupling stays a READ.** Fee-owing reads `invoices.balance_amount`/`status` tenant-scoped — **no invoice write**. (The 3× auto-invoice on infraction is INCR-13's owner-gated financial write, decision #2 — NOT here.) Dex + Sarah gate no-write.
- **PDF-engine portability** — the exeat card stays on `@react-pdf/renderer` (Node runtime, `lib/pdf/*`), **no puppeteer / chromium / Vercel PDF service**. Dex.
- **No PII in the card URL or SMS logs** — the download route is keyed by **exeat id (uuid)**, not student name; the console SMS provider logs the body (parent phone + student name) — acceptable only because it's console/dev, another reason live sends need the owner gate. Sarah.
- **Don't break the frozen contract** — `getExeatPolicy` / `getBoardingCalendar` are **READ-ONLY** from `lib/boarding/config.ts`; a field rename/re-model is a cross-increment break for 10–13. Dex + Kofi.
- **Composite intra-tenant FKs** (exeat→student, →house, →period, →calendar_event) so a cross-tenant reference is structurally impossible; DDL order table→UK→ADD-FK. Wells.
- **Quota derived, not counted** — count SCHEDULED exeat rows per (student × semester); no denormalised counter to drift. Dex.
- **Auto-approve must fail safe** — a scheduled exeat auto-approves ONLY if every clean-check passes (quota not exceeded, fees clear-or-routed, no discipline flag [stub]); any flag → manual review, never a silent approve. Quinn.
- **Seed not idempotent** — marker-scoped, re-run-safe, or prod-paste to the shared dev DB.

### Prerequisites / stop-and-ask
- ✅ `senior-feat` level with `main` (`108b8e1`); INCR-7/F0 + INCR-8 merged; `getExeatPolicy` frozen; `boarding_settings`/calendar shipped in 0045. Next migration **0046**.
- **OWNER CALL before Claude Code wires any real send:** module decision **#3 — SMS go-live** (provision Hubtel = paid). The build proceeds console-only; do not provision creds without the go-ahead.
- **Deploy note:** migration 0046 + hand-paste `prod-paste-0046-boarding-exeat.sql` (FORCE RLS on each new tenant table) on prod.
- **Forward deps to STUB, not build:** the +1hr formal NOTE + penalty assessment (discipline = surface 07 / INCR-13); the 3× auto-invoice financial write (owner decision #2 / INCR-13). INCR-9 records overdue state + audits; it writes no discipline record and no invoice.

### Kofi rulings — INCR-9 (2026-07-18, none owner) — Wells UNBLOCKED
- **OQ1 → two new tenant tables (migration 0046):**
  - **`boarding_exeat`**: id, school_id, `student_id` (composite FK `(school_id,student_id)`→students; requester must be residency=BOARDER), `house_id` (composite FK, House at time of exeat), `academic_period_id` (composite FK, SHS semester = quota scope), `calendar_event_id` NULL (the EXEAT_WINDOW; **composite `(school_id,id)`→boarding_calendar_event — needs adding `unique(school_id,id)` to that INCR-8 table, else single-col SET NULL**), `exeat_type exeat_type_enum` (`SCHEDULED|SPECIAL|FEE_COLLECTION` — FEE_COLLECTION first-class, NOT a flag), `status exeat_status_enum` (`REQUESTED|HM_APPROVED|SR_HM_SIGNED|DEPARTED|RETURNED|DECLINED` — supersedes BUILD_STACK's OVERDUE/CANCELLED: overdue is computed, cancelled=DECLINED), `ref_code` (`unique(school_id,ref_code)`, e.g. ASA-EX-2026-0341), `reason` (app-required for SPECIAL, auto-prefilled for FEE_COLLECTION), `parent_initiated`, `depart_at`/`return_by`, **5 stage stamps** `requested_at`/`hm_approved_at`/`sr_hm_signed_at`/`departed_at`/`returned_at` each + `*_by_user_id` (SET NULL single-col), `declined_at`/`declined_by_user_id`/`decline_reason`, `fee_owing_snapshot numeric(12,2) NULL` (live balance frozen at approval). Constraints: `unique(school_id,id)` tenant UK, `unique(school_id,ref_code)`, `index(school_id,student_id,academic_period_id)` (quota), FORCE RLS. **DERIVED (no columns):** quota_used = count(SCHEDULED+FEE_COLLECTION, status≠DECLINED, per student×period); returned_late = returned_at>return_by; overdue = DEPARTED ∧ now>return_by ∧ returned_at IS NULL.
  - **`exeat_notification`** (append-only SMS log — NOT audit_log, needs idempotency + delivery metadata): id, school_id, `exeat_id` (composite FK), `kind exeat_notification_kind_enum` (`DEPARTURE|REMINDER|OVERDUE_STAGE_1|OVERDUE_STAGE_2|OVERDUE_STAGE_3`), to_phone, body, provider (console/hubtel), provider_message_id NULL, error NULL, ok bool, sent_at, sent_by_user_id NULL. `index(school_id,exeat_id)`, FORCE RLS. Idempotency = `NOT EXISTS(kind for this exeat)` before each stage send. Human actions (approve/sign/depart/return/decline) still → audit_log.
- **OQ2 → fee-owing ROUTES, never blocks.** Fee-owing at scheduled → typed FEE_COLLECTION (goes home to collect), `fee_owing_snapshot`=live balance, reason prefilled, departure never blocked (GES cannot-detain). Special → soft-warn only (type stays SPECIAL). No override role (nothing is blocked).
- **OQ3 → quota** = `scheduledPerTerm` hard cap on SCHEDULED+FEE_COLLECTION combined per (student×semester); specials uncapped; fee-collection counts BUT a GES-cannot-detain fee-collection may exceed the cap; mid-term `scheduledPerTerm` change forward-only.
- **OQ4 → approval:** scheduled/fee + clean + standard-window → auto-approve (system, HM lane); SPECIAL → Senior HM (`DEAN_OF_BOARDING`) `SR_HM_SIGNED`, a plain HOUSEMASTER cannot sign a special; plain HM `HM_APPROVED` only within own House (`canAccessHouse`), Dean/HM/Admin school-wide.
- **OQ5 → overdue computed; SMS chain console (+5/+30/+60), idempotent in `exeat_notification`; +1hr NOTE STUBBED** (record + audit; NO discipline record, NO invoice in INCR-9).
- **Open-for-owner (spec silent, NOT a blocker — proceeding on Kofi default):** an off-window scheduled exeat's reviewer → default HM manual review, Senior-HM for an extra overnight.

#### INCR-9 · Acceptance criteria (for Quinn)
- **A · 5-stage lifecycle.** A1 scheduled-clean: REQUESTED→HM_APPROVED→DEPARTED→RETURNED (skips SR_HM_SIGNED), each stamp+actor set. A2 special passes SR_HM_SIGNED. A3 no illegal skips (REQUESTED→DEPARTED rejected; DEPARTED needs prior HM_APPROVED[sched/fee] or SR_HM_SIGNED[special]). A4 every transition audit-logged + atomic. A5 DECLINED terminal, stamps decline_at/by/reason, blocks later departure.
- **B · Quota.** B1 4th scheduled over cap → no auto-approve, can't create as scheduled. B2 specials never quota-blocked. B3 fee-collection counts toward the 3. B4 GES override: fee-owing student over-quota still gets a fee-collection trip (never detained). B5 mid-term `scheduledPerTerm` 3→2 doesn't retro-decline existing 3. B6 semester boundary → quota_used resets (period scope).
- **C · Fee-owing routes.** C1 read = SUM(invoices.balance_amount) WHERE status∈(ISSUED,PARTIAL,OVERDUE), tenant-scoped, READ-only (DRAFT/PAID/EXEMPT/VOIDED don't count). C2 fee-owing scheduled → typed FEE_COLLECTION, snapshot set, never blocked. C3 fee-collection SMS body includes the amount. C4 fee-owing special stays SPECIAL, soft-warn, not blocked/rerouted. C5 fee-clear → snapshot NULL, type SCHEDULED.
- **D · Approval gating (fail-safe).** D1 auto-approve ONLY if quota-ok ∧ fees-clear-or-routed ∧ no-discipline-flag[stub] ∧ standard-window; any fail → stays REQUESTED/manual. D2 off-window scheduled → manual review (not auto). D3 SPECIAL SR_HM_SIGNED only by DEAN_OF_BOARDING/HEADMASTER/ADMIN; plain HM rejected. D4 plain HM acts only within own House. D5 bulk-approve skips flagged rows.
- **E · Return + SMS chain (console).** E1 return stamps returned_at/by, computes returned_late. E2 overdue surfaces via computed predicate (no status enum). E3 chain invokes sendSms (provider=console, ok=true, no real send), one `exeat_notification` per stage. E4 idempotent (no re-send of a logged stage). E5 STUB: stage-3 logs notification+audit, writes ZERO discipline/invoice rows.
- **F · Exeat card PDF.** F1 renders from data (ref_code, name, form·House·bunk, type, date-out/in, dress=policy.dressCode, fee line, signer=policy.cardSigner label + actual SR_HM actor). F2 route authed (requireSchool + BOARDING_ROLES + house-scope + withSchool), keyed by exeat id (no PII in URL), `application/pdf` `private, no-store`, audit-logged. F3 stays on @react-pdf (no puppeteer).
- **G · Tenant/RBAC/contract.** G1 cross-tenant exeat/notification denied (FORCE RLS + composite FKs). G2 STUDENT/PARENT/TEACHER/MATRON denied. G3 reads `getExeatPolicy` ONLY (all 7 fields, never re-modeled). G4 prod-paste-0046 parity on both tables.
- **Domain traps:** T1 fee-collection returns still-owing → RETURNED, surfaced, NO infraction/invoice (INCR-13 hook stubbed). T2 special during a scheduled window → stays SPECIAL, uncapped, needs SR_HM, consumes no quota. T3 overdue + pending discipline → INCR-9 has no discipline read (stub returns clean, not a silent gap); chain fires regardless. T4 deboardinize mid-exeat → RETURNED still succeeds (departed exeat is immutable history); a NEW request for non-BOARDER rejected. T5 fee snapshot read live at approval + frozen (not re-read per view).

### Lucy surface map (surface 05) — load-bearing facts
- **Route `/senior/boarding/exeats`** (server component, `requireSchool`+`assertAnyRole(BOARDING_ROLES)`+house-scope for plain HM; reach from the Boarding landing, NOT a new sidebar row — sidebar stays flat).
- **Exeat card PDF = near-mechanical clone of the ledger-book stack:** new `lib/pdf/exeat-card-document.tsx` + `render-exeat-card.tsx` + `app/api/senior/exeat-card/route.ts` (mirror `app/api/senior/ledger-book/route.ts`, reuse `lib/pdf/fonts.ts`, nodejs runtime, keyed by exeat id, `private, no-store`, audit-logged). Card fields: ref_code, name, form·House·bunk (from `current_bunk_id`), type, date-out (`departed_at`)/date-in (`return_by`), **Dress = `getExeatPolicy.dressCode`**, fee line (clear or owed amount), **signer = `getExeatPolicy.cardSigner` label + the ACTUAL SR_HM_SIGNED actor name** (don't hardcode — surface has a name-mismatch drift).
- **Regions:** summary strip (5 DERIVED cards: in-flight·in-queue·awaiting-Sr-HM·returns-today·late-returns); in-flight card (5-stage timeline — dot states done=green/active=gold+ring/upcoming=grey; elapsed derived); queue (rows: type pill sched/special/fee · student · reason · out/in · fee-status clear/owed · approval approved/pending/needs · action; **bulk-approve "Approve all clean (N)"** = count passing every clean-check); returns-today grid (RETURNED that day, late→terra); **late-return band (empty=wiring reference; 3 rungs +5/+30/+60 → sendSms console; stage-3 NOTE STUBBED)**.
- **Late-chain offsets are relative to `getExeatPolicy.returnByTime`** (16:05 = +5), compute don't hardcode. **All SMS calls `sendSms()` → console provider, no real send** until owner provisions Hubtel; NEVER provision `HUBTEL_*` creds. Stage-3 NOTE/penalty copy MUST NOT imply a working discipline record (INCR-13) — soften to future/conditional.
- **Config-read `getExeatPolicy` (READ-only, frozen):** dressCode→card Dress; cardSigner→card signer label; returnByTime→return line + chain base; scheduledPerTerm→quota + "SCHED 1 OF 3"; feeOwingMustCollect→routing; specialApprover→SR-HM requirement; parentInitiated. Also `getBoardingCalendar` EXEAT_WINDOW for next window/sequence.
- **🔴 alpha-on-hex trap (no-alpha discipline):** the featured summary card's muted text (`rgba(232,212,184,.7/.6)` = gold-soft on navy) + card-art foot — do NOT `text-gold-soft/70`/`bg-gold/[0.08]` on raw-hex; use a tint token / `opacity-N`, verify in live preview. (The real PDF card uses @react-pdf where rgba is fine.)
- **Later-increment (render/stub only):** +1hr NOTE + penalty/3×-invoice = INCR-13 (no discipline/invoice write here); SMS go-live = owner Hubtel; timed auto-escalation scheduler = deferred (overdue on-read + triggered send, no cron infra).
