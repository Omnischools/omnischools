# GOV-8 — Mid-year census GENERATION DRAWER + hand-fill form — Surface Map

**Author:** Lucy (design cartographer) · **Status:** design spec, ready for the implementation engineer.
**Scope:** the **generation drawer** for the GES census and its **in-app hand-fill form** — the surface a
Headmaster/Admin opens at `/reports/statutory/generate-annual-census?cadence=mid-year` to produce the
**MID-YEAR** census return. This maps the LEFT/DRAWER half of `Surfaces/schoolup-annual-census.html` only.
**The PDF (cover, tables, declaration, stamp — the RIGHT half, HTML §02 lines 1680–2587) is GOV-9 and is
NOT mapped here** (see §11 for the GOV-8→GOV-9 hand-off point).

> **The one thing that must not be missed:** the surface's static Auto/Partial/Manual tags and its hard-coded
> "71% auto-filled" **are demo markup that predates GOV-3/6/7.** In the build, every tag and the fill % are
> **COMPUTED FROM LIVE ROLLUP-ARM STATUS at generation time.** The surface is the *visual grammar*; the arm
> status is the *truth*. Every supersession is flagged inline and collected in §9.

## Source (verified first-hand)

| Source | Role in this map |
|---|---|
| `Surfaces/schoolup-annual-census.html` §01 "Generation drawer" (markup lines 1336–1678; CSS lines 120–535; notes 1654–1676) | **PRIMARY visual + copy source** for the drawer, checklist, tags, and output card. |
| Same file, PDF `.manual-fill`/`.manual-field`/`.infra-card`/`.infra-count-cell` blocks (CSS 875–1073; markup 1933–2508) | **The hatched hand-fill grammar** GOV-8's in-app form reuses (§4). The blocks render in the surface's PDF preview, but the visual treatment + field labels are the honest-absence spec for GOV-8. |
| Kofi R386–R405 (board `GOV-8 SPEC` record) | Logic source of truth: the mid-year field subset, arm-computed tags, honest-absence rule. |
| `md files/design-tokens.json` / `design-tokens.css` + the surface `:root` (lines 11–31) | Canonical tokens. |
| `components/reports/*` (built finance-report grammar), `app/(app)/staff/compensation/` + `db/schema/staff.ts` (staff compensation, migration 0030 — the **GOV-7 salary arm, already shipped**) | The form/report grammar the hand-fill form extends, and the one supersession arm confirmed live in this worktree. |
| `docs/senior/incr57-headmaster-rollup-surface-map.md` / `docs/senior/ledger-surface-map.md` | Shape this map follows; token→Tailwind convention (`text-navy-3`, `bg-gold-bg`, `font-display`, never inline `var(--x)`). |

> **Not in this worktree (map to the contract, implementer wires the source):** the statutory route,
> `components/reports/terminal-results-form.tsx` (GOV-6 arm), `components/reports/facilities-form.tsx`
> (GOV-3 arm) are referenced by the task but not present here. This is a **pre-implementation map**. I map
> the arm CONTRACT (§2); the engineer binds it to each module's real availability signal.

---

## 0. Cadence — the route param that makes this GOV-8 (not GOV-9)

One route, one drawer component, two cadences via `?cadence=`:

| `?cadence=` | Return | This map | Sections active | Pages (surface demo) |
|---|---|---|---|---|
| `mid-year` | **Mid-year census** | **GOV-8 (this doc)** | the mid-year subset (§5) | fewer than 10; `[computed]` |
| `annual` | Full annual census | GOV-9 field set | all sections | 10 (surface demo) |

- **Default / missing param:** treat as `annual` **only if** the route is reached outside a mid-year window;
  otherwise the entry point that opens the drawer sets `?cadence=mid-year`. Flag to PO: confirm the default.
- The cadence changes **copy** (head eyebrow/lede/deadline), **which arms are in-scope** (§5), the **auto-fill
  denominator** (§3.5), and the **output page count/filename**. Everything else — layout, tokens, the 4-step
  spine — is shared with the annual drawer. Build **one drawer, cadence-parameterised**, not two.

---

## 1. Token & type reference (drawer-specific)

Base tokens/type map exactly as `ledger-surface-map.md §0` (Tailwind token class, never inline `var(--x)`;
`font-display`=Fraunces w/ italic gold accents, `font-body`=Manrope, `font-mono`=JetBrains Mono; empty value
= em-dash `—`, **never a fabricated `0`** — see §4). Drawer surface classes → Tailwind:

