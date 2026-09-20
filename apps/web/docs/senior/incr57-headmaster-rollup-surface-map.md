# INCR-57 — Headmaster §6.4 whole-school academic roll-up + full filter bar — Surface Map

**Author:** Lucy (design cartographer) · **Status:** design spec, ready for the implementation engineer.
**Scope:** the Headmaster's subject-level readiness roll-up (spec §6.4) **plus** the full filter bar
deferred from the Vice-Headmaster progress view (spec §6.1), both added to the **existing**
`/senior/academic-progress` page. This is not a redesign — it EXTENDS the built VHM surface's grammar
(hero, §6.2 discipline banner, period tabs, completion table, at-risk flags). Where the surface and the
spec disagree, **spec wins on logic, surface wins on visual presentation**; each drift is flagged inline
and collected in the drift log.

## Source surfaces & code (verified first-hand)

| Source | Role in this map |
|---|---|
| `Surfaces/schoolup-shs-vice-headmaster-progress.html` **§3** ("The Headmaster's cascade · same data, one level up", lines 753–871) | **PRIMARY visual source.** The roll-up EXISTS in this file as Section 3. The three-bucket `.rollup-grid`, the escalation card, and the provenance footer are all specified here. Its CSS (`.rollup-grid`/`.rollup-card`/`.rc-label`/`.rc-num`/`.rc-suffix`/`.subject-list`, lines 391–404) is the token source. |
| `app/(app)/senior/academic-progress/page.tsx` (senior-live) | **The grammar to EXTEND.** Server component, `dynamic="force-dynamic"`, gated on `SENIOR_MANAGEMENT_ROLES` (already admits HEADMASTER). Owns hero (§1.2), period tabs, §6.2 navy discipline banner, `VhmProgressTable`, at-risk flags. The roll-up + filter bar slot into this file. |
| `components/senior/vhm-progress-table.tsx` | The per-teacher table the roll-up sits above and drills into. Path-pill + cat-dot + STPSHS-tier vocabulary the roll-up must stay consistent with. |
| `lib/score-ledger/vhm-progress.ts` | `loadVhmProgress()` → `VhmProgressRow[]` (the data the roll-up aggregates) and the `computeVhmTier()` pure-function precedent to copy for `computeSubjectRollup()`. |
| `Surfaces/schoolup-oversight-academic-performance.html` | **Reference only — do NOT replicate** (Phase-5 cross-tenant Oversight tier). Its subject×completion aggregation grammar informs nothing structural here; the in-school roll-up is simpler (three buckets, one school). Ignored except as confirmation that "subjects with all teachers complete" is the right unit. |
| `md files/SHS_SCORE_LEDGER_SPEC.md` §6.1 (filter dimensions), §6.4 (the cascade, line 276) | Logic source of truth. |

---

## 0. Two decisions the brief asked me to make explicit

### 0.1 New mode/tab, or separate surface? → **A section on the existing page. Not a new route.**

The mockup renders Section 3 with its own browser chrome and a `…/senior/headmaster-summary/…` URL and a
Headmaster-specific sidebar. **That is design-doc framing, not a build instruction.** Build it as a
**roll-up section added ABOVE the existing per-teacher table on `/senior/academic-progress`**, for these
reasons:

- The built page **already role-gates the Headmaster in** (`SENIOR_MANAGEMENT_ROLES` = PROPRIETOR / ADMIN /
  HEADMASTER / VICE_HEADMASTER_ACADEMIC, verified in `lib/access.ts`). The HM already lands here.
- The spec is emphatic that the cascade is **"genuinely the Vice Headmaster's data rolled up, not a separate
  calculation"** and that drill-down **"lands in the Vice Headmaster's view — same data, deeper granularity.
  No data lives in only one of the two surfaces."** One page, one `loadVhmProgress()` call, one source of
  truth honours that; a second route re-loading the same data invites divergence.
- The brief itself says: *"the Headmaster's aggregated view **above** the existing Vice-Headmaster progress
  dashboard."* Above = same scroll, same page.

