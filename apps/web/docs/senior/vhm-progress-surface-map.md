# SHS Score Ledger — Surface Map (Item 3: Vice Headmaster Academic progress view)

**Author:** Lucy (design cartographer) · **Status:** design spec, ready for the implementation engineer.
**Scope of this map:** Score Ledger **Item 3** — the Vice Headmaster Academic progress view (spec `md files/SHS_SCORE_LEDGER_SPEC.md` §6). This is the **management/oversight read** of ledger completion: three cascading surfaces (per-teacher table · at-risk flags · Headmaster roll-up), all reading the same per-teacher completion data.

This is an exhaustive 1:1 map of the source surface onto the existing Next.js Senior idioms. Where surface and spec disagree, the rule is **spec wins on logic, surface wins on visual presentation** — every drift is called out inline and collected in the **Open questions / drift log** at the end.

The **single most important thing this surface is _not_**: it is not the ledger grid. Item 1 (`senior-ledger-grid.tsx`) shows *score values* to the teacher who owns them. This surface shows *completion states only* to a manager who must never see the values (spec §6.2). Everything below serves that discipline.

## Source surfaces (visual source of truth — replicate 1:1)

| Surface file | Role in this map |
|---|---|
| `Surfaces/schoolup-shs-vice-headmaster-progress.html` | **PRIMARY.** Three sections, three routed screens: §1 per-teacher progress table (VHM), §2 at-risk flags (VHM), §3 Headmaster roll-up. Each wrapped in the editorial browser-frame chrome that the implementer strips (build the in-app `.main` only). |

## Canonical inputs

- **Tokens:** `md files/design-tokens.json` (v1.0.0) + live `omnischools/styles/tokens.css`. Runtime uses **Tailwind token classes** (`text-navy`, `bg-gold-bg`, `border-border`, `font-display`, `max-w-page`), **never inline `var(--x)` in JSX**. The surface is hand-written HTML with `var(--x)`; translate each to the Tailwind class of the same token. **The token table from the Item-1 map (`ledger-surface-map.md` §0) applies verbatim** and is reproduced condensed in §0 below.
- **Spec:** `SHS_SCORE_LEDGER_SPEC.md` §6 — §6.1 (ten columns + filters + default sort), §6.2 (completion-not-score discipline), §6.3 (three at-risk rules), §6.4 (Headmaster subject-level cascade).
- **Item-1 map:** `omnischools/docs/senior/ledger-surface-map.md` — the VHM vocabulary noted there (path pills A/B/C, `stpshs-cell` ready/behind/at-risk, ✓/¾/— category dots) is authoritative and must stay consistent; this map is its downstream consumer.
- **Shipped idioms to match:** `omnischools/app/(app)/senior/score-ledger/page.tsx` (hero header block, `withSchool`/`requireSchool` server fetch, `?classId&subjectId&periodId` query params, `academic_period.period_label`), `omnischools/components/senior/senior-ledger-grid.tsx` (sticky-left table, token cell classes), `omnischools/components/gradebook/selectors.tsx` (query-param filter precedent).
- **Schema already present:** `omnischools/db/schema/score-ledger.ts` (`seniorScoreLedger`, `seniorAssessments`, `assessmentWeights`), `omnischools/db/schema/anomaly.ts` (`ref_anomaly_rule` — the flag engine), `omnischools/db/schema/timetable.ts` (`timetable_slot.teacherUserId` — the *only* teacher↔class×subject link that exists; see the drift log, this is the central data-model gap).

---

## 0. Token & type reference (condensed — full table in `ledger-surface-map.md` §0)