| Surface class (CSS line) | Surface CSS | Tailwind token build |
|---|---|---|
| `.drawer` (146) | `w:540px; bg:surface; radius:8px 0 0 8px; shadow -16px 0 40px` | `w-[540px] rounded-l-lg bg-surface shadow-[-16px_0_40px_-8px_rgba(26,43,71,0.35)]` right-anchored flex-col |
| `.drawer-overlay` (139) | `rgba(26,43,71,0.32)` scrim | `bg-navy/32` **← token-opacity trap; see §1.1** |
| `.drawer-head h1` (184) | `font-display 24px 500; em italic gold` | `font-display text-2xl font-medium` · `em` → `italic font-normal text-gold` |
| `.drawer-head .eyebrow-tag` (166) | `10px .16em upper 700 gold` | `text-[10px] font-bold uppercase tracking-[0.16em] text-gold` |
| `.drawer-head .lede` (193) | `12px navy-3` | `text-xs text-navy-3` · `b` → `text-navy-2 font-semibold` |
| `.close-btn` (173) | `28px sq; border; navy-3; ×` | `size-7 rounded-lg border border-border text-navy-3` |
| `.section-eyebrow` / `.step-tag` / `.num-circle` (212–238) | 9px upper gold; 18px gold circle w/ navy display numeral | `text-[9px] font-bold uppercase tracking-[0.16em]` · circle `size-[18px] rounded-full bg-gold text-navy font-display font-bold text-[10px]` |
| `.year-selector-row` (241) | `bg:bg; border; radius:10px; 12px 16px` | `flex items-center gap-2.5 rounded-[10px] border border-border bg-bg px-4 py-3` |
| `.year-value` (255) | `font-display 18px 600; em italic gold` | `font-display text-lg font-semibold` · `em italic text-gold font-medium` |
| `.id-preview` (275) | `bg:bg; border; 2-col grid` | `grid grid-cols-2 gap-2.5 rounded-[10px] border border-border bg-bg px-4 py-3.5` |
| `.id-row .lbl` / `.val` / `.val.mono` (284–300) | 9px upper navy-3 / 12px navy 600 / mono | `text-[9px] font-bold uppercase tracking-[0.14em] text-navy-3` · `text-xs font-semibold text-navy` · mono → `font-mono` |
| `.fill-summary` (303) | `bg:gold-bg; border gold-soft; radius:10px` | `rounded-[10px] border border-gold-soft bg-gold-bg px-4 py-3.5` |
| `.fs-label` (310) | 9px .16em upper gold 700 | `text-[9px] font-bold uppercase tracking-[0.16em] text-gold` |
| `.fs-pct` (322) | `font-display 26px 600 green; em italic` | `font-display text-[26px] font-semibold leading-none text-green` · `em italic` |
| `.progress-bar .bar-auto` (346) | solid green | `bg-green` |
| `.progress-bar .bar-manual` (349) | 45° hatched warn on warn-bg | `bg-[repeating-linear-gradient(45deg,#F5E9D0,#F5E9D0_4px,#C58A2E_4px,#C58A2E_5px)]` (token hexes; **no slash-opacity**) |
| `.checklist-section-header` (433) | 9px upper navy-3; `b` italic Fraunces gold; trailing rule | `text-[9px] font-bold uppercase tracking-[0.14em] text-navy-3` · `b` → `font-display italic font-medium text-[10px] normal-case text-gold` · rule `h-px flex-1 bg-border` |
| `.checklist-row` (358) | 3-col grid `22px 1fr auto`; border; radius 8 | `grid grid-cols-[22px_1fr_auto] gap-3 rounded-lg border border-border bg-surface px-3 py-2.5 items-start` |
| `.checklist-row.warn` (368) | `bg:warn-bg; border rgba(197,138,46,.3)` | `bg-warn-bg border-warn/30` **← token-opacity trap; use `border-warn-soft` tint or `opacity`** |
| `.checklist-row.disabled` (372) | `opacity:.5` | `opacity-50` (the **annual-only-in-mid-year** treatment, §5) |
| `.check-mark` (375) | 22px circle; green `✓` / warn `!` / disabled bg | `size-[22px] rounded-full font-display font-bold text-[11px]` · ready `bg-green text-white` · warn `bg-warn text-white` · disabled `bg-bg border border-border text-navy-3` |
| `.body .name` / `.meta` (395–406) | 12px navy 700 / 10px navy-3 | `text-xs font-bold text-navy` · `text-[10px] text-navy-3` (`b` → `text-navy-2 font-semibold`) |
| `.status-tag.ready` (417) | `bg green-bg; text green` | `rounded-full bg-green-bg px-2 py-[3px] text-[9px] font-bold uppercase tracking-[0.06em] text-green` |
| `.status-tag.partial` (421) | `bg warn-bg; text warn; border rgba(197,138,46,.3)` | `bg-warn-bg text-warn border border-warn/30` **← trap** |
| `.status-tag.manual` (426) | `bg:bg; text navy-3; border` | `bg-bg text-navy-3 border border-border` |
| `.output-card` (458) + `.pdf-tag` (468) | `bg:bg`; 36px terra `PDF` chip | `grid grid-cols-[36px_1fr] gap-3 rounded-lg border border-border bg-bg px-4 py-3.5` · chip `size-9 rounded-lg bg-terra text-white font-display font-bold text-[11px]` |
| `.out-meta .filename` (488) | mono navy-2 600 | `font-mono font-semibold text-navy-2` |
| `.drawer-foot` (494) + `.summary` (502) | top border; `font-display 13px 600; em italic gold` | `flex justify-between items-center border-t border-border bg-surface px-7 py-4` · summary `font-display text-[13px] font-semibold` · `em italic text-gold` |
| `.btn` / `.btn.primary` (517/529) | ghost / navy fill | `rounded-md px-4 py-2.5 text-xs font-semibold border border-border-2 bg-surface text-navy` · primary `bg-navy text-bg border-navy font-bold` |

### 1.1 Token-opacity trap (memory `no-alpha-token-opacity`) — three live hits in this drawer

The surface uses raw-hex-alpha in three spots. Tailwind slash-opacity **silently breaks on raw-hex tokens** —
specify solid/tint tokens or `opacity-N`, and **verify in the live preview, not the build**:
1. `.drawer-overlay` `rgba(26,43,71,0.32)` → use `opacity-[.32]` on a solid `bg-navy` layer, not `bg-navy/32`.
2. `.checklist-row.warn` + `.status-tag.partial` borders `rgba(197,138,46,0.3)` → add a dedicated
   **`--warn-soft`** border tint token, or `border-warn opacity-30`. Do **not** ship `border-warn/30`.