**Therefore:** no new `page.tsx`, no new route, no second data load. Order on the page becomes:
hero → period tabs → §6.2 discipline banner → **[NEW] filter bar → [NEW] roll-up section** → completion table
→ at-risk flags. The mockup's "Open full progress view" button becomes an **in-page anchor to the table
below** (drill-down affordance, §5). The Headmaster-specific sidebar/crumb/hero copy in the mockup is
reference for tone only — the shared hero stays.

> Optional role-conditional refinement (not required): if a school wants the HM to see *only* the roll-up by
> default, add a `?view=rollup|full` param that collapses the table behind the drill-down link. Default and
> recommended: table always visible below the roll-up (the brief says "above the dashboard", i.e. both shown).

### 0.2 What is aggregated, and do teacher names appear? → **Counts only. Names only on the exception path.**

- **Aggregated = readiness COUNTS, never scores.** The roll-up carries the same §6.2 discipline as the table:
  it counts subjects/teaching-assignments by tier (ready / partial / at-risk). No score value, no weighted
  total, nothing from any gradebook cell ever appears. `VhmProgressRow` already contains only completion
  counts (`filled.*`, `categoriesDone`, `status`) — the roll-up reduces those, so the discipline is
  structurally preserved (there is no score field to leak).
- **Per-teacher names do NOT appear on the "fully ready" or "partially ready" cards** — those show subject
  names + `X of N` counts only, matching "the Headmaster doesn't need per-teacher detail" (§6.4).
