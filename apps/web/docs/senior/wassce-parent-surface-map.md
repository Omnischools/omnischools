# WASSCE Parent-Tracker — Surface Map (INCR-19 · Module 4.3)

**Author:** Lucy (design cartographer) · **Status:** design spec, ready for the implementation engineer (Claude Code).
**Increment:** INCR-19 — *Parent-tracker* · **no new migration** (build-plan line 2077/2080: "none new; **parent-scoped RLS policy** (prod-paste)") · depends on INCR-17 (0053) + INCR-17b (0054) · **Parent-facing capstone (read-only, one child).**
**Scope of THIS map:** the WHOLE of `Surfaces/schoolup-wassce-parent-tracker.html` — all five editorial sections, one parent app frame, one child.

> **This is the FIRST parent-facing surface in the product.** Every prior surface (INCR-15…18, ledger, boarding, sickbay-adjacent) is staff-only. Two things follow, and they govern this entire map:
> 1. **The reader is a parent, not a teacher.** Density, vocabulary and assumed knowledge all drop. The FAQ and the "what the school is doing for you" explainer are **load-bearing product**, not filler — they are the only place several staff terms get translated. Part I is the jargon register.
> 2. **A parent must see ONE child and NOTHING else.** Part H is a **hard boundary**, not a preference. Every element below is tagged **[CHILD]** (this-child-only) or **[REF]** (global/school reference, non-comparative). **There is no third tag** — nothing on this surface may bind to cohort or comparative data, and Part H names the four places an implementer could accidentally reach it.

## Source surface (visual source of truth — replicate 1:1)

| Surface file | Role | Sections in scope |
|---|---|---|
| `Surfaces/schoolup-wassce-parent-tracker.html` | **PRIMARY and ONLY.** A. Aidoo (mother) viewing Yaa Aidoo, Wed 14 May 2026 14:45 GMT. | **ALL of §1–§5** (lines 208–942). Five editorial sections = **five body regions of ONE parent page**, not five pages (see §0.5). |

**Tables this map READS (every one read-only — see Part J: the surface contains ZERO writes):**
`wassce_candidates` · `wassce_candidate_subject` · `wassce_subjects` · `wassce_programmes` · `wassce_papers` · `wassce_paper_sittings` · `waec_special_consideration` · `readiness_statements` · `university_targets` + GLOBAL `universities`/`university_programmes` · `students` · `student_guardian` · `houses` · `staff`/`role_assignment` (contact names) · `notification_log` (partial — see Part K). **Derived-on-read via existing pure libs:** `lib/wassce/projection.ts` (the aggregate), `lib/wassce/university-match.ts` (`matchMargin`, `MATCH_TIER_LABEL`, `cutOffLabel`). **No new table, no new enum, no trigger. Nothing on this surface writes.**

## Explicitly OUT of scope (noted, NOT mapped)

| Item | Owner | Why out |
|---|---|---|
| The other five parent-nav tabs (`Sickbay` · `Communications` · `Billing` · `Boarding` · `School calendar`) | later parent increments / 4.4 | Rendered as **nav chrome only** (§0.6). Only `WASSCE` is built. |
| Cohort-readiness (distribution, at-risk list, heatmap) | INCR-18 (shipped, staff-only) | **Hard boundary — Part H.** A parent must not be able to reach it at all. |
| Student-readiness deep-dive (7 staff sections) | INCR-20 | The staff twin of this data. Do NOT reuse its comment/benchmark components here (Part H.3). |
| Sickbay clinical record (ward, bed, treatment, ward rounds, NHIS itemisation) | **4.4 — NOT BUILT** | The surface shows all of it. **No binding exists** (Part K.2). |
| Phone-call logging (channel, direction, duration) | **no table exists** | Part K.1. |

---

# §0 — Shared chrome, tokens, type & no-alpha discipline

## 0.1 Tokens — identical `:root` to INCR-15/16/17/17b/18

The surface declares the **same palette** as every prior WASSCE surface (identical hexes to `design-tokens.json` v1.0.0). **Reuse the INCR-15 token→Tailwind table** (`docs/senior/wassce-spine-surface-map.md` §0.1) — do not re-derive.

`font-display` = **Fraunces** (headlines, child name, paper names, card titles, step dots, the `Q.`/`A.` FAQ prefixes, avatars, section nums); `font-body` = **Manrope** (all body, labels, pills, meta); `font-mono` = **JetBrains Mono** (the comms timestamps `06:52`/`11:32`, the WAEC ref `SC-12-184-2026-0044` — **note the surface does NOT set mono on the index number / NHIS number here**, unlike the staff surfaces; see Part O.3). Empty/missing = em-dash `—` in `text-navy-3`, never `0`/`N/A`.

**Base type is 14px** (`html,body { font-size:14px }`) — same as staff. The parent body is **narrower**: `.parent-body { max-width:980px; margin:0 auto }` vs the staff `.body-shell` full width.

## 0.2 Bespoke colours introduced/reused here (NOT tokens — flag)

| Value | Where | Status |
|---|---|---|
| `#8B3829` (dark terra) | `.status-hero` gradient tail `linear-gradient(135deg,#B84A39,#8B3829)` | **already flagged** INCR-17 §0.3 — reuse the same constant |
| `#F5D4C9` (light terra) | `.sh-headline em` | already flagged INCR-17 |
| `#FFD4C9` (pale terra) | `.sh-live-dot` + its pulse ring | already flagged INCR-17 |
| `#FBEBE7` (pale terra tint) | `.paper-row.missed` row bg | same hex as the staff `.sch-row.missed` — **reuse, do not re-hex** |
| `#E5F0EB` bg / `#1E5A35` text | `.cc-pill` (Science programme) | **DRIFT (known):** INCR-15's Science programme pill is terra-tinted; here it is green-tinted, exactly as INCR-17 §0.3 flagged on the identity card. Reconcile ONCE across both — Part O.1. |
| `#E5EAF2` bg / `var(--navy)` text | `.info-icon.waec` | same bespoke blue-grey as the SAFETY match pill + Slessor House pill. Reuse. |

## 0.3 No-alpha discipline — EVERY translucency on this surface (repo memory `no-alpha-token-opacity`)

The surface hand-writes `rgba()` / `opacity` — fine as authored. **The trap is the Tailwind port:** slash-opacity on a raw-hex token (`text-bg/70`, `bg-navy/80`) **silently renders nothing**. **Verify in the live preview, not the build.** This surface is the **most alpha-dense in the module** — the hero card alone has nine.

| Element | Raw value | Port to |
|---|---|---|
| `.browser-bar .dots span` | `rgba(255,255,255,0.18)` | cosmetic — `bg-[rgba(255,255,255,0.18)]` |
| `.browser-bar .url` | `rgba(255,255,255,0.08)` | `bg-[rgba(255,255,255,0.08)]` |
| `.status-hero` shadow | `rgba(184,74,57,0.4)` | decorative — arbitrary rgba or drop |
| `.sh-eyebrow` | `opacity:0.75` | **`opacity-75`** (NOT `text-bg/75`) |
| `.sh-live` | `rgba(255,255,255,0.14)` | `bg-[rgba(255,255,255,0.14)]` |
| `.sh-live-dot` pulse ring | `rgba(255,212,201,0.7 → 0)` keyframe | decorative pulse — arbitrary rgba or drop the animation |
| `.sh-body` | `opacity:0.92` | **`opacity-92`** (arbitrary) |
| `.sh-cell` ×3 | `rgba(255,255,255,0.1)` | `bg-[rgba(255,255,255,0.1)]` |
| `.sh-cell-label` | `opacity:0.7` | `opacity-70` |
| `.sh-cell-meta` | `opacity:0.78` | `opacity-[0.78]` |
| `.sh-btn` | `rgba(255,255,255,0.95)` | `bg-[rgba(255,255,255,0.95)] text-terra` |
| `.sh-btn-ghost` bg + border | `rgba(255,255,255,0.14)` / `rgba(255,255,255,0.3)` | `bg-[rgba(...)]` / `border-[rgba(...)]` |
| `.proc-step.active .proc-dot` glow | `rgba(200,151,91,0.5 → 0)` keyframe | decorative pulse-gold — arbitrary rgba or drop |
| `.desktop` shadow | `rgba(26,43,71,0.25)` | = `shadow.lg` token |
| `.status-hero` / `.cc-avatar` / `.readiness-card` gradients | solid-stop gradients | arbitrary `bg-[linear-gradient(...)]` — **never** slash-opacity a stop |

**Every remaining tint on this surface is a SOLID token or a solid bespoke hex** (`.ps-pill.*`, `.info-icon.*`, `.cc-pill`, `.paper-row.missed`) — none needs alpha. The only true opacity utilities are the six hero ones above.

## 0.4 The parent shell — NEW chrome, build once (this is the only genuinely new frame in the module)

The staff frame (`.app-shell` = 220px sidebar + main) is **NOT used**. The parent frame is:

```
.desktop → .browser-bar (cosmetic) → .parent-shell (bg = --bg)
   .parent-header   (surface, border-b, padding 18px 28px, flex, gap 14px)
   .parent-nav      (surface, border-b, padding 0 28px, horizontal tabs, overflow-x:auto)
   .parent-body     (padding 24px 28px 36px, max-width 980px, margin 0 auto)
```

**`.parent-header`** — left `.ph-brand`: `.logo-mini` (36px `rounded-md bg-gold text-navy`, Fraunces 600 14px, glyph **`A`**) + `.ph-name` `Asankrangwa SHS` (Fraunces 15px 500) + `.ph-name-meta` `Parent portal · Yaa Aidoo` (11px `text-navy-3`). Right `.ph-user`: stacked right-aligned `A. Aidoo` (12px `text-navy` 600) / `Mother` (10px `text-navy-3`) + `.ph-user-avatar` (32px circle `bg-navy text-gold`, Fraunces 13px 600, **`AA`**).

> **Binding [CHILD]:** brand name ← `schools.name`; `Parent portal · {child full name}` ← `students`; `A. Aidoo` ← the session user's `users.full_name` (rendered **initial + surname**); `Mother` ← `student_guardian.relationship` (`guardianRelationEnum` MOTHER → title-case "Mother"). Avatar initials derived, not stored.

**`.parent-nav`** — six `.pn-item` tabs (14px 16px padding, 13px 500 `text-navy-3`, `border-bottom:2px solid transparent`; `.active` = `text-navy`, `border-bottom-color:var(--gold)`, weight 600):

| # | Label | State | Notes |
|---|---|---|---|
| 1 | `WASSCE` | **active** + `.dot` | the built tab |
| 2 | `Sickbay` | + `.dot` | nav only — target not built (4.4) |
| 3 | `Communications` | — | nav only |
| 4 | `Billing` | — | nav only |
| 5 | `Boarding` | — | nav only |
| 6 | `School calendar` | — | nav only |

