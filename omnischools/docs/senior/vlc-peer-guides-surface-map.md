# VLC Peer Guides — Surface Map (INCR-41 · Module 4.5 / surface 02 · roster + training + vacancy)

**Author:** Lucy (design cartographer) · **Status:** design spec, ready for the implementation engineer.
**Scope of this map:** VLC surface **02 — the Peer Guides ROSTER.** The per-class Peer Guide slots (2 per
Form 2 / Form 3 class, one boy + one girl), the vacancy protocol (step-aside → class vote → finish-term),
the monthly training calendar + per-session attendance, and the tenure/rotation framing. Owned by the
**DEAN_OF_STUDENTS** role (the same gate F0/INCR-40 shipped); **HEADMASTER + FORM_MASTER read**.

**NOT in INCR-41** (mapped here only so the implementer knows to *skip/neutralise* them, every offending
element tagged inline):
- **[INCR-42 · sessions]** anything counting VLC *session* facilitation — "hours of practice", "peer-
  conversations led", session participation. There are no session instances this increment → **omit-not-fake**
  (render neutral/roster-derived or drop; never fabricate session counts).
- **[INCR-43 · journal / character paragraph]** the school-leaver character-reference recognition, and any
  deep-link from a Peer Guide to a student's journal / pastoral record → **stub/omit**.

Rule where surface and spec disagree: **spec wins on logic, surface wins on visual presentation.** Every
drift is called out inline and collected in the **Open questions / drift log** at the end.

## Source

| File | Role |
|---|---|
| `Surfaces/schoolup-vlc-peer-guides.html` | **PRIMARY.** Section 01 (the desktop app mock) is the INCR-41 build target. Section 02 ("Peer Guide vs Prefect") is an editorial explainer, **not a build target** (§6). |

**Sibling surfaces (context):** `schoolup-vlc-programme-setup.html` (surface 01 — **SHIPPED**, INCR-40, the
config spine at `/senior/vlc/setup`; see `docs/senior/vlc-f0-programme-setup-surface-map.md`);
`schoolup-vlc-session-register.html`, `schoolup-vlc-student-journal.html`, `schoolup-vlc-school-dashboard.html`
(all later increments). Do not build those here.

## Canonical inputs (what INCR-40 already established — mirror it exactly)

- **Shipped page idiom:** `omnischools/app/(app)/senior/vlc/setup/page.tsx` — server component,
  `export const dynamic = "force-dynamic"`, `requireSchoolRole(VLC_CONFIG_READ_ROLES)` →
  `if (school.schoolType === "BASIC") redirect("/dashboard")` → `canEdit = hasAnyRole(roles,
  VLC_CONFIG_WRITE_ROLES)`. **Reuse this guard shape verbatim.**
- **Local chrome helpers `SectionHead` + `SumCard`** live inside `setup/page.tsx` (L170–222). This surface
  needs both. **Ladder call: extract the two helpers once to `components/vlc/chrome.tsx` and import from both
  pages** rather than copy-paste a second definition (≈50 lines, DRY, no behaviour change). Flag #9.
- **Data-layer idiom:** `omnischools/lib/vlc/setup-data.ts` — `"server-only"`, one `withSchool(schoolId, …)`
  read, **counts DERIVED not stored**, coalesce-to-defaults for an unseeded school, returns plain
  serializable view types; the page passes primitives to client editors (never the DB driver). Build
  `lib/vlc/peer-guides-data.ts` to the same shape.
- **Frozen editorial idiom:** `omnischools/lib/vlc/defaults.ts` — copy strings that are identical for every
  school (phase names, arc labels) live in a pure `lib/` file, DB-free, unit-tested. The Peer Guide **policy
  strings** ("No Peer Guides by policy", the tenure-rule copy, the vacancy-protocol steps) belong there.
- **Nav + RBAC:** `components/app/sidebar.tsx` (the flat, role-gated `Student support` item already points at
  `/senior/vlc/setup`), `lib/access.ts` (`VLC_CONFIG_READ_ROLES` / `VLC_CONFIG_WRITE_ROLES` — **already
  exist, reuse; do NOT invent a new gate**), `lib/auth/index.ts` (`DEAN_OF_STUDENTS` is already a
  `KnownAppRole`).
- **Nav-label convention:** the sidebar label is **"Student support"**, never "Pastoral" / "Pastoral &
  values" (README/BUILD_STACK: "pastoral" is editorial/CSS only). The surface's in-page crumb keeps the
  editorial "Pastoral & values"; the sidebar must not. See §1.2 and drift #1.

---

## 0. Token & type reference (delta from the shipped Tailwind vocabulary)

Same `:root` block as every Senior surface (byte-identical to `ledger-surface-map.md` §0 and the F0 map §0).
The tokens **this** surface actually uses:

| Surface `var(--x)` | Hex | Tailwind class | Used for on THIS surface |
|---|---|---|---|
| `--navy` | `#1A2B47` | `text/bg/border-navy` | body text, featured sum-card & lead-card grounds, boy-slot left border + avatar |
| `--navy-2` | `#2D3F5C` | `text-navy-2` | secondary copy, tenure values, gap-body |
| `--navy-3` | `#5C6675` | `text-navy-3` | meta, ledes, role labels, class-sub, form-1 policy note |
| `--gold` | `#C8975B` | `text/bg/border-gold` | all italic accents, gold buttons, term-pill, training "next" left-border, boy-avatar glyph, lead-tile `<em>` numbers |
| `--gold-soft` | `#E8D4B8` | `text/border-gold-soft` | featured-card label/sub (**rgba trap** — §0 note), lead-tile borders |
| `--gold-bg` | `#F5EBDC` | `bg-gold-bg` | term-context ground, `form-pill.f2`, training "next" row ground |
| `--bg` | `#FAF7F2` | `bg-bg` | page ground, sum-strip ground, pg-slot ground, `class-card.form1` ground, "done" training row, `9-more` note |
| `--surface` | `#FFFFFF` | `bg-surface` | cards, training card, class cards |
| `--green` | `#2F6B47` | `text/bg-green` | attendance bar fill, `form-pill.f3` text, training "done" status pill |
| `--green-bg` | `#E5EFE8` | `bg-green-bg` | `form-pill.f3` ground, "done" status-pill ground |
| `--terra` | `#B84A39` | `text/border-terra` | girl-slot left border + avatar, **vacancy/gap** border+text, empty-slot dashed |
| `--terra-bg` | `#F5E1DC` | `bg-terra-bg` | `class-card.gap` ground, empty-slot ground, gap-callout ground |
| `--warn` / `--warn-bg` | `#C58A2E` / `#F5E9D0` | `text-warn` / `bg-warn-bg` | the "Rotating after T2" sum-card (warn variant) |
| `--border` / `--border-2` | `#E5DFD3` / `#D4CCBA` | `border-border` / `border-border-2` | card borders, dashed dividers, button borders |

