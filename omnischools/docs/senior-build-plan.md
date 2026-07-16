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

## Next increment — INCR-5: Score Ledger Item 6 · Omnischools-branded paper ledger book · NO new migration

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
