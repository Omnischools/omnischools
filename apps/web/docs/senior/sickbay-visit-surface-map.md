# Sickbay — The Visit · Surface Map (INCR-22 · Module 4.4)

**Author:** Lucy (design cartographer) · **Status:** build-ready design spec for the implementation engineer (Claude Code).
**Increment:** INCR-22 — *the visit: presentation · vitals timeline · assessment · disposition · admission · **attendance-M hook*** · migration **0057** · **TRUNK** of Module 4.4 (every later surface is a projection of this record).
**Source surfaces:** `Surfaces/schoolup-sickbay-visit-record.html` (1144 lines, 5 stacked sections) · `Surfaces/schoolup-sickbay-today.html` (§01 only).
**Companions:** `docs/senior/sickbay-surface-inventory.md` (module breadth · N1–N30 / B1–B14) · `docs/senior/sickbay-setup-surface-map.md` (INCR-21, shipped).
**Board:** `docs/senior-build-plan.md` L2369–2458 (owner decisions D1–D9, Kofi R1–R31, INCR-21 build outcomes).
**Shipped spine this map builds on:** `db/schema/sickbay.ts` (`sickbay_settings` · `sickbay_bed` · `sickbay_schedule_slot`), the **frozen contract** `lib/sickbay/{config,defaults}.ts`, `lib/actions/sickbay-config.ts`, `lib/access.ts::SICKBAY_ROLES`.

---

## 0. Scope — the section-numbering reconciliation first