**Type families:** `font-display` = Fraunces (all headings, the big sum-card numbers, italic gold `<em>`,
class-card `<h4>` names, the **avatar initials** `.av`, the gap-callout icon glyph, lead-tile numbers);
`font-body`/default = Manrope (body, labels, PG names, role labels); `font-mono` = JetBrains Mono (the
training `date-box` day/month, the tenure-bar value, and any n/36 data readouts).

**No-alpha token trap (memory `no-alpha-token-opacity`) — the two navy regions on this surface.** Same
translation table as F0 §0. Offenders here:
- **Featured "Active Peer Guides" sum-card** (`bg-navy`): `.lab` `rgba(232,212,184,0.7)` and `.sub`
  `rgba(232,212,184,0.6)` → use **solid `text-gold-soft`**, NOT `text-gold-soft/70`. (The shipped `SumCard`
  helper already does exactly this — `featured ? "text-gold-soft"` — so reusing it gets this right for free.)
- **Leadership `lead-card`** (`bg-navy`, and this whole block is largely [INCR-42/43], see §2.7): tile ground
  `rgba(255,255,255,0.04)` → `bg-white/5` (white is a real colour, slash-opacity safe); tile border
  `rgba(232,212,184,0.15)` → `border-gold-soft/15` is unsafe on the raw hex → use a **literal**
  `border-[rgba(232,212,184,0.15)]`; `.lab` `rgba(232,212,184,0.6)` → `text-gold-soft`; `.sub`
  `rgba(250,247,242,0.6)` (the `--bg` off-white at 60%) → **never `text-bg/60`** → literal
  `text-[rgba(250,247,242,0.6)]` or fall back to `text-gold-soft`.
Verify in the **live preview**, not the build (a broken slash-opacity compiles clean).

---

## 1. Route, nav, and RBAC

