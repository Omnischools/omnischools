# GOV-5 — Board-Pack PDF — Build-Ready Design Spec

**Author:** Lucy (design cartographer) · **Status:** build-ready design spec, for the implementation engineer (Claude Code).
**Deliverable:** a downloadable, print-ready **A4 portrait governance overview** that mirrors the GOV-4 board dashboard for a board member / director to read or print.
**Guard / scope:** BOARD_MEMBER only, session school id (never a URL school id — R339). Aggregate, read-only, no per-student / operational detail.

## Files to create (the shipped trio idiom — do NOT invent a rendering approach)

| File | Role | Mirrors |
|---|---|---|
| `lib/pdf/board-pack-document.tsx` | the React-PDF `<Document>` (presentational; branches on arm `status`) | `readiness-statement-document.tsx`, `report-card-document.tsx` |
| `lib/pdf/render-board-pack.tsx` | `server-only` render entry → `renderToBuffer` → `Promise<Buffer>` | `render-readiness-statement.tsx`, `render-receipt.tsx` |
| `app/api/board/board-pack/route.ts` | GET; `requireBoard()` + `getSchoolRollup` + meta → stream PDF inline | `app/api/receipts/[paymentId]/route.ts` |

Reuse `lib/pdf/fonts.ts` (`SERIF`/`SANS`/`MONO`) verbatim. No new dependency — same `@react-pdf/renderer` primitives as every shipped doc.

---

## 0. The four things this design has to get right

### 0.1 The honest-absence spine MUST compile into the print layer
Every arm is a `RollupArm<T> = CAPTURED | NOT_CAPTURED | NOT_APPLICABLE`. The dashboard adds a fourth
runtime state — **coming-soon** — for the two `PendingArm`s (`terminalResults`, `infrastructure`). The
PDF must render the SAME four states with the SAME discipline:
- **NOT_CAPTURED / NOT_APPLICABLE** → print the arm's neutral `reason` string, **never a fabricated number**.
- a **real captured zero** (`GHS 0` collected, `0%` rate) → print the real zero, normal styling.
- a **`PendingArm`** ("coming soon") → a forward-looking note, **not a blank and not a zero**.

