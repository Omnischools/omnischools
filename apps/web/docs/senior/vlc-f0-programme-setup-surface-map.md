# VLC Programme Setup — Surface Map (INCR-40 · Module 4.5 / F0 · the config spine)

**Author:** Lucy (design cartographer) · **Status:** design spec, ready for the implementation engineer.
**Scope of this map:** VLC **F0 — the CONFIG spine only.** The programme/cadence settings, the locked
5-phase rhythm, the sequence-locked three-term arc, the 11 ordered core values (English + Twi, grouped
by term), and each value's A/B session-template + prompt (the curriculum library). Edited by a new
**DEAN_OF_STUDENTS** role; **HEADMASTER reads**.

**NOT in F0** (mapped here only so the implementer knows to *skip* them): live sessions, the session
register, Peer Guides (roster/training/selection), the student journal, pastoral flags, and the school
dashboard. Every surface element that belongs to a later increment is tagged **[LATER]** inline.

Rule where surface and spec disagree: **spec wins on logic, surface wins on visual presentation.** Every
drift is called out inline and collected in the **Open questions / drift log** at the end.

## Source

| File | Role |
|---|---|
| `Surfaces/schoolup-vlc-programme-setup.html` | **PRIMARY** — the only surface for this increment. Section 01 (the desktop app mock) is the F0 build target; Section 02 ("VLC is not RME") is an editorial explainer, **not a build target** (§6 below). |

**Sibling surfaces (context only, all [LATER]):** `schoolup-vlc-peer-guides.html` (surface 2 of the batch —
Peer Guide config), `schoolup-vlc-session-register.html`, `schoolup-vlc-student-journal.html`,
`schoolup-vlc-school-dashboard.html`. Do not build any of these in INCR-40.

## Canonical inputs

- **Tokens:** the surface's `:root` block is **byte-identical** to the Score-Ledger surfaces. Use the same
  `var(--x)` → Tailwind-class table already documented in `docs/senior/ledger-surface-map.md` §0. Reproduced
  in §0 below for convenience. **Use the Tailwind token class, never inline `var(--x)` in JSX.**
- **Structural precedent:** `omnischools/app/(app)/senior/boarding/programme/page.tsx` — the closest existing
  analog (a Senior "programme setup" config page: hero → 5-card summary strip → sectioned editors →
  read-only "locked defaults" card, with a server `canEdit` gate). **Reuse its `Section` and `SumCard` local
  helpers verbatim and its edit-gate shape.** This map maps VLC 1:1 onto that idiom.
- **Nav + RBAC:** `omnischools/components/app/sidebar.tsx` (flat, role-gated `SENIOR_ITEMS`),
  `omnischools/lib/access.ts` (the `*_ROLES` groups + `hasAnyRole`), `omnischools/lib/auth/index.ts`
  (`KNOWN_APP_ROLES` — **`DEAN_OF_STUDENTS` is NOT yet a member; the implementer must add it**).
- **Nav-label convention** (README + `BUILD_STACK.md`): the sidebar label is **"Student support"**, never
  "pastoral" / "Pastoral & values" (that phrasing is editorial/CSS only). See §1 and drift log #1.

---

## 0. Token & type reference (applies to every region)

Identical to `ledger-surface-map.md` §0. The ones this surface actually uses:

| Surface `var(--x)` | Hex | Tailwind class | Used for on THIS surface |
|---|---|---|---|
| `--navy` | `#1A2B47` | `text-navy` / `bg-navy` / `border-navy` | body text, featured summary card, rhythm-strip & pg-card grounds, cal-block number |
| `--navy-2` | `#2D3F5C` | `text-navy-2` | secondary body copy, value-card session text |
| `--navy-3` | `#5C6675` | `text-navy-3` | muted meta, labels, ledes |
| `--gold` | `#C8975B` | `text-gold` / `bg-gold` / `border-gold` | all italic accents, "Edit programme" gold btn, phase top-border, current-value border, num-mini |
| `--gold-soft` | `#E8D4B8` | `text-gold-soft` / `border-gold-soft` | cadence-card border, gold-soft dividers, vc-num on non-current cards |
| `--gold-bg` | `#F5EBDC` | `bg-gold-bg` | cadence-card ground, current value-card ground, T1 arc column, VLC compare column |
| `--bg` | `#FAF7F2` | `bg-bg` | page ground, summary-strip ground, taught value-card ground, input ground |
| `--surface` | `#FFFFFF` | `bg-surface` | cards, cal-block, term-arc panel |
| `--green` | `#2F6B47` | `text-green` / `bg-green` | "Taught" status pill text [LATER], T2 arc column accent |
| `--green-bg` | `#E5EFE8` | `bg-green-bg` | "Taught" pill ground [LATER], T2 arc column ground |
| `--terra` | `#B84A39` | `text-terra` | "capstone" label (value 11), T3 arc column accent |
| `--terra-bg` | `#F5E1DC` | `bg-terra-bg` | T3 arc column ground |
| `--warn` / `--warn-bg` | `#C58A2E` / `#F5E9D0` | `text-warn` / `bg-warn-bg` | not used on this surface (present in `:root` only) |
| `--border` | `#E5DFD3` | `border-border` | default card borders, dividers |
| `--border-2` | `#D4CCBA` | `border-border-2` | button borders, dashed value-card / add-value borders, arc term-sub divider |