### 1.1 Route
- **Recommended route:** `/senior/vlc/peer-guides` (server component, `dynamic = "force-dynamic"`, same guard
  chain as `setup/page.tsx`). The surface's own URL bar reads `app.omnischools.gh / pastoral / vlc /
  peer-guides` — editorial; the app convention is `/senior/<module>/…`, so the real path drops "pastoral".
- **School-type guard:** identical to setup — `if (school.schoolType === "BASIC") redirect("/dashboard")`.
  VLC is Senior-only.

### 1.2 Nav — VLC now has TWO surfaces under one flat sidebar slot
- The sidebar is well under twelve items, so the convention says **stay flat — do NOT open a sectioned nav.**
  The `Student support` item already exists (→ `/senior/vlc/setup`, `HeartHandshake`, gated
  `VLC_CONFIG_READ_ROLES`).
- **Recommendation:** keep the **single flat `Student support` sidebar item**; surface `Setup` and
  `Peer Guides` as an **in-page VLC sub-nav (a tab / segmented link row at the top of each VLC page)** — a
  module-level secondary nav, *not* a sidebar section and *not* a second top-level item. Two sibling
  top-level items ("Student support" + "Peer Guides") would read wrong — Peer Guides is a sub-concept of the
  VLC/Student-support module. Confirm the exact sub-nav shape with the owner (drift #2). Whatever is chosen,
  the sidebar **label stays "Student support"**; "Pastoral & values" is the in-page crumb only.
- **Landing question:** if the owner wants a single VLC entry point, `Student support` can point at a VLC
  index/landing that tabs to setup + peer-guides; otherwise it keeps pointing at `/senior/vlc/setup` and the
  sub-nav carries the user across. Either way `/senior/vlc/peer-guides` is a real, linkable route.

### 1.3 RBAC — reuse the two INCR-40 gates as-is
No new role, no new group. `DEAN_OF_STUDENTS` already exists; the two gates already exist and fit:
- **`VLC_CONFIG_READ_ROLES`** = `DEAN_OF_STUDENTS, ADMIN, HEADMASTER, FORM_MASTER` → **reads** the roster.
- **`VLC_CONFIG_WRITE_ROLES`** = `DEAN_OF_STUDENTS, ADMIN` → **appoints / removes / marks-trained /
  plans-training / confirms-vote**.

```
const { school, user } = await requireSchoolRole(VLC_CONFIG_READ_ROLES);
if (school.schoolType === "BASIC") redirect("/dashboard");
const canEdit = hasAnyRole(roles, VLC_CONFIG_WRITE_ROLES);
```

`canEdit` is passed into every client sub-component (drives read-only rendering) **and** re-checked
server-side in every action. When `!canEdit`, append the same italic line the setup page uses to the hero
lede: *"You have read-only access to this surface."*

**Per-role reading of THIS surface (map 1:1, mirror the F0 split):**
- **Dean of Students** — owns the roster: full edit (appoint, remove/accept-step-aside, confirm vacancy
  vote, plan + mark training, schedule the next selection cycle).
- **Admin** — same write gate as Dean (fallback owner).
- **Headmaster** — read-only (sees the whole roster; no edit controls).
- **Form Master** — read-only on this surface. The surface names the FM as the class-vote holder
  ("Mrs L. Owusu (FM) has 4 candidate names", "FM holds a class vote"), but the vote is **ratified by the
  Dean** ("Dean (Mr Kyei) attends to ratify"). **Open question (drift #3):** does the FM get a *class-scoped*
  write to record their own class's vacancy vote, or does the Dean record all outcomes? The lazy INCR-41
  default: **Dean/Admin write only; FM reads** (matches the shipped gate; the FM's approval is an offline
  class event the Dean records). Confirm before granting FM a scoped mutation.
- **Students / Peer Guides** — never see this surface (structural parent_deny + not in the read gate).

---

## 2. Surface structure — Section 01 (the INCR-41 build target), top to bottom

Section 01's editorial `.section-head` ("01 · The roster · 36 Peer Guides across 18 classes", section-meta
"Pastoral & values → VLC → Peer Guides") and the outer `.page-header` (§5) are **design-doc chrome**. The
build target is the `.desktop` browser mock inside it. Regions in order:

### 2.1 `.head-row` (in-app header — build this)
- **Crumb** (`text-navy-3 text-[11px] uppercase tracking-[0.08em] font-semibold`):
  `Pastoral & values · VLC · Peer Guides roster`.
- **`<h2 class="display">`** (28px, 500): `Peer Guides ` + `<em class="text-gold italic">· Semester 2 ·
  2025/26</em>`.
- **Lede** (`text-navy-3 text-[13px] max-w-[660px]`), verbatim on the surface:
  `34 of 36 slots filled · 17 boys + 17 girls (perfect balance) · 22 Form 2 + 12 Form 3 · next training
  Saturday 19 May · class vote pending for Form 2 Eunyam vacancy`.
  - Every clause is **INCR-41-derivable** (roster counts + next training date + open vacancy) once the roster,
    training and vacancy tables exist — no rewrite needed. Build the lede from real aggregates
    (`{filled} of {slots} · {boys} boys + {girls} girls · {f2} Form 2 + {f3} Form 3 · next training {date} ·
    {vacancyClause}`).
- **Actions (right):**
  - `View selection history` — `.btn.ghost`. Reads `peer_guide_selection_history` (README audit table).
    **[INCR-41-thin — flag #4]:** the audit table is in the increment, but a full history *view/drilldown* is
    a separate surface. Recommend: render the button, wire to a lightweight list (or defer/omit if the
    history view slips); do not fake it.
  - `Schedule 2026/27 Semester 1 selection` — `.btn.gold`. A selection-cycle scheduling workflow.
    **[INCR-41-thin — flag #4]:** the heavy "run a class-vote wizard" is more than a roster ships. Recommend a
    **lightweight "record next selection date"** action (writes the cycle date the term-context banner and the
    "Rotating after T2" card read), not a full election engine. **Rendered only when `canEdit`.**

### 2.2 `.summary-strip` (5 cards, `grid-cols-5`, `bg-bg` ground)
Reuse the shipped `SumCard` helper (featured = `bg-navy text-bg` gold number; the warn variant needs a small
addition — see below). Copy verbatim:

| # | variant | `.lab` | `.big` (display, gold `<em>`) | `.sub` | INCR-41? |
|---|---|---|---|---|---|
| 1 | **featured** (navy) | `Active Peer Guides` | `34 / 36` (em on `34`) | `94% · 2 slots open (1 vacancy + 1 rotation)` | **INCR-41** — roster count + vacancy/rotation flags. |
| 2 | default | `Gender balance` | `17 · 17` (both em) | `Boys / girls · default 1+1 pattern holding` | **INCR-41** — derived from PG rows' rep gender. |
| 3 | default | `Form distribution` | `22 · 12` (both em) | `F2 / F3 · F3 students tend to rotate out for WASSCE` | **INCR-41** — derived from PG rows' class form. |
| 4 | default | `Training attendance` | `92%` | `4 trainings done · avg 33 of 36 attended` | **INCR-41** — training-attendance aggregate. |
| 5 | **warn** (`bg-warn-bg border-warn`) | `Rotating after T2` | `14 PGs` | `Selection cycle 15 Jul for 2026/27 Semester 1` | **INCR-41-ish** — rotation count from tenure end-dates; "15 Jul" is the scheduled next-selection date (flag #4). |

- **`SumCard` warn variant is net-new:** the shipped helper only knows `featured` vs default. Add a `warn`
  prop (`bg-warn-bg border-warn`, `.lab`+`.big` in `text-warn`) — small extension, do it in the extracted
  `chrome.tsx` (flag #9).
- All five cards are INCR-41-buildable (no session/journal dependency), so — unlike the F0 strip — **build all
  five.** The only soft edge is card 5's "15 Jul" selection date, which comes with the scheduling action
  (flag #4); until that ships, show the rotation count and drop the date clause rather than hard-code it.

### 2.3 `.term-context` banner (gold-bg card, `border-gold-soft`)
- **`.term-pill`** (`bg-gold text-navy`): `SEMESTER 2 LOCKED`.
- **`.info`** (verbatim): `Current selection in tenure` (bold) ` · Semester 2 PGs serve May — Aug 2026 · `
  `<em>2026/27 Semester 1 selection opens 15 Jul</em> · 14 of 34 will rotate (Form 3 finishing, voluntary
  step-aside, end of tenure)`.
- **`.actions`:** `View tenure rules` — `.btn.ghost`. Opens the **static tenure-rule copy** (1-term default,
  re-selection allowed, F3 rolls off for WASSCE). This is frozen policy text → put it in `lib/vlc/defaults.ts`
  and render in a modal/disclosure; **not** a mutation, so it shows for read-only viewers too.
- **INCR-41** — tenure window + rotation count derive from PG tenure rows; the "selection opens 15 Jul" is the
  scheduled cycle date (flag #4). The "LOCKED" pill is the same *visual* lock idiom as the setup arc's
  "Sequence locked" badge (semester tenure is locked once the cycle closes; not editable mid-term).

### 2.4 Body block A — `.block` "Per-class roster" — **INCR-41 core**
**`.block-head`:** eyebrow `Per-class roster · 9 classes shown of 18`; `<h3 class="display">Each class <em>·
two Peer Guides</em> · except Form 1</h3>`; **meta:** `Filterable by form · click any card for class detail`.
- **"9 classes shown of 18"** is a *design abbreviation* of the mock. The real page renders **every class**
  (all F1 + F2 + F3), grouped/orderable by form. The `.9-more` footer note
  (`9 more classes · 4 Form 2 + 5 Form 3 · click to expand the full roster`) is mock-only — the build renders
  the complete grid (or paginates); don't hard-code "9 more".
- **`Filterable by form`** → a real F1/F2/F3 filter control (INCR-41).
- **`click any card for class detail`** → a per-class detail drilldown. **This is where appoint / remove /
  replace live** (the surface has no naked "add PG" button on a card face). **[INCR-41 — flag #5]:** the
  class-detail view is implied but not drawn on this surface; scope it as a modal/side-panel that holds the
  per-slot edit actions, and keep it INCR-41 (roster edit) — it must **not** deep-link to a student's journal
  (that link is [INCR-43], omit).

**`.classes-grid`** = `grid-cols-3`, gap 14px. Three card variants:

**(a) Form 1 card — `.class-card.form1`** (`bg-bg`, no PG slots). Two shown:
- Head: `<h4>Form 1 <em>GS</em></h4>`; sub `General Science · 42 students · Mrs Y. Akoto FM`; form-pill `F1`
  (`.f1` = `bg-border text-navy-3`).
- Body: `.no-pg-note` (italic, centred): **`No Peer Guides by policy`** (bold) + `Form 1 students receive ·
  they don't lead in their first year`.