| Surface `var(--x)` | Tailwind class | Used for on THIS surface |
|---|---|---|
| `--navy` `#1A2B47` | `text-navy` / `bg-navy` | primary text, discipline banner bg, primary buttons, deep-navy sidebar override note |
| `--navy-2` `#2D3F5C` | `text-navy-2` | secondary text, MS/ES header labels, risk-card body |
| `--navy-3` `#5C6675` | `text-navy-3` | muted meta, crumbs, `.last-active`, pending-dot colour |
| `--navy-deep` `#13203A` | `bg-navy-deep` | **Oversight** app-shell sidebar (the surface's default `.sidebar` = `#13203A`); **but Senior override forces `bg-navy`** — see §1.1 |
| `--gold` `#C8975B` | `text-gold` / `bg-gold` | accents, italic `<em>`, path-pill B text, `stpshs-cell.behind` text, med-risk icon |
| `--gold-soft` `#E8D4B8` | `border-gold-soft` | gold-tinted borders |
| `--gold-bg` `#F5EBDC` | `bg-gold-bg` | row hover, path-pill B bg, `stpshs-cell.behind` bg, `cat-dot.partial`… no wait: partial = solid gold; `behind` pills = gold-bg |
| `--bg` `#FAF7F2` | `bg-bg` | page bg, table-head bg, low-risk card bg |
| `--surface` `#FFFFFF` | `bg-surface` | cards, panels, table body |
| `--green` `#2F6B47` | `text-green` / `bg-green` | path-pill A, `cat-dot.done`, `stpshs-cell.ready`, "complete" roll-up accent |
| `--green-bg` `#E5EFE8` | `bg-green-bg` | path-pill A bg, `stpshs-cell.ready` bg |
| `--terra` `#B84A39` | `text-terra` / `bg-terra` | path-pill C, `cat-dot.late`, `stpshs-cell.at-risk`, `.last-active.stale`, high-risk card, "at risk" roll-up |
| `--terra-bg` `#F5E1DC` | `bg-terra-bg` | path-pill C bg, `stpshs-cell.at-risk` bg, high-risk card bg |
| `--warn` `#C58A2E` | `text-warn` | (defined; used on other ledger surfaces for low-conf — **unused on this surface**) |
| `--warn-bg` `#F5E9D0` | `bg-warn-bg` | (Item-1 `behind` variant uses this; **this surface uses `gold-bg` for `behind` instead** — drift note §1.4) |
| `--border` `#E5DFD3` | `border-border` | dividers, card borders |
| `--border-2` `#D4CCBA` | `border-border-2` | stronger borders, buttons, `cat-dot.pending` bg |

**Type families:** `font-display` = Fraunces (headings, section numerals, stat numbers, italic gold `<em>`); `font-body`/Manrope (body, labels, teacher names); `font-mono` = JetBrains Mono (**path pills, cat-dots, stpshs-cell counts, last-activity, all counts**). Every count ("0/5", "4 of 6"), every path letter, every last-activity string is `font-mono`.

**Convention:** an unentered category renders the em-dash `—` in `cat-dot.pending`, never `0` / `N/A`. (The dot is the state; the surface deliberately shows no numeric score anywhere — see §1.3.)

---

## Which surface renders where — the three screens

The one HTML file is three routed screens sharing the Senior app-shell. Recommended routes (extending the `/senior/score-ledger` precedent):

| Section | Screen | URL in surface | Suggested route | Role viewing |
|---|---|---|---|---|
| §1 | Per-teacher progress table | `…/senior/academic-progress/semester-2-2025-26` | `/senior/academic-progress` | Vice Headmaster Academic |
| §2 | At-risk flags | `…/senior/academic-progress/risks` | `/senior/academic-progress/risks` | Vice Headmaster Academic |
| §3 | Headmaster roll-up | `…/senior/headmaster-summary/semester-2-2025-26` | `/senior/headmaster-summary` | Headmaster |

§1 and §2 are the same role's two tabs; §3 is a **different role's** landing. The roll-up (§3) **is on a separate surface**, not embedded in the VHM view (spec §6.4 confirmed by the surface: distinct sidebar scope-chip `Mr. V. Yanney · Headmaster`, distinct nav, distinct URL). See §3.

---

# SECTION 1 — Per-teacher progress table (the core)

Source: surface §1. Demo: **Asankrangwa SHS · Mrs. P. Anim (Vice Headmaster Academic) · Semester 2 of 2025/26 · 14 teachers · 23 class-subject combinations · STPSHS window opens 14 July 2026.**

## 1.0 Editorial page-header (design-doc chrome — DO NOT build)

The outer `.page-header` (mvp-tag `Omnischools Senior · Vice Headmaster Academic · Progress view`, `<h1>Who's done, <em>who's not.</em></h1>`, gold rule, lede paragraph) is the design-doc framing above the browser mock. **Build the in-app `.page-head` inside the app-shell (§1.2), not this.** The lede's content, however, is the spec source for §6.2's discipline and should inform the in-app discipline banner copy.

## 1.1 App shell — sidebar + main

- **Sidebar** — the surface's base `.sidebar` is Oversight deep-navy `#13203A`, **but the Senior override at CSS line 254 forces `.app-shell .sidebar { background: var(--navy) }`.** Build the sidebar `bg-navy` (regular Senior operational navy, matching the Item-1 ledger sidebar), **not** `bg-navy-deep`. Width 230px.
  - **Brand crest** (`.gov-mark`): gold rounded square badge `A` (`bg-gold text-navy font-display`) + `Omnischools Senior` (`.l1`, `font-display 14px`) / `Asankrangwa SHS` (`.l2`, `text-gold-soft 9px uppercase tracking-[0.14em]`).
  - **Scope chip** (`.scope-chip`, `bg-[rgba(200,151,91,0.10)] border-[rgba(200,151,91,0.25)] rounded-md`): label `Role` (`.sc-label`, gold `8.5px uppercase`), name `Mrs. P. Anim` (`.sc-name`, `font-display 14px`), meta `Vice Headmaster Academic` (`.sc-meta`, `text-gold-soft 10px`). **Note this is a `Role` chip, not the Item-1 `Teaching` chip** — the VHM's scope is school-wide, not a class-subject.
  - **Nav groups + items (verbatim, §1 & §2 identical):** group `Academic management` → **Ledger progress (active)** · Teachers · Classes & subjects · Timetable. group `Term cycle` → Assessment calendar · Report cards · STPSHS submissions. group `School` → All students · Parents. Active item = `bg-[rgba(200,151,91,0.10)] text-bg border-l-2 border-gold`; inactive `text-[rgba(250,247,242,0.7)]`.
  - **Footer:** avatar `PA` (`bg-gold-soft text-navy font-display`) / `P. Anim` / `Vice Headmaster Academic`. `Powered by <em class="text-gold">Omnischools</em>`.
- **Main** `bg-bg`.

## 1.2 `.page-head` (in-app header — BUILD THIS)

Reuse the shipped hero idiom (`score-ledger/page.tsx` lines 320–343: eyebrow/crumb → `font-display` h1 with italic gold `<em>` → lede → right-aligned actions).

- **Crumb** (`.crumb`, `text-navy-3 11px uppercase tracking-[0.12em]`): `Senior · Vice Headmaster · Academic progress · Semester 2 of 2025/26`.
- **h1** (`font-display 28px 500`): `Score ledger <em class="text-gold italic">progress.</em>`
- **Lede** (`.lede`, `text-navy-3 13px`): `14 teachers · 23 class-subject combinations · STPSHS window opens 14 July 2026 — 17 days from now`. The "17 days from now" is **computed** from `academic_period` / the STPSHS window date, not literal.
- **Actions** (right): `Filter` (`.btn.ghost` = `bg-transparent border-border-2 text-navy-3`) · `Export PDF` (`.btn.ghost`) · **`Message behind teachers →`** (`.btn.primary` = `bg-navy text-bg`). The primary action is a **bulk comms** action scoped to the currently-behind set (ties to `Message all flagged teachers` in §2).

## 1.3 The discipline banner (`.discipline-banner`) — the completion-not-scores contract, made visible

**This is the §6.2 discipline rendered as a first-class UI element and must not be dropped.** Full-width navy gradient card above the table.

- Container: `bg-[linear-gradient(135deg,navy,navy-2)] text-bg rounded-xl px-[22px] py-4 mb-[18px]`, grid `auto 1fr`.
- Icon (`.db-icon`): gold rounded square `bg-gold text-navy font-display italic`, glyph `i`.
- Text (`.db-text`, `12px`, `<b>` accents in `font-display italic text-gold`): verbatim —
  > This view shows **completion progress**, not the score values themselves. The Vice Headmaster sees which categories each teacher has entered; the marks themselves remain the teacher's domain until the semester is closed. To inspect actual scores, navigate to the gradebook — that access is audit-logged, the same way Oversight's compliance record view is.

**Discipline audit (brief requirement — CONFIRMED CLEAN):** I traced every cell rendered on this surface. **No score value appears anywhere.** The columns render category *states* (✓ / ¾ / ⅔ / —), path letters, aggregate counts (`0/5`, `2/5`), status pills, and relative dates. The one place a number-that-looks-like-a-mark could leak is the cat-dot — but `¾` and `⅔` are **completion fractions** (assignments 3-of-4 entered), not scores. The implementer must preserve this: the cat-dot's value is derived from *how many category-entries exist*, never from `weighted_total` or any `*_score` column. **Any future addition of a mean/average/total column to this table breaks the §6.2 contract and must be rejected.** The banner's promise ("navigate to the gradebook, audit-logged") is the sanctioned escape hatch — a per-teacher link to the audit-logged ledger view, not an inline reveal.

## 1.4 The completion table (`.vha-table`) — spec §6.1, ten logical columns

Wrapped in a `.panel` (`bg-surface border border-border rounded-[14px]`). Panel-head: title `Teacher × class · <em class="text-gold">23 combinations</em>` (`font-display 17px`) + meta `Sorted by STPSHS readiness · most behind first` (`.ph-meta`, `10px uppercase text-navy-3`).

Reuse `senior-ledger-grid.tsx`'s table mechanics: `overflow-x-auto rounded-xl border`, `thead` = `bg-bg text-[9px] uppercase tracking-[0.1em] font-bold text-navy-3`, `tbody` rows `divide-y divide-border`, `tr:hover td → bg-gold-bg`. **The header is `position: sticky; top: 0`** (`.vha-table thead th` — sticky on vertical scroll, since this table is long; the teacher column is NOT sticky-left here, unlike the ledger grid, because the surface doesn't declare it — see drift §D3).

