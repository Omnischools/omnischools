# VLC School Dashboard — Surface Map (INCR-44 · Module 4.5 / surface 05 · the HM + Dean rollup · METADATA-ONLY, NO new tables)

**Author:** Lucy (design cartographer) · **Status:** design spec, ready for the implementation engineer (pending the one Kofi gate ruling in §1.3 + the two owner confirms in the drift log).
**Scope of this map:** `Surfaces/schoolup-vlc-school-dashboard.html` — the school-wide "how is the values
programme actually running?" rollup for the **Headmaster + Dean of Students**. This is the **last VLC surface
(05 of 05)** and the module's only aggregate view.

**🔴 THE HARD CONSTRAINT (every ruling below flows from it):**
- **METADATA / AGGREGATES ONLY** — counts, percentages, per-class rollups. **NO confidential CONTENT** — no
  journal / note / observation / case / character-paragraph body text, and **no per-STUDENT pastoral-flag
  existence** that names a specific student's confidential status on a school-wide page. An aggregate *"N flags
  open"* (school or class **count**) is safe; a *"J. Manu · flagged ✓"* named row is a **LEAK** → **omit-not-fake**,
  or send the Dean to the **existing gated per-student drill-in** (the shipped `/senior/vlc/journal/[studentId]`).
- **NO NEW TABLES** — every number derives (a COUNT / AVG / GROUP BY) from the **already-shipped** VLC tables
  (`db/schema/vlc.ts`, INCR-40→43b). Anything the surface draws that needs data not yet built = **omit-not-fake**.
- **READ-ONLY.** The dashboard has no write affordances (§4). The two surface buttons that *look* like writes
  (`Open pastoral case file`) are the pastoral-stub anti-pattern → omit (§Ω).

Rule where surface and spec/owner disagree: **owner/confidentiality wins on logic + visibility, surface wins on
visual presentation.** Every drift is called out inline and collected in the drift log.

## Source

| File | Role |
|---|---|
| `Surfaces/schoolup-vlc-school-dashboard.html` — CSS L8–187; **§01** L201–630 (the app mock: head-row, summary strip, filter bar, class matrix, flag drilldown, curriculum coverage); **§02** L632–662 (editorial); `.notes` asides L613–628 + L651–660 | **PRIMARY** for copy, tokens, states, and the "what it deliberately doesn't show" contract. |
| `docs/senior/vlc-pastoral-flag-surface-map.md` (42b) §7, `docs/senior/vlc-student-journal-surface-map.md` (43a) §1.3 + §7, `docs/senior/vlc-character-paragraph-surface-map.md` (43b) §4 | **PARENT MAPS** — all three explicitly parked "a Dean cross-class flag roll-up → **INCR-44** `vlc-school-dashboard`". This map is that roll-up, built to the metadata-only fence. |

## Canonical inputs — the SHIPPED tables every metric derives from (NO new store)

`db/schema/vlc.ts` already ships everything the dashboard needs. The dashboard is a **pure read** over these:

| Shipped table (INCR) | Audit class | What the dashboard derives from it |
|---|---|---|
| `vlc_session` (42a) | operational / SHOWN | sessions held per class + school-wide; "year progress"; curriculum position |
| `vlc_session_attendance` (42a) | operational / SHOWN | attendance % (present-by-default: present = enrolled − ABSENT rows); form-level breakdown |
| `vlc_session_template` → `vlc_value` (40) | config / SHOWN | the value ordinal + slot behind each session → curriculum-coverage grid |
| `vlc_peer_guide` (41) | operational / SHOWN | trained-PG count; per-class PG initials; **PG vacancy** (derived: eligible class with <2 active) |
| `vlc_training` + `vlc_training_absence` (41) | operational / SHOWN | PG-training attendance % (present-by-default) + next-training date |
| **`vlc_pastoral_flag` (42b)** | **CONFIDENTIAL / REDACTED** | **flag COUNTS only** — raised / open (`resolved_at IS NULL`) / resolved / escalated (`severity='CRISIS'`); GROUP-BY value + severity for the pattern block. **NEVER** the named per-student card + `context`/narrative (that stays the gated drill-in). |
| `vlc_pastoral_journal` (43a) | CONFIDENTIAL / REDACTED | **NOTHING** — the "reflection submission %" metric is **omit-not-fake** (§Ω). |
| `classes` / `students` / `users` | operational | class name, enrolment, form level (`classFormNumber`), Form Master name. |

