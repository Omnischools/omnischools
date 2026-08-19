# Directors' Insights — spec + acceptance criteria

**Steward:** Kofi (Domain / Spec) · **Status:** ready for build · **Series:** `INS-01..INS-31`
**Persona:** Director / management (Proprietor · Headmaster · Admin) — **not** the read-only `BOARD_MEMBER`
**Tier:** cross-tier (Basic + Senior + Combined), tier-gated per arm like `/board`.

This is the real build of the consolidated director dashboard mock (KPI scan strip · "Needs your attention" panel · finance/academic/operational panels · drill-in links). It is **composition, not net-new data**: it re-serves the *aggregate* projections that already ship behind `/board` and `/reports`, adds three drill-in dimensions (by class · by year-group/level · by subject), and a gender + age distribution. The hard rule that shapes every decision below: **everything is aggregate — class / year-group / subject — never an individual-student row.**

Grounding (verified in `senior-live` on 2026-08-19):
- `lib/rollup/school-rollup.ts` — `getSchoolRollup(schoolId, {periodId})`, the aggregate spine of `/board`. Arms are honesty-gated (`RollupArm`: `CAPTURED` / `NOT_CAPTURED` / `NOT_APPLICABLE`) and already **PII-stripped** (attendance arm's own note: "Aggregate-only re-exposure — no needsAttention/criticalCount/thresholds (PII/ops)").
- `lib/reports/census-enrolment-data.ts` — `getCensusEnrolment(schoolId)`: `roll`, `gender` (SexSplit), `byClass` (+`level`), `byLevel`, `ageByLevel`, `approvedAge`, `dobUnknown`. **The single source for the by-level + gender + age drill-ins.** Fully aggregate, no PII.
- `lib/reports/class-performance-data.ts` — `getClassPerformance(schoolId,{periodId})`: per-class aggregate `rows[]` (no student rows).
- `lib/reports/subject-performance-data.ts` — `getSubjectPerformance(schoolId,{periodId})`: per-subject aggregate `rows[]` (no student rows).
- `classes.level` (`db/schema/students.ts:37`, `text`, nullable, e.g. `"JHS 1"`, `"Form 2"`) — the year-group key. **No schema change is needed** (see §6).
- Access model: `lib/access.ts` + `lib/auth/server.ts` (`requireSchool` → staff gate + finance-only path confinement; `requireSchoolRole(allowed)` → adds the role redirect).

---

## 1 · Route + access

**Ruling — route.** Live at top-level **`/insights`** inside the staff `app/(app)` group. **Do NOT nest it under `/reports`.** `/reports` is a finance-only-reachable prefix (`FINANCE_SECTIONS` includes `/reports`), so `/reports/insights` would satisfy `pathAllowedForFinance()` and rely *solely* on the role redirect to keep an Accountant out — a fragile, single-lock leak. A sibling top-level segment is stopped by **both** the finance path-confinement layer **and** the role gate. Exact name is `OC-INS-ROUTE` — recommend `/insights`.

**Ruling — gate.** Guard with `requireSchoolRole(INSIGHTS_READ_ROLES)` where `INSIGHTS_READ_ROLES = ["ADMIN", "HEADMASTER", "PROPRIETOR"]`. Introduce it as a **new, purpose-named** group in `lib/access.ts`, membership initially identical to `STAFF_ADMIN_ROLES` / `USER_ADMIN_ROLES` but semantically distinct: this is the *director analytics read* gate, not the authorization root (`STAFF_ADMIN_ROLES` = "who may mint administrators") nor the login-lifecycle set (`USER_ADMIN_ROLES`). This follows the codebase's own discipline — purpose-named gates so widening one never silently widens another — and directly answers the standing hazard [[builds-widen-ratified-authz-and-self-bless]]: do **not** reuse a wider or auth-root sibling.

**Ruling — relationship to existing surfaces.** It **complements, never replaces**: `/dashboard` stays the staff landing; `/reports` stays the report hub (and owns the *deep*, per-student detail, e.g. attendance needs-attention); `/board` stays `BOARD_MEMBER`-only. `/insights` is the director's consolidated overview that **drills INTO** the existing reports (its drill-ins link out to the full `/reports/*` pages for anything below aggregate grain).

**Ruling — exclusions.** `VICE_HEADMASTER_ACADEMIC` is **excluded by default**: this surface carries the finance/net-position streams (fees, books, payroll), which are governance, not academics. Whether VHA should be admitted (and, if so, whether the finance panel is hidden from them) is `OC-INS-VHA`. Finance-only staff (Accountant / Bursar), Teacher, Form Master, Student, Parent, and `BOARD_MEMBER` never reach it.

---

## 2 · Reuse-vs-build (composition map)

**Reuse — no new SQL (8 of 9 data needs):**

| Need | Source (existing) |
|---|---|
| KPI scan strip (roll, attendance, academic standing, fee %, facilities) | `getSchoolRollup` arms |
| Finance panel (fees · books · payroll, three un-summed streams) | `rollup.netPositionFinance` |
| Terminal results (BECE/WASSCE) · Infrastructure | `rollup.terminalResults`, `rollup.infrastructure` |
| Performance headline + Senior readiness | `rollup.performance` |
| Performance drill-in **by class** | `getClassPerformance().rows` |
| Performance drill-in **by subject** | `getSubjectPerformance().rows` |
| Attendance drill-in **by class** | `rollup.attendance.data.byClass` (PII-stripped) |
| Attendance drill-in **by year-group** | fold `rollup.attendance.data.byClass` counts by a `classId→level` map from `getCensusEnrolment().byClass` — **exact** (integer P/L/E/M/A counts sum losslessly; rate = (ΣP+ΣL)/Σmarked) |
| Enrolment **by class / by level**, **gender split**, **age distribution** | `getCensusEnrolment()` (`byClass`, `byLevel`, `gender`, `ageByLevel`, `approvedAge`) |

**Build — exactly ONE new reader:** **performance by year-group (level).** It cannot be composed honestly: `ClassPerfRow.average` is rounded to 1 dp and the reader exposes `studentsGraded` (a distinct-student count) but not the score-row count, so a mean-of-class-means weighted by `studentsGraded` would be a fabricated figure (wrong denominator, compounding rounding). Build a level-grouped aggregate — `getLevelPerformance(schoolId,{periodId})`, or a `byLevel[]` addition to `getClassPerformance` — that groups `gradebook_score.total` by `classes.level` with the **same** per-score basis already in `scopedSchoolAggregate`: `AVG(total)` over non-null totals; pass rate via `passRateOf(count(*) filter total>=PASS_MARK, count(*) filter total not null)`; `studentsGraded = count(distinct studentId)`. Classes with `level IS NULL` bucket under an `"Unspecified"` level (honest, mirrors census `UNSPECIFIED`).

**Optional thin composition seam (recommended):** a single server entry `getDirectorsInsights(schoolId,{periodId})` that awaits the readers above and returns **only aggregate types** — the structural place the aggregate-only invariant (§4) is guaranteed and where Quinn/Sarah test. It stays zero-SQL beyond the one new level reader, mirroring how `getSchoolRollup` composes.

**Do NOT call `getAttendanceSummary` from this surface.** It returns `needsAttention: NeedsAttentionRow[]` carrying `studentId` / student `name` / `studentCode` — per-student PII. Use `rollup.attendance` (already stripped) instead. This is the one reuse trap that would breach §5.

---

## 3 · Drill-in data contracts

Presentation model (in-page expandable sections vs tabs vs linked detail) is **Lucy's call**; this section rules only the **data each drill-in must carry**. Recommended default: in-page expandable sections per metric family (data is already loaded server-side; the full `/reports/*` pages remain the linked "deep" detail). Term selection (`?periodId`, reusing `ReportFilters` as `/board` does) governs **performance · attendance · finance · senior-readiness · terminal (year)**. **Enrolment, gender, and age are point-in-time snapshots** (census reader is as-of-now, ACTIVE-only, not period-scoped) — label them as such; they do not change with the period selector.

**Performance** (three dimensions):
- *by class* — one row per active class: class name, average, grade (on the school `grade_scale`), delta vs prior term, `studentsGraded` count. Source `getClassPerformance().rows`.
- *by year-group (level)* — one row per distinct `classes.level`: level label, level average, pass rate, `studentsGraded`, optional delta. Source the new `getLevelPerformance`.
- *by subject* — one row per active subject: subject name/code, average, grade, pass rate, delta, highest/lowest **scores** (not names). Source `getSubjectPerformance().rows`.

**Attendance** (two dimensions):
- *by class* — class name, rate = (P+L)/marked, marked count, P/L/E/M/A `counts`. Source `rollup.attendance.data.byClass`.
- *by year-group (level)* — level label, folded P/L/E/M/A counts, marked, recomputed rate. Source the fold in §2.
- All **five** attendance statuses (Present/Late/Excused/**Medical**/Absent) preserved and shown distinctly; Medical ("M") is never folded into Absent ([[attendance-five-statuses]]).

**Enrolment** (two dimensions + gender + age):
- *by class* — class name, `level`, enrolled, female/male counts. Source `getCensusEnrolment().byClass` (or `rollup.enrolment.data.byClass`).
- *by year-group (level)* — level label, female/male/total. Source `getCensusEnrolment().byLevel`.

---

## 4 · Gender + age distribution

**Gender** — aggregate counts at school, per class, and per level, from `getCensusEnrolment().gender` / `.byClass` / `.byLevel` (each a `SexSplit {female, male, total}`). No per-student rows.

**Age distribution** — reuse `getCensusEnrolment().ageByLevel` (age × sex histogram per level, plus a `dobUnknown` bucket) and/or `.approvedAge` (under / on / over the GES official age per level, plus an `unknown` bucket). Both are **gender-disaggregated and aggregate**. A student with a NULL date-of-birth is **never coerced to an age** — they surface in `dobUnknown` / the level `unknown` bucket (census honesty), and that bucket must be **shown**, never dropped or backfilled.

---

## 5 · Aggregate-only invariant (KEY — owner-stated hard rule)

**INV.** No individual-student row appears anywhere on `/insights` or any of its drill-ins. Granularity is **class / year-group / subject** only. A reader that projects a student **name, id, student-code, or date-of-birth** into this surface is a **violation**. This mirrors the rollup/census no-PII discipline and is testable structurally:
- Every reader feeding `/insights` returns only class/level/subject-keyed aggregate rows and counts.
- `getAttendanceSummary` (student `needsAttention[]`) is **not** in the composition (§2).
- The `getDirectorsInsights` seam's return type contains no student-identifying field; a projection that adds one is a compile-time/type violation Sarah can pin.
- Staff/class metadata at the aggregate grain (a class's teacher name, a class/subject name) is **not** student PII and is permitted as row labelling.

Per-student drill-in is an **explicit future call** ("for now") — `OC-INS-PERSTUDENT`. When built it lives behind a **tighter** gate + PII handling (like the existing `/reports/*` detail pages), never by widening this surface.

---

## 6 · Schema

**None.** Every figure derives from existing tables (`students`, `classes`, `gradebook_score`, `attendance_record`, plus the finance/facilities/terminal sources the rollup already reads). `classes.level` (`text`, nullable) already exists and is the year-group key; the new by-level performance reader is a pure `GROUP BY classes.level` over existing columns. **No migration, no new column, no RLS change — this does not pull in Wells.**

---

## 7 · Honesty

Inherit omit-not-fake wholesale: every rollup arm renders its `CAPTURED` figure, or its `NOT_CAPTURED` / `NOT_APPLICABLE` **reason string** — never a fabricated zero (a *real* captured zero renders as a true zero). The finance panel keeps the three streams **separate and un-summed** (no "net position"/"profit" scalar). The "Needs your attention" panel is **aggregate-signal-only** (e.g. "3 classes below 75% attendance", "fee collection 62% — GHS X outstanding", "2 subjects at risk for STPSHS", "Form 2 average down 6 pts vs last term") with drill-in / report links; it must **not** reproduce the per-student needs-attention list (that stays on `/reports/operational/attendance-summary` behind its own gate).

---

## Acceptance criteria (`INS-01..INS-31`)

### Route + access
- **INS-01 (Sarah).** ADMIN/HEADMASTER/PROPRIETOR at the active school → `/insights` renders.
- **INS-02 (Sarah).** A finance-only session (ACCOUNTANT/BURSAR only) → redirected to `FINANCE_HOME` `/billing`, no insights data — enforced by BOTH finance path-confinement (route not in `FINANCE_SECTIONS`) AND the role gate.
- **INS-03 (Sarah).** TEACHER-only / FORM_MASTER-only / STUDENT / PARENT → redirected to `/dashboard`, no data.
- **INS-04 (Sarah).** `BOARD_MEMBER`-only → redirected to `BOARD_HOME` `/board`.
- **INS-05 (Sarah).** `INSIGHTS_READ_ROLES` is a distinct named group — NOT an alias/import of `STAFF_ADMIN_ROLES`/`USER_ADMIN_ROLES`/any wider set. Mutating the guard to a wider group reds a test.
- **INS-06 (Sarah).** Reads the SESSION school id, never a URL/query id (`withSchool` FORCE-RLS boundary).

### Composition + drill-in presence (functional)
- **INS-07 (Quinn).** KPI scan strip from `getSchoolRollup` arms (roll, attendance %, academic standing, fee %, facilities), each honesty-gated.
- **INS-08 (Quinn).** Finance panel = fees + books + payroll as three separate streams, no summed "net position".
- **INS-09 (Quinn).** Performance exposes THREE drill-in dimensions — by class, by year-group (level), by subject — each present, each an aggregate average (+ pass rate where the source provides it).
- **INS-10 (Quinn).** Performance *by class* rows match `getClassPerformance().rows` for the term.
- **INS-11 (Quinn).** Performance *by subject* rows match `getSubjectPerformance().rows`.
- **INS-12 (Quinn).** Performance *by year-group* groups classes sharing a `classes.level` (e.g. "Form 2 Science" + "Form 2 General Arts A" → one **Form 2** row); its average is a level-grouped per-score aggregate, NOT a mean of rounded class averages. `level IS NULL` → an "Unspecified" row.
- **INS-13 (Quinn).** Attendance drill-ins by class + year-group; by-class rows match `rollup.attendance.data.byClass`.
- **INS-14 (Quinn).** Attendance *by year-group* counts = sum of constituent classes' P/L/E/M/A; rate = (ΣP+ΣL)/Σmarked (lossless integer fold).
- **INS-15 (Quinn).** All FIVE attendance statuses shown distinctly; Medical never merged into Absent.
- **INS-16 (Quinn).** Enrolment drill-ins by class + year-group; by-level totals match `getCensusEnrolment().byLevel`.
- **INS-17 (Quinn).** Gender split at school + per class/level (female/male/total), matching census `gender`/`byClass`/`byLevel`.
- **INS-18 (Quinn).** Age distribution shown, gender-disaggregated, matching `ageByLevel` and/or `approvedAge`.
- **INS-19 (Quinn).** Unknown-DOB students appear in a visible `dobUnknown`/`unknown` bucket, never assigned a coerced age.
- **INS-20 (Quinn).** "Needs your attention" = aggregate signals only (class/level/subject-grain) + links; NO per-student list.

### Aggregate-only invariant (security)
- **INS-21 (Sarah).** No response/markup on `/insights` or any drill-in carries a student name/id/code/DOB. (Age is a bucket count, never a per-pupil value.)
- **INS-22 (Sarah).** `getAttendanceSummary` is NOT in the `/insights` data path; attendance comes from PII-stripped `rollup.attendance`. Wiring its `needsAttention[]` reds a test.
- **INS-23 (Sarah).** Every reader/type feeding `/insights` (incl. the new by-level reader + the `getDirectorsInsights` seam) exposes only class/level/subject-keyed aggregates; adding a student-identifying field is a type/structural violation.
- **INS-24 (Sarah).** Drill-in granularity stops at class/year-group/subject; no path expands to an individual-student row (`OC-INS-PERSTUDENT`, deferred).

### Honesty + term filter (functional)
- **INS-25 (Quinn).** Each metric renders its real value OR its `NOT_CAPTURED`/`NOT_APPLICABLE` reason — never a fabricated zero; a genuine captured zero renders as a real zero.
- **INS-26 (Quinn).** A tier-inapplicable arm is omitted/marked NOT_APPLICABLE (BASIC → no Senior-readiness/WASSCE; SENIOR → no Basic-gradebook/BECE).
- **INS-27 (Quinn).** `?periodId` re-scopes performance/attendance/finance/senior-readiness; enrolment/gender/age are labelled point-in-time and don't change with the selector.
- **INS-28 (Quinn).** An empty/new school renders honest empties, does not error or invent data.
- **INS-29 (Quinn).** Only source-exposed deltas shown; no computed verdict/health score.
- **INS-30 (Sarah).** The new by-level reader is `withSchool`-scoped (tenant-isolated) and omits/`null`s a level with no graded scores (never `0`).
- **INS-31 (Sarah).** No new migration/RLS ships; `/insights` reads only existing tables. A schema diff fails review.

---

## Open calls (owner)
- **OC-INS-ROUTE** — exact route name. Recommend `/insights` (top-level, NOT under `/reports`).
- **OC-INS-VHA** — admit `VICE_HEADMASTER_ACADEMIC`? Default **no** (finance/governance exposure); if yes, decide whether the finance panel is hidden from them.
- **OC-INS-PERSTUDENT** — per-student drill-in deferred ("for now"); when built, behind a tighter PII-aware gate, never by widening `/insights`.
- **OC-INS-AGE-FREEZE** — age/gender as-of-now (live census snapshot). Recommend live-as-of-now, matching `/board`.