3. The `.bar-manual` hatch and `--terra-bg-soft` are already solid/tint tokens — safe.

---

## 2. The arm-status contract — the spine of every computed tag (READ FIRST)

Every checklist row maps to **one rollup arm**. An arm answers, per `(school × academic-period × cadence)`:

```
arm = {
  key,                       // e.g. "attendanceRate", "infrastructureClassrooms"
  coverage: FULL | PARTIAL | NONE,   // how much of the arm's data is present
  reason?: string,           // shown when coverage ≠ FULL — the honest prompt (e.g. surface meta copy)
  captured?: number, total?: number, // for PARTIAL rows ("8 of 14 captured")
  meta?: string,             // FULL-row inline verification ("312 students · 157 boys, 155 girls")
}
```

**Tag = pure function of `coverage` (NOT the surface's static class):**

| `coverage` | Status tag | check-mark | row style | Meaning |
|---|---|---|---|---|
| `FULL` | **`Auto`** (`.status-tag.ready`, green) | `✓` green | plain | arm CAPTURED; value auto-fills |
| `PARTIAL` | **`Partial`** (`.status-tag.partial`, warn) | `!` warn | `.warn` tint | some captured, rest hand-fill (e.g. 8/14 staff) |
| `NONE` | **`Manual`** (`.status-tag.manual`) | `!` warn | `.warn` tint | not captured → **hatched hand-fill blank** (§4), never a fabricated 0 |

Cadence gate sits **above** coverage: an **annual-only** arm in a `mid-year` run renders
`.checklist-row.disabled` (`opacity-50`) with an **`Annual`** tag and is **excluded from the fill %**,
regardless of its coverage (§5).

- **Fill % is computed, never hard-coded:** `pct = round(100 × FULL / inScope)` where `inScope` = arms whose
  cadence includes the current run (annual-only excluded). `PARTIAL` and `NONE` both count toward
  "sections still need your hand." The surface's "71%", "5 sections", "11 of 16", "20 minutes" are **demo
  numbers and internally inconsistent** (the markup has 17 rows, not 16; 9 `Auto` + 1 `Partial`, not 11) —
  do not carry any of them; compute all four from the arms.

---

## 3. Drawer layout — section by section (copy verbatim; `[computed]`/`[demo]` marked)

Stage: right-anchored `.drawer` (540px) over a dimmed app scrim (`.drawer-bg` sidebar silhouette +
`.drawer-overlay`). The scrim is illustrative — in-app it is the real page behind the drawer. Spine is a
fixed head, a scrollable body of **4 numbered steps**, and a fixed foot.

### 3.0 Head (`.drawer-head`)
- **Eyebrow-tag** `[computed]`: `Mid-year census · {academicYear}` (surface: `Annual census · 2025/26`).
- **Close** `×` (`.close-btn`) — dismisses the drawer, returns to `/reports` (no generation).
- **Title:** `Generate ` + `<em>mid-year census</em>` (surface: `annual census`). `font-display`, em italic gold.
- **Lede** `[computed, cadence copy]` — surface annual lede is: *"The big one · filed once a year to GES · 10
  pages · combines enrolment, staff, attendance, performance, and **infrastructure**. Most data auto-fills
  from Omnischools; some sections still need your hand."* **Mid-year replacement (proposed, honest to the
  lighter subset):** *"The termly signal · enrolment, staff, attendance, and movement for this period ·
  `{n}` pages · **almost entirely auto-filled** from Omnischools. Infrastructure, results, and programmes
  are annual-only — they'll appear greyed."* Confirm mid-year lede copy with PO.

### 3.1 Step 1 — Academic year / cadence selector (`.year-selector-row`)
- Step tag: `① Academic year`.
- **Left:** `.year-label` **`Filing for`** · `.year-value` **`Academic year `** `<em>{year}</em>` `[computed]`.
- **Right (`.year-meta`)** `[computed]`: `{term} in progress · <b>day {d} of {total}</b>` + `<br>` +
  `Census window: {windowOpen} — {windowClose}`. Surface demo: *"Term 1 in progress · day 47 of 187 · Census
  window: 1 Sep — 31 Oct"*. **Mid-year window differs from annual — pull from the period, don't hard-code.**
  (Same stored-window gap flagged in `ledger-surface-map.md §3.7` / `incr57 drift #5`: if no
  `academic_period.census_window_*` field exists, omit the window line rather than invent dates — §10.)
- The surface note is explicit that the window line is **operationally critical** (late filing triggers GES
  penalties) — keep it prominent when the field exists.

### 3.2 Step 2 — School identification preview (`.id-preview`, 2×3 grid, read-only)
Six fields, `[computed from school config]`, mono for ID + year. Mirrors the GES form fields 1:1:

| Field (`.lbl`) | `.val` | Format |
|---|---|---|
| `School name` | `Christ the King JHS` `[demo]` | text |
| `GES School ID` | `4-2305-018` `[demo]` | **mono** |
| `District` | `Accra Metro` | text |
| `Circuit` | `Korle Klottey` | text |
| `Region` | `Greater Accra` | text |
| `Year established` | `1962` | **mono** |