### The columns — surface headers vs spec §6.1, exhaustive

The surface **compresses** the spec's ten columns into **eight rendered columns**. The mapping (this reconciliation is the heart of the map):

| # | Spec §6.1 column | Surface header | Cell render (verbatim from surface) | Token/class |
|---|---|---|---|---|
| 1 | Teacher (name + subject) | **Teacher** | `<div class="teacher-name">B. Akoto</div>` + `<span class="teacher-subjects">Government</span>` | name `font-bold text-navy`; subject `9.5px text-navy-3` block |
| 2 | Class (form + programme) | **Class · subject** | `<div class="class-name">Form 3 Arts A</div>` | `font-semibold text-navy-2` |
| 3 | Path (A/B/C) | **Path** (center) | `<span class="path-pill b">B</span>` | see §1.5 |
| 4 | Assignments (count/expected + bar) | **Asg** (cat-col, `text-green`) | `<span class="cat-dot done">✓</span>` | see §1.6 · **DRIFT §D1: surface shows a dot, NOT a "count/expected + progress bar"** |
| 5 | Mid-semester exam (entered+date) | **MS** (cat-col, `text-navy-2`) | `cat-dot` (✓/¾/—) | §1.6 · **DRIFT §D1: no date shown** |
| 6 | End-of-semester exam (entered+date) | **ES** (cat-col, `text-navy-2`) | `cat-dot` | §1.6 · no date |
| 7 | Project work (entered+date) | **Proj** (cat-col, `text-green`) | `cat-dot` | §1.6 · no date |
| 8 | Portfolio (entered+date) | **Port** (cat-col, `text-terra`) | `cat-dot` | §1.6 · no date. **Portfolio header is `text-terra`** — the same "one category Omnischools can't compute" colour as Item 1 |
| 9 | STPSHS export ready (Yes/No missing X) | **STPSHS** (center) | `<span class="stpshs-cell at-risk">At risk · 0/5</span>` | see §1.7 |
| 10 | Last activity | **Last activity** (right) | `<span class="last-active stale">19 days ago</span>` | see §1.8 |

**Header colour coding (must preserve, matches Item-1 §3.4 semantic key):** Asg + Proj = `text-green` (auto-computable "safe" categories); MS + ES = `text-navy-2` (the two exams); **Port = `text-terra`** (the one manual-only category). This is the same five-category colour vocabulary as the ledger grid — a VHM glancing across knows terra = portfolio without a legend.

## 1.5 The path pill (`.path-pill`) — A/B/C, spec/Item-1 colour vocabulary

`font-mono 9px font-bold rounded-full px-[7px] py-[3px] tracking-[0.04em]`, one letter:

| Path | Class | Colour | Tailwind |
|---|---|---|---|
| **A** — Auto-compile | `.path-pill.a` | green | `bg-green-bg text-green` |
| **B** — Scan paper | `.path-pill.b` | gold | `bg-gold-bg text-gold` |
| **C** — Direct digital | `.path-pill.c` | terra | `bg-terra-bg text-terra` |

**These are exactly the colours the Item-1 map (§6) pinned for the VHM `.path-pill`.** Keep them. The path is per `(teacher × subject × class × semester)` and affects what "complete" looks like (a Path C teacher shows progress cell-by-cell early; a Path B teacher shows nothing until the semester-end scan) — the pill tells the VHM which reading applies. **In-table legend footer** (`.legend`-style, below the table) spells them out: `A Auto-compile · B Scan paper · C Direct digital`.

## 1.6 The category dot (`.cat-dot`) — the completion state, NOT a score

`inline-flex 22×22px rounded-md font-mono 11px font-bold`, four states:

| State | Class | Glyph | Colour | Meaning |
|---|---|---|---|---|
| Entered / complete | `.cat-dot.done` | `✓` | `bg-green text-bg` | category fully entered |
| Partial | `.cat-dot.partial` | `¾` or `⅔` | `bg-gold text-navy` | some but not all entries in (e.g. 3 of 4 assignments) — the glyph is a **completion fraction**, surface uses `¾` and `⅔` literally |
| Pending | `.cat-dot.pending` | `—` | `bg-border-2 text-navy-3` | nothing entered |
| Late | `.cat-dot.late` | (n/a in demo rows) | `bg-terra text-bg` | **defined in CSS, unused in demo** — reserved for "entry expected by calendar but overdue" |

**Table-foot legend** (below `.vha-table`, `10.5px text-navy-3`): three 16px dots — `✓ Entered · ¾ Partial · — Pending`. The `.late` state has no legend entry (unused). **DRIFT §D2:** the `.cat-dot.late` (terra) state exists but no demo row triggers it and there is no legend for it — the implementer must decide the trigger (spec is silent; likely "a single-event category — MS/ES/Proj — whose assessment date has passed with no entry"). This is where the spec §6.1 "entered (date)" data would surface as a *state* rather than a *date*.

## 1.7 The STPSHS-ready cell (`.stpshs-cell`) — spec §6.1 col 9, the three-tier readiness