- **Names appear ONLY on the exception/at-risk path:** the at-risk subject-list line and the escalation card
  name the specific blocking teacher (mockup: *"Government (Form 3 Arts) — Mr. B. Akoto's two classes
  flagged; 19 days inactive"*). This is the "unless something is going wrong" clause made literal. Flag this
  to the implementer as a deliberate asymmetry, not an omission.

---

## 1. Token & type reference (roll-up-specific additions)

All base tokens/type map exactly as in `ledger-surface-map.md §0` (use the Tailwind token class, never inline
`var(--x)`; `font-display`=Fraunces, `font-body`=Manrope, `font-mono`=JetBrains Mono; empty = em-dash `—`).
The roll-up introduces these surface classes (from the HTML `<style>`, lines 391–404) — each maps to token
Tailwind classes:

| Surface class | Surface CSS | Tailwind token build |
|---|---|---|
| `.rollup-grid` | `grid; grid-template-columns:repeat(3,1fr); gap:14px` | `grid grid-cols-1 gap-3.5 sm:grid-cols-3` (responsive, see §6) |
| `.rollup-card` | `bg:surface; border:1px border; radius:11px; padding:18px 20px` | `rounded-[11px] border border-border bg-surface px-5 py-[18px]` |
| `.rollup-card.complete` | `border-color:green` | `border-green` |
| `.rollup-card.partial` | `border-color:gold` | `border-gold` |
| `.rollup-card.behind` | `border-color:terra` | `border-terra` |
| `.rc-label` | `10px; tracking:.1em; uppercase; bold; navy-3` | `text-[10px] font-bold uppercase tracking-[0.1em] text-navy-3` |
| `.rc-num` | `font-display; 36px; 600; navy; line-height:1` | `font-display text-[36px] font-semibold leading-none text-navy` |
| `.rc-num em` (complete) | italic `green` | `italic text-green` |
| `.rc-num em` (partial) | italic `gold` (default) | `italic text-gold` |
| `.rc-num em` (behind) | italic `terra` | `italic text-terra` |
| `.rc-suffix` | `12px; navy-3; 500; margin-top:6px` | `mt-1.5 text-xs font-medium text-navy-3` |
| `.subject-list` | `10.5px; navy-2; pt:12px; mt:12px; border-top; line-height:1.55` | `mt-3 border-t border-border pt-3 text-[10.5px] leading-relaxed text-navy-2` |
| `.subject-list b` | `navy; 700` | `font-bold text-navy` |
| section eyebrow (line 809) | `11px; tracking:.08em; uppercase; 700; navy-3` | `text-[11px] font-bold uppercase tracking-[0.08em] text-navy-3` |
| escalation card (line 842) | gold gradient, `border:1.5px gold`, radius 12, 3-col grid | see §3 (reuse the §6.3 gold-flag pattern already in `page.tsx` lines 164–180) |
| `.provenance` (line 240) | `flex; gap:18px; bg:bg; border; radius:10px; 10.5px navy-3` | `mt-5 flex flex-wrap gap-[18px] rounded-[10px] border border-border bg-bg px-[18px] py-3.5 text-[10.5px] text-navy-3` |

> **Token-opacity trap (memory `no-alpha-token-opacity`):** the escalation card and provenance strip use
> solid tint tokens (`bg-gold-bg`, `bg-bg`) — **do not** reach for `bg-navy/80` / `text-bg/70` slash-opacity
> on these raw-hex tokens. Verify the gold-gradient escalation card in the live preview, not the build.
> Where the surface uses a `linear-gradient(135deg, gold-bg, surface 70%)` fill, either an arbitrary Tailwind
> `bg-[linear-gradient(...)]` value with token hexes or a flat `bg-gold-bg` is acceptable; flag for preview.

---

## 2. The filter bar (spec §6.1 — the deferred filter, NEW for INCR-57)

Spec §6.1: *"The view supports filtering by teacher, subject, form, programme, and submission status."* The
built VHM page never rendered this (the surface's §1 page-head `Filter` ghost button is decorative). INCR-57
delivers it as a **persistent horizontal filter bar** that governs **both** the roll-up **and** the table
below it (one filter state, two consumers). The brief scopes it to four dimensions: **subject · form-year ·
programme · status** (teacher-name filtering folds into the table's existing sort; defer it — see drift #4).

### 2.1 Placement & mechanics
- Sits **directly below the §6.2 discipline banner, above the roll-up section**. Full width.
- **URL-param driven, server-filtered** — the exact `?periodId` precedent already in `page.tsx` (and the
  Basic `GradebookSelectors` pattern). Add `?subject=&form=&programme=&status=` to the page's `searchParams`.
  The page filters the already-loaded `rows: VhmProgressRow[]` array in-memory (N≈23; no new query needed —
  **lazy and correct**: `rows.filter(...)` before both the roll-up reduce and the table render).
- No client state / no `"use client"` needed if built as `<Link>` chips (like the period tabs). If native
  `<select>`s are preferred, a thin client wrapper pushing `URLSearchParams` mirrors `GradebookSelectors`.

### 2.2 The four filter groups (exhaustive)
Reuse the surface `.table-toolbar` + `.chip` vocabulary (defined in the HTML `<style>`, lines 208–213):
toolbar `flex items-center gap-2.5 flex-wrap`, label `text-[10px] font-bold uppercase tracking-[0.13em]
text-navy-3`, chip `rounded-full border border-border-2 bg-surface px-[11px] py-[5px] text-[11px]
font-semibold text-navy-2`, active chip `bg-navy text-bg border-navy`.

| Filter | Options source | Notes |
|---|---|---|
| **Subject** | distinct `rows[].subjectName` (`subjectId` as value) | e.g. Mathematics · English · Chemistry … |
| **Form / year** | `classes.level` (SHS "Form 2") — see §2.3 data note | e.g. Form 1 · Form 2 · Form 3. Spec §6.4 calls these "Year 1" etc.; use the school's `level` text verbatim. |
| **Programme** | `classes.programme` enum (GENERAL_ARTS / SCIENCE / BUSINESS / AGRIC / …) | Structured column, already exists. Label from the programme display map. |
| **Status** | the three tiers already on the row: `ready` / `behind` / `at_risk` | Chip colours reuse the STPSHS-tier palette: ready `bg-green-bg text-green`, behind `bg-gold-bg text-gold`, at-risk `bg-terra-bg text-terra`. |

- Each group defaults to **"All"** (an unset param = no filter). Multiple groups AND together.
- A **`Clear filters`** affordance appears (right-aligned, `.chip.compare`-style or a plain gold text link)
  **only when ≥1 filter is active**; clears all params back to the base route (+ `periodId`).
- The active filter count feeds the empty state copy (§4).

### 2.3 Data dependency (the one real prerequisite — flag to implementer)
`VhmProgressRow` currently carries only `className` (a free-text string like "Form 3 Arts A"). The **form**
and **programme** filters need structured values. **Do not parse the class-name string.** Extend
`loadVhmProgress()` to also project the two columns that already exist on `classes`:

- `classes.level` → new row field `classLevel: string | null` (the form/year source)
- `classes.programme` → new row field `classProgramme: <programmeEnum> | null`

The loader already `select`s `classes.id, classes.name` (lines 181–184); add `level` and `programme` to that
select and thread onto each row. **No schema change, no migration** — both columns are shipped. This is the
whole cost of the filter bar's structured dimensions. (Subject and status are already on the row.)

> **DRIFT #4 — teacher-name filter deferred.** Spec §6.1 lists "teacher" as a filter dimension. The brief
> scopes INCR-57 to subject/form/programme/status. Teacher-name filtering is redundant with the table's
> existing "most-behind-first" sort and the roll-up's per-subject teacher counts; defer it. Flag for PO.

---

## 3. The roll-up section (spec §6.4 — PRIMARY, from surface §3)

Order within the section: **section eyebrow → three-bucket `.rollup-grid` → escalation card → provenance
strip.** All copy below is verbatim from the surface unless marked `[dynamic]` (computed) or `[demo]`
(mockup sample data the build replaces with live values).

### 3.1 Section header
Two options, both faithful — pick one:
- **(a, recommended)** A `font-display` section title reusing the mockup's HM headline as the section h2:
  **"Where the school `<em class="italic text-gold">`stands.`</em>`"** (surface line 797), followed by the
  eyebrow line below. Keeps the shared page hero intact (§0.1) while giving the roll-up its own voice.
- **(b)** Eyebrow only (surface line 809, verbatim): **"Subject-level readiness · cascaded from per-teacher
  progress"** — `text-[11px] font-bold uppercase tracking-[0.08em] text-navy-3 mb-3`.

Either way, render the **STPSHS deadline line** here (see §3.4 urgency).

### 3.2 The three bucket cards (`.rollup-grid`, `grid-cols-3`)

Each card = a tier bucket over the **distinct subjects** in the (filtered) `rows`. Partition every subject
into exactly one bucket. Card anatomy: `.rc-label` (tier name) · `.rc-num` (count, big italic accent) ·
`.rc-suffix` (`X of N subjects · <criterion>`) · `.subject-list` (named subjects + per-subject teacher count).

| Card | `.rc-label` (verbatim) | accent | `.rc-suffix` pattern | `.subject-list` content |
|---|---|---|---|---|
| **complete** (`border-green`) | `Subjects fully ready` | `em` → `text-green` | `[dynamic] {n} of {total} subjects · all teachers complete` | subject names only, no counts, no teacher names. `[demo]` "**Physics** · Elective Maths · Geography" |
| **partial** (`border-gold`) | `Subjects partially ready` | `em` → `text-gold` | `[dynamic] {n} of {total} subjects · 1 or more teachers behind` | subject + per-subject `(X of N teachers complete)`. `[demo]` "**Mathematics** (4 of 6 teachers complete) · **English** (3 of 5) · **Chemistry** (1 of 2) · **Biology** (2 of 3) · **Integrated Science** (3 of 4)" |
| **behind / at-risk** (`border-terra`) | `Subjects at risk` | `em` → `text-terra` | `[dynamic] {n} of {total} subjects · zero teachers ready` | subject + **blocking teacher name(s)** + inactivity. `[demo]` "**Government** (Form 3 Arts) — Mr. B. Akoto's two classes flagged; 19 days inactive" |

**Bucketing logic — `computeSubjectRollup(rows)` (pure, co-locate in `vhm-progress.ts` beside
`computeVhmTier`, unit-test it the same way):**

Group `rows` by `subjectId`. For each subject, over its member rows:
- `readyCount` = rows where `status === "ready"`; `total` = member rows.
- **fully ready** ⇢ `readyCount === total` (every teaching-assignment ready)
- **at risk** ⇢ `readyCount === 0` (zero ready — surface "zero teachers ready")
- **partial** ⇢ otherwise (`0 < readyCount < total`)

The `.rc-num` is the count of subjects in the bucket; `.rc-suffix` denominator is the total distinct subjects
(3+5+1 = 9 in the demo). The partial card's `(X of N)` per subject = `readyCount of total` for that subject.

> **DRIFT #1 — "teachers" vs "class-subject combinations".** The counting unit is `VhmProgressRow` =
> **(class × subject) teaching assignment**, not distinct teacher. K. Owusu teaching Maths to two forms = two
> rows. The surface copy says "4 of 6 **teachers** complete"; the honest underlying count is over
> assignments. Recommend: **count assignments, keep the word "teachers" in HM-facing copy** (it matches the
> HM's mental model and the "23 class-subject combinations" framing already on the page). If PO wants a true
> distinct-teacher count (a teacher is "complete" only when ALL their assignments in that subject are ready),
> that's a `groupBy(teacherName)` inside the subject group — flag, don't assume. Default: per-assignment.

> **DRIFT #2 — subject vs subject×form/year granularity.** Spec §6.4 wants "English **Year 1** has 4 of 5
> teachers complete" (subject × form/year); the surface §3 cards group by **subject alone** across all forms,
> naming the form only in the single-class at-risk case ("Government (Form 3 Arts)"). Reconciliation: the
> **default roll-up groups by subject** (surface-faithful); applying the **form/year filter (§2)** narrows the
> `rows`, so the same cards then read as "subject × that form/year" without a second grouping mode. This
> satisfies §6.4 ("English Year 1") via the filter, and stays 1:1 with the surface when unfiltered. If PO
> wants the cards to split by subject×form even when unfiltered, the group key becomes `subjectId:classLevel`
> — a one-line change to `computeSubjectRollup`. Flag; default = group by subject.

### 3.3 Escalation card (surface lines 842–846 — the single most urgent action item)

Below the three cards, one gold-bordered 3-column card `[auto-derived from the most urgent at-risk row]`.
Reuse the **§6.3 gold at-risk flag pattern already in `page.tsx` (lines 164–180)** — same
`border-gold bg-gold-bg` + `!` icon + navy-2 body + right-aligned action button — do not invent a new card.

- **Icon:** `!` in `bg-gold text-navy` rounded square (font-display italic), 36px.
- **Body `[demo, partly un-backed — see drift #3]`:** *"The Vice Headmaster Academic has flagged Mr. B.
  Akoto's classes as the most urgent action item — 19 days inactive, no scores entered, two classes affected.
  Mrs. P. Anim has been in touch; Mr. Akoto cited illness, returning next week. Mrs. Anim is preparing to
  support score entry on Mr. Akoto's return. **You may want to confirm the support plan with her before the
  STPSHS window opens.**"*
- **Action button:** `Message Mrs. Anim` (`.btn.primary` = `bg-navy text-bg`). **The action targets the line
  manager (the VHA), NOT the teacher** — the surface note is explicit: "escalating past the line manager is
  the wrong move and the system reflects the hierarchy." Build it to message the VHA, not Mr. Akoto.
- **Selection rule (buildable half):** derive the escalation subject from the highest-severity at-risk row —
  the `at_risk` row with the largest `daysInactive` (nulls = never-touched = most stale, per the loader's
  existing staleness tiebreak). Name that teacher + its class count + inactivity. This half maps cleanly onto
  existing data (`teacherName`, `daysInactive`, the existing `flags[]`).

> **DRIFT #3 — the "who's handling it" narrative has no data source.** The sentences *"Mrs. Anim has been in
> touch; Mr. Akoto cited illness, returning next week… preparing to support score entry"* describe a **case
> status / follow-up note** the data model does not have (there is no case-note or acknowledgement field on
> the ledger/flag). **Do NOT fabricate it.** Honest build: render the blocker (teacher · classes · days
> inactive · the rule that fired) + the "confirm with [VHA]" prompt + "Message [VHA]" action, and OMIT the
> illness/returning narrative until a follow-up-note field exists. Flag for PO: this narrative is the natural
> home for a future "flag acknowledgement / case note" feature (a VHA leaves a one-line status the HM reads).

### 3.4 STPSHS-deadline urgency treatment

- **Deadline line** (in the section header, §3.1): `[dynamic]` "STPSHS Semester 2 window opens {date} · {n}
  days from now" — surface uses "14 July 2026 · 17 days from now". Reuse the mono/label vocabulary.
- **Tier escalation:** the at-risk (terra) bucket card is the loudest by border colour already. When the
  window is imminent (≤7 days, the §6.3 high-severity threshold), the partial card's copy hardens ("1 or more
  teachers behind **with {n} days to the window**") and the escalation card is forced visible. Below the
  threshold, urgency is calmer.
- **Note on current status semantics:** `computeVhmTier` derives ready/behind/at-risk from **completion
  counts, not the calendar** — which is honest and works today. The countdown is additive polish.

> **DRIFT #5 — STPSHS window date is not yet a stored field.** The "14 July 2026 · 17 days" is mockup copy;
> there is no `stpshs_window_opens_at` on `academic_period` (same gap flagged in `ledger-surface-map.md §3.7`
> for the STPSHS-ready card). Until a per-`(school × period)` window date exists, **omit the countdown** and
> show the completion-based tiers only (which need no date). Recommend adding the field so both this roll-up
> and the ledger's STPSHS-ready card compute "N days from now" from one source. Flag for PO.

### 3.5 Provenance strip (surface lines 848–852, verbatim)
`.provenance` flex strip, three items (`text-[10.5px] text-navy-3`, `b` in navy-2):
- **Source data** · per-teacher ledger progress, same as Vice Headmaster view
- **Aggregation** · grouped by subject across all classes
- **Refresh** · live as teachers enter

This is the map's honesty affordance — it states out loud that the roll-up is the table's data reduced, not a
separate figure (reinforcing §0.1 / §0.2). Keep it verbatim.

---

## 4. Interaction states (every state, per region)

| Region | State | Visual / copy |
|---|---|---|
| Filter chip | inactive / active | `border-border-2 bg-surface text-navy-2` / `bg-navy text-bg border-navy` |
| Status filter chip | ready / behind / at-risk | `bg-green-bg text-green` / `bg-gold-bg text-gold` / `bg-terra-bg text-terra` |
| Clear-filters | hidden / shown | shown only when ≥1 filter active |
| Roll-up card | complete / partial / at-risk | `border-green` / `border-gold` / `border-terra`, accent `em` colour matches |
| At-risk bucket | **empty (GOOD)** | when 0 subjects at risk: `.rc-num` reads `0`, `.subject-list` → positive empty copy **"Every subject on track for STPSHS."** (don't render a blank terra card as if broken) |
| Partial bucket | empty | `.rc-num` `0`, subject-list → "No subjects partially behind." |
| Escalation card | present / absent | absent when no at-risk row exists (mirrors the existing "No flags" state in `page.tsx` lines 136–141) |
| Roll-up section | **loading** | page is `dynamic="force-dynamic"` SSR — no client skeleton; first paint is populated (same as the current table). No spinner needed. |
| Roll-up section | **empty — no assignments** | when `rows.length === 0`: render a single dashed card matching `VhmProgressTable`'s empty state — **"No subjects to roll up yet. Set up teaching assignments in Classes & subjects."** (`rounded-xl border border-dashed border-border-2 bg-surface p-12 text-center text-sm text-navy-3`) |
| Roll-up + table | **empty — filters exclude everything** | when `rows.length > 0` but filtered set is empty: **"No subjects match these filters."** + a `Clear filters` link. Distinct copy from the no-assignments state (honest: data exists, filter hid it) |
| Roll-up | **error** | server component — a load failure throws to the route error boundary (existing behaviour). No inline error card. |
| Drill-down chip / "Open full progress view" | default / hover | in-page anchor (§5); `text-gold font-semibold hover:underline` |

---

## 5. Drill-down affordance (to per-teacher detail)

Spec §6.4: the HM "doesn't need per-teacher detail unless something's wrong" but must be able to reach it.
Since the table lives on the same page (§0.1):

- **"Open full progress view →"** (surface line 801, a `.btn.ghost` in the mockup page-head) becomes an
  **in-page anchor to the completion table `<section>`** (`href="#per-teacher"`, smooth scroll). It is the
  literal "same data, deeper granularity" drill.
- **Per-subject drill (recommended enhancement):** make each subject name in the partial/at-risk
  `.subject-list` a link that sets `?subject={subjectId}` — jumping to the table pre-filtered to that
  subject's rows (the filter bar and table already consume the param). This is the cross-surface hook §6.4
  describes ("a Headmaster who wants to see Mr. Akoto's row specifically clicks through") realised in-page,
  for free, off the filter bar already being built. Lazy win — no new mechanism.
- The escalation card's "Message {VHA}" is a **compose/notify action**, not a drill — wire it to the
  existing messaging entry point if one exists, else stub the button (render, no-op) and flag.

---

## 6. Responsive / PWA

- **No dedicated PWA variant.** This is a management desktop surface (HM/VHA). The PWA form-factor is the
  *teacher's* ledger (`ledger-surface-map.md §4`); the progress/roll-up view has no phone-first mode. The
  surface's own media query (`@media max-width:1280px`) simply stacks the grids — replicate with responsive
  Tailwind, no separate component.
- `.rollup-grid` → `grid-cols-1 gap-3.5 sm:grid-cols-3` (stacks below `sm`; surface collapses `repeat(3,1fr)`
  → `1fr` at 1280px — Tailwind `sm`/`md` breakpoint is close enough; verify in preview).
- Filter bar → `flex flex-wrap` so chip groups wrap on narrow widths.
- Escalation card 3-col grid → stacks (`grid-cols-1 sm:grid-cols-[auto_1fr_auto]`).
- The page already sits in `mx-auto max-w-page` — the roll-up inherits it. No new width container.

---

## 7. Cross-module hooks (design commitments to preserve)

| Hook | Where | Preserve as |
|---|---|---|
| **ledger → roll-up** | `seniorScoreLedger` completion counts → `VhmProgressRow` → `computeSubjectRollup` | The roll-up is a pure reduction of the same rows the table shows. One data load. Never a separate calculation (§0.1, provenance strip). |
| **roll-up → per-teacher table** | subject drill / "Open full progress view" (§5) | In-page anchor + `?subject=` filter. Same page, deeper granularity. |
| **roll-up → STPSHS export/submissions** | deadline line + at-risk tier (§3.4) | The readiness buckets are the "is the school ready for the STPSHS window" answer; the tiers feed the STPSHS submissions surface. Keep the window-date wording consistent with the ledger STPSHS-ready card (shared field, drift #5). |
| **escalation → line-manager (hierarchy)** | "Message {VHA}", never "Message {teacher}" (§3.3) | The action respects the org chart — HM escalates to the VHA, not past them to the teacher. A structural design commitment, not a copy choice. |
| **roll-up → board/Oversight briefing** | "Brief the board →" primary action (surface line 802) | Out of INCR-57 build scope (needs the board/Oversight reporting export, spec §8.3). Render the button, stub or hide; flag as a future hook. The roll-up figures ARE the briefing input. |

---

## 8. Build summary — what actually gets written

Minimal, extends the existing file. **No new route, no migration, no new data load.**

1. **`lib/score-ledger/vhm-progress.ts`** — (a) add `classLevel` + `classProgramme` to `VhmProgressRow` and
   project them in `loadVhmProgress` (add two columns to the existing `classes` select, §2.3); (b) add pure
   `computeSubjectRollup(rows): { fullyReady, partial, atRisk }` beside `computeVhmTier`, with a one-assert
   `__` self-check / unit test (partition is exhaustive & disjoint; the demo `3/5/1` case).
2. **`app/(app)/senior/academic-progress/page.tsx`** — extend `searchParams` with
   `subject/form/programme/status`; filter `rows` in-memory; render **filter bar** (§2) + **roll-up section**
   (§3) between the discipline banner and the completion `<section>`; give the table `id="per-teacher"` for
   the drill anchor.
3. **Filter bar** — `<Link>`-chip group (no client JS) or a thin `GradebookSelectors`-style client wrapper;
   options derived from the (unfiltered) rows + the programme enum display map.
4. **Roll-up section** — can be inline in `page.tsx` or a small presentational `RollupCards` server component
   (mirrors `VhmProgressTable`: pure, receives pre-shaped counts, imports no DB driver — memory
   `reports-data-is-server-only`). Escalation card reuses the §6.3 gold-flag markup already in `page.tsx`.

---

## Open questions / drift log (consolidated)

1. **"Teachers" count unit = teaching assignments (class × subject), not distinct teachers** (§3.2). Copy says
   "teachers"; underlying = `VhmProgressRow`. Default: per-assignment (matches "23 combinations" framing).
   Confirm with PO if a true distinct-teacher "all-my-assignments-ready" count is wanted.
2. **Roll-up group key = subject (default), subject×form/year via the filter** (§3.2). Surface groups by
   subject; spec §6.4 says "English Year 1". Reconciled through the form/year filter. Confirm whether cards
   should split by subject×form even when unfiltered (one-line key change).
3. **Escalation "who's handling it" narrative has no data source** (§3.3). Do not fabricate the
   illness/returning/support-plan status — needs a follow-up-note/case field. Ship blocker + rule + "Message
   {VHA}"; defer the narrative. Natural home for a future flag-acknowledgement feature.
4. **Teacher-name filter deferred** (§2.2). Spec §6.1 lists it; brief scopes to subject/form/programme/status.
   Redundant with sort + per-subject counts. Confirm defer.
5. **STPSHS window date is not stored** (§3.4). "14 July 2026 · 17 days" is mockup copy; no
   `academic_period.stpshs_window_opens_at`. Same gap as `ledger-surface-map.md §3.7`. Omit the countdown or
   add one shared per-`(school × period)` field. Confirm with PO.
6. **"Brief the board" action is out of scope** (§7). Needs the board/Oversight reporting export (§8.3).
   Render + stub/hide; flag as future hook.
7. **Single shared hero vs role-conditional hero** (§0.1/§3.1). Recommend keeping the shared "Score ledger
   progress." page hero and giving the roll-up its own section title ("Where the school stands."). A
   role-conditional page hero is optional and not required.
8. **`?view=rollup|full` collapse mode is optional** (§0.1). Default: table always visible below the roll-up
   (brief says "above the dashboard"). Only add the collapse if a school asks the HM to see roll-up only.

---

*Map produced against: `schoolup-shs-vice-headmaster-progress.html` §3 (lines 391–404 CSS, 753–871 markup);
`SHS_SCORE_LEDGER_SPEC.md` §6.1/§6.3/§6.4; the built `app/(app)/senior/academic-progress/page.tsx`,
`components/senior/vhm-progress-table.tsx`, `lib/score-ledger/vhm-progress.ts`, `lib/access.ts`
(`SENIOR_MANAGEMENT_ROLES` admits HEADMASTER), and `db/schema/students.ts` (`classes.programme` enum +
`classes.level` text — the filter's structured fields, already shipped). Reference-only, not replicated:
`schoolup-oversight-academic-performance.html`. Follows the shape of `docs/senior/ledger-surface-map.md`.*