- Read-only preview, not an edit form — sourced from school profile (the
  `schoolup-district-region-ownership` config). If a field is blank in config, show `—` and let the PDF print
  a hatched blank (§4); **do not block generation** on a missing identification field, but flag it in the
  foot summary count.
- **Mid-year addition — `own-ownership column`:** the mid-year field subset requires an **ownership** value
  (public / private / mission / …) that the surface's 6-field grid omits. Add it as a 7th id-row (or thread
  it into the enrolment table as the "own-ownership column"). Source: school config; AUTO. Flag placement
  with PO — recommended: 7th `.id-row` `Ownership` so it reads on the preview.

### 3.3 Step 3a — Auto-fill summary band (`.fill-summary`) — ALL FOUR NUMBERS COMPUTED
- Step tag: `③ What's included & auto-fill status`.
- `.fs-label` **`Census auto-fill progress`**.
- `.fs-pct` `[computed]` big italic **green** `{pct}%` (surface `71%`).
- `.fs-text` `[computed]`: *"of sections auto-filled by Omnischools · **`{needHand}` sections** still need
  your hand · estimated **`{mins}` minutes** of manual entry"* — `needHand = PARTIAL + NONE (in-scope)`;
  `mins` = a per-section estimate × `needHand` (flag the estimate constant to PO).
- `.progress-bar` `[computed]`: `bar-auto` width = `pct%` (solid green), `bar-manual` width = `100−pct%`
  (warn hatch). Surface note: **the hatch is deliberately the same texture as the PDF's hand-fill blocks** —
  the admin recognises "this hatched slice = the pen-fill work." Preserve that texture identity (§4).
- **Mid-year reality:** because the mid-year subset is almost entirely AUTO arms (§5), a well-configured
  school reads **~100%** here with an empty hand-fill list. The band's job in mid-year is mostly reassurance;
  its non-100% case is the **exception** (a school that hasn't marked attendance / recorded admissions this
  period) — see the empty/exception states in §6.

### 3.4 Step 3b — Section checklist (A–E), grouped by GES form section
Each `.checklist-section-header` = `<span>Section {X}</span> <b>{italic gold title}</b> <rule>`. Rows below.
**Every row's tag + check-mark is arm-computed (§2); the columns below give the surface's static demo tag AND
the computed/superseded truth.** `[demo]` meta = sample numbers the arm replaces.

**Section A · `Enrolment & demographics`**

| Row `.name` | `.meta` (surface `[demo]`) | Surface tag | Arm key | Cadence | Computed tag | Note |
|---|---|---|---|---|---|---|
| `Enrolment by class & gender` | `312 students · 9 classes · 157 boys, 155 girls` | Auto | `enrolmentByClassGender` | **MID** + annual | FULL→Auto | core mid-year arm |
| `Age-by-class distribution` | `Computed from student DOBs · ages 12—17 across JHS 1—3` | Auto | `ageByClassGender` | **MID (optional)** + annual | FULL→Auto / PARTIAL if DOBs missing | + `approved-age` optional |
| `Special needs enrolment` | `Not yet captured in Omnischools · blank fields will be left for manual entry` | Manual | `specialNeeds` | **annual-only** | greyed **`Annual`** in mid-year | **§9 supersession candidate** — a `schoolup-special-needs.html` module now exists; if its arm is live, annual coverage flips FULL/PARTIAL, not permanent MANUAL |
| `Movement (admissions, withdrawals, transfers)` | `Year-to-date · +18 admissions · −6 withdrawals · ±5 transfers` | Auto | `movementAdmissions` | **MID (admissions×sex only)** + annual (full) | FULL→Auto | mid-year narrows to **admissions-this-period × sex**; withdrawals/transfers are annual — relabel row in mid-year |
| `Repetition by class` | `From last year's promotion records · 14 repeaters across 9 classes` | Auto | `repetition` | **annual-only** | greyed **`Annual`** in mid-year | |

**Section B · `Staff`**

| Row `.name` | `.meta` `[demo]` | Surface tag | Arm key | Cadence | Computed tag | Note |
|---|---|---|---|---|---|---|
| `Teaching staff list` | `14 teachers · names, roles, gender, subjects` | Auto | `teachingStaff` | **MID** + annual | FULL→Auto | mid-year needs **count × gender**; PTR (below) derives from this |
| `Staff qualifications & certifications` | `8 of 14 staff have qualifications captured · 6 still need entry` | Partial | `qualifications` | **annual-only** | greyed **`Annual`** in mid-year | the surface's canonical PARTIAL example (`captured 8 / total 14`) |
| `Non-teaching staff` | `3 non-teaching · accountant, secretary, caretaker` | Auto | `nonTeachingStaff` | **MID** + annual | FULL→Auto | count × gender for mid-year |
| `Salary status (GES / private / unpaid)` | `Not captured in Omnischools · hand-fill against your school's records` | **Manual** | `salaryStatus` | **annual-only** | greyed **`Annual`** in mid-year | **§9 SUPERSEDED:** GOV-7 staff-compensation is **live** (migration 0030, `staff/compensation`) — in an *annual* run this is **AUTO-when-captured**, not Manual |

**Section C · `Attendance & academic`**

