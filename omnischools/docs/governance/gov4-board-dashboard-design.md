# GOV-4 — Board / Director Dashboard — Surface Map (designed from scratch)

**Author:** Lucy (design cartographer) · **Status:** build-ready design spec, for the implementation engineer.
**Route:** `/board` (the existing `app/(board)/board/page.tsx`) · **Guard:** `requireBoard()` — BOARD_MEMBER only.
**Supersedes:** the minimal GOV-2/3 shell now living in `app/(board)/board/page.tsx` (top 3-KPI strip + the `FinancialPosition` section). This spec elevates that shell into the full, honest 5-tile governance dashboard and **removes the GOV-2/GOV-3 finance duplication** (see §0.2).

There is **no source surface** for this view. The `Surfaces/schoolup-oversight-*.html` files are the **Phase-5 cross-tenant regulator tier** (deep-navy `#13203A` chrome, district/regional/national scope, peer comparison) — a *grammar reference only*. The board view is **one school, live, read-only, no cross-school comparison**. Where the oversight grammar assumes "a number against its peers is oversight," the board view has no peers; **state is encoded by trend and by honest-absence, not by comparison.**

---

## 0. The three things this design has to get right

### 0.1 Honest absence is a first-class visual system, not an afterthought
Every arm is a `RollupArm<T>` = `CAPTURED | NOT_CAPTURED | NOT_APPLICABLE`. On top of that the dashboard adds a **fourth, distinct** state — **NOT_YET_CAPTURED ("coming soon")** — for capabilities that are *not built yet* (Performance terminal results until GOV-6; the whole Infrastructure tile until GOV-7). These four map to **three visual treatments** (§8). A not-yet-captured tile must never look like a real zero or a real attention state, and must never render a fabricated number.

### 0.2 Finance appears exactly ONCE
The GOV-2 shell shows a top **"Fees collected" GHS KPI** *and* the GOV-3 `FinancialPosition` section repeats the same fee-collections figure — the same number in two competing homes. The redesign:
- The **Finance tile** (§4) is the single authoritative home for the three streams (fees · books · payroll).
- The **summary strip** (§3) carries finance as the **collection *rate* %** (a within-fees ratio, the scan headline for the tile below it) — *not* a second GHS "collected" figure. Summary→detail repetition of a headline is expected; two coordinate finance *sections* is the wart, and it's gone.

### 0.3 Read-only governance framing
No operational controls, no edit affordances, **no drill-into-edit**, no links out to the staff `(app)` report routes (the board route group doesn't contain them and the BOARD_MEMBER isn't admitted there). Permitted interaction: the **period selector** (term pills, `?periodId`) and a **stubbed board-pack PDF** link (GOV-5). That is the entire interaction surface.

---

## 1. Sources & canonical inputs

| Input | Role |
|---|---|
| `md files/design-tokens.json` (v1.0.0) | canonical tokens — navy/gold/green/terra/warn, Fraunces/Manrope/JetBrains Mono. **Do not invent a new system.** |
| `app/(board)/board/page.tsx` (GOV-2/3) | the shell being elevated — reuse the `boardTile`/`boardGhs` honesty helpers and the 3-stream `FinancialPosition` verbatim as the Finance tile body. |
| `app/(board)/layout.tsx` | the board chrome (school crest header, `main` at `max-w-[980px]`, `SignOutButton`, `print:hidden` header). **The dashboard is designed to fit `max-w-[980px]`.** |
| `lib/rollup/school-rollup.ts` | the data spine — `SchoolRollup` with `enrolment`, `attendance`, `feeCollections`, `netPositionFinance` arms + `period`. **No `performance` arm and no `terms` list yet — see §9 flags.** |
| `lib/board/tiles.ts` | `boardTile(arm, fn)` narrows on status so a NOT_CAPTURED arm can never render a number; `boardGhs(n)` → `"GHS 41,200"`. Reuse for every headline. |
| `components/reports/report-kit.tsx` | `KpiStrip`, `FeaturedKpi`, `Kpi`, `SectionCard`, `ColumnHeads`, `PerfBar`, `SnapshotPill` — reuse for the summary strip, tile shells, and rate bars. |
| `components/reports/report-filters.tsx` | `ReportFilters` (term pills → `?periodId`, `showClass={false}`) — reuse verbatim as the period selector. |
| `lib/attendance-status.ts` | `ATTENDANCE_STATUS_ORDER` + `ATTENDANCE_STATUS_META` (`.seg/.letter/.label/.num/.borderL`) — reuse for the 5-status split (P·L·E·M·A). **Keep all 5 statuses** (Medical is the sickbay→attendance "M" hook; memory `attendance-five-statuses`). |
| `Surfaces/schoolup-oversight-school-detail.html` | **grammar reference only** — the `.kpi-strip`/`.kpi-card`/`.k-delta` trend-pill vocabulary and the `.panel` card grammar. Do **not** replicate its deep-navy chrome, its detail-tabs, or any peer-comparison copy. |

