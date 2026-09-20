# WASSCE Subject-Teacher + Mock Cycle — Surface Map (INCR-16 · Module 4.3)

**Author:** Lucy (design cartographer) · **Status:** design spec, ready for the implementation engineer (Claude Code).
**Increment:** INCR-16 — *Subject-teacher + mock cycle* · Module 4.3 · builds **on top of** the INCR-15 spine (candidates/subjects/programmes, migration 0051).
**Scope of this map:** the **subject-teacher cohort surface** (`schoolup-wassce-subject-teacher.html`, all 5 app-frame sections) **+** the **mock-cycle config section** of the setup surface (`schoolup-wassce-setup.html` §2, lines ~509–647).

**INCR-16 is the first WASSCE increment with WRITE surfaces.** Three write flows exist: **mock-cycle config** (admin schedules/configures a mock), **teacher mark-entry** (subject teacher enters mock raw score + grade for their assigned subject × cohort), and **HoA moderation** (Head of Academics overrides/co-signs a teacher's mock grade). Unlike INCR-15, controls that look like writes here mostly **are** writes — each is tagged read-only-display / **teacher-editable** / **HoA-moderate-only** / **admin-config** so Kofi/Wells confirm authz and Claude Code builds the right server action. Where the source HTML draws only the *display* of an already-marked mock (grade chips, raw scores in notes), the **edit / validation / moderation states are specified as DERIVED from the display + the increment's write requirement + house style** (reuse the score-ledger grid's input/validation/save mechanics) — every such derivation is called out inline.

## Source surfaces (visual source of truth — replicate 1:1)

| Surface file | Role in this map | Sections mapped |
|---|---|---|
| `Surfaces/schoolup-wassce-subject-teacher.html` | **PRIMARY.** Mr S. Asiedu's cohort view — his assigned subject × cohort, mock marks, per-subject predicted grades, class distribution, mark-entry entry point. | **All 5** app-frame sections (01–05) |
| `Surfaces/schoolup-wassce-setup.html` **§2 only** | **Mock-cycle config.** The mock timeline + predictive-accuracy + cohort-distribution config cards. | **§2 only** (lines ~509–647) |

**Tables this map reconciles against** (task-assigned; Wells confirms shape at INCR-16 migration):
- **`mock_exams`** — one row per mock cycle instance (Mock 1 / Mock 2 / … per school × cohort): name, window, method copy, status. Setup §2 timeline binds here.
- **`mock_results`** — one row per **candidate × subject × mock**: raw score, grade, moderated flag/grade/actor, entered-by. The subject-teacher trajectory table + histogram + credit/distinction stats bind here. **This is the write table.**
- **`benchmark_data_points`** — school/region/national comparison figures + data-quality tier. Section 05 + setup §2 predictive-accuracy bind here (mostly constants / DIRECTIONAL).
- **Reused (INCR-15 spine):** `senior_subject_teacher` (Asiedu's assignment — the authz scope), `wassce_candidates` (the 28), `wassce_subjects` (Chemistry), `wassce_programmes` (F3 Science track), `wassce_setup_frozen_at` (freeze read).

Every element below carries a **Binds to** line. Elements with **no clean binding** are collected in **Part F** and the **Open questions / drift log** (Part G).

## Explicitly OUT of scope (note existence, do NOT map/build)

| Item | Owner increment | Note |
|---|---|---|
| `wassce-setup` §1 (programmes/subjects), §4 (roster), §5 (anchors) | **INCR-15 — shipped** | See `docs/senior/wassce-spine-surface-map.md`. |
| `wassce-setup` §3 (university target system) | **INCR-17** | Tier bands, cut-offs, Dean guidance. |
| **Best-3 AGGREGATE projection** (agg 6→54, tier bands, KNUST-eligible aggregate, median aggregate) | **INCR-17** | Per-subject Mock-2 **predicted grade** is in-scope here; the cross-subject **aggregate** is NOT. Every aggregate figure on these surfaces is flagged below. |
| Cohort-readiness dashboard / parent / student surfaces | **INCR-18/19/20** | Whole-cohort (cross-subject) visibility is **INCR-18, NOT here** — this surface is one teacher × one subject × one cohort. |

---

## §0 — Shared chrome, tokens, type & no-alpha discipline

### 0.1 Token & type reference

The two surfaces declare the **identical `:root` palette** as INCR-15 (same hexes as `design-tokens.json` v1.0.0). **Reuse the INCR-15 token→Tailwind table verbatim** (`docs/senior/wassce-spine-surface-map.md` §0.1) — `--navy`/`--navy-2`/`--navy-3`, `--gold`/`--gold-soft`/`--gold-bg`, `--bg`/`--surface`, `--green`/`--green-bg`, `--terra`/`--terra-bg`, `--warn`/`--warn-bg`, `--border`/`--border-2`. **Do not re-derive.**

**Type families (identical to INCR-15):** `font-display` = **Fraunces** (headings, stat/grade numbers, section titles, italic gold `<em>`); `font-body` = **Manrope** (body, labels, names); `font-mono` = **JetBrains Mono** (index numbers `0184-0891`, dates in calendar strip, raw scores, %, counts, licence no `GA-TL-78423`, years). Headings weight 500 with italic gold `<em>` (e.g. `Chemistry · <em class="text-gold italic">F3</em> · my cohort`). Empty/missing = em-dash `—` in `text-navy-3`; currency `GHS 1,400` convention (not used on these two surfaces).

### 0.2 NEW bespoke palettes on this surface (NOT tokens — store as `lib/wassce/` constants)

Three colour scales appear here that are **not** in the token set and are **not** identical to INCR-15's opacity-stepped grading strip (INCR-15 §1.5 stepped `bg-green/gold/warn/terra` with `opacity-N`; this surface uses **distinct hexes** for a smoother 9-step gradient). **Reconcile with Kofi/Wells: reuse INCR-15's opacity approach OR store these as a `lib/wassce/grade-colors` constant.** They recur across grade chips, histogram bars, and heatmap cells.

**A. Grade-chip / distribution-bar scale (9-grade)** — `.grade-chip.{A1..F9}` and `.dist-bar.b-{a1..f9}`:

| Grade | Hex | Token? | Dist-bar note |
|---|---|---|---|
| A1 | `#1E5A35` | **bespoke** dark forest | — |
| B2 | `#2F6B47` | = `--green` | — |
| B3 | `#3D8059` | **bespoke** | — |
| C4 | `#7C9647` | **bespoke** olive | — |
| C5 | `#B59B3D` | **bespoke** gold-olive | — |
| C6 | `#C58A2E` | = `--warn` | — |
| D7 | `#C58A2E` | = `--warn` | dist-bar `opacity:0.4` → `opacity-40` |
| E8 | `#A8771F` (chip) | **bespoke** | dist-bar `#C58A2E opacity:0.3` → `opacity-30` |
| F9 | `#B84A39` | = `--terra` | dist-bar `--terra opacity:0.4` → `opacity-40` |

**B. Heatmap scale (6-step, DIFFERENT from A)** — `.heat-cell.h{0..5}`, count-driven not grade-driven:

| Class | Hex | Meaning | Count band |
|---|---|---|---|
| `h5` | `#1E5A35` | Strong | 14+ |
| `h4` | `#3D8059` | Good | 10–13 |
| `h3` | `#B59B3D` | Mixed | 6–9 |
| `h2` | `#C58A2E` (`--warn`) | Focus area | 3–5 |
| `h1` | `#B84A39` (`--terra`) | Critical gap | 0–2 |
| `h0` | `#FAF7F2` (`--bg`), text `--navy-3` | zero | 0 |

**C. Bespoke near-white row tints (Section 02, NOT tokens — arbitrary bg):**

| Class | Hex | Use | Port |
|---|---|---|---|
| `.stud-row.top` | `#F5FBF7` | top-3 rows | `bg-[#F5FBF7]` |
| `.stud-row.flagged` | `#FBEBE7` | FOCUS/risk rows | `bg-[#FBEBE7]` |
| `.stud-row.disrupted` | `#F5EBDC` (= `--gold-bg`) | **defined, unused by demo rows** — build for medical/disruption tier | `bg-gold-bg` |

### 0.3 No-alpha discipline — every translucency in scope (repo memory `no-alpha-token-opacity`)

All translucency here is either **CSS `opacity:` on a solid element** (port to `opacity-N` utility) or **shared-sidebar `rgba()` literals** (identical to INCR-15 §0.2 — reuse that table). **No slash-opacity on raw-hex tokens** (`bg-gold/8`, `bg-warn/40` render nothing). Verify in the **live preview**, not the build.

| Region | Raw value | Port to (NOT slash-opacity) |
|---|---|---|
| Sidebar nav (both surfaces) — label / active bg / group / dividers / url / dots | `rgba(250,247,242,0.7)` · `rgba(200,151,91,0.08)` · `rgba(232,212,184,0.5)` · `rgba(255,255,255,0.08/0.05/0.18)` | **Reuse INCR-15 §0.2 arbitrary-rgba ports verbatim.** |
| `.nav-item .ic` glyph | `opacity:0.8` on `currentColor` | `opacity-80` |
| Dist-bar D7 / E8 / F9 (§B.1) | `opacity:0.4 / 0.3 / 0.4` on solid bar | `opacity-40` / `opacity-30` / `opacity-40` |
| `.mock-row.future` (setup §2) | `opacity:0.85` on gradient row | `opacity-85` (row) — gradient itself is solid tokens |
| Calendar strip POST + F2 cells (§B.4) | `opacity:0.5` on `bg-bg` cell | `opacity-50` |
| Card box-shadows (`.desktop`, decorative) | `rgba(26,43,71,0.25)` | decorative shadow; arbitrary rgba or drop |

> **Note:** the setup §2 mock timeline `.mock-row.live` (gold gradient) and all §2 progress bars use **solid tokens** (green/gold/warn/terra/navy-3 fills at % widths) — no alpha. Only `.mock-row.future` carries `opacity`.

### 0.4 Two distinct nav contexts (build both; the real app nav wins where it differs)

These two surfaces render **different sidebars for different personas** — do not assume the INCR-15 admin nav.

- **Setup §2** uses the **admin operational nav** (Head of Academics persona) — identical to INCR-15: `Dashboard · Students · Classes & courses · Attendance · Boarding · Sickbay · WASSCE(active) →[Setup(active) · Cohort readiness · Student reports · Subject view · Live exam tracker] · Discipline · Communications · Reports`; footer `CO / C. Owusu-Ansah / Head of Academics`. **Reuse INCR-15 §0.3.** URL: `asankrangwa.omnischools.gh / wassce / setup / mocks`.
- **Subject-teacher surface** uses a **teacher-persona SECTIONED nav** (14 items > 12 → sectioning correct; groups `Teaching / Form Master / PLC / Other`). Verbatim, top→bottom:
  - **Teaching:** `My classes · Gradebook · Lesson plans · WASSCE 2026 (active) · Assignments`
  - **Form Master:** `My form · F3 Slessor · VLC sessions · Character paragraphs`
  - **PLC:** `Science HOD PLC · CPD points`
  - **Other:** `Communications · Calendar · Settings`
  - Brand: gold `.logo-mini` `A` + `Asankrangwa SHS` (`font-display 13px`) + meta `Mr S. Asiedu · Chem & Form Master` (`text-gold-soft 10px`). Nav-group label = `10px uppercase tracking-[0.14em] text-[rgba(232,212,184,0.5)] 600`. Active = `bg-[rgba(200,151,91,0.08)] text-bg border-l-2 border-gold`. **No footer/powered-by block on this surface.** `.sidebar` / `.sidebar.tall` min-height = demo-canvas sizing — ignore.
  - **Nav note:** this is the surface's own teacher demo nav. `WASSCE 2026` is the only in-scope item. The real Senior teacher nav wins where it differs; this map only asserts the WASSCE entry + the subject-teacher scope.

### 0.5 Shared in-app chrome

- `.desktop` → `.browser-bar` (navy, cosmetic dots + `.url`) → `.app-shell` (`sidebar 220px + main 1fr`). The outer editorial `.page-header` / `.section-head` / `.section-num` / `.section-meta` and the `.notes` right-rail are **design-doc chrome — do NOT build.** Build the in-app frame only (same rule as INCR-15 / ledger map).
- **`.head-row`** (`bg-surface border-b border-border`, `padding 20px 32px`): `.crumb` (`11px text-navy-3`, `<b>›</b>` separator `text-navy`) → `<h1 font-display 24px 500>` with gold italic `<em>` → right `.head-actions`.
- **`.btn` families:** `.btn` = `border-border-2 bg-surface text-navy 12px/600` (secondary); `.btn-primary` = `bg-navy text-bg`; `.btn-gold` = `bg-gold text-navy`.
- **`.body-shell`** = `padding 28px 32px 40px`.

---

# PART A — Setup §2 · Mock-cycle config (the admin-config write surface)

**Setup surface lines 509–647.** Section head (editorial, do-not-build): num `02` · title `Mock exam cycle · Mock 1 · Mock 2` · meta `Two predictive sittings · September → April`.
**Owner (RBAC):** Head of Academics (admin-config). **State on the frozen F3 cohort:** Mock 1 + Mock 2 **complete** (read-only history); config writes target the **F2/2027 cohort** ("Schedule Mock 2027 · F2").

### A.1 In-app page-head

| Element | Exact copy | Token / type / state |
|---|---|---|
| Crumb | `WASSCE · Setup · Mock cycle` (`WASSCE`, `Setup` are `<a>`) | `text-navy-3`; `<a>` `text-gold` |
| `<h1>` | `Mock exam ` + `<em>cycle.</em>` | `font-display 28px 500`; gold italic `<em>` |
| Lede | `Two predictive mocks across the academic year. **Mock 1 in November** sets a baseline; **Mock 2 in March** drives the readiness statement. Both run on simulated WAEC papers under exam conditions, marked by F3 subject teachers using WAEC mark schemes. The Mock 2 grade is the readiness statement's projected WASSCE grade.` | `text-navy-3 13px`; bolds `text-navy-2` |
| Action `Mock 1 results` | `Mock 1 results` | `.btn` — **read/nav** to Mock-1 results view. OK. |
| Action `Mock 2 results` | `Mock 2 results` | `.btn` — **read/nav** to Mock-2 results view. OK. |
| Action `Schedule Mock 2027 · F2` | `Schedule Mock 2027 · F2` | `.btn.primary` — **WRITE (admin-config).** Opens the mock-config flow for the **F2 cohort** (see A.5). On the frozen F3 cohort this is the only active write; F3 mocks are read-only history. |

> **Binds to:** the lede copy is static explainer. `Mock 1 results` / `Mock 2 results` nav to `mock_results` filtered by mock. `Schedule Mock 2027 · F2` creates a new `mock_exams` row for the F2 cohort.
> **Key design rule (from lede + §2 notes):** *"The Mock 2 grade is the readiness statement's projected WASSCE grade"* and *"Subject teachers mark their own students' papers."* This fixes two INCR-16 semantics: (1) **predicted grade = Mock-2 grade** (per subject; NOT a separate prediction field — confirm Part G Q4); (2) **mark-entry authz = the assigned subject teacher** (`senior_subject_teacher`).

### A.2 Mock timeline (`.mock-timeline`) — 4 rows — `mock_exams`

White card, `rounded-xl border-border`, rows divided by `border-border`. Each `.mock-row` = `grid-cols-[100px_1fr_1fr_auto]`, `gap 22px`:
- `.mr-when` — `font-mono 13px 700 text-navy` + `.mr-date` (block, `9px uppercase tracking-[0.08em] text-navy-3`, Manrope)
- `.mr-title` — `font-display 16px 600` with gold italic `<em>` + `.mr-sub` (block, `11px italic text-navy-3` Manrope)
- `.mr-method` — `11px text-navy-2 leading-[1.55]`, bolds `text-navy`
- `.mr-status` — pill `9px uppercase tracking-[0.12em] 700 rounded-full`

**Status pills (`.mr-status`):** `.complete` = `bg-green-bg text-green` · `.live` = `bg-gold text-navy` · `.future` = `bg-bg text-navy-3 border border-border-2`.
**Row-state backgrounds:** default = `bg-surface` · `.mock-row.live` = `bg-[linear-gradient(90deg,var(--gold-bg),var(--surface))]` · `.mock-row.future` = `bg-[linear-gradient(90deg,var(--bg),var(--surface))] opacity-85`.

| # | `.mr-when` / `.mr-date` | `.mr-title` (em) / `.mr-sub` | `.mr-method` (verbatim) | `.mr-status` |
|---|---|---|---|---|
| 1 | `Nov 2025` / `Semester 1 · Week 10` | `Mock 1` / `Baseline diagnostic · 24 papers across 10 days` | `**Methodology.** Past WAEC papers (2022, 2023) administered under exam conditions. Marked by F3 teachers using official WAEC mark schemes. **Purpose:** identify cohort weaknesses early in F3 with enough time to remediate before Mock 2.` | `Complete` (`.complete`) |
| 2 | `Mar 2026` / `Semester 2 · Week 11` | `Mock 2` / `Predictive sitting · 24 papers · readiness statement source` | `**Methodology.** Custom papers commissioned from a panel of 3 retired WAEC examiners. Set to mirror anticipated WASSCE 2026 difficulty. **Purpose:** the grade each student gets here is the projected WASSCE grade that drives their readiness statement and university match.` | `Complete` (`.complete`) |
| 3 (`.live`) | `May 13–Jun 19` / `2026 · live` | `WASSCE 2026` / `The real thing · 30 days · Day 2 today` | `**Source of truth.** Replaces all Mock projections once results arrive. WAEC release window for 2025 was 5 Aug 2025; expect 2026 results by **early Aug 2026**. School posts results on this surface within 24 hours of WAEC release.` | `Day 2 live` (`.live`) |
| 4 (`.future`) | `Nov 2026` / `Semester 1 2026/27` | `Mock 1 · F2 cohort` / `Next cohort's baseline · F2 students tracking toward 2027` | `Schedule auto-set 7 weeks into Semester 1. Papers ordered from same examiner panel in October. **Cohort:** the 245 students currently in F2 (counted at end of Semester 2 attendance freeze).` | `Scheduled` (`.future`) |

> **Binds to `mock_exams`:** each row = one row — `label` ("Mock 1"/"Mock 2"), `cohort` (F3-2026 / F2-2027), `window_start`/`window_end` (the `.mr-when` dates), `paper_count` (24), `method` (the `.mr-method` copy — could be a stored text field or a template constant), `status` enum. **Suggested `status`: `COMPLETE` (green) · `LIVE` (gold) · `SCHEDULED`/`FUTURE` (grey).**
> - Row 3 (`WASSCE 2026`) is **not a mock** — it is the live-exam anchor row shown for context. Bind its status (`Day 2 live`) to `wassce_paper_sittings` / a runtime flag, **not** `mock_exams`. Render as **static schedule copy** in INCR-16 (same treatment as INCR-15's live banner — do NOT build a live clock). Flag Part F.
> - Row 4 (F2 Mock 1) = a **future/scheduled** `mock_exams` row auto-created 7 weeks into Semester 1. `245 F2 students` count binds to the F2 roster (attendance-freeze snapshot) — cross-cohort, may be `—` if F2 not yet registered. Flag.
> - `.mr-status.future` **is the config write target** — "Schedule Mock 2027 · F2" (A.1) creates/edits this row.

### A.3 Predictive-accuracy card (`.card`) — `benchmark_data_points` (constant / historical)

`.card` white, `rounded-lg border-border`. Head: `.ch-title` `Mock 2 → WASSCE <em>predictive accuracy</em>` · `.ch-meta` `5-year track record · 2021–2025`. Body = 5 stacked bar rows (`grid-cols-[60px_1fr_60px]`), each: year (`font-mono 700 text-navy`) + track (`bg-bg h-14px rounded-full`, `.fill bg-green` at width%) + value (`font-mono 700 right`).

| Year | Fill width | Value | 
|---|---|---|
| `2021` | 73% | `73%` |
| `2022` | 78% | `78%` |
| `2023` | 81% | `81%` |
| `2024` | 79% | `79%` |
| `2025` | 82% | `82%` |

Callout below (`bg-green-bg rounded-lg border-l-3 border-green`, `11px text-navy-2`): `**Mock 2 lands within 1 grade of WASSCE about 80% of the time.** The other 20% mostly drift downward (WASSCE harder than Mock 2 for that student), with 6–8% drifting upward. The readiness statement explicitly states the historical drift to set parent expectations.`

> **Binds to `benchmark_data_points`** (or a `lib/wassce/` constant): 5 years of Mock2→WASSCE accuracy. **No live data path in INCR-16** — this is historical school-internal record (needs 5 years of matched mock↔WASSCE pairs, which do not exist in-DB yet). **Render as a `benchmark_data_points` constant set** seeded per school, OR a `lib/wassce/` constant if not school-specific. Flag Part F: **directional / seeded, not computed here.**

### A.4 Cohort-distribution card (`.card`) — AGGREGATE → **INCR-17 flag**

Head: `.ch-title` `Mock 2 <em>cohort distribution</em> · Mar 2026` · `.ch-meta` `240 candidates · aggregate distribution`. Body = 5 stacked bar rows (`grid-cols-[90px_1fr_50px]`): band label + count-driven fill + count (`font-mono 700`).

| Band label (`<b>`) / sub-caption | Fill / colour | Count |
|---|---|---|
| `Agg. 6–12` / `Top tier` | 16% · `bg-green` | `39` |
| `Agg. 13–18` / `Very good` | 38% · `bg-gold` | `91` |
| `Agg. 19–24` / `Fair · Legon limit` | 31% · `bg-warn` | `74` |
| `Agg. 25–36` / `Weak · tech track` | 13% · `bg-terra` | `32` |
| `Agg. 37+` / `No tertiary path` | 1.7% · `bg-navy-3` | `4` |

Footer (`border-top`, `11px text-navy-3`): `**Median Mock 2 aggregate: 18.** Mean 18.7. **54% in 13–24 range** — the bulk of the cohort. 16% in Legon-competitive range. 4 students projected without a tertiary path; the Dean is running individual exit-planning conversations with each.`

> **FLAG — this whole card is best-3 AGGREGATE math = INCR-17, NOT INCR-16.** The band labels (`Agg. 6–12 … 37+`), the median/mean aggregate, and "Legon-competitive" tiers all require the cross-subject best-3-cores + best-3-electives aggregate that **INCR-17** computes. **INCR-16 must NOT compute or store any aggregate.** Options: (a) render this card as **deferred / "available after INCR-17"**, or (b) render from a **seeded `benchmark_data_points` cohort-distribution row** (directional) until INCR-17 wires the real aggregate. Do **not** derive it from `mock_results` in INCR-16 (that would smuggle aggregate math into this increment). Confirm with Kofi which. (The **per-subject** Mock-2 grade distribution — Section 01 histogram, §B.1 — IS in scope; that is subject-level, not aggregate.)

### A.5 Mock-config WRITE states (admin-config; DERIVED spec)

The source draws the timeline read-only; the config write is the `Schedule Mock 2027 · F2` button. **Build the config flow following house style** (a form/modal, reuse the setup surface's `.card` + `.btn` chrome):

| State | Spec |
|---|---|
| **default / read** | Timeline rows render at their `mock_exams.status`; F3 Mock 1/2 = `Complete` read-only history. |
| **config (admin)** | `Schedule Mock 2027 · F2` opens a form: `label`, `cohort` (F2), `window_start`/`window_end` (native `<input type="date">`), `paper_count`, optional `method` text. **Authz: Head of Academics only** (`assertAnyRole` — HEADMASTER / VICE_HEADMASTER_ACADEMIC / ADMIN; NOT subject teacher). |
| **validation-error** | `window_end ≥ window_start`; `paper_count > 0`; no overlapping mock window for the same cohort. Inline error `text-terra`. |
| **saved** | New `.mock-row.future` (`Scheduled` pill) appended; audit-log the create. |
| **frozen** | Mock rows for a frozen cohort (`wassce_setup_frozen_at IS NOT NULL`) are **read-only** — config disabled with the frozen affordance (reuse INCR-15 §5.4 freeze read). |

---

# PART B — Subject-teacher surface (5 app-frame sections)

**Route (all 5 sections):** `omnischools.gh/asankrangwa/wassce/teacher/asiedu/chemistry-f3` with anchors `#students · #heatmap · #plan · #benchmark`. **One route, five anchored regions** (mirror INCR-15's single-page-with-anchors precedent). **Routing flag (Part G):** the demo URL embeds `asiedu` (a teacher id) — a real teacher route must **scope to the session teacher** (`/senior/wassce/my-cohort` or similar), NOT expose/accept an arbitrary teacher id in the URL (authz leak). Subject/cohort come from `senior_subject_teacher` for the logged-in teacher.

**Persona/authz for the whole surface:** Mr S. Asiedu — TEACHER + FORM_MASTER + HOD Science. He sees **only his assigned subject × cohort** (Chemistry × F3 Science, 28 candidates), scoped by `senior_subject_teacher`. **Whole-cohort / cross-subject visibility is INCR-18, NOT here.** The HoA (C. Owusu-Ansah) appears as the **moderation / co-sign authority** (§B.4 "Share with Mrs Owusu-Ansah").

---

## §B.1 — Section 01 · My cohort (teacher identity + countdown + distribution histogram)

**Surface lines 222–384.** Editorial head (do-not-build): `01 · My cohort · Chemistry F3 Science · 28 candidates · Mr S. Asiedu · 24 days to paper · 100% credit rate`. URL `…/chemistry-f3`.

### §B.1.1 In-app page-head

| Element | Exact copy | Token / state |
|---|---|---|
| Crumb | `WASSCE 2026 › Chemistry · F3 Science` | `text-navy-3`; `›` `text-navy` |
| `<h1>` | `Chemistry · ` + `<em>F3</em>` + ` · my cohort` | `font-display 24px`; gold italic `<em>` |
| Action `Mark Mock 3 papers` | `Mark Mock 3 papers` | `.btn` — **WRITE (teacher-editable).** Entry point to mark-entry (see Part C). Scoped to Asiedu's Chemistry × F3 SCI. |
| Action `Topic teaching log` | `Topic teaching log` | `.btn` — nav/write to a teaching-log surface (topic coverage). **Out of INCR-16 tables** — treat as nav-inert or flag. |
| Action `Export intervention plan` | `Export intervention plan` | `.btn.gold` — **read/export** (PDF of §B.4 plan). OK. |

### §B.1.2 Teacher identity card (`.teacher-card`)

`grid-cols-[auto_1fr_auto]`, white `rounded-xl border-border`. Avatar `.t-avatar` = 60px `rounded-xl`, `bg-[linear-gradient(135deg,var(--navy),var(--navy-2))] text-gold font-display 22px`, initials `SA`.

| Element | Exact copy | Token |
|---|---|---|
| `.t-name` | `Mr S. ` + `<em>Asiedu</em>` | `font-display 22px 500`; gold italic `<em>` |
| `.t-meta-row` (5 items, bolds `text-navy`) | `**Subject** · Chemistry · F3` · `**Form Master** · F3 Slessor` · `**HOD Science**` · `**NTC Licence** · GA-TL-78423 · valid to 2028` · `**PLC** · Science HOD PLC · 12 sessions YTD` | `12px text-navy-3` |
| `.t-pill` | `28 candidates assigned` | `bg-gold-bg text-gold 11px 600 rounded-full` |

> **Binds to `senior_subject_teacher`** (the assignment: teacher × subject `Chemistry` × cohort `F3 SCI`; `28 candidates assigned` = count of `mock_results`/candidates in scope). `Form Master · F3 Slessor`, `HOD Science`, `NTC Licence GA-TL-78423`, `PLC · 12 sessions YTD` = **teacher-profile / cross-module (HR/NTC) fields — NOT in the 3 INCR-16 tables.** Render from the teacher/staff record if present, else static. Flag Part F.

### §B.1.3 Countdown strip (`.summary-strip`) — 5 cells

`grid-cols-5`, each `.ss-cell` white `rounded-lg border-border` with optional coloured left border (`.live`=terra, `.gold`=gold, `.green`=green, `border-left:3px`). Label `10px uppercase tracking-[0.14em] text-navy-3 600`; value `font-display 28px 500` (colour variant `.terra/.green/.gold`); meta `11px text-navy-3`.

| # | Class | Label | Value | Meta | Binds to |
|---|---|---|---|---|---|
| 1 | `.live` (terra) | `Days to Chemistry paper` | `24` (`text-terra`) | `Mon 8 Jun · 08:00 · Paper 1+2 combined · 3 hrs` | Countdown = paper date − today. Paper date/session ← `wassce_paper_sittings` (Chemistry). **Subject clock**, not last-paper clock. |
| 2 | `.green` | `Mock 2 credit rate` | `100%` (`text-green`) | `28 / 28 at C6 or better · school-wide best` | `count(mock_results grade ≤ C6) / 28` for Mock 2 · Chemistry. In scope. |
| 3 | `.gold` | `Mock 2 distinction rate` | `43%` (`text-gold`) | `12 / 28 at A1 or B2 (vs cohort avg 31%)` | `count(grade ∈ {A1,B2}) / 28`. The `31%` cohort-avg comparison = cross-subject school avg → `benchmark_data_points`. In scope for the 43%; the 31% is benchmark. |
| 4 | (default) | `Mock 2 cohort mean` | `B3` | `↑ 1 grade from Mock 1 · ranked best in region` | Mean grade across the 28 Mock-2 Chemistry grades (subject-level, NOT aggregate). `↑ 1 grade from Mock 1` = Mock1-mean vs Mock2-mean. `ranked best in region` = `benchmark_data_points` (directional). |
| 5 | (default) | `Practical · 22 Apr` | `28/28` | `All candidates sat · awaiting marking` | **Practical-paper attendance** (sat/not-sat count), NOT a score. Needs a practical-sitting flag on `mock_results` or a separate practical record. Flag Part F. |

> **Binds to `mock_results`** (Mock 2 · Chemistry · the 28): cells 2/3/4 are subject-level derived stats — **in scope** (per-subject, not aggregate). Cell 1 = `wassce_paper_sittings`. Cell 5 = practical attendance (no clean binding). The "vs cohort avg 31%" / "ranked best in region" comparators are `benchmark_data_points` (directional).

### §B.1.4 Distribution histogram (`.dist-grid`)

White `rounded-lg border-border padding 24px 28px`. Head: `.dist-title` `Grade distribution · Mock 1 → Mock 2 → Chemistry paper` · `.dist-meta` `28 candidates · 9-grade scale`. Bars = `grid-cols-9`, `height 200px`, `border-b border-border`. Each `.dist-bar-col`: `.dist-bar.b-{grade}` (height% + palette A, §0.2A) with `.dist-bar-num` (count, `font-display 14px 600 text-navy`, `top:-22px`) + `.dist-bar-grade` (`font-display 13px 600`; `.dim text-navy-3` when count 0).

| Grade | Bar height | Count (`.dist-bar-num`) | Grade label |
|---|---|---|---|
| A1 | 14% | `4` | `A1` |
| B2 | 29% | `8` | `B2` |
| B3 | 32% | `9` | `B3` |
| C4 | 14% | `4` | `C4` |
| C5 | 7% | `2` | `C5` |
| C6 | 4% | `1` | `C6` |
| D7 | 1% | (none) | `D7` (`.dim`) |
| E8 | 1% | (none) | `E8` (`.dim`) |
| F9 | 1% | (none) | `F9` (`.dim`) |

Summary row (`grid-cols-3`, `.dist-sum-cell`, `b` = `font-display 18px 600 block`; `.green b` = `text-green`):

| Cell | Bold lead | Body |
|---|---|---|
| 1 (`.green`) | `21 / 28 above credit` | `75% at C4 or better — top quartile entry to tertiary` |
| 2 | `12 / 28 distinction` | `43% at B2 or better — strongest subject in F3 SCI cohort` |
| 3 | `3 / 28 borderline` | `C5–C6 band — focus zone for final 24 days` |

> **Binds to `mock_results`** — the Mock-2 · Chemistry grade histogram (counts per grade; 4+8+9+4+2+1 = 28). **In scope** (per-subject distribution). Title says "Mock 1 → Mock 2 → Chemistry paper" but bars render **Mock 2 only** (the "Chemistry paper" third series is future/empty until WASSCE results). Bar height% is a **display scale**, not stored — derive from count/max. The `.dim` grade labels (D7/E8/F9, count 0) use the **empty-band** treatment (grey, no number) — this is the histogram's "empty" state per grade.

---

## §B.2 — Section 02 · The candidate trajectory table (THE mark-entry surface)

**Surface lines 386–596.** Editorial head: `02 · 28 candidates · Mock 1 → Mock 2 → paper status · Sortable · filterable · 9 sample rows shown`. URL `…#students`. **This is the core write surface** — the source draws the read (grade chips + notes); Part C specifies the derived edit/validation/moderation states.

### §B.2.1 In-app page-head

| Element | Exact copy | Token / state |
|---|---|---|
| Crumb | `Chemistry F3 › Candidates` | `text-navy-3` |
| `<h1>` | `28 ` + `<em>candidates</em>` | `font-display 24px`; gold italic |
| Action `Sort by Mock 2 grade` | `Sort by Mock 2 grade` | `.btn` — client view-state (sort). No write. |
| Action `Filter · house` | `Filter · house` | `.btn` — client view-state (filter by boarding House). No write. |
| Action `Filter · risk` | `Filter · risk` | `.btn` — client view-state (filter FOCUS/flag). No write. |

> Sort/filter are **client view-state over the read** (URL query-param, mirror `GradebookSelectors`) — safe interactive, no mutation. `Sort by Mock 2 grade` binds to `mock_results` grade. `Filter · house` binds to `wassce_candidates`→House (F0, INCR-15). `Filter · risk` binds to the FOCUS flag (derived, §B.2.3).

### §B.2.2 Table structure (`.stud-table`)

White `rounded-lg border-border overflow-hidden`. Head + rows share `grid-cols-[42px_1.5fr_80px_80px_100px_100px_1fr_100px]`, `gap 12px`. Head (`.stud-head`): `bg-bg border-b border-border`, `10px uppercase tracking-[0.12em] text-navy-3 600`.

**Header columns (8, verbatim + alignment):**

| Col | Header | Align | Cell content |
|---|---|---|---|
| 1 | `#` | left | `.stud-num` (`font-mono 11px 600 text-navy-3`, 2-digit rank) |
| 2 | `Name & house` | left | `.stud-name` (`600` + optional `.stud-flag-mini`) + `.stud-name-meta` (`11px text-navy-3`: House · index · optional target/agg/accommodation) |
| 3 | `Mock 1` | center | `.grade-chip.{grade}` (30px, palette A) |
| 4 | `Mock 2` | center | `.grade-chip.{grade}` |
| 5 | `Trajectory` | center | `.stud-traj-arrow` (`13px 700`; `.down text-terra` · `.flat text-navy-3` · default `text-green`) |
| 6 | `Practical` | center | `.stud-paper` (`11px text-navy-3`; `.late text-gold 600`) |
| 7 | `Teacher note` | left | `.stud-comment` (`11px text-navy-2`, bold lead `text-navy`) |
| 8 | `Action` | left | `.stud-action` (`11px text-gold 600 right`) |

**Flag mini-badges (`.stud-flag-mini`, `9px 700 tracking-[0.06em] rounded-full`):** `.med` `bg-terra-bg text-terra` (`MED`) · `.acc` `bg-gold-bg text-gold` (`SC-7`) · `.risk` `bg-warn-bg text-warn` (`FOCUS`) · `.top` `bg-green-bg text-green` (**defined, unused by demo rows** — build for a top-of-cohort tag).
**Row tints:** `.top` `bg-[#F5FBF7]` (top-3) · `.flagged` `bg-[#FBEBE7]` (FOCUS) · `.disrupted` `bg-gold-bg` (**defined, unused** — medical/disruption tier).
**Trajectory copy is contextual for `.flat`:** `→ holding` (good grades held) vs `→ stuck` (borderline held) — same class, different label; derive from grade band, or store the label. `↑ N grade` (green, up) · `↓ N grade` (terra, down).

**Demo rows (verbatim — 9 sample + summary):**

| # | Row tint | Name (+flag) | `.stud-name-meta` | Mock 1 | Mock 2 | Trajectory | Practical | Teacher note (bold lead) | Action |
|---|---|---|---|---|---|---|---|---|---|
| 01 | `.top` | `E. Mensah` `SC-7` | `Aggrey · 0184-0891 · accommodation 15min` | `A1` | `A1` | `→ holding` (flat) | `Sat 22 Apr` | `**Top of cohort.** Mock 2 raw 96/100. Predicted A1.` | `View profile` |
| 02 | `.top` | `Y. Aidoo` `MED` | `Slessor · 0184-0817 · KNUST Biochem target` | `B2` | `A1` | `↑ 1 grade` | `Sat 22 Apr` | `**Strong organic chem.** Currently hospitalised; Chem paper 24 days out.` | `Student page` |
| 03 | `.top` | `K. Owusu` | `Slessor · 0184-0824` | `B2` | `A1` | `↑ 1 grade` | `Sat 22 Apr` | `Strongest on physical chem. Recommend A1 path.` | `View profile` |
| 04 | (none) | `J. Tetteh` | `Aggrey · 0184-0823 · Mock 2 agg 14` | `B2` | `B2` | `→ holding` (flat) | `Sat 22 Apr` | `Steady B2. Organic strong, inorganic weaker.` | `View profile` |
| 05 | (none) | `N. Asare` | `Kufuor · 0184-0846` | `B3` | `B2` | `↑ 1 grade` | `Sat 22 Apr` | `Improvement on equilibria after Semester 2 tutoring.` | `View profile` |
| 06 | (none) | `M. Boateng` | `Nkrumah · 0184-0833` | `C4` | `B3` | `↑ 1 grade` | `Sat 22 Apr` | `Strong reaction kinetics; weaker on stoichiometry.` | `View profile` |
| 07 | `.flagged` | `A. Bonsu` `FOCUS` | `Aggrey · 0184-0858` | `C5` | `C5` | `→ stuck` (flat) | `Sat 22 Apr` | `**Risk of C6.** Inorganic at D7, organic at C4. Plan: 8 hrs after-school tutoring.` | `Tutoring slot` |
| 08 | `.flagged` | `P. Mensah` `FOCUS` | `Slessor · 0184-0867` | `C4` | `C5` | `↓ 1 grade` (down) | `Sat 22 Apr` | `**Concerning slip.** Mock 2 raw 47/100. Organic and inorganic both weak.` | `Conference` |
| 09 | `.flagged` | `D. Awuku` `FOCUS` | `Kufuor · 0184-0871` | `C5` | `C6` | `↓ 1 grade` (down) | `Sat 22 Apr` | `**Only C6 in cohort.** Risk of D7 without final 24-day push.` | `Tutoring slot` |
| — | summary | `colspan` full-width, centered italic `11px text-navy-3` | `+ 19 more candidates · scroll to see full cohort` | | | | | | |

> **Binds to (per column):**
> - **#** → display rank (client-derived, sort order). Not stored.
> - **Name & house** → `wassce_candidates.student_id`→`students` (name); `.stud-name-meta` = House (F0) · `index_number` (`0184-0891`, INCR-15) · optional tail. **The optional tails cross increments:** `KNUST Biochem target` = **INCR-17** (university target — display-only if present, do NOT build here); `Mock 2 agg 14` = **best-3 AGGREGATE = INCR-17** (flag: do NOT compute; render `—`/omit until INCR-17); `accommodation 15min` = SC-form accommodation (INCR-15, `wassce_candidates`).
> - **Mock 1 / Mock 2** → `mock_results.grade` for (candidate × Chemistry × mock). **In scope — the write columns.** Chip colour = palette A.
> - **Trajectory** → **derived** from Mock1 vs Mock2 grade (not stored). ↑/→/↓ + delta count.
> - **Practical** → practical-paper **sat/not-sat** (attendance), `.late` variant if sat late. Not a score. No clean binding — flag.
> - **Teacher note** → `mock_results.teacher_note` (free text; bold lead is inline `<b>`). Contains raw scores ("raw 96/100", "raw 47/100") = `mock_results.raw_score` surfaced in prose. **Teacher-editable.**
> - **Flags:** `MED` ← `wassce_candidates.reg_status = ON_MEDICAL` (INCR-15, cross-ref); `SC-7` ← accommodation/`sc_form` (INCR-15); `FOCUS` ← intervention tier (derived from Mock-2 grade band, §B.4). Row `.top` = top-3 rank; `.flagged` = FOCUS.
> - **Action** → per-row nav: `View profile`/`Student page` (→ student surface, INCR-20); `Tutoring slot`/`Conference` (→ scheduling — out of INCR-16, nav-inert or flag).

### §B.2.3 Predicted grade & derived flags (in-scope vs out)

- **Per-subject Mock-2 predicted grade — IN SCOPE.** "Predicted A1" (row 01) = the Mock-2 grade is the projected WASSCE grade per A.1 design rule. Bind predicted = **moderated-or-raw Mock-2 grade** (Chemistry). This is subject-level, NOT aggregate.
- **`Mock 2 agg 14` (row 04) — OUT (INCR-17).** Best-3 cross-subject aggregate. Do NOT compute here.
- **`KNUST Biochem target` (row 02) — OUT (INCR-17).** University target.
- **FOCUS tier — IN SCOPE (derived).** Borderline C5–C6 (Mock 2) = the "focus zone" (matches §B.1.4 "3/28 borderline C5–C6"). Rows 07/08/09 are the 3 FOCUS candidates.

---

## §B.3 — Section 03 · Topic heatmap

**Surface lines 598–815.** Editorial head: `03 · Topic heatmap · where the cohort needs attention · 12 topics × 6 sub-areas · derived from Mock 2 marking`. URL `…#heatmap`.

### §B.3.1 Page-head + structure

| Element | Exact copy | Token / state |
|---|---|---|
| Crumb | `Chemistry F3 › Topic heatmap` | `text-navy-3` |
| `<h1>` | `Where the ` + `<em>cohort</em>` + ` is weak` | `font-display 24px`; gold italic |
| Action `Compare to Mock 1` | `Compare to Mock 1` | `.btn` — read/view-toggle (Mock 1 vs Mock 2 heat). No write. |
| Action `Export topic plan` | `Export topic plan` | `.btn` — read/export. OK. |

`.topic-grid` white `rounded-lg border-border padding 22px 26px`. Each `.topic-row` = `grid-cols-[1.5fr_repeat(6,1fr)]`, `border-b border-border`. Head row (`.head`): `10px uppercase text-navy-3 600`.

**Header:** `Topic` · `A1 band` · `B2–B3` · `C4–C6` · `D7–E8` · `F9` · `Cohort avg` (5 grade-band count columns + avg).
**Heat cells** (`.heat-cell.h{0..5}`, palette B §0.2B, count-driven): `h5` 14+ · `h4` 10–13 · `h3` 6–9 · `h2` 3–5 · `h1` 0–2 · `h0` 0. The **avg** column renders a grade with the matching heat class.

**10 topic rows (verbatim — name / meta / 5 band counts / avg):**

| Topic | Meta (`.topic-name-meta`) | A1 | B2–B3 | C4–C6 | D7–E8 | F9 | Avg |
|---|---|---|---|---|---|---|---|
| Organic chemistry | `12 questions · 24% of paper` | 12 (h5) | 11 (h4) | 5 (h2) | 0 (h0) | 0 (h0) | B2 (h4) |
| Inorganic chemistry · transition metals | `8 questions · 16% of paper` | 9 (h5) | 10 (h4) | 7 (h3) | 2 (h1) | 0 (h0) | B3 (h3) |
| Stoichiometry & mole concept | `6 questions · 12% of paper` | 10 (h5) | 12 (h4) | 6 (h2) | 0 (h0) | 0 (h0) | B2 (h4) |
| Atomic structure & bonding | `5 questions · 10% of paper` | 8 (h5) | 13 (h4) | 7 (h3) | 0 (h0) | 0 (h0) | B3 (h3) |
| Acids · bases · salts | `5 questions · 10% of paper` | 11 (h5) | 10 (h4) | 6 (h2) | 1 (h0) | 0 (h0) | B2 (h4) |
| Equilibria · Le Chatelier | `5 questions · 10% of paper` | 4 (h3) | 9 (h3) | 12 (h2) | 3 (h1) | 0 (h0) | C4 (h2) |
| Electrochemistry | `4 questions · 8% of paper` | 3 (h2) | 8 (h3) | 12 (h2) | 4 (h1) | 1 (h0) | C5 (h1) |
| Reaction kinetics | `3 questions · 6% of paper` | 7 (h4) | 11 (h4) | 9 (h3) | 1 (h1) | 0 (h0) | B3 (h3) |
| Energetics & thermochemistry | `3 questions · 6% of paper` | 6 (h4) | 9 (h3) | 10 (h2) | 3 (h1) | 0 (h0) | C4 (h2) |
| Industrial chemistry · contemporary issues | `2 questions · 4% of paper` | 7 (h4) | 12 (h4) | 8 (h3) | 1 (h0) | 0 (h0) | B3 (h3) |

**Legend** (below, `grid-cols-5`, `11px text-navy-3`): `14+ Strong` (h5) · `10–13 Good` (h4) · `6–9 Mixed` (h3) · `3–5 Focus area` (h2) · `0–2 Critical gap` (h1).

> **FLAG — NO clean binding in the 3 INCR-16 tables.** The heatmap needs a **per-candidate × per-topic** score breakdown (each row distributes the 28 candidates across bands *for that topic*; e.g. Organic 12+11+5+0+0 = 28). `mock_results` as scoped (candidate × subject × mock → one grade) does **not** carry topic granularity. This requires either (a) a **`mock_result_topic`** breakdown table (candidate × mock × topic → band), or (b) a JSON topic-breakdown column on `mock_results`, or (c) **deferral** of Section 03 to a later increment. The topic list + weights (`12 questions · 24% of paper`) is a **WAEC-syllabus constant** (`lib/wassce/chemistry-topics` — per subject). **Confirm with Kofi/Wells whether topic granularity is in INCR-16 scope or deferred.** The section header says "12 topics × 6 sub-areas" but only **10 rows** render (design drift — 10 topics shown, not 12). Reading a heat cell = count-of-candidates-in-band; the avg column = "the grade most students would earn if the paper were only this topic."

---

## §B.4 — Section 04 · Final 24 days · differentiated intervention plan

**Surface lines 817–993.** Editorial head: `04 · Final 24 days · differentiated intervention plan · 3 tiers · 28 candidates · 24 days · 6 lessons remaining`. URL `…#plan`.

### §B.4.1 Page-head

| Element | Exact copy | Token / state |
|---|---|---|
| Crumb | `Chemistry F3 › 24-day plan` | `text-navy-3` |
| `<h1>` | `The ` + `<em>final</em>` + ` 24 days` | `font-display 24px`; gold italic |
| Action `Save plan` | `Save plan` | `.btn` — **WRITE (teacher-editable).** Persists the intervention plan. **No INCR-16 table** for the plan — flag (needs `intervention_plan` or defer). |
| Action `Share with Mrs Owusu-Ansah` | `Share with Mrs Owusu-Ansah` | `.btn.primary` — **WRITE (teacher→HoA).** Routes the plan to the Head of Academics for **co-sign / moderation**. |

### §B.4.2 Tier cards (`.iv-grid`) — 3 cards

`grid-cols-3`. Each `.iv-card` white `rounded-lg border-border`, coloured `border-top:3px` (`.urgent` terra · `.focus` gold · `.consolidate` green). `.iv-eyebrow` (`10px uppercase 600`; `.urgent` terra, `.focus` gold, `.consolidate` green) + `.iv-title` (`font-display 16px 500`) + `.iv-students` (`12px text-navy-2 border-b`, bolds `text-navy`) + `.iv-plan` (`12px text-navy-2`, gold `·` bullets).

| Card | `.iv-eyebrow` | `.iv-title` | `.iv-students` (verbatim) | `.iv-plan` bullets (verbatim) |
|---|---|---|---|---|
| `.urgent` | `Tier 1 · urgent intervention` | `3 candidates · borderline credit` | `**A. Bonsu** (Aggrey · C5) · **P. Mensah** (Slessor · C5, slipping) · **D. Awuku** (Kufuor · C6, only one in cohort)` | `**Plan over 24 days:**` — `8 hrs after-school tutoring (Mon + Wed, 16:00–17:00, weeks 1–4)` · `Pair-tutor with K. Owusu (top-3 student) for inorganic — Saturday mornings` · `Daily 20-min question set on weakest topic (equilibria + electrochem)` · `Weekly parent SMS update (drafted by FM, sent by Omnischools)` · `Pre-paper boost session · Fri 5 Jun · 14:00–16:00` |
| `.focus` | `Tier 2 · focused improvement` | `12 candidates · move B3 → B2 or B2 → A1` | `**9 currently at B3** + **3 newly at B2 (Mock 2)** · all within reach of one grade lift in 24 days` | `**Plan over 24 days:**` — `Whole-class focus on equilibria + electrochem (2 lessons each)` · `WAEC past-paper practice · weekly · marked by Mr Asiedu` · `Topic-specific resource pack (notes + 50 questions + worked solutions per topic)` · `Peer Guide pairs from F2 Sci for Saturday morning study group` · `Mid-cycle check-in · Sat 24 May · 10:00 in Science block` |
| `.consolidate` | `Tier 3 · consolidate strengths` | `13 candidates · A1 / B2 band · hold the line` | `**4 at A1** · **9 at B2** · low-risk of slipping if confidence maintained · includes Y. Aidoo (medical)` | `**Plan over 24 days:**` — `Self-directed past-paper drills · weekly check-in only` · `Peer-tutor assignments (top 3 paired with Tier 1 students)` · `Stretch material on industrial chem + contemporary issues for context` · `Y. Aidoo: catch-up plan post-discharge · individual schedule` · `Pre-paper boost session optional · Fri 5 Jun · 14:00–16:00` |

> **Tier membership binds to `mock_results`** (Mock-2 grade band): Tier 1 = C5–C6 (the 3 FOCUS, §B.2); Tier 2 = B3/newly-B2 (12); Tier 3 = A1/B2 (13). 3+12+13 = 28. The **plan bodies are free-authored teacher text** — **no INCR-16 table.** Y. Aidoo "(medical)" cross-refs `reg_status` (INCR-15).

### §B.4.3 Calendar strip (24-day)

Inline card (`bg-surface border-border rounded-lg`), title `24-day calendar · 6 remaining Chemistry lessons` (`font-display 14px 500`). `grid-cols-7`, each cell `rounded-sm border`, mono date label + week label + note:

| Cell | Date (mono) | Label | Note | Tint |
|---|---|---|---|---|
| 1 | `15–19 MAY` | `Week 1` | `Equilibria · 2 lessons + tutoring kick-off` | `bg-bg border-border` |
| 2 | `20–24 MAY` | `Week 2` | `Electrochem · 2 lessons · mid-cycle check-in Sat` | `bg-bg border-border` |
| 3 | `27–31 MAY` | `Week 3` | `Past papers · 2 lessons · weekly tutoring` | `bg-bg border-border` |
| 4 | `1–5 JUN` (gold) | `Week 4` | `Final review + boost session Fri` | `bg-gold-bg border-gold-soft` (date `text-gold 700`) |
| 5 | `MON 8 JUN` (terra) | `PAPER DAY` | `08:00 · 3 hrs · centre SU-0184` | `bg-terra-bg border-terra` (date `text-terra 700`) |
| 6 | `POST` | `Aug 2026` | `Results release · Mock 3 baseline for F2 cohort` | `bg-bg border-border opacity-50` |
| 7 | `NOV 2026` | `F2 Mock 1` | `Next cohort starts the same cycle` | `bg-bg border-border opacity-50` |

> **Binds to:** calendar cells 4/5 dates ← `wassce_paper_sittings` (Chemistry paper `Mon 8 Jun`, centre `SU-0184` = INCR-15 centre code). Cells 1–3/6/7 = **authored plan schedule** (part of the intervention plan free content). `.opacity-50` on cells 6/7 = future/dimmed state.

### §B.4.4 Intervention-plan WRITE states (teacher-editable + HoA co-sign; DERIVED)

| State | Spec |
|---|---|
| **default / read** | Tier cards + calendar render from saved plan. |
| **empty** | No plan yet → tier cards show membership (derived from mock bands) with empty plan bodies + a "Draft plan" affordance. |
| **editing (teacher)** | Plan bullets + calendar notes editable (textarea/list). Tier membership auto-derives from Mock-2 bands (not hand-assigned). **Authz: the assigned subject teacher only.** |
| **saved** | `Save plan` persists; timestamp. |
| **shared / co-sign (HoA)** | `Share with Mrs Owusu-Ansah` routes to HoA; HoA **co-signs** (per §B.4 notes "Mrs Owusu-Ansah co-signs it"). Co-signed state = a signature/badge on the plan. |
| **frozen** | Plan read-only once cohort frozen. |

> **FLAG — intervention plan has no INCR-16 table binding.** Needs an `intervention_plan` table (or deferral). The **tier membership** is derivable from `mock_results`; the **plan content + co-sign** is not. Confirm scope with Kofi/Wells: build the plan writer now, or defer and render tier membership read-only in INCR-16.

---

## §B.5 — Section 05 · Benchmark · my cohort vs school, region, national

**Surface lines 995–1157.** Editorial head: `05 · Benchmark · my cohort vs school, region, national · Mock 2 March 2026 · 5-year rolling comparison`. URL `…#benchmark`.

### §B.5.1 Page-head

| Element | Exact copy | Token / state |
|---|---|---|
| Crumb | `Chemistry F3 › Benchmark` | `text-navy-3` |
| `<h1>` | `How does ` + `<em>my</em>` + ` cohort compare?` | `font-display 24px`; gold italic |
| Action `Region history · 5 yrs` | `Region history · 5 yrs` | `.btn` — read/view-toggle. No write. |

### §B.5.2 Benchmark strip (`.bench-strip`) — 2 cells

`grid-cols-2` white `rounded-lg border-border padding 22px 26px`. Each `.bench-cell`: `.bench-label` (`font-display 14px 500`) + 4 `.bench-bar-row` (`grid-cols-[160px_1fr_60px]`): `.bench-row-label` (`<b>` name + `.bench-source` provenance with `.quality-dot`) · `.bench-bar` (`bg-bg h-8px rounded`, `.fill` at width%) · `.bench-num` (`font-mono 600 right`).

**Quality dots (`.quality-dot`):** `.strong` `bg-green` · `.mod` `bg-gold` · `.weak` `bg-warn` (`.bench-source.weak` → `text-warn 600`).

**Cell 1 — `Mock 2 credit rate · Chemistry · F3`:**

| Row | Source line (verbatim) + dot | Fill (colour) | Num |
|---|---|---|---|
| `My cohort` | `Omnischools · Mr Asiedu's Mock 2 marking, Mar 2026` (strong) | 100% (`bg-green`) | `100%` |
| `School avg` | `Omnischools internal · 5-yr history, 2021–2025` (strong) | 96% (`bg-green`) | `96%` |
| `Region · WR` | `WAEC WR summary 2024 · subject-level data sparse` (**weak**) | 78% (`bg-gold`) | `78%` |
| `National` | `WAEC 2024 chief examiner report` (strong) | 71% (`bg-gold`) | `71%` |

`.bench-note`: `**22 percentage points above national.** Mr Asiedu's cohort has not seen a sub-credit since 2023.`
`.bench-note.caveat` (`bg-warn-bg border-warn`, bold `text-warn`): `**Region figure is directional.** WAEC's Western Region summary does not consistently publish subject-level credit rates; the 78% is interpolated from regional aggregate + 2024 subject-mix. Treat as ± 4 pp.`

**Cell 2 — `Mock 2 distinction rate (A1 / B2)`:**

| Row | Source line (verbatim) + dot | Fill | Num |
|---|---|---|---|
| `My cohort` | `Omnischools · Mr Asiedu's Mock 2 marking, Mar 2026` (strong) | 43% (`bg-green`) | `43%` |
| `School avg` | `Omnischools internal · 5-yr history, 2021–2025` (strong) | 31% (`bg-gold`) | `31%` |
| `Region · WR` | `WAEC WR 2024 · A1/B2 mix not regionally published` (**weak**) | 24% (`bg-gold`) | `24%` |
| `National` | `WAEC 2024 chief examiner report` (strong) | 19% (`bg-gold`) | `19%` |

`.bench-note`: `**24 percentage points above national.** 12 of 28 candidates likely to score A1 or B2 · KNUST-eligible band for science programmes.`
`.bench-note.caveat`: `**Region figure is directional.** WAEC does not publish A1/B2 distinction rates by region at subject level; the 24% is estimated from national distribution adjusted for WR historical performance gap. Treat as ± 5 pp.`

**Data-quality legend** (below strip, `bg-bg border-border rounded-lg`, `11px`): `**Data quality**` · `● **Strong** · direct measurement, current data` (green) · `● **Moderate** · annual snapshot, lightly modelled` (gold) · `● **Directional** · interpolated from coarser data` (warn).

### §B.5.3 CPD record card

Gold card (`bg-gold-bg border-gold-soft rounded-lg`), title `Mr Asiedu's CPD record on this cohort` (`font-display 14px 500`), body (`12px text-navy-2`): `Three-year teaching cycle for this group · joined them in F1 (Sep 2023) · 142 lessons taught · 18 mock assessments marked · 12 Science HOD PLC sessions attended · 1 CPD-credited equilibria pedagogy session led at Western Region NTC convention (March 2026, +15 CPD points). NTC licence renewal eligible at end of cycle. The cohort's trajectory becomes part of his teaching record at the next NTC review.`

> **Binds to `benchmark_data_points` — and this is the section to flag hardest.** Only **`My cohort`** (both cells) binds to **live `mock_results`** (Mock-2 · Chemistry credit rate = 100%, distinction = 43% — subject-level, in scope). The other three rows per cell:
> - **`School avg`** (96% / 31%) = "5-yr history 2021–2025" — needs 5 years of internal WASSCE history that **does not exist in-DB**. → **`benchmark_data_points` seeded constant** (per school × subject), NOT computed in INCR-16.
> - **`Region · WR`** (78% / 24%) = **DIRECTIONAL** (interpolated; `.weak` dot + `± 4/5 pp` caveat). → **`benchmark_data_points` with `quality='DIRECTIONAL'`** or a constant. Never presented as measured.
> - **`National`** (71% / 19%) = WAEC 2024 chief examiner report → **`benchmark_data_points` constant** (external, annual).
> - **CPD card** = teacher/NTC record — **NOT in the 3 tables**, cross-module (HR/CPD). Static or from staff record. Flag.
>
> **`benchmark_data_points` shape must carry a `quality` tier** (`STRONG`/`MODERATE`/`DIRECTIONAL`) to render the dots + caveat honesty. The whole section's design integrity is the provenance labelling — **do not render a directional figure without its dot + caveat.**

---

# PART C — Write / validation / moderation state master spec (mark-entry)

The source draws the **read** of already-marked mocks (grade chips, raw scores in notes). INCR-16 must build the **mark-entry** and **moderation** write flows. Below is the DERIVED state spec — **reuse the score-ledger grid's input/validation/save/pending mechanics** (`SeniorLedgerGrid`), do not re-invent. Entry point: `Mark Mock 3 papers` (§B.1.1). The editable artifact is the **Mock N column** of the §B.2 trajectory table (or a dedicated entry grid over the same 28 candidates).

### C.1 Mark-entry states (teacher-editable)

| State | Visual / behaviour | Binds to |
|---|---|---|
| **default (unmarked / empty)** | Grade cell = em-dash `—` (`text-navy-3`); raw-score input empty. Per-candidate row present (roster from `senior_subject_teacher` scope → the 28). | new `mock_results` rows |
| **editing** | Two inputs per candidate: **raw score** `<input>` numeric **0–100** (`font-mono`, right-aligned) + **grade** select **A1–F9** (9-value). If raw→grade auto-derive (Part G Q1), the grade cell shows the derived chip live as raw is typed. | `mock_results.raw_score`, `.grade` |
| **validation-error** | Raw score outside **0–100** → inline `text-terra` error, cell `border-terra`, save blocked. Grade not in **{A1,B2,B3,C4,C5,C6,D7,E8,F9}** → rejected (select constrains it). Raw↔grade mismatch (if both entered manually) → warn, not block (confirm Part G Q1). Over-100 reuses the ledger's flag→block→cap discipline. | validation on write |
| **loading / saving** | Pending tint on the edited cell (solid `bg-gold-bg`, **never** `bg-gold/8` — no-alpha trap), spinner/disabled save; reuse ledger pending-buffer. | — |
| **saved** | Grade chip renders (palette A); raw score persisted (surfaces in `.stud-comment` prose if authored); trajectory arrow recomputes (Mock1 vs new grade). Audit-log the entry. | `mock_results` |
| **frozen** | Once Mock 2 is posted / cohort frozen (`wassce_setup_frozen_at`), the mock columns are **read-only** — inputs disabled with the frozen affordance (reuse INCR-15 §5.4). Mock 3 (in-flight) stays editable until its own post/freeze. | `mock_exams.status`, freeze marker |

### C.2 Moderation states (HoA-moderate-only)

The HoA (Head of Academics, C. Owusu-Ansah) can **override** a subject teacher's mock grade and **co-sign**. The surface encodes moderation authority via "Share with Mrs Owusu-Ansah" + "she co-signs it." **Moderated-vs-original visual treatment** (DERIVED — no explicit surface drawing; follow house style):

| State | Visual | Binds to |
|---|---|---|
| **un-moderated** | Grade chip = teacher's entered grade (palette A). No moderation badge. | `mock_results.grade` |
| **moderated** | Chip shows the **moderated grade**; the **original teacher grade** shown struck/secondary (e.g. small `text-navy-3 line-through` original beside/below the moderated chip) + a moderation marker (e.g. a `bg-navy text-gold` "MOD" pill or a gold left-border). Both values visible — never silently replace. | `mock_results.moderated_grade`, `.moderated_by`, original `.grade` |
| **moderation in progress** | Pending tint on the cell while HoA saves. | — |
| **authz** | Only the HoA role can write `moderated_grade`; the subject teacher **sees** the moderation (read) but cannot overwrite it. Distinct from the teacher's own entry authz. | role gate |

> **`mock_results` moderation columns needed:** `grade` (teacher entry), `moderated_grade` (nullable, HoA), `moderated_by` (actor), `moderated_at`. When `moderated_grade IS NOT NULL`, the **predicted/effective grade = moderated_grade**; display keeps the original visible. **Confirm the moderation role with Kofi/Sarah** (HoA = VICE_HEADMASTER_ACADEMIC, or a distinct HEAD_OF_ACADEMICS role? Also: can the HOD moderate within their own department? The surface names the HoA, not the HOD, as co-signer).

---

# PART D — Route, responsive & PWA

- **Subject-teacher route:** one route with 5 anchored regions (`#students · #heatmap · #plan · #benchmark`), scoped to the **session teacher's** `senior_subject_teacher` assignment (do NOT accept a teacher id in the URL — see Part G routing flag). RLS-tenant-scoped + assignment-scoped read.
- **Setup §2 route:** `/senior/wassce/setup?view=mocks` (or the anchored setup page from INCR-15). Admin-config, tenant-scoped.
- **Responsive** (subject-teacher surface has **no** `@media` block of its own beyond inherited): the wide grids need collapse rules on narrow widths — `.summary-strip` (5-col) → 2-col; `.iv-grid` (3-col) → 1-col; `.bench-strip` (2-col) → 1-col; `.dist-bars` (9-col) keeps 9 (small bars) or horizontal scroll; `.stud-table` and `.topic-grid` are **wide fixed grids** → wrap in `overflow-x:auto` with a **sticky-left first column** (reuse `ColumnScoreGrid` sticky/overflow mechanics, per the ledger map). Setup §2 uses INCR-15's `@media max-width:1280px` (`.mock-row → 1col`).
- **PWA:** no dedicated `-pwa.html` variant for INCR-16. **BUT** the mark-entry flow is exactly the offline-entry use case the ledger PWA solves — if teacher mark-entry ships as a PWA-capable surface, reuse the ledger's pending-buffer + `bg-gold-bg` pending tint (no-alpha). Not a build target unless Kofi scopes it; noted as reuse.

---

# PART E — Authz / control inventory (read / teacher-edit / HoA-moderate / admin-config)

| Control (section) | Kind | Authz | INCR-16 treatment |
|---|---|---|---|
| `Mark Mock 3 papers` (§B.1.1) | **WRITE** | **Teacher-editable** (assigned subject teacher) | Build mark-entry (Part C). Scoped to `senior_subject_teacher`. |
| Mock 1 / Mock 2 grade cells (§B.2) | **WRITE** (display today) | Teacher-editable; HoA-moderate | Read chip + Part C edit/moderation states. |
| Teacher note (§B.2 col 7) | **WRITE** | Teacher-editable | `mock_results.teacher_note`. |
| Moderation override (Part C.2) | **WRITE** | **HoA-moderate-only** | Distinct role gate; moderated-vs-original treatment. |
| `Save plan` (§B.4.1) | **WRITE** | Teacher-editable | Intervention plan — **no table yet** (flag / defer). |
| `Share with Mrs Owusu-Ansah` (§B.4.1) | **WRITE** (route + co-sign) | Teacher → HoA co-sign | Routes plan to HoA. |
| `Schedule Mock 2027 · F2` (§A.1) | **WRITE** | **Admin-config** (Head of Academics; NOT subject teacher) | Creates `mock_exams` F2 row (Part A.5). |
| Sort / Filter pills (§B.2.1) | Client view-state | any reader | Query-param filter/sort. No write. |
| `Compare to Mock 1` (§B.3.1) · `Region history · 5 yrs` (§B.5.1) | Client view-toggle | any reader | View state. No write. |
| `Export intervention plan` (§B.1.1) · `Export topic plan` (§B.3.1) · `Mock 1/2 results` (§A.1) | Read / export / nav | any reader | OK to wire (or stub). No mutation. |
| `Topic teaching log` (§B.1.1) | Nav/write (teaching log) | teacher | Out of INCR-16 tables — nav-inert or flag. |
| `View profile` / `Student page` (§B.2 action) | Nav → student surface (INCR-20) | teacher | Inert — target not built. |
| `Tutoring slot` / `Conference` (§B.2 action) | Nav → scheduling | teacher | Out of scope — inert or flag. |

> **The authz spine:** a **subject teacher sees ONLY their assigned subject × cohort** (`senior_subject_teacher`) — never the whole cohort, never other subjects (that's INCR-18). The **HoA moderates** (override + co-sign). **Admin-config** (mock scheduling) is Head-of-Academics, not the teacher. Sarah + Kofi confirm the exact role enum for HoA-moderate vs HOD-within-department, and whether mark-entry endpoint rejects a teacher acting outside their assignment (403/404).

---

# PART F — Table reconciliation & no-clean-binding flags

**Clean bindings (build against INCR-16 migration):**

| Table | Surface elements |
|---|---|
| `mock_exams` | Setup §2 timeline rows 1/2/4 (Mock 1/2/F2-Mock-1); status enum; A.5 config write |
| `mock_results` | §B.1.3 credit/distinction/mean stats · §B.1.4 histogram · §B.2 Mock 1/2 grade columns + raw scores + teacher note · §B.4.2 tier membership · §B.5.2 "My cohort" rows. **The write table** (entry + moderation). |
| `benchmark_data_points` | §A.3 predictive accuracy (5-yr) · §B.5.2 School avg / Region / National rows (+ `quality` tier) · §B.1.3 "cohort avg 31%" / "best in region" comparators |
| `senior_subject_teacher` (reused) | §B.1.2 teacher assignment + "28 candidates assigned"; the authz scope for the whole surface |
| `wassce_candidates` (reused, INCR-15) | §B.2 candidate names, House, index number, MED/SC-7 flags (reg_status/accommodation) |
| `wassce_subjects` / `wassce_programmes` (reused) | Chemistry × F3 Science scoping |
| `wassce_setup_frozen_at` (reused) | freeze read → read-only mock columns / plan / config |

**NO clean binding (reconcile / defer / seed / constant / flag):**

| Element | Belongs to | INCR-16 render |
|---|---|---|
| **§A.4 cohort-distribution card** (agg bands, median/mean aggregate) | **INCR-17 aggregate** | defer OR seeded `benchmark_data_points` directional; do NOT compute aggregate |
| **§B.2 "Mock 2 agg 14"** (row 04 meta) | **INCR-17 aggregate** | `—` / omit until INCR-17 |
| **§B.2 "KNUST Biochem target"** (row 02 meta) | **INCR-17 university target** | display-only if present; do NOT build |
| **§B.3 topic heatmap** (per-candidate × per-topic bands) | **needs `mock_result_topic` table or defer** | biggest gap — confirm scope; topic list = `lib/wassce/` constant |
| **§B.4 intervention plan content + co-sign** | **needs `intervention_plan` table or defer** | tier membership binds to `mock_results`; plan body/co-sign does not |
| **§A.2 row 3 "WASSCE 2026 · Day 2 live"** | Live-exam anchor (later) | static schedule copy from `wassce_paper_sittings`; no live clock |
| **§A.2 row 4 "245 F2 students"** | F2 roster (attendance-freeze snapshot) | `—` if F2 not yet counted |
| **§A.3 predictive accuracy (5-yr)** · **§B.5.2 School avg (5-yr)** | seeded historical | `benchmark_data_points` constant; not computed (no 5-yr history in-DB) |
| **§B.5.2 Region · WR** | DIRECTIONAL | `benchmark_data_points quality=DIRECTIONAL` + dot + caveat; never as measured |
| **§B.5.2 National** | WAEC external | `benchmark_data_points` constant (annual) |
| **§B.5.3 CPD card** · **§B.1.2 NTC/PLC/Form-Master fields** | teacher/NTC/HR record | staff record or static; not in the 3 tables |
| **§B.1.3 cell 5 Practical 28/28** | practical-paper attendance | needs practical sat/not-sat flag; not a score |
| **§B.2 Action `Tutoring slot`/`Conference`** · **§B.1.1 `Topic teaching log`** | scheduling / teaching-log | nav-inert or flag |
| **Grade-chip / heat / dist palettes (§0.2 A/B) + row tints (§0.2C)** | **no design token** | `lib/wassce/grade-colors` constant OR reuse INCR-15 opacity approach; never slash-opacity |

---

# PART G — Open questions / drift log

1. **Raw→grade: auto-derived or dual manual entry?** The surface shows both raw ("96/100", "47/100") and grade ("A1"). Confirm whether mark-entry stores raw score and **auto-derives** the WAEC band grade (a `lib/wassce/` band constant — reuse the A1–F9 grading constant from INCR-15 §1.5/§5.2), or the teacher enters the grade directly (holistic marking) with raw optional. Affects validation (mismatch = block or warn). **Predicted grade = Mock-2 grade** (per A.1 lede) — confirm predicted is NOT a separate field.
2. **`mock_results` moderation columns + role.** Need `grade` (teacher), `moderated_grade`/`moderated_by`/`moderated_at` (HoA). Effective grade = moderated when present; original stays visible (Part C.2). **Which role moderates** — HoA (VICE_HEADMASTER_ACADEMIC / a HEAD_OF_ACADEMICS role) vs HOD-within-department? Surface names the HoA (C. Owusu-Ansah) as co-signer. Sarah + Kofi.
3. **Subject-teacher scope enforcement.** Route must scope to the **session teacher's** `senior_subject_teacher` assignment — do NOT accept a teacher id in the URL (the demo `…/teacher/asiedu/…` is a leak). Mark-entry endpoint must reject a teacher writing outside their assignment (403/404). Whole-cohort/cross-subject = INCR-18, explicitly NOT here.
4. **Topic heatmap granularity (biggest gap).** §B.3 needs per-candidate × per-topic bands — no binding in `mock_results` as scoped. Add a `mock_result_topic` breakdown table, a JSON column, or **defer Section 03**. Also: header says "12 topics × 6 sub-areas" but 10 rows render (design drift — 10 topics, 5 grade-band columns + avg).
5. **Intervention plan (§B.4).** Needs an `intervention_plan` table (content + tier + co-sign) or deferral. Tier membership is derivable from `mock_results` bands; the plan body + `Share with Mrs Owusu-Ansah` co-sign is not. Confirm scope.
6. **AGGREGATE is INCR-17, not here.** §A.4 cohort-distribution card, §B.2 "Mock 2 agg 14", median/mean aggregate — all best-3 cross-subject aggregate. **INCR-16 must not compute or store any aggregate.** Render deferred / directional-seed / em-dash. Per-subject Mock-2 predicted grade + per-subject distribution ARE in scope.
7. **`benchmark_data_points` must carry a `quality` tier** (`STRONG`/`MODERATE`/`DIRECTIONAL`) to render the §B.5 provenance dots + caveats. Region figures are **DIRECTIONAL** (interpolated, ± pp) and must never render as measured. School-avg + predictive-accuracy 5-yr figures are **seeded** (no in-DB history) — not computed in INCR-16.
8. **Bespoke palettes (§0.2).** Grade-chip/dist-bar 9-step scale (`#1E5A35 … #A8771F`), heat 6-step scale, and near-white row tints (`#F5FBF7`/`#FBEBE7`) are **not tokens** and are **not** identical to INCR-15's opacity-stepped grading strip. Reconcile: store as `lib/wassce/grade-colors` constants, or reuse INCR-15's opacity approach. Never slash-opacity; port every `opacity:` to `opacity-N` (§0.3).
9. **`mock_exams` status enum + method text.** Suggested `COMPLETE / LIVE / SCHEDULED`. Confirm whether the `.mr-method` methodology copy is a stored per-mock field or a template constant. Row 3 (WASSCE live) is an anchor, not a mock — bind to `wassce_paper_sittings`, render static.
10. **Practical paper (§B.1.3 cell 5 / §B.2 col 6).** "28/28 sat · awaiting marking" is **attendance**, not a score. Needs a practical sat/not-sat flag (per candidate) distinct from the graded papers. Confirm shape with Wells.
11. **Defined-but-unused CSS classes** to build for the enum: `.stud-flag-mini.top` (top-of-cohort tag), `.stud-row.disrupted` (medical/disruption tier). Present in CSS, unused by demo rows (mirrors INCR-15's `.reg-status.critical`).
12. **`.notes` right-rail + outer editorial `.page-header`/`.section-head` are design-doc chrome — do not build.** Only the in-app `.app-shell` frame is the target (same rule as INCR-15 / ledger map).

---

*Map produced against: `Surfaces/schoolup-wassce-subject-teacher.html` (all 5 sections, lines 1–1162) + `Surfaces/schoolup-wassce-setup.html` §2 (lines 509–647); `md files/design-tokens.json` v1.0.0; house style + WASSCE token/grade conventions from `docs/senior/wassce-spine-surface-map.md` (INCR-15). INCR-16 tables (`mock_exams` / `mock_results` / `benchmark_data_points`) per task assignment; reused spine tables per INCR-15. setup §1/§4/§5 = INCR-15 (shipped), §3 = INCR-17, cohort-readiness/parent/student = INCR-18/19/20 — deliberately NOT mapped.*