| Row `.name` | `.meta` `[demo]` | Surface tag | Arm key | Cadence | Computed tag | Note |
|---|---|---|---|---|---|---|
| `Attendance rate` | `Last full term: 93.5% · current term to date: 93.8%` | Auto | `attendanceRate` | **MID (current period)** + annual (full year) | FULL→Auto / **NONE→Manual if no days marked** | the most likely mid-year exception: unmarked attendance → hatched blank, **never a fabricated 0** |
| `BECE results · last year` | `From assessment module · 33 graduates · aggregate 18 average` | Auto | `terminalResults` | **annual-only** | greyed **`Annual`** in mid-year | **§9 SUPERSEDED:** GOV-6 terminal-results arm — AUTO-**when-captured**; if results not yet entered, coverage NONE (annual run), not blind Auto |
| `Academic performance · all classes` | `End-of-term averages by class & subject` | Auto | `academicPerformance` | **annual-only (per-subject)** | greyed **`Annual`** in mid-year | |

**Section D · `Infrastructure`** — *entire section annual-only; in mid-year all three render greyed `Annual`.*

| Row `.name` | `.meta` `[demo]` | Surface tag | Arm key | Cadence | Computed tag | Note |
|---|---|---|---|---|---|---|
| `Classrooms (count & condition)` | `Not tracked in Omnischools · count + condition per block` | Manual | `infrastructureClassrooms` | annual-only | greyed `Annual` | **§9 SUPERSEDED:** GOV-3 facilities arm — AUTO-when-captured |
| `Water, electricity, sanitation` | `Source, status, latrine count by gender` | Manual | `infrastructureUtilities` | annual-only | greyed `Annual` | **§9 SUPERSEDED:** GOV-3 |
| `Library, ICT lab, kitchen` | `Presence, equipment counts, condition` | Manual | `infrastructureFacilities` | annual-only | greyed `Annual` | **§9 SUPERSEDED:** GOV-3 |

**Section E · `Programmes & resources`** — *annual-only; genuinely HAND (no integration exists).*

| Row `.name` | `.meta` `[demo]` | Surface tag | Arm key | Cadence | Computed tag | Note |
|---|---|---|---|---|---|---|
| `School feeding programme` | `Participation status, meals served, supplier · hand-fill` | Manual | `feedingGSFP` | annual-only | greyed `Annual` | **genuinely HAND** — no GSFP register integration; stays Manual even annual |
| `Textbook availability` | `Inventory by subject & class · hand-fill from stockroom` | Manual | `textbooks` | annual-only | greyed `Annual` | **genuinely HAND** — stockroom count |

### 3.5 Step 4 — Output card (`.output-card`)
- Step tag: `④ Output`.
- Terra `PDF` chip + `.out-title` `[computed]` **`A4 portrait · {n} pages`** (mid-year < 10) + `.out-meta`
  **`Filename: `** `<span class="filename">{CODE}_GES_MidYearCensus_{year}.pdf</span>` `[computed]`
  (surface demo `CTK_GES_Census_2025-26.pdf`).
- **Filing note** `[computed deadline]` (italic, below card): *"After download, complete the manual sections
  in pen, sign, apply your school stamp, and submit two copies to the District Education Office before
  **`{deadline}`**."* Surface demo deadline `31 Oct 2025`. Pull the mid-year deadline from the window field
  (§3.1); omit if unstored (§10).

### 3.6 Foot (`.drawer-foot`)
- **Summary** `[computed]`: `<b>{FULL}</b> of <b>{inScope}</b> sections ` + `<em>auto-filled</em>` (italic
  gold). Surface demo `11 of 16 sections auto-filled` — replace both numbers with the computed in-scope
  tally (§2).
- **Meta-line** `[computed]`: `{School} · {year} {cadence} census`.
- **Actions:** `Cancel` (ghost, = close) · **`Generate PDF →`** (`.btn.primary`, navy). Generate is always
  enabled — a partially-captured census still generates (missing arms print as hatched blanks, §4). Surface
  note confirms **no skip-sections, no alternate format, no upload-to-GES** affordances (SRIMPR upload is out
  of scope; admin uploads the PDF themselves).

---

## 4. The hand-fill form + honest-absence (hatched blank) treatment

The census never fabricates a `0` for an uncaptured source. A `PARTIAL`/`NONE` arm produces **hatched
hand-fill blanks** carrying the arm's `reason` as the prompt. Two field kinds:

- **NOT_CAPTURED fields** — an arm exists but `coverage ≠ FULL` (e.g. attendance not marked, GOV-3
  infrastructure before capture). These are **flippable**: capturing the data (via the arm's own module /
  the GOV-6/7 capture form) turns the row `Auto`.
- **HAND fields** — no arm will ever fill them (`feedingGSFP`, `textbooks`). Permanent hatched blanks.

### 4.1 Where the hand-fill happens (two honest paths, admin's choice)
1. **In-app capture (preferred):** a NOT_CAPTURED row exposes a **"Fill by hand"** affordance that opens an
   in-app form **reusing the built report/capture grammar** (`components/reports/*`; the GOV-6
   `terminal-results-form.tsx` / GOV-3 `facilities-form.tsx` when built). Submitting flips the arm to
   `FULL`/`PARTIAL` and the row to `Auto`/`Partial`. This is the data-durable path.
2. **Print-and-pen (fallback):** if left uncaptured, the field prints as a hatched blank in the PDF (GOV-9)
   for pen-fill after download — the surface's baseline model ("complete the manual sections in pen").

