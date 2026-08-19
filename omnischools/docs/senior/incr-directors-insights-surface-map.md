# INCR — Directors' Insights — Surface Map

**Author:** Lucy (design cartographer) · **Status:** design spec, ready for the implementation engineer.
**Scope:** the acting **director/admin** analytics dashboard — the board overview's richer, act-on-it
sibling. It **extends** the shipped `app/(board)/board/page.tsx` (the closest existing surface and the
visual source of truth) with (a) a **"Needs your attention"** action panel and (b) real **aggregate
drill-ins** on Performance / Attendance / Enrolment (by class · by year-group · by subject), plus a
**gender-split** and an **age-distribution** viz on Enrolment. This is **not a redesign** — it reuses the
board's `Tile` / `SummaryCell` / `TrendPill` / `AbsencePanel` / `StatusSplit` / gender mini-bar / `PerfBar`
idioms verbatim. Where the mockup and the shipped board disagree, **the shipped board wins on visual
presentation**; Kofi's data/AC spec wins on logic. Every drift is flagged inline and collected in the drift
log. Kofi is speccing data/AC in parallel — the **Data-shape assumptions (§17)** section marks every place
this map assumes a reader/field so the two specs reconcile.

> **HARD CONSTRAINT (repeated because it governs every section): aggregate-only.** No student name, no
> student row, no per-student anything appears anywhere on this surface or in any drill-in. Every drill-in
> row is a **class / year-group / subject / age-band** aggregate. This is structurally enforced by sourcing
> only from aggregate readers (§17) that expose counts and averages, never `rows[]` of students.

## Source surfaces & code (verified first-hand)

| Source | Role in this map |
|---|---|
| `app/(board)/board/page.tsx` | **PRIMARY visual + interaction source.** The 5-cell summary strip (lead cell gold-bg), the Financial-position full-width tile, Attendance \| Enrolment and Performance \| Infrastructure pairs, `Tile` / `SummaryCell` anatomy, `academicSummary()`, `StatusSplit` (P/L/E/M/A), the gender mini-bar (`FEMALE_HEX`/`MALE_HEX`), `Line`/`StreamCard`/`Headline`/`Caption`/`Reason`, the omit-not-fake `AbsencePanel` for NOT_CAPTURED. Reused **verbatim**; the drill-ins slot **inside** the existing tiles. |
| `components/board/board-tiles.tsx` | The **pure presentational** primitives (`TrendPill`, `ComingSoon`, `AbsencePanel`) — no `server-only`, no DB. The right home to also lift the shared `SummaryCell` / `Tile` / `StatusSplit` / `Line` so both board and insights import them (§15). |
| `components/reports/report-kit.tsx` | `PerfBar` (track + tone fill + mono value, capped 100), `ColumnHeads`, `SectionCard`, `Kpi`/`FeaturedKpi`, `SnapshotPill`. `PerfBar` is the drill-in bar; it is pure/presentational (usable client-side). |
| `components/reports/report-filters.tsx` | `ReportFilters` — the term-pill + class `<select>` URL-param filter bar. The **period selector** (verbatim, `showClass={false}`) **and** the term-pill visual is the exact idiom the drill-in segmented control reuses. |
| `lib/rollup/school-rollup.ts` | `getSchoolRollup()` → the whole summary strip + all six tiles. Also the source of the drill-in seeds already loaded: `attendance.data.byClass` (`AttendanceClassRow`, P/L/E/M/A counts) and `enrolment.data.byClass` (`EnrolmentClassRow`, female/male). |
| `lib/reports/class-performance-data.ts` | `getClassPerformance()` → `rows: ClassPerfRow[]` (classId·name·average·grade·tone·delta·studentsGraded) — the **Performance › by class** drill-in. |
| `lib/reports/subject-performance-data.ts` | `getSubjectPerformance()` → `rows: SubjectPerfRow[]` (subjectId·name·average·grade·tone·delta·passRate·highest·lowest) — the **Performance › by subject** drill-in. |
| `lib/reports/census-enrolment-data.ts` | `getCensusEnrolment()` → `byClass` / `byLevel` (each `{name/level, female, male, total}`), `ageByLevel` (per-year `{age, female, male, total}` + `dobUnknown`), `approvedAge` (under/on/over/unknown vs GES official age), `dobUnknown`, `censusDate`. The **single reader** behind Enrolment by-class, by-year-group, gender-split and age-distribution. Aggregate, sex-split, `officialAgeForLevel` + `ageAsOf` honesty already built in. |
| `lib/reports/school-stats-data.ts` | `getSchoolStats().byClass` carries `classes.level` — the year-group key. Confirms `level` is the form-level source for grouping. |
| `lib/attendance-status.ts` | `ATTENDANCE_STATUS_ORDER` + `ATTENDANCE_STATUS_META` (P green / L gold / E warn / **M navy-2** / A terra). The 5-status colours the attendance drill-in reuses; Medical stays first-class (sickbay→attendance hook). |
| `lib/access.ts` | Role groups. `STAFF_ADMIN_ROLES` = ADMIN·HEADMASTER·PROPRIETOR (the acting director persona); `SENIOR_MANAGEMENT_ROLES` = ADMIN·HEADMASTER·VICE_HEADMASTER_ACADEMIC. §0.4. |
| `app/(app)/senior/headmaster-summary/page.tsx` | Reference for the **senior-tier acting page** pattern — `requireSchoolRole()`, `dynamic="force-dynamic"`, `mx-auto max-w-page`, period tabs, the shared hero voice, honest dashed empty states. The insights page follows this frame. |
| `md files/design-tokens.json` + `styles/tokens.css` | Canonical tokens. Use the Tailwind token class (`text-gold`, `bg-navy`, `border-border`), never inline `var(--x)`. |

---

## 0. Decisions the brief asked me to make explicit

### 0.1 New route, or a mode of `/board`? → **A new route under the app frame. Not part of `/board`.**

