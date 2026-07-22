# Sickbay — The Chronic Register · Surface Map (INCR-23 · Module 4.4)

**Author:** Lucy (design cartographer) · **Status:** build-ready design spec for the implementation engineer (Claude Code).
**Increment:** INCR-23 — *care plans · medication schedules by round · escalation protocols · the dorm-side artefact · **per-staff access grants + the read-audit trail***. **Migration 0058** (the module's third RLS boundary — Risk 1, the most novel technical work in 4.4).
**Source surface:** `Surfaces/schoolup-sickbay-chronic-register.html` — **all four sections in scope** (§01 lines 332–519 · §02 521–822 · §03 824–976 · §04 978–1253).
**Companions:** `docs/senior/sickbay-surface-inventory.md` §5 (module breadth) · `sickbay-setup-surface-map.md` (INCR-21, shipped) · `sickbay-visit-surface-map.md` (22a/22b, shipped) · `sickbay-today-surface-map.md` (22c, shipped — **its rulings are settled and are NOT re-litigated here**).
**Board:** `docs/senior-build-plan.md` L2369–2417 (module plan, D1–D9, Risks 1–10) · L2418–2457 (R1–R31) · L2462–2486 (R32–R67) · L2506–2537 (R68–R90 + **Sarah's six items carried to 23**, L2535).
**Shipped code this map binds to:** `db/schema/sickbay.ts` (0056 + 0057) · `db/schema/students.ts::studentHealthRecords` (0036) · `lib/sickbay/{config,defaults,visits,vitals,visit-copy,visit-reads,board-reads,board-copy,medical-hold}.ts` · `lib/access.ts::SICKBAY_{ROLES,CONFIG_WRITE_ROLES,CLINICAL_READ_ROLES,CLINICAL_WRITE_ROLES}` · `lib/db/audit.ts::recordAudit` + `db/schema/audit.ts::auditLog`.

---

## 0. Scope, boundary, and the two structural blockers

### 0.1 In scope — all four sections

| § | Title (verbatim) | Lines | Route the surface draws |
|---|---|---|---|
| **§01** | `Active register · six students` | 332–519 | `app.omnischools.gh/sickbay/chronic-register` |
| **§02** | `Care plan · Adwoa Mensa · sickle cell` | 521–822 | `…/chronic-register/AS-2024-F1-0089` |
| **§03** | `Pastoral · referral-managed · J. Manu` | 824–976 | `…/chronic-register/AS-2023-F2-0091` |
| **§04** | `Access grants & the audit trail` | 978–1253 | `…/chronic-register/access-grants` |

**§02 and §03 are the SAME route** — one care-plan detail page, two condition families. §03 is not a separate surface; it is what the detail page looks like when `condition = MENTAL_HEALTH`. Build one route with a conditional block, never two routes (a `/pastoral/` URL segment is itself a disclosure — §10/M10).

### 0.2 🔴 Two blockers that must clear BEFORE 0058 is authored

| # | Blocker | Why it blocks 23 specifically |
|---|---|---|
| **BL1** | **`resetScheduleSlots` is a hard DELETE that changes every slot id** (`lib/actions/sickbay-config.ts`; recorded at INCR-21 as an *INCR-24* obligation, board L2453a). | `care_plan_medication` carries a composite `(school_id, slot_id)` FK to `sickbay_schedule_slot_tenant_uk` — **that FK lands at 0058, one migration EARLIER than the board assumed.** Today a headmaster clicking "Reset to defaults" on setup would cascade away every chronic medication schedule in the school. The obligation is **promoted from 24 to a 23 prerequisite**: `resetScheduleSlots` must become a reconcile/update-in-place before 0058 ships. |
| **BL2** | **A shipped page already renders the data the register calls admin-private.** `app/(app)/students/[id]/page.tsx:237–267` selects `studentHealthRecords` and renders `Blood group · Allergies · Conditions · Medications · Emergency contact · Notes` behind **`requireSchool()` alone** (line 61) — i.e. **every authenticated staff member of the school**, including HOUSEMASTER, TEACHER, ACCOUNTANT. | The register's own privacy banner promises *"visible to Matron, Headmaster… Housemasters and class teachers see only what the matron explicitly grants."* Shipping that sentence beside an unchanged student profile makes the product's most load-bearing non-disclosure copy **false on delivery**. Either (a) gate that block on the student profile to `SICKBAY_CLINICAL_READ_ROLES` (recommended — it is a one-condition change, and the register is where that content now lives), or (b) the banner copy must be re-authored. **Not Lucy's to fix; it is a build blocker for the banner.** |

### 0.3 Out of scope — map the boundary, do not detail

| Element on this surface | Owner | Boundary rule at 23 |
|---|---|---|
| **NHIS & billing card** (§02, lines 746–775) + **`NHIS coverage 5 of 6` tile** (§01) + `NHIS · active` patient flag | **INCR-25** | D3 says *store NHIS*, but ⚠️ the **modelling is explicitly a Kofi+Wells ruling at INCR-25** (board L2381): four shapes are needed and the card-holder is often the mother, not the student. **Omit every NHIS element — no card, no tile, no flag, no `—`.** The `YTD school cost` row additionally implies a per-plan cost ledger and a sickbay→billing write, which **D6 blocks**. |
| **Boarding · HM alert** xmod card (`admission SMS within 5min`) | **INCR-26** | No `sickbay_notification` row exists. Rendering "within 5min" asserts a message nothing sends (Z4 precedent). |
| **Communications · parent SMS** xmod card (three-tier rule) | **INCR-26** | same |
| **`Open VLC case`** action + `VLC Case 2024-VLC-0047` + `Pastoral home` VLC fields (§03) | **VLC — unbuilt, no increment** | A dead link is worse than an absent one. **Omit the action.** The *pastoral home* free text survives as plan content (a counsellor's name and cadence are facts the matron records), but it never renders as a link and never claims a case id format. |
| **Medication ADMINISTRATION** (did she take it?) — anywhere | **INCR-24** | 0058 authors the *schedule*, never the *event*. No "given/missed", no MAR, no round task list. The med grid is a prescription, not a log. |
| `Print dorm copy` / `Export PDF` / `Export grant log` / `Export 30-day log` | see §14 | Three of the four are omitted; the dorm card ships as an on-screen artefact + a print-stylesheet route (§5.6). |

---

## 1. Routes, chrome, navigation

### 1.1 Three routes

| Route | Section | Reader gate | Writer gate |
|---|---|---|---|
| `/senior/sickbay/chronic-register` | §01 list | `SICKBAY_CLINICAL_READ_ROLES` (`HEADMASTER`, `MATRON`) — **rows filtered per reader**, see §4.4 | `MATRON` (`+ Add student`) |
| `/senior/sickbay/chronic-register/[studentId]` | §02 / §03 detail | `MATRON` ∪ `HEADMASTER` (minus `MENTAL_HEALTH`, R42) ∪ **grant holders** | `MATRON` |
| `/senior/sickbay/chronic-register/access-grants` | §04 | `MATRON` ∪ `HEADMASTER` | `MATRON` |

**Route key is `studentId` (uuid), NOT `student_code`.** The surface draws `AS-2024-F1-0089`; `students.student_code` is free text with no format guarantee and four contradictory formats across the module (F2). A code in a URL is also a guessable cross-reference handle. Use the uuid, exactly as `visits/[visitId]` does.

`export const dynamic = "force-dynamic"` on all three — grant expiry is evaluated **server-side per request and never cached** (Sarah's carried item 5).

### 1.2 🔴 The module gate must be decided, not discovered (Sarah's carried item 1)

`requireSchoolRole(SICKBAY_ROLES)` refuses `HOUSEMASTER` **before any reader runs**. A grant cannot help someone the route rejects. Two options, and this is a Kofi ruling:

| Option | Consequence |
|---|---|
| **A · widen the module gate** to include `HOUSEMASTER` (and any staff role that can hold a grant) on the *detail route only* | The reader's grant check becomes the **only** boundary. Everything then rests on the SQL `EXISTS` (§7.6). Simplest routing; highest blast radius if the reader is ever wrong. |
| **B · author a separate route/gate** for grant holders | Two doors into one artefact; the second door has to re-implement the scope projection. Rejected — two implementations of a disclosure boundary is how they diverge. |

**Recommend A**, with the detail page's gate expressed as *"holds a clinical read role **or** has a live grant for this student"*, evaluated as the literal first statement, before any query is issued (R81's shape — it preserves the ADMIN-zero-SQL property that made Quinn's Z2 strong).

⚠️ **ADMIN is not a reader here either.** D2 is explicit: *"admin-private" means school leadership, NOT this codebase's `ADMIN`*. ADMIN gets `<ClinicalRestricted crumb="Chronic register" />` on all three routes, and **the fetch never happens**.

### 1.3 Nav

Sidebar `Sickbay` currently points at `/senior/sickbay/today` (22c). **Row count stays at one, nav stays flat** — the surface's five sub-items are demo chrome; the module is still well under the twelve-item sectioning threshold. The register is reached from:
- the board's page head — **add one secondary link `Chronic register`** beside the existing `Setup` link;
- the visit record's patient header — see §16/Q3 (the `Care plan →` link, and what it may show).

Crumbs: `Sickbay · Chronic register` (list) → `Sickbay · Chronic register · {Student}` (detail) → `Sickbay · Chronic register · Access grants`. `Sickbay` links to `/senior/sickbay/today` (the module's operational root, per 22c's convention), `Chronic register` links to the list.

### 1.4 Design-doc chrome — do NOT build

| Do NOT build | Lines |
|---|---|
| `.page-header` (`MVP2 · Sickbay · surface 4 of 5`, h1 `The chronic *register.*`, gold rule, the *"Six students at Asankrangwa SHS…"* paragraph) | 325–330 |
| `.section-head` ×4 (`01 Active register · six students / Matron + Head · admin-private`; `02 Care plan · Adwoa Mensa · sickle cell / Matron view · full plan`; `03 Pastoral · referral-managed · J. Manu / Mental health as Ghana actually treats it`; `04 Access grants & the audit trail / Privacy by default · accountability by design`) | 334–338, 523–527, 826–830, 980–984 |
| `.notes` right rails (5 bullets ×4 = 20 items) | 508–517, 811–820, 965–974, 1241–1251 |
| `.desktop` / `.browser-bar` / `.url` / `box-shadow:0 24px 60px -20px rgba(26,43,71,0.25)` | per section |
| `.sidebar` demo nav (10 items + 5 subs), `min-height` 1280/1640/1900, footer `A. Bediako · Matron · N&MC reg.`, `powered-by` | per section |

The `.notes` are **intent documentation** — port their rules, render none of their text. Six bind this build and are quoted where they land: *"Care plans, not diagnoses"* (§3.2), *"Status separates from condition"* (§3.4), *"HM grants are role-based, not personal"* (§7.4), *"Three scope levels"* (§7.3), *"HMs aren't clinicians and shouldn't have full medical detail"* (§5.6), *"Append-only is real"* (§7.8).

### 1.5 Page container

`<div className="mx-auto max-w-page px-6 pb-16 pt-6 md:px-9">` — the shipped sickbay page idiom. The surface's `.page-head` and `.body` paddings are app-frame chrome the shell already provides.

---

## 2. Tokens, type, bespoke values

### 2.1 `:root` → Tailwind (identical hexes to `md files/design-tokens.json`)

| Surface var | Hex | Tailwind | Used in scope for |
|---|---|---|---|
| `--navy` | `#1A2B47` | `text-navy` / `bg-navy` | body text, `.s-name`, `.pr-val b`, `.ms-cell.dose`, `.ep-h`, `.ac-v b`, `.av-meta b`, `.at-event b`, privacy-banner gradient start |
| `--navy-2` | `#2D3F5C` | `text-navy-2` / `bg-navy-2` | `.pr-val`, `.ep-d`, `.ac-v`, `.at-event`, `.ph-v`, **`.condition-pill.mental`** (see 2.4), privacy-banner gradient end |
| `--navy-3` | `#5C6675` | `text-navy-3` | crumb, lede, `.pr-lbl`, `.ch-meta`, `.s-class`, `.med-sub`, `.ac-l`, `.reason`, `.role`, `.at-tag`, `.ac-foot` |
| `--gold` | `#C8975B` | `text-gold` / `bg-gold` / `border-gold` | every italic `<em>`, `.pb-lock` fill, `.condition-pill.allergy`, `.scope-pill.full`, `.at-tag.create`, `.artefact-card` dashed border, `.save-bar` border, `.pastoral-block` bar, `.action-btn.active` |
| `--gold-soft` | `#E8D4B8` | `bg-gold-soft` / `border-gold-soft` | `.s-av` default fill, `.g-av` default fill, `.av-mini` default fill, `.pb-sub` text, `.id-flag`, `.at-tag.grant` border |
| `--gold-bg` | `#F5EBDC` | `bg-gold-bg` | `.ms-cell.dose.prn`, `.at-tag.update`, `.save-bar` gradient start |
| `--bg` | `#FAF7F2` | `bg-bg` | page ground, `th` ground, `.ms-cell.head`, `.scope-pill` ground, `.at-tag` ground, `.pb-handoff` ground |
| `--surface` | `#FFFFFF` | `bg-surface` | every card, table, `.artefact-card`, `.g-av` ring |
| `--green` | `#2F6B47` | `text-green` | `.status-pill.stable`, `.signal.ok`, `.expiry.never`, `.at-tag.grant`, `.av-mini.green` |
| `--green-bg` | `#E5EFE8` | `bg-green-bg` | those same fills |
| `--terra` | `#B84A39` | `text-terra` / `bg-terra` / `border-terra` | `.condition-pill.scd`, `.chronic-flag`, `.protocol-block` border + `.ep-title` + `.ep-num`, `.ungrant-btn` text, `.signal`, `tr.crisis` left border |
| `--terra-bg` | `#F5E1DC` | `bg-terra-bg` | `.status-pill.crisis`, `.s-av.terra`, `tr.crisis` gradient start, `.protocol-block` gradient start |
| `--warn` | `#C58A2E` | `text-warn` / `bg-warn` / `border-warn` | `.condition-pill.asthma`, `.status-pill.monitor`, `.scope-pill.partial`, `tr.monitor` left border |
| `--warn-bg` | `#F5E9D0` | `bg-warn-bg` | those same fills |
| `--border` | `#E5DFD3` | `border-border` | card borders, every row divider |
| `--border-2` | `#D4CCBA` | `border-border-2` | `.btn`, `.filter-pill`, `.action-btn`, `th` bottom, dashed panels |

**Type:** `font-display` = Fraunces (h1, `.ch-title`, `.s-name`, `.ep-title`, `.ep-h`, `.ac-title`, `.pb-title`, `.xm-t`, `.ms-cell.drug b`, `.sb-t`, tile values, avatars) · default = Manrope · `font-mono` = JetBrains Mono (`.mono` student codes, `.ms-cell.dose`, `.ms-cell.head.time`, `.lastvisit`, `.mono-i` phone numbers, `.expiry`, `.at-time`, `.ac-v.tel`, `.pr-val.mono-i`).

### 2.2 🔴 Bespoke / raw-hex values — flag list

| Value | Where | Ruling |
|---|---|---|
| **`#7B4A8A`** (purple) | `.condition-pill.epilepsy` (line 128) | 🔴 **BESPOKE — not in `design-tokens.json`.** Two options: add `--condition-epilepsy` as a named token in `tailwind.config.ts`, or drop the sixth colour and render epilepsy on `--navy-2`. **Recommend: add the token** — the notes justify the palette (*"Condition pills follow severity colour"*) and a colour that only exists inside one component is how a palette rots. Do NOT inline the hex in a `className`. |
| **`#3E7B6B`** (green-blue) | `.condition-pill.diabetes` (line 131) | 🔴 **BESPOKE — same ruling**, `--condition-diabetes`. ⚠️ It is *close to but not* `--green #2F6B47`; using `--green` instead would collide with the `Stable` status pill sitting one column away. |
| `rgba(200,151,91,0.18)` / `(0.2)` | `.filter-pill .ct` count bubble | solid-ise: `bg-gold-bg text-gold` (active variant `bg-gold-bg text-gold-soft` reads wrong on navy → use `bg-navy-2 text-gold-soft`). |
| `rgba(45,63,92,0.12)` / `(0.1)` / `(0.08)` / `(0.06)` | `.s-av.navy`, `.status-pill.referral`, `.scope-pill.referral-only`, `.at-tag.view`, `.xm-ic.navy` | **five different alphas of the same navy for the same visual job.** Collapse to ONE dedicated tint token `--navy-bg` (recommend `#E9EBEF`, the 12 % mix on `--bg`) and use it for all five. |
| `rgba(184,74,57,0.25)` | `.ep-step` dashed divider | `border-terra-bg` (solid) — visually identical on the block's gradient. |
| `rgba(245,225,220,0.3)` / `(0.2)` | `tr.crisis` + `.protocol-block` gradient ends | gradient ends only; reproduce as `…var(--terra-bg)_0%,var(--surface)_100%` — a fade to surface, no alpha. |
| `rgba(245,233,208,0.25)` | `tr.monitor` row ground | **solid-ise to a new `--warn-bg-soft`** or use `bg-warn-bg` at `opacity-…` on a wrapper — see the trap below. |
| `linear-gradient(135deg, var(--navy) 0%, var(--navy-2) 100%)` | `.privacy-banner`, `.patient-header` | arbitrary-value idiom: `bg-[linear-gradient(135deg,var(--navy)_0%,var(--navy-2)_100%)]` — already shipped in `visit-record-console.tsx`. |
| `linear-gradient(180deg, var(--gold) 0%, var(--gold-soft) 100%)` | `.pastoral-block::before` 4px bar | same idiom |

> 🔴 **THE TOKEN-OPACITY TRAP.** Every value in the `rgba()` rows above is a place a naive port writes `bg-navy/10`, `bg-warn-bg/25`, `text-gold/18`. **These are raw hex behind CSS variables: Tailwind slash-opacity compiles to `rgb(var(--x) / a)` against a channel triplet that does not exist, the rule silently renders NOTHING, and `next build` still passes.** Use a solid token, a dedicated `-bg` tint, or `opacity-N` on the element. **Verify in the live preview, not the build** (repo memory `no-alpha-token-opacity`). This surface has **eleven** such sites — more than any sickbay surface so far — because it is the first to use tinted table rows.

### 2.3 Bespoke values — reproduce exactly

| Element | Value |
|---|---|
| `.privacy-banner` | `grid grid-cols-[auto_1fr_auto] gap-[18px] items-center rounded-xl p-[18px_22px] mb-6 text-bg` + the 135° gradient; `::before` decorative circle **drop it** (a `rgba(200,151,91,0.06)` blob that no token expresses and nobody will miss) |
| `.pb-lock` | `size-[42px] rounded-[10px] bg-gold text-navy grid place-items-center font-display font-bold text-[18px]`; glyph `⚿` — **keep the glyph** (it is a Unicode character, not an emoji, and the brand rule bans emoji not typography) |
| `.pb-title` / `.pb-sub` | `font-display text-[16px] font-medium mb-[3px]`, `<em>` italic gold 400 · `text-[11px] text-gold-soft leading-[1.5]`, `<b>` → `text-bg font-semibold` |
| `.filter-pill` / `.active` / `.ct` | `rounded-full border border-border-2 bg-surface px-3 py-[6px] text-[11px] font-semibold text-navy-2` · `bg-navy text-bg border-navy` · `ml-[5px] rounded-full px-[6px] py-px font-mono text-[10px]` |
| `.register-table` | `w-full border-collapse bg-surface border border-border rounded-xl overflow-hidden`; `th` `bg-bg p-[11px_14px] text-[9px] tracking-[0.14em] uppercase font-bold text-navy-3 text-left border-b border-border-2`; `td` `p-[14px] text-[12px] border-b border-border align-middle` |
| `tr.crisis` / `.monitor` / `.stable` / `.referral` | left border `3px` solid `terra` / `warn` / `green` / `navy-3` on `td:first-child` with `pl-[11px]`; row tint per 2.2 |
| `.s-av` | `size-[34px] rounded-full grid place-items-center font-display font-semibold text-[12px]` + variant fills |
| `.condition-pill` / `.status-pill` | `inline-block rounded-full px-[10px] py-1 text-[10px] tracking-[0.04em] uppercase font-bold` · same at `px-[9px] py-[3px]` |
| `.plan-row` | `grid grid-cols-[160px_1fr] gap-[18px] items-start py-3 border-b border-border`, `:last-child` none; `.pr-lbl` `text-[10px] tracking-[0.14em] uppercase font-bold text-navy-3 pt-[2px]`; `.pr-val` `text-[13px] text-navy-2 leading-[1.55]`, `<b>` navy 600, `<em>` **gold, not italic** (`font-style:normal`) |
| `.pr-val ul li` | `py-1 pl-[14px] relative`, marker `·` gold bold at `left-1` |
| `.signal` | `inline-block rounded-full px-[7px] py-px text-[10px] font-bold`; default `bg-terra-bg text-terra`, `.warn`, `.ok` |
| `.med-schedule` | `grid grid-cols-[160px_repeat(N,1fr)]` — ⚠️ **N is derived from the round config, not the literal 4** (§5.4) |
| `.ms-cell` | `p-[12px_14px] border-b border-r border-border text-[12px]`; `.head` `bg-bg text-[9px] tracking-[0.14em] uppercase font-bold text-navy-3`; `.head.time` `font-mono text-[11px] normal-case text-navy-2 text-center` with `.label` `block font-body text-[9px] tracking-[0.14em] uppercase text-navy-3 mt-[2px]` |
| `.ms-cell.dose` | `text-center font-mono font-semibold text-navy`; `.muted` `text-navy-3 italic font-body font-normal text-[11px]`; `.prn` `bg-gold-bg` with `::before` `content:"PRN"` `block text-[8px] tracking-[0.1em] text-gold font-bold mb-[2px]` |
| `.protocol-block` | `border-[1.5px] border-terra rounded-xl p-[20px_24px] mb-4` + `bg-[linear-gradient(180deg,var(--terra-bg)_0%,var(--surface)_100%)]` |
| `.ep-step` | `grid grid-cols-[36px_1fr] gap-3 py-3 border-b border-dashed border-terra-bg items-start`; `.ep-num` `size-[30px] rounded-full bg-terra text-bg grid place-items-center font-display font-semibold text-[13px]` |
| `.artefact-card` | `bg-surface border-[1.5px] border-dashed border-gold rounded-xl p-[18px_22px] relative`; `::before` label `DORM-SIDE COPY` `absolute -top-[9px] left-[18px] bg-bg px-[10px] text-[9px] tracking-[0.18em] text-gold font-bold` |
| `.ac-row` | `grid grid-cols-[110px_1fr] gap-[14px] py-[9px] border-b border-border` |
| `.pastoral-block` | `bg-surface border border-border rounded-[14px] p-[24px_28px] relative overflow-hidden` + the 4px gold→gold-soft bar via `::before`; content `pl-[18px]` |
| `.pb-handoff` | `grid grid-cols-3 gap-[14px] p-[14px_18px] bg-bg rounded-[10px] border border-border`; `.pill` `bg-navy-2 text-bg rounded-full px-2 py-[2px] text-[10px] uppercase font-bold` |
| `.grant-table` | as `.register-table` at `td p-[12px_14px]`; `.scope-pill` `inline-block rounded-full border px-2 py-[3px] text-[10px] font-semibold`; `.expiry` `font-mono text-[11px] text-navy-2`, `.never` `font-body italic text-green`; `.ungrant-btn` `rounded-md border border-border-2 bg-surface px-[10px] py-[5px] text-[10px] font-semibold text-terra` |
| `.audit-trail` / `.audit-row` | `bg-surface border border-border rounded-xl overflow-hidden` · `grid grid-cols-[110px_1fr_auto] gap-[18px] p-[14px_20px] items-center border-b border-border` |
| `.at-time` / `.day` | `font-mono text-[11px] text-navy-2 font-semibold` · `block font-body text-[9px] text-navy-3 font-medium mt-px` |
| `.at-tag` | `rounded-full border border-border bg-bg px-2 py-[3px] text-[9px] tracking-[0.12em] uppercase font-bold text-navy-3`; `.view` navy tint · `.update` `bg-gold-bg text-gold border-gold-soft` · `.grant` `bg-green-bg text-green border-green` · `.create` `bg-gold text-navy border-gold` |
| `.save-bar` | `grid grid-cols-[1fr_auto] gap-[18px] items-center rounded-xl border-[1.5px] border-gold p-[18px_22px] mt-4` + `bg-[linear-gradient(135deg,var(--gold-bg)_0%,var(--surface)_100%)]` |
| `.xmod-strip` | `grid grid-cols-3 gap-3 mt-4` → **`grid-cols-1` at 23** (two of three cards omitted, §5.8) |

### 2.4 One colour ruling with a disclosure consequence

`.condition-pill.mental` is `bg-navy-2 text-bg` — the notes say *"mental health navy (different system)"*. **Keep it**, but note what it means: the pill colour alone identifies the condition family across a room. That is one of the thirteen mental-health-by-implication vectors catalogued in §10.2 — and it is the reason §4.4's row-level filter, not the pill's colour, is the actual control.

---

## 3. §01 — Active register, element by element

### 3.1 Page head

| Element | Exact surface copy | 23 |
|---|---|---|
| Crumb | `Sickbay` *(link)* ` · Chronic register` | **BUILD.** `text-[11px] tracking-[0.12em] uppercase font-semibold text-navy-3`; link `text-gold no-underline` → `/senior/sickbay/today`. |
| `<h1>` | `Chronic ` + `<em>register.</em>` | **BUILD verbatim**, trailing full stop included. `font-display text-[28px] font-medium tracking-[-0.018em] leading-[1.1]`; `<em>` `font-normal italic text-gold`. |
| Lede | `**6 active** care plans · last review **Mon 12 May** · next monthly review **Mon 19 May** · **admin-private** by default` | **BUILD, TRIMMED + DERIVED** → `**{n} active** care plans · last review **{EEE d MMM}** · **admin-private** by default`. `{n}` counts **the rows this reader can see** (§4.4). `last review` = `max(reviewed_at)` over that same set; the clause drops when no plan has ever been reviewed. ⚠️ **`next monthly review` is DROPPED** — nothing in 0058 schedules a review; a monthly cadence is school policy, not config, and rendering a date nothing computes is the STPSHS-matrix shape. `admin-private` clause is **verbatim, load-bearing copy** — but see **BL2**: it is false until the student profile is gated. |
| Action 1 | `Export PDF` | **OMIT.** A PDF of six students' conditions, statuses and drug names in one file, downloadable and un-revocable. Same reasoning that omitted `Print day sheet` at 22c (A6 · B16) — and here the payload is longitudinal, not one shift's. |
| Action 2 | `Audit trail` | **BUILD** as a secondary link → `/senior/sickbay/chronic-register/access-grants#audit`. `rounded-[6px] border border-border-2 bg-surface px-[14px] py-[9px] text-[12px] font-semibold text-navy`. |
| Action 3 | `+ Add student` (`.btn.primary`) | **BUILD**, `MATRON` only (absent for a HEADMASTER — an affordance filter, never a data filter, per R72's precedent). `bg-navy text-bg border-navy font-bold`. Opens the new-plan form (§5.9). |

### 3.2 Privacy banner

**BUILD in full.** This is the surface's own non-disclosure copy and Risk 4 says preserve it verbatim — **with one mandatory correction**.

| Element | Copy | 23 |
|---|---|---|
| `.pb-lock` | `⚿` | keep |
| `.pb-title` | `Admin-private · ` + `<em>per-grant access only</em>` | **verbatim** |
| `.pb-sub` | `Chronic medical records are visible to **Matron, Headmaster, and Deputy Head (Welfare)** by default. Housemasters and class teachers see **only what the matron explicitly grants**, scoped per student and per field. Every read and write is recorded in the audit trail.` | 🔴 **RE-AUTHORED.** `Deputy Head (Welfare)` **does not exist** — `VICE_HEADMASTER_ACADEMIC` is the only vice-head role and is academic by definition (inventory §1.3). Ship: `Chronic medical records are visible to **the Matron and the Headmaster** by default. Housemasters and other staff see **only what the matron explicitly grants**, scoped per student. Every read and write is recorded in the audit trail.` ⚠️ **`scoped per field` is dropped** — 23 ships three whole-projection scopes, not per-field grants (§7.3). Advertising per-field scoping the DB cannot express is exactly the capability-the-boundary-won't-enforce failure. ⚠️ **Add one sentence** for R42: `Records with a mental-health condition are visible to the Matron only, unless she grants access explicitly.` |
| `.pb-cta` | `Manage grants ›` | **BUILD** → `/senior/sickbay/chronic-register/access-grants`. `MATRON` sees `Manage grants ›`; `HEADMASTER` sees `View grants ›` (AUTHORED — he cannot write one). |

### 3.3 Filter strip

| Pill | Surface | 23 |
|---|---|---|
| `Filter` label | `Filter` | keep, `text-[10px] tracking-[0.14em] uppercase font-bold text-navy-3` |
| `All` `6` | count | **BUILD, derived over the reader's visible set** |
| `Active crisis` `1` | count | **BUILD** |
| `Monitor` `2` | count | **BUILD** |
| `Stable` `2` | count | **BUILD** |
| `Referral-managed` `1` | count | **BUILD — but a bucket with ZERO rows for this reader does NOT render.** Not `0`, not greyed. Reason: in a register where the only referral-managed row is a mental-health one, a `Referral-managed 1` pill discloses that a hidden record exists to a HEADMASTER who cannot open it (§10.2/M3). Applying the rule to *all* buckets, not just this one, keeps it from being a tell in itself. |
| `Sort · last visit ↓` | control | **OMIT at 23.** Six rows need no sort (YAGNI), and the surface defines exactly one order. **Default order: status severity** (`Active crisis` → `Monitor` → `Referral-managed` → `Stable`), then surname. ⚠️ The surface's own label says *last visit* but its rows are drawn in severity order — the label loses to the rows. |
| **Partition invariant** | — | the status buckets **sum to `All`** (R74's rule, applied here). A row whose status is outside the four values is a bug, not a fifth pill. |

### 3.4 Register table — 7 columns → **5**

Column widths from the surface: Student 24 % · Condition 14 % · Status 10 % · Daily medication 18 % · Last visit 11 % · HM grants 14 % · Plan 9 %.

| Col | Surface content (all 6 rows verbatim) | 23 ruling |
|---|---|---|
| **Student** | avatar (initials, tinted by status) + `Adwoa Mensa` / `**F1 SCI** · Slessor · AS-2024-F1-0089` — then `Kofi Asante` `F2 SCI · Aggrey · AS-2023-F2-0142`, `Akua Owusu` `F3 GA · Slessor · AS-2022-F3-0034`, `Yaw Boateng` `F1 BUS · Kufuor · AS-2024-F1-0203`, `J. Manu` `F2 GA · Aggrey · AS-2023-F2-0091`, `Esi Antwi` `F3 SCI · Nkrumah · AS-2022-F3-0167` | **BUILD.** ⚠️ **FULL name, not initials** — this is a destination list a matron navigated to, one row per student she manages; the 22c abbreviation tier (`A. Mensa`) exists for a bench-side glance screen and does not apply here (C-ladder C0, §4.2). `formLabel()` for `F1 SCI`; `houses.name` **without** the word `House` (as drawn); `students.student_code` **verbatim, no `#`** (F2). Avatar = shipped `initials()`. |
| **Condition** | `.condition-pill` ×6: `Sickle cell · HbSS` · `Asthma · moderate` · `Epilepsy` · `Anaphylaxis · peanut` · `Anxiety · referral-managed` · `Type 1 diabetes` | **BUILD.** The pill's **label is a stored per-plan string** (`condition_label`), NOT the enum rendered — `Sickle cell · HbSS` and `Asthma · moderate` carry a phenotype/severity the 7-value enum cannot. The **colour** comes from the enum (`chronic_condition_enum`), the **words** from the plan. ⚠️ `Anxiety · referral-managed` duplicates the status column; ship the label as authored by the matron and let her repeat herself if she wants. |
| **Status** | `.status-pill` ×6: `Active crisis` · `Monitor` · `Monitor` · `Stable` · `Referral-managed` · `Stable` | **BUILD** — a 4-value enum. The note is the spec: *"Status separates from condition. Asthma can be 'stable' or 'monitor' or 'active'; SCD can be 'stable' or 'crisis'. **A condition is forever, a status is today.**"* |
| **Daily medication** | `**Hydroxyurea 500mg** OD` / `+ paracetamol PRN, oral hydration` · `**Beclomethasone** BD inhaler` / `+ salbutamol PRN, peak flow Mon/Thu` · `**Carbamazepine 200mg** BD` / `morning 06:30 + evening 21:00 round` · `**Epi-pen ×2** on standby` / `kitchen alert · 0 exposures this semester` · `no on-site medication` / `monthly Asankrangwa DMHU clinic` · `**NovoMix 30** BD insulin` / `pre-breakfast + pre-dinner · HbA1c 7.4%` | **BUILD the bold line, DROP the sub-line.** The primary line **derives** from `care_plan_medication` (the highest-dose scheduled drug + its frequency code) — never a stored duplicate string. The sub-lines are six different kinds of thing (a PRN list, a monitoring cadence, a kitchen instruction, a lab value, a clinic destination) with no common binding, and two of them are disclosures: `monthly Asankrangwa DMHU clinic` names a Mental Health Unit (M5) and `HbA1c 7.4%` is a lab value in a list (§10.1 class 3). ⚠️ **For a `MENTAL_HEALTH` row the cell renders EMPTY — not `no on-site medication`.** An explicit "no medication" in a medication column is the schedule-gap tell (M4). |
| **Last visit** | `14 May 09:14` / `admitted now` · `04 May 14:22` / `10 days ago · attack` · `29 Mar 22:40` / `6 wk ago · nocturnal sz` · `11 May 13:15` / `3 days ago · contact` · `02 May 10:00` / `12 days ago · DMHU visit` · `12 May 18:40` / `2 days ago · routine` | **BUILD the timestamp + relative age; DROP the reason clause.** `attack`, `nocturnal sz`, `contact`, `DMHU visit`, `routine` are clinical assertions (and one destination disclosure) rendered six-at-once in a list — **A12 exactly**, and 22c already settled that a *log* row does not earn a clinical fragment. There is also no clean binding: they would have to come from `presenting_complaint`/`working_impression`, which R69/R87's field ceiling forbids in a list projection. `admitted now` **survives** as a derived state from an open `sickbay_admission` (it is tier-2 location/status, not a clinical assertion) and keeps its `text-terra font-semibold` urgency tone. |
| **HM grants** | avatar stack + `3 staff` / `2 staff` / `2 staff` / `3 staff` / `2 staff` / `3 staff` | **BUILD the COUNT, DROP the avatar stack.** Two reasons: (a) the stack needs grantee identities resolved for 6 rows × ~3 grantees — a per-row read that R68's O(1) contract forbids, and Dex's statement-count guard now catches (board L2532: *"exactly INCR-23's per-student chronic-lookup shape"*); (b) a grantee's initials beside a condition pill re-identifies **which** staff know, and for the mental-health row the counsellor's initials are themselves a disclosure (M8). Render `{n} staff` (`text-[10px] text-navy-3 font-semibold`), linking to the grants page filtered by student. Singular `1 member of staff`, zero → **`No grants`** (AUTHORED) in `text-navy-3 italic` — a real and meaningful state, not a blank. |
| **Plan** | `Open ›` (`.action-btn`, gold `.active` on the crisis row) | **BUILD.** Right-aligned. The **whole row** is the link to `/senior/sickbay/chronic-register/{studentId}`; the button is the affordance. Gold `.active` variant on the row whose status is `Active crisis`. |

**Empty state:** head + filter strip absent, one line — **AUTHORED:** `No chronic care plans on the register yet.` + (`MATRON` only) `Add the first one →`. `text-[12px] italic text-navy-3 p-[18px_20px]`. No illustration. A school with no chronic register is a normal early state, not a failure.

### 3.5 Summary tiles — 4 → **2 (+1 optional)**

The surface draws four `1fr` tiles below the table.

| # | `.lbl` | value | sub-line | 23 |
|---|---|---|---|---|
| 1 | `Active crises (today)` | `1` + `<em> of 6</em>` | `Adwoa M. · SCD pain crisis` | **BUILD, sub-line re-authored.** Value = count of `status = ACTIVE_CRISIS` over the reader's visible set. 🔴 **Sub-line drops the condition and applies A2's one-name rule:** exactly one → `{Firstname} {I}.` · more than one → `{n} students` · zero → **no sub-line at all**. `A. Mensa · SCD pain crisis` is name + condition + clinical state on a tile — the A2 leak, verbatim. |
| 2 | `NHIS coverage` | `5` + `<em> of 6</em>` | `Yaw B. is private (epi-pen not covered)` | 🔴 **OMIT THE WHOLE TILE.** No NHIS field exists; D3's *shape* ruling is INCR-25's. The sub-line additionally names a student and his coverage gap. |
| 3 | `WASSCE candidates` | `2` + `<em> of 6</em>` | `Akua O., Esi A. · examination accommodations on file` | **OPTIONAL BUILD — count only, sub-line dropped.** Genuinely backed: `wassce_candidates` (student join) + `waec_special_consideration` where `sc_form = 'SC-7'` (chronic-condition extra time) — both shipped. Cost: one extra select. The **sub-line naming students is dropped** (A2). If built, sub-line becomes `{n} with SC-7 accommodations on file` (AUTHORED) and drops when zero. **Recommend building it** — it is a real cross-module hook and the only one on this surface that costs nothing to keep honest. |
| 4 | `Plans needing review` | `0` + `<em> overdue</em>` | `Next monthly review **Mon 19 May**` | **BUILD value, DROP sub-line.** Overdue = `reviewed_at < now − PLAN_REVIEW_DAYS`, where `PLAN_REVIEW_DAYS = 30` is a **frozen constant in `lib/sickbay/`, documented as policy-not-config** (a per-school review cadence is a config table nobody asked for; the R26 policy-anchor precedent). The `Next monthly review` sub-line asserts a scheduled event nothing schedules. ⚠️ A plan with `reviewed_at IS NULL` counts as **overdue**, not as "fine" — a never-reviewed plan is the case this tile exists for. |

Strip becomes `grid-cols-2` (or `grid-cols-3` with the WASSCE tile).

---

## 4. 🔴 ADJACENCY — a fresh question, because this surface is different in kind

### 4.1 What changed since 22c

22c's threat model was **physical shoulder-surfing at a bench-side screen the matron keeps open all day, in a room where students queue** (A11). Every A-ruling followed from that. This surface is not that screen:

| | The today board (22c) | The chronic register (23) |
|---|---|---|
| **Dwell** | open continuously, morning round → lights-out | opened deliberately, per student, then closed |
| **Audience in the room** | queueing students, other patients, whoever walks in | whoever is with the matron when she opens it — normally nobody |
| **Purpose of the detail** | glance-check; the detail is *incidental* | **the detail IS the artefact** — a care plan without triggers, drugs and red flags is not a care plan |
| **Reader set** | fixed by role (`HEADMASTER`, `MATRON`) | role **plus grants** — for the first time the reader set is per-row and mutable |
| **Physical output** | none (both print actions omitted) | **a card printed and posted inside a cabinet door**, permanently, with no revocation path |

**So the adjacency question inverts.** On the board the question was *"does this element earn its place against a shoulder-surfing risk?"* — and almost nothing did. Here the question is:

> **Is this element in the SCOPE the reader holds, and does it appear on a LIST or on a DETAIL page?**

Three consequences, and they are the whole of §4:

1. **Tier-4 clinical content is IN SCOPE on the detail route.** Condition names, drug names, protocol steps, lab values, family history — all of it — render in full to a full-scope reader. This is not a relaxation of A1/A13; it is the case those rulings explicitly reserved (*"at INCR-23 it returns inside the visit record only, never on this board"*). **Nothing in §4 licenses putting any of it back on the today board.**
2. **§01 is a LIST, and a list is board-shaped again.** Six students × condition × drug × status, legible at once. Every ruling in §3.4 that trimmed a column is the A12 rule reapplied, and the reasoning is identical: nothing on a list is being decided, and a list multiplies exposure by its row count.
3. **The scope IS the boundary.** A `PARTIAL` grant is not a rendering preference; it is a projection the reader physically cannot see past. Any element whose disclosure depends on someone *choosing not to render* it is a bug (§7.6).

### 4.2 The C-ladder — this surface's rulings (C0–C14)

Numbered **C**, deliberately not continuing A1–A14: they answer a different question and conflating them is how a future implementer imports a board ruling into a detail page or vice versa.

| # | Element | Pairing | Verdict |
|---|---|---|---|
| **C0** | §01 student names **in full** (`Adwoa Mensa`, not `A. Mensa`) | identity, tier 1 | ✅ **Full names.** The abbreviation tier is a *board* control (Sarah ADV-2 made it compile-checked there). A register the matron navigated to, listing the students she is responsible for, is not improved by making her decode initials. **State this in the PR** so nobody "fixes" it to match the board. |
| **C1** | §01 `Condition` pill × 6 rows | name + condition, six at once | ✅ **KEEP.** It is the register's index — the surface's own title. But it is the reason the list route is `SICKBAY_CLINICAL_READ_ROLES` only and **never grant-scoped** (§4.4). |
| **C2** | §01 `Daily medication` bold line × 6 | name + **drug name**, six at once | ⚠️ **KEEP, with a named ceiling.** This is A4's drug-re-identification leak (`Hydroxyurea` ⇒ SCD) — but here the condition is *deliberately disclosed in the column beside it*, so the drug adds no new fact to this reader. It earns its place operationally (*who is due what* is the matron's daily question). 🔴 **Ceiling: it is the FIRST column to drop if the list is ever widened beyond the clinical read set.** Record it in the PR. |
| **C3** | §01 medication **sub-lines** | lab values, destinations, kitchen instructions | ❌ **DROP** (§3.4) — no common binding, and two are disclosures. |
| **C4** | §01 `no on-site medication` on the MH row | **schedule gap ⇒ referral-managed ⇒ mental health** | 🔴 **DROP — render the cell empty.** M4. |
| **C5** | §01 `Last visit` reason clause (`attack`, `nocturnal sz`, `DMHU visit`) | name + clinical assertion, six at once | ❌ **DROP** — A12 reapplied, and unbindable anyway. |
| **C6** | §01 `HM grants` avatar stack | grantee identity + condition, per row | ❌ **DROP the stack, keep the count.** N+1 shape + grantee re-identification. |
| **C7** | §01 tile 1 sub-line `Adwoa M. · SCD pain crisis` | name + condition + state on a tile | 🔴 **Condition dropped; A2 one-name rule applies.** |
| **C8** | §01 filter pill with a zero count | **a count discloses a row you cannot open** | 🔴 **Empty buckets do not render.** M3. |
| **C9** | §02 everything — condition paragraph, family history, triggers, baseline labs, med grid, 5 protocol steps, phone numbers | the full clinical record | ✅ **RENDER IN FULL to a `FULL_PLAN`-scope reader.** This is the surface's purpose. The control is the scope, not the rendering. |
| **C10** | §02 the **dorm-side card**, printed and posted | **a permanent physical artefact naming a condition** | ⚠️ **KEEP for physical conditions — it is the `PARTIAL` payload and the reason `PARTIAL` exists.** The foot copy is the control and ships verbatim: *"Print this card and post inside the HM's cabinet door. **Do not display in dorm common area** — medical privacy applies."* 🔴 **NEVER for a `MENTAL_HEALTH` plan** (C13). |
| **C11** | §02 masked phones `0244 ███ 089` | — | 🔴 **The mask is INCOHERENT on this surface — do not build a masking layer.** The dorm card's `Parent` and `Matron` rows exist *to be dialled*; a masked number on a card whose purpose is "who to call" is a broken artefact, and the same reader can read the guardian's number on the student profile anyway. **Render in full to a reader whose scope includes the field; readers without that scope do not get the field at all.** The grant decides, not the mask. (This **revises** the inventory §1.2 "masking is a design commitment" — it is a screenshot-safety convention in a public HTML file. **Owner-escalate, Q6.**) |
| **C12** | §02 `Print dorm copy` | export | ⚠️ **BUILD as a print-stylesheet route, not a PDF generator** (native platform feature over a lib), and **write an audit `Export` row on the action that produces it** — honestly labelled as *intent to print*, because no web app can observe a print. |
| **C13** | §03 a dorm card for a mental-health plan | **a printed psychiatric label posted in a cabinet, forever, with no revocation path** | 🔴 **DOES NOT EXIST.** `Print dorm copy` does not render on a `MENTAL_HEALTH` plan, and the artefact card is absent from that route. The surface never draws one — this ruling makes that explicit so nobody "completes" the pattern. |
| **C14** | §04 audit-row event text | **the accountability instrument leaking the thing it protects** | 🔴 The event sentence names actor · verb · student · **scope**, and **never the condition**. Rows about a `MENTAL_HEALTH` plan are visible only to readers who can see that plan (M9). |

### 4.3 The disclosure ladder, rewritten for this surface

| Tier | Content | §01 list | §02/§03 detail | Dorm card (`PARTIAL`) | `ALERT_ONLY` |
|---|---|---|---|---|---|
| **1 · Identity** | name, form, House, code, bunk | ✅ | ✅ | ✅ | ✅ |
| **2 · Status & location** | care-plan status, `admitted now`, review age, grant count | ✅ | ✅ | — | ✅ (*"has a care plan on file"*) |
| **3 · Condition family** | condition enum + label | ✅ *(clinical read roles only)* | ✅ | ✅ | ❌ |
| **4 · Clinical detail** | triggers, protocol steps, drug names, doses, lab values, family history, external clinicians | ⚠️ drug name only (C2) | ✅ | ⚠️ **only the 8 authored rows** | ❌ |
| **5 · Mental health** | psychiatric label, bereavement, self-harm triggers, DMHU/counsellor identity, the *absence* of medication | ❌ **row hidden from non-scoped readers** | ✅ **MATRON, or explicit grant — NOT the HEADMASTER by default (R42)** | ❌ **no card exists** | ❌ **not even the existence of the plan** |

**Tier 5 is new.** R42 already ruled it (*"a longitudinal psychiatric label is not operational information for a headmaster"*); this map is where it becomes a rendering contract.

### 4.4 The row-filter rule, and the counting rule that follows

> **A reader sees a care-plan row if: they hold `MATRON`; OR they hold `HEADMASTER` and the plan's condition is not `MENTAL_HEALTH`; OR they hold a live, unexpired, unrevoked grant for that student.**

Two consequences the implementer must not get wrong:

1. **Every count on this surface is computed over the reader's visible set** — the lede, all four filter pills, all summary tiles, the grants-page lede. A HEADMASTER at Asankrangwa sees `5 active care plans`, not `6`.
2. **No affordance ever hints at a hidden row.** No `1 record hidden`, no `+1`, no greyed row, no gap in a numbered list, no filter pill with a zero count (C8). The absence must be indistinguishable from the record not existing. This is the single rule that makes tier 5 real.

---

## 5. §02 — Care plan detail, element by element

### 5.1 Page head

| Element | Exact surface copy | 23 |
|---|---|---|
| Crumb | `Sickbay` · `Chronic register` · `Adwoa Mensa` | **BUILD**, both links live. |
| `<h1>` | `Care ` + `<em>plan.</em>` | **BUILD verbatim.** |
| Lede | `Sickle cell disease · **HbSS** · diagnosed age 3 · plan version **v4** last reviewed **Mon 21 Apr** by Mrs A. Bediako` | **BUILD, derived:** `{condition_label} · plan version **v{n}** last reviewed **{EEE d MMM}** by {reviewer}`. ⚠️ `diagnosed age 3` is **narrative that belongs in the Condition row**, not the lede — there is no `diagnosed_at` and inventing one for a demo string is wrong. When `reviewed_at` is null: `plan version **v1** · not yet reviewed` (AUTHORED). |
| Action 1 | `Print dorm copy` | **BUILD** (C12) — absent for `MENTAL_HEALTH` (C13), absent for `ALERT_ONLY` scope. |
| Action 2 | `View visit history` | **BUILD** → the student's visits. ⚠️ **No such route exists yet** — 22c's §03 is a 24-hour window on the board, not a per-student history. Two options: (a) link to `/senior/sickbay/today#recent` (wrong — it is not this student's history); (b) **defer the action to INCR-27** (30-day history) and omit it now. **Recommend (b): OMIT.** Never a dead link. |
| Action 3 | `Edit plan` (`.btn.primary`) | **BUILD**, `MATRON` only. **Creates a new version** (§8.2), never an in-place edit. |

### 5.2 Patient header

Reuse the visit record's component (`.patient-header`, the 135° navy gradient).

| Element | Surface copy | 23 |
|---|---|---|
| `.patient-av` | `AM` | shipped `initials()` |
| `.p-name` | `Adwoa ` + `<em>Mensa</em>` | `{firstName} <em>{lastName}</em>` |
| `.p-detail` | `**F1 SCI** · age 15` · `**Slessor** House · bed S-12-B` · `Mother **Mrs E. Mensa** · primary contact` | **BUILD, three corrections.** `formLabel()`. **`age 15` is derivable** — `students.date_of_birth` exists (`students.ts:131`) and is nullable; render `age {n}` only when present, drop the clause otherwise. 🔴 **`bed S-12-B` — OMIT** (R61, unchanged from 22): `boarding_bunk` carries no `lower bunk · near door` shape and never has. Render `**{House}** House` alone; if the student has a `current_bunk_id`, render the bunk's own shipped label, never a free-text bed string. `Mother **Mrs E. Mensa** · primary contact` binds to `student_guardian` (**BACKED**) — render `{relation} **{name}** · primary contact`. |
| `.chronic-flag` | `Sickle cell · HbSS` | **BUILD** — terra pill. This is the register's own detail page; A3's omission was scoped to the board. |
| `.nhis-flag` | `NHIS · active` | **OMIT** (no field). |
| `.id-flag` | `AS-2024-F1-0089` | **BUILD** — `students.student_code` verbatim, `font-mono text-[10px] text-gold-soft`. |

### 5.3 Plan details card

Head: `Plan ` `<em>details</em>` · meta `v4 · 21 Apr 2026 · Mrs A. Bediako` → `v{n} · {d MMM yyyy} · {reviewer}`.

| `.pr-lbl` | `.pr-val` (verbatim) | Binding |
|---|---|---|
| `Condition` | `**Sickle cell disease · homozygous HbSS**, diagnosed age 3 at Korle Bu. Family history positive (maternal aunt deceased age 19 from acute chest syndrome). Most severe phenotype — chronic anaemia, vaso-occlusive crises 3-5× per year, splenic dysfunction since age 8.` | `care_plan.condition_detail` — **free text**, one paragraph. ⚠️ **Class-5-adjacent PII: family history about a person who is not the student.** Render it; it is clinically load-bearing. Never index it, never search it, never surface it anywhere else. |
| `Crisis triggers` | 5 bullets: `**Dehydration** — primary trigger, especially during harmattan and games (Tue/Thu 16:00)` · `**Cold exposure** — sleeping under fan, early-morning prep` · `**Infection** — even minor URTIs precipitate crisis; daily Penicillin V prophylaxis essential` · `**Physical exertion** — exempt from cross-country and prolonged outdoor PE` · `**Emotional stress** — examination weeks; flagged with class teacher and HM` | `care_plan_trigger` rows, **ordered** (`sort_order`), each `label` + `detail`. Not a JSONB array — the dorm card reads a *label-only* projection of exactly these rows (§5.6). |
| `Baseline status` | `Hb baseline **7.8 g/dL** (anaemia of SCD · stable). HbF **11.2%** (improving on hydroxyurea, target >15%). Last KATH outpatient review **27 Mar 2026** · Dr Asare-Mensah (paediatric haematology, no relation to Headmaster). Next review **27 Jun 2026**.` | `care_plan.baseline_status` — **free text.** ⚠️ Do **not** structure the lab values into columns: that is an EMR feature (R43's ceiling, and Risk 8's *"not a pharmacy, not an EMR"*). ⚠️ `no relation to Headmaster` is a **demo joke about a fabricated name collision** — it must not appear in any seed or fixture. |
| `Care goals · term` | `<span class="signal ok">on track</span> Zero school days lost to preventable crisis · **2 of 5 terms achieved**. Hydroxyurea adherence **97%**. Examination accommodations for end-of-term: extra time, separate room, water bottle access.` | `care_plan.care_goals` free text + `care_plan.goal_signal` (a 3-value tone: `ok` / `warn` / `alert` → the `.signal` variants). ⚠️ **`2 of 5 terms achieved` and `adherence 97%` are counters nothing computes** — they live inside the free text as the matron wrote them, never as derived numbers. Say so in the PR: the day someone computes `adherence 97%` from a MAR is INCR-24's problem and it will need a definition. |

### 5.4 Daily medication schedule grid — the config-driven one

Head: `Daily ` `<em>medication schedule</em>` · meta `Dispensed by matron · round-by-round`.

🔴 **The columns come from `getRoundSchedule(schoolId)`, never from the surface.** The surface draws `06:30 Morning` / `13:00 Lunch` / `21:00 Evening` / `PRN As needed`. **R13 is explicit: the chronic register's `13:00` column is demo drift and LOSES.** The canonical rounds are `06:30 / 12:30 / 21:00` (`CANONICAL_SICKBAY_SLOTS`, anchor first). The grid is therefore:

`grid-cols-[160px_repeat({rounds.length},1fr)_1fr]` — one column per **active** `MEDICATION_ROUND` slot in `roundSchedule()` order, plus **one PRN column**.

| Cell | Surface | 23 |
|---|---|---|
| `.ms-cell.head` (col 1) | `Medication` | verbatim |
| `.ms-cell.head.time` | `06:30` + `<span class="label">Morning</span>` | `{slot.startsAt}` + `<span>{slot.label}</span>`. ⚠️ The surface's short labels (`Morning`/`Lunch`/`Evening`) are **not** the stored labels (`Morning medication round`). Render the stored `label` — one formatter, no second vocabulary (R14's "never store the label beside the set", applied to its inverse: never author a second one at render). |
| PRN column head | `PRN` + `<span class="label">As needed</span>` | **verbatim, AUTHORED as a constant** — PRN is not a slot and must never be seeded as one. |
| `.ms-cell.drug` | `**Hydroxyurea**` / `capsule · 500mg · with food` — then `**Folic acid**` `tablet · 5mg · with food` · `**Penicillin V**` `tablet · 250mg · prophylaxis` · `**Paracetamol**` `tablet · 500mg · max 4×/day` · `**Ibuprofen**` `tablet · 400mg · with food` · `**Oral rehydration**` `sachet · 200ml water` | `care_plan_medication.drug_name` + a derived sub-line `{form} · {strength} · {note}`. All three sub-line parts nullable; the separator collapses. |
| `.ms-cell.dose` | `500mg` / `—` / `250mg` | per `(medication × slot)` dose. **A slot with no dose renders the `—` in `.muted`** — ⚠️ **deliberate deviation from 22c's vitals rule.** On the vitals grid a `—` reads as "measured and normal" and was banned; on a *schedule* grid a `—` means "not given at this round", which is exactly the fact, and a blank cell in a dose grid reads as an omission. **Say this in the PR** so the two rules are not "harmonised". |
| `.ms-cell.dose.prn` | `500mg` / `400mg` / `1 sachet` with the `PRN` micro-label | `care_plan_medication.prn_dose` where `is_prn`. The `::before` `PRN` label stays. |
| Round-timing note | `**Round timing rule.** Morning 06:30 round happens before breakfast (per boarding standing order). Adwoa attends in person with her dorm pass; meds are recorded at the round, not retrospectively. Lunch round is for students who can't get to the dining hall — Adwoa typically doesn't need it. Evening 21:00 round is back at sickbay before lights-out.` | 🔴 **RE-AUTHOR — it hardcodes three round times and one student's name.** The slot rows already carry a stored `description` which R13 says *is* the handoff document. Ship: render the **anchor slot's stored description** in the same dashed panel, with the AUTHORED lead `**Round timing rule.** ` and the AUTHORED tail `Meds are recorded at the round, not retrospectively.` Everything else is per-school config. **Absent entirely in Mode C** (§9). |

**Empty:** a plan with zero medications renders the head + **AUTHORED** `No scheduled medication on this plan.` — a real and common state (anaphylaxis, epilepsy-in-remission, every referral-managed plan). No empty grid, no zero columns.

### 5.5 Emergency protocol block

Head: `SCD pain crisis · ` `<em>escalation protocol</em>` → `{protocol_title}` (stored per plan — *"the matron's plan in their own words"*, not a template library).

Five ordered `care_plan_protocol_step` rows, each `heading` + `heading_em` + `detail`:

| # | `.ep-h` (verbatim) | `.ep-d` (verbatim) |
|---|---|---|
| 1 | `Recognise · ` `<em>vaso-occlusive crisis presenting</em>` | `Adwoa presents with **pain ≥4/10**, typically back/joints/limbs. Often follows trigger (dehydration, cold, infection). May appear tearful or withdrawn — pain expression varies. Don't dismiss as routine complaint.` |
| 2 | `Admit to sickbay · ` `<em>begin protocol</em>` | `Bed assignment, warm blanket, oral hydration **200ml ORS or water every 30min**. Initial vitals — temp, BP, pulse, oxygen sat (if pulse ox available), pain score. Paracetamol 500mg PO. Notify HM Slessor (**Mr E. Akoto**) — admission notification rule.` |
| 3 | `Notify parent · ` `<em>admission tier</em>` | `SMS within 1hr to **Mrs E. Mensa** (0244 ███ 089) — admission template. If pain not controlled within 2hr or any red flag, escalate to **immediate phone call**.` |
| 4 | `Red flags · ` `<em>immediate referral</em>` | `Refer to **Asankrangwa Govt Hospital** immediately if: pain >7/10 unresponsive to paracetamol+ibuprofen · fever >38.5°C · chest pain or breathlessness (acute chest syndrome risk) · neurological signs · priapism (boys) · sustained vomiting · oxygen sat <95%. Call ahead — request **Dr Owusu-Ansah** on duty if available.` |
| 5 | `Tertiary escalation · ` `<em>KATH transfer</em>` | `If Asankrangwa Govt unable to manage (e.g. acute chest syndrome, need for transfusion), onward referral to **KATH Kumasi · paediatric haematology · Dr Asare-Mensah** (+233 32 202 ████). Adwoa's full chart is on file at KATH; her ID will retrieve it.` |

**Rulings:**
- **All five are FREE TEXT authored by the matron.** No template library, no step-count validation, no per-condition scaffold. The note is the spec: *"Not a generic SCD reference — this is what Mrs Bediako will actually do."*
- **Steps are ORDERED and re-orderable** (`sort_order`); the `.ep-num` is the render index, never a stored number (a stored ordinal disagrees with its own order the first time a step is inserted).
- ⚠️ **The protocol is INERT** — stored, rendered, **never evaluated**. Same posture as `escalation_triggers` at 22 (R43): anything that *acts* on a stored clinical value is surveillance → INCR-27.
- ⚠️ Step 2's `Notify HM Slessor (Mr E. Akoto)` and step 4's named hospital are **text inside the step**, not FKs. `sickbay_hospital` is INCR-25's table (N6) and `houses.hm_user_id` is a live pointer that would silently rewrite a historical protocol. Text is correct here for the same reason `clinician_name` is copied onto a consult row (R60).
- Phone numbers render **in full** (C11), and only to a reader whose scope includes the protocol (`FULL_PLAN`).

### 5.6 Dorm-side artefact card — the `PARTIAL` payload

**This card IS the `PARTIAL` grant's projection.** Not "the card is what we print"; the card is what a `PARTIAL` reader's `getCarePlan()` returns — the same eight rows, the same order, the same fields. That is what makes the scope enforceable rather than decorative.

| Element | Verbatim | Binding |
|---|---|---|
| `::before` label | `DORM-SIDE COPY` | constant |
| `.ac-title` | `Adwoa ` `<em>Mensa</em>` ` · Slessor House` | student + house |
| `.ac-sub` | `Dorm-side reference · **HM-only** · auto-printed every term` | ⚠️ **`auto-printed every term` is unbacked** — nothing schedules a print. Re-author: `Dorm-side reference · **HM-only** · reprint on every plan revision` (which the version number makes true). |
| row `Condition` | `**Sickle cell · HbSS**` | `condition_label` |
| row `Bed` | `S-12-B · lower bunk · near door` | 🔴 **OMIT the row** unless boarding supplies a bunk label; never free text. |
| row `Triggers` | `dehydration, cold, infection, stress` | `care_plan_trigger.label` joined by `, ` — **labels only, no details** (the detail column is `FULL_PLAN`). |
| row `Daily med` | `06:30 round at sickbay (must attend)` | derived: `{anchor slot startsAt} round at sickbay (must attend)` when the plan has any round-scheduled medication; **omitted** when it has none. **No drug names on this card** — the HM needs the attendance fact, not the prescription. |
| row `Red flags` | `severe pain · fever · breathlessness · chest pain` | `care_plan.red_flags_short` — a **separate short field**, authored for the card, NOT a truncation of protocol step 4. A truncated protocol is a misread protocol. |
| row `Action` | `**Walk her to sickbay** · do not let her wait` | `care_plan.dorm_action` free text |
| row `Parent` | `Mrs Mensa · 0244 ███ 089` | `student_guardian` (primary) — **full number** (C11) |
| row `Matron` | `Mrs Bediako · 0277 ███ 412` | `sickbay_settings.matron_user_id` → `ref_user` → the shipped staff phone field if one exists; **omit the row if no number is stored** — never a placeholder number |
| `.ac-foot` | `Print this card and post inside the HM's cabinet door. **Do not display in dorm common area** — medical privacy applies. Replaced each term and on plan revision.` | **VERBATIM.** This is the physical-adjacency control and it ships as written. |

⚠️ **Never rendered for a `MENTAL_HEALTH` plan** (C13).

### 5.7 NHIS & billing card — **OMITTED ENTIRELY**

No shell, no badge, no anchor target, no `—`. The `col-2` grid collapses to one column and the artefact card takes the full width. Recorded so INCR-25 knows exactly what lands here: card number, status + validity, coverage list, not-covered list, YTD school cost (which additionally needs D6's sickbay→billing ruling).

### 5.8 Cross-module strip — 3 cards → **1**

| Card | Copy | 23 |
|---|---|---|
| `Attendance · <em>auto-excuse</em>` | `Days admitted to sickbay register as **excused medical absence** automatically. Class teachers see "M" not "A". Adwoa has **3 excused days** this semester — all SCD.` | **BUILD, trimmed.** The mechanism is **shipped** (22b). Derive `{n} excused days this term` from `attendance_record` where `reason_code = 'SICKBAY'` for this student in the current term. 🔴 **Drop `— all SCD`**: a per-plan attribution the schema cannot make (an `M` records a *location*, never a condition — R50), and it is a condition assertion inside an attendance sentence. Keep `Class teachers see "M" not "A"` **verbatim** — Risk 4 names it as product copy. |
| `Boarding · <em>HM alert</em>` | `Mr E. Akoto (Slessor HM) receives admission SMS within 5min…` | **OMIT** (INCR-26). Recorded verbatim in the inventory; do not re-render. Its *behavioural* commitment binds anyway: `No medical detail shared — only "in sickbay" status.` |
| `Communications · <em>parent SMS</em>` | `Three-tier rule fires automatically…` | **OMIT** (INCR-26). |

Strip becomes `grid-cols-1`; the eyebrow `Cross-module integration` stays.

### 5.9 `+ Add student` / `Edit plan` — the write forms (AUTHORED; the surface draws neither)

**`+ Add student`:** student picker (reuse the shipped `searchActiveStudents()` from `visit-reads.ts`) → condition enum (7 values) → condition label (free text, required) → status (4 values, default `Stable`) → the plan body. **Prefill from `student_health_record`** where present: `conditions` → condition detail, `medications` → a first free-text medication note, `allergies` → surfaced as a warning beside the picker, `emergency_contact_*` → the dorm card's parent row. **Prefill, never link:** the health record stays the student's static bio row; the plan is its own artefact.

**`Edit plan`:** loads the current version, saves as **v(n+1)** with `superseded_at` stamped on the old row (§8.2). The reviewer is the acting user, `reviewed_at = now`. **One audit `Update` row per save**, with `before`/`after` snapshots (the shipped `recordAudit` shape, and Dex's INCR-21 D2 fix applies: `after` must be an effective **snapshot**, never a patch).

---

## 6. §03 — Mental health, told honestly

**Same route as §02**, rendered when `condition = MENTAL_HEALTH`. Reader: **`MATRON` or an explicit grant. NOT `HEADMASTER` by default (R42).**

### 6.1 Page head

| Element | Verbatim | 23 |
|---|---|---|
| `<h1>` | `Pastoral ` `<em>cross-reference.</em>` | **BUILD verbatim.** ⚠️ `pastoral` is fine in a heading a scoped reader sees; it is **never** a URL segment, a nav label or a filter value (repo convention: *"Student support" is the nav label; "pastoral" is editorial/CSS only*). |
| Lede | `Mental health appears in the register honestly: **referral-managed**, not on-site treated · primary care held by **VLC pastoral system** · sickbay role is monitoring, not treatment` | **BUILD, one edit:** `VLC pastoral system` → `the school's pastoral system` (VLC is unbuilt; naming a module that does not exist advertises an absent affordance). |
| Action 1 | `Open VLC case` | **OMIT** — no target. |
| Action 2 | `Log monthly visit` (`.btn.primary`) | **BUILD** if the external-visit log ships (§8.3/N19b); **omit the action AND the log card together** if it does not. Never a button without a store. |

### 6.2 Pastoral block — the surface's most important editorial

**BUILD in full, verbatim.** This is the product.

- eyebrow `Why mental health sits here this way`
- title `No on-site treatment · ` `<em>referral-managed only.</em>`
- body: `A real Ghanaian SHS sickbay does not provide mental health treatment. The matron is not a psychiatrist or counsellor, and pretending otherwise creates harm. So J. Manu appears in the register as **referral-managed**: the District Mental Health Unit at Asankrangwa Govt holds her clinical case, she attends monthly, and Mrs Bediako's role is to **recognise warning signs, support adherence, and route distress**. Primary pastoral care lives in the VLC system where Mrs Owusu (her counsellor) holds the relationship.`
  - ⚠️ **The paragraph is per-student narrative in the demo but the RULE is universal.** Split it: the first two sentences are **frozen editorial** (a constant in `lib/sickbay/`, identical for every school — the R26 policy-anchor idiom); the rest binds to the plan's own external-care fields.
- three `.pb-handoff` fields — **all three are `care_plan_external_care` columns:**

| `.ph-l` | `.ph-v` | Binding |
|---|---|---|
| `Clinical home` | `**Asankrangwa District Mental Health Unit**` + `<span class="pill">DMHU</span>` | `clinical_home_name` + `clinical_home_abbr` |
| `Pastoral home` | `**VLC · pastoral** · Mrs Owusu, counsellor` | `pastoral_home_name` + `pastoral_contact_name` — **render `**Pastoral** · {contact}`**, never `VLC` |
| `Sickbay role` | `**Monitoring only** · monthly check-in, escalation` | `sickbay_role` free text — but the label `Monitoring only` is the `referral_managed` flag rendered (BUILD_STACK #4's `on_site_treatable_flag` / `referral_managed_flag`, which are exactly what this block exists to make honest) |

### 6.3 Plan details card — 6 rows

Head meta `v2 · 28 Apr 2026 · Mrs A. Bediako + Mrs N. Owusu` — ⚠️ **two co-authors.** `reviewed_by_user_id` is single. Ruling: **one reviewer FK + an optional `co_reviewer_note` free text** (`+ Mrs N. Owusu`), because the counsellor may not be a system user at all (the R21/R38 recorded-external-actor precedent). Do not add a second FK to a user who may not exist.

| `.pr-lbl` | `.pr-val` verbatim | Binding |
|---|---|---|
| `Condition` | `**Anxiety with sleep disturbance**, in context of bereavement (father, Feb 2026). Initial assessment at DMHU **02 May 2026**, diagnosis adjustment disorder with anxiety features. Not on medication. Currently weekly pastoral sessions with Mrs Owusu, monthly DMHU review.` | `condition_detail`. 🔴 **The single most sensitive string in the product**: bereavement + a psychiatric diagnosis. ⚠️ Note the surface writes `diagnosis` here — the **only** place in the module. R43's grep-testable ban is on **column/enum/type/zod-key/label/route names**, not on a matron's free-text prose quoting an external clinician. **The word may appear in stored text; it may not appear in any identifier.** Say so in the PR or someone will "fix" the copy. |
| `Pastoral home` | `**VLC Case 2024-VLC-0047** · Mrs N. Owusu (counsellor) holds primary relationship. Weekly Tue 16:00 sessions. Open since 18 Feb 2026.` | free text minus the case id (**drop `VLC Case 2024-VLC-0047`** — an id into an unbuilt system). |
| `DMHU schedule` | `Monthly first Friday · next visit **Fri 06 Jun 2026, 10:00** · mother accompanies. Transport: school pickup truck or trotro depending on availability.` | `external_care.cadence` free text + `next_visit_at` timestamp. ⚠️ **`next visit` is a stored date, not a computed one** — nothing generates a monthly series. |
| `Sickbay monitoring` | 4 bullets: `No daily medication dispensed (no prescription)` · `Monthly DMHU visit logged here (next: 06 Jun)` · `Distress escalations route to **Mrs Owusu first**, sickbay second` · `Watch for: weight loss, sleep complaints presenting as somatic (stomach pain, headache)` | reuse `care_plan_trigger` rows (the same ordered-bullet shape; a "trigger" and a "watch-for" are the same artefact under two names) — **do not author a second bullet table**. |
| `Red flags · escalation` | `<span class="signal">immediate</span> Any disclosure of self-harm thoughts, refusal of food >48hr, or significant deterioration — **call Mrs Owusu immediately** (0244 ███ 178), then DMHU duty officer. Do not wait for monthly review.` | `care_plan.red_flags_short` + the `signal` tone. 🔴 **Tier 5 · highest sensitivity in the product.** Renders in full to a scoped reader; renders **nowhere else, ever** — not on the dorm card (which does not exist), not on the list, not in an audit sentence. |
| `What the matron doesn't do` | `Treatment, counselling, diagnosis, medication. If J. presents with headache or stomach pain, treat the physical symptom — but route the underlying concern to Mrs Owusu the same day.` | `care_plan.scope_limits` free text. **The note is the spec:** *"Naming the limits protects both the student and the matron."* Render it in the surface's own muted italic (`.pr-val` with `italic text-navy-3`). |

### 6.4 DMHU visit log card

Head: `DMHU ` `<em>visit log</em>` · meta `2 visits · monthly cadence` → `{n} visits · {cadence}`.

Two rows drawn, rendered in the `.audit-trail` chrome (`border:none` inside the card body):

| `.at-time` | `.at-event` | `.at-tag` |
|---|---|---|
| `02 May 2026` / `Fri · 10:00` | `**Initial assessment** at DMHU. Seen by **Dr K. Boateng**, psychiatrist. Mother accompanied. Diagnosis: <em>adjustment disorder with anxiety features</em>. Plan: monthly review, no medication, continue VLC pastoral support. Return-to-school clearance: **no restrictions**.` | `Initial` (`.create`) |
| `06 Jun 2026` / `Fri · 10:00` | `**Monthly review** scheduled. Booked. Mother confirmed accompaniment. School pickup arranged via Mr Mensah (transport officer).` | `Scheduled` (plain) |

**Rulings:** rows are `care_plan_external_visit` (N19b) — `occurred_at` · `kind` (`INITIAL` / `REVIEW` / `SCHEDULED`) · `clinician_name` **TEXT** (R21/R38: an external psychiatrist is never a tenant identity) · `note` free text · `recorded_by_user_id`. **Append-only** (the vitals/consult posture): a correction is a second row, no `updated_at`, no delete. A **future-dated** row is legitimate here and is exactly what the `Scheduled` tag means — this is the one append-only table in the module whose rows may post-date `now`.

**Empty:** head + **AUTHORED** `No external visits logged yet.`

---

## 7. 🔴 §04 — Access grants & the audit trail (the increment's novel surface)

### 7.1 Page head

| Element | Verbatim | 23 |
|---|---|---|
| `<h1>` | `Who can see ` `<em>what.</em>` | **BUILD verbatim.** |
| Lede | `**13 active grants** across 6 students · **4 default-access** staff (Matron, HM, Deputy Welfare, School Nurse) · housemasters grant explicitly · every read logged` | 🔴 **RE-AUTHORED.** `4 default-access staff` is a **fabricated role set** — `Deputy Head (Welfare)` and `School Nurse` do not exist (inventory §1.3). Ship: `**{n} active grants** across **{n} students** · **2 default-access roles** (Matron, Headmaster) · other staff are granted explicitly · every read logged`. Counts over the reader's visible set (§4.4). |
| Action 1 | `Export grant log` | **OMIT.** An exportable file of who-knows-what-about-whom is a durable, un-revocable disclosure map. |
| Action 2 | `+ Grant access` (`.btn.primary`) | **BUILD**, `MATRON` only. |

### 7.2 The grant dialog — AUTHORED (the surface draws no form)

Every field maps to a column; nothing is decorative.

| Field | Control | Rule |
|---|---|---|
| **Grantee** | staff picker | 🔴 **STAFF ONLY.** The user must hold a staff role assignment **in this school** — checked at the app layer, exactly as `holdsMatronRole` guards the matron pointers, because `ref_user` is global and the DB cannot check tenancy on it (Sarah's INCR-21 advisory 2). **A student can never be a grantee** — R38's principle (a student is never an *actor* in another student's clinical record) applies a fortiori to *readers*. This omits the surface's `P. Kwakye · Senior prefect` row (§7.4). |
| **Grantee kind** | radio: `This person` / `Whoever is HM of this student's House` | Makes the notes' *"HM grants are role-based, not personal… auto-transfer to the new HM"* **true by construction** — the house-role grant stores no user id and resolves through `houses.hm_user_id` at read time. See §7.4. |
| **Student** | picker, from the register | one grant row per (grantee × student). |
| **Scope** | select, **3 values** | `Full plan` / `Partial (dorm card)` / `Alert only` — see §7.3. |
| **Expires** | `<input type="date">` + a `No expiry` checkbox | native date input (ladder rung 4). Two states only. |
| **Reason** | textarea, **required** | The reason is the accountability artefact; a grant with no reason is unauditable. Free text. |

### 7.3 🔴 THREE scopes, not nine — and each is a real projection

The surface renders **nine** access-level labels: `Full plan` · `Partial` · `Exam-only` · `Restrict-only` · `Alert-only` · `Catering-only` · `Allergen-only` · `Pastoral-only` · `Removed`. But its own CSS defines exactly **three** pill classes (`.full`, `.partial`, `.referral-only`) and **six of the nine labels render with `.referral-only`**. The surface is telling you it has three scopes and six reason strings.

BUILD_STACK agrees: `grant_scope_enum AS ENUM ('FULL_PLAN', 'PARTIAL', 'REFERRAL_ONLY')`.

| Scope | Pill | **The projection — this is the contract** |
|---|---|---|
| `FULL_PLAN` | `Full plan`, `bg-gold text-navy` | The whole care plan: condition detail, triggers + details, baseline, care goals, the med grid, all protocol steps, the dorm card, external care. **Not** the grants table and **not** the audit trail (those are the matron's). |
| `PARTIAL` | `Partial`, `bg-warn-bg text-warn border-warn` | **Exactly the eight dorm-card rows** (§5.6) and nothing else. This is why the card exists. |
| `ALERT_ONLY` | `Alert only`, `bg-navy-bg text-navy-2 border-navy-3` | Name + `This student has a care plan on file. Call the matron if she is unwell.` (AUTHORED). **No condition, no drug, no trigger, no phone number.** ⚠️ **Renamed from the enum's `REFERRAL_ONLY`** in copy only — `Referral-only` collides with the *status* value `Referral-managed` one column away and would read as a mental-health tell. Enum value stays `REFERRAL_ONLY` (BUILD_STACK); the label is `Alert only`. |

🔴 **`Exam-only`, `Restrict-only`, `Catering-only`, `Allergen-only`, `Pastoral-only` are OMITTED.** Each implies a per-fact field allow-list — *"sees only 'no cross-country, no prolonged outdoor'"*, *"sees allergen name, no medical detail"* — which is a **different product**: a school-wide dietary/PE restriction list owned by catering and games, not a medical grant. Shipping five extra pills against three projections would be precisely a **capability the DB boundary will not enforce**: the pill would say `Allergen-only` and the reader would return the plan.

**`Removed` is not a scope** — it is `revoked_at IS NOT NULL`. Render revoked rows with a neutral **`Revoked`** state pill (`bg-bg text-navy-3 border-border`), the scope pill greyed beside it, and a disabled action cell. They stay in the table because append-only means they stay.

### 7.4 The grants table — 6 columns, and every drawn row's verdict

| Col | Content | 23 |
|---|---|---|
| **Staff member** | `.av-mini` initials + `**E. Akoto**` / `HM · Slessor House` | **BUILD.** Name from `ref_user.full_name`; the role sub-line **derived** from the grantee kind (`HM · {House} House`) or the user's role assignment — never stored beside the grant. |
| **Student / scope** | `**Adwoa Mensa** · dorm-side card` | **BUILD name; the descriptor becomes the scope's own label.** The surface's per-row descriptors (`dorm-side card`, `exam accommodations only`, `physical restrictions`, `asthma + inhaler location`, `seizure protocol`, `alert-only`, `anaphylaxis protocol`, `kitchen alert`, `allergen list`, `pastoral handoff`, `diabetic protocol`) are **nine condition disclosures in a single column** — `seizure protocol`, `asthma + inhaler`, `anaphylaxis`, `diabetic`, `pastoral` each name the condition family beside a student's name, on a page whose reader may hold no grant at all. 🔴 **DROP the free-text descriptor. Render `**{Student}** · {scope label}`.** |
| **Access level** | `.scope-pill` | **BUILD** — 3 values (§7.3). |
| **Expires** | `31 Jul 2026` · `no expiry · housemaster role` · `no expiry · sports role` · `no expiry · catering oversight` · `standing` · `tied to VLC case` · `28 Apr 2026 · ended` | 🔴 **TWO states.** `{d MMM yyyy}` (`font-mono`) or **`No expiry`** (`.never`, italic green). The role glosses belong to the Reason column; `tied to VLC case` asserts a dependency on an unbuilt module and never renders. An expired grant renders its date + `· expired` in `text-navy-3`. |
| **Reason** | `**HM of student's house** · standing grant per house role` etc. | **BUILD verbatim as stored** — this is the matron's own justification and the audit artefact. ⚠️ The **reason field must not be used to smuggle back the descriptor**: the two example rows that name a condition (`Life-threatening allergy · HM holds epi-pen #2, must know full protocol`, `Hypoglycaemia risk · HM trained in glucagon admin`, `Nocturnal seizure risk`) are the matron's words about a grantee who **already holds `FULL_PLAN`** — so no new disclosure to *that* reader. But the reason column is visible to every reader of this page. **Ruling: the reason renders only to `MATRON` and to the grantee themselves; a HEADMASTER sees the row without the reason.** (Alternative, if that is judged too fine: drop the column for non-matron readers entirely.) |
| **(action)** | `Revoke` / disabled `—` on the removed row | **BUILD**, `MATRON` only. **Revoke is a stamp, never a delete** (`revoked_at`, `revoked_by_user_id`). Confirmation required (AUTHORED: `Revoke {Name}'s access to {Student}'s care plan? The grant stays in the audit trail.`). |

**The 13 drawn rows — verdicts:**

| Row | Verdict |
|---|---|
| `E. Akoto` HM Slessor → Adwoa, `Partial` | ✅ build shape — **house-role grantee** |
| `S. Henneh` Class teacher F1 SCI → Adwoa, `Exam-only`, expires `31 Jul 2026` | ⚠️ scope collapses to `ALERT_ONLY`; **exam accommodations are `waec_special_consideration` SC-7's job**, not a medical grant's |
| `D. Kufuor` Sports master → Adwoa, `Restrict-only` | ⚠️ collapses to `ALERT_ONLY`; the PE-exemption list is a different feature |
| `J. Osei` HM Aggrey → Kofi Asante, `Partial` | ✅ house-role |
| `P. Essien` Games master → Kofi, `Partial` (inhaler location) | ✅ personal grant, `PARTIAL` |
| `E. Akoto` → Akua Owusu, `Full plan` (nocturnal seizure) | ✅ house-role, `FULL_PLAN` |
| **`P. Kwakye` Senior prefect → Akua, `Alert-only`** | 🔴 **OMIT — a STUDENT holding a medical access grant.** Sarah gate; R38's principle. A dorm-mate alert is a conversation, not a row. |
| `Y. Kwaku` HM Kufuor → Yaw Boateng, `Full plan` (anaphylaxis) | ✅ house-role, `FULL_PLAN` |
| **`Mr Boampong` Bursar → Yaw, `Catering-only`** | 🔴 **OMIT** — kitchen vetting is not a medical grant |
| **`C. Tetteh` Catering supervisor → Yaw, `Allergen-only`, `standing`** | 🔴 **OMIT** — and note the grantee plausibly has **no login at all**; grant-to-a-non-user is unresolvable and must not be modelled |
| `J. Osei` HM Aggrey → J. Manu, `Pastoral-only` | ⚠️ **collapses to `ALERT_ONLY`** — and the scope label `Pastoral-only` is itself a mental-health tell (M7) |
| `E. Akoto` → J. Manu, `Removed`, `28 Apr 2026 · ended`, *House transfer · grant auto-expired* | ✅ **build as the revoked state** — and it is **only honest under the house-role grantee kind**, where the transfer is automatic by construction |
| `N. Wiafe` HM Nkrumah → Esi Antwi, `Full plan` (diabetic) | ✅ house-role, `FULL_PLAN` |

⚠️ The surface's typo `HM · Slessor was` (line 1138) is demo noise — the role sub-line is derived, so it cannot survive.

### 7.5 The audit trail

Head: `Audit ` `<em>trail</em>` ` · last 24 hours` · meta `11 events · append-only` → `{n} events · append-only`.

| Col | Rule |
|---|---|
| `.at-time` | `{HH:MM}` + `.day` `{EEE d MMM}` — from `audit_log.occurred_at` |
| `.at-event` | **A pure formatter over `(actionType, entityType, actorName, studentName, scopeLabel)` — the sentence is NEVER stored.** Templates (AUTHORED, from the drawn rows): `{Actor} opened **{Student}** care plan` · `{Actor} viewed **{Student}** · {scope label}` · `{Actor} updated **{Student}** care plan · v{n} created` · `{Actor} granted **{Grantee}** {Scope} access to **{Student}**` · `{Actor} revoked **{Grantee}**'s access to **{Student}**` · `{Actor} printed dorm-side card · **{Student}**`. 🔴 **No template names a condition.** The surface's `status updated **stable → active crisis**` is permissible (a *status*, tier 2); its `· SCD protocol`-shaped variants are not. |
| `.at-tag` | 4 values as drawn: `View` (`.view`) · `Update` (`.update`) · `Grant` (`.grant`) · `Export` (plain). The surface's 5th, `Initial`/`Scheduled` (`.create`), belongs to the DMHU log, not here. |

**The 11 drawn rows are the vocabulary spec** — reproduced verbatim in the inventory §5 §04; do not re-author them, do not seed them.

🔴 **Visibility:** the trail renders to `MATRON` and `HEADMASTER`. **Rows about a `MENTAL_HEALTH` plan render only to readers who can see that plan** (M9) — the drawn row *"Mrs N. Owusu (VLC counsellor) viewed J. Manu · pastoral cross-reference"* discloses the condition family through the actor's role and the scope label, to a reader who is barred from the record itself.

**Window:** `last 24 hours` as drawn — rolling from `now` on `occurred_at` (R75's precedent: a civil-date window is empty at 06:00). `Full trail ›` opens a longer, paginated view.

### 7.6 🔴 Read logging — the new behaviour, and its ceiling

`lib/db/audit.ts::recordAudit` logs **mutations only**. Eight of the eleven drawn rows are `View`/`Export`. *"Every read is in the trail"* is a **new behaviour** and Risk 3 flags it as a volume trap.

**Ruling (Risk 3 + Sarah's carried item 5):**

| Rule | Detail |
|---|---|
| **What is logged** | **Care-plan DETAIL opens only.** Never the list view, never the grants page, never the audit page itself (an audit of reading the audit is a fixed point nobody wants). |
| **Dedupe** | One row per **(actor × student × civil day)**. Implemented as a select-then-insert; **best-effort** — a lost race writes a second row, which in an append-only log is harmless. |
| **Shape** | `actionType: 'viewed'` · `entityType: 'sickbay_care_plan'` · `entityId: {planId}` · `actorUserId` · `actorRole` · `reason: {scopeLabel}` · no `before`/`after`. **No new table.** |
| **Never blocks** | The write runs **outside** the read's transaction. If audit logging fails, the plan still renders — same posture as R54's best-effort attendance write, for the same reason: the clinical artefact must survive its instrumentation having a bad day. |
| **Never fires for an empty read** | A reader whose scope returned nothing did not read anything. |
| **Retention** | 🔴 The save-bar's `Retention: 7 years after student leaves the school per GES records policy` has **no machinery anywhere in the repo** and D5 (retention obligations) is a **deferred owner decision**. **Omit the retention sentence** until retention exists. |

**Save-bar copy, corrected:**
> `Audit trail is <em>append-only</em>` · `Reads, writes, grants, revocations and exports are recorded with timestamp and actor. Entries cannot be edited or deleted, even by the Headmaster.`
Actions: `Full trail ›` **BUILD**; `Export 30-day log` **OMIT**.

### 7.7 🔴 The DB boundary — what it must actually enforce

Risk 1 and BUILD_STACK Decision 5 both say the same thing: *"Row-level security on Postgres enforces this; the application layer cannot bypass it."*

| Layer | Obligation |
|---|---|
| **RLS** | A `staff_grant_scope` RESTRICTIVE policy family on a new `app.current_staff_user` GUC, mirroring the shipped 19a `parent_scope`/`parent_deny` pattern (`db/sql/policies.sql:258–451`), + a verifier cloned from `scripts/verify-parent-boundary.ts`. Every 0058 table gets `ENABLE + FORCE RLS + tenant_isolation` and is **automatically `parent_deny`** (catalog-driven — D8, zero edits). |
| **The reader** | The grant check is an **`EXISTS` in the WHERE, inside the same `withSchool` tx** — never over-fetch-then-filter-in-TS (the row is materialised before it is authorised), never a per-row `hasGrant` (the N+1 R68 forbids and Dex's statement-count guard now catches). The coarse role check stays the **literal first statement** so the ADMIT-zero-SQL property survives. |
| **The signature** | `getSickbayBoard(schoolId, roles, now)` **breaks at 23** — `roles: readonly string[]` cannot express `hasGrant(actor, student)`. Take it to `{id, roles}` (Sarah's carried item 4). The new register readers take the same actor shape from day one. |
| **The client boundary** | 🔴 **A client component takes SCALARS or a separately-pinned view type — NEVER a reader row.** `<X row={row} />` ships every field into the flight payload regardless of what the JSX renders. This is the increment where 22c's B4 served-HTML check **becomes load-bearing** (board L2522/L2529): the grants table's `Revoke` button is the module's first clinical-adjacent client component. |
| **The key-set pin** | Extend 22c's `BOARD_ROW_KEYS` idiom: a frozen `Object.keys(row).sort()` list **per scope projection**, so `FULL_PLAN`, `PARTIAL` and `ALERT_ONLY` are runtime-distinguishable. Sarah ADV-2's lesson applies directly — a field name identical across tiers is invisible to a key-set pin, so **the three projections must not share field names for different payloads**. |

**Things the UI must NOT imply that the boundary will not enforce:**

| Implied capability | Reality | Resolution |
|---|---|---|
| Nine access levels | three enum values | ship three (§7.3) |
| `scoped per student and **per field**` (banner) | whole-projection scopes | drop the clause (§3.2) |
| `HM grants auto-transfer to the new HM` | true **only** with the house-role grantee kind | ship the grantee kind, or change the copy (§7.2) |
| `Time-limited grants expire automatically` | true **only** if expiry is evaluated in the reader's `WHERE`, per request | evaluate server-side, never cache in a session claim |
| `grant auto-expired` on house transfer | true **only** for house-role grants | the drawn row is honest under that kind and dishonest without it |
| `Cannot be edited or deleted, even by Headmaster` | true at the app layer (no update/delete path on `audit_log`) | ✅ ship verbatim |
| `Retention: 7 years` | no machinery exists | omit (D5) |

---

## 8. Data bindings — against the shipped schema

### 8.1 What `student_health_record` CAN and CANNOT carry

`db/schema/students.ts:243–272` (migration 0036): `blood_group · allergies · conditions · medications · emergency_contact_{name,phone,relation} · notes · updated_by_user_id · updated_at`, with `student_id` **globally `.unique()`** (not the tenant-scoped idiom — Risk 10; harmless with UUIDs).

| ✅ CAN carry | ❌ CANNOT carry |
|---|---|
| **Seed values** for a new plan: `conditions` → condition detail, `medications` → a first medication note, `allergies` → a picker warning | **Two chronic conditions for one student** — `UNIQUE(student_id)`. This is *why* the register needs its own table (Risk 10, Wells' own note) |
| The dorm card's **`Parent`** row and the patient header's emergency contact (`emergency_contact_*`) — **the only backed source today** | Per-condition **status** (`Active crisis` / `Monitor` / `Stable` / `Referral-managed`) |
| `blood_group` for the patient header if ever wanted | **Versions** — no version, no reviewer, no `reviewed_at`, no supersede chain |
| A student's static bio, updated from the student profile | **Per-round doses** — free text cannot carry `(medication × slot)` |
| — | **Ordered protocol steps**, **triggers**, **external care**, **grants**, **the `on_site_treatable`/`referral_managed` flags** |
| — | Anything **privacy-scoped**: it is behind `requireSchool()` alone (**BL2**) |

**Ruling: prefill from it, never link to it.** A care plan that reads its condition text live from the health record would be silently rewritten by a clerk editing the student profile.

### 8.2 New schema — migration 0058 (maps to N17–N20)

| Table | N# | Shape | Notes |
|---|---|---|---|
| `sickbay_care_plan` | **N17** | `school_id · student_id (composite FK) · condition (chronic_condition_enum) · condition_label · status (new enum) · version smallint · condition_detail · baseline_status · care_goals · goal_signal · red_flags_short · dorm_action · scope_limits · on_site_treatable · referral_managed · protocol_title · reviewed_by_user_id · co_reviewer_note · reviewed_at · superseded_at · superseded_by_user_id · active · created_at` | **Version = a row.** Partial unique `(school_id, student_id, condition) WHERE superseded_at IS NULL AND active` — the R58 partial-unique idiom, so a student may hold two *different* chronic conditions but never two live plans for the same one. `sickbay_care_plan_tenant_uk (school_id, id)` **authored INLINE, before every child FK** (the 0033 hazard / AC S2 — three children target it in this same migration). |
| `sickbay_care_plan_trigger` | **N18a** | `school_id · plan_id (composite FK) · sort_order · label · detail` | serves both `Crisis triggers` and `Sickbay monitoring` bullets |
| `sickbay_care_plan_protocol_step` | **N18b** | `school_id · plan_id · sort_order · heading · heading_em · detail` | free text; **inert** |
| `sickbay_care_plan_medication` | **N18c** | `school_id · plan_id · sort_order · drug_name · form · strength · note · is_prn · prn_dose · prn_criteria · max_per_day` | + a child `…_dose` row per round, or a `(medication, slot_id)` join row: `school_id · medication_id · slot_id (composite FK → sickbay_schedule_slot_tenant_uk, **shipped in 0056**) · dose` — ⚠️ **BL1 blocks this until `resetScheduleSlots` stops hard-DELETEing slot ids.** |
| `sickbay_care_plan_external_care` | **N19a** | `school_id · plan_id · clinical_home_name · clinical_home_abbr · pastoral_home_name · pastoral_contact_name · cadence · next_visit_at · sickbay_role` | 1:1 with the plan version |
| `sickbay_care_plan_external_visit` | **N19b** | `school_id · plan_id (or student_id) · occurred_at · kind · clinician_name TEXT · note · recorded_by_user_id · created_at` | **append-only**, no `updated_at`; **may be future-dated** (the `Scheduled` tag) |
| `sickbay_access_grant` | **N20** | `school_id · student_id (composite FK) · grantee_kind (enum: `USER` \| `STUDENT_HOUSE_HM`) · granted_to_user_id (nullable, single-col SET NULL → global ref_user) · scope (grant_scope_enum) · reason NOT NULL · expires_at · granted_by_user_id · granted_at · revoked_at · revoked_by_user_id` | **Grant is on the STUDENT, not the plan version** — a version bump must not silently revoke every grant. App rule: exactly one of (`granted_to_user_id`, house-derivation) per `grantee_kind`. Partial unique `(school_id, student_id, granted_to_user_id, scope) WHERE revoked_at IS NULL` prevents duplicate live grants. Index `(school_id, granted_to_user_id) WHERE revoked_at IS NULL` for the reader's `EXISTS`. |

**⚠️ The versioning cost, stated:** children hang off the **version** row, so `Edit plan` copies triggers, steps and medications forward. That is the price of `v4` meaning something about the med schedule and not only about the narrative. The alternative (children on a stable plan id) makes the version number a lie. **Kofi's call — recommend children-on-version.**

**Deliberate omissions (continuing the R64/E2 amendment series):** NO `daily_med_schedule_json` (BUILD_STACK's shape — a JSON blob cannot carry the `(school_id, slot_id)` composite FK, cannot be time-ordered, and reproduces the `vitals_json` mistake) · NO `dorm_side_artefact_pdf_file_id` (no file-storage layer exists; the card is derived, not stored) · NO `nhis_card_number` on the plan (D3's shape is INCR-25's, and putting it here presumes the card belongs to the student) · NO stored grant *label* (derived from the enum) · NO stored audit *sentence* (derived by a pure formatter) · NO `next_review_at` (a monthly cadence is policy, not per-plan config).

### 8.3 Element → binding, exhaustively

| Element | Binding | Status |
|---|---|---|
| §01 rows: name, form, house, code | `students` ⨝ `classes` ⨝ `houses` + `formLabel()` | **BACKED** |
| §01 condition pill | `care_plan.condition` (colour) + `.condition_label` (words) | **NEEDS SCHEMA · N17** |
| §01 status pill + filter counts | `care_plan.status` | **NEEDS SCHEMA · N17** |
| §01 daily medication line | derived from `care_plan_medication` | **NEEDS SCHEMA · N18c** |
| §01 `Last visit` timestamp + age | `sickbay_visit.presented_at` (latest, non-void) | **0057 ✓** |
| §01 `admitted now` | open `sickbay_admission` | **0057 ✓** |
| §01 grant count | `count(sickbay_access_grant)` live | **NEEDS SCHEMA · N20** |
| §01 tile `Active crises` | `count(status = ACTIVE_CRISIS)` | **N17** |
| §01 tile `WASSCE candidates` | `wassce_candidates` ⨝ `waec_special_consideration (sc_form='SC-7')` | **BACKED** (shipped) |
| §01 tile `Plans needing review` | `reviewed_at < now − 30d OR IS NULL` | **N17** |
| §01 tile `NHIS coverage` | — | 🔴 **NO CLEAN BINDING → OMIT** |
| §02 patient header identity/house/guardian | `students`, `houses`, `student_guardian` | **BACKED** |
| §02 `age 15` | `students.date_of_birth` | **BACKED** (nullable) |
| §02 `bed S-12-B · lower bunk · near door` | — | 🔴 **NO CLEAN BINDING → OMIT** (R61) |
| §02 `NHIS · active` | — | 🔴 **NO CLEAN BINDING → OMIT** |
| §02 plan rows (condition / triggers / baseline / goals) | N17 + N18a | **NEEDS SCHEMA** |
| §02 version meta `v4 · date · reviewer` | N17 + `ref_user` | **NEEDS SCHEMA** |
| §02 med grid **columns** | `getRoundSchedule(schoolId)` — **shipped frozen contract** | **0056 ✓** |
| §02 med grid **cells** | N18c | **NEEDS SCHEMA** |
| §02 round-timing note | anchor slot's `description` | **0056 ✓** |
| §02 protocol steps | N18b | **NEEDS SCHEMA** |
| §02 dorm card rows | N17 + N18a labels + `student_guardian` + `sickbay_settings.matron_user_id` | **NEEDS SCHEMA + BACKED** |
| §02 NHIS card (5 rows) | — | 🔴 **NO CLEAN BINDING → OMIT** |
| §02 xmod attendance `3 excused days` | `attendance_record` where `reason_code='SICKBAY'` | **BACKED** (22b) |
| §02 xmod boarding / comms | — | **NO BINDING → OMIT** (INCR-26) |
| §03 pastoral handoff (3 fields) | N19a | **NEEDS SCHEMA** |
| §03 plan rows | N17 + N18a | **NEEDS SCHEMA** |
| §03 DMHU visit log | N19b | **NEEDS SCHEMA** |
| §03 `Open VLC case` / case id | — | 🔴 **NO CLEAN BINDING → OMIT** (module unbuilt) |
| §04 grant rows (all 6 columns) | N20 + `ref_user` + `houses.hm_user_id` | **NEEDS SCHEMA** |
| §04 grantee role sub-line | `role_assignments` ⨝ `roles`, or the house derivation | **BACKED** |
| §04 audit rows — writes/grants/status | `audit_log` (`actionType`,`entityType`,`entityId`,`actorUserId`,`actorRole`,`before`,`after`,`reason`,`occurredAt`) | **BACKED** (shipped, no schema change) |
| §04 audit rows — **`View` / `Export`** | `audit_log` with `actionType='viewed'/'exported'` | **PARTIALLY BACKED — the TABLE fits, the BEHAVIOUR is new** (§7.6) |
| §04 `Retention: 7 years` | — | 🔴 **NO MACHINERY → OMIT** (D5) |

---

## 9. Per-mode matrix — FULL / FIRST_AID / **REFERRAL_ONLY**

`capabilities` from the shipped `sickbayCapabilities(mode)` — never re-derived, never stored (R4). **A and B are capability-identical** (AC A2); nothing below branches on A-vs-B.

> 🔴 **Mode C is ~49 % of public SHS and the chronic register is one of the THREE things R4 says Mode C KEEPS** (with referrals and parent notifications). **This surface matters more to a Mode-C school than to a Mode-A one** — it is the only clinical artefact they have. It is not a degraded view; it is the product.

| Element | **A · FULL** | **B · FIRST_AID** | **C · REFERRAL_ONLY** |
|---|---|---|---|
| §01 list, filters, table, row order | yes | yes | **yes — identical** |
| §01 `Daily medication` column | yes | yes | **yes** — but it is what the student *takes*, not what the matron *dispenses*. The header stays `Daily medication`; nothing implies dispensing |
| §01 tiles (crises / review / WASSCE) | yes | yes | **yes — identical.** A crisis and an overdue review are mode-independent facts |
| §02 patient header, plan details, triggers, baseline, goals | yes | yes | **yes — identical** |
| **§02 medication GRID** | `grid-cols-[160px_repeat(3,1fr)_1fr]` from the 3 canonical rounds + PRN | same | 🔴 **NOT A GRID.** Mode C has **no `MEDICATION_ROUND` slots and no anchor** (R16). Render a **medication LIST**: `{drug} · {form} · {strength}` + a free-text `frequency` + the PRN flag. **Not a grid with zero columns, not a greyed grid, not `—` across empty round columns.** |
| §02 card meta `Dispensed by matron · round-by-round` | yes | yes | **re-authored:** `Prescribed medication · self-administered or home-supplied` (AUTHORED) |
| §02 round-timing note | anchor slot's description | same | **ABSENT** — it describes rounds that do not exist |
| **§02 escalation protocol** | yes | yes | **yes — and it matters MORE here.** A school with no beds escalates earlier. The steps are free text authored by the school, so a Mode-C school writes its own step 2; **no mode branching on protocol content**, and no seeded template that presumes an admit step |
| §02 dorm-side artefact | yes | yes | **yes — arguably the most important element in Mode C**, where the housemaster IS the clinical front line (BUILD_STACK #1: 59 % of sickbay-less schools appoint health prefects). The `Daily med` row renders whatever the plan says instead of a round time |
| §02 `Print dorm copy` | yes | yes | **yes** |
| §02 NHIS card | *(omitted in all modes)* | | |
| §02 xmod attendance card | yes | yes | **yes** — Mode C cannot ADMIT (R55) but **REFER still writes `M`** (R46), so the count is real; the copy must not say *"days admitted"* |
| §03 mental health, in full | yes | yes | **yes — identical.** Referral-managed care is mode-independent by definition |
| **§04 grants + audit** | yes | yes | **yes — bit-for-bit identical.** Grants are about disclosure, not capacity. This is the one surface in module 4.4 with **no mode branching at all** |
| Mode-C explanatory panel | — | — | 🔴 **NONE.** R89 settled this on the board and the reasoning holds harder here: the register is not empty in Mode C, it is *complete*. A panel explaining the school has no beds, on a surface that never mentions beds, is noise. |
| `configured === false` notice | — | — | **YES** — the same shipped `NOT_CONFIGURED` dashed panel above the list (R89's adopted half): a coalesced `REFERRAL_ONLY` is not a declared Mode C |

### 9.1 Mode C — what must be OMITTED rather than placeholdered

| Never render in Mode C | Not even as |
|---|---|
| Round columns in the med schedule | `—` cells, greyed columns, `0 rounds`, a disabled grid |
| The round-timing note | a "no rounds configured" line |
| `Dispensed by matron` | a struck-through label |
| Any round time, anywhere, including inside copy | a hardcoded `06:30` |
| A bed reference in a protocol step | — *(the step is free text; the school writes its own)* |

---

## 10. Medical-PII classification — per element

### 10.1 Classes present on this surface

| Class | Elements | Tier |
|---|---|---|
| **1 · Identity + care-plan existence** | names, form, House, student code, avatar, grant count, `admitted now` | 1–2 |
| **2 · Condition family** | condition pill + label, `.chronic-flag`, `condition` on the dorm card, scope-pill `Full plan` on a life-threatening condition | 3 |
| **3 · Clinical measurements & labs** | `Hb 7.8 g/dL`, `HbF 11.2%`, `HbA1c 7.4%`, `pain ≥4/10`, `fever >38.5°C`, `O₂ sat <95%` | 4 |
| **4 · Drug names, doses, schedules** | Hydroxyurea, folic acid, Penicillin V, paracetamol, ibuprofen, ORS, beclomethasone, salbutamol, carbamazepine, NovoMix 30, epi-pen, glucagon | 4 |
| **5 · Family history about a third party** | `maternal aunt deceased age 19 from acute chest syndrome` | 4 |
| **6 · External clinicians & facilities** | `Dr Asare-Mensah (KATH paediatric haematology)`, `Dr Owusu-Ansah`, `Asankrangwa Govt Hospital`, `KATH Kumasi`, `Dr K. Boateng, psychiatrist`, `Asankrangwa DMHU` | 4–5 |
| **7 · Contact details** | parent phone, matron phone, KATH switchboard, counsellor phone | 3 |
| **8 · Reproductive / bodily specifics** | `priapism (boys)` in the red-flag list | 4 |
| **9 · MENTAL HEALTH** | see §10.2 | **5 — a distinct tier (R42)** |
| **10 · Access metadata** | who holds a grant, why, when, who read what and when | 3 — *because it re-identifies class 2 by inference* |

### 10.2 🔴 Mental health — every element that discloses it, **including by implication**

R42: *"at 23 the HEADMASTER default does NOT extend to `MENTAL_HEALTH` (grant-only) — a longitudinal psychiatric label is not operational information for a headmaster."* That is the rule. These thirteen are the ways the rule leaks if only the obvious field is protected.

| # | Vector | Element | Ruling |
|---|---|---|---|
| **M1** | **By name** | `Anxiety · referral-managed` condition pill; `adjustment disorder with anxiety features`; `bereavement (father, Feb 2026)` | row hidden from non-scoped readers (§4.4) |
| **M2** | **By status** | `Referral-managed` status pill — in a register where MH is the only referral-managed family, the status *is* the diagnosis | hidden with the row; and the status remains legitimate for non-MH plans, so it is not dropped from the enum |
| **M3** | **By count** | filter pill `Referral-managed 1`; lede `6 active` vs a HEADMASTER's five | 🔴 **all counts computed over the reader's visible set; zero-count buckets do not render; no "hidden row" affordance ever** (C8) |
| **M4** | **By schedule gap** | `no on-site medication` in the Daily medication column — an explicit absence in a column whose premise is presence | 🔴 **render the cell EMPTY for a MH row** (C4). An empty cell is ambiguous; `no on-site medication` is not |
| **M5** | **By destination** | `monthly Asankrangwa DMHU clinic`; `Asankrangwa District Mental Health Unit`; `DMHU` pill | sub-line dropped from the list (C3); the full names render only inside the scoped detail page |
| **M6** | **By visit reason** | `Last visit … 12 days ago · DMHU visit` | reason clause dropped from the list entirely (C5) |
| **M7** | **By scope vocabulary** | grant pill `Pastoral-only` | 🔴 collapsed into the neutral `Alert only` (§7.3). A scope name that identifies a condition family is a disclosure channel with a UI control attached |
| **M8** | **By grantee identity** | the HM-grants avatar stack; the grant reason `sees only "VLC pastoral active · refer to Mrs Owusu"` — a counsellor's name beside a student | stack dropped (C6); reason descriptor dropped (§7.4); reason column visible only to `MATRON` + the grantee |
| **M9** | **By audit row** | `Mrs N. Owusu (VLC counsellor) viewed J. Manu · pastoral cross-reference` — the accountability instrument disclosing what it protects | 🔴 **audit rows about a MH plan render only to readers who can see that plan** (C14) |
| **M10** | **By route** | a `/pastoral/` URL segment, or a distinct route for §03 | 🔴 **one detail route for all conditions.** `pastoral` stays editorial/CSS only, per repo convention |
| **M11** | **By colour** | `.condition-pill.mental` navy — identifiable across a room without reading | accepted (the pill only renders to a scoped reader), recorded so nobody adds a *second* MH-specific visual token elsewhere |
| **M12** | **By printed artefact** | a dorm-side card naming a psychiatric condition, posted in a cabinet, permanently, with no revocation path | 🔴 **NO CARD EXISTS for a MH plan** (C13) — the artefact and the `Print dorm copy` action are both absent |
| **M13** | **By drug (forward)** | no MH drug appears today (*"Not on medication"*), but the moment one does, the drug name is the diagnosis — INCR-24's MAR and INCR-21's stock table (`Hydroxyurea 500mg · for Adwoa Mensa`, Risk 4) are the live precedent | **recorded forward:** a per-student drug row leaks a diagnosis through an inventory table. INCR-24 must not render a psychotropic beside a name outside the scoped detail page |

### 10.3 The parent boundary

**D8: a parent never sees sickbay in module 4.4.** Every 0058 table is `parent_deny` automatically (catalog-driven). No portal view, no digest, no "your child has a care plan" notification. The shipped inert parent "Sickbay" tab stays inert.

---

## 11. Interaction states

| State | §01 list | §02/§03 detail | §04 grants + audit |
|---|---|---|---|
| **Loading** | optional `loading.tsx`, row skeletons at `62px`, tile skeletons at `92px` | card skeletons at real heights (plan `320px`, med grid `{rows}×44px`, protocol `380px`) | grant rows `54px`, audit rows `58px` |
| **Empty · no plans** | `No chronic care plans on the register yet.` + (`MATRON`) `Add the first one →` | n/a | n/a |
| **Empty · no medications** | — | `No scheduled medication on this plan.` | — |
| **Empty · no protocol** | — | **the whole `.protocol-block` is absent** — a bordered terra block containing "no steps" is an alarm about nothing | — |
| **Empty · no triggers** | — | the `Crisis triggers` row is absent (a `.plan-row` with an empty value is a broken row) | — |
| **Empty · no external care** | — | the pastoral block + DMHU card are absent | — |
| **Empty · no grants** | row shows `No grants` | — | `No access has been granted yet. Only you and the Headmaster can see these records.` (AUTHORED, `MATRON` wording) |
| **Empty · no audit events** | — | — | `No activity in the last 24 hours.` (AUTHORED) |
| **Populated** | as mapped | as mapped | as mapped |
| **🔴 Revoked grant** | the student's grant count drops | **the grantee's next request 404s** — `notFound()`, not a "your access was revoked" panel. A revocation message confirms the record exists, which is the fact the revocation removed | row stays with the `Revoked` pill + date, action disabled, greyed at `opacity-60`; **the original grant row stays in the audit trail** (*"Append-only is real. If a grant was made in error, the action is 'revoke' — the original grant stays in the trail."*) |
| **🔴 Expired grant** | same | same — expiry is evaluated **server-side, per request**, never cached in a session claim | row renders `{date} · expired` in `text-navy-3`, action disabled |
| **Scope-limited read (`PARTIAL`)** | list not reachable | **only the dorm card renders** — the page is the card, with the patient header. No hidden sections, no "more available" affordance, no collapsed accordion | grants page not reachable |
| **Scope-limited read (`ALERT_ONLY`)** | not reachable | one line: `{Student} has a care plan on file. Call the matron if she is unwell.` + the matron's number | not reachable |
| **MH plan · unscoped HEADMASTER** | **row absent** | `notFound()` — never `ClinicalRestricted`, which would confirm the record exists | audit rows about that plan absent |
| **ADMIN** | `<ClinicalRestricted crumb="Chronic register" />`, **no fetch** | same | same |
| **Read-only actor (HEADMASTER)** | `+ Add student` absent; rows still link | `Edit plan` absent; `Print dorm copy` **present** (reading is his right; printing is an audited export he may legitimately make) | `+ Grant access` and every `Revoke` absent; the trail renders |
| **Error (read)** | throw to the route error boundary — no bespoke clinical error card | same | same |
| **Error (write)** | `+ Add student` failure renders the action's **named** error inline above the form | `Edit plan` save failure keeps the form populated; a version is never partially written | grant/revoke failure renders inline in the row; the row does not disappear |
| **Concurrent edit** | — | 🔴 two matrons saving v4 simultaneously: the partial unique on `(school_id, student_id, condition) WHERE superseded_at IS NULL` **rejects the second at the DB** (the R58 idiom — never an app check, which loses the race). Named error: `This plan was revised by {name} a moment ago. Reload to edit the current version.` (AUTHORED) | — |
| **Refresh** | none — `force-dynamic` + the browser's own reload | same | same |

---

## 12. Responsive & PWA

**The surface declares ONE media query** (`max-width:1280px`, lines 311–319): `.layout` → 1 col, `.col-2` → 1 col, `.xmod-strip` → 1 col, `.patient-header` → 1 col with `.patient-flags` becoming a horizontal row, **`.med-schedule` → `grid-template-columns:1fr`**, `.pb-handoff` → 1 col. Everything narrower is AUTHORED.

| Width | §01 | §02/§03 | §04 |
|---|---|---|---|
| **≥ 1280** | table 5 cols; tiles `grid-cols-2/3` | `col-2` two-up (artefact + *what was NHIS* → now full-width artefact); med grid full | tables as specced |
| **768–1279** | table survives (5 cols fit); tiles 2-up | patient header stacks, flags go horizontal; **med grid → 1 col per the surface's own rule**: each medication becomes a stacked block with its round doses as labelled rows | grant table: `Reason` column wraps |
| **< 768 (PWA / phone)** | 🔴 **rows become stacked cards** — name + form/house line 1, condition + status pills line 2, medication line 3, last-visit + grant count line 4, whole card tappable. **Never horizontally scroll a clinical table.** Filter pills scroll horizontally with `overflow-x-auto` | med grid: one block per drug, `{round label} · {dose}` rows; protocol steps stack (`.ep-num` above the body); dorm card full-width — **it is the artefact most likely to be read on a phone** | 🔴 **grant rows become stacked cards** — grantee + role line 1, student + scope line 2, expiry line 3, reason line 4, `Revoke` **full-width, min 44px**. Audit rows: time + tag on line 1 (tag right-aligned), event text on line 2 |
| **Print** (`@media print`) | — | 🔴 **the dorm-card print route**: the card alone, `border-none`, no app chrome, no nav, no other section. One card per page. This is the only print stylesheet in the module | — |

**PWA:** the matron's device is a phone; the housemaster's `PARTIAL` view is *certainly* a phone. There is no offline write here. *Skipped: an offline cache of care plans — add when a matron actually loses a plan to signal, not before. And note the obvious counter-argument: a cached care plan is a medical record sitting in a phone's storage after a grant is revoked.*

---

## 13. Fabricated demo content — never build these as data shapes

| F# | Item | Where | Verdict |
|---|---|---|---|
| **F1** | 🔴 **`Wed 14 May 2026` is a THURSDAY** — the audit trail asserts it five times (`14:42`, `13:17`, `12:50`, `09:18`, `07:32` all tagged `Wed 14 May`), and `Tue 13 May` / `Mon 12 May` inherit the same off-by-one | §04 | Already ruled at 22c (R90/F7). **Derive every weekday**; the string must not appear in any expected-copy fixture, or the character-exact copy method would enshrine the error |
| **F2** | 🔴 **A cast that contradicts every other surface.** This file's six are `Adwoa Mensa` · `Kofi Asante` · `Akua Owusu` · `Yaw Boateng` · `J. Manu` · `Esi Antwi`. The today board's queue is `K. Asante` · `P. Owusu` · `Y. Boateng`; its log is six *other* names. `Kofi Asante` here is `F2 SCI · Aggrey`; on the board `K. Asante` is `F2 SCI · Aggrey House` ✓ — but `Yaw Boateng` here is `F1 BUS · Kufuor` and on the board `Y. Boateng` is `F1 BUS · Kufuor House` ✓ while `Akua Owusu` here is `F3 GA · Slessor` and the board's `P. Owusu` is `F3 GA · Slessor House` — **a different first initial for the same row** | everywhere | All names derive from `students`. The contradictions cannot survive a join |
| **F3** | 🔴 **Adwoa Mensa is a fourth different patient here.** This file: `F1 SCI`, code `AS-2024-F1-0089`, `age 15`, Slessor, bed `S-12-B`. The board: `F1 General Arts`, `Adm. #2025/F1/0214`, bed 3. The visit record: `F1 SCI`, `AS-2024-F1-0089`. **Two of the four disagree with each other on programme AND code** | §01/§02 | One `formLabel()`, one `student_code`, one row |
| **F4** | **Adwoa Mensa is not in the dev seed** (nearest: *Abena Mensah*). Neither are `Kofi Asante`, `Akua Owusu`, `Yaw Boateng`, `J. Manu`, `Esi Antwi` | everywhere | Never hardcode, never seed "her" to match code. A demo patient is a **seed** task |
| **F5** | **Houses `Kufuor` and `Nkrumah` are not seeded** (seed: Aggrey · Guggisberg · Fraser · Slessor · Kingsley · Aryee) | §01 | Houses are read, never named in code |
| **F6** | 🔴 **Three contradictory round schedules across the module, and this file holds the losing one**: `06:30/13:00/21:00` (this grid) vs `06:30/12:30/21:00` (setup, canonical) vs `06:30/12:30/17:00/21:00` (today §02) | §02 grid | **R13: the setup rows win.** Nothing here hardcodes a round time — the grid columns come from `getRoundSchedule()` |
| **F7** | 🔴 **`13 active grants` vs a table of 13 rows of which ONE is `Removed`** — so 12 are active. The head-card meta compounds it: `13 grants · 8 unique staff`, while the table lists **10 distinct people** (E. Akoto ×3, J. Osei ×2, + S. Henneh, D. Kufuor, P. Essien, P. Kwakye, Y. Kwaku, Mr Boampong, C. Tetteh, N. Wiafe = 12 names, 12 unique) | §04 | **Derive every count.** Counter drift is this module's signature defect (setup §03's "3 reorder alerts" over a 2-alert table; the board's `5 visits` over a 4-discharge table) |
| **F8** | **`11 events · append-only` over an 11-row list ✓** — the one tally in the file that checks out | §04 | recorded, because it is the exception |
| **F9** | **`4 default-access staff (Matron, HM, Deputy Welfare, School Nurse)`** — two of the four roles do not exist | §04 lede + §01 banner | Re-authored (§3.2, §7.1) |
| **F10** | **Nine access-level labels against a three-value enum**, six of them sharing one CSS class | §04 | Three scopes (§7.3) |
| **F11** | **A student holds a medical access grant** (`P. Kwakye · Senior prefect`) | §04 | **Omit the row and the shape** (Sarah gate) |
| **F12** | **A grantee with no plausible login** (`C. Tetteh · Catering supervisor`, expiry `standing`) | §04 | Grantees are `ref_user` holders with a role assignment in this school |
| **F13** | **`HM · Slessor was`** — a literal typo in the role sub-line | §04 line 1138 | The sub-line is derived; it cannot survive |
| **F14** | **`no relation to Headmaster`** — a joke about a fabricated name collision, inside a clinical baseline paragraph | §02 | Must not appear in any seed or fixture |
| **F15** | **`2 of 5 terms achieved`, `Hydroxyurea adherence 97%`, `0 exposures this semester`, `HbA1c 7.4%`, `3 excused days`** — five counters, of which **only `3 excused days` is derivable** | §01/§02 | The other four live inside free text as the matron wrote them. Never derive `adherence 97%` without a definition (INCR-24) |
| **F16** | **`auto-printed every term`** — nothing schedules a print | §02 artefact sub-line | Re-authored to `reprint on every plan revision` |
| **F17** | **`Retention: 7 years after student leaves the school per GES records policy`** — a policy claim with no machinery | §04 save bar | Omit (D5) |
| **F18** | **`bed S-12-B · lower bunk · near door`** — exceeds `boarding_bunk`'s shape, twice (header + dorm card) | §02 | Omit (R61, unchanged from 22) |
| **F19** | **`VLC Case 2024-VLC-0047`** — an id into an unbuilt module | §03 | Omit |
| **F20** | **`Dr K. Boateng`** the DMHU psychiatrist vs **`K. Boateng`** a *student* in the referral log's active-referral cast | §03 vs referral log | Coincidence in the demo; a reminder that clinician names are TEXT and never resolve against `ref_user` or `students` |
| **F21** | **`.adwoa-block`-style naming does not recur here**, but `.pastoral-block` is a CSS class named after the editorial term the nav must not use | §03 | Fine in CSS (repo convention); never a label, never a route |

---

## 14. Omit-not-fake register (for the PR body)

| Omitted | Why | Reinstatement trigger |
|---|---|---|
| Every NHIS element (card, tile, patient flag, coverage lists, YTD cost) | no field; D3's shape ruling is 25's; YTD implies a cost ledger D6 blocks | INCR-25 |
| `Export PDF` (§01) / `Export grant log` (§04) / `Export 30-day log` (§04) | each carries a durable, un-revocable disclosure map out of the room and out of the gate | an owner-approved export design |
| `Sort · last visit ↓` | six rows need no sort; the surface's own rows contradict its label | a register that outgrows one screen |
| §01 medication sub-lines | no common binding; two are disclosures | never |
| §01 `Last visit` reason clause | A12 reapplied; unbindable | never |
| §01 HM-grant avatar stack | N+1 read + grantee re-identification | never (the count and the grants page cover it) |
| §01 `NHIS coverage` tile | unbacked | INCR-25 |
| Tile sub-lines naming students | A2 one-name rule | never |
| `next monthly review {date}` (lede + tile) | nothing schedules a review | a real review scheduler |
| `Deputy Head (Welfare)` + `School Nurse` from the default-access set | roles do not exist | a new role, or never |
| `scoped per field` from the privacy banner | three whole-projection scopes, not per-field | a per-field scope model (not recommended) |
| `View visit history` action | no per-student history route exists | INCR-27 |
| `bed S-12-B · lower bunk · near door` | exceeds `boarding_bunk` | never |
| `NHIS · active` patient flag | unbacked | INCR-25 |
| Boarding + Communications xmod cards | no notification row; asserting "SMS within 5min" claims a message nothing sends | INCR-26 |
| `Open VLC case` + `VLC Case 2024-VLC-0047` + `VLC` as a rendered word | module unbuilt; never a dead link | VLC |
| Six of the nine grant scope labels | a per-fact allow-list the DB will not enforce; the real need is a catering/PE list, not a medical grant | a separate dietary/restriction feature |
| The `Senior prefect` grant row **and shape** | a student reading another student's clinical record | never |
| The `Bursar` / `Catering supervisor` grant rows | grant-to-a-non-user is unresolvable | a non-user grantee model (not recommended) |
| Per-row scope descriptors in the grants table (`seizure protocol`, `anaphylaxis protocol`, `diabetic protocol`, `pastoral handoff`…) | nine condition disclosures in one column, visible to readers holding no grant | never |
| `tied to VLC case` expiry | a dependency on an unbuilt module | VLC |
| `Retention: 7 years…` | no machinery; D5 deferred | D5 + a retention job |
| **A dorm-side card for a mental-health plan** | a permanent physical disclosure with no revocation path | **never** |
| Medication **administration** anywhere (given/missed/witness) | 0058 authors the schedule, not the event | INCR-24 |

**Nothing in this list is placeholdered.** No `LIGHT·PLACEHOLDER` badges, no greyed mock rows, no `0 of 6`, no `—` standing in for an unrecorded clinical value, **no disabled control standing in for a capability the school does not have** — and, new at 23, **no affordance that hints a hidden row exists**.

---

## 15. Cross-module hooks — design commitments preserved

| Hook | On this surface | Status at 23 |
|---|---|---|
| **sickbay → attendance "M"** | the xmod card (`Class teachers see "M" not "A"`, `{n} excused days`) | shipped at 22b; 23 **reads** the count, writes nothing. `attendance_record.note` stays `null` (A7) and no `M` chip renders on the register |
| **sickbay config → the med grid** | grid columns from `getRoundSchedule()` | the config spine's **third** consumer. ⚠️ **BL1**: the slot-id FK makes `resetScheduleSlots`'s hard DELETE a 23 blocker |
| **boarding → House + housemaster** | every row's house; **house-role grants derive from `houses.hm_user_id`**; the dorm card | live reads. The house-role grantee kind is what makes *"grants auto-transfer to the new HM"* true |
| **boarding → bunk** | `bed S-12-B` | **omitted** — B1 stands: never conflate a sickbay bed, a dorm bunk and a free-text bed string |
| **chronic register → WASSCE SC-7** | the `WASSCE candidates` tile + `Examination accommodations for end-of-term` | ✅ **the one genuinely backed cross-module read on this surface** — `wassce_candidates` ⨝ `waec_special_consideration (sc_form='SC-7')`. Count only, no names |
| **chronic register → the visit record** | `View visit history`, `Last visit` column | the column is a live read of `sickbay_visit`; the action is deferred (§5.1) |
| **chronic register → the today board** | — | 🔴 **see §16/Q3** — what the queue and the patient header may now show |
| **chronic register → MAR / rounds** | `care_plan_medication × slot` | **this table is the source of INCR-24's round roster** (*"When a round fires, Adwoa's entries appear in the round task list automatically"*). 0058 authors the schedule; 24 fires it |
| **chronic register → discharge criteria** | — | R63 deferred the structured criterion instance to 23 *"because per-condition templates arrive with the chronic register"*. ⚠️ **Not built at 23 either** — the criterion instance belongs to an *admission*, and 23 has no admission surface. Recorded so INCR-24/25 knows the template source now exists |
| **chronic register → referrals** | protocol steps 4/5 name hospitals as **text** | INCR-25 introduces `sickbay_hospital` (N6); the steps stay text (R60's copied-name precedent) |
| **chronic register → notifications** | protocol step 3's `SMS within 1hr` | INCR-26. The step is **inert prose**, not a trigger |
| **chronic register → billing** | `YTD school cost`, the Bursar grant | **omitted** — D6 blocks the sickbay→billing write |
| **sickbay stock → the register** | `Hydroxyurea 500mg · sickle cell chronic · for Adwoa Mensa` (setup §03) | ⚠️ **Risk 4's canonical example: a diagnosis leaking through an inventory table.** INCR-24 must not render a per-student drug row outside the scoped detail page. **Recorded here because the register is the thing it leaks** |
| **register → VLC** | pastoral home, counsellor, case link | VLC unbuilt; ship the fields, never the link |

---

## 16. Open questions

| # | Question | Owner | Blocks |
|---|---|---|---|
| **Q1** | 🔴 **BL1 — `resetScheduleSlots`'s hard DELETE must be fixed BEFORE 0058**, because `care_plan_medication` carries a `(school_id, slot_id)` FK one migration earlier than the board's INCR-24 obligation assumed. Confirm the promotion | Kofi + Wells | 0058 |
| **Q2** | 🔴 **BL2 — the shipped student profile renders `Conditions`/`Medications`/`Allergies` behind `requireSchool()` alone**, contradicting the privacy banner. Gate that block, or re-author the banner? | Owner + Sarah | §3.2 copy |
| **Q3** | 🔴 **What may the queue and the patient header show now that the register exists?** At 22c I killed `No chronic flag` as a false negative *"against a register that did not exist"*. It exists at 23. My ruling: the queue may render a **neutral marker** — `Care plan on file` (AUTHORED), **positive only, never its negation, never the condition, never a drug** — and only for a plan the reader is scoped to see. **A blank cell must never mean "no plan"**; it means "nothing to say here", which is the whole point. The visit record's patient header may render the **`.chronic-flag` condition pill** (A3's reinstatement trigger was *"INCR-23 — visit record only, never this board"*). 🔴 **The today board's bed tile, live tile and §03 log stay exactly as ruled — A1/A2/A12/A13 are NOT reopened.** Confirm | Kofi | the queue projection + `SickbayWardPatient` |
| **Q4** | **Module gate: widen `SICKBAY_ROLES` for grant holders (option A) or author a second route (B)?** A grant cannot help someone the route rejects (Sarah's carried item 1). Recommend A | Kofi | §1.2 |
| **Q5** | **Version children: copy-forward on every version bump (recommended), or children on a stable plan id?** The first costs duplication; the second makes `v4` a lie about the med schedule | Kofi | §8.2 |
| **Q6** | **Phone masking (C11).** The inventory called masking a design commitment; the dorm card makes it incoherent (a card whose purpose is "who to call" cannot mask the number). Recommend: **no masking layer; the grant decides field access.** Confirm | Owner + Sarah | §5.6, §5.5 |
| **Q7** | **`Print dorm copy`: a print-stylesheet route (recommended) or a real PDF** (the repo has a receipt-PDF precedent)? And is an audit row on *intent to print* honest enough? | Owner | §5.6 |
| **Q8** | **Three scopes, not nine (§7.3).** Confirm the five one-fact labels are omitted and that the kitchen/PE need is a different feature | Owner + Kofi | §7.3, §7.4 |
| **Q9** | **The house-role grantee kind.** Ship it (making *"auto-transfer"* true), or ship user-id grants only and delete the claim from the copy? | Kofi | §7.2, §7.4 |
| **Q10** | **The grants table's `Reason` column** is visible to every reader of §04 and three drawn reasons name a condition. Recommend: reason renders to `MATRON` + the grantee only. Confirm, or drop the column for non-matron readers | Sarah | §7.4 |
| **Q11** | **Read-audit scope (§7.6)** — detail opens only, deduped per (actor × student × day), best-effort, outside the read tx. Confirm; and confirm the retention sentence is omitted pending D5 | Kofi + Dex + Wells | §7.6 |
| **Q12** | **Sarah ADV-1 carried from 22c** (still open, and it is a *design* question): with four admitted patients the board's tile says `4 on the ward` while four full names and four vitals grids stack below. Not this surface's problem, but it is on my desk | Lucy + Kofi | today board |
| **Q13** | **AUTHORED copy needing sign-off:** `No chronic care plans on the register yet.` · `Add the first one →` · `No grants` · `{n} with SC-7 accommodations on file` · `No scheduled medication on this plan.` · `Prescribed medication · self-administered or home-supplied` · `Round timing rule.` / `Meds are recorded at the round, not retrospectively.` · `reprint on every plan revision` · `plan version v1 · not yet reviewed` · `Alert only` · `This student has a care plan on file. Call the matron if she is unwell.` · `No access has been granted yet. Only you and the Headmaster can see these records.` · `No activity in the last 24 hours.` · `No external visits logged yet.` · `Revoke {Name}'s access to {Student}'s care plan? The grant stays in the audit trail.` · `This plan was revised by {name} a moment ago. Reload to edit the current version.` · `Care plan on file` · `View grants ›` · the re-authored privacy banner + the R42 sentence · the re-authored §04 lede · the re-authored save bar | Owner | copy review before merge |