### 4.2 Hatched-blank grammar (from surface CSS 875–1073) → Tailwind
| Surface class | Treatment | Tailwind |
|---|---|---|
| `.manual-fill` | 45° hatch bg, dashed border, `!` warn icon + heading + `reason` body | `bg-[repeating-linear-gradient(45deg,#FAF7F2,#FAF7F2_6px,rgba(217,211,194,0.4)_6px,rgba(217,211,194,0.4)_12px)] border border-dashed border-paper-line` + `!` chip `size-5 rounded-full bg-warn text-white` |
| `.manual-field` + `.mf-blank` | labelled cell w/ underline blank | `border border-paper-line bg-surface px-3 pt-2 pb-1.5` · label `text-[8px] font-bold uppercase tracking-[0.12em] text-navy-3` · blank `h-3.5 border-b border-navy-3` |
| `.infra-card` (+`.checkbox-empty`/`.checkbox-circle`) | dashed-hatch tick-grid | dashed hatched card; `size-[11px] border-[1.5px] border-navy-3 rounded-sm` (multi-tick) / `rounded-full` (single-choice) |
| `.infra-count-cell` + `.ic-blank` | dashed-hatch count blank | `border border-dashed border-paper-line bg-surface px-3 py-2`, blank `h-[18px] border-b border-navy-3` |
| `.auto-fill-block` + `.auto-pill` | green-`✓` "already auto" confirmation inside an otherwise-manual section | `bg-surface border border-paper-line` + `✓` `bg-green` chip + pill `bg-green-bg text-green` |
| `.provenance` | italic navy-3 note w/ gold left-border | `bg-bg border-l-2 border-gold px-2.5 py-1.5 text-[9px] italic text-navy-3` |

### 4.3 Hand-fill field inventory (verbatim labels + prompts, from surface markup)
For **mid-year** most of these sit behind the annual-only gate — the mid-year hand-fill form is typically
**empty** (§6). The full inventory is mapped so it is ready for the annual run and for the mid-year exception
(a NOT_CAPTURED mid-year arm):

- **Special needs (`specialNeeds`)** — `.manual-fill` heading **"To be filled by hand"**, prompt *"Enter the
  count of students by category. Use **0** if there are none. **Omnischools does not yet capture special
  needs data**; this section will be added in a future update."* — **12 `.manual-field` blanks** (×boys/girls):
  Visual impairment · Hearing impairment · Physical disability · Intellectual disability · Speech impairment ·
  Other (specify). *(Note: this prompt is the surface's; if the special-needs module's arm is live it
  supersedes — §9.)*
- **Salary status (`salaryStatus`)** — surface prints a per-staff table column `Salary [Manual]`. **SUPERSEDED
  by GOV-7** (live) — the annual run reads compensation from `staff/compensation`; hand-fill only for
  uncaptured staff.
- **Infrastructure — classrooms (`infrastructureClassrooms`)** — heading **"To be filled by hand · entire
  section"**; `.infra-count-cell` blanks: `Total classrooms` · `In good condition` · `Needing repair`; plus
  desk/board counts `Student desks · usable` / `· broken` · `Teacher desks` · `Chalkboards` · `Whiteboards` ·
  `Projectors`.
- **Infrastructure — utilities (`infrastructureUtilities`)** — `.infra-card` single-choice ticks:
  `Primary water source · tick one` → Borehole · Piped (GWCL) · Hand-dug well · Rainwater harvesting · Tanker
  delivery · None. `Electricity supply · tick one` → National grid (ECG) · Solar · Generator only · None.
  `Latrine type · tick` → Water closet (flush) · KVIP / VIP · Pit latrine · None. `Hand-washing facilities ·
  tick all that apply` → Tippy taps · Wash basins with running water · Veronica buckets · None. Count cells:
  `Latrines · boys` / `· girls` / `· staff`.
- **Infrastructure — facilities (`infrastructureFacilities`)** — `Library status` (Dedicated library room /
  Shared room-corner / None) · `Approx. book count` · `Library staff (FTE)` · `ICT lab status` · `Total
  computers` · `Working computers` · `Internet · tick` · `Kitchen status` · `Cooking fuel · tick all`.
- **School feeding (`feedingGSFP`, HAND)** — heading **"To be filled by hand"**, prompt names the **"Ghana
  School Feeding Programme"**; `GSFP participation status · tick one` → Active participant · Suspended (specify
  reason in notes) · Never enrolled; count cells `Meals served · last term` · `Pupils fed · daily avg` ·
  `Caterer / supplier name`.
- **Textbooks (`textbooks`, HAND)** — heading **"To be filled by hand"**, prompt *"Count the textbooks
  available in stockroom **by subject and class**…"*; a per-subject table (`JHS 1/2/3 books` blanks) with a
  computed **`Need (per pupil)`** column (312 = current enrolment) and provenance note *"'Need' column is
  computed from current enrolment… The District Officer uses this to plan supplementary distribution."*

---

## 5. Mid-year vs annual visibility matrix (the decision the cadence param drives)

**MID-YEAR (GOV-8) in-scope arms** — active rows, count toward fill %:
`identification` · `enrolmentByClassGender` · `ownership` · `ageByClassGender` (optional) ·
`movementAdmissions` (admissions-this-period × sex) · `teachingStaff` · `nonTeachingStaff` · `ptr` (derived:
enrolment ÷ teaching count, AUTO) · `attendanceRate` (current period).

**ANNUAL-ONLY arms** — in a mid-year run render `.checklist-row.disabled` (`opacity-50`) with an **`Annual`**
tag, **excluded from the fill %**: `specialNeeds` · `repetition` · `qualifications` · `salaryStatus` ·
`terminalResults` · `academicPerformance` · `infrastructureClassrooms/Utilities/Facilities` · `feedingGSFP` ·
`textbooks`.