`inline-block font-mono 10px font-bold rounded-full px-2.5 py-1 uppercase tracking-[0.04em]`. **Format: `<Tier> · <n>/5`** — tier word + categories-entered-of-five:

| Tier | Class | Colour | Demo values | Meaning (spec §6.1 / §6.5-note) |
|---|---|---|---|---|
| **Ready** | `.stpshs-cell.ready` | `bg-green-bg text-green` | `Ready · 5/5` | all five categories in — STPSHS-exportable |
| **Behind** | `.stpshs-cell.behind` | `bg-gold-bg text-gold` | `Behind · 2/5`, `Behind · 3/5`, `Behind · 4/5` | window approaching, teacher still has categories outstanding |
| **At risk** | `.stpshs-cell.at-risk` | `bg-terra-bg text-terra` | `At risk · 0/5` | window has effectively arrived and the teacher hasn't moved |

**These are the exact three tiers the Item-1 map (§3.7) said the teacher's grid completion summary must map onto** — teacher view and VHM view share `ready / behind / at-risk` vocabulary so a conversation between them needs no translation (spec §6.1). The `n/5` is the count of the five categories in a `done`-or-better state.

> **DRIFT §D4 — `behind` colour differs from Item-1.** The Item-1 map's class-tab status pill used `behind = bg-warn-bg text-warn` (§3.3). **This surface uses `behind = bg-gold-bg text-gold`.** Same semantic, different token. Since the two live on different surfaces the visual clash is invisible to any one user, but the implementer should pick one and note it. **Recommendation: follow THIS surface (`gold-bg`/`gold`) for the VHM `stpshs-cell`**, since it's the surface being built; leave the Item-1 class-tab as-is or reconcile later. The tier→calendar calibration (Ready/Behind/At risk are calibrated against the *window date*, not an arbitrary %) is spec §6.1 and identical either way.

## 1.8 Last activity (`.last-active`) — spec §6.1 col 10