**Existing readers to mirror (do NOT re-invent):** `lib/vlc/session-data.ts::getVlcSessionsLanding` (the
school-wide operational rollup idiom — `server-only`, one `withSchool`, counts DERIVED, plain view types, the
`present / enrolled · presentPct%` shape at `sessions/page.tsx` L98–105). The confidential flag COUNT is a
**separate** server read behind the flag gate (the `pastoral-data.ts::getPastoralFlags` "separate query, only
run past the gate, never into non-gated props" idiom) — see §1.3.

**Components:** `components/vlc/chrome.tsx` (`SectionHead` + `SumCard`); the `sessions/page.tsx` hero + table
idiom; `components/vlc/vlc-tabs.tsx` (nav). No new component family.

---

## 0. Token & type reference + the no-alpha trap (this surface is a heavy offender)

Same `:root` as every Senior surface (byte-identical to the ledger/F0 map §0). The three panels that lean on
`rgba()` and MUST translate to **SOLID** tokens (repo memory `no-alpha-token-opacity`; a broken slash-opacity
compiles clean — **verify tints in the live preview, not the build**):

| Surface region | Surface tint(s) | SOLID translation (mandated) |
|---|---|---|
| **`.sum-card.featured`** (Year-progress, navy) | navy + `rgba(232,212,184,0.7/0.6)` label/sub | `SumCard featured` — already SOLID `text-gold-soft` (chrome.tsx L55/57). Reuse verbatim. |
| **`.sum-card.terra`** (Pastoral-flags card) | `bg-terra-bg` + `border-terra` + `text-terra` | **NEW `terra` ground on `SumCard`**: `border-terra bg-terra-bg`, label/big/sub `text-terra`. All solid — the 42b callout already proves the terra family clean. **Do NOT** `bg-terra/10`. |
| **`.coverage-card`** (navy, the 11-value grid) | `bg-navy`; cells `rgba(255,255,255,0.04)` + `rgba(232,212,184,0.15)` border; muted text `rgba(232,212,184,0.7)`; foot `rgba(200,151,91,0.1)` | ground `bg-navy text-bg`; cells **`bg-navy-2`** (solid) + `border border-navy-3`; muted `text-gold-soft` (SOLID); `done` cell `bg-green-bg`-on-navy → use a solid green tint (`border-green` + solid fill); `current` `bg-gold text-navy`; foot `border-l-gold` on a solid navy-2 band. **Never** slash-opacity on navy/gold. |
| **matrix row tints** `.flagged` / `.exemplar` / `.f1` | `bg-terra-bg` / `bg-green-bg` / `bg-bg` | solid `bg-terra-bg` / `bg-green-bg` / `bg-bg` — already solid tokens, no alpha. Fine. |

**Type:** Fraunces (`font-display`) — h1/h2, section titles, `SumCard` big numbers, matrix class names + attendance
figures, coverage value ordinals; Manrope — all body/labels/FM names; **JetBrains Mono** — the matrix `bar-meta`
(`13 / 22 sessions`), coverage `v-rate` (`100%`), PG codes. Italic gold `<em>` on every display heading.

---

## 1. Route, nav & the audience gate (the crux — this is where metadata-only meets HM-excluded-from-flags)

### 1.1 Route — `/senior/vlc/dashboard`
- Surface browser bar: `app.omnischools.gh / pastoral / vlc / dashboard / academic-year-2025-26`; crumb
  `Pastoral & values · VLC · School-wide dashboard`. Per repo convention **"pastoral" is editorial/CSS only,
  never a route segment** → built route **`/senior/vlc/dashboard`**, a new page under the shipped `VlcLayout`
  (`app/(app)/senior/vlc/dashboard/page.tsx`, `export const dynamic = "force-dynamic"`, `params`-free). It sits
  beside `setup/`, `peer-guides/`, `sessions/`.

### 1.2 Nav — the dashboard is the leadership LANDING + the discoverable VLC entry (the 43b follow-on)
- **Add a `Dashboard` tab to `VlcTabs`** (`components/vlc/vlc-tabs.tsx` `TABS`), **first**:
  `Dashboard · Setup · Peer Guides · Sessions`. One line; the tab row already renders under `VlcLayout`.
- **Repoint the sidebar "Student support" item** (`components/app/sidebar.tsx` L115) from `/senior/vlc/setup`
  → **`/senior/vlc/dashboard`**. Today the flat "Student support" slot lands leadership on the *config setup*
  page; the rollup is the right landing for HM/Dean. **This is the discoverable VLC entry the 43a/43b maps said
  HM still lacked** — HM is already in `VLC_CONFIG_READ_ROLES`, so the sidebar item already shows for HM; it just
  pointed at the wrong page. (Label stays **"Student support"**, never "Pastoral".)
- **NOT a per-student drill-down.** Unlike `/journal/[studentId]` and `/reference/[studentId]` (which `VlcTabs`
  hides), the dashboard is a top-level operational surface → it keeps the tab row, Dashboard active.

### 1.3 🔴 The gate — the dashboard MIXES two sensitivity classes on one page (Kofi ruling parallel)
The surface is one page, but its data splits across the exact boundary this module is built on:

| Region | Data class | Who may see it (shipped precedent) |
|---|---|---|
| Sessions held · attendance % · curriculum coverage · PG training · PG vacancy · class matrix (minus the flags column) | **operational / SHOWN** | `VLC_CONFIG_READ_ROLES` = **Dean · ADMIN · HM · FM** (the same set that reads the operational register). |
| **Pastoral-flag AGGREGATES** (the strip's flags card, the matrix Flags column, the pattern block) | **confidential-derived METADATA** (counts, no identity, no content) | **🔴 KOFI'S CALL.** Owner-locked today: `VLC_PASTORAL_READ_ROLES` = **FM + Dean only; HM excluded, ADMIN barred.** |
| The **named per-student flag drilldown + narratives** (the 4 flag cards) | **confidential CONTENT + per-student identity** | **NOBODY, on this surface** → omit; reached only via the shipped gated per-student drill-in. |

**My recommendation (for Kofi to rule):**
1. **Two server reads, not one.** The page runs the operational rollup (`VLC_CONFIG_READ_ROLES`) for everyone
   gated in, and a **separate** flag-count read **only past a flag decision** — the `getPastoralFlags` pattern
   (separate query, never merged into non-gated props). A viewer who fails the flag gate gets a page **identical
   to one where zero flags exist** (no "restricted" card, no gap) — the 42b indistinguishability contract.
2. **The Dean** (school-wide pastoral authority) sees the flag aggregates. **Definite.**
3. **The HM** is the open question. A **bare count** ("4 flags open school-wide") leaks no student identity and no
   content — it is arguably leadership metadata the HM should have (the surface is literally titled "Headmaster &
   Dean view"). But it derives from the confidential table the owner locked HM out of. **Recommend: admit HM to
   the flag *count* (aggregate) but NOT to any per-class or per-student breakdown** — i.e. HM sees the strip's
   single school-wide "N open / N raised" number, Dean additionally sees the per-class Flags column + the pattern
   block. If Kofi prefers the strict owner reading, HM sees **no** flag data and the flags card/column render for
   Dean only. Either way: **a new `VLC_DASHBOARD_FLAG_ROLES` const** (Dean, ±HM) keeps the decision in one place,
   disjoint from `VLC_PASTORAL_READ_ROLES` (which stays the per-student content gate, untouched).
4. **The plain FM** reads the whole school's rollup? An FM's world is their own class. Recommend the dashboard
   *operational* body is leadership-scoped in practice, but since `VLC_CONFIG_READ_ROLES` includes `FORM_MASTER`
   for the setup read, an FM technically reaches it. Not a leak (operational data is school-wide-readable); flag
   for the owner whether to narrow the *dashboard* to leadership (drift log).

---

## 2. Section-by-section 1:1 — every card/metric, its shipped data source, and the KEEP / OMIT verdict

Order top-to-bottom. **Copy transcribed verbatim.** For each metric: the derivation, then the verdict.

### 2.1 Page header (editorial chrome above the app frame, L192–199)
Eyebrow `Omnischools · VLC batch · 05 of 05`; gold pill `SHS · Headmaster & Dean view`; outline pill
`School-wide rollup · 18 classes`; h1 `The view <em>across the school</em>`; gold rule; lede (verbatim):
> "What the Headmaster and Dean see when they want to know: *how is the values programme actually running?*
> Eighteen classes, thirteen sessions held to date, four active pastoral flags, ninety-two percent peer-guide
> training attendance, sixty percent through the eleven-value curriculum. **Not a grade for VLC, not a ranking —
> a rhythm-check.**…"

**Verdict:** this outer header is design-doc chrome; the in-app header is `.head-row` (§2.2). Build §2.2. Keep the
"rhythm-check, not a ranking" framing — it is the editorial spine (§2.8) and the reason there are **no
leaderboards** (owner-adjacent).

### 2.2 In-app head-row (L215–225)
- Crumb `Pastoral & values · VLC · School-wide dashboard`.
- h2 (Fraunces) `Semester 2 · Week 26 of 30 <em>· 14 May 2026</em>` — week/date derive from the current
  `academic_period` + today. **KEEP.**
- Lede (verbatim): `18 classes running · 234 VLC sessions held cumulatively year-to-date · 91% average
  attendance · 12 pastoral flags raised this year (4 currently open) · 36 trained Peer Guides`.
  - `18 classes` = COUNT(SHS classes). `234 sessions` = COUNT(`vlc_session`) school-wide. `91%` = attendance AVG.
    `36 trained PGs` = COUNT(`vlc_peer_guide` active). **All KEEP (aggregates).**
  - `12 pastoral flags raised (4 currently open)` = COUNT(`vlc_pastoral_flag`) / COUNT WHERE `resolved_at IS NULL`.
    **KEEP as a count — gate per §1.3** (Dean always; HM per Kofi). Metadata, no identity.
- **Actions (right):** `Export term report` (ghost) · `Open pastoral case file` (gold).
  - **`Export term report`** — **KEEP only if metadata-only.** The export must be the same aggregates (counts,
    attendance %, coverage), **never** flag narratives or journal content. Flag: scope the export to the rollup
    numbers; a per-student flag/case export is out of INCR-44 (§Ω).
  - **`Open pastoral case file`** — **OMIT (§Ω).** A "case file" button on a school-wide surface with no student
    selected implies a case-file system reachable from the rollup — the `lib/boarding/pastoral-stub.ts`
    anti-pattern the module bans. A case file is a **per-student gated drill-in**, not a dashboard action.

### 2.3 Summary strip — 5 cards (L227–253) → build 4, omit 1

| # | Card (verbatim label · big · sub) | Derivation (shipped) | Verdict |
|---|---|---|---|
| 1 | **Year progress** · `59%` · `13 of 22 sessions held · 9 to go · on schedule` | held = COUNT(`vlc_session`); total = COUNT(`vlc_value` active)×2 slots (=11×2=22) | **KEEP** (operational). `SumCard featured`. |
| 2 | **Avg attendance** · `91%` · `Form 2 93% · Form 3 88% (WASSCE pressure)` | AVG over `vlc_session_attendance` (present = enrolled−ABSENT); form split via `classFormNumber` | **KEEP** (operational). Default `SumCard`. |
| 3 | **Pastoral flags · year** · `12 raised` · `4 open · 1 escalated to Dean · 8 resolved` | COUNT(`vlc_pastoral_flag`): raised=all; open=`resolved_at IS NULL`; resolved=NOT NULL; **escalated = `severity='CRISIS'` AND open** (42b: escalate = bump to CRISIS) | **KEEP as counts — gate §1.3.** `SumCard terra` (new ground). Metadata only; NO student names. |
| 4 | **PG training attendance** · `92%` · `4 trainings held · next 19 May (Sat morning)` | (active PGs − `vlc_training_absence` rows)/active PGs; trainings = COUNT(`vlc_training`); next = MIN(future `scheduled_date`) | **KEEP** (operational). Default `SumCard`. |
| 5 | **Reflection submission** · `94%` · `Class avg · range 87%—99% · F3 GS A leads` | would need COUNT(`vlc_pastoral_journal`) per student/session | **🔴 OMIT (§Ω).** Confidential journal data the module refuses to roll up (editorial §02) **and** implies a student-submission flow that does not exist (43a owner override — the FM records reflections, there is no "submission"). `F3 GS A leads` is a leaderboard the editorial explicitly forbids. |

Net: a **4-card strip** (drop card 5). If a 5th operational card is wanted for symmetry, use a safe aggregate
(e.g. `Sessions this week` / `Classes on schedule` from `vlc_session`) — never a journal-derived one.

### 2.4 Filter bar (L258–272)
Label `FILTERS`; chips `All forms · Form 1 · Form 2 · Form 3 · · · Has flags · Behind schedule · Ahead of
schedule · PG vacancy`; search `Search class or Form Master...`.
- All chips filter the matrix on **class-level aggregates** — form level, has-flags (per-class COUNT>0),
  schedule variance (held vs expected), PG vacancy (derived <2 active). **KEEP** (metadata filters, no student
  identity). `Has flags` gates with the flags column (§1.3). Search over class name / FM name. **KEEP.**

### 2.5 Class matrix (L275–455) — the per-class rollup · **drop the Submission column, gate the Flags column**
Head (verbatim): `Per-class status · 18 classes` / `Class-by-class · position in curriculum, attendance, flags` /
`Sorted by form, then by curriculum position · 1 row per class`. Surface columns:
`Class · Curriculum position · Attendance · Submission · Flags · Form Master / PGs · Action`.

| Column | Cell content (verbatim examples) | Derivation (shipped) | Verdict |
|---|---|---|---|
| **Class** | `Form 1 GS` · `General Science · 42 students`; a `PG vacancy` sub-tag in terra | `classes.name` + level + COUNT(students); vacancy derived | **KEEP.** Non-confidential. |
| **Curriculum position** | `07A Patriotism · session A done`; bar `13 / 22 sessions · on schedule`; `LIVE NOW`, `1 ahead`, `1 behind` variants | latest `vlc_session` → `vlc_session_template`→`vlc_value` ordinal/slot; held count vs expected | **KEEP** (operational). |
| **Attendance** | `94%` · `+1 vs avg` / `−9 vs avg` | per-class AVG over `vlc_session_attendance` | **KEEP.** |
| **Submission** | `96%` · `strong` | COUNT(`vlc_pastoral_journal`) per class | **🔴 OMIT (§Ω)** — same journal/no-submission reason as strip card 5. Drop the column. |
| **Flags** | badge `— 0` / `1 open` / `1 today` / `2 open` (zero/one/multi tints) | per-class COUNT(`vlc_pastoral_flag` WHERE open) | **KEEP as a per-class COUNT — gate §1.3.** The task greenlights a "class count"; this is the safe form. **NO student name, NO `context`, NO ✓-per-student.** Dean always; HM per Kofi. |
| **Form Master / PGs** | `Mrs Y. Akoto` · `EA + NB · both trained 100%` / `KO + vote pending` | `classes.class_teacher_user_id`→`users.fullName`; `vlc_peer_guide` initials + training-derived % | **KEEP.** Non-confidential (a Form Master name + PG initials are roster data, not pastoral status). |
| **Action** | `VIEW CLASS →` / `VIEW SESSION →` / `VOTE 23 MAY →` / `FM CONVO →` | links to the class register / peer-guides | **KEEP** as operational links to shipped surfaces. **`FM CONVO →` must NOT deep-link a confidential case** — link to the class register (the gated flag callout lives there for the Dean/own-FM), not a school-wide case view. |

Row tints: `.flagged` (whole-class terra) / `.exemplar` (green) / `.f1` — **class-level** signals, no per-student
leak. **KEEP** (gate the `.flagged` tint with the Flags column). Footer `9 more classes · 2 Form 2 + 7 Form 3 ·
click to expand · sort by attendance, flags, or curriculum position` — **KEEP** (pagination/sort).

> **🔴 Rendering invariant (the whole increment's proof):** the matrix carries **counts, never names**. The
> surface, correctly, puts no student name in any matrix cell. **Do not add a per-student flag dot/tooltip** — a
> class-count is safe, a named/identifiable per-student flag on a school-wide grid is the leak this map exists to
> prevent (the 42b "grid must NOT gain a per-student flag dot" ruling, one surface up).

### 2.6 🔴 Pastoral-flag drilldown (L458–537) — the named cards + narratives are the CRUX OMIT
Block head: `Active pastoral flags · 4 open across the school` / `Where the <em>pastoral attention is
concentrating</em>` / actions `View resolved (8)` · `Open case file`. Then **4 `.flag-card`s**, each naming a
student and carrying a full welfare narrative:
- `Form 2 GA A · J. Manu · V7B Patriotism` — bereavement, tearful walk-out, "father d. Feb 2026".
- `Form 3 GA · A. Quartey · V6A Compassion` — **home-violence disclosure**, social-services referral.
- `Form 1 SC · K. Boateng · V5B Perseverance` — withdrawal, "father lost job".
- `Form 2 BUS · R. Adjei · V6A Compassion` — "persistent feeling of being unseen".

Then a **pattern block** (L534): `Pattern across 4 open flags: 2 in Compassion (V6), 1 in Patriotism (V7), 1 in
Perseverance (V5) · interpersonal-term values are surfacing more pastoral concerns…`

**Verdict — split hard:**
- **The 4 named narrative cards → OMIT (§Ω, the single most important one).** They are (a) **per-student flag
  identity** on an aggregate surface (leak), and (b) **`vlc_pastoral_note`/`vlc_pastoral_case` CONTENT** (43a
  confidential casework, FM+Dean own-class only, ≤4000-char narratives) — exactly the "NO journal/note/case body
  text" fence. The 42b flag table stores only a SHORT ≤280 `context` locator, not this bereavement/home-violence
  prose; the prose lives in the casework tables the dashboard must never read. **Even the Dean does not get a
  school-wide named narrative list here** — the Dean reaches a specific case the shipped way: open the class
  register → the gated flag callout → `Open journal` → `/senior/vlc/journal/[studentId]`. The dashboard points at
  concentration, not people.
- **The pattern block → KEEP as an AGGREGATE.** `2 in Compassion, 1 in Patriotism, 1 in Perseverance` is a
  GROUP-BY `value` × COUNT over open flags — metadata, no identity, no content. It **replaces** the named cards
  as the honest "where is the attention concentrating" answer. Gate with the flags data (§1.3). The editorial
  gloss ("interpersonal-term values surface more concerns") is a derived reading, safe to keep.
- **`View resolved (8)`** — a resolved-flag COUNT is safe; a resolved-flag *list* re-opens the named-list leak →
  render the **count**, not a named history. **`Open case file`** button → **OMIT** (§Ω, pastoral-stub).

> **The defensible middle (Kofi/owner call, drift log):** IF leadership wants an actionable Dean worklist, the
> honest form is a **Dean-only** active-flag list of **flag METADATA only** — short-name + class + value +
> severity + raised-date + a link to the **gated** `/senior/vlc/journal/[studentId]` — **no narrative body**. That
> is the "cross-class flag roll-up → INCR-44" the 42b/43a maps forecast, and it is flag metadata (not journal
> content). But it is still per-student pastoral identity, so it is **Dean-only, never HM**, and it is a scoped
> follow-on, not the default INCR-44 build. **Default INCR-44 = aggregates + pattern block; the named worklist is
> opt-in behind the Dean gate.**

### 2.7 Curriculum coverage card (L540–608) — the 11-value school-wide grid
Navy card. Head `Curriculum coverage · school-wide` / `All 18 classes <em>at the same value</em> · ±1 session` /
`RATE = % of classes that completed the value`. Grid of 11 values (verbatim): `01 Respect 100% · 02 Integrity
100% · 03 Responsibility 100% · 04 Discipline 100% · 05 Perseverance 100% · 06 Compassion 100% · 07 Patriotism
94% (current) · 08 Tolerance — · 09 Service — · 10 Excellence — · 11 Wisdom —`. States: `done` / `current` /
`upcoming`. Foot narrative: `18 of 18 classes completed Values 1—6 … 17 of 18 have completed Value 7A; Form 3 GA
is the one class behind…`.
- **Derivation:** for each `vlc_value` ordinal, RATE = COUNT(DISTINCT class with a `vlc_session` for that value's
  slot) / COUNT(classes). Value names/ordinals/Twi from `vlc_value`. **KEEP** (operational aggregate).
- The foot naming **`Form 3 GA` (a class, not a student)** is class-level → safe operationally. **KEEP** as a
  derived reading. (No student is named; a lagging *class* is operational, not pastoral.)
- No-alpha: rebuild the navy cells/foot per §0 (this card is the worst alpha offender).

### 2.8 Editorial §02 + the `.notes` asides — the design contract (build the contract, not the section)
§02 (`A pastoral programme needs management, not measurement`) is an editorial explainer — **not a build target**,
but it **is the spec** for the omit-not-fake rules. Load-bearing commitments to preserve (they are why the OMITs
are OMITs):
- **No rankings / no leaderboards / no "best class for VLC"** — kills strip card 5's `F3 GS A leads`.
- **No staff comparisons** — "sessions held is a hygiene metric, not a performance one"; the matrix is not an FM
  scoreboard.
- **"This dashboard does not surface journal content. Not to the Headmaster, not even to the Dean in summary
  form."** — the direct authority for §2.6's OMIT and §Ω.
- The `.notes` aside "What this surface deliberately doesn't show": **No journal content · No student rankings ·
  No staff comparisons** — transcribe as the acceptance fence.

---

## 3. The student-list / leaver-roster question (point 2 — the 43b follow-on)
**This surface has no leaver roster and no link to `/senior/vlc/reference/[studentId]`.** Its only student list is
the **flag drilldown (§2.6)**, which is a *flag-status* list with narratives → **omitted**. The matrix Action
links (`VIEW CLASS →`, `VIEW SESSION →`) go to **class** surfaces, not per-student reference/journal pages. So:
- **On the dashboard:** no student roster. The safe roster the task describes (names/class only, **NO flag-status
  column**, per-student links gated) is a **different surface** — the HM/Dean entry to the character reference
  that the 43b map (`vlc-character-paragraph-surface-map.md` §4/§7.4) recommended lives on the **student
  record / F0 roster**, not here. INCR-44 does **not** host it.
- **If a discoverable reference roster is built** (a genuine 43b follow-on, separate from this surface): columns
  = **name · class/form only** (non-confidential); **NO flags column, NO case column, NO pastoral status**;
  per-student links keep their **own** gates — `→ Character reference` to `/senior/vlc/reference/[studentId]`
  (own-class FM + Dean + **HM**, via `VLC_PARAGRAPH_READ_ROLES`, finalised-only for HM), and `→ Journal` to
  `/senior/vlc/journal/[studentId]` (own-class FM + Dean only). A flag-status column on such a roster would be the
  leak — omit it. **Recommend keeping that roster out of INCR-44** (metadata-only, no per-student pages); note it
  as the reference-discovery follow-on for a later increment.

---

## Ω. Omit-not-fake — the explicit list (render ABSENT; no placeholder, no disabled control, no "coming soon")

1. **The 4 named pastoral-flag cards + their narratives** (§2.6, surface L472–530) — per-student identity **and**
   `vlc_pastoral_note`/`case` CONTENT on an aggregate surface. **The single most important omit.** Keep the
   GROUP-BY pattern block (metadata) instead; a specific case is reached via the shipped gated drill-in, never a
   school-wide named list. Even for the Dean, no narrative rolls up (editorial §02: "not even to the Dean in
   summary form").
2. **`Reflection submission 94%`** — strip card 5 (§2.3) **and** the matrix `Submission` column (§2.5). Derives
   from confidential `vlc_pastoral_journal`; the module refuses to aggregate reflections (editorial §02); and it
   implies a student-submission flow that does not exist (43a owner override — FM records, no submission). Drop
   both. `F3 GS A leads` is a forbidden leaderboard besides.
3. **`Open pastoral case file`** (head-row, gold) **and `Open case file`** (flag block) — a case-file button on a
   school-wide page implies a reachable case-file system with no student selected (the `pastoral-stub`
   anti-pattern). Omit both; the case file is a per-student gated drill-in.
4. **`View resolved (8)` as a named list** — render the **count** only; a resolved-flag roster re-opens the
   named-list leak.
5. **Any flag NARRATIVE, `context` locator, severity-per-student, or ✓-per-student in the matrix or anywhere
   school-wide** — only COUNTS and GROUP-BY-value/severity aggregates leave the flag table onto this surface.
6. **`Export term report` carrying flag/journal content** — the export is metadata-only (counts, %, coverage); a
   per-student flag/case/journal export is out of INCR-44 scope.

**NOT omitted (guard against over-scrubbing — these ARE INCR-44):** the operational aggregates (sessions,
attendance, curriculum coverage, PG training, PG vacancy); the class matrix (minus Submission, with the Flags
**count** column gated); the flag **counts** (strip card 3, lede clause) + the **pattern block** (GROUP-BY); the
filter bar; the curriculum-coverage grid; the "rhythm-check, not a ranking" framing.

---

## 4. Read-only confirmation + interaction states

**Read-only: confirmed.** Every kept region is a projection; there is no create/edit/delete/save anywhere. The
surface's only buttons are `Export term report` (a read/export) and `Open pastoral case file` (omitted). No form,
no input except the client-side matrix filter/search. The dashboard **writes nothing** — it has no server action.

| Region | States | Behaviour |
|---|---|---|
| **Page (operational body)** | gated / non-gated / BASIC | `VLC_CONFIG_READ_ROLES` → full operational rollup; else the layout redirect; BASIC → `/dashboard`. |
| **Flag aggregates** (strip card 3, matrix Flags col, pattern block) | present (gated) / absent | rendered **only** past the §1.3 flag decision (separate read); a viewer who fails it gets a page **identical to zero-flags** — no "restricted" card, no layout gap. |
| **Summary strip** | populated / empty | fresh school (no sessions) → cards read `—` / `0%` honestly, never a fabricated figure. |
| **Class matrix** | populated / empty / filtered | 0 classes → `EmptyState` "No SHS classes yet"; filter/search re-filters client-side; `9 more classes` expander. |
| **Curriculum coverage** | populated / pre-launch | no values seeded (F0 not configured) → coalesce to the "not configured" empty state (the setup-data idiom), never fake 11 values. `done/current/upcoming` derive from held counts. |
| **Responsive / PWA** | desktop-primary | the surface is a `.desktop` mock (a Head at a desk). The 5→4 card strip stacks (grid→2→1); the 7-col matrix needs a horizontal-scroll / card-collapse at mobile (the `ColumnScoreGrid` overflow idiom); the 11-cell coverage grid wraps. No PWA-specific variant drawn. |

---

## 5. Component / build mapping (reuse-first — no new component family)

| Surface region | Reuse | New for INCR-44 |
|---|---|---|
| head-row hero + crumb | `sessions/page.tsx` hero idiom + `SectionHead` | copy swap |
| summary strip | `chrome.tsx::SumCard` (`featured` + default) | **add a `terra` ground to `SumCard`** (solid `border-terra bg-terra-bg text-terra`); render 4 cards |
| filter bar | the peer-guides chip-row idiom | client filter over pre-shaped rows |
| class matrix | the `sessions/page.tsx` table + `ColumnScoreGrid` sticky/overflow mechanics | a 6-col rollup table (Submission dropped); the Flags **count** cell gated |
| flag aggregates (count + pattern) | `pastoral-data.ts::getPastoralFlags` gate pattern (separate read, never into non-gated props) | `getVlcDashboardFlagCounts(schoolId, caller)` — COUNTs + GROUP-BY only, **no body/context projection** |
| operational rollup read | `session-data.ts::getVlcSessionsLanding` (`server-only`, `withSchool`, derived counts) | `getVlcDashboard(schoolId)` — school-wide session/attendance/PG/coverage aggregates |
| curriculum coverage | — | navy grid card, no-alpha per §0 |
| nav | `vlc-tabs.tsx` + `sidebar.tsx` | +1 `Dashboard` tab; repoint the "Student support" href |
| gate | `lib/access.ts` groups + `hasAnyRole` | **`VLC_DASHBOARD_FLAG_ROLES`** (Dean ±HM — Kofi §1.3), disjoint from `VLC_PASTORAL_READ_ROLES` |
| empty states | `components/ui/empty-state.tsx` | reuse |

---

## 6. Cross-module hooks (design commitments — preserve)

- **Flag COUNT ↔ INCR-45 stub retirement.** The dashboard's open-flag count reads `vlc_pastoral_flag` WHERE
  `resolved_at IS NULL` — the **same existence check** `isPastorallyFlagged` will use when INCR-45 retires
  `lib/boarding/pastoral-stub.ts`. Both answer "is/are there open flags?" from metadata, never confidential
  content — preserving the INCR-30 non-disclosure. Keep the count derivation existence-only (no content read).
- **Attendance ↔ the 5-status enum ("M").** The dashboard attendance % reads `vlc_session_attendance`, which
  reuses the canonical 5-status `attendanceStatusEnum` (P/L/E/M/A). The Medical seam / future sickbay hook stays
  intact (M is storable); the dashboard just aggregates present-vs-absent, not a per-status breakdown.
- **Curriculum coverage ↔ the F0 value/template spine.** The coverage grid is the school-wide read of the
  INCR-40 `vlc_value` (11 values, ordinals, term groups) + `vlc_session_template` slots — the config spine's
  operational payoff.
- **PG training ↔ the INCR-41 roster.** Trained-PG count + training attendance reuse `vlc_peer_guide` /
  `vlc_training` / `vlc_training_absence`; vacancy is the same derived "<2 active per class×period" the peer-guides
  surface defines. No new person model.
- **The dashboard is the terminus of the "Dean cross-class flag roll-up" the 42b/43a/43b maps deferred** — but it
  terminates it as **aggregates + a gated drill-in**, not a named list. Preserve the pointer-not-document
  relationship: the flag is a pointer (42b), the journal is the document (43a), the dashboard is the *census* of
  pointers — never the documents.

---

## Open questions / drift log

1. **🔴 The flag-aggregate gate (Kofi, §1.3).** Owner-locked today: HM excluded from all flag data
   (`VLC_PASTORAL_READ_ROLES` = FM+Dean). The dashboard is titled "Headmaster & Dean view" and shows flag
   **counts** (no identity, no content). **Recommend:** Dean sees all flag aggregates; HM sees the bare
   school-wide count only (or nothing, strict reading); ADMIN metadata-only per the task's "(+ maybe Admin for
   metadata)". Resolve into a new `VLC_DASHBOARD_FLAG_ROLES`, disjoint from the per-student content gate. **Blocks
   build of §2.3-card-3 / §2.5-Flags-col / §2.6-pattern visibility.**
2. **Named Dean worklist — build it or not?** §2.6's defensible middle (Dean-only flag **metadata** list, no
   narrative, linking to the gated journal) is the forecast "INCR-44 cross-class roll-up". **Recommend: NOT in the
   default INCR-44** (aggregates + pattern block suffice); ship it opt-in later if the Dean needs an actionable
   list. Confirm.
3. **Dashboard audience — leadership-only, or every FM?** `VLC_CONFIG_READ_ROLES` includes `FORM_MASTER`, so a
   plain FM reaches the school-wide operational rollup. Not a leak (operational data is school-wide-readable), but
   an FM's world is their class. Confirm whether to narrow the *dashboard* to leadership (Dean/HM/ADMIN) while FMs
   keep the per-class surfaces.
4. **`Export term report` scope.** Confirm the export is metadata-only (counts, attendance %, coverage) and
   carries **no** flag narrative / journal / per-student content.
5. **Reflection-submission omit.** Confirm strip card 5 + the matrix Submission column are dropped (confidential
   journal + no-submission-flow + forbidden-leaderboard). No safe substitute needed unless the owner wants a 5th
   operational card.
6. **Route + nav.** Confirm `/senior/vlc/dashboard` under `VlcLayout`, a `Dashboard` tab first in `VlcTabs`, and
   repointing the "Student support" sidebar item to the dashboard (the discoverable HM/Dean landing). The
   alternative (keep sidebar → `/setup`, add only the tab) is smaller but leaves leadership landing on config.

---

*Map produced against: `Surfaces/schoolup-vlc-school-dashboard.html` (§01 L201–630, §02 L632–662, notes
L613–628/L651–660); the SHIPPED VLC schema `db/schema/vlc.ts` (INCR-40→43b, esp. `vlc_session*`,
`vlc_session_attendance`, `vlc_peer_guide`, `vlc_training*`, `vlc_pastoral_flag`, and the confidential
`vlc_pastoral_*` casework tables it must NOT read); the access gates `lib/access.ts`
(`VLC_CONFIG_READ_ROLES`, `VLC_PASTORAL_READ_ROLES`, `VLC_PARAGRAPH_READ_ROLES`); the reader idioms
`lib/vlc/session-data.ts::getVlcSessionsLanding` + `lib/vlc/pastoral-data.ts::getPastoralFlags`; the chrome
`components/vlc/chrome.tsx` (`SumCard`/`SectionHead`), nav `components/vlc/vlc-tabs.tsx` +
`components/app/sidebar.tsx`, and the operational-rollup precedent `app/(app)/senior/vlc/sessions/page.tsx`; and
the parent maps `docs/senior/vlc-{pastoral-flag,student-journal,character-paragraph}-surface-map.md` (each of which
forecast this INCR-44 roll-up). Companion + terminus of the VLC surface set (05 of 05) — the census of pointers,
never the documents.*