### 1.1 Token & type quick-reference (use the Tailwind class, never raw hex/`var()`)
`bg-navy`/`text-navy` `#1A2B47` · `text-navy-2` `#2D3F5C` · `text-navy-3` `#5C6675` (muted/captions/dashes) · `text-gold`/`bg-gold` `#C8975B` · `border-gold-soft` `#E8D4B8` · `bg-gold-bg` `#F5EBDC` · `bg-bg` `#FAF7F2` · `bg-surface` `#FFFFFF` · `text-green`/`bg-green-bg` (up/healthy) · `text-terra`/`bg-terra-bg` (down/attention) · `text-warn`/`bg-warn-bg` (partial/pending) · `border-border` `#E5DFD3` · `border-border-2` `#D4CCBA`.
**Type:** `font-display` = Fraunces (headings + stat numbers, italic gold `<em>` accent); `font-body`/default = Manrope; `font-mono` = JetBrains Mono (**every currency, %, count, ratio, delta**). Currency: `GHS 41,200` via `boardGhs` (never `GH₵`/`Ghc`). Empty value: `—` in `text-navy-3` (never `0`/`N/A`/`null`).

---

## 2. Layout, order & hierarchy (within `max-w-[980px]`)

Summary-before-detail. Three bands, top to bottom:

```
┌─ HEADER ──────────────────────────────────────────────────────────┐
│  Board overview.        [period pills]   [Board pack (PDF) · stub] │
│  Term 2 · 2025/26 · read-only governance snapshot                  │
├─ SUMMARY STRIP — the scan layer (§3) ─────────────────────────────┤
│  [Enrolment*] [Attendance] [Performance] [Fee collection] [Infra]  │   *lead = gold-gradient
├─ DETAIL TILES — the read layer ───────────────────────────────────┤
│  ┌─ 1 · FINANCE (full width, 3 streams) ──────────────────────┐    │
│  │  Fee collections │ Books (this term) │ Payroll              │    │
│  └────────────────────────────────────────────────────────────┘    │
│  ┌─ 2 · ATTENDANCE ─────────┐  ┌─ 3 · ENROLMENT ─────────────┐     │
│  │ rate + trend + P·L·E·M·A │  │ roll + gender + classes …   │     │
│  └──────────────────────────┘  └─────────────────────────────┘     │
│  ┌─ 4 · PERFORMANCE ────────┐  ┌─ 5 · INFRASTRUCTURE ────────┐     │
│  │ Basic avg / SHS readiness│  │ Coming soon (GOV-7)         │     │
│  │ + terminal: coming soon  │  │ (dashed placeholder)        │     │
│  └──────────────────────────┘  └─────────────────────────────┘     │
└────────────────────────────────────────────────────────────────────┘
```