`font-mono 10px text-navy-3`, right-aligned. Renders a **relative** string: `today`, `yesterday`, `2 days ago`, `3 days ago`, `4 days ago`, `19 days ago`. **`.stale` variant** = `text-terra font-bold` — applied when the teacher is inactive past the 14-day threshold (the demo's "19 days ago" rows are `.stale`). This column is the visual seed of the §6.3 "inactive 14+ days" flag; the flag engine (§2) reads the same underlying `last_touched_at`.

## 1.9 Default sort & the overflow row

- **Default sort = STPSHS readiness, most-behind first** (spec §6.1, panel-head meta confirms "Sorted by STPSHS readiness · most behind first"). Demo order: the two `At risk · 0/5` rows (B. Akoto ×2, `19 days ago` stale) first, then `Behind · 2/5`, `3/5`, `4/5` ascending, then `Ready · 5/5` last. **Sort key = (tier rank: at-risk<behind<ready) then (n ascending) then (last-activity descending staleness).** The most consequential cases are visually loudest at the top.
- **Overflow row** (`opacity:0.4`, `colspan=10`, `font-style:italic text-navy-3 center`): `… 14 more class-subject combinations · 5 ready, 8 behind, 1 at risk`. This is the truncation affordance (demo shows 9 of 23 rows) — build as a "show all / paginate" footer, or virtualise. The tally string (`5 ready, 8 behind, 1 at risk`) is a live aggregate.

## 1.10 Filters (spec §6.1) — reuse the `GradebookSelectors` query-param precedent

Spec §6.1: **filter by teacher, subject, form, programme, and submission status.** The surface renders a `Filter` ghost button (unexpanded); the mechanism is the shipped `GradebookSelectors` pattern (`components/gradebook/selectors.tsx`) — linked `<select>`s that push to the route via `URLSearchParams`. For this surface the params are `?teacherId&subjectId&form&programme&status` on `/senior/academic-progress`. Default (no params) = the STPSHS-readiness sort above, all rows. The `status` filter values map to the three `stpshs-cell` tiers (`ready|behind|at-risk`). **DRIFT §D5:** the surface does not render an expanded filter bar — only the button. The implementer builds the filter row from the spec's five dimensions using the `selectors.tsx` idiom; the surface gives colour/placement precedent only via the `Filter` button in `.actions`.

## 1.11 Demo rows (verbatim — the data contract)

The exact eight visible rows (each is one `(teacher × class-subject)` combination), so the implementer can seed/verify:

| Teacher (subject) | Class | Path | Asg | MS | ES | Proj | Port | STPSHS | Last activity |
|---|---|---|---|---|---|---|---|---|---|
| B. Akoto (Government) | Form 3 Arts A | B | — | — | — | — | — | At risk · 0/5 | 19 days ago (stale) |
| B. Akoto (Government) | Form 3 Arts B | B | — | — | — | — | — | At risk · 0/5 | 19 days ago (stale) |
| J. Asare (Chemistry) | Form 2 Science | A | ✓ | ✓ | ¾ | — | — | Behind · 2/5 | 2 days ago |
| M. Boateng (English) | Form 1 General | C | ✓ | ✓ | ✓ | ⅔ | — | Behind · 3/5 | today |
| A. Nkrumah (Biology) | Form 2 Science | B | ✓ | ✓ | ✓ | ✓ | — | Behind · 4/5 | yesterday |
| K. Owusu (Mathematics) | Form 2 Science | A | ✓ | ✓ | ✓ | ✓ | — | Behind · 4/5 | today |
| K. Owusu (Mathematics) | Form 2 General | A | ✓ | ✓ | ✓ | ✓ | — | Behind · 4/5 | today |
| F. Sarpong (Physics) | Form 2 Science | C | ✓ | ✓ | ✓ | ✓ | ✓ | Ready · 5/5 | 4 days ago |
| G. Mensah (Elective Maths) | Form 3 Science | A | ✓ | ✓ | ✓ | ✓ | ✓ | Ready · 5/5 | 3 days ago |

Note: **`Behind · 2/5` (Asare) counts ✓✓ = 2** and treats the `¾` partial ES as not-yet-done for the count — so `n/5` counts only `done` categories, partials don't increment. Confirm this rule (a partial category is "started, not complete" → excluded from `n`).

---

# SECTION 2 — At-risk flags (spec §6.3)

Source: surface §2 (route `…/risks`). Same VHM sidebar/scope as §1. Demo: **3 flags raised · sorted by severity · STPSHS window opens in 17 days.**

## 2.1 `.page-head`

- Crumb: `Senior · Vice Headmaster · Academic progress · At-risk flags`.
- h1: `Risks <em class="text-gold italic">this week.</em>`
- Lede: `3 flags raised by the engine · sorted by severity · STPSHS window opens in 17 days`.
- Actions: `Configure rules` (`.btn.ghost` → opens the `ref_anomaly_rule` editor) · **`Message all flagged teachers →`** (`.btn.primary`) — the bulk-comms action (spec §2 note: one templated message per flagged teacher with their specific gap referenced).

## 2.2 The risk stack (`.risk-stack`) — three severity tiers

Vertical stack of `.risk-card`s. Each card: grid `auto 1fr auto`, `rounded-[11px] border px-[18px] py-[14px]`. Icon (`.rc-icon`, 34px rounded, `font-display italic`, glyph `!`). Body (`.rc-text`, `12px text-navy-2`, `<b>` in `text-navy`) + a meta line (`.rc-meta`, `9.5px uppercase tracking-[0.04em] text-navy-3 font-bold`) that **names the rule that fired**. Right: action button (`.rc-action`).

| Severity | Card class | bg / border | Icon bg | Action button |
|---|---|---|---|---|
| **High** | `.risk-card.high` | `bg-terra-bg border-terra` | `bg-terra text-bg` | `.rc-action` on high = `bg-navy text-bg border-navy` (filled) |
| **Medium** | `.risk-card.med` | `bg-gold-bg border-gold` | `bg-gold text-navy` | `bg-surface border-border-2` (outline) |
| **Low** | `.risk-card.low` | `bg-bg border-border-2` | `bg-navy-3 text-bg` | (no demo low card; outline) |

## 2.3 The three flags — exact copy, mapped to the three spec §6.3 rules

**Flag 1 (high) — the inactivity rule (spec §6.3 bullet 2, "14+ days"):**
- Title `<b>`: `Mr. B. Akoto has not touched the ledger in 19 days.`
- Body: `Two Form 3 Arts Government classes — 82 students between them — have zero categories entered for Semester 2. STPSHS window opens in 17 days. Mid-sem and end-of-sem exam dates have already passed; scores exist on paper somewhere but not in Omnischools.`
- Meta: `Rule: teacher inactivity 14+ days during semester · severity high`
- Action: `Message Mr. Akoto →`

**Flag 2 (high) — the STPSHS-window rule (spec §6.3 bullet 1, "window opens in <7 days, teachers not complete"):**
- Title: `STPSHS window opens in 17 days · 9 of 23 class-subject combinations not yet ready.`
- Body: `If trajectory holds, 4 of those will not be complete by 14 July. The teachers behind are: J. Asare (1 class), M. Boateng (1), A. Nkrumah (1), K. Owusu (2), and B. Akoto (2 — flagged separately above).`
- Meta: `Rule: STPSHS window < 7 days with incomplete entries · severity high`
- Action: `See behind list →` (deep-links back to §1's table filtered to `status=behind|at-risk`)

> **DRIFT §D6 — the window-rule threshold is inconsistent within the surface.** The rule meta says "STPSHS window **< 7 days**" (matching spec §6.3), but the flag fires at **17 days** out and the lede says "opens in 17 days." Either the demo fires the rule early for illustration, or the rule's real threshold is wider than 7 days (a trajectory projection: "won't be complete *by* the window even though the window is >7 days away"). The body's "If trajectory holds, 4 … will not be complete by 14 July" implies the latter — a **projection**, not a simple countdown. Implementer: the rule is likely two-part (`days_to_window < 7` OR `projected_incomplete_at_window`), and the `ref_anomaly_rule.threshold_jsonb` should encode both. Confirm with the spec author.

**Flag 3 (medium) — the entry-rate rule (spec §6.3 bullet 3, "Path C anomalous rate"):**
- Title: `Mrs. E. Coleman entered 38 scores in 4 minutes on Path C.`
- Body: `Possible data-quality concern — that pace is significantly faster than the class median (38 students entered in ~22 minutes). Could be a teacher with all marks ready in front of them typing fast; could also be guessing. Worth a brief conversation before STPSHS submission.`
- Meta: `Rule: entry rate > 3σ from median · severity medium`
- Action: `Review with Mrs. Coleman →` (note: **"Review with", not "Confront"** — the action framing is a conversation prompt, spec §2/§6.3 posture)

> Note the entry-rate flag names **Mrs. E. Coleman**, a teacher NOT in §1's eight visible rows (she's among the "14 more"). The flags read the full 23-combination set, not just the visible page.

## 2.4 The "no more flags" footer (`.risk-stack` sibling)

Below the stack, a reassurance panel (`bg-bg border border-border rounded-[11px] px-[18px] py-[14px] 11px text-navy-3`, flex):
- Lead (`font-display italic 13px text-navy`): `No more flags.`
- Body: `The engine evaluated 23 class-subject combinations against five active rules. Three triggered. The remainder are tracking on schedule. Rules are configurable — the Headmaster or Vice Headmaster Academic can add a school-specific rule (e.g. "no class incomplete by week 9") and the engine picks it up the next night.`

**Note "five active rules" but only three §6.3 rules are specced.** The surface notes (§2 notes list) name the five: (1) teacher inactivity, (2) STPSHS window approach, (3) entry-rate outlier, (4) **score-down between uploads** (from the Item-2/ledger diff logic, spec §7.2 — a cell populated-then-blanked or changed), (5) **portfolio-only-pending** (all four computable done, portfolio the sole gap). **DRIFT §D7:** spec §6.3 lists three rules; the surface's engine runs five. Rules 4 and 5 come from spec §7 (diff) and the portfolio-manual discipline. Model all five in `ref_anomaly_rule` (`applies_to = 'SCORE_LEDGER'`), each with `severity` + `threshold_jsonb` + `enabled`. "The engine picks it up the next night" implies a **nightly batch evaluator**, not live (contrast the roll-up's "live" refresh in §3.5 — see drift §D8).

## 2.5 Rule engine → schema (already present)

