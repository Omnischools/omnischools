# WASSCE Cohort Spine — Surface Map (INCR-15 · F0 · Module 4.3)

**Author:** Lucy (design cartographer) · **Status:** design spec, ready for the implementation engineer (Claude Code).
**Increment:** INCR-15 — *F0: WASSCE cohort spine* · migration **0051** · **ROOT** of Module 4.3 (everything FKs to candidates/subjects).
**Scope of this map:** the **read-only, frozen** WASSCE setup/registration surface — **§1 (programmes · subjects · electives)**, **§4 (registration roster · "the 240")**, **§5 (policy anchors / frozen state)** only.

INCR-15 is **read-only**. There is **no write-side projection math** in this increment. Every control that *looks* like a write (Edit · Late registration · Run match) is mapped as **display-only / disabled** and flagged so the implementer renders it inert. Where the surface disagrees with "read-only", it is called out inline and collected in the **Read-only vs later-editable control inventory** and the **Open questions / drift log** at the end.

## Source surface (visual source of truth — replicate 1:1)

| Surface file | Role in this map |
|---|---|
| `Surfaces/schoolup-wassce-setup.html` | **PRIMARY & ONLY** source. A single design-doc page holding five stacked app-frame sections. This map covers **§1, §4, §5**. |

**Spine tables this map reconciles against (Pence/Kofi, build-plan INCR-15):**
`wassce_programmes → wassce_subjects → wassce_candidates → wassce_papers → wassce_paper_sittings` + a per-school **freeze marker** `wassce_setup_frozen_at` (Kofi Decision 1). Every surface element below carries a **Binds to** line so Wells's schema and the surface line up; elements with **no clean spine binding** are flagged for Kofi/Wells reconciliation.

## Explicitly OUT of scope for INCR-15 (mapped **nowhere below** — flagged, not built)

The source page has five sections. **Two are deliberately skipped:**

| Section | Title (surface) | Owner increment | Why skipped here |
|---|---|---|---|
| **§2** | *Mock exam cycle · Mock 1 · Mock 2* (surface lines 509–647) | **INCR-16** | Mock cycle config + Mock 2→WASSCE predictive-accuracy + cohort distribution. Prediction **input**, not spine. |
| **§3** | *University target system · per-student tagging* (surface lines 649–857) | **INCR-17** | Tier bands, cut-off table, stretch/match/safety, Dean guidance. Analytical spine; heaviest. |

> **INCR-15 build note:** §2 and §3 must **not** appear on the INCR-15 route. Their existence is acknowledged so the implementer knows the setup surface grows two more sections later — but nothing from §2/§3 is a build target now, and no §2/§3 table exists at migration 0051.

---

## 0. Shared chrome, tokens & type (applies to every section below)

### 0.1 Token & type reference

The surface declares its palette as `:root` `--x` vars (identical hexes to `design-tokens.json` v1.0.0). The runtime uses **Tailwind token classes** (`text-gold`, `bg-navy`, `border-border-2`, `font-display`), **never inline `var(--x)` in JSX** — translate each `var(--x)` to the Tailwind class of the same token, exactly as the ledger map does.

| Surface `var(--x)` | Hex | Tailwind class | Used in §1/§4/§5 for |
|---|---|---|---|
| `--navy` | `#1A2B47` | `text-navy` / `bg-navy` / `border-navy` | body text, sidebar, `.btn.primary`, boarder-ish pills, index numbers |
| `--navy-2` | `#2D3F5C` | `text-navy-2` / `bg-navy-2` | secondary text, prog-subject names, anchor body copy |
| `--navy-3` | `#5C6675` | `text-navy-3` | muted meta, captions, crumbs, labels, empty-ish text |
| `--gold` | `#C8975B` | `text-gold` / `bg-gold` / `border-gold` | accent, display `<em>` italics, Business track, active states |
| `--gold-soft` | `#E8D4B8` | `text-gold-soft` / `border-gold-soft` | sidebar meta on navy, gold borders |
| `--gold-bg` | `#F5EBDC` | `bg-gold-bg` | Business prog-pill tint, gold gradient starts, save-bar |
| `--bg` | `#FAF7F2` | `bg-bg` | page bg, table-head bg, sidebar-active reads, count-pill grounds |
| `--surface` | `#FFFFFF` | `bg-surface` | cards, tiles, table body |
| `--green` | `#2F6B47` | `text-green` / `bg-green` | Home Ec track, confirmed status, A1–B3 grade cells, "ok" tile |
| `--green-bg` | `#E5EFE8` | `bg-green-bg` | confirmed pill tint, "ok" tile gradient, green-avatar tint |
| `--terra` | `#B84A39` | `text-terra` / `bg-terra` | Science track, F9 grade, critical/medical accents, flag numbers |
| `--terra-bg` | `#F5E1DC` | `bg-terra-bg` | Science prog-pill tint, terra-avatar tint |
| `--warn` | `#C58A2E` | `text-warn` / `bg-warn` | D7/E8 grades, flag status, "flag" tile, warn banner/avatar |
| `--warn-bg` | `#F5E9D0` | `bg-warn-bg` | flag pill tint, warn tile gradient, warn banner |
| `--border` | `#E5DFD3` | `border-border` | default borders, row dividers |
| `--border-2` | `#D4CCBA` | `border-border-2` | stronger borders (buttons, table-head bottom), em-dash colour |

**Type families:** `font-display` = **Fraunces** (all headings, stat numbers, prog names, section titles, italic gold `<em>` accents); `font-body`/default = **Manrope** (all body, labels, student names in stat context); `font-mono` = **JetBrains Mono** (index numbers, centre code `SU-0184`, grade points, fees `GHS 336k`, aggregate figures, count badges). **Every index number, centre code, aggregate figure, and fee amount is `font-mono`.** Headings use `font-display` weight 500 with an italic gold `<em>` (e.g. `WASSCE 2026 <em class="text-gold italic">configuration.</em>`).

**Conventions (`design-tokens.json._conventions`):** empty/missing value = **em-dash `—`** in `text-navy-3`/`text-border-2`, never `0`/`N/A`/`null` (used by the untagged/other rows). Currency = **`GHS 1,400`** / **`GHS 336k`** — space after unit, never `GH₵`/`Ghc`.

### 0.2 No-alpha discipline — every translucency in §1/§4/§5 (repo memory `no-alpha-token-opacity`)

The surface hand-writes `rgba(...)` **literals**. That is fine as-is. The trap is on the **Tailwind port**: slash-opacity on a raw-hex token (`bg-gold/8`, `text-bg/70`, `bg-navy/80`) **silently renders nothing** because the tokens are raw hex, not HSL channels. **Verify in the live preview, not the build.** For each translucency below, port to an **explicit arbitrary rgba value** (`bg-[rgba(200,151,91,0.08)]`) **or** an `opacity-N` utility on a solid token — **never** `bg-gold/8`.

