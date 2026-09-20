# SHS Score Ledger — Surface Map (Increment 1: F0 + Score Ledger Item 1)

**Author:** Lucy (design cartographer) · **Status:** design spec, ready for the implementation engineer.
**Scope of this map:** F0 (Senior foundations — SHS roster: programme chips, House column + House dots, residency) **+** Score Ledger **Item 1** (the five-category model and **Path A auto-compile web UI**).

This is an exhaustive 1:1 map of the source surfaces onto the existing Next.js Basic-tier idioms. Where a surface and the spec disagree, the rule is **spec wins on logic, surface wins on visual presentation** — every such drift is called out inline and collected in the **Open questions / drift log** at the end.

## Source surfaces (visual source of truth — replicate 1:1)

| Surface file | Role in this map |
|---|---|
| `Surfaces/schoolup-shs-score-ledger.html` | **PRIMARY** — desktop Path A five-category ledger grid (§1), Path B scan/diff (§2, out of Item-1 scope but colour vocabulary reused), STPSHS export (§3, out of scope). |
| `Surfaces/schoolup-shs-score-ledger-pwa.html` | Card/grid two-view toggle, class-chevron + bottom-sheet switcher, sync strip. Grid view informs the desktop Item-1 grid. **PWA itself is Item 5, not this increment** — mapped here for the grid + switcher design only. |
| `Surfaces/schoolup-shs-vice-headmaster-progress.html` | **Context only (Item 3).** Read for the ledger-completion-state vocabulary (Ready / Behind / At risk; ✓ / ¾ / — category dots) that the Item-1 grid's completion summary must be consistent with. |
| `Surfaces/schoolup-shs-class-roster.html` + `Surfaces/schoolup-class-roster-shs-variant.html` | **F0 roster** — programme chips, House column + House dots, residency boarder/day. (The two files are byte-identical; treat as one.) |

## Canonical inputs

- **Tokens:** `md files/design-tokens.json` (v1.0.0) and the live `omnischools/styles/tokens.css`. The runtime uses **Tailwind token classes** (`text-gold`, `bg-navy`, `border-border-2`, `font-display`, `max-w-page`), **never inline `var(--x)` in JSX**. The surfaces are hand-written HTML with `var(--x)`; the implementer translates each to the Tailwind class of the same token.
- **Spec:** `md files/SHS_SCORE_LEDGER_SPEC.md` — §2 (five categories + weights), §4.1 (Path A), §5.2 (card vs grid), §5.3 (class chevron), §11 (build sequence; Item 1 = five-category model + Path A).
- **Build board:** `omnischools/docs/senior-build-plan.md` (INCR-1 = F0 + Ledger Item 1; this surface map is the "Lucy" step) and `omnischools/docs/senior-tier-backlog.md` (records the deferred SHS roster + ledger features this increment now picks up).

---

## 0. Token & type reference (applies to every region below)

The surfaces declare these `:root` vars; `tokens.css` exposes each as a Tailwind class. Use the class, not the raw hex.

| Surface `var(--x)` | Hex | Tailwind class | Used for |
|---|---|---|---|
| `--navy` | `#1A2B47` | `text-navy` / `bg-navy` / `border-navy` | primary text, CTAs, total column, boarder pill |
| `--navy-2` | `#2D3F5C` | `text-navy-2` / `bg-navy-2` | secondary text, hover, mid/end header labels |
| `--navy-3` | `#5C6675` | `text-navy-3` | muted meta, captions, empty-cell dashes |
| `--navy-deep` | `#13203A` | `bg-navy-deep` | Save-button hover, total-cell row hover |
| `--gold` | `#C8975B` | `text-gold` / `bg-gold` / `border-gold` | accent, italics, active states, path-active |
| `--gold-soft` | `#E8D4B8` | `border-gold-soft` / `bg-gold-soft` | gold borders, subtle accents |
| `--gold-bg` | `#F5EBDC` | `bg-gold-bg` | manual/portfolio cells, row hover, active tab tint |
| `--bg` | `#FAF7F2` | `bg-bg` | page background, table-head background, input background |
| `--surface` | `#FFFFFF` | `bg-surface` | cards, panels, score cells |
| `--green` | `#2F6B47` | `text-green` / `bg-green` | computed (auto-compiled) cells, "done" status |
| `--green-bg` | `#E5EFE8` | `bg-green-bg` | computed-cell tint, ready/synced strip |
| `--terra` | `#B84A39` | `text-terra` / `bg-terra` | portfolio header accent, destructive, "gone missing" diff |
| `--terra-bg` | `#F5E1DC` | `bg-terra-bg` | terra-tinted surfaces |
| `--warn` | `#C58A2E` | `text-warn` / `bg-warn` | low-confidence "?" cells (scan path), "behind" status |
| `--warn-bg` | `#F5E9D0` | `bg-warn-bg` | warn-tinted surfaces |
| `--border` (`--border-1` in css) | `#E5DFD3` | `border-border` | default borders, row dividers |
| `--border-2` | `#D4CCBA` | `border-border-2` | stronger borders (buttons, inputs), empty dash colour |

**Type families:** `font-display` = Fraunces (serif, headings, stat numbers, italic accents); `font-body`/default = Manrope (all body, labels, student names); `font-mono` = JetBrains Mono (all scores, weights, REF IDs, totals). **Every numeric score cell, weight, REF-ID, and weighted total is `font-mono`.** Headings use `font-display` with an italic gold `<em>` accent (e.g. `Form 2 Science · <em class="text-gold not-italic-serif italic">Mathematics.</em>`).

**Convention (from `design-tokens.json._conventions`):** empty/missing score = **em-dash `—`** in `text-navy-3` / `text-border-2`, never `0`, `N/A`, or `null`.

---

## 1. Existing Basic gradebook idioms to reuse (do NOT reinvent)

The SHS ledger is the **five-category evolution of the Basic gradebook**, which already lives at `omnischools/app/(app)/gradebook/`. Match its patterns exactly. Verified first-hand from source:

**Route + files**
- `omnischools/app/(app)/gradebook/page.tsx` — **server component**, `export const dynamic = "force-dynamic"`. Fetches inside `withSchool(school.id, tx => …)` (tenant-scoped RLS wrapper from `@/lib/db/rls`), auth via `requireSchool()` from `@/lib/auth/server`. Reads query params `?classId&subjectId&periodId`.
- `omnischools/components/gradebook/selectors.tsx` — `GradebookSelectors` (client) — three linked `<select>`s (class · subject · period) that push to the route via `URLSearchParams`. **This is the desktop precedent for the SHS class switcher + period.** Props: `classes/subjects/periods: {id,label}[]`, current ids, `basePath`, `showSubject`.
- `omnischools/components/gradebook/column-score-grid.tsx` — `ColumnScoreGrid` (client) — the score grid. **This is the component the SHS ledger grid extends.**
- `omnischools/components/gradebook/new-subject-form.tsx`, `add-column-form.tsx`, `empty-columns.tsx` (`GradebookEmptyColumns`) — supporting forms/empty state.
- `omnischools/lib/actions/gradebook.ts` — server actions `saveColumnScores`, `deleteGradebookColumn`, `createGradebookColumn`, `createSubject`, `generateReportCards` (client calls these; server rollup is source of truth; mutations call `safeRevalidate("/gradebook")` then client `router.refresh()`).
- `omnischools/components/ui/empty-state.tsx` — shared `EmptyState` primitive, props `tone="muted"|"default"|"navy"`, `icon/eyebrow/title/body/primary/secondary`. **Reuse for the SHS "no selection" and "no students" states** (muted tone = the dashed card). `components/ui/` also has `modal`, `fields` (Select/Combobox/DateInput), `back-link`, `confirm-dialog`, `selection` — use these for any SHS dialogs/selects.

**Hero header idiom (reuse verbatim structure — `page.tsx` lines 191–216):**
```
<div className="mx-auto max-w-page">
  <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold">Omnischools · Gradebook</div>
      <h1 className="mt-1 font-display text-3xl font-semibold text-navy">Every score, <em className="text-gold">weighted right</em></h1>
      <div className="mb-3 mt-2 h-0.5 w-16 bg-gold" />   {/* the gold rule */}
      <p className="max-w-2xl text-sm text-navy-3">…lede…</p>
    </div>
    <div className="flex items-center gap-3">…actions…</div>
  </div>
```
The surface `.page-head` (eyebrow → `<h1>` with italic gold `<em>` → gold rule → lede → right-aligned action buttons) maps **1:1** onto this. Keep it.