- **`ptr` and `ownership` are mid-year fields the surface checklist doesn't render as rows** — PTR is a
  derived AUTO figure (surface only shows it in the PDF), ownership is an identification/enrolment column.
  Decision to flag: render them as explicit mid-year checklist rows (recommended, so the admin sees them
  auto-filled) or keep them table-only. Default: add PTR + ownership as mid-year `Auto` rows in Sections
  A/B respectively.
- The surface renders 17 rows because it is the **annual** demo; the mid-year drawer shows the **9 in-scope
  rows active + the 10 annual-only rows greyed**. Do not hide the greyed rows — the surface intent (task
  brief) is to *show* the fuller census exists but mark it annual-only, so the admin understands mid-year is a
  subset, not a broken/short form.

---

## 6. Interaction states (every state, per region)

| Region | State | Visual / copy |
|---|---|---|
| Drawer | closed / open | slides from right over `.drawer-overlay` scrim; `×` / `Cancel` close |
| Fill % band | `[computed]` populated | green fill = `pct%`, hatch = remainder; all 4 numbers from arms (§2) |
| Fill % band | **100% (mid-year happy path)** | `100%` green, `.fs-text` → **"every mid-year section auto-filled · nothing needs your hand"**, hatch slice absent |
| Checklist row | FULL | `✓` green, `Auto` tag, `.meta` = arm's inline verification (`[demo]` "312 students · 157 boys, 155 girls") |
| Checklist row | PARTIAL | `!` warn, `Partial` tag, `.warn` tint, `.meta` = `{captured} of {total} … · {reason}` |
| Checklist row | NONE | `!` warn, `Manual` tag, `.warn` tint, `.meta` = arm `reason` (honest — no number); **"Fill by hand" affordance** (§4.1) |
| Checklist row | annual-only in mid-year | `.disabled` `opacity-50`, `Annual` tag, no check-mark action, excluded from % |
| Checklist section | empty of in-scope rows | in mid-year a section may show only greyed rows — keep the header, the greyed rows read as "annual scope" |
| Hand-fill form | **empty (mid-year happy path)** | no NOT_CAPTURED/HAND fields → positive empty state: **"Nothing to hand-fill — every mid-year section auto-filled from Omnischools."** Do NOT render an empty hatched shell |
| Hand-fill form | **exception (mid-year NONE arm)** | e.g. attendance unmarked → single hatched block with the arm `reason`; **never a fabricated 0** |
| Hand-fill form | populated / submitted | on submit, arm flips to FULL/PARTIAL, row re-tags `Auto`/`Partial`, % recomputes |
| Identification | missing field | `—` in the cell (never blank-that-reads-as-0); prints hatched blank in PDF; does not block Generate |
| Drawer | **loading** | server-rendered from the arm reads (page is `dynamic`); first paint is populated — no client skeleton. If arm reads are async on open, a lightweight "Reading your data…" line in the fill band is acceptable; confirm SSR vs client |
| Drawer | **error** (an arm read throws) | route error boundary (existing pattern) — do NOT show a fabricated-complete census; fail loud so no false 100% ships |
| Generate | idle / generating / done | `Generate PDF →` → spinner/disabled while the PDF composes → hands to GOV-9 preview (§11) |
| Foot summary | `[computed]` | `{FULL} of {inScope} … auto-filled`; never the surface's static `11 of 16` |