- **Tile order = brief order** (Finance 1 · Attendance 2 · Enrolment 3 · Performance 4 · Infrastructure 5). Finance is full-width (needs room for three streams) and leads the read layer because sustainability is the board's first question.
- **Grid classes:** summary strip `grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5`; Finance tile `col-span-full`; the two 2-up rows `grid gap-4 lg:grid-cols-2`. Vertical rhythm `space-y-6` between bands (matches the shell's `mt-8`).
- **Mobile (< `lg`):** everything stacks single-column; the summary strip becomes 2-up then 3-up; the Finance streams stack (`sm:grid-cols-3` collapses to one column).

---

## 3. Summary strip — the scan layer

Five cells, one per domain, uniform grammar so the board reads *state* in one pass. Each cell is `boardTile`-driven: CAPTURED → headline + trend/context; else → the honest-absence treatment (§8). **This strip encodes state; it does not re-house any tile's full breakdown.**

Cell shell (from `report-kit`): `Kpi` for four; `FeaturedKpi` (navy) *or* a gold-gradient `.lead` variant for the first (Enrolment) as the size-of-school anchor. Label = `text-[10px] font-bold uppercase tracking-[0.14em]`; value = `font-display text-3xl`; sub = `text-xs text-navy-3`.

| # | Label (copy) | Value (arm · field) | Sub / state |
|---|---|---|---|
| 1 · lead | `Students on roll` | `enrolment.roll` (`toLocaleString`) | `enrolment.gender` → `"18 boys · 14 girls"`; **trend pill** from `netChange` (`▲ +12 this term` / `▼ −3 this term` / `— no change`); `netChange == null` → sub `point-in-time roll`. |
| 2 | `Attendance rate` | `attendance.schoolRate` → `"90.2%"` (or `—` if `null`) | **trend pill** from `schoolDelta` vs prior term (`▲ +1.8 pts` / `▼ −1.8 pts` / `— level`); `schoolDelta == null` → sub `(present + late) ÷ all marks`. |
| 3 | `Academic standing` | `performance` headline (Kofi — see §6) | band pill (green/gold/terra); absent → §8 treatment. |
| 4 | `Fee collection` | `feeCollections.collectionRate` → `"82%"` | sub `GHS 41,200 collected of GHS 50,100 billed` (`boardGhs`). **Rate only — the GHS composition lives once, in the Finance tile.** |
| 5 | `Infrastructure` | — | **coming-soon chip** (§8.C): dashed, italic `Not yet captured`. Never a number. |

When `period == null`, cells 2/3/4 show their NOT_CAPTURED reason (`"No academic period configured."`) as the sub with value `—`; cell 1 still shows the live roll; cell 5 stays coming-soon.

---

## 4. Tile 1 · Finance — net position, three honest streams

**Arm:** `netPositionFinance: RollupArm<NetPositionFinanceArm>` (`{ fees, books, payroll }`). **Reuse the shell's `FinancialPosition` + `StreamCard`/`Headline`/`Caption`/`Reason`/`Line` verbatim** — it is already correct; this tile is that component, promoted to `col-span-full` and given the tile header treatment below.

- **Tile header:** `font-display text-lg` → `Financial <em class="not-italic text-gold">position</em>.` · caption (`text-[13px] text-navy-3 max-w-2xl`): *"Three separate records shown side by side. Fee collections and the school's books are kept as separate ledgers and are not combined into a single profit; payroll is a current monthly figure."* (verbatim from the shell — the honesty invariant, R349/R350).
- **Whole-arm absence** (`period == null`): one `border-border bg-surface` panel with `arm.reason` (`"No academic period configured."`). No streams, no zeros.
- **CAPTURED → three `StreamCard`s (`grid gap-4 sm:grid-cols-3`):**

| Stream | Fields (arm) | Copy / states |
|---|---|---|
| **Fee collections** | `fees` (= `feeCollections`, reused verbatim so it can never disagree) | CAPTURED: `Headline` = `boardGhs(collected)`, `Caption` = `collected · this term`. **Add** a `PerfBar` of `collectionRate` (tone `gold`) + `outstanding` line `GHS x outstanding`. NOT_CAPTURED (no fees billed) → `Reason` (`"No fees billed for Term 2 · 2025/26."`). |
| **Books (this term)** | `books` → `{income, expense, net}` | CAPTURED: `dl` with `Line` Income / Expense / **Net** (`strong`), all `boardGhs`. `net` is the **only** permitted cross-line composite (income − expense, within the books ledger). NOT_CAPTURED → `Reason` (`"No books entries recorded for Term 2 · 2025/26."`). |
| **Payroll** | `payroll` → `schoolPaidMonthlyTotal` + GES/allowance memos | CAPTURED: `Headline` = `boardGhs(schoolPaidMonthlyTotal)`, `Caption` = `school-paid · gross · monthly`; memo lines `GES-paid (memo, not added): GHS x` and, if `allowanceMonthlyMemo > 0`, `Allowance (memo, not added): GHS x` (both `text-[11px] text-navy-3`). **NOT_APPLICABLE** (school runs no payroll) → `Reason` (`"This school does not run payroll in Omnischools."`). |

**Honesty guardrails to preserve:** never sum across ≥2 streams; the three headline numbers stay distinct and separately labelled; a captured `GHS 0` renders (true zero), a not-captured stream renders its reason and no number.

---

## 5. Tile 2 · Attendance — rate, trend, five-status split

**Arm:** `attendance: RollupArm<AttendanceArm>` (`schoolRate`, `schoolDelta`, `totalMarked`, `statusTotals`, `byClass`).

- **Header:** `Attendance <em class="not-italic text-gold">this term</em>.` · meta `{totalMarked} marks recorded`.
- **Absence** (`period == null`, or `totalMarked == 0`): `Reason` — `"No academic period configured."` / `"No attendance marked for Term 2 · 2025/26."` (SOLID-border treatment, §8.A).
- **CAPTURED:**
  1. **Headline row:** `schoolRate` (`font-display text-3xl`, or `—` if `null`) + **trend pill** from `schoolDelta` (`▲ +1.8 pts vs Term 1` green / `▼ −1.8 pts` terra / `— level`); `schoolDelta == null` → caption `(present + late) ÷ all marks`.
  2. **Five-status split** (aggregate, no PII): the segmented bar + per-status readout, reused from the attendance-summary page — iterate `ATTENDANCE_STATUS_ORDER`, colour each segment with `ATTENDANCE_STATUS_META[s].seg`, flex-grow by count; below it a `font-mono text-[10px]` readout `P·L·E·M·A` = `{present}·{late}·{excused}·{medical}·{absent}`. **Medical (M) is kept as its own status** (navy-2 tint) — it is the sickbay→attendance cross-module readout.
- **Available but deferred to keep the tile scannable:** `byClass[]` (per-class rates, aggregate — no PII). Do **not** render the full table here; optionally a one-line `N classes marked · lowest {name} {rate}%`. Full by-class belongs to the (future, non-board) operational report, not the governance tile. Note in build: `byClass` is on the arm if a later iteration wants an expandable.

---

## 6. Tile 3 · Enrolment — roll, gender, classes, intake

**Arm:** `enrolment: RollupArm<EnrolmentArm>`.

- **Header:** `Enrolment <em class="not-italic text-gold">at a glance</em>.` · meta `enrolment.levelSummary` (e.g. `"KG1–JHS3"` / `"Form 1–3"`).
- **Absence:** NOT_CAPTURED only at zero roll → `Reason` `"No students currently enrolled."` (enrolment is point-in-time; it populates even with `period == null`).
- **CAPTURED — four regions (compact, no PII):**
  1. **Roll headline** + **net-change trend pill** (`netChange`: `▲ +12 this term` / `▼ −3` / `—`; `null` → `point-in-time roll`).
  2. **Gender mini-bar:** `gender.female`/`gender.male` counts + `femalePct`/`malePct`. Reuse the school-stats **pink/blue** palette (`FEMALE #C77B9E` / `MALE #6B86B0`) via inline `style` — a sanctioned non-token exception (as school-stats already does; memory `no-alpha-token-opacity` — no slash-opacity on these hexes). Two flex segments + `font-mono` `"18F · 14M"`.
  3. **Structure lines** (`dl`, `Line` grammar): `Active classes` = `activeClasses` · `Avg class size` = `avgClassSize` · `Teaching staff` = `teachingStaff` · `Student:teacher` = `studentTeacherRatio == null ? "—" : "{n}:1"`.
  4. **Intake this term:** `admissionsThisTerm` new admissions (`intakeFemale`/`intakeMale` split); each `null` when `period == null` → render `—`, never `0`. **Lifetime exits** (labelled *lifetime*, cumulative): `withdrew` / `transferred` / `graduated` (+ `lifetimeExits` total). Copy: *"Withdrawals, transfers and graduations are current lifetime totals — per-term exit dating arrives when status history is tracked."* (matches the school-stats caveat).

---

## 7. Tile 4 · Performance — cross-tier, live + coming-soon terminal

**Arm:** `performance` — **NOT ON `SchoolRollup` YET** (Kofi is speccing it in parallel; §9 flag #1). This tile is designed against the expected shape: a cross-tier aggregate arm carrying **Basic gradebook averages** and **Senior readiness**, each `RollupArm`-wrapped so honest-absence flows through unchanged.

- **Header:** `Academic <em class="not-italic text-gold">performance</em>.` · meta `cross-tier · this term`.
- **Live region (top) — whatever tier(s) the school runs:**
  - **Basic:** school-wide gradebook average (e.g. `72%`) + band pill via `grade-band` `PerfTone` (green/gold/terra) — or per-level averages as short `PerfBar` rows if Kofi exposes them.
  - **Senior:** **readiness** — e.g. `"31 of 37 STPSHS-ready"` or a readiness %, reusing the score-ledger completion vocabulary (`ready` green / `behind` warn / `at-risk` terra). This is the ledger→STPSHS cross-module output surfaced at governance depth.
  - A COMBINED (Basic+Senior) school shows both, stacked/labelled per tier.
  - Absence (no gradebook/ledger data this term) → NOT_CAPTURED `Reason` (§8.A).
- **Terminal results sub-section (bottom) — COMING SOON (GOV-6):** a dashed sub-panel (§8.C) — **never a number**:
  > eyebrow `Terminal results` · `font-display italic text-navy-3` **"BECE & WASSCE results — coming soon"** · tag `Arrives with results capture · GOV-6`.
  This is where the **ledger-trajectory → WASSCE predictor** hook and BECE outcomes will land. Until GOV-6 the board sees a deliberate placeholder, **not** a fabricated pass-rate.

---

## 8. Tile 5 · Infrastructure — wholly coming-soon (GOV-7)

**No arm.** A hard-coded, deliberate placeholder — the canonical coming-soon treatment (§8.C):
- **Header:** `Infrastructure <em class="not-italic text-gold">&amp; facilities</em>.`
- **Body:** dashed tile, `font-display italic text-navy-3` **"Not yet captured"** · body `text-[13px] text-navy-3`: *"Facilities, assets and maintenance tracking arrives in a later release."* · tag `GOV-7`.
- No number, no pill, no zero. This tile is the reference implementation of the coming-soon look; Performance's terminal sub-section reuses it.

---

## 9. The honest-absence system — three visual treatments (consolidated)

The dashboard must make four data-states legible and **mutually distinguishable at a glance**. They collapse to three looks:

| Treatment | Applies to | Container | Content | Reads as |
|---|---|---|---|---|
| **A · Reason (solid)** | `NOT_CAPTURED` (real feature, no data *this term*) and `NOT_APPLICABLE` (structurally n/a, e.g. no payroll) | `rounded-xl border border-border bg-surface` (SOLID) | `arm.reason` string in `text-[13px] text-navy-3`, **no number** | "this exists, there's just nothing to show yet / here" |
| **B · Real zero** | `CAPTURED` with a genuine `0` (e.g. `GHS 0` collected, `0%` rate) | normal tile | the real `0`, normal `font-display`/`font-mono` styling | "a true, measured zero" |
| **C · Coming soon (dashed)** | **NOT_YET_CAPTURED** — capability not built (Performance terminal → GOV-6; Infrastructure → GOV-7) | `rounded-xl border border-dashed border-border-2 bg-bg` (DASHED) | eyebrow + `font-display italic text-navy-3 "Coming soon" / "Not yet captured"` + milestone tag (`GOV-6`/`GOV-7`), **no number** | "a deliberate placeholder for something not built yet" |

**The critical distinctions the brief demands:** C (dashed, uncoloured, italic "coming soon") ≠ B (a real coloured/typed zero) ≠ an **attention** state (a *terra* trend pill on a captured number, §10). A not-yet-captured tile is never coloured green/terra and never carries a figure. The `boardTile` helper already makes fabricating a number for a non-CAPTURED arm a **compile error** — lean on it; treatment C is authored inline (no arm) but must obey the same "no number" rule.

---

## 10. State-encoding vocabulary — form, not just numbers (consolidated)

State is encoded honestly, from data the aggregate rollup actually exposes. **No fabricated verdicts.**

- **Trend pill** (the `.k-delta` grammar, echoed from the oversight surface): the sign of an *exposed delta*.
  - up: `inline-flex items-center gap-1 rounded-pill bg-green-bg px-2 py-0.5 text-[10px] font-bold text-green` → `▲ +{n} …`
  - down: `bg-terra-bg text-terra` → `▼ −{n} …`
  - flat: `bg-bg text-navy-3` → `— {label}`
  - **Sources:** attendance `schoolDelta` (vs prior term; `null` → no pill), enrolment `netChange` (term flow; `null` → no pill). Performance may add a delta later.
- **Progress bar** (`PerfBar`): fee `collectionRate` (tone `gold`); optional capacity utilisation. Encodes ratio-to-whole visually.
- **Band pill** (Performance): `PerfTone` green/gold/terra from `grade-band` (Kofi's arm supplies the tone).
- **Status pills** (absence, §9): captured / not-captured / coming-soon / not-applicable.

> **Honesty boundary (flag #4).** The brief asks for a "healthy/attention pill." An *absolute* health verdict (e.g. "attendance healthy ≥ 90%") needs a **target/threshold**, and the rollup **deliberately strips ops thresholds** (`school-rollup.ts`: *"Aggregate-only re-exposure — no needsAttention/criticalCount/thresholds (PII/ops)"*). So the sanctioned state-encoding is the **trend pill** (direction of change is honest and needs no threshold), **not** a fabricated pass/fail badge. An absolute-band pill is deferred until a governance target config is exposed — do not synthesise one.

---

## 11. Period selector & board-pack PDF stub

- **Period selector:** reuse `ReportFilters` (`showClass={false}`) directly under the header — term pills writing `?periodId=<uuid>`; the page already reads `searchParams.periodId` (async, Next 15) and feeds it to `getSchoolRollup`. Active pill = `border-navy bg-navy text-bg`. `print:hidden`. **Needs the terms list** the rollup doesn't return today (§9 flag #2).
- **Board-pack PDF (GOV-5) stub:** a ghost button in the header actions — `Board pack (PDF)` (`border-border-2 bg-surface text-navy-3`), **disabled**, `title="Coming soon · GOV-5"`, `print:hidden`. Do **not** wire the report `PrintButton` (raw `window.print()`) as if it were the board pack — the board pack is a curated GOV-5 artefact. A raw browser print of this page should still be tidy (see §12), but the button is an honest stub until GOV-5.

---

## 12. Responsive, print & PWA

- **Responsive:** `max-w-[980px]` (from the board layout). `lg` = the 2-up tile rows + 5-across summary strip; below `lg` everything stacks single-column; summary strip `grid-cols-2` → `sm:grid-cols-3`; Finance streams `sm:grid-cols-3` → 1 column. No horizontal scroll at 360px.
- **Print:** `.print:hidden` on the selector, PDF-stub button, and the layout's header actions (`SignOutButton` already is). Tiles stack ink-friendly (surfaces are white, borders hairline). This is a *fallback* — the real board pack is GOV-5.
- **PWA:** the board dashboard is a plain responsive server page in the `(board)` route group — **not** a separate installable/offline PWA surface (unlike the SHS ledger PWA). No offline sync strip, no bottom-nav. Nothing to add.

---

## 13. Accessibility

- **Trend never colour-only:** each pill pairs a **glyph** (`▲`/`▼`/`—`) **+ a sign** (`+`/`−`) **+ text** (`"+1.8 pts vs Term 1"`), so direction survives without hue.
- **Coming-soon is a text label** ("Coming soon" / "Not yet captured"), not a style alone.
- **Semantics:** each tile = a `<section>` with an `<h2>`/`<h3>`; stream/structure lines use `<dl>/<dt>/<dd>` (as the shell's `Line` already does); the status split has a `font-mono` text readout beside the bar.
- **Selector:** `ReportFilters` renders real `<button>`s (keyboard/focus native).
- **Contrast:** navy/navy-2/navy-3 on off-white/white all clear AA; `text-navy-3` reserved for meta, never load-bearing numbers.

---

## 14. Cross-module hooks surfaced here (design commitments, preserve)

The board view is a read-only aggregate, but it is the governance *readout* of several standing hooks:
- **sickbay → attendance ("M"):** Medical is kept as its own status in the 5-status split (§5) — the board sees Medical marks as a distinct aggregate, not folded into Absent.
- **score-ledger → STPSHS:** Senior **readiness** in the Performance tile (§6) reuses the ledger completion vocabulary (`ready`/`behind`/`at-risk`).
- **ledger trajectory → WASSCE predictor** and **BECE outcomes:** the Performance **terminal sub-section** (§6, coming-soon, GOV-6) is exactly where these land — the placeholder is reserving that seam, not hiding it.
- **fees vs books (double-count) → 3-stream separation:** the Finance tile (§4) keeps fees, books and payroll un-summed precisely because school-paid salaries double-count into the books' salaries line (the R341–R348 invariant). Do not "helpfully" total them.

---

## 15. Component reuse map (surface region → existing idiom)

| Region | Reuse | New work |
|---|---|---|
| Board chrome | `app/(board)/layout.tsx` (crest header, `max-w-[980px]`, sign-out) | none |
| Header + PDF stub | `ReportHeader`-style block (crumbless — board has no back-link) | disabled ghost PDF button |
| Period selector | `ReportFilters` (`showClass={false}`) | pass a terms list (§9 #2) |
| Summary strip | `KpiStrip` + `Kpi`/`FeaturedKpi`; `boardTile` for honesty | trend-pill component |
| Finance tile | **`FinancialPosition` + `StreamCard`/`Headline`/`Caption`/`Reason`/`Line` from the shell, verbatim** | promote to `col-span-full` + tile header; add `PerfBar` on the fees stream |
| Attendance tile | 5-status segmented bar + `ATTENDANCE_STATUS_META` (from attendance-summary) | tile shell + trend pill |
| Enrolment tile | school-stats gender palette + `Line` grammar | tile shell + trend pill |
| Performance tile | `PerfBar`/`PerfTone` (`grade-band`); ledger readiness vocabulary | depends on the `performance` arm (§9 #1) + coming-soon terminal sub-panel |
| Infrastructure tile | — | coming-soon treatment (§9.C) — the reference implementation |
| Trend pill | `.k-delta` grammar (oversight ref) | one small shared component (`up`/`down`/`flat`) |
| Honesty | `boardTile`, `boardGhs` | treatment C authored inline |

---

## 16. Open questions / flagged rollup gaps (blockers for the implementer)

1. **`performance` arm does not exist on `SchoolRollup`.** Kofi is speccing it in parallel. The Performance tile (§6) and summary cell 3 (§3) **block on it**. Expected shape: `performance: RollupArm<{ basic?: {...averages, tone}, senior?: {...readiness} }>` — cross-tier, each region honest-absence-wrapped, **terminal BECE/WASSCE excluded** (that's GOV-6). Confirm the exact field names with Kofi before building; until then render the whole tile via treatment A/C.
2. **Rollup returns no `terms` list.** `getSchoolRollup` computes `terms` internally (`listAcademicTerms`) but returns only the resolved `period`. The period selector needs the full list. **Lazy fix: add `terms: AcademicTerm[]` to the `SchoolRollup` return** (one line — it's already in scope in `getSchoolRollup`), rather than a second `listAcademicTerms` call in the page. Flag for the rollup owner.
3. **No finance trend.** There is no prior-period finance delta on the arm, so the Finance summary/tile carry **no trend pill** — only the `collectionRate` bar. Correct and honest; don't fake a finance trend. (Add later only if a prior-term finance figure is exposed.)
4. **Absolute health-band pill deferred** (see §10 boundary) — needs a governance target/threshold config the aggregate rollup intentionally withholds. Ship the trend pill now; revisit if/when a target is provided. Confirm with the PO whether a coarse target (e.g. attendance target %) should be exposed to the board.
5. **Coming-soon copy & milestone tags** ("BECE & WASSCE results — coming soon · GOV-6", "Infrastructure not yet captured · GOV-7") are placeholders pending PO wording — the *treatment* is fixed (§9.C), the exact strings should be PO-confirmed.
6. **Board-pack PDF is a disabled stub** (§11) until GOV-5; confirm whether GOV-4 should also enable a raw browser-print fallback in the interim, or keep the button fully disabled.

---

*Map produced against: `app/(board)/board/page.tsx` + `app/(board)/layout.tsx` (GOV-2/3 shell), `lib/rollup/school-rollup.ts`, `lib/board/tiles.ts`, `components/reports/{report-kit,report-filters,report-header}.tsx`, `app/(app)/reports/operational/attendance-summary/page.tsx` + `reports/school-stats/page.tsx`, `lib/attendance-status.ts`; grammar reference `Surfaces/schoolup-oversight-school-detail.html`; tokens `md files/design-tokens.json` v1.0.0.*