`ref_anomaly_rule` (`omnischools/db/schema/anomaly.ts`) exists and is explicitly "consumed by the Vice-Headmaster Academic progress view." Columns: `rule_code`, `severity` (enum), `description`, `applies_to`, `threshold_jsonb`, `enabled`. The five rules seed as rows here. The **flag instances** (which teacher tripped which rule, when, the computed detail) need a **flag-instances table that does not yet exist** — `ref_anomaly_rule` is the catalogue, not the log. **DRIFT §D9 (data-model gap):** there is no `anomaly_flag` / `ledger_risk_flag` table to hold a fired flag's `(rule_id, teacher_user_id, class_id, subject_id, period_id, detail_json, raised_at, resolved_at)`. The implementer must add one, or compute flags on-the-fly from the ledger state each render (cheaper for v1, but then "Configure rules … picks it up the next night" and resolved-state tracking don't fit). Recommend a lightweight `senior_ledger_flag` instance table.

---

# SECTION 3 — Headmaster roll-up (spec §6.4)

Source: surface §3 (route `…/headmaster-summary`). **This is a SEPARATE surface for a SEPARATE role** — not embedded in the VHM view. Demo: **Mr. V. Yanney (Headmaster) · Semester 2 of 2025/26.**

## 3.1 App shell — the Headmaster's different sidebar

Same `bg-navy` Senior shell, but **different scope-chip and nav** (the surface makes the role switch explicit):
- **Scope chip:** `Role` / `Mr. V. Yanney` / `Headmaster`.
- **Nav (verbatim, differs from VHM):** group `School overview` → **Headmaster summary (active)** · Enrolment · WASSCE readiness. group `Academic` → Ledger progress (full) · Teachers · STPSHS submissions. group `School operations` → Boarding · Finance · Parents & PTA.
- Footer: `VY` / `V. Yanney` / `Headmaster`.

The nav difference encodes the hierarchy: the Headmaster's landing is `Headmaster summary`; `Ledger progress (full)` is a drill-down into the VHM's §1 view (spec §6.4: "a Headmaster who wants to see Mr. Akoto's row clicks 'Open full progress view' and lands in the Vice Headmaster's view").

## 3.2 `.page-head`

- Crumb: `Senior · Headmaster · Semester-end summary`.
- h1: `Where the school <em class="text-gold italic">stands.</em>`
- Lede: `Semester 2 of 2025/26 · 23 class-subject combinations · STPSHS window opens 14 July 2026`.
- Actions: `Open full progress view` (`.btn.ghost` → deep-links to §1) · **`Brief the board →`** (`.btn.primary` — exports the three figures + action note for a Board of Governors briefing).

## 3.3 The roll-up grid (`.rollup-grid`) — spec §6.4 subject-level "all / partial / behind complete"

Section label above the grid (`11px uppercase tracking-[0.08em] font-bold text-navy-3`): `Subject-level readiness · cascaded from per-teacher progress`.

Three `.rollup-card`s (`grid-cols-3 gap-3.5`, each `bg-surface border rounded-[11px] px-5 py-[18px]`). Structure: label (`.rc-label`, `10px uppercase text-navy-3`) → big number (`.rc-num`, `font-display 36px 600`, gold italic `<em>`) → suffix (`.rc-suffix`, `12px text-navy-3`) → subject list (`.subject-list`, `10.5px text-navy-2`, `border-top`, `<b>` accents).

| Card | Border | `<em>` colour | Label | Number | Suffix | Subject list (verbatim) |
|---|---|---|---|---|---|---|
| **Complete** | `.complete` → `border-green` | `text-green` | `Subjects fully ready` | `3` | `of 9 subjects · all teachers complete` | `<b>Physics</b> · Elective Maths · Geography` |
| **Partial** | `.partial` → `border-gold` | (default gold) | `Subjects partially ready` | `5` | `of 9 subjects · 1 or more teachers behind` | `<b>Mathematics</b> (4 of 6 teachers complete) · <b>English</b> (3 of 5) · <b>Chemistry</b> (1 of 2) · <b>Biology</b> (2 of 3) · <b>Integrated Science</b> (3 of 4)` |
| **At risk** | `.behind` → `border-terra` | `text-terra` | `Subjects at risk` | `1` | `of 9 subjects · zero teachers ready` | `<b>Government</b> (Form 3 Arts) — Mr. B. Akoto's two classes flagged; 19 days inactive` |

**This is the §6.4 "subjects with all teachers complete / partial / behind" aggregation** — the same per-teacher data (§1) grouped by subject. The subject-list line with per-subject teacher counts (`4 of 6 teachers complete`) is the deliberate design choice (surface note §3): "9 ready / 8 behind / 1 at risk" would be the right total but wrong framing — the Headmaster needs to know *which* subjects, because Government-at-risk (1 teacher) is a different problem from Mathematics-at-risk (6 teachers).

**Aggregation rule:** a subject is `complete` if all its teachers are `Ready`; `at risk` if zero are `Ready`; `partial` otherwise. Grain: subject × (all classes/teachers teaching it). Counts (`3 + 5 + 1 = 9 subjects`) are subject-level, distinct from §1's 23 class-subject combinations.

## 3.4 The action-item card (gold callout) — the surfaced escalation

Below the roll-up, a gold-bordered callout (`bg-[linear-gradient(135deg,gold-bg,surface_70%)] border-[1.5px] border-gold rounded-xl`, grid `auto 1fr auto`):
- Icon: gold rounded square `!` (`bg-gold text-navy font-display italic`).
- Text (`12px text-navy-2`): `The Vice Headmaster Academic has flagged Mr. B. Akoto's classes as the most urgent action item — 19 days inactive, no scores entered, two classes affected. Mrs. P. Anim has been in touch; Mr. Akoto cited illness, returning next week. Mrs. Anim is preparing to support score entry on Mr. Akoto's return. <b>You may want to confirm the support plan with her before the STPSHS window opens.</b>`
- Action: `Message Mrs. Anim` (`.btn.primary` small).

**Design discipline (surface note §3, must preserve):** the action button is **"Message Mrs. Anim" (the line manager), NOT "Message Mr. Akoto"** — escalating past the line manager is the wrong move and the system reflects the hierarchy. The Headmaster's escalation routes through the VHM.

## 3.5 Provenance footer (`.provenance`)

Three items (`10.5px text-navy-3`, `<b>` in `text-navy-2`): `Source data · per-teacher ledger progress, same as Vice Headmaster view` · `Aggregation · grouped by subject across all classes` · `Refresh · live as teachers enter`.