- Second: `Form 1 SC` · `Science · 38 students · Mr D. Mensah FM`.
- **Policy string is frozen editorial** → `lib/vlc/defaults.ts`. Form 1 classes render this card with **no
  slots and no edit affordance** (structural, not a vacancy).

**(b) Regular F2/F3 card — `.class-card`** (`bg-surface`). Shown: Form 2 `GA A`, Form 2 `GS A`, Form 2 `BUS`,
Form 3 `GS A`, Form 3 `GA`, Form 3 `BUS`. Each renders:
- Head: `<h4>Form 2 <em>GA A</em></h4>`; sub `General Arts · 40 students · Mr A. Mensah FM`; form-pill
  `F2` (`.f2` = `bg-gold-bg text-gold`) or `F3` (`.f3` = `bg-green-bg text-green`).
- **`.pg-pair`** (2 cols) — two `.pg-slot`s:
  - **Boy slot** (`.boy`, left border navy, avatar `bg-navy text-gold`): avatar initials (e.g. `PO`), name
    `Prince Otoo`, role `Boys' rep · F2`.
  - **Girl slot** (`.girl`, left border terra, avatar `bg-terra text-bg`): initials `AG`, name `Akua Gyamfi`,
    role `Girls' rep · F2`.
- **`.tenure-bar`** (mono value): label `Tenure` · value — one of: `Semester 2 · ends 21 Aug` (F2 regular),
  `Final semester · WASSCE soon` (F3 GS A), `Final semester · rotating out` (F3 GA / BUS).
- Verbatim slot data for the six drawn cards:

  | Class | Sub (programme · size · FM) | Boy rep | Girl rep | Tenure value |
  |---|---|---|---|---|
  | Form 2 GA A | General Arts · 40 · Mr A. Mensah FM | Prince Otoo (PO) | Akua Gyamfi (AG) | Semester 2 · ends 21 Aug |
  | Form 2 GS A | General Science · 42 · Mr K. Yiadom FM | Edem Agbeko (EA) | Naa Boakye (NB) | Semester 2 · ends 21 Aug |
  | Form 2 BUS | Business · 36 · Mrs J. Ofori FM | Samuel Annan (SA) | Esther Bonsu (EB) | Semester 2 · ends 21 Aug |
  | Form 3 GS A | General Science · 38 · Dr E. Tetteh FM | Kofi Adusei (KA) | Yaa Bediako (YB) | Final semester · WASSCE soon |
  | Form 3 GA | General Arts · 35 · Mrs G. Asante FM | Joseph Mensah (JM) | Priscilla Sarpong (PS) | Final semester · rotating out |
  | Form 3 BUS | Business · 32 · Mr P. Akoto FM | Daniel Kpodo (DK) | Abena Twum (AT) | Final semester · rotating out |

**(c) Vacancy card — `.class-card.gap`** (`border-terra`, `bg-terra-bg`). The one drawn:
- Head: `<h4>Form 2 <em>Eunyam</em></h4>`; sub `General Arts · 41 students · Mrs L. Owusu FM · ` +
  **`vacancy open`** (terra bold); form-pill `F2`.
- `.pg-pair`: **boy slot** filled — `Kwame Osei (KO)` · `Boys' rep · F2`; **empty slot** (`.pg-slot.empty`,
  terra dashed, avatar glyph `!`): name line `Akosua M. stepped aside`, role line `Vote pending Fri 23 May`.
  - **Copy drift #6:** the empty-slot name reads `Akosua M.` here vs `Akosua Mensah` in the gap-callout (§2.5)
    and the "girls' rep" role; the head sub says just "vacancy open". Render the stepped-aside student's real
    name consistently (full name in the callout, short in the tight slot is fine); the "Vote pending {date}"
    line comes from the vacancy record.
- `.tenure-bar`: `Semester 2 · 2 wks in · 14 wks left` (this class's own tenure clock, further along than the
  generic "ends 21 Aug").