The task brief and the surface number these sections differently. They resolve to the same set (and to the board's INCR-22 row `visit-record §1 §2 §4 + today §1`):

| Brief label | Surface section | Surface lines |
|---|---|---|
| §1 presentation / identity | **visit-record §01** — patient header, status strip, SCD banner, presenting complaint | 297–519 |
| §2 vitals timeline | **also visit-record §01** — trend strip + vitals table (the same DOM section) | 405–494 |
| §4 assessment · disposition · admission | **visit-record §02** (assessment + consult) **and §04** (disposition + criteria + paths) | 521–636, 790–928 |
| the live queue + bed board | **today §01** — live strip, admitted block, queue, bed grid, HM strip | 237–377 |

**In scope: visit-record §01, §02, §04 + today §01.** Nothing else.

### 0.1 Out of scope — the boundary, precisely

| Section | Title (surface) | Lines | Owner | Boundary rule |
|---|---|---|---|---|
| visit-record **§03** | *Medications administered · this visit* | 638–788 | **INCR-24** | The whole MAR table, both next-dose cards, the append-only cluster note, the four source tags. 0057 authors **no** medication table and **no** `source_kind` enum. |
| visit-record **§05** | *Communications, follow-up & cross-links* | 930–1139 | **INCR-26** (+ 23/24/25 for the xlink targets) | Notification log, 4 cross-link cards, the 5-step follow-up plan, the `.action-bar`. |
| referral handoff | disposition value `REFERRED` → the referral artefact | — | **INCR-25** | 0057 authors the **enum value** and `sickbay_visit_tenant_uk`; it authors **no** hospital FK, transport, ward-update or return column. |
| today **§02** | *Today's medication rounds* | 379–467 | **INCR-24** | — |
| today **§04** | *Active referrals out* | — | **INCR-25** | — |
| today **§05** | *Outbreak monitor* | — | **INCR-27** | — |
| today **§03** | *Recent visits · last 24 hours* | 469–575 | **UNASSIGNED — flag** | The board's increment table assigns §01 to 22 and never assigns §03 to anything. It reads **only** the visit atom (time, student, complaint, action, disposition pill) and needs no new table beyond 0057. **Recommend folding it into INCR-22 as a tail slice, or opening it as INCR-22b** — leaving it unassigned strands the only route to a visit record ("click any row to open the full visit record"). Kofi call. **Not detailed in this map.** |

### 0.2 In-scope elements that structurally depend on out-of-scope increments

Nine. Each carries a stated INCR-22 resolution; every one is an **omit**, never a placeholder.

| # | In-scope element | Reaches into | INCR-22 resolution |
|---|---|---|---|
| **Y1** | visit §01 patient-header flag `Sickle cell · HbSS` | `sickbay_care_plan` (N17, INCR-23) | **OMIT the chronic flag** (see §2.2 for the two-tier alternative if Kofi wants it earlier off `student_health_record.conditions`). |
| **Y2** | visit §01 **SCD protocol banner** (whole `.protocol-banner`) | N17/N18 care plan + N4 standing order (23/24) | **OMIT the banner entirely.** Its `View care plan →` has no target and its body names the standing-order drugs (which re-identify the condition even without the condition name). |
| **Y3** | visit §04 discharge criteria *"per-condition in the chronic register's action plan"* | N17 (INCR-23) | **BUILD the criteria as matron-typed rows**; the care plan only *pre-fills* them at 23. If INCR-22 must shed weight this is the first slice to drop (the admission still keeps `target_discharge_at` + `fallback_plan`). |
| **Y4** | visit §02 second consult card (`Mr S. Bonsu · Slessor housemaster · notified`) | `sickbay_notification` (N26, authored 0060 / built INCR-26) | **OMIT the card.** It renders a *send record* (who, when, acknowledged) that no table holds. |
| **Y5** | today §01 **HM awareness strip** (both rows, timestamps `09:17`) | same as Y4 | **OMIT the strip.** Rendering "notified · 09:17" without a send row asserts a message that was never sent — the worst kind of fake on a privacy surface. Copy preserved verbatim in §5.6 for INCR-26 to port. |
| **Y6** | today §01 live tile 4 `Active referrals` | N21 (INCR-25) | **OMIT the tile.** |
| **Y7** | today §01 live tile 5 `Cluster watch · URTI` | N16 (INCR-27) | **OMIT the tile.** Live strip drops to **3 columns** (the INCR-21 capacity-strip precedent). |
| **Y8** | today §01 admitted-block narrative `.ab-line` — the med sentence (`Paracetamol 1g → 09:30 and 12:30`) and the parent sentence (`Parent (Mrs Mensa) notified 09:22 via SMS + phone call`) | INCR-24 / INCR-26 | **Render only the in-scope fragments** (impression + hydration/plan + pain trend). Both sentences restore verbatim with their increments. |
| **Y9** | visit §01 patient-header flag `NHIS · active` | N25, owner decision D3 (shape unsettled, ruled at INCR-25) | **OMIT the flag.** WASSCE precedent: omit, do not placeholder, do not fabricate. |

**INCR-22 has ZERO dependency on** standing orders, drug stock, hospitals, the notification policy tiers, outbreak surveillance, or NHIS. It depends on the **shipped** INCR-21 spine for exactly three things: `capabilities` (mode gating), `sickbay_bed` rows (the bed board), and `holdsMatronRole()` (the actor guard).

---

## 1. Shared chrome, route, tokens, type

### 1.1 Design-doc chrome — do NOT build

Both files are design documents wrapping app frames. Build **only** `.app-shell` (sidebar + main), and the sidebar is the shipped `components/app/sidebar.tsx`, not the surface's demo nav.

| Do NOT build | Where |
|---|---|
| visit-record `.page-header` (`MVP2 · Sickbay · surface 3 of 5`, h1 `The visit *record.*`, gold rule, the "One visit, completely captured…" paragraph) | 290–295 |
| today `.page-header` (`MVP2 · Sickbay · Boarding · Surface 2 of 5`, h1 `Today's *sickbay*`, the "matron's live operational view…" paragraph) | 230–235 |
| every `.section-head` (`01` / `Patient, presentation & vitals timeline` / `Matron · live record`; `02` / `Matron's assessment & visiting doctor consult` / `Clinical · scope of practice`; `04` / `Disposition · admitted, discharge target` / `Operational state`; today `01` / `Live situation · admissions, queue, key vitals` / `Now · Wed 14 May 14:45`) | 299–303, 523–527, 792–796, 238–242 |
| every `.notes` right rail (4 bullets × 3 on visit-record; 5 bullets on today) | 508–516, 625–633, 918–925, 366–375 |
| `.desktop` / `.browser-bar` / `.url` / `box-shadow:0 24px 60px -20px rgba(26,43,71,0.25)` | per section |
| `.sidebar.tall` / `.taller` min-heights, and both surfaces' contradictory demo nav (see 1.2) | — |

The `.notes` panels are **intent documentation** — port their rules (why vitals are a timeline, the medico-legal 09:14 confirmation, the scope-of-practice line, why discharge is a checklist, the HM privacy boundary), render none of their text.

### 1.2 Routes & navigation

- **Today:** `/senior/sickbay/today` — surface URL `app.omnischools.gh/sickbay/today`, repo `/senior/` prefix per the INCR-21 precedent.
- **Visit record:** `/senior/sickbay/visits/[ref]` — surface URL `…/sickbay/visits/VR-2026-05-14-0089-001`. Anchors `#assessment` / `#disposition` are **in-page sections of one route**, not sub-routes (the surface renders one page four times to show four scroll positions). `#medications` / `#communications` do not exist at 22.
- **Reference format:** `VR-{YYYY-MM-DD}-{student seq}-{visit seq}` → **`sickbay_visit.reference`**, generated server-side, `UNIQUE(school_id, reference)`, the `invoice.invoice_number` idiom. **Route by reference, not uuid** — it is printed on the crumb, spoken on the phone to a hospital, and written on a paper slip. Resolve to the row server-side inside `withSchool` (no IDOR: RLS + explicit school predicate + a re-resolved id, the INCR-21 three-layer pattern).
- **Sidebar:** the shipped flat nav has ONE sickbay row → `/senior/sickbay/setup`. **Re-point it to `/senior/sickbay/today`** and leave the row count unchanged. Grounding: a MATRON is **read-only** on setup (R18) — landing the module's primary actor on a page she cannot edit is wrong; `Today` is her home. Setup stays reachable from the Today page head (secondary `Setup` button) and from the URL. *Alternative — a second flat row `Sickbay setup` — pushes a Senior Headmaster further past twelve items; the sectioned-nav decision stays module-independent and out of INCR-22.* **Q1 for Kofi.**
- **Sub-nav:** still none. `Visit record` is a *detail* route reached by clicking a queue/visit row, never a nav item (the setup surface is right to omit it; the other three surfaces are wrong to include it — inventory §1.5).
- **Surface nav drift, for the record:** today draws `Dashboard · Students · Academics · Boarding · Sickbay · Discipline · VLC · Communications · Billing & fees · Reports`; visit-record draws `Dashboard · Students · Attendance · Boarding · Sickbay · Discipline · Communications · Reports`. **The app nav wins over both.**

### 1.3 Token reference (`:root` identical in both files → Tailwind token class)

Identical hexes to `md files/design-tokens.json`. Tailwind token classes in JSX, **never inline `var(--x)`**.

| Surface var | Hex | Tailwind | Used in scope for |
|---|---|---|---|
| `--navy` | `#1A2B47` | `text-navy` / `bg-navy` | body text, patient-header gradient start, `.q-time`, `.bed-name`, `.vv`, `.f-val`, `.cr-text b` |
| `--navy-2` | `#2D3F5C` | `text-navy-2` | patient-header gradient end, `.ar-val`, `.cc-body`, `.cb-text`, `.vitals-table td.c.ok`, `.q-complaint`, `.hm-text`, `.bed-num` |
| `--navy-3` | `#5C6675` | `text-navy-3` | crumb, lede, `.ch-meta`, `.st-lbl`/`.st-sub`, `.tt-lbl`, table `th`, `.qs-meta`, `.bed-meta`, `.vt`, `.tt-delta.flat`, `.hm-time`, second consult card's left border |
| `--gold` | `#C8975B` | `text-gold` / `bg-gold` / `border-gold` | every italic `<em>`, `.cb-lbl`, `.dc-eyebrow`, `.pain-pill.low` text, `.q-time .wait`, `.hm-house`, `.btn-sm` fill, `.ab-tag.admitted` fill, `.disp-card` border, `.criteria-row .cr-check.pending` |
| `--gold-soft` | `#E8D4B8` | `text-gold-soft` / `border-gold-soft` | `.p-detail` text, `.id-flag`, `.dc-meta` top border, `.ab-vitals` border, `.ab-line` dashed top border, `.bed-condition` top border |
| `--gold-bg` | `#F5EBDC` | `bg-gold-bg` | `.vitals-table tr.now td`, `.pain-pill.low`, `.status-tile.gold-edge` gradient end, `.disp-card` gradient start, `.live-tile.active` gradient end, `.bed.occupied` gradient end, `.d-pill.admit`, `.ab-tag` area |
| `--bg` | `#FAF7F2` | `bg-bg` | page ground, `.main`, table `th` ground, `.complaint-block`, `.trend-strip`, `.bed` ground, `.hm-row` ground; **also the light text on navy/terra fills** (`.chronic-flag`, `.ab-tag.chronic`, `.pb-icon`) |
| `--surface` | `#FFFFFF` | `bg-surface` | cards, tiles, `.page-head`, `.btn`, `.bed.empty`, `.ab-vitals`, `.pain-pill.high/.mod` text |
| `--green` | `#2F6B47` | `text-green` | `.vitals-table td.c.normal`, `.tt-delta`, `.cr-check.met` fill, `.cr-status.met`, `.triage.routine`, `.d-pill.discharge`, `.now-dot` |
| `--green-bg` | `#E5EFE8` | `bg-green-bg` | `.nhis-flag` (omitted), `.pain-pill.min`, `.triage.routine` (omitted), `.d-pill.discharge`, `.now-dot` ring |
| `--terra` | `#B84A39` | `text-terra` / `bg-terra` / `border-terra` | `.chronic-flag` fill, `.protocol-banner` border + `.pb-icon`, `.vitals-table td.c.elevated`, `.pain-pill.high`, `.tt-delta.up`, `.ar-val .neg`, `.bed.isolation` border, `.iso-tag` text, `.bed-condition`, `.live-tile.alert` |
| `--terra-bg` | `#F5E1DC` | `bg-terra-bg` | `.protocol-banner` gradient, `.iso-tag` fill, `.d-pill.refer`, `.live-tile.alert` gradient |
| `--warn` | `#C58A2E` | `text-warn` | `.vitals-table td.c.warn`, `.pain-pill.mod`, `.ab-vital .vv.warn` |
| `--warn-bg` | `#F5E9D0` | `bg-warn-bg` | **declared, unused in scope** |
| `--border` | `#E5DFD3` | `border-border` | card borders, every row divider, `.bed` rest border, `.hm-row` |
| `--border-2` | `#D4CCBA` | `border-border-2` | `.btn` border, every table `th` bottom, `.trend-strip` **dashed** border, `.consult-card` border |

**Type families:** `font-display` = **Fraunces** (h1, `.ch-title`, `.p-name`, `.st-val`, `.tt-val`, `.cb-text` *(italic body copy — unusual, deliberate)*, `.dc-title`, `.cc-who`, `.ab-name`, `.bed-name`, `.hm-house` *(italic)*, `.pb-icon`, `.live-tile .val`, avatar glyphs) · default = **Manrope** · `font-mono` = **JetBrains Mono** (`.id-flag`, `.mono-sub`, every `.vitals-table td.time` and `td.c`, `.pain-pill`, `.tt-val .u`, `.f-val .mono-i`, `.q-time`, `.bed-num`, `.vv`, `.live-tile .sub-num`, `.hm-time`, the N&MC number).

**Absent-value convention (`design-tokens.json._conventions`):** em-dash `—` in `text-navy-3` for *unknown*; a genuine `0` renders `0`. **Neither applies to an absent clinical reading** — an unrecorded SpO₂ renders **nothing** (the cell is blank), never `—` and never `0`. A dash in a vitals grid reads as "measured and normal" to a nurse scanning a column.

### 1.4 No-alpha discipline (repo memory `no-alpha-token-opacity`)

**In-scope finding: the body content of all four sections is translucency-free except ONE decorative element.** Every fill is a solid token or a dedicated `-bg` tint.

| Region | Raw value | Port to (NOT slash-opacity) |
|---|---|---|
| `.patient-header::before` decorative glow (160px circle, `top:-40px right:-40px`, inside `overflow:hidden`) | `rgba(200,151,91,0.08)` | `bg-[rgba(200,151,91,0.08)]` — **never** `bg-gold/8`. Purely decorative; dropping it is acceptable. |
| sidebar `.nav-item` / brand / footer / `.powered-by` | `rgba(250,247,242,0.7)`, `rgba(200,151,91,0.08)`, `rgba(255,255,255,0.08)`, `rgba(200,151,91,0.55)` | already shipped in `components/app/sidebar.tsx` — do not re-author |
| `.browser-bar` dots/url | `rgba(255,255,255,0.18)`, `rgba(255,255,255,0.08)` | not built |
| `.live-tile .now-dot` ring | `box-shadow:0 0 0 4px var(--green-bg)` — **a solid token**, no alpha | `ring-4 ring-green-bg` or `shadow-[0_0_0_4px_var(--green-bg)]` — safe either way |
| attendance "M" chip (if rendered anywhere) | — | **reuse `ATTENDANCE_STATUS_META.MEDICAL`** from `lib/attendance-status.ts` (`bg-navy-2 text-white`, letter `M`) — it already solves the tint problem with an inline rgba. Do not author a second chip. |

**Verify in the live preview, not the build.** Slash-opacity on a raw-hex token renders *nothing* and `next build` passes.

### 1.5 Bespoke / non-token values in scope — reproduce exactly, do not round to a scale step

**visit-record**

| Element | Bespoke value |
|---|---|
| `.patient-header` | `linear-gradient(135deg, var(--navy) 0%, var(--navy-2) 100%)` · `rounded-[14px]` · `p-[24px_28px]` · `grid-cols-[auto_1fr_auto] gap-6 items-center` · `relative overflow-hidden` |
| `.patient-av` | `size-[72px] rounded-full bg-gold text-navy` · Fraunces `24px` 600 |
| `.p-name` | Fraunces `26px` 500 `tracking-[-0.018em] leading-[1.1] mb-1`; `<em>` italic gold 400 |
| `.p-detail` | `12px text-gold-soft flex gap-4 flex-wrap`; `<b>` → `text-bg font-semibold`; `.dot` → `text-gold` |
| `.chronic-flag` | `bg-terra text-bg` `10px/0.1em` uppercase 700 `px-[11px] py-[5px] rounded-full` |
| `.nhis-flag` | `bg-green-bg text-green` `9px/0.08em` uppercase 700 `px-[10px] py-[4px] rounded-full` |
| `.id-flag` | `font-mono 10px text-gold-soft font-medium` |
| `.status-strip` / `.status-tile` | `grid-cols-4 gap-3 mb-6` · tile `bg-surface border border-border rounded-[10px] p-[14px_16px]` |
| `.status-tile.gold-edge` | `border-gold border-[1.5px]` + `linear-gradient(180deg, var(--surface) 0%, var(--gold-bg) 100%)` |
| `.st-lbl` / `.st-val` / `.mono-sub` / `.st-sub` | `9px/0.14em` uppercase 700 navy-3 · Fraunces `18px` 600 `tracking-[-0.01em] leading-[1.15]` · `font-mono 13px text-navy-2 font-medium` · `10px italic text-navy-3`, `<b>` → `text-navy-2 not-italic font-semibold` |
| `.protocol-banner` *(omitted at 22 — recorded for INCR-23)* | `linear-gradient(135deg, var(--terra-bg) 0%, var(--surface) 100%)` · `border border-terra rounded-[10px] p-[14px_18px]` · `grid-cols-[auto_1fr_auto] gap-[14px]`; `.pb-icon` `size-8 rounded-full bg-terra text-surface` Fraunces **italic** 600 14px |
| `.card` / `.card-head` / `.card-body` | `bg-surface border border-border rounded-xl overflow-hidden mb-[18px]` · head `p-[14px_20px_12px] border-b border-border flex justify-between items-baseline` · body `p-[16px_20px_20px]` |
| `.ch-title` / `.ch-meta` | Fraunces `16px` 600 `tracking-[-0.005em]`, `<em>` italic gold 400 · `10px text-navy-3 font-semibold tracking-[0.06em]` |
| `.trend-strip` | `grid-cols-5 gap-[14px] mb-[18px] p-[18px_20px] bg-bg` **`border border-dashed border-border-2`** `rounded-[10px]` |
| `.tt-lbl` / `.tt-val` / `.u` / `.tt-delta` | `9px/0.14em` uppercase 700 · Fraunces `22px` 600 `leading-none mb-[3px]`, `<em>` italic gold 400 · `font-mono 11px text-navy-3 font-medium` · `10px font-bold text-green`, `.up` → terra, `.flat` → navy-3 |
| `.vitals-table` | `w-full border-collapse`; `th` `bg-bg p-[9px_12px] 9px/0.14em uppercase 700 text-navy-3 text-left border-b border-border-2` (`.c` centre, `.r` right); `td` `p-[11px_12px] text-[12px] border-b border-border align-middle`; last row no border |
| `td.time` | `font-mono 11px text-navy-2 font-semibold`; `.day` `block 9px text-navy-3 font-medium mt-px` **font-body** (Manrope inside a mono cell — deliberate) |
| `td.c` severity | `.elevated` terra 700 · `.warn` warn 600 · `.ok` navy-2 · `.normal` green 600 |
| `tr.now td` | `bg-gold-bg`; `tr.now td.time` → `text-navy` |
| `.pain-pill` | `inline-block px-[7px] py-[2px] rounded-full font-mono 10px font-bold` · `.high` `bg-terra text-surface` · `.mod` `bg-warn text-surface` · `.low` `bg-gold-bg text-gold` · `.min` `bg-green-bg text-green` |
| `.complaint-block` | `bg-bg border border-border rounded-[10px] p-[18px_20px]`; `.cb-lbl` `10px/0.14em` uppercase 700 **gold**; `.cb-text` **Fraunces 15px italic text-navy-2 leading-[1.55]**, `<b>` → `not-italic text-navy font-semibold`; `.cb-byline` `10px text-navy-3 italic mt-[10px]`, `<b>` → `text-navy-2 not-italic font-semibold` |
| `.assessment-row` | `grid-cols-[140px_1fr] gap-[18px] py-3 border-b border-border`, last none; `.ar-lbl` `10px/0.14em` uppercase 700 navy-3 `pt-[2px]`; `.ar-val` `13px text-navy-2 leading-[1.55]`, `<b>` navy 600, **`<em>` → gold `not-italic` 600** (⚠️ the one place a gold `<em>` is NOT italic), `.pos` green 600, `.neg` terra 600 |
| assessment "Recorded by" licence span | inline `style="font-family:monospace; font-size:11px;"` → `font-mono text-[11px]` |
| `.consult-card` | `bg-surface border border-border-2` + **`border-l-[3px] border-l-gold`** `rounded-[10px] p-[16px_20px] mb-[14px]`; variant 2 overrides the left border to `--navy-3` |
| `.cc-who` / `.cc-time` / `.cc-body` / `.cc-mode` | Fraunces `14px` 600 + em italic gold · `font-mono 10px text-navy-3 font-semibold` · `12px text-navy-2 leading-[1.55]`, `<b>` navy 600, **`<em>` gold `not-italic` 600** · pill `9px/0.1em` uppercase 700 `bg-gold-bg text-gold ml-2 px-2 py-[2px] rounded-full`; variant 2 overrides to `bg-bg text-navy-2 border border-border` |
| `.disp-card` | `linear-gradient(135deg, var(--gold-bg) 0%, var(--surface) 100%)` · **`border-2 border-gold`** `rounded-[14px] p-[22px_26px] mb-5` |
| `.dc-eyebrow` / `.dc-title` / `.dc-meta` / `.f-lbl` / `.f-val` | `10px/0.16em` uppercase 700 gold · Fraunces `22px` 500 `tracking-[-0.018em] leading-[1.15]`, em italic gold 400 · `grid-cols-3 gap-[18px] pt-[14px]` **`border-t border-gold-soft`** · `9px/0.14em` uppercase 700 navy-3 · `13px font-semibold text-navy`, `.mono-i` `font-mono 11px`, `<em>` italic gold 600 |
| `.criteria-row` | `grid-cols-[24px_1fr_auto] gap-3 py-[10px] border-b border-border items-center`; `.cr-check` `size-5 rounded-full grid place-items-center 11px font-bold`; `.met` `bg-green text-surface` glyph `✓`; `.pending` `bg-gold-bg border-[1.5px] border-gold` containing an **8px gold dot** (`::before` → render a real `<span aria-hidden>`); `.cr-text` `12px text-navy-2`, b navy 600; `.cr-status` `10px/0.08em` uppercase 700, `.met` green / `.pending` gold |
| `.col-2` | `grid-cols-2 gap-[18px] mb-[18px]` |
| `.cluster-note` | ⚠️ **the class is used (line 909) but never defined in this file's `<style>`.** Take the definition from `schoolup-sickbay-setup.html:191–192`: `bg-bg border border-dashed border-border-2 rounded-[10px] p-[14px_18px] mt-4 text-[12px] text-navy-3 italic`; `<b>` → `text-navy-2 not-italic font-semibold` |

**today §01**

| Element | Bespoke value |
|---|---|
| `.live-strip` / `.live-tile` | `grid-cols-5 gap-[14px] mb-6` → **`grid-cols-3` at INCR-22** (Y6/Y7) · tile `bg-surface border border-border rounded-xl p-[16px_18px] relative` |
| `.live-tile.active` / `.alert` | `border-gold border-[1.5px]` + `linear-gradient(180deg, var(--surface) 0%, var(--gold-bg) 100%)` / same with terra + `--terra-bg` |
| `.live-tile .lbl` / `.val` / `.sub-num` / `.meta` / `.now-dot` | `9px/0.14em` uppercase 700 navy-3 · Fraunces **32px** 600 `tracking-[-0.018em] leading-[1.05] mt-[3px]`, em italic gold · `font-mono 14px text-navy-3 font-medium` · `10px italic text-navy-3`, b → navy-2 not-italic 600 · `absolute top-[14px] right-[14px] size-2 rounded-full bg-green ring-4 ring-green-bg` |
| `.adwoa-block` | ⚠️ **the CSS class is named after a fabricated demo patient — rename to `.admitted-block`.** `linear-gradient(180deg, var(--gold-bg) 0%, var(--surface) 100%)` · `border-[1.5px] border-gold rounded-[14px] p-[20px_24px] mb-6` |
| `.ab-name` / `.ab-meta` / `.ab-tag` | Fraunces `20px` 600 `tracking-[-0.01em]`, em italic gold 400 · `11px text-navy-3 mt-[3px]`, b navy-2 600 · pill `9px/0.08em` uppercase 700 `px-[9px] py-[3px] rounded-full`; `.chronic` `bg-terra text-bg`; `.admitted` `bg-gold text-navy` |
| `.ab-vitals` / `.vl` / `.vv` / `.vt` | `grid-cols-5 gap-[10px] mt-[14px] p-3 bg-surface border border-gold-soft rounded-lg` · `9px/0.12em` uppercase 700 navy-3 · **`font-mono 14px font-semibold text-navy`**, `.warn` → warn · `9px text-navy-3 italic mt-[2px]` |
| `.ab-line` | `12px text-navy-2 mt-3 pt-[10px]` **`border-t border-dashed border-gold-soft`** `leading-[1.6]`; `.arrow` gold `mx-1` |
| `.card.featured` | `border-gold border-[1.5px]` |
| `.queue-row` | `grid-cols-[70px_1fr_130px_80px_80px] gap-[14px] p-[14px_20px] items-center border-b border-border` → **`grid-cols-[70px_1fr_130px_80px]` at 22** (the `q-flag` column is omitted, Y1) |
| `.q-time` / `.wait` | `font-mono 13px font-semibold text-navy` · `block 9px text-gold font-bold tracking-[0.08em] uppercase mt-[2px]` **font-body** |
| `.qs-name` / `.qs-meta` | `13px font-semibold text-navy mb-px` · `11px text-navy-3`, b navy-2 600 |
| `.q-complaint` / `.triage` | `12px text-navy-2` · pill `9px/0.08em` uppercase 700 `mt-1 px-[7px] py-[2px] rounded-full`, `.routine` `bg-green-bg text-green` *(omitted at 22 — §5.4)* |
| `.btn-sm` | `px-[11px] py-[6px] text-[11px] font-semibold rounded-[5px] border border-gold bg-gold text-navy` |
| `.bed-grid` / `.bed` | `grid-cols-4 gap-[10px] p-[18px_20px]` · `bg-bg border border-border rounded-[10px] p-[14px] min-h-[100px] flex flex-col gap-[6px] relative` |
| `.bed.empty` / `.occupied` / `.isolation` | `bg-surface border-dashed`, `.bed-num` → navy-3, `.bed-state` → `mt-auto 11px italic text-navy-3` · `linear-gradient(180deg, var(--surface) 0%, var(--gold-bg) 100%)` + `border-gold border-[1.5px]` · `border-terra border-dashed`; `.isolation.empty` → `bg-surface` |
| `.bed-num` / `.iso-tag` / `.bed-name` / `.bed-meta` / `.bed-condition` | `font-mono 10px/0.1em` uppercase 700 navy-2 · `ml-[6px] px-[6px] py-px rounded-full bg-terra-bg text-terra 8px/0.08em 700` · Fraunces `14px` 600 navy · `10px text-navy-3`, b navy-2 600 · `10px font-bold tracking-[0.06em] uppercase mt-auto pt-[6px]` **`border-t border-gold-soft`** — ⚠️ colour changes from `text-terra` to `text-navy-3` (§5.5 ruling) |
| `.hm-strip` *(omitted at 22 — recorded for INCR-26)* | `bg-surface border border-border rounded-[10px] p-[14px_18px] mt-[18px]`; `.hs-rows` `grid-cols-2 gap-[10px]`; `.hm-row` `flex gap-[10px] items-center 11px p-[7px_10px] bg-bg border border-border rounded-md`; `.hm-house` **Fraunces italic 12px text-gold 600** |
| `.page-head` / `.body` | `bg-surface border-b border-border p-[24px_36px_22px]` · `p-[28px_36px_60px]` |

---

## §V1 — visit-record §01 · Patient, presentation & vitals timeline

**Surface lines 297–519.** Actor in the sidebar footer: `A. Bediako` / `Matron · N&MC reg.` — **render the acting user, never a hardcoded name** (R18).

### V1.1 Page head — exact copy

| Element | Exact copy | Token / type |
|---|---|---|
| Crumb | `Sickbay` *(link)* ` · ` `Today` *(link)* ` · Visit VR-2026-05-14-0089-001` | `text-navy-3 text-[11px] tracking-[0.12em] uppercase font-semibold`; links `text-gold no-underline` |
| `<h1>` | `Visit ` + `<em>record.</em>` | `font-display text-[28px] font-medium tracking-[-0.018em] leading-[1.1]`; `<em>` italic gold 400 |
| Lede | `Admitted **09:14** · Wed 14 May 2026 · Bed **3** · Day-shift attending **Mrs A. Bediako**` | `text-navy-3 text-[13px] mt-1 max-w-[720px]`; `<b>` → `text-navy-2 font-semibold` |
| Action 1 | `Print summary` | `.btn` — **OMIT at 22** (no print artefact; §11) |
| Action 2 | `Add note` | `.btn` — **OMIT at 22** (no note entity; the assessment card *is* the note) |
| Action 3 | `Update vitals` | `.btn.primary` = `bg-navy text-bg border-navy font-bold` — **BUILD** (W5) |

**Lede is fully derived and mode-dependent.** For a non-admitted visit it must not say "Admitted / Bed": render `Seen **09:14** · Wed 14 May 2026 · Attending **{name}**`. **AUTHORED** — the surface only ever draws the admitted case.

### V1.2 Patient header

| Element | Exact copy (demo) | Binding | INCR-22 |
|---|---|---|---|
| `.patient-av` | `AM` | derived — reuse `initials()` from `lib/sickbay/defaults.ts` (shipped, honorific-stripping) | BUILD |
| `.p-name` | `Adwoa ` + `<em>Mensa</em>` | `students.first_name` + `last_name`; the surname carries the gold italic | BUILD |
| detail 1 | `**F1 SCI** · age 15` | `classes` + `students.programme` via `formLabel()`; age from `students.date_of_birth` — **render the age fragment only when DOB is present** | BUILD |
| detail 2 | `**Slessor** House · bed S-12-B` | `houses.name` **BACKED**; `bed S-12-B` = **B1, NO CLEAN BINDING** — `boarding_bunk` is dormitory name + `position_number` with no upper/lower axis | House BUILD · **bunk fragment OMIT** |
| detail 3 | `Mother **Mrs E. Mensa** · primary contact` | `student_guardian` where `is_primary` — `relationship` (title-cased) + `name` + the literal ` · primary contact` | BUILD |
| `.chronic-flag` | `Sickle cell · HbSS` | N17 (INCR-23) | **OMIT** (Y1) |
| `.nhis-flag` | `NHIS · active` | N25 / D3 | **OMIT** (Y9) |
| `.id-flag` | `AS-2024-F1-0089` | `students.student_code` — render **verbatim as stored**, never reformat, never regex-validate | BUILD |

⚠️ **`bed 3` (lede, status tile, disposition card) and `bed S-12-B` (patient header) are two different beds** — a sickbay bed row and a boarding dorm bunk. They appear 12 lines apart. `sickbay_bed` and `boarding_bunk` must never be conflated (R7 exists for exactly this reason). Name the props `sickbayBedNumber` and `dormBunkLabel` so the conflation cannot happen silently.

### V1.3 Status strip — 4 tiles

| # | `.st-lbl` | `.st-val` | `.st-sub` | Derivation | Mode C |
|---|---|---|---|---|---|
| 1 | `Disposition` | `<em>Admitted</em>` (gold italic) | `general ward · **bed 3**` | `sickbay_visit.disposition` + `sickbay_admission.bed_id → bedNumber` | renders `Referred` / `Discharged`; **no bed sub-line** |
| 2 | `Time on ward` | `05h 31m` (mono) | `from **09:14**` | `now − admitted_at`, format `HHh MMm` (zero-padded hours) | **not rendered** |
| 3 | `Pain · current` | `2/10` (mono) + `<em>↓</em>` | `was **6/10** on arrival` | latest vs first `sickbay_vitals.pain`; arrow `↓` improving / `↑` worsening / omit when equal | renders (pain is a visit fact, not an admission fact) |
| 4 | `Expected discharge` | `16:00` (mono) | `if criteria **met**` | `admission.target_discharge_at`; sub-line is a fixed string | **not rendered** |

Tile 1 is `.gold-edge`. When `target_discharge_at` is null, tile 4 does **not** render (the strip becomes 3-up), never `—`.

### V1.4 SCD protocol banner — **OMITTED at INCR-22 (Y2)**

Copy recorded verbatim for INCR-23:
- `.pb-icon` `SCD` · title `Sickle cell pain crisis protocol ` + `<em>· active</em>`
- `.pb-sub` `Following standing order: **hydroxyurea continuation + paracetamol PRN + oral hydration**. Escalate if pain >7/10, fever >38.5°C, chest pain, or breathlessness.`
- `.pb-link` `View care plan →`

### V1.5 Vitals card — the section's clinical core

Card head: `Vitals ` + `<em>timeline</em>` · meta `4 readings · last **14:30**` — **derived** (`{n} readings · last {HH:MM}`; singular `1 reading`).

**The trend strip — 5 tiles**

| # | `.tt-lbl` | `.tt-val` | `.tt-delta` | Rule |
|---|---|---|---|---|
| 1 | `Temp` | `37.2` + `<span class="u">°C</span>` | `−0.6 from arrival` | `latest − first`, 1 dp, U+2212 minus |
| 2 | `BP` | `108` + `<span class="u">/68</span>` | `stable` | **no scalar delta exists for a composite reading** → render `from 110/72` (the arrival value). **AUTHORED**, replaces the surface's unearned `stable` |
| 3 | `Heart rate` | `84` + `<span class="u">bpm</span>` | `−12 from arrival` | `latest − first`, integer |
| 4 | `SpO₂` | `98` + `<span class="u">%</span>` | `stable` (`.flat`) | delta 0 → literal `stable` in `.flat` navy-3 |
| 5 | `Pain (0-10)` | `<em>2</em>` (gold italic — the headline metric) | `−4 from arrival` | integer |

Delta colour: **improving → green (default) · worsening → `.up` terra · unchanged → `.flat` navy-3 + the literal `stable`.** Direction-of-improvement is per metric (temp down = better; SpO₂ **up** = better; pain down = better; HR down = better within range). One pure function, unit-tested. ⚠️ The surface renders BP's "stable" in green and SpO₂'s in flat — inconsistent; the rule above normalises both to `.flat`. Two-token deviation, deliberate.

With only **one** reading there is no delta: render the tiles with values and **no** delta line (never `0`, never `stable`).

**The vitals table**

Columns: `Time` · `Temp` (c) · `BP` (c) · `HR` (c) · `SpO₂` (c) · `Pain` (c) · `Taken by` (r).

| Row | `td.time` | `.day` sub | Temp | BP | HR | SpO₂ | Pain | Taken by |
|---|---|---|---|---|---|---|---|---|
| 1 | `09:14` | `on arrival` | `37.8°C` warn | `110/72` ok | `96` warn | `98%` ok | `6/10` `.mod` | `A. Bediako` |
| 2 | `11:00` | `2h obs` | `37.6°C` warn | `109/70` ok | `92` ok | `98%` ok | `5/10` `.low` | `A. Bediako` |
| 3 | `13:30` | `post-meds` | `37.4°C` ok | `108/70` ok | `88` ok | `98%` ok | `3/10` `.low` | `G. Antwi` |
| 4 `tr.now` | `14:30` | `current` | `37.2°C` **normal** | `108/68` normal | `84` normal | `98%` normal | `2/10` `.min` | `A. Bediako` |

**The severity ladder — one pure function `vitalSeverity(metric, value, isCurrentRow)` reproduces all 24 coloured cells:**

| Metric | `warn` | `elevated` | else |
|---|---|---|---|
| Temp | `> 37.5` | `≥ 38.5` (the assessment's own escalation threshold) | in-range |
| HR | `> 95` | `≥ 120` **(authored — no surface value exercises it)** | in-range |
| SpO₂ | `< 94` (the assessment's own trigger) | `< 90` **(authored)** | in-range |
| BP | — | — | **no ladder.** The surface never colours a BP cell anything but ok/normal; do not invent adolescent BP thresholds |
| Pain | pill ladder below | | |

In-range cells render **`.normal` (green) on the current row** and **`.ok` (navy-2) on historical rows** — that single rule explains why `98%` is navy on row 1 and green on row 4.

**Pain pill ladder** (from the four drawn values 6→mod, 5→low, 3→low, 2→min): `0–2 .min` · `3–5 .low` · `6–7 .mod` · `8–10 .high`. Rendered `{n}/10`.

**The `.day` context sub-line — split by derivability:**
- `on arrival` (first row) and `current` (latest row) are **derived**, never stored.
- `2h obs` and `post-meds` are **not derivable** → a nullable `context_note` (≤ 32 chars) typed by the taker; renders nothing when absent.

**`Taken by`** = `{initial}. {Surname}` of `taken_by_user_id` — abbreviate at render, store the FK.

### V1.6 Presenting complaint block

| Element | Exact copy | Binding |
|---|---|---|
| `.cb-lbl` | `Presenting complaint · as recorded` | static |
| `.cb-text` | `"Joint pain — **knees, lower back, both wrists**. Started overnight. Worsened after morning prep run before 06:30 round. Mild abdominal discomfort, no nausea. No fever felt by patient. Took her usual hydroxyurea at 06:30 morning round."` | `sickbay_visit.complaint` (N8) — free text, **rendered inside literal typographic quotes**, Fraunces italic |
| `.cb-byline` | `Recorded by **F. Tetteh · Sick Bay Prefect** at intake 09:11 · confirmed by Matron at **09:14**` | see below |

**The byline is the module's sharpest actor problem (B3) and it lands here.** A *student* records the complaint; the notes panel calls the Matron's 09:14 confirmation *"the medico-legal anchor — the Council's scope of practice is clear that clinical assessment must be by the registered nurse."*

**Ruling — recorded attribution, not an authenticated actor.** Mirror **R21** (the visiting doctor, already ratified): the prefect is *named on the record*, not an actor with a write path.
- `recorded_by_user_id` → the staff member who keyed it (may be the matron herself).
- `intake_prefect_student_id` → nullable composite FK to `students`; renders `{shortName} · Sick Bay Prefect`. **No login, no session, no role.** Candidates come from the shipped `getHealthPrefects()` derivation.
- `intake_at` (09:11) and `confirmed_at` / `confirmed_by_user_id` (09:14). **`confirmed_by` MUST hold MATRON in this school** — reuse the shipped `holdsMatronRole()`; validated at the app layer, never a DB trigger (the J3 precedent).
- Byline renders three ways: prefect + confirmation (as drawn) · staff-only (`Recorded by **{name}** at intake {time}`) · unconfirmed (`Recorded by … · **awaiting Matron confirmation**` — **AUTHORED**, gold, and it must be visible: an unconfirmed clinical record is an operational state, not a blank).

---

## §V2 — visit-record §02 · Matron's assessment & visiting doctor consult

**Surface lines 521–636.**

### V2.1 Page head

| Element | Exact copy |
|---|---|
| Crumb | `Sickbay` *(link)* ` · Visit **VR-2026-05-14-0089-001**` |
| `<h1>` | `Assessment & ` + `<em>consult.</em>` |
| Lede | `Matron's clinical reasoning, the visiting doctor's input, and the line where each takes responsibility.` |
| Actions | none |

At 22 this is the `#assessment` anchor of the visit route, not a second page: keep the h1 as an in-page section heading (`font-display text-[28px]`), keep the lede, drop the crumb repeat.

### V2.2 Matron's assessment card

Head: `Matron's ` + `<em>assessment</em>` · meta `recorded **09:42** · A. Bediako · N&MC #N-04827` — **derived** from `recorded_at` + the actor + `staff_profile.nmc_licence_number` (shipped at 0056). Store the bare value `N-04827`; `N&MC #` is render chrome; `font-mono`. Omit the licence fragment when null.

Six `.assessment-row`s, verbatim:

| `.ar-lbl` | `.ar-val` (verbatim) | Field |
|---|---|---|
| `Working impression` | `**Mild sickle cell pain crisis** — vaso-occlusive type, joint & lower-back distribution. Likely triggered by *dehydration + cold dawn + physical exertion*. No acute chest signs, no fever spike, oxygen saturation maintained.` | `working_impression` text · **required** |
| `Red flags screened` | `*Negative* · chest pain · breathlessness · pallor change · jaundice progression · severe headache · neurological signs · abdominal guarding · fever above 38.5°C.` | `red_flags_negative boolean` + `red_flags_screened text` |
| `Hydration status` | `Mild dehydration on arrival (dry tongue, reduced skin turgor). **Tolerating oral fluids** — ORS 500ml + water taken since admission. Urine output reported normal at 13:00 toilet break.` | `hydration_status text` nullable |
| `Plan` | `**Continue standing order** — oral analgesia per protocol, encourage 200ml fluid every 30 min, rest on ward, reassess every 2 hours. *Hold for visiting doctor input* at next phone window before changing protocol.` | `plan text` nullable |
| `Escalation triggers` | `Pain rises to *≥7/10* · temperature *>38.5°C* · any chest pain or breathlessness · SpO₂ *<94%* · vomiting unable to retain fluids · drowsiness. → **Same-day referral to Asankrangwa Government Hospital**.` | `escalation_triggers text` nullable |
| `Recorded by` | `**Mrs Akua Bediako** · School Matron · Nursing & Midwifery Council reg. `N-04827` · within scope of practice for first-line vaso-occlusive management.` | **derived** — actor name + `staffDesignation()` + licence. **Trim the trailing clause** `· within scope of practice for first-line vaso-occlusive management` (per-case editorial that restates the impression). |

**🔴 D1 vocabulary commitment — the field is `working_impression`, never `diagnosis`.** *"The Matron documents her working impression — what she clinically thinks. She does not write 'diagnosis'; that's a doctor's word."* Column name, TypeScript field, form label, and every log line use `working_impression`. This is a scope-of-practice commitment ratified by the owner; a rename is a product regression.

**Markup in the copy:** the `<span class="pos">Negative</span>` and the three `<span class="neg">` threshold highlights are **decoration over free text**. Store plain text; render plain. Do not invent a marker syntax to preserve the highlight, and do not store HTML. *(`splitBold()` exists in `defaults.ts` for `**bold**` in static editorial only — assessment text is user input, not editorial.)* The `Negative` verdict survives as the boolean, rendered `.pos` green ahead of the list.

**One assessment per visit** (`UNIQUE(school_id, visit_id)`), upserted, `updated_at` stamped, every save audited with before/after snapshots (not patches — the INCR-21 Dex D2 lesson).

### V2.3 Visiting doctor consult card

| Element | Exact copy | Binding |
|---|---|---|
| `.cc-who` | `Dr K. ` + `<em>Mensah</em>` + ` · visiting doctor` + `.cc-mode` pill `phone consult` | `clinician_name` (defaults to `sickbay_settings.visiting_doctor_name`, editable per consult) + `mode` enum |
| `.cc-time` | `11:30 · 14 May` | `consulted_at` |
| `.cc-body` | `Discussed vitals trend, no red flags. *Approved Matron's plan* — continue oral analgesia + hydration + observation. No need for hospital transfer at this point. **Will visit in person Thursday 14:00 round** for review. If pain rebounds overnight, call Asankrangwa Govt. ER directly; they have her chronic register summary on file from January admission.` | `body text` |

- **R21 applies verbatim:** the doctor is **not** a system user. `sickbay_consult` stores `clinician_name` + `clinician_affiliation` text and `recorded_by_user_id` = the matron who transcribed. No `ref_user`, no `role_assignment`, no invite.
- **Separate artefact, never folded into the assessment** (notes: *"Dr Mensah's call took 8 minutes; the record reflects what he actually said, not a summary"*). Many consults per visit, chronological.
- `mode` enum `PHONE | IN_PERSON` — `phone consult` is the only value drawn; `IN_PERSON` is implied by the body and by the shipped `DOCTOR_VISIT` slot. Render pill copy `phone consult` / `in-person consult` (**AUTHORED** for the second).
- Mode C: `capabilities.visitingDoctor === false` → the **`Log consult` control does not render**; any stored consults still render (data filter vs affordance filter, R3).

### V2.4 Housemaster notification card — **OMITTED at INCR-22 (Y4)**

Copy recorded verbatim for INCR-26:
- `.cc-who` `Mr S. ` + `<em>Bonsu</em>` + ` · Slessor housemaster` + pill `notified` (neutral variant: `bg-bg text-navy-2 border border-border`); card `border-l` overridden to `--navy-3`
- `.cc-time` `09:20 · 14 May`
- `.cc-body` `Informed Adwoa admitted, sickle cell crisis, mild. *Attendance auto-excused* for the day. Slessor house dorm-side care plan PDF is on file with him; he confirmed possession. Will visit ward at 16:00 if she's discharged before evening prep.`

⚠️ This card asserts **`Attendance auto-excused for the day`**. INCR-22 must make that assertion TRUE (§10) even though the card that states it is not built until 26.

---

## §V4 — visit-record §04 · Disposition · admitted, discharge target

**Surface lines 790–928.**

### V4.1 Page head

| Element | Exact copy |
|---|---|
| Crumb | `Sickbay` *(link)* ` · Visit **VR-2026-05-14-0089-001** · Disposition` |
| `<h1>` | `Disposition ` + `<em>& discharge.</em>` |
| Lede | `Currently admitted · target discharge **16:00 today** if four criteria met. The criteria are explicit, checkable, and visible to the Matron who covers night shift.` — **derived** (`{n} criteria`), and mode/disposition dependent |

### V4.2 Disposition card (`.disp-card`)

| Element | Exact copy | Binding |
|---|---|---|
| `.dc-eyebrow` | `Current disposition` | static |
| `.dc-title` | `Admitted · ` + `<em>general ward, bed 3</em>` | disposition + `general ward` / `isolation` from `sickbay_bed.is_isolation` + `bed {n}` |
| field 1 | `Admitted` / `09:14 · 14 May` (`.mono-i` on the time) | `admission.admitted_at` |
| field 2 | `Target discharge` / `<em>16:00 today</em>` | `target_discharge_at`; `today` / `tomorrow` / a date, derived |
| field 3 | `Fallback overnight plan` / `stay on ward, Mrs Antwi covers` | `fallback_plan text` nullable |

Non-admitted dispositions render the same card with two fields: `Discharged · <em>home to Slessor House</em>` / `Referred · <em>{destination}</em>` (**AUTHORED** — the surface only draws the admitted case). When `target_discharge_at` and `fallback_plan` are both null the `.dc-meta` row collapses; the card keeps eyebrow + title.

### V4.3 Discharge criteria card

Head: `Discharge ` + `<em>criteria</em>` · meta `3 of 4 met · pending reassessment at 16:00` — **derive** `{met} of {total} met`; the trailing clause renders only when `target_discharge_at` is set.

| `.cr-check` | `.cr-text` (verbatim) | `.cr-status` |
|---|---|---|
| `.met` ✓ | `**Pain ≤2/10** at reassessment` | `Met · 14:30` |
| `.met` ✓ | `**Temperature normal range** (36.5-37.5°C)` | `Met · 14:30` |
| `.met` ✓ | `**Oral intake adequate** — ≥750ml fluids since admission` | `Met · 850ml total` |
| `.pending` dot | `**Mobilising independently** — ward to bathroom unassisted` | `Pending · 16:00 test` |

- Rows are **matron-typed at INCR-22** (`text`, `sort_order`, `met boolean`, `met_at`, `met_detail`). The `.cr-status` renders `Met · {HH:MM}` **or** `Met · {met_detail}` when a detail is present (`850ml total`), else `Pending · {target time}` / bare `Pending`.
- **Per-condition templates are INCR-23** (*"SCD has these four, asthma has different ones, anaphylaxis has its own"*). At 23 the care plan seeds the rows; the stored instance shape does not change.
- Empty state (no criteria): the card does **not** render. A discharge with no checklist is legitimate for a 20-minute headache visit — an empty checklist card would imply a missing one.

### V4.4 The two path cards (`.col-2`)

| Card | Head | Meta | Body (verbatim) | Binding |
|---|---|---|---|---|
| 1 | `If criteria ` + `<em>met</em>` | `expected path` | `Discharge to Slessor House at **16:00**. Excused from **tomorrow's 06:00 prep run** (auto-applied to roll-call). Resume normal hydroxyurea schedule from 06:30 round. Slessor HM to check on her at evening prep **19:00**. Return to sickbay immediately if any pain return.` | `discharge_plan text` nullable |
| 2 | `If criteria ` + `<em>not met</em>` | `overnight path` | `Stay on bed 3 overnight. **Mrs Antwi** covers from 17:00. Re-call **Dr Mensah** if any escalation triggers fire. **Mrs Mensa to be re-notified by 18:00** with overnight stay plan. Reassess at 06:00 Thursday — visiting doctor in person at 14:00.` | `extension_plan text` nullable |

Both are matron-typed free text; each card renders only when its field is non-empty.
⚠️ **Trim `(auto-applied to roll-call)` from the seeded/placeholder copy** — INCR-22 does **not** write `prep_attendance` (a future-dated exemption has no shape; §10.2). The matron may type whatever she likes; the app must not *pre-fill* a promise it does not keep.
⚠️ `Mrs Mensa to be re-notified by 18:00` is a **scheduled notification** (B9, INCR-26). At 22 it is prose in a text field, not a queued job.

### V4.5 Cluster note

Verbatim: `**The 16:00 reassessment** is on the Matron's task list and on Mrs Antwi's incoming-shift handover. Either criterion-pass writes the discharge stamp; either criterion-fail extends admission with the parent re-notified. No silent overnight stays.`

**Ruling:** *"on the Matron's task list"* = N28 (INCR-26) and *"parent re-notified"* = INCR-26. **Ship a trimmed note at 22:**
> `**The 16:00 reassessment** is on the incoming shift's handover. Either criterion-pass writes the discharge stamp; either criterion-fail extends admission. No silent overnight stays.`

Restore the two clauses verbatim at INCR-26. `No silent overnight stays` is the encodable rule: **an admission whose `target_discharge_at` has passed with criteria unmet must surface as an operational state on today §01** — at 22, an overdue admitted block, not a notification.

---

## §T1 — today §01 · Live situation (the queue + the bed board)

**Surface lines 237–377.** Actor: `Mrs A. Bediako · Matron · N&MC 04827` — footer renders the acting user; **drop the licence from the sidebar footer** (the shipped footer prints name + role; a licence there is gratuitous).

### T1.1 Page head

| Element | Exact copy | INCR-22 |
|---|---|---|
| Crumb | `Sickbay` *(link)* ` · Today` | BUILD |
| `<h1>` | `Today's ` + `<em>sickbay</em>` + ` · Wed 14 May 2026` | BUILD — date derived, `EEE d MMM yyyy` |
| Lede | `**1 admitted** · **3 in queue** · **5 visits** earlier today · **1 active referral** (D. Sarpong · Wassa Akropong) · URTI mild cluster watch` | **TRIM to** `**{n} admitted** · **{n} in queue** · **{n} visits** earlier today` — restore the referral clause at 25 and the cluster clause at 27, verbatim. *(The INCR-21 FLAG-L1 precedent: never advertise an absent affordance.)* |
| Action 1 | `Print day sheet` | **OMIT** — no print artefact, and a printed day sheet carries every complaint string out of the room (§9, A6) |
| Action 2 | `New visit` | **BUILD** (W1) |
| Action 3 | `Admit patient` | **BUILD** (W8) — **absent in Mode C** |

### T1.2 Live strip — 5 tiles → **3 at INCR-22**

| # | `.lbl` | `.val` | `.meta` | INCR-22 |
|---|---|---|---|---|
| 1 | `Admitted now` | `1` + `<span class="sub-num"> / 8 beds</span>` | `**A. Mensa** · bed 3 · SCD crisis` | **BUILD, meta rewritten** — see below. `.active` + `.now-dot` |
| 2 | `In queue` | `3` | `avg wait **4 min** · oldest 7 min` | **BUILD** — both derived from `queued_at`; when the queue is empty the tile renders `0` with **no** meta line |
| 3 | `Visits today` | `5` | `3 discharged · 1 admitted · 1 awaiting` | **BUILD** — derived by disposition; `awaiting` = open visits with no disposition |
| 4 | `Active referrals` | `1` | `**D. Sarpong** · post-op Akropong` | **OMIT** (Y6) |
| 5 | `Cluster watch` | `URTI` | `**6 cases** past 7 days · monitor` | **OMIT** (Y7) |

**🔴 Tile 1 meta is an adjacency leak** — name + bed + **diagnosis** in a summary tile on the module's landing page. **Ruling:**
- exactly one admission → `**{initial}. {Surname}** · bed {n}` — **never the condition**
- more than one → `{n} on the ward` — **no names at all** (a list of admitted students on a shoulder-surfed screen is a roll-call of who is unwell)
- zero → `0 / {total} beds`, no meta
- **Mode C → the tile does not render** (no beds, no admissions)

### T1.3 Admitted-patient block (`.adwoa-block` → rename `.admitted-block`)

The notes call it *"the single most clinically important piece of information."* Renders **one block per open admission**, ordered by bed number (the surface draws one because the demo has one — **AUTHORED** multiplication rule).

| Element | Exact copy | Binding |
|---|---|---|
| `.ab-name` | `Adwoa ` + `<em>Mensa</em>` + ` · admitted bed 3` | student + `bedNumber` |
| `.ab-meta` | `F1 General Arts · **Slessor House** · Adm. #2025/F1/0214 · admitted **09:14 today** by Mrs Bediako · 5h 31m on bed` | `formLabel()` ⚠️ *(today prints the full programme name, the visit record prints `SCI` — F#3; use `formLabel()` everywhere)* · House · `student_code` · `admitted_at` + `admitted_by` · elapsed `Xh YYm` |
| `.ab-tag.chronic` | `Sickle cell SS` | **OMIT** (Y1) |
| `.ab-tag.admitted` | `Admitted` | BUILD (gold) |
| `.ab-vitals` × 5 | `Temp 37.1°C` / `Pulse 88 bpm` / `BP 108/68` / `SpO₂ 98%` / `Pain score 4/10` (`.warn`), sub-lines `13:00 last` ×4 and `down from 7` | latest `sickbay_vitals` row |
| `.ab-line` | *(see below)* | composite |

**Vocabulary unification:** today says `Pulse` / `Pain score`, the visit record says `HR` / `Pain (0-10)`. **One vocabulary — the visit record's** (`Temp` · `BP` · `HR` · `SpO₂` · `Pain`), one formatter module, both surfaces import it. The `.vv.warn` colouring uses the **same `vitalSeverity()`** as V1.5, not a second ad-hoc rule.

**`.ab-line` — the densest clinical string on any sickbay surface.** Surface verbatim:
> `Mild vaso-occlusive pain crisis · right shoulder & knee. Hydration started 09:25 (oral, 200ml/h target). Paracetamol 1g → 09:30 and 12:30. Hydroxyurea continued. **Pain trending down 7 → 4** over 5 hours · hold admission, recheck vitals 17:00, plan discharge tomorrow morning if pain ≤ 2 and no fever. Parent (Mrs Mensa) notified **09:22** via SMS + phone call.`

At INCR-22 render only what exists: `{working_impression}` + `{hydration_status}` + `{plan}` + the derived `**Pain trending down {first} → {latest}** over {elapsed}` clause (the `→` is the gold `.arrow`). The med sentence returns at 24; the parent sentence at 26 (Y8). If the assessment is unsaved, the block renders name + tags + vitals and **no** `.ab-line` (the dashed top border goes with it).

### T1.4 Queue card

Head: `Queue · ` + `<em>waiting now</em>` · meta `3 students · refresh 15s`.

**`refresh 15s` is a promise, not data.** INCR-22 ships a server-rendered page with `export const dynamic = "force-dynamic"` and no polling → **meta renders `{n} students`** (singular `1 student`). Add the literal back only if a real refresh interval ships. *Skipped: client polling; add when a matron says the page goes stale on the bench.*

Row grammar (5 columns → **4 at INCR-22**):

| Cell | Copy (3 rows verbatim) | Binding |
|---|---|---|
| `.q-time` + `.wait` | `14:38` / `7 min wait` · `14:41` / `4 min wait` · `14:43` / `2 min wait` | `queued_at`; wait = `now − queued_at` floored to minutes, `{n} min wait`; `< 1 min` → `just now` (**AUTHORED**) |
| `.qs-name` + `.qs-meta` | `K. Asante` / `F2 SCI · **Aggrey House** · #2024/F2/0188` · `P. Owusu` / `F3 GA · **Slessor House** · #2023/F3/0067` · `Y. Boateng` / `F1 BUS · **Kufuor House** · #2025/F1/0091` | students + classes + houses + `student_code`, all BACKED |
| `.q-complaint` | `Headache, since after lunch` · `Knee scrape · sports field` · `Menstrual cramps` | `sickbay_visit.complaint` |
| `.triage` | `Routine` ×3 | **OMIT** — §5.4 |
| `.q-flag` | `No chronic flag` ×3 | **OMIT** — Y1 |
| `.q-action` | `Begin visit` | W2 → routes to `/senior/sickbay/visits/{ref}` |

Ordering: **by `queued_at` ascending** (longest wait first — as drawn). The notes say *"the matron picks the order"*; do not add a sort control at 22.
Empty queue: the card renders with head + one line `No one waiting.` (**AUTHORED**, `text-navy-3 text-[12px] italic`, `p-[18px_20px]`). No illustration, no pep.

### T1.5 Bed board — the highest-risk surface in the module

Head: `Beds · ` + `<em>occupancy</em>` · meta `1 / 8 · 7 empty` — **derive** `{occupied} / {total} · {free} empty`.

Eight tiles from **`sickbay_bed`** (BACKED — shipped at 0056), ordered by `bed_number`, `active = true` only. Retired beds never render.

| Tile | Copy | Rule |
|---|---|---|
| empty general | `Bed 01` / `Empty` | `.bed.empty` dashed; number **zero-padded to 2 digits** at render (`bed_number` is `smallint`, stable for life — R8) |
| empty isolation | `Bed 07` + `.iso-tag` `Iso` / `Empty` | `.bed.isolation.empty` — dashed terra border, surface fill |
| occupied | `Bed 03` / `A. Mensa` / `F1 · **Slessor**` / `SCD · 5h 31m` | `.bed.occupied` gold gradient + 1.5px gold border |

**🔴 THE ADJACENCY RULING — the bed tile must NOT print the condition.**
`SCD · 5h 31m` beside a name, on the screen the matron keeps open on the dispensing bench in a room containing other students, defeats *"Diagnosis stays inside the sickbay module per privacy default"* in one line of markup. **The `.bed-condition` footer renders the elapsed time only** — `5h 31m` — and its colour changes from `text-terra` to `text-navy-3` (terra signals a clinical alarm; a duration is not an alarm). Keep the slot, keep the `border-t border-gold-soft`, delete the leak. Two-token deviation, deliberate, and it is the reason this section exists.
The occupied tile therefore prints: **bed number · `{initial}. {Surname}` · `{form} · {House}` · elapsed.** Name + location, never condition — the same boundary the HM strip draws in prose.

**States:**
- **Mode C** → the entire bed card does **not render** (`capabilities.beds === false`). Not `0/0`, not disabled, not a placeholder. The `.col-2` collapses to a single column and the queue card takes the full width.
- **Mode A/B with zero bed rows** → the card renders with one line: `No beds configured — add capacity in Sickbay setup.` (**AUTHORED**, link to `/senior/sickbay/setup`, shown to every SICKBAY_ROLES reader since the MATRON can read setup).
- **All beds occupied** → no special state; the `Admit patient` action returns the named error `No free {general|isolation} bed.` (the `planBedReconcile` error-copy idiom: name it, apply nothing).
- **Isolation pools never merge (R9)** — a full general pool does not overflow into isolation. The admit form picks a pool, then a bed.

### T1.6 Housemaster awareness strip — **OMITTED at INCR-22 (Y5)**

Copy recorded verbatim for INCR-26 — **this is the product's privacy commitment in prose, port it character-exact:**
- `.hs-head` `Housemaster awareness · auto-notified of admissions`
- row 1: `.hm-house` `Slessor` · `.hm-text` `**Mr Owusu** notified · student in sickbay (medical detail withheld)` · `.hm-time` `09:17`
- row 2: `.hm-house` `Office` · `.hm-text` `**Mr Asare-Mensah** (HM) auto-notified of admission` · `.hm-time` `09:17`

HM identity is BACKED (`houses.hm_user_id`); the **notification event** is not. INCR-22 renders nothing here. ⚠️ The behavioural commitment binds INCR-22 anyway: **anything an HM can see about an admission carries name + location, never condition** — including INCR-28's boarding sick-bay count.

---

## 2. Per-mode render matrix — FULL / FIRST_AID / REFERRAL_ONLY

`capabilities` comes from the shipped `sickbayCapabilities(mode)` — **never re-derive, never store, never hand-set** (R4). **A and B are capability-identical** (R3/AC A2): they differ in editorial copy only, so nothing below may branch on A-vs-B. **Mode C is ~49% of public SHS — a first-class render, empty-by-design, never degraded.**

The relevant capability flags: `beds` · `admissions` · `visitingDoctor` (all `false` in C); `referrals` · `chronicRegister` · `parentNotifications` · `healthPrefects` (all `true` in C).

### 2.1 visit-record §01

| Element | **A · FULL** | **B · FIRST_AID** | **C · REFERRAL_ONLY** |
|---|---|---|---|
| Page head lede | `Admitted {t} · {date} · Bed {n} · Day-shift attending {name}` | same | `Seen {t} · {date} · Attending {name}` — **no bed, no "Admitted"** |
| `Update vitals` | yes | yes | **yes** — a Mode-C school takes a temperature before deciding to refer |
| Patient header | as mapped | same | same |
| Status tile 1 `Disposition` | `Admitted` / `Discharged` / `Referred` | same | **`Discharged` or `Referred` only** |
| Status tile 2 `Time on ward` | yes | yes | **not rendered** |
| Status tile 3 `Pain · current` | yes | yes | yes |
| Status tile 4 `Expected discharge` | yes | yes | **not rendered** |
| Vitals card | yes | yes | **yes** — the whole card, unchanged |
| Presenting complaint | yes | yes | yes |

### 2.2 visit-record §02

| Element | A | B | C |
|---|---|---|---|
| Assessment card | yes | yes | **yes** — a health coordinator still records what she found and why she referred. `staffDesignation()` already renames the post to `School Health Coordinator · SHEP` in C (shipped) |
| `Add consult` control | yes | yes | **not rendered** (`capabilities.visitingDoctor === false`) |
| Stored consults | render | render | **still render** — affordance filter, never a data filter (R3) |

### 2.3 visit-record §04

| Element | A | B | C |
|---|---|---|---|
| Whole section | yes | yes | **renders, admission-free** |
| `.disp-card` | Admitted / Discharged / Referred | same | **Discharged / Referred only** — an `ADMITTED` write is **rejected at the action**, not merely hidden |
| Target discharge · fallback plan · both path cards | yes | yes | **not rendered** (all four are admission columns) |
| Discharge criteria | yes | yes | **not rendered** — criteria hang off an admission |
| Cluster note | yes | yes | **not rendered** |

**Mode C's §04 substitute — one card, no admission fields.** The disposition card alone, with the destination line, plus (at 25) the referral artefact. **Never** an empty criteria list, never a disabled `Admit`.

### 2.4 today §01

| Element | A | B | C |
|---|---|---|---|
| `Admit patient` action | yes | yes | **not rendered** |
| `New visit` action | yes | yes | yes |
| Live tile `Admitted now` | yes | yes | **not rendered** |
| Live tile `In queue` | yes | yes | yes |
| Live tile `Visits today` | yes | yes | yes → the strip is **2 tiles** in Mode C at INCR-22 (`grid-cols-2`) |
| Admitted block | one per open admission | same | **never renders** |
| Queue card | yes | yes | **yes — the primary content**, full width |
| **Bed board** | yes | yes | **DOES NOT RENDER — the card is absent from the DOM** (R5/AC A7) |
| HM strip | *(omitted at 22)* | *(omitted at 22)* | *(omitted at 22)* |

**Mode C's today page — one explanatory panel where the bed board was**, in the shipped `MODE_C_CAPACITY_PANEL` idiom (`lib/sickbay/defaults.ts`), so the voice stays the surface's:

> **AUTHORED (owner review — not in any surface):** heading `Beds & admissions` · body `Referral-only operation · no on-site beds and no admissions. Every case is seen, recorded, and either discharged or referred to a hospital.`

Assembled from Mode C's own card copy (`No sickbay. School Health Prefect roster handles first response, all cases route to nearest hospital.`). **Never `0 / 0`, never `—`, never a disabled `Admit patient`, never a PLACEHOLDER badge.**

**Mode A adds nothing at INCR-22.** A renders exactly like B (AC A2). Do not scaffold speculative Mode-A UI.

---

## 3. Data bindings — element by element

### 3.1 BACKED (shipped, no migration)

| Element | Table / column / helper |
|---|---|
| Student name, code, sex, DOB→age, status | `students.first_name` / `last_name` / `student_code` / `date_of_birth` / `status` |
| Form + programme label `F1 SCI` | `classes.level` + `.name` + `students.programme` → **`formLabel()`** in `lib/sickbay/defaults.ts` |
| House `Slessor` | `houses.name` via `boarding_dormitory` → `boarding_bunk` → `students.current_bunk_id`, or the direct house link |
| Housemaster identity (for INCR-26) | `houses.hm_user_id` |
| Primary contact `Mother Mrs E. Mensa` | `student_guardian` where `is_primary` (`name`, `relationship`, `phone`) |
| Bed inventory, numbers, isolation flag, active | **`sickbay_bed`** (0056) via `getSickbayConfig().beds` / `.bedCounts` |
| Mode + capabilities gating | **`sickbay_settings.mode`** → `getSickbayConfig().capabilities` |
| Matron identity, designation, N&MC number | `sickbay_settings.matron_user_id` / `assistant_matron_user_id` → `getClinicalStaff()`; `staff_profile.nmc_licence_number` (0056) |
| Visiting doctor name + affiliation | `sickbay_settings.visiting_doctor_name` / `_affiliation` (R21 — text, not a user) |
| Health-prefect candidates (complaint intake attribution) | **`getHealthPrefects()`** — derived from `boarding_bunk.prefect_role = 'SICKBAY'` (R23) |
| MATRON-role validation for confirmations | **`holdsMatronRole(schoolId, userId)`** (shipped) |
| Attendance day record, `MEDICAL` status, `reason_code`, `note` | `attendance_record` + `attendance_status` enum |
| Attendance correction (co-signed) | `attendance_correction` |
| Attendance "M" presentation | **`ATTENDANCE_STATUS_META.MEDICAL`** in `lib/attendance-status.ts` — letter `M`, label `Medical`, `bg-navy-2` |
| Free-text chronic conditions / allergies / blood group | `student_health_record` (`conditions`, `allergies`, `blood_group`) — the ONLY shipped clinical store |
| Audit of every mutation | `audit_log` via `lib/db/audit.ts` (snapshot before/after, never a patch) |
| Read/write gating | `lib/access.ts::SICKBAY_ROLES` — ⚠️ **insufficient for clinical reads, see §8** |

### 3.2 NEEDS SCHEMA — migration 0057 (N-numbers from the inventory)

| N# | Table | Columns the four sections require | Notes for Wells |
|---|---|---|---|
| **N8** | `sickbay_visit` | `student_id` (composite FK), `reference` (`UNIQUE(school_id, reference)`, `VR-{date}-{seq}-{seq}`), `state` (`QUEUED\|IN_PROGRESS\|CLOSED`), `queued_at`, `started_at`, `ended_at`, `complaint text`, `intake_at`, `recorded_by_user_id`, `intake_prefect_student_id` (nullable composite FK), `confirmed_by_user_id`, `confirmed_at`, `attending_user_id`, `disposition` (nullable `DISCHARGED\|ADMITTED\|REFERRED`), `disposition_note text`, **`sickbay_visit_tenant_uk UNIQUE(school_id, id)`** | The tenant UK must be authored **now**, in 0057, even though only 0059/0060 reference it — adding a UNIQUE in the same migration as the FK that needs it is the 0033 ordering hazard (the AC B6 precedent from 0056). **Partial unique on `(school_id, student_id) WHERE state <> 'CLOSED'`** — a student cannot hold two open visits. |
| **N9** | `sickbay_vitals` | `visit_id` (composite FK), `taken_at`, `temp_c numeric(3,1)`, `bp_systolic smallint`, `bp_diastolic smallint`, `heart_rate smallint`, `spo2 smallint`, `pain smallint`, `context_note text`, `taken_by_user_id` | **Every reading nullable** — a matron who takes only a temperature must be able to save. `CHECK (pain BETWEEN 0 AND 10)`; BP both-or-neither at the app layer. **Append-per-reading**, ordered by `taken_at`. |
| **N10** | `sickbay_assessment` | `visit_id` **`UNIQUE(school_id, visit_id)`**, `recorded_at`, `working_impression text NOT NULL`, `red_flags_negative boolean`, `red_flags_screened text`, `hydration_status text`, `plan text`, `escalation_triggers text`, `recorded_by_user_id` | The column is **`working_impression`**, never `diagnosis` (D1). |
| **N11** | `sickbay_consult` | `visit_id` (composite FK), `clinician_name text NOT NULL`, `clinician_affiliation text`, `mode` (`PHONE\|IN_PERSON`), `consulted_at`, `body text`, `recorded_by_user_id` | Many per visit. **No `user_id`** (R21). |
| **N13** | `sickbay_admission` | `visit_id` (composite FK, **UNIQUE** — one admission per visit), `bed_id` **composite FK → `sickbay_bed(school_id, id)`** *(the target UNIQUE is already shipped)*, `admitted_at`, `admitted_by_user_id`, `target_discharge_at`, `fallback_plan text`, `discharge_plan text`, `extension_plan text`, `discharged_at`, `discharged_by_user_id` | **Partial unique on `(school_id, bed_id) WHERE discharged_at IS NULL`** — one open admission per bed, enforced by the DB, not by a read-then-write race. This partial-unique is also what `planBedReconcile`'s `occupiedBedIds` reads. |
| **N14** | `sickbay_discharge_criterion` | `admission_id` (composite FK), `sort_order smallint`, `text text NOT NULL`, `met boolean default false`, `met_at`, `met_detail text` | Matron-typed at 22; care-plan-seeded at 23 (shape unchanged). |
| — | enums | `sickbay_visit_state`, `sickbay_disposition`, `sickbay_consult_mode` | **Three enums, six tables.** No triage enum, no medication source kind, no referral status — those belong to 24/25. |
| — | `lib/attendance-reasons.ts` | reason code **`SICKBAY`** | **NOT a migration** — `attendance_record.reason_code` is `text` guarded by a Zod enum. See §10.3 for the picker trap. |

**Explicitly out of 0057:** N4/N5 (standing orders, stock), N6 (hospitals), N7 (notification policy), N12 (MAR), N15 (rounds), N16 (surveillance), N17–N20 (chronic register + grants), N21–N24 (referrals), N25 (NHIS), N26–N28 (notifications, follow-up tasks).

**RLS:** all six tables school-scoped, `ENABLE` + `FORCE`, `tenant_isolation`, composite `(school_id, id)` FKs per repo memory; `parent_deny` is catalog-driven so all six are parent-denied with zero edits (D8). **Prod RLS must be hand-pasted** — `prod-paste-0057-sickbay-visit.sql` is the module's second of five pastes, and the first one carrying real clinical data. A missed paste leaks medical PII across schools.

### 3.3 NO CLEAN BINDING (B-numbers)

| B# | Element | Resolution at INCR-22 |
|---|---|---|
| **B1** | `bed S-12-B · lower bunk` (patient header) | **OMIT the fragment.** `boarding_bunk` = dormitory name + `position_number`; there is no upper/lower axis. Do not invent a suffix to match a demo string. |
| **B3** | Student as clinical actor (`F. Tetteh` records the complaint) | **BITES HERE.** Resolved as *recorded attribution*, not an actor: `intake_prefect_student_id` + a staff `recorded_by_user_id` + a MATRON `confirmed_by`. No student write path, no student session. (The dose-witness half of B3 is INCR-24's.) |
| **B4** | Visiting doctor without a login | **SETTLED by R21** — `clinician_name` + `clinician_affiliation` on the consult, authored by the transcribing matron. |
| **B9** | Scheduled notifications (`re-notified by 18:00`, `Due 17:00`) | Prose inside a text field at 22. No queue, no due-at, no scheduler. INCR-26. |
| **B14** | Mode-C degradation of the clinical surfaces | **Owned here** (§2). Precedent set at 21: empty-by-design, reordered by importance, reason named, never zeroed. |
| **B15** *(new)* | Wall-clock derivations — `5h 31m`, `7 min wait`, `Time on ward`, `avg wait` | Not a schema gap, a **render** gap: compute server-side at request time, render a static string, do **not** ship a ticking client clock. `export const dynamic = "force-dynamic"` on both routes. A stale minute is honest; a hydration mismatch on a clinical page is not. |
| **B16** *(new)* | `Print summary` / `Print day sheet` | No print artefact exists for sickbay; the repo's receipt-PDF path is invoice-specific. Omit both. Also §9/A6: a printed day sheet carries every complaint string out of the room. |

---

## 4. Interaction states (per section)

| State | visit §01 | visit §02 | visit §04 | today §01 |
|---|---|---|---|---|
| **Loading** | patient-header skeleton at real height (120px), status tiles, table skeleton at the real row height (43px) | card skeleton, 6 rows | disp-card + criteria skeletons | tile skeletons; queue skeleton at 3 rows; **bed grid renders immediately** (beds are config, already fetched) |
| **Empty** | a visit always has a student + complaint; **vitals card renders with head + `No readings yet.` + the `Update vitals` CTA** (AUTHORED) | **assessment card absent** until saved, replaced by a single `Record assessment` CTA (AUTHORED); consult list absent when empty | criteria card absent when no criteria; path cards absent when their field is empty | queue `No one waiting.`; beds all-empty is a normal state, not an empty state; **no admission → no admitted block** and tile 1 reads `0 / {total} beds` |
| **Error (write)** | inline under the offending field; a rejected vitals row keeps the typed values | inline; never blank a saved assessment | named error from the action (e.g. `No free general bed.`), nothing applied | admit/begin errors as a toast + inline; the queue row does not disappear |
| **Populated** | as mapped | as mapped | as mapped | as mapped |
| **Read-only actor** (HEADMASTER) | every value renders; `Update vitals` absent | assessment + consults render; no CTAs | renders; no criteria ticking, no discharge | renders; `New visit` / `Admit patient` / `Begin visit` absent |
| **Closed visit** | banner-free; actions absent; the record is a document | same | disposition final | not in the queue |
| **Overdue admission** (`target_discharge_at` < now, criteria unmet) | — | — | criteria meta gains `· reassessment overdue` (gold) — **AUTHORED**, the encodable half of *"No silent overnight stays"* | admitted block gains the same marker |

---

## 5. Design rulings that deviate from the surface (with reasons)

1. **§5.1 Bed tile drops the condition** — `SCD · 5h 31m` → `5h 31m`, terra → navy-3. The most-shared screen in the module cannot carry a diagnosis (§9).
2. **§5.2 Live tile 1 drops the condition and, above one patient, drops the names** — `A. Mensa · bed 3 · SCD crisis` → `A. Mensa · bed 3` / `{n} on the ward`.
3. **§5.3 One vitals vocabulary** — `HR` not `Pulse`, `Pain` not `Pain score`, one `vitalSeverity()`, one delta formatter, shared by both surfaces.
4. **§5.4 Triage pill omitted** — every drawn row is `Routine`, the notes say *"Three in queue all routine triage · the matron picks the order"*, and the full ladder is undefined by all five surfaces. Inventing `Urgent`/`Emergency` colours and semantics for a value nothing sets is speculative. Reinstate when a real urgency workflow is designed (Kofi).
5. **§5.5 `.bed-condition` colour** terra → navy-3 (a duration is not an alarm).
6. **§5.6 BP trend tile** renders `from 110/72` instead of the unearned `stable`; `stable` is reserved for a true zero delta.
7. **§5.7 `.adwoa-block` renamed `.admitted-block`** — no CSS class named after a demo patient.
8. **§5.8 `PROGRAMME_ABBR.GENERAL_SCIENCE`** — the shipped constant renders **`GS`**; **all three sickbay surfaces print `SCI`** (`F1 SCI`, `F2 SCI`, `E. Asare · F2 SCI` on the *setup* surface INCR-21 was character-compared against). One-line fix in `lib/sickbay/defaults.ts` at INCR-22 that also corrects the already-shipped setup surface. **Q9 for the owner** (it is copy, not code).
9. **§5.9 Sidebar footer drops the licence** — the shipped footer prints name + role; `N&MC 04827` there is clutter (and it is rendered in two different formats across the two surfaces).

---

## 6. Write actions & authz

### 6.1 Gates — ⚠️ the shipped gate is too wide for clinical data

`SICKBAY_ROLES = [ADMIN, HEADMASTER, MATRON]` (shipped) is the **module** gate. **Owner decision D2:** clinical read defaults to **MATRON + HEADMASTER**; **ADMIN gets module access but no clinical read without an explicit, expiring, per-student grant** — and the grant machinery is INCR-23.

> **🔴 FLAG G1 — INCR-22 must NOT reuse `SICKBAY_ROLES` as the read gate for the visit surfaces.** Doing so hands the proprietor/IT `ADMIN` account every student's working impression, vitals and complaint text for one whole increment. Author **`SICKBAY_CLINICAL_READ_ROLES = ["HEADMASTER", "MATRON"]`** in `lib/access.ts` beside the existing groups, and gate `/senior/sickbay/today` and `/senior/sickbay/visits/**` on it. ADMIN keeps `/senior/sickbay/setup`. This is not a tightening for its own sake — it is D2, applied on the first increment where it can bite. *(It also pre-empts Sarah's advisory: "the data-minimisation argument EXPIRES at INCR-23".)*

**Write gate:** **`SICKBAY_CLINICAL_WRITE_ROLES = ["MATRON"]`.** Every clinical actor on both surfaces is the Matron; the Headmaster appears only as a digest recipient. In Mode C the same pointer holds the designated health coordinator, who also holds `MATRON` (R20/E1) — so MATRON-only writes are coherent in all three modes. `HOUSEMASTER` is not a member of either gate (grant-scoped at 23, never role-scoped).

### 6.2 The actions

| # | Action | Trigger | Writes | Authz | Guards |
|---|---|---|---|---|---|
| **W1** | New visit | `New visit` | `sickbay_visit` (`QUEUED`, `queued_at`) | MATRON | student ACTIVE + same school; **no second non-CLOSED visit for that student** (partial unique); `reference` generated server-side |
| **W2** | Begin visit | `Begin visit` (queue row) | `state = IN_PROGRESS`, `started_at`, `attending_user_id` | MATRON | visit must be `QUEUED`; id re-resolved server-side (no client-supplied bed/visit ids) |
| **W3** | Record / edit complaint + intake | complaint form | `complaint`, `intake_at`, `recorded_by_user_id`, `intake_prefect_student_id` | MATRON | prefect (if given) must be an ACTIVE student of this school |
| **W4** | Confirm intake | `Confirm` | `confirmed_by_user_id`, `confirmed_at` | MATRON | **`holdsMatronRole()` must pass** — the medico-legal anchor; a non-matron cannot confirm even with a forged POST |
| **W5** | Update vitals | `Update vitals` | new `sickbay_vitals` row | MATRON | ≥1 reading present; ranges (§7); `taken_at` defaults to now, may be back-dated **≤ 12h and never into the future**; the taker may correct **the row she just created** (audit keeps before/after) — otherwise readings are append-only |
| **W6** | Save assessment | assessment form | `sickbay_assessment` upsert | MATRON | `working_impression` required, ≤ 2000; audit `before`/`after` as **snapshots**, not patches |
| **W7** | Log consult | `Add consult` | `sickbay_consult` insert | MATRON | `capabilities.visitingDoctor` must be true to *offer* it; `clinician_name` required (defaults from settings) |
| **W8** | **Admit patient** | `Admit patient` | `sickbay_admission` + `visit.disposition = ADMITTED` **+ the attendance MEDICAL write (§10)** | MATRON | **`capabilities.admissions` must be true — REJECT in Mode C at the action, not just in the UI**; bed active + unoccupied + correct pool; one open admission per bed (partial unique); one admission per visit |
| **W9** | Set discharge target / plans | disposition form | `target_discharge_at`, `fallback_plan`, `discharge_plan`, `extension_plan` | MATRON | target must be ≥ `admitted_at` |
| **W10** | Add / tick discharge criterion | criteria card | `sickbay_discharge_criterion` | MATRON | `met_at` stamped **server-side**, never client-supplied; un-ticking clears `met_at` and is audited |
| **W11** | Discharge | `Discharge` | `admission.discharged_at` + `discharged_by`, `visit.state = CLOSED`, `ended_at`, **attendance backfill (§10.4)** | MATRON | admission must be open; **`disposition` stays `ADMITTED`** — the visit's outcome was an admission (today §03 proves it: the discharged walk-ins read `Discharged 14:35`, the admitted patient still reads `Admitted`) |
| **W12** | Refer | `Refer` | `disposition = REFERRED`, `disposition_note`, `state = CLOSED` | MATRON | terminal at 22; **no hospital FK, no transport, no return** (INCR-25) |
| **W13** | Discharge without admission | `Close visit` | `disposition = DISCHARGED`, `ended_at`, `state = CLOSED` | MATRON | the walk-in path; **writes no attendance** (§10.1) |
| **W14** | **Mode-change guard (lands here)** | existing `lib/actions/sickbay-config.ts` mode writer | — | HEADMASTER/ADMIN | **reject `→ REFERRAL_ONLY` while any admission is open** — the R6 forward guard INCR-21 could not test |
| **W15** | **Bed reconcile guard goes live** | existing capacity save | — | HEADMASTER/ADMIN | pass real `occupiedBedIds` to `planBedReconcile` — grep the shipped `planBedReconcile(config.beds, parsed.data, [])`; the R11 reject branch has been unit-test-only since 0056 |

Every W-action writes `audit_log` via `lib/db/audit.ts` with a per-table `entityType`. **No read-audit at 22** — that is INCR-23's novel problem (and Risk 3's volume trap).

---

## 7. The vitals form — fields, units, precision, ranges

One dialog behind `Update vitals`; every field optional, at least one required.

| Field | Input | Unit | Precision | Accept range (reject outside) | Clinical flag | Default |
|---|---|---|---|---|---|---|
| Temperature | `type="number" step="0.1" inputmode="decimal"` | °C | 1 dp (`numeric(3,1)`) | **30.0 – 45.0** | warn > 37.5 · elevated ≥ 38.5 | empty |
| BP systolic | `number inputmode="numeric"` | mmHg | integer | **50 – 250** | no ladder (§V1.5) | empty |
| BP diastolic | same | mmHg | integer | **30 – 150** | — | empty |
| Heart rate | same | bpm | integer | **20 – 250** | warn > 95 · elevated ≥ 120 *(authored)* | empty |
| SpO₂ | same | % | integer | **50 – 100** | warn < 94 · elevated < 90 *(authored)* | empty |
| Pain | 0–10 **segmented control** (reuse the attendance segmented idiom), keyboard 0–9 + `10` | — | integer | **0 – 10** (`CHECK`) | pill ladder min/low/mod/high | empty |
| Context note | text ≤ 32 | — | — | — | renders as the `.day` sub-line | empty |
| Taken at | `type="datetime-local"` | — | minute | ≤ now, ≥ now − 12h | — | **now** |
| Taken by | implicit = actor | — | — | — | — | actor |

**Validation copy is named, never generic:** `Temperature must be between 30.0 and 45.0 °C.` — the `planBedReconcile` error-copy idiom (name the bound, apply nothing).
BP is **both-or-neither**. A row with every field empty is rejected: `Record at least one reading.`
Phone-first: native keyboards via `inputmode`, no picker dependency, 44px minimum hit targets on the pain control. *Skipped: an offline write queue — add when a matron reports losing a 06:30 round reading to dead signal.*

---

## 8. Medical-PII classification — per element

Classes follow the inventory §9. **This increment introduces the first real clinical data in the product.**

### 8.1 By field

| Element | Class | Gate |
|---|---|---|
| `working_impression`, `red_flags_screened`, `hydration_status`, `plan`, `escalation_triggers` | **1 — clinical assessment (highest)** | clinical read gate; never leaves the module in any form |
| Doctor consult body | **1** | same |
| `complaint` free text (visit + queue) | **1** (and **4** when reproductive — `Menstrual cramps`, `period pain`) | same; ⚠️ printed on the queue, see A6 |
| Temp / BP / HR / SpO₂ / **pain score** | **3 — measurements** | same |
| Discharge criteria text + `met_detail` (`850ml total`) | **3** | same |
| Admission: bed, ward, admitted/discharged times, elapsed | **6 — inferable** (occupancy tied to a named student) | clinical read gate for the detail; **name + location only** for anything an HM/boarding surface sees (R29 / INCR-28) |
| `student_code`, guardian name + relationship | **5 — identifiers & contact** | existing student gates |
| N&MC licence number | **NOT medical PII** — a public statutory-register credential (R22) | fine to render |
| Actor names (`Taken by G. Antwi`) | staff attribution, not student PII | fine |
| Chronic condition names, NHIS card | 1 / 5 | **not built at 22** (Y1/Y9) |

### 8.2 🔴 By ADJACENCY — leaks that no column list catches

The board's Risk 4 in element form. **Every one of these is a rendering decision, not a schema decision.**

| # | Leak | Where | Ruling |
|---|---|---|---|
| **A1** | Bed tile prints `SCD` beside a name on a bench-side screen | today §01 bed board | **condition removed; duration only** (§5.1). The single most important ruling in this map. |
| **A2** | Live tile meta `A. Mensa · bed 3 · SCD crisis` | today §01 tile 1 | condition removed; **names suppressed entirely above one patient** (§5.2) |
| **A3** | `.ab-tag.chronic` `Sickle cell SS` beside the name, above the fold, on the module landing page | today §01 admitted block | omitted at 22 (Y1); at 23 it renders **only inside the visit record**, never on today |
| **A4** | The SCD banner leaks twice — by name *and* by drug (`hydroxyurea` ⇒ sickle cell to any nurse) | visit §01 | omitted at 22 (Y2); at 23 it is a visit-record-only element |
| **A5** | `No chronic flag` — the *absence* is safe; the presence would leak on a shared screen | today §01 queue | column omitted at 22; at 23 render a **neutral marker** (`Care plan on file`), never the condition |
| **A6** | Queue prints the complaint verbatim (`Menstrual cramps`) next to a name, on a screen in a room containing the other queued students | today §01 queue | operationally necessary for triage → **keep on screen, never on paper**: this is an independent reason `Print day sheet` is omitted |
| **A7** | **The attendance `note` field** — the one column that carries sickbay text to a *class teacher* | `attendance_record.note` | **write `null` or the fixed string `Admitted to sickbay`. NEVER the complaint, the impression, or the condition.** This is the module's only outbound leak path into the Basic tier. |
| **A8** | `.ab-line` — impression + hydration + plan + pain trend in one paragraph on the landing page rather than behind a visit click | today §01 | kept (the notes call it the most clinically important element) but it is the reason the whole route sits behind `SICKBAY_CLINICAL_READ_ROLES` |
| **A9** | The HM strip's non-disclosure is *correct*; the risk is an implementer "improving" it by adding the condition | today §01 (omitted at 22) | copy preserved verbatim in §T1.6; the behaviour binds INCR-28's boarding count too |
| **A10** | Elapsed-time strings (`5h 31m`) reveal *how long* a named student has been unwell to anyone reading the screen | both | accepted — location/duration is the HM-visible tier by design |
| **A11** | Physical shoulder-surfing: the today page lives on a bench in a room full of students | today §01 | the whole justification for A1/A2/A5. Say it in the PR so the next implementer does not "restore" the condition line. |

### 8.3 Deliberate non-disclosure copy — **preserve verbatim, it is the product**

- `student in sickbay (medical detail withheld)` — today §01 HM strip *(INCR-26)*
- `Please flag classmates if they ask, no medical detail to share` — visit §05 *(INCR-26)*
- `Class teachers see "M" not "A"` — chronic register §02 *(INCR-23; the promise INCR-22's write must satisfy)*
- `Teachers see medical · excused without seeing diagnosis`
- `student under sickbay care, off-campus` — referral log §01 *(INCR-25)*
- `Diagnosis stays inside the sickbay module per privacy default.` — referral log §01 *(INCR-25)*
- `The HM and Headmaster notifications are medical-detail-light` / `he knows she's admitted and excused, not the clinical specifics` — notes panels, visit §02/§05

---

## 9. The attendance-"M" touchpoints — every assertion, and exactly what it claims

### 9.1 Where the surfaces assert it

| # | Surface · element | Verbatim claim | Scope | INCR-22 obligation |
|---|---|---|---|---|
| 1 | visit §02, HM notification card | `Attendance auto-excused for the day.` | **in scope** (the card itself is Y4/INCR-26) | the write must be real by 22 even though the card lands at 26 |
| 2 | visit §04, `If criteria met` card | `Excused from **tomorrow's 06:00 prep run** (auto-applied to roll-call).` | **in scope** | ❌ **NOT built.** That is boarding `prep_attendance` (INCR-9), a *future-dated* exemption with no shape. **Trim the parenthetical from any pre-filled copy.** |
| 3 | visit §05, Attendance cross-link | `Today's excuse **auto-applied** · **5 periods** · all classes · attendance flags "excused (sickbay)"` | out (INCR-26) | **R30 stands:** `uniq_attendance_student_day` means per-period attendance does not exist → re-express as a single **day** mark. Do not escalate the schema for a copy string. |
| 4 | chronic register §02 | `Days admitted to sickbay register as **excused medical absence** automatically. Class teachers see "M" not "A".` | out (INCR-23) | the promise INCR-22's write must satisfy: status `MEDICAL` (letter `M`), never `ABSENT` |
| 5 | today §01 | *(no attendance assertion anywhere in §01)* | in scope | none |

### 9.2 The write (D4 — sickbay WRITES attendance; attendance does not derive from sickbay)

**Trigger: ADMISSION ONLY (W8), never a walk-in visit.** Grounding: every claim above says *admitted* (`Days **admitted** to sickbay register as…`, `Informed Adwoa **admitted**… Attendance auto-excused`). A 20-minute headache visit must not mark a student's day.

```
attendance_record (school_id, student_id, date)          ← uniq_attendance_student_day
  status      = 'MEDICAL'
  reason_code = 'SICKBAY'
  note        = null   (or the fixed 'Admitted to sickbay' — NEVER clinical text · A7)
  class_id    = students.class_id                        ← NOT NULL
  marked_by   = the admitting matron
```

Four hard guards:
1. **`class_id` is NOT NULL** and the 240 synthetic WASSCE candidates have no `classId` (board Risk 2c) → a classless student **cannot** receive an attendance row. **Skip honestly with a named non-blocking warning** (`Admitted. Attendance not marked — {name} has no class assigned.`); never fabricate a class, never fail the admission.
2. **A CLOSED term** makes `saveAttendance` refuse. The sickbay writer must respect the same rule — **and must not roll back the admission.** Return `Admitted. Attendance not marked — {term} is closed.` A clinical fact is not contingent on an academic-calendar state.
3. **Multi-day admissions:** write the admission date at admit time; **on discharge (W11) backfill `MEDICAL` for every date from `admitted_at` to `discharged_at`**. No scheduler exists and none is worth building for this. *(An admission still open across midnight shows a one-day-behind register until discharge — a known, named ceiling; add a daily job only if matrons complain.)*
4. **The downgrade guard is the root-cause fix, in the ONE shared writer** — `lib/actions/attendance.ts::saveAttendance`'s `onConflictDoUpdate`. A teacher's 10:00 class save must **not** overwrite the matron's 09:14 `MEDICAL`/`SICKBAY` row:
   - add a `where` predicate to the upsert's update branch excluding rows where `status = 'MEDICAL' AND reason_code = 'SICKBAY'`;
   - report the declined rows honestly in `SaveAttendanceResult` (`2 students are marked Medical by the sickbay and were not changed.`) — a silently-ignored save is worse than a refused one;
   - correction remains the existing **co-signed `attendance_correction`** flow — the only legal downgrade path.
   **Fix it in the writer, never per-caller:** ~8 shipped Basic-tier callers route through `saveAttendance`, and patching only the sickbay path leaves every sibling caller able to clobber the mark.

### 9.3 The reason code — a lib trap, not a migration

`attendance_record.reason_code` is `text`, guarded by `z.enum(ATTENDANCE_REASON_CODES)` from `lib/attendance-reasons.ts`. Adding `SICKBAY` is a one-line change — **but `ATTENDANCE_REASONS` is also the teacher's reason picker** (`"Shared by the take-register UI and the per-student attendance view"`). A teacher must not be able to *choose* `Sickbay`.

**Shape:** keep `ATTENDANCE_REASONS` as the picker list; add a separate system entry (`{ code: "SICKBAY", label: "Sickbay" }`) that is merged into `REASON_LABEL` and into the Zod enum but **not** into the picker. Without it, `reasonLabel('SICKBAY')` falls through to the raw code and a teacher's per-student view prints the literal string `SICKBAY`.

### 9.4 The display — reuse, do not re-author

`lib/attendance-status.ts::ATTENDANCE_STATUS_META.MEDICAL` already ships letter `M`, label `Medical`, `bg-navy-2 text-white`, and an inline-rgba row tint (the no-alpha workaround is already solved there). Any sickbay-side rendering of the mark imports it. Repo memory `attendance-five-statuses` holds: five statuses, Medical = navy-2.

---

## 10. Fabricated demo content appearing in scope — never build these as data shapes

| F# | Item | Where in scope | Verdict |
|---|---|---|---|
| **F1** | **Two contradictory Slessor housemasters** — today §01 says `Mr Owusu`, visit §02 says `Mr S. Bonsu` (the module has four across five surfaces) | today §01 HM strip · visit §02 HM card | Derive from `houses.hm_user_id`. **Never a name in the copy.** Both elements are omitted at 22 anyway. |
| **F2** | **Four student-code formats** in scope — `AS-2024-F1-0089` (visit id-flag), `2025/F1/0214` (today `Adm. #`), `#2024/F2/0188`, `#2023/F3/0067`, `#2025/F1/0091` (queue) | both | `students.student_code` is free text: **render verbatim as stored.** No format, no regex, no validation, no seed convention. |
| **F3** | **Adwoa Mensa is three different patients** — programme `F1 SCI` (visit) vs `F1 General Arts` (today block) vs `F1 GA` (today §03); adm# `AS-2024-F1-0089` vs `2025/F1/0214`; pain `2/10 @14:30` vs `4/10 @14:45`; temp `37.2` vs `37.1`; HR `84` vs `88`; last-reading `14:30` vs `13:00` | both | **The visit-record dataset wins** (most complete). The contradiction disappears by construction once both surfaces read the same `sickbay_vitals` rows through the same formatter. |
| **F4** | **Adwoa Mensa is not in the seed** — the dev seed's nearest student is **Abena Mensah** | every element | Never hardcode her. The preview will render whatever the seed holds; a demo student is a **seed** task, not a code task. |
| **F5** | **`Kufuor House`** on queue row 3 (and `Nkrumah` elsewhere) | today §01 queue | Seeded houses are Aggrey · Guggisberg · Fraser · Slessor · Kingsley · Aryee. **Houses are read, never named in code.** |
| **F6** | Live tile `5 visits` vs today §03's `6 visits` | today §01 tile 3 | **Derive the count.** Counter drift is this module's signature defect (setup §03's "3 reorder alerts" over a 2-alert table). |
| **F7** | `1 active referral (D. Sarpong · Wassa Akropong)` — a cast that contradicts the referral log's (`Y. Aidoo`, `K. Boateng`) and appears in no history | today §01 lede + tile 4 | Both omitted at 22; when 25 builds it, **the referral-log cast wins**. |
| **F8** | `.adwoa-block` — a **CSS class named after a fabricated patient** | today §01 | rename `.admitted-block` (§5.7) |
| **F9** | Two N&MC render formats — `N&MC #N-04827` (visit) vs `N&MC 04827` (today sidebar) | both | Store the bare value; **one render**: `N&MC #{value}`. Drop it from the sidebar entirely (§5.9). |
| **F10** | `Paracetamol 1g → 09:30 and 12:30` (today `.ab-line`) vs the MAR's `09:20` / `13:00` | today §01 | Out of scope (meds) — recorded so INCR-24 does not "reconcile" it in copy. Both fragments are omitted at 22 (Y8). |
| **F11** | `refresh 15s` — a polling promise nothing implements | today §01 queue meta | Omit the literal (§T1.4). |
| **F12** | The three contradictory round schedules (`06:30/12:30/17:00/21:00` here) | today §02 (out of scope) | **Already settled by R13** — the setup surface's slot rows are canonical; `today`'s 17:00 round is demo drift and loses. Noted so nothing in scope reads a hardcoded time. |

Also in scope and **not** fabrication, just cross-reading: `F. Tetteh · Sick Bay Prefect` is narrative continuity with the boarding batch — he is a demo student like any other, and the shipped `getHealthPrefects()` derivation renders whoever the boarding bunks actually mark.

---

## 11. Responsive & PWA

**visit-record declares ONE breakpoint (line 275, `max-width:1280px`):** `.layout` → 1 col · `.col-2` → 1 col · `.status-strip` / `.trend-strip` → 2 cols · `.patient-header` → 1 col · `.patient-flags` → horizontal row · `.dc-meta` → 1 col · **`.assessment-row` → 1 col** (label above value).

**today declares NO media query at all** — every breakpoint below is authored.

| Width | visit §01/§02/§04 | today §01 |
|---|---|---|
| ≥ 1280 | as mapped | live strip 3-up; `.col-2` at `1.4fr 1fr`; bed grid 4-up |
| 768–1279 | surface rules above | live strip **2-up**; `.col-2` → **1 col** (queue above beds); bed grid **3-up** |
| < 768 (PWA / phone) | patient header stacks, flags become a wrapping row; status tiles **1 col**; trend strip **2 cols** (pain last, full width); **the vitals table becomes stacked reading cards** — time + context on line 1, a 5-cell mono grid on line 2, `Taken by` on line 3. Do **not** horizontally scroll a 7-column clinical table on a phone. Assessment rows stack. Criteria rows keep `24px 1fr` with the status wrapping under the text. | live strip **1 col**; admitted block stacks (vitals 5 → **2 cols**, pain full width); **queue rows become stacked cards** — `HH:MM · {n} min wait` line 1, name + meta line 2, complaint line 3, **`Begin visit` full width, min 44px** line 4; **bed grid 2-up** (a 4-up grid at phone width makes each tile unreadable) |

**PWA notes:** the matron's device at the bedside is a phone. `Update vitals` is the only high-frequency write and is specified phone-first (§7). Both routes are `force-dynamic` (B15). *Skipped: an offline write queue and a service-worker cache — add when a 06:30 round reading is actually lost to signal, not before.*

---

## 12. Cross-module hooks — design commitments preserved

| Hook | Where in scope | Status at INCR-22 |
|---|---|---|
| **sickbay → attendance "M"** (the board's headline hook) | W8 / W11 + the `saveAttendance` root-cause guard | **BUILT HERE.** §9. |
| **sickbay config → the visit** | `capabilities`, `sickbay_bed` rows, `holdsMatronRole()` | live reads of the shipped INCR-21 spine — the config spine's first consumer |
| **boarding → House / housemaster** | patient header House, queue `Aggrey House`, bed tile `Slessor`, HM identity | live reads (`houses`, `houses.hm_user_id`) |
| **boarding → dorm bunk** (`bed S-12-B`) | patient header | **B1 — omitted.** Two "beds" in one view; never conflate `sickbay_bed` with `boarding_bunk` (R7) |
| **boarding in-House count** (R29) | the admission state | INCR-22 creates the state INCR-28 reads. **Sickbay-admitted ≠ referred-out**: the `· sick-bay not subtracted` gloss at `boarding/houses/[houseId]/today/page.tsx:135` **stays** (OQ5); a *referred-out* student IS subtracted, at 25/28 |
| **boarding `prep_attendance`** (`excused from the 06:00 prep run`) | visit §04 path card | **NOT built** — trim the parenthetical (§9.1 row 2) |
| **sickbay → chronic register** | chronic flags, SCD banner, per-condition criteria, `View care plan →` | all omitted at 22; the criteria row shape is designed so 23 pre-fills it without a migration |
| **sickbay → MAR / rounds** | `.ab-line` med sentence, `Add dose` | INCR-24; 0057 authors `sickbay_visit_tenant_uk` so 0059 can carry the composite FK |
| **sickbay → referrals** | disposition `REFERRED` | INCR-25; the enum value ships at 22, the artefact does not |
| **sickbay → parent / HM notifications** | HM strip, HM card, `re-notified by 18:00` | INCR-26; **the privacy grammar (name + location, never condition) binds INCR-22's bed board and live tile today** |
| **sickbay → WASSCE SC-12** | admission spans | INCR-28 (app-layer auto-suggest, insert-if-absent DRAFT only, never a trigger; MATRON gains no WASSCE role) |
| **sickbay → billing** | — | **out** (D6, owner-deferred; INCR-27 is display-only) |

---

## 13. Omit-not-fake register (the honest-omission list for the PR)

| Omitted | Why | Reinstatement trigger |
|---|---|---|
| SCD protocol banner (whole element) | no care plan exists; leaks the diagnosis twice | INCR-23 |
| Chronic flags: `Sickle cell · HbSS`, `Sickle cell SS`, bed `SCD`, `No chronic flag` | same source, plus the adjacency ruling | INCR-23 — and even then, **visit record only**, never the queue or the bed board |
| `NHIS · active` | no field; D3's shape is unsettled | INCR-25 |
| HM awareness strip + §02 HM notification card | no notification table; rendering "notified 09:17" asserts a message never sent | INCR-26 |
| Live tiles 4 (`Active referrals`) and 5 (`Cluster watch`) → strip drops to 3 | no source table | INCR-25 / INCR-27 |
| today lede clauses `1 active referral (…)` and `URTI mild cluster watch` | advertise absent affordances | same |
| `Print day sheet` / `Print summary` | no print artefact; a printed sheet carries every complaint out of the room | an owner-approved print design |
| `Add note` | no note entity — the assessment card **is** the note | never (unless a distinct nursing-note artefact is designed) |
| `refresh 15s` | polls nothing | a real refresh interval |
| Triage pill `Routine` | every drawn row is Routine; the ladder is undefined by all five surfaces | a designed urgency workflow |
| `bed S-12-B` fragment | B1 — no upper/lower bunk axis | a real bunk-position schema |
| `age 15` when DOB is null | render only when present | — |
| `(auto-applied to roll-call)` | `prep_attendance` is not written | a designed future-dated exemption |
| `View care plan →`, `Mark for 16:00 reassessment`, `Save draft` | no target / no task list | 23 / 26 |
| `.ab-line` med + parent-notification sentences | 24 / 26 | those increments |
| visit §03 / §05 entirely — **no shell, no badge, no anchor target** | INCR-24 / INCR-26 | those increments |
| today §02 / §04 / §05 entirely | 24 / 25 / 27 | those increments |
| N&MC number in the sidebar footer | clutter, two formats | never |

**Nothing in this list is placeholdered.** No `LIGHT·PLACEHOLDER` badges, no greyed mock rows, no `0/0`, no `—` standing in for an unrecorded clinical value, and — the Mode-C rule — **no disabled control standing in for a capability the school does not have.**

---

## 14. Open questions / drift log

| # | Question | Owner | Blocks |
|---|---|---|---|
| **Q1** | Sidebar: re-point the single `Sickbay` row to `/senior/sickbay/today` (recommended — MATRON is read-only on setup), or add a second row and push a Headmaster further past twelve items? | Kofi | INCR-22 nav |
| **Q2** | 🔴 **`SICKBAY_CLINICAL_READ_ROLES = [HEADMASTER, MATRON]`** — D2 says ADMIN has no clinical read without a grant, and grants are INCR-23. Confirm ADMIN is excluded from `/today` and `/visits/**` at 22. | Kofi + Sarah | INCR-22 gate — **the highest-severity item in this map** |
| **Q3** | Route key: human `reference` (recommended — printed, spoken, written on slips) vs uuid | Wells | 0057 unique index |
| **Q4** | Vitals: append-only with a same-session correction window (recommended) vs strict append-only with an amendment row (the MAR rule, INCR-24) | Kofi | W5 |
| **Q5** | Chronic flag before INCR-23: omit entirely (recommended) vs a two-tier read of `student_health_record.conditions` — condition text **inside the visit record only**, a neutral marker on the queue/bed board | Kofi + owner | Y1 |
| **Q6** | Multi-day attendance: write-on-admit + backfill-on-discharge (recommended, no scheduler) vs a daily job | Kofi | §9.2 guard 3 |
| **Q7** | Discharge criteria at 22 (recommended, matron-typed) vs deferring the whole card to 23 with the care plan | Kofi | Y3 · INCR-22 size (already XL) |
| **Q8** | Triage ladder — omit (recommended) vs define `ROUTINE\|URGENT\|EMERGENCY` now | Kofi | §5.4 |
| **Q9** | `PROGRAMME_ABBR.GENERAL_SCIENCE` — shipped `GS` vs the surfaces' `SCI` (one-line fix; also corrects the shipped setup surface) | Owner | §5.8 |
| **Q10** | Multiple simultaneous admissions: one `.admitted-block` per admission (recommended) vs one block + the bed board | Owner / Lucy | T1.3 |
| **Q11** | today §03 (*Recent visits · 24h*) is **unassigned by the board** and is the only route to a visit record — fold into 22, or open 22b? | Kofi | the module's navigation loop |
| **Q12** | **AUTHORED copy needing owner sign-off:** `No readings yet.` · `No one waiting.` · `No beds configured — add capacity in Sickbay setup.` · `awaiting Matron confirmation` · `reassessment overdue` · `just now` · the Mode-C beds panel · the non-admitted lede/disposition variants · `Admitted. Attendance not marked — {reason}.` · `in-person consult` | Owner | copy review before merge |

**Inventory corrections recorded here:**
1. Inventory §7 lists **B4** (visiting doctor as an actor) as unresolved — **R21 settled it**: recorded external actor, name + affiliation, no `ref_user`. This map follows R21.
2. Inventory §7's BACKED table lists *"Boarding day-type axis (reuse for the hours table)"* — already corrected by the INCR-21 map (FLAG D1) and by **R14**; noted again only because the same table is cited for the round schedule this surface's `.ab-line` and §V4 reference.
3. Inventory §4 §01 calls the queue's chronic flag *"a derived read of the chronic register"* — true, but the **adjacency ruling (A5)** now constrains *how* it may render when 23 lands: neutral marker on the queue, condition text only inside the visit record.