> **DRIFT §D8 — "live" here vs "next night" in §2.** The roll-up claims `Refresh · live as teachers enter`, while §2's flag engine "picks it up the next night." Reconcile: the **completion states** (§1 table, §3 roll-up) are live-derived from `senior_score_ledger` on each request (cheap aggregate query, matches the shipped `page.tsx` server-fetch model). The **anomaly flags** (§2) run as a nightly batch (rate-outlier and trajectory projection are expensive / need historical entry-timing). So both statements are true of different data. The implementer should make §1/§3 request-time server aggregates and §2 a batched evaluator writing flag instances.

---

## Interaction-state inventory (every state, per region)

| Region | State | Visual |
|---|---|---|
| Table row (`.vha-table tr`) | default / hover | `bg-surface` / `bg-gold-bg` |
| Path pill | A / B / C | `bg-green-bg text-green` / `bg-gold-bg text-gold` / `bg-terra-bg text-terra` |
| Category dot | done / partial / pending / late | `bg-green text-bg ✓` / `bg-gold text-navy ¾` / `bg-border-2 text-navy-3 —` / `bg-terra text-bg` (unused in demo) |
| STPSHS cell | ready / behind / at-risk | `bg-green-bg text-green` / `bg-gold-bg text-gold` / `bg-terra-bg text-terra` |
| Last activity | normal / stale | `text-navy-3` / `text-terra font-bold` (>14 days) |
| Risk card | high / med / low | `bg-terra-bg border-terra` / `bg-gold-bg border-gold` / `bg-bg border-border-2` |
| Risk-card action | high / med-low | `bg-navy text-bg` (filled) / `bg-surface border-border-2` (outline) |
| Roll-up card | complete / partial / at-risk | `border-green` + green `<em>` / `border-gold` / `border-terra` + terra `<em>` |
| `.btn` | ghost / primary | `bg-transparent border-border-2 text-navy-3` / `bg-navy text-bg` |
| Filter (spec §6.1) | via query param | `GradebookSelectors` `<select>` idiom, `focus:border-gold` |
| Empty state (no ledger activity) | — | see below |

## The empty state (no ledger activity yet — brief requirement)

The surface shows **no explicit empty state** (the demo is mid-semester with data). The implementer must build one, reusing the shipped dashed-card idiom (`score-ledger/page.tsx` lines 76–80, and `components/ui/empty-state.tsx` `tone="muted"`):
- **No teachers/combinations configured** (semester just opened, no class-subjects set up): `rounded-xl border border-dashed border-border-2 bg-surface p-12 text-center text-sm text-navy-3` → e.g. *"No class-subject combinations for this semester yet. Set up teaching assignments in Classes & subjects."* — **and this copy exposes the data-model gap in §D10 below** (there must be a "teaching assignment" source to enumerate rows).
- **All combinations at 0/5, no activity** (semester open, no teacher has touched a ledger): show the full table with every row `At risk · 0/5` / `— never` last-activity, plus a lede note. Do **not** show the dashed empty card here — zero-progress is data, not absence.
- **§2 flags, none raised:** the "No more flags." panel (§2.4) *is* the empty-of-flags state — reuse it verbatim.
- **§3 roll-up, no subjects ready:** all three cards render with `0` — again, data not absence.

---

## Component mapping summary (surface region → build target)

| Surface region | Existing idiom to reuse | New work for Item 3 |
|---|---|---|
| `.page-head` hero (all 3 screens) | `score-ledger/page.tsx` hero block | copy structure; swap crumb/h1/lede/actions per screen |
| App-shell sidebar | Item-1 Senior `bg-navy` sidebar | swap scope-chip to `Role`; VHM vs Headmaster nav lists |
| Discipline banner (§1.3) | — (new) | navy-gradient card; **non-negotiable, encodes §6.2** |
| `.vha-table` (§1.4) | `senior-ledger-grid.tsx` table mechanics (overflow-x, thead/tbody classes, hover) | **sticky-top** thead (not sticky-left); 8 columns; NO score values |
| Path pill (§1.5) | — (Item-1 map §6 pinned colours) | 3-variant `font-mono` pill |
| Category dot (§1.6) | — (new) | 4-state dot (done/partial/pending/late); value = completion fraction, never a score |
| STPSHS cell (§1.7) | — (Item-1 §3.7 tiers) | 3-tier `Tier · n/5` pill |
| Filters (§1.10) | `components/gradebook/selectors.tsx` | 5-dimension query-param filter row |
| Default sort (§1.9) | — | tier→n→staleness sort; overflow/paginate footer |
| Risk stack (§2.2–2.3) | — (new) | 3-severity card; rule-meta line; conversation-framed actions |
| Rule engine (§2.5) | `ref_anomaly_rule` (schema exists) | seed 5 rule rows; **add flag-instance table (§D9)** |
| Roll-up cards (§3.3) | — (new) | 3 subject-level aggregate cards; subject-list with teacher counts |
| Action-item callout (§3.4) | — (new) | gold callout; action routes to line-manager, not teacher |
| Empty states | `components/ui/empty-state.tsx` + dashed card | per §"empty state" above |
| Data fetch (all) | `withSchool`/`requireSchool` + `academic_period.period_label` (from `page.tsx`) | server aggregates over `senior_score_ledger`; **teacher attribution unresolved (§D10)** |

---

## Open questions / drift log

**The central data-model question (brief-flagged): how does the surface know which teacher owns each class × subject?**

- **§D10 — There is NO subject-teacher assignment table.** This is the load-bearing gap. The surface's atomic row is `(teacher × class × subject)`, and every aggregate (§1 rows, §2 flags, §3 subject roll-up) depends on knowing *which teacher owns each class-subject*. **The schema has no such table.** The only teacher↔(class×subject) links that exist are:
  1. `timetable_slot.teacherUserId` (`timetable.ts`) — but this is `onDelete: set null`, **per weekday-slot** (a teacher appears in many slots for one class-subject), `subjectId` is nullable, and it models *scheduling*, not *authoritative assignment*. Deriving "B. Akoto owns Form 3 Arts A Government" from timetable slots is possible but fragile (a class-subject with no timetable rows would vanish from the VHM view entirely).
  2. `senior_assessment.createdByUserId` (`score-ledger.ts`) — who created an assessment event. But **Path B and Path C teachers may never create `senior_assessment` rows** (Path B scans, Path C types straight into the ledger), so this attributes nothing for them — and `senior_score_ledger` itself has **no `teacher_user_id` column at all** (grain is `student × subject × period`, teacher-free).
  - **Consequence:** the VHM view cannot be built on current schema without either (a) a new **`class_subject_teacher`** assignment table — grain `(school, class_id, subject_id, teacher_user_id, period_id?)`, composite tenant FKs per the memory `composite-tenant-fks` convention — which becomes the enumeration source for the rows and the join target for `last_activity`; or (b) treating `timetable_slot` (distinct teacher×class×subject tuples) as the assignment source, accepting its fragility. **Recommend (a): a dedicated `class_subject_teacher` table.** The Item-1 onboarding-cascade memory (`onboarding-inputs-cascade`) applies — teaching assignments should be created when the admin sets up classes/subjects, not re-entered. **Confirm with the spec author before building §1.**