**Type families:** `font-display` = Fraunces (all headings, big stat numbers, italic gold `<em>` accents,
the value names, the phase-minute numbers, the `ss-tag` A/B letters, the num-mini value numbers);
`font-body`/default = Manrope (all body, labels); `font-mono` = JetBrains Mono (the `cal-block` time `PM`,
and any data readouts). **Value names are `font-display`; Twi names are `font-body` italic** (`vc-twi` =
`font-style:italic; color:var(--navy-3)`).

**No-alpha token trap (memory `no-alpha-token-opacity`) — this surface is FULL of it.** The rhythm-strip,
the featured summary card, and the pg-card [LATER] all sit on `bg-navy` and use `rgba()` text/borders.
Translate them the same way the boarding `LadderView` already does:
- `rgba(255,255,255,0.05 / 0.1)` grounds & borders → `bg-white/5`, `border-white/10` (**`white` is a real
  colour, not a raw-hex token, so slash-opacity is safe there**).
- `rgba(232,212,184,x)` (gold-soft tints) → `text-gold-soft` (solid `#E8D4B8`) — do **not** write
  `text-gold-soft/60`.
- `rgba(250,247,242,0.65)` (the `--bg` off-white at 65%) → **never `text-bg/65`** (silently breaks on the
  raw hex). Use a literal `text-[rgba(250,247,242,0.65)]` or fall back to `text-gold-soft`.
The implementer must verify these in the live preview, not the build (the build won't flag a broken
slash-opacity). Every offending declaration is listed per-region below.

---

## 1. Route, nav, and RBAC (the placement decisions)

### 1.1 Route
- **Recommended route:** `/senior/vlc/setup` (server component, `export const dynamic = "force-dynamic"`,
  same as `boarding/programme/page.tsx`). The surface's own URL bar reads
  `app.omnischools.gh / pastoral / vlc / programme-setup` — that's editorial. Follow the app's real
  convention (`/senior/<module>/...`), so `/senior/vlc/setup` (or `/senior/vlc/programme`).
- **School-type guard:** mirror boarding — `if (school.schoolType === "BASIC") redirect("/dashboard")`.
  VLC is Senior-only (SENIOR / COMBINED).

### 1.2 Nav
- Add ONE flat, role-gated item to `SENIOR_ITEMS` in `components/app/sidebar.tsx`, alongside
  Boarding / WASSCE / Sickbay. Gate it to the VLC read group (§1.3).
- **Nav label = "Student support"** (or a plain `"VLC"` item), **NOT "Pastoral & values."** The README /
  BUILD_STACK convention is explicit: *"pastoral" is reserved for editorial copy and CSS class names; the
  navigation label is "Student support."* The surface's in-page crumb ("Pastoral & values · VLC ·
  Programme setup") may keep the editorial phrasing; the **sidebar** must not. With only one VLC surface in
  F0, a flat item labelled `VLC` is the cleanest match to the existing flat Senior items. See drift log #1.
- **Icon:** the other Senior items use `lucide` icons (`BedDouble`, `Award`, `HeartPulse`, …). The brand
  rule forbids icon substitutions without checking — pick a `lucide` glyph that reads as
  values/community (candidates: `HeartHandshake`, `Compass`, `Sparkles`) and confirm before wiring. Do not
  invent an icon.

### 1.3 RBAC — new role + two gates (mirror the boarding two-gate pattern)
`DEAN_OF_STUDENTS` does not exist yet. The implementer adds it to `KNOWN_APP_ROLES` in `lib/auth/index.ts`
(next to `DEAN_OF_BOARDING`), then adds two groups to `lib/access.ts`:

- **`VLC_ROLES`** (read the surface) = `["ADMIN", "HEADMASTER", "DEAN_OF_STUDENTS"]`.
- **`VLC_EDIT_ROLES`** (write curriculum, cadence, phases, values) = `["ADMIN", "DEAN_OF_STUDENTS"]`.

`as const satisfies readonly KnownAppRole[]` (the compile-time typo guard the file already uses).

**Read-only HM view (owner gate: Dean edits, HM reads):** exactly the boarding shape —
```
const canEdit = hasAnyRole(roles, VLC_EDIT_ROLES);
```
`canEdit` is passed into every editor component (drives read-only rendering) **and** re-checked server-side
in every action (the UI hide is not the boundary). When `!canEdit`, append to the hero lede the same italic
line boarding uses: *"You have read-only access to this surface."* (`boarding/programme/page.tsx` L55–57).

