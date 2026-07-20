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

## INCR-9 ✅ MERGED (PR #151, `df0d529`) — Boarding exeat management · surface 05 · migration 0046 · ⚠️ prod deploy: hand-paste `prod-paste-0046-boarding-exeat.sql`

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

---

## INCR-10 ✅ MERGED (PR #153, `fbb406e`) — Boarding daily life · surface 04 · migration 0047 · ⚠️ prod deploy: hand-paste `prod-paste-0047-boarding-inspections.sql`

> **Nothing structural blocks INCR-10, and no OWNER CALL gates it.** `senior-feat` level with `main` (`2e54337`);
> INCR-7/F0, INCR-8 (config OS + frozen `getScheduleTemplate`/`getInspectionPolicy`) and INCR-9 (`boarding_exeat`)
> merged. The Housemaster's homepage — operational, not policy. **Wells on the critical path** (two new tenant tables:
> `inspections` DAILY+WEEKLY, prep-attendance) blocked on Kofi OQ1. Everything else is READ/DERIVED, no storage: timeline
> resolves from `getScheduleTemplate`, `.now` from the clock, exeats-today from INCR-9's `boarding_exeat`, sick-bay count
> is a **counts-only PLACEHOLDER** (module 4.4 unbuilt). Next migration **0047**.