| Surface region (in scope) | Raw value | Port to (NOT slash-opacity) |
|---|---|---|
| Sidebar `.nav-item` label | `rgba(250,247,242,0.7)` | `text-[rgba(250,247,242,0.7)]` (off-white 70% on navy) |
| Sidebar `.nav-item.active` bg | `rgba(200,151,91,0.08)` | `bg-[rgba(200,151,91,0.08)]` (gold 8% on navy) |
| Sidebar `.nav-item.sub` label | `rgba(250,247,242,0.55)` | `text-[rgba(250,247,242,0.55)]` |
| Sidebar brand/footer/powered dividers | `rgba(255,255,255,0.08 / 0.05)` | `border-[rgba(255,255,255,0.08)]` |
| `.powered-by` label | `rgba(200,151,91,0.55)` | `text-[rgba(200,151,91,0.55)]` |
| `.live-banner::before` glow | `rgba(200,151,91,0.07)` | decorative; `bg-[rgba(200,151,91,0.07)]` or drop |
| `.filter-pill .ct` count badge | `rgba(200,151,91,0.18)` bg + `text-gold` | `bg-[rgba(200,151,91,0.18)]` (do **not** `bg-gold/18`) |
| `.roster-table td .st-av.navy` avatar | `rgba(45,63,92,0.12)` | `bg-[rgba(45,63,92,0.12)]` (navy-2 12%) |
| `.roster-table tr.live-row` gradient tail | `rgba(245,233,208,0.2)` | `bg-[linear-gradient(90deg,var(--warn-bg)_0%,rgba(245,233,208,0.2)_100%)]` |
| `.roster-table td .prog-pill.ga` (Gen. Arts) | `rgba(123,74,138,0.12)` bg + `#7B4A8A` text | **bespoke purple, no token** — inline `style` (see §1.4 drift) |
| `.xmod-card::before` glow | `rgba(200,151,91,0.06)` | decorative; `bg-[rgba(200,151,91,0.06)]` or drop |
| Grading cells `opacity:0.85 / 0.72 …` | inline `opacity` on solid tokens | `opacity-90` / `opacity-75` utilities — **not** `bg-green/85` |

### 0.3 App-shell chrome — identical across §1, §4, §5 (build once)

All three sections render the same desktop app frame (`.desktop` → `.browser-bar` → `.app-shell` = `sidebar 220px + main 1fr`). Only the URL and body differ. The `.notes` right-rail (`.layout` 2nd column) and the outer editorial `.page-header` / `.section-head` are **design-doc chrome — do NOT build them**; build the in-app frame.

- **Browser URL** (`.url`, cosmetic): §1 `asankrangwa.omnischools.gh / wassce / setup / programmes` · §4 `… / registration` · §5 `… / anchors`. These map to one route with three views/anchors (see §6 route note).
- **Sidebar** (`.sidebar`, `bg-navy`): brand block = gold `.logo-mini` `A` + `Asankrangwa SHS` (`font-display 13px`) + meta `Semester 2 · Week 2` (`text-gold-soft 10px`). Flat nav (verbatim, top→bottom):
  `Dashboard · Students · Classes & courses · Attendance · Boarding · Sickbay · **WASSCE (active)**` → sub-items `**Setup (active)** · Cohort readiness · Student reports · Subject view · Live exam tracker` → `Discipline · Communications · Reports`.
  Active item = `bg-[rgba(200,151,91,0.08)] text-bg border-l-2 border-gold`; sub-active same tint. Footer avatar `CO` / `C. Owusu-Ansah` / `Head of Academics` (`text-gold-soft`). `Powered by <em class="text-gold">Omnischools</em>`.
  - **INCR-15 nav note:** only **WASSCE → Setup** is this increment. The four sibling subs are later increments (**Cohort readiness = INCR-18 · Student reports/Subject view = INCR-16/20 · Live exam tracker = later**). Render them as inert nav links or omit until built. The `.sidebar.tall/.taller/.tallest` min-height variants are demo-canvas sizing — ignore.
  - **Nav convention:** this is the surface's own demo nav (flat, WASSCE with 5 subs = under twelve top-level items → **flat nav is correct**, no sectioning). Where the real Senior app nav differs, the app nav wins; this map only asserts the WASSCE → Setup entry.
- **`.page-head`** (`bg-surface border-b border-border`, `padding 24px 36px 22px`): crumb → `<h1 font-display 28px 500>` with italic gold `<em>` → lede → right-aligned `.actions`. Per-section copy in §1.1 / §4.1 / §5.1.
- **`.btn` families:** `.btn` = `border-border-2 bg-surface text-navy 12px/600` (secondary/ghost); `.btn.primary` = `bg-navy text-bg 700`; `.btn.gold` = `bg-gold text-navy 700` (defined, unused in scope).

---

## §1 — Programmes · subjects · electives

**Surface lines 293–507.** Section head (editorial, do-not-build): num `01` · title `Programmes · subjects · electives` · meta `Headmaster + Head of Academics · school-wide`.
**Owners (RBAC):** Headmaster + Head of Academics, school-wide read. **State: frozen** (F3 cohort registered; edits route to F2/2027).

### §1.1 In-app page-head

| Element | Exact copy | Token / type |
|---|---|---|
| Crumb | `WASSCE · Setup · Programmes & subjects` (`WASSCE` is `<a>`) | `text-navy-3 11px uppercase tracking-[0.12em]`; `<a>` `text-gold` |
| `<h1>` | `WASSCE 2026 ` + `<em>configuration.</em>` | `font-display 28px 500`; `<em>` `text-gold italic 400` |
| Lede | `**240 F3 candidates across 4 programmes.** Main writing started Tue 13 May with Oral English; Day 2 papers (English Language 1 + 2) running now. Setup is frozen for this cohort — changes apply to the F2 batch tracking toward WASSCE 2027.` | `text-navy-3 13px`; lead clause bold `text-navy-2` |
| Action `Export setup` | `Export setup` | `.btn` — **read/export, OK to wire (or stub)** |
| Action `Audit history` | `Audit history` | `.btn` — **read, OK** |
| Action `Edit · F2 cohort` | `Edit · F2 cohort` | `.btn.primary` — **WRITE (F2). DISPLAY-ONLY / disabled in INCR-15** (frozen F3 cohort is read-only). Flag. |

> **Binds to:** the `240` / `4 programmes` counts derive from `wassce_candidates` (count) and `wassce_programmes` (count). "Setup is frozen for this cohort" ← `wassce_setup_frozen_at IS NOT NULL` for this school+cohort. The **Day-2 / date copy** ("Tue 13 May", "Day 2") is derivable from `wassce_paper_sittings` + today — but is live-exam framing (see §1.2 flag).

### §1.2 Live-exam banner (`.live-banner`) — FLAG: not core spine

Navy gradient card (`linear-gradient(135deg, navy, navy-2)`), `grid-cols-[auto_1fr_auto]`.

| Sub-element | Exact copy | Token / type |
|---|---|---|
| `.lb-dot` | `W` + red `.pulse` dot | gold square 52px `bg-gold text-navy font-display`; pulse `bg-terra` ringed `border navy` |
| `.lb-title` | `WASSCE 2026 is ` + `<em>live</em>` + ` · Day 2 of main writing` | `font-display 20px 500`; `<em>` gold italic |
| `.lb-sub` | `Started **Tue 13 May · Oral English**. Today (Wed 14 May) **English Language 2 (Essay) 09:30–12:00** + **English Language 1 (Objective) 14:00–15:00**. Ghana returns to the international May–June calendar after 5 years of Ghana-only WASSCE following the 2020 COVID disruption.` | `text-gold-soft 12px`; bolds `text-bg` |
| `.lb-cta button` | `Open live tracker` | `bg-gold text-navy 700 11px` — **nav to Live-exam tracker (later increment). DISPLAY-ONLY / inert.** |
| `.day-count` | `Day 2 of 30 · ends Fri 19 Jun` | `font-mono 11px text-gold-soft` |

