# Governance & Census track — build plan & task board

**What this is:** a single-school, read-only **Board/Director governance overview** (cross Basic + Senior, no operational access) **plus the GES statutory census (mid-year + annual)**, both consuming ONE shared "school rollup" aggregate layer.

**Branch:** `governance-feat` off `main` (cross-tier — NOT senior-feat). **Cadence:** per-increment PRs; milestone merge to `main` per module; owner merges every PR. **Gates (every PR):** Quinn (works) · Dex (well-built/portable) · Sarah (secure/RLS/PII, holds merge).
**Standing constraints:** honesty / omit-not-fake (an un-captured tile reads "not yet captured", never a fabricated number); no payment gateway; SMS console-only/deferred; teacher attendance DEFERRED. Next 15 async `params`/`searchParams`. New tenant tables need FORCE + `tenant_isolation` RLS **hand-pasted on prod** (prod-paste SQL).

## ✅ Owner-decided scope (2026-08-03)
1. **Finances = "net position" (buildable now)** — union EXISTING data (fee collections `getFinanceReport` + `books` income-vs-expense + payroll `staff_compensation` surfaced). **NO accounting engine, NO statutory P&L, NO Balance Sheet** (no cash/liability/equity/GL). **Payroll aggregate shown ONLY when the school uses payroll provisioning** (else omit the line, honestly).
2. **Census = in scope, shared rollup** — GES **mid-year + annual** generation (auto-fill + hand-fill + signed PDF) on the same aggregate layer. **Census does NOT include finances** → the net-position finance arm feeds ONLY the board overview (census decoupled from the finance module).
3. **Performance = add terminal-results capture** — NET-NEW: actual **BECE (Basic) + WASSCE (Senior)** results, both tiers. **Manual entry + CSV import for v1; WAEC-portal integration DEFERRED to a later iteration.**
4. **Infrastructure = light manual facilities form** — NET-NEW: once-a-term form (classrooms/utilities/condition/ICT/library/feeding) feeding BOTH the board overview AND the census infra section.
- **Board persona = a LOGIN account** (seated `BOARD_MEMBER`, confined like the finance-only pattern — no operational/write access). Teacher attendance DEFERRED.

## Module / increment decomposition (GOV-1..9)

**G0 — Shared rollup foundation + board persona (spine)**
- **GOV-1** ⭐ — `lib/rollup/school-rollup.ts` aggregate seam. Server-only, `withSchool`-scoped; composes shipped functions (enrolment `enrolment-roll`/`school-stats`, attendance `getAttendanceSummary`, fee collections `getFinanceReport`) into one typed rollup. Kofi ratifies the SEAM CONTRACT first. **Pure read/aggregate — no schema/role/surface.**
- **GOV-2** — Read-only `BOARD_MEMBER` role (free-text append to `KNOWN_APP_ROLES`, no enum migration) + `isBoardOnly`/`BOARD_SECTIONS`/`pathAllowedForBoard`/`BOARD_HOME` mirroring `isFinanceOnly`; `/board` landing. Inert in every write/management group; rank-1. **No schema.**

**G1 — Net-position finance**
- **GOV-3** — Net-position rollup arm: fee net (`getFinanceReport`) + books income-vs-expense (`/books/reports`) + payroll line (Σ `staff_compensation` SCHOOL_PAID, GES-paid as memo) **only if payroll is used**. **Pure aggregate — no schema.** Board-overview only (not census).

**G2 — Board overview dashboard + PDF**
- **GOV-4** — Board dashboard, 5 tiles (finance/attendance/enrolment real; performance = existing Basic gradebook avgs + Senior readiness; infra = "not yet captured" until GOV-7). Lucy designs from scratch (no surface exists). **No schema.**
- **GOV-5** — Board-pack PDF (reuse `lib/pdf/*`). **Pure render.**

**G3 — Terminal-results capture (NET-NEW DATA)**
- **GOV-6** — NEW `terminal_exam_result` table (school_id, exam_type BECE|WASSCE, year; school-level pass-rate aggregates — per-candidate PII = open call §OC). Manual entry + CSV import; `school_type`-gated. Feeds performance tile + census. **Wells: migration + RLS + prod-paste.**

**G4 — Facilities form (NET-NEW DATA)**
- **GOV-7** — NEW `facilities_snapshot` table (school_id, term; classrooms/utilities/condition/ICT/library/feeding). Field list aligned to the GES infra section. Native-input form. Feeds infra tile + census. **Wells: migration + RLS + prod-paste.**

**G5 — GES census (mid-year + annual)**
- **GOV-8** — NEW `census_return` table (cadence MID_YEAR|ANNUAL, year, status, hand-fill fields + snapshot of auto-filled rollup). **🔴 BLOCKED on the real GES form (owner input — §OC).** Auto-fill (incl. sex-disaggregated enrolment arm) + hand-fill. **Wells: migration + RLS + prod-paste.** NO finance arm.
- **GOV-9** — Annual field set (ALTER on GOV-8) + signed GES submission PDF (print-and-sign; no electronic GES/EMIS integration in v1). **Mostly render.**