### Goal
The Housemaster's live daily view (surface 04). The half-hour timeline (done/NOW/upcoming) resolved from
`getScheduleTemplate(schoolId, dayType, form)` with the F3 prep-ext variant; the NOW card (current activity, minutes
in/left) from the clock; 5 summary cards (in-House · morning inspection N/8 · tonight's prep · Wed scrubbing · sick-bay);
the per-dorm **morning DAILY inspection** (PASS/PARTIAL/FAIL + bunks-clean + findings) AND the separate-cadence Saturday
**WEEKLY whole-house inspection** (BUILD_STACK #8 — two datasets, one table, distinct `type`); prep attendance; Wed
scrubbing/washing accents; sick-bay (stub) + exeats-today (real) counts. Reads the frozen config; writes only
inspection + prep records.

### Done when
On a House's Today view a Housemaster (`BOARDING_ROLES`, house-scoped for a plain HM) sees the live day timeline resolved
from `getScheduleTemplate` (F3 variant before the `ALL` base; unseeded day_type → empty, never fabricated) with each slot
done/NOW/upcoming **purely from the clock (no stored slot state)** + the NOW card; **records the morning per-dorm DAILY
inspection** (PASS/PARTIAL/FAIL + `N/M bunks clean` + findings, staff-stamped, `type=DAILY`) AND the Saturday **WEEKLY**
whole-house inspection (`type=WEEKLY`, separate findings shape); **marks prep attendance** (Kofi's model); sees the
**exeats-today count** (DERIVED read of INCR-9 `boarding_exeat`) + the **sick-bay count** (counts-only PLACEHOLDER — 4.4
unbuilt, copy must not imply a working sickbay). Config reads via the frozen `getScheduleTemplate`/`getInspectionPolicy`
(never re-modeled); the two new records are NEW tenant tables (FORCE RLS + **prod-paste-0047**, composite `(school_id,id)`
FKs, per-dorm / per-boarder); a failed inspection's **discipline escalation (daily→Note, weekly→Warning) is STUBBED**
(INCR-13 — records result + audits, writes NO discipline row); all logic in `lib/boarding/` (no trigger); audit-logged;
three gates green.

### Step table
| Step | Owner | State |
|---|---|---|
| Rulings on OQ1–OQ5 + acceptance criteria (**OQ1 inspection + prep table shape gates Wells**); confirm NONE is owner (sick-bay placeholder settled by module decision #4) | Kofi | ⬜ gates Wells |
| Surface map — surface 04 every block: house strip · NOW strip · 5 summary cards (DERIVED) · day-timeline rail (done/now/upcoming) + 4 rail-foot mini-cards (Wed scrubbing/washing, F3 prep-ext, club) · per-dorm daily-inspection grid (pass/partial/fail + score + findings) + weekly-cadence meta · tonight's-prep card · Wed scrubbing accent (+ "Attendance for scrubbing" button — flag scope) · sick-bay `LIGHT·PLACEHOLDER` card + `sb-note` (must NOT imply a working sickbay). Confirm route | Lucy | ⬜ |
| **Schema (inspection + prep — critical path).** NEW tenant `inspections` (dormitory_id composite FK, inspected_at, actor `*_by_user_id` SET NULL, `type inspection_type_enum` DAILY/WEEKLY, `result inspection_result_enum` PASS/PARTIAL/FAIL [3-state supersedes BUILD_STACK's `pass_fail` bool], bunks_clean/bunks_total, findings_json, anomalies_count) + NEW tenant prep-attendance (shape per OQ3); composite `(school_id,id)` UK + composite intra-tenant FKs; FORCE RLS; migration **0047** + **prod-paste-0047-boarding-inspections.sql**; DDL order table→UK→ADD-FK | Wells | ⬜ blocked on Kofi OQ1 |
| Config + counts reads — `getScheduleTemplate`+`getInspectionPolicy` READ-ONLY (never re-derive); resolve day_type from date (+ `getBoardingCalendar` for SUNDAY vs VISITING_SUNDAY); DERIVED counts — exeats-today = live read of `boarding_exeat`; in-House = BOARDER count − departed-exeats − sick-bay(stub 0); **sick-bay = PLACEHOLDER stub**; all `withSchool` server-only | Claude Code | ⬜ |
| Timeline + `.now` derivation — pure funcs in `lib/boarding/` (resolve template incl. F3, mark done/now/upcoming from clock, minutes-in/remaining) — **display-only, NO storage, NO trigger**; vitest DB-free | Claude Code | ⬜ |
| Inspection record actions — daily per-dorm + weekly whole-house in `lib/boarding/` (no trigger), atomic + audit; PARTIAL/FAIL records result + anomalies but **STUBS discipline escalation** (INCR-13 — NO infraction row); reads `getInspectionPolicy` cadence/scope | Claude Code | ⬜ |
| Prep-attendance action — Kofi's OQ3 model in `lib/boarding/` (no trigger), atomic + audit, roster from BOARDER set; "Attendance for scrubbing" reuses this or stubs (OQ4) | Claude Code | ⬜ |
| Daily-life UI (surface 04) — route `/senior/boarding/houses/[houseId]/today` (Lucy confirms; reach from Boarding landing/roster, NOT a new sidebar row); house strip + NOW strip + 5 cards + timeline rail + rail-foot + per-dorm daily-inspection grid + record modal + weekly pane + tonight's-prep + attendance + Wed scrubbing (Wed-only) + sick-bay placeholder; house-scope for plain HM | Claude Code | ⬜ |
| Seed — demo Today (~7/8 daily pass + one PARTIAL, one weekly row, a prep roster; coherent with F0 boarders incl. J. Manu clean), marker-scoped re-run-safe | Wells/Claude Code | ⬜ |
| Build · typecheck · tests (timeline/now across day-types + F3, daily vs weekly write, prep, exeat-count read, sick-bay stub, tenant isolation) · RLS test · preview round-trip | Claude Code | ⬜ |
| QA — timeline vs clock, F3 variant, unseeded day_type empty, daily 3-state + bunks-clean, weekly separate cadence, inspection-fail STUBS discipline (no infraction), prep, exeats-today real vs sick-bay stub, in-House math, tenant isolation, role/house-scope | Quinn | ⬜ |
| Architecture/portability — timeline/now + inspection + prep in `lib/` (no trigger), `.now`/timeline NO storage, config READ-only, escalation stubbed, counts derived (no counter) | Dex | ⬜ |
| Security — `inspections` + prep FORCE RLS + **prod-paste-0047 parity**, cross-tenant denied, composite FKs, route auth + `BOARDING_ROLES` + house-scope, contract READ-only, sick-bay stub leaks no medical PII | Sarah | ⬜ holds merge |
| Gate fixes (aggregated) | Claude Code | ⬜ |
| Merge · verify `git log origin/main` · **Pence syncs senior-feat ← main** | Sarah + Pence | ⬜ |

### Dependencies / critical path
Reads INCR-8's frozen `getScheduleTemplate` (timeline, `(dayType,form)→(dayType,'ALL')→null`, F3 variant) +
`getInspectionPolicy` (cadence/scope/inspector) READ-ONLY; reads `getBoardingCalendar` (SUNDAY vs VISITING_SUNDAY); reads
INCR-9's `boarding_exeat` (exeats-today count, live). Sits on F0's dorm/bunk spine (inspections per-dorm; prep/in-House
per-boarder). NEW writes = `inspections` (DAILY+WEEKLY) + prep-attendance → Wells → 0047 → prod-paste-0047. **Stub, don't
build:** sick-bay count (4.4); inspection-fail → discipline Note/Warning (INCR-13). Critical path: Kofi OQ1 → Wells (0047)
→ Claude Code reads → timeline/now ∥ inspection actions ∥ prep → surface-04 UI → 3 gates → Sarah merge → Pence sync.

### Open questions — Kofi rules (**none is an OWNER CALL** — operational under BUILD_STACK #8 / surface)
1. **Inspection granularity + result shape (gates Wells).** Per-dormitory (not per-bunk); BUILD_STACK's `pass_fail` bool
   superseded by **3-state `inspection_result_enum` PASS/PARTIAL/FAIL** + bunks-clean count + `findings_json`; confirm daily
   vs weekly findings shapes differ (#8: daily = bunks/lockers/attire; weekly = whole-house deep). One `inspections` table,
   `type` DAILY/WEEKLY.
2. **Who records + gating.** Staff-stamped `*_by_user_id` (SET NULL → users, exeat actor-stamp pattern); `BOARDING_ROLES` +
   house-scope for plain HM (daily), Dean/Senior-HM weekly; prefects assist but don't own the row.
3. **Prep-attendance model (gates Wells).** _Rec: a per-boarder EXCEPTION log (late/absent) over a full present/absent
   roster — matches the surface's "log exceptions", smallest table._
4. **`.now`/timeline storage + scrubbing accents.** Timeline + NOW = pure derivation, NO storage/slot-state row. Wed
   scrubbing/washing from `getScheduleTemplate` + policy. "Attendance for scrubbing" button → reuse prep model or stub (no 3rd table).
5. **Sick-bay count — stub confirm.** Counts-only PLACEHOLDER, no boarding table backs it (4.4); exeats-today is real
   (INCR-9). Keep the `LIGHT · PLACEHOLDER` badge + `sb-note`; must not imply a working sickbay.

### Risk flags
- **NEW tenant tables ⇒ prod-paste RLS** (`prod-paste-0047-boarding-inspections.sql`; db:policies dev-only). Sarah gates parity.
- **Frozen contract READ-ONLY** — `getScheduleTemplate`/`getInspectionPolicy` never re-modeled (cross-increment break for 11–13). Dex + Kofi.
- **`.now`/timeline derived — NO storage** (computed from clock vs template each render; no slot column, no trigger). Dex.
- **Sick-bay = PLACEHOLDER/STUB** (4.4); copy keeps `LIGHT · PLACEHOLDER` + `sb-note`, must not imply a working sickbay; exeats-today is real (don't conflate). Quinn + Kofi.
- **Inspection-fail → discipline escalation STUBBED** (daily→Note, weekly→Warning = INCR-13); records result + audits, NO `boarding_infractions` row. Quinn.
- **Portability** — timeline/now + inspection + prep all in `lib/boarding/` (no DB trigger). Dex.
- **Day-type + timezone** — resolve day_type from the date against the school clock (Ghana = UTC); a Wednesday reads WEEKDAY, a visiting Sunday reads VISITING_SUNDAY. Quinn.
- **Seed not idempotent** — marker-scoped, re-run-safe.

### Prerequisites / stop-and-ask
- ✅ `senior-feat` level with `main` (`2e54337`); INCR-7/8/9 merged; `getScheduleTemplate`/`getInspectionPolicy` frozen; `boarding_exeat` shipped. Next migration **0047**.
- **No owner call before Wells cuts schema** — OQ1 is a Kofi call under BUILD_STACK #8. Kofi ∥ Lucy start now.
- **Deploy note:** migration 0047 + hand-paste `prod-paste-0047-boarding-inspections.sql` on prod.
- **Forward deps to STUB, not build:** sick-bay count/queue (real sickbay = module 4.4); inspection-fail → discipline Note/Warning (INCR-13); "Attendance for scrubbing" write if OQ4 defers it.

**Load-bearing schema notes:** (1) BUILD_STACK's `inspections.pass_fail` boolean does NOT match surface 04's PASS/PARTIAL/FAIL
+ `N/M bunks clean` — OQ1 blesses a 3-state `inspection_result_enum` (surface beats the sketch here). (2) There is NO
prep-attendance table in BUILD_STACK — a genuinely new modelling call (OQ3), which is why Wells is on the critical path.

### Kofi rulings — INCR-10 (2026-07-18, none owner) — Wells UNBLOCKED
- **OQ1 → `inspections` (leaf, append-only, latest-wins) — migration 0047:** id, school_id, `dormitory_id` (composite FK `(school_id,dormitory_id)`→boarding_dormitory), `type inspection_type_enum` (DAILY/WEEKLY, new), `result inspection_result_enum` (PASS/PARTIAL/FAIL, new — **supersedes BUILD_STACK's `pass_fail` bool**), `bunks_clean`/`bunks_total smallint NULL` (populated DAILY, NULL WEEKLY; `bunks_total` a **snapshot**, not re-derived), `findings_json jsonb NOT NULL` (**shape discriminated by `type`, Zod-validated in `lib/` — NOT a DB CHECK/trigger**: DAILY `{kind:"DAILY",checks:{bunks/lockers/attire:OK|ISSUE},flaggedBunks?,notes?}`; WEEKLY `{kind:"WEEKLY",areas:[{area,result,note?}],notes?}`), `anomalies_count smallint DEFAULT 0` (computed in lib at write), `inspected_at`, `inspected_by_user_id → users SET NULL (single-col)`, created_at. **LEAF table: NO `(school_id,id)` tenant UK, NO unique-per-day** (nothing references it — mirrors `bunk_allocation`); index `(school_id,dormitory_id,inspected_at)`; FORCE RLS. **Read = latest-wins** per (dorm×type×UTC-date) by max `inspected_at` (a re-inspection appends).
- **OQ2 → same recording gate for both cadences:** `BOARDING_ROLES` + house-scope for plain HM (`canAccessHouse`), school-scoped Admin/HM/Dean; actor-stamped; prefects assist but the HM owns the row. (Weekly "led by Senior HM" is descriptive, not an app access boundary — spec-silent, proceeding on this default.)
- **OQ3 → `prep_attendance` = per-boarder EXCEPTION log (upsert per boarder per night):** id, school_id, `student_id` (composite FK), `house_id` (composite FK, **snapshot**), `session_date date NOT NULL` (**stored date, not derived** — avoids the tz-boundary trap), `status attendance_status_enum` (**reuse the canonical 5-status enum**; writer inserts only LATE/ABSENT/EXCUSED/MEDICAL — **PRESENT is never a row** = absence of a row; keep all 5, memory), `minutes_late smallint NULL`, `note`, `logged_at`, `logged_by_user_id → users SET NULL`, created_at. **UNIQUE(school_id,student_id,session_date)** = upsert target; index `(school_id,house_id,session_date)`; LEAF (no tenant UK); FORCE RLS.
- **OQ4 → timeline + NOW are PURE derivation** from `getScheduleTemplate` vs the clock — NO storage, no slot-state row, no trigger. Main rail = `(dayType,'ALL')`; **F3 prep-ext = a derived accent card** (delta of the `FORM_3` variant's lights-out vs `ALL`), not a whole-timeline swap. Wed scrubbing/washing = display labels from `getInspectionPolicy.scrubbing`/`.washingDays`, weekday-token-gated. **"Attendance for scrubbing" = STUB** (no write, no 3rd table).
- **OQ5 → sick-bay = counts-only PLACEHOLDER, no boarding table** (real sickbay = module 4.4); exeats-today is REAL (INCR-9 `boarding_exeat`). **CORRECTION to the board's in-House formula: in-House (on-premises) = active BOARDERs − DEPARTED-on-exeat; sick-bay is NOT subtracted** (sickbay is on-site, still "in House"). Keep `LIGHT·PLACEHOLDER` + `sb-note`.
- **For Wells:** two new enums + two LEAF tenant tables (`inspections`, `prep_attendance`) — no `(school_id,id)` tenant UK, composite intra-tenant FKs, FORCE RLS + **prod-paste-0047**. NO `boarding_infractions`, no billing, no 3rd (scrubbing) table.

#### INCR-10 · Acceptance criteria (for Quinn)
`now` = server clock UTC (Ghana GMT+0); `template` = `getScheduleTemplate`; `roster` = active BOARDERs in House.
- **A · Timeline + NOW (pure, no storage).** A1 slots done/now/upcoming purely from clock vs ranges, re-render = ZERO DB writes (grep confirms no slot state). A2 single-time block ("21:30 lights out") upcoming before, done after. A3 minutes-in/left from clock. A4 gap between blocks → NOW=null, shows next+time-until (no fabricated NOW). A5 pre-day/after-lights-out → NOW=null, no crash. A6 unseeded day_type → `getScheduleTemplate` null → empty "not configured" (never fabricated). A7 F3 accent from FORM_3 variant (22:00 vs ALL 21:30); no FORM_3 → no accent; main rail always ALL. A8 Wed scrubbing/washing render only on a weekday whose token ∈ policy (Wed=both, Tue=neither, Fri=washing only).
- **B · Day-type.** B1 Saturday→SATURDAY, Wednesday→WEEKDAY. B2 Sunday matching a `VISITING` calendar event→VISITING_SUNDAY, else SUNDAY (distinct templates). B3 computed against UTC.
- **C · Daily inspection (per-dorm 3-state).** C1 record writes type=DAILY, result∈{PASS,PARTIAL,FAIL}, bunks_clean/total, DAILY findings, actor-stamped, audited, atomic. C2 "N of M pass": M=active dorms, N=today's PASS, PARTIAL/FAIL distinct. C3 bunks_total snapshot (a later added bunk doesn't change it). C4 second record same dorm/day appends; grid+count read latest-wins.
- **D · Weekly inspection (separate cadence, same table).** D1 type=WEEKLY, WEEKLY findings (area list), bunks_clean/total NULL; in the weekly pane, NEVER the daily grid/count. D2 same gate (plain HM own House allowed, other House denied). D3 not weekday-constrained (a WEEKLY on Wednesday accepted, stays out of the daily grid).
- **E · Discipline-escalation STUB (INCR-13).** E1 a PARTIAL/FAIL daily records result+anomalies+audit, writes ZERO `boarding_infractions` (grep=0), copy doesn't imply a Note. E2 FAIL weekly writes no infraction (Warning stubbed). E3 no discipline/billing/invoice write anywhere in INCR-10.
- **F · Prep attendance (exception log).** F1 roster auto-populates; a boarder with no exception = present-by-default (no row). F2 logging LATE writes one row (status/minutes_late/session_date/actor); re-log same boarder same night UPSERTS (unique), no 2nd row. F3 NO PRESENT row ever. F4 present-count = roster − ABSENT tonight (LATE counts present; EXCUSED/MEDICAL away-authorized); no counter. F5 "Attendance for scrubbing" writes nothing (stub, no 3rd table).
- **G · Counts (real vs stub) + in-House.** G1 exeats-today + currently-out = live derived reads of `boarding_exeat` (tenant+House scoped, no counter). G2 in-House = roster − (DEPARTED ∧ not returned); **a sickbay boarder is NOT subtracted**. G3 sick-bay count = PLACEHOLDER stub (reads no boarding table, no real derivation, keeps `LIGHT·PLACEHOLDER`+`sb-note`, no medical PII). G4 a DEPARTED boarder returning increments in-House on next read, no write.
- **H · Tenant/RBAC/contract.** H1 cross-tenant inspections/prep denied (FORCE RLS + composite FKs); prod-paste-0047 parity. H2 route `/senior/boarding/houses/[houseId]/today` authed `BOARDING_ROLES` (STUDENT/PARENT/TEACHER/MATRON denied). H3 plain HM only own House (`canAccessHouse`). H4 config via frozen `getScheduleTemplate`/`getInspectionPolicy`/`getBoardingCalendar` ONLY, no re-model. H5 all logic in `lib/boarding/` (no trigger), every write audit-logged.
- **Traps:** T1 dorm not-yet-inspected → "pending" (neutral), excluded from PASS numerator, never phantom PASS (before 06:10 all 8 pending). T2 visiting-Sunday vs normal-Sunday driven by the calendar event, not weekday. T3 day/tz boundary on UTC (22:30 → all done + NOW=null). T4 weekly on non-Saturday accepted, stays out of daily grid. T5 prep for a boarder on exeat → excluded from expected roster (auto-EXCUSED, off-premises), never ABSENT. T6 F3 prep-ext = FORM_3 template variant (not WASSCE-date-gated; contract has no season input); the "club·Thu" rail-foot has no table backing (static/omit).

### Lucy surface map (surface 04) — load-bearing facts
- **Route `/senior/boarding/houses/[houseId]/today` + `?date=YYYY-MM-DD`** (default today); server component, `requireSchoolRole(BOARDING_ROLES)` + BASIC redirect + house-scope for plain HM (mirror the roster page). Reach from the Boarding landing/roster, NOT a new sidebar row.
- **🔴 BINDING sick-bay OVERRIDE (§2.10):** module 4.4 is unbuilt — no table backs the mock's 3 patient rows (temps/symptoms = fake medical PII). **Render the card shell + `LIGHT·PLACEHOLDER` badge + the `sb-note` verbatim (the honest disclaimer) + an empty state — do NOT build the patient rows, stub the count (0/—), and the count MUST NOT feed the in-House subtraction.** Sarah gates "no medical PII".
- **🔴 alpha-on-hex trap (4 hotspots):** house-strip labels on House-red, featured sum-card gold-soft-on-navy, prep-card cells on navy, (the `.dt-slot.upcoming{opacity:0.65}` element-opacity IS the sanctioned form). Use `opacity-N`/solid `-bg` tokens, never slash-opacity a raw hex; verify in live preview. House colour = USER DATA inline `style` + `isLightColour()` (Aggrey `#B43A2F` ≠ terra token).
- **Regions:** house strip (4 stats); NOW strip (derived, pulsing when live); 5 summary cards (all DERIVED — card 4 Wed scrubbing suppressed on non-Wed); day timeline rail (activity blocks not literal 30-min buckets — render whatever `getScheduleTemplate` returns; done/now/upcoming) + 4 rail-foot minis (Wed scrubbing/washing suppressed non-Wed, F3 prep-ext accent, club "Thu only" = negative/empty state); per-dorm DAILY inspection grid (8 dorms PASS/PARTIAL/FAIL — **the record modal + the not-yet-inspected "pending" state are build additions; the surface shows only the populated read**); tonight's prep (per-form counts derived from BOARDER set; the late-log = the exception-write, no visible button on surface — build the entry UI); Wed scrubbing accent (Wed-only, "Attendance for scrubbing" = stub); sick-bay placeholder (override above).
- **Weekly inspection has NO UI on surface 04** (only the grid meta + notes panel) — the board's "weekly pane" is a design addition; recommend a **Saturday-scoped view** of this route; findings shape from the notes panel (washrooms/drying-lines/chop-box/bicycle-shed). Confirm placement.
- **Classification:** DERIVED (timeline/NOW/lights-out from `getScheduleTemplate`+clock; exeats-today+in-House from `boarding_exeat`; inspection pass-count + prep per-form counts). CONFIG frozen READ-only (`getScheduleTemplate`/`getInspectionPolicy`/`getBoardingCalendar`). STORED new (`inspections`, `prep_attendance`). STUB later (sick-bay count/list = 4.4; inspection-fail→discipline Note/Warning = INCR-13 — render result, write nothing). Editorial tenets to honour as behaviour: quiet-when-fine/loud-when-wrong (tiles flip green→warn, fail→terra), be-honest (PARTIAL shown as PARTIAL), be-current (live NOW).
- **Open UI (team, no owner call):** club-accent source (schedule block or static negative state); on-duty-prefect/SoD source (ScheduleBlock.who / F0 prefect roster, no new storage); the prep "4 classrooms" copy vs 3 rendered cells — derive from the allocation, don't hardcode.

---

## INCR-11 ✅ MERGED (PR #155, `5d538d7`) — Boarding resumption/vacation · surface 03 · migration 0048 (+ 3 tweaks) · ⚠️ prod deploy: hand-paste `prod-paste-0048-boarding-resumption.sql`

> **Nothing structural blocks INCR-11, and no OWNER CALL gates the build.** `senior-feat` level with `main`
> (`a572c47`); INCR-7/F0, INCR-8 (frozen `getBoardingCalendar`), INCR-9 (`boarding_exeat` + `feeOwingForStudent`) and
> INCR-10 (`inspections`/`prep_attendance`) merged. The two chaos days of the year — a Housemaster runs a high-volume
> staggered arrival (F3 first → F1 last), and the same surface flips to Vacation/departure. **Wells on the critical
> path** (ONE new tenant table + THREE co-migrated deferred tweaks) blocked on Kofi OQ1. Everything on top is
> READ/DERIVED. **Latent owner gate (does NOT block the build):** module #3 — SMS go-live via Hubtel (arrival/unaccounted
> SMS wire to `sendSms()` console-only until provisioned). Next migration **0048**.

### The 3 deferred tweaks fold into 0048 (flag each)
- **#1 F3 `product_line`** (INCR-8 follow-up): Wells adds `product_line` to `academic_period` (column ALTER, backfill
  existing rows to SENIOR/BASIC, seed the per-school `SENIOR_F3` row from `gen_period_defaults` via onboarding); Claude
  Code swaps `getBoardingCalendar`'s F3 SOURCE from the global `gen_period_defaults` to the school's own
  `academic_period` `product_line='SENIOR_F3'`, and scopes the main resumption/vacation query to `product_line='SENIOR'`.
  **The frozen `BoardingCalendar` return shape + `buildCalendar()` signature are UNCHANGED — only the F3 source moves.**
- **#3 inspections `dormitory_id` nullable + `house_id`** (INCR-10 follow-up, Dex): Wells additive migration (nullable
  `dormitory_id`, add composite `house_id` FK, backfill existing WEEKLY rows' `house_id`); Claude Code points
  `recordWeeklyInspection` (`lib/actions/boarding-daily.ts` — the `dormitoryId: wctx.firstDormId!` anchor) at
  `house_id`+NULL `dormitory_id`, and the weekly read (`daily-data.ts`) at `house_id`. Independently-testable INCR-10 fix.
- **#2 canonical academic-year resolver** (INCR-8 follow-up, Claude Code, no migration): co-locate ONE resolver beside
  `config.ts` (today `getCurrentPeriod` lives in `exeat-data.ts`; billing/onboarding/programme-data diverge); route
  INCR-11 + 9/12 through it. Rides the reads step.

### Goal
Resumption-day ops (surface 03): the staggered **arrival windows** (F3 all-Houses first → F2 → F1 → Late, defaulted from
`getBoardingCalendar` + Form); **House-by-House arrival progress**; the per-arrival **GES prospectus 6-item checklist**
(CHOP·MATTRESS·MAC·NET·BUCKET·BIBLE, each ok/partial/missing) + **fee-owing flag** (live read, never a detention — GES
cannot-detain) + **bunk confirm** (F0 `current_bunk_id`); the **live counter** + foot stats (derived); the **issues
queue** (transport/prospectus-shortfall/unaccounted/fee-shortfall → Senior HM resolves/escalates). **Same surface flips
to VACATION** — the inverse departure checklist (bunk-cleared · locker-emptied · chop-box · transport-verified ·
exeat-card-returned) with departure timestamps. Reads the frozen calendar (F3 now live via #1); reuses the fee-owing
read + the canonicalised resolver (#2); ships the inspections `house_id` fix (#3). Arrival/unaccounted SMS → `sendSms()`
console (no real send until Hubtel go-live).

### Done when
A Housemaster (`BOARDING_ROLES`, house-scoped for plain HM; Dean/HM/Admin school-wide) opens surface 03 and: sees the
staggered arrival windows (F3 first → F1 last) with per-window %arrived DERIVED from the arrival records; sees
House-by-House progress (arrived/expected, per-Form, fee shortfalls — derived); **records each boarder's gate check** —
the GES 6-item prospectus checklist (ok/partial/missing), the live fee-owing flag (`feeOwingForStudent`, surfaced never
blocking, mirrors exeat), the bunk confirmed from `current_bunk_id` — staff+time-stamped; the issues queue surfaces
every shortfall for the Senior HM; the live counter + foot bar derive from the records (**no counter columns**). **The
surface flips to VACATION** and runs the inverse departure checklist with `departed_at` + "safe travels" SMS.
Arrival/unaccounted SMS invoke `sendSms()` (console, no real send) until Hubtel go-live; the "absent for resumption"
past-gate-close state is DERIVED (no discipline write — INCR-13 stub). NEW tenant arrival/departure table (FORCE RLS +
**prod-paste-0048**, composite `(school_id,id)` FKs, per-boarder); frozen contract READ-only; all logic in
`lib/boarding/` (no trigger); audit-logged; three gates green. **Co-shipped in 0048:** tweak #1 (F3 live) + tweak #3
(weekly survives a dorm deactivation).

### Step table
| Step | Owner | State |
|---|---|---|
| Rulings on OQ1–OQ6 + acceptance criteria (**OQ1 arrival-record + checklist shape gates Wells**); confirm NONE owner (SMS go-live = provisioning, not build) | Kofi | ⬜ gates Wells |
| Surface map — surface 03 both modes: mode switch (Resumption↔Vacation, one surface inverse) · counter strip (DERIVED) · arrival-window rail (6 windows F3→F1→Late, per-window %) · House-by-House progress grid · live-arrivals checklist card (6 prospectus pips + fee + bunk + action) · issues queue · foot bar · **the VACATION inverse** (departing counter, 5-item departure checklist, safe-travels SMS, locked-down state). Confirm route | Lucy | ⬜ |
| **Schema (arrival table + 3 tweaks — critical path).** NEW tenant `boarding_arrival`: student_id+house_id (snapshot)+academic_period_id (composite FKs), `mode` enum (RESUMPTION\|VACATION — one table, mode flag), arrival/departure stamp + actor `*_by_user_id` (SET NULL), `checklist_json jsonb` (shape discriminated by `mode`, Zod-in-lib, no DB CHECK), `fee_owing_snapshot numeric(12,2) NULL`, nullable window/note, checked_at, created_at; composite `(school_id,id)` tenant UK + composite intra-tenant FKs; FORCE RLS. **+ TWEAK #1** `academic_period.product_line` (ALTER + backfill + seed SENIOR_F3). **+ TWEAK #3** `inspections.dormitory_id`→nullable + add `house_id` FK + backfill WEEKLY rows. migration **0048** + **prod-paste-0048-boarding-resumption.sql** (new table only) | Wells | ⬜ blocked on Kofi OQ1 |
| Config + fee-owing + canonical-year reads — **#2** co-locate ONE canonical period/year resolver beside `config.ts` (move `getCurrentPeriod` out of `exeat-data.ts`; point 9/12+billing/onboarding/programme at it); **#1 source-swap** in `getBoardingCalendar` (F3 from `academic_period` `product_line='SENIOR_F3'`, main query scoped `='SENIOR'` — **frozen return shape UNCHANGED**); reuse `feeOwingForStudent` (READ-only); `withSchool` server-only | Claude Code | ⬜ |
| Gate-check server actions — record arrival (resumption)/departure (vacation) per boarder: checklist state + freeze `fee_owing_snapshot` + confirm bunk; `lib/boarding/` (no trigger), atomic + `recordAudit`. **Fee-owing NEVER blocks** (flag, mirror exeat). Wire the INCR-10 weekly write/read to `house_id` (#3) | Claude Code | ⬜ |
| Window + counter + House-progress derivations — pure funcs (default windows from calendar+Form F3→F1→Late; per-window %, House progress, live counter, unaccounted-past-window, derivable issues), vitest DB-free, **NO storage/window-state row** | Claude Code | ⬜ |
| GES prospectus + vacation checklist canonical constants — the fixed 6-item resumption + 5-item vacation lists as `lib/boarding/` constants (deboardinization-ladder pattern, `schoolId` in signature for a future override, no config table now) | Claude Code | ⬜ |
| Resumption/Vacation UI (surface 03) — route `/senior/boarding/operations/[mode]` (Lucy confirms; from Boarding landing, NOT a new sidebar row); mode switch · counter strip · window rail · House-progress grid · live-arrivals checklist + gate-check modal · issues queue; house-scope for plain HM; the vacation inverse | Claude Code | ⬜ |
| Arrival/unaccounted SMS chain — arrival-confirmation + unaccounted-at-window (60-min-past) → `sendSms()` (**console, no cost until Hubtel go-live**); unaccounted computed **on-read** (defer timed scheduler, same as INCR-9); NEVER provision `HUBTEL_*` | Claude Code | ⬜ (SMS-live gated on owner #3) |
| Seed — demo resumption-in-progress (arrivals across windows, ~one PARTIAL/missing checklist, a fee-owing arrival, an unaccounted; coherent with F0 boarders incl. J. Manu clean), marker-scoped re-run-safe | Wells/Claude Code | ⬜ |
| Build · typecheck · tests (window/counter/House-progress derivation, checklist write, fee-flag-not-block, mode inverse, unaccounted-on-read, SMS-console, **tweak-1 F3-live + frozen-shape**, **tweak-3 weekly-by-house_id**) · RLS test · preview round-trip | Claude Code | ⬜ |
| QA — staggered windows F3→F1, House progress vs records, prospectus 3-state + fee flag (never blocks), bunk confirm, issues queue, VACATION inverse, unaccounted-derived, SMS console-only, tweak-1 (F3 shifts w/ custom dates + frozen shape) + tweak-3 (weekly survives dorm deactivate), tenant isolation, role/house-scope | Quinn | ⬜ |
| Architecture/portability — derivation+gate-check in `lib/` (no trigger); checklist jsonb Zod-in-lib; windows/counter DERIVED (no counter/window-state); fee-owing READ; SMS behind `sendSms()`; **tweak #1 changes `getBoardingCalendar` INTERNALS only, frozen shape intact**; canonical resolver de-duplicated | Dex | ⬜ |
| Security — new arrival table FORCE RLS + **prod-paste-0048 parity**; cross-tenant denied; composite FKs; route auth + `BOARDING_ROLES` + house-scope; no PII in URL/SMS log; no real send without owner go-live; frozen contract READ-only; tweak ALTERs leak nothing cross-tenant | Sarah | ⬜ holds merge |
| Gate fixes (aggregated) | Claude Code | ⬜ |
| Merge · verify `git log origin/main` · **Pence syncs senior-feat ← main** | Sarah + Pence | ⬜ |

### Dependencies / critical path
Primary consumer of INCR-8's frozen `getBoardingCalendar` (resumption/vacation by Form incl. F3 early return, live via
#1); reuses INCR-9's `feeOwingForStudent`; sits on F0's spine (per-boarder, House + `current_bunk_id`, house-scope);
reuses `sendSms()` (console). Critical path: Kofi OQ1 → Wells (0048: arrival table + #1 + #3) → Claude Code reads
(canonical resolver ∥ calendar source-swap ∥ fee-owing) → gate-check actions ∥ derivations ∥ checklist constants →
surface-03 two-mode UI → SMS chain (console) → 3 gates → Sarah merge → Pence sync.

### Open questions — Kofi rules (**none is an OWNER CALL** — operational)
1. **OQ1 (gates Wells):** ONE `boarding_arrival` table + `mode` enum (RESUMPTION\|VACATION), checklist as `checklist_json`
   (Zod-in-lib, the inspections pattern) vs discrete columns. _Rec: one table + mode flag + jsonb (one-surface-inverse)._
2. **OQ2:** prospectus checklist fixed vs configurable. _Rec: canonical `lib/boarding/` constant now, `schoolId` in sig
   for a future override; defer a config table (YAGNI)._
3. **OQ3:** arrival-window model derived vs stored. _Rec: derive-with-defaults (calendar+Form), no window-state table._
4. **OQ4:** fee-owing at arrival → **flag never block** (GES cannot-detain, mirror exeat); no override role.
5. **OQ5:** issues queue derived vs stored. _Rec: derive what's derivable (missing/snapshot>0/unaccounted) + a lean
   note/flag on the arrival record; a separate issues table only if Kofi wants an independent assign/resolve lifecycle._
6. **OQ6 (folds into #1):** F3 `product_line` seed — source dates from global `gen_period_defaults` `SENIOR_F3` at
   onboarding, school-editable after; backfill existing `academic_period` rows to their product line.

### Risk flags
- **NEW tenant table ⇒ prod-paste RLS** (`prod-paste-0048-boarding-resumption.sql`; db:policies dev-only). Sarah gates parity.
- **Tweak #1 must NOT alter the frozen `getBoardingCalendar` return shape** — change only the F3 SOURCE + scope the main
  query to `product_line='SENIOR'`; `buildCalendar()` signature intact. Dex + Kofi gate the invariant.
- **Tweak #3 additive** — `dormitory_id`→nullable + add `house_id` + backfill WEEKLY rows; DAILY sets `dormitory_id`,
  WEEKLY sets `house_id`+NULL (app-enforced in `lib/`, no DB CHECK). Wells + Quinn.
- **Billing a READ** — `feeOwingForStudent`, tenant-scoped, no billing write. Dex + Sarah.
- **SMS is a PAID external service (STOP-AND-ASK)** — never provision `HUBTEL_*` without owner #3; console-only build.
- **Unaccounted-bell computed on-read + triggered send** (no cron infra, same as INCR-9). Dex/Kofi.
- **Windows/counter/House-progress DERIVED — no storage** (no counter column, no window-state row, no trigger). Dex.
- **Portability** — gate-check + derivation in `lib/boarding/`; checklist jsonb Zod-in-lib; canonical resolver de-duped (#2). Dex.
- **Composite intra-tenant FKs** (arrival→student/house/period; new `inspections.house_id`); DDL order table→UK→ADD-FK. Wells.
- **"Absent for resumption" discipline STUBBED** (INCR-13); records + audits, NO discipline row. Quinn.
- **Seed not idempotent** — marker-scoped, re-run-safe.

### Prerequisites / stop-and-ask
- ✅ `senior-feat` level with `main` (`a572c47`); INCR-7/8/9/10 merged. Next migration **0048**.
- **No owner call before Wells cuts schema** — OQ1 is a Kofi call. Kofi ∥ Lucy start now.
- **Latent owner gate (does NOT block build):** module #3 SMS go-live (provision Hubtel = paid); console-only build, don't provision creds.
- **Deploy note:** migration 0048 + hand-paste `prod-paste-0048-boarding-resumption.sql` (new arrival table). Tweaks #1/#3 are ALTERs on already-RLS'd tables (no new RLS) but must be in 0048 + prod-applied.
- **Forward deps to STUB:** the "absent for resumption" discipline note (INCR-13); real SMS send (owner Hubtel); the timed auto-escalation scheduler (unaccounted on-read + triggered send).

### Kofi rulings — INCR-11 (2026-07-18, none owner) — Wells UNBLOCKED
- **OQ1 → one `boarding_arrival` LEAF table (migration 0048):** id, school_id, `student_id` (composite FK), `house_id` (composite FK, **snapshot**), `academic_period_id` (composite FK, resolved SENIOR semester), `mode boarding_mode_enum NOT NULL` (RESUMPTION|VACATION, new enum), `checklist_json jsonb NOT NULL` (shape discriminated by `mode`, **Zod-in-lib, NO DB CHECK**), `fee_owing_snapshot numeric(12,2) NULL` (frozen at check), `note text NULL` (the one lean issue note — OQ5), `checked_at timestamptz NOT NULL DEFAULT now()` (arrived_at RESUMPTION / departed_at VACATION — mode disambiguates), `checked_by_user_id → users SET NULL`, created_at. **UNIQUE(school_id, student_id, academic_period_id, mode)** (upsert/re-scan idempotency target) + index `(school_id, house_id, academic_period_id, mode)`. **LEAF: no `(school_id,id)` tenant UK** (nothing references it — corrects the board's Wells-row suggestion). NO bunk_id (read `current_bunk_id` live), NO window column (derived), NO arrived/departed split (mode disambiguates one `checked_at`).
- **OQ2 → two fixed canonical `lib/boarding/` constants** (`getResumptionProspectus(schoolId)` / `getVacationChecklist(schoolId)`, schoolId-in-sig unused, deboardinization-ladder pattern, no config table). **Resumption 6 items** (keys): `chop_box`·`mattress`·`mackintosh`·`mosquito_net`·`bucket`·`bible_or_quran` (pips CHOP/MATTRESS/MAC/NET/BUCKET/BIBLE). **Vacation 5 items**: `bunk_cleared`·`locker_emptied`·`chop_box_collected`·`transport_contact_verified`·`exeat_card_returned`. Shared 3-state vocab `ok|partial|missing`.
- **OQ3 → derive windows** (pure funcs from calendar+Form+House-gender, no window-state table). **OQ4 → flag never block** (GES cannot-detain, live `feeOwingForStudent` frozen to snapshot, no override role). **OQ5 → derive issues + one lean `note`, NO issues table** (prospectus-missing / snapshot>0 / unaccounted-past-window / bunk-null all derivable; transport/social-services → the note).
- **OQ6/Tweak #1 → `academic_period.product_line text NOT NULL`** (SENIOR|BASIC|SENIOR_F3); backfill existing rows by `ref_academic_period_config.period_type` (SEMESTER→SENIOR, TERM→BASIC); seed per-school `SENIOR_F3` row from global `gen_period_defaults` `SENIOR_F3` (at onboarding for new schools + in the 0048 backfill for existing SHS). `getBoardingCalendar` swaps F3 source to `academic_period product_line='SENIOR_F3'` + scopes the main query to `='SENIOR'`. **`buildCalendar` sig + `BoardingCalendar` shape UNCHANGED.**

#### INCR-11 · Acceptance criteria (for Quinn)
- **A · Staggered windows (derived, F3-first→F1-last).** A1 6 windows derive from resumption-day + Form + House-gender, no state row (W1 05-07 F3·all, W2 07-09 F2·boys, W3 09-12 F2·girls, W4 12-14 F1·boys, W5 14-16 F1·girls, W6 16-18 Late·all). A2 per-window % = arrivals in the window's Form-cohort ÷ expected cohort (from rows). A3 done/active/pending from clock, never stored. A4 W6 "Late" is a time bucket (count-only, no denominator). A5 House gender drives the F2/F1 split. A6 custom SENIOR dates → windows derive on the shifted day.
- **B · House progress (derived).** B1 arrived/expected per House from row-count (no counter). B2 per-Form breakdown. B3 fee-shortfall = arrivals with snapshot>0. B4 plain HM own House only, Dean/HM/Admin all + totals.
- **C · Counter + foot (derived).** C1 total arrived/% from rows vs active-boarder count. C2 arrived-this-hour + rate from `checked_at`. C3 foot stats derived, none stored.
- **D · Prospectus checklist (3-state).** D1 6 items/order/labels from the constant. D2 each item ok|partial|missing, Zod rejects other/missing/extra keys. D3 partial/missing → shortfall but does NOT block. D4 all-ok → no shortfall. D5 checklist_json mode-discriminated (RESUMPTION Zod-validates the 6 keys, rejects the 5 vacation keys, vice versa).
- **E · Fee-owing flag (never blocks).** E1 live `feeOwingForStudent` at check, frozen to snapshot, READ-only. E2 balance>0 records successfully, flag surfaced, NOT blocked, no override role. E3 snapshot>0 → shortfall+queue; 0/null → CLEAR. E4 frozen at check, not re-read per view.
- **F · Bunk confirm (F0 live).** F1 bunk from `current_bunk_id`, no bunk_id column. F2 null bunk → "unallocated" shortfall, never blocks.
- **G · Issues queue (derived + note).** G1 derive 4 categories, no issues table/status. G2 unaccounted-past-window = ACTIVE boarder, no RESUMPTION arrival, window-close+grace passed — derived, no stored flag, no discipline write. G3 note carries arrived-with-caveat, optional. G4 escalate/resolve not persisted; "escalate" fires console SMS only.
- **H · VACATION inverse.** H1 mode switch flips the same surface + table via the enum. H2 5 vacation items from the constant, 3-state, Zod-discriminated. H3 departure records checked_at + actor; counter/windows invert (F3 departs first). H4 "safe travels" SMS console. H5 one RESUMPTION + one VACATION row per (student×period) coexist (the unique includes mode).
- **I · SMS console-only.** I1 arrival-confirm → sendSms console, no HUBTEL_*. I2 unaccounted on-read (60-min-past) → console, no scheduler. I3 zero cost until Hubtel go-live.
- **J · Tweak #1 (F3 school-driven, frozen shape).** J1 F3 vacation derives from the school's `academic_period product_line='SENIOR_F3'`; editing shifts it. J2 main lists scope `='SENIOR'` (SENIOR_F3 doesn't leak into F1/F2). J3 `BoardingCalendar` return shape + `buildCalendar` sig byte-for-byte unchanged (regression: `getExeatBoard.nextWindow` still resolves). J4 no SENIOR_F3 row → f3Vacation null, no throw. J5 backfill tags existing rows SENIOR/BASIC + seeds SENIOR_F3 for existing SHS.
- **K · Tweak #3 (WEEKLY survives dorm deactivate).** K1 WEEKLY writes house_id + NULL dormitory_id; DAILY still dormitory_id; app-enforced in lib, no DB CHECK. K2 after a WEEKLY, deactivating its former-anchor dorm → the WEEKLY row still reads (by house_id). K3 weekly read by house_id, daily by dormitory_id. K4 existing WEEKLY rows backfilled house_id.
- **L · Tenant/RBAC/contract.** L1 cross-tenant arrival read/write denied (withSchool RLS). L2 composite FKs cross-tenant-proof. L3 BOARDING_ROLES gate (STUDENT/PARENT/TEACHER/MATRON denied); plain HM house-scoped. L4 boarding_arrival FORCE RLS + prod-paste-0048 parity; contract READ-only. L5 no PII in URL/SMS-log.
- **M · Re-scan idempotency.** M1 re-scan same boarder+mode+period upserts the one row (unique), never a dup. M2 counter/progress count each boarder once.
- **Domain traps:** wrong-Form window (recorded, % attributes to expected cohort); late-after-gate-close (W6 catches 16-18, past 18:30 = derived "absent for resumption", no discipline write); fee-owing admitted (snapshot+flag, never blocked); roster-boarder-never-arrives (derived unaccounted, console SMS, no flag/discipline); vacation-depart-still-owing (recorded, flag, never blocked — cannot-detain symmetric); F3 early vacation (SENIOR_F3 date via #1, row still on SENIOR period_id); re-scan (upsert, counted once); no-bunk arriving (recorded, "unallocated" shortfall); day-student at gate (not on roster, no arrival row — residency gate).

### Lucy surface map (surface 03) — load-bearing facts
- **Route `/senior/boarding/operations/[mode]`** (`[mode]` ∈ resumption|vacation) + **`?date=`** (default today, prefer over the surface's path-segment date); from the Boarding landing, NOT a new sidebar row; `requireSchool`+`assertAnyRole(BOARDING_ROLES)`+house-scope for plain HM (Dean/HM/Admin school-wide + totals).
- **Dual-mode = ONE surface, ONE table, `mode` enum** — the tab flips every region's copy/semantics (arriving↔departing, arrival-checklist↔departure-checklist, close-gate↔lock-down). VACATION concrete copy is DERIVED from the notes/editorial (the HTML renders only Resumption) — the 5-item departure list + "safe travels" SMS are canonical (explicit in notes); the VACATION House-card fee→"rooms cleared" swap + VACATION issue-types are PROPOSED (confirm).
- **🔴 no-alpha trap:** every muted-on-navy label (live-strip/foot gold-soft @60-75%, browser-bar white @0.18) is raw `rgba()` → use `opacity-N`/solid tokens, NEVER slash-opacity a raw-hex token; verify in preview. **House band colours = USER DATA inline `style`** (bespoke `#B43A2F`/`#E5C44A`/`#9B6FAA`, token-equal navy/green, white `#FFFFFF` needs the `border-border-2` hairline). Fee-cleared renders the WORD `CLEAR` (green), not `—`.
- **Regions (all DERIVED unless noted):** mode-switch bar; live counter strip (clock/arrived/rate/peak); arrival-window rail (6 windows done/active/pending — 2 pending sub-states: `0/N·0%` vs `— pending —`); House-by-House grid (6 cards, band=House colour, arrived/expected + per-Form + fee-shortfall + status pill live/done/waiting + bar green/warn); **live-arrivals checklist card = the STORED gate-check** (6 pips ok/partial/missing + fee CLEAR/owed + bunk + View/Note/Process action; the 90-sec scan→mark→auto-fee/bunk→SMS **gate-check modal** is the write path); issues queue (terra alarm card, derived + routing HM/Senior-HM/Dean); foot bar (4 stats + close-gate CTA).
- **Genuinely-open UI (confirm/decide, not owner calls):** (a) gate-close 6PM/supper/lock-down times have **no config source** — recommend a resumption/vacation calendar field or a `lib/boarding/` default, do NOT overload `getExeatPolicy`; (b) empty-issues-queue = a NEW calm `bg-green-bg` "No open issues" state (surface only shows the terra alarm); (c) VACATION House-card "Fee shortfalls → Rooms cleared/Keys returned" swap + VACATION issue-type set (proposed); (d) `?date=` query vs path segment.
- **STUB (build wires, doesn't activate):** real SMS send (owner Hubtel — console-only, never provision `HUBTEL_*`); unaccounted-bell on-read + triggered send (no cron); "absent for resumption" → discipline note (INCR-13, no discipline row).

---

## INCR-12 ✅ MERGED (PR #156, `867ed5d`+`8c1b7ac`) — Boarding visiting day · surface 06 · migration 0049 · ⚠️ prod deploy: hand-paste `prod-paste-0049-boarding-visiting.sql`

> **Nothing structural blocks INCR-12, and no OWNER CALL blocks the build.** `senior-feat` level with `main`
> (`d72f50d`); INCR-7/F0, INCR-8 (frozen `getVisitingPolicy` + `getBoardingCalendar` VISITING events), INCR-9
> (`sendSms()` + the `exeat_notification` idempotent-log + the exeat two-stamp in/out) and INCR-11
> (`boarding_arrival` upsert-idempotency + the canonical year resolver) merged. The digital Visitor's Book — the
> school's front door, one Sunday a month. **Wells on the critical path** (TWO new tenant tables — a durable
> approved-visitor list + the visit record) blocked on Kofi OQ1. **Second-to-last Boarding increment (only INCR-13
> discipline remains).** **OWNER scope/security call (does NOT block the build — OQ-A):** is the parent RSVP link a
> PUBLIC unauthenticated tokenised surface, or **staff-entered RSVP** for v1? _Rec: staff-entered v1 (authed app),
> defer the public link._ **Latent owner gate (does NOT block build):** module #3 SMS go-live via Hubtel
> (invitation/reminder/arrival/overstay SMS → `sendSms()` console-only). Next migration **0049**.

### Goal
Visiting-day ops (surface 06): the monthly **2nd-Sunday · 12:00–16:00** cadence (lunch 11:30, dormitories out of
bounds), keyed to a **VISITING calendar event** from the frozen `getBoardingCalendar`; **parent RSVP** (staff-entered
v1 — the "indicated arrivals" list; the public tokenised link = OQ-A/deferred); the **approved-visitor list per student**
(max ~6 durable names, HM-curated, Dean-approved for pastoral-sensitive) the gate **verifies against**; per-visitor
**in/out timestamping** (arrive→depart, exeat two-stamp pattern); **RSVP-by-House + zone occupancy + arrival counters**
(all DERIVED); **unauthorised-visitor flag** (not on list → flag + actor-stamped HM verbal-auth override, never silent,
never a hard turn-away) + **overstay** (past `hoursEnd`+grace, on-read, HM notified). Reads the frozen `getVisitingPolicy`
+ `getBoardingCalendar` VISITING events; RSVP/arrival/overstay SMS → `sendSms()` console. **Visiting is NOT fee- or
discipline-gated** (OQ-F — no `feeOwingForStudent` call).

### Done when
A Housemaster/SoD (`BOARDING_ROLES`, house-scoped for plain HM; Dean/HM/Admin school-wide) opens surface 06 for a
VISITING event and: sees the countdown + 5 DERIVED cards + **RSVP-by-House counters** (per House arrived/expected, per-Form,
respecting the event `formScope` e.g. "Forms 1 & 2 only") derived from records; **manages a student's approved-visitor
list** (add/remove ≤ max, PENDING→APPROVED, Dean-gate on pastoral — VLC 4.5 STUB); **records a gate check per visitor** —
RSVP (staff-entered) → **arrive** (in-stamp; matched to approved list = VERIFIED, else FLAGGED requiring an actor-stamped
HM authorisation, never silent, never hard-block) → **depart** (out-stamp); sees **zone allocation + occupancy** (zones a
`lib/boarding/` constant, occupancy derived) + the **overstay** state (past `hoursEnd`+grace, on-read, HM notified via
console SMS — NO discipline write, INCR-13 stub). NEW tenant tables (durable `boarding_approved_visitor` + `boarding_visit`;
FORCE RLS + **prod-paste-0049**, composite FKs, per-boarder); frozen contract READ-only; all logic in `lib/boarding/` (no
trigger); **PII (visitor names/phones/IDs) tenant-scoped, never in a URL/SMS log**; audit-logged; three gates green.

### Step table
| Step | Owner | State |
|---|---|---|
| Rulings on OQ1–OQ7 + acceptance criteria (**OQ1 approved-visitor + visit table shape gates Wells**); surface OQ-A (RSVP-link scope/security — OWNER) + module #3 SMS; confirm not fee/discipline-gated (OQ-F) | Kofi | ⬜ gates Wells |
| Surface map — surface 06 all blocks: countdown strip · 5 summary cards (DERIVED) · RSVP-by-House 6 counters · indicated-arrivals per-student list (student·visitor·relationship·VERIFIED/NEEDS-REVIEW·action) · approved-visitor detail card (max-6 slots + empty) · 3-zone allocation + capacity · OOB/overstay reminder · §2 editorial security tenets (list-CHECK not list-RECORD; flag→HM verbal auth; no photos/QR in front of parent). Confirm route | Lucy | ⬜ |
| **Schema (approved-visitor + visit — critical path).** NEW tenant `boarding_approved_visitor` (DURABLE, **referenced by visits → needs `(school_id,id)` tenant UK**): student_id (composite FK), name, relationship, id_hint/phone (PII), `status` enum PENDING_REVIEW\|APPROVED, pastoral_review flag (Dean/VLC stub), added_by/at; max-N app-enforced in `lib/`. NEW tenant `boarding_visit` (two-stamp in/out, mirrors exeat depart/return): student_id+house_id (snapshot)+calendar_event_id (composite FKs), `approved_visitor_id` NULL SET NULL (NULL=flagged not-on-list), visitor_name/phone snapshot, `status` enum RSVP\|ARRIVED\|DEPARTED + `verification` VERIFIED\|FLAGGED\|HM_AUTHORISED, `zone_key` NULL, arrived_at/departed_at + actor `*_by_user_id`, authorised_by/at, note; composite `(school_id,id)` UKs + composite FKs; new enums; FORCE RLS; migration **0049** + **prod-paste-0049-boarding-visiting.sql**. (Optional OQ7) lean `boarding_visit_notification` idempotent log OR flags | Wells | ⬜ blocked on Kofi OQ1 |
| Config reads — `getVisitingPolicy` READ-ONLY (window/lunch/dormitories-rule/`approvedVisitors` **policy-string label ONLY, NOT the per-student list**/bookOwner) + `getBoardingCalendar` VISITING events (date + formScope; `nextVisiting`, `?date=`/`?eventId=`); reuse canonical resolver (#2). **NO `feeOwingForStudent`** (OQ-F). `withSchool` server-only | Claude Code | ⬜ |
| Approved-visitor CRUD — add/remove ≤ max, PENDING→APPROVED, Dean-gate on pastoral (VLC 4.5 STUB); `lib/boarding/`, atomic + audit; max-N in `lib/` | Claude Code | ⬜ |
| Visit gate-check actions — RSVP (staff-entered) → arrive (in-stamp; verify vs approved list → VERIFIED else FLAGGED needing actor-stamped HM auth before admit — flag+override, never silent, never hard-block) → depart (out-stamp); `lib/boarding/`, atomic + audit; upsert-idempotent per (student×event×visitor) | Claude Code | ⬜ |
| Derivations — RSVP-by-House (respect `formScope`), zone occupancy, arrival counter, overstay-on-read — pure funcs, vitest DB-free, **NO counter/occupancy columns** | Claude Code | ⬜ |
| Canonical constants — visitor zones (`lib/boarding/` constant, name·for-whom·capacity, schoolId-in-sig) + max-N/relationship rule | Claude Code | ⬜ |
| RSVP/arrival/overstay SMS chain — invitation (T-7) + reminders + arrival-confirm + overstay → `sendSms()` (**console, no cost until Hubtel**); overstay on-read; idempotent (OQ7); NEVER provision `HUBTEL_*` | Claude Code | ⬜ (SMS-live gated on owner #3) |
| Visiting-day UI (surface 06) — route `/senior/boarding/operations/visiting` (Lucy confirms; from Boarding landing, NOT a new sidebar row); countdown · summary · RSVP-by-House · indicated-arrivals list · approved-visitor detail+editor · zones+occupancy · OOB/overstay · gate-check modal (list-check + flag→HM-auth); house-scope for plain HM | Claude Code | ⬜ |
| Seed — demo visiting day (RSVPs across Houses respecting a `FORMS_1_2` event, approved lists incl. J. Manu pastoral/Dean-approved 5-of-6, one flagged not-on-list, zone allocations), marker-scoped re-run-safe | Wells/Claude Code | ⬜ |
| Build · typecheck · tests (list-verify vs flag+override, in/out two-stamp, RSVP-by-House w/ formScope, zone occupancy, overstay-on-read, max-N, SMS-console, tenant isolation) · RLS test · preview round-trip | Claude Code | ⬜ |
| QA — cadence/window from `getVisitingPolicy`, VISITING event keying + formScope cohorts, approved-list gate-verify + flag→HM-auth (never silent/never hard-block), in/out timestamps, RSVP-by-House + zone counters (derived), overstay-on-read, max-N, not-fee/discipline-gated, PII scoping, SMS console-only, tenant isolation, role/house-scope | Quinn | ⬜ |
| Architecture/portability — CRUD + gate-check + derivation in `lib/` (no trigger); zone/max-N Zod-in-lib; counters/occupancy DERIVED; frozen contract READ-only; SMS behind `sendSms()`; VLC STUBBED; no fee coupling | Dex | ⬜ |
| Security — both new tenant tables FORCE RLS + **prod-paste-0049 parity**; cross-tenant denied; composite FKs; route auth + `BOARDING_ROLES` + house-scope; **visitor-list PII (names/phones/IDs) tenant-scoped, never in URL/SMS log — the biggest external-PII surface in Boarding**; no real send without owner go-live; **IF OQ-A ships the public link → its own unauthenticated-surface envelope (token signing/expiry, no-session tenant scope, rate-limit, minimal exposure)** | Sarah | ⬜ holds merge |
| Gate fixes (aggregated) | Claude Code | ⬜ |
| Merge · verify `git log origin/main` · **Pence syncs senior-feat ← main** | Sarah + Pence | ⬜ |

### Dependencies / critical path
Reads INCR-8's frozen `getVisitingPolicy` + `getBoardingCalendar` VISITING events (READ-only); sits on F0's spine
(per-boarder, House, house-scope); reuses INCR-9's `sendSms()` console + `exeat_notification` idempotent pattern; the
visit record's in/out mirrors the **exeat depart/return two-stamp** (needs BOTH arrive AND depart on one row — closer than
`boarding_arrival`'s single `checked_at`); reuses INCR-11's upsert-idempotency + canonical year resolver (#2). **Does NOT
read billing** (not fee-gated — OQ-F). Critical path: Kofi OQ1 (+ owner OQ-A) → Wells (0049) → Claude Code reads → CRUD ∥
gate-check ∥ derivations ∥ zone/max-N constants → surface-06 UI → SMS chain (console) → 3 gates → Sarah merge → Pence sync.

### Open questions — Kofi rules (**OQ-A is the OWNER-facing scope/security call; module #3 SMS is a latent owner gate**)
1. **OQ1 (gates Wells) — table shapes.** DURABLE `boarding_approved_visitor` (referenced by visits → **needs a
   `(school_id,id)` tenant UK**, unlike the INCR-10/11 LEAF tables) + `boarding_visit` (two-stamp in/out, nullable
   `approved_visitor_id`, verification state, zone key). _Rec: two tables; verification vocab Zod-in-lib._
2. **OQ-A — RSVP-link scope + security (OWNER CALL · scope + Sarah).** Public unauthenticated tokenised parent link vs
   staff-entered RSVP v1. Public = a NEW unauthenticated surface collecting external PII with no session (token
   signing/expiry, no-session tenant scope, rate-limit) + depends on SMS go-live. _Rec: staff-entered v1 (the
   "indicated arrivals" list the surface renders); defer the public link with a dedicated security envelope._
3. **OQ3 — approved-visitor SOURCE + max.** HM-managed CRUD (no admissions-ingest exists) vs first-RSVP-captured. _Rec:
   HM CRUD now, schoolId-in-sig for a future ingest, max ~6 in `lib/`, Dean-approval on pastoral (VLC stub)._ Confirm max.
4. **OQ4 — unauthorised visitor: flag vs hard-block.** §2 editorial: list-CHECK not list-RECORD; not-on-list → flag +
   SoD calls HM for verbal auth (actor-stamped override), never silent, never a hard turn-away. _Rec: FLAGGED → needs
   HM_AUTHORISED to admit; the visit records both flag + authoriser._
5. **OQ5 — zones/capacity: derived or stored.** _Rec: zones a `lib/boarding/` constant + nullable `zone_key` on the visit; occupancy DERIVED._
6. **OQ-F — visiting gated on anything?** Surface has no fee column, no discipline gate. _Rec: NOT fee-gated, NOT
   discipline-gated — no `feeOwingForStudent` call; overstay is a notification NOT a discipline write (INCR-13 stub)._ Confirm.
7. **OQ7 — SMS idempotency.** Reminders are cohort-batch (pre-visit, no visit row); arrival/overstay are per-visit. _Rec:
   a lean `boarding_visit_notification` log (mirror `exeat_notification`, event-scoped reminders / visit-scoped arrival) or flags; pick the smaller; overstay on-read._

### Risk flags
- **NEW tenant tables ⇒ prod-paste RLS** (`prod-paste-0049-boarding-visiting.sql`; db:policies dev-only). Sarah gates parity.
- **🔴 The RSVP link, IF public, is an UNAUTHENTICATED surface** (parent, no session, reads/writes tenant PII) — a real new attack surface. _Rec: staff-entered v1, defer public (OQ-A); if it ships, Sarah gates the full token/expiry/no-session-scope/rate-limit/minimal-exposure envelope._
- **🔴 PII — the approved-visitor list is the biggest external-PII surface in Boarding** (adults' names, relationships, phones, ID hints). FORCE RLS, no PII in URL/SMS log, minimal exposure. Sarah.
- **SMS is a PAID external service (STOP-AND-ASK)** — never provision `HUBTEL_*` without owner #3; console-only build.
- **Frozen contract READ-ONLY** — `getVisitingPolicy`/`getBoardingCalendar` never re-modeled. `approvedVisitors` config is a **policy STRING label, NOT the per-student list** — don't conflate. Dex + Kofi.
- **Counters/occupancy DERIVED — no storage.** Dex.
- **Overstay on-read + triggered send** (no cron); overstay is a notification, **no discipline write** (INCR-13 stub). Dex/Quinn.
- **VLC pastoral cross-link STUBBED** (module 4.5) — nullable flag + manual. **Composite intra-tenant FKs**; DDL order table→UK→ADD-FK. Wells.
- **Don't wire fee-owing** (OQ-F — no fee dimension). **Seed not idempotent** — marker-scoped, re-run-safe.

### Prerequisites / stop-and-ask
- ✅ `senior-feat` level with `main` (`d72f50d`); INCR-7/8/9/10/11 merged. Next migration **0049**.
- **OWNER scope/security call (does NOT block the build): OQ-A — public tokenised RSVP link vs staff-entered.** Default staff-entered v1; don't build a public unauthenticated surface silently.
- **Latent owner gate (does NOT block build):** module #3 SMS go-live (provision Hubtel = paid); console-only build.
- **Deploy note:** migration 0049 + hand-paste `prod-paste-0049-boarding-visiting.sql` on prod.
- **Forward deps to STUB:** VLC pastoral cross-link (module 4.5); overstay "discipline note" (INCR-13 — no discipline row); real SMS send (owner Hubtel); the timed scheduler (overstay on-read + triggered send).

### Kofi rulings — INCR-12 (2026-07-18) — OQ-A owner-settled (staff-entered v1, public link deferred) — Wells UNBLOCKED
- **OQ1 → THREE new tenant tables (migration 0049) + 4 enums.** Enums: `visitor_approval_status` (PENDING_REVIEW|APPROVED), `visit_status` (RSVP|ARRIVED|DEPARTED), `visit_verification` (VERIFIED|FLAGGED|HM_AUTHORISED), `visit_notification_kind` (INVITATION|REMINDER_T3|REMINDER_T1|ARRIVAL_CONFIRM|OVERSTAY).
  - **`boarding_approved_visitor`** (DURABLE — **needs `(school_id,id)` tenant UK**): id, school_id, `student_id` (composite FK), `name`, `relationship text` (FREE TEXT, not enum), `id_hint text NULL` (PII), `phone text NULL` (PII), `status visitor_approval_status DEFAULT PENDING_REVIEW`, `pastoral_review bool DEFAULT false` (Dean-gate/VLC stub), note, added_by/approved_by (SET NULL users), approved_at, created_at. Index `(school_id, student_id)`. **Max-6 app-enforced in `lib/`** (no DB cardinality constraint). FORCE RLS.
  - **`boarding_visit`** (two-stamp in/out — **needs `(school_id,id)` tenant UK**): id, school_id, `student_id`+`house_id` (snapshot, composite FKs), `calendar_event_id uuid NULL SET NULL` (single-col, exeat exemption), `approved_visitor_id uuid NULL SET NULL` (single-col — NULL = flagged not-on-list OR later-removed; the snapshot is the durable record), `visitor_name text NOT NULL` (snapshot), `visitor_phone`/`relationship` (snapshot), `status visit_status DEFAULT RSVP`, `verification visit_verification DEFAULT FLAGGED` (**safe default — never silently VERIFIED**), `zone_key text NULL`, note, stamps `rsvp_by`/`arrived_at`+`arrived_by`/`departed_at`+`departed_by`/`authorised_at`+`authorised_by` (SET NULL actors), created_at. **UNIQUE `(school_id, student_id, calendar_event_id, approved_visitor_id)`** (re-RSVP idempotency; NULL-distinct so multiple flagged walk-ins coexist) + index `(school_id, calendar_event_id, house_id)`. **NO `fee_owing_snapshot` (OQ-F).** FORCE RLS.
  - **`boarding_visit_notification`** (LEAF, mirror `exeat_notification`, dual-scoped): id, school_id, `visit_id uuid NULL` (composite FK, MATCH SIMPLE), `calendar_event_id uuid NULL SET NULL` (cohort sends), `kind visit_notification_kind`, to_phone, body, provider, provider_message_id, error, ok, sent_at, sent_by. Index `(school_id, visit_id)` + `(school_id, calendar_event_id)`. FORCE RLS. DDL order: enums → approved_visitor(+UK) → visit(+UK, SET-NULL FKs) → notification(composite FK after visit UK).
- **OQ3 → HM-managed CRUD, max = 6** (`MAX_APPROVED_VISITORS=6` in `lib/`, schoolId-in-sig future ingest); PENDING_REVIEW→APPROVED; pastoral-sensitive → Dean (VLC stub).
- **OQ4 → FLAG, never hard-block, never silent (list-CHECK not list-RECORD).** Not-on-list/pending → `verification=FLAGGED`; admit needs an actor-stamped HM override → `HM_AUTHORISED` (authorised_by/at); **the override admits THIS visit only, does NOT create a `boarding_approved_visitor` row** (list curation is a separate CRUD action).
- **OQ5 → zones = `lib/boarding/` constant** (`main_lawn`~700 / `dining_annex`~300 / `library_quad`~200; total ~1,200), nullable `zone_key` on the visit, occupancy DERIVED. OOB is editorial copy, not a zone_key.
- **OQ-F → NOT fee-gated, NOT discipline-gated** (no `feeOwingForStudent` call, no fee_owing_snapshot column); overstay = notification, NO discipline write (INCR-13 stub).
- **OQ7 → ONE lean `boarding_visit_notification` (dual-scoped)**: cohort invitation/reminders (event-scoped, no visit row) + per-visit arrival/overstay; idempotent `NOT EXISTS(scope, kind)`; overstay on-read (no cron), grace 15 min (past 4:15).

#### INCR-12 · Acceptance criteria (for Quinn)
- **A · cadence/window (frozen READ-only).** A1 keyed to a VISITING calendar event (never re-derived "2nd Sunday"). A2 window/lunch from `getVisitingPolicy` (not hard-coded). A3-A4 cadence/dormitoriesRule/bookOwner render as labels; `approvedVisitors` is a policy STRING label, never the per-student list. A5 editing settings/event shifts the surface with zero INCR-12 write; getters never re-modeled.
- **B · approved-visitor HM CRUD.** B1 add/remove → row, audit. B2 7th (max+1) rejected, first 6 persist. B3 default PENDING_REVIEW; HM approve → APPROVED. B4 `pastoral_review` → Dean-gated (manual STUB, no VLC write). B5 zero approved visitors is valid (pastoral signal, not an error). B6 remove a visitor → row gone; past visits keep the snapshot with `approved_visitor_id` nulled (history intact).
- **C · gate check (list-CHECK not list-RECORD).** C1 APPROVED match → VERIFIED. C2 not-on-list → FLAGGED, approved_visitor_id NULL, never silently VERIFIED/never hard-turn-away (row still created). C3 PENDING_REVIEW at the gate → FLAGGED. C4 admitting FLAGGED needs actor-stamped HM override → HM_AUTHORISED (authorised_by/at); else stays FLAGGED. C5 the override admits THIS visit only, does NOT create an approved_visitor row. C6 the visit persists flag + authoriser. C7 no visit ever hard-blocked.
- **D · two-stamp in/out.** D1 arrive → ARRIVED + arrived_at/by. D2 depart → DEPARTED + departed_at/by. D3 depart-before-arrive rejected. D4 departed_at ≥ arrived_at. D5 walk-in inserts directly at ARRIVED. D6 re-record same (student×event×visitor) upserts one row.
- **E · RSVP-by-House + formScope (DERIVED).** E1 per-House arrived/expected + per-Form from row counts (no counter). E2 `formScope=FORMS_1_2` → expected + shown cohort scope to F1+F2 only (F3 excluded). E3 null formScope → whole-school. E4 cohort = ACTIVE ∧ BOARDER (DAY/DEBOARD/WITHDRAWN excluded). E5 plain HM own House only.
- **F · zones/occupancy (DERIVED).** F1 from the constant (3 zones, ~700/~300/~200). F2 zone_key nullable. F3 occupancy = ARRIVED-not-DEPARTED with that zone_key (no column). F4 advisory, no hard-block on capacity.
- **G · overstay (on-read, NO discipline).** G1 overstay = ARRIVED ∧ no departed_at ∧ now > hoursEnd+15m (on-read, no stored flag). G2 → HM console SMS (OVERSTAY kind, idempotent). G3 ZERO discipline row (INCR-13 stub). G4 +30m Senior-HM tier = derived display escalation (no extra send). G5 departed → not overstaying.
- **H · not fee/discipline-gated.** H1 no `feeOwingForStudent` call, no fee_owing_snapshot column. H2 fee-owing family visits normally. H3 discipline-rung boarder visits normally.
- **I · SMS console + idempotency.** I1 INVITATION/REMINDER_T3/T1 event-scoped (visit_id NULL); ARRIVAL_CONFIRM/OVERSTAY visit-scoped. I2 idempotent `NOT EXISTS(scope, kind)` (re-click reminder / re-arrival no double-send). I3 provider=console, no HUBTEL_*. I4 pastoral-active arrival → console HM notification (no VLC journal write — stub).
- **J · tenant/RBAC/PII/contract.** J1 cross-tenant denied (withSchool RLS + composite FKs). J2 BOARDING_ROLES gate; STUDENT/PARENT/TEACHER/MATRON denied; plain HM house-scoped. J3 all 3 tables FORCE RLS + prod-paste-0049 parity. J4 **visitor PII (names/phones/ID hints) NEVER in a URL or SMS-log payload** beyond delivery to_phone; the surface MASKS the phone ("+233 24 *** *** 91"); no photos/QR (§2). J5 frozen getters READ-only. J6 all logic in `lib/boarding/` (no trigger).
- **K · everything derived (no storage):** 5 summary cards, RSVP-by-House, zone occupancy, arrival counters, overstay — pure derivations, no counter/occupancy/overstay columns; vitest DB-free.
- **Traps:** never-met approved relative (VERIFIED on match) vs flagged stranger (FLAGGED→HM auth, NOT added to list); out-of-formScope visit (surface-as-anomaly, not hard-blocked); zero-approved-visitors (valid, pastoral signal); overstay past 4 (console SMS, no discipline); same visitor across 2 students (separate rows per student); DAY/DEBOARD/WITHDRAWN excluded from cohort; max-N+1 rejected; approved-visitor removed after a visit (SET NULL, snapshot survives); event deleted (SET NULL, history survives); walk-in no-RSVP (ARRIVED direct, flag if not on list).

### Lucy surface map (surface 06) — load-bearing facts
- **Route `/senior/boarding/operations/visiting`** — a NEW **static** page (do NOT fold into `operations/[mode]` — that redirects non-resumption/vacation); from the Boarding landing (add a 3rd Operations link), NOT a new sidebar row; `requireSchoolRole(BOARDING_ROLES)` + BASIC redirect + house-scope; `?date=`/`?eventId=` (default `nextVisiting`).
- **🔴 TWO flag vocabularies collide by name — give DISTINCT treatments:** (1) `.pa-row.flagged` (terra row highlight) = the **pastoral-attention** highlight (J. Manu, `isPastorallyFlagged('ASK-24-0118')` stub) — NOT a security flag; (2) `boarding_visit.verification=FLAGGED` = the **gate not-on-list** security state (Sunday-live) → the flag→HM-auth modal. Never render them the same. Also distinct from `.approved` column (the pre-arrival list-match: VERIFIED green / `+N NEEDS REVIEW` gold → `[Review]` opens the editor).
- **🔴 PII (biggest external-PII surface in Boarding):** visitor names/phones/ID-hints are adults' external PII. **Store full, render MASKED** (phone → "+233 24 *** *** 91"); ID is a HINT not a document; **no photo/QR** (the check is done out of the parent's sight, §2 tenet); NEVER in a URL/query/audit/SMS-log beyond delivery to_phone; server-only data module → client gets pre-masked strings.
- **🔴 list-CHECK not list-RECORD (§2 tenet):** the gate pulls the student's approved list + matches the visitor; not-on-list → FLAG → SoD calls HM for verbal auth (actor-stamped HM_AUTHORISED); never silent, never a hard turn-away; the override does NOT append to the list.
- **Regions (all DERIVED unless noted):** countdown strip (date derived + window config); 5 summary cards; RSVP-by-House 6 counters (respect formScope — F3 excluded on FORMS_1_2; plain `.rsvp-cell`, no House-colour band by default); indicated-arrivals per-student list (the STORED visit + list-match); approved-visitor detail card (6 slots + empty slot = the add affordance; the CRUD editor with PENDING→APPROVED + Dean/VLC stub); 3-zone allocation (constant + derived occupancy); OOB/overstay reminder (static copy + overstay-on-read 16:15/16:30). Fee-cleared analog: n/a (no fee dimension).
- **Copy/honesty:** "RSVP via SMS link" is aspirational (staff-entered v1, no public page) — keep the console reminder-SMS affordance, drop any parent-self-serve implication. VLC pastoral cross-link + "HM checks in on J. Manu" = 4.5 stub (must not imply a working VLC journal). House names = per-school config (Aggrey/Guggisberg/... is Asankrangwa's set), render from data.

---

## INCR-13 ✅ MERGED (PR #157, `6c50ec8`) — Boarding discipline & deboardinization · surface 07 · migration 0050 · 🏁 CLOSED MODULE 4.2 · ⚠️ prod deploy: hand-paste `prod-paste-0050-boarding-discipline.sql`

> **🟥 SCOPE BOUNDARY (OWNER-SETTLED — DO NOT RE-OPEN): BUILD ALL OF INCR-13 EXCEPT THE INVOICE WRITE.** The 3× boarding-fee penalty →
> production-billing invoice write (BUILD_STACK #6 / module owner decision #2) is **STUBBED**: model
> `deboardinization_records.fee_penalty_invoice_id` (nullable, **LEFT NULL**, **NO FK to `invoices`**) + a **"penalty pending — billing
> not yet wired"** display, but write **NO `invoices` row, touch NO billing/finance table, create NO PENALTY fee-category**. The billing
> trigger is a clearly-marked follow-up for a later owner decision. **The single most important scope guard — Sarah + Dex gate NO-WRITE
> (grep=0 on `invoices`/finance).**
>
> **MODULE 4.2 CLOSER — the last Boarding increment.** `senior-feat` level with `main` (`0803587`); INCR-7/8/9/10/11/12 merged. The
> trunk closer (INCR-7 → INCR-8 → INCR-13), the frozen ladder's real consumer. **Wells on the critical path** (THREE new tenant tables:
> append-only infraction ledger + `bond_artefacts` + `deboardinization_records`) blocked on Kofi OQ1. Next migration **0050**.

### Goal
The disciplinary ledger (surface 07): the **5-rung ladder** (NOTE→WARNING→BOND→SUSPENSION→DEBOARDINIZATION) rendered from the **frozen
`getDeboardinizationLadder(schoolId)`** (READ-only, schema-locked, BUILD_STACK #4); an **append-only infraction ledger**
(`boarding_infractions` — no delete/edit, corrections are superseding rows); **co-sign counts + roles enforced from the frozen constant**
(Deboardinization = 3-way HM + Senior HM + Headmaster); a **`deboardinization_records`** object with the 3-way co-sign + first-class
**Board-review** + Headmaster-gated **reinstatement**; deboardinization **flips `students.residency` BOARDER→DEBOARDINIZED** + releases
the bunk (INCR-7 J2), **reversible only by the Board** (record + guarded action — NO "Board" RBAC role); the **four parked module stubs
now write REAL infractions**; the **3× penalty is DISPLAYED** but the **invoice write is STUBBED**; the **VLC pastoral bypass** routes a
flagged student to the Dean (module 4.5 STUB, `isPastorallyFlagged`). Parent-notify SMS at Warning+ → `sendSms()` console.

### Done when
A HM/Senior-HM/Headmaster (`BOARDING_ROLES`, house-scoped for plain HM) opens surface 07: sees the 5-rung ladder from the **frozen
constant** + the append-only ledger grouped by severity; **logs an infraction** at a rung (rung defs from the constant; a
**pastorally-flagged** student → Dean route NOT the ladder — VLC 4.5 stub; parent notified console SMS at Warning+); **runs a Bond**
(`bond_artefacts` witnessed by HM + Senior HM + the student's signature); **imposes a Deboardinization** only when all **3 co-signs
(HM=HOUSEMASTER / Senior HM=DEAN_OF_BOARDING / Headmaster=HEADMASTER) present** → sets `effective_at`, **flips residency
BOARDER→DEBOARDINIZED**, nulls `current_bunk_id`, closes the open `bunk_allocation_history` row (INCR-7 J2), all audited; files a
**Board-review** + records the outcome; **reinstates** (Board-only → Headmaster-gated, requires `board_decision_text`, residency flips
back → `reinstated_at`). The **4 parked stubs write real `boarding_infractions`** idempotently — (a) exeat +1hr → NOTE, (b) inspection
FAIL daily → NOTE / weekly → WARNING, (c) visiting overstay → NOTE, (d) resumption "absent" → NOTE. The **3× penalty is DISPLAYED**
(days × boarding-fee/day × 3 + Head-discretion adjusted figure/reason stored) but **`fee_penalty_invoice_id` is LEFT NULL, NO
`invoices`/finance row written** — the surface shows **"penalty pending — billing not yet wired."** THREE NEW tenant tables (FORCE RLS
+ **prod-paste-0050**, composite FKs, tenant UK on the parent ledger); frozen contract READ-only; all logic in `lib/boarding/` (**no
trigger, no cross-table trigger — same-table CHECK only**); audit-logged; three gates green. **🏁 MODULE 4.2 CLOSED.**

### Step table
| Step | Owner | State |
|---|---|---|
| Rulings on OQ1–OQ7 + acceptance criteria (**OQ1 3-table shape gates Wells**); confirm co-sign app-in-lib (reads frozen `coSignCount`/`coSignRoles`; role map HM=HOUSEMASTER · Senior-HM=DEAN_OF_BOARDING · Headmaster=HEADMASTER), rung-map for the 4 stubs, append-only-vs-supersede, Head-discretion penalty-DISPLAY fields, Board-reinstatement guard, the frozen-ladder-vs-surface co-sign-copy reconciliation. **Confirm invoice-write STUB owner-settled + the 4 parked-stub wirings in scope** | Kofi | ⬜ gates Wells |
| Surface map — surface 07 all blocks: header · ledger head-row + actions · 5 summary cards (incl. PENALTY FEES card = STUB display) · the 5-rung ladder (SCHEMA-LOCKED, render from frozen constant) · active-cases ledger grouped-by-severity (append-only) · currently-deboardinized cards (3 co-sign chips + Board-review-pending + penalty rows) · bond-artefact-in-flight (serif form + 3 sig slots) · penalty-invoices table = STUB · pastoral cross-ref (VLC stub) · foot. Confirm route. **🔴 Flag frozen-ladder-vs-surface co-sign-copy discrepancy** (frozen Bond=2/Suspension=0 vs surface Bond "3 incl student"/Suspension "HM+Headmaster") — frozen constant is AUTHORITATIVE | Lucy | ⬜ |
| **Schema (3 tables + enums — critical path, migration 0050).** `boarding_infractions` (PARENT, append-only, **tenant UK**; student/house composite FKs; `severity infraction_severity_enum` NOTE/WARNING/BOND/SUSPENSION/DEBOARDINIZATION; `narrative_text`; `status` OPEN/RESOLVED/SUPERSEDED; `co_signs_json`; `parent_infraction_id` composite self-FK; **`source_kind`/`source_ref_id` idempotency key** MANUAL/EXEAT_OVERDUE/INSPECTION_DAILY/INSPECTION_WEEKLY/VISIT_OVERSTAY/RESUMPTION_ABSENT; logged_by/at; parents_notified_at). `bond_artefacts` (LEAF, ref infraction: student_signature_at, hm_witness+at, senior_hm_witness+at, scanned_pdf_file_id, bond_text). `deboardinization_records` (LEAF, ref student+infraction: 3 discrete signs+at, `effective_at` NULL gated by **same-table CHECK** (all 3 sign_at present), `board_review_at`, `board_decision_text`, `reinstated_at`, **`fee_penalty_invoice_id uuid NULL — no FK, LEFT NULL, no write`**, penalty-display `penalty_days`/`penalty_adjusted_amount`/`penalty_adjustment_reason`). New enums; FORCE RLS on all 3; DDL order enums→infractions(+UK)→bond_artefacts→deboardinization_records. **prod-paste-0050-boarding-discipline.sql** | Wells | ⬜ blocked on Kofi OQ1 |
| Frozen-ladder read + actions — read `getDeboardinizationLadder` (READ-only); `logInfraction` (rung from constant; **pastoral-bypass `isPastorallyFlagged` → Dean route NOT ladder**; parent SMS console at Warning+); `coSign`/`witnessBond` (app-enforced vs frozen `coSignCount` + role check); `createBondArtefact`; **`deboardinize`** (3-co-sign gate → `effective_at` → **flip residency + null current_bunk_id + close open alloc**, INCR-7 J2); `fileBoardReview` + **`reinstate`** (Headmaster-gated, requires board_decision_text, flips residency back). `lib/boarding/`, atomic + audit, **no trigger** | Claude Code | ⬜ |
| **Wire the 4 parked stubs → real infractions (idempotent, source-keyed).** (a) `exeat-notify.ts` OVERDUE_STAGE_3/`EXEAT_OVERDUE_NOTE_STUB` → NOTE; (b) `boarding-daily.ts` `escalationStub:"INCR-13"`: daily FAIL → NOTE / weekly FAIL → WARNING; (c) `visiting-notify.ts` OVERSTAY → NOTE; (d) INCR-11 resumption "absent" → NOTE. Each replaces its audit-marker-only stub with an idempotent `boarding_infractions` insert guarded by `NOT EXISTS(source_kind, source_ref_id)` — the sweeps repeat on-read, MUST NOT double-log | Claude Code | ⬜ |
| Constants + derivations — reuse frozen ladder (no re-model); auto-escalation eligibility (3 Notes → Warning prompt, 2 Warnings → Bond eligibility — **HM decides, NOT an auto-write**) as pure funcs; **penalty-DISPLAY** pure func (days × boarding-fee/day × 3 + Head-discretion), DISPLAY only, vitest DB-free, **no invoice write** | Claude Code | ⬜ |
| Discipline UI (surface 07) — route `/senior/boarding/discipline` (from Boarding landing, NOT a new sidebar row); ladder (frozen) · ledger grouped-by-severity · deboardinized cards + Board-review · bond-artefact signing room (serif form, 3 sigs) · **penalty table clearly marked "penalty pending — billing not yet wired"** · pastoral cross-ref (VLC stub); house-scope for plain HM | Claude Code | ⬜ |
| Parent-notification SMS (Warning+) → `sendSms()` (console); idempotent per (infraction × kind); NEVER provision `HUBTEL_*` | Claude Code | ⬜ (SMS-live gated on owner #3) |
| Seed — demo ledger (Notes/Warnings/Bonds/Suspension), 3 deboardinized incl. one Board-review-pending, one bond-in-flight, **J. Manu pastorally-flagged → Dean (not laddered)**; penalty rows with `fee_penalty_invoice_id` NULL; marker-scoped re-run-safe | Wells/Claude Code | ⬜ |
| Build · typecheck · tests (rung from frozen constant, 3-co-sign gate, **residency-flip + bunk-release**, reinstate guard, **4 stub-wirings idempotent**, append-only/supersede, **penalty DISPLAY-only NO invoice write**, VLC bypass stub, SMS console, tenant isolation) · RLS test · preview round-trip | Claude Code | ⬜ |
| QA — ladder from frozen constant, 3-of-3 co-sign gate + role map, residency flip + bunk release + reinstatement, 4 stubs write real infractions idempotently, append-only (corrections supersede), pastoral bypass → Dean, **grep-proof ZERO writes to invoices/finance · `fee_penalty_invoice_id` NULL**, SMS console, tenant isolation, role/house-scope | Quinn | ⬜ |
| Architecture/portability — logic in `lib/boarding/` (no trigger; same-table CHECK only); frozen ladder READ-only; co-sign app-in-lib vs frozen `coSignCount`; append-only + supersede-chain; **confirm NO billing coupling — `fee_penalty_invoice_id` no FK, penalty display-only**; VLC STUBBED; idempotent source-keyed auto-log | Dex | ⬜ |
| Security — 3 new tenant tables **FORCE RLS + prod-paste-0050 parity**; cross-tenant denied; composite FKs; route auth + `BOARDING_ROLES` + house-scope; **🟥 THE SCOPE GUARD: confirm NO `invoices` row, NO billing/finance write, NO PENALTY fee-category, `fee_penalty_invoice_id` LEFT NULL/no FK**; **residency-flip audited + guarded**; discipline `narrative_text`/`bond_text` PII tenant-scoped; no real SMS send; frozen contract READ-only | Sarah | ⬜ holds merge |
| Gate fixes (aggregated) | Claude Code | ⬜ |
| Merge · verify `git log origin/main` · **Pence syncs senior-feat ← main** · **🏁 MODULE 4.2 CLOSED** | Sarah + Pence | ⬜ |

### Dependencies / critical path
Reads INCR-8's frozen `getDeboardinizationLadder` (rung defs, `coSignCount`, `coSignRoles`, `reversalNote` — READ-only, do NOT re-model).
Sits on F0's spine (`students.residency`, `current_bunk_id`, `bunk_allocation_history`, House, house-scope) + **performs INCR-7 J2**
(deboardinization releases the bunk + closes the open alloc — F0 deferred it here). **Consumes the four parked module stubs** →
real infractions (exeat-notify OVERDUE_STAGE_3, boarding-daily escalationStub, visiting-notify OVERSTAY, INCR-11 resumption "absent").
Reuses `isPastorallyFlagged` for the VLC bypass + `sendSms()` console. **Flips `students.residency`** (real student-record state change).
**Does NOT write billing** (invoice write STUBBED — `fee_penalty_invoice_id` LEFT NULL). Critical path: Kofi OQ1 → Wells (0050) →
Claude Code (frozen-ladder read → log/co-sign/bond/deboardinize/reinstate ∥ 4 stub-wirings ∥ penalty-display) → surface-07 UI →
SMS console → 3 gates → Sarah merge → Pence sync → **MODULE 4.2 CLOSED**.

### Open questions — Kofi rules (**the sole OWNER CALL — the penalty invoice write — is OWNER-SETTLED as STUBBED; none below is owner-gated**)
1. **OQ1 (gates Wells) — the 3-table shape** (per BUILD_STACK #4/#5 + the `source_kind`/`source_ref_id` idempotency addition for the auto-logged stubs; enums align to the frozen `DeboardinizationSeverity`).
2. **OQ2 — co-sign enforcement:** app-enforced in `lib/` (reads frozen `coSignCount`/`coSignRoles`, exeat posture, no cross-table trigger) + a same-table CHECK on `deboardinization_records` (`effective_at` requires all 3 sign_at). Role map HM=HOUSEMASTER / Senior-HM=DEAN_OF_BOARDING / Headmaster=HEADMASTER (no "Senior HM" role).
3. **OQ3 — Board-review + reinstatement (no "Board" RBAC role):** model Board as a first-class record + a HEADMASTER-gated `reinstate` action (requires `board_decision_text`, flips residency back, audited). Confirm reinstatement authority.
4. **OQ4 — rung-map for the 4 stubs:** (a) exeat overdue → NOTE; (b) inspection FAIL daily → NOTE / weekly → WARNING (FAIL only, not PARTIAL); (c) overstay → NOTE; (d) resumption absent → NOTE. All idempotent via `source_kind`/`source_ref_id` NOT-EXISTS.
5. **OQ5 — append-only vs void/supersede:** append-only (surface §2 "no infraction deletable"); a correction is a superseding infraction (`parent_infraction_id` + `status=SUPERSEDED`), never in-place edit/delete.
6. **OQ6 — Head-discretion penalty adjustment + DISPLAY (invoice STAYS stubbed):** store `penalty_days`/`penalty_adjusted_amount`/`penalty_adjustment_reason` (display/snapshot only); show the 3× formula + "penalty pending — billing not yet wired". Confirm whether the GHS figure is computed from a boarding-fee/day READ (a read is allowed) or formula-only. **No `invoices` write either way.**
7. **OQ7 — frozen-ladder vs surface co-sign-copy + auto-escalation:** the frozen constant is AUTHORITATIVE for enforcement (Bond=2 witnesses + student sig; Suspension=0); the surface's per-rung signer text is display. Auto-escalation is a derived prompt (HM decides), NOT an automatic rung write.

### Risk flags
- **NEW tenant tables ⇒ prod-paste RLS** (`prod-paste-0050-boarding-discipline.sql`). Sarah gates parity.
- **🟥 THE INVOICE WRITE IS STUBBED — the #1 scope guard.** Sarah + Dex confirm NO billing/finance write, NO `invoices` row, NO PENALTY fee-category, `fee_penalty_invoice_id` LEFT NULL/no FK (grep=0 on invoices/finance mutations). The 3× penalty is display-only.
- **Ladder append-only + schema-locked** (BUILD_STACK #4) — no silent edits/deletes; corrections supersede. Dex + Quinn.
- **Co-sign enforcement** — a Deboardinization needs all 3 co-signs (correct roles) or no `effective_at`/no residency flip. App-enforced vs frozen `coSignCount` + same-table CHECK. Quinn + Sarah.
- **Deboardinization flips residency + releases bunk** (INCR-7 J2) — a real student-record state change; audit + guard; reinstatement (Board/Headmaster-gated) flips back. Quinn + Sarah.
- **VLC pastoral bypass STUBBED** (4.5) — `isPastorallyFlagged` → Dean route, NOT the ladder; copy must not imply a working VLC. Dex.
- **Frozen ladder READ-only** — never re-modeled/edited; enforcement reads `coSignCount`/`coSignRoles` from it. Dex + Kofi.
- **Idempotent auto-logging** — the 4 stubs fire from repeating on-read sweeps; `source_kind`/`source_ref_id` NOT-EXISTS prevents duplicate NOTEs. Quinn + Dex.
- **Portability** — all discipline logic in `lib/boarding/` (no DB trigger, no cross-table trigger; same-table CHECK only). Dex.
- **Composite intra-tenant FKs** + tenant UK on the PARENT ledger; DDL order table→UK→ADD-FK. Wells.
- **Discipline PII/audit** — `narrative_text`/`bond_text` sensitive; tenant-scoped; audit every rung + the residency flip. Sarah.
- **SMS PAID (STOP-AND-ASK)** — never provision `HUBTEL_*` without owner #3; console-only. **Seed not idempotent** — marker-scoped.

### Prerequisites / stop-and-ask
- ✅ `senior-feat` level with `main` (`0803587`); INCR-7..12 merged. Next migration **0050**.
- **🟥 OWNER-SETTLED (do NOT re-open):** the 3× penalty **invoice write is STUBBED** (`fee_penalty_invoice_id` nullable/LEFT NULL + "penalty pending — billing not yet wired" display; NO `invoices`/finance write, NO PENALTY category). Billing trigger = clearly-marked follow-up for a later owner decision.
- **In scope:** the 4 parked-stub wirings (exeat overdue / inspection FAIL / visiting overstay / resumption absent → real `boarding_infractions`).
- **No owner call before Wells cuts schema** — OQ1 is a Kofi call. Kofi ∥ Lucy start now. **Deploy note:** migration 0050 + hand-paste `prod-paste-0050-boarding-discipline.sql`.
- **Forward deps to STUB:** VLC pastoral bypass (4.5); the 3× penalty invoice write (owner follow-up); real SMS send (owner Hubtel).

### Kofi rulings + AC (2026-07-19) — Wells UNBLOCKED (invoice write owner-settled STUB)
- **🔴 SUSPENSION CO-SIGN CORRECTION (orchestrator decision, overrides Kofi's "defer"):** the frozen constant has Suspension
  `coSignCount=0`, but BUILD_STACK #4 (constitution, wins on conflict) + surface 07 mandate **2 (HM + Headmaster)**. INCR-13 is the
  ladder's designated co-sign-ENFORCEMENT consumer → **correct `lib/boarding/deboardinization-ladder.ts` Suspension rung to
  `coSignCount: 2, coSignRoles: ["HM", "Headmaster"]`** (a data correction to align the constant with the constitution, not a re-model)
  and **enforce 2**. (Bond stays `coSignCount=2` = 2 staff witnesses + the student's own signature = the "3 slots"; Deboard=3;
  Note/Warning=0.) Flagged to owner; revert only if they intended suspension to need no co-sign.
- **OQ1 → 3 tables + 3 enums (migration 0050):** enums `infraction_severity` (NOTE|WARNING|BOND|SUSPENSION|DEBOARDINIZATION = the frozen
  `DeboardinizationSeverity`), `infraction_status` (OPEN|RESOLVED|SUPERSEDED), `infraction_source` (MANUAL|EXEAT_OVERDUE|INSPECTION_DAILY|
  INSPECTION_WEEKLY|VISIT_OVERSTAY|RESUMPTION_ABSENT).
  - **`boarding_infractions`** (PARENT, append-only, **tenant UK `(school_id,id)`**): id, school_id, `student_id` (composite FK),
    `house_id NULL` (composite FK SET NULL, snapshot), `severity`, `narrative_text`, `status DEFAULT OPEN`, `co_signs_json` (audit mirror,
    NOT the enforcement point), `parent_infraction_id` (composite self-FK, supersede chain), `source_kind DEFAULT MANUAL`, `source_ref_id
    text NULL`, `logged_by_user_id NULL → users SET NULL` (system auto-logs have no human logger), `logged_at`, `parents_notified_at`,
    created_at. **idempotency UK `(school_id, source_kind, source_ref_id) WHERE source_ref_id IS NOT NULL`** (DB backstop behind the
    NOT-EXISTS guard). indexes `(school_id,student_id)`, `(school_id,status)`. FORCE RLS.
  - **`bond_artefacts`** (LEAF): id, school_id, `infraction_id` (composite FK) `UNIQUE(school_id,infraction_id)`, student_signature_at,
    hm_witness_user_id+at, senior_hm_witness_user_id+at, scanned_pdf_file_id, bond_text. FORCE RLS.
  - **`deboardinization_records`** (LEAF): id, school_id, `student_id`+`infraction_id` (composite FKs), 3 discrete signs `{hm,senior_hm,
    headmaster}_sign_user_id`+`_at`, `effective_at NULL`, `board_review_at NULL`, `board_decision_text NULL`, `reinstated_at NULL`,
    `reinstated_by_user_id NULL`, **`fee_penalty_invoice_id uuid NULL — NO FK, LEFT NULL, no write (THE STUB)`**, penalty-display
    `penalty_days int`/`penalty_per_day_amount numeric(12,2)` (SNAPSHOT, not a live billing read)/`penalty_adjusted_amount`/
    `penalty_adjustment_reason`, created_at. **same-table CHECK** `effective_at IS NULL OR (all 3 sign_at NOT NULL)`; **CHECK**
    `reinstated_at IS NULL OR board_decision_text IS NOT NULL`; **partial UK** `(school_id,student_id) WHERE effective_at IS NOT NULL AND
    reinstated_at IS NULL` (one ACTIVE deboard per student). FORCE RLS. **prod-paste-0050-boarding-discipline.sql.**
- **OQ2 → co-sign app-enforced in `lib/`** (reads frozen `coSignCount`/`coSignRoles`, no cross-table trigger) + the same-table CHECK backstop;
  role map HM=HOUSEMASTER (house-scoped to the student's House) / Senior-HM=DEAN_OF_BOARDING / Headmaster=HEADMASTER; deboard co-signs live
  on the discrete columns, `co_signs_json` is an audit mirror.
- **OQ3 → Board = a first-class RECORD + a HEADMASTER-gated (ADMIN super-role) `reinstate` action** (requires non-empty `board_decision_text`,
  flips residency DEBOARDINIZED→BOARDER, stamps `reinstated_at`/`by`, audited). NOT plain HM, NOT Dean. No "Board" RBAC role.
- **OQ4 → 4 stub rung-map (idempotent, source-keyed):** exeat overdue→NOTE (`source_ref_id=exeat.id`); inspection FAIL daily→NOTE /
  weekly→WARNING (`inspections.id`; PARTIAL = NO infraction); visiting overstay→NOTE (`boarding_visit.id`, against the visited student);
  resumption "absent" (derived-on-read unaccounted)→NOTE (`source_ref_id="${eventOrPeriodId}:${studentId}"` — no arrival row). Each guarded
  `NOT EXISTS(school_id,source_kind,source_ref_id)`. **Auto-logs respect the pastoral bypass — a flagged student's trigger writes ZERO
  infraction (the check is at the shared insert site).**
- **OQ5 → append-only:** no DELETE, no content edit; `status` OPEN→RESOLVED or OPEN→SUPERSEDED only; a correction is a NEW row with
  `parent_infraction_id` + the original → SUPERSEDED.
- **OQ6 → penalty DISPLAY formula-only from stored SNAPSHOTS** (`penalty_days × penalty_per_day_amount × 3`, Head-discretion override) —
  a pure DB-free func, NO billing read, NO invoices write; surface shows "penalty pending — billing not yet wired"; `fee_penalty_invoice_id`
  NULL.
- **OQ7 → frozen constant AUTHORITATIVE for enforcement** (Bond=2 witnesses + student sig; Suspension now=2 per the correction above;
  Deboard=3); surface per-rung signer text is display. Auto-escalation (3 Notes→Warning, 2 Warnings→Bond) is a **derived PROMPT (HM decides),
  NOT an auto rung-write**.

#### INCR-13 · Acceptance criteria (for Quinn)
- **A · ladder from frozen constant.** A1 5 rungs render from `getDeboardinizationLadder` (never re-declared inline). A2 `severity` enum ==
  the frozen 5-value set. A3 INCR-13 writes zero to the ladder constant EXCEPT the sanctioned Suspension `coSignCount` 0→2 correction.
- **B · co-sign gate.** B1 Deboard needs all 3 (`effective_at` only when HM+Senior-HM+Headmaster `*_sign_at` present). B2 2-of-3 → no
  `effective_at`/no residency flip (app + same-table CHECK reject). B3 wrong-role signer rejected. B4 plain HM co-signs only in their House.
  B5 Bond = student sig + 2 staff witnesses. B6 **Suspension now enforces 2 (HM+Headmaster)** per the correction. B7 Note/Warning = 0.
- **C · deboard side-effects (INCR-7 J2).** C1 `effective_at` → residency BOARDER→DEBOARDINIZED. C2 null `current_bunk_id` + close open
  `bunk_allocation_history` (to_at, reason), atomic + audit. C3 freed bunk re-allocatable. C4 DEBOARDINIZED excluded from boarder cohorts.
  C5 no DB trigger.
- **D · Board-review + reinstate.** D1 `fileBoardReview` records `board_review_at`/motion. D2 `reinstate` HEADMASTER/ADMIN + non-empty
  `board_decision_text` → residency back + `reinstated_at`/`by`, audit. D3 Dean/plain-HM reinstate rejected. D4 empty board_decision_text
  rejected (app + CHECK). D5 reinstate does NOT restore the old bunk (current_bunk_id stays NULL). D6 no path clears `effective_at` except
  reinstate.
- **E · 4 stubs → real infractions idempotent.** E1 exeat overdue → 1 NOTE, re-sweep no dup. E2 inspection FAIL daily→NOTE/weekly→WARNING;
  PARTIAL none. E3 overstay → 1 NOTE. E4 resumption absent → 1 NOTE (composite source_ref_id). E5 idempotency UK rejects a concurrent dup.
- **F · append-only.** F1 no delete/severity-edit path. F2 correction = superseding row + original→SUPERSEDED. F3 status enum = the 3 values.
- **G · pastoral bypass (STUB).** G1 flagged student manual log → ZERO infraction, Dean route. G2 auto-sweeps ALSO skip a flagged student.
  G3 the seeded flagged student appears Dean-routed, never laddered. (Reconcile the seed drift — surface says A. Quartey, stub flags Joseph
  Manu `ASK-24-0118` — use a seeded static demo matching the surface, no live VLC.)
- **H · penalty DISPLAY + invoice STUB (#1 scope guard).** H1 figure = days×per-day×3 (+ Head-discretion). H2 "penalty pending — billing not
  yet wired." H3 `fee_penalty_invoice_id` NULL every row, no FK. **H4 grep-proof ZERO writes to `invoices`/finance/fee-category** (any invoices
  ref is a READ at most). H5 display func pure/DB-free.
- **I · SMS console.** I1 parent-notify at Warning+ → `sendSms()` console, idempotent per (infraction×kind), no HUBTEL_*.
- **J · tenant/RBAC/contract.** J1 3 tables FORCE RLS + prod-paste-0050 parity; cross-tenant denied. J2 `BOARDING_ROLES` gate; plain HM
  house-scoped; STUDENT/PARENT/TEACHER/MATRON denied. J3 frozen contract READ-only (bar the Suspension correction). J4 all logic in
  `lib/boarding/` (no trigger, same-table CHECK only).
- **K · auto-escalation is a prompt** (3 Notes→Warning eligible, 2 Warnings→Bond eligible — ledger unchanged until the HM logs the rung).
- **Traps:** 2-of-3 deboard (no effect); non-Headmaster reinstate (denied); reinstate w/o board_decision_text (denied); same overdue/
  overstay swept twice (1 NOTE); Suspension now enforcing 2 (was the 0-bug); pastorally-flagged student (Dean, no rung — manual AND auto);
  deboardinized bunk (released + re-allocatable); reinstated student (residency back, bunk NOT restored); penalty shown + `fee_penalty_
  invoice_id` NULL + zero finance writes; correction editing in place (forbidden — supersede only).

### Lucy surface map (surface 07) — load-bearing facts
- **Route `/senior/boarding/discipline`** (new `discipline/page.tsx`; from the Boarding landing, NOT a new sidebar row); `requireSchoolRole
  (BOARDING_ROLES)` + BASIC redirect + house-scope for plain HM (Senior HM = cross-house). **Reuse the programme surface's `LadderView`**
  (`boarding/programme/page.tsx`) to render the frozen ladder — same constant, READ-only.
- **Regions:** header/head-row (Filter/Export/**Log new infraction**); 5 summary cards (4 DERIVED + **card 5 PENALTY FEES = STUB display**);
  the **5-rung ladder** (frozen constant + a DERIVED count column overlay — render the constant's name/desc/penaltyLabel, roman `i–v`);
  **active-cases ledger grouped by severity** (append-only rows, `.active`/`.flagged` row states); **currently-deboardinized cards** (3
  co-sign chips signed/pending + the **Board-review-pending** `.review` object + days-off-roll/unauthorised-days/penalty rows); **bond
  artefact signing room** (serif standard-form + 3 independently-flipping signature slots: student + HM witness + Senior-HM witness);
  **penalty-invoices table = STUB** ("View in billing" inert/marked pending; render the PEN-2026-009 GHS 1,500→510 Head-discretion example);
  **pastoral-protection card = STUB** (VLC 4.5, render only when flagged, copy must not imply a working VLC).
- **🔴 non-canonical token `--terra-deep #8E3528`** (rung-5 chip, deboard-card head, review text) — NOT in design-tokens; add `terra-deep` to
  `tokens.css` (mirror the terra scale) or use literal `bg-[#8E3528]`, do NOT approximate with `terra`.
- **🔴 alpha-on-hex trap:** the featured (navy) summary card's label/sub = `gold-soft` at `rgba(...,0.7/0.6)` — use literal `text-[rgba(...)]`
  or solid `text-gold-soft`, NEVER slash-opacity a raw hex. House colour = user-data inline. Period label rendered live (not the mock date).
- **Empty/interaction states to BUILD (some not in the mock):** no-active-cases (EmptyState); bond mid-signing 1-of-3 (slot flips, pill
  "Awaiting N signatures"); **deboardinization 2-of-3 pending = an uncommitted DRAFT** (status "Awaiting co-signs (2 of 3)", NOT off-roll,
  excluded from the DEBOARDINIZED count until all 3 land); Board-review-pending (`.review` ring + motion box); penalty stub; pastorally-flagged.

---

## INCR-14 ✅ MERGED (PR #158, `dd88cd6`+`b960a00`+`d1ef624`) — Score Ledger Item 9 · PWA phase 2 · NO new migration · 🏁 RE-CLOSES MODULE 4.1 (Items 1–9) · no prod-paste (idempotent upsert)

> Module 4.1 was closed at Item 7/INCR-6; **Item 9 was deferred as a v2 item (§11 line 372 "Later — PWA phase 2 IF real demand surfaces");
> the owner now wants it.** `senior-feat` level with `main` (`c03f93d`); Boarding (4.2) complete. **No migration; Wells OFF the critical path**
> (client-side IndexedDB; the Path-C write `saveDirectLedgerScores`/`savePortfolioScores` is an `onConflictDoUpdate` upsert on
> `student×subject×period`, so an extended-offline replay is naturally idempotent — no dup rows, no idempotency-key column, no schema).
> Two OWNER CALLs gate copy + pre-cache scope — **PROCEEDING ON DEFAULTS** (below): honest line "Enter a full class's scores with no signal
> — they save when you're back online" (single-device); pre-cache **all current-semester assigned rosters** (warn-and-keep, no cap).

### Goal
Make the Phase-1 pending buffer + rosters **durable across a full offline session** via IndexedDB, so a teacher can enter a **whole
class's scores with no signal**, close and reopen the app, and still have every entry + the roster present, then flush to the server on
reconnect. **Single-device only — NO multi-device conflict resolution (Phase 3 / Item 10, OUT).** The honest promise EVOLVES here: Phase 1
was "works on your phone, handles bad connections" (never "offline"); Phase 2 **can honestly promise extended single-device offline** — but
STILL never "works across your devices" / conflict-free. Also closes Item 5's tracked **shared-device follow-up**: bind the IndexedDB store
+ the SW cache partition to the **session token** (not just the uid) so a logout/re-login can't surface a prior user's pending scores.

### Done when
A teacher enters a **full class's scores with NO connectivity**; the entries (typed cells + pending/errored buffer state) AND the roster
**persist in IndexedDB across an app close/reopen** (not just a network drop with the tab open — that was Phase 1); on reconnect the buffer
**auto-flushes to the same Path-C server actions** — no lost work, no duplicate write (idempotent upsert), no false "saved"; a domain
`{ok:false}` on flush surfaces the **red errored cell** and that red state **survives the reopen** (never re-parked as "will sync" —
MAJOR-1). On a shared tablet, after logout (or a different teacher logging in), the prior teacher's pending scores are **gone** (IndexedDB
store + SW cache keyed to the session token, wiped on logout). Still single-device; Phase-1's in-memory path + the desktop web ledger
unchanged. **IndexedDB + Cache API only — no `next-pwa`, no Vercel KV/Blob/Postgres.** Tenant-scoped; three gates green.

### Architecture crux
The **pure buffer reducer (`lib/score-ledger/pwa-buffer.ts`) stays source-of-truth** — IndexedDB is a persistence layer BENEATH it, not a
rewrite. Phase 2 = (a) an IndexedDB store module snapshotting the reducer state (`pending`/`errored`/`episode`/`lastError`/`lastSyncedAt`) +
the typed `cells` map + the pre-cached rosters, keyed to the **session token**; (b) `pwa-ledger.tsx` **hydrates from IndexedDB on mount**
(replaces Phase-1's "fall back to last server-confirmed on reload") and **persists on every edit/confirm/reject**; (c) the SW ledger-cache
partition (`public/sw.js` `LEDGER_PREFIX`) re-keyed `<uid>`→**session token** (closes the Phase-1 shared-device ceiling); (d) the logout
purge (`sign-out-button.tsx` + SW `omnischools-clear`) extended to **also wipe the IndexedDB store**. The **server write path is UNCHANGED**
— flush (`pwa-flush.ts`) still calls the Path-C upserts (idempotent replay). No new schema.

### Step table
| Step | Owner | State |
|---|---|---|
| Rulings on the open questions + Phase-2 AC (durability boundary · honest phase-2 line · pre-cache scope · session-token partition · flush/domain-reject persistence · single-device confirm); confirm the DEFAULT owner calls | Kofi | ⬜ gates build |
| Surface confirm — `Surfaces/schoolup-shs-score-ledger-pwa.html`: NO dedicated phase-2 UI; phase 2 **deepens the gold sync strip** into a durable-across-reopen state + **graduates the roadmap "Phase 2 · later" card to "ships now"** + the evolved marketing caption. Note new copy | Lucy | ⬜ small |
| **NO schema — Wells confirm-only** (Pence already confirmed the Path-C write is `onConflictDoUpdate`; extended-offline replay idempotent; no idempotency-key column). Flag ONLY if a non-idempotent write surfaces | Wells | ⬜ confirm-only (satisfied) |
| IndexedDB store module — snapshot reducer state + `cells` + pre-cached rosters, keyed to the **session token**; single store-version constant; Cache API only, no `next-pwa`/Vercel KV | Claude Code | ⬜ |
| Hydrate + persist wiring — `pwa-ledger.tsx` loads on mount (replaces Phase-1 reload fallback) + writes on every edit/confirm/reject; reducer stays source-of-truth; retire the Phase-1 pending-buffer `beforeunload` warning now that pending is durable (keep an unsynced indicator) | Claude Code | ⬜ |
| Pre-cache rosters — persist the teacher's `senior_subject_teacher` current-semester assignments into IndexedDB (all assigned, per the default); eager on first online load so a later signal-less open of any assigned class works; staleness = refresh on any successful online load | Claude Code | ⬜ |
| Session-token partition (Item-5 follow-up) — re-key the SW ledger cache + IndexedDB store `<uid>`→session token; purge non-current-session partitions on identify (`pwa-session.tsx`) | Claude Code | ⬜ |
| Logout / shared-device purge — extend `sign-out-button.tsx` + SW `omnischools-clear` to **delete the IndexedDB store** so pending scores never survive logout on a shared tablet | Claude Code | ⬜ |
| Flush-on-reconnect + domain-reject persistence — reuse `pwa-flush.ts` (transport-hold vs domain-`{ok:false}`); **persist the errored red state to IndexedDB so it survives reopen** — never re-park as "will sync" (MAJOR-1) | Claude Code | ⬜ |
| Honest copy / roadmap evolution — apply the phase-2 line; graduate the roadmap Phase-2 card; NEVER promise multi-device/conflict-free | Claude Code | ⬜ |
| Build · lint · typecheck · self-verify (DevTools: full class offline → close+reopen the installed app → entries+roster present → reconnect → syncs; domain-reject survives reopen as red; logout wipes IndexedDB; **a real `pnpm build` to catch a Vercel/`next-pwa` portability leak**) | Claude Code | ⬜ |
| QA — full offline session survives close/reopen (entries+roster); flush no-loss/no-dup; domain-`{ok:false}` red survives reopen; logout wipes IndexedDB; shared-device session-token partition (B never sees A's pending); Phase-1 in-memory + desktop web unbroken; **copy never promises multi-device** | Quinn | ⬜ |
| Architecture/portability — IndexedDB + Cache API only (no `next-pwa`/Vercel KV/Blob/Postgres); server write path unchanged; buffer reducer still source-of-truth; single store+cache version constant | Dex | ⬜ |
| Security — pending SCORES (PII) now durable in IndexedDB on a shared tablet; **session-token partition + logout purge MUST wipe them**; cross-session/cross-tenant isolation; prod parity | Sarah | ⬜ holds merge |
| Gate fixes (aggregated) | Claude Code | ⬜ |
| Merge · verify `git log origin/main` · **Pence syncs senior-feat←main** | Sarah + Pence | ⬜ |

### Dependencies / critical path
**Extends Item 5 (INCR-4):** `pwa-buffer.ts` (reducer state = what's persisted), `pwa-flush.ts` (reused UNCHANGED), `public/sw.js` (cache
partition re-keyed uid→session token), `pwa-ledger.tsx` (hydrate/persist), `pwa-session.tsx` + `sign-out-button.tsx` (session-token identify
+ IndexedDB purge). **Flushes to the existing Path-C server actions** (unchanged, idempotent upsert). **Closes the Item-5 shared-device
follow-up.** Kofi ∥ Lucy ∥ Wells(confirm-only) parallel. Claude Code: IndexedDB store → hydrate/persist → roster pre-cache → session-token
partition → logout purge → flush/domain-reject persistence → honest copy → self-verify → 3 gates → Sarah merge → Pence sync. **No forward deps, no migration.**

### Open questions — Kofi rules (OWNER CALLs Q1/Q2 = PROCEEDING ON DEFAULTS)
1. **Honest phase-2 marketing line (OWNER CALL — default taken).** _"Enter a full class's scores with no signal — they save when you're
   back online"_ (single-device). OFF-LIMITS: any "works across your devices" / conflict-free / multi-device claim. Owner may swap the exact string.
2. **Extended scope (OWNER CALL — default taken):** pre-cache **all the teacher's current-semester assigned rosters** (`senior_subject_teacher`);
   NO hard cap (reuse Item-5 live-count warn-and-keep, never-block, never-silently-drop); staleness = refresh on any successful online load.
3. **Which rosters + when.** Eager pre-fetch of the assigned set on first online load (a lazy-only would silently fail an unvisited class offline).
4. **Sync-queue flush semantics + single-device confirm.** Order per-class groups; retry on `online`; **domain-`{ok:false}` → red errored cell (MAJOR-1),
   PERSISTED across reopen, never "will sync"/never dropped.** Flush hits the unchanged Path-C actions. **Single-device: a second device's edits are Item 10, NOT reconciled (no last-write-wins — Phase 3).**
5. **Session-token partition (Sarah gates).** Bind the IndexedDB store + SW cache partition to the **session token** (not the uid) so a shared-device logout/re-login can't surface a prior user's pending scores. Confirm a stable client-side session identifier is available.
6. **Idempotency (confirm no schema).** Path-C write is `onConflictDoUpdate` on `student×subject×period` → replay-idempotent; no dup rows, no idempotency-key column, no migration. (Confirmed by Pence.)
7. **`beforeunload` fate.** Pending is durable now → drop the pending-buffer close-warning; keep a visible unsynced indicator (errored cells still visible).

### Risk flags
- **R1 — Honesty line (BINDING, evolves):** phase 2 unlocks an honest extended single-device offline claim; **NEVER** multi-device/conflict-free (Phase 3). A pending score still never renders "saved." The roadmap Phase-2 card graduates; Phase-3 stays "later still." Kofi + Quinn gate copy.
- **R2 — Portability (memory-critical):** **IndexedDB + Cache API ONLY — no `next-pwa`, no Vercel KV/Blob/Postgres.** Server write path UNCHANGED. A `@vercel/kv`/`next-pwa` leak fails only at `pnpm build` (not typecheck) — self-verify MUST run a real build. Dex gates.
- **R3 — Shared-device PII (Sarah holds merge):** phase 2 makes pending **scores** durable in IndexedDB on a shared tablet; the **session-token partition + logout purge MUST wipe them** (zero of the prior teacher's pending scores survive a logout / a different login). Strictly heavier than Phase-1's cache-only leak.
- **R4 — No silent data loss (MAJOR-1):** a domain-`{ok:false}` on flush surfaces the red errored cell + persists it across reopen — never "will sync," never dropped. The "enter offline, sync when back" promise must not quietly become "drop the rejected ones." Quinn gates.
- **R5 — Don't break Phase 1 / desktop:** the reducer stays source-of-truth (IndexedDB is persistence beneath it, not a fork); the in-memory transport-hold path + the desktop web ledger (no IndexedDB) untouched. Quinn asserts both.

### Prerequisites / stop-and-ask
- ✅ `senior-feat` level with `main` (`c03f93d`). Item-9 demand-trigger satisfied by owner direction. No migration; no paid external service (IndexedDB/Cache API in-browser).
- **OWNER CALLs Q1 (marketing line) + Q2 (extended scope) — proceeding on the recommended defaults** (swap-on-word); not blocking.

### Kofi rulings + AC (2026-07-19) — no schema (Wells confirm-only)
- **Q1/Q2 (owner defaults, restated):** honest line "Enter a full class's scores with no signal — they save when you're back online" (single-device; NEVER multi-device/conflict-free); pre-cache **all current-semester `senior_subject_teacher` assigned rosters**, no cap (warn-and-keep), refresh-on-online, current-semester only.
- **Q4 durability + reject persistence:** IndexedDB persists the reducer snapshot (`pending`/`errored`/`episode`/`lastError`/`lastSyncedAt`) + the `cells` map + pre-cached rosters, keyed to the **session token**, surviving app close/reopen; **local persist is IMMEDIATE per edit/confirm/reject** (only the network flush keeps the 700ms debounce, so no edit lost in the close window); flush per-class groups, retries on `online` AND on mount-while-online-with-pending, hits the unchanged Path-C actions; a domain-`{ok:false}` → **red errored cell PERSISTED** so it survives reopen (MAJOR-1 deepened).
- **Q5 single-device (confirm boundary):** a 2nd device's edits are NOT reconciled (Phase 3/Item 10, OUT); no last-write-wins; the reducer stays source-of-truth, IndexedDB is persistence beneath it.
- **Session-token partition (Sarah gates):** key BOTH the IndexedDB store and the SW `LEDGER_PREFIX` to the **Supabase session id** (`getSession().data.session`) — stable across close/reopen + across hourly token refresh, rotates on logout/re-login. **Add `getSessionId()` to `lib/auth/index.ts`; do NOT touch `supabase.auth.*` in feature code (portability). Use the session ID, NEVER the raw access-token JWT** (a bearer secret + rotates hourly → would orphan the buffer). Dev-bypass (no Supabase session) → fall back to uid (single-user by construction). Logout purge wipes BOTH the SW cache AND the IndexedDB store.
- **Q7 `beforeunload`:** **DROP it entirely** (pending + errored are both durable now); keep the visible unsynced indicators (gold strip, red cells, error banner).
- **Honest invariant (binding):** a pending score NEVER renders "saved"; on hydrate a pending cell = GOLD/held, an errored cell = RED (status from the persisted reducer, never inferred green from a typed value); roadmap Phase-2 card graduates "later"→"ships now", Phase-3 stays "later still"; copy never promises multi-device.
- **🔴 Trap-1 remedy — ORCHESTRATOR DECISION = Option A (Kofi flagged for owner; decided as an engineering-precision call, invariant preserved either way):** both Path-C actions (`saveDirectLedgerScores` :857, `savePortfolioScores` :584) **silently skip** a non-ACTIVE student yet return `{ok:true, saved:N}` → Phase 2's long offline window makes roster drift likely → the flush's `bufferConfirm` would green a dropped student's cell from `{ok:true}` alone (false-save = MAJOR-1 re-entering). **Fix: ADDITIVELY extend the two Path-C result shapes to return the WRITTEN student ids** (keep `saved:N` for existing desktop callers — additive, no break), so the flush confirms EXACTLY the written ids and routes the rest to **red errored** ("student no longer in this class — score not saved"). Return-shape only — the DB write is unchanged, no schema, no migration, replay-idempotent.

#### INCR-14 · Acceptance criteria (for Quinn)
- **AC1 durability:** a full class's scores entered offline + the roster PERSIST in IndexedDB across an app **close/reopen** (not just a tab-open drop); each entered cell renders gold/held, never green.
- **AC2 flush:** reconnect (or reopen-while-online-with-pending) auto-flushes to the Path-C actions with NO lost work; a reopen-online must flush without waiting for an offline→online event.
- **AC3 idempotent:** re-flushing the same batch → NO duplicate rows (one per `student×subject×period`), identical values.
- **AC4 rerun latch:** a mid-flush re-edited cell stays pending + resends its new value (phase-1 behavior unbroken).
- **AC5 MAJOR-1 deepened:** a domain-`{ok:false}` cell → red errored, persisted, **survives close/reopen still red** — never "will sync"/dropped/green. **Trap-1: a written-off (stale-roster) cell also goes red** ("not saved — student no longer in this class"), never green, via the Option-A written-ids return.
- **AC6 re-edit clears:** editing a hydrated red cell clears the error → pending → re-flush (errored must hydrate into `reducer.errored`, not pending/clean).
- **AC7 pre-cache:** after an eager online load, any assigned current-semester class is offline-openable (incl. one not visited this session); historical/closed-semester classes are NOT.
- **AC8 warn-and-keep:** a large assigned set warns-and-keeps (never blocks/silently drops); rosters refresh on next online load.
- **AC9 logout purge:** teacher A logs out → ZERO of A's pending scores/rosters remain in IndexedDB OR the SW cache.
- **AC10 shared-device:** teacher B logs in on the same tablet (A didn't log out) → B sees NONE of A's pending/rosters (session-token partition + purge-on-identify).
- **AC11 token refresh:** an hourly access-token refresh does NOT change the partition key (keyed to the stable session id, not the JWT) — buffer not orphaned.
- **AC12/13 no regression:** phase-1 in-memory transport-hold path unbroken; desktop web ledger (no SW/IndexedDB) works unchanged, no console error.
- **AC14 copy:** the phase-2 caption reads the settled line, NOWHERE claims multi-device/conflict-free; roadmap Phase-2 = "ships now", Phase-3 = "later still".
- **AC15 portability:** IndexedDB + Cache API only (no `next-pwa`/`@vercel/kv`/Blob/Postgres); server write path unchanged (bar the additive Path-C return field); a **real `pnpm build`** passes (the leak class fails only at build); single store-version + single SW VERSION constant.
- **Traps (Kofi):** (2) a since-revoked `senior_subject_teacher` assignment — no new write path, authz is whatever Path-C already enforces; actively rejecting a revoked-assignment offline score = a server change, OUT of Item 9 (flag). (3) **store-version bump must NOT blind-wipe a store holding unsynced pending/errored** — SW cache (rebuildable, wipe-safe) vs IndexedDB store (only copy of unsynced work) get SEPARATE version constants + policies; migrate-forward / flush-then-clear, never silent drop. (4) two tabs of one session — IndexedDB origin-shared; hydrate MERGES persisted pending/errored (never zero another tab's unsynced); live cross-tab sync NOT a phase-2 requirement (documented ceiling; the server upsert is the reconciliation point). (5) session id stable across offline; (6) errored+re-edit handled by existing `bufferEdit`; (7) **hydration re-derives `online` live from `navigator.onLine`** (not the persisted `online:false`) + `episode = hasPending`, else a reopened-online buffer sits gold forever without flushing.

### Lucy surface confirm (PWA phase 2 — states/copy deepening, NO new surface)
- **Gold sync strip (copy edit in 2 helpers, tokens unchanged):** the buffer survives close/reopen so on a signal-less reopen there is NO live "Connection lost" event — drop the event-framed prefix. `heldStripText(n)` → **"{n} score{s} held offline · will sync when you're back online"**; `heldBadgeText(n)` → **"{n} score{s} on this card held offline · will save when you're back online"** (`lib/score-ledger/pwa-buffer.ts`). Green "All scores synced · last …" UNCHANGED; a held score still never renders "saved".
- **Roadmap panel (Section 4, mechanical):** graduate the Phase-2 card eyebrow **"Phase 2 · later · trigger = real demand" → "Phase 2 · ships now"** + re-tone muted-navy-3 → shipped-state (green eyebrow, opacity 1, gold-bg — match the Phase-1 card); Section-04 meta **"Three phases · only one ships now" → "…two now shipped"**; **Phase-3 card UNCHANGED ("later still", opacity 0.55)**.
- **Honest caption → the settled line** ("Enter a full class's scores with no signal — they save when you're back online", single-device) replaces the phase-1 "works on your phone, handles bad connections / Not works offline" caption. **MUST NOT show anywhere:** "works across your devices"/multi-device/cross-device, "conflict-free"/conflict-resolution/last-write-wins/offline-first, or "works offline" used to imply the Phase-3 story — those stay Phase 3 "later still". Keep single-device explicit.
- **Red errored cell:** treatment UNCHANGED (`border-terra bg-terra-bg text-terra` on the input + the error banner from `buffer.lastError`); now PERSISTS across reopen (the `errored` map + `lastError` are in the persisted snapshot). No new tint.
- **No-alpha discipline clean** — all status tints are solid `-bg` brand tokens (gold-bg/green-bg/terra-bg), no slash-opacity; phase 2 adds no new tint.

### INCR-14 · Build + gate outcomes (impl `dd88cd6`, +test `b960a00`)
- **Files (13 + 1 test):** `lib/auth/index.ts` (new `getSessionId()`/`sessionIdFromJwt` — server-only, decodes the stable `session_id` claim, never the rotating raw JWT), `lib/score-ledger/pwa-store.ts` (NEW plain-IndexedDB layer), `pwa-flush.ts` (Trap-1 confirm/reject + `STALE_ROSTER_ERROR`), `pwa-buffer.ts` (phase-2 copy), `lib/actions/score-ledger.ts` (additive `writtenIds` on both Path-C actions — `{ok,saved}` unchanged), `components/senior/pwa-ledger.tsx` (hydrate/persist, `beforeunload` removed), `components/pwa-session.tsx` + `components/app/sign-out-button.tsx` (session-keyed purge on identify + logout, wipes IndexedDB **and** SW cache), `public/sw.js` (`LEDGER_PREFIX` uid→session id), `app/(app)/layout.tsx` + `app/(app)/senior/score-ledger/page.tsx` (thread `getSessionId()`), + `lib/score-ledger/pwa-store.test.ts` (NEW, fake-indexeddb).
- **Gates ALL GREEN:** Quinn **GREEN** (323/323 tests, typecheck+build clean; Trap-1 red-path proven; idempotent upsert byte-for-byte intact; desktop grid + phase-1 hold path unbroken; copy honest). Dex **APPROVE** (IndexedDB+CacheAPI only, no new runtime dep, seam confined to `lib/auth`; `DB_VERSION`/`STORE_VERSION`/SW `VERSION` correctly 3-way separated; `loadSnapshot` never wipes on a version delta). Sarah **CLEAR-TO-MERGE** (isolation is **structural** — session-prefixed keys mean B can't read A's records regardless of purge timing; unverified claim used only to name a client cache partition, never authz; RLS untouched; **no schema/migration/RLS/prod-paste** this increment — nothing to hand-paste on prod).
- **AC15 build:** a clean `pnpm exec next build` on the installed **Next 15.5.20** passes end-to-end (full route table, exit 0). Dex's build caveat was his subagent invoking a stale pnpm-cached `next@14.2.35`, not the diff.
- **Coverage follow-up DONE (Quinn note #2):** added `fake-indexeddb` (test-only devDep) + `pwa-store.test.ts` — 7 cases covering the durable round-trip (pending+errored survive), subject-partition non-bleed, and the AC9/AC10 purge isolation (the shared-tablet children's-PII path). The store is no longer the untested mechanism.
- **🟠 AC7 RATIFIED as within-subject for Phase 2 (orchestrator scope note; Quinn #1):** eager pre-cache makes any assigned **same-subject** class offline-openable incl. one not visited this session (all same-subject classes load into one page render; the class switcher is pure client state — no refetch). A **cross-subject** unvisited class is NOT eagerly pre-loaded: the reducer is single-subject (`cellId`/`weights`/flush routing scope one `subjectId`), and merging cross-subject rosters into one view would misroute a held score — **both Dex and Quinn independently ruled the boundary sound, not an under-build.** The cross-subject miss fails **honestly and loudly** — an explicit "can't load this class without a connection; your held scores are safe and will sync" page (`sw.js` offline fallback), never a false-empty roster, never a false-save, **no data loss** (MAJOR-1 invariant intact). True cross-subject eager offline (SW warm-fetch of every assigned-subject URL, or a multi-subject view) is **Phase 3 / Item 10**. Kofi's Q3 "eager pre-fetch of the assigned SET" is honoured **per subject**; the cross-subject clause is explicitly deferred here rather than silently narrowed. `snapshot.rosters` is persisted now (board-mandated) but read-only until that Phase-3 reconstruction lands.
- **Live DevTools self-verify = the remaining manual E2E proof (owner, at merge):** the offline close/reopen, logout-wipe, and shared-device flows can't run in the node test runner. Checklist: (1) offline → enter a full class's scores → **close & reopen the app still offline** → scores present & GOLD, none green; (2) reconnect → auto-flush → all green, no dup rows on a second flush; (3) a deliberately-invalid score → RED, **survives close/reopen still red**; (4) log out teacher A → A's pending scores/rosters gone from IndexedDB **and** the SW cache; (5) log in teacher B on the same tablet → B sees **none** of A's held scores.
- **Deferred (unchanged owner calls, NOT this increment):** cross-tab live sync (documented ceiling; server upsert is the reconciliation point); a pre-existing marketing FAQ "offline-first" line (`components/marketing/faq.tsx`, NOT touched by this diff — flag to Lucy separately); the untracked `Surfaces/schoolup-shs-score-ledger-pwa.html` roadmap/caption graduation (design artifact in the parent tree, no app component renders it — Lucy to sync the mockup: Phase-2 card → "ships now", Section-04 meta → "two now shipped", caption → the honest single-device line).

---

# MODULE 4.3 — WASSCE READINESS (5 surfaces · reads the ledger trajectory · size L)

> Pence plan (2026-07-19). Next after 4.1 (closed, Items 1–9) + 4.2 (closed, 7 surfaces). `senior-feat` level with `main`.

**Two module-framing findings (settled by authority order — logged, not owner-blocking):**
- **(A) Schema source = BUILD_STACK, not spec §4.3.** `INSTRUCTIONS_FOR_CLAUDE_CODE.md §4.3` sketches 5 tables; `BUILD_STACK.md` (the constitution, wins on conflict) defines the **full ~14-table + 8-enum WASSCE batch** (`wassce_programmes/subjects/candidates/papers/paper_sittings`, `mock_exams/mock_results`, `universities/university_programmes/university_targets`, `waec_special_consideration`, `wassce_results`, `readiness_statements`, `benchmark_data_points`). Module builds to the BUILD_STACK batch. Kofi logs this at INCR-15 start.
- **(B) Prediction is Mock-2-anchored, NOT ledger-weighted-total→band math.** Per-subject predicted grade = teacher-marked **Mock 2 grade** (`mock_results.grade`, BUILD_STACK Decision 2; Mock 1 = calibration). Aggregate projection = deterministic **best-3 cores + best-3 electives** (min 6 / max 54, Decision 12), and it **HOLDS through medical disruption** (Decision 11). The **6-semester ledger trajectory is CONTEXTUAL** — rendered on student-readiness under *"Ledger trajectory · what the predictor sees that STPSHS does not,"* a supporting strip, not the formula. Centre of gravity = **mock capture + deterministic projection, ledger as context.** (The one open domain nuance — is the trajectory purely contextual or a tie-breaker/confidence adjust — is a Kofi call at INCR-16/17, NOT a weighted-total formula.)

**Module reads (READ-ONLY / frozen ledger contracts):** `senior_score_ledger` (`weightedTotal` + 5 category scores per student×subject×period = the trajectory strip; NEVER written here), `senior_subject_teacher` (mock-marking gate + "my cohort"), the **frozen `*_weight_used` snapshot** on the ledger row (display that, never re-resolve live weights), `academic_period` (6 SHS semesters + `period.weight` for STPSHS aggregation). Must NOT import/re-run `compile.ts`/`resolveWeights` — consume stored values.

## MODULE 4.3 — increments (INCR-15 → INCR-20)

| # | Title | Surface(s) | Migration | Depends on | Position |
|---|---|---|---|---|---|
| **INCR-15** | **F0 — WASSCE cohort spine** | `wassce-setup` §1 (programmes/subjects/electives), §4 (registration roster · the 240), §5 (policy anchors/frozen state) | **0051** | Senior F0 (shipped) + `students` | **ROOT** — everything FKs to candidates/subjects |
| **INCR-16** | Subject-teacher + mock cycle | `wassce-subject-teacher` (Mr Asiedu) + `wassce-setup` §2 (mock config) | **0052** | INCR-15 | Prediction **input** (mocks before projection) |
| **INCR-17** | Projection engine + university targets + readiness statement + SC-form | `wassce-setup` §3 (uni targets) + the readiness-statement artifact | **0053** | INCR-16 | **Analytical spine** (heaviest; split `university_*`→INCR-17b if it runs long) |
| **INCR-18** | Cohort-readiness (HoA) | `wassce-cohort-readiness` | none (read/aggregate) | INCR-16,17 | HoA moderation gate on mock marking |
| **INCR-19** | Parent-tracker | `wassce-parent-tracker` | none new; **parent-scoped RLS policy** (prod-paste) | INCR-17 | Parent-facing capstone (read-only, one child) |
| **INCR-20** | Student-readiness (LAST) | `wassce-student-readiness` (Y. Aidoo · 7 sections) | none new | **all prior** | Built last per §4.3 — pulls from every table |

Only INCR-15/16/17 add tables → **0051/0052/0053** + a `db/sql/prod-paste-005X-*.sql` each. INCR-18/19/20 are read surfaces (don't burn a migration number); INCR-19 adds a **parent-scoped RLS policy** only.

**Portability/RLS (Wells):** tenant tables (composite `(school_id,id)` FKs + `tenant_isolation` FORCE + prod-paste): all `wassce_*` except universities, plus `mock_*`, `university_targets`, `waec_special_consideration`, `readiness_statements`. **Global** (bare ENABLE RLS, never FORCE/tenant_isolation): `universities`, `university_programmes`. **`benchmark_data_points` is MIXED** (`SCHOOLUP_DIRECT`=tenant, `WAEC_NATIONAL/REGIONAL`=global) → **lean split-the-table** over nullable-`school_id`-with-conditional-RLS (Kofi/Wells joint call). **No triggers** (best-3 aggregate = pure lib like `compile.ts`; freeze = app-layer; Sickbay→SC-12 auto-suggest deferred to 4.4). **Reuse the portable receipt-PDF path** (#136) for `readiness_statements.parent_signature_pdf_file_id` — no new PDF dep.

**OWNER calls (surface at module gate; block a *slice*, not the build):** parent-ack SMS provider (same Hubtel gate as 4.2 — blocks the parent-ack slice of INCR-17/19); university cut-off dataset source (licensed vs school-entered — blocks uni-match slice of INCR-17/20); benchmark national/region data + multi-school pooling (ship region as `DIRECTIONAL` placeholder; **do NOT build cross-tenant pooling** — depends on Oversight tier / Phase 5); public mock-accuracy figure (73–82%) + its update policy; WAEC ICTD API vs printable (build manual/printable path). **No paid-service provisioning needed for the core** (mocks are teacher-entered) → no stop-and-ask beyond SMS.

**Cross-module hooks DEFERRED to 4.4 Sickbay / senior backlog (Kofi):** Sickbay→SC-12 auto-suggest (Decision 9) and F3 discipline-pause / WASSCE-window absence-exemption (Decision 6) touch Sickbay (not yet built). INCR-17 ships **SC-12 as manual filing**; auto-suggest is a later app-layer cross-module call (never a trigger).

## Next increment — INCR-15 · F0 WASSCE cohort spine · migration 0051

**Recommended first (Pence):** the sole increment nothing can precede — every other WASSCE table + all four remaining surfaces FK into `wassce_candidates`/`wassce_subjects`; carries the most schema-shaped Kofi rulings that block Wells; maps to the read-only, lowest-risk part of the setup surface (§1/§4/§5), letting the loop shake out the module's RLS/composite-FK/freeze patterns with no write-side projection math. Exact analogue of 4.2 opening on the House→Dorm→Bunk spine.

**Spine tables:** `wassce_programmes → wassce_subjects → wassce_candidates → wassce_papers → wassce_paper_sittings` + a per-school **freeze marker** (`wassce_setup_frozen_at`, Decision 1).

**Kofi must rule before Wells designs schema:**
1. **Freeze mechanism (Decision 1):** where `wassce_setup_frozen_at` lives (per-school SHS config row vs per-cohort table), HoA+Headmaster co-sign semantics, which dependent tables lock on freeze, the change-control typo exception. *(WHAT=Kofi, WHERE=Wells.)*
2. **`subjects_sitting_json` vs a normalized `wassce_candidate_subject` join** — BUILD_STACK says JSON on `wassce_candidates`; repo composite-FK discipline argues for a normalized join with FK integrity to `wassce_subjects`. Kofi call; likely the join table for RLS/FK integrity — **flag owner if it goes the other way.**
3. **`index_number` uniqueness scope** — BUILD_STACK writes `UNIQUE(index_number)` (nationally unique WAEC numbers); a *global* unique across tenants leaks row existence + fights isolation. **Flag owner if they choose global** over tenant-scoped.
4. **`wassce_subjects` tenancy** — must carry `school_id` + composite FK to `wassce_programmes(school_id,id)` so isolation is enforceable (no through-join escape).

**Owner map:** Kofi (rulings + AC for the frozen read-only roster) ‖ Lucy (`wassce-setup` §1/§4/§5 → `docs/senior/wassce-spine-surface-map.md`) → Wells (6-table spine + freeze marker + migration 0051 + `prod-paste-0051-wassce-spine.sql`; composite FKs; FORCE RLS) → Claude Code (read-only setup/registration surface + apply/verify 0051 on dev + PR) → Quinn/Dex/Sarah gates.

**INCR-15 done when:** an SHS admin can view the frozen WASSCE registration roster (programmes, subjects/electives, the candidate list with index numbers, papers/sittings, policy anchors) for the cohort — tenant-scoped, RLS-enforced, freeze-state signalled, no write-side projection — three gates green + `prod-paste-0051` ready to hand-paste.

### INCR-15 · Kofi rulings + AC (2026-07-19) · Lucy map: `docs/senior/wassce-spine-surface-map.md`
**Spine = 7 tables** (migration 0051): `wassce_cohort` (freeze anchor) → `wassce_programmes` → `wassce_subjects` → `wassce_candidates` → **`wassce_candidate_subject`** (join, replaces JSON) → `wassce_papers` → `wassce_paper_sittings`. All carry `school_id`, composite `(school_id,id)` intra-tenant FKs, `tenant_uk` where referenced, FORCE RLS `tenant_isolation`. INCR-15 is **READ-ONLY** — seed the WASSCE-2026 F3 cohort already-frozen; **no server action mutates any spine row** (there are none to build).
- **Ruling A** — schema source = **BUILD_STACK** WASSCE batch (not spec §4.3's 5-table sketch), amended by 1–4.
- **Ruling 1 — freeze is PER-COHORT, keyed `(school_id × exam_year)`, NOT a per-school scalar.** The surface shows F3-2026 frozen while F2-2027 stays editable in the same school → a scalar can't express that. `wassce_cohort.setup_frozen_at`: NULL = in-flight/editable, non-NULL = frozen. Freeze requires **both** co-signs present: one `HEADMASTER` + one `VICE_HEADMASTER_ACADEMIC` (= Head of Academics in this codebase's `appRoleEnum`; no separate HOA role), each an append-only {actor id, ts}; **self-cosign rejected**. Cohort-scoped rows (candidates, candidate_subject, papers, sittings) lock on freeze; `wassce_programmes`/`wassce_subjects` are durable **school-level** reference (NOT cohort-scoped, edits affect future registrations only). **Typo exception:** post-freeze the ONLY writes are clerical `index_number`/`centre_code` fixes via a co-signed, audit-logged change-control action. **The freeze/unfreeze co-sign action + typo write-flow are DEFERRED** to a later increment — INCR-15 builds the model + display only.
- **Ruling 2 — DEVIATION RATIFIED (orchestrator):** replace BUILD_STACK's `wassce_candidates.subjects_sitting_json` with a normalized **`wassce_candidate_subject`** join `(id, school_id, candidate_id, subject_id)`, `UNIQUE(school_id, candidate_id, subject_id)`, composite FKs to candidates + subjects, FORCE RLS. Buys FK integrity + RLS + INCR-18 heatmap `GROUP BY`. `accommodations_json` STAYS json (unstructured SC display).
- **Ruling 3 — `index_number` = tenant-scoped `UNIQUE(school_id, index_number)`, NOT global.** Centre code is 1:1 with the school (index `0184-0817` = centre `SU-0184` + candidate), so within-school uniqueness already preserves national uniqueness; a global unique leaks cross-tenant row existence below RLS. **No owner escalation** (global was the escalation-worthy option; declined — future cross-school dup detection = Oversight tier, never a DB constraint).
- **Ruling 4 — `wassce_subjects` carries `school_id` + composite FK to `wassce_programmes(school_id,id)`** + its own `tenant_uk`; uniform across all 7 tables. Closes the through-join RLS escape.
- **K1** subjects are per-programme rows (no subject-master/join; "23 subjects · 4 core · 19 elec" = distinct-display count); `subject_type` `CORE/ELECTIVE/OPTIONAL` ↔ surface `Core/Elec/Alt`. **K2** `wassce_papers` + `wassce_paper_sittings` are cohort-scoped; sittings `UNIQUE(school_id, candidate_id, paper_id)`. **K3** fee/NHIS/medical are **display flags, never `candidate_status`, never blockers** (Decision 5); `candidate_status_enum` = `REGISTERED/ACTIVE/WITHDRAWN/COMPLETED` (WAEC lifecycle only); INCR-15 seeds these flags as static display (live billing/sickbay reads = later). **K4** `mock_2_aggregate` renders seeded/display-only, `projected_aggregate` stays NULL, tier chips NOT computed (INCR-16/17). **K5** `wassce_programmes`/`wassce_subjects` soft-delete via `active_flag` (never dangle a frozen cohort's reference).

**AC for Quinn** (surface-accurate to `wassce-setup` §1/§4/§5):
- **A·cohort/freeze:** seeded F3-2026 cohort `setup_frozen_at` non-NULL with **two distinct** co-sign stamps (HEADMASTER + VICE_HEADMASTER_ACADEMIC); one-stamp fixture ⇒ NULL; self-cosign rejected; every candidate/subject/paper/sitting resolves to exactly one cohort and inherits its freeze state.
- **B·frozen roster (§4 "the 240"):** no write/edit affordance on frozen rows and **no mutating server action exists**; save-bar shows "Setup is frozen for this cohort"; 240 candidates each render name+student id, programme pill, mono index (`0184-0817`), WAEC reg-status, notes/accommodation, seeded Mock 2 agg; tiles = Confirmed 237/240 · Flagged 3 · Accommodations 4 · fees GHS 336k/0 outstanding; filters All 240·Sci 60·Bus 60·Arts 80·Home Ec 40; P. Donkor (GHS 240 owing) still REGISTERED/Confirmed; Y. Aidoo (`0184-0817`) "On medical" is display-only (no SC/sickbay write).
- **C·matrix (§1):** 4 programme cards (Sci 60/Bus 60/Arts 80/Home Ec 40) w/ 4 shared cores + electives/alts, tags map `subject_type`; stats strip 240·4·23(4 core·19 elec)·Mocks 2 of 2 (seeded); A1–F9 band + "best-3-cores+best-3-electives=6…54" static.
- **D·papers/sittings:** cohort-scoped WAEC-2026 timetable papers (date/time/duration/type/`waec_paper_code`); sittings one-per-(candidate×paper) `UNIQUE(school_id,candidate_id,paper_id)`, exemption fields for Y. Aidoo's missed papers, no derivation.
- **E·policy (§5):** WAEC anchors (centre SU-0184, 21 Apr→19 Jun 2026, SC-3/7/12, grading+aggregate) + GES anchors (Free SHS GHS 1,400/candidate, "no candidate denied for fees" as TEXT only — no fee-gating code path).
- **F·isolation:** all 7 tables FORCE RLS + `prod-paste-0051` mirrors dev policies; a second school SELECTs zero cohort rows; every intra-tenant FK composite (mismatched `school_id` insert rejected); `index_number` unique is `(school_id, index_number)` — two schools, no collision/no cross-tenant error.
- **G·no projection leak:** module imports no mock/projection/`compile`/best-3 logic; `mock_2_aggregate` seeded-only, `projected_aggregate` NULL/unused; university tier band NOT computed (seeded/static or omitted).

**Lucy map + binding gaps (render seeded/static/inert, NOT computed or wired):** Mock 2 agg column + Aggregate sort + "Mocks 2 of 2" (INCR-16/17 → em-dash/omit; disable Aggregate sort); live-exam banner (static or defer); A1–F9 + SC-form list + GES anchors = `lib/wassce/` constants, not tables; billing figures = static `count × GHS 1,400` (cross-module Billing); Sickbay/VLC referral cards = static from a candidate flag (4.4/4.5 unbuilt); Gen. Arts `#7B4A8A` = per-programme inline color (not a token, mirrors boarding House-hex drift — no slash-opacity); centre code `SU-0184` = per-school WASSCE config, not a spine table. **WRITE controls to render INERT (contradict read-only, do NOT build):** `Edit · F2 cohort`, `+ Late registration`, any freeze/unfreeze toggle, nav-out buttons to unbuilt targets. Export/Print/Audit-history are reads (safe to wire/stub); filter/sort pills are client view-state (safe; disable Aggregate sort). **No-alpha discipline:** every `rgba()` in scope → arbitrary-rgba or `opacity-N`, never `bg-gold/8`.

**Orchestrator ratifications (no owner call needed for INCR-15):** Ruling 2 join-over-JSON **RATIFIED**; co-sign order = both-present/order-agnostic (Kofi), UX default HoA-proposes→Headmaster-ratifies, not enforced, write-flow deferred; Ruling 3 tenant-scoped, no escalation.

### INCR-15 · Build + gate outcomes (PR #159 — awaiting owner merge)
- **Commits:** Wells schema/migration `3505961` + Claude Code surface/seed `a2f8011` + Quinn money-tile test. **Files:** `db/schema/wassce.ts` (7 tables), `db/migrations/0051_soft_changeling.sql`, `db/sql/prod-paste-0051-wassce-spine.sql`, `db/seed/wassce.ts` (240-candidate frozen cohort, idempotent), `app/(app)/senior/wassce/setup/page.tsx`, `lib/wassce/setup-data.ts` (server-only loader), `lib/wassce/constants.ts` (+test), `components/senior/wassce-roster-table.tsx` (client), `lib/access.ts` (`WASSCE_SETUP_ROLES`), sidebar nav.
- **Gates ALL GREEN:** Quinn **GREEN** (326 tests; freeze CHECKs proven by violating inserts — one-stamp + self-cosign both blocked; every count derives from real rows; no projection leak; 7/7 RLS pass). Dex **APPROVE** (freeze = same-row CHECKs not triggers; 0051 UNIQUE-before-FK replays from empty; server/client seam build-verified; Wells's enum/column calls sound). Sarah **CLEAR-TO-MERGE** (7 tables fail-closed foreign=0/unscoped=0; prod-paste parity for all 7; zero mutating server action = no write-path surface; role-gate server-side before PII read; seed marker-scoped).
- **⚠️ PROD DEPLOY:** hand-paste `db/sql/prod-paste-0051-wassce-spine.sql` (FORCE RLS `tenant_isolation` for all 7 tables) — `db:policies` is dev-only; without it the cohort PII leaks cross-school.
- **Adjudicated deviation (Quinn):** subjects render **22/4/18** not the surface's printed **23/19** — the surface's own §1.4 cards sum to 22 distinct subjects (its stat tile miscounts itself); honesty-of-counts (all displays derive from rows) wins. Roster renders all **240** real rows (working sort/show) rather than the surface's "9 + 231 more" placeholder — more faithful to "the 240."
- **🟠 CARRY INTO INCR-16 (must-fix there, not INCR-15 scope):** (1) **Dex MINOR-1** — `lib/wassce/setup-data.ts` selects the cohort via `asc(examYear)` first-row (comment says "latest"); harmless with one seeded cohort but selects the WRONG cohort once INCR-16 adds F2-2027. A naive `asc→desc` flip is ALSO wrong (the setup surface centers on the frozen F3 cohort, not merely the latest year) — the fix needs INCR-16's cohort-selector semantics (select by frozen-state / an "active cohort" notion). (2) **Quinn MINOR** — the `freeze_needs_both_cosigns` CHECK ties `setup_frozen_at` to the two `*_cosign_at` timestamps only; a frozen row with both timestamps but a NULL `*_cosign_user_id` would pass. Extend the CHECK to also require both signer ids non-null WHEN the freeze **write-flow** lands (INCR-16+), and `assertAnyRole` the signer roles server-side at that point (Sarah's deferred note). Both are latent-only (seed sets everything correctly; no write-flow exists in INCR-15).

## INCR-15 ✅ MERGED (PR #159, `3505961`+`a2f8011`) — WASSCE readiness F0 · migration 0051 · ⚠️ prod deploy: hand-paste `prod-paste-0051-wassce-spine.sql`

## Next increment — INCR-16 · Subject-teacher + mock cycle · migration 0052

The prediction **input**: `mock_exams` + `mock_results` make the per-subject predicted grade (= Mock 2 grade, Decision 2) real. Whole-candidate best-3 **aggregate** stays INCR-17. First WASSCE increment with **write surfaces** (mock config + teacher mark-entry; moderation columns-only). Surfaces: `wassce-subject-teacher` (full, Mr Asiedu) + `wassce-setup §2` (mock config). Lucy map: `docs/senior/wassce-mock-surface-map.md`.

### INCR-16 · Kofi rulings + AC (2026-07-19)
**New tables (0052):** `mock_exams` (TENANT, referenced), `mock_results` (TENANT, leaf), `benchmark_data_points` (TENANT), `benchmark_reference` (**GLOBAL** — bare ENABLE RLS). Enums: **`wassce_grade`** (A1,B2,B3,C4,C5,C6,D7,E8,F9 — match `lib/wassce/constants.ts` order), `benchmark_source` (SCHOOLUP_DIRECT/WAEC_NATIONAL/WAEC_REGIONAL_SUMMARY/INTERPOLATED/MULTI_SCHOOL_POOL[reserved,no logic]), `benchmark_quality` (STRONG/MODERATE/DIRECTIONAL), `benchmark_metric` (CREDIT_RATE/DISTINCTION_RATE), `benchmark_scope` (SCHOOL/REGION/NATIONAL).
- **R1 mock_exams:** 2 mocks/cohort (Mock 1 Nov calibration + Mock 2 Mar predictor), cohort-wide, cohort-scoped. Predictor = explicit **`is_predictor bool`** (partial `UNIQUE(school_id,cohort_id) WHERE is_predictor`) NOT "highest mock_number" (surface has a "Mark Mock 3" button that would re-point it). `mock_number smallint` **no CHECK ceiling** (">2 allowed, not seeded"). **RATIFIED DEVIATION:** `cohort_id` composite FK → `wassce_cohort(school_id,id)` replaces BUILD_STACK's loose `cohort_year`. Config gated to `WASSCE_SETUP_ROLES`; fields `name, mock_number, is_predictor, scheduled_start, scheduled_end, marking_complete_at`.
- **R2 mock_results grade:** teacher enters **grade A1–F9 directly** (authoritative, `wassce_grade NOT NULL`); `raw_score`/`max_score` nullable diagnostic. **Per-subject predicted grade = Mock 2 grade DERIVED-ON-READ** (`COALESCE(moderated_grade, grade)` of the `is_predictor` mock), **no stored `predicted_grade` column**. NO invented raw→band ladder — the per-school **`grade_scale`** table already maps score→letter; auto-suggest is optional (OWNER-ESCALATE non-blocking → **recommend grade entered directly, defer auto-suggest**).
- **R3 moderation (Decision 10):** store BOTH — `grade` (teacher, immutable) + `moderated_grade wassce_grade NULL` + `moderator_user_id`(SET NULL) + `moderated_at` + `moderation_reason`. Effective = COALESCE. Same-row **CHECK** `moderated_grade IS NULL OR (moderator_user_id NOT NULL AND moderated_at NOT NULL)` (portable, INCR-15 idiom). Moderator = `VICE_HEADMASTER_ACADEMIC`. **Columns authored now in 0052; the moderation WRITE UI is INCR-18** — the derived read must already COALESCE.
- **R3b write scope — BUILD now:** teacher mark-entry (gated by `senior_subject_teacher` + `mock_exams.marking_complete_at IS NULL`) + minimal mock-config write (HoA/admin, edit blocked once `marking_complete_at` set). **DEFERRED:** moderation write→INCR-18; freeze co-sign write-flow stays deferred (NOT INCR-16). **KEY DOMAIN RULING: mock marking is NOT gated by the registration freeze** — `setup_frozen_at` locks the ROSTER; `mock_exams.marking_complete_at` locks MARKING independently (Mock 2 is March, after Feb reg close). Resolves Decision 1's apparent contradiction.
- **R4 benchmark SPLIT:** tenant **`benchmark_data_points`** (SCHOOLUP_DIRECT per-school, FORCE RLS, prod-paste) + global **`benchmark_reference`** (WAEC national + directional region, **bare ENABLE RLS**, no FORCE/no tenant_isolation, prod-paste). "My cohort" is DERIVED (not a row). **NO pooling logic, no cross-tenant reads.** Region ships **DIRECTIONAL** (±4–5pp). Actual WAEC numbers + 73–82% accuracy = placeholders/constants (OWNER-ESCALATE non-blocking, board pre-rules placeholder).
- **R5 subject-teacher authz (per-subject scoped):** a subject teacher sees ONLY their assigned (cohort × subject) — Mr Asiedu → Chemistry F3 only; whole-cohort visibility is INCR-18. Assignment = `senior_subject_teacher` (reuse). **⚠️ GENUINE MODELLING SEAM (Sarah/Quinn must prove no cross-subject/cohort leak):** `senior_subject_teacher.subject_id` → score-ledger `subject` (name+code); `mock_results.subject_id` → `wassce_subjects` (name only). Resolve the correspondence by **(school_id, subject `name`)** within the cohort's F3 class(es).
- **Active-cohort selection (fixes Dex MINOR-1):** "active cohort" = `WHERE setup_frozen_at IS NOT NULL ORDER BY exam_year DESC LIMIT 1` → resolves to **F3-2026** (NOT merely latest year, which would wrongly pick the unfrozen F2-2027; NOT `asc` which is right only by accident). **INCR-16 seeds a 2nd cohort F2-2027 in-flight (unfrozen), Mock 1 scheduled (`marking_complete_at` NULL)** — forces the selector fix + gives a non-locked mock to test writes.
- **Portability:** no triggers (banding = pure `grade_scale` lib read; moderation = app-layer COALESCE; trail invariant = same-row CHECK); composite tenant FKs (actor stamps single-column SET NULL); prod-paste for all 3 tenant tables + the global `benchmark_reference` (bare ENABLE). No projection/best-3/`compile` import (AC16); `projected_aggregate` stays NULL.

**AC (Quinn), surface-accurate:** AC1 2 mocks render, Mock 2 `is_predictor`, one-predictor-per-cohort enforced · AC2 config write role-scoped (subject-teacher denied) · AC3 config edit locked once `marking_complete_at` set · AC4 mark-entry restricted to assigned subject via `senior_subject_teacher` (Physics write by Asiedu rejected; no assignment ⇒ 0 rows/403) · AC5 mark-entry blocked once marking complete, **but NOT blocked by registration freeze** · AC6 grade enum A1–F9 enforced, raw nullable · AC7 predicted grade = Mock 2 `COALESCE(moderated_grade,grade)`, no stored column · AC8 trajectory ↑/→/↓ derived from real Mock1→Mock2 · AC9 histogram + credit/distinction rates derive from rows · AC10 moderation COALESCE supersedes, original preserved, CHECK rejects half-populated moderation (no write UI) · AC11 benchmark split, region DIRECTIONAL + "±4–5pp", no pooling · AC12 benchmark tenancy (tenant fail-closed; reference global) · AC13 no whole-cohort leak (only Chemistry; `mock_2_aggregate` not computed) · AC14 tenant isolation on all 3 tenant tables, composite FKs, prod-paste parity · AC15 active-cohort defaults F3-2026 · AC16 no projection leak (heatmap/intervention/notes seeded-static).

**Lucy map + binding gaps (`docs/senior/wassce-mock-surface-map.md`):** subject-teacher = 5 frames (identity+countdown+Mock2 histogram · 28-candidate mark-entry table · topic heatmap · intervention plan+calendar · benchmark strip+CPD). **Render seeded/static, NOT built as tables in INCR-16:** topic heatmap (§3, needs per-topic grain `mock_results` lacks — future `mock_topic_scores`), intervention-plan text + co-sign (§4), CPD/NTC/Form-Master/practical-attendance fields. **Aggregate — do NOT compute (INCR-17):** cohort-distribution card (Agg 6–54, median/mean, "Legon-competitive"), "Mock 2 agg 14", university targets ("KNUST Biochem"). **Write controls:** teacher-editable (mark cells, raw, note, Save plan); HoA-moderate-only (grade override, Share co-sign → INCR-18); admin-config (Schedule Mock · F2). **Routing leak fix:** demo URL embeds teacher id — real route scopes to session teacher's `senior_subject_teacher`. **Surface drift (OWNER note, non-blocking):** "Mark Mock 3 papers" button contradicts the two-mock rule — recommend relabel to "Mock 2" at surface-sync; HTML renders as-is, the action targets a mock by id.

### INCR-16 · Build + gate outcomes (PR #160 — awaiting owner merge)
- **Commits:** Wells schema/migration `0f6effc` + Claude Code surfaces/writes/seed `889fb73`. **Files:** `db/schema/wassce.ts` (4 tables), `0052_bitter_squadron_sinister.sql`, `db/sql/prod-paste-0052-wassce-mock.sql`, `db/seed/wassce-mock.ts`, `app/(app)/senior/wassce/{subject,mocks}/page.tsx`, `lib/actions/wassce-mocks.ts`, `lib/wassce/{mock-data,mock-grades,mock-view,active-cohort,subject-authz,grade-colors,setup-data}.ts` (+2 tests), `components/senior/wassce-mock-{entry-grid,config-form}.tsx`, `scripts/verify-wassce-mock.ts`.
- **Gates ALL GREEN:** Quinn **GREEN** (344 tests; AC1–16; one-predictor-per-cohort DB-proven; **freeze ≠ marking-lock DB-proven** — an open mock on the frozen F3-2026 cohort accepts a mark; moderation supersede + half-populated-CHECK rejection; no projection leak). Dex **APPROVE** (no triggers; global `benchmark_reference` bare-ENABLE idiom exact; 0052 UNIQUE-before-FK replays from empty; server/client seam build-verified; `getActiveCohort` + `subject-authz` centralized). Sarah **CLEAR-TO-MERGE** (R5 correspondence school+F3-scoped, deny-by-default; **no IDOR** — mock/candidate/subject ids all re-validated server-side; oversight-write leadership-scoped + lock-gated + audited, teacher-isolation intact; 3 tenant tables fail-closed; `benchmark_reference` PII-free global; seed marker-scoped).
- **⚠️ PROD DEPLOY:** hand-paste `db/sql/prod-paste-0052-wassce-mock.sql` — FORCE+`tenant_isolation` for the 3 tenant tables + **bare `ENABLE` (no FORCE/no policy) for global `benchmark_reference`**. `db:policies` is dev-only.
- **Oversight-write (assessed ACCEPTABLE by all 3 gates):** `WASSCE_SETUP_ROLES` (ADMIN/HEADMASTER/VICE_HEADMASTER_ACADEMIC) may mark-enter any subject, bypassing the R5 subject gate; a plain TEACHER is NOT in that set so R5 gates them fully → teacher-isolation holds. Slightly exceeds R3b's config-only wording — **note to Kofi** (non-blocking).
- **🟠 CARRY INTO INCR-17/18 (gate-flagged, non-blocking; fold into the increment that touches the write/moderation path):**
  1. **Quinn obs — write-path integrity (INCR-18):** `saveMockResult` verifies candidate∈cohort + subject-exists but NOT that the candidate is REGISTERED for that `wassce_subject` (via `wassce_candidate_subject`). UI-unreachable (grid lists only registered candidates) but a crafted POST could store an off-roster diagnostic grade. Add the registration check when INCR-18 touches this write.
  2. **Sarah note (INCR-18):** an oversight open-window write overwrites the teacher's authoritative `grade` with NO moderation trail — route oversight edits through the moderation columns once the INCR-18 moderation UI lands.
  3. **Dex FORWARD-1 (INCR-18):** the R5 authz name-match (`subjects.name` ↔ `wassce_subjects.name`) guards case/whitespace only; a semantic rename/alias would silently drop/mismatch access. Upgrade to an explicit `wassce_subjects.ledger_subject_id` composite FK when either vocabulary becomes user-editable.
  4. **Dex NIT-1 (INCR-17):** dedupe the inline credit/distinction boundary in `mock-data.ts:388,393` → reuse the exported `isDistinction`/`isCredit` predicates. Behavior-neutral.
  5. **Quinn obs (cosmetic):** the `wassce-mock.ts` seed comment says raw "C4 4 · C5 2" but the histogram renders *effective* grades (the moderated C4→C5 makes live C4/C5 = 3/3); refresh the comment. All AC-asserted figures (A1/B2/B3=4/8/9, credit 100%, distinction 43%, mean B3) hold.

## INCR-16 ✅ MERGED (PR #160, `0f6effc`+`889fb73`) — WASSCE subject-teacher + mock cycle · migration 0052 · ⚠️ prod deploy: hand-paste `prod-paste-0052-wassce-mock.sql` (3 tenant FORCE + global `benchmark_reference` bare-ENABLE)

## INCR-17 ✅ MERGED (PR #161, `974e270`+`c785d7c`) — Projection engine + readiness statement + SC-form · migration 0053 · ⚠️ prod deploy: hand-paste `prod-paste-0053-wassce-readiness.sql` (2 tenant tables)

The **analytical spine** — the deterministic best-3 aggregate INCR-18/19/20 all read. Surfaces: `wassce-student-readiness` §5 (aggregate visualizer) + §1/§3/§4 (projection display) + §7 (readiness-statement + parent-ack) + `wassce-setup §5` (SC-form). Lucy map: `docs/senior/wassce-readiness-surface-map.md`.

### INCR-17 · Kofi rulings + AC (2026-07-19)
**SPLIT CONFIRMED (domain-sound):** the readiness statement does NOT require the university match (BUILD_STACK gives `university_targets` its OWN `parent_acknowledged_at`, separate from `readiness_statements`). **INCR-17 (0053):** `projectAggregate` pure lib + `waec_special_consideration` + `readiness_statements` (academic core; `target_universities_json` NULL). **INCR-17b (0054):** `universities`/`university_programmes`/`university_targets` + wassce-setup §3 + §6 match + per-target ack. **New tables (0053):** `waec_special_consideration` (TENANT, leaf), `readiness_statements` (TENANT, references `mock_exams`). **Enums:** `sc_form_enum` (SC-3/SC-7/SC-12), `sc_status_enum` (DRAFT/FILED/ACKNOWLEDGED/APPROVED/SCHEDULED/COMPLETED/REJECTED), `parent_ack_method_enum` (PHONE_OTP/IN_PERSON/PDF_UPLOAD). NOT enums: readiness state = **derived** from `parent_acknowledged_at`+`superseded_at`; `projected_band` = text label (lib `bandForAggregate()`). Deferred to 17b: `university_type_enum`, `target_rank_enum`. `wassce_results` (post-release actuals) **DEFERRED** entirely.

**🔑 THE PROJECTION ALGORITHM (`lib/wassce/projection.ts`, pure lib, NO trigger — crown jewel):**
- Partition by `subject_type`: **CORE→core pool; ELECTIVE or OPTIONAL→elective pool** (OPTIONAL/"Alt" competes in best-3-electives). Per-subject grade = predictor mock's `COALESCE(moderated_grade, grade)` (reuse `effectiveGrade`); `gradePoints = gradeOrdinal+1` (A1=1…F9=9).
- If ≥3 graded cores AND ≥3 graded electives → sort each pool by **`(points asc, name asc)`** (deterministic tie-break), counted = first 3, dropped = rest (dropped stays rendered at `opacity-45`, never filtered). `aggregate = Σ points of the 6 counted` — **includes D7/E8/F9** (min 6 = six A1, max 54 = six F9). `band = bandForAggregate(aggregate)`.
- If `<3` in either pool → **`{computable:false, reason: INSUFFICIENT_CORES|INSUFFICIENT_ELECTIVES}`** — NEVER a partial 5-subject number (would misread vs cut-offs). `isCredit` (A1–C6) is a SEPARATE per-subject flag, NOT a filter on the aggregate sum (six F9 → agg 54, 0 credits).
- **Canonical fixture Y. Aidoo = 10:** cores IntSci A1/Math B2/Eng B3/Social B3 → keep IntSci+Math+Eng=6, **drop Social** (ties Eng at 3; "English Language" < "Social Studies" → English kept, matches §5 exactly); electives Bio A1/Chem A1/Phys B2/ElecMath C4 → keep Bio+Chem+Phys=4. Agg=10. Ship a runnable self-check (fixture=10, all-A1=6, all-F9=54, tie-break drops Social, <3 cores→not-computable, exempted-live-paper input = same number).
- **Decision 11 medical HOLD = STRUCTURAL:** `projectAggregate` reads ONLY the predictor mock, **never `wassce_paper_sittings`** — a missed/exempted live paper (SC-12) cannot affect the number (Mock 2 was sat in March, pre-disruption). No `if(medical)` branch. If Mock 2 ITSELF is incomplete → that's the 1(c) partial-data NULL, not a Decision-11 case.
- **STORED vs DERIVED (hybrid):** live aggregate = **DERIVED-on-read** via the pure lib (no drift, no trigger, `compile.ts` idiom); `wassce_candidates.projected_aggregate` stays **NULL in the live path**; the ONLY stored copy is the **immutable frozen snapshot on `readiness_statements`**. `projected_aggregate == mock_2_aggregate` in INCR-17 (no trajectory-based numeric adjustment — trajectory is context narrative only; a numeric adjust would be the "hidden logic" Decision 12 forbids). **Cleanup (Claude Code):** point the roster's Mock-2-agg column at the DERIVED value, don't trust the INCR-15 seeded static (one source of truth).
- **OWNER-ESCALATE (non-blocking):** pure best-3-of-4-cores (spec/surface/visualizer-accurate) vs the real Ghana university-ADMISSION rule (English + Core Maths mandatory, best-of the rest as 3rd core). Diverge ONLY when Eng/Maths is a candidate's WORST core (not in the Y. Aidoo demo). **Ship pure best-3 now; flag the Eng/Maths refinement to owner tied to 17b** (where cut-off matching makes admission-accurate aggregates load-bearing). Projection number is advisory, never WAEC-authoritative.

**Ruling 3 — SC-form (`waec_special_consideration`, WRITE surface, manual filing):** SC-3 (pre-exam sensory/physical accommodations), SC-7 (chronic-condition extra time), SC-12 (in-window medical disruption/missed papers). Shape: `school_id`, composite FK `(school_id, candidate_id)`, `sc_form`, `status`, `filed_at`, `filed_by_user_id`(SET NULL), nullable `medical_cert_file_id`/`clinician_letter_file_id` (stay NULL — no file layer), `waec_acknowledged_at`, `waec_ref`, `approved_at`, `make_up_scheduled_at`, `make_up_centre`, `completed_at`, `notes`. **UNIQUE(school_id, candidate_id, sc_form)** (refile updates). TENANT, FORCE RLS, LEAF, mutable workflow. Gated to `WASSCE_SETUP_ROLES` (no new exams-officer/matron role). Sickbay→SC-12 auto-suggest DEFERRED to 4.4. Setup §5 SC list stays policy-display (a `lib/wassce` constant); the real filing artifact is on student-readiness.

**Ruling 4 — readiness statement (`readiness_statements`, frozen artifact):** cols `school_id`, composite FK `(school_id, candidate_id)`, `mock_2_id` composite FK `(school_id, mock_2_id)`→`mock_exams`, `projected_aggregate`(frozen), `projected_band`(frozen text), **`projection_snapshot_json` jsonb** (`{mock1Aggregate, mock2Aggregate, projectedAggregate, band, subjects:[{name,type,grade,points,counted}]}` — the §5 visualizer + Mock1→Mock2 trajectory frozen), `target_universities_json` **NULL (17b)**, `generated_at`, `generated_by_user_id`(SET NULL), `superseded_at` NULL, parent-ack: `parent_acknowledged_at`, `parent_acknowledged_signature_method`(enum), `parent_acknowledged_phone`, `parent_concerns_text`, `parent_signature_pdf_file_id`(NULL). **Generation:** manual by `WASSCE_SETUP_ROLES`, gated on predictor `marking_complete_at IS NOT NULL` AND computable; lib runs ONCE, output frozen. **Regeneration supersedes** (new row + prior `superseded_at`; state derived, no status enum). **Parent-ack in INCR-17 = SCHOOL-CAPTURED** (HoA records the ack; the parent-facing signing UI is INCR-19). **PDF = reuse #136 trio** (`lib/pdf/readiness-statement-document.tsx` + `render-readiness-statement.tsx` + `app/api/senior/readiness-statement/[id]/route.ts`, `runtime="nodejs"`, RLS-scoped, `renderToBuffer`, on-demand render — NO new dep, NO files table, re-render from the frozen snapshot). **Parent-ack SMS = OWNER-GATED console-degrade** via existing `sendSms()` (same Hubtel gate as boarding — NEVER provision creds; console-OTP or IN_PERSON keeps it testable).

**AC (Quinn):** AC1 Y.Aidoo→10 (cores {IntSci,Math,Eng} drop Social, electives {Bio,Chem,Phys} drop ElecMath) · AC2 six-A1=6, six-F9=54, D7–F9 summed · AC3 six-F9→agg 54/credit 0 (isCredit≠aggregate filter) · AC4 OPTIONAL pools with electives · AC5 (points asc,name asc) deterministic tie-break · AC6 <3 either pool→not-computable, generation blocked · AC7 predictor `effectiveGrade` only, Mock1 never feeds agg · AC8 **medical HOLD** — exempted-live-paper candidate = identical agg, no sitting-table read · AC9 derived/no-trigger/no-drift, `projected_aggregate` NULL live path · AC10 SC-form CRUD+states, `UNIQUE(school_id,candidate_id,sc_form)` · AC11 SC authz `WASSCE_SETUP_ROLES` (teacher rejected), composite FK · AC12 statement freezes agg/band/snapshot, later moderation doesn't change it · AC13 generation gate (marking_complete_at + computable), `mock_2_id` set · AC14 regen supersedes (new row + `superseded_at`, derived state) · AC15 parent-ack method/at/phone/concerns, SMS **console-degrades** (no creds read) · AC16 PDF via #136 (no new dep, university block omitted) · AC17 **no university leak** (no universities/targets/cut-off/tier, `target_universities_json` NULL) · AC18 no `wassce_results` read/write · AC19 tenant isolation (both tables FORCE, composite FKs, prod-paste-0053) · AC20 Dex NIT-1 done (`mock-data.ts:388,393`→`isDistinction`/`isCredit`).

**Lucy map + gaps (`docs/senior/wassce-readiness-surface-map.md`):** §5 aggregate visualizer (crown jewel — dropped subject `opacity-45`, never filtered), §1/§3/§4 projection display (Mock1-agg `14` derive-on-read into `projection_snapshot_json`, NOT a stored column; §4 30-cell ledger grid = `senior_score_ledger` contextual read, INCR-20), §7 readiness+parent-ack. **NO clean binding (static/deferred):** SC banner Sickbay/clinician/NHIS fields (4.4 unbuilt, no auto-suggest), bespoke banner/pill colours (`#8B3829`/`#F5D4C9`/drifted Science green — inline, no slash-opacity). **University match (§6 + setup §3) correctly deferred to 17b** — flagged where it bleeds (the §5 "cut-off 11" line + parent-ack "KNUST Biochemistry" target lines omit, not placeholder). **Write-actions:** File SC-form, Generate readiness statement (+PDF), record parent-ack. **Portability:** projection pure lib (no trigger), composite tenant FKs (actor stamps SET NULL), PDF reuse, prod-paste-0053, parent-ack SMS console-degrade. **Carry:** Dex NIT-1 folded in; INCR-18 items (registration write-check, oversight-via-moderation, R5 name-match→FK) stay INCR-18 — though the projection loader's `wassce_candidate_subject` join naturally filters to registered subjects (free partial mitigation).

### INCR-17 · Build + gate outcomes (PR #161 — awaiting owner merge)
- **Commits:** Wells schema/migration `974e270` + Claude Code impl `c785d7c` (15 files). **Files:** `lib/wassce/projection.ts` (+`.test.ts`, the crown jewel), `lib/actions/wassce-readiness.ts` (generate + supersede + SC-form + parent-ack), `lib/wassce/{readiness-data,readiness-view}.ts`, `app/(app)/senior/wassce/candidates/[index]/page.tsx`, `components/senior/wassce-{aggregate-visualizer,readiness-panel}.tsx`, `lib/pdf/{readiness-statement-document,render-readiness-statement}.tsx`, `app/api/senior/readiness-statement/[id]/route.ts`, `db/schema/wassce.ts` (0053: 2 tables), `db/sql/prod-paste-0053-wassce-readiness.sql`, `db/seed/wassce-readiness.ts`, cleanups in `lib/wassce/{setup-data,mock-data}.ts`.
- **Gates ALL GREEN:** Quinn **GREEN** (projection 44 assertions + **real-DB agg=10**; frozen snapshot + single-current verified in DB; SC-form/parent-ack/PDF pass; 358 tests). Dex **APPROVE** (pure lib, structural medical-hold — `projectAggregate` takes no sitting/paper arg; no new dep; composite FKs; server/client seam build-verified). Sarah **CLEAR-TO-MERGE** (both tables fail-closed; PDF route 403-gates + `withSchool` RLS → **no IDOR** (foreign statement id 404s); medical notes/parent phone kept out of audit rows; SMS console-degrades; seed school-scoped).
- **⚠️ PROD DEPLOY:** hand-paste `db/sql/prod-paste-0053-wassce-readiness.sql` (FORCE+`tenant_isolation` for both new tenant tables). `db:policies` is dev-only.
- **PDF-500 RESOLVED (Dex reproduced live):** the readiness PDF route AND the shipped #136 receipt route throw the **identical** React #31 (duplicate-React signature) in the local `next dev` — a pre-existing `@react-pdf`+Next dev quirk, NOT an INCR-17 regression. Receipts render in prod → the 1:1-mirror readiness route is production-safe; both render valid `%PDF` in a clean harness. Ship.
- **🟠 CARRY INTO INCR-17b (fold into 0054, which already touches `readiness_statements`):** (1) **Dex MEDIUM** — upgrade `readiness_statements_current_idx` to a **partial UNIQUE** `(school_id, candidate_id) WHERE superseded_at IS NULL` (Wells's one-liner). The supersede-then-insert app-order is correct, but under two concurrent same-candidate generations (READ COMMITTED) each misses the other's uncommitted insert → two "current" rows; the unique turns it into a benign unique-violation the existing try/catch degrades. Wanted before real multi-user load, not this merge. (2) **Dex NIT** — align the current-statement read (`readiness-data.ts:~383`) to `.where(and(…, isNull(supersededAt))).limit(1)` (currently `limit(5)` reads `[0]` with no `superseded_at` predicate, so the partial index can't serve it). (3) INCR-18 carry (registration write-check, oversight-via-moderation, R5 name-match→FK) unchanged. (4) Owner note: pure best-3 aggregate is spec/surface-accurate; the Ghana admission rule (English+Core-Maths mandatory) diverges only when one is a candidate's worst core (not in demo) — decide at 17b where cut-offs make it load-bearing.

## Next increment — INCR-17b · University targets + match · migration 0054 (closes the INCR-17 split)

Owner decision (made): cut-off data = **seeded published snapshot** as global reference (labeled `cut_off_reference_year`, updatable per cycle like the benchmark figure) — no external feed, no per-school entry. Surfaces: student-readiness **§6** (match tiles) + setup **§3** (targets config). Lucy map: `docs/senior/wassce-university-surface-map.md`.

### INCR-17b · Kofi rulings + AC (2026-07-19)
**🔑 KEY INSIGHT:** the §6 headline candidate aggregate (`10`) is the SAME number in every tile; **TARGET is NOT a computed band — it's the PRIMARY-CHOICE overlay.** The 4 *computed* bands are SAFETY/COMFORTABLE/MATCH/STRETCH; a FIRST_CHOICE target always renders **TARGET** regardless of its computed band. This reproduces the §6 header "1 target · 1 comfortable · 2 stretch · 1 safety" exactly and explains why NO tile shows MATCH (the only δ+1 programme is the primary → TARGET).
**New tables (0054):** `universities` (**GLOBAL**, bare ENABLE RLS), `university_programmes` (**GLOBAL**, bare ENABLE RLS), `university_targets` (**TENANT**, FORCE RLS). Enums: **`university_type`** (PUBLIC_UNIVERSITY/PRIVATE_UNIVERSITY/TECHNICAL_UNIVERSITY/POLYTECHNIC/NURSING_COLLEGE/EDUCATION_COLLEGE), **`target_rank`** (**AMENDED to** FIRST_CHOICE/SECOND_CHOICE/THIRD_CHOICE — the stretch/match/safety words are the *computed* band, so storing them too = two sources of truth; nullable). **NO `match_tier` enum** — the 5-tier band is a DERIVED lib label.
- **R1 tables/tenancy:** `universities` (global: name, short_name, `university_type`, location, region) — single-col FKs only. `university_programmes` (global: single-col FK→universities RESTRICT, name, qualification, duration_years, `current_cut_off` smallint CHECK 6..54, `cut_off_reference_year` NOT NULL, `cut_off_history_json`, `prerequisite_subjects_json`) — **seed-only in 17b, no update UI** (dropped BUILD_STACK `updated_*`/`public_or_private`/`accreditation_status` — YAGNI). `university_targets` (tenant: **composite `(school_id,candidate_id)`→wassce_candidates**, single-col `university_programme_id`→programmes RESTRICT, `target_rank` nullable, `tagged_by_user_id` SET NULL, `parent_acknowledged_at` [column now, no writer], notes) · `UNIQUE(school_id,candidate_id,university_programme_id)` · **partial `UNIQUE(school_id,candidate_id,target_rank) WHERE target_rank IS NOT NULL`** (one FIRST/SECOND/THIRD per candidate).
- **R2 match function (pure lib `lib/wassce/university-match.ts`, no trigger, derived-on-read, NOT stored):** `δ = cutOff − projected` (lower agg = stronger; cutOff = worst admitted). `matchBand`: δ≥+4 SAFETY · δ≥+2 COMFORTABLE · δ≥−1 MATCH · else STRETCH (total, non-overlapping). `matchTier(proj,cut,isPrimary) = isPrimary ? "TARGET" : matchBand`; `isPrimary = target_rank==="FIRST_CHOICE"`. `matchMargin` → {inside/outside/on, |δ|}. Only called when `projectAggregate` is computable (else "projection pending", no bands). Legend copy overlaps (editorial) — **tile values are ground truth**.
- **R3 AGGREGATE — DECIDED: single pure best-3** (no admission-accurate variant). §5 and §6 show ONE number; Y. Aidoo identical under both rules; projection is advisory not WAEC-authoritative. The English+Core-Maths admission concern is folded into **prerequisites** (R6), not a 2nd aggregate. `ponytail:` residual bias (weak-but-credit English/Maths as worst core = slightly optimistic) bounded by the credit-prereq check. **OWNER-CONFIRM non-blocking** — recommend defer the `admissionAggregate()` variant to v2.
- **R4 `target_universities_json` freeze:** the §6 board is LIVE/derive-on-read; the statement's `target_universities_json` is FROZEN only at statement (re)generation (mirrors INCR-17 `projection_snapshot_json`). Target CRUD writes `university_targets` ONLY — never supersedes/regenerates a statement. Generation snapshots current live targets + computed match; regeneration supersedes + re-snapshots; a no-target generation writes `[]` (vs legacy INCR-17 NULL). Frozen element: `{universityName,shortName,universityType,programmeName,qualification,location,cutOff,cutOffReferenceYear,targetRank,isPrimary,projectedAggregate,matchBand,displayTier,margin,prerequisites}`.
- **R5 per-target parent-ack:** column authored now, **write-flow DEFERRED to INCR-19** — the §7 ack is ONE bundled statement-level ack (INCR-17's `readiness_statements.parent_acknowledged_at`), not per-programme.
- **R6 prerequisites — modeled + CHECKED (not display-only):** `university_programmes.prerequisite_subjects_json` = `[{subject,minGrade}|{anyOf:[…],minGrade}]` (grounds "Physics OR Elec Math"). `checkPrerequisites(rules, effectiveGrades, registered)` (pure lib) → {met, unmet[], pending[]}: satisfied = registered via `wassce_candidate_subject` AND predictor `effectiveGrade` credit ≥ minGrade; `pending` = registered/no grade; `unmet` = below-credit or not-registered. **Universal seed baseline: every programme requires English ≥ C6 + Core Maths ≥ C6** (encodes the admission concern in DATA). `ponytail:` subject name-match seam (same as INCR-16 FORWARD-1) — upgrade to a per-school alias/FK if vocabularies drift; flag, don't build.
- **Portability:** match+prereq = pure lib (no trigger); universities/programmes GLOBAL (bare ENABLE RLS, GLOBAL block of policies.sql + prod-paste-0054, seed-only); `university_targets` TENANT (FORCE, prod-paste-0054 hand-paste); composite tenant FK on targets, single-col to global programme + SET NULL actor. **Kofi owns the BUILD_STACK sync** (target_rank values, the column trims, "band is derived") once 0054 lands.

**AC (Quinn):** AC1 `matchBand(10,·)`=SAFETY@14/COMFORTABLE@12/MATCH@11/STRETCH@8/STRETCH@6 · AC2 `matchTier(10,11,primary)`=TARGET, `(…,false)`=MATCH · AC3 boundaries total/non-overlapping (δ +4→SAFETY,+3→COMF,+2→COMF,+1→MATCH,0→MATCH,−1→MATCH,−2→STRETCH) · AC4 tally reproduces §6 header (1 primary + 4 computed, NO MATCH tile) · AC5 margins 1in/2in/2out/4out/4in · AC6 not-computable → "projection pending", no bands · AC7 §6 "You·N" == §5 headline (single aggregate; Y. Aidoo 10) · AC8 universities/programmes GLOBAL bare-ENABLE (no FORCE/no school_id, Data-API-denied) · AC9 `university_targets` TENANT fail-closed, composite-FK cross-tenant impossible · AC10 FKs composite→candidates + single-col RESTRICT→programmes · AC11 target CRUD gated `WASSCE_SETUP_ROLES` (teacher rejected; universities/programmes read-only to schools) · AC12 dup-programme + 2nd-FIRST_CHOICE rejected, NULL-rank multiple allowed · AC13 target edit does NOT create/supersede a statement · AC14 generation snapshots targets+match into `target_universities_json`, regen supersedes+re-snapshots, no-target→`[]` · AC15 frozen json unchanged by later cut-off/target edits (live board reflects them) · AC16 `checkPrerequisites` met/unmet/pending (Y. Aidoo KNUST Biochem met) · AC17 every seed prereq includes Eng≥C6 + Maths≥C6, OR-groups satisfied by either · AC18 seed the 5 §6 programmes exact (KNUST Biochem 11(2025), Legon Biochem 12, KNUST Pharmacy 8, Legon Medicine 6, UCC Biochem 14) + history json · AC19 NO projection regression (Y. Aidoo=10, drop Social+ElecMath, medical-hold structural, no sitting read) · AC20 readiness PDF now includes the university block from frozen json (academic block unchanged, no new dep) · **AC21 (Dex MEDIUM) `readiness_statements_current_idx` → partial UNIQUE** `(school_id,candidate_id) WHERE superseded_at IS NULL` (concurrent gen → 1 current row, 2nd degrades via try/catch) · **AC22 (Dex NIT)** current-statement read = `.where(and(…, isNull(supersededAt))).limit(1)`.

**Lucy map (`docs/senior/wassce-university-surface-map.md`):** §6 = 5 match tiles (5-tier badges: TARGET gold-bg/navy · COMFORTABLE green-bg/green · MATCH green-bg/bespoke #1E5A35 [**no demo tile — build+test the unexercised state**] · STRETCH warn-bg/warn · SAFETY bespoke blue-grey #E5EAF2/navy-2 — all solid, no slash-opacity) + "+Add programme" empty tile; setup §3 = tier-band strip + 12-row cut-off table. **Honesty:** every cut-off renders `(reference_year)`; label "updated annually"/"Trend stable 3 yrs"/"Median cut-off" as SNAPSHOT (single-year data can't back a live trend — history_json backs the 3-yr only). **Re-derive** §6 marker/bar %s from one linear 6→54 scale (surface's are hand-tuned/inconsistent). **Write-actions:** set/tag target, rank target, remove/edit (all `WASSCE_SETUP_ROLES`); "Run match·all" is a READ/refresh (tier derived). No new role (surface's "Dean of Students" doesn't exist in `appRoleEnum` — reuse WASSCE_SETUP_ROLES).

### INCR-17b · Build + gate outcomes (PR #163 — awaiting owner merge)
- **Commits:** Wells schema/migration `a295033` + Claude Code impl `294a4cf` + gate fixes `66ea2a8`. **Files:** `lib/wassce/university-match.ts` (+`.test.ts`, pure lib), `lib/actions/wassce-university.ts` (target CRUD), `lib/actions/wassce-readiness.ts` (generation now freezes targets), `lib/wassce/{readiness-data,readiness-view,setup-data}.ts`, `app/(app)/senior/wassce/{candidates/[index],setup}/page.tsx`, `components/senior/wassce-target-panel.tsx`, `lib/pdf/readiness-statement-document.tsx` (university block), `db/schema/wassce.ts` (0054: 3 tables), `db/sql/prod-paste-0054-wassce-university.sql`, `db/seed/wassce-university.ts`, `scripts/verify-wassce-university.ts`, **+ 2 shared-infra fixes: `lib/db/rls.ts`, `tailwind.config.ts`**.
- **Gates ALL GREEN:** Quinn **GREEN** (383 tests + 25 match assertions; swept **ALL 2401 (projected,cutOff) pairs** over 6..54 vs an independent predicate — **0 deviations**; AC6 proved by construction w/ throwing getters; AC19 = zero-byte diff on `projection.ts`; tenancy vs a throwaway 2nd tenant as the non-superuser role). Dex **APPROVE** (reproduced the Drizzle wrapping through the real driver; cyclic-`cause` safe, depth-cap 5 vs real depth 1; no Drizzle private-API coupling; Tailwind fix verified in built CSS). Sarah **CLEAR-TO-MERGE** (attacker-side IDOR read/UPDATE/DELETE/forged-INSERT as the non-superuser role → 0 rows / rejected; RLS split verified in `pg_class`/`pg_policy`; globals hold zero tenant PII; `pgError` classifies without exposing Postgres text; seed double-scoped).
- **⚠️ PROD DEPLOY:** hand-paste `db/sql/prod-paste-0054-wassce-university.sql`. Its duplicate-current-statement pre-check is now **SELF-ENFORCING** (a `DO` block that RAISEs *before* the `DROP INDEX`, so a failed AC21 upgrade can never leave `readiness_statements` index-less) — both paths verified on dev (0-dup passes; injected dup aborts).
- **2 shared-infra bugs fixed (both silent under `next build`, found only by live preview):** (1) **`lib/db/rls.ts`** — Drizzle wraps driver errors with the `PostgresError` on `.cause`, so EVERY `err.code === "23505"` check in the repo **always missed**; added `pgError()`/`isUniqueViolation()` walking the cause chain (structural duck-typing, no `instanceof` → degrades gracefully if Drizzle adds OR drops a layer). (2) **`tailwind.config.ts`** — `lib/**` was unscanned so arbitrary colours declared in lib were never emitted (SAFETY/MATCH badges colourless); additive-only, and it also repairs an INCR-15 roster avatar tint that had **never** been emitted since `889fb73`.
- **Gate fixes applied before PR (`66ea2a8`):** self-enforcing prod-paste pre-check (Dex F5); corrected the `wassce-readiness.ts` comment that still claimed the current index is non-unique (AC21 made it UNIQUE — it contradicted the schema's own "structural backstop", Dex D1/Quinn MINOR-1); corrected the PDF route comment claiming the university block is omitted (AC20 renders it — Sarah nit).
- **🔴 QUEUED FOLLOW-UP — repo-wide 23505 retrofit (NEXT increment, must land AFTER #163 since the helper ships here):** the same Drizzle wrapping leaves **6 pre-existing call sites dead**. Ranked by real consequence (Dex): (1) **`lib/actions/boarding-exeat.ts:234` — WORST**, the broken check sits inside a ref-code-collision **retry loop**, so the retry is dead code and exeat creation hard-throws on any collision; (2) **`lib/actions/boarding.ts:180`** — a lost bunk race **throws** instead of returning "bunk just taken" (defeats the behaviour its own comment documents); (3) `boarding-config.ts:236,299,412,470` + `whatsapp-templates.ts` + `onboarding.ts` — cosmetic (friendly message → generic). ~8 one-line swaps to `isUniqueViolation`; **worklist = `grep -rn '=== "23505"'`**. Sites 1–2 are live user-facing defects already on main.
- **🟠 Deferred (forward-looking, non-blocking):** `programmeOptions`/`loadCandidateReadiness` loads the ENTIRE global programme catalogue unbounded per candidate-page render (16 rows today; needs limit/typeahead once a real Ghana catalogue is seeded — Dex F4/Quinn MINOR-4); `setup-data.ts medianCutOffLabel` stamps a cross-programme median with the FIRST programme's reference year (correct today — all 16 are 2025 — misstates when years diverge, Quinn MINOR-3); `pgError` return type asymmetry + a `constraint_name` is-postgres.js-specific comment (Dex F2/F3); the generate action's bare catch doesn't use `isUniqueViolation` (Dex F1, degrades safely); `scripts/verify-wassce-university.ts` isn't idempotent w.r.t. `readiness_statements` (grows the table per run — Quinn MINOR-5); §3 "Other (private/vocational/abroad)" bucket not built (loader bucket, not a row). **Manual check before ship (Quinn limitation):** no browser-driving tool available — click "Tag programme"/"Remove" once in a real browser; the write path is verified at the action boundary + real 23505 dispatch.

## ✅ MERGED (PR #164, `54e2b1f`+`fb139ec`) — repo-wide 23505 retrofit · no schema, no prod-paste
The queued retrofit is **DONE** (it is no longer pending — Kofi's INCR-18 note to "fold it in" predates the merge). Probing a real duplicate insert proved Drizzle wraps every driver failure: thrown `.code` is `undefined` and thrown `.message` is only `"Failed query: …"`, while the real `PostgresError` (`code`, `constraint_name`) hangs off `.cause`. So BOTH idioms in the repo were dead: `(err as {code?}).code === "23505"` AND `String(err.message).includes("duplicate key")`. All 8 sites revived. Two were live user-facing defects: `boarding-exeat.ts` (the check guards a ref-code **retry loop** → retry was dead code, exeat creation hard-threw on any collision) and `boarding.ts` (a lost bunk race **threw** instead of returning "just taken"). Extracted the classifier to a PURE `lib/db/pg-error.ts` (re-exported from `rls.ts`, zero call-site import changes) + **8 regression tests** pinning the real wrapper shape — this class is invisible to build/typecheck/lint. Post-review (Quinn): the whatsapp constraint is `uniq_whatsapp_template_name_per_school` (the old code matched by SUBSTRING; `===` silently killed that branch), and the bare `|| code === "23505"` fallback was dropped from `onboarding.ts` (that tx also creates classes/subjects/roles/fees, so an unrelated dupe was reported as a GES-code clash). Every constraint literal in `lib/` swept against `pg_constraint` + `pg_indexes` — all present (`uniq_student_current_bunk`, `uniq_university_target_rank` are partial unique INDEXES, which postgres.js still reports via `constraint_name`). Also shipped `docs/OWNER-TODO.md` (owner-assigned pre-go-live actions).

## Next increment — INCR-18 · Cohort-readiness (HoA) · **NO migration** (read/aggregate + one write)

Surface: `wassce-cohort-readiness` (full). Lucy map: `docs/senior/wassce-cohort-surface-map.md`. The first surface reading the WHOLE module + the **moderation write flow** INCR-16 R3 deferred here.

### INCR-18 · Kofi rulings + AC (2026-07-20)
**⚠️ LOAD-BEARING (Kofi + Lucy independently):** the surface has **NO moderation UI** — `grep -i moderat` → **0 hits** across all 1136 lines. Lucy found orphaned CSS (`.save-bar`, `.hm-row-total`, both defined-never-used) proving the write section was **cut from a larger draft**. The flow is grounded only in BUILD_STACK **Decision 10** + INCR-16 R3. **Do NOT invent a panel:** put the affordance on the **existing INCR-16 mark-entry grid** (`/senior/wassce/subject`, `components/senior/wassce-mock-entry-grid.tsx`), with the cohort heatmap row linking into that grid filtered to the subject — literally Decision 10's flow (distribution → escalate → moderate). This surface gets a **read-only trail card**. **The original-vs-moderated treatment ALREADY SHIPS** (`wassce-mock-entry-grid.tsx:145,154-163`): moderated chip + `MOD` badge over the dim original, teacher `<select>` suppressed when moderated — **reuse verbatim**. (Its header comment says "struck through" but the code renders `dim` — code is truth; docs nit.) **Any NEW moderation copy is `NEW COPY` (not from the surface) and needs owner sign-off.**
- **R1 moderation:** role = **`WASSCE_SETUP_ROLES`** (ADMIN/HEADMASTER/VICE_HEADMASTER_ACADEMIC) — **ORCHESTRATOR RESOLUTION of a Kofi↔Lucy conflict** (Lucy proposed VHA-only): Kofi's rationale wins because that set can ALREADY overwrite `grade` today, so routing them into moderation strictly **reduces** privilege; HEADMASTER is who the HoA escalates to; ADMIN stays attributable via `moderator_user_id` + audit `actorRole`. TEACHER/FORM_MASTER may NEVER moderate — **including their own subject** (Decision 10 exists to check self-marking from outside). Action sets EXACTLY 4 cols (`moderated_grade`, `moderator_user_id`, `moderated_at`, `moderation_reason`); NEVER `grade`/`marked_*`/`raw_score`/`max_score`. **`moderation_reason` MANDATORY** (trimmed 5–500). **Reversible:** a clear NULLs all 4 (history lives in append-only `audit_log`, never a half-populated row); clear also needs a reason; clearing an un-moderated row is rejected; not restricted to the original moderator. **NOT blocked by `marking_complete_at`** — it is precisely the write that survives it (Decision 10 cross-checks the *distribution*, only meaningful once marking is done); teacher `saveMockResult` stays locked (INCR-16 AC5 unchanged). Not gated by `setup_frozen_at`.
- **R1.6 statements:** a moderation moves the LIVE derived aggregate but must NOT touch `readiness_statements` (INCR-17 AC12, structurally guaranteed). HoA sees a **derived-on-read STALE badge** — current statement (`superseded_at IS NULL`) whose frozen `projected_aggregate` ≠ live, or whose live projection is no longer computable. **No stored `is_stale`, no auto-regenerate, no auto-supersede**; remedy is the existing INCR-17 regenerate→supersede. Superseded rows never badged.
- **🔴 R2 CARRY-IN (Sarah) — oversight routes through moderation.** `saveMockResult` order: `isAssigned` (even if the actor also holds an oversight role) → writes `grade` as today; `isOversight` only + row **EXISTS** → **REJECTED** ("already has a teacher mark — use Moderate"); `isOversight` only + **no row** + marking open → **allowed**, creates with `marked_by_user_id = actor` (honest — the surface itself names the case: French has no L1 teacher); `isOversight` only + no row + marking closed → rejected (creation IS marking). A teacher grade is thus **immutable to everyone but its own teacher**, and every oversight change leaves a trail.
- **🔴 R3 CARRY-IN (Quinn) — registration check on BOTH writes:** verify a `wassce_candidate_subject` row exists for `(school_id, candidate_id, subject_id)` else reject. INCR-18 is the first surface where the hole has a consequence (the heatmap GROUP BYs `mock_results`). Every INCR-18 cohort loader ALSO inner-joins `wassce_candidate_subject` (defence in depth). Served by the existing UNIQUE — no new index.
- **R4 metrics — honesty corrections (INCR-15 precedent: derive or omit, never fake):** (a) "Sitting today 239/240" → **nothing records attendance**; render **"Expected in centre today"** = sittings for papers scheduled today − `exempted_at IS NOT NULL`, sub-line "N exempted"; no paper today → next paper date. Banner may render Day-N + clock windows (derived) but **may NOT claim** "in centre"/"underway"/"no other anomalies". (b) "Credit-pass rate 94%" — label and sub-line disagree; **the sub-line is the definition** → **"All-credit candidates"** = every graded predictor result `isCredit` ÷ candidates with ≥1 graded result, numerator/denominator both rendered (per-*result* `creditRate` belongs in the heatmap footer). (c) "No tertiary path 4" → **"No target tagged"** (the surface's own filter strip says so; the system knows tagging, not paths). (d) median/mean over **computable projections only**, tile states N. (e) **BUILD a marking-progress tile** (graded ⋈ registration vs expected + `marking_complete_at`). (f) Histogram = **19 bins** 6–24 + one terminal "25+" (the surface has TWO overlapping terminals "25+" and "28+" — incoherent; one terminal); bins sum to computable N. (g) **❌ OMIT the regional/national comparison** (Western median 20 / national 17 / tier-share) — `benchmark_metric` ships only CREDIT_RATE/DISTINCTION_RATE and `benchmark_reference.subject_name` is NOT NULL so no school-wide row is representable; inventing it = the false precision Decision 14 refuses. Migration explicitly **declined**.
- **R4b tier vocabulary — ORCHESTRATOR RESOLUTION (Kofi↔Lucy):** use the **already-shipped `TARGET_TIER_BANDS`** (`lib/wassce/university-match.ts:331`, Tier 1 6–12 / 2 13–18 / 3 19–24 / 4 25+ — already consumed by `setup-data.ts`), NOT a new `cohortTier()` derived from `AGGREGATE_BANDS`. Verified both tables ship and are **different axes**: `AGGREGATE_BANDS` (projection.ts) is the readiness-statement band LABEL; `TARGET_TIER_BANDS` is the 4-tier cohort distribution and matches the surface exactly. Reusing it honours Kofi's own "never a second band table" principle.
- **R5 heatmap — 🔑 the colour is the GRADE COLUMN, not the count.** Cell = subject × grade (9 cols A1…F9); every row carries `g1…g9` in fixed column order regardless of counts (Social Studies `g9=0` still terra) — a fixed green→terra ramp encoding pass-band intuition. **There is NO data-driven heat threshold and no band tints — all nine fills solid hex, zero alpha.** **Do NOT use `HEAT_COLORS`** (INCR-16's count-driven 6-step scale — a category error); use Palette-A `GRADE_COLORS` (drifts from the surface on 5/9 columns — Lucy documented the table so the call is reversible). Rows = every `wassce_subjects` with ≥1 registered candidate (**derive, don't hard-code 15 — the surface OMITS every Home Ec elective, 40 students in no row**), CORE first then ELECTIVE/OPTIONAL, alphabetical within. Counts use the **effective** grade via the shipped `gradeDistribution`/`creditRate`. Tags derived: **CONCERN ≥30%**, **WATCH 15–29.9%**, none <15, **none when graded <5**. **⚠️ Arithmetic audit (Lucy):** the Elective-Math card states `(33%)` where the true share is **40.7%**, and claims "largest below-credit concentration" when Core Maths has 44 vs its 35 (true only as a *share*) — **compute both, do not port the numbers**.
- **R6 at-risk (pure lib, no hidden logic):** `atRisk = reasons.length > 0`, union of five named reasons in fixed order — `PROJECTION_NOT_COMPUTABLE` · `NO_TARGET_TAGGED` · `ABOVE_LOWEST_CUTOFF` (`gap > 0`) · `UNMET_PREREQUISITE` (**lowest target only**; `pending` never fires) · `OPEN_SC12` (**SC-3/SC-7 never fire** — granted accommodations, not disruptions; COMPLETED/REJECTED don't fire). **"Lowest target" = `MAX(cut_off)`** — the least-ambitious/safety school, NOT the smallest numeral (a wording trap that would invert the list). **`gap = projected − lowestCutOff` is the NEGATIVE of the shipped `matchMargin` δ — reuse `matchMargin` and flip the label, do NOT add a second sign convention** (Lucy). Deterministic sort: null-gap first, then gap desc, then name asc (the surface's order is hand-arranged — minor adjudicated deviation). Y. Aidoo (agg 10, cut-off 11, −1 *inside*) is at-risk **solely** via `OPEN_SC12` — the case that proves the rule widens beyond academics. **❌ OMIT the case-management columns** (`Last action`, `Next`, the Dean cadence card 9/11/4, "Mother declined Dean call", the `Followup pending` filter) — `grep interview|worklist|followup` over `db/schema` → **0 hits**; that's a workflow entity, not a display field. Log "WASSCE at-risk case-management log" to the senior backlog. Keep only filter pills that map to derived reasons.
- **R7 house:** build house × **TIER** (what the cards render: median, 4 tier counts, at-risk), NOT house×programme (§1 already cuts by programme). Pure aggregate `wassce_candidates ⋈ students.house_id ⋈ house` (HM via `house.hm_user_id`). **A candidate with NO house is BUCKETED, never omitted** — explicit "No house · day candidates" card so cards sum to cohort N (the demo school is 720 boarders + 480 day; silently dropping day candidates would understate every at-risk and tier count). Replace the live "sitting today 60/60" rows with the derivable **open-SC-12 count** per house.
- **R8 authz:** page gated **`WASSCE_SETUP_ROLES`** server-side **before any PII read**. A `TEACHER` — **including one with a live `senior_subject_teacher` assignment** — gets a hard **403/redirect, NOT a filtered view** (INCR-16 R5 scopes teachers per-subject; whole-cohort is HoA-only). FORM_MASTER/HOUSEMASTER/DEAN_OF_BOARDING/STUDENT/PARENT denied; sidebar hidden. **Do NOT use `SENIOR_LEDGER_ROLES` — it includes TEACHER** (Lucy). Every loader inside `withSchool`.
- **R9 Dex FORWARD-1 (name-match → FK): STAYS DEFERRED.** INCR-18 adds no vocabulary editing AND never joins the two vocabularies — the heatmap/metrics group by `wassce_subjects` alone and the HoA gate is role-based, so `resolveAuthorizedWassceSubjectIds` is never called on any INCR-18 read path. **INCR-18 keeps its planned shape: no migration, no schema change.**
- **MIGRATION 0055 — NOT NEEDED, explicitly declined.** Kofi tabulated the serving index for every INCR-18 query (`mock_results_mock_subject_idx`, `uniq_wassce_candidate_subject`, `wassce_candidates_cohort_idx`, `readiness_statements_current_idx`, `wassce_paper_sittings_paper_idx`, students PK). Scale ≈240 candidates × ~8 subjects ≈ 1,900 rows, one batched pass. **No new table ⇒ no prod-paste-0055, no RLS change.**
- **Pure lib `lib/wassce/cohort.ts`** (no DB import): `cohortTier` (from TARGET_TIER_BANDS), `aggregateHistogram`, `medianAggregate`, `meanAggregate`, `assessCandidateRisk` → `{atRisk, reasons[], lowestCutOff, gap, sortKey}`, `subjectHeatTag`, `cohortSummary`. Server loader `cohort-data.ts` widens the existing `computeCohortAggregates` (`readiness-data.ts:410`) to return `Map<string, ProjectionResult>` — **do NOT write a second cohort projection query**. **Do NOT read `readiness_statements` for cohort figures** (it's the frozen artifact — reading it would make the dashboard stale the instant a grade is moderated); read it ONLY for the stale badge.

**AC (Quinn):** AC1 moderation writes exactly 4 cols, `grade`/`marked_*`/`raw_score` byte-unchanged, one audit row · AC2 role set correct, TEACHER rejected **even on own subject**, cross-tenant not-found · AC3 empty/<5-char reason rejected, row unchanged · AC4 with `marking_complete_at` set: `saveMockResult` rejected AND `moderateMockResult` succeeds; also succeeds on a frozen cohort · AC5 clear NULLs all 4, effective reverts, audited with its own reason, CHECK never violable (prove a half-populated write fails), clearing un-moderated rejected · AC6 moderation moves the LIVE aggregate + heatmap cell + cohort median/tiers; `projected_aggregate` stays NULL, no trigger · AC7 issued statement byte-unchanged AND flagged stale; superseded never flagged; nothing auto-regenerates · AC8 oversight + existing row → rejected w/ hint, then moderate succeeds · AC9 oversight + no row + open → creates w/ `marked_by = actor`; closed → rejected · AC10 assigned+oversight actor writes `grade` normally (assignment wins) · AC11 crafted POST for an unregistered (candidate, subject) rejected by BOTH writes · AC12 every tile derives from rows (mutate one seeded grade → every dependent figure moves) · AC13 marking-progress tile · AC14 "expected in centre" derivation + no attendance claim · AC15 no regional/national comparison rendered or seeded · AC16 heatmap rows/order/effective-counts/tags; colour keyed to the grade COLUMN · AC17 `assessCandidateRisk` unit set incl. Y. Aidoo = at-risk via OPEN_SC12 only, SC-3/SC-7 never fire, unmet-vs-pending, deterministic sort · AC18 house cards sum to cohort N incl. an explicit No-house bucket · AC19 authz (TEACHER-with-assignment → 403, not filtered) · AC20 second school → zero rows through EVERY loader; moderation on another school's id → not-found · AC21 no `db/migrations/` file, no new `pgTable`, no trigger, `cohort.ts` DB-free, clean `pnpm build` · AC22 nothing rendered the data can't support (case-management, cadence card, regional comparison, attendance claims **absent, not placeholdered**).

### INCR-18 · Build + gate outcomes (PR #166 — awaiting owner merge)
- **Commits:** Claude Code `1e15507` + gate fixes `61e9ce5`. **Zero `db/` changes** — the no-migration ruling HELD (Dex spot-checked Kofi's index claim query-by-query: no table scan at 240 × ~8 ≈ 1,920 rows).
- **Gates ALL GREEN:** Quinn **GREEN** (427 tests; **swept all 2,401 (projected,cutOff) pairs** — 0 deviations, `gap === −δ` on every pair; proved the moderation write against **live Postgres with md5 row hashes** — teacher columns byte-identical; half-populated write rejected by the CHECK; frozen/live split proven by moderating a **CORE** — all 4 statement rowhashes identical while the live histogram/mean/heatmap/credit all moved + stale badge fired). Dex **APPROVE**. Sarah **CLEAR-TO-MERGE** (no IDOR — cross-tenant id dies at the `schoolId` predicate with no existence oracle; SC read selects only `candidateId, scForm, status` so no medical detail leaks; `ModerationColumns` makes "exactly 4 columns" a **compile-time** fact).
- **NO prod-paste for INCR-18.** Outstanding hand-pastes remain 0051–0054, unchanged.
- **🔑 Subject-merge RATIFIED (Dex definitive):** `wassce_subjects` is UNIQUE per **programme**, so the heatmap rendered English Language 4× / Biology 2×. Rows merge by **name** (English 240, Biology 100). Sound because: (a) double-counting is unreachable — `wassce_candidate_subject` has **no application write path**, the seed is the sole writer and registers within-programme; Quinn confirmed `registrations == distinct_candidates` for every name and **zero** cross-programme registrations; (b) it does NOT re-introduce R9's seam — that is **cross-module** string matching between two independently-authored domains, this is **intra-table**, one column, one flow; (c) **decisive** — `projectAggregate` has keyed subjects by NAME since INCR-17, so the merge makes the heatmap **agree** with the identity model already in production (grouping by `subject_id` would have left it the only surface disagreeing with the aggregate engine); (d) no stronger key exists without a migration this increment forbids.
- **Gate fixes applied pre-PR (`61e9ce5`):** (1) **Sarah MINOR — TOCTOU**: the oversight-CREATE path read `before`, applied the reject, then upserted; under READ COMMITTED a teacher mark committing in between turned the create into a **silent overwrite of that teacher's grade**, losing the exact trail the R2 carry-in guarantees → now insert-or-nothing, "nothing" returns the same rejection. (2) **Dex-1** merged `subject_type` fell to `subjectRows[0].type` on an unordered query → Biology's badge flickered ELECTIVE/OPTIONAL between loads; explicit precedence CORE>ELECTIVE>OPTIONAL (no figure depends on it — `projectAggregate` pools both identically). (3) **Dex-2/Quinn MINOR-1** a merged row read "240 registered" but deep-linked to one copy showing ~60 → rows now state "opens 1 of N programme views". (4) **Dex-3** redundant `as PrerequisiteCheck` cast removed (would have masked a real error on type drift). (5) **Sarah NIT** free-text reason stored twice → once on `audit_log.reason`; also dropped the prior reason from `before` on the same reasoning (it lives on the prior moderation's own audit row).
- **Three omissions ADJUDICATED (Quinn):** C.8 vocabulary card **justified** (defines "Resolved", a status the system cannot enter once case-management was cut — exactly the AC22 failure mode). D.4 cross-module strip **justified and it OVERRIDES Lucy's map** — its Sickbay card asserts live wiring to unbuilt module 4.4 and the VLC card hard-codes a student's state that contradicts her real dev state; **AC22 outranks the map on conflict — logged here as a deliberate map deviation so it is not silently re-added.** C.9 no-targets guard **not an under-build** — the board ratified `atRisk = reasons.length > 0` with no guard and the implementer followed it; overturning needs a Kofi ruling, not a QA finding.
- **🟠 Deferred (forward-looking):** the merge rests on an invariant the schema does not enforce (`uniq_wassce_candidate_subject` is keyed on `subject_id`, not name) — zero occurrences today; when R9's `ledger_subject_id` lands, re-key the merge to it. When a registration UI is built, constrain the subject picker to the candidate's programme (that is the guard keeping this merge exact). Cohort-scoping the driving query at the index becomes worthwhile past ~3 archived cohorts.
- **🔴 RECOMMENDED NEXT INCREMENT — pre-existing privilege escalation in `lib/auth` (Sarah HIGH, NOT an INCR-18 defect):** `lib/auth/index.ts:185-196` builds `AppUser.roles` from **every** role assignment at **any** school, and `lib/auth/server.ts:64-71` picks the active school as an unordered `LIMIT 1`. So a user who is TEACHER at School A and ADMIN at School B carries `"ADMIN"` while operating at School A — passing `requireSchoolRole(WASSCE_SETUP_ROLES)` AND `assertAnyRole(...)` there, enough to read School A's whole-cohort PII dashboard and moderate School A grades. **NOT a cross-tenant leak** (RLS holds; the active school is not attacker-selectable) and `lib/auth/` is untouched by this diff — but it is the **ceiling on INCR-18's headline authz guarantee** and **every `requireSchoolRole`/`assertAnyRole` site repo-wide inherits it**. Fix in ONE place: scope roles to the active school (`rolesFor(schoolId)`, thread `school.id` into `assertAnyRole`). Record R8 as "hard-denied for single-school users" until it lands.

## 🔐 AUTH FIX (PR #167 — awaiting owner merge) · no schema, no migration, no prod-paste
Taken BEFORE INCR-19 at the owner's direction, closing the privilege escalation Sarah found gating INCR-18. **Three defects, one root cause — the role query constrained neither school nor time.** Proved against the DB with a synthetic multi-school user (rolled back), running the OLD query shape first as a negative control: old → active school **B** (arbitrary — unordered) with roles `[ADMIN@B, HEADMASTER@A(ended 2019-12-31), TEACHER@A]`; new → active **A**, roles `[TEACHER]`.
- **(1) cross-school union** → roles scoped to the active school. **(2) expired assignments still granted roles** (`end_date` documented "null = currently active"; nothing enforced it, so departed staff kept every permission). **(3) non-deterministic active school** — and `getActiveSchool` ran a SECOND independent unordered query, so it could resolve a different school than the roles came from.
- **Fixed at the SOURCE, not the ~129 `hasAnyRole`/`assertAnyRole`/`requireSchoolRole` sites across ~41 files.** Threading a school id through them makes the property a per-call-site obligation with 129 chances to forget — and the 130th starts at zero. `AppUser.roles` is now BY CONSTRUCTION only the active school's roles, so every existing AND future check inherits the correction. Dex verified the premise: `AppUser` has exactly **two** constructors, both in `lib/auth/index.ts`; the invariant is documented on the field itself where a future identity-path author (impersonation / service account / `getUserById`) will read it.
- **The time window is now testable.** It lived only in a drizzle WHERE clause no test could reach — mistyping `gte(endDate, today)` as `gt` would lock out every staff member whose assignment ends today and leave the suite green (Quinn MINOR-1). `isCurrentlyActive(start,end,today)` is now a pure predicate and the AUTHORITY (`scopeRolesToActiveSchool` re-applies it; SQL is a pre-filter). **Mutation-checked** — that exact typo fails 2 of the new tests.
- **Also fixed from the gate:** `getActiveSchool` now takes the already-resolved user (my original commit claimed the divergence was "structurally impossible" — it wasn't, so it was fixed rather than reworded); and **`AUTH_DEV_BYPASS` defaulted to `true`, i.e. the auth kill-switch FAILED OPEN** — absent/misspelled on prod, `authIsLive()` goes false even with Supabase configured, every request becomes `DEV_USER` with `["ADMIN"]` at a real school. Now `.default("false")`; every documented path sets it explicitly so only the forgot-it case changes, and that case must deny.
- **Gates ALL GREEN:** Sarah **CLEAR-TO-MERGE** (26/26 probe assertions; negative control on the old query). Quinn **GREEN** (all 5 dev users byte-identical before/after; 6/6 date boundaries; `getActiveSchool` JSON-identical shape; dev-bypass live-verified with HTTP 200s on every gated senior surface). Dex **APPROVE** (proved purity by BUNDLING `roles.ts` — 403 bytes, one input, zero runtime deps — noting the green suite alone was NOT proof since `lib/env.ts` never throws). 444 tests · typecheck · lint · clean build exit 0.
- **⚠️ DEPLOY:** any prod `role_assignment` row with a stale `end_date` **loses access the moment this ships** — correct, but it will look like an outage. Count first. Dev has zero, and no app path writes `end_date`, so the blast radius is hand-imported data only. Second note: the app computes `today` in UTC while Postgres writes `start_date` with the DB session TimeZone — fine on UTC/Accra, but a session east of UTC could briefly lock out a new starter.
- **INTENDED denial (a behaviour change, not a no-op):** a user whose assignments have ALL ended now gets no school and lands on `/start` instead of a working session. That is the bug being fixed; zero users affected on dev.
- **🟠 Follow-ups raised, deliberately NOT in the PR:** (a) **`role_assignment.scope_ref` is DEAD SCHEMA** — declared as scoping a role to programme/house/class, read by NOTHING; real narrowing happens via domain tables (`house.hm_user_id`, `senior_subject_teacher`), which is the better design. Risk is the INVERSE of unenforcement — someone will *read* it believing it's populated. Drop it or fix the comment (Wells). (b) **Three definitions of "active assignment" now coexist** — auth (correct), `isNull(end)` in `lib/reports/school-stats-data.ts:188`, `endDate === null` in `app/(app)/staff/[id]/page.tsx:182`, plus no window at all on the staff roster/dashboard headcount; visible symptom is a departed staffer listed while auth correctly grants them nothing. (c) A **school switcher** — active school is deterministic but not user-selectable; deliberate (security correction, not a feature), seam is `scopeRolesToActiveSchool(assignments, preferredSchoolId?)`. (d) `resolveActor` attributes audit rows to `roles[0]` — now deterministic but still arbitrary, not "most privileged".

**OWNER notes (non-blocking):** (1) a true "% projected to qualify" metric is **omitted** — the honest cohort signal is the all-credit tile; if wanted it must be the Ghana tertiary-entry rule (credits in Eng + Core Maths + Int Sci/Social + 3 electives) and is better placed on the post-release actuals path (`wassce_results`, deferred). (2) **📌 SCOPE GAP:** the surface's **"Live exam tracker"** page has **no increment anywhere in INCR-15→20** — flag to the owner as a missing planned surface; INCR-18 must NOT absorb it. (3) Part E moderation copy is NEW (not in any surface) → owner sign-off. (4) Kofi owns a BUILD_STACK sync post-merge (Decision 10 still names `*_staff_id` and omits `moderated_grade`/`moderation_reason`).

## 🔴 INCR-19 · Parent-tracker — RE-PLAN REQUIRED (board row was wrong on all 3 counts)

The board planned INCR-19 as *"none new; parent-scoped RLS policy (prod-paste); parent-facing capstone (read-only, one child)"*. **Not buildable as written.** Pence found one blocker; Kofi verified it and found three more; Lucy corroborated independently from the surface side. **No code written — awaiting owner steer on the claiming flow.**

### The five blockers
1. **No parent→student linkage exists anywhere.** `student_guardian` (`db/schema/students.ts:196`) is SMS-contact data only (`name`/`relationship`/`phone`/`email`/`is_primary`) — **no `user_id`**. `lib/actions/invites.ts` greps zero for `studentId|PARENT`; `invite.assignments` jsonb is *teacher* class grants. `PARENT` appears ONLY as an enum member, in `NON_STAFF_ROLE_CODES`, and in tests asserting it is DENIED — **the role has never granted anything.** INCR-19 would be the first surface a parent can reach.
2. **🔴 Per-user RLS does not exist (the biggest under-estimate).** `withSchool` (`lib/db/rls.ts:10-18`) sets exactly ONE GUC, `app.current_school`; every policy is generated as `school_id = current_setting('app.current_school')` (`policies.sql:149-153`). **RLS can see WHICH SCHOOL is asking, never WHICH USER.** So "parent-scoped RLS policy (prod-paste)" is not a paste — it is a change to the seam every tenant read passes through. Getting it backwards "either locks staff out of every table or opens every row" (Kofi).
3. **The surface's data spine is partly unbuilt.** §1 hero (Ward B bed 7, IV artesunate, Dr Nyarko, 14:30 ward round), the Hospital card and the NHIS card all read **Sickbay — module 4.4, NOT BUILT**. No sickbay table exists (the only `SICKBAY` in schema is a *prefect role*); `student_health_record` has no NHIS/ward/clinician. §4's phone-call events are unrepresentable — `inbox_message` is SMS/WhatsApp-only. **"Shipping a hardcoded hospital bed to a real mother is the worst failure available in this module."**
4. **🔴 BLOCKING surface gap (Lucy):** §3 step 3 **"Awaiting fit-to-sit"** — the pulsing ACTIVE step, the most prominent element in the section — **maps to no `sc_status` value and its date is stored nowhere**. `REJECTED` has no parent-facing design at all.
5. **Comms has no store:** `notification_log` is SMS-only — 3 of 6 thread rows and 5 of 7 per-row fields (channel, from-label, direction, duration, scheduled-future) have no columns.

### Kofi's rulings
- **R1 LINKAGE = `student_guardian.user_id`** (nullable, **single-column** FK → `ref_user` `ON DELETE SET NULL` — `ref_user` is GLOBAL so composite doesn't apply). Migration **0055**. **Phone-match REJECTED OUTRIGHT** (not on balance): shared family SIMs are normal in Ghana (the demo's own Aidoo household), MTN recycles numbers, and `normalizeGhanaPhone` returns raw input on unrecognised shapes — so "equal phone" is not even a stable relation. A separate `parent_student` table also rejected: `student_guardian` already IS the relation (it carries `relationship`/`is_primary`), and a second table drifts the dangerous way — **a guardian removed from contacts would keep portal access**.
- **R2 CLAIMING = school-issued, PER-CHILD invite + OTP to the STORED number** 🔶 **OWNER-ESCALATE** (genuinely a product decision; specs are silent — BUILD_STACK Decision 13 says only "a parent-scoped role"). Add a real `invite.student_id` **column** (not the untyped jsonb) + composite `(school_id, student_id)` FK. Staff pick a `student_guardian` row → invite; guardian opens token (factor 1) → OTP to `student_guardian.phone` **as stored** (factor 2). **What stops someone claiming another child by typing that guardian's number: NOTHING IS TYPED.** Siblings need their own invite deliberately (auto-linking rows sharing a phone re-imports the phone boundary at claim time). Self-serve REJECTED — it lets anyone enumerate which numbers are guardians at which school; if the owner wants it, required mitigations are OTP-to-stored-number-only + a school-side approval queue. **SMS console-degrades; never provision `HUBTEL_*`.**
- **R3 VISIBILITY** — allowed: child card, candidate status + SC-12 state, that candidate's 9 papers, the SC-12 row's public fields, comms where `contact_phone` is this parent's own, the CURRENT (non-superseded) readiness statement + PDF, static FAQ. **Hard denials (query-layer, not page-level):** any other candidate anywhere; ALL cohort data (`benchmark_*`, INCR-18 aggregates, distributions, rank, percentile, "N of 240"); the **moderation trail** (parent sees the effective grade ONLY via the frozen snapshot, never a live `mock_results` row); at-risk internals + `reg_flag`; **superseded statements**; `audit_log`; `waec_special_consideration.notes`/`filed_by_user_id` (staff free text); other guardians' rows; the existence of any other student. **OMIT don't fake** the Sickbay hero/NHIS/call-log (INCR-17 precedent: omitted, not placeholdered). **A `DRAFT` SC-12 must NOT be shown** (Lucy — the school hasn't filed; showing it promises something that hasn't happened).
- **R4 NO PARENT WRITE PATH.** The surface settles it: §5 is titled *"what you signed in March"* and its notes read *"End the parent view with reassurance, not action."* Lucy inventoried all 11 interactive elements — **zero forms/inputs/buttons/signature/OTP/reply/upload**; OTP appears only as past-tense provenance. **The parent-facing signing UI (INCR-17 R4) is DESCOPED → senior backlog** (no surface exists for the March signing moment; do not invent one). **INCR-17b R5 per-target ack stays unwritten** — keep the column, document "no writer, by ruling". 🔶 **OWNER-ESCALATE (honesty):** `parent_acknowledged_signature_method = PHONE_OTP` is *recorded by staff*, NOT *proven by a challenge*, yet §5 renders it as if cryptographic — recommend softening the parent copy to "acknowledgement recorded by the school · confirmed by phone" NOW, and building real OTP signing later as its own increment.
- **R5 SPLIT — YES.** **19a** = linkage + claiming + **the per-user RLS mechanism** + deny suite · migration 0055 · **no surface** · gated on **Sarah**. **19b** = the read-only surface. **Route-group rule:** build the portal as its own `app/(parent)/…` with its own layout — **never admit a PARENT into `app/(app)/`** (that shell assumes staff: sidebar, `/start`, finance redirects).
- **R6 × PR #167** — model works (PARENT is in NO role group in `lib/access.ts`, so all ~129 gates fail closed; #167 also stops parent roles unioning across schools). **Caveat:** a parent with children at two schools gets the earliest-claimed school **permanently** — fails closed and leaks nothing, but is not acceptable product behaviour, so the portal **must SAY SO** ("children at more than one school; contact the school") rather than render one child as the whole picture. **Gap — revocation:** nothing ends a parent's `role_assignment`; therefore **entitlement derives from the LIVE guardian link, not the role assignment** — deleting the guardian row revokes access in the same statement. 🔶 OWNER-ESCALATE: retention after graduation (note the trap — a WASSCE candidate graduates in the same window the results land).
- **RLS mechanism — RULED (i) second GUC.** Add `withParentScope(schoolId, userId)` setting `app.current_school` AND `app.current_parent_user`; generate a `parent_isolation` policy family (expressed ONCE like `tenant_isolation` at `policies.sql:149`, not bespoke per table) restricting rows to students linked via `student_guardian.user_id`. `app.current_parent_user` **must be absent on staff sessions** and the parent policies apply only when set. (ii) a dedicated PG role = too big a portability change; (iii) app-layer only = what `public-receipt.ts` does but **fails Decision 13**, which mandates DB-layer enforcement. ⚠️ `prod-paste-0055-parent-linkage.sql` must be hand-pasted or the boundary is silently app-layer-only.

### Lucy's additional findings (surface side)
- **The three real leak vectors are in the BUILD, not the mock** — the surface itself is clean (no rank/percentile/peer names; its notes forbid it twice): (1) **`wassce_papers` is COHORT-scoped** — driving §2 from papers instead of `wassce_paper_sittings WHERE candidate_id` pulls other candidates' rows; (2) reusing any INCR-18/20 component, esp. `mock_results` teacher comments which contain literal cohort prose ("top quartile"); (3) `projection_snapshot_json.band` carries the cohort tier vocabulary. **"Omission isn't enforcement — a plain `tenant_isolation` policy lets a PARENT read every candidate in the school."**
- **🔴 The drawn URL puts a child's NAME in the path** (`parent.omnischools.gh/asankrangwa/aidoo-yaa/wassce`) — the exact pattern this repo already forbids for boarding PII. **Resolve the child from the SESSION with no route parameter.**
- **Jargon gap:** `aggregate` is used 5× and **never defined** — FAQ Q5 explains why it hasn't moved but never what it IS or that LOWER IS BETTER, making "cut-off 11 · one place inside" unreadable to a parent. Needs a ruling. The exemplary translation to copy: **`Missed · medical` → `Postponed · SC-12 filed`** (needs a parent label map, not the shared staff constant). Must stay absent: predictor mock, moderation, best-3, tier band, credit pass, raw score.
- Existing precedent nobody had cited: **`lib/actions/public-receipt.ts`** — unguessable token + student code, unauthenticated, re-scoped downstream. The shipped "parent sees one child's artefact" pattern.

### Status
**Migration 0055 spec + full AC (L1-L6 linkage · C1-C7 claiming · D1-D10 crafted-request denials · R1-R4 read scope · A1-A2 ack-absence · M1-M2 multi-school) are in Kofi's ruling.** Lucy map: `docs/senior/wassce-parent-surface-map.md`. **Blocked on the owner's claiming-flow call** (invite vs self-serve) before Wells is dispatched.

**OWNER DECISION (2026-07-20): claiming flow = school-issued INVITE.** Wells dispatched for 19a (migration 0055 + per-user RLS). Self-serve declined.

### INCR-19a · Build + gate outcomes (PR #168 — awaiting owner merge)
- **Commits:** Wells schema/RLS `adc5ca1` + Claude Code claiming/deny-suite `cf57519` + Wells block-fix `90d006c`. Migration **0055** (`student_guardian.user_id` single-col→ref_user, `invite.student_id` composite→students). Files: `db/schema/{students,invites}.ts`, `lib/db/rls.ts` (`withParentScope`), `db/sql/{policies.sql,prod-paste-0055-parent-linkage.sql}`, `lib/actions/invites.ts`, `lib/parent/{claim,parent-data}.ts` (+2 tests), `lib/access.ts` (`isStaff`), `components/students/parent-invite-button.tsx`, `scripts/verify-parent-boundary.ts`.
- **The per-user RLS boundary:** `app.current_parent_user` GUC + **RESTRICTIVE** `parent_deny` (deny-by-default) / `parent_scope` (9 readable tables via the `parent_student_ids` SECURITY DEFINER helper). RESTRICTIVE because `tenant_isolation` is permissive and Postgres OR's permissive policies — a permissive parent policy would leak the whole school. `pu IS NULL` no-op guard → staff/bypass byte-unchanged. **`parent_deny` is CATALOG-DRIVEN** — every FORCE-RLS + `school_id` table lacking `parent_scope` is auto-denied, so a new tenant table inherits the boundary with zero code change (Dex's structural fix). A **drift-guard** in `verify-parent-boundary.ts` enumerates the same catalog and fails RED if any table is left unprotected.
- **TWO BLOCKS found + closed at their shared root cause (hand-maintained lists):** (1) **Sarah BLOCK — pre-existing health-PII exposure:** `student_health_record` (blood group/allergies/medications) was missing from `policies.sql` since 0036 → **RLS OFF on dev** (a parent read every child's health record; unscoped read crossed tenants). **Prod was SAFE** — `prod-paste-0036` gave it `tenant_isolation`, owner-confirmed live (`rls_on`+`forced` both true). Fixed: added to `tenant_isolation` + auto-covered by the catalog deny. (2) **Dex BLOCK — `parent_deny` was a hand-kept 77-table array with no drift-guard** → a new tenant table silently escaped. Fixed by the catalog-driven deny + drift-guard.
- **Gates ALL GREEN (re-gated after the fix):** Sarah **CLEAR-TO-MERGE** (leak proven closed as non-superuser role: parent→0 health rows, staff→own school; catalog complete 9 scope+78 deny, 0 both/neither; drift-guard bites — dropped a deny→RED→`db:policies`→GREEN). Dex **APPROVE** (set-algebra proof the catalog reproduces the exact prior 77+the health table; byte-identical policies↔prod-paste 170/170; scope-first ordering can't AND-lock a parent from their own child). Quinn **GREEN** (457 tests; deny suite proven NOT theatre — drops to `omnischools_app` rolsuper=f/rolbypassrls=f; every L1-6/C1-7/D1-10/M1-2 assertion holds). Deny suite = `db:verify-parent-boundary` (RLS can't run in pure vitest — MUST stay in the merge gate; NOT in `pnpm test`).
- **⚠️ PROD DEPLOY:** hand-paste `db/sql/prod-paste-0055-parent-linkage.sql` — installs the whole parent boundary + idempotently re-asserts the health-table `tenant_isolation`. Without it the boundary is app-layer only AND `student_health_record` has no `parent_deny` on prod (Sarah's exact leak, live).
- **NO parent write path** (Kofi R4, Lucy confirmed 0 write controls on the surface) — the signing UI is descoped to the senior backlog. `university_targets.parent_acknowledged_at` stays writerless.
- **🟠 Deferred (non-blocking, logged):** (a) `REVOKE EXECUTE ON parent_student_ids FROM PUBLIC` + `GRANT TO omnischools_app` — low-sev RPC-surface hardening (the GRANT is MANDATORY or the rls-test/verify harness breaks with "permission denied for function"; the real app connects as owner so is unaffected). (b) Column redaction (`notes`/`filed_by_user_id`/`reg_flag`) is loader-discipline not structural — the 19b surface loader must keep selecting only parent-safe columns (a `select *` leaks); revisit a column-grant/DB-view when 19b lands. (c) `projection_snapshot_json.band` carries cohort-tier vocabulary — 19b MUST strip it before rendering (Lucy leak #3; dormant in 19a, no caller). (d) Minor test-coverage gaps (C3/C5/C4-overwrite verified by inspection, no automated assertion). (e) **Manual check for owner:** no browser tool here could click the staff "Invite to parent portal" button end-to-end — writes proven via the deny suite, a real click before ship is worth it.

### INCR-19b (NEXT — the read-only portal, no migration)
Own `app/(parent)/…` route group (never admit PARENT into `app/(app)/`). §1–§5 minus the Sickbay-dependent content (omit ward/bed/clinician/NHIS/call-log — module 4.4 unbuilt, "omit not fake"). Resolve the child from the SESSION (no name/id in the URL — Lucy). Strip `projection_snapshot_json.band` cohort vocabulary. Define `aggregate` for parents + the `Missed·medical`→`Postponed·SC-12 filed` parent label map (Lucy jargon gap). 🔶 OWNER-ESCALATE (honesty): soften the §5 signature line from "Phone-OTP signature" (rendered as if cryptographic) to "acknowledgement recorded by the school · confirmed by phone" — the ack is staff-recorded, not challenge-proven. The multi-school notice ("children at more than one school") via the `hasChildrenAtOtherSchools` signal 19a already exposes.