**Grid idiom (`ColumnScoreGrid` — reuse these exact mechanics):**
- Wrapper: `<div className="bg-surface overflow-x-auto rounded-xl border border-border">` → `<table className="w-full text-sm">`.
- **Sticky-left student column** (this is the surface's "sticky-left names"): header `<th className="bg-bg sticky left-0 z-10 …">`, body `<td className="bg-surface sticky left-0 z-10 …">`. Reuse for the SHS grid unchanged.
- Head row: `<thead className="bg-bg border-b border-border text-left text-xs uppercase tracking-wide text-navy-3">`.
- Rows: `<tbody className="divide-y divide-border">`.
- Score input class (constant `inputCls`): `w-16 rounded-md border border-border-2 bg-bg px-2 py-1.5 text-sm font-mono text-navy outline-none focus:border-gold`.
- **Live client rollup** (`rollup(studentId)`): computes CA%/Exam%/Total live as cells change; **"server rollup on save is the source of truth; this just mirrors it live."** The SHS weighted-total column follows this exact pattern (five categories instead of CA/Exam).
- Save: dirty-`Set` of `columnId:studentId` keys → `saveColumnScores()` server action → `router.refresh()`. Buttons: primary `text-bg rounded-md bg-navy px-5 py-2 … hover:bg-navy-deep disabled:opacity-60`; secondary `border-border-2 bg-surface … hover:bg-gold-bg`.
- Category pill in header: EXAM `rounded-full bg-navy px-1.5 py-0.5 text-[9px] font-semibold text-bg`; CA `bg-gold-bg text-gold`. The SHS grid recolours these per-category (see §3.2).

**Component library reality:** `omnischools/components/ui/` is **NOT a stock shadcn install** — it contains only `back-link`, `confirm-dialog`, `empty-state`, `fields`, `modal`, `selection`. There is **no shadcn `table`/`tabs`/`badge`/`button`/`card`**. So every "shadcn/component" mapping below resolves to **hand-rolled Tailwind markup matching the gradebook**, not an import. Do not add shadcn; follow the existing hand-rolled convention.

**Data pattern (matches memory `reports-data-is-server-only`):** the server component fetches and **pre-shapes** rows (`{id, name: "Last, First", code}`); the client grid receives **pre-formatted primitives only** and never imports the DB driver.

---

## 2. F0 — SHS class roster (programme chips · House column + House dots · residency)

Source: `schoolup-shs-class-roster.html` / `schoolup-class-roster-shs-variant.html` (identical). This is the **F0 structural surface** — it makes the dual assignment (academic class × pastoral House) visible and adds programme + residency. Only the roster surface (§ its section 1) is in Item-1 scope; its section 2 is an editorial explainer, not a build target.

Top-to-bottom regions:

### 2.1 Page hero (editorial page-header, above the app frame)
- Eyebrow: `Omnischools · Batch 0 · Structural foundation` — `text-gold text-[11px] uppercase tracking-[0.18em]` (surface `.eyebrow`, `letter-spacing:0.18em`).
- Tags: gold pill `SHS · classes` (`.mvp-tag`: `bg-gold text-navy text-[10px] uppercase tracking-[0.12em] font-bold rounded-full px-2.5 py-[3px]`) + outline pill `Two-dimensional sort · class × House` (`.related-tag`: `bg-surface border-border text-navy-3`).
- `<h1 class="font-display">` `Form 2 General Arts A · 32 students` with `<em class="text-gold italic">` on the class name; `font-size:56px weight:500 tracking:-0.02em`.
- Gold rule (`w-16 h-0.5 bg-gold`), then lede paragraph `text-navy-3 text-base max-w-[740px]`.
- **Note:** this outer editorial header is a design-doc chrome. In-app the real header is the `.page-head-c` inside the app frame (§2.3). Build the in-app one.

### 2.2 App shell (sidebar + main)
- **Sidebar** `bg-navy` (regular navy — the Senior operational app; NOT the Oversight deep-navy `#13203A`). Width 220px. Brand block: gold rounded square `logo-mini` with school initials (`CK`), school name (`font-display 13px`) + `SHS · Accra` meta (`text-gold-soft`). Nav items `text-[rgba(250,247,242,0.7)]`; active item `bg-[rgba(200,151,91,0.08)] text-bg border-l-2 border-gold`. Nav list (verbatim copy): **Dashboard · Students · Staff · Classes (active) · Programmes · Houses · Attendance · Billing · Comms · PLC · CPD · Reports · Settings.** Footer avatar `FA` / `Florence A.` / `Admin`. `Powered by <em class="text-gold">Omnischools</em>`.
  - **F0 note:** the `Programmes` and `Houses` nav entries are new in SHS (per `senior-tier-backlog.md` "Programmes / Houses nav"). Include them.
- **Main** `bg-bg`.

### 2.3 `.page-head-c` (in-app header)
- Crumb: `<a>Classes</a> · Form 2 · General Arts · Section A` (`text-navy-3 text-[11px] uppercase tracking-[0.12em]`, `<a>` in `text-gold`).
- `<h1 class="font-display">` `Form 2 General Arts <em class="text-gold">A</em>` (30px, 500).
- Lede: `32 students · 6 House affiliations represented · 19 boarders + 13 day · **Mr Mensah teaches Maths here** Tuesday/Thursday 8 AM · last attendance taken yesterday.` (bold in `text-navy-2`).
- Actions (right): `Print roster` · `Take attendance` (both `.btn` = `border-border-2 bg-surface text-navy`) · `+ Admit student` (`.btn.primary` = `bg-navy text-bg`).

### 2.4 Class identity strip (`.class-id`)
White card, `rounded-xl border border-border`. Left: navy `form-badge` (64px, `bg-navy text-bg rounded-xl`) showing `2` over `FORM`. Then name block: `<h2 class="font-display">Form 2 General Arts A</h2>` with italic gold `A`, and the **programme-chip component row** (`.components`):
- `<span class="chip">Form 2</span>` (`bg-bg border-border text-navy-2`)
- separator `×` (`text-border-2`)
- **`<span class="chip programme">General Arts</span>` — the PROGRAMME CHIP: `bg-gold-bg border-gold-soft text-gold`.**
- `×` · `<span class="chip section">Section A</span>` (`bg-navy border-navy text-bg`)
- `·` · italic `unique combination · **CLS-2024-007**` (the class code; bold `text-navy-2`).
Right (`.quick-acts`): `View timetable` · `House view` buttons (peer lateral-nav affordances).

**Programme values (F0 canonical, from `senior-tier-backlog.md`):** General Arts · Science · Business · Agric (also called General Science / Agricultural Science in full). The programme chip is the gold-tinted variant; render one chip per class's programme.

### 2.5 Meta strip (`.meta-strip`) — 5 equal cells, dividers between
White card, `grid-cols-5`, each cell `border-r border-border`. Cells (label `text-[9px] uppercase tracking-[0.14em] text-navy-3 font-bold`; value `font-display 18px` with gold italic `<em>`):
1. **Enrolment** — `32 students` / sub `of 40 capacity · 80%`.
2. **Gender mix** — `18 / 14` / sub `boys / girls · co-ed`.
3. **Residency** — `19 / 13` / sub `boarders / day · 59% B`. ← **residency summary.**
4. **House mix** — `all 6` / sub `all Houses represented · balanced`. (Soft health-check: fewer than 6 signals the admission balancer.)
5. **Attendance** — `94.2%` / sub `term-to-date · above target`.

### 2.6 Roster tabs (`.roster-tabs`)
Underline-style tab bar (`border-b-[1.5px] border-border`; active tab `text-navy border-b-[2.5px] border-gold`, count badge `bg-gold text-navy` when active else `bg-bg text-navy-3`). Tabs (verbatim): **Roster [32] (active) · Attendance log · Subject teachers [9] · Timetable · Grades · Comms history.** Only the **Roster** tab is in F0 scope; the others are lateral routes.

### 2.7 Roster body grid (`.roster-grid`) — main table + right rail (`1fr 320px`)

**Student table (`.student-table`)** — white card. Head bar (`.table-head-bar`, `bg-bg`): title `Students · <em>roster</em>` (`font-display`), count caption `sorted by surname · House visible`, search box placeholder `Search by name or House…`, `Filter` button.

Row grid (`.stu-row`): `grid-cols-[42px_1.4fr_0.9fr_0.7fr_0.7fr_0.7fr_32px]`, `border-b border-border`. **Header row copy:** `# · Student · House · Gender · Status · Attend · (menu)`.

Per-student cell mapping (this is the exhaustive column spec):
- **Avatar** (`.av`) — 36px circle, `bg-gold-bg text-gold font-display`, student initials.
- **Student** (`.name`) — `<h4 class="font-display">` full name + `id-x` code in `font-mono text-[10px] text-navy-3` (e.g. `CTKS-24-0118`).
- **House** (`.house-cell`) — **House DOT + name.** Dot = `11px` circle, `border border-surface` + `box-shadow 0 0 0 1px var(--border-2)` (a hairline ring so light dots read on white). Name in `text-navy font-medium 12px`. **The dot is a fast-scan marker; the House name is the primary read** (per surface note: dots are deliberately small).
- **Gender** (`.gender-cell`) — `M` / `F`, `text-navy-2 11px`.
- **Status** = **RESIDENCY pill** (`.residency-cell`). ← header says "Status" but the cell renders residency. **`BOARDER` pill = `bg-navy text-bg`; `DAY` pill = `bg-bg text-navy-2 border border-border-2`.** `text-[10px] uppercase font-bold tracking-[0.04em] rounded-full px-2.5 py-[3px]`.
- **Attend** (`.attend-cell`) — `<b class="font-mono text-navy">96%</b>`.
- **Menu** (`.menu-btn`) — `⋯` in `text-navy-3`.

Footer row: `… 22 more students · show all 32` (`show all` in `text-gold font-semibold`).

**Right rail (`.right-rail`, 3 cards):**
1. **House distribution** (`.rail-card`) — eyebrow `House distribution`, title `This class · across 6 Houses`. Six `.house-bar` rows: dot + House name + mono count, and a thin `5px` track (`bg-bg`) with a coloured `bar-fill`. **This is the House-dots colour legend for the whole surface.**
2. **Subject teachers** — `9 teachers · this class`; teacher rows with initials avatar, `font-display` name, subject + schedule meta. (Lateral; not F0-critical.)
3. **Quick actions** — gold-tinted card (`bg-gold-bg border-gold-soft`): → Send SMS to all parents (32 parents) · → Schedule Form PTA meeting · → Generate class report card · → Export roster to CSV · → View grade analytics.

### 2.8 The six Houses — colours & names (F0 canonical for THIS surface)

The surface renders **six** Houses with these exact names + dot colours. **These are RAW HEX in the surface, not tokens** — three are bespoke House colours with no token, three reuse brand tokens:

| House (surface) | Dot class | Colour | Token? |
|---|---|---|---|
| Pink 1 | `.dot.pink` | `#D87794` | **no token — bespoke House hex** |
| Pink 2 | `.dot.pink` | `#D87794` | (shares Pink 1's hex) |
| Gibson | `.dot.gold-c` | `#C8975B` (`--gold`) | yes (`bg-gold`) |
| Aryee | `.dot.blue` | `#5A7A9F` | **no token — bespoke House hex** |
| Knight | `.dot.navy-c` | `#1A2B47` (`--navy`) | yes (`bg-navy`) |
| Quaque | `.dot.green` | `#5A8F6E` | **no token — bespoke House hex** (near but ≠ `--green #2F6B47`) |

A sixth dot class `.dot.terra-c` (`--terra`) is defined in CSS but unused by these six rows.

> **DRIFT — House names.** The build brief names the six Houses **Aggrey, Guggisberg, Fraser, Slessor, Kingsley, Aryee**. The surface names them **Pink 1, Pink 2, Gibson, Aryee, Knight, Quaque**. Only **Aryee** overlaps. **House names and their colour mapping are per-school configuration data, not hard-coded** — the surface is Christ the King SHS's demo set; the brief's set is a different school's. Build the House model as configurable (name + colour per House per school, exactly the `houses` table F0 introduces); seed whichever set the demo school uses. **Do not hard-code either list.** Flagged in the drift log.

> **DRIFT — bespoke House hex vs token palette.** Pink `#D87794`, blue `#5A7A9F`, green `#5A8F6E` are **not in `design-tokens.json`**. Per memory `no-alpha-token-opacity`, avoid slash-opacity on raw hex. House dot colours should be stored as a per-House `color` value in the DB (arbitrary hex the school picks), rendered via inline `style={{background: house.color}}` on the dot — **this is the one sanctioned place to leave the token system**, because House colours are user data, not brand tokens. Everything else on the surface stays on tokens.

---

## 3. Score Ledger Item 1 — the working ledger (Path A auto-compile, desktop)

Source: `schoolup-shs-score-ledger.html` **§1** ("The working ledger · five categories, three paths, one record"). This is the **primary build target of the increment.** Demo: **Mr. K. Owusu**, Mathematics, **Form 2 Science** (37 students), **Semester 2 of 2025/26**, Path A active, portfolio pending.

Top-to-bottom regions of the in-app surface:

### 3.1 App shell + `.page-head`
- **Sidebar** `bg-navy` (Senior override — NOT Oversight deep-navy). Brand crest: gold badge `A` + `Omnischools Senior` / `Asankrangwa SHS`. **Scope chip** (`.scope-chip`, `bg-[rgba(200,151,91,0.10)] border-[rgba(200,151,91,0.25)] rounded-md`): label `Teaching`, name `Mr. K. Owusu` (`font-display`), meta `Mathematics · Form 2 Science`.
- Nav groups + items (verbatim): **My teaching** → Today's lessons · Classes · **Score ledger (active)** · Lesson plans · Assignments. **Students** → Class registers · Parent messages. **Semester end** → Report cards · STPSHS export. Footer `KO` / `K. Owusu` / `Subject teacher · Maths`.
- **`.page-head`** (`bg-surface border-b border-border`):
  - Crumb: `Senior · Mathematics · Form 2 Science · Semester 2, 2025/26 · Score ledger`.
  - `<h1 class="font-display">Form 2 Science · <em class="text-gold italic">Mathematics.</em></h1>` (28px, 500).
  - Lede: `37 students · Semester 2 of 2025/26 · weighted by Asankrangwa SHS configuration for Mathematics (15/15/40/15/15)` (bold-ish in `text-navy-3`).
  - Actions: `Configure weights` (`.btn.ghost` — `bg-transparent border-border-2 text-navy-3`) · **`Generate STPSHS sheet →`** (`.btn.primary` — `bg-navy text-bg`). *(The Configure-weights modal and STPSHS generation are downstream Items; the buttons must render but need only stub for Item 1 — see drift log.)*

### 3.2 Path chooser (`.path-chooser`) — three peer cards, `grid-cols-3`

Three `.path-card`s (`bg-surface border-[1.5px] border-border-2 rounded-xl`). The **active** card (Path A) = `border-gold bg-[linear-gradient(135deg,gold-bg,surface_60%)]` with an absolute `Active` label top-right (`text-gold text-[9px] uppercase`). Each card: italic gold serif letter (`.pc-letter font-display italic 22px text-gold`), bold name, muted description.

| Card | `.pc-letter` | `.pc-name` | `.pc-desc` (verbatim) |
|---|---|---|---|
| **A (active)** | A | **Auto-compile** | "From the assignments, exams and projects I've recorded through the semester. Portfolio entered at semester end." |
| B | B | **Scan my paper ledger** | "I keep a paper book; photograph it and Omnischools extracts the scores. I verify cell-by-cell." |
| C | C | **Type directly** | "Skip individual assignment tracking; enter category scores onto the ledger grid as I go." |

**Interaction:** peers, not a progression (spec §4.4 — the branded paper ledger is a feature, not a transitional artifact). Selecting a card sets the path for `(teacher × subject × class × semester)`. **For Item 1, only Path A is functional**; B and C render as selectable-but-inactive cards (B → Item 4, C → Item 2). Hover on inactive cards: `border-gold-soft`.

### 3.3 Class switcher — the class-tab list (desktop form of the chevron)

Source region: `.class-switcher-header` + `.class-tabs`. This is the **desktop equivalent of the PWA chevron/bottom-sheet** (spec §5.3: "on the desktop, a horizontal class-tab list expanding above the grid"). It is the required **class name + "1 of N" + switcher** affordance.

- **Header row** (`.class-switcher-header`): `Mr. K. Owusu · 2 classes this semester` (uppercase `text-navy-3 tracking-[0.14em]`) + italic gold serif hint `tap a tab to switch · the grid below reloads with that class's roster`.
- **Tab list** (`.class-tabs`, `bg-bg border border-border rounded-[11px] p-1 flex gap-1.5`). Each `.class-tab` is a flex-column card; **active tab** = `bg-surface border-gold shadow-sm`. Two tabs in the demo:
  1. **active** — `Form 2 Science · <em>Maths</em>` (`font-display 14px`, italic gold on subject) · meta `37 students · Path A · 4 of 5 categories` · status pill **`current`** (`.ct-status.current` = `bg-gold text-navy`).
  2. `Form 2 General · <em>Maths</em>` · `29 students · Path A · 4 of 5 categories` · status pill **`behind`** (`.ct-status.behind` = `bg-warn-bg text-warn`).
- Third status variant defined: **`ready`** = `bg-green-bg text-green` (all 5 categories complete / STPSHS-exportable).

**Behaviour (spec §5.3, must implement):**
- The "**1 of N**" pill on the PWA / the "N classes this semester" header on desktop is the **count affordance**. The chevron/tabs are **suppressed entirely when the teacher has only one class**.
- Tapping a tab **reloads the grid below with that class's roster, scores, progress** (the Basic `GradebookSelectors` query-param mechanism is the precedent — swap the class `<select>` for this tab list, or drive both from `?classId`).
- **Active class persists per (teacher × semester)** — the teacher lands back on the class they last touched, not alphabetical-first.
- **Chevron carries status** (spec §5.3): STPSHS deadline < 7 days → chevron/tab accent gold; teacher inactive > 14 days → warn-dot. Uses the same `ref_anomaly_rule` infra as the VHM view. *(Status-on-chevron is polish; the core tab switch is the Item-1 requirement.)*

### 3.4 The five-category ledger grid (`.ledger-grid`) — THE CORE

Wrapped in a `.panel` (`bg-surface border border-border rounded-[14px]`). Panel head: title `Semester 2 <em>ledger</em>` (`font-display`) + meta `37 of 37 students · 4 of 5 categories filled · portfolio pending`.

**Header row — the five category columns + weighted total (exhaustive):**

| # | Column header (verbatim) | Sub-line (`.cat-weight`, `font-mono 9px`) | Header colour class | Maps to spec §2 |
|---|---|---|---|---|
| — | **Student** (`.student-col`, left-aligned, sticky-left) | — | `text-navy-3` | student key + REF ID |
| 1 | **Assignments** | `15%` | `.cat-asgn` → **`text-green`** | Assignments / class exercises (avg of in-sem entries) |
| 2 | **Mid-sem** | `15%` | `.cat-mid` → `text-navy-2` | Mid-semester examination |
| 3 | **End-of-sem** | `40%` | `.cat-end` → `text-navy-2` | End-of-semester examination (dominant weight) |
| 4 | **Project** | `15%` | `.cat-proj` → **`text-green`** | Individual project work |
| 5 | **Portfolio** | `15%` | `.cat-port` → **`text-terra`** | Portfolio (manual-only) |
| Σ | **Weighted** | `100%` (in `rgba(255,255,255,0.6)`) | `.cat-total` → **`bg-navy text-bg`** | weighted total |

Header cells: `bg-bg text-[9px] uppercase tracking-[0.1em] font-bold py-[11px] px-2.5 text-center border-b border-border-2`. The **Weighted** header is inverted (`bg-navy text-bg`) to read as the output column. **The five category colours are the surface's semantic key:** green = auto-computable "safe" categories (assignments, project), navy = the two exams, **terra = portfolio (the one Omnischools cannot compute).** Preserve exactly.

> Note the header abbreviations differ across surfaces: desktop full-form uses "Assignments / Mid-sem / End-of-sem / Project / Portfolio / Weighted"; the term-progress card uses the long NaCCA forms ("Assignments / class exercises", "Mid-semester examination", "End-of-semester examination", "Individual project work", "Portfolio"); scan/PWA/STPSHS use short codes (Asg / MS / ES / Pj/Pro / Pf/Por / Wt). The VHM view uses `Asg · MS · ES · Proj · Port`. **Canonical machine keys:** `asgn_score, mid_sem_score, end_sem_score, project_score, portfolio_score` + computed weighted total (spec §9). Keep the machine keys stable; the display label varies by surface width.

**Body rows** (`.ledger-grid tbody td`, all `font-mono 12px text-center`, `border-b border-border`):
- **Student name cell** (`.student-name`, left, sticky-left, `font-body font-semibold text-navy`) + **`.student-ref`** block `REF-2024-0142` (`font-mono 9.5px text-navy-3`). The `REF-2024-XXXX` is the **STPSHS Assessment Reference ID** assigned at Year-1 registration — present on every row; it is what makes the eventual STPSHS export match per-student (spec §8.1). **Required on every row.**
- **Score cells** — four state classes (this is the cell-colour vocabulary):
  - **`.computed`** = `bg-green-bg text-green font-bold` — **auto-compiled from in-semester entries (Path A).** The four left categories in the demo are all computed.
  - **`.manual`** = `bg-gold-bg text-navy font-bold` — **manual entry (portfolio + corrections).**
  - **`.empty`** = `text-border-2`, renders `—` — no value yet (portfolio column in the demo).
  - **`.low-conf`** = `bg-warn-bg text-warn font-bold` with an absolute `?` marker top-right — **scan path only (Path B, Item 4)**; not produced by Path A but the class must exist for cross-path reuse.
- **Total cell** (`.total`) = `bg-navy text-bg font-bold 13px` — the weighted total (e.g. `76.1`). Row hover: `tr:hover td → bg-gold-bg`, and `td.total → bg-navy-deep`.

Demo data (first rows, verbatim, all portfolio empty so totals are provisional): Abena Mensah `72/68/81/75/— → 76.1`; Akwasi Boateng `65/71/69/80/— → 70.6`; Ama Asante `88/85/89/92/— → 88.6`; Daniel Owusu `58/62/55/66/— → 58.7`; … `… 27 more students · scroll to view full class` (dimmed row, `opacity:0.4`).

**Legend** (`.legend`, below the table): three swatches — `Auto-compiled from in-semester entries` (green box) · `Manual entry (portfolio + corrections)` (gold box) · `Low-confidence (scan path only)` (warn box). Render all three even in Path A (the low-conf one is documented-but-unused here).

### 3.5 The weighted-total column & how weights are surfaced

- **Weights are configured per `(subject × school)`** (spec §2). The demo shows `15/15/40/15/15` in three places, all of which must stay in sync with the config: (a) the `.page-head` lede — "weighted by Asankrangwa SHS configuration for Mathematics (15/15/40/15/15)"; (b) each category header's `.cat-weight` sub-line (`15% / 15% / 40% / 15% / 15%`); (c) the STPSHS-ready card copy (§3.7).
- The **Weighted** column value = Σ(category% × weight)/100 over entered categories, **provisional until portfolio is in** (spec §4.1). Compute live client-side (mirror of Basic `rollup()`), server rollup on save = source of truth.
- **Surfacing rationale (spec §2):** "surfaces the configured weights on every report so a parent or auditor can see how a final score was computed." The per-column weight sub-line is non-negotiable — it is the audit affordance.
- **`Configure weights` button** (`.page-head` ghost action) opens the per-`(subject×school)` weight editor. Default seed `15/15/40/15/15`. *(Editor UI is minimal for Item 1; the numbers must be readable/derived from config, not hard-coded in the grid.)*

### 3.6 Term-progress card (`.term-progress`) — the completion state (left of the two-up)

Below the grid, a two-column layout (`grid-cols-2 gap-3.5`). **Left card** = per-category completion for this class-subject. Title `Semester 2 progress · this class-subject`. Five `.cat-progress` rows (label `text-navy-2 11.5px` + status pill `font-mono 10px rounded-full`):

| `.cp-label` (verbatim, long NaCCA form) | `.cp-status` | pill class |
|---|---|---|
| Assignments / class exercises | `8 of 8 · done` | `.done` = `bg-green-bg text-green` |
| Mid-semester examination | `37 of 37 · done` | `.done` |
| End-of-semester examination | `37 of 37 · done` | `.done` |
| Individual project work | `37 of 37 · done` | `.done` |
| **Portfolio** | **`0 of 37 · enter at semester end`** | `.pending` = `bg-bg text-navy-3` |

A `.partial` variant (`bg-gold-bg text-gold`) exists for in-between counts.

> **Portfolio = manual-only affordance #1:** the four computable categories show a **progress count** ("37 of 37 · done"); portfolio shows **"enter at semester end"** instead of a count. This is the deliberate UI signal (spec §2, §4.1) that Omnischools **cannot auto-compile portfolio** — there are no in-term events to aggregate; it is a one-shot end-of-semester discretionary mark. Never show a "0 of 37" as if it were merely incomplete work.

### 3.7 STPSHS-ready card (`.stpshs-ready`) — the export completion state (right of the two-up)

Right card of the two-up. Two states:
- **`.pending`** (demo state) = `bg-[linear-gradient(135deg,gold-bg,surface_70%)] border-gold`, icon `!` (`bg-gold text-navy`). Copy (verbatim): **"STPSHS export is _one step away_. Enter the portfolio scores for the 37 students, then the printable STPSHS-ready score sheet generates from this ledger. **STPSHS Semester 2 window opens 14 July 2026** · 17 days from now."**
- **Ready** (default, from §3 of the surface) = `bg-[linear-gradient(135deg,green-bg,surface_70%)] border-green`, icon `✓` (`bg-green text-bg`). Copy: "**Ledger is complete and STPSHS-ready.** All 37 students have all five categories filled…". (This full-ready card lives on the STPSHS export surface = Item 8; the ledger surface shows the **pending** state.)

> **"STPSHS export ready / missing X" completion state:** this card **is** that state. Pending → "one step away … enter the portfolio scores for the 37 students" (i.e. *missing portfolio*). Ready → "complete and STPSHS-ready." The card names the **WAEC submission window date** (14 July 2026) and **days remaining** (17 days). The corresponding VHM-view vocabulary (context surface) is the `stpshs-cell` pill: **`ready` (5/5) · `behind` (e.g. 4/5) · `at-risk` (0/5)** — the Item-1 grid's completion summary must map onto those same three tiers so the teacher's view and the VHM's view share vocabulary (spec §6, and the VHM surface `.stpshs-cell` classes).

---

## 4. Card-view vs grid-view (from the PWA surface) — informs the desktop grid

Source: `schoolup-shs-score-ledger-pwa.html` §1. **The PWA is Item 5, not this increment** — but the **two-view model and the switcher** are mapped here because (a) the spec (§5.2) requires the desktop ledger to also carry the toggle, and (b) the PWA **grid view** is the compact sibling of the desktop Item-1 grid. Build the desktop grid now; the toggle + card view land with Item 5.

### 4.1 The toggle (`.pwa-view-toggle`)
Two-segment pill (`bg-bg border border-border rounded-md p-[3px]`). Segments `Card` / `Grid`, each with an italic serif glyph (`▤` / `▦`). Active segment = `bg-navy text-bg`. Persists per `(teacher × subject × class × semester)`; **card is first-use default, grid becomes default once chosen** (spec §5.2). On desktop the **default is grid** (wide screen scans the whole class).

### 4.2 Card view (`.pwa-student-card`) — one student, five large fields, live total
Per spec §5.2, the right shape for *entering scores as you mark* (misattribution to the wrong student is the biggest error source). Structure of one card:
- `.psc-name` (bold 14px) + `.psc-ref` (`REF-2024-0142 · 14 of 37` — REF ID + position-in-class).
- **Five `.pwa-cat-row`s** (`grid-cols-[1fr_70px]`): label + `.pcr-weight` (`15%`/`40%`) on the left, a large `.pwa-input` on the right (`font-mono font-bold text-center border-[1.5px] border-border-2 rounded-md`, focus → `border-gold bg-gold-bg`). Labels: `Assignments · Mid-sem exam · End-of-sem · Project work · Portfolio`. **Portfolio input** uses `.empty` + `placeholder="—"` (manual-only, blank).
- **`.pwa-total-row`** — label `Weighted total` + `.ptr-val` = `font-display 22px` italic gold number `76.1` with a `+ portfolio` suffix in `text-navy-3`. **Live-computed, provisional until portfolio.** This is the "live total" requirement.

Input states: `.pwa-input.empty` (portfolio, `text-border-2`); `.pwa-input.pending-sync` (`bg-gold-bg border-gold` — a score held locally offline, Item 5). Sync strip above (`.pwa-sync-strip`) green "All scores synced · last 2 minutes ago" / offline gold "Connection lost · N scores held locally" — **Item 5, not Item 1.**

### 4.3 Grid view (`.pwa-grid-table`) — whole class, sticky-left names
Per spec §5.2, the right shape for *scanning / spotting outliers / final review before STPSHS*. This is the **compact form of the desktop grid** and the "sticky-left names" reference:
- `thead` = `bg-navy text-bg`; columns `Student · Asg(15) · Mid(15) · End(40) · Pro(15) · Por(15) · Wt(total)`. The `Wt` column head = `.gh-wt` = `bg-gold text-navy`; each weight sub-line in `.gh-weight` (`8px`).
- Body: `.gc-student` sticky-left (`font-body font-semibold`) with `.gc-ref` short code (`0142`); `.gc-score` cells `font-mono`; `.gc-score.empty` = `—` (`text-navy-3 opacity-50`); `.gc-wt` = `font-display italic text-gold` weighted total on a faint gold tint.
- Foot (`.pwa-grid-foot`): `8 of 37 · scroll for more` + hint `tap any cell to edit`.

> The **desktop** `.ledger-grid` (§3.4) is the authoritative Item-1 build; the PWA grid view is the same data at phone width. Both use the identical five columns + weighted total and the sticky-left student column. Reuse `ColumnScoreGrid`'s sticky/overflow mechanics.

### 4.4 The chevron + bottom-sheet switcher (PWA form of §3.3)
`.pwa-context.tappable`: class name `Form 2 Science · <em>Maths</em>` + **`.pc-chevron` (`▾`, gold)** + **`.pc-class-count` pill `1 of 2`** (`bg-gold-bg text-navy`). Tapping opens `.pwa-bottom-sheet` (dim overlay `rgba(26,43,71,0.45)`, sheet `rounded-t-[18px]` with a grab handle). Sheet title `Switch class · Mr. K. Owusu · Semester 2`. Each `.pwa-class-option` row: `.pco-name` (`font-display`, italic gold subject) + `.pco-meta` (`37 students · Path A · 4 of 5 categories · portfolio pending · STPSHS in 17 days`) + `.pco-status` pill (`current` gold / `ready` green-bg / `behind` warn-bg). **Two taps end-to-end.** Same three status variants as the desktop tabs (§3.3). Bottom nav `.pwa-bottombar`: Today · Classes · **Ledger (active)** · More.

> **Conceptual model is identical across form factors** (spec §5.3): one teacher, several classes, one switch. Desktop = horizontal tab list; PWA = chevron + bottom sheet. Same data (`class name · student count · path · completion · status pill`), same persistence, same "1 of N".

---

## 5. Portfolio = manual-only — the single most important affordance (consolidated)

Because the brief calls this out specifically, here is every place the "portfolio is the one cell Omnischools cannot auto-compile" truth must surface (spec §2 + §4.1):

1. **Grid cell** (§3.4) — portfolio column renders `.empty` `—` in Path A (never a computed green value); when entered it becomes `.manual` (gold), never `.computed` (green). Portfolio is **structurally `manual`**, distinct from the four `computed` categories.
2. **Term-progress card** (§3.6) — portfolio row shows **"enter at semester end"**, not a "N of 37" progress count. The other four show counts.
3. **Card view** (§4.2) — portfolio `.pwa-input.empty` with `placeholder="—"`; the weighted total shows `+ portfolio` suffix to signal it's provisional.
4. **STPSHS-ready card** (§3.7) — the "one step away" pending copy is *specifically about the missing portfolio*: "Enter the portfolio scores for the 37 students."
5. **Header colour** (§3.4) — portfolio header is **`text-terra`** (the only terra category), visually marking it as the exception to the green/navy auto-computable set.
6. **Path A card copy** (§3.2) — "Portfolio entered at semester end."

The engineering rule (spec §2/§4.1): the four computable categories derive from in-semester events (`GRADED_EVENT` rows); **portfolio has no source events — it is a single discretionary end-of-semester field.** The compile step fills four; the teacher fills the fifth by hand.

---

## 6. The path indicator (A / B / C)

Appears in three consistent forms; keep the letter + colour vocabulary aligned:
- **Path chooser cards** (§3.2) — big serif italic gold letters A/B/C; active card gold-outlined + "Active" label.
- **Class tabs / switcher rows** (§3.3, §4.4) — "Path A" in the `.ct-meta` / `.pco-meta` line.
- **VHM view `.path-pill`** (context surface) — `A` = `bg-green-bg text-green` · `B` = `bg-gold-bg text-gold` · `C` = `bg-terra-bg text-terra` (`font-mono 9px rounded-full`). The teacher-facing surfaces don't colour-code the path letter, but if a compact path pill is needed on the tab, reuse these VHM colours (spec/VHM note: "pill colours match the ledger surface's colour vocabulary").
- **Item-1 scope:** only Path A is functional. Render B/C as inactive. The path is chosen per `(teacher × subject × class × semester)` and is switchable (spec §4.4).

---

## 7. Interaction-state inventory (every state, per region)

| Region | State | Visual |
|---|---|---|
| Path card | default / hover / active | `border-border-2` / `border-gold-soft` / `border-gold` + gold-bg gradient + "Active" |
| Class tab | inactive / active | `border-transparent` / `bg-surface border-gold shadow-sm` |
| Class-tab status pill | current / ready / behind | `bg-gold text-navy` / `bg-green-bg text-green` / `bg-warn-bg text-warn` |
| Score cell | computed / manual / empty / low-conf | `bg-green-bg text-green` / `bg-gold-bg text-navy` / `—` `text-border-2` / `bg-warn-bg text-warn` + `?` |
| Ledger row | default / hover | `bg-surface` / `bg-gold-bg` (total cell → `bg-navy-deep`) |
| Score input (PWA/edit) | default / focus / empty / pending-sync | `border-border-2` / `border-gold bg-gold-bg` / `text-border-2` / `bg-gold-bg border-gold` |
| View toggle | inactive / active | `text-navy-3` / `bg-navy text-bg` |
| STPSHS-ready card | pending / ready | gold gradient + `!` / green gradient + `✓` |
| Term-progress pill | done / partial / pending | `bg-green-bg text-green` / `bg-gold-bg text-gold` / `bg-bg text-navy-3` |
| Save button (reuse Basic) | idle / saving / disabled | `bg-navy hover:bg-navy-deep` / "Saving…" / `disabled:opacity-60` |
| Residency pill (roster) | boarder / day | `bg-navy text-bg` / `bg-bg text-navy-2 border border-border-2` |
| Programme chip (roster) | — | `bg-gold-bg border-gold-soft text-gold` |
| House dot (roster) | — | 11px circle, per-House `color`, hairline `box-shadow` ring |
| Empty grid (no selection) | — | reuse Basic dashed card / `EmptyState` tone="muted": `border-border-2 bg-surface rounded-xl border border-dashed p-12 text-center text-navy-3` → "Choose a class, subject and period to enter scores." |
| Empty roster (0 students) | — | reuse Basic dashed card → "No students in this class." |
| Ledger before any category entered | mirror `GradebookEmptyColumns` — faded preview grid (`opacity-45 pointer-events-none`) behind an absolute-centred gold floating-CTA card | Path A onboarding; adapt copy to "record assignments/exams to auto-compile" |

---

## 8. Component mapping summary (surface region → build target)

| Surface region | Existing Basic component / idiom to reuse | New work for Item 1 |
|---|---|---|
| `.page-head` hero | gradebook `page.tsx` hero header block | copy structure; swap copy + Senior crumb |
| Path chooser | — (new) | 3 hand-rolled `.path-card`s; only A active |
| Class-tab switcher | `GradebookSelectors` (query-param drive) | replace class `<select>` with tab list; keep `?classId` mechanics; add persistence + "1 of N" |
| Five-category grid | `ColumnScoreGrid` (sticky-left, overflow-x, live `rollup`, dirty-set save) | 5 fixed category columns + weighted-total column; category state classes (computed/manual/empty/low-conf); REF-ID sub-line; `saveColumnScores`-style server action |
| Weighted total column | Basic `rollup()` total column | 5-category weighted math; per-column weight sub-lines from `(subject×school)` config |
| Term-progress card | — (new) | 5 `.cat-progress` rows; portfolio = "enter at semester end" |
| STPSHS-ready card | — (new) | pending/ready states; window date + days-left (may stub the Generate action) |
| Card / grid toggle + card view | (Item 5) | not built in Item 1; grid view = desktop grid |
| Roster: programme chip | — (new, F0) | gold-tinted `.chip.programme` |
| Roster: House column + dots | — (new, F0) | House dot (per-House colour) + name; right-rail distribution bars |
| Roster: residency pill | — (new, F0) | boarder (navy) / day (outline) pill |
| Selectors / period | `GradebookSelectors` + `academicPeriod` (period label "Semester 2" from `academic_period.period_label`) | reuse; SHS reads "Semester" via label, no code branch (spec §3.3) |
| Empty states, buttons, save | Basic dashed card, `.btn`/`.btn.primary`, save server-action pattern | reuse verbatim |

---

## Open questions / drift log

1. **House names — surface vs brief (spec-neutral, config data).** Brief lists **Aggrey, Guggisberg, Fraser, Slessor, Kingsley, Aryee**; the roster surface lists **Pink 1, Pink 2, Gibson, Aryee, Knight, Quaque** (only *Aryee* shared). Neither is "correct" — **Houses are per-school config (name + colour), not hard-coded.** Resolution: build the `houses` table (name, colour, per school), seed the demo school's set. *Which set seeds the F0 demo/seed data must be confirmed with the product owner.* Surface wins on visual presentation (dot + name + ring); brief's names are just a different school's data.
2. **House dot colours are raw hex, not tokens.** `#D87794` (pink), `#5A7A9F` (blue), `#5A8F6E` (green) are absent from `design-tokens.json`. Sanctioned exception: store per-House `color` in DB, render via inline `style` on the dot (House colour is user data). Do **not** apply slash-opacity to these (memory `no-alpha-token-opacity`). Everything else stays on tokens.
3. **"Status" header renders residency.** Roster table header column 5 says **Status** but the cell shows the **boarder/day residency pill**. Kept 1:1 (surface wins on presentation). Flag: consider renaming the header to "Residency" for clarity — confirm with PO before deviating from the surface.
4. **Category header labels vary by surface width.** Full ("Assignments/Mid-sem/End-of-sem/Project/Portfolio/Weighted") vs long NaCCA ("Assignments / class exercises" …) vs short codes (Asg/MS/ES/Pj/Pf). Machine keys are fixed (`asgn_/mid_sem_/end_sem_/project_/portfolio_score`); pick display label by breakpoint. No conflict, but the implementer must not treat the labels as the keys.
5. **`.cat-mid` vs `.cat-end` share a colour but not a weight.** Both headers are `text-navy-2`, yet end-of-sem carries **40%** (dominant) vs mid-sem **15%**. The weight sub-line is the only visual differentiator. Ensure the 40% isn't lost — it's the single most important weight (spec §2).
6. **Path B/C cells appear in a Path-A-only increment.** The `.low-conf` (scan) cell class and Paths B/C cards render on the Path A surface. For Item 1 they are inert (B → Item 4, C → Item 2). Build the CSS classes now (cheap, needed for cross-path reuse per spec §4.2/§7.4) but wire only Path A.
7. **`Configure weights` + `Generate STPSHS sheet` buttons are downstream.** Both render in the `.page-head` of the Item-1 surface but their targets are later Items (weight editor minimal; STPSHS sheet = Item 8). Confirm whether Item 1 ships a functional weight editor or a read-only weights display seeded at `15/15/40/15/15`.
8. **`--navy-deep` (`#13203A`) is used but only in `tokens.css`, not `design-tokens.json`.** The ledger hover (`td.total → var(--navy-deep)`) and Basic Save-hover both use it. It exists as `bg-navy-deep` in `tokens.css` — fine to use; note it's absent from the JSON token source (minor token-source drift, already reconciled in css).
9. **Period label comes from data, not code (spec §3.3).** SHS shows "Semester 2 of 2025/26", Basic "Term 2" — both read `academic_period.period_label`. Item 0 (period config) is "✅ shipped in Basic" per the build plan; confirm the SHS seed writes `period_type='SEMESTER', period_count=2` so labels read "Semester" without branching.
10. **Class-switcher persistence + status-on-chevron** (spec §5.3) — "active class persists per (teacher × semester)" and "chevron carries status (gold < 7 days / warn-dot > 14 days)" reuse `ref_anomaly_rule`. The core tab-switch is the Item-1 requirement; persistence and status-on-chevron are polish that can trail if `ref_anomaly_rule` isn't yet present in Senior.

---

*Map produced against: `schoolup-shs-score-ledger.html`, `schoolup-shs-score-ledger-pwa.html`, `schoolup-shs-vice-headmaster-progress.html` (context), `schoolup-shs-class-roster.html` / `schoolup-class-roster-shs-variant.html`; `SHS_SCORE_LEDGER_SPEC.md` §§2/4.1/5.2/5.3/9/11; `design-tokens.json` v1.0.0; live `styles/tokens.css`; and the Basic gradebook (`app/(app)/gradebook/page.tsx`, `components/gradebook/column-score-grid.tsx`, `selectors.tsx`).*