`/board` is gated `requireBoard()` = **BOARD_MEMBER only, read-only governance** (its docblock and the
board-pack route's `x-pathname` confinement are explicit). Directors' Insights is the **acting** persona —
the same figures, but the director can click through to *fix* them. Different audience, different auth,
different capability. Build it as a **new server route in the operational app frame**, e.g.
`app/(app)/directors/page.tsx` (or `app/(app)/senior/insights/page.tsx` if it ships senior-first — see
§0.4 / drift #1), `export const dynamic = "force-dynamic"`, `mx-auto max-w-page`. It **reuses the board's
components** but is its own page — the board stays the read-only mirror; insights is the cockpit.

> Why not extend `/board` with a `?mode=` flag: the board is auth-confined to BOARD_MEMBER and its
> board-pack export is path-confined to `/board`. A director is usually **not** a board member. Folding the
> two would either widen `requireBoard()` (an authz regression — see memory `builds-widen-ratified-authz`)
> or leave directors locked out. Separate route, shared pixels.

### 0.2 Drill-in interaction pattern → **In-page disclosure + segmented dimension control. One surface, one data load.**

The brief asks me to pick and justify. **Chosen: in-page.** Each drillable tile keeps its board summary
always visible, and gains a **disclosure** ("Break down ▾") that reveals an aggregate **bar list**; a
**segmented control** (the ReportFilters term-pill idiom) switches the dimension (**By class · By year-group
· By subject**). Rejected: a linked detail route (heavier — a second page, a second load, a second place for
the same aggregate to drift; and the mockup's "links" were exactly the thing the owner asked to replace with
*real* drill-ins **on this surface**).

**Mechanics (lazy + typed + SSR-friendly):** the page is a server component. It **loads and pre-shapes every
dimension's aggregate rows** (all pre-formatted primitives — memory `reports-data-is-server-only`), and
**server-renders each dimension's bar list**. A thin client component `<DrillIn>` receives those pre-rendered
nodes as slots and owns only two pieces of local UI state — `open` (the disclosure) and `activeDim` (which
slot shows). Switching dimension is **instant, no refetch, no URL churn**; no student data can leak because
the client only ever holds already-rendered aggregate JSX. This is the whole client-JS surface of the page.

> Alternative considered and rejected: URL-param dimension switch (`?perfDim=class`) via `<Link>` chips (the
> ReportFilters pattern, zero client JS). It works, but three tiles × their own param + re-nav on every
> switch (and native `<details>` losing its open state across the nav) is more moving parts than one small
> `<DrillIn>`. Take the higher rung: one client component, instant switches. (If the team prefers zero client
> JS, the `<Link>`-chip form is a drop-in — flag #6.)

### 0.3 What is aggregated, and is any of it per-student? → **Counts and averages only. Never a student row.**

Restating the hard constraint as a build rule: every drill-in row's unit is **class / year-group (form
level) / subject / age-band**. The readers behind them (§17) expose `average` / `passRate` / `female` /
`male` / `total` / P·L·E·M·A `counts` — **there is no student-name field to render**. The one place the
board already shows sex counts is aggregate (gender mini-bar `NF · NM`); the age viz is age-band × sex
counts. No "top student", no "at-risk pupil list", no per-student trajectory. If a future owner wants a
student-level drill, that is a **different, permission-gated surface** — not this one.

### 0.4 Role gate → **`STAFF_ADMIN_ROLES` (ADMIN · HEADMASTER · PROPRIETOR), the director persona.**

The acting director/admin persona maps to `STAFF_ADMIN_ROLES` (PROPRIETOR = the school director/owner). Gate
with `requireSchoolRole(STAFF_ADMIN_ROLES)` (the headmaster-summary precedent). If the surface ships
senior-first, `SENIOR_MANAGEMENT_ROLES` is the alternative (adds VICE_HEADMASTER_ACADEMIC, drops PROPRIETOR).
**Recommend a dedicated per-surface group `DIRECTOR_INSIGHTS_ROLES`** (named like `WASSCE_SETUP_ROLES` so it
can diverge later without touching another gate), seeded = `STAFF_ADMIN_ROLES`. Confirm the exact set with
Kofi/PO — this is the one authz decision, and per memory `builds-widen-ratified-authz`, **gate to the
spec, do not copy a wider sibling**. Drift #1.

---

## 1. Token & type reference

All base tokens/type families map exactly as in `ledger-surface-map.md §0` and `incr57 §1` — **use the
Tailwind token class, never inline `var(--x)`**; `font-display`=Fraunces, `font-body`=Manrope,
`font-mono`=JetBrains Mono; empty/missing value = em-dash `—` in `text-navy-3`, never `0`/`N/A`. Palette
(from the brief, all shipped tokens): navy `#1A2B47` / navy-2 `#2D3F5C` / navy-3 `#5C6675`; gold `#C8975B` /
gold-soft `#E8D4B8` (`border-gold-soft`) / gold-bg `#F5EBDC`; page `#FAF7F2` (`bg-bg`); surface `#FFFFFF`;
border `#E5DFD3` (`border-border`) / border-2 `#D4CCBA`; green `#2F6B47` / green-bg `#E5EFE8`; terra
`#B84A39` / terra-bg `#F5E1DC`; warn `#C58A2E` / warn-bg `#F5E9D0`; navy-deep `#13203A` (`bg-navy-deep`).

**Reused idioms (already shipped — do NOT reinvent):**

| Element | Where it lives | Exact classes / values |
|---|---|---|
| Summary cell (lead) | board `SummaryCell` | `rounded-xl border px-4 py-3.5`; lead → `border-gold-soft bg-gold-bg`; label `text-[10px] font-bold uppercase tracking-[0.14em] text-navy-3`; value `font-display text-3xl font-medium leading-none text-navy`; sub `mt-1.5 text-xs leading-relaxed text-navy-3` |
| Tile shell | board `Tile` | `rounded-xl border border-border bg-surface px-[22px] py-5`; title `font-display text-lg font-medium text-navy` with `<em className="not-italic text-gold">` accent; meta `text-[11px] text-navy-3` |
| Trend pill | `TrendPill` | glyph ▲/▼/— + sign, up `bg-green-bg text-green`, down `bg-terra-bg text-terra`, flat `bg-bg text-navy-3`; `rounded-pill px-2 py-0.5 font-mono text-[10px] font-bold`. **Only sanctioned state colour** — encodes sign of an EXPOSED delta, never a health verdict. |
| Honest-absence panel | `AbsencePanel` | `rounded-xl border border-border bg-surface px-[22px] py-[18px] text-[13px] leading-relaxed text-navy-3` — solid border, no number (treatment A). Reused for every NOT_CAPTURED drill-in. |
| Perf/rate bar | `PerfBar` | track `h-2.5 rounded-pill border border-border bg-bg`; fill tone `bg-green`/`bg-gold`/`bg-terra`/`bg-navy-3` capped 100; value `min-w-[42px] text-right font-mono text-xs font-semibold`, `—` when null |
| Column heads | `ColumnHeads` | `hidden … lg:grid border-b border-border bg-bg px-6 py-3 text-[9px] font-bold uppercase tracking-[0.1em] text-navy-3` |
| P/L/E/M/A status split | board `StatusSplit` + `ATTENDANCE_STATUS_META` | segmented bar `h-2.5 rounded-pill border border-border bg-bg`, per-status `.seg` fill (`bg-green`/`bg-gold`/`bg-warn`/`bg-navy-2`/`bg-terra`), `flexGrow: count`; readout `font-mono text-[10px]` `P n · L n · E n · M n · A n` in each status's `.num` colour |
| Gender mini-bar | board `EnrolmentBody` | `h-2.5 rounded-pill border border-border bg-bg`; female seg `style={{flexGrow, backgroundColor: "#C77B9E"}}`, male `"#6B86B0"`; readout `font-mono text-[10px] text-navy-3` `NF · NM`. **Sanctioned non-token inline hex** (school-stats pink/blue); per `no-alpha-token-opacity` never slash-opacity these. |
| Term-pill / segmented chip | `ReportFilters` | `rounded-pill border px-3 py-1 text-xs font-semibold`; active `border-navy bg-navy text-bg`; inactive `border-border-2 bg-surface text-navy-3 hover:border-gold hover:text-navy-2` |

**New surface classes introduced (three small ones — token-only):**

| New element | Build | Tokens |
|---|---|---|
| Action row (`ActionRow`, §5) | a link row: marker dot + label + value + chevron `›` | `flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 hover:bg-gold-bg`; label `text-[13px] font-semibold text-navy`; value `text-xs text-navy-3`; chevron `text-navy-3`; severity dot `h-2 w-2 rounded-full` in `bg-terra`/`bg-warn`/`bg-navy-2` |
| Disclosure toggle (`<DrillIn>` summary, §7) | `Break down ▾` / `Hide breakdown ▴` | `inline-flex items-center gap-1 text-xs font-semibold text-gold hover:underline` |
| Age-band stacked bar (§10.3) | one per age year — reuses the **gender mini-bar** verbatim | female `#C77B9E` / male `#6B86B0` inline segs; age label `font-mono text-[11px] text-navy-2` |

> **Token-opacity trap (memory `no-alpha-token-opacity`):** the action-panel hover (`hover:bg-gold-bg`), the
> disclosure, and every drill-in use **solid tint tokens** (`bg-gold-bg`, `bg-green-bg`, `bg-terra-bg`,
> `bg-warn-bg`, `bg-bg`). Do **not** reach for `bg-navy/80` / `text-bg/70` slash-opacity on raw-hex tokens.
> The gender/age pink & blue are the one sanctioned inline-hex exception (user-ish school-stats colours), and
> even those must not take slash-opacity — use solid hex + `flexGrow`. **Verify tints in the live preview,
> not the build.**

---

## 2. Page frame & section order (extends the board 1:1)

Server component, `dynamic="force-dynamic"`, `<div className="mx-auto max-w-page space-y-6">`. Order, with
[NEW]/[verbatim] marked:

1. **Header** — title + period selector row + "Export board pack" action. §3.
2. **Period selector** — `ReportFilters showClass={false}`, verbatim board. §3.
3. **Summary strip** — 5 `SummaryCell` (lead = roll). **[verbatim board]** §4.
4. **Needs your attention** — act-on-it action panel. **[NEW — the director-can-act differentiator]** §5.
5. **Financial position** — full-width `FinanceTile`. **[verbatim board]** §6.
6. **Attendance** \| **Enrolment** — `lg:grid-cols-2`. Each summary tile is board-verbatim; each gains an
   in-tile **drill-in** (Attendance: class/year; Enrolment: class/year + gender + age). §9, §10.
7. **Performance** \| **Infrastructure** — `lg:grid-cols-2`. Performance gains the class/year/subject
   drill-in; Infrastructure is board-verbatim (no drill-in requested). §8, §11.

The board's exact grid pairing is preserved; the drill-ins live **inside** their tiles (the tile grows
taller when opened). This is the "extend, don't redesign" answer — the scan layer is unchanged.

---

## 3. Header + period selector + export

**Header** (`flex flex-wrap items-start justify-between gap-3`):

- **Title** (`font-display text-xl font-medium text-navy`): **`Directors' `** `<em className="not-italic
  text-gold">`**`insights`**`</em>``.`  → renders "Directors' *insights*." (mirrors board's "Board
  *overview*.").
- **Sub** (`mt-1 text-[13px] text-navy-2`): `[dynamic]` `{termLabel} · consolidated director dashboard`
  where `termLabel` = `` `${period.label} · ${period.academicYear}` `` or `No academic period configured`
  (board's exact `termLabel`). The board's word is "read-only governance snapshot"; here it is
  **"consolidated director dashboard"** (this one acts).
- **Export action** (right): **`Export board pack`** — `rounded-md border border-border-2 bg-surface px-3
  py-1.5 text-xs font-semibold text-navy hover:bg-bg print:hidden`, `target="_blank" rel="noopener"`. Href
  carries the on-screen `?periodId`. **See drift #2 / §16:** the shipped board-pack route lives under
  `/board` and is `requireBoard()`-confined, so a director route can't reuse it as-is — it needs its own
  export endpoint (mirror `board-pack/route.ts` under the insights path, gated by the same role group) **or**
  the button is stubbed for v1. The button renders regardless; the target is the build dependency.

**Period selector** — `ReportFilters terms={rollup.terms} activePeriodId={rollup.period?.periodId ?? null}
showClass={false}` — **verbatim**. Writes `?periodId=<uuid>`; the page re-loads server-side (force-dynamic).
The whole page (summary + tiles + drill-ins) is scoped to the selected term, exactly as the board is.

---

## 4. Summary strip — the scan layer [verbatim board]

Five `SummaryCell` in `grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5`, **copied from the board with no
change** (same fields, same honest `—` + reason for non-CAPTURED, same `TrendPill` deltas):

| # | Cell | value | sub | lead? |
|---|---|---|---|---|
| 1 | **Students on roll** | `enrolment.data.roll` (en-GH) else `—` | `{male} boys · {female} girls` + `TrendPill(netChange, "this term", flat "no change")` else `reason` | **lead** (`bg-gold-bg`) |
| 2 | **Attendance rate** | `attendance.data.schoolRate + "%"` else `—` | `TrendPill(schoolDelta,"pts","vs last term")` or `(present + late) ÷ all marks` else `reason` | — |
| 3 | **Academic standing** | `academicSummary().value` (Basic avg %, else `{ready}/{total}` senior, else `—`) | `academicSummary().sub` (`{pass}% pass · N classes graded` + delta) | — |
| 4 | **Fee collection** | `feeCollections.data.collectionRate + "%"` else `—` | `{boardGhs(collected)} of {boardGhs(billed)} billed` else `reason` | — |
| 5 | **Facilities** | `infrastructure.data.classrooms.pctGood + "%"` else `—` | `{good}/{total} classrooms sound` else `reason` | — |

Keep `academicSummary()` verbatim (R357 — one tier's figure, never a blended number). Keep the omit-not-fake
discipline: a non-CAPTURED cell shows `—` + its reason string, never a fabricated `0`.

---

## 5. "Needs your attention" — the act-on-it panel [NEW]

The single feature that makes this the *director's* dashboard, not the board's mirror: a compact list of
**act-on-it rows**, each an aggregate signal + a chevron to the surface that fixes it. Placed directly under
the summary strip (highest scan priority after the KPIs).

**Section shell:** a `Tile` titled **`Needs your `**`<em>`**`attention`**`</em>``.` , meta `[dynamic]`
`{n} items` (omit meta when 0). Body = a `space-y-2` list of `ActionRow`s.

**`ActionRow`** (new, §1): `<Link href>` · severity dot · label + value · chevron `›`. Severity dot colour:
terra (urgent) / warn (watch) / navy-2 (informational). Rows are **only rendered when their condition is
genuinely true** (omit-not-fake — an absent problem is absent, never a green "all good" row inside the list).

**The rows (each conditional; sorted terra → warn → navy-2):**

| Row | Condition (from loaded data) | Value copy `[dynamic]` | Chevron → | Severity |
|---|---|---|---|---|
| **Outstanding fees** | `feeCollections.status==="CAPTURED" && outstanding > 0` | `{boardGhs(outstanding)} outstanding · {collectionRate}% collected` | Billing / fees surface | terra if `collectionRate < 60`, else warn |
| **Ungraded classes** | `classPerf.totalClasses - classPerf.classesGraded > 0` (Basic tier) | `{ungraded} of {totalClasses} classes have no gradebook scores for {termLabel}` | Gradebook / `/senior/academic-progress` | warn |
| **Attendance not captured** | `attendance.status !== "CAPTURED"` | the arm `reason` (e.g. `No attendance marked for Term 2 · 2025/26.`) | Attendance register | warn |
| **Census not filed** | `[assumed]` census return for the year is not submitted (§17) | `The GES annual census for {academicYear} is not yet submitted.` | Census surface | navy-2 (informational) unless a window deadline is near |
| **Facilities snapshot missing** | `infrastructure.status !== "CAPTURED"` | `No facilities snapshot captured yet.` | Facilities capture | navy-2 |
| **Senior readiness at risk** | `performance.senior.status==="CAPTURED" && subjectsAtRisk > 0` | `{subjectsAtRisk} subject(s) at risk for STPSHS · {subjectsPartial} partial` | `/senior/headmaster-summary` (the roll-up) | terra |

**Honest empty state** (all conditions false): a single positive line, **not** a blank tile —
`Everything's current — nothing needs your attention this term.` (`text-[13px] text-navy-3`, matching the
incr57 "Every subject on track" positive-empty convention). Distinct from a data-absent state.

> **Aggregate-only note:** every row is a school-wide count/amount or a subject count. None names a student or
> a parent. "Outstanding fees" is the school total, not a debtor list; "ungraded classes" is a class count,
> not a teacher list. The drill *into* each is the linked operational surface's own (permissioned)
> responsibility — the panel only surfaces the aggregate signal.

---

## 6. Financial position [verbatim board]

Full-width `FinanceTile` (`col-span-full`), **copied unchanged**. Title `Financial `*`position`*`.`; the lede
about three separate un-reconciled ledgers; then either `AbsencePanel(reason)` or the three `StreamCard`s —
**Fee collections** (`boardGhs(collected)` + `PerfBar(collectionRate, "gold", "%")` + outstanding),
**Books (this term)** (`Income`/`Expense`/`Net` via `Line`), **Payroll** (`schoolPaidMonthlyTotal` + GES /
allowance memos). **No drill-in** — a finance drill-in was not requested; keep the honesty invariant (never a
single summed "net position"; each stream keeps its own reason). If a director wants finance detail they
click through to the finance reports (a linked surface, out of scope here).

---

## 7. The drill-in interaction pattern (the crux)

One reusable client component drives all three drillable tiles.

### 7.1 `<DrillIn>` — the component

```
<DrillIn
  toggleLabel="Break down"                    // shows "Break down ▾" / "Hide breakdown ▴"
  dimensions={[
    { key: "class",   label: "By class",      content: <ClassBars … /> },      // server-rendered node
    { key: "year",    label: "By year group", content: <YearBars … /> },
    { key: "subject", label: "By subject",    content: <SubjectBars … /> },     // Performance only
  ]}
  defaultDim="class"
/>
```

- **`"use client"`**, ~30 lines. Holds `open` (bool) and `activeDim` (string). Renders: the disclosure
  toggle; when open, the **segmented control** (one chip per `dimensions[]`, ReportFilters pill idiom) + the
  active dimension's pre-rendered `content` node. That is the entire client footprint of the page.
- **`content` is a server-rendered ReactNode** (the bar list, already formatted with `PerfBar` /
  `StatusSplit` / gender bars and string labels). The server owns data + formatting (memory
  `reports-data-is-server-only`); the client only toggles which node is visible. **No student data can reach
  the client** — only aggregate JSX does.
- **No refetch on switch** — every dimension's node is in the RSC payload already (a handful of aggregate
  rows each). Instant. `defaultDim` = `"class"` for all three.
- **`dimensions[]` with one entry** → render the bar list with **no segmented control** (a single-dimension
  drill still gets the disclosure; the chip row is suppressed — mirrors the ledger class-switcher's
  "suppressed when only one" rule).

### 7.2 The bar-list anatomy (shared by all dimensions)

Each dimension's `content` is a list. Header row = `ColumnHeads` (`lg:grid`, hidden on mobile). Each data row
= a `grid` row: **label** (left, `text-[13px] text-navy` — a class/level/subject name, `font-mono` for level
codes) · **`PerfBar`** (the metric) · a small **mono readout** · optional **`TrendPill`**. Rows are sorted by
the readers (descending average / rate). A row with no captured value renders `—` (PerfBar null → `—`), never
`0`. If the whole dimension is empty → `AbsencePanel(arm.reason)` in place of the list.

> **Why segmented control, not tabs-as-routes or accordions:** the segmented control (a) is the shipped
> ReportFilters pill — zero new visual grammar; (b) keeps all dimensions one thumb-reach apart for scanning;
> (c) never navigates, so the tile's summary and the rest of the page don't reload. Accordions-per-dimension
> would stack three lists; a route-per-dimension is §0.2's rejected heavier path.

---

## 8. Performance tile + drill-in (by class · by year-group · by subject)

**Summary portion** = board `PerformanceTile` **verbatim**: title `Academic `*`performance`*`.`, meta
`cross-tier · this term`; Basic gradebook line (overall average % + pass rate + graded-classes + delta) and/or
Senior STPSHS-readiness line (`ready / partial / at risk`) and/or Terminal exams (BECE / WASSCE), each
honest-absence-gated on its own tier (omit-not-fake; `NOT_APPLICABLE` omitted).

**Drill-in** (`<DrillIn>`, three dimensions):

### 8.1 By class — source `getClassPerformance().rows` (`ClassPerfRow[]`)
Row grid (`ColumnHeads`: `Class · Avg · Grade · vs last term`):
- **Label:** `row.name` (`text-[13px] text-navy`).
- **Bar:** `PerfBar value={row.average} tone={row.tone} suffix="%"` (tone from `performanceTone`: ≥70 green /
  ≥50 gold / else terra; null → `—`).
- **Grade:** `row.grade` (`font-mono text-xs text-navy-2`) — from the school's own grade scale; `—` when null.
- **Trend:** `TrendPill(row.delta, "pts", "vs last term")` (null → no pill).
- **Mono caption** (secondary line / on mobile): `{studentsGraded} graded`.
- **Sorted** descending by average (reader already sorts). Ungraded class → `average=null` → `—` row.
- **Whole-dimension empty:** `performance.basic` NOT_CAPTURED → `AbsencePanel(basic.reason)`
  (e.g. "No gradebook scores recorded for Term 2 · 2025/26.").

### 8.2 By subject — source `getSubjectPerformance().rows` (`SubjectPerfRow[]`)
Same grid + one extra column (`ColumnHeads`: `Subject · Avg · Grade · Pass · vs last term`):
- **Label:** `row.name` (+ `row.code` in `font-mono text-[10px] text-navy-3` when present).
- **Bar:** `PerfBar value={row.average} tone={row.tone} suffix="%"`.
- **Grade:** `row.grade`.
- **Pass:** `row.passRate != null ? row.passRate + "% pass" : —` (`font-mono text-xs`) — the share ≥ PASS_MARK
  (50), aggregate per-score basis; null when nothing graded (never `0%`).
- **Trend:** `TrendPill(row.delta, "pts", "vs last term")`.
- **Sorted** descending by average. Empty → `AbsencePanel` (subject reader's honest empty).

### 8.3 By year-group (form level) — **derived; see §17 data note**
Rows = one per **`classes.level`** (e.g. `JHS 1` / `JHS 2` / `JHS 3`, or `Form 1` / `Form 2` / `Form 3`).
Row = level label · `PerfBar(levelAverage, performanceTone, "%")` · `{gradedClasses} of {classes} classes` ·
`TrendPill(levelDelta,"pts")`. **`levelAverage` must be a `studentsGraded`-weighted mean of the member class
averages, NOT a mean of means** (a mean of means over-weights small classes). Sorted by level order (numeric
within the tier), not by average, so the ladder JHS1→JHS3 reads top-to-bottom. Empty → the same
`basic.reason` panel.

> **Data note (§17-A):** `ClassPerfRow` carries no `level`. Either (a) project `classes.level` onto
> `ClassPerfRow` in `getClassPerformance` and reduce by level in-memory here (weighted by `studentsGraded`),
> or (b) Kofi adds a `byLevel` aggregate to a director-insights reader. `getSchoolStats().byClass` proves
> `level` is available on `classes`. **Recommend (a)** — one column added to an existing select, in-memory
> reduce, no new query. Flag for reconciliation.

---

## 9. Attendance tile + drill-in (by class · by year-group)

**Summary portion** = board `AttendanceTile` **verbatim**: title `Attendance `*`this term`*`.`, meta
`{totalMarked} marks recorded`; either `AbsencePanel(reason)` or the big `schoolRate%` + `TrendPill(schoolDelta,
"pts","vs last term")` (or the `(present + late) ÷ all marks` caption when delta null) + `StatusSplit(statusTotals)`
(the P/L/E/M/A segmented bar + mono readout). **Keep Medical (M) first-class navy-2** — it is the
sickbay→attendance readout, never folded into Absent (memory `attendance-five-statuses`).

**Drill-in** (`<DrillIn>`, two dimensions — no subject dimension for attendance):

### 9.1 By class — source `attendance.data.byClass` (`AttendanceClassRow[]`, already loaded in the rollup)
Row grid (`ColumnHeads`: `Class · Rate · P L E M A`):
- **Label:** `row.name`.
- **Bar:** `PerfBar value={row.rate} tone={attendanceTone(row.rate)} suffix="%"` (attendance scale: ≥90 green /
  ≥75 gold / else terra; null → `—`).
- **Status readout:** a **compact `StatusSplit(row.counts)`** — reuse the exact board component (the 5-status
  segmented bar + `P n · L n · E n · M n · A n` mono readout). This is the per-class P/L/E/M/A breakdown,
  aggregate counts only.
- **Mono caption:** `{marked} marks`.
- **Sorted** descending by rate (lowest-attendance classes are the ones a director watches — optionally sort
  ascending so the at-risk classes surface first; **recommend ascending by rate** so "who needs help" is at
  the top. Flag #5 — pick one.)
- A class with `rate=null` (marks exist but rate not derivable) or `marked=0` → `—` bar; whole-dimension
  NOT_CAPTURED → `AbsencePanel(attendance.reason)`.

### 9.2 By year-group (form level) — **derived; see §17 data note**
Rows = one per level; row = level label · `PerfBar(levelRate, attendanceTone, "%")` · a `StatusSplit` over the
**summed** P/L/E/M/A counts for the level · `{marked} marks`. **`levelRate` = (present + late) ÷ all marks over
the level's summed counts** (the board's own rate definition — recompute from summed counts, do not average
class rates). Sorted by level order.

> **Data note (§17-B):** `AttendanceClassRow` carries no `level`. Same fix as §8.3: project `classes.level`
> onto the attendance byClass row (in `getAttendanceSummary` / the rollup) and reduce by level in-memory. The
> level's rate/counts are honest sums, so no fabrication risk.

---

## 10. Enrolment tile + drill-in (by class · by year-group · gender split · age distribution)

**Summary portion** = board `EnrolmentTile` / `EnrolmentBody` **verbatim**: title `Enrolment `*`at a glance`*`.`,
meta `levelSummary`; roll headline + `TrendPill(netChange)`; the **gender mini-bar** (`NF · NM`); the structure
`Line`s (active classes / avg class size / teaching staff / student:teacher); the intake-this-term + lifetime
exits block with the honest per-term caveat. **No fabricated term-windowed zeros** (`—` for nulls).

**Drill-in** (`<DrillIn>`, dimensions: **By class · By year-group** + the two dedicated vizzes **Gender** and
**Age**). All four powered by **one reader**, `getCensusEnrolment(school.id)` (§17-C) — it returns `byClass`
(with `level`), `byLevel`, `ageByLevel`, `approvedAge`, `dobUnknown`, `censusDate`, all aggregate sex-split.

### 10.1 By class — source `census.byClass` (`CensusClassRow[]`: name, level, female, male, total)
Row grid (`ColumnHeads`: `Class · Enrolled · Girls / Boys`):
- **Label:** `row.name`.
- **Enrolled:** `row.total` (`font-mono text-navy`).
- **Gender bar:** the **gender mini-bar verbatim** — female `#C77B9E` seg (`flexGrow: row.female`) + male
  `#6B86B0` seg (`flexGrow: row.male`) in an `h-2.5 rounded-pill` track; readout `{female}F · {male}M`
  (`font-mono text-[10px] text-navy-3`).
- **Sorted** by class name (reader order). An `Unassigned` synthetic row appears **only** when unassigned
  active students exist (the reader adds it so tallies sum to roll — honest gap, not dropped). A zero-student
  class still lists (GES-style). Empty roll → `AbsencePanel("No students currently enrolled.")`.

### 10.2 By year-group (form level) — source `census.byLevel` (`CensusLevelRow[]`: level, female, male, total)
Same row shape, keyed on level; the gender mini-bar per level; sorted by level. **This is available directly
from the census reader — no derivation needed** (unlike performance/attendance year-group, §8.3/§9.2). An
`Unspecified` level row appears for classes with a null `level` (honest).

### 10.3 Gender split viz — school + per class/level
The gender split is the mini-bar seen twice:
- **School total bar** — a wide gender mini-bar over `census.gender` (`{female}F · {male}M · {total} total`),
  shown at the top of the Gender dimension (bigger than the per-row bars: `h-3`).
- **Per class/level bars** — reuse the §10.1/§10.2 rows' gender bars (the same bars, so "By class"/"By
  year-group" already *are* the gender split at that grain). The **Gender** dimension is therefore a
  thin wrapper: school total bar + a segmented sub-toggle (class ↔ level) reusing the §10.1/§10.2 lists. To
  avoid duplicating the segmented control, **recommend folding gender into the class/level rows** (they carry
  the bar already) and making **Gender** a school-level summary strip only:
  `{femalePct}% girls · {malePct}% boys · {total} on roll` with the wide bar. Lazy: the per-grain split is
  the class/level list; Gender = the school headline bar. (Flag #4 — confirm whether a standalone per-level
  gender table is wanted beyond the class/level lists already showing it.)

### 10.4 Age distribution viz — age bands × gender (the census hook)
The richest new viz. Source: `census.ageByLevel` (per-year buckets) + `census.approvedAge` (GES bands) +
`census.dobUnknown`. **A sub-toggle** (segmented, reusing the pill idiom) picks scope: **School** (sum
`ageByLevel` across levels per age) or **By level** (one level's `byAge`). Default = **School**.

**(a) Age histogram — gender-split stacked bars (primary form):**
One row per **age year** present, ascending (e.g. 12, 13, 14, 15…). Each row:
- **Age label:** `{age} yrs` (`font-mono text-[11px] text-navy-2`).
- **Stacked gender bar:** the **gender mini-bar verbatim** — female `#C77B9E` (`flexGrow: bucket.female`) +
  male `#6B86B0` (`flexGrow: bucket.male`), in an `h-2.5 rounded-pill` track. **Bar widths normalise across
  rows to the largest age bucket's total** so tall bars read as the modal age (compute `maxTotal =
  max(bucket.total)`; each row's track holds the female+male segs plus an empty spacer to `maxTotal` — or
  simply set the row's flex-basis proportional to `bucket.total / maxTotal`). This gives the histogram shape
  (a real distribution, not equal-width rows).
- **Readout:** `{bucket.female}F · {bucket.male}M · {bucket.total}` (`font-mono text-[10px] text-navy-3`).

> **Optional richer variant — population pyramid (flag #4):** female bars grow **left**, male bars grow
> **right**, from a centred axis, one row per age — the classic census pyramid. It's more custom CSS (two
> half-tracks + a centre rule) but reads beautifully for a school-age distribution. **Base spec = stacked
> bars (reuses the shipped mini-bar verbatim, zero new mechanics);** offer the pyramid only if the owner asks.

**(b) Approved-age bands (the GES "enrolment by approved age" — 3 tone-coded bands):**
Below the histogram, for the selected scope, `census.approvedAge` per level (or summed for School over levels
that *have* an official age). Three tone-coded readouts + a thin 3-segment bar:
- **On age** — `green` / `bg-green` seg — `count` at exactly `officialAge`.
- **Under age** — `gold` / `bg-gold` seg — younger than `officialAge`.
- **Over age** — `terra` / `bg-terra` seg — older than `officialAge`.
- **Unknown DOB** — `navy-3` / `bg-navy-3` seg — students with no DOB (never coerced to an age).
Label each: `{on} on age · {under} under · {over} over` (`font-mono text-[10px]`, each in its tone). Levels
with no GES official age (nursery/creche, unparseable label) are **omitted** from this band (the reader
already excludes them — you cannot assess "approved age" without an official reference). This is the direct
census cross-module hook (§16).

**(c) Honest DOB-unknown treatment (omit-not-fake, GOV8-05):**
`census.dobUnknown > 0` → a footnote under the age viz: `{dobUnknown} student(s) have no date of birth
recorded — they are counted in the roll but never assigned an age.` (`text-[11px] text-navy-3`). **Never
bucket unknowns into an age band.** If **every** student lacks a DOB (histogram empty), show only this
footnote + `AbsencePanel`-style note, not an empty chart.

**As-of note:** the census reader freezes ages to `censusDate` (default now). Show a small meta
`as of {censusDate}` (`text-[11px] text-navy-3`) so the director knows the age snapshot's reference point.
The census roll (ACTIVE now) reconciles with the summary tile's roll (also ACTIVE now) — they must match
(§17-C reconciliation note).

---

## 11. Infrastructure [verbatim board]

Board `InfrastructureTile` / `InfrastructureBody` **copied unchanged**: title `Infrastructure `*`& facilities`*`.`,
meta `{periodLabel} · {academicYear}`; `%` classrooms sound + count; the utilities / ICT / library / feeding /
textbooks `Line`s; honest `AbsencePanel(reason)` when no snapshot. **No drill-in requested** — facilities is
a latest-snapshot read, not a class/subject aggregate. Keep the captured-zero honesty (0 working computers,
handwashing false render as real values, never absence).

---

## 12. Interaction-state inventory (every state, per region)

| Region | State | Visual / copy |
|---|---|---|
| Period pill | active / inactive | `border-navy bg-navy text-bg` / `border-border-2 bg-surface text-navy-3 hover:border-gold` |
| Summary cell | captured / not-captured | value + sub / `—` + reason string (omit-not-fake); lead cell always `bg-gold-bg` |
| Trend pill | up / down / flat / none | `bg-green-bg text-green ▲` / `bg-terra-bg text-terra ▼` / `bg-bg text-navy-3 —` / no pill (`delta==null`) |
| Action row | present / hover | `border-border bg-surface` / `hover:bg-gold-bg`; severity dot terra/warn/navy-2 |
| Action panel | populated / **empty (GOOD)** | rows / `Everything's current — nothing needs your attention this term.` (positive empty, not blank) |
| Disclosure | closed / open | `Break down ▾` (`text-gold`) / `Hide breakdown ▴`; content region below |
| Dimension segment | active / inactive | period-pill classes (active `bg-navy text-bg`); **suppressed entirely when one dimension** |
| Drill-in bar row | captured / null | `PerfBar` fill + value / `PerfBar` `—` (null → empty track, `—` value), never `0` |
| Drill-in dimension | populated / empty | bar list / `AbsencePanel(arm.reason)` (the tier's honest reason) |
| Status split (P/L/E/M/A) | with marks / zero | segmented bar + mono readout / no segments when `total===0` (readout still shows `n 0` in each tone) |
| Gender bar | mixed / single-sex / empty | both segs / one seg (other `flexGrow:0`) / no segs when total 0 |
| Age histogram | populated / all-DOB-unknown | per-age stacked bars + approved-age bands / DOB-unknown footnote only + honest note |
| Approved-age band | has official age / no official age | 3-seg tone bar / level omitted (nursery/unparseable) |
| Facilities / attendance / senior arm | CAPTURED / NOT_CAPTURED / NOT_APPLICABLE | figure / `AbsencePanel(reason)` / omitted (tier doesn't apply) |
| Whole page | loading | `dynamic="force-dynamic"` SSR — first paint is populated; no client skeleton, no spinner (same as board) |
| Whole page | error | server component — a load failure throws to the route error boundary (existing behaviour); no inline error card |
| No period configured | — | summary cells `—`; each tile's arm renders its `No academic period configured.` reason; action panel may still show census/facilities rows |

---

## 13. Responsive / PWA

- **No dedicated PWA variant.** This is a **management desktop surface** (director/admin), like the
  headmaster-summary and board — the PWA form-factor belongs to the teacher's ledger. Responsive is pure
  Tailwind breakpoints, no separate component.
- **Summary strip:** `grid-cols-2 sm:grid-cols-3 lg:grid-cols-5` (board verbatim — stacks 2→3→5).
- **Tile pairs:** `grid gap-4 lg:grid-cols-2` (board verbatim — single column below `lg`).
- **Action panel:** rows are full-width `flex`; the value wraps under the label on narrow widths
  (`flex-wrap`), chevron stays right.
- **Drill-in:** `ColumnHeads` is `hidden lg:grid` (board/report-kit convention) — below `lg`, each row shows a
  stacked label + inline mono readout (the bar stays full-width). The segmented control `flex flex-wrap`.
- **Age histogram / gender bars:** already full-width bars; they reflow naturally. When the **Enrolment**
  drill-in (the tallest, with age + gender) is open on a half-width tile at `lg`, the age viz may feel tight
  — **optional:** let the Enrolment tile go `col-span-full` while its drill-in is open (a client class toggle
  the `<DrillIn>` already knows about). Default keeps the board grid; **verify in the live preview** (flag #7).

---

## 14. Accessibility

- **Disclosure** = a real `<button aria-expanded aria-controls>` toggling a region (or a native
  `<details>/<summary>` if the team drops the client component — the native element is keyboard/AT-complete
  for free). Focus-visible ring on the toggle and every segment chip.
- **Segmented control** = a `role="tablist"` of `role="tab"`/`aria-selected` buttons controlling one
  `role="tabpanel"`, **or** simple buttons with `aria-pressed` (lighter, fine for a 2–3 option switch). Arrow-key
  movement between segments is a nice-to-have, not required for 2–3 options.
- **Bars are decorative; numbers are authoritative.** Every `PerfBar` / gender bar / status seg is `aria-hidden`
  (the board already marks the segmented bars `aria-hidden`); the adjacent mono readout carries the real value
  for screen readers. Direction/severity never rely on colour alone — `TrendPill` carries a glyph + sign +
  text; status readout carries the letter (P/L/E/M/A); approved-age carries the word (on/under/over).
- **Contrast:** all text on `bg-surface`/`bg-bg` is navy/navy-2/navy-3 (AA). The pink/blue gender segs are
  decorative (`aria-hidden`), so their contrast is not a text concern; the `F`/`M` labels are navy-3 text.
- **Landmarks/headings:** each `Tile` is a `<section>` with an `<h2>`; the action panel and drill-in sub-lists
  use nested headings/labels so the page has a coherent outline. The action rows are links with descriptive
  text ("Outstanding fees — GHS … outstanding"), not "click here".
- **Chevron `›` / disclosure glyphs** are text with an accessible label on the link (the row's label text
  already describes the destination).

---

## 15. Component / build map (what actually gets written)

New route, board components reused. **No redesign of the board; a small lift of its shared primitives.**

| Surface region | Reuse (shipped) | New work |
|---|---|---|
| Page frame | headmaster-summary frame (`requireSchoolRole`, `dynamic`, `max-w-page`) | `app/(app)/directors/page.tsx` (or `/senior/insights` — §0.1) |
| Header + period | board header block + `ReportFilters` | copy structure; swap copy; wire `Export board pack` href (needs own export route — drift #2) |
| Summary strip | board `SummaryCell` + `academicSummary()` | verbatim; **lift `SummaryCell` into `components/board/board-tiles.tsx`** so both pages import it |
| Financial / Infrastructure tiles | board `FinanceTile` / `InfrastructureTile` + `StreamCard`/`Line` | verbatim; lift `Tile`/`Line`/`StreamCard` to the shared pure module |
| **Needs your attention** | `Tile` shell + `<Link>` | new `ActionRow` + the conditional-row logic (all fields from already-loaded arms + class-perf totals; census flag = §17-D) |
| **`<DrillIn>`** | ReportFilters pill idiom | new ~30-line client component (`open` + `activeDim`, renders server-node slots) |
| Performance drill-in | `getClassPerformance` (loaded), `getSubjectPerformance` (new call), `PerfBar`, `ColumnHeads`, `TrendPill` | `ClassBars`/`SubjectBars`/`YearBars` server nodes; year-group needs `level` on `ClassPerfRow` (§17-A) |
| Attendance drill-in | `attendance.data.byClass` (loaded), board `StatusSplit`, `attendanceTone`, `PerfBar` | `ClassBars`/`YearBars`; **lift `StatusSplit` to the shared pure module**; year-group needs `level` (§17-B) |
| Enrolment drill-in | gender mini-bar (board), `PerfBar` | `getCensusEnrolment` call; `ClassBars`/`YearBars`/`GenderViz`/`AgeViz` server nodes (§17-C) |
| Absence / empty states | `AbsencePanel`, headmaster-summary dashed-card copy | reuse verbatim |
| Role gate | `requireSchoolRole` | `STAFF_ADMIN_ROLES` or a new `DIRECTOR_INSIGHTS_ROLES` (§0.4, drift #1) |

**Shared-primitive lift (small, low-risk refactor):** `Tile`, `SummaryCell`, `StatusSplit`, `Line`,
`StreamCard`, and the gender-bar constants (`FEMALE_HEX`/`MALE_HEX`) are currently **local functions in
`app/(board)/board/page.tsx`**. To reuse them 1:1 without duplication, lift them into
`components/board/board-tiles.tsx` (already the pure, `server-only`-free "these own the pixels" module) and
import them into **both** the board page and the insights page. Pure move, no behaviour change, keeps the
board render tests green. **This is the only edit to a shipped file; verify the board still renders
identically in the live preview.** (If the team prefers zero changes to `board/page.tsx`, duplicate the five
tiny helpers into `components/insights/` instead — flag #3.)

**Data loads (server, in `Promise.all`):** `getSchoolRollup(school.id, {periodId})` (summary + all tiles +
attendance/enrolment byClass) · `getClassPerformance(school.id, {periodId})` (class + year-group performance)
· `getSubjectPerformance(school.id, {periodId})` (subject performance) · `getCensusEnrolment(school.id)`
(enrolment by-class/level + gender + age). Each is an existing aggregate reader.

---

## 16. Cross-module hooks (design commitments to preserve)

| Hook | Where on this surface | Preserve as |
|---|---|---|
| **fee collection → billing** | "Outstanding fees" action row (§5) + Financial tile | The aggregate outstanding amount is the signal; the chevron routes to the billing surface where a director acts. Never a debtor/student list here. |
| **score ledger → STPSHS export** | "Senior readiness at risk" action row + Performance drill-in senior line | The `ready / partial / at risk` counts are the STPSHS-readiness answer; the chevron routes to `/senior/headmaster-summary` (the subject roll-up), the drill toward the STPSHS export. |
| **sickbay → attendance ("M")** | Attendance `StatusSplit` (summary + per-class/level drill-in) | Medical (M) stays a first-class navy-2 status, never folded into Absent — the sickbay→register readout is visible at school, class, and year-group grain. |
| **census → enrolment (age × sex × approved-age)** | Enrolment age-distribution viz + approved-age bands (§10.4) + "Census not filed" action row | The GES census disaggregation (`getCensusEnrolment`) is surfaced here as a live director viz; the action row nudges filing. The age/approved-age figures ARE the census input — keep the honesty (DOB-unknown never aged, no-official-age levels omitted). |
| **ledger trajectory → WASSCE predictor** | Performance drill-in (senior) — **future drill-through** | Out of this build's scope, but the by-subject/by-class senior figures are the predictor's input; leave the Performance drill-in as the natural future entry point (a subject → WASSCE-predictor link). Do not build now; note the seam. |
| **board pack export** | Header "Export board pack" (§3) | The insights figures ARE the board-pack input; the export must render the same term's aggregate. Needs its own role-gated export route (drift #2). |

---

## 17. Data-shape assumptions to reconcile with Kofi

Everything the surface **assumes** about readers/fields, so the two specs meet cleanly. **A–C are the crux;
D–E are the action panel.**

- **§17-A — Performance by year-group needs `level` on `ClassPerfRow`.** `getClassPerformance` returns no
  `level`. Assumption: project `classes.level` onto `ClassPerfRow` (one column on the existing select) and
  reduce by level in-memory, `studentsGraded`-weighted mean. No new query. (`getSchoolStats.byClass` confirms
  `level` exists.) If Kofi prefers a first-class `byLevel` aggregate in the reader, the surface consumes that
  instead — same shape (`{level, average, gradedClasses, classes, delta}`).
- **§17-B — Attendance by year-group needs `level` on `AttendanceClassRow`.** Same as A: project `classes.level`
  onto the attendance byClass row, reduce by level, recompute `rate = (present+late) ÷ all marks` from summed
  counts (not an average of class rates). No new query.
- **§17-C — Enrolment drill-in + gender + age all source `getCensusEnrolment(school.id)`.** It already returns
  `byClass` (with level), `byLevel`, `ageByLevel` (per-year sex split + `dobUnknown`), `approvedAge`
  (under/on/over/unknown vs `officialAgeForLevel`), `dobUnknown`, `censusDate`. **Reconciliation:** the census
  roll is ACTIVE as-of `censusDate` (default now); the summary Enrolment tile's roll is ACTIVE now
  (`getSchoolStats`). They must match — confirm both are ACTIVE-only and un-windowed, or pass the same
  reference date. If Kofi's insights reader already computes age/gender, the surface consumes that instead;
  the shapes above are the contract.
- **§17-D — "Census not filed" action row needs a filed/unfiled signal.** The census track (GOV-9) has a
  `census_return` concept. Assumption: a cheap boolean "is there a submitted census return for
  `(school, academicYear)`?" — a small reader or a field on the return. If none exists yet, **omit this row**
  (omit-not-fake) until Kofi exposes the signal. Do not fabricate a "due" state.
- **§17-E — "Ungraded classes" needs `totalClasses` + `classesGraded`.** Both are on
  `ClassPerformance` (`totalClasses`, `classesGraded`) — already loaded for the drill-in. The rollup's
  `BasicPerformanceSummary` exposes only `gradedClasses`, so **compute the ungraded count from
  `getClassPerformance`, not the rollup arm.** No new data.
- **§17-F — Export route.** The insights "board pack" needs a role-gated export endpoint (mirror
  `app/(board)/board/board-pack/route.ts`) under the insights path, since the shipped one is `requireBoard()`
  + `/board`-confined. Kofi/PO to confirm scope; the button renders either way.

---

## Open questions / drift log (consolidated)

1. **Route + role gate (§0.1, §0.4).** New route `app/(app)/directors/` vs `app/(app)/senior/insights/`; gate
   `STAFF_ADMIN_ROLES` vs `SENIOR_MANAGEMENT_ROLES` vs a new `DIRECTOR_INSIGHTS_ROLES`. Recommend a dedicated
   per-surface group seeded = `STAFF_ADMIN_ROLES`. **Gate to the spec, never copy a wider sibling** (memory
   `builds-widen-ratified-authz`). Confirm with PO.
2. **"Export board pack" target (§3, §17-F).** The shipped board-pack route is `requireBoard()`/`/board`-confined
   — a director route can't reuse it. Needs its own role-gated export endpoint, or the button stubs for v1.
   Confirm scope.
3. **Shared-primitive lift (§15).** Lifting `Tile`/`SummaryCell`/`StatusSplit`/`Line`/`StreamCard` from
   `board/page.tsx` into the pure `board-tiles.tsx` is the clean reuse (one shipped-file edit, verify board
   unchanged in preview). Alternative: duplicate the five tiny helpers into `components/insights/`. Recommend
   the lift. Confirm.
4. **Gender/age viz depth (§10.3, §10.4).** (a) Is a standalone per-level gender table wanted, or is the
   gender split adequately shown by the per-class/level rows' mini-bars (recommend the latter; Gender = school
   headline bar only)? (b) Age viz: stacked gender bars (base, reuses shipped mini-bar) or the population
   pyramid variant (richer, custom CSS)? Recommend stacked for v1. Confirm.
5. **Attendance drill-in sort (§9.1).** Sort classes/levels **ascending by rate** (worst-first, "who needs
   help" at top) or descending? Recommend ascending for the director's watch-list read. Confirm.
6. **Drill-in mechanic (§0.2).** In-page `<DrillIn>` client component (recommended, instant switch) vs
   zero-JS `<Link>`-chip URL-param dimension switch (heavier nav, native-`<details>` state loss). Recommend the
   client component. Confirm if the team wants zero client JS.
7. **Enrolment tile width when open (§13).** Optionally let the Enrolment tile go `col-span-full` while its
   (tall) age+gender drill-in is open, else keep the board 2-col grid. Verify in the live preview
   (memory `no-alpha-token-opacity` — tints + this layout are preview checks, not build checks).
8. **Year-group label vocabulary.** Use the school's own `classes.level` text verbatim ("JHS 3" / "Form 2" /
   "Primary 5") — do not normalise or invent labels. The census reader already sorts levels lexically; if a
   numeric tier order is wanted (JHS1→JHS3), sort on the parsed level number. Confirm the ordering rule.

---

*Map produced against: `app/(board)/board/page.tsx`, `components/board/board-tiles.tsx`,
`components/reports/report-kit.tsx`, `components/reports/report-filters.tsx`, `lib/rollup/school-rollup.ts`,
`lib/reports/class-performance-data.ts`, `lib/reports/subject-performance-data.ts`,
`lib/reports/census-enrolment-data.ts`, `lib/reports/school-stats-data.ts`, `lib/attendance-status.ts`,
`lib/access.ts`, `app/(app)/senior/headmaster-summary/page.tsx`; tokens from `md files/design-tokens.json` +
`styles/tokens.css`. Follows the shape of `docs/senior/ledger-surface-map.md` and
`docs/senior/incr57-headmaster-rollup-surface-map.md`. Aggregate-only is a hard constraint — every drill-in
row is a class / year-group / subject / age-band, never a student.*
</content>
</invoke>