> **FLAG — no clean INCR-15 binding.** The live-exam banner is a *live-tracker* affordance. The paper names/times ("English Language 2 (Essay) 09:30–12:00") derive from `wassce_paper_sittings`, but "is live / Day 2 of 30" is a runtime status the read-only spine doesn't own. **INCR-15 option:** render the banner as a **static schedule read** off `wassce_paper_sittings` (first sitting date → "started"; count of sittings → "of 30"), or defer the banner entirely to the Live-exam tracker. Do **not** build a live clock in INCR-15. Reconcile with Kofi/Wells whether the sittings table stores date+time+session enough to render this statically.

### §1.3 Stat strip (`.stats-strip`) — 4 tiles

`grid-cols-4`, each `.stat` white card (`bg-surface border-border rounded-lg`); label `9px uppercase tracking-[0.16em] text-navy-3 700`; value `font-display 28px 500` with gold italic `<em>` + `.unit` (`13px text-navy-3`, `font-body`); trend `10px text-navy-3`, bolds `text-navy-2`.

| # | Class | Label | Value | Trend | Binds to |
|---|---|---|---|---|---|
| 1 | `.stat.live` (gold gradient `linear-gradient(135deg, gold-bg, surface)`, `border-gold`, value `text-gold`) | `F3 cohort` | `240` (`<em>`) + unit `candidates` | `**237 confirmed** · 3 flagged today` | `wassce_candidates` count; confirmed/flagged = `reg_status` group |
| 2 | `.stat` | `Programmes` | `4` + unit `tracks` | `Science · Business · Arts · Home Ec.` | `wassce_programmes` count + names |
| 3 | `.stat` | `Subjects offered` | `23` + unit `total` | `**4 core** · 19 electives` | `wassce_subjects` distinct count by `kind` |
| 4 | `.stat` | `Mocks completed` | `2` + unit `of 2` | `Mock 1 **Nov 2025** · Mock 2 **Mar 2026**` | **FLAG: INCR-16** (mock cycle) — no spine table in 0051 |

> **FLAG — tile 4 ("Mocks completed") has no INCR-15 binding.** The mock cycle is INCR-16. For INCR-15 render it as `—` / "not yet configured", or omit the tile. Do not fabricate mock counts.

### §1.4 Programme matrix (`.prog-grid`) — 4 programme cards — CORE SPINE

`grid-cols-4`. Each `.prog-card` = white card, `rounded-xl border-border`, coloured `border-top:3px`. Head (`.prog-head`): `.ph-name` (`font-display 15px 600`, gold italic `<em>`) + `.ph-count` (`font-mono 11px 700 bg-bg border-border rounded-full`, the candidate count). Body: repeated `.pb-label` (`9px uppercase tracking-[0.14em] text-navy-3 700`) + `.pb-list` of `.pb-subj` rows (`12px text-navy-2`, name bold `text-navy`, trailing `.pb-tag`).

**Tag vocabulary** (`.pb-tag`, `8px uppercase 700 rounded-full`): `core` = `bg-navy text-bg` · `elec` (label "Elec") = `bg-gold-bg text-gold` · `opt` (label "Alt") = `bg-bg text-navy-3 border-border`.

| Card | `border-top` colour | Name (`.ph-name`) | `.ph-count` | Core (`.pb-label` "Core (mandatory · all)") | Electives block (`.pb-label` verbatim) |
|---|---|---|---|---|---|
| `.prog-card.science` | `var(--terra)` | `General ` `<em>Science</em>` | `60` | English Language · Mathematics (Core) · Integrated Science · Social Studies | **"Electives (4 required)":** Chemistry · Physics · Biology · Elective Mathematics |
| `.prog-card.business` | `var(--gold)` | `<em>Business</em>` | `60` | (same 4 cores) | **"Electives (4 required)":** Financial Accounting · Cost Accounting · Business Management · Economics · `Elective Mathematics (or)` [Alt] |
| `.prog-card.arts` | `#7B4A8A` (**bespoke, no token**) | `General ` `<em>Arts</em>` | `80` | (same 4 cores) | **"Electives (choose 4)":** Literature in English · Geography · Government · Economics · `History` [Alt] · `Christian Religious Studies` [Alt] · `French` [Alt] |
| `.prog-card.home` | `var(--green)` | `Home ` `<em>Economics</em>` | `40` | (same 4 cores) | **"Electives (4 required)":** Management in Living · Food and Nutrition · Clothing and Textiles · `Biology (or)` [Alt] · `General Knowledge in Art (or)` [Alt] |

**The four cores are identical across all programmes** (verbatim, tag `core`): `English Language` · `Mathematics (Core)` · `Integrated Science` · `Social Studies`. (Note "(Core)" distinguishes Core Maths from Elective Maths.)

