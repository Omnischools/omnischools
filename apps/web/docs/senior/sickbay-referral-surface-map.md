# Sickbay — The Referral Log · Surface Map (INCR-25 · Module 4.4)

**Author:** Lucy (design cartographer) · **Status:** build-ready design spec for the implementation engineer (Claude Code).
**Increment:** INCR-25 — *referrals: hospitals · referral out · ward updates · return · **NHIS shape ruling*** · migration **0062** · **lane B** of Module 4.4 (branches independently off the INCR-22 trunk, alongside the 23→24 lane; touches no chronic table).
**Source surface:** `Surfaces/schoolup-sickbay-referral-log.html` (1334 lines, 5 stacked sections). **Companion source sections** for the two out-of-file build slices this increment also owns: `Surfaces/schoolup-sickbay-today.html` **§04** (active referrals out) and `Surfaces/schoolup-sickbay-setup.html` **§04** (referral hospitals, lines 706–852 — carved out of the INCR-21 setup map to here).
**Companions:** `docs/senior/sickbay-surface-inventory.md` (module breadth · N1–N30 / B1–B14 · the 24 NHIS elements · 6 PII classes) · `sickbay-setup-surface-map.md` (INCR-21 — §04 hospitals deferred here) · `sickbay-visit-surface-map.md` (INCR-22 — the visit atom this referral hangs off; disposition value `REFERRED`) · `sickbay-chronic-register-surface-map.md` (INCR-23) · `sickbay-medication-surface-map.md` (INCR-24).
**Board:** `docs/senior-build-plan.md` → **MODULE 4.4** header (L2369), the INCR-25 row (L2394), owner **D3 (NHIS four shapes)**, **D6 (sickbay→billing write STOP-AND-ASK)**, Risk 4 (PII by proximity), Risk 9 (seed drift). Kofi rules the NHIS *modelling* in parallel; this map owns the *surface inventory* of what the referral log renders.
**Shipped spine this map builds on:** `db/schema/sickbay.ts` (`sickbay_settings` · `sickbay_bed` · `sickbay_schedule_slot`), the frozen contract `lib/sickbay/{config,defaults}.ts`, the visit atom `sickbay_visit` · `sickbay_admission` · `sickbay_doctor_consult` (0057), the attendance hook `lib/attendance/mark.ts` + `medicalHoldStudentIds()` (0057/22b — INCR-25 extends its **open-referral arm** with no caller change), `lib/access.ts::SICKBAY_ROLES` / `SICKBAY_CLINICAL_READ_ROLES`.

> **Migration number.** The board's INCR-25 row still reads `0060`; that number was **consumed by INCR-24** (see `sickbay-medication-surface-map.md` header — 0060 = the medication layer). Per owner direction this increment's referral tables land in **migration 0062**. `sickbay_notification` is **authored in 0062** but its write-chain is built at **INCR-26** (the INCR-16→18 / 0060-authored-0026-built precedent).

---

## 0. Scope — five sections, three owner increments; INCR-25 builds two of the surface's five plus two out-of-file slices

The referral-log file draws **five stacked sections**. INCR-25 builds **§01 + §02 (minus its comms-thread card)**, plus **`today` §04** and **`setup` §04** which live in other files. Everything else is **mapped 1:1 but not built here** — exactly as the setup map carved §3 out to INCR-24.

### 0.1 Section → owner increment → build status at INCR-25

| Surface section | Title (verbatim `.section-title`) | Lines | Owner increment | Build status at INCR-25 |
|---|---|---|---|---|
| **§01** | *Active referrals · two students out* | 340–491 | **INCR-25** | **BUILD** — stats strip, the two referral cards (seven-line pattern), the cross-module strip. |
| **§02** | *Case detail · Y. Aidoo · severe malaria* | 493–748 | **INCR-25** (patient header · ER handoff · hospital updates · NHIS-identity) **+ INCR-26** (parent comms thread card) **+ INCR-27** (itemised-cost render → billing handoff) | **PARTIAL** — see §0.2. |
| **§03** | *Today's parent notifications · timeline* | 750–922 | **INCR-26** | **MAP-ONLY** — the whole three-tier notification timeline. |
| **§04** | *Referral history · last 30 days* | 924–1162 | **INCR-27** | **MAP-ONLY** — the 30-day table + diagnosis/hospital-mix bars. |
| **§05** | *Outstanding reconciliation · three families* | 1164–1329 | **INCR-27** | **MAP-ONLY** — recon strip, outstanding list, cross-module billing handoff. 🚫 **and the school-wide NHIS roll-up = DO-NOT-BUILD, ever** (§7, the forbidden STPSHS matrix). |
| **`today` §04** | *Active referrals out* (`schoolup-sickbay-today.html`) | today file | **INCR-25** | **BUILD** — the live-strip tile + a compact projection of §01's active cast. |
| **`setup` §04** | *Where serious cases go* (`schoolup-sickbay-setup.html` 706–852) | setup file | **INCR-25** | **BUILD** — the four hospital cards + `sickbay_hospital` config (N6). |

**In scope for the 0062 migration + build: referral-log §01, §02 (handoff + updates + NHIS card identity/coverage), today §04, setup §04.** The parent comms thread, the notification timeline, the 30-day history, and the outstanding reconciliation are **authored-not-built** — 0062 may author `sickbay_notification` (built at 26) and the referral-cost line table (rendered at 27), but INCR-25 ships no notification chain and no billing write.

### 0.2 §02 is split three ways — the boundary, precisely

| §02 card | Lines | Owner | Boundary rule at INCR-25 |
|---|---|---|---|
| Patient header (`.patient-header` + `.dx-flag` + `.nhis-flag` + `.id-flag`) | 541–560 | **INCR-25** | BUILD — clinical-read gated (§1.3). The `.dx-flag` renders the diagnosis; it is a PII-by-proximity spot (A-adjacency A1, §6). |
| **ER handoff at admission** (`.handoff-grid`, 14 rows) | 564–593 | **INCR-25** | BUILD — the frozen referral-time clinical snapshot (**N22 `referral_handoff`**). |
| **Hospital updates** (append-only external clinical log) | 595–618 | **INCR-25** | BUILD — **N23 `referral_update`**, authored by an external clinician who is NOT a school user (R21 pattern). |
| **Parent comms thread** (`.comms-thread`, 7 events) | 622–698 | **INCR-26** | **OMIT the whole card at 25.** It renders inbound/outbound/failed sends with tier tags, call durations, and a *private matron note* that must never reach a parent — none of which has a write-chain until 26. Copy preserved verbatim in §5.3 for INCR-26 to port. |
| **NHIS reconciliation · this case** (`.nhis-block`, 8 itemised rows + green note) | 701–730 | **INCR-25** shape ruling (card identity · holder≠student · per-line coverage = D3) **/ INCR-27** full itemised render + billing handoff | **BUILD the card identity + holder line + coverage shape** (the D3 four shapes land here); **defer the itemised-cost table render + the "billing module gets a flag" write to INCR-27** (D6 — reconciliation is display-only, `invoice_id` NULL, no financial write in 4.4). See §4 and §7. |

### 0.3 In-scope elements that structurally depend on out-of-scope increments (Y-items)

Each carries a stated INCR-25 resolution; every one is an **omit**, never a fabricated placeholder.