**Mechanism (do this, don't hand-roll it):** the document branches on `arm.status === "CAPTURED"`
*before* reading `arm.data`. TypeScript narrows the union, so reading `arm.data.x` on a non-captured arm
is a **compile error** — the exact `boardTile`/`RollupArm` guarantee (`lib/board/tiles.ts`), now enforced
inside the PDF. This is why the pack must be fed the **rollup arms themselves** (§2.2), not a flattened
bag of strings that has already thrown the discriminant away.

### 0.2 Financial position is THREE un-summed streams — never one "profit" (GOV-3 / R341–R348)
`netPositionFinance = { fees, books, payroll }` are separate, un-reconciled ledgers (school-paid salaries
even double-count into the books' salaries line — two double-count paths). The pack prints **three
distinctly labelled streams side by side** and **NO field that sums across ≥2 of {fees, books, payroll}**.
The only permitted cross-line composite is `books.net = income − expense`, *within* the one books ledger.
Carry the dashboard's verbatim honesty caption (§6).

### 0.3 Governance framing — aggregate, read-only, not an audited statement
Mirror the dashboard's PII-minimisation: school-wide aggregates only, no `byClass` tables, no student
names, no teacher names, no blocker text. Senior performance is **completion counts, never scores** (§6.2 /
R354). Print a neutral finance caption ("management records, not an audited financial statement"), never a
verdict. No trend "health/attention" badge that needs a threshold the rollup deliberately strips — only the
**sign of an exposed delta** (§12).

### 0.4 Cross-tier performance is not blended (R357)
`performance` is an unwrapped `{ basic, senior }` container — each tier honest-absence-gated on its OWN.
A COMBINED school prints a captured Basic average **beside** a not-captured Senior readiness without one
masking the other. **No field averages/sums Basic and Senior together** (a mark-average vs a completion-count
are different measures). A `NOT_APPLICABLE` tier is **omitted** (omit-not-fake), not printed as "n/a: 0".

---

## 1. Sources & reuse map

| Input | Role |
|---|---|
| `lib/rollup/school-rollup.ts` → `getSchoolRollup(schoolId, {periodId})` | **the data spine.** Reuse its arms verbatim (§2.2). Fully exposes every field this pack needs — see §14, no arm change required. |
| `app/(board)/board/page.tsx` (GOV-4 dashboard) | the on-screen surface being print-adapted. **Copy strings below are lifted verbatim from it** so pack and dashboard read identically. |
| `docs/governance/gov4-board-dashboard-design.md` | the sibling surface map — section order, honesty treatments, cross-module hooks. |
| `lib/pdf/readiness-statement-document.tsx` | **closest structural precedent** (A4, gold top strip, crest header band, hero block, dashed candidate bar, section eyebrows, `dl`-style `Line` rows, fixed platform footer). Clone its `StyleSheet` vocabulary. |
| `lib/pdf/report-card-document.tsx` | precedent for a **centred crest cover header**, a bordered meta grid, a bottom-`absolute` page footer, and `fmt0`/`fmt2` in-doc formatters. |
| `lib/pdf/receipt-document.tsx` | precedent for the header band, `ghs()` in-doc formatter, dashed section separators, banner blocks, and colour tokens as hex constants. |
| `lib/pdf/fonts.ts` | `SERIF`/`SANS`/`MONO` (Times-Roman / Helvetica / Courier standing in for Fraunces / Manrope / JetBrains Mono). Inherited "register real TTFs later" follow-up — no action here. |
| `lib/board/tiles.ts` → `boardGhs` | the GHS grammar (`en-GH` grouping, no forced decimals: `0 → "GHS 0"`, `41200 → "GHS 41,200"`). Re-implement as the in-doc `ghs()` (one line) so the pack figures equal the dashboard's exactly. |
| `lib/wassce/readiness-data.ts` → `initialsOf(schoolName)` | 2-letter school-crest initials (`"Aggrey Memorial" → "AM"`). Precedent for the crest mark (§2.3). |

---

## 2. Document architecture

### 2.1 The trio
- `board-pack-document.tsx` exports `BoardPackDocument({ data }: { data: BoardPackData })` — pure presentational, no data access, no locale work beyond a trivial in-doc `ghs()`/`pct()`.
- `render-board-pack.tsx` (`server-only`): `renderBoardPackPdf(data: BoardPackData): Promise<Buffer>` → `renderToBuffer(<BoardPackDocument data={data} />)`.
- `app/api/board/board-pack/route.ts` (`runtime = "nodejs"`, `dynamic = "force-dynamic"`): `requireBoard()` → `getSchoolRollup(school.id, { periodId })` (read `?periodId` from the query) → build `BoardPackData` → stream `Content-Type: application/pdf`, `Content-Disposition: inline; filename="Board-pack-<school>-<term>.pdf"`, `Cache-Control: private, no-store`.

### 2.2 Data in — reuse the arms, don't re-flatten them (preserves 0.1's compile-fence)
```ts
import type { SchoolRollup } from "@/lib/rollup/school-rollup"; // type-only → erased; safe past the arm's `server-only`

export type BoardPackData = {
  rollup: SchoolRollup;   // the arms verbatim — the document branches on each arm.status
  meta: {
    schoolName: string;      // requireBoard().school.name  (NOT on the rollup — §14 #1)
    schoolInitials: string;  // initialsOf(schoolName)      (NOT on the rollup — §14 #1)
    termLabel: string;       // rollup.period ? `${label} · ${academicYear}` : "No academic period configured"
    generatedAtLabel: string;// route formats rollup.generatedAt in the school tz/locale (§14 #2)
  };
};
```
Rationale: passing the arms verbatim keeps the document branching on the **same `RollupArm.status`** the
dashboard branches on — the two can never diverge, and fabricating a number for a non-captured arm stays a
compile error. Numeric formatting (`ghs`, `pct`, `toLocaleString`) lives in-doc, exactly as `receipt-document`
(`ghs`) and `report-card-document` (`fmt0`/`fmt2`) already do. Only the **date + initials + term label** —
which need tz/locale/session data the doc must not reach for — are pre-formatted in `meta`.

> Alternative (rejected as primary): a fully pre-formatted flat DTO à la `ReceiptData`. Cleaner separation, but
> it re-derives the honesty branching by hand and throws away the `status` discriminant that gives us the
> compile-fence for free. Only adopt it if the team wants doc/DTO symmetry across all PDFs — and then keep a
> `status` field per arm so 0.1 still holds.

### 2.3 Page shell (clone from `readiness-statement-document`)
- `<Page size="A4" style={s.page}>`; `s.page = { backgroundColor:"#FFFFFF", fontFamily:SANS, fontSize:10, color:NAVY, paddingBottom:44 }` (footroom for the fixed footer).
- **Gold top strip** `s.strip = { height:6, backgroundColor:GOLD }` at the top of every page.
- Section horizontal padding **40** (readiness/report-card gutter). Body blocks in a `{ paddingHorizontal:40 }` view.
- Multi-page: A4 wraps automatically; each section is a `<View wrap={false}>` so a section never splits mid-card. Fixed footer + gold strip repeat per page (§11). Optional `break` before §8/§9 if they would orphan.

### 2.4 Colour tokens (hex constants — `@react-pdf` cannot use CSS vars; copy the block the shipped docs already declare)
| Const | Hex | Use |
|---|---|---|
| `NAVY` | `#1A2B47` | headings, primary figures |
| `NAVY2` | `#2D3F5C` | secondary body text |
| `NAVY3` | `#5C6675` | captions, labels, dashes, **all `reason` strings** |
| `GOLD` | `#C8975B` | crest initials, accent words, eyebrows, rate bar |
| `GOLD_SOFT` | `#E8D4B8` | soft borders, hero/target tint edges |
| `GOLD_BG` | `#F5EBDC` | cover band tint, highlighted cells |
| `BG` | `#FAF7F2` | note/absence panel grounds |
| `SURFACE` | `#FFFFFF` | page + card ground |
| `GREEN` / `GREEN_BG` | `#2F6B47` / `#E5EFE8` | up-delta, ready |
| `TERRA` / `TERRA_BG` | `#B84A39` / `#F5E1DC` | down-delta, at-risk |
| `WARN` / `WARN_BG` | `#C58A2E` / `#F5E9D0` | partial / pending |
| `BORDER` / `BORDER_2` | `#E5DFD3` / `#D4CCBA` | hairline / dashed (coming-soon) borders |

(`GREEN_BG` canonical token is `#E5EFE8`; the shipped readiness doc uses `#E5F0EB` — either reads fine, prefer the token.)

### 2.5 Type roles (mirror the dashboard §1.1)
- **`SERIF` (Fraunces):** the cover school name + pack title, every section heading, and headline stat numbers. Gold accent word in a heading = a `<Text style={{color:GOLD}}>` — **non-italic** (matches the app tiles' `<em class="not-italic text-gold">`). Reserve `fontStyle:"italic"` for the coming-soon placeholder text only (as readiness does for empty states).
- **`SANS` (Manrope):** body copy, captions, labels.
- **`MONO` (Courier):** **every currency, %, count, ratio, delta** (tabular figures) — the P·L·E·M·A readout, GHS amounts, rates, staff counts.
- Empty value glyph: `—` in `NAVY3` (never `0` / `N/A` / `null`).
- Currency: `ghs()` → `"GHS 41,200"` (no `GH₵` / `Ghc`, no forced decimals — board grain, matching `boardGhs`).

---

## 3. Cover (top band of page 1 — the report-card centred-header idiom, enlarged)

A prominent banded header region, not a separate `<Page>` (keeps the single-flow idiom every shipped doc
uses; if the PO later wants a standalone cover page it is a trivial `<Page>` split). Centred, on a
`GOLD_BG` panel bordered `GOLD_SOFT`, sitting under the gold strip.

| Element | Copy / source | Type / token |
|---|---|---|
| Crest mark | navy rounded square, `meta.schoolInitials` inside | `SERIF bold` gold on `NAVY` square (46×46, radius 8) — the `report-card` `mark` |
| School name | `meta.schoolName` | `SERIF bold ~22 NAVY`, centred |
| Pack title | **`Board & Governance Overview`** | `SERIF ~13 GOLD`, letter-spaced eyebrow OR a second Fraunces line with a gold accent: `Board & Governance <Text gold>Overview</Text>` |
| Term | `meta.termLabel` → `"Term 2 · 2025/26"` (or `"No academic period configured"`) | `MONO ~10 NAVY2` |
| Generated | `Generated {meta.generatedAtLabel}` | `SANS 8.5 NAVY3` |
| Framing sub | **`Read-only governance snapshot · aggregate figures only, no per-student detail.`** | `SANS 9 NAVY3`, centred |
| Prepared-by | (in the fixed footer, §11) — `Prepared on Omnischools · the school management platform` | — |

When `rollup.period == null`: the term line prints the neutral `"No academic period configured"` (already in
`meta.termLabel`); the sections below carry their own NOT_CAPTURED reasons (§10). No fabricated term.

---

## 4. Section 1 · Enrolment  → `rollup.enrolment: RollupArm<EnrolmentArm>`

**Header:** `Enrolment <gold>at a glance</gold>.` · meta (right) = `enrolment.data.levelSummary` when CAPTURED (e.g. `"KG1–JHS3"` / `"Form 1–3"`).
**Absence:** NOT_CAPTURED only at zero roll → treatment A panel with `reason` `"No students currently enrolled."` (enrolment is point-in-time; it populates even when `period == null`).
**CAPTURED body** — four compact regions, no PII:

| Region | Copy | Field | Type / token · states |
|---|---|---|---|
| Roll headline + net-change | `{roll}` + trend chip | `roll` · `netChange` | `SERIF ~26 NAVY`; trend chip §12 (`▲ +12 this term` / `▼ −3 this term` / `— no change`); **`netChange == null` → chip omitted, caption `point-in-time roll`** |
| Gender mini-bar | `{female}F · {male}M` | `gender.female` / `.male` / `.femalePct` / `.malePct` | two flex segments — pink `#C77B9E` (F) / blue `#6B86B0` (M) inline hex (sanctioned non-token exception, as school-stats); `MONO 9 NAVY3` readout |
| Structure lines (`Line` rows) | `Active classes` / `Avg class size` / `Teaching staff` / `Student : teacher` | `activeClasses` / `avgClassSize` / `teachingStaff` / `studentTeacherRatio` | label `SANS NAVY3` · value `MONO NAVY2`; **`studentTeacherRatio == null → "—"`, else `"{n}:1"`** |
| Intake this term + lifetime exits | `{admissionsThisTerm} new ({intakeFemale}F · {intakeMale}M)` then `Lifetime exits: {withdrew} withdrew · {transferred} transferred · {graduated} graduated ({lifetimeExits} total)` | those fields | **each term-windowed field is `null` when `period == null` → print `—`, NEVER `0`**; lifetime totals always print |
| Caveat | `Withdrawals, transfers and graduations are current lifetime totals — per-term exit dating arrives when status history is tracked.` | — | `SANS 8 NAVY3` |

---

## 5. Section 2 · Attendance  → `rollup.attendance: RollupArm<AttendanceArm>`

**Header:** `Attendance <gold>this term</gold>.` · meta = `{totalMarked.toLocaleString('en-GH')} marks recorded` when CAPTURED.
**Absence:** treatment A panel with `reason` — `"No academic period configured."` (no period) or `"No attendance marked for {term}."` (`totalMarked == 0`).
**CAPTURED body:**

| Region | Copy | Field | Type / token · states |
|---|---|---|---|
| Rate headline + trend | `{schoolRate}%` + trend chip | `schoolRate` · `schoolDelta` | `SERIF ~26 NAVY`, **`schoolRate == null → "—"`**; trend chip §12 (`▲ +1.8 pts vs last term` green / `▼ −1.8 pts` terra / `— level`); **`schoolDelta == null` → chip omitted, caption `(present + late) ÷ all marks`** |
| Five-status split | segmented bar + `MONO` readout `P {present} · L {late} · E {excused} · M {medical} · A {absent}` | `statusTotals` (P/L/E/M/A) | iterate `ATTENDANCE_STATUS_ORDER`; segment widths = `flexGrow: count` (skip 0-count segments); status colours per `ATTENDANCE_STATUS_META[s]` hex (map the `.seg` Tailwind class to its hex constant for print). **Keep all 5 statuses — Medical (M, navy-2) is the sickbay→attendance readout, never folded into Absent** (§13). |

`byClass[]` is on the arm but **not printed** (per-class detail = PII-adjacent + not scannable; governance is
aggregate). Flag for a future appendix only.

---

## 6. Section 3 · Financial position  → `rollup.netPositionFinance: RollupArm<NetPositionFinanceArm>`

**Header:** `Financial <gold>position</gold>.`
**Honesty caption (verbatim from the dashboard, always printed under the header):**
> Three separate records shown side by side. Fee collections and the school's books are kept as separate ledgers and are not combined into a single profit; payroll is a current monthly figure.

**Footnote (neutral finance caption — brief §"neutral finance caption ... not an audited statement"):**
> Figures are management records for governance oversight, not an audited financial statement.
(`SANS 8 NAVY3`. PO-confirmable wording; treatment is fixed.)

**Whole-arm absence** (`period == null`): one treatment-A panel with `reason` `"No academic period configured."` — **no streams, no zeros.**
**CAPTURED → three `StreamCard`s side by side** (`flexDirection:"row"`, three flex cells; stack if it overflows). **Never sum across streams.**

| Stream | Field | Copy · states |
|---|---|---|
| **Fee collections** (`fees` — the `feeCollections` arm reused verbatim so the two figures can never disagree) | `fees: RollupArm<FeeCollectionsArm>` | CAPTURED: headline `ghs(collected)` · caption `collected · this term` · a rate bar of `collectionRate%` (gold) · line `ghs(outstanding) outstanding`. NOT_CAPTURED → treatment-A `reason` `"No fees billed for {term}."`. A captured `GHS 0` collected prints as `GHS 0` (real zero). |
| **Books (this term)** | `books: RollupArm<BooksFinanceLine>` | CAPTURED: `dl` `Line`s — `Income = ghs(income)` / `Expense = ghs(expense)` / **`Net = ghs(net)`** (`net` strong; the ONLY cross-line composite, income − expense, WITHIN books). NOT_CAPTURED → `reason` `"No books entries recorded for {term}."`. |
| **Payroll** | `payroll: RollupArm<PayrollLine>` | CAPTURED: headline `ghs(schoolPaidMonthlyTotal)` · caption `school-paid · gross · monthly` · memo line `GES-paid (memo, not added): ghs(gesPaidMonthlyMemo)` · **if `allowanceMonthlyMemo > 0`** memo line `Allowance (memo, not added): ghs(allowanceMonthlyMemo)` (memos `MONO 8 NAVY3`). **NOT_APPLICABLE** (school runs no payroll) → treatment-A `reason` `"This school does not run payroll in Omnischools."`. |

**Guardrails to preserve:** never a single "net position"/"profit"/"surplus" scalar; the three headline
numbers stay distinct and separately labelled; GES-paid and allowance are **memos, not added** to the
school-paid figure; a captured `GHS 0` renders, a not-captured stream renders its reason and no number.

---

## 7. Section 4 · Academic performance  → `rollup.performance: PerformanceArm` ( `{ basic, senior }` )

**Header:** `Academic <gold>performance</gold>.` · meta `cross-tier · this term`.
Cross-tier, **no blend** (R357). A `NOT_APPLICABLE` tier is **omitted entirely** (omit-not-fake), not printed as a reason row.

**7.1 Basic · gradebook** (`performance.basic: RollupArm<BasicPerformanceSummary>`) — printed unless `NOT_APPLICABLE`:

| Copy | Field | Type / token · states |
|---|---|---|
| eyebrow `Basic · gradebook` | — | `SANS 8 NAVY3 bold` |
| `{overallAverage}%` | `overallAverage` | `SERIF ~26 NAVY`; **`null → "—"`** |
| `{passRate}% pass rate` | `passRate` | `MONO 8.5 NAVY2`; **`passRate == null` → omit the pass-rate token entirely (never "0% pass")** |
| `{gradedClasses} class(es) graded` | `gradedClasses` | `SANS 8 NAVY3` (singular/plural) |
| trend chip | `overallDelta` | §12 (`▲ +2 pts vs last term` / …); `null → omit` |
| absence | `reason` | NOT_CAPTURED → treatment-A `reason` `"No gradebook scores recorded for {term}."` |

**7.2 Senior · STPSHS readiness** (`performance.senior: RollupArm<SeniorReadinessSummary>`) — printed unless `NOT_APPLICABLE`. **Completion counts only — no scores, no names, no blockers (§6.2 / R354):**

| Copy | Field | Type / token · states |
|---|---|---|
| eyebrow `Senior · STPSHS readiness` | — | `SANS 8 NAVY3 bold` |
| `{subjectsReady} of {subjectsTotal} subjects ready · {subjectsPartial} partial · {subjectsAtRisk} at risk` | `subjectsReady` / `subjectsTotal` / `subjectsPartial` / `subjectsAtRisk` | `subjectsReady` big `SERIF ~18 NAVY`; `partial` in `WARN`/gold, `at risk` in `TERRA` (colour + word, greyscale-safe) |
| absence | `reason` | NOT_CAPTURED → treatment-A `reason` `"No senior readiness data recorded for {term}."` |

(This is the **score-ledger → STPSHS** cross-module output at governance depth — §13.)

---

## 8. Section 5 · Terminal results — coming soon  → `rollup.terminalResults: PendingArm`

A **treatment-C** dashed panel (§10) — **never a number**. Reads the pending arm's forward-looking reason.

| Element | Copy / source |
|---|---|
| eyebrow | `Terminal results` |
| headline (italic) | `BECE & WASSCE results — coming soon` |
| body | `terminalResults.reason` → `"Terminal exam results (BECE / WASSCE) are not yet captured in Omnischools — coming in a later release."` |
| tag | `GOV-6` |

This is the seam the **ledger-trajectory → WASSCE predictor** and BECE outcomes land on (§13). Placeholder, not a fabricated pass-rate.

## 9. Section 6 · Infrastructure — coming soon  → `rollup.infrastructure: PendingArm`

A **treatment-C** dashed panel — the reference implementation of the coming-soon look.

| Element | Copy / source |
|---|---|
| eyebrow / header | `Infrastructure <gold>& facilities</gold>.` |
| headline (italic) | `Not yet captured` |
| body | `infrastructure.reason` → `"Facilities details are not yet captured — the termly facilities form is coming soon."` |
| tag | `GOV-7` |

`PendingArm` is `RollupArm<never>` — a CAPTURED member is a compile error, so these can never fabricate a
figure. Narrow with a tiny `pendingReason(arm)` helper (as the dashboard does) to read the reason.

---

## 10. Honest-absence print treatment — three looks (mirrors dashboard §9)

| Treatment | Applies to | Print container | Content |
|---|---|---|---|
| **A · Reason (solid)** | `NOT_CAPTURED` / `NOT_APPLICABLE` | `border BORDER, backgroundColor BG, borderRadius 6, padding 12` | `arm.reason` in `SANS 9 NAVY3`, **no number** |
| **B · Real zero** | `CAPTURED` with a genuine `0` | normal card | the real `0` / `GHS 0` / `0%`, normal `SERIF`/`MONO` styling |
| **C · Coming soon (dashed)** | `PendingArm` (§8, §9) | `borderWidth 1, borderColor BORDER_2, borderStyle "dashed", backgroundColor BG` | eyebrow + `SERIF italic NAVY3` headline (`"coming soon"` / `"Not yet captured"`) + `reason` body + milestone tag (`GOV-6`/`GOV-7`), **no number** |

Critical separations: **C (dashed, uncoloured, italic)** ≠ **B (a real, coloured/typed zero)** ≠ an
**attention** state (a `TERRA` delta on a captured number, §12). A coming-soon block is never coloured
green/terra and never carries a figure. `borderStyle:"dashed"` is supported (used by receipt/readiness).

---

## 11. Page bands & fixed footer (clone readiness `platform` / report-card `footer`)

- **Top:** the gold `s.strip` (height 6) on every page.
- **Fixed footer** (`position:"absolute", bottom:0, left:0, right:0`, `fixed`, `borderTopWidth:1 BORDER`, `paddingHorizontal:40, paddingVertical:12`):
  - left: `Prepared on ` + `<Text style={{color:GOLD, fontWeight:"bold"}}>Omnischools</Text>` + ` · the school management platform` (`SANS 7.5 NAVY3`) — the "prepared by Omnischools" mark.
  - right: use the `Text` `render` prop for pagination — `render={({ pageNumber, totalPages }) => \`${meta.schoolName} · Board pack · ${pageNumber}/${totalPages}\`}` (`SANS 7.5 NAVY3`). Put `fixed` on this `Text` so it repeats.
- **Section spacing:** `marginBottom ~16` between sections; each section `<View wrap={false}>` so the card + its header stay together; `paddingBottom:44` on the page reserves footer room. Optional `break` before §8/§9 if they orphan on page 1.

---

## 12. State-encoding in print — the trend chip (greyscale-safe)

The only state encoding is the **sign of an exposed delta** — no threshold-based health/attention verdict
(the rollup strips ops thresholds; dashboard §10 honesty boundary).

- **up:** `▲ +{n} {unit} {context}` in `GREEN` on `GREEN_BG` pill (`borderRadius 8, padding 2×6, MONO 8`).
- **down:** `▼ −{n} {unit} {context}` in `TERRA` on `TERRA_BG`.
- **flat:** `— {flatLabel}` in `NAVY3` on `BG`.
- **Sources:** enrolment `netChange` (`this term`, `flatLabel:"no change"`), attendance `schoolDelta` (`unit:"pts", context:"vs last term"`, `flatLabel:"level"`), basic performance `overallDelta` (`unit:"pts"`). **`delta == null` → no chip** (the caption fallback prints instead).
- **Greyscale/B&W safe (boards print mono):** every chip pairs a **glyph** (`▲`/`▼`/`—`) **+ a sign** (`+`/`−`) **+ text**, so direction survives without hue. Never colour-only. Senior `partial`/`at risk` similarly pair the colour with the word.

---

## 13. Cross-module hooks preserved in print (design commitments)

- **sickbay → attendance ("M"):** Medical is its own segment + `M {n}` readout in §5, never folded into Absent.
- **score-ledger → STPSHS:** Senior readiness completion counts (§7.2) are the ledger→STPSHS output at governance depth (`ready`/`partial`/`at-risk` vocabulary).
- **ledger trajectory → WASSCE predictor + BECE outcomes:** the Terminal-results coming-soon panel (§8) reserves exactly that seam (GOV-6) — a placeholder, not a hidden number.
- **fees vs books double-count → 3-stream separation:** §6 keeps fees/books/payroll un-summed precisely because school-paid salaries double-count into the books' salaries line (R341–R348). Do not total them.

---

## 14. Flags — arm fields the PDF needs that the rollup does NOT expose

1. **School name + crest initials are not on `SchoolRollup`** (it carries `schoolId`, not the school record). Source `schoolName` from `requireBoard().school.name` in the route and derive `schoolInitials` via `initialsOf(schoolName)` (reuse `lib/wassce/readiness-data.ts`'s helper, or inline the one-liner) — exactly how every shipped PDF receives `school: { name, initials }`. **Not a rollup change; a route/mapper concern.**
2. **`generatedAt` is a `Date`, not a label.** The route must format `rollup.generatedAt` to `meta.generatedAtLabel` in the school tz/locale (documents take pre-formatted dates — house style). No arm change.
3. **No new arm field required otherwise.** Everything §4–§9 needs is already exposed and already rendered by the dashboard (`app/(board)/board/page.tsx`) — enrolment (incl. term-null `admissionsThisTerm`/`intakeFemale`/`intakeMale`/`netChange`), attendance `statusTotals` (5), the 3 finance streams, `BasicPerformanceSummary.passRate` (GOV-4a), `SeniorReadinessSummary` counts, and both `PendingArm.reason` strings. **The pack requires zero changes to `lib/rollup/school-rollup.ts`.**
4. **Wire the disabled dashboard stub.** `app/(board)/board/page.tsx` renders a disabled `Board pack (PDF)` button (`title="Coming soon · GOV-5"`). GOV-5 replaces it with a real link/anchor to `GET /api/board/board-pack?periodId={activePeriodId}` (carry the current `?periodId` so the pack matches the on-screen term), `print:hidden`. Enabling that button is the only dashboard edit — content-wise the dashboard is untouched.
5. **Copy strings marked "PO-confirmable"** — the finance footnote (§6) and the coming-soon milestone tags (`GOV-6`/`GOV-7`) — carry sensible defaults; the *treatment* is fixed, only the exact wording is open.

---

## 15. Component reuse table (pack region → shipped idiom)

| Region | Reuse from | New work |
|---|---|---|
| Trio + render + route | `readiness-statement-document` + `render-readiness-statement` + `app/api/receipts/[paymentId]/route.ts` | the 3 new files |
| Page shell / gold strip / A4 | `readiness-statement-document` `s.page` + `s.strip` | none |
| Cover crest header | `report-card-document` centred `header`/`mark`/`schoolName`/`eyebrow` | enlarge; add framing sub-line |
| Section heading (gold accent) | `readiness` `sectionTitle` eyebrow + a `SERIF` heading with a `{color:GOLD}` accent word | one small `SectionHead` component |
| `Line` rows (label/value) | `report-card` `MetaCell` / receipt `Line`-style rows | reuse |
| Finance StreamCards | dashboard `FinanceTile` structure → PDF `View` cards | port to `@react-pdf` primitives |
| Attendance 5-status bar | dashboard `StatusSplit` + `ATTENDANCE_STATUS_META` (map `.seg` class → hex) | port to `flexGrow` segments |
| Trend chip | dashboard `TrendPill` grammar | one small `TrendChip` (`up`/`down`/`flat`) in the doc |
| Absence panel (A) / Coming-soon (C) | dashboard `AbsencePanel` / `ComingSoon` | two small `View`s (solid vs dashed) |
| Fixed footer + pagination | `readiness` `platform` (fixed) + `report-card` `footer` render prop | reuse |

---

*Mapped against: `lib/rollup/school-rollup.ts`; `app/(board)/board/page.tsx` + `app/(board)/layout.tsx`; `lib/pdf/{receipt,report-card,readiness-statement}-document.tsx`, `render-{receipt,readiness-statement}.tsx`, `fonts.ts`; `app/api/receipts/[paymentId]/route.ts`; `lib/board/tiles.ts`; `lib/reports/senior-readiness-data.ts`; `lib/wassce/readiness-data.ts` (`initialsOf`); `styles/tokens.css`; `docs/governance/gov4-board-dashboard-design.md`.*