> **Binds to:** `wassce_programmes` (name, track colour, candidate count via `ph-count`) → `wassce_subjects` (name, `kind` ∈ core/elective/alternative, per-programme membership via composite FK `(school_id, programme_id)`). The `(or)` / `Alt` tag = `kind='alternative'` (the "Elective Maths OR a 4th business elective" / "choose 4 from 7" pattern — Kofi Decision 2's normalized `wassce_candidate_subject` join records *which* the candidate chose; the card here shows the *offered* set, not per-candidate choice).
>
> **Counts:** `60+60+80+40 = 240` = total candidates. The `.ph-count` binds to `count(wassce_candidates) group by programme_id` (or a stored per-programme count).
>
> **DRIFT — General Arts purple `#7B4A8A` is not a token** (like the boarding House hexes). It appears twice: `.prog-card.arts` border-top and `.prog-pill.ga` (§4.5). Store as a per-programme `color` value and render via inline `style={{...}}`, **or** since programmes are a fixed small set, define one CSS var. Science/Business/Home map cleanly to `terra`/`gold`/`green`. Do **not** slash-opacity the purple.

### §1.5 WASSCE grading card (`.card`) — WAEC constant, not a spine table

Head: `.ch-title` `WASSCE <em>grading</em> · how the aggregate works` · `.ch-meta` `WAEC · 9-grade scale`. Body = a **9-column grade strip** + an aggregate explainer.

**Grade cells** (`grid-cols-9`, each `padding 8px rounded-sm text-center`, big grade `font-display 16px 600`, caption `9px uppercase`):

| Grade | Caption | Cell bg | Inline `opacity` (port to `opacity-N`, NOT slash) |
|---|---|---|---|
| A1 | `Excellent · 1pt` | `bg-green text-bg` | 1.0 |
| B2 | `V. Good · 2pt` | `bg-green text-bg` | 0.85 → `opacity-90` |
| B3 | `Good · 3pt` | `bg-green text-bg` | 0.72 → `opacity-75` |
| C4 | `Credit · 4pt` | `bg-gold text-navy` | 1.0 |
| C5 | `Credit · 5pt` | `bg-gold text-navy` | 0.88 → `opacity-90` |
| C6 | `Credit · 6pt` | `bg-gold text-navy` | 0.76 → `opacity-75` |
| D7 | `Pass · 7pt` | `bg-warn text-surface` | 1.0 |
| E8 | `Pass · 8pt` | `bg-warn text-surface` | 0.85 → `opacity-90` |
| F9 | `Fail · 9pt` | `bg-terra text-bg` | 1.0 |

**Aggregate explainer** (below, `12px text-navy-2`, `border-top`): `**Aggregate** = best 3 cores + best 3 electives = ` + mono pill `6 (best) → 54 (worst)` + `. Universities use this for admission. **A1–C6 are credit passes** and count toward tertiary admission; **D7–F9 do not.** University cut-offs typically run ` + mono `6–24` + ` with the most competitive programmes (Medicine, Pharmacy, Engineering) at ` + mono `6–12` + `.` (mono runs `font-mono`, pill `bg-bg rounded-full`).

> **FLAG — no spine table.** The A1–F9 scale + aggregate rule is a **WAEC constant** (same content re-appears in §5 WAEC anchors "Grading + aggregate"). Bind to a **shared `lib/wassce/` constant**, not a DB table. Single source; render in both §1.5 and §5.1.

### §1.6 Cross-module strip (`.xmod-strip`) — 3 navy cards

`grid-cols-3`. Each `.xmod-card` = navy gradient (`linear-gradient(135deg, navy, navy-2)`), `text-bg`; label `9px uppercase text-gold 700`; title `font-display 14px 500` gold italic `<em>`; body `11px text-gold-soft`, bolds `text-bg`.

| Card | `.xm-lbl` | `.xm-title` | `.xm-body` (verbatim) | Binds to |
|---|---|---|---|---|
| 1 | `Cross-module · Classes` | `Programme → <em>class</em> mapping` | `Each F3 student belongs to one programme via their class assignment. **F3 SCI 1, F3 SCI 2, F3 BUS 1, F3 BUS 2**, etc. Class → programme join carries forward into WASSCE registration.` | **F0 (shipped):** `classes.programmeId` → `wassce_candidates.programme_id` |
| 2 | `Cross-module · Teachers` | `Subject teacher <em>roster</em> locked` | `Each subject has one or more F3 teachers. **Mr S. Asiedu** takes Chemistry across all F3 SCI classes. Subject-view surface keys off this roster — readiness data flows back to each teacher.` | **FLAG: INCR-16** (subject-teacher). No 0051 table. |
| 3 | `Cross-module · Billing` | `WAEC exam <em>fee</em> reconciliation` | `WAEC charges per student per paper. **GHS 1,400 per candidate** for 2026. Free SHS covers core fees; private add-ons (re-sits, extra electives) flow into billing as individual line items. 3 students flagged below.` | **Cross-module (Billing).** Not spine. `GHS 1,400` = policy anchor (§5). |

> **Design commitment (preserve):** cross-module hooks are commitments, not accidents — card 1 (**programme→class** join, F0) is live now; cards 2 (**subject-teacher→subject-view readiness**) and 3 (**WAEC fee→billing line items**) are directional and render as **static explainer copy** in INCR-15 (their target modules aren't built). Keep the copy; wire nothing.

---

## §4 — WASSCE registration · the 240

**Surface lines 859–1072.** Section head (editorial): num `04` · title `WASSCE registration · the 240` · meta `Roster · WAEC · medical accommodations`.
**Owners:** roster / WAEC / medical-accommodation view. **State: frozen** (240 registered, index numbers issued Feb 2026, WAEC export ran 14 Feb 2026). **This is the primary INCR-15 build target.**

### §4.1 In-app page-head

| Element | Exact copy | Token / type / state |
|---|---|---|
| Crumb | `WASSCE · Setup · Registration roster` (`WASSCE`, `Setup` are `<a>`) | `text-navy-3`; `<a>` `text-gold` |
| `<h1>` | `WASSCE 2026 ` + `<em>roster.</em>` | `font-display 28px`; gold italic `<em>` |
| Lede | `**240 candidates registered** with WAEC. Centre code <span class="mono">**SU-0184**</span>. Index numbers issued Feb 2026. 3 students flagged today — one inpatient (medical exemption process active), two with NHIS-card issues affecting the WAEC fee reconciliation.` | `text-navy-3`; `240…` bold; `SU-0184` `font-mono` bold |
| Action `WAEC export` | `WAEC export` | `.btn` — **read/export, OK** (mirrors the real 14 Feb 2026 export) |
| Action `Print roster` | `Print roster` | `.btn` — **read, OK** |
| Action `+ Late registration` | `+ Late registration` | `.btn.primary` — **WRITE. DISPLAY-ONLY / disabled in INCR-15** (roster frozen). Flag. |

> **Binds to:** `240` ← `wassce_candidates` count; `SU-0184` ← per-school WAEC **centre code** (school-level config; also §5.1); "index numbers issued Feb 2026" ← `wassce_candidates.index_number` populated. "3 flagged" ← `reg_status`.

### §4.2 Medical-exemption banner (`.reg-banner.warn`)

Warn-gradient card (`linear-gradient(135deg, warn-bg, surface)`, `border-warn`), `grid-cols-[auto_1fr_auto]`.

| Sub-element | Exact copy | Token / state |
|---|---|---|
| `.rb-ic` | `!` | `bg-warn text-bg rounded-lg 42px font-display 700` |
| `.rb-t` | `One <em>candidate</em> on medical leave · WAEC special consideration form filed` | `font-display 15px 500`, gold italic `<em>` |
| `.rb-d` | `**Y. Aidoo (F3 Slessor SCI · index 0184-0817)** is inpatient at Asankrangwa Government Hospital since 06:45 today with severe malaria. **WAEC Form SC-12 filed at 11:00**; awaiting acknowledgment. Medical certificate from Dr K. Mensah pending hospital discharge. Sickbay module → Referral log integration carries the case across modules.` | `text-navy-2 12px`, bolds `text-navy` |
| Button `Open case` | `Open case` | `.btn.primary` — **nav to Sickbay referral (module not built). DISPLAY-ONLY / inert.** |

> **FLAG — cross-module Sickbay hook, not built.** The banner "pulls live from sickbay → referral log" (per §4.6 card 1). Sickbay is **Module 4.4, not built**. For INCR-15, render the banner from a **candidate flag + note** on `wassce_candidates` (e.g. `reg_status='ON_MEDICAL'`, `sc_form='SC-12'`, a note field) — **static, no live sickbay pull**. The Sickbay→SC-12 auto-suggest is explicitly deferred (build-plan Decision 9). "F3 Slessor SCI" also references the candidate's **House** (F0) + programme — House isn't a §4 column, only banner prose.

### §4.3 Roster stat tiles (`.roster-grid`) — 4 tiles

`grid-cols-4`. `.roster-tile` white card; label `9px uppercase tracking-[0.16em] text-navy-3 700`; value `font-display 26px 500` (`.mono` variant on tile 4); trend `10px text-navy-3`.

| # | Class / accent | Label | Value | Trend | Binds to |
|---|---|---|---|---|---|
| 1 | `.roster-tile.ok` (green gradient `linear-gradient(135deg, green-bg, surface)`, `border-green`, value `text-green`) | `Confirmed` | `237` + `of 240` (sub) | `98.8% · all papers paid · index numbers issued` | `count(reg_status='CONFIRMED')` / total |
| 2 | `.roster-tile.flag` (warn gradient, `border-warn`, value `text-warn`) | `Flagged today` | `3` | `1 medical · 2 NHIS / fee admin` | `count(reg_status IN flag set)` |
| 3 | `.roster-tile` | `Accommodations` | `4` | `2 chronic · 1 sight · 1 hearing` | `count(candidates with accommodation)` — needs accommodation field |
| 4 | `.roster-tile` (value `.mono 22px`) | `Total fees` | `GHS 336k` | `Free SHS covers 100% · 0 outstanding` | **Cross-module Billing.** `240 × GHS 1,400 = 336,000`. Not spine. Flag. |

> **FLAG — tile 4 ("Total fees") is billing-derived, not spine.** `GHS 336k` = candidate count × the §5 GES fee anchor (`GHS 1,400`). Render as a **static computed read** (count × policy constant) in INCR-15, or defer. Do not pull the billing ledger.

### §4.4 Filter + sort strip (`.filter-strip`) — client view-state only

`.fs-lbl` `10px uppercase tracking-[0.14em] text-navy-3 700`. `.filter-pill` = `bg-surface border-border-2 rounded-full 11px 600 text-navy-2`; **active** = `bg-navy text-bg border-navy`. Count badge `.ct` = `bg-[rgba(200,151,91,0.18)] text-gold rounded-full font-mono 10px` (see §0.2).

- **`Show`** — `All [240]` (**active**) · `Flagged [3]` · `Accommodations [4]` · `Science [60]` · `Business [60]` · `Arts [80]` · `Home Ec. [40]`
- **`Sort`** — `Index number` · `Class` (**active**) · `Aggregate`

> **Read-only status:** these are **client-side view filters/sorts over the read-only roster** — no writes. Safe to build as interactive (URL query-param drive, mirroring `GradebookSelectors`), **or** render static-with-active-defaults for a minimal INCR-15. **FLAG:** the `Aggregate` sort binds to **Mock 2 aggregate (INCR-16/17)** — that sort key has no 0051 data; disable/omit `Aggregate` sort until then. The programme/count badges bind to `wassce_programmes` + candidate counts.

### §4.5 The roster table (`.roster-table`) — CORE SPINE, THE "240"

White table, `rounded-xl border-border`. Head (`bg-bg`, `9px uppercase tracking-[0.14em] text-navy-3 700`, `border-b border-border-2`). Body cells `11.5px text-navy-2 border-b border-border`.

**Header row (6 columns, verbatim + alignment):**

| Col | Header | Align | Cell content |
|---|---|---|---|
| 1 | `Candidate` | left | `.st-cell` = avatar `.st-av` (30px circle, initials, `font-display 10px`, tint class) + `.st-name` (`font-display 12px 600`) + `.st-id` (`font-mono 9px text-navy-3`, student code) |
| 2 | `Programme` | left | `.prog-pill` (see palette below) |
| 3 | `Index number` | left | `.ind-num` (`font-mono 11px 600 text-navy`) + optional `.sub` (`8px uppercase text-navy-3`) |
| 4 | `Reg. status` | **center** (`.c`) | `.reg-status` pill |
| 5 | `Notes / accommodation` | left | `.accom` (`10px text-navy-3`, bolds `text-navy-2`) |
| 6 | `Mock 2 agg.` | **right** (`.r`) | `.ind-num` number + `.sub` tier — **FLAG: INCR-16/17** |

**Avatar tint classes** (`.st-av`): default `bg-gold-soft text-navy` · `.terra` `bg-terra-bg text-terra` · `.warn` `bg-warn-bg text-warn` · `.green` `bg-green-bg text-green` · `.navy` `bg-[rgba(45,63,92,0.12)] text-navy-2`.

**Programme pills** (`.prog-pill`, `9px uppercase 700 rounded-full`): `.sci` "Science" `bg-terra-bg text-terra` · `.bus` "Business" `bg-gold-bg text-gold` · `.ga` "Gen. Arts" `bg-[rgba(123,74,138,0.12)] text-[#7B4A8A]` (**bespoke purple, inline style**) · `.he` "Home Ec." `bg-green-bg text-green`. *(Note "Gen. Arts" / "Home Ec." are the roster short labels vs §1's "General Arts" / "Home Economics".)*

**Reg-status pills** (`.reg-status`, `9px uppercase 700 rounded-full`): `.confirmed` `bg-green-bg text-green` · `.flag` `bg-warn-bg text-warn` · `.critical` `bg-terra-bg text-terra` (**defined in CSS, unused by demo rows** — build the class for the enum's terra tier).

**`.live-row`** (Y. Aidoo): row bg `bg-[linear-gradient(90deg,warn-bg,rgba(245,233,208,0.2))]`, first cell `border-l-3 border-warn`.

**Demo rows (verbatim — 9 rows + summary):**

| # | Avatar/tint | Name | `.st-id` | Programme | Index (`.sub`) | Reg. status | Notes / accommodation | Mock 2 agg. (`.sub`) |
|---|---|---|---|---|---|---|---|---|
| 1 (`.live-row`) | `YA` terra | Y. Aidoo | `SHS-2023-0817` | Science | `0184-0817` (`SC-12 filed`) | `On medical` (flag) | **Inpatient · severe malaria** · Asankrangwa Govt Hospital · matron escorting · medical cert pending | `10` (`tier 1`) |
| 2 | `JT` navy | J. Tetteh | `SHS-2023-0823` | Science | `0184-0823` | `Confirmed` | Sitting today's English 2 · no flags | `14` (`tier 2`) |
| 3 | `FB` navy | F. Boakye | `SHS-2023-0841` | Business | `0184-0841` | `Confirmed` | Sitting today · no flags | `16` (`tier 2`) |
| 4 | `SA` warn | S. Asante | `SHS-2023-0852` | Business | `0184-0852` | `NHIS issue` (flag) | **NHIS card expired Apr** · doesn't affect WASSCE writing · bursar SMS sent | `19` (`tier 3`) |
| 5 | `FT` navy | F. Tetteh | `SHS-2023-0860` | Business | `0184-0860` | `Confirmed` | Sick Bay Prefect · assisting matron mornings · no exam conflict | `15` (`tier 2`) |
| 6 | `AQ` navy | A. Quartey | `SHS-2023-0879` | Gen. Arts | `0184-0879` | `Confirmed` | **Pastoral · VLC flag** · Dean co-monitoring · no exam exemption | `22` (`tier 3`) |
| 7 | `EM` green | E. Mensah | `SHS-2023-0891` | Science | `0184-0891` | `Confirmed` | **Chronic accommodation** · sickle cell · extra 15 min if needed · WAEC SC-7 filed Nov | `9` (`tier 1`) |
| 8 | `KM` navy | K. Mensa | `SHS-2023-0905` | Gen. Arts | `0184-0905` | `Confirmed` | **Visual accommodation** · 1.5× time · WAEC SC-3 approved Jan | `17` (`tier 2`) |
| 9 | `PD` warn | P. Donkor | `SHS-2023-0918` | Home Ec. | `0184-0918` | `Fee` (flag) | **Late Free-SHS reconciliation** · GHS 240 outstanding · bursar working with GES district | `21` (`tier 3`) |
| — | — | **Summary row** `colspan=6`, centered italic `11px text-navy-3` | | | | | `+ 231 more rows · click to expand · sort by class shows all F3 SCI 1, then F3 SCI 2, etc.` | |

> **Binds to (per column):**
> - **Candidate** → `wassce_candidates.student_id` FK → `students` (name, `.st-id` = student code e.g. `SHS-2023-0817`). Avatar initials/tint = client-derived from name + reg_status.
> - **Programme** → `wassce_candidates.programme_id` → `wassce_programmes.name`.
> - **Index number** → `wassce_candidates.index_number` (format `<centre-serial>-<candidate-serial>`, e.g. centre `SU-0184` → `0184-0817`). `.sub` `SC-12 filed` = SC-form marker (a candidate field). **Kofi Decision 3:** `index_number` uniqueness scope is **tenant-scoped**, not global (flag owner if global chosen — leaks cross-tenant row existence).
> - **Reg. status** → `wassce_candidates.reg_status` enum. **Observed values → suggested enum:** `CONFIRMED` (green) · `ON_MEDICAL` (flag/warn, terra avatar) · `NHIS_ISSUE` (flag) · `FEE` (flag). Plus the CSS-only `critical` (terra) tier for future. Confirm enum spelling with Kofi/Wells.
> - **Notes / accommodation** → free-text `note` + a structured `accommodation` (chronic/sight/hearing) + `sc_form` (SC-3/SC-7/SC-12). The tile-3 breakdown ("2 chronic · 1 sight · 1 hearing") implies an **accommodation type** field, not just free text.
> - **Papers / sittings** → **not a visible column**, but each candidate's papers (core + chosen electives) are the `wassce_candidate_subject` join → `wassce_papers` → `wassce_paper_sittings`. The roster row *represents* a candidate whose paper set is the spine's leaf. (Surface shows papers only in prose: "Sitting today's English 2".)
> - **Mock 2 agg.** (col 6) → **FLAG: no INCR-15 binding.** Aggregate + tier are **projection outputs (INCR-16 mocks → INCR-17 projection)**. There is no `mock2_aggregate` at migration 0051. **For INCR-15 render col 6 as `—` / "pending"** (em-dash convention) or omit the column; do **not** compute or store an aggregate. This is the single biggest "surface shows more than the spine has" gap.

### §4.6 Cross-module strip (`.xmod-strip`) — 3 navy cards

Same `.xmod-card` styling as §1.6.

| Card | `.xm-lbl` | `.xm-title` | `.xm-body` (verbatim) | Binds to |
|---|---|---|---|---|
| 1 | `Cross-module · Sickbay` | `Y. Aidoo case <em>linked</em> to today's referral` | `The medical exemption banner above pulls live from **sickbay → referral log**. When the matron updates her status on the referral log, this banner updates here. Discharge will trigger the WAEC make-up scheduling.` | **FLAG: Sickbay (4.4) not built.** Static in INCR-15. |
| 2 | `Cross-module · VLC` | `A. Quartey <em>pastoral</em> cross-reference` | `Pastoral flag visible to Dean only · no exam exemption granted (VLC pastoral case is about the support, not the standards). She sits the same papers as everyone else; the Dean checks in privately.` | **FLAG: VLC (4.5) not built.** Static. "Student support" is the nav label; "pastoral" is editorial. |
| 3 | `Cross-module · Billing` | `3 fee flags <em>resolved or active</em>` | `P. Donkor's **GHS 240** is the only fee-blocking issue. Bursar is working with the GES district office. Per Free SHS policy, no candidate can be denied WASSCE for fee reasons — the school carries the gap if the district doesn't reconcile.` | **Cross-module Billing.** Static. |

> **Design commitments (preserve, wire nothing in INCR-15):** Sickbay→SC-12 make-up scheduling (Decision 9, deferred), VLC pastoral cross-reference, and Billing Free-SHS receivable. All three target modules are unbuilt or separate; render the copy, keep the hooks documented.

---

## §5 — Policy & schema anchors / frozen state

**Surface lines 1074–1202.** Section head (editorial): num `05` · title `Policy & schema anchors` · meta `WAEC · GES · Ministry of Education`.
**State: frozen** — this section *is* the freeze display. **The save-bar (§5.4) is the canonical freeze signal that binds to `wassce_setup_frozen_at`.**

### §5.1 In-app page-head

| Element | Exact copy | Token / state |
|---|---|---|
| Crumb | `WASSCE · Setup · Policy anchors` (`WASSCE`, `Setup` are `<a>`) | `text-navy-3`; `<a>` `text-gold` |
| `<h1>` | `Policy ` + `<em>anchors.</em>` | `font-display 28px`; gold italic `<em>` |
| Lede | `What the WASSCE module is built on. Three regulators (WAEC, GES, MoE), one cohort, one set of rules. The anchors below are referenced in every readiness statement.` | `text-navy-3 13px` |
| Action `Export anchors` | `Export anchors` | `.btn` — **read/export, OK** |
| Action `Audit history` | `Audit history` | `.btn.primary` — **read, OK** |

### §5.2 WAEC policy-anchors card (`.card`)

Head: `.ch-title` `WAEC <em>policy anchors</em>` · `.ch-meta` `West African Examinations Council · 1952`. Body = `grid-cols-2 gap-[18px]`, four items; each = `font-display 14px 600` sub-heading + `text-navy-2 12px` body (bolds `text-navy`).

| Sub-heading | Body (verbatim) | Binds to |
|---|---|---|
| `Centre code` | `**SU-0184** · Asankrangwa Senior High School · Western Region · Wassa Amenfi West District. Reviewed annually before registration window opens (Jan).` | Per-school WAEC **centre code** config (also §4.1 lede + index prefix) |
| `2026 calendar return` | `**First International WASSCE** since 2019. Ghana on Ghana-only calendar 2020–2025 due to COVID disruption. **21 Apr → 19 Jun 2026.**` | Cohort calendar window (constant / cohort config) |
| `Special consideration forms` | `**SC-3** (sensory/physical), **SC-7** (known chronic condition), **SC-12** (exam-day medical). Filed via WAEC online portal; medical cert from registered facility required.` | **`lib/wassce/` constant** — the SC-form vocabulary (used by §4.5 accommodation notes) |
| `Grading + aggregate` | `**A1=1, B2=2, B3=3, C4=4, C5=5, C6=6, D7=7, E8=8, F9=9.** Aggregate = best 3 cores + best 3 electives. Lower = better.` | **Same `lib/wassce/` grading constant as §1.5** — single source |

> **Binds to:** only **Centre code (`SU-0184`)** is per-school config data; the rest are **WAEC constants** (`lib/wassce/`). No new 0051 table for the constants.

### §5.3 GES operational-anchors card (`.card`)

Head: `.ch-title` `GES <em>operational anchors</em>` · `.ch-meta` `Ghana Education Service · school authority`. Body = `grid-cols-2`, four items (same type treatment as §5.2).

| Sub-heading | Body (verbatim) | Binds to |
|---|---|---|
| `Free SHS coverage` | `All WASSCE fees for school candidates covered by GES (2017 Free SHS policy). **GHS 1,400 per candidate** for core registration. Specialist electives may incur add-ons; school reconciles with GES district office.` | Policy constant; `GHS 1,400` feeds §1.6/§4.3 fee figures |
| `"No candidate denied"` | `**No student can be denied WASSCE registration for fee reasons.** If district reconciliation lags, school carries the receivable. Omnischools billing module flags this; WASSCE module ignores it.` | Policy constant (Free-SHS rule) |
| `Calendar alignment` | `Per the GES SHS 2025/26 academic calendar, F3 Semester 2 runs **3 May → 21 Jun 2026** for single-track schools (a shortened Semester 2 since F3 ends earlier than F1–F2 to make way for WASSCE). F3 students complete WASSCE during Semester 2; F1–F2 students continue Semester 2 through **21 Aug 2026** per the same calendar. School-leaver ceremony scheduled for **Fri 26 Jun** (week after WASSCE ends).` | `academic_period` (SENIOR / **SENIOR_F3** product lines, shipped in Boarding F0) |
| `Discipline pause` | `**F3 disciplinary actions paused** during WASSCE writing period unless safety-related. Boarding discipline ladder pauses for F3 from Apr 21 — penalty fees still accrue, but suspension and deboardinization on hold. Resumes Jun 22.` | **Cross-module (Boarding discipline, 4.2).** Constant/reference here. |

> **Binds to:** mostly **policy constants** (`lib/wassce/` or a `wassce_policy_anchor` reference set). "Calendar alignment" reconciles with the existing **`academic_period` SENIOR_F3** early-post-WASSCE date (already modelled in Boarding F0 — do not re-model). "Discipline pause" is a Boarding-module rule surfaced here as read-only reference. **MoE** is named in the §5.1 lede but has **no card** — three regulators framing, two cards.

### §5.4 Save-bar (`.save-bar`) — THE FREEZE SIGNAL — CORE SPINE binding

Despite the CSS name `save-bar`, this is a **frozen-state indicator, not a save control.** Gold-gradient card (`linear-gradient(135deg, gold-bg, surface)`, `border-gold 1.5px`, `rounded-xl`), `grid-cols-[1fr_auto]`.

| Sub-element | Exact copy | Token / state |
|---|---|---|
| `.sb-t` | `Setup is <em>frozen</em> for this cohort` | `font-display 16px 500`, gold italic `<em>` |
| `.sb-d` | `240 candidates registered with WAEC · 4 programmes locked · Mock 2 results posted · 11 cross-module integrations active. **WASSCE 2026 is in progress.** No further setup changes possible until WAEC results arrive in August.` | `text-navy-3 12px`, bold `text-navy` |
| Button `View change log` | `View change log` | `.btn` — **read/audit, OK** |
| Button `Open cohort readiness` | `Open cohort readiness` | `.btn.primary` — **nav to INCR-18. DISPLAY-ONLY / inert in INCR-15** (target not built) |

> **Binds to `wassce_setup_frozen_at` (Kofi Decision 1).** This card is the **primary render of the freeze marker**: present + populated ⟺ `frozen_at IS NOT NULL`. When frozen, it drives the read-only state of the whole surface (and disables §1.1 `Edit · F2 cohort` and §4.1 `+ Late registration`). **Freeze semantics to confirm with Kofi/Wells:** *where* `wassce_setup_frozen_at` lives (per-school config row vs per-cohort table), the **HoA + Headmaster co-sign** semantics, which dependent tables lock on freeze, and the change-control typo exception. INCR-15 only *reads/displays* the frozen state — it does **not** implement the freeze/unfreeze transition (that's the write-side, later).
> - **FLAG:** `.sb-d` mentions "Mock 2 results posted" (INCR-16) and "11 cross-module integrations" (aggregate of unbuilt modules). Render this as **static frozen-state copy**, not a live integration counter, in INCR-15.

---

## 6. Route, responsive & PWA notes

- **Route:** the three browser-bar URLs (`/wassce/setup/programmes`, `/registration`, `/anchors`) map to **one Setup surface** — either a single scrolling page with three anchored regions, or `/senior/wassce/setup?view=programmes|registration|anchors`. Confirm with the implementer's routing convention; the ledger map's precedent is query-param views. **All three are read-only, RLS-tenant-scoped.**
- **Responsive** (surface `@media max-width:1280px`): `prog-grid → 2col`, `stats-strip → 2col`, `roster-grid → 2col`, `xmod-strip → 1col`, `live-banner → 1col`, `col-2 → 1col`. The `.roster-table` (§4.5) has **no** column-collapse rule — on narrow widths it needs `overflow-x:auto` with a **sticky-left Candidate column** (reuse `ColumnScoreGrid`'s sticky/overflow mechanics, per the ledger map).
- **PWA:** this surface has **no dedicated `-pwa.html` variant** (unlike the score ledger). No separate PWA build target for INCR-15; the responsive desktop surface is the whole deliverable.

---

## 7. Read-only vs later-editable control inventory (INCR-15 is read-only)

Every interactive control in scope, and whether INCR-15 wires it:

| Control (section) | Kind | INCR-15 treatment |
|---|---|---|
| `Export setup` (§1.1) · `WAEC export` (§4.1) · `Export anchors` (§5.1) | Read/export | **OK to wire** (or stub) — no mutation |
| `Audit history` (§1.1) · `Audit history` (§5.1) · `View change log` (§5.4) | Read/audit | **OK to wire** (or stub) — reads audit log |
| `Print roster` (§4.1) | Read/print | **OK to wire** (browser print) |
| Filter/Sort pills (§4.4) | Client view-state | **Optional** — build as query-param filter, or static. **No writes.** Disable `Aggregate` sort (INCR-16/17 data). |
| **`Edit · F2 cohort` (§1.1)** | **WRITE (F2)** | **DISPLAY-ONLY / disabled.** Frozen F3 cohort. Do NOT wire. |
| **`+ Late registration` (§4.1)** | **WRITE** | **DISPLAY-ONLY / disabled.** Roster frozen. Do NOT wire. |
| `Open live tracker` (§1.2) | Nav (later) | **Inert** — Live-exam tracker not built |
| `Open case` (§4.2) | Nav (Sickbay) | **Inert** — Sickbay (4.4) not built |
| `Open cohort readiness` (§5.4) | Nav (INCR-18) | **Inert** — target not built |
| Freeze marker display (§5.4 save-bar, §1.1 lede) | Read | **Display only** — reads `wassce_setup_frozen_at`; does NOT implement freeze/unfreeze |

> **Three controls contradict "read-only INCR-15" if wired:** `Edit · F2 cohort`, `+ Late registration`, and any freeze *toggle*. All are the write-side of the module. **Render them disabled/inert with the frozen affordance; flag, don't build.** (Surface note lines 499: *"This page is read-only for the F3 cohort; the 'Edit' button activates for F2."*)

---

## 8. Spine-table reconciliation summary (for Kofi/Wells)

**Clean spine bindings (build against 0051):**

| Spine table | Surface elements |
|---|---|
| `wassce_programmes` | §1.3 tile 2, §1.4 prog cards (name, track colour, candidate count), §4.4 programme filters, §4.5 Programme column |
| `wassce_subjects` | §1.3 tile 3, §1.4 core + elective/alternative lists (`kind`), subject-count `23` |
| `wassce_candidates` | §1.1/§1.3 counts, §4.1 `240`, §4.3 tiles 1–3, §4.5 roster rows (student, programme, index, reg_status, notes/accommodation) |
| `wassce_candidate_subject` (join, Kofi Dec. 2) | per-candidate chosen electives (the `(or)`/`Alt` choice); FK integrity to `wassce_subjects` |
| `wassce_papers` | candidate paper set (prose only: "Sitting today's English 2") |
| `wassce_paper_sittings` | §1.2 schedule/dates ("English Language 2 (Essay) 09:30–12:00", "Day 2 of 30", `21 Apr → 19 Jun`) |
| `wassce_setup_frozen_at` (freeze marker) | §5.4 save-bar (primary), §1.1 lede "Setup is frozen", disabled Edit/Late-reg buttons |

**Elements with NO clean INCR-15 spine binding (reconcile / defer / static):**

| Element | Belongs to | INCR-15 render |
|---|---|---|
| §1.3 tile 4 "Mocks completed 2 of 2" | Mock cycle **INCR-16** | `—` / omit |
| §4.5 col 6 "Mock 2 agg." + tier | Projection **INCR-16→17** | `—` / omit column |
| §4.4 `Aggregate` sort | Projection **INCR-16→17** | disable |
| §1.2 live-exam banner (live status) | Live-exam tracker (later) | static schedule read or defer |
| §1.5 / §5.2 A1–F9 grading + aggregate | WAEC **constant** (`lib/wassce/`) | shared constant, no table |
| §5.2 SC-form vocabulary | WAEC **constant** | constant |
| §5.3 GES policy anchors (Free SHS, no-denied, discipline pause) | Policy **constants** / cross-module Boarding | constants / reference copy |
| §1.6 card 2 (Subject teacher) | **INCR-16** | static copy |
| §1.6 card 3 / §4.3 tile 4 / §4.6 card 3 (Billing fees) | Billing (cross-module) | static computed (count × `GHS 1,400`) |
| §4.2 banner + §4.6 card 1 (Sickbay referral) | Sickbay **4.4** (not built) | static from candidate flag |
| §4.6 card 2 (VLC pastoral) | VLC **4.5** (not built) | static copy |
| §5.3 "Calendar alignment" | `academic_period` **SENIOR_F3** (shipped) | reuse existing, do not re-model |
| §1.4 Gen. Arts purple `#7B4A8A` | **no design token** | per-programme `color` / inline style |
| §4.5 `.reg-status.critical` (terra) | enum tier defined-but-unused | build class for the enum's terra tier |

---

## 9. Open questions / drift log

1. **Mock 2 aggregate column on a spine-only increment (biggest gap).** §4.5 col 6 + §4.4 `Aggregate` sort + §1.3 tile 4 render projection/mock data that **does not exist at migration 0051** (INCR-16/17). INCR-15 must render col 6 as em-dash/"pending" or omit it; do not compute or store aggregates. Confirm with Kofi whether the roster ships the column shell (em-dash) or drops it until INCR-17.
2. **`index_number` uniqueness scope (Kofi Decision 3).** Surface index `0184-0817` = centre-code prefix + serial. BUILD_STACK proposed global `UNIQUE(index_number)`; repo isolation discipline wants **tenant-scoped**. Global unique across tenants leaks row existence. **Flag owner if global is chosen.**
3. **`subjects_sitting_json` vs normalized `wassce_candidate_subject` (Kofi Decision 2).** The §1.4 `(or)`/`Alt` pattern + per-candidate elective choice needs FK integrity to `wassce_subjects`. Repo composite-FK discipline argues for the **normalized join**; BUILD_STACK proposed JSON. Likely the join for RLS/FK integrity — **flag owner if it goes JSON.**
4. **Freeze marker location + co-sign semantics (Kofi Decision 1).** Where `wassce_setup_frozen_at` lives (per-school config row vs per-cohort table), HoA + Headmaster co-sign, which tables lock on freeze, the change-control typo exception. INCR-15 **only displays** the frozen state (§5.4); the freeze/unfreeze transition is write-side (later). Confirm the marker is readable at 0051 for the display.
5. **`wassce_subjects` tenancy (Kofi Decision 4).** Must carry `school_id` + composite FK to `wassce_programmes(school_id, id)` so isolation is enforceable (no through-join escape). Confirmed in build plan; noted so the surface's per-programme subject lists (§1.4) bind through the composite FK.
6. **`reg_status` enum spelling.** Surface shows `Confirmed / On medical / NHIS issue / Fee` + a CSS-only `critical` (terra) tier. Suggested enum `CONFIRMED / ON_MEDICAL / NHIS_ISSUE / FEE` (+ terra tier). Confirm the canonical set/labels with Kofi/Wells — the pill copy is display, the enum is the key.
7. **Accommodation is structured, not just a note.** §4.3 tile 3 breaks down "2 chronic · 1 sight · 1 hearing" and §4.5 notes carry `SC-3/SC-7/SC-12`. Implies an `accommodation_type` + `sc_form` field on `wassce_candidates`, not only free text. Confirm the shape with Wells.
8. **Gen. Arts purple `#7B4A8A` is not a token** (mirrors the boarding House-hex drift). Store as a per-programme `color` and render via inline `style`, or define one CSS var. Science/Business/Home Ec map cleanly to `terra`/`gold`/`green`. Never slash-opacity the purple (or the `rgba(123,74,138,0.12)` pill tint).
9. **Programme label variants.** §1 uses full names ("General Arts", "Home Economics"); §4 pills use short ("Gen. Arts", "Home Ec."). Store the canonical name in `wassce_programmes.name`; the short label is a display formatter, not a second field.
10. **Centre code is per-school config, not a spine table.** `SU-0184` appears in §4.1, §5.2, and as the index-number prefix. Confirm it lives on the school's WASSCE config (alongside/with `wassce_setup_frozen_at`), not duplicated per candidate.
11. **`.notes` right-rail + outer editorial `.page-header`/`.section-head` are design-doc chrome — do not build.** Only the in-app `.app-shell` frame is the target (same rule as the ledger map).

---

*Map produced against: `Surfaces/schoolup-wassce-setup.html` §1 (lines 293–507), §4 (lines 859–1072), §5 (lines 1074–1202); `md files/design-tokens.json` v1.0.0; `docs/senior-build-plan.md` MODULE 4.3 / INCR-15 (spine tables + Kofi Decisions 1–4); house style from `docs/senior/ledger-surface-map.md`. §2 (mock cycle → INCR-16) and §3 (university targets → INCR-17) deliberately NOT mapped.*