| # | In-scope element | Reaches into | INCR-25 resolution |
|---|---|---|---|
| **Y1** | §01 card actions `Message parent` · `Call hospital`; §02 `Call parent` · `Add update`→notification | `sickbay_notification` (N26, INCR-26) | **`Add update` BUILDS** (it appends an N23 hospital-update row, no comms). **`Message parent` / `Call parent` / `Call hospital` render but log a *contact intent*, not a send** — or OMIT at 25 and restore at 26. Recommend OMIT (never draw a comms affordance with no chain — the FLAG-L1 precedent). |
| **Y2** | §01 xmod `Attendance` card — *"Y. Aidoo marked excused for Wed, Thu · Marks back to normal when matron clears return"* | `lib/attendance/mark.ts` (shipped 22b) + a **clear-return** write | **BUILD the fact, not the card.** INCR-25 makes the assertion TRUE: a `REFERRED` disposition places the student under an open medical hold (`medicalHoldStudentIds()` open-referral arm), so day-2/3 registers coerce `MEDICAL` on INSERT. The **clear-return** write (`returned_at` set → hold closes) is INCR-25's. The xmod *card* that narrates it is editorial — render a plain honest line, not the demo card (§5.1). |
| **Y3** | §01 xmod `Boarding` card — *"HMs notified · student under sickbay care, off-campus"* | `sickbay_notification` (26) + the boarding in-House formula (INCR-28) | **OMIT the card.** But the **off-campus fact is INCR-25's** and it collides with OQ5/R29: a *referred-out* student **IS** subtracted from in-House (unlike a sickbay admission). Flag to boarding at 28 (§8). |
| **Y4** | §01 xmod `Billing` card + §02 NHIS green note *"billing module gets a flag"* + §05 handoff | `invoice_line_item` write (D6 — STOP-AND-ASK) | **OMIT the billing write at 25.** Cost lines are stored (N24) with `invoice_id` NULL; the billing hook is INCR-27 display-only. No production financial write in 4.4 (D6, same shape as the parked boarding 3× penalty). |
| **Y5** | §02 NHIS reconciliation `.nhis-table` itemised 8 rows + total | N24 `referral_cost_line` full render | **BUILD the card identity + holder line** (D3) at 25; **defer the itemised table + total to INCR-27** (it is the school-facing reconciliation, not the matron's at-ER need). At 25 the §01 card's NHIS line (card number + one-line coverage summary) is enough for the matron presenting the card physically. |
| **Y6** | §02 ER-handoff `Chronic` row — *"None on register · no known drug allergies"* | `sickbay_care_plan` / `student_health_record` (INCR-23, shipped) | **BUILD as a live read** — 23 is shipped in lane A; the handoff reads the chronic register at referral time and **freezes** the string into the N22 snapshot (a later plan edit must not rewrite a historical handoff). |
| **Y7** | §02 ER-handoff `Reason out` — *"Beyond N&MC scope for matron-only"* | `sickbay_standing_order` (INCR-24, shipped) scope-of-practice | **Free text at 25** (no FK). The clause is the matron's prose justification; do not join it to a standing-order row. |
| **Y8** | §02 hospital-updates `Dr Mensah ward round` / `Nurse update` authors | external clinician, no `ref_user` (R21/B4) | **BUILD as recorded external actors** — `author_name` + `author_role` text on the N23 row, `recorded_by_user_id` = the matron who transcribed. No login, no identity pointer (R38 verbatim: an FK to an external clinician is not an actor). |

**INCR-25 has ZERO dependency on** the notification tiers, the outbreak monitor, or the school-wide NHIS roll-up. It depends on the **shipped** INCR-21 spine (`capabilities` for mode gating), the **shipped** INCR-22 visit atom (`sickbay_visit.disposition = REFERRED` is the parent of every referral row), and the **shipped** 22b attendance writer (extended, not rewritten).

---

## 1. Shared chrome, routes, gates, tokens, type

### 1.1 Design-doc chrome — do NOT build

The file is a design document wrapping app frames. Build **only** `.app-shell` (the shipped `components/app/sidebar.tsx` + main). The five `.notes` right rails are **intent documentation** — port their rules, render none of their text.

| Do NOT build | Where |
|---|---|
| `.page-header` (`.mvp-tag` `MVP2 · Sickbay · surface 5 of 5`, h1 `The referral *log.*`, gold rule, the "When a sickbay sends a student out…" paragraph) | 333–338 |
| every `.section-head` (`01` / `Active referrals · two students out` / `Live · Wed 14 May 15:30`; `02` / `Case detail · Y. Aidoo · severe malaria` / `Day 1 inpatient · full thread`; `03`/`04`/`05` heads) | 341–345, 494–498, 751–755, 925–929, 1165–1169 |
| every `.desktop` / `.browser-bar` / `.url` / drop-shadow `rgba(26,43,71,0.25)` | per section |
| every `.notes` right rail (§01 481–489, §02 737–746, §03 911–920, §04 1151–1160, §05 1318–1327) | — |
| `.sidebar.tall` min-height variants + the surface's demo nav (see 1.2) | — |

**Notes-panel rules to PORT (not render):** §01 — *"two cards, two stories"* (inpatient = higher-stakes worry, terra border + day counter; returning = wind-down, warn border + ETA), *"the seven-line card pattern… anything missing is a real gap, not a UX gap"* (the seven lines ARE the referral row's required-field set), *"NHIS card number is visible… the most operationally important number on the page"* (mono, copy-pasteable, no drill-down), *"cross-module strip is honest — attendance gets the fact, HMs get the fact, billing gets the cost — none get the diagnosis"* (this is the product, §6). §02 — *"ER handoff is verbatim recall… determines whether the receiving doctor wastes time re-investigating"*, *"NHIS is itemised, not aggregated"*, *"Call parent is the primary action… she's looking at it while talking"*. §05 — *"the matron never sees billing… sickbay creates the cost; billing carries it"* (clean separation — the Bursar owns §05), *"the age column is the operational signal, not the amount"*.

### 1.2 Routes & navigation

- **§01 Active:** `/senior/sickbay/referrals` — surface URL `asankrangwa.omnischools.gh/sickbay/referrals`, repo `/senior/` prefix (INCR-21 precedent).
- **§02 Case detail:** `/senior/sickbay/referrals/[ref]` — surface URL `…/sickbay/referrals/r-2026-05-14-0817`. Anchors within it are one route.
  - **Reference format `R-{YYYY-MM-DD}-{student seq}`** (`R-2026-05-14-0817`, seq `0817` from `SHS-2023-0817`). ⚠️ **Do NOT author a stored generated `referral_ref` column** — the visit map's R64 amendment #11 dropped the generated visit_ref for exactly this reason (it re-encodes facts already on the row in a format the surfaces contradict). **Route by the referral row's server-resolved id** inside `withSchool` (three-layer no-IDOR: RLS + explicit school predicate + re-resolved id, the INCR-21 pattern); a pure formatter `formatReferralRef(row)` produces the crumb/print string. **Q1 for Kofi/Wells** — confirm route-by-id vs a stored reference (the invoice-number idiom); the phone/paper use case that justified the visit `reference` is weaker here (the NHIS card number, not the case ref, is what the matron reads down the phone).
- **§03 notifications:** `/senior/sickbay/referrals/notifications` — **INCR-26.**
- **§04 history:** `/senior/sickbay/referrals/history` — **INCR-27.**
- **§05 reconciliation:** `/senior/sickbay/referrals/reconciliation` — **INCR-27** (Bursar-owned view).
- **`today` §04:** the live-strip `Active referrals` tile + a summary block on `/senior/sickbay/today`, linking to `/senior/sickbay/referrals`. **INCR-25.**
- **`setup` §04:** `/senior/sickbay/setup#hospitals` — an in-page section of the shipped setup route (the `#capacity` precedent). **INCR-25.**
- **Sidebar:** the shipped flat nav's one Sickbay row → `/senior/sickbay/today` (repointed at INCR-22). **No sub-nav.** `Referrals` is reached by the module's own in-page navigation, not a sidebar sub-item (inventory §1.5). The surface's demo sub-nav (`Today's sickbay · Visit record · Chronic register · Referrals · Setup`) — **the app nav wins.** "Student support" is the section-nav label if/when the twelve-item threshold triggers sectioning; "pastoral" stays editorial/CSS.
- **Surface nav drift, for the record:** the referral log draws `Dashboard · Students · Attendance · Boarding · Sickbay · Discipline · Communications · Reports`. The app nav wins.

### 1.3 🔴 Gates — the referral surface is clinical-read gated, but its cross-module PROJECTIONS are not

| Slice | Read | Write | Grounding |
|---|---|---|---|
| **§01 · §02 · today §04** (the referral record + case detail) | **`SICKBAY_CLINICAL_READ_ROLES = [HEADMASTER, MATRON]`** — **NOT ADMIN** (D2), **NOT HOUSEMASTER** | **`[MATRON]`** (create referral, add update, mark returned) | The referral renders diagnosis, vitals, menstrual data, NHIS numbers — the module's Class-1/3/4 PII. ADMIN keeps module access, gets **no clinical detail** (server-side prop trim, not conditional render — the INCR-22 R40/Z2 rule). |
| **setup §04** (hospital config) | `SICKBAY_ROLES = [ADMIN, HEADMASTER, MATRON]` (config, not the clinical graph) | **`SICKBAY_CONFIG_WRITE_ROLES = [ADMIN, HEADMASTER]`** — the MATRON **reads but cannot write** hospitals (the INCR-21 R18 boundary: config is the Headmaster's; the surface footer proves it). | `accepts_nhis` / `distance_km` are config facts, no PII. |
| **§05 reconciliation** (INCR-27) | Bursar + `SICKBAY_ROLES` — **but the diagnosis must be trimmed for the Bursar** (§6, A-leak). | display-only (D6) | *"The matron never sees billing… Mrs Bediako can read this (audit) but the bursar owns it."* |

**The projections (attendance mark, boarding HM roster, billing line-item) carry NAME + FACT-OF-REFERRAL, NEVER the diagnosis** — the xmod strip copy is the design commitment (§6). `attendance_record.note` is the module's only outbound leak path into the Basic tier → write `null` or a fixed non-clinical string, never the diagnosis (visit-map A7, binding).

### 1.4 Token reference (`:root` identical to every sickbay surface → Tailwind token class)

Identical hexes to `md files/design-tokens.json`. Token classes in JSX, **never inline `var(--x)`**.

| Surface var | Hex | Tailwind | Used in scope for |
|---|---|---|---|
| `--navy` | `#1A2B47` | `text-navy` / `bg-navy` | body text, `.ref-head`/`.patient-header`/`.xmod-card` gradient start, `.r-av`/`.h-av` glyph, `.r-val b`, `.vital-num`, `.nhis-table td.r`, `.h-date`, `.h-cost`, `.ol-amt`, `.filter-pill.active` |
| `--navy-2` | `#2D3F5C` | `text-navy-2` | `.ref-head`/`.patient-header`/`.xmod-card` gradient end, `.r-val`, `.ct-time`, `.ct-body`, `.nt-time`, `.h-cond`/`.h-hosp`, `.rc-trend b`, `.s-trend b` |
| `--navy-3` | `#5C6675` | `text-navy-3` | crumb, lede, `.s-lbl`/`.s-trend`, `.r-lbl`/`.sub`, `.ch-meta`, `.h-lbl`, `.day`/`.ago`/`.h-time`/`.km` sub-lines, `.ct-note`, `.nh-card`, table `th`, `.fs-lbl`, `.rc-lbl`, `.ol-line` |
| `--gold` | `#C8975B` | `text-gold` / `bg-gold` / `border-gold` | every italic `<em>`, `.r-av`/`.h-av` fill, `.pill-mini.transport` text, `.ct-chan.call-out`/`.sms-out` fill/border, `.ct-tag.outbound`, `.nt-icon.tier-1`/`.nt-tier.t1`, `.h-stat.outpatient`, `.ol-action.primary` fill, `.xm-lbl`, `.inline-link`, the 15:25 `.ct-time` italic |
| `--gold-soft` | `#E8D4B8` | `text-gold-soft` / `border-gold-soft` | `.r-class`/`.p-detail` text, `.ref-day-pill`, `.id-flag`, `.h-av` default fill, `.ol-av` default fill, `.ct-msg` left border, `.xm-body` text, `.filter-pill.active .ct` text |
| `--gold-bg` | `#F5EBDC` | `bg-gold-bg` | `.pill-mini.transport` fill, `.ct-chan.sms-out`/`.ct-tag.outbound` tint, `.nt-icon.tier-1`/`.nt-tier.t1` tint, `.h-stat.outpatient` tint, the failure-note panel, the billing-handoff note |
| `--bg` | `#FAF7F2` | `bg-bg` | page ground, `.main`, `.ref-foot`, table `th` ground, `.ct-msg`/`.ct-tag` ground, `.channel` pill, `.nhis-table tfoot`, `.h-av.navy`(via tint), `.notify-row.future` gradient start; **also the light text on navy/terra fills** (`.r-name`? no — `text-bg` on `.ref-head`, `.dx-flag`, `.ref-status-pill.inpatient`, `.xm-body b`) |
| `--surface` | `#FFFFFF` | `bg-surface` | cards, tiles, `.stat`, `.ref-card`, `.nhis-block`, `.notify-timeline`, `.history-table`, `.recon-card`, `.filter-pill`, `.ref-status-pill.returning` text, `.ct-chan.call-out` glyph… |
| `--green` | `#2F6B47` | `text-green` | `.pill-mini.nhis`/`.cov-pill.covered`/`.nhis-flag` text, `.ct-chan.call-in`/`.ct-tag.inbound`, `.h-nhis.yes`, `.h-stat.returned`, `.h-cost .h-status`, `.recon` "within window", the clean-NHIS note bar |
| `--green-bg` | `#E5EFE8` | `bg-green-bg` | `.pill-mini.nhis`/`.cov-pill.covered`/`.nhis-flag` tint, `.ct-chan.call-in`/`.ct-tag.inbound` tint, `.h-av.green`, `.h-stat.returned` tint, the clean-NHIS note ground |
| `--terra` | `#B84A39` | `text-terra` / `bg-terra` / `border-terra` | `.stat.active`/`.recon-card.outstanding` border+val, `.ref-card.inpatient` border, `.ref-status-pill.inpatient` fill, **`.dx-flag` fill**, `.pill-mini.severity`/`.cov-pill.oop`, `.nt-icon.tier-3`/`.nt-tier.t3`, `.h-stat.inpatient`, `.h-nhis.no`, `.vital-num.alert`, `.ol-since`, `.ago.urgent`, history `tr.tier-3` left border |
| `--terra-bg` | `#F5E1DC` | `bg-terra-bg` | `.stat.active`/`.recon-card.outstanding` gradient, `.pill-mini.severity`/`.cov-pill.oop` tint, `.nt-icon.tier-3`/`.nt-tier.t3` tint, `.h-stat.inpatient` tint, `.h-av.terra`, history `tr.active-row` gradient start |
| `--warn` | `#C58A2E` | `text-warn` | `.ref-card.returning` border, `.ref-status-pill.returning` fill, `.cov-pill.partial`, `.nt-icon.tier-2`/`.nt-tier.t2`, `.h-stat.returning`, `.h-nhis.exp`, `.h-cost .h-status.partial`, the card-health warn note, `11:00` update `38.2°C` |
| `--warn-bg` | `#F5E9D0` | `bg-warn-bg` | `.cov-pill.partial` tint, `.nt-icon.tier-2`/`.nt-tier.t2` tint, `.h-stat.returning` tint, `.h-av.warn`, the card-health warn note ground |
| `--border` | `#E5DFD3` | `border-border` | card borders, every row divider, `.handoff-col h5` rule, `.channel` pill border |
| `--border-2` | `#D4CCBA` | `border-border-2` | `.ff-btn`/`.filter-pill`/`.ol-action` border, every table `th` bottom, `.ct-chan.call-fail`/`.ct-msg.fail` border |

**Type families:** `font-display` = **Fraunces** (h1, `.section-title`, `.s-val`, `.r-av`/`.r-name`, `.patient-av`/`.p-name`, `.ch-title`/`.nh-title`, `.h-av`/`.h-name`, `.ct-chan` glyphs, `.nt-icon`, `.rc-val`, `.ol-av`/`.ol-name`, `.xm-title`, every gold `<em>`, and the `15:25 · Latest` `.ct-time` **italic gold**) · default = **Manrope** · `font-mono` = **JetBrains Mono** (`.ref-day-pill`, `.r-val .mono` incl. every NHIS card number + phone, `.ct-time`/`.ct-dur`, `.nh-card`, `.nhis-table td.r`, `.nt-time`, `.h-date`, `.h-cost`, `.filter-pill .ct`, `.ol-amt`, `.km`, `.vital-num`, the inline mono spans in the hospital-updates card).

**Deliberate Manrope-inside-mono cells** (the visit-map convention): `.day` / `.ago` / `.h-time` / `.h-status` / `.ol-since` are set `font-family:'Manrope'` even though they sit under a mono time/cost. Reproduce the mix; do not "correct" it to mono.

**Absent-value convention:** em-dash `—` in `text-navy-3` for *unknown*; a genuine `0` renders `0` (e.g. `GHS 0.00` covered). The NHIS out-of-pocket column already uses `—` for a covered line — that is the convention, correct as drawn. An **absent clinical reading** (an unrecorded handoff vital) renders **nothing** (blank cell), never `—`.

### 1.5 No-alpha discipline (repo memory `no-alpha-token-opacity`)

**Finding: unlike the chronic register (which introduced two bespoke condition-pill hexes `#7B4A8A`/`#3E7B6B`), this surface introduces NO new named hex — every colour is a declared `:root` token.** The only raw values are **alpha literals**, and they are precisely where a Tailwind slash-opacity translation renders *nothing* while `next build` passes. Port every one as an arbitrary value or `opacity-N`, never slash-opacity.

| Region | Raw value | Port to (NOT slash-opacity) |
|---|---|---|
| `.ref-head::before` / `.patient-header::before` / `.xmod-card::before` decorative glows | `rgba(200,151,91,0.07)` / `(0.08)` / `(0.06)` | `bg-[rgba(200,151,91,0.07)]` etc — **never** `bg-gold/7`. Purely decorative; dropping them is acceptable. |
| `.filter-pill .ct` count badge / `.filter-pill.active .ct` | `rgba(200,151,91,0.18)` / `(0.2)` | `bg-[rgba(200,151,91,0.18)]` — **never** `bg-gold/18`. |
| `.comms-row .ct-chan.sms-in` (INCR-26) | `rgba(45,107,71,0.08)` (green at 8%) | `bg-[rgba(45,107,71,0.08)]` — **never** `bg-green/8`. |
| `.history-table tr.active-row` gradient (INCR-27) | `linear-gradient(90deg, var(--terra-bg) 0%, rgba(245,225,220,0.2) 100%)` | reproduce the literal in the arbitrary gradient value; the second stop is terra-bg at 20% — do not `terra-bg/20`. |
| `.history-table td .h-av.navy` (INCR-27) | `rgba(45,63,92,0.12)` (navy-2 at 12%) | 🔴 **the chronic-register precedent applies** — this is the same navy-tint-for-an-avatar job flagged there. Recommend a **dedicated `--navy-bg` tint token** (chronic map recommended `#E9EBEF`) shared across both surfaces, not a per-component alpha. |
| `.notify-row.future` (INCR-26) | `opacity:0.7` | `opacity-70` utility (safe — not a token alpha). |
| `.filter-pill.ct` / sidebar rgba | `rgba(255,255,255,0.18/0.08)`, `rgba(250,247,242,0.7)` etc | sidebar values already shipped in `components/app/sidebar.tsx` — do not re-author. |

**Verify in the live preview, not the build.** Slash-opacity on a raw-hex token renders *nothing* and the build is green.

### 1.6 Bespoke / non-token values in scope — reproduce exactly, do not round to a scale step

**§01 (BUILD)**

| Element | Bespoke value |
|---|---|
| `.stats-strip` / `.stat` | `grid-cols-4 gap-[14px] mb-6` · tile `bg-surface border border-border rounded-[10px] p-[14px_16px]` |
| `.s-lbl` / `.s-val` / `.unit` / `.s-trend` | `9px/0.16em` uppercase 700 navy-3 mb-[6px] · Fraunces `28px` 500 `tracking-[-0.02em]` leading-none, `<em>` italic gold 400 · `13px text-navy-3 font-medium` Manrope `ml-[5px]` not-italic · `10px text-navy-3 mt-[5px] font-medium`, `<b>` navy-2 700 |
| `.stat.active` | `linear-gradient(135deg, var(--terra-bg) 0%, var(--surface) 100%)` · `border-terra`; `.active .s-val` → `text-terra` |
| tile 4 `.s-val.mono` | inline `font-size:24px` → `font-mono text-[24px]` (the `GHS 340` outstanding-cost tile) |
| `.referral-grid` | `grid-cols-2 gap-[18px] mb-[22px]` |
| `.ref-card` / `.inpatient` / `.returning` | `bg-surface border border-border rounded-[14px] overflow-hidden flex flex-col` · `border-[1.5px] border-terra` · `border-[1.5px] border-warn` |
| `.ref-head` | `linear-gradient(135deg, var(--navy) 0%, var(--navy-2) 100%)` text-bg `p-[16px_20px]` `grid-cols-[auto_1fr_auto] gap-[14px] items-center relative overflow-hidden`; `::before` 90px circle `top-[-25px] right-[-25px]` `bg-[rgba(200,151,91,0.07)]` |
| `.r-av` | `size-12 rounded-full bg-gold text-navy` Fraunces `16px` 600 |
| `.r-name` / `.r-class` | Fraunces `18px` 500 `tracking-[-0.01em] mb-[2px]`, `<em>` italic gold 400 · `11px text-gold-soft`, `<b>` text-bg 600 |
| `.ref-status-pill` / `.ref-day-pill` | `9px/0.12em` uppercase 700 `px-[10px] py-1 rounded-full`; `.inpatient` bg-terra text-bg; `.returning` bg-warn text-surface · `9px/0.08em` 600 text-gold-soft **font-mono** |
| `.ref-body` / `.ref-line` | `p-[18px_20px] flex-1` · `grid-cols-[120px_1fr] gap-[14px] py-2 border-b border-border items-start`, last none |
| `.r-lbl` / `.r-val` | `9px/0.14em` uppercase 700 navy-3 `pt-[2px]` · `12px text-navy-2 leading-[1.5]`, `<b>` navy 600; `.sub` `block 11px text-navy-3 mt-[2px] italic`; `.mono` `font-mono 11px` |
| `.pill-mini` | `inline-block 9px/0.08em` uppercase 700 `px-[7px] py-[2px] rounded-full mr-[5px]`; `.nhis` green-bg/green · `.transport` gold-bg/gold · `.severity` terra-bg/terra |
| `.ref-foot` / `.ff-lbl` / `.ff-btn` | `bg-bg p-[12px_20px] border-t border-border flex gap-2 items-center` · `9px/0.14em` uppercase 700 navy-3 · `bg-surface border border-border-2 p-[6px_11px] rounded-md 10px 600 text-navy`; `.primary` bg-navy text-bg |
| `.xmod-strip` / `.xmod-card` | `grid-cols-3 gap-[14px] mt-5` · `linear-gradient(135deg,var(--navy)_0%,var(--navy-2)_100%)` text-bg `rounded-[10px] p-[14px_16px] relative overflow-hidden`; `::before` 80px `bg-[rgba(200,151,91,0.06)]` |
| `.xm-lbl` / `.xm-title` / `.xm-body` | `9px/0.16em` uppercase 700 gold mb-[6px] · Fraunces `14px` 500 `leading-[1.3] mb-[5px]`, `<em>` italic gold 400 · `11px text-gold-soft leading-[1.5]`, `<b>` text-bg 600 |

**§02 (BUILD, minus the comms-thread card)**

| Element | Bespoke value |
|---|---|
| `.patient-header` | `linear-gradient(135deg,var(--navy)_0%,var(--navy-2)_100%)` text-bg `rounded-[14px] p-[24px_28px] mb-6 grid-cols-[auto_1fr_auto] gap-6 items-center relative overflow-hidden`; `::before` 160px `bg-[rgba(200,151,91,0.08)]` |
| `.patient-av` | ⚠️ **`size-[68px]`** (referral log draws 68px; the visit-record `.patient-av` is 72px — two surfaces, two sizes, reproduce each per file) `rounded-full bg-gold text-navy` Fraunces `22px` 600 |
| `.p-name` / `.p-detail` | Fraunces `24px` 500 `tracking-[-0.018em] leading-[1.1] mb-1`, `<em>` italic gold 400 · `12px text-gold-soft flex gap-4 flex-wrap`, `<b>` text-bg 600, `.dot` gold |
| `.dx-flag` | `bg-terra text-bg 10px/0.1em` uppercase 700 `px-[11px] py-[5px] rounded-full` — 🔴 **renders the diagnosis** (A1, §6) |
| `.nhis-flag` / `.id-flag` | `bg-green-bg text-green 9px/0.08em` uppercase 700 `px-[10px] py-1 rounded-full` · `font-mono 10px text-gold-soft font-medium` |
| `.card` / `.card-head` / `.ch-title` / `.ch-meta` / `.card-body` / `.col-2` | `bg-surface border border-border rounded-[12px] overflow-hidden mb-4` · head `p-[14px_20px_12px] border-b border-border flex justify-between items-baseline` · Fraunces `16px` 600, `<em>` italic gold 400 · `10px text-navy-3 font-semibold tracking-[0.06em]`, `<b>` navy 600 · body `p-[16px_20px_20px]` · `grid-cols-2 gap-4` |
| `.handoff-grid` / `.handoff-col h5` | `grid-cols-2 gap-[14px]` · `9px/0.14em` uppercase 700 navy-3 `mb-[10px] pb-[6px] border-b border-border` |
| `.h-row` / `.h-lbl` / `.h-val` | `py-[6px] grid-cols-[90px_1fr] gap-[10px] 11px text-navy-2 items-baseline` · `9px/0.1em` uppercase 700 navy-3 · `<b>` navy 600; `.vital-num` `font-mono 12px navy 600`, `.alert` → terra |
| hospital-updates rows | inline-styled: time `font-mono 11px navy 600` (the `15:25 · Latest` time adds `text-gold italic`); body `11px navy-2`; inline vital spans `font-mono` with `text-warn` (`38.2°C`) / `text-green` (`37.4°C`, `84`) / `text-navy` (`98`). **Author these as a real `.update-row` component**, not inline styles: `grid-cols-[90px_1fr] gap-[14px] py-[9px] border-b border-border`, last none. |
| `.nhis-block` / `.nhis-head` / `.nh-title` / `.nh-card` | `bg-surface border border-border rounded-[12px] overflow-hidden` · `p-[14px_20px_12px] border-b border-border flex justify-between items-baseline` · Fraunces `15px` 600, `<em>` italic gold · `font-mono 10px text-navy-3 font-medium` |
| `.nhis-table` | `w-full border-collapse`; `th` `bg-bg p-[9px_14px] 9px/0.14em` uppercase 700 navy-3 left `border-b border-border-2` (`.r` right); `td` `p-[10px_14px] 11px border-b border-border text-navy-2` (`.r` right `font-mono 600 navy`); `.cov-pill` `inline-block 9px/0.08em` uppercase 700 `px-[7px] py-[2px] rounded-full` (`.covered` green-bg/green · `.partial` warn-bg/warn · `.oop` terra-bg/terra); `tfoot td` `bg-bg 700 border-t-2 border-navy`, `.r` `13px navy`, `.r em` italic gold 600 |
| clean-NHIS note bar | `mt-[14px] p-[12px_16px] bg-green-bg rounded-lg border-l-[3px] border-green 12px text-navy-2`, `<b>` navy 600 |

**Map-only bespoke (§03/§04/§05, INCR-26/27)** — capture now so the later increments port from a spec, not the raw HTML: `.comms-thread`/`.comms-row` (grid `90px auto 1fr`, five `.ct-chan` glyph variants, `.ct-tag` direction pills, `.ct-msg` verbatim-SMS bubble, `.ct-note` private-matron note); `.notify-timeline`/`.notify-row` (grid `90px 36px 1fr auto`, `.nt-icon.tier-1/2/3`, `.nt-tier.t1/2/3`, `.future` opacity-70 gradient); `.filter-strip`/`.filter-pill` (+ `.ct` count badge); `.history-table` (7 cols, `tr.tier-N` left-border, `.h-av` 5 tints, `.h-stat`/`.h-nhis`/`.h-cost` vocab); `.recon-strip`/`.recon-card` (+ `.outstanding` variant); `.outstanding-list`/`.outstanding-row`. All colours resolve to the token table in §1.4; the only raw values are the alpha literals in §1.5. ⚠️ **§03's `.s-val gold/warn/terra/green` classes have no CSS rule in the file** → they render navy in the surface; INCR-26 must map them intentionally to `text-gold/text-warn/text-terra/text-green` (they are clearly meant to colour the tier counts).

---

## §R1 — referral-log §01 · Active referrals · two students out

**Surface lines 340–491.** Actor in the sidebar footer: `A. Bediako` / `Matron · N&MC reg.` — **render the acting user, never a hardcoded name.**

### R1.1 Page head — exact copy

| Element | Exact copy | Token / type |
|---|---|---|
| Crumb | `Sickbay` *(link)* ` · Referrals · Active` | `text-navy-3 text-[11px] tracking-[0.12em] uppercase font-semibold`; link `text-gold no-underline` |
| `<h1>` | `Referrals ` + `<em>log.</em>` | `font-display text-[28px] font-medium tracking-[-0.018em] leading-[1.1]`; `<em>` italic gold 400 |
| Lede | `**Two students out right now.** Y. Aidoo at the district hospital since 06:45 with severe malaria — still inpatient. K. Boateng returning now from orthopaedic — wrist cast, ETA 15:45.` | `text-navy-3 text-[13px] mt-1`; `<b>` → `text-navy-2 font-semibold`. **Derived + PII-trimmed** — the lede names two students and their conditions; it renders only to a clinical reader (§1.3). The count `Two` and the `since 06:45` / `ETA 15:45` are derived; the condition phrases are the referral rows. Render `{n} student{s} out right now.` + one clause per active referral. |
| Action 1 | `Filter` | `.btn` — filters the active list (status/house). BUILD (or defer — only two rows). |
| Action 2 | `Export` | `.btn` — **OMIT at 25** (an export carries every diagnosis out of the room; the visit-map A6 / `Print day sheet` precedent). |
| Action 3 | `+ New referral` | `.btn.primary` = `bg-navy text-bg border-navy font-bold` — **BUILD** (W1, §9). |

### R1.2 Stats strip — 4 tiles

| # | `.s-lbl` | `.s-val` | `.s-trend` | Derivation | Mode C |
|---|---|---|---|---|---|
| 1 `.active` | `Active right now` | `<em>2</em>` + `unit` `students` (terra) | `Y. Aidoo · K. Boateng` | count of open referrals (`returned_at IS NULL`); trend = the student short-names — 🔴 **names beside "referred out" = PII-by-proximity (A2, §6)**: render the count always; render the names only to a clinical reader and only when ≤ a small n (the visit-map "no names at all above one" ladder) | renders (referrals are first-class in C) |
| 2 | `This week` | `4` + `total` | `**3 returned** · 1 inpatient` | referrals in the ISO week; trend = closed/open split, `<b>` on the closed count | renders |
| 3 | `This semester` | `27` + `total` | `19 malaria · 4 injury · 2 SCD · 2 other` | count in the term; trend = the **categorised** diagnosis mix (N21 `diagnosis_category`, §4) — **empty at launch** (no history), never a fabricated 27 | renders (empty at launch) |
| 4 | `Outstanding cost` | `GHS 340` (mono 24px) | `3 families · 1 over 30 days` | 🔴 **INCR-27 / D6** — sum of `referral_cost_line.out_of_pocket` where unbilled. **OMIT at INCR-25** (no cost render, no billing); reinstate at 27. Strip drops to **3-up** (the INCR-21 capacity-strip precedent). | omit at 25 |

Tile 1 is `.active` (terra gradient). At INCR-25 the strip is **3 tiles** (tile 4 omitted, Y4).

### R1.3 The referral cards — the seven-line pattern (the required-field set)

Two cards in `.referral-grid`. The notes panel is explicit: *"Every active referral fills the same seven lines. Anything missing is a real gap — not a UX gap."* → **the seven `.ref-line` labels are the referral row's required (or explicitly-nullable-with-reason) field set.**

**Card 1 — `.ref-card.inpatient` (Y. Aidoo)**

| Region | Exact copy | Binding (N-item) |
|---|---|---|
| `.r-av` | `YA` | derived initials |
| `.r-name` | `Y. ` + `<em>Aidoo</em>` | `students.first_name`/`last_name`, surname carries gold italic |
| `.r-class` | `F3 Slessor House · **Science** · ID **SHS-2023-0817**` | class + house (BACKED) + programme + `student_code` (verbatim); ⚠️ **seed drift, §5** — `SHS-2023-0817` is the WASSCE Aidoo |
| `.ref-status-pill` | `Inpatient` (terra) | derived from `status` (N21) |
| `.ref-day-pill` | `Day 1 · since 06:45` | `floor(now − departed_at in days)` + `departed_at` time |
| line 1 `Diagnosis` | `**Severe malaria** ` [`.severity` `P. falciparum`] · sub `RDT positive 06:20 · temp 38.9°C · vomiting · referred when matron could not start IV` | **N21** `diagnosis_label` + `diagnosis_category` (the `.severity` pill = a categorised sub-classifier) + `diagnosis_detail` (free text) 🔴 **PII** |
| line 2 `Hospital` | `**Asankrangwa Government Hospital**` · sub `Ward B · bed 7 · Dr K. Mensah (visiting doctor here, attending there)` | **N6** `sickbay_hospital` FK + **N31** `hospital_ward` / `hospital_bed` (text) + attending clinician text (R21) |
| line 3 `Transport` | [`.transport` `School van`] `**15 min drive**` · sub `Matron Bediako accompanied · arrived 07:02` | **N31** `transport_mode` (categorised) + `transport_note` + `accompanied_by_user_id` (matron) + `arrived_at` |
| line 4 `NHIS` | [`.nhis` `Active`] `<mono>NHIS-9842-1276-5503</mono>` · sub `Card presented at ER · valid through Dec 2026 · IV artesunate covered` | 🔴 **N25·S1 card identity + N25·S4 status** (§4). The mono number is *"the most operationally important number on the page"* — copy-pasteable, no drill-down |
| line 5 `Parent` | `Mother — **A. Aidoo** <mono>+233 24 487 6612</mono>` · sub `Notified by phone 06:50 · 4 min · followed up SMS · last update 14:20` | guardian (BACKED, `is_primary`/`relationship`) + phone (**store full, mask at display** per the chronic-register rule) + notification meta → the *notified* sub-line is **INCR-26** (render only the derived parent identity at 25) |
| line 6 `Status` | `**Improving.** Fever down to 37.4°C at 14:00 reassessment. Doctor will reassess tomorrow morning before deciding discharge.` | **N23** latest update summary (or a `status_note` on N21) 🔴 **PII** |
| line 7 `Expected back` | `**Thu 15 May, afternoon** if morning reassessment is clear. Mrs Bediako will collect; school van on standby from 11:00.` | **N21** `expected_return_note` (free text — the surface never draws a bare date, always a conditional prose ETA) |
| `.ref-foot` | `Actions` · `Open case detail` (primary) · `Call hospital` · `Message parent` · `Mark returned` | `Open case detail` → §R2 route (BUILD); `Mark returned` → W2 (BUILD); `Call hospital`/`Message parent` → Y1 (OMIT at 25) |

**Card 2 — `.ref-card.returning` (K. Boateng)** — same seven lines, two label variants:

| Line | Exact copy | Binding note |
|---|---|---|
| header | `K. ` + `<em>Boateng</em>` · `F2 Aggrey House · **Business** · ID **SHS-2024-1133**` · pill `Returning` (warn) · day-pill `Discharged 15:10` | ⚠️ **seed drift, §5** — `SHS-2024-1133` is fabricated demo (not seeded) |
| `Diagnosis` | `**Mild wrist fracture** · right radius distal ` [`.severity` `Class A`] · sub `Sports field injury · football tackle Tue 11:40 · referred when matron suspected fracture` | N21 |
| `Hospital` | `**Asankrangwa Government Hospital**` · sub `Orthopaedic clinic · X-ray confirmed mild fracture · backslab cast applied 14:30` | N6 + N31 |
| `Transport` | [`School van`] `**Round trip arranged**` · sub `Ms Grace Antwi (asst matron) accompanied · van returning now` | `accompanied_by` = the assistant matron (a second `MATRON` pointer, R20) |
| `NHIS` | [`Active`] `<mono>NHIS-9842-2208-1144</mono>` · sub `Consultation + X-ray covered · cast materials **parent-supplied (GHS 80)**` | 🔴 **N25·S1** + the `parent-supplied (GHS 80)` = an **N24 cost line** with coverage `oop` — the referral's first out-of-pocket (feeds §05/billing at 27) |
| `Follow-up` | `Cast review at **Asankrangwa Govt** in **2 weeks (Wed 28 May)**. Matron to escort. Cast care leaflet given to dorm prefect for posting in Aggrey common room.` | **N28** follow-up task (INCR-26/28) — render as free text at 25, not a queued task |
| `ETA back` | `**15:45** — about 15 minutes. HM Mr Ofori notified to expect him at house. Excused from sports until follow-up.` | `expected_return_note`; `HM … notified` = Y3 (INCR-26); `Excused from sports` = a soft boarding link (not built) |
| `.ref-foot` | `Mark returned` (primary) · `Open case detail` · `Schedule follow-up` · `Print cast-care card` | `Print cast-care card` → **OMIT at 25** (no print artefact; and a cast-care card is harmless but no source doc exists) |

**The seven lines as the N21 shape:** `diagnosis_label` · `diagnosis_category` · `diagnosis_detail` · `hospital_id`(N6) · `hospital_ward`/`hospital_bed` · attending clinician text · `transport_mode` · `transport_note` · `accompanied_by_user_id` · `departed_at` · `arrived_at` · NHIS(N25) · `status_note` · `expected_return_note` · `returned_at` · `status`. **"Anything missing is a real gap"** → these are `NOT NULL` except the explicitly-conditional ones (`arrived_at`, `returned_at`, follow-up).

### R1.4 Cross-module strip — 3 xmod cards (the privacy design, verbatim)

The strip is *"honest — attendance gets the fact, HMs get the fact, billing gets the cost — none of them get the diagnosis."* **These cards are editorial narration of real writes; render the writes, not necessarily the cards.**

| Card | `.xm-lbl` | `.xm-title` | `.xm-body` | INCR-25 |
|---|---|---|---|---|
| 1 | `Cross-module · Attendance` | `Y. Aidoo ` + `<em>marked excused</em>` + ` for Wed, Thu` | `SCI class register and morning attendance auto-flagged. Teachers see **medical · excused** without seeing diagnosis. Marks back to normal when matron clears return.` | **Fact BUILDS (Y2)**; card OMIT — render a plain honest line. The `M` write extends the shipped hold predicate; the clear-return write is W2. |
| 2 | `Cross-module · Boarding` | `HMs ` + `<em>notified</em>` + ` · no medical detail` | `Mr Mensah (Slessor HM) and Mr Ofori (Aggrey HM) see "student under sickbay care, off-campus" on their dorm rosters. Diagnosis stays inside the sickbay module per privacy default.` | **OMIT the card (Y3).** The HM *notification* is INCR-26; the **off-campus fact** is INCR-25's and feeds the in-House formula revisit (R29/OQ5, §8). ⚠️ HM name drift — see §5. |
| 3 | `Cross-module · Billing` | `K. Boateng ` + `<em>GHS 80</em>` + ` cast cost` | `Cast materials parent-supplied charge already on his account. NHIS-covered items don't touch billing. Outstanding from Y. Aidoo: nothing — fully covered.` | **OMIT the card (Y4).** The cost line is stored (N24, `invoice_id` NULL); the billing write is INCR-27/D6. |

---

## §R2 — referral-log §02 · Case detail (Y. Aidoo · severe malaria)

**Surface lines 493–748.** Clinical-read gated (§1.3). The demo case is `R-2026-05-14-0817`.

### R2.1 Page head

| Element | Exact copy |
|---|---|
| Crumb | `Sickbay` *(link)* ` · ` `Referrals` *(link)* ` · Y. Aidoo · case ` + `<mono>R-2026-05-14-0817</mono>` |
| `<h1>` | `Y. Aidoo · ` + `<em>severe malaria.</em>` |
| Lede | `Inpatient at **Asankrangwa Government Hospital · Ward B bed 7**. Improving — fever 37.4°C at 14:00 reassessment, down from 38.9°C at admission. Doctor reassesses tomorrow morning before discharge.` — **derived** from N21 + latest N23 update 🔴 PII |
| Action 1 | `Print case` | **OMIT** (carries the full clinical record out of the room; §6/A6) |
| Action 2 | `Add update` | **BUILD** (W3 — appends an N23 hospital-update row) |
| Action 3 | `Call parent` | `.btn.primary` — the primary action *"used most during a phone call"*. **OMIT at 25 / restore at 26** (no comms chain) — or render as a `tel:` link with no logged send. Q for Kofi. |

### R2.2 Patient header

| Element | Exact copy (demo) | Binding | INCR-25 |
|---|---|---|---|
| `.patient-av` | `YA` | derived initials | BUILD |
| `.p-name` | `Yaa ` + `<em>Aidoo</em>` | `students` | BUILD |
| detail 1 | `**Form 3 Science**` | class + programme | BUILD |
| detail 2 | `**Slessor House** · dorm S-12` | house (BACKED); `dorm S-12` = **B1 NO CLEAN BINDING** (bunk has no dorm-label axis) | House BUILD · **dorm fragment OMIT** (B1, unchanged from the visit map) |
| detail 3 | `Age **17**` | derive from `date_of_birth` — render only when DOB present | BUILD |
| detail 4 | `**HM** Mr E. Akoto` | `houses.hm_user_id` derived — ⚠️ **HM drift, §5** (§01 xmod says *Mr Mensah* is Slessor HM; here *Mr E. Akoto*) | render the derived HM, ignore both demo names |
| `.dx-flag` | `Severe malaria · P. falciparum` | **N21** `diagnosis_label` + `diagnosis_category` | 🔴 **BUILD, clinical-read gated** — the diagnosis IS the record here (unlike the visit map, which OMITTED the chronic flag because that surface's reader set was wider). A1 adjacency (§6) is satisfied by the gate, not by omission. |
| `.nhis-flag` | `NHIS active` | **N25·S4** status | BUILD (D3) |
| `.id-flag` | `SHS-2023-0817 · NHIS-9842-1276-5503` | `student_code` + **N25·S1** card number | BUILD |

### R2.3 ER handoff at admission — `.handoff-grid` (14 rows, **N22 `referral_handoff`**)

Card head: `ER handoff ` + `<em>at admission</em>` · meta `07:02 · Matron → Dr K. Mensah` (derived: `arrived_at` + the transcribing matron + the receiving clinician text). **This is a frozen snapshot at referral time** — *"verbatim recall… determines whether the receiving doctor wastes time re-investigating."* Store it as its own row, not a live join (a later vitals/chronic edit must not rewrite history).

**Column `Presenting` (7 rows):**

| `.h-lbl` | `.h-val` (verbatim) | Field |
|---|---|---|
| `Complaint` | `Vomiting + fever since **04:00**` | `complaint` (free text) |
| `RDT` | `**Positive** · taken 06:20` | `rdt_result` + `rdt_at` — a categorised lab result (`POSITIVE`/`NEGATIVE`) 🔴 |
| `Temp` | `**38.9°C**` (`.alert` terra) `at sickbay arrival` | `temp` (the `.alert` = the same severity helper as the visit vitals table) |
| `BP` | `**98/62**` | `bp_systolic`/`bp_diastolic` |
| `Pulse` | `**112**` (`.alert`) | `pulse` |
| `SpO₂` | `**97%**` | `spo2` |
| `Hydration` | `Dry mucous · refused ORS · re-vomited at 06:35` | `hydration_note` |

**Column `Pre-referral care` (7 rows):**

| `.h-lbl` | `.h-val` (verbatim) | Field |
|---|---|---|
| `Given` | `**Paracetamol 1g** oral 06:25 · spat back at 06:35` | `pre_referral_meds` (free text; NOT a MAR row — this is the handoff narrative, INCR-24's MAR is the on-ward log) |
| `ORS` | `Started 06:22 · refused after 2 sips` | (same) |
| `Reason out` | `**Cannot retain oral meds.** Needs IV antimalarial. **Beyond N&MC scope for matron-only.**` | `reason_out` (free text, Y7 — the scope clause is prose, not a standing-order FK) |
| `Chronic` | `None on register · no known drug allergies` | **Y6** — live read of the chronic register at referral time, frozen into the snapshot |
| `Last meal` | `Last solid Tue dinner 19:30 (12h ago)` | `last_meal_note` |
| `Menses` | `Not currently · LMP 22 Apr` | 🔴 **Class-4 reproductive PII** — `menses_note`, nullable, rendered only for the relevant patient; Sarah adjacency A-item (§6) |
| `Travel` | `No · in school since term start 28 Apr` | `travel_note` |

**The `.vital-num.alert` colouring** reuses the visit map's `vitalSeverity()` pure function (temp `>37.5` warn / `≥38.5` elevated; pulse `>95` warn / `≥120` elevated). `38.9°C` and `112` land `.alert` (terra). One helper, shared with §02 hospital-updates and the visit vitals table.

### R2.4 Hospital updates — append-only external clinical log (**N23 `referral_update`**)

Card head: `Hospital ` + `<em>updates</em>` · meta `3 reassessments logged` (derive `{n} reassessments logged`; the surface shows 4 rows and says 3 — **counter drift, derive don't copy**). Four rows, verbatim:

| Time | Author + body (verbatim) | Field |
|---|---|---|
| `08:30` | `**Dr Mensah ward round.** IV artesunate 120mg started · IV fluids running · paracetamol IV 1g for fever. Re-RDT confirmed. Bloods sent — PCV pending.` | `author_name` `Dr Mensah` + `author_role` `ward round` + `body` |
| `11:00` | `**Nurse update.** Temp <mono warn>38.2°C</mono> · pulse <mono>98</mono> · tolerating sips of water. No more vomiting since 09:15. PCV 32% — mild anaemia, not transfusion threshold.` | external nurse; inline vitals coloured by the shared severity helper 🔴 lab PII (`PCV 32%`) |
| `14:00` | `**Dr Mensah ward round.** Temp <mono green>37.4°C</mono> · pulse <mono green>84</mono> · ate light porridge. Switched to oral artemether-lumefantrine. **Plan** · observe overnight · reassess 08:00 Thu · likely discharge afternoon if stable.` | (same) |
| `15:25` (**gold italic**) | `**Latest.** Mother visited briefly during afternoon hours. Brought soup. Yaa eating. Hospital nurse confirmed she will phone if anything changes overnight.` | the newest row renders `.ct-time`-style **gold italic** — a derived "latest" flag (`is_newest`), not stored |

- **Append-only** — no edit/delete; a correction is a second row (the R60 doctor-consult idiom). `recorded_by_user_id` = the matron who transcribed (Y8). The external author is **text, never an identity pointer** (R38).
- **Mode C:** hospital updates still render (a referral-only school's whole model is off-site care) — the author is whichever hospital reports back; the transcriber is the school's health focal person (a `MATRON`-role pointer, E1).

### R2.5 Parent comms thread — **OMITTED at INCR-25 (Y1 / boundary §0.2), INCR-26**

`.comms-thread`, 7 events (lines 622–698). Copy recorded verbatim for INCR-26 in §5.3. The card renders inbound/outbound/failed sends, tier tags, call durations, verbatim SMS bodies, and a **private matron `.ct-note`** — none has a write-chain until INCR-26, and the private note is *"a parent-boundary landmine"* (must never reach a parent). **Do not render a partial thread at 25.**

### R2.6 NHIS reconciliation · this case — `.nhis-block` (D3 shapes BUILD; itemised render DEFER to 27)

Card head: `NHIS ` + `<em>reconciliation</em>` + ` · this case` · meta `Card 9842-1276-5503 · valid Dec 2026`.
`.nhis-head`: `Itemised costs ` + `<em>· Day 1</em>` · **holder line `NHIS-9842-1276-5503 · A. Aidoo · Yaa Aidoo (minor)`** 🔴 **the card-holder ≠ student case — the card is the mother's; the student is a dependent minor** (D3 shape N25·S2, §4).

**8 itemised rows** (`.nhis-table` — INCR-27 render), each `Item` / `Provider` / `Coverage` (`.cov-pill.covered`) / `Out-of-pocket` (`—`):

`ER consultation` · `Malaria RDT confirmation` · `IV cannulation + fluids (3 bags Ringer's)` · `IV artesunate 120mg × 3 doses` · `IV paracetamol 1g` · `FBC + PCV bloods` · `Ward B bed (Day 1 night)` · `Take-home AL course (6 tablets)` — all `Asankrangwa Govt` provider, all `NHIS · covered`, all `—`. Footer: `**Total parent out-of-pocket**` / `<em>GHS 0.00</em>`.
Green note bar: `**Clean NHIS case.** All items covered. No billing module entry. If Day 2 charges arise tomorrow they'll append here; if anything falls outside NHIS, billing module gets a flag and parent gets an SMS before incurring the cost.`

- **At INCR-25 (D3 shape ruling):** BUILD `sickbay_nhis_card` identity (N25·S1) + holder-≠-student (N25·S2) + the per-line **coverage flag** shape (N25·S3, on N24 `referral_cost_line`). The §01 card's one-line NHIS summary is what the matron needs at ER.
- **DEFER to INCR-27:** the full 8-row itemised render + the `Total out-of-pocket` + the *"billing module gets a flag"* write (D6 — display-only, `invoice_id` NULL). 🔴 **The itemised-drug rows are a diagnosis leak** (`IV artesunate` ⇒ malaria) — render only to a clinical reader, never to the Bursar view (§6/A-leak).

---

## §T4 — today §04 · Active referrals out (companion build slice, INCR-25)

**Source: `schoolup-sickbay-today.html` §04** (mapped from the inventory §3.§04; the exact tokens live in the today file). INCR-25 renders **the projection**, not a second cast.

- **`today` §01 live-strip tile** `Active referrals` `{n}` — *sub `{shortname} · {status}`* — the visit map OMITTED this tile at INCR-22 (Y6, "live strip drops to 3 columns"); **INCR-25 reinstates it** and the strip returns to its fuller column count. Alert state when any referral is inpatient.
- **`today` §04 block** — a compact card per open referral (name · house · hospital · status · day/ETA), each linking to `/senior/sickbay/referrals/[ref]`. Actions `Open full referral log` → `/senior/sickbay/referrals`; `Log new referral` → W1.
- 🔴 **Cast reconciliation (Q20, resolved):** the today surface draws **D. Sarpong** (appendicitis, Wassa Akropong) — a cast **mutually exclusive** with the referral-log's **Y. Aidoo / K. Boateng**. The referral-log cast is richer and is the one every other surface must project. **today §04's D. Sarpong is demo drift and LOSES** — the built today §04 reads the same `sickbay_referral` rows as §R1.
- **Mode C:** on a Mode-C `today` page the queue/beds block is absent (INCR-22 R55); the active-referrals block is one of the **few** things that renders — it must read first-class, not as a leftover.

---

## §S4 — setup §04 · Referral hospitals (companion build slice, INCR-25 · **N6 `sickbay_hospital`**)

**Source: `schoolup-sickbay-setup.html` §04, lines 706–852** (carved out of the INCR-21 setup map to here). Route `/senior/sickbay/setup#hospitals`. Config gate `SICKBAY_CONFIG_WRITE_ROLES = [ADMIN, HEADMASTER]` — the **MATRON reads but cannot write** (R18). Renders in **all three modes** (Mode C needs hospitals most — every case routes to one).

Head: `Where serious cases go` · lede `When the sickbay can't, the hospital does · **Asankrangwa Government** is the primary referral; three more cover specialised cases and after-hours · NHIS acceptance tracked because **parent cost matters**` · action `+ Add hospital`.

Four hospital cards, verbatim (name / meta chips / tags):

| Hospital | Meta | Tags | Binding (N6) |
|---|---|---|---|
| `Asankrangwa Government Hospital` (gold, primary) | `4.2 km` · `OPD · in-patient · X-ray · pharmacy` · `Dr K. Mensah (visiting MO) here` · `24h emergency` | `Primary referral`, `NHIS accepted` | `name` · `distance_km` (**the notes name the field**) · `services` · `is_primary` · `accepts_nhis` · links to the visiting-doctor text on the staff row |
| `Wassa Akropong District Hospital` | `38 km` · `Higher capacity · 2 ambulances` · `For cases beyond Asankrangwa's scope` | `NHIS accepted`, `After-hours backup` | (same) |
| `St. Martin's Clinic · Asankrangwa` | `1.8 km` · `Private · faster waits` · `Some sickle-cell expertise` | `Private · cost`, `After-hours` | `accepts_nhis = false` (the `Private · cost` tag) |
| `Komfo Anokyé Teaching Hospital · Kumasi` | `198 km` · `Tertiary care · specialist referrals only` · `By onward referral from district` | `NHIS accepted` | tertiary; every referral row's `hospital_id` FK targets this table |

- **N6 shape:** `name` · `distance_km numeric` · `services text` · `notes text` · `is_primary boolean` (exactly one per school — the anchor idiom) · `accepts_nhis boolean` · `tags` (a small enum set or text) · `active`. **This table is the FK target for every referral row's `hospital_id`.**
- **Control `+ Add hospital`:** name (required) · distance (numeric, nullable) · services/notes (text) · primary (toggle, at most one) · accepts_nhis (toggle) · tags. Audit-logged config mutation.
- ⚠️ **`accepts_nhis` is the config half of the NHIS story** (D3 shape 4) — the referral's per-line coverage (N25·S3) is the operational half.

---

## §R3 / §R4 / §R5 — MAP-ONLY (INCR-26 / INCR-27)

Mapped 1:1 so the later increments port from a spec, not the raw HTML. **Not built at INCR-25.**

### §R3 · Today's parent notifications · timeline (lines 750–922) → **INCR-26**

- Head `Today's ` + `<em>notifications.</em>` · lede `The three-tier rule fired **seven times** today across two referrals, two admissions, and three discharges. Every event keyed off the setup-page policy anchor. One Tier 3 notification is due in 90 minutes (Y. Aidoo evening update).` · actions `Filter by tier` · `Export day` · `Send manual`.
- Stats strip (4): `Tier 1 today` `3 SMS` · `Tier 2 today` `1 call + SMS` · `Tier 3 today` `3 phone-first` · `Delivery rate` `85%` (`**1 fail** · retried successfully`). ⚠️ counter drift (meta `6 sent · 1 due`, lede `seven times`, Tier1=3 but 2 Tier-1 rows shown) — derive all counts.
- Filter strip: `All today 7` · `Tier 1 3` · `Tier 2 1` · `Tier 3 3` · `Failed 1` · `Due / queued 1`.
- Notify timeline (8 rows = 7 fired + 1 `.future`): each = time+ago / tier icon (1/2/3) / line (student · class · house · *event* · recipient+channel+duration) / tier pill. Notable rows: `09:45 J. Manu … Tier 1 because of pastoral cross-reference flag` (🔴 a pastoral flag *elevating* a tier — PII-by-proximity, §6); `17:00 future … Tier 3 inpatient day cadence 06:00, 11:00, 17:00, 21:00 · evening slot due` (a **per-case notification cadence** — distinct from the medication-round schedule; a scheduler the repo lacks, B9).
- Failure note (gold): `One delivery failed and was retried. Mother's first SMS at 06:52 came back as **undelivered** from **MTN** at 06:55 — network issue. Auto-retry at 07:02 succeeded…` + `View retry log`.
- **Bindings for 26:** `sickbay_notification` (authored in 0062) extended with channel/direction/tier/duration/answered-ack/**retry link**/**scheduled due-at**/entity link; delivery status/provider partially reuse `notification_log`. The three-tier policy rows come from setup §05 (INCR-26).

### §R4 · Referral history · last 30 days (lines 924–1162) → **INCR-27**

- Head `30-day ` + `<em>history.</em>` · lede `**Twelve referrals** in 30 days · ten closed · two still active. Malaria leads at **seven of twelve**… Two SCD crises, both Adwoa…` · actions `Export CSV` · `Export PDF` · `Term report`.
- Filter strip: Range `30 days 12` / `90 days 31` / `This term 27` / `This year 68`; Filter `Malaria 7` / `SCD 2` / `Injury 1` / `Asthma 1` / `Other 1` — **the diagnosis filter is proof `diagnosis_category` must be a categorised field** (N21), not free text.
- History table (7 cols · 12 rows): `Date` / `Student` (avatar+name+`F3 Slessor · SCI`) / `Diagnosis` (+sub) / `Hospital` (+`4.2 km · primary`) / `NHIS` (`Yes`/`Partial`/`Expired`) / `Status` / `Out-of-pocket`. Status vocab: `Inpatient · Day 1` · `Returning · today` · `Returned {date}` · `Returned same day` · `Outpatient · returned same day`. Cost-status vocab: `Covered` · `Parent due` · `Comfort items` · `ORS pack`. `tr.tier-N` left-border encodes the notification tier; `tr.active-row` = the two open rows.
- Two analysis cards: `Diagnosis mix · 30 days` (bars: Malaria 7 / SCD 2 / Asthma 1 / Injury 1 / Other 1 — *"the mix bar isn't analytics, it's a procurement instrument"* → reads INTO setup §3 stock) and `Hospital mix · 30 days` (Asankrangwa Govt 12 / others 0). 🔴 **inline-styled bars** (`width:58%` etc) — author as a real bar component; every colour is a token, the widths are derived.
- **Day-one empty state is mandatory** — the whole table + both bars are empty until referral history exists (§1.4 #12); never a fabricated 12/7/58%.

### §R5 · Outstanding reconciliation · three families (lines 1164–1329) → **INCR-27** (Bursar-owned)

- Head `Outstanding ` + `<em>reconciliation.</em>` · lede `Three families carry referral-related balances. **GHS 340.00 total.**… NHIS-covered items don't show here — only the gaps NHIS doesn't fill.` · actions `Open in billing` · `Print reminders` · `Send SMS reminder`.
- Recon strip (3): `Total outstanding` `GHS 340.00` · `NHIS-covered (30d)` `GHS 2,180.00` · `Average parent-cost` `GHS 28.33`.
- Outstanding list (3 rows): `J. Tetteh` GHS 215.00 *22 days · over 30d soon* (**NHIS card expired**) · `K. Boateng` GHS 80.00 *Today · within window* · `Adwoa Mensa` GHS 45.00 *6 days · within window*. 🔴 **each row prints the diagnosis** (`Malaria 22 Apr`, `SCD crisis 08 May`) to a **Bursar** — a non-clinical reader — this is the §6 A-leak: the reconciliation needs the cost + age + fact-of-referral, **not the diagnosis**. Trim it.
- **🚫 `NHIS card health across the school` card — DO-NOT-BUILD (§7).**
- `Cross-module handoff` card (`Sickbay → Billing → Comms`) — the three-step: billing line-item (`"sickbay referral"` tag) · Comms SMS at moment-of-incurring · this reconciliation surface. **All display-only at 27** (D6); the actual `invoice_line_item` write is a STOP-AND-ASK production financial write, parked like the boarding 3× penalty.

---

## 4. 🔴 NHIS element inventory — the D3 four shapes, decomposed as N-items (for Kofi + Wells)

Board **D3**: NHIS is IN, but the shape is a Kofi+Wells ruling at INCR-25, and it is **four shapes, not two columns**. Every NHIS element the referral surface renders, mapped to a shape. (Inventory §8 catalogues all 24 module-wide; the ~10 below are this surface's.)

| Shape | N-item | Where on THIS surface | What it needs |
|---|---|---|---|
| **Card identity** | **N25·S1** | §01 both cards line 4 (`NHIS-9842-1276-5503`, `NHIS-9842-2208-1144`); §02 `.id-flag` + `.nh-card` (`Card 9842-1276-5503 · valid Dec 2026`) | `card_number text` (formats differ across surfaces — `NHIS-9842-1276-5503` here vs `8005-4287-6611-09` on the chronic register; **store verbatim, no regex, no reformat**), `valid_from`/`valid_to date` |
| **Card holder ≠ student** | **N25·S2** | 🔴 §02 NHIS holder line `NHIS-9842-1276-5503 · A. Aidoo · Yaa Aidoo (minor)` — **the card is the mother's; Yaa is a dependent minor** | the card's natural home is the **household / guardian**, not the student — but the referral looks it up **per-student**. So: a `nhis_card` row keyed to a guardian/household + a per-student *resolution* (which card covers this student). **Kofi's modelling call.** A single column on `students` cannot express "my mother's card covers me". |
| **Per-line-item coverage** | **N25·S3** | §02 NHIS table 8 rows each `NHIS · covered` / `—`; §01 card 2 `cast materials parent-supplied (GHS 80)` | a `coverage` enum (`COVERED`/`PARTIAL`/`OOP`) + `out_of_pocket numeric` **on N24 `referral_cost_line`** (item · provider · coverage · amount · nullable billing link) |
| **Facility acceptance** | **N25·S4 / N6** | setup §04 tags `NHIS accepted` ×3, `Private · cost` ×1 | `accepts_nhis boolean` on `sickbay_hospital` (N6) |
| **Status (derived)** | (N25·S1 derived) | `.nhis-flag NHIS active`; §04 history NHIS column `Yes`/`Partial`/`Expired` | derived from `valid_to` vs today — never stored as a status string |

**🚫 DO-NOT-BUILD — the school-wide roll-up (§05, forbidden STPSHS matrix).** `NHIS card health across the school`: `Active cards 1,108 / 1,200` · `Expired this semester 52` · `Expiring next 30 days 31` · `No card on file 40` · `Coverage rate 92.3%`, labelled *"Synced from student records"*, plus the *"Bursar SMS campaign opens Monday · 83 students"* note. **Zero backing, and it is the canonical STPSHS-matrix fiction in this module** (board D3 explicit, inventory §1.4 #10). It becomes a real derivation **only** once N25 lands and the whole student body carries card identity — **not at INCR-25, and not by fabrication ever.** Omit the whole card (no shell, no badge). *(D3 direction "store it" stands; the roll-up is a later, real derivation — the WASSCE-STPSHS precedent.)*

**Owner/Kofi three-part decision (restated from inventory §1.1, unblocked by D3's "IN"):** (a) NHIS lives on the household/guardian (N25·S2 forces this — the mother's card); (b) in scope for INCR-25 as the referral's coverage story; (c) the **Bursar** owns the renewal-chase campaign (§05 implies it) → NHIS is a **billing field with a sickbay reader**, not a pure sickbay field. Wells authors the shape in 0062.

---

## 5. Seed-drift flags (Risk 9) — demo-only vs must-reconcile

| Item | Where on this surface | Seeded reality | Verdict for the INCR-25 build |
|---|---|---|---|
| **The two Aidoos** | §01 card 1 + §02 `Yaa Aidoo · SHS-2023-0817 · F3 Slessor Science · age 17 · ON_MEDICAL (implied)` | Seed has **`SHS-2023-0817 Yaa`** (FEMALE, `ON_MEDICAL`) — the **WASSCE** Aidoo — **and** `ASK-23-0007 Yaw` (MALE, DAY), a different student. The log prints `SHS-2023-0817`. | **MUST RECONCILE — and it is buildable.** The referral demo case = the real seeded `SHS-2023-0817`. ⚠️ **Confirm the 22b seed fix** (`db/seed/wassce.ts` — it gave `SHS-2023-*` rows a class so they can receive an attendance row) **also assigned Slessor house + boarding residency** so Y. Aidoo can (i) render `F3 Slessor` and (ii) receive the `MEDICAL` mark + the off-campus in-House treatment. If house/residency are still null, add them scoped to the `SHS-2023-0817` marker row only (the R53 seed-fix idiom). **This is the canonical cross-module demo case — it must be real by INCR-25.** |
| **K. Boateng** `SHS-2024-1133` | §01 card 2, §03/§04/§05 | Not seeded (fabricated). | **DEMO-ONLY.** At INCR-25 the second active card either renders empty-honest (one referral out) or is seeded as a companion demo row. Not a build blocker — the surface's second card is a demo convenience. |
| **Adwoa Mensa** (SCD anchor) | §03 (09:14 admission), §04 (history 08 May + 28 Apr, *"both Adwoa"*), §05 (GHS 45 outstanding) | Seed has **`Abena Mensah`**, not Adwoa Mensa. | **DEMO-ONLY at INCR-25** — Adwoa appears **only** in §03/§04/§05 (all INCR-26/27), never in §01/§02's active cast (Aidoo + Boateng). So INCR-25's built surfaces do not depend on her. Kofi/Lucy settle the rename-vs-seed before INCR-28 (Risk 9); recommend renaming the demo to the seeded **Abena Mensah** module-wide (one name, one student). |
| **Kufuor / Nkrumah houses** | §04 history (`F3 Kufuor`, `F1 Kufuor`, `F2 Nkrumah`) | Seeded houses: **Aggrey · Guggisberg · Fraser · Slessor · Kingsley · Aryee**. Kufuor/Nkrumah **not seeded**. | **DEMO-ONLY** — only in §04 (INCR-27), which has a mandatory day-one empty state, so no reconciliation needed at INCR-25. Flag for the 27 demo seed. |
| **HM name drift** | §01 xmod (*"Mr Mensah (Slessor HM)"*, *"Mr Ofori (Aggrey HM)"*) vs §02 header (*"HM Mr E. Akoto"* for Slessor) | HM derived from `houses.hm_user_id`. | **DEMO NOISE — two Slessor HMs on one surface.** Render the real derived HM; ignore both demo names. (Module-wide there are four different Slessor HMs across surfaces — the same derivation rule fixes all.) |
| **Student-code format** | `SHS-2023-0817`, `SHS-2024-1133` | `students.student_code` is free text. | **This surface settles on one format** (`SHS-{year}-{seq}`, matching the WASSCE seed) — unlike the cross-surface drift (4 formats). Store/render verbatim. |
| **Notification cadence `06:00/11:00/17:00/21:00`** | §03 future row | — | ⚠️ **NOT the medication-round schedule** (`06:30/12:30/21:00`, R13). This is a **per-case notification cadence** (INCR-26, B9). Do not conflate; do not seed it as a round. |

---

## 6. 🔴 PII-by-proximity spots (Risk 4) — where a diagnosis/condition sits beside a name or bed (for Sarah)

Every spot where clinical detail is adjacent to an identity. The referral surface's **own** rendering is clinical-read gated (§1.3), so within-surface adjacency is acceptable to a `[HEADMASTER, MATRON]` reader; the leaks Sarah must gate are the **cross-module projections** and the **Bursar view**. Ordered by severity.

| # | Adjacency | Where | Ruling |
|---|---|---|---|
| **A1** | diagnosis pill beside name + house + HM | §02 `.dx-flag Severe malaria · P. falciparum` next to `Yaa Aidoo · Slessor · Mr E. Akoto` | **ACCEPT within the gated surface** — the diagnosis IS the referral record; the reader is clinical. (Contrast the visit map, which OMITTED the chronic flag because that reader set was wider.) Sarah confirms the gate refuses ADMIN + HOUSEMASTER. |
| **A2** | student names beside "referred out" | §01 stat 1 trend `Y. Aidoo · K. Boateng`; §01 lede | **Count always; names only to a clinical reader, only at low n** (the visit-map "no names above one" ladder). Fact-of-referral is less private than diagnosis but still identifies who is off-campus. |
| **A3** | reproductive data beside name | §02 ER handoff `Menses · Not currently · LMP 22 Apr` | **Class-4 PII** — render only for the relevant patient, only to the clinical reader; never in any projection. |
| **A4** | drug-name → diagnosis leak in an itemised table | §02 NHIS 8 rows (`IV artesunate` ⇒ malaria); §05 `Malaria 22 Apr` / `SCD crisis` to the **Bursar** | 🔴 **The §05 Bursar leak is the sharp one** — the reconciliation must show cost + age + a generic `"sickbay referral"` tag, **not the diagnosis**. The §02 itemised drugs render only to the clinical reader (defer to 27, clinical-gated). |
| **A5** | pastoral flag *elevating* a notification tier | §03 `J. Manu … Tier 1 because of pastoral cross-reference flag` | **Class-6 inferable-by-proximity** (INCR-26) — a Tier-1 notification firing *because of* a pastoral flag re-identifies J. Manu as pastoral/MH-flagged. The tier must not expose *why* it fired to a non-clinical channel. |
| **A6** | any export/print carries the whole record out | §01 `Export`, §02 `Print case`, §04 `Export CSV/PDF`, §05 `Print reminders` | **OMIT the print/export affordances at 25** (the visit-map A6 / `Print day sheet` precedent) — a printed referral carries diagnosis, vitals, menses, NHIS numbers out of the room. |
| **A7** | the attendance note as an outbound leak | the `M` write → `attendance_record.note` (Basic tier) | **Write `null` or a fixed non-clinical string, never the diagnosis** (visit-map A7, binding). This is the module's only outbound leak path into the Basic tier. |
| **A8** | HM dorm roster "off-campus" | §01 xmod Boarding | HM sees *"student under sickbay care, off-campus"* — **name + fact, never condition** (the design, preserve verbatim). Interacts with the in-House formula (§8). |

**Deliberate non-disclosure copy — preserve VERBATIM (it is the product):** *"Teachers see **medical · excused** without seeing diagnosis"* · *"student under sickbay care, off-campus"* · *"**Diagnosis stays inside the sickbay module per privacy default.**"* · *"NHIS-covered items don't touch billing."* · *"the matron never sees billing."*

---

## 7. 🚫 DO-NOT-BUILD — the forbidden roll-up (restated, load-bearing)

The **`NHIS card health across the school`** card in §05 (`1,108 / 1,200` · `92.3%` · `52 expired` · `31 expiring` · `40 no card` · *"Synced from student records"* · *"Bursar SMS campaign · 83 students"*) is **this module's STPSHS matrix**. Board D3 names it explicitly: *"the school-wide card-health roll-up… is **this module's STPSHS matrix — DO NOT BUILD IT**."* It has **zero backing** until N25 covers the whole student body. **Omit the card entirely** — no shell, no `LIGHT·PLACEHOLDER` badge, no anchor target. When NHIS card identity lands school-wide (a later increment), it becomes a real derivation; never a fabrication. *(Same posture as the WASSCE STPSHS submission matrix — a genuine future increment gated on the underlying data, never faked.)*

---

## 8. Mode C (REFERRAL_ONLY) — the referral log is FIRST-CLASS, not degraded

Board **R4/R29**: Mode C disables beds/isolation/admissions/rounds/standing-orders/stock, but **KEEPS referrals, chronic register, parent notifications, health prefects, hospitals.** ~49% of public SHS are Mode C (Risk 7) — for them the **referral log is the primary operational sickbay surface**. The referral file never draws Mode C, so this is authored from the mode-card copy + R4/R29.

| Element | A/B (drawn) | **C · REFERRAL_ONLY** |
|---|---|---|
| §01/§02 referral record | as drawn | **renders identically — first-class.** A referral is a `sickbay_visit` with `disposition=REFERRED`; Mode C allows `REFER`/`DISCHARGE`, never `ADMIT` (R4). |
| §01 stats · "This week/semester" | as drawn | render (the referral history is the school's whole clinical footprint) |
| §02 ER handoff `Reason out · Beyond N&MC scope for matron-only` | matron scope | **AUTHORED re-express** — Mode C has no on-site matron scope to exceed; the referral is initiated by the SHEP health-focal person routing to the nearest hospital. Render `Routed to hospital · no on-site clinical capacity (referral-only school)` when `mode=REFERRAL_ONLY`, else the drawn clause. |
| §02 ER handoff vitals | on-site matron vitals | may be **sparse/prefect-recorded** in C (no matron on duty) — nullable, render only what was captured; never `—` for an untaken vital. |
| §02 hospital updates | as drawn | render (off-site care IS the model); transcriber = the health-focal `MATRON` pointer (E1). |
| §T4 today active-referrals | one block among queue/beds | **one of the FEW blocks on the Mode-C `today` page** (queue/beds absent) — must read first-class, not as a leftover of a hidden section. |
| §S4 setup hospitals | renders | **renders and matters most** — every case routes to a hospital; the primary/`accepts_nhis` config is the school's whole referral policy. |
| The `attendance-M` + off-campus writes | fire | fire (a referred Mode-C student is off-campus and medical-excused exactly as in A/B). |

**Quinn AC at INCR-25, not discovered at 27** (Risk 7): a Mode-C school with no beds must produce a complete, first-class referral end-to-end.

---

## 9. Interaction states & the referral lifecycle

### 9.1 The referral state machine (N21 `status`, mostly derived from timestamps — the R32 idiom)

`referred → inpatient (day N) → returning → returned` · plus `outpatient · returned same day`.

| State | Derivation | Renders |
|---|---|---|
| **referred / departed** | `departed_at` set, `returned_at` null, no inpatient marker | day pill `Day 0 · since {t}` |
| **inpatient** | admitted at the hospital (a hospital-update or an explicit `is_inpatient`), `returned_at` null | `.ref-card.inpatient` (terra), day pill `Day N · since {t}`, stat 1 `inpatient` |
| **returning** | hospital `discharged_at` set, `returned_at` null | `.ref-card.returning` (warn), day pill `Discharged {t}`, ETA line |
| **returned** | `returned_at` set → **closes the medical hold** (Y2 clear-return write) | §04 history `Returned {date}` |
| **outpatient · same day** | departed + returned same civil date | history `Outpatient · returned same day` |

- **No stored status enum that can disagree with its timestamps** (R10/R32) — `referralState()` is a pure function of `departed_at` / inpatient marker / hospital `discharged_at` / `returned_at`, unit-tested. A stored `status` column, if any, is a denormalised cache Kofi may reject.
- **`Mark returned` (W2)** writes `returned_at` and closes the hold; the `M` marks already written are **never reverted** (R51 — correction is the co-signed `attendance_correction` flow only).

### 9.2 Empty / loading / error states

| State | §01 active list | §02 case detail | §S4 hospitals |
|---|---|---|---|
| **Loading** | skeleton cards at real height (`.ref-card` ≈ its 7-line body height); stats skeletons | header + card skeletons | tile skeletons |
| **Empty** | **no open referrals → "No students out right now."** (`text-navy-3 italic`), stats still render (this week/semester counts), the strip is honest at `0`. Never a fake card. In Mode C this is the common resting state and must read calm, not broken. | n/a (a case detail is always for a real row; a bad ref → 404 via the route error boundary) | zero hospitals → the `+ Add hospital` CTA as the only body; **in Mode C this is the most important empty state to fill** (a referral-only school with no hospital list is unusable) |
| **Error (write)** | inline under the offending field; the card does not disappear; toast for action-level failures | same | field-level inline; a failed save reverts to stored |
| **Populated** | as mapped | as mapped | as mapped |
| **Disabled (read-only actor)** | HEADMASTER reads §01/§02, sees no write CTAs; MATRON reads §S4, no `+ Add hospital`; ADMIN is refused §01/§02 entirely (server-side, D2) | same | MATRON: inputs `readonly`, no `+ Add hospital` |

---

## 10. Data bindings — INCR-25 scope

### 10.1 BACKED (no migration)

| Element | Table / column |
|---|---|
| Student identity, code, sex, DOB(→age), programme, residency | `students` |
| Class label `F3 Science` | `classes` + programme short code (⚠️ the `PROGRAMME_ABBR.GENERAL_SCIENCE="GS"` vs surface `SCI` defect — fixed at INCR-22) |
| House `Slessor` / `Aggrey`, housemaster (derived) | `houses` incl. `hm_user_id` |
| Parent/guardian name, relationship, phone, primary | `student_guardian` |
| The parent referral record's parent | the referred `sickbay_visit` (disposition `REFERRED`, shipped 0057) |
| Attendance `MEDICAL` write + hold predicate | `lib/attendance/mark.ts` + `medicalHoldStudentIds()` (shipped 22b — **extend the open-referral arm, no caller change**) |
| Accompanying/transcribing staff (matron, asst matron) | `ref_user` + `role_assignment` (`MATRON`, both pointers R20); guarded by `holdsMatronRole`/`assertSchoolClinician` (app layer — `ref_user` is global) |
| Referral cost → billing target (INCR-27, display-only) | `invoice_line_item` + a `"Sickbay referral"` `fee_category` (`invoice_id` NULL at 4.4, D6) |
| Every mutation's audit row | `audit_log` via `lib/db/audit.ts` |

### 10.2 NEEDS SCHEMA — migration 0062 (N-items; referral-pass additions numbered from N31)

| N# | Shape | Fed by | Notes for Wells |
|---|---|---|---|
| **N6** | `sickbay_hospital` — name, `distance_km`, services, notes, `is_primary` (one/school), `accepts_nhis`, tags, active | §S4 | FK target for every referral. Deferred from 0056 to here. |
| **N21** | `sickbay_referral` — FK to `sickbay_visit`, `hospital_id`(N6), `diagnosis_label` + **`diagnosis_category`** (categorised — drives §04 filter + outbreak), `diagnosis_detail`, attending clinician text (R21/R38), `departed_at`, `arrived_at`, `expected_return_note`, `returned_at`, status (derived R32) | §01, §04, §T4 | Intra-tenant composite FK `(school_id, visit_id)`. `diagnosis_category` is the categorised field the mix-bar + outbreak both need. |
| **N22** | `referral_handoff` — frozen ER snapshot: complaint, RDT result+at, temp/BP/pulse/SpO₂, hydration, pre-referral meds, ORS, reason_out, **frozen `chronic_note`** (Y6), last_meal, `menses_note`(Class-4), travel; `recorded_by_user_id` | §02 handoff | One per referral. Snapshot, not a live join. |
| **N23** | `referral_update` — append-only external clinical updates: `at`, `author_name`+`author_role` (text, R38), `body`, `recorded_by_user_id`, `is_newest`(derived) | §02 updates, §01 status | No edit/delete; correction = new row. |
| **N24** | `referral_cost_line` — item, provider, **coverage enum** (`COVERED`/`PARTIAL`/`OOP`), `out_of_pocket numeric`, nullable `invoice_line_item_id` | §02 NHIS table (27), §05 (27) | The NHIS per-line coverage lives here (N25·S3). Billing link stays NULL at 4.4 (D6). |
| **N25·S1–S4** | NHIS: **S1** card identity (`card_number` verbatim, `valid_from`/`valid_to`) · **S2** holder≠student (card on household/guardian + per-student resolution) · **S3** per-line coverage (on N24) · **S4** facility `accepts_nhis` (on N6). Status derived. | §01/§02, §S4 | 🔴 **Kofi+Wells modelling ruling** (D3). S2 forces household/guardian home, not `students`. Bursar-owned renewal (billing field, sickbay reader). |
| **N31** | referral logistics — `transport_mode` (categorised: van/pickup/parent/ambulance) + `transport_note`, `accompanied_by_user_id`, `hospital_ward`/`hospital_bed` (text) | §01 lines 2–3, §02 lede | The "seven-line pattern" logistics half. |
| **N32** | HM referral-authorisation (the today-surface note: *"matron leaving site mid-shift requires Headmaster authorisation"*) — nullable `authorised_by_user_id` + `authorised_at` | today §04 note | A co-sign field on N21, not decoration. Confirm with Kofi whether it is required for an off-site referral. |
| **N26 / `sickbay_notification`** | authored in 0062, **built at INCR-26** — channel/direction/tier/duration/answered-ack/**retry link**/**scheduled due-at**/entity link/**private matron note** | §R2 thread, §R3, §01 parent line | Reuse-vs-extend `notification_log` (B9 — the repo has no scheduler). Not built at 25. |
| **N28** | follow-up task (visit/referral, when, owner, text, done) | §01 K.Boateng `Follow-up`, §02 | Free text at 25; a real task list at 26/28. |

### 10.3 NO CLEAN BINDING (B-items)

| # | Element | Resolution at INCR-25 |
|---|---|---|
| **B1** | `dorm S-12` (§02 header) | `boarding_bunk` has no dorm-label axis → **OMIT the dorm fragment** (unchanged from the visit map). |
| **B4** | visiting doctor / hospital clinician as actor | **recorded external actor** — name+role text on N22/N23, transcriber = matron (R21/R38). No `ref_user`. |
| **B9** | scheduled/future notifications, per-case cadence (`Due 17:00`) | no scheduler in the stack → **INCR-26**; not built at 25. |
| **B14** | Mode-C degradation | authored in §8; referrals are first-class in C (R4/R29). |

---

## 11. Write actions (INCR-25 scope)

| # | Action | Surface | State transition | Build |
|---|---|---|---|---|
| **W1** | `+ New referral` / `Log new referral` | §01, §T4 | creates a `sickbay_referral` off a `REFERRED` visit disposition (or promotes an open visit to `REFERRED` — R36: at 22 disposition is immutable, so a referral is a *disposition choice at dispose-time*, or an escalation event; confirm with Kofi) → writes `departed_at`, opens the medical hold | **BUILD** — `[MATRON]` |
| **W2** | `Mark returned` | §01 both cards | `returned_at` set → status `returned` → **closes the medical hold** (clear-return) | **BUILD** — `[MATRON]` |
| **W3** | `Add update` | §02 | appends an N23 `referral_update` row (external author text + transcriber) | **BUILD** — `[MATRON]` |
| **W4** | `+ Add hospital` (+ edit) | §S4 | inserts/updates `sickbay_hospital` (N6) | **BUILD** — `[ADMIN, HEADMASTER]` (config write; MATRON read-only) |
| **W5** | `Schedule follow-up` | §01 | N28 task | **DEFER 26** (render free text at 25) |
| **W6** | `Message parent` / `Call parent` / `Call hospital` | §01/§02 | a logged send | **OMIT 25** (no comms chain, Y1) — or a `tel:` link with no logged send |
| **W7** | `Filter` / `Export` / `Print case` / `Print cast-care card` | §01/§02 | reads/exports | **OMIT the print/export** (A6, §6); `Filter` optional |

All writes: `audit_log` with before/after **snapshots** (not patches — the INCR-21 Dex D2 lesson); `authorizeWrite()` as the first statement; no IDOR (referral id re-resolved server-side inside `withSchool`).

---

## 12. Cross-module hooks (design commitments, preserve exactly)

- **Sickbay → Attendance (the "M" hook, extended):** a `REFERRED` disposition puts the student under an **open medical hold**; the shared writer `lib/attendance/mark.ts` coerces `MEDICAL` on the referral days via the **open-referral arm** of `medicalHoldStudentIds()` — *no new caller, no scheduler* (R48). `reason_code='SICKBAY'`, **note carries no diagnosis** (A7). `Mark returned` closes the hold; the marks are never reverted (R51). *"Teachers see medical · excused without seeing diagnosis · Marks back to normal when matron clears return."*
- **Sickbay → Boarding (off-campus, the R29 split):** a **referred-out** student IS off-campus and **IS** subtracted from the boarding in-House count — unlike a sickbay *admission* (on-site, OQ5 says NOT subtracted). INCR-25 exposes the off-campus fact; the in-House formula revisit is **INCR-28** (Risk 5). HM sees *"under sickbay care, off-campus"* — name + fact, never condition.
- **Sickbay → Billing (the cost hook, D6-parked):** a referral out-of-pocket writes an N24 `referral_cost_line` (coverage flag + amount); the `invoice_line_item` write with the `"Sickbay referral"` fee-category tag is **display-only at 4.4** (`invoice_id` NULL) — the actual financial write is a STOP-AND-ASK (INCR-27, D6). *"The matron does not chase money… sickbay creates the cost; billing carries it."*
- **Sickbay → Comms (the tier engine, INCR-26):** every parent notification keys off the setup §05 three-tier policy; the referral is the Tier-3 trigger. Authored (0062), built at 26. Scheduled per-case cadence + retry/failure are new (B9).
- **Setup → Referral (config FK):** every referral's `hospital_id` targets `sickbay_hospital` (N6); `accepts_nhis` is the config half of the coverage story.
- **Chronic register → Referral (live read):** the ER handoff `Chronic` line reads the chronic register at referral time (Y6, shipped 23), frozen into the N22 snapshot.
- **Referral history → Setup stock (procurement, INCR-27):** the §04 diagnosis-mix bar reads INTO the setup §3 stock page — *"the mix bar isn't analytics, it's a procurement instrument"* (7 malaria cases → AL/RDT reorder).
- **Referral → WASSCE (SC-12, INCR-27/28):** an inpatient referral during an exam window is the SC-12 special-consideration case; the auto-suggest is app-layer, never a trigger (INCR-28, Q18).

---

## 13. Responsive / PWA

The surface's one media query is `@media (max-width:1280px)` (lines 317–327): `.layout`, `.col-2`, `.referral-grid`, `.handoff-grid`, `.recon-strip`, `.stats-strip`(→2-up), `.xmod-strip`, `.patient-header` all collapse to single column, and `.patient-flags` flips from `flex-col items-end` to `flex-row items-start`. Reproduce as Tailwind `lg:` breakpoints (the app's container is narrower than the 1480px design canvas — the `.layout`/`.notes` split is design-doc chrome, not built). The referral cards and the case-detail two-column grid are the load-bearing responsive collapses; on mobile the matron reads one referral card at a time (the surface is used bedside/on-the-phone — the `Call parent`/NHIS-number moments must survive a phone width). No PWA-specific variant is drawn; the module inherits the app shell's PWA behaviour.