**Per the surface's own Permissions note (map 1:1):**
- **Dean of Students** — full edit: adds/removes values, edits prompts, sets cadence, phase durations.
- **Headmaster** — view all; approves any sequence change. (Read-only in F0. The "approve sequence change"
  workflow is [LATER] — F0 just gives HM read; there is no approval queue yet. Flag #7.)
- **Form Master** — "view their class's schedule · cannot edit curriculum." That view is the **session
  register [LATER]**, not this config surface. **Do NOT grant FORM_MASTER the `/senior/vlc/setup` route in
  F0.**
- **Students / Peer Guides** — never see this surface.

---

## 2. Surface structure — Section 01 (the F0 build target), top to bottom

Section 01's editorial `.section-head` ("01 · The programme · curriculum, Peer Guides, and the Wednesday
rhythm", section-meta "Pastoral & values → VLC → Programme setup") and the outer `.page-header` (§5) are
**design-doc chrome**. The build target is the `.desktop` browser mock inside it. Regions in order:

### 2.0 Outer page-header (design-doc chrome — do NOT build as-is; see §5)

### 2.1 `.head-row` (in-app header — build this)
- **Crumb** (`text-navy-3 text-[11px] uppercase tracking-[0.08em] font-semibold`): `Pastoral & values · VLC · Programme setup`.
- **`<h2 class="display">`** (28px, 500): `VLC` + `<em class="text-gold italic">· academic year 2025/26</em>`.
- **Lede** (`text-navy-3 text-[13px] max-w-[680px]`), verbatim on the surface:
  `Week 26 of 30 · Semester 2 in progress · today's session: Value 7 Patriotism (Ɔman dɔ) session B · 18 classes · 36 Peer Guides trained · last pastoral flag 7 minutes ago`.
  - **F0 rewrite:** keep only the config-derivable clause. The live parts ("today's session … session B",
    "36 Peer Guides trained", "last pastoral flag 7 minutes ago") are [LATER] (sessions/PGs/flags).
    F0-safe lede: `{academicYear} · Week {n} of 30 · {semesterLabel} · 11 values · 22 sessions · {classCount} classes`.
- **Actions (right):**
  - `Open curriculum library` — `.btn.ghost` (`bg-transparent border-border-2 text-navy`). F0: scroll/anchor
    to the curriculum-library block (§2.4). Optional in F0 (the block is on the same page).
  - `Edit programme` — `.btn.gold` (`bg-gold text-navy border-gold font-bold`). F0: enters edit mode /
    toggles the editors' `canEdit` affordances. **Rendered only when `canEdit`.**

### 2.2 `.summary-strip` (5 cards, `grid-cols-5`, `bg-bg` ground)
Reuse the boarding `SumCard` helper (featured = `bg-navy text-bg`, gold big number). Card copy verbatim:

| # | `.lab` | `.big` (display, gold `<em>`) | `.sub` | F0? |
|---|---|---|---|---|
| 1 | `Core values · annual` | `11 values` | `22 sessions · 2 per value (A intro, B applied)` | **F0** — pure config. FEATURED (navy). |
| 2 | `Active classes` | `18 classes` | `Form 1 · Form 2 · Form 3 · all programmes` | **F0** — derivable from the class roster. |
| 3 | `Peer Guides trained` | `36 · 2/class` | `17 boys · 17 girls · 2 in selection rotation` | **[LATER]** — Peer Guides module. |
| 4 | `Sessions held this year` | `13 / 22` | `59% complete · 9 sessions to year-end` | **[LATER]** — live sessions. |
| 5 | `Pastoral flags open` | `4 open` | `3 with FM check-in queued · 1 escalated to Dean` | **[LATER]** — session/journal. |

**F0 recommendation (omit-not-fake, per the sickbay nav precedent):** render only cards 1 & 2 in INCR-40;
do not stub cards 3–5 with zeros. Drop the grid to `grid-cols-2`/`3`. Cards 3–5 land with their own modules.
Map all five here so nothing is lost; build two.

### 2.3 Body block A — `.block` "The Wednesday rhythm" (cadence + 5-phase) — **F0 core**

**`.block-head`:** eyebrow `When and how it runs`; `<h3 class="display">The <em>Wednesday rhythm</em> · 60 minutes, every class, every week</h3>`; **meta (the lock label):** `Locked at programme level · individual class can defer with Dean approval`.

#### 2.3a `.cadence-card` (gold-bg card, `border-gold-soft`, 3-col: cal-block · info · actions)
- **`.cal-block`** (88px white square, `border-gold`): `.day` `WED` (`text-gold`) · `.num` `2:30`
  (`font-display 36px text-navy`) · `.time` `PM` (`font-mono 10px text-navy-3`).
- **`.cad-info`:** eyebrow (the lock) `Master timetable · protected slot`; `<h4 class="display">Every Wednesday <em>2:30 — 3:30 PM</em></h4>`; body `p` verbatim:
  > Last period of the day. **No classes, no assemblies, no clubs scheduled in this slot** · master timetable enforces. Different day from PLC (Friday) so teacher load is spread. Form Master + 2 Peer Guides facilitate; whole class attends in their normal classroom. **22 sessions across the academic year** · 8 weeks of slack for exams, sports days, public holidays, and other disruptions baked into the planning.
- **`.cad-actions`** (stacked): `Adjust cadence` (`.btn`) · `View calendar` (`.btn.ghost`).
  - `Adjust cadence` — **F0**, Dean-only. Edits `cadence_day` (Wednesday), `start_time` (14:30),
    `session_length_min` (60 → drives the 3:30 PM end). **Lock affordance:** the eyebrow "Master timetable ·
    protected slot" + block-head meta are the *visual conveyance of the lock* — the slot is protected from
    other scheduling, not from the Dean. Render `Adjust cadence` disabled/absent when `!canEdit`.
  - `View calendar` — **[LATER]** (calendar/sessions). Render inert or omit in F0.
  - The "individual class can defer with Dean approval → auto-reschedules to the following Wednesday"
    behaviour (notes) is a **[LATER]** per-class session action; F0 sets only the programme-level cadence.

#### 2.3b `.rhythm-strip` (navy card, the 5-phase editor) — **F0 core**
- **`.rs-head`:** eyebrow `Five-phase session structure`; `<h4 class="display">Every session <em>follows the same rhythm</em></h4>`; **`.total`** (right): `Total <b>60 min</b> · phase widths reflect time`.
- **`.phases`** — `grid-template-columns:0.4fr 1.2fr 0.8fr 0.6fr 0.4fr` (**the column widths are literally
  proportional to the minutes** — a deliberate design detail; preserve). Each `.phase` = `bg-white/5
  rounded-lg`, **`border-top:3px solid var(--gold)`** (`border-t-[3px] border-gold`). Five phases, verbatim:

| # | `.ph-mins` (display, gold `<em>` on the number) | `.ph-name` | `.ph-who` | `.ph-desc` |
|---|---|---|---|---|
| 1 | `5 min` | `Opener` | `FM frames` | `Value of the week introduced · today's focus question posed` |
| 2 | `25 min` | `Small groups` | `PGs lead` | `Class splits in two · each Peer Guide leads 4-5 students through the discussion prompts` |
| 3 | `15 min` | `Plenary` | `FM moderates` | `Each group shares back · class hears the range of perspectives` |
| 4 | `10 min` | `Reflection` | `Silent · journal` | `Each student writes a private journal entry · append-only` |
| 5 | `5 min` | `Close` | `FM closes` | `Next week's value previewed · session formally closed` |

- **Lock affordance (spec: "locked but configurable"):** the **five phases, their names, and their `who`
  are locked** (Form Masters/schools don't add a 6th phase or rename them). **Only the durations are
  editable.** So the F0 editor exposes five numeric duration inputs (`5 / 25 / 15 / 10 / 5`); the names/roles
  render as read-only labels. **Constraint:** the five durations must sum to `session_length_min` (60) —
  validate on save (this is the money/logic path → leave a runnable check). `.ph-who` colour tokens:
  `text-gold-soft` (do not use `text-*/opacity`); `.ph-desc` → `text-[rgba(250,247,242,0.65)]`.

### 2.4 Body block B — `.block` "Three-term curriculum arc" (`.term-arc`) — **F0, but READ-ONLY / sequence-locked**

**`.block-head`:** eyebrow `Three-term curriculum arc`; `<h3 class="display">Foundations <em>→ Interpersonal → Integration</em></h3>`; **meta (the lock):** `Sequence locked at programme level · same order every academic year`.

**`.term-arc`** (white panel). `.ta-head`: eyebrow `The 11 values, grouped by term`; `<h4 class="display">Building from <em>self → others → community</em></h4>`. Then `.arc-grid` (3 cols):

| Col | ground / top-border | `.term-lab` | `.term-title` (display, coloured `<em>`) | `.term-sub` | `.vals-list` (num-mini + `<b>EN</b> · Twi`) |
|---|---|---|---|---|---|
| **t1** | `bg-gold-bg` / `border-t-[3px] border-gold` | `Semester 1 · Sept — Dec` | `Foundations <em>· self-formation</em>` (gold em) | `Values 1—4 · weeks 1—9 · 4 values × 2 sessions = 8 sessions` | 1 **Respect** · Obu · 2 **Integrity** · Nokwaredi · 3 **Responsibility** · Asɛyɛde · 4 **Discipline** · Akwankyerɛ |
| **t2** | `bg-green-bg` / `border-t-[3px] border-green` | `Semester 2 · Jan — Apr` | `Interpersonal <em>· toward others</em>` (green em) | `Values 5—8 · weeks 14—22 · 4 values × 2 sessions = 8 sessions` | 5 **Perseverance** · Boasetɔ · 6 **Compassion** · Mmɔborɔhunu · 7 **Patriotism** · Ɔman dɔ *(this week)* · 8 **Tolerance** · Asomdwoe |
| **t3** | `bg-terra-bg` / `border-t-[3px] border-terra` | `Semester 2 · May — Aug` | `Integration <em>· into community</em>` (terra em) | `Values 9—11 · weeks 26—30 · 3 values × 2 sessions = 6 sessions` | 9 **Service** · Adwumayɛ · 10 **Excellence** · Papayɛ · 11 **Wisdom** · Nyansa *capstone* (terra) |

- The `num-mini` value numbers are `font-display italic`, coloured per column (gold / green / terra).
- **`(this week)`** on value 7 is a **[LATER]** live marker (current session); omit in F0.
- **Lock affordance (sequence-locked):** this whole block is **read-only in F0** — present it like boarding's
  `LadderView` (a static "SEQUENCE LOCKED" badge in place of edit controls). The three arc phases
  (Foundations→Interpersonal→Integration, self→others→community) and their order are fixed and never
  reorderable. It is a *projection* of the 11 values (§2.5) grouped by their `arc_phase`/term assignment —
  editing a value in §2.5 reflows here; the arc frame itself is not editable.
- **DRIFT (semester labels):** t2 and t3 are **both** labelled "Semester 2" while t1 is "Semester 1". SHS
  runs **2 semesters/year**, but the curriculum arc has **3 phases**. The arc phase is a *pedagogical
  grouping* (`arc_phase` 1/2/3 → Foundations/Interpersonal/Integration), NOT the academic-period semester.
  Model `arc_phase` distinct from `academic_period`; treat the `term-lab` text as descriptive config copy.
  Flag #3.

### 2.5 Body block C — `.block` "Curriculum library" (`.values-grid`, the 11 values + A/B prompts) — **F0 core**

**`.block-head`:** eyebrow `Curriculum library · 11 values, 22 sessions`; `<h3 class="display">Each value <em>· session A intro, session B application</em></h3>`; **actions:** `Download full curriculum (PDF)` (`.btn.ghost` — **[LATER]/optional**, PDF export) · `Edit prompts` (`.btn` — **F0**, opens the A/B prompt editor; render only when `canEdit`).

**`.values-grid`** = `grid-cols-3`, gap 14px. **11 `.value-card`s + 1 add-value card = 12 cells (4 rows).**

**Per-card anatomy (all F0-editable config):**
- **`.vc-num`** (absolute top-right, `font-display italic 30px`) — the value number `01`–`11`
  (`sequence_order`). `text-gold-soft`, except the current card `text-gold`.
- **`.vc-status`** pill — **the card-variant chrome is [LATER] live-derived** (see below).
- **`.vc-name`** (`font-display 18px 600`) — the **English** value name.
- **`.vc-twi`** (`font-body italic text-navy-3`, dashed bottom border) — the **Twi name · descriptor**.
- **`.vc-session` × 2** — each row = `.ss-tag` (the `A`/`B` letter, `font-display italic gold`) + a `<b>`
  bold prompt title + a plain subtitle. **This is the session-template + prompt content the Dean edits.**

**All 11 values — VERBATIM (keep the Twi names exactly; keep every prompt string):**

| # | Status pill (surface) | EN name | Twi · descriptor | Session **A** (title · subtitle) | Session **B** (title · subtitle) |
|---|---|---|---|---|---|
| 01 | `Taught · Wks 1-2` | **Respect** | Obu · foundation value | **What is respect?** · for self, for elders, for peers | **Respect in practice** · how we speak, listen, disagree |
| 02 | `Taught · Wks 3-4` | **Integrity** | Nokwaredi · honesty & consistency | **Truth-telling** · why it costs, why it matters | **When no one is watching** · who you are alone |
| 03 | `Taught · Wks 5-6` | **Responsibility** | Asɛyɛde · ownership of self & tasks | **What's mine to own** · circles of responsibility | **Excuses and accountability** · catching the slip |
| 04 | `Taught · Wks 7-8` | **Discipline** | Akwankyerɛ · self-direction | **Doing what must be done** · even when hard | **Habit and routine** · small choices, big results |
| 05 | `Taught · Wks 14-15` | **Perseverance** | Boasetɔ · endurance under difficulty | **When things are hard** · stories of endurance | **Failing forward** · how to fail and continue |
| 06 | `Taught · Wks 16-17` | **Compassion** | Mmɔborɔhunu · seeing the other's burden | **Noticing the unseen** · who is left out | **Compassion in action** · what helping really looks like |
| 07 | `Current · Wks 25-26` | **Patriotism** | Ɔman dɔ · love of country, civic duty | **What Ghana means to me** · belonging beyond family | **Service project planning** · today · what we will do |
| 08 | `Upcoming · Wks 27-28` | **Tolerance** | Asomdwoe · peaceful difference | **Tribe, faith, region** · the diversity we live with | **Disagreeing well** · making space without losing self |
| 09 | `Upcoming · Wk 28-29` | **Service** | Adwumayɛ · using what you have for others | **What service is not** · service vs charity vs duty | **Service project execution** · paired with Value 7B |
| 10 | `Upcoming · Wk 29` | **Excellence** | Papayɛ · doing what is good, well | **The whole work** · finishing what you start, well | **Quiet excellence** · without praise, without audience |
| 11 | `Capstone · Wk 30` | **Wisdom** | Nyansa · capstone · integration | **What the year taught me** · pulling threads together | **Carrying forward** · what stays with you after this year |

> **Ghanaian voice (do not simplify):** value 07B "Service project planning" is deliberately paired with
> 09B "Service project execution · paired with Value 7B" — an **intra-curriculum cross-reference** (a
> session template that points at another value's session). Preserve it; it's a design commitment (see §7).
> Twi names are locked content — copy the diacritics exactly (`Asɛyɛde`, `Akwankyerɛ`, `Boasetɔ`,
> `Mmɔborɔhunu`, `Ɔman dɔ`). The schema note also allows `name_ga`; the surface shows only EN + Twi, so
> `name_ga` is an optional/empty column in F0.

**Card-variant states — which are F0 config vs [LATER] live:**
- **`.value-card.taught`** — `bg-bg`, `.vc-status` = `bg-green-bg text-green` "Taught · Wks X-Y".
- **`.value-card.current`** — `border-[1.5px] border-gold`, `bg-gold-bg`, `.vc-num text-gold`, `.vc-status`
  = `bg-gold text-navy` "Current · Wks X-Y".
- **`.value-card.upcoming`** — `border-dashed`, `.vc-status` = `bg-border text-navy-3` "Upcoming · Wks X-Y".
- **Taught / Current / Upcoming are LIVE progress states** derived from session completion against the
  academic week (the surface is set at Week 26 of 30). **In F0 there are no sessions**, so **render every
  value card in one neutral base style** (the plain `.value-card` — white, `border-border`, `vc-num` in
  `text-gold-soft`); do **not** compute taught/current/upcoming. Flag #4.
- **"Capstone" (value 11)** IS config, not live — it's a static property of value 11 (`is_capstone`).
  The `capstone` word can render as a small terra label on value 11's Twi line even in F0.
- **The "Wks X-Y" week bands** are derivable config (sequence + cadence + calendar) — optional to show in
  F0; safe to render as static text, but not load-bearing.

**Add-value card (last cell) — F0 add affordance:**
- Dashed `bg-bg` card, centred: gold italic `+` (`font-display 32px text-gold-soft`) · `Add a value to next
  year's curriculum` · sub (`italic text-navy-3`) `Year-by-year configurable · admin only · changes apply
  next academic year`.
- **Behaviour:** opens a new-value form (EN name, Twi name, description/descriptor, arc phase, A prompt,
  B prompt). **Constraint copy is load-bearing:** additions are **"admin only"** and **"apply next academic
  year"** — i.e. forward-only; a mid-year add doesn't reshuffle the running year. Render only when `canEdit`.

### 2.6 Body block D — `.block` "Student leadership pattern" (`.pg-card`) — **[LATER], do NOT build in F0**

Entirely the **Peer Guides** module (surface 2 of the batch). Mapped for awareness only; skip in INCR-40.
- `.block-head` meta says so: `Detailed roster & training in surface 2 of this batch`.
- Content (for reference): pg-eb `The pattern`; h3 `Two <em>Peer Guides per class</em> · one boy, one girl ·
  Form 2 or 3 · one-term tenure`; 4 `.pg-tile`s — **Per class** `2` (`1 boy + 1 girl` default · class vote,
  FM approval, Dean sign-off), **Eligibility** `F2 / F3 only` (Form 1 don't supply PGs), **Tenure** `1 term`
  (then rotates), **Training** `monthly` (Dean-led · 90 min, last Saturday morning); plus the `.pg-policy`
  "Why this pattern, and not Prefects" paragraph.
- **F0 note:** the surface's own "What this surface configures" note claims Peer Guides eligibility/pairing/
  tenure/training are "configured here." **Per the increment brief, Peer Guides are OUT of F0** — build the
  PG config with the Peer Guides increment, not INCR-40. Drop this whole block from the F0 page.

---

## 3. Interaction-state inventory (F0 editor states, per region)

Follow the boarding editor idiom: each block is a client editor component receiving `canEdit`; when
`!canEdit` it renders the same content read-only (no inputs, no buttons). Every mutation is a server action
that re-checks `VLC_EDIT_ROLES`.

| Region | State | Behaviour / visual |
|---|---|---|
| Cadence | read (`!canEdit`) / edit | read: static WED · 2:30 PM · 60 min. edit: `Adjust cadence` reveals day-select + `<input type="time">` + length; protected-slot eyebrow persists (informational lock, not a hard read-only for the Dean). |
| Phase rhythm | read / edit | read: five phases as labels. edit: five numeric duration inputs; names/roles stay read-only labels; **validate Σ = session_length (60)** on save. |
| Term arc | **read-only always** | sequence-locked; render a static "SEQUENCE LOCKED" badge (boarding `LadderView` precedent). No reorder here. Reflows from §2.5. |
| Value card — rename | read / edit | inline edit `vc-name` (EN) and `vc-twi` (Twi + descriptor). |
| Value card — reorder | edit | reorder `sequence_order` (drag or up/down). Renumbers `vc-num`; reflows the arc grouping. **Constraint:** structural reorder is Dean/admin; per the add-value copy, disruptive changes "apply next academic year" — confirm whether mid-year reorder is allowed or deferred (flag #5). |
| Value card — add | edit | the `+` card → new-value form (EN, Twi, descriptor, arc phase, A prompt, B prompt); "applies next academic year," admin-only. |
| Value card — remove | edit | remove a value (the notes say Dean adds/**removes** values). Confirm dialog (reuse `components/ui/confirm-dialog`). Forward-only posture — confirm whether a value with recorded sessions can be removed (there are none in F0). |
| Session template / prompt | read / edit | `Edit prompts` → edit each value's A & B `<b>title</b>` + subtitle (the `default_focus_text`). |
| Save / confirm | idle / saving / disabled | reuse the Basic/boarding save pattern: primary `bg-navy hover:bg-navy-deep text-bg disabled:opacity-60`; secondary `border-border-2 bg-surface hover:bg-gold-bg`. Server action → `safeRevalidate` → client `router.refresh()`. |
| HM read-only whole surface | `!canEdit` | no `Edit programme` / `Adjust cadence` / `Edit prompts` / `+` controls; hero lede appends *"You have read-only access to this surface."* |
| Empty state (fresh school) | — | VLC config defaults to the **Omnischools canonical 11 values** (the set in §2.5) on programme enable — a true "empty" grid should not normally appear. If a school has VLC enabled but no values seeded, show a muted `EmptyState` (`components/ui/empty-state.tsx`, tone="muted") with a "Seed the canonical 11 values" CTA rather than a blank grid. |

---

## 4. Component / build mapping (surface region → build target)

| Surface region | Reuse | New work for F0 |
|---|---|---|
| `.head-row` hero | boarding `programme/page.tsx` hero block (eyebrow → display h1 w/ gold `<em>` → gold rule → lede + `!canEdit` line) | swap copy + VLC crumb; F0-safe lede (§2.1) |
| `.summary-strip` | boarding `SumCard` helper (verbatim) | 2 config cards (Core values FEATURED, Active classes); defer cards 3–5 |
| `.block` section headers | boarding `Section` helper (eyebrow / title / gold `<em>` / right-meta) | copy the eyebrow/title/meta strings verbatim |
| `.cadence-card` | — (new; simple gold-bg card) | cal-block + info + `Adjust cadence` (day/time/length) |
| `.rhythm-strip` | boarding `LadderView` navy-card idiom (rgba→`bg-white/N` translation) | 5 duration inputs, Σ=60 validation; names/roles read-only |
| `.term-arc` | boarding `LadderView` "locked defaults" read-only card | static 3-column projection of the values by arc phase; SEQUENCE-LOCKED badge |
| `.values-grid` | `components/ui/confirm-dialog`, `fields` (inputs) for the editor | 11 value cards + add-card; rename/reorder/add/remove; A/B prompt editor; neutral base card (no live variants) |
| `.pg-card` | — | **[LATER] — do not build** |
| Section 02 editorial | — | **not a build target** (§6) |
| Page guard | `requireSchoolRole(VLC_ROLES)`; `school.schoolType==="BASIC"→redirect` (boarding precedent) | + `canEdit = hasAnyRole(roles, VLC_EDIT_ROLES)` |
| Data lib | boarding `lib/boarding/programme-data.ts` shape (`getProgrammeConfig(school.id)` returning pre-shaped, RLS-scoped config) | new `lib/vlc/programme-data.ts`; pre-shape all copy strings server-side (client editors take primitives, never the DB driver) |
| Actions | boarding `lib/actions/boarding-config.ts` shape (re-check edit gate every action) | new `lib/actions/vlc-config.ts` |
| Access | `lib/access.ts` groups | add `VLC_ROLES`, `VLC_EDIT_ROLES`; `DEAN_OF_STUDENTS` in `KNOWN_APP_ROLES` |

**Data model this surface implies (F0 subset of the README's VLC schema block):** `vlc_programme_config`
(`cadence_day`, `start_time`, `session_length_min`), `vlc_values` (`value_no`/`sequence_order`, `name_en`,
`name_twi`, `name_ga?`, `description`, `arc_phase`/`term_assignment`, `is_capstone`, `customisable`),
`vlc_curriculum` (per value: `session_type` `'INTRO'|'APPLICATION'` = A/B, `default_focus_text` = the
prompt title + subtitle, `week_no`). The **phase durations** need a home too — either a
`phase_durations_json` on `vlc_programme_config` or a small `vlc_phases` table (5 rows: order, name, who,
duration_min). Do NOT build `vlc_sessions`, `vlc_attendance`, `vlc_reflections`, `vlc_pastoral_flags`,
`peer_guides*` in F0 (all [LATER]).

---

## 5. The outer editorial page-header (design-doc chrome — do NOT build verbatim)

Above the `.desktop` mock. Like the ledger map's outer hero, this is documentation chrome; the in-app
`.head-row` (§2.1) is the built header. For the record:
- eyebrow `Omnischools · VLC batch · 01 of 05`; `.mvp-tag` `SHS · Dean of Students view`; `.related-tag`
  `Student-facing counterpart to PLC`.
- `<h1 class="display">Eleven values, <em>twenty-two sessions</em>, one year</h1>` (56px).
- Lede (long, editorial — the "Every Wednesday at 2:30 PM… the rhythm is the design… eight weeks of slack…
  the days the rain takes the roof off the assembly hall" paragraph). Not built as-is; its facts are already
  captured in the in-app cadence card.

---

## 6. Section 02 — "VLC is not RME" (editorial, NOT a build target)

`.section` 02 is a two-column editorial (`.editorial` article + `.notes` aside). **It is an explainer, not a
configurable surface — do not build it in INCR-40.** Its content is the RME-boundary argument (RME &
Citizenship = examinable NaCCA subjects with WASSCE grades on the transcript; VLC = not examined, no grade,
Form-Master-led, journaled, contributes to the school-leaver character paragraph). The `.compare-grid` two
columns ("RME & Citizenship Education" vs "VLC · this programme") and the closing "complementary, not
competing" paragraph are editorial.

**Why it still matters (design constraints for [LATER] increments, not F0 config):** the aside encodes hard
rules for the journal/dashboard work — *don't put VLC entries on the transcript; don't treat reflections
like assignments; don't "grade" the values; don't let parents see the journal (pastoral confidentiality).*
Record these so the journal/character-paragraph increment honours them; they impose nothing on the F0 config
spine beyond the "no grade / not examinable" framing already implicit in the curriculum library.

---

## 7. Cross-module hooks (design commitments — preserve in the map)

- **VLC cadence ↔ master timetable (protected slot).** The Wednesday 2:30–3:30 PM slot is master-timetable
  protected — "no classes, no assemblies, no clubs scheduled in this slot." The cadence config is the source
  the timetable reads to block the slot. Commitment, not decoration.
- **VLC cadence day ≠ PLC cadence day.** VLC = Wednesday specifically *because* PLC = Friday ("so teacher
  load is spread"). A config-level relationship between the two module cadences; flag if a school tries to
  collide them.
- **Intra-curriculum session pairing.** Value 7B "Service project planning" ↔ Value 9B "Service project
  execution · paired with Value 7B." A session template can reference another value's session — the data
  model for prompts should allow (or at least not forbid) such a reference.
- **[LATER] chains to note now:** phase 4 "Reflection · append-only" → the **student journal**; journal + FM
  notes + PG observations → the **school-leaver character paragraph** (the only parent-facing externalisation);
  Peer Guides eligibility (F2/F3) ↔ class **Form level**; pastoral flags → session/dashboard. None built in
  F0; the config spine must not preclude them.

---

## Open questions / drift log

1. **Nav label — "Pastoral & values" (task) vs "Student support" (convention).** The task text says a new
   "Pastoral & values" nav; the README/BUILD_STACK convention is explicit that **"pastoral" is never a nav
   label — "Student support" is.** Resolution: sidebar item = **"Student support"** (or a plain **"VLC"**
   flat item, matching the other flat Senior items); keep "Pastoral & values" only as the in-page editorial
   crumb. Confirm the exact label with the owner, but do not ship "Pastoral & values" in the sidebar.
2. **`DEAN_OF_STUDENTS` is a brand-new role.** Not in `KNOWN_APP_ROLES`. Add it next to `DEAN_OF_BOARDING`;
   add `VLC_ROLES` (read) and `VLC_EDIT_ROLES` (edit) to `lib/access.ts`. No existing gate references it yet,
   so the mirror of the boarding two-gate pattern is the whole RBAC surface for F0.
3. **Curriculum arc phases (3) vs academic semesters (2).** The term-arc labels t2 and t3 **both** read
   "Semester 2." SHS = 2 semesters; the arc = 3 pedagogical phases (Foundations/Interpersonal/Integration).
   Model `arc_phase` (1/2/3) distinct from `academic_period`; the `term-lab` text is descriptive copy, not a
   period key.
4. **Value-card live states in a config-only increment.** `.taught` / `.current` / `.upcoming` are derived
   from session progress against the academic week — there are **no sessions in F0.** Render all value cards
   in one neutral base style; do not compute those states. "Capstone" (value 11) is the one card marker that
   IS config. The "Wks X-Y" bands are derivable config (optional to show).
5. **Reorder/rename/add posture — mid-year vs next-year.** The values are described as reorderable/renamable,
   but the add-value card says changes "apply next academic year · admin only." Confirm whether F0 allows
   live mid-year edits of the running year's curriculum or forces a forward-only (next-year) posture (matches
   the PTA/boarding forward-only idiom). Recommend forward-only for structural changes (add/remove/reorder),
   free edit for prompt text.
6. **Summary strip — 3 of 5 cards depend on [LATER] modules.** Cards 3 (Peer Guides), 4 (Sessions held),
   5 (Pastoral flags) read from modules not built in F0. Per omit-not-fake, build cards 1 & 2 only; do not
   stub the others with zeros.
7. **HM "approves any sequence change" has no F0 workflow.** The Permissions note gives HM an approval role
   over sequence changes; F0 ships only HM *read*. There is no approval queue/handoff yet — build it with the
   increment that makes sequence changes consequential (or confirm the owner wants a lightweight approve
   step in F0). For now: Dean edits, HM reads.
8. **Peer Guides block claims to be "configured here."** The surface's own note lists PG eligibility/pairing/
   tenure/training as configured on this surface, but the increment brief scopes Peer Guides OUT of F0
   (surface 2 of the batch). Follow the brief: drop `.pg-card` from the F0 build.

---

*Map produced against: `Surfaces/schoolup-vlc-programme-setup.html`; the existing Senior config-page idiom
`app/(app)/senior/boarding/programme/page.tsx` (+ `SumCard`/`Section`/`LadderView` helpers);
`components/app/sidebar.tsx`; `lib/access.ts`; `lib/auth/index.ts`; the token vocabulary shared with
`docs/senior/ledger-surface-map.md` §0; and the VLC schema block in `md files/README.md`.*