**The census-specific multi-state flow** (the surface's defining interaction): every row cycles
`FULL → PARTIAL → NONE`, gated by `annual-only`, and the fill band + foot summary are **live reductions** of
those row states. The honest-absence rule is the invariant across all of them: **a source that isn't there
renders a hatched blank, never a zero.**

---

## 7. Responsive / PWA

- **No PWA / phone-first variant.** This is a Headmaster/Admin desktop statutory task (same posture as the
  `incr57` management surfaces). The surface's only media query stacks the doc/notes layout (`max-width:
  1280px` → single column); the drawer itself is a fixed 540px panel.
- On narrow viewports the 540px drawer becomes near-full-width (`w-full max-w-[540px]`); the body scrolls; the
  head + foot stay pinned (`flex-shrink-0`). The `.id-preview` 2-col and `.manual-fields-grid` 2-col collapse
  to 1-col below `sm`.
- Print/PDF composition is GOV-9's concern (§11); the drawer has no print styles.

---

## 8. Cross-module hooks (design commitments to preserve)

| Hook | Where | Preserve as |
|---|---|---|
| **enrolment/attendance/staff modules → census arms** | every `Auto` row | the census is a **read/reduction** of live module data, not a re-entry form. One arm read per section; never fabricate. |
| **GOV-3 facilities → infrastructure arms** | Section D | infrastructure is AUTO-**when-captured** via `facilities-form.tsx`; supersede the surface's "Manual" (§9). The drawer's "Fill by hand" for infra should route to the GOV-3 capture form, not a bespoke blank. |
| **GOV-6 terminal-results → results arm** | BECE/WASSCE row | AUTO-when-captured via `terminal-results-form.tsx`; a not-yet-entered result is `NONE` (hatched), never blind `Auto`. |
| **GOV-7 staff compensation → salary arm** | salary row | **live** (`staff/compensation`, migration 0030) — annual salary reads from it. This is the one supersession confirmed shippable in this worktree. |
| **census fill-% + row states → GOV-9 PDF** | Generate → preview | the computed coverage per arm drives which PDF cells auto-fill vs print hatched. Row-state and PDF-cell state are the **same** arm coverage — one source (§11). |
| **census → District Education Office (SRIMPR)** | output filing note | Omnischools generates + the admin files two stamped copies; **no in-app upload** (out of scope, surface-confirmed). Preserve the manual-filing copy. |

---

## 9. Static-tag → computed-status SUPERSESSION log (flag every one to the implementer)

The surface's tags are frozen at its authoring date (pre-GOV-3/6/7). **Do not port them literally.** Each row
below: what the surface *shows* vs what the arm *now computes*.

| Row | Surface static tag | Computed truth (build this) |
|---|---|---|
| Salary status | **Manual** | **AUTO-when-captured** — GOV-7 compensation is live (migration 0030). Annual: FULL if compensation recorded, else NONE. |
| Classrooms / Utilities / Facilities (Section D) | **Manual** (×3) | **AUTO-when-captured** — GOV-3 facilities arm. NONE only until captured; "Fill by hand" routes to `facilities-form`. |
| BECE / terminal results | **Auto** (blind) | **AUTO-when-captured** — GOV-6 arm. If results not entered → NONE (hatched), not a false Auto. |
| Special needs | **Manual** ("not yet captured… future update") | **AUTO-when-captured IF** the `schoolup-special-needs` module's arm is live — verify; else remains HAND with the surface prompt. |
| Fill % `71%` / `5 sections` / `20 min` / foot `11 of 16` | **hard-coded, internally inconsistent** (17 rows, 9 Auto+1 Partial) | **all four computed** from in-scope arm coverage (§2). Carry none of the literals. |
| Every `Auto`/`Partial`/`Manual` tag | static class in markup | **pure function of arm `coverage`** (§2 table), gated by cadence (§5). |

---

## 10. Drift / open questions (for PO / Kofi)

1. **Census-window dates not stored.** The Step-1 window line + Step-4 deadline (`1 Sep — 31 Oct` /
   `31 Oct 2025`) are demo copy; no `academic_period.census_window_open/close`. Same gap as
   `ledger-surface-map.md §3.7`. **Omit the window/deadline lines until a per-`(school × period × cadence)`
   window field exists** rather than invent dates. Recommend adding it (mid-year and annual windows differ).
2. **Cadence default.** Confirm whether a missing `?cadence=` defaults to `annual` or is always set by the
   entry point. Recommend the entry point always sets it explicitly.
3. **PTR + ownership as visible rows.** Mid-year subset needs both, but the surface checklist has no row for
   either (PTR is PDF-only, ownership is an id column). Recommend rendering both as mid-year `Auto` rows.
   Confirm.
4. **`movementAdmissions` mid-year scope.** Surface row is full movement (admissions/withdrawals/transfers);
   mid-year subset is **admissions-this-period × sex** only. Relabel the row + narrow the arm for mid-year.
   Confirm the exact mid-year movement fields.
5. **Fill-% weighting of PARTIAL + the minutes estimate.** Recommend PARTIAL counts as "needs hand" (not
   fractional); `mins = perSectionConstant × needHand`. Confirm the per-section minute constant, or drop the
   minutes phrase for mid-year (near-100% makes it noise).
6. **Special-needs arm liveness (§9).** Verify whether the special-needs module exposes a census arm; it
   changes SEN from permanent-HAND to AUTO-when-captured.
7. **In-app hand-fill vs print-and-pen (§4.1).** Confirm GOV-8 ships the in-app "Fill by hand" capture path
   (routing to GOV-3/6 forms) or defers to print-and-pen for v1. The surface only models print-and-pen.

---

## 11. Where GOV-9 picks up (the hand-off, not mapped here)

`Generate PDF →` composes the return and opens the **PDF preview — GOV-9** (surface §02, lines 1680–2587):
the navy GES band, the **cover page** (school crest, academic year, `.cover-stats`), the **content pages**
(`.pdf-table` enrolment/staff/attendance/results tables, `.pdf-id-grid`, the in-PDF `.manual-fill` hatched
blocks for uncaptured arms, `.provenance` lines, `.auto-cell` green-dot auto indicators), the **declaration**
(`.pdf-declaration`, `.dec-signature-grid`, simulated `.sig-mark`), and the **school stamp** (`.school-stamp`
terra ring). **GOV-9 owns all of that.** The only shared contract across the seam: **per-arm coverage** — the
same `FULL/PARTIAL/NONE` that drives a drawer row's tag drives whether the matching PDF cell auto-fills or
prints a hatched blank. Map that seam once so the two surfaces can never disagree.

---

*Map produced against: `Surfaces/schoolup-annual-census.html` §01 (drawer markup 1336–1678, CSS 120–535,
notes 1654–1676) + the hand-fill grammar in its PDF blocks (875–1073, 1933–2508); the built
`app/(app)/staff/compensation/` + `db/schema/staff.ts` (GOV-7 salary arm, migration 0030) and
`components/reports/*` grammar; the task's GOV-8 SPEC (Kofi R386–R405). GOV-6 `terminal-results-form.tsx` /
GOV-3 `facilities-form.tsx` and the statutory route are referenced-not-present (pre-implementation) and mapped
to the arm contract. Follows the shape of `docs/senior/ledger-surface-map.md` /
`docs/senior/incr57-headmaster-rollup-surface-map.md`.*