`.pn-item .dot` = 6px circle **`bg-terra`**, `margin-left:6px` — an **unread/attention marker**, on WASSCE and Sickbay only.

> **Flat nav, 6 items — correct per the nav convention** (sectioned nav only above twelve). Horizontal tabs (not a sidebar) is deliberate: mobile-leaning. `overflow-x:auto` is the phone behaviour.
> **Binding for the dots [CHILD]:** no unread-state table exists. Render the dot from a **derived** "has an open item in that module" predicate (WASSCE = an open `waec_special_consideration`; Sickbay = unbindable, 4.4) or **omit the dots in v1** rather than fake them. Flag — Part K.6.

## 0.5 Five editorial sections = ONE page

Each of the five `.section` blocks re-renders the **identical** `.parent-header` + `.parent-nav` and swaps only `.parent-body`. The browser-bar URLs are `…/wassce`, `#schedule`, `#sc12`, `#thread`, `#readiness` — i.e. **one route with anchored regions**, the same pattern as INCR-15/16/17. Build **one page**, five stacked regions, in this order (the notes fix it explicitly): **hero → child card → schedule → SC-12 process → thread → readiness → info cards → FAQ.**

The outer editorial `.page-header`, `.section-head`/`.section-num`/`.section-title`/`.section-meta`, and the `.notes` right-rail are **design-doc chrome — do NOT build** (same rule as every prior WASSCE map).

## 0.6 Responsive — this surface is **phone-first**, and says so

`.page-header p` (do-not-build) states it: *"She opens Omnischools on her phone (rendered here in a desktop frame)."* The `.notes` add: *"Mobile-first reading order. The desktop frame is for this presentation; on phone, the order is hero → child card → schedule → SC-12 process → thread."*

**There is no `@media` block in this file** — the desktop frame IS the mock. Derive the phone behaviour (this is the one place the map must design rather than transcribe):

| Region | Desktop (as drawn) | Phone |
|---|---|---|
| `.sh-grid` | `repeat(3,1fr)` | **1-col** stacked (3 cells) |
| `.sh-actions` | inline row, `flex-wrap` | already wraps; buttons full-width at ≤400px |
| `.child-card` | `auto 1fr auto` (avatar / identity / target) | **stack**: avatar+name row, then meta, then the target block **left-aligned** (its `text-align:right` must drop) |
| `.paper-row` | `auto 1fr auto` | keep — the 70px date rail + name + pill fits; pill may wrap under the name at ≤360px |
| `.proc-steps` | 5 across, connector line | **the pressure point.** 5 labels across a 360px screen is ~64px each. Either keep 5 across with 10px labels, or switch to a **vertical** step list (the canonical vertical step nav, `schoolup-unified-onboarding.html`). **Recommend vertical on phone** — the connector `::before` becomes a left rail. |
| `.thread-msg` | `64px 1fr` | keep (the time rail is the scannable spine) |
| `.info-grid` | `1fr 1fr` | **1-col** |
| `.rc-sig-row` | `1fr auto` | **stack**, link below |
| `.parent-nav` | 6 tabs | horizontal scroll (already `overflow-x:auto`) |