- **§D11 — "Expected / not-started" contexts (brief-flagged).** Related to §D10: a class-subject where the teacher has done *nothing* still must appear as a row (`At risk · 0/5`, `— never` activity) — the B. Akoto rows are exactly this. That means the row set is driven by **assignments (what's expected)**, not by **ledger rows that exist (what's started)**. A pure `senior_score_ledger` scan would **omit** a teacher who never touched anything (no ledger rows → no row → the most at-risk teacher is invisible). So the enumeration MUST come from the expected set (the `class_subject_teacher` table of §D10), left-joined to `senior_score_ledger`/`senior_assessment` for progress. This is the single most important correctness point for the implementer: **enumerate from expected assignments, LEFT JOIN progress — never enumerate from progress.** `last_activity` for a never-started row is `—`/`never`, not absent.

**Other drifts (collected from inline notes above):**

- **§D1 — Category columns are dots, not "count/bar + date".** Spec §6.1 specifies Assignments as "count entered / expected, progress bar" and MS/ES/Proj/Port as "entered (date) / not entered." The surface renders all five as a single `cat-dot` (✓/¾/⅔/—) with **no count, no bar, no date**. Surface wins on presentation (the dot is cleaner and the `¾`/`⅔` partial glyph carries the count-ish signal for assignments/project). **But the "entered (date)" data is lost** — the VHM can't see *when* mid-sem was entered from this table. Decide: keep the surface's dot-only rendering (recommended, matches the completion-not-detail posture) and expose dates on row-expand/hover, or add a date tooltip. Confirm.
- **§D2 — `.cat-dot.late` (terra) is defined but unused, and has no legend.** Trigger unspecified. Likely "single-event category (MS/ES/Proj) whose assessment date has passed with no entry" — this is where §6.1's date data becomes a *state*. Implementer must define the trigger; add a legend entry if used.
- **§D3 — Table thead is sticky-top, not sticky-left.** Unlike `senior-ledger-grid.tsx` (sticky-left student column), `.vha-table` declares `thead th { position: sticky; top: 0 }` only. On narrow screens the Teacher column will scroll away under horizontal overflow. Consider adding sticky-left to the Teacher column for parity with the ledger grid (minor enhancement, not in surface).
- **§D4 — `behind` status colour drifts from Item-1.** This surface: `stpshs-cell.behind = gold-bg/gold`. Item-1 class-tab: `behind = warn-bg/warn`. Pick one; recommend following this surface for the VHM view. Same three-tier semantic either way.
- **§D5 — Filter bar is a button only.** Surface renders `Filter` unexpanded; build the 5-dimension filter (teacher/subject/form/programme/status) from the `selectors.tsx` query-param idiom.
- **§D6 — STPSHS-window rule threshold is inconsistent (7 days vs firing at 17).** The rule meta says "< 7 days" but fires at 17 days with a *trajectory projection* ("won't be complete by 14 July"). The real rule is likely two-part: `days_to_window < 7` OR `projected_incomplete_at_window`. Encode both in `threshold_jsonb`. Confirm with spec author.
- **§D7 — Five rules run, spec §6.3 lists three.** Surface engine adds (4) score-changed-between-uploads (from spec §7 diff) and (5) portfolio-only-pending. Model all five as `ref_anomaly_rule` rows; spec §6.3 is a subset.
- **§D8 — "Live" (§3 roll-up) vs "next night" (§2 flags).** Completion states are request-time server aggregates; anomaly flags are a nightly batch. Both statements true of different data — split accordingly.
- **§D9 — No flag-instance table.** `ref_anomaly_rule` is the catalogue; there's no table for a *fired* flag (`rule_id, teacher, class, subject, period, detail, raised_at, resolved_at`). Add `senior_ledger_flag` (or compute on-the-fly for v1, accepting no resolved-state tracking). The `Configure rules` and "picks it up the next night" copy implies a persisted, batch-populated instance store.
- **§D12 — Roll-up subject count (9) vs combination count (23).** §3 counts 9 subjects; §1 counts 23 class-subject combinations; §2 counts 23. The roll-up aggregates combinations→subjects (many classes per subject). Keep both grains straight: §1/§2 are per-combination, §3 is per-subject.
- **§D13 — `Message …` / `Export PDF` / `Brief the board` / `Configure rules` actions are downstream.** All buttons must render; their targets (bulk comms compose, PDF export, board-brief export, rule editor) are later work. For Item 3, wire the navigation/deep-links (`See behind list →` → §1 filtered; `Open full progress view` → §1; `Message Mrs. Anim` → comms) and stub the export/compose actions. Confirm scope.
- **§D14 — Role/permission gating.** §1/§2 are Vice-Headmaster-Academic-scoped; §3 is Headmaster-scoped. The `ref_user`/role model (`TEACHER` role seen in seed; VHM/Headmaster roles) must gate route access and — critically for §6.2 — **deny the score values** to these roles (only the audit-logged gradebook link reveals them). Confirm the role codes for `VICE_HEADMASTER_ACADEMIC` / `HEADMASTER` exist or need seeding.

---

*Map produced against: `schoolup-shs-vice-headmaster-progress.html` (§1/§2/§3); `SHS_SCORE_LEDGER_SPEC.md` §6 (§6.1–§6.4) + §7 (diff rules) + §2/§4.1 (portfolio-manual, path model); `omnischools/docs/senior/ledger-surface-map.md` §0/§3.7/§6 (token table + VHM vocabulary); shipped `app/(app)/senior/score-ledger/page.tsx`, `components/senior/senior-ledger-grid.tsx`, `components/gradebook/selectors.tsx`; schema `db/schema/score-ledger.ts`, `anomaly.ts`, `timetable.ts`, `staff.ts`; `design-tokens.json` v1.0.0.*