**Data points a class card shows (for Kofi — project only these):** class display name (`Form 2 Eunyam`),
programme label (`General Arts`), student count (`41 students` — `count(students where class_id)`), Form
Master name (`Mrs L. Owusu FM` — `classes.class_teacher_user_id → user`), form level (F1/F2/F3 — derived from
class name/`level`/`programme`, **not** a new column), a `vacancy open` flag, and **per slot**: rep gender
(boy/girl → border+avatar colour), student name + initials (derived from name), role label
(`Boys'/Girls' rep · F{n}`), and for an empty slot the stepped-aside student's name + `Vote pending {date}`.
The card-level **tenure string** derives from the PG tenure window + the class form (F3 → "WASSCE"/"rotating
out"; F2 → "ends {date}").

### 2.5 `.gap-callout` — the vacancy protocol panel — **INCR-41 core (the "vacancy protocol" deliverable)**
- **`.gc-head`:** icon glyph `!` (terra); `<h4>Open vacancy · <em>Form 2 Eunyam</em></h4>`; sub (verbatim):
  `Akosua Mensah stepped aside 02 May 2026.` (bold) ` Personal circumstances (family illness, returning home
  weekends). Class vote scheduled for Friday 23 May to elect replacement girls' rep. Mrs L. Owusu (FM) has 4
  candidate names from class members.`
- **`.gc-head .actions`:** `View candidates` (`.btn.ghost`) → reads the ≤4 nominations. `Confirm vote`
  (`.btn.gold`) → **the fill-vacancy mutation** (records the winner, fills the empty slot for the remainder of
  the term). Both **write-gated**; hidden for read-only viewers.
- **`.gc-body`** (verbatim, the protocol copy): `Vacancy protocol when a PG steps aside mid-term: `**`class
  members nominate up to 4 candidates within one week`**` · FM holds a class vote · winner serves the
  remainder of the term (not a fresh full tenure). `**`Kwame Otoo (boys' rep) continues solo`**` during the
  gap — Mrs Owusu has been picking up the small-group facilitation that would normally be Akosua's. Vote
  happens Friday in the regular VLC slot. Dean (Mr Kyei) attends to ratify.`
  - **Copy drift #6 (again):** boy rep is `Kwame Osei` in the card but `Kwame Otoo` in this paragraph — one
    student, pick one spelling. The protocol steps themselves are frozen editorial → `lib/vlc/defaults.ts`.
- **State model this drives:** a PG row transitions `active → stepped_down` (with `stepped_down_at` +
  `reason_text`); the class card flips to `.gap` state; a vacancy carries ≤4 candidate names + a scheduled
  vote date; `Confirm vote` appoints a replacement whose tenure = **remainder of the current term** (not a
  fresh 1-term). The gap-callout only renders when the class has an open vacancy (0 or more panels).

### 2.6 Body block B — `.block` "Training calendar" — **INCR-41 core (the "training" deliverable)**
**`.block-head`:** eyebrow `Monthly training · last Saturday morning`; `<h3 class="display">Training <em>
calendar</em> · 6 sessions per academic year</h3>`; **actions:** `Download attendance log` (`.btn.ghost` —
CSV export of `peer_guide_training_attendance`; **optional/thin**, cheap, but fine to defer) · `Plan next
training` (`.btn` — creates a training session; **write-gated**).

**`.training-card`** — one `.training-row` per session (`grid-cols-[80px_1fr_90px_110px_90px]`). Six rows,
each: `.date-box` (mono day + month) · `.topic` (title + desc) · `.duration` (mono) · `.attendance` (mini bar
+ n/36 + %) · `.status-pill`. Row backgrounds: `.done` (`bg-bg`), `.next` (`bg-gold-bg` + gold left border),
`.future` (`opacity-65`). Verbatim:

| Date | Title | Desc | Dur | Attendance | Status pill |
|---|---|---|---|---|---|
| 26 Jan | Welcome & the Peer Guide role | What it is, what it is not · facilitation vs authority | 90 min | 36 / 36 · 100% | `DONE` (green) |
| 23 Feb | Listening · the discipline of holding space | Active listening drills · paired exercises · silence as a tool | 90 min | 34 / 36 · 94% | `DONE` |
| 30 Mar | When to flag · pastoral concern protocol | Recognising a struggle · escalation paths · confidentiality boundaries | 120 min | 33 / 36 · 92% | `DONE` |
| 27 Apr | Difficult moments · de-escalation | When a group conversation goes off-rails · case scenarios from Semester 1 | 90 min | 32 / 36 · 89% | `DONE` |
| 19 May | Service projects · planning & running Value 7B | Prep for the Patriotism→Service paired session block · per-class project briefs | 120 min | `— · upcoming` (bar 0%) | `NEXT · SAT` (gold) |
| 23 Jun | Year reflection · handing over | Capstone training · F3 PGs prepare to step down · F2s prepare to mentor next intake | 90 min | `— · scheduled` (bar 0%) | `FUTURE` (border/navy-3) |

- **Data points a training row shows (Kofi):** `scheduled_at` (→ day + month + the "SAT" weekday tag),
  `topic` (title), a **description** line (README's `peer_guide_training_sessions` lists `topic` but not a
  separate desc — either widen to `topic` + `description`/`detail`, or fold into `topic`; flag #7),
  `duration_min`, and the **attendance aggregate** (present-count / total-PGs + %). `DONE / NEXT / FUTURE` are
  **derived from `scheduled_at` vs today**, not stored.
- **Mark-trained affordance:** the attendance bars imply a per-session attendance capture (mark each PG
  present/absent → drives the n/36 and the 92% headline). That capture is **INCR-41** (it's "training"); it
  lives on a training-detail view reached from a row (not drawn here — flag #5). A future/next row has no
  attendance yet ("— · upcoming/scheduled").
- **Cross-hook to preserve (§7):** the 19 May title "planning & running **Value 7B**" and the desc
  "Patriotism→Service paired session block" mirror the INCR-40 intra-curriculum pairing (Value 7B ↔ 9B). Keep
  the copy; it's a design commitment, not filler.

### 2.7 `.lead-card` "Leadership development" — **MOSTLY [INCR-42/43] — omit-not-fake**
Navy card. `.lc-eb` `Leadership development · the year so far`; `<h3>36 students <em>have led a peer-
conversation</em> this year</h3>`; 4 `.lead-tile`s. **Read this block critically — three of the four tiles and
the headline count things that don't exist until later increments.**

| Tile | `.lab` | `.num` | `.sub` | Verdict |
|---|---|---|---|---|
| headline | (h3) | `36` | "have led a peer-conversation this year" | **[INCR-42]** "led a peer-conversation" is a *session* claim (no sessions yet). The number 36 = roster count; if kept, **reframe to a roster statement** ("36 students hold a PG role this year") — do not imply sessions ran. |
| 1 | Students who held a PG role | `36` | Cumulative this year · plus 14 more rotating in for 2026/27 Semester 1 | **[INCR-41-partial]** current count is roster-derived; "cumulative this year" needs `peer_guide_selection_history` (flag #4). |
| 2 | Trained in facilitation | `50` | By year-end · 36 current + 14 incoming | **[INCR-41-projection]** a forward projection (current + incoming). If shown, derive from roster + scheduled cycle; otherwise omit — do not hard-code 50. |
| 3 | Hours of practice each | `22 hrs` | 11 sessions × 60 min each · plus monthly training | **[INCR-42] omit-not-fake** — counts VLC *session* facilitation hours. No sessions this increment → drop the tile or render neutral. |
| 4 | Recognised on character ref | `36` | PG service line on school-leaver letter · all current PGs eligible | **[INCR-43] stub/omit** — the school-leaver character paragraph is the journal/character-paragraph increment. |

- **Recommendation:** in INCR-41, **render at most tiles 1 (roster count) + 2 (only if the incoming/cycle
  number is real), and neutralise the headline to a roster statement.** Drop tiles 3 & 4 entirely (do not stub
  with zeros or fabricated hours). If that leaves the navy `lead-card` thin, collapse it to a single
  roster-summary line rather than a 4-tile grid. Flag #8.
- The navy ground makes this the **second no-alpha hazard region** (§0 note) — but since most of it is
  deferred, the hazard mostly disappears with the deferred tiles.

### 2.8 `.notes` aside (design-doc chrome — intent, not a build target)
The right rail documents intent; capture it, don't render it. Two headings:
- **"What this surface manages":** per-class PG slots (2 per F2/F3 class; F1 = "no PGs by policy"); vacancy
  protocol (step-aside → ≤4 nominations in one week → FM class vote → winner finishes term); **training
  attendance tracked per session** (drives the 92% headline; **below 80% triggers a Dean conversation** with
  the missing PG — a pattern of absence may signal stepping aside); tenure rotation is calendared (2026/27
  Semester 1 selection opens 15 Jul; F3 PGs roll off for WASSCE, some F2 PGs roll off at end of 1-term
  tenure); **leadership stats feed the year-end character paragraph** (each PG's service recognised on the
  school-leaver reference letter — the [INCR-43] hook).
- **"Why not a longer tenure?":** 1-term is deliberate — (1) spreads leadership wider across the cohort,
  (2) prevents burnout accumulating, (3) each class meets multiple PG personalities across the year.
  Re-selection allowed (~20–30% stand again next year). → This is the **tenure-rules copy** the
  `View tenure rules` action (§2.3) shows; put it in `lib/vlc/defaults.ts`.

---

## 3. Interaction-state inventory (INCR-41, per region)

Each mutating region is a client component receiving `canEdit`; `!canEdit` renders read-only (no buttons, no
inputs). Every mutation is a server action that re-checks `VLC_CONFIG_WRITE_ROLES`.

| Region | State | Behaviour / visual |
|---|---|---|
| Roster grid | empty / loading / populated | **empty:** school with VLC enabled but no PG rows (fresh term before selection) → muted `EmptyState` ("No Peer Guides selected yet · schedule the first selection cycle"), **not** a blank grid — mirror the setup-data coalesce discipline. **populated:** F1 policy cards + F2/F3 slot cards + any `.gap` cards. |
| Form filter | idle / active | F1/F2/F3 filter chips (INCR-41). Pure client filter over the loaded roster. |
| Class detail (per card click) | closed / open (read) / open (edit) | modal/side-panel; **[flag #5]** holds appoint / remove / replace slot actions (write-gated). Must NOT link to a student journal/pastoral record ([INCR-43], omit). |
| Appoint / remove PG | edit | appoint fills a slot (pick a class student of the matching rep gender); remove = accept a step-aside → transitions the row to `stepped_down` + opens a vacancy. Confirm dialog (`components/ui/confirm-dialog`). Write-gated. |
| Vacancy — view candidates | read | lists ≤4 nominated candidates for the open slot. |
| Vacancy — confirm vote | edit | records the winner, fills the empty slot for the **remainder of the term** (not a fresh tenure); flips the `.gap` card back to normal. Write-gated. |
| Training — plan next | edit | new training-session form (date, topic, duration). Write-gated. |
| Training — mark attendance | read / edit | per-session present/absent capture (drives n/36 + the 92% headline). Lives on a training-detail view (flag #5). Write-gated. |
| Training — download log | read | CSV export of attendance (optional/thin; safe to defer). |
| Selection — schedule / history | edit / read | schedule next cycle date (lightweight — flag #4); view history reads the audit table. Write-gated (schedule) / read-gated (history). |
| Tenure rules | read (all) | static disclosure/modal of frozen policy copy; **shows for read-only viewers too** (not a mutation). |
| Whole surface — `!canEdit` | read-only | no Schedule-selection / Confirm-vote / Plan-training / appoint-remove controls; hero lede appends *"You have read-only access to this surface."* |

---

## 4. Component / build mapping + implied data model

| Surface region | Reuse | New work for INCR-41 |
|---|---|---|
| `.head-row` hero | setup `page.tsx` hero shape (crumb → display h2 w/ gold `<em>` → lede + `!canEdit` line) | swap copy + VLC crumb; real-aggregate lede; the two right actions (history/schedule) |
| `.summary-strip` | shipped `SumCard` helper (extract to `components/vlc/chrome.tsx`) | **add a `warn` variant**; build all 5 cards |
| `.block` headers | shipped `SectionHead` helper (extract) | copy eyebrow/title/meta strings verbatim |
| `.term-context` | boarding/gold-bg banner idiom | tenure/rotation summary + `View tenure rules` disclosure |
| `.classes-grid` (F1 policy / F2·F3 slots / gap) | — (net-new) | `PeerGuideRoster` client component — class cards, pg-slot pairs, form filter, tenure string, `.gap` state |
| `.gap-callout` | `components/ui/confirm-dialog` for Confirm-vote | `VacancyPanel` — nominations + confirm-vote mutation |
| `.training-card` | — (net-new) | `TrainingCalendar` client component — rows, DONE/NEXT/FUTURE derivation, plan/mark actions |
| `.lead-card` | — | **mostly deferred** ([INCR-42/43]); build only the roster-derived slice (§2.7) |
| Page guard | `requireSchoolRole(VLC_CONFIG_READ_ROLES)` + BASIC redirect + `canEdit` (setup precedent) | none — identical |
| Data lib | `lib/vlc/setup-data.ts` shape (`"server-only"`, `withSchool`, derived counts, plain view types) | new `lib/vlc/peer-guides-data.ts` |
| Actions | setup action idiom (re-check write gate every action, `safeRevalidate` → `router.refresh()`) | new `lib/actions/vlc-peer-guides.ts` |
| Frozen copy | `lib/vlc/defaults.ts` | add PG policy strings (no-PG-by-policy, tenure rules, vacancy-protocol steps) |
| Access / role / nav | `VLC_CONFIG_*_ROLES`, `DEAN_OF_STUDENTS`, `Student support` item | **none — all already exist** (drift #1 already resolved by INCR-40) |

**Data model this surface implies (Kofi — NONE of these tables exist yet; F0 shipped only `vlc_programme` /
`vlc_value` / `vlc_session_template`).** Straight from the README VLC schema block, INCR-41 subset:
- **`peer_guide`** — `school_id`, `class_id`, `student_id`, `rep` (boys'/girls' — or derive from
  `student.gender`, which is `houseGenderEnum` BOYS/GIRLS on the student), `term_no` (which semester),
  `tenure_start` / `tenure_end` (or `term_count`), `status` (active / stepped_down), `assigned_at`,
  `stepped_down_at`, `reason_text`. Composite intra-tenant FKs `(school_id, class_id)` → `class_tenant_uk` and
  `(school_id, student_id)` → the student tenant UK (the codebase's composite-tenant-FK rule).
- **`peer_guide_training_session`** — `school_id`, `scheduled_at`, `topic` (+ a `description` line, flag #7),
  `duration_min`, `led_by_staff_id`, `materials_file_id?`.
- **`peer_guide_training_attendance`** — `school_id`, `training_session_id`, `peer_guide_id`, `status`,
  `marked_at`. (Aggregate n/36 + % is **derived**, never stored — the counts-are-derived discipline.)
- **`peer_guide_selection_history`** — `school_id`, the audit trail for the "cumulative this year" tile + the
  `View selection history` action (thin — flag #4).
- **A vacancy needs nomination storage** for the ≤4 candidates + scheduled vote date. Either a
  `peer_guide_vacancy` (open slot, vote date) + `peer_guide_nomination` (≤4 candidates), or fold nominations
  onto the open PG-slot row. Kofi's call; the surface needs: open-slot marker, ≤4 candidate names, a vote
  date, and a confirm→appoint transition. Flag #10.
- **Do NOT build** `vlc_session*`, `vlc_attendance`, `vlc_reflection`, `vlc_pastoral_flag`,
  `vlc_character_paragraph` here — those are INCR-42/43.
- **Tables are tenant-scoped:** ENABLE + FORCE RLS + `tenant_isolation` + `parent_deny` (parents see NOTHING
  in VLC, owner-locked — same as the F0 spine); on prod, hand-paste the RLS (memory `prod-rls-manual-paste`).

---

## 5. The outer editorial page-header (design-doc chrome — do NOT build verbatim)
Above the `.desktop` mock: eyebrow `Omnischools · VLC batch · 02 of 05`; `.mvp-tag` `SHS · Dean of Students
view`; `.related-tag` `Roster, training, leadership development`; `<h1>Thirty-six <em>Peer Guides</em></h1>`
(56px); a long editorial lede (two-per-class, one-term tenure, class-vote + FM approval + Dean sign-off, Form
1 doesn't supply PGs, monthly training). Its facts are already carried by the in-app head-row + term-context +
training blocks. Not built as-is.

---

## 6. Section 02 — "Peer Guide vs Prefect" (editorial, NOT a build target)
`.section` 02 is a two-column editorial (`.editorial` article + `.notes` aside): *A Prefect holds authority.
A Peer Guide holds space.* It is an explainer, not a configurable surface — **do not build it in INCR-41.**
But it encodes **hard design constraints** the roster build must honour:
- **Selection legitimacy = the class vote.** "Don't appoint Peer Guides from above · the class election step
  is the source of legitimacy · skipping it makes a Peer Guide functionally a Prefect." → The **appoint**
  flow must run through nomination + vote (FM approval, Dean sign-off), **not** a naked Dean-assigns-anyone
  action. This shapes the appoint/vacancy mutations in §3.
- **PG service ≠ Prefect duty** (different timeslots/rooms/functions; a student can hold both) → do not
  model PG as a Prefect role or collapse them; a student may be both.
- **Recognition channel is separate.** "Don't recognise PGs in the same channel as Prefects · Prefects get
  badges at assembly, PGs get a sentence on the character paragraph." → the [INCR-43] character-paragraph hook;
  keep PG recognition **out** of any prefect/assembly channel.

---

## 7. Cross-module hooks (design commitments — preserve in the map)
- **Peer Guide eligibility ↔ class Form level.** F2/F3 supply PGs; **Form 1 never does** (structural, not a
  gap — "receiving in their first year, not asked to lead"). The roster reads the class form to decide slots
  (2) vs the "no PGs by policy" card.
- **PG rep gender ↔ student sex.** The default 1 boy + 1 girl per class reads `student.gender`
  (`houseGenderEnum` BOYS/GIRLS) — drives the boy/girl slot styling and the 17·17 balance card.
- **Training ↔ the intra-curriculum pairing (INCR-40).** The 19 May training "planning & running **Value 7B**
  · Patriotism→Service paired session block" mirrors the setup-spine's Value 7B ↔ 9B pairing. Same design
  commitment; keep the copy aligned.
- **Tenure/rotation ↔ WASSCE + the academic calendar.** F3 PGs roll off for WASSCE prep; the 2026/27 Semester
  1 selection cycle is calendared (15 Jul). Ties to the WASSCE module's F3 window.
- **Training-attendance threshold ↔ pastoral flag [INCR-42+].** "Below 80% training attendance triggers a Dean
  conversation · a pattern of absence may signal stepping aside." The threshold logic is INCR-41 (it reads
  training attendance); the *pastoral-flag* escalation it feeds is later. Record the threshold now; don't wire
  the flag yet.
- **[INCR-43] chains to note now (do not build):** PG service → the school-leaver **character paragraph** (the
  only parent-facing externalisation); a PG slot → the student's **journal / pastoral record**. The roster
  must not preclude these, but must not deep-link to them this increment.

---

## Open questions / drift log
1. **Nav label — already resolved by INCR-40.** Sidebar item is `Student support` (never "Pastoral"); the
   in-page crumb keeps "Pastoral & values". No new gate/role needed — `VLC_CONFIG_*_ROLES` +
   `DEAN_OF_STUDENTS` already exist and fit this surface.
2. **VLC now has two surfaces under one flat sidebar slot.** Recommend an **in-page VLC sub-nav (tabs)**
   `Setup · Peer Guides`, keeping the single flat `Student support` sidebar item (sidebar is under twelve
   items, so no section). Confirm the sub-nav shape and whether `Student support` points at a VLC landing or
   stays at `/senior/vlc/setup`.
3. **Does FORM_MASTER get a class-scoped write?** The surface makes the FM the class-vote holder, but the Dean
   ratifies. INCR-41 default: **Dean/Admin write, FM reads** (matches the shipped gate). Confirm before
   granting FM a scoped `Confirm vote` for their own class.
4. **Selection scheduling / history depth.** `Schedule 2026/27 Semester 1 selection`, `View selection
   history`, and the "cumulative this year"/"15 Jul" copy imply a selection engine + audit view. Recommend a
   **lightweight "record next selection date"** + a thin history list for INCR-41; defer a full election wizard.
   Confirm the intended depth.
5. **Class-detail + training-detail views are implied but not drawn.** `click any card for class detail` and
   the training-attendance capture need detail surfaces (modal/side-panel) that hold the appoint/remove/replace
   and mark-attendance mutations. Confirm they're in INCR-41 (they should be — they're where roster+training
   *edit* lives) and that class-detail does **not** deep-link to a student journal ([INCR-43]).
6. **Copy inconsistencies in the mock** (one student, two spellings): boy rep `Kwame Osei` (card) vs
   `Kwame Otoo` (callout); stepped-aside `Akosua M.` (slot) vs `Akosua Mensah` (callout). Render each
   student's real name consistently; these are mock artefacts, not two people.
7. **Training `topic` vs `topic` + `description`.** The README table lists only `topic`, but the surface shows
   a title **and** a description line per row. Widen to `topic` + `description` (or `detail`), or fold into
   `topic`. Kofi's call.
8. **`lead-card` is mostly [INCR-42/43].** Headline "led a peer-conversation" + tile 3 "hours of practice"
   (session facilitation) = **[INCR-42] omit-not-fake**; tile 4 "character ref" = **[INCR-43] stub/omit**;
   tiles 1–2 are roster/projection. Recommend rendering only the roster-derived slice (or a single summary
   line); never fabricate hours or session counts.
9. **Extract `SectionHead` + `SumCard` (and add a `warn` variant) to `components/vlc/chrome.tsx`.** They are
   currently local to `setup/page.tsx`; this surface needs both. Small DRY refactor of shipped INCR-40 code
   (no behaviour change) — confirm OK to touch the setup page's imports.
10. **Vacancy nomination storage.** The ≤4 candidates + scheduled vote date need a home (a
    `peer_guide_vacancy` + `peer_guide_nomination`, or folded onto the open slot). Kofi to model; the surface
    requires: open-slot marker, ≤4 candidate names, vote date, confirm→appoint (remainder-of-term tenure).

---

*Map produced against: `Surfaces/schoolup-vlc-peer-guides.html`; the shipped INCR-40 idiom
`app/(app)/senior/vlc/setup/page.tsx` (+ its local `SectionHead`/`SumCard`), `lib/vlc/setup-data.ts`,
`lib/vlc/defaults.ts`, `db/schema/vlc.ts`; `components/app/sidebar.tsx`; `lib/access.ts`
(`VLC_CONFIG_READ_ROLES` / `VLC_CONFIG_WRITE_ROLES`); the student/class fields in `db/schema/students.ts`;
the VLC schema block in `md files/README.md`; and the token vocabulary shared with
`docs/senior/ledger-surface-map.md` §0 and `docs/senior/vlc-f0-programme-setup-surface-map.md`.*
</content>
</invoke>