## Critical path / sequence
`GOV-1 → GOV-2 → GOV-3 → GOV-4 → GOV-5` (board half, unblocked now) ; `GOV-6`, `GOV-7` (net-new data, independent, fill GOV-4's placeholder tiles) ; `GOV-8 → GOV-9` (census — needs GOV-7 + enrolment/attendance + the GES form). **6 of 9 increments are pure read/aggregate (no Wells/migration/prod-paste); risk concentrates in GOV-6/7/8.** Recommended serial order: GOV-1→2→3→4→5→6→7→8→9 (front-load the board deliverable). Census-priority alt: pull GOV-6/7 earlier if a filing deadline binds.

## 🔴 Open owner-calls (unresolved)
- **OC-CENSUS-FORM:** the real current-year GES mid-year + annual census field list is a REQUIRED external input (stop-and-ask) — Kofi cannot infer it. Blocks GOV-8/9. Board half does not need it.
- **OC-RESULTS-PII:** terminal results stored as **school-level aggregates** (assumed) vs individual candidate results (PII surface). CSV import format tbd.
- **OC-SEATING:** who may assign `BOARD_MEMBER` (PROPRIETOR only vs `STAFF_ADMIN_ROLES`); confirm the role never satisfies any `isStaff`/write gate.
- **OC-FACILITIES-FIELDS / OC-STAFFING-BREAKDOWN / OC-CENSUS-CHANNEL** (print-sign vs electronic EMIS — electronic = stop-and-ask), **OC-BECE-WASSCE-SEQ** — resolve at each module.

---

## GOV-1 · shared school-rollup aggregate seam — GATES GREEN, PR OPEN (`b919216`) · no deploy SQL · 2026-08-03
Server-only `lib/rollup/school-rollup.ts`, ZERO SQL — composes the shipped `school-stats`/`enrolment-roll`/`attendance-summary`/`finance` functions into one `withSchool`-scoped typed rollup. Kofi contract **R320–R332**.
- **🔑 The honesty convention the WHOLE track inherits (R323):** every arm is a tagged union `RollupArm<T> = {status:"CAPTURED",data} | {status:"NOT_CAPTURED",reason} | {status:"NOT_APPLICABLE",reason}` — a consumer must narrow on `status` before touching `.data`, so a fabricated zero is a **compile error**. Real-zero (fees billed, `collected:0`) is CAPTURED; NOT_CAPTURED is drawn at row-existence (invoiceCount/totalMarked/roll), NEVER the headline figure. GOV-1 emits only CAPTURED/NOT_CAPTURED; NOT_APPLICABLE is reserved (GOV-6 Basic-school-WASSCE / Senior-school-BECE, GOV-3 no-payroll).
- **3 arms:** enrolment (point-in-time from school-stats + term-windowed intake from enrolment-roll, nullable-when-no-period; **netChange from enrolment-roll [term-scoped], lifetimeExits re-summed from school-stats [period-independent — avoids enrolment-roll's no-term fabricated zero]**), attendance (**aggregates ONLY — per-student needsAttention/names/teacherName stripped, PII-minimised**; all 5 statuses P/L/E/M/A), feeCollections (billed/collected/outstanding/rate, collections view only — net-position is GOV-3).
- **Gates all pass** — **Quinn 🟢 GREEN** (1633 tests; 5/5 mutations caught; found the two reconciliations were correct-but-unguarded [self-blessing-green-suite hole] + folded 3 guards `b919216`; middot `{label} · {year}` separator ACCEPTED as the shipped convention). **Dex ✅ APPROVE** (RollupArm<T> the right shape; container consumer-agnostic — additive arms don't break consumers; the two reconciliations are the honest calls; server-only + purity clean; sound foundation for GOV-2..9). **Sarah CLEAR** (tenant isolation inherited — one schoolId fans out to all withSchool-scoped calls, cross-tenant structurally impossible; PII-minimised arms; server-only; no new surface — read-only library fn, no prod-paste owed).
- **🔵 Forward-notes for later increments (Dex/Sarah advisory — no change now):** (a) top-level `period` is TERM-shaped — GOV-6 (BECE/WASSCE) + GOV-8/9 (annual census) are YEAR-scoped; derive year from `period.academicYear` or extend the `opts` bag, don't force year-scoped arms through the term `period`. (b) GOV-7 facilities is a once-a-term SNAPSHOT — carry its captured-at INSIDE the arm's `data`, not the live `generatedAt`. (c) enrolment CAPTURED gates on ACTIVE roll>0 (hides lifetime exits for a zero-active school — conscious editorial). (d) keep `gender`/`statusTotals`/`counts` aggregate-only if a source shape ever widens (they're pass-by-reference).