**PWA:** no `-pwa.html` variant exists for the parent tracker. The signed statement PDF (`View signed PDF →`) reuses the portable receipt-PDF path (#136) — no new dep, no new offline surface.

---

# PART A — §1 · Live status · day 2 of WASSCE

Editorial head (do-not-build): `01 · Live status · day 2 of WASSCE` · meta `A. Aidoo · mother · phone +233 24 487 6612`. URL `parent.omnischools.gh/asankrangwa/aidoo-yaa/wassce` (**do NOT build this URL — Part L.2**).

## A.1 The status hero (`.status-hero`) — the live SC-12 moment

Terra-gradient card `linear-gradient(135deg,#B84A39 0%,#8B3829 100%)`, `text-bg`, `rounded-2xl` (14px), `padding 28px 32px`, `margin-bottom 24px`, shadow `rgba(184,74,57,0.4)`. **This is the parent-facing twin of the staff `.disruption-banner`** (INCR-17 D.1) — same gradient, same pulse, **different copy register**.

| Sub-element | Exact copy | Token / type | Tag |
|---|---|---|---|
| `.sh-eyebrow` | `Live · Wednesday 14 May · 14:45 GMT` | 10px uppercase `tracking-[0.16em]` 600 `opacity-75` | [CHILD] |
| `.sh-live` | `Active case` + pulsing `.sh-live-dot` | pill `bg-[rgba(255,255,255,0.14)]`, 10px 700 uppercase `tracking-[0.1em]`; dot `#FFD4C9` | [CHILD] |
| `.sh-headline` | `Yaa is at ` + `<em>Ward B bed 7</em>` + `. Her three English papers have been formally ` + `<em>postponed</em>` + ` by WAEC.` | Fraunces 28px 500 `leading-[1.2]`; `<em>` italic `#F5D4C9` 400 | [CHILD] |
| `.sh-body` | `We received your SMS confirmation at 11:32 from WAEC. The special-consideration form (SC-12) for Yaa was filed this morning at 11:00 and acknowledged by WAEC's Western Region office at 11:32. The three English papers she missed — Oral English (yesterday), English Language 1 and 2 (this morning) — will be rescheduled at the regional WAEC office in Sefwi-Wiawso. We do not know the date yet; WAEC will advise once Yaa's clinician confirms fitness to sit. Her next paper at our centre is Mathematics on Wednesday 3 June. The matron and clinician will assess fitness on Monday 1 June.` | 14px `leading-[1.6]` `opacity-92`, `max-width:760px` | [CHILD] |

**`.sh-grid`** — 3 cells (`repeat(3,1fr) gap-12`, each `bg-[rgba(255,255,255,0.1)] rounded-lg padding 14px 16px`; label 10px uppercase `tracking-[0.12em]` 600 `opacity-70`; value Fraunces 18px 500; meta 11px `opacity-[0.78]`):

| Cell | `.sh-cell-label` | `.sh-cell-value` | `.sh-cell-meta` | Binding |
|---|---|---|---|---|
| 1 | `Yaa's location` | `Ward B · bed 7` | `Asankrangwa Govt Hospital` | 🔴 **NO BINDING** — Sickbay 4.4 (Part K.2) |
| 2 | `Treatment` | `Responding well` | `IV artesunate · 14:30 ward round` | 🔴 **NO BINDING** — Sickbay 4.4 |
| 3 | `Next paper` | `Math · Wed 3 Jun` | `19 days · fit-to-sit pending` | ✅ `wassce_papers.scheduled_date` (next un-sat paper for this candidate) + derived day-count; `fit-to-sit pending` ← SC status |

**`.sh-actions`** — three controls, all **READ/contact, no writes**:

| Control | Copy | Style | Kind |
|---|---|---|---|
| 1 | `Call Matron Bediako` | `.sh-btn` `bg-[rgba(255,255,255,0.95)] text-terra` 12px 700 `tracking-[0.04em]` | **`tel:` link** — staff phone |
| 2 | `Call Head of Academics` | `.sh-btn-ghost` `bg-[rgba(255,255,255,0.14)] border-[rgba(255,255,255,0.3)] text-bg` 12px 600 | **`tel:` link** |
| 3 | `Hospital ward info` | `.sh-btn-ghost` | nav/read — **target not built (4.4) → inert** |

> **Binding (whole hero) [CHILD]:** the **narrative is composed, not a field.** The only clean columns behind it: `waec_special_consideration` (`filed_at` 11:00, `waec_acknowledged_at` 11:32, `waec_ref`, `make_up_centre` "Sefwi-Wiawso", `status=ACKNOWLEDGED`), the three `wassce_paper_sittings` rows with `exempted_at` set, and the next `wassce_papers.scheduled_date`. Ward/bed/treatment/clinician-fitness-date have **no columns anywhere** (Part K.2).
> **Render the prose as a TEMPLATE with named slots** (`{childFirst}`, `{ackTime}`, `{scForm}`, `{filedTime}`, `{waecOffice}`, `{missedPaperPhrase}`, `{makeUpCentre}`, `{nextPaperName}`, `{nextPaperDate}`, `{fitToSitDate}`) in a `lib/wassce/parent-copy.ts` constant — NOT free text in JSX, and NOT a stored string. Slots with no binding (ward/bed) must be **omittable** so the paragraph degrades to a grammatical sentence without them.
> **Conditional render:** the whole hero shows **only** when the candidate has an **open** `waec_special_consideration` (`status NOT IN (COMPLETED, REJECTED)`). Part M.1 specifies what replaces it when there is no live case — **this is the single most important derived state on the surface**, because the calm/no-case parent is the common case and the surface never draws it.

## A.2 The child quick card (`.child-card`)

White `rounded-xl border-border padding 22px 26px`, grid `auto 1fr auto gap-20 items-center`.

| Element | Exact copy | Token | Tag |
|---|---|---|---|
| `.cc-avatar` | `YA` | 64px circle, `linear-gradient(135deg, gold 0%, gold-soft 100%)`, Fraunces 22px 500 `text-navy` | [CHILD] |
| `.cc-name` | `Yaa ` + `<em>Aidoo</em>` | Fraunces 22px 500; `<em>` italic **gold** 400 | [CHILD] |
| `.cc-meta` item 1 | `<b>F3</b> · Slessor House` | 12px `text-navy-3`, `<b>` `text-navy` | [CHILD] |
| `.cc-meta` item 2 | `Science programme` | `.cc-pill` — `bg-[#E5F0EB] text-[#1E5A35]` 11px 600 rounded-full (**drift, §0.2**) | [CHILD] |
| `.cc-meta` item 3 | `<b>Form Master</b> · Mr S. Asiedu` | 12px | [CHILD] |
| `.cc-meta` item 4 | `<b>Index</b> · 0184-0817` | 12px — **note: NOT mono here** (staff surfaces use mono; Part O.3) | [CHILD] |
| identity tail | `Born 12 August 2008 · NHIS 9842-1276-5503 (active)` | 11px `text-navy-3` | [CHILD] — **PII, see Part L.3** |
| `.cc-target-label` | `University target` | 10px uppercase `tracking-[0.14em]` 600 `text-navy-3`, right-aligned | [CHILD] |
| `.cc-target-value` | `KNUST Biochemistry` | Fraunces 16px 500, right | [CHILD] + [REF] |
| `.cc-target-meta` | `Projected aggregate 10 · cut-off 11 · one place inside` | 11px `text-navy-3`, right | [CHILD] + [REF] · **jargon — Part I.1** |

> **Binding [CHILD]:** name/DOB ← `students`; `F3` ← `current_class_label`; House ← `students.house_id → houses.name`; programme pill ← `students.programme` (reuse `PROGRAMME_TRACKS`); Form Master ← the student's class → form-master `role_assignment` (**partial binding — Part K.4**); `Index` ← `wassce_candidates.index_number`; **NHIS number has no column anywhere** (Part K.2).
> **Target block:** `university_targets` where `target_rank = FIRST_CHOICE` → GLOBAL `university_programmes.name` + `.cut_off_aggregate` (11) + `universities.short_name` (KNUST); `Projected aggregate 10` ← **derived** `projectAggregate()` (`wassce_candidates.projected_aggregate` stays NULL in the live path — read the derived value, one source of truth); `one place inside` ← `matchMargin(10, 11)` → reuse `marginLabel()`. **⚠️ The surface drops the reference-year stamp** that INCR-17b made mandatory (`cutOffLabel()` renders `11 (2025)`, never a bare `11`). Part O.2 — **honour the snapshot-honesty rule; the parent needs it more than the staff do.**
> **[REF] not [cohort]:** a cut-off is a published university threshold on a GLOBAL table. It is **not** peer data. Safe.

---

# PART B — §2 · WASSCE schedule · what Yaa has done, missed, and has left

Editorial head: `02 · WASSCE schedule · what Yaa has done, missed, and has left` · meta `9 papers · 1 sat · 3 missed (medical · being rescheduled) · 5 upcoming`. URL `#schedule`.

## B.1 The list container (`.papers-list`)

White `rounded-xl border-border overflow-hidden`. `.papers-head` (`bg-bg border-b padding 18px 24px`, flex justify-between):
- `<h3>` `Paper-by-paper schedule` (Fraunces 16px 500)
- `.papers-head-meta` `Centre · Asankrangwa SHS · SU-0184` (11px `text-navy-3` `tracking-[0.06em]`) — [REF], ← `wassce_candidates.centre_code`. *(The notes justify it: "useful for hospital discharge planning.")*

## B.2 Row anatomy (`.paper-row`)

`grid auto 1fr auto`, `gap-16`, `padding 16px 24px`, `border-b border-border` (last none).
- `.paper-date` (70px, centered): `.paper-date-day` (Fraunces 11px 600 uppercase `tracking-[0.08em]` `text-navy-3`) / `.paper-date-num` (Fraunces 24px 500) / `.paper-date-mo` (10px 600 uppercase `text-navy-3`)
- `.paper-info`: `.paper-name` (Fraunces 15px 500) / `.paper-time` (12px `text-navy-3`)
- `.paper-status`: one `.ps-pill` (11px 600 `tracking-[0.04em]` rounded-full, `padding 5px 11px`)

**Row background states:** `.paper-row.missed` = **`#FBEBE7`** (bespoke pale terra) · `.paper-row.next` = **`var(--bg)`** · default = surface.

**Pill states — all four exercised:**

| Pill class | bg / text | Copy in demo |
|---|---|---|
| `.ps-pill.sat` | `bg-green-bg text-green` | `Sat · attended` |
| `.ps-pill.missed` | `bg-terra-bg text-terra` | `Postponed · SC-12 filed` |
| `.ps-pill.next` | **`bg-gold text-navy`** | `Next paper · 19 days` |
| `.ps-pill.upcoming` | `bg-bg text-navy-3 border border-border` | `In 11 days` |

## B.3 The nine rows — VERBATIM

| # | Day/Num/Mo | `.paper-name` | `.paper-time` | Pill | Row state |
|---|---|---|---|---|---|
| 1 | Mon 12 May | `Social Studies · Paper 1` | `08:00 · 1 hour · objective` | `Sat · attended` (sat) | default |
| 2 | Tue 13 May | `English Language · Oral` | `14:00 · 45 minutes · listening test` | `Postponed · SC-12 filed` (missed) | `.missed` |
| 3 | Wed 14 May | `English Language · Paper 1` | `08:00 · 1 hour · objective` | `Postponed · SC-12 filed` (missed) | `.missed` |
| 4 | Wed 14 May | `English Language · Paper 2` | `10:30 · 1 hr 30 min · essay` | `Postponed · SC-12 filed` (missed) | `.missed` |
| 5 | Tue 26 May | `Integrated Science · Paper 1+2` | `08:00 · 2 hr 30 min · combined` | `In 11 days` (upcoming) | default |
| 6 | Wed 3 Jun | `Mathematics (Core) · Paper 1+2` | `08:00 + 11:00 · combined sittings · 4 hours` | `Next paper · 19 days` (next) | `.next` |
| 7 | Mon 8 Jun | `Chemistry · Paper 1+2` | `08:00 · 3 hours · theory` | `In 24 days` (upcoming) | default |
| 8 | Tue 9 Jun | `Physics · Paper 1+2` | `11:00 · 3 hours · theory` | `In 25 days` (upcoming) | default |
| 9 | Thu 11 Jun | `Biology · Paper 1+2` | `08:00 · 3 hours · theory` | `In 27 days` (upcoming) | default |

> **Binding [CHILD]:** rows = `wassce_paper_sittings` for **this candidate** LEFT JOIN `wassce_papers` (`name`, `scheduled_date`, `scheduled_time`, `duration_minutes`, `paper_type`), ordered by date+time. `.paper-time` = `{scheduled_time} · {humanised duration} · {paper_type lowercased}`.
> **⚠️ THE COHORT-LEAK TRAP (Part H.1):** `wassce_papers` is **cohort-scoped**, `wassce_paper_sittings` is **candidate-scoped**. The parent query MUST drive from the candidate's sittings. Selecting papers first (`WHERE cohort_id = …`) then joining sittings will pull **other candidates' sitting rows** into the result set. Drive from `wassce_paper_sittings WHERE candidate_id = :child`.
> **Pill derivation:** `sat` ← `sat_at IS NOT NULL` · `missed/postponed` ← `exempted_at IS NOT NULL` **and** an SC filing covers it · `next` ← the earliest future paper with no `sat_at` · `upcoming` ← everything else future. Day-counts derived from today; **not stored**.
> **🔑 LANGUAGE SUBSTITUTION — LOAD-BEARING (Part I.2):** the staff surface pill for the identical row reads **`Missed · medical`**; the parent pill reads **`Postponed · SC-12 filed`**. The notes state the rule: *"'Postponed', not 'missed'. The school owns the language. Three papers are being rescheduled by WAEC; they have not been failed."* **This must be an audience-specific label map, not a shared status label.** Do not reuse the staff label constant here — add `PARENT_SITTING_LABEL` beside it.
> **9 papers vs 8 subjects:** the parent list shows 9 rows for 8 subjects (English contributes 3). Elective Maths — which the staff surface shows as **dropped from the best-3** — **does not appear at all** on the parent schedule. Confirm intent (Part O.4): if the child sits it, the parent should arguably see it; the surface omits it, and this map replicates the omission rather than inventing a row.

---

# PART C — §3 · WAEC special-consideration process · what happens next

Editorial head: `03 · WAEC special-consideration process · what happens next` · meta `Form SC-12 · ref SC-12-184-2026-0044 · 5 steps · 2 done`. URL `#sc12`.

## C.1 Card head (`.proc-head`)

`flex justify-between items-center`, `border-b border-border padding-bottom 14px`.
- `.proc-title` `Make-up sitting · the 5 steps` (Fraunces 18px 500)
- subtitle (11px `text-navy-3`, `margin-top:2px`): `School is handling steps 1–4. Step 5 is between you, Yaa, and the clinician.`
- `.proc-ref` (right, **JetBrains Mono 11px** `text-navy-3`): `WAEC ref · ` + `<b>SC-12-184-2026-0044</b>` (`<b>` `text-navy`)

> ⚠️ **Copy contradiction inside the card** (Part O.5): the head says *"School is handling steps 1–4. **Step 5** is between you, Yaa, and the clinician"*, but the step strip labels **step 5** `Yaa sits papers` and **step 3** `Awaiting fit-to-sit` — and the `.notes` say *"School owns 1–4. The parent and clinician own **step 5 (fit-to-sit confirmation)**."* Fit-to-sit is step **3**, not 5. **Render the copy verbatim** (faithful port) and **flag for surface-sync** — do not silently "fix" it, and do not let the step-ownership logic follow the wrong number.

## C.2 The 5-step strip (`.proc-steps`)

`flex`, each `.proc-step` `flex:1`, column, `gap-8`, `padding 0 8px`. Connector: `::before` absolute 2px rail, `top:14px`, `left:-50%`→`right:50%`, `bg-border`; hidden on first; **`.done::before` = `bg-green`**; **`.active::before` = `linear-gradient(to right, green 0%, gold 100%)`**.

`.proc-dot` = 30px circle, `bg-bg border-2 border-border`, Fraunces 12px 600 `text-navy-3`.
- `.done .proc-dot` = `bg-green border-green text-surface`
- `.active .proc-dot` = `bg-gold border-gold text-navy` + **`pulse-gold` animation** (`rgba(200,151,91,0.5)` ring)
- `.pending .proc-label` = `text-navy-3`

| Step | State | `.proc-dot` | `.proc-label` (verbatim, `<br>` as drawn) | `.proc-meta` | Binding |
|---|---|---|---|---|---|
| 1 | `.done` | `✓` | `Filed` | `Wed · 11:00` | ✅ `filed_at` |
| 2 | `.done` | `✓` | `Acknowledged<br>by WAEC` | `Wed · 11:32` | ✅ `waec_acknowledged_at` |
| 3 | **`.active`** | `3` | `Awaiting<br>fit-to-sit` | `Mon 1 Jun` | 🔴 **NO BINDING** — Part K.3 |
| 4 | `.pending` | `4` | `Date<br>scheduled` | `By WAEC` | ✅ `make_up_scheduled_at` (null → pending) |
| 5 | `.pending` | `5` | `Yaa sits<br>papers` | `Sefwi-Wiawso` | ✅ `completed_at` / `make_up_centre` |

> **🔴 The active step has no column.** `scStatusEnum` = DRAFT / FILED / ACKNOWLEDGED / APPROVED / SCHEDULED / COMPLETED / REJECTED (7). The parent strip is 5 steps and its **most prominent element — the pulsing gold active dot — is "Awaiting fit-to-sit", which maps to no status and whose date (`Mon 1 Jun`) is stored nowhere.** Proposed mapping and the gap, in full, at **Part K.3**. Also: **REJECTED has no parent-facing step design at all** — Part M.3.

## C.3 The explainer (`.proc-explain`) — **the load-bearing translation block**

`bg-bg`, **`border-left:3px solid var(--gold)`**, `rounded-sm`, `padding 14px 18px`, 13px `text-navy-2` `leading-[1.6]`; `<b>` → `text-navy`; `<li>` bullets are a gold `·` via `::before`, `padding-left 14px`.

Lead: `What the school is doing for you:`

Five bullets, VERBATIM:
1. `Mrs Owusu-Ansah (Head of Academics) filed the SC-12 form this morning with WAEC's Western Region office in Sefwi-Wiawso, with copies of Yaa's hospital admission slip and the clinician's letter.`
2. `WAEC acknowledged the filing at 11:32 — this means they have the paperwork and Yaa is officially registered as a candidate with special consideration.`
3. `The matron, Mrs Bediako, will assess Yaa with the hospital clinician on Mon 1 June. If they confirm she is fit to sit, the school informs WAEC the same day.`
4. `WAEC then sets a make-up sitting date — typically within 10 working days of fit-to-sit. The make-up papers are taken at the WAEC Regional office in Sefwi-Wiawso, not here at the school.`
5. `The school will arrange transport to Sefwi-Wiawso and a teacher will accompany Yaa on the day. You will be informed before, during, and after.`

> **This is the single most important copy block on the surface for the parent audience.** Bullet 2 is a *definition* ("this means they have the paperwork…"), bullet 4 is a *process expectation* with a stated typical duration, bullet 5 is a *reassurance*. **Do not compress, do not bullet-point into fragments.** Template slots: `{hoaName}`, `{scForm}`, `{waecOffice}`, `{ackTime}`, `{matronName}`, `{fitToSitDate}`, `{makeUpCentre}`, `{childFirst}`. Same `lib/wassce/parent-copy.ts` home as A.1. Bullet 4's "typically within 10 working days" is the **same WAEC convention constant** the staff surface carries (INCR-17 D.2) — reuse it, do not re-author.

## C.4 The three action buttons (inline-styled row, `margin-top:14px; display:flex; gap:10px`)

| Control | Copy | Style | Kind |
|---|---|---|---|
| 1 | `View SC-12 form` | `bg-navy text-bg`, 12px 600, `rounded-md`, `padding 10px 18px` | **READ** — opens the filed SC artifact/PDF (reuse #136 path) |
| 2 | `Hospital clinician contact` | `bg-surface text-navy border border-border-2` | READ/contact — **no binding (4.4) → inert** |
| 3 | `Call Mrs Owusu-Ansah` | `bg-surface text-navy border border-border-2` | **`tel:` link** |

> ⚠️ **`View SC-12 form` is the one control worth a second look for a parent audience.** On the staff surface it opens the internal filing record. For a parent it should open a **read-only rendering / PDF** of the SC-12 — **never** the staff filing form, and never a route that permits `status` transitions. Gate at the route, not the button.

---

# PART D — §4 · Today's communications · ordered, with you in the loop

Editorial head: `04 · Today's communications · ordered, with you in the loop` · meta `6 events · 4 phone calls · 2 SMS · 1 scheduled`. URL `#thread`. *(The meta itself is inconsistent — 6 events but the strip lists 3 phone + 3 SMS; see Part O.6.)*

## D.1 Container (`.thread`)

White `rounded-xl border-border overflow-hidden`. `.thread-head` (`bg-bg border-b padding 18px 24px`, flex justify-between):
- `.thread-title` `Wednesday 14 May · day 2 of WASSCE` (Fraunces 16px 500)
- `.thread-meta` `All times GMT · school contact records` (11px `text-navy-3`)

## D.2 Message anatomy (`.thread-msg`)

`grid 64px 1fr`, `gap-16`, `padding 16px 24px`, `border-b` (last none). **`.thread-msg.system` = `bg-bg`** — used on the three **phone-call** rows (the SMS rows are surface-white). *(Class name `system` but applied to human calls — Part O.7.)*
- `.tm-time-num` — **JetBrains Mono 13px 600 `text-navy`**
- `.tm-time-channel` — 9px uppercase `tracking-[0.1em]` 600 `text-navy-3`, `margin-top:2px`
- `.tm-from` — 11px `text-navy-3`, `<b>` `text-navy` 600
- `.tm-content` — 13px `text-navy-2` `leading-[1.6]`, `<b>` `text-navy`
- `.tm-status` — 10px 600 uppercase `tracking-[0.06em]` **`text-green`**; `.tm-status.scheduled` = **`text-gold`**

## D.3 The six events — VERBATIM

| # | `.tm-time-num` | channel | `.tm-from` | `.tm-content` | `.tm-status` | Row bg |
|---|---|---|---|---|---|---|
| 1 | `06:52` | `Phone` | `<b>Matron Mrs G. Bediako</b> · called you` | `Yaa admitted to Asankrangwa Govt Hospital, Ward B bed 7, at 06:45 with severe malaria. NHIS card in use. Mrs Bediako accompanied her from sickbay to A&E. Clinician has declared her unfit to sit today's papers. You said you were leaving Tarkwa immediately and would be at the hospital by 11:00.` | `Delivered · 4-minute call` | `.system` (bg) |
| 2 | `07:14` | `SMS` | `<b>Omnischools system</b> · automated` | `"Confirmation: Yaa is on Ward B bed 7, Asankrangwa Govt Hospital. Oral English today and English Lang 1 + 2 tomorrow morning will be missed. WAEC SC-12 form being filed at 11:00 by Mrs Owusu-Ansah. Matron Bediako with Yaa now."` | `Delivered` | surface |
| 3 | `11:00` | `Phone` | `<b>Mrs C. Owusu-Ansah</b> (Head of Academics) · called you` | `SC-12 special-consideration form filed with WAEC Regional. Hospital admission slip and clinician's letter attached. Mrs Owusu-Ansah explained the 5-step process for make-up sitting. You confirmed you had arrived at the hospital at 10:48 and were with Yaa.` | `Delivered · 9-minute call` | `.system` |
| 4 | `11:32` | `SMS` | `<b>Omnischools system</b> · automated · from WAEC` | `"WAEC has acknowledged the SC-12 special-consideration form for candidate 0184-0817 (Aidoo, Yaa). Reference number SC-12-184-2026-0044. Make-up sitting will be scheduled once a fit-to-sit confirmation is received from the candidate's clinician."` | `Delivered` | surface |
| 5 | `14:30` | `Phone` | `<b>Matron Mrs G. Bediako</b> · called you` | `Hospital ward round update. Yaa is responding to IV artesunate, no fever for the past four hours, awake and comfortable. NHIS card itemised for the hospital bill — IV medication and ward bed covered; meals (GHS 24 line) not covered. Next ward round at 21:00.` | `Delivered · 6-minute call · you were at bedside` | `.system` |
| 6 | `21:00` | `SMS` | `<b>Omnischools system</b> · scheduled · evening ward summary` | `Evening ward round summary will be sent automatically once the ward round is complete and the matron has confirmed it. You will receive an SMS, and a more detailed update will appear in your communications log.` | `Scheduled · 21:00 tonight` (**`.scheduled`, gold**) | surface |

## D.4 The four thread rules (from `.notes` — these are the build contract)

1. **Chronological, top-down.** Earliest at top; today's last **scheduled** event at the bottom.
2. **Second person.** `called you`, never "called the parent". The parent is reading **her own** thread.
3. **Every event shows who / what / channel / status.** *"The parent never has to ask 'did you call me?' — the answer is in the log."*
4. **SMS is quoted verbatim inside `" "`; phone-call notes are summarised, not verbatim.** Rows 2/4 are in quote marks; 1/3/5 are not. Row 6 is a *future* SMS so it is **described, not quoted** — correct, and a state the build must preserve.
5. **Scheduled (future) events are visible.** *"The parent knows what is coming next; they are not surprised by the 21:00 SMS."*

> **🔴 Binding — the largest gap on the surface (Part K.1).** `notification_log` has `phone`, `message`, `status` (QUEUED/…), `student_id`, `sent_by_user_id`, `created_at`. It covers **rows 2 and 4 only, partially**. It has **no** channel discriminator (there is no PHONE), **no** call direction, **no** duration, **no** from-person display label, **no** future/scheduled row, and **no** "you were at bedside" annotation field. **Three of six rows and five of the row's seven display fields have no binding.**
> **Is there a parent WRITE here?** **No.** There is no reply box, no compose control, no "mark read", no attachment. The thread is a **pure read log**. Part J confirms.

---

# PART E — §5a · Readiness statement · what you signed in March — **THE WRITE QUESTION**

Editorial head: `05 · Readiness statement · what you signed in March` · meta `Signed 28 Mar 2026 · phone-OTP · projected aggregate 10 · KNUST Biochem`. URL `#readiness`.

## E.1 The card (`.readiness-card`) — element by element

`linear-gradient(135deg, gold-bg 0%, bg 100%)`, `border border-gold-soft`, `rounded-xl`, `padding 22px 26px`, `margin-bottom 20px`.

| Element | Exact copy | Token | Tag |
|---|---|---|---|
| `.rc-icon` | `✓` | 42px `rounded-lg` **`bg-gold text-navy`** Fraunces 18px 600 | signed-state glyph |
| `.rc-title` | `Mock 2 readiness statement · you signed on Saturday 28 March 2026` | Fraunces 16px 500 `leading-[1.2]` | [CHILD] |
| `.rc-subtitle` | `After the March 2026 mock cycle · before the WASSCE in May` | 11px `text-navy-3` | [REF] |
| `.rc-body` | `You acknowledged Yaa's projected aggregate of <b>10</b> based on her Mock 2 results. You agreed with <b>KNUST Biochemistry</b> as her primary target (cut-off 11 · one place inside) and three supporting choices: Legon Biochemistry (comfortable), KNUST Pharmacy (stretch), UCC Biochemistry (safety). You raised one concern: <i>"commute distance to Kumasi is far from Tarkwa."</i> Mrs Owusu-Ansah noted this on the form and we discussed UCC Biochemistry as a closer fallback.` | 13px `text-navy-2` `leading-[1.6]`, `border-t border-gold-soft` `padding-top 14px` | [CHILD]+[REF] |
| `.rc-sig` | `Phone-OTP signature · <b>+233 24 487 6612</b> · 28 Mar 2026 · 14:22 GMT` | 11px `text-navy-3`, `border-t border-gold-soft padding-top 14px` | [CHILD] |
| `.rc-sig-link` | `View signed PDF →` | 12px **`text-gold` 700**, `<a href="#">` | **READ** |

> **Binding [CHILD] — all clean, all shipped in 0053/0054:**
> - `.rc-title` ← `readiness_statements` (the **current** row: `superseded_at IS NULL`) + `parent_acknowledged_at` formatted long-form with weekday (`Saturday 28 March 2026`) — **note the parent format is longer than the staff format** (`28 Mar 2026`). Add a `parentDateLabel()` formatter; do not reuse `StatementView.parentAckTitle`.
> - `.rc-subtitle` ← the generating mock's name/window (`mock_exams`).
> - `aggregate of 10` ← `projection_snapshot_json.projectedAggregate` (the **frozen** figure, not the live derived one — the statement is an immutable artifact).
> - primary target + three supporting + their `(comfortable)/(stretch)/(safety)` parentheticals ← `readiness_statements.target_universities_json` (the 17b R4 frozen snapshot) → `MATCH_TIER_LABEL` lowercased. **Jargon flag — Part I.3.**
> - the quoted concern ← **`readiness_statements.parent_concerns_text`** (verbatim, in `<i>` + curly quotes).
> - `Mrs Owusu-Ansah noted this…` ← `generated_by_user_id → users.full_name`. The trailing clause *"and we discussed UCC Biochemistry as a closer fallback"* is **not a column** — it is prose continuation of the same free-text concern field, or an unbound addendum. Flag (Part K.5): either fold it into `parent_concerns_text` at capture time or drop it.
> - `.rc-sig` ← `parent_acknowledged_signature_method = PHONE_OTP` → rendered **`Phone-OTP signature`** (terminology convention: always "OTP", never "code"/"PIN") + `parent_acknowledged_phone` + `parent_acknowledged_at`.
> - `View signed PDF →` ← `/api/senior/readiness-statement/{id}` (existing route, receipt-PDF path #136). **Read-only.**

## E.2 🔑 IS THERE A PARENT SIGNATURE / ACK CONTROL? — **NO. Not one.**

I looked for every affordance the task named. Findings, precisely:

| Sought affordance | Present on this surface? |
|---|---|
| A signature pad / draw-to-sign | **No** |
| An OTP entry step (request code / enter code) | **No** — OTP appears only as **past-tense provenance text**: `Phone-OTP signature · +233 24 487 6612 · 28 Mar 2026 · 14:22 GMT` |
| An "I have read this" / "I acknowledge" checkbox or button | **No** |
| A "Sign now" / "Acknowledge statement" CTA | **No** |
| A per-target acknowledgement control (§E.3) | **No** |
| Any `<form>`, `<input>`, `<select>`, `<textarea>`, or submit control **anywhere in the file** | **No — zero.** |
| A reply/compose control on the comms thread | **No** |

**Every control on the surface is one of: a `tel:` link, a nav link, or a document read.** The `.notes` state the doctrine explicitly: *"Two-click actions only. Call matron · call HoA · view hospital. **No fillable forms; everything heavy is done by school.**"*

> **⚖️ THE RULING THIS FORCES.** The schema comment on `readiness_statements` says *"the parent-facing signing UI is INCR-19"*, and the INCR-17 map deferred the parent-side ack here. **The INCR-19 surface does not draw it.** So one of two things is true, and **Kofi must pick — an implementer must not decide this by guessing:**
> - **(a) INCR-19 is READ-ONLY as designed** (what the surface says, what build-plan line 2077 says: *"Parent-facing capstone (read-only, one child)"*). Parent-ack stays **school-captured** by the HoA (INCR-17, shipped). The parent portal *displays* the signature it already has. **This map recommends (a)** — it matches the surface, the build plan, and the owner-gated-SMS reality.
> - **(b) A parent signing flow is added.** Then **INCR-19 becomes a WRITE surface** and everything changes: a parent-writable path into `readiness_statements`, an OTP send (**owner-gated Hubtel — the same gate that blocks the 4.2/INCR-17 ack slice**), a fresh RLS write policy for a PARENT role, audit-logging, and a whole unsigned-state design that **does not exist on this surface** (Part M.4). That is a new increment's worth of work and a new attack surface. **Do not build it off this map.**
>
> **If (b) is ever chosen, the unsigned state must be designed first — it is not drawn.** The `.readiness-card` exists only in its signed form: gold `✓`, past-tense title, a signature line, a signed PDF. Part M.4 gives the state matrix INCR-19 needs *even under option (a)*, because **a candidate with no statement, or an unsigned statement, is a real and common data state** that this section currently cannot render.

## E.3 University targets — the per-target parent-ack: **NO CONTROL, NO WRITER**

INCR-17b shipped `university_targets.parent_acknowledged_at` with **no writer** (build-plan R5: *"column authored now, write-flow **DEFERRED to INCR-19**"*).

**The parent surface does not draw a per-target acknowledgement.** The four programmes appear **only as prose inside `.rc-body`** — one sentence, no per-target row, no per-target control, no per-target state, no per-target date. The `.cc-target-meta` in §1 shows the primary target as a **read line**.

> **Finding:** `university_targets.parent_acknowledged_at` **remains writerless after INCR-19** if INCR-19 is built to its own surface. The §7 staff ack is — as R5 already ruled — **one bundled statement-level ack** (`readiness_statements`), and the parent surface reflects exactly that: one statement, one signature, targets described inside it. **Flag to Kofi:** either accept the column stays unwritten (harmless, already ruled) or explicitly scope a per-target ack as a *later* increment with its own surface. **Do not invent per-target ack UI from this surface — there is nothing here to replicate.**

---

# PART F — §5b · The four info cards (`.info-grid`, `1fr 1fr`, gap 14px)

Each `.info-card` = white `rounded-xl border-border padding 20px 24px`. `.info-head` = `.info-icon` (32px `rounded-md`, Fraunces 14px 600) + `.info-title` (Fraunces 15px 500). `.info-body` = 12px `text-navy-2` `leading-[1.7]`; `.row` = `flex justify-between padding 4px 0`; `<b>` = `text-navy`; `<a>` = `text-gold 600`. Each card ends with a divider block (`margin-top:10px; padding-top:10px; border-top:1px solid var(--border)`).

## F.1 Hospital details — `.info-icon.hosp` `bg-terra-bg text-terra`, glyph `⚕`

| Row | Label | Value |
|---|---|---|
| 1 | `Hospital` | `Asankrangwa Govt Hospital` |
| 2 | `Ward` | `Ward B · bed 7` |
| 3 | `Admitted` | `Tue 13 May · 06:45` |
| 4 | `Clinician` | `Dr E. Nyarko` |
| 5 | `Treatment` | `IV artesunate` |
| 6 | `Ward round` | `14:30 today · 21:00 evening` |
| tail | link | `Hospital map & directions →` |

🔴 **NO BINDING — every row.** Sickbay is 4.4, not built (Part K.2).

## F.2 NHIS coverage — `.info-icon.nhis` `bg-green-bg text-green`, glyph `⊕`

| Row | Label | Value |
|---|---|---|
| 1 | `Card number` | `9842-1276-5503` |
| 2 | `Status` | `Active · to Mar 2027` |
| 3 | `Bed` | `Covered` |
| 4 | `IV medication` | `Covered` |
| 5 | `Diagnostic tests` | `Covered` |
| 6 | `Meals` | `Not covered · GHS 24/day` |
| tail | prose | `No out-of-pocket payment for Yaa's care other than meals.` |

🔴 **NO BINDING — every row.** No NHIS column exists anywhere in the schema (`nhis` appears only in prose/seed and as the `reg_flag` display pill). **`GHS 24/day` must use the currency convention** (`GHS 24.00`? — the surface writes `GHS 24/day`; keep verbatim but note the two-decimal rule, Part O.8).

## F.3 Asankrangwa SHS contacts — `.info-icon.school` `bg-gold-bg text-gold`, glyph `A`

| Row | Label | Value | Binding |
|---|---|---|---|
| 1 | `Matron` | `Mrs G. Bediako` | `role_assignment` MATRON |
| 2 | `Form Master` | `Mr S. Asiedu` | class → FORM_MASTER (**per-child** — Part K.4) |
| 3 | `Head of Academics` | `Mrs C. Owusu-Ansah` | VICE_HEADMASTER_ACADEMIC |
| 4 | `Headmaster` | `Dr K. Asare-Bediako` | HEADMASTER |
| 5 | `Centre code` | `SU-0184` | `wassce_candidates.centre_code` |
| tail | link | `Open contact directory →` | nav — **target not built → inert** |

> ⚠️ **Staff phone numbers are NOT shown here** — the card gives names only, while §1/§3 give `Call …` buttons. So the phone numbers exist behind the buttons but are not displayed as text. **Preserve that**: a parent portal should place a call, not publish staff mobile numbers as copyable text. If `Open contact directory →` is ever built, that decision needs revisiting deliberately.

## F.4 WAEC details — `.info-icon.waec` `bg-[#E5EAF2] text-navy`, glyph `W`

| Row | Label | Value | Binding |
|---|---|---|---|
| 1 | `Yaa's index` | `0184-0817` | `wassce_candidates.index_number` |
| 2 | `Centre` | `SU-0184 (here)` | `centre_code` + the literal `(here)` |
| 3 | `Make-up centre` | `WAEC Regional · Sefwi-Wiawso` | `waec_special_consideration.make_up_centre` |
| 4 | `SC-12 reference` | `SC-12-184-2026-0044` | `waec_ref` |
| 5 | `Programme` | `Science · 8 subjects` | `wassce_programmes` + COUNT(`wassce_candidate_subject`) |
| tail | link | `WAEC Western Region contact →` | nav/[REF] — static WAEC contact |

> Row 5's `8 subjects` is a **count of this child's own registered subjects** — [CHILD], not cohort. Safe.
> Rows 3/4 render **only when an SC filing exists** — Part M.3.

---

# PART G — §5c · FAQ · "Questions you might have"

`.faq` = white `rounded-xl border-border padding 24px 28px`. `.faq-title` `Questions you might have` (Fraunces 16px 500, `margin-bottom 18px`). `.faq-item` = `padding 14px 0 border-b border-border` (last: no border, no bottom padding).
- `.faq-q` = 13px 600 `text-navy`, prefixed by CSS `::before` **`Q. `** in **gold Fraunces italic 500**
- `.faq-a` = 13px `text-navy-2` `leading-[1.6]`, `padding-left 18px`, prefixed by `::before` **`A. `** (gold Fraunces italic, `margin-left:-18px` hanging indent)

**All six, VERBATIM:**

| # | Q | A |
|---|---|---|
| 1 | `Will Yaa fail because she missed the English papers?` | `No. The SC-12 special-consideration process is exactly for this. WAEC will reschedule the three English papers within the WASSCE window. Yaa's aggregate calculation will include the English grades from the make-up sitting, not zeros.` |
| 2 | `When will we know the make-up sitting date?` | `After the fit-to-sit confirmation on Mon 1 Jun. WAEC then schedules the date and notifies the school and you via SMS. Typically 5–10 working days after the confirmation.` |
| 3 | `Will Yaa be able to sit Mathematics on Wed 3 Jun?` | `That depends on the matron and clinician's assessment on Mon 1 Jun. If Yaa is well enough, she sits at the school centre as scheduled. If she is not, the matron will file an additional SC-12 for Mathematics. Mrs Owusu-Ansah will update you on Mon 1 Jun by phone.` |
| 4 | `Is the school open today and tomorrow?` | `Yes. The school is fully operational and Yaa's classmates are sitting their papers. You do not need to come to the school for anything; everything that involves you happens by phone or via this portal.` |
| 5 | `What does the projected aggregate of 10 mean now?` | `It is the same projection from Mock 2 in March. We do not adjust it for the missed papers — we wait for the make-up sitting to score and update with real data. If Yaa scores the same B3 in English at the make-up that she did in Mock 2, the aggregate of 10 holds.` |
| 6 | `How will I know about the make-up papers when they happen?` | `You will get a phone call from Mrs Owusu-Ansah at least 48 hours before, and a follow-up SMS confirming the date, time, and transport plan. On the day, the school will collect Yaa, accompany her to Sefwi-Wiawso, and bring her back. You will be informed after each step.` |
|

> **The FAQ is NOT static copy.** Five of six answers embed **child-specific facts**: the child's name (all), `Mon 1 Jun` (fit-to-sit, Q2/Q3), `Wed 3 Jun` (next paper, Q3), the HoA's name (Q3/Q6), `aggregate of 10` and `B3 in English` and `Mock 2` (Q5), `Sefwi-Wiawso` (Q6). **Build it as a slotted template in `lib/wassce/parent-copy.ts`**, driven by the same slot set as A.1/C.3 — not as a static markdown block, and not as free text in JSX.
> **Q2 vs C.3 bullet 4 conflict:** the FAQ says make-up is scheduled **"Typically 5–10 working days after the confirmation"**; the process explainer says **"typically within 10 working days of fit-to-sit"**. Compatible but differently worded — **use ONE constant**, render both strings from it, and flag for surface-sync (Part O.9).
> **Q1 is the emotional core of the surface** and it is a *policy* statement (`not zeros`) that must stay true to the engine: INCR-17 Decision 11 holds the projection through medical disruption and substitutes **no fail grade**. Q1 and the engine agree. Keep them agreeing.
> **Q5 is the closest the surface comes to defining "aggregate"** — and it **does not define it**. It explains *provenance* ("same projection from Mock 2") but never *what an aggregate is*. **Gap — Part I.1.**
> The `.notes` fix the intent: *"FAQ is the longest section by intent. Most of what a parent worries about can be answered without a phone call."* and *"End the parent view with reassurance, not action."* **The FAQ is the last thing on the page. Nothing follows it. Do not append a CTA.**

---

# PART H — 🔴 HARD BOUNDARY · cohort & comparative data

**Rule:** a parent must not be able to reach data about any other candidate — not by rendering, not by query, not by URL manipulation, not by a reused component.

## H.1 The surface is CLEAN — audited element by element

I checked every element for rank, position, percentile, distribution, peer names, "top N%", class average, cohort counts. **The surface contains none.** The `.notes` state the doctrine twice: *"One child, one page. No dashboards, no benchmarks."* and *"**No benchmarks, no cohort data.** The parent's view never compares Yaa to others. That is the school's analytical work."*

**The four near-misses, and why each is safe:**

| Element | Looks comparative | Verdict |
|---|---|---|
| `Projected aggregate 10 · cut-off 11 · one place inside` (§1) | "one place inside" | **SAFE [REF].** Compared to a **published university cut-off** on a GLOBAL table, not to peers. No other candidate is involved in the arithmetic. |
| `Legon Biochemistry (comfortable), KNUST Pharmacy (stretch), UCC Biochemistry (safety)` (§5) | tier words | **SAFE.** `matchBand()` is `projected vs cutOff` — a two-number comparison against a global reference. No cohort input. |
| `Yaa's classmates are sitting their papers` (FAQ Q4) | mentions classmates | **SAFE.** Static reassurance prose. No names, no data, no binding. Keep as prose; **never** turn it into a count or a list. |
| `Centre · Asankrangwa SHS · SU-0184` / `Science · 8 subjects` | school/cohort-ish | **SAFE.** School-level reference + this child's own subject count. |

## H.2 🔴 The three ways an implementer could still leak cohort data

**These are the real risks. None is visible in the mock; all are one careless query away.**

1. **The schedule query (Part B).** `wassce_papers` is **cohort-scoped**. Driving §2 from papers and joining sittings returns **every candidate's sitting rows**. **Drive from `wassce_paper_sittings WHERE candidate_id = :child`.** This is the single most likely leak on the surface.
2. **Component reuse from INCR-18/20.** The staff surfaces have components that *carry* cohort data — the cohort histogram, the at-risk list, the subject heatmap, the House breakdown, and **`SubjectTrajectoryView` teacher comments** (which contain literal cohort-relative prose, e.g. *"Mock 2 raw score 89/100 — top quartile"*, INCR-17 B.2 card 3). **The parent surface renders no teacher comments at all.** Do not import a single INCR-18 component, and do not render `mock_results` comment text here.
3. **`readiness_statements.projection_snapshot_json`.** It carries `{mock1Aggregate, mock2Aggregate, projectedAggregate, band, subjects:[…]}` — all this-child, so it is safe **except `band`**, which is the **cohort tier vocabulary** (`Top tier · 6–12`, `AGGREGATE_BANDS`). The parent surface **never renders the band**. Keep it that way, or translate it (Part I.4).

## H.3 Enforcement, not just omission

Omitting cohort UI is necessary and not sufficient. The read path must be structurally incapable of returning another child:
- Resolve the child **from the session**, never from the URL (Part L.2).
- The **parent-scoped RLS policy** (the one deliverable of INCR-19 per build-plan line 2080) must scope on the guardian→student link, not on `school_id` alone — a plain `tenant_isolation` policy lets a PARENT read **every candidate in the school**. **This is the whole point of the increment** and it is blocked by Part L.1.
- No parent route may accept a candidate id, index number, or student slug as a parameter.

---

# PART I — Staff jargon → parent language (the translation register)

The surface does real translation work. Where it succeeds, replicate exactly. Where it does not, **flag — do not invent copy.**

## I.1 🔴 `aggregate` — used **unexplained**. The one genuine language gap.

`Projected aggregate 10` (§1 child card) · `projected aggregate of <b>10</b>` (§5 statement) · `What does the projected aggregate of 10 mean now?` (FAQ Q5) · `Yaa's aggregate calculation will include the English grades…` (FAQ Q1) · `the aggregate of 10 holds` (Q5).

The staff surface has a whole explainer card (*"WASSCE grades convert to points on a 1–9 scale… The aggregate is the sum of points from the best 3 cores plus the best 3 electives… Lower aggregate = better"*, INCR-17 A.4). **The parent surface has no equivalent.** Q5 explains only *why the number hasn't changed*, never *what it is* or *that lower is better*.

> **Flag, do not fix:** a Ghanaian SHS parent likely knows "aggregate" from admissions culture — this may be deliberate. But `cut-off 11 · one place inside` is unreadable without knowing lower=better. **Recommend an owner/Kofi call**: add a 7th FAQ ("What is an aggregate?") reusing the staff explainer's first two sentences, or a small info affordance beside `.cc-target-meta`. **Do not author the copy in the build without that ruling.**

## I.2 ✅ `missed` → **`postponed`** — the exemplary translation

Staff pill `Missed · medical` → parent pill `Postponed · SC-12 filed`; hero headline `formally postponed by WAEC`. Rule stated in the notes: *"The school owns the language… they have not been failed."* **Implement as a separate parent label map** (Part B.3). This is the model for every other divergence.

## I.3 ⚠️ Match-tier words `(comfortable) / (stretch) / (safety)` — exposed unglossed

`.rc-body` lists supporting choices with bare parenthetical tier words. On the staff surface each has a **legend gloss** (`Cut-off 2–4 above projected aggregate`, etc., INCR-17b A.6). The parent gets the word alone. "Safety" and "stretch" are reasonably self-evident in admissions English; **"comfortable" is the weakest**. Flag; low severity; render verbatim.

## I.4 ✅ Terms correctly kept OUT — do not reintroduce

Absent from the parent surface entirely, and they must stay absent: **predictor mock · moderation / moderated grade · best-3 · tier band (`Top tier · 6–12`) · cohort distribution · credit pass · dropped subject · aggregate band · raw score · at-risk.** Several exist in `readiness-view.ts`/`cohort.ts` types the implementer will have open. **Do not surface them.**

## I.5 ✅ Terms used AND explained in place

| Term | Where explained |
|---|---|
| `SC-12` / special consideration | §3 title + explainer bullets 1–2 + FAQ Q1 — thoroughly |
| `fit-to-sit` | §3 bullet 3 ("assess Yaa… If they confirm she is fit to sit") + FAQ Q2/Q3 |
| make-up sitting is **off-site** | §3 bullet 4 ("not here at the school") + notes rule |
| `Mock 2` | `.rc-subtitle` ("After the March 2026 mock cycle · before the WASSCE in May") |
| `index` / `centre code` | shown as labelled facts; centre code justified by the discharge-planning use |
| WAEC ref number | notes: *"what the parent quotes when asking about the case"* |

## I.6 The tone contract (from the notes — build rules, not flavour)

- **Second person everywhere**: `called you`, `what you signed`, `You raised one concern`, `You do not need to come to the school`. Never third-person about the parent.
- **The school does the work**: *"What the school is doing **for you**"*, *"everything heavy is done by school"*, *"You will be informed before, during, and after."*
- **No newer than the last comms**: *"The page surfaces what the parent has been told, in order. Nothing newer than the last comms timestamp."* **This is a data rule** — the portal must not reveal a fact the parent has not yet been told by phone/SMS. Part K.7.
- **End on reassurance, not action.** The FAQ is last. Nothing follows.

---

# PART J — Read / WRITE control register — **THE COMPLETE INVENTORY**

**Every interactive element on the surface. There are eleven. Zero are writes.**

| # | Control | Section | Kind | Target | Build |
|---|---|---|---|---|---|
| 1 | `Call Matron Bediako` | §1 hero | **contact** | `tel:` | wire to MATRON phone |
| 2 | `Call Head of Academics` | §1 hero | **contact** | `tel:` | wire to VHM_ACADEMIC phone |
| 3 | `Hospital ward info` | §1 hero | nav | — | **inert** (4.4 not built) |
| 4 | `View SC-12 form` | §3 | **READ** | SC artifact/PDF | read-only render; never the staff filing form |
| 5 | `Hospital clinician contact` | §3 | contact | — | **inert** (4.4) |
| 6 | `Call Mrs Owusu-Ansah` | §3 | **contact** | `tel:` | wire |
| 7 | `View signed PDF →` | §5 statement | **READ** | `/api/senior/readiness-statement/{id}` | existing route (#136) |
| 8 | `Hospital map & directions →` | §5 hospital card | nav | — | **inert** (4.4) |
| 9 | `Open contact directory →` | §5 contacts card | nav | — | **inert** |
| 10 | `WAEC Western Region contact →` | §5 WAEC card | nav/[REF] | static WAEC contact | static |
| 11 | The six `.pn-item` nav tabs | shell | nav | 5 of 6 unbuilt | only `WASSCE` routes |

**Not present anywhere in the file:** `<form>` · `<input>` · `<textarea>` · `<select>` · `<button>` · submit · checkbox · signature pad · OTP field · reply box · upload · "acknowledge" · "confirm" · "I have read".

> **✅ VERDICT: INCR-19 is a READ-ONLY surface.** No parent-initiated state change of any kind. The only parent-side "writes" a build could infer are (a) the readiness signature and (b) a comms reply — **the surface draws neither**, and both are flagged in Part E.2 / Part D.4 as decisions requiring a Kofi ruling and (for the signature) an owner SMS gate, **not** an implementer's judgement.
>
> **Authz (proposed for Kofi/Sarah):** a new `PARENT`-gated route group. `appRoleEnum` already has `PARENT` (`db/schema/_enums.ts:25`); `lib/access.ts` has **no parent group** yet (its three groups all end *"STUDENT / PARENT never reach it"*). INCR-19 adds the **first** parent-reachable route in the product. Every existing WASSCE gate must **stay** closed to PARENT — the new gate is additive and narrow: one route, one child, read-only, no server action.

---

# PART K — 🔴 Elements with NO clean data binding

Ordered by severity.

## K.1 The whole comms thread (§4) — **the largest gap**

`notification_log` gives: `phone`, `message`, `status` (QUEUED/SENT/…), `student_id`, `sent_by_user_id`, `created_at`. The thread needs **seven** display fields per row:

| Field | Example | Binding |
|---|---|---|
| time | `06:52` | ✅ `created_at` |
| **channel** | `Phone` / `SMS` | 🔴 no discriminator — `notification_log` is SMS-only |
| **from + role** | `Matron Mrs G. Bediako` / `Mrs C. Owusu-Ansah (Head of Academics)` / `Omnischools system` | 🔴 no display-label column (`sent_by_user_id` gives a name, not a role-suffixed label; automated rows have no sender) |
| **direction** | `called you` | 🔴 none |
| content | the note / the quoted SMS | ⚠️ `message` covers SMS only; **call summaries have no home** |
| **status + duration** | `Delivered · 4-minute call · you were at bedside` | ⚠️ `status`→`Delivered`; duration and the annotation 🔴 none |
| **future/scheduled row** | the 21:00 row | 🔴 `notification_log` has no scheduled/future concept |

**Three of six rows (the phone calls) have no table at all.** Options for Kofi: (a) render **SMS-only** in v1 from `notification_log` and drop the call rows (honest, thin, breaks the notes' "did you call me?" contract); (b) a new `parent_contact_log` table (channel · direction · from · summary · duration · scheduled_for · status) — **but INCR-19 is explicitly "no new migration"**; (c) defer §4 to a comms increment and ship §1/§2/§3/§5 now. **Recommend (c) or (a)** — do not smuggle a table into a no-migration increment.

## K.2 Everything clinical — Sickbay (4.4) is not built

**No binding:** hero cells 1–2 (`Ward B · bed 7`, `Responding well`, `IV artesunate · 14:30 ward round`) · the entire **Hospital details** card (6 rows + map link) · the entire **NHIS coverage** card (6 rows + tail) · the NHIS number on the child card · every ward/clinician phrase inside the §1 prose, §3 bullets and §4 call summaries.

`waec_special_consideration` has only `notes` (free text) and two nullable **file-id placeholders with no files table**. `wassce_candidates.reg_flag = ON_MEDICAL` is a **display pill, never a data source** (Kofi K3). **≈20 displayed values, zero columns.**

> Same treatment as INCR-17 D.1: render clinical fields **only if** they are captured on the SC record as static text, else **omit the row entirely** (never `—` for a medical fact the school has not recorded — an em-dash next to "Treatment" reads as *no treatment*). Cards F.1/F.2 should render **only when populated**; otherwise omit the card (Part M.5).

## K.3 🔴 Step 3 `Awaiting fit-to-sit` — the active step has no column

`scStatusEnum` (7) vs the parent strip (5):

| Parent step | Proposed status source | Clean? |
|---|---|---|
| 1 `Filed` | `filed_at` / status ≥ FILED | ✅ |
| 2 `Acknowledged by WAEC` | `waec_acknowledged_at` / ACKNOWLEDGED | ✅ |
| 3 **`Awaiting fit-to-sit`** | **nothing** — the demo sits at ACKNOWLEDGED with step 3 *active* | 🔴 **the date `Mon 1 Jun` and the fitness assessment are stored nowhere** |
| 4 `Date scheduled` | `make_up_scheduled_at` / SCHEDULED | ✅ |
| 5 `Yaa sits papers` | `completed_at` / COMPLETED + `make_up_centre` | ✅ |

**Also unmapped:** `DRAFT` (should the parent see an unfiled draft? **No** — Part M.3), `APPROVED` (no parent step — folded into 3→4?), **`REJECTED`** (🔴 **no parent-facing design at all**, and it is the state a parent most needs explained).

> **Kofi call:** either (a) derive step 3 as "ACKNOWLEDGED and not yet SCHEDULED" and render the fit-to-sit date from the **school's own scheduling** — which has no column either — or (b) accept step 3's date as **unbound/omitted** and show the step without a date. **Recommend (b) for v1**: pulse the step, drop the date, rather than fabricate one. And **design the REJECTED parent state** before shipping — that is the hardest conversation this surface will ever have to hold, and it currently has no copy.

## K.4 Form Master per-child — partial

`role_assignment.scope_ref` is documented as *"programme_id / house_id / class_id, role-dependent"*. A FORM_MASTER assignment scoped to the child's class resolves it — **verify the seed actually scopes it**; if `scope_ref` is null for form masters, the name cannot be resolved per child and the row must be omitted rather than showing an arbitrary form master.

## K.5 Statement prose tail

`Mrs Owusu-Ansah noted this on the form and we discussed UCC Biochemistry as a closer fallback.` — the naming of a *specific fallback programme discussed* is not a column. Either fold into `parent_concerns_text` at capture, or drop the clause. Do not hard-code a university name in a template.

## K.6 The two nav `.dot` unread markers

No unread/notification-state table. Derive (open SC = WASSCE dot) or **omit**. Never render a permanent dot.

## K.7 "Live · … 14:45 GMT" and the freshness contract

The eyebrow renders a wall-clock 15 minutes **after** the last thread event (14:30). So the timestamp is `now()`, but the notes forbid content newer than the last comms event. **Resolve as:** the eyebrow shows **server-rendered current time** (the "you are looking at a live page" signal); **every fact below it** must trace to a communicated event. If those ever diverge, show the **last-updated** time instead of now — a stale-but-honest timestamp beats a live-looking page with old facts.

---

# PART L — Identity, routing & the parent-scoped RLS policy

## L.1 🔴 **BLOCKING: there is no link from an authenticated user to their child.**

- `student_guardian` (`db/schema/students.ts:196`) = `id · school_id · student_id · name · relationship · phone · email · is_primary · created_at`. **No `user_id`.**
- `users` (`db/schema/identity.ts:5`) = `id · phone · email · full_name · created_at`. **No student link.**
- `role_assignments` = `user_id · school_id · role_id · scope_ref · start/end`. `scope_ref` is a bare uuid documented as *"programme_id / house_id / class_id"*.

**A PARENT user therefore cannot be resolved to a child today.** The one deliverable of INCR-19 — *"parent-scoped RLS policy (prod-paste)"* — **has nothing to scope on**. Options for Kofi/Wells:
- **(a)** Join on `users.phone = student_guardian.phone` (both E.164; `users.phone` is unique). **Zero migration** — fits the no-new-migration constraint. Fragile: a phone change silently detaches a parent; two guardians sharing a phone both match; and a *guardian phone* becoming an *authentication* key deserves Sarah's eyes.
- **(b)** Use `role_assignments.scope_ref` = `student_id` for the PARENT role. Zero migration; one row per child, so multi-child parents get multiple assignments — but `scope_ref` becomes polymorphic across a fourth meaning, and the existing role-scoping code (post-#167) must be checked for that assumption.
- **(c)** Add `student_guardian.user_id`. Correct and explicit — **but it is a migration**, which INCR-19 is scoped not to have.

> **This is the increment's real gate, and it is a schema question, not a design one — I raise it because the surface's core promise ("one child and nothing else") is unenforceable without it.** Recommend Kofi rule before build starts; **(a)** is the smallest thing that could work with Sarah's sign-off, **(c)** is the right one.

## L.2 🔴 Do NOT build the drawn URL

The mock shows `parent.omnischools.gh/asankrangwa/aidoo-yaa/wassce` — a **separate subdomain** + school slug + **child-name slug**. Two problems:
1. **A child's name in a URL is PII in a URL** — the exact pattern this repo already forbids (boarding AC J4: external PII *"never in a URL/SMS log"*). URLs land in logs, referrers, browser history and shared screenshots.
2. **Any child identifier in the path is an enumeration surface**, even with RLS behind it.

> **Build instead:** `app/(app)/parent/wassce/page.tsx` (or equivalent) in the existing app shell, **PARENT-gated, child resolved from the session** (L.1), **no route parameter**. The `parent.` subdomain is a marketing/IA idea, not a routing requirement — treat the browser-bar URL as cosmetic (as every prior WASSCE map has). If multi-child support is ever needed, use a child **switcher in the header**, backed by the session's guardian links — still no id in the path.

## L.3 PII rendered in full — deliberate, but note it

The surface shows the child's **NHIS number**, **WAEC index**, **date of birth**, **hospital ward and bed**, **diagnosis**, **treatment**, and **clinician name** — plus the **parent's own phone** on the signature line. **All of it is the guardian's own child's data and is legitimate for this reader.** Two constraints follow: (1) none of it may enter a URL, an SMS body, or a log line; (2) if the readiness/SC PDFs are generated server-side and cached, they inherit the same rule as the receipt PDFs. **No masking is required on-screen for the guardian** (unlike the boarding visitor record, where the PII belongs to a third party).

---

# PART M — State matrix (the states the surface does NOT draw)

The mock draws exactly one scenario: **a live medical case, mid-process, with a signed statement.** Every other state is derived. These are the ones a build must render.

## M.1 §1 hero — the **no-live-case** state (🔴 the common case, not drawn)

Most parents most days have **no open SC-12**. The terra "Active case" hero is then wrong at every level.

| State | Render |
|---|---|
| **open SC (drawn)** | terra hero, pulse, 3 cells, 3 actions |
| **no open SC** 🔴 | **Omit the terra hero entirely.** Lead with the child card, then the schedule with the next paper highlighted. A calm variant (gold or surface, "Next paper · Mathematics · Wed 3 Jun") would need new copy — **flag for a design pass, do not improvise a red banner with cheerful text.** |
| **WASSCE not started / no cohort** | omit hero; schedule shows the full upcoming list; no live eyebrow |
| **WASSCE complete** | omit hero; schedule all `Sat · attended`; statement + FAQ remain |

## M.2 §2 schedule

| State | Render |
|---|---|
| populated (drawn) | 9 rows, 4 pill states |
| **no papers scheduled** | card with the head + one empty line — *the surface has no empty copy; needs a string.* Never an empty white card. |
| all sat | every pill `Sat · attended`; no `.next` row |
| a paper with no date (`scheduled_date` null) | date rail = **`—`** (em-dash convention), pill `upcoming` **without** a day-count — never "In NaN days" |
| **loading** | skeleton rows preserving the `auto 1fr auto` grid; never a spinner over a blank card |

## M.3 §3 SC-12 process — the status states

| SC status | Parent render |
|---|---|
| **none** | **omit the entire §3 card** (and the WAEC card's rows 3–4) |
| `DRAFT` | 🔴 **omit — a parent must not see an unfiled draft.** The school has not filed yet; showing it promises something that has not happened. |
| `FILED` | step 1 done, step 2 **active**; `waec_ref` row hidden until it exists |
| `ACKNOWLEDGED` (drawn) | steps 1–2 done, step 3 active |
| `APPROVED` | 🔴 no distinct step drawn — fold into step 3→4 (Kofi, K.3) |
| `SCHEDULED` | step 4 done + the date; step 5 active |
| `COMPLETED` | all 5 done; card may collapse to a summary |
| **`REJECTED`** | 🔴 **NOT DESIGNED. Blocking for ship.** Needs its own treatment and copy (what it means, what happens next, who is calling the parent). Do not render a stalled gold pulse. |

## M.4 §5 readiness statement — the unsigned/absent states (🔴 not drawn)

The card exists **only** in its signed form. `readiness_statements` legitimately produces three other states:

| State | Data | Render (DERIVED — needs a design ruling) |
|---|---|---|
| **no statement** | no row | **Omit the card.** (Statements are generated after the predictor mock is marked; before that there is nothing to show.) |
| **generated, unacknowledged** | row exists, `parent_acknowledged_at IS NULL` | 🔴 **not drawn.** Minimum honest version: neutral (not gold-`✓`) icon, title in the present tense, `View PDF →`, and **no signature line**. **Under option (a) (read-only) there is NO sign button** — the parent is told the school will call. **Adding a button here converts INCR-19 to a write surface (Part E.2) — Kofi ruling required.** |
| **acknowledged (drawn)** | `parent_acknowledged_at` set | as mapped, E.1 |
| **superseded** | `superseded_at` set, a newer row exists | show the **current** statement only (`superseded_at IS NULL`). History is staff-side. Never show a parent two conflicting projections. |
| ack method ≠ PHONE_OTP | `IN_PERSON` / `PDF_UPLOAD` | signature line must vary: `In-person signature · recorded by {hoa} · {date}` / `Signed form received · {date}`. **The surface only draws PHONE_OTP** — the other two need strings. |

## M.5 §5 info cards + FAQ

| Card | Empty behaviour |
|---|---|
| Hospital · NHIS | 🔴 unbindable (K.2) — **omit the whole card** when unpopulated; never render six em-dashes against medical labels |
| Contacts | omit individual rows whose role is unfilled; the card survives on the centre code |
| WAEC | rows 3–4 (make-up centre, SC ref) only when an SC exists |
| FAQ | Q1/Q2/Q3/Q6 are **SC-specific** — with no open SC they are nonsense. **Show the SC FAQ block only alongside an open SC**; Q4/Q5 are evergreen. 🔴 A no-SC FAQ set is not drawn — flag. |

## M.6 Loading & error (global)

- **Loading:** skeletons that hold layout (hero block, 9 schedule rows, 6 thread rows). No spinner-over-blank.
- **Error:** a parent must never see a stack trace, a table name, or a candidate id. One calm message + the school's phone number — **the fallback for this audience is a phone call**, which is exactly what the rest of the surface says. Copy needs authoring; flag.
- **Partial failure:** each region renders independently. A dead Sickbay read must not blank the schedule.

---

# PART N — Cross-module hooks (design commitments — preserve)

| Hook | Where on this surface | Status |
|---|---|---|
| **Sickbay → SC-12** | hero cells 1–2, hospital card, NHIS card, §4 call summaries | **Design commitment, unbuilt.** 4.4; auto-suggest is Decision 9, deferred. Preserve the *shape* (the parent surface is the strongest argument for the sickbay data model — it consumes ward, bed, clinician, treatment, ward-round, and NHIS itemisation). |
| **Sickbay → attendance (`M`)** | not shown | the child is on the 5-status `M` path (repo memory `attendance-five-statuses`) — not surfaced to the parent; noted for consistency. |
| **SC-12 → WASSCE schedule** | §2 `Postponed · SC-12 filed` pills | ✅ built (0053) — the sitting↔SC join, parent-labelled. |
| **Projection → university target** | `.cc-target-meta`, `.rc-body` | ✅ built (0053/0054) — `projectAggregate()` + `matchMargin()`. |
| **Readiness statement → PDF** | `View signed PDF →` | ✅ built — receipt-PDF path #136. |
| **Comms → parent portal** | §4 whole section + the `Communications` nav tab | **partially unbuilt** — K.1. |
| **Billing / NHIS → parent** | `Billing` nav tab; the NHIS "meals GHS 24/day" line | nav only; the fee link is a later parent increment. |
| **Ledger trajectory → WASSCE predictor** | **absent by design** | staff-only reasoning. **Do not surface it here.** |

---

# PART O — Surface-sync notes (issues in the source HTML — render as-is, flag for a fix)

1. **`.cc-pill` Science = green tint** (`#E5F0EB`/`#1E5A35`) while INCR-15's programme pill is terra. **Same drift INCR-17 §0.3 already logged** on the staff identity card — reconcile once, both surfaces.
2. **Cut-off shown without its reference year.** `.cc-target-meta` renders `cut-off 11`; INCR-17b made `cutOffLabel()` → `11 (2025)` mandatory ("never render a cut-off without its reference year" — snapshot honesty). **The parent needs the stamp more than staff do.** Recommend rendering `cut-off 11 (2025)`; flag the surface.
3. **Index/NHIS not in mono.** Every staff surface renders `0184-0817` and ref codes in JetBrains Mono; the parent child-card uses body font (mono is applied only to the §4 timestamps and the §3 WAEC ref). Probably deliberate softening for a parent — **replicate as drawn**, flag for confirmation.
4. **Elective Maths absent from the schedule.** 9 rows / 8 subjects; the staff surface shows a 9th subject (Elective Mathematics, dropped from best-3, paper 13 Jun). If the child sits it, the parent arguably should see it. Replicated as omitted; confirm.
5. **Step-number contradiction in §3.** Head says *"Step 5 is between you, Yaa, and the clinician"*; the strip's step 5 is `Yaa sits papers` and fit-to-sit is **step 3**. The notes repeat the error (*"the parent and clinician own step 5 (fit-to-sit confirmation)"*). **Render verbatim; flag.**
6. **§4 section-meta arithmetic.** Meta says `6 events · 4 phone calls · 2 SMS · 1 scheduled`; the thread lists **3 phone + 3 SMS** (one scheduled). Editorial chrome (not built), but the underlying counts should be derived, not written.
7. **`.thread-msg.system` is applied to human phone calls** and *not* to the automated system SMS rows. The class name inverts its meaning. Rename to `.thread-msg.call` at sync; **keep the visual mapping** (calls get the `bg-bg` tint).
8. **Currency format.** `GHS 24/day` and `meals (GHS 24 line)` vs the convention `GHS 24.00` (always two decimals). Flag; the `/day` suffix is a rate, so the convention may need a rate clause.
9. **Make-up-window duration stated twice, differently.** §3 bullet 4 `typically within 10 working days of fit-to-sit`; FAQ Q2 `Typically 5–10 working days after the confirmation`. **One constant, two renderings.**
10. **`.notes` right-rail + the outer editorial `.page-header`/`.section-head`/`.section-meta` are design-doc chrome — do NOT build.** Only the `.parent-shell` frame is the target.
11. **`href="#"` on every link.** All nav/PDF links are placeholders in the mock; Part J names the real targets and the inert ones.

---

# PART P — Open questions (for Kofi / Wells / Sarah / owner)

1. **🔴 The parent→child link (Part L.1).** No `user_id` on `student_guardian`. Phone-match (a), `scope_ref` (b), or a column (c)? **This blocks the parent-scoped RLS policy, which is the increment's only stated deliverable.** Wells + Sarah.
2. **🔴 Is INCR-19 read-only?** The surface says yes (zero write controls, Part J); the `readiness_statements` schema comment says *"the parent-facing signing UI is INCR-19."* **Recommend read-only (option a, Part E.2).** If a parent signing flow is wanted, it needs: an unsigned-state design (M.4), an owner-gated Hubtel OTP send, a parent WRITE RLS policy, and its own increment. Kofi + owner.
3. **`university_targets.parent_acknowledged_at` stays writerless** (Part E.3) — the surface draws no per-target ack. Confirm the column remains unwritten, or scope a per-target ack elsewhere.
4. **§4 comms has no table (K.1).** SMS-only from `notification_log` / defer §4 / a new table (which breaks "no new migration"). Kofi.
5. **Step 3 `Awaiting fit-to-sit` has no column (K.3)**, and **`REJECTED` has no parent-facing design (M.3)** — the latter is **blocking for ship**.
6. **All clinical + NHIS data is unbindable (K.2)** — ~20 displayed values, Sickbay 4.4. Confirm: omit the two cards and the two hero cells in v1, or carry static text on the SC record.
7. **The no-live-case hero (M.1)** — the common state is not drawn. Needs a design pass before an implementer improvises.
8. **`aggregate` is never defined for the parent (I.1)** — add a 7th FAQ, an inline gloss, or accept it. Owner/Kofi call; **do not author new copy without it.**
9. **Routing (L.2):** confirm no child identifier in the path and no `parent.` subdomain requirement for v1.
10. **Phone-first responsive (0.6):** confirm the 5-step strip goes **vertical** on phone (the canonical vertical step nav) rather than compressing five labels across 360px.
11. **Reference-year stamp on the parent cut-off (O.2)** — render `11 (2025)` or accept the bare number?

---

*Map produced against: `Surfaces/schoolup-wassce-parent-tracker.html` (whole file, lines 1–947; CSS 10–204, §1 218–328, §2 330–510, §3 512–629, §4 631–766, §5 768–942); `md files/design-tokens.json` v1.0.0; house style, grade palette, chrome conventions and no-alpha discipline reused from `docs/senior/wassce-{spine,mock,readiness,university,cohort}-surface-map.md` (INCR-15/16/17/17b/18 — **not re-derived**); shipped schema `db/schema/{wassce,students,identity,comms}.ts` + `db/schema/_enums.ts` (`scStatusEnum`, `parentAckMethodEnum`, `appRoleEnum.PARENT`) + `lib/wassce/{projection,university-match,readiness-view}.ts` + `lib/access.ts`; `docs/senior-build-plan.md` MODULE 4.3 (INCR-19 row line 2077, "no new migration + parent-scoped RLS" line 2080, owner-gated parent-ack SMS line 2084, 17b R5 per-target-ack deferral line 2210). **No INCR-19 Kofi rulings exist yet — every binding above is a proposal for confirmation.** Projection/SC/statement spine = INCR-17 (shipped) · university match = INCR-17b (shipped) · cohort readiness = INCR-18 (shipped, **hard-boundary off-limits to this surface**) · student-readiness deep-dive = INCR-20 — deliberately NOT mapped.*
