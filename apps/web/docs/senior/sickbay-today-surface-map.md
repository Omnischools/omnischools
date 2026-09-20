# Sickbay — The Today Board · Surface Map (INCR-22c · Module 4.4)

**Author:** Lucy (design cartographer) · **Status:** build-ready design spec for the implementation engineer (Claude Code).
**Increment:** INCR-22c — *the bench-side board: live strip · admitted block · queue · bed board · the 24-hour visit log*. **NO MIGRATION.** Pure derived reads over the shipped 0056 + 0057 spine.
**Source surface:** `Surfaces/schoolup-sickbay-today.html` — **§01** (lines 237–377) and **§03** (lines 469–573).
**Companions:** `docs/senior/sickbay-surface-inventory.md` (module breadth) · `docs/senior/sickbay-setup-surface-map.md` (INCR-21, shipped) · `docs/senior/sickbay-visit-surface-map.md` (INCR-22a/b, shipped — §T1 there is the module-level pass this map supersedes in detail).
**Board:** `docs/senior-build-plan.md` L2462–2502 (R32–R67, the 22a/22b/22c split, the **🟠 22c obligations** at L2497).
**Shipped code this map binds to:** `db/schema/sickbay.ts` (0056 + 0057) · `lib/sickbay/{config,defaults,visits,vitals,visit-copy,visit-reads}.ts` · `lib/access.ts::SICKBAY_{ROLES,CLINICAL_READ_ROLES,CLINICAL_WRITE_ROLES}` · `lib/actions/sickbay-visit.ts` (`TODAY_PATH = "/senior/sickbay/today"` is **already** the revalidation target of every 22a write).

---

## 0. Scope, boundary, and the one structural dependency

### 0.1 In scope — exactly two sections

| Surface § | Title (verbatim) | Lines | Contents |
|---|---|---|---|
| **§01** | `Live situation · admissions, queue, key vitals` | 237–377 | page head · live strip (5 tiles) · admitted block · queue card · bed board · HM awareness strip |
| **§03** | `Recent visits · last 24 hours` | 469–573 | page head · body-shell head-row · 6 visit rows |

### 0.2 Out of scope — map the boundary, do not detail

| Surface § | Title | Owner | Boundary rule at 22c |
|---|---|---|---|
| **§02** | `Today's medication rounds · scheduled dispensing` | **INCR-24** | No round row, no `Mark 17:00 ready`, no dispense state. 0057 authors no medication table. ⚠️ The four times drawn here (`06:30 / 12:30 / 17:00 / 21:00`) are **demo drift and already lose to R13**: the canonical rounds are the three `CANONICAL_SICKBAY_SLOTS` MEDICATION_ROUNDs (06:30 / 12:30 / 21:00). Nothing in 22c may hardcode a round time. |
| **§04** | `Active referrals out · students currently at hospital` | **INCR-25** | No referral card, no comms thread, no NHIS row, no hospital name. |
| **§05** | `Outbreak monitor · 7-day cluster watch` | **INCR-27** | No condition counts, no thresholds, no trend arrows, no GHS notification. |

### 0.3 In-scope elements that structurally depend on an out-of-scope increment

Six. Every one is an **omit**, never a placeholder — no shell, no badge, no `0`, no `—`, no disabled control.

| # | In-scope element | Reaches into | 22c resolution |
|---|---|---|---|
| **Z1** | §01 live tile 4 `Active referrals` (`1` · `D. Sarpong · post-op Akropong`) | referral artefact (INCR-25) | **OMIT the tile.** |
| **Z2** | §01 live tile 5 `Cluster watch` (`URTI` · `6 cases past 7 days · monitor`) | surveillance (INCR-27) | **OMIT the tile.** Strip drops 5 → **3** (A/B) and → **2** (Mode C). |
| **Z3** | §01 lede clauses `· **1 active referral** (D. Sarpong · Wassa Akropong) · URTI mild cluster watch` | 25 / 27 | **TRIM.** Never advertise an absent affordance (FLAG-L1, INCR-21 precedent). Both clauses restore verbatim with their increments. |
| **Z4** | §01 HM awareness strip (whole `.hm-strip`, both rows, `09:17`) | `sickbay_notification` (INCR-26) | **OMIT.** Rendering `notified · 09:17` without a send row asserts a message that was never sent. Copy already preserved verbatim in the visit map §T1.6 — do not re-author it here, and do not render it. |
| **Z5** | §01 admitted block `.ab-line` medication sentence (`Paracetamol 1g → 09:30 and 12:30`, `Hydroxyurea continued`) | MAR (INCR-24) | **OMIT** — and see §4/A13: the *whole* `.ab-line` goes at 22c on adjacency grounds, not only the med clause. |
| **Z6** | §01 admitted block `.ab-line` parent sentence (`Parent (Mrs Mensa) notified **09:22** via SMS + phone call`) | Tier-2 chain (INCR-26) | **OMIT** — same. |

**22c has ZERO dependency on** medications, rounds, referrals, surveillance, notifications, the chronic register, NHIS, or any new column. It reads: `sickbay_settings` + `sickbay_bed` (0056), `sickbay_visit` + `sickbay_admission` + `sickbay_vital_reading` (0057), `students` + `classes` + `houses` + `ref_user` (shipped).

---

## 1. Route, chrome, navigation

### 1.1 One route, two sections — `/senior/sickbay/today`

The surface draws §01 at `app.omnischools.gh/sickbay/today` and §03 at `…/sickbay/today/visits`, each with its own page head. **Build ONE route** with §03 as a section below §01.

Grounding: (a) the surface's own lede calls it *"one page she keeps open beside the dispensing bench from morning round to lights-out"*; (b) the shipped app nav is flat with a single Sickbay row and no sub-nav; (c) two routes = two clinical-gate checks, two readers and two `force-dynamic` renders for one glance; (d) the 24-hour window is self-bounding, so the section can never grow into a browser. The `Visit records` sub-nav item the surface draws is the **future full log browser** (a different surface, INCR-23+), not this section.

`export const dynamic = "force-dynamic"` (B15 — every wall-clock derivation is computed server-side at request time and rendered as a static string; no ticking client clock on a clinical page).

### 1.2 Nav + crumb re-points (Q1 from the visit map — **resolve at 22c**)

| Change | From | To | Why |
|---|---|---|---|
| `components/app/sidebar.tsx` Sickbay row | `/senior/sickbay/setup` | **`/senior/sickbay/today`** | A MATRON is read-only on setup (R18); landing the module's primary actor on a page she cannot edit is wrong. Row count unchanged — still flat, still one row, still `SICKBAY_ROLES`. Setup stays reachable from the board's `Setup` secondary link and from the URL. |
| `components/sickbay/visit-record-console.tsx` crumb link | `/senior/sickbay/setup` | **`/senior/sickbay/today`** | The crumb reads `Sickbay · Visit VR-…`; its link target must be the board the record was opened from. |
| `components/sickbay/new-visit-form.tsx` / `visits/new/page.tsx` crumb link | `/senior/sickbay/setup` | **`/senior/sickbay/today`** | same |
| `components/sickbay/clinical-restricted.tsx` | crumb label hardcoded `Visit record` | add `crumb?: string` prop, default unchanged | the board reuses this component for ADMIN (§7.5) |

**The `/senior/sickbay/visits/new` route SURVIVES** (the 22c obligation at board L2497 offered "absorb or re-point"). Ruling: **re-point, do not absorb.** `createVisit` *is* the queue-entry writer — it stamps `presented_at` with `started_at` null, which is precisely `QUEUED` — so the form is the queue's intake, not a bypass of it. There are no queue-side guards to bypass: `authorizeClinicalWrite()` + the student re-resolve + `uniq_sickbay_open_visit_student` all live in the action. Changes: its crumb re-points to `today`, and the board's `New visit` action links to it. On success `createVisit` already calls `safeRevalidate(TODAY_PATH)`; the form's success path should `router.push("/senior/sickbay/today")` so the matron lands back on the board with the student now in the queue.

### 1.3 Design-doc chrome — do NOT build

| Do NOT build | Lines |
|---|---|
| `.page-header` (`MVP2 · Sickbay · Boarding · Surface 2 of 5`, h1 `Today's *sickbay*`, gold rule, the "matron's live operational view…" paragraph) | 230–235 |
| `.section-head` ×2 (`01` / `Live situation · admissions, queue, key vitals` / `Now · Wed 14 May 14:45`; `03` / `Recent visits · last 24 hours` / `Yesterday 19:40 → Now`) | 238–242, 470–474 |
| `.notes` right rails (5 bullets on §01, 5 on §03) | 366–375, 562–571 |
| `.desktop` / `.browser-bar` / `.url` / the `box-shadow:0 24px 60px -20px rgba(26,43,71,0.25)` | per section |
| `.sidebar` demo nav (10 items + 5 sub-items) and `min-height:1640px` | 247–266 |
| sidebar footer `Mrs A. Bediako` / `Matron · N&MC 04827` | 264 |

The `.notes` are **intent documentation** — port their rules, render none of their text. The two that bind 22c: *"One page, full picture — queue + beds + vitals visible without clicking"* and *"the HM and Slessor housemaster were notified of admission **without seeing the diagnosis** · privacy preserved"*. The second is the whole of §4. (The §03 note *"Slessor House over-represented today (3 of 6)"* is **wrong about its own table** — see §8/F6.)

### 1.4 Page container

`<div className="mx-auto max-w-page px-6 pb-16 pt-6 md:px-9">` — the shipped sickbay page idiom (`visits/new/page.tsx`, `clinical-restricted.tsx`). The surface's `.page-head` (`bg-surface border-b border-border p-[24px_36px_22px]`) and `.body` (`p-[28px_36px_60px]`) are app-frame chrome the shipped shell already provides; do not re-author them.

---

## 2. Tokens, type, bespoke values

### 2.1 `:root` → Tailwind (identical hexes to `md files/design-tokens.json`; tokens confirmed in `tailwind.config.ts`)

| Surface var | Hex | Tailwind | Used in scope for |
|---|---|---|---|
| `--navy` | `#1A2B47` | `text-navy` / `bg-navy` | body text, `.q-time`, `.bed-name`, `.vv`, `.ab-tag.admitted` text, `.btn-sm` text, `.vs-name` |
| `--navy-2` | `#2D3F5C` | `text-navy-2` | `.q-complaint`, `.bed-num`, `.hm-text`, `.v-time`, `.qs-meta b`, `.vs-complaint b` |
| `--navy-3` | `#5C6675` | `text-navy-3` | crumb, lede, `.lbl`, `.ch-meta`, `.meta`, `.qs-meta`, `.bed-meta`, `.vt`, `.bed-state`, `.vs-complaint`, `.hr-l p`, the **re-toned `.bed-condition`** (§4/A1) |
| `--gold` | `#C8975B` | `text-gold` / `bg-gold` / `border-gold` | every italic `<em>`, `.q-time .wait`, `.v-day`, `.btn-sm` fill, `.ab-tag.admitted` fill, `.d-pill.admit` text, `.live-tile.active` border, `.card.featured` border, `.hm-house` |
| `--gold-soft` | `#E8D4B8` | `border-gold-soft` | `.ab-vitals` border, `.ab-line` dashed top border (kept — see §3.3), `.bed-condition` top border |
| `--gold-bg` | `#F5EBDC` | `bg-gold-bg` | `.live-tile.active` gradient end, `.bed.occupied` gradient end, `.adwoa-block` gradient start, `.d-pill.admit` |
| `--bg` | `#FAF7F2` | `bg-bg` | page ground, `.bed` ground, `.hm-row` ground, `.live-clock` ground, `.pill.pending` ground, `.head-row` gradient start |
| `--surface` | `#FFFFFF` | `bg-surface` | cards, tiles, `.bed.empty`, `.ab-vitals`, `.body-shell`, gradient starts |
| `--green` | `#2F6B47` | `text-green` | `.now-dot`, `.d-pill.discharge` text |
| `--green-bg` | `#E5EFE8` | `bg-green-bg` | `.now-dot` ring, `.d-pill.discharge` |
| `--terra` | `#B84A39` | `text-terra` / `border-terra` | `.bed.isolation` border, `.iso-tag` text, `.d-pill.refer` text, `.live-tile.alert` *(tile omitted)* |
| `--terra-bg` | `#F5E1DC` | `bg-terra-bg` | `.iso-tag` fill, `.d-pill.refer` |
| `--warn` | `#C58A2E` | `text-warn` | `.ab-vital .vv.warn` |
| `--warn-bg` | `#F5E9D0` | `bg-warn-bg` | **declared, unused in scope** |
| `--border` | `#E5DFD3` | `border-border` | card borders, every row divider, `.bed` rest border |
| `--border-2` | `#D4CCBA` | `border-border-2` | `.btn` border, dashed empty-state panels |

**Type:** `font-display` = Fraunces (h1, `.ch-title`, `.live-tile .val`, `.ab-name`, `.bed-name`, `.hm-house` *(italic)*, `.hr-l h3`, `.o-cond`) · default = Manrope · `font-mono` = JetBrains Mono (`.q-time`, `.bed-num`, `.vv`, `.live-tile .sub-num`, `.hm-time`, `.v-time`, `.live-clock`).

### 2.2 ⚠️ The token-opacity trap

**§01 and §03 body content are translucency-free.** Every fill is a solid token or a dedicated `-bg` tint. The only `rgba()` in either section belongs to chrome that is **not built** (`.browser-bar` dots/url, `.sidebar` nav/brand/footer, `.desktop` box-shadow).

> 🔴 **Never write `text-navy-3/70`, `bg-navy/80`, `border-gold/40` or any slash-opacity on these tokens.** They are raw hex behind CSS variables: Tailwind's slash-opacity compiles to `color-mix`/`rgb(var(--x) / a)` against a channel triplet that does not exist, so the rule silently renders **nothing** and `next build` still passes. Use a solid token, a dedicated `-bg` tint, or `opacity-N` on the element. **Verify in the live preview, not the build** (repo memory `no-alpha-token-opacity`).

`.now-dot`'s ring is `box-shadow: 0 0 0 4px var(--green-bg)` — **a solid token, no alpha** → `ring-4 ring-green-bg` is safe.

### 2.3 Bespoke values — reproduce exactly, do not round to a scale step

Gradients follow the shipped arbitrary-value idiom in `visit-record-console.tsx` (underscores for spaces, `var(--x)` inside): `bg-[linear-gradient(180deg,var(--surface)_0%,var(--gold-bg)_100%)]`.

**§01**

| Element | Value |
|---|---|
| `.live-strip` | `grid grid-cols-5 gap-[14px] mb-6` → **`grid-cols-3` (A/B)** / **`grid-cols-2` (Mode C)** at 22c |
| `.live-tile` | `bg-surface border border-border rounded-xl p-[16px_18px] relative` |
| `.live-tile.active` | `border-gold border-[1.5px]` + `bg-[linear-gradient(180deg,var(--surface)_0%,var(--gold-bg)_100%)]` |
| `.live-tile.alert` | *(tile omitted — Z2)* same with `border-terra` + `--terra-bg` |
| `.lbl` / `.val` / `.sub-num` / `.meta` | `text-[9px] tracking-[0.14em] uppercase font-bold text-navy-3` · `font-display text-[32px] font-semibold tracking-[-0.018em] leading-[1.05] mt-[3px]`, `<em>` italic gold · `font-mono text-[14px] text-navy-3 font-medium` · `text-[10px] italic text-navy-3 mt-1`, `<b>` → `text-navy-2 not-italic font-semibold` |
| `.now-dot` | `absolute top-[14px] right-[14px] size-2 rounded-full bg-green ring-4 ring-green-bg` |
| `.adwoa-block` → **rename `.admitted-block`** | ⚠️ the CSS class is named after a fabricated demo patient (F8). `bg-[linear-gradient(180deg,var(--gold-bg)_0%,var(--surface)_100%)] border-[1.5px] border-gold rounded-[14px] p-[20px_24px] mb-6` |
| `.ab-head` / `.ab-name` / `.ab-meta` | `flex justify-between items-start mb-[10px] gap-[14px]` · `font-display text-[20px] font-semibold tracking-[-0.01em]`, `<em>` italic gold 400 · `text-[11px] text-navy-3 mt-[3px]`, `<b>` navy-2 600 |
| `.ab-tag` | `px-[9px] py-[3px] rounded-full text-[9px] tracking-[0.08em] uppercase font-bold`; `.chronic` `bg-terra text-bg` **(omitted)**; `.admitted` `bg-gold text-navy` |
| `.ab-vitals` / `.vl` / `.vv` / `.vt` | `grid grid-cols-5 gap-[10px] mt-[14px] p-3 bg-surface border border-gold-soft rounded-lg` · `text-[9px] tracking-[0.12em] uppercase font-bold text-navy-3` · `font-mono text-[14px] font-semibold text-navy`, `.warn` → `text-warn` · `text-[9px] text-navy-3 italic mt-[2px]` |
| `.ab-line` | `text-[12px] text-navy-2 mt-3 pt-[10px] border-t border-dashed border-gold-soft leading-[1.6]`; `.arrow` `text-gold mx-1` — **slot KEPT, content replaced** (§3.3) |
| `.card` / `.card.featured` / `.card-head` | `bg-surface border border-border rounded-xl overflow-hidden` · `border-gold border-[1.5px]` · `p-[14px_20px_12px] border-b border-border flex justify-between items-baseline gap-[14px]` |
| `.ch-title` / `.ch-meta` | `font-display text-[16px] font-semibold tracking-[-0.005em]`, `<em>` italic gold 400 · `text-[10px] text-navy-3 font-semibold tracking-[0.06em] shrink-0` |
| `.col-2` | `grid gap-[18px] mb-6` with the inline override `grid-template-columns:1.4fr 1fr` → `lg:grid-cols-[1.4fr_1fr]` |
| `.queue-row` | `grid grid-cols-[70px_1fr_130px_80px_80px] gap-[14px] p-[14px_20px] items-center border-b border-border` → **`grid-cols-[70px_1fr_130px_80px]` at 22c** (`.q-flag` omitted); `:last-child` no border |
| `.q-time` / `.wait` | `font-mono text-[13px] font-semibold text-navy` · `block text-[9px] text-gold font-bold tracking-[0.08em] uppercase mt-[2px]` **font-body (Manrope inside a mono cell — deliberate)** |
| `.qs-name` / `.qs-meta` | `text-[13px] font-semibold text-navy mb-px` · `text-[11px] text-navy-3`, `<b>` navy-2 600 |
| `.q-complaint` / `.triage` | `text-[12px] text-navy-2` · pill `text-[9px] tracking-[0.08em] uppercase font-bold mt-1 px-[7px] py-[2px] rounded-full`, `.routine` `bg-green-bg text-green` — **pill omitted (R62)** |
| `.q-flag` | `text-[10px] text-navy-3` — **column omitted (R61)** |
| `.btn-sm` | `px-[11px] py-[6px] text-[11px] font-semibold rounded-[5px] border border-gold bg-gold text-navy` |
| `.bed-grid` / `.bed` | `grid grid-cols-4 gap-[10px] p-[18px_20px]` · `bg-bg border border-border rounded-[10px] p-[14px] min-h-[100px] flex flex-col gap-[6px] relative` |
| `.bed.empty` / `.occupied` / `.isolation` | `bg-surface border-dashed`, `.bed-num` → navy-3, `.bed-state` → `mt-auto text-[11px] italic text-navy-3` · `bg-[linear-gradient(180deg,var(--surface)_0%,var(--gold-bg)_100%)] border-gold border-[1.5px]` · `border-terra border-dashed`; `.isolation.empty` → `bg-surface` |
| `.bed-num` / `.iso-tag` | `font-mono text-[10px] tracking-[0.1em] uppercase font-bold text-navy-2` · `inline-block ml-[6px] px-[6px] py-px rounded-full bg-terra-bg text-terra text-[8px] tracking-[0.08em] font-bold` |
| `.bed-name` / `.bed-meta` / `.bed-condition` | `font-display text-[14px] font-semibold tracking-[-0.005em] text-navy` · `text-[10px] text-navy-3`, `<b>` navy-2 600 · `text-[10px] font-bold tracking-[0.06em] uppercase mt-auto pt-[6px] border-t border-gold-soft` — ⚠️ **`text-terra` → `text-navy-3`** (§4/A1) |
| `.hm-strip` | *(omitted — Z4)* `bg-surface border border-border rounded-[10px] p-[14px_18px] mt-[18px]`; `.hs-rows` `grid-cols-2 gap-[10px]`; `.hm-row` `flex gap-[10px] items-center text-[11px] p-[7px_10px] bg-bg border border-border rounded-md`; `.hm-house` `font-display italic text-[12px] text-gold font-semibold` |

**§03**

| Element | Value |
|---|---|
| `.body-shell` | `bg-surface rounded-[14px] overflow-hidden border border-border` |
| `.head-row` | `p-[18px_22px_16px] border-b border-border flex justify-between items-end gap-[14px] bg-[linear-gradient(180deg,var(--bg)_0%,var(--surface)_100%)]` |
| `.hr-l h3` / `.hr-l p` | `font-display text-[20px] font-semibold tracking-[-0.01em]`, `<em>` italic gold 400 · `text-[12px] text-navy-3 mt-[3px]`, `<b>` navy-2 600 |
| `.live-clock` / `.lc-dot` | `font-mono text-[13px] text-navy font-semibold px-[10px] py-[5px] bg-bg border border-border rounded-md` · `inline-block size-[6px] rounded-full bg-green mr-[6px] align-middle` — ⚠️ **dot dropped, copy re-authored** (§5.2) |
| `.visit-row` | `grid grid-cols-[74px_1fr_150px_110px] gap-[14px] p-[12px_20px] items-center border-b border-border text-[12px]` → **`grid-cols-[74px_1fr_110px]` at 22c** (`.v-action` omitted, §4/A12); `:last-child` no border |
| `.v-time` / `.v-day` | `font-mono text-[12px] text-navy-2 font-semibold` · `block text-[9px] text-gold tracking-[0.08em] uppercase font-bold mt-px` **font-body** |
| `.vs-name` / `.vs-complaint` | `text-[12px] font-semibold text-navy` · `text-[11px] text-navy-3 mt-px leading-[1.5]`, `<b>` navy-2 600 |
| `.v-action` | `text-[11px] text-navy-2 leading-[1.5]` — **column omitted** |
| `.v-disposition` / `.d-pill` | `text-right` · `inline-block px-[9px] py-[3px] rounded-full text-[9px] tracking-[0.06em] uppercase font-bold`; `.discharge` `bg-green-bg text-green` · `.admit` `bg-gold-bg text-gold` · `.refer` `bg-terra-bg text-terra` |
| `.pill.pending` *(borrowed from `.round-row`, line 142 — in-file, not authored)* | `bg-bg text-navy-3 border border-border` — the neutral `In progress` variant (§5.3) |

---

## 3. §01 — Live situation · element by element

### 3.1 Page head

| Element | Exact surface copy | 22c |
|---|---|---|
| Crumb | `Sickbay` *(link)* ` · Today` | **BUILD.** `text-[11px] tracking-[0.12em] uppercase font-semibold text-navy-3`; link `text-gold no-underline` → `/senior/sickbay/today` (self) — render the crumb root as a **link to `/senior/sickbay/setup`** only for readers who can reach setup; simplest and shipped-consistent: keep the `Sickbay` word as plain text on the board itself and as a link everywhere else. |
| `<h1>` | `Today's ` + `<em>sickbay</em>` + ` · Wed 14 May 2026` | **BUILD.** `font-display text-[28px] font-medium tracking-[-0.018em] leading-[1.1] text-navy`; `<em>` `font-normal italic text-gold`. Date **derived** — `Intl.DateTimeFormat("en-GB", {weekday:"short", day:"numeric", month:"short", year:"numeric", timeZone:"UTC"})`, the shipped `LONG` formatter in `visits/[visitId]/page.tsx`. ⚠️ Never hardcode `Wed` (F7). |
| Lede | `**1 admitted** · **3 in queue** · **5 visits** earlier today · **1 active referral** (D. Sarpong · Wassa Akropong) · URTI mild cluster watch` | **BUILD, TRIMMED** to `**{n} admitted** · **{n} in queue** · **{n} visits** today`. `text-[13px] text-navy-3 max-w-[720px] mt-1`, `<b>` → `text-navy-2 font-semibold`. Clauses with a zero count are **dropped, not rendered as `0`** — except when all three are zero, when the lede reads the AUTHORED `A quiet day so far — no visits recorded yet.` Referral + cluster clauses restore at 25 / 27 (Z3). ⚠️ `earlier today` → `today`: the count now includes the students still in the queue (§6.3). |
| Action 1 | `Print day sheet` | **OMIT.** No print artefact exists, and a printed day sheet carries every complaint string out of the room (A6 · B16). |
| Action 2 | `New visit` | **BUILD** — `link` styled as the shipped gold button `rounded-[5px] border border-gold bg-gold px-[14px] py-[8px] text-[12px] font-bold text-navy` → `/senior/sickbay/visits/new`. `SICKBAY_CLINICAL_WRITE_ROLES` only. |
| Action 3 | `Admit patient` (`.btn.primary`) | **OMIT.** An admission is a **disposition of an open visit** (R34 requires `started_at`, a complaint and a working impression), so a board-level `Admit patient` has no visit to attach to and would need a picker nobody designed. The real path is `Begin visit` → visit record → `Admit`. Omitting it also deletes an entire Mode-C branch. |
| *(new)* | — | **BUILD** a secondary `Setup` link → `/senior/sickbay/setup`, `rounded-[5px] border border-border-2 bg-surface px-[14px] py-[8px] text-[12px] font-semibold text-navy`. The sidebar row now points at the board (§1.2), so setup needs one reachable door. |

### 3.2 Live strip — 5 tiles → 3 (A/B) / 2 (Mode C)

| # | `.lbl` | `.val` | `.meta` (surface) | 22c |
|---|---|---|---|---|
| 1 | `Admitted now` | `1` + `<span class="sub-num"> / 8 beds</span>` | `**A. Mensa** · bed 3 · SCD crisis` | **BUILD, meta re-authored** (§4/A2). `.active` + `.now-dot`. Value = open admissions; sub-num = ` / {bedCounts.total} beds` (singular ` / 1 bed`). |
| 2 | `In queue` | `3` | `avg wait **4 min** · oldest 7 min` | **BUILD.** `.active` + `.now-dot` **only when the count > 0**; a zero queue is a plain tile with no dot and **no meta line**. |
| 3 | `Visits today` | `5` | `3 discharged · 1 admitted · 1 awaiting` | **BUILD, derived** — see §6.3 for the definition and F5 for the surface's arithmetic error. Zero-valued clauses are dropped; all-zero renders no meta. |
| 4 | `Active referrals` | `1` | `**D. Sarpong** · post-op Akropong` | **OMIT** (Z1) |
| 5 | `Cluster watch` | `URTI` | `**6 cases** past 7 days · monitor` | **OMIT** (Z2) |

**Tile 1 meta, the ruling (A2, unchanged from the visit map, restated because this is the increment that builds it):**
- exactly one open admission → `**{I}. {Surname}** · bed {n}` — **never the condition**
- more than one → `{n} on the ward` — **no names at all**. A list of admitted students on a shoulder-surfed screen is a roll-call of who is unwell.
- zero → value `0`, sub-num ` / {total} beds`, **no meta line**
- Mode C → **the tile does not render**

### 3.3 Admitted-patient block

One block **per open admission**, ordered by `bedNumber` ascending (Q10 → resolved: per-admission; the demo draws one because the demo has one).

| Element | Exact surface copy | 22c |
|---|---|---|
| `.ab-name` | `Adwoa ` + `<em>Mensa</em>` + ` · admitted bed 3` | **BUILD.** `{firstName} <em>{lastName}</em> · admitted bed {n}`; for an isolation bed append ` · isolation` (AUTHORED — the surface never draws an occupied isolation bed). |
| `.ab-meta` | `F1 General Arts · **Slessor House** · Adm. #2025/F1/0214 · admitted **09:14 today** by Mrs Bediako · 5h 31m on bed` | **BUILD** as `{formLabel} · **{House} House** · Adm. {student_code} · admitted **{HH:MM} {today\|d MMM}** by {A. Bediako} · {05h 31m} on bed`. ⚠️ `F1 General Arts` → `formLabel()` renders `F1 GA` (F3 — today prints the full programme name, §03 and the visit record print the short code; one formatter wins). ⚠️ The `#` in `Adm. #…` is **demo chrome, not data** — render `students.student_code` verbatim with no added prefix (F2). ⚠️ Elapsed uses the shipped `formatElapsed()` → `05h 31m` (zero-padded), a deliberate one-character deviation from the surface's `5h 31m`; the same surface prints `05h 31m` on the visit record, so one formatter settles its own inconsistency. House clause drops entirely when `houseName` is null (a day student). |
| `.ab-tag.chronic` | `Sickle cell SS` | **OMIT** (R61 · A3) |
| `.ab-tag.admitted` | `Admitted` | **BUILD** — `bg-gold text-navy` |
| `.ab-vitals` ×5 | `Temp 37.1°C` · `Pulse 88 bpm` · `BP 108/68` · `SpO₂ 98%` · `Pain score 4/10` (`.warn`); sub-lines `13:00 last` ×4, `down from 7` | **BUILD.** Labels use the visit record's vocabulary (§5.3 of the visit map, and the shipped `VITALS_COLUMNS.slice(1,6)`): **`Temp · BP · HR · SpO₂ · Pain`** — `Pulse`→`HR`, `Pain score`→`Pain`. Values from the **latest** `sickbay_vital_reading` for that visit. Sub-line = `{HH:MM} last`. Pain's sub-line = the shipped `painTrend()`: `down from {first}` / `up from {first}` *(AUTHORED for the up case)* / nothing when there is one reading or no change. Colour from the shipped `vitalSeverity(metric, value, /* isCurrent */ true)` → `warn` `text-warn`, `elevated` `text-terra` *(AUTHORED third state, consistent with the visit record's table)*, else `text-navy`. **A tile with a null measure renders NOTHING — no `—`, no `0`** (a dash in a vitals grid reads as "measured and normal" to a nurse). **Zero readings → the whole `.ab-vitals` grid is absent**, replaced by the AUTHORED `No readings yet.` line (`text-[11px] italic text-navy-3`) + the `Open record →` link. |
| `.ab-line` | `Mild vaso-occlusive pain crisis · right shoulder & knee. Hydration started 09:25 (oral, 200ml/h target). Paracetamol 1g → 09:30 and 12:30. Hydroxyurea continued. **Pain trending down 7 → 4** over 5 hours · hold admission, recheck vitals 17:00, plan discharge tomorrow morning if pain ≤ 2 and no fever. Parent (Mrs Mensa) notified **09:22** via SMS + phone call.` | **🔴 SLOT KEPT, CONTENT REPLACED — see §4/A13.** No clinical prose on the board. The line becomes, in the same `.ab-line` styling: `Expected discharge **{16:00 today}**` *(only when `expected_discharge_at` is set)* + `· **reassessment overdue**` in `text-gold font-semibold` *(when that stamp has passed and `discharged_at` is null)* + a trailing gold `Open record →` link to `/senior/sickbay/visits/{visitId}`. When `expected_discharge_at` is null the line renders the link alone. The dashed `border-t border-gold-soft` stays. |

**Nothing is lost that the surface conveyed at a tier the board may carry:** the pain trend (`7 → 4`) survives inside the Pain tile's own sub-line, exactly where the surface already put it.

### 3.4 Queue card

Head: `Queue · ` + `<em>waiting now</em>` · meta `3 students · refresh 15s` → **`{n} students`** (singular `1 student`). `refresh 15s` is a promise nothing implements (F11 · R61) — **omit the literal**. `.card.featured` (gold 1.5px border).

Row grammar — 5 columns → **4**:

| Cell | Surface copy (3 rows verbatim) | 22c |
|---|---|---|
| `.q-time` + `.wait` | `14:38` / `7 min wait` · `14:41` / `4 min wait` · `14:43` / `2 min wait` | **BUILD.** `{HH:MM}` from `presented_at`; wait from the shipped `waitMs()` floored to minutes → `{n} min wait`; **< 1 min → `just now`** (AUTHORED, no trailing `wait`). Add one pure line to `lib/sickbay/visits.ts`: `formatWait(ms)`. |
| `.qs-name` + `.qs-meta` | `K. Asante` / `F2 SCI · **Aggrey House** · #2024/F2/0188` · `P. Owusu` / `F3 GA · **Slessor House** · #2023/F3/0067` · `Y. Boateng` / `F1 BUS · **Kufuor House** · #2025/F1/0091` | **BUILD.** Name = `{I}. {Surname}` (the shipped `shortName` idiom in `visit-reads.ts`); meta = `{formLabel} · **{House} House** · {student_code}` — code **verbatim, no `#` prefix** (F2), House clause dropped when null. |
| `.q-complaint` | `Headache, since after lunch` · `Knee scrape · sports field` · `Menstrual cramps` | **BUILD — the single named adjacency exception (§4/A6).** `sickbay_visit.presenting_complaint`, rendered verbatim, no truncation, no ellipsis: a truncated complaint is a *misread* complaint. |
| `.triage` pill `Routine` | `Routine` ×3 | **OMIT** — R62: a hardcoded pill is an unassessed clinical-urgency assertion; every drawn row is the same value and no surface defines the ladder. |
| `.q-flag` | `No chronic flag` ×3 | **OMIT** — R61: a false **negative**; it asserts a student is *safe* per a register that does not exist until INCR-23. |
| `.q-action` | `Begin visit` | **BUILD** (`.btn-sm`, gold). Calls the shipped `beginVisit({visitId})`, then routes to `/senior/sickbay/visits/{id}`. `SICKBAY_CLINICAL_WRITE_ROLES` only; absent for a HEADMASTER, whose rows still link. |

**Ordering:** `presented_at` ascending — longest wait first, as drawn. The notes say *"the matron picks the order"*; do **not** add a sort control at 22c.
**Row link:** the whole row is a link to `/senior/sickbay/visits/{id}` (the `Begin visit` button stops propagation).
**Empty:** head + one line `No one waiting.` (`text-[12px] italic text-navy-3 p-[18px_20px]`). No illustration, no pep.

### 3.5 Bed board

Head: `Beds · ` + `<em>occupancy</em>` · meta `1 / 8 · 7 empty` → **derive** `{occupied} / {total} · {free} empty`.

Tiles from `config.beds` where `active === true`, ordered by `bedNumber`. Retired beds never render (R8: numbers are stable for life; retirement is `active = false`).

| Tile | Surface copy | Rule |
|---|---|---|
| empty general | `Bed 01` / `Empty` | `.bed.empty` dashed; number **zero-padded to 2 digits at render** (`Bed 01`… `Bed 10`) |
| empty isolation | `Bed 07` + `.iso-tag` `Iso` / `Empty` | `.bed.isolation.empty` — dashed terra border, surface fill |
| occupied | `Bed 03` / `A. Mensa` / `F1 · **Slessor**` / `SCD · 5h 31m` | `.bed.occupied` gold gradient + 1.5px gold border. **The condition is removed** — the footer prints the elapsed time alone (§4/A1). |

**Occupied tile prints exactly:** bed number · `{I}. {Surname}` · `{form} · **{House}**` · `{05h 31m}`. Name + location + duration, never condition.
**Tile link:** an occupied tile links to `/senior/sickbay/visits/{visitId}`; an empty tile is not a control (there is no board-level admit, §3.1).

### 3.6 Housemaster awareness strip — **OMITTED (Z4)**

Copy already recorded verbatim in `docs/senior/sickbay-visit-surface-map.md` §T1.6. Do not re-render it here and do not re-author it. ⚠️ Its *behavioural* commitment binds 22c anyway: **anything a non-clinical reader ever sees about an admission carries name + location, never condition** — the rule §4 applies element by element.

---

## 4. 🔴 ADJACENCY — the headline risk, per element

### 4.1 The threat model, stated so nobody "restores" a helpful detail later

> **This board is a bench-side screen in a room where students queue.** The matron keeps it open beside the dispensing bench from morning round to lights-out (the surface's own lede). The reader gate (`SICKBAY_CLINICAL_READ_ROLES = [HEADMASTER, MATRON]`) controls *who logs in*; it controls **nothing** about who is standing behind her. The threat is **physical shoulder-surfing by other students** — the same students whose classmate is on the bed. Every pairing below is judged on that basis, not on the role gate. **A1/A2/A6/A12/A13 are rendering decisions no column list, no RLS policy and no role check can catch.**

### 4.2 The disclosure ladder — the rule that decides every row

| Tier | Content | On the board? |
|---|---|---|
| **1 · Identity** | name, form, House, student code, initials | ✅ **always** — already public inside the school |
| **2 · Location & status** | bed number, isolation flag, `Admitted` / `In queue` / `Discharged` / `Referred`, admitted-at, elapsed, expected discharge, overdue marker | ✅ **always** — this is exactly the tier the module already commits to disclosing to a housemaster (*"student in sickbay (medical detail withheld)"*) |
| **3 · Measurements** | temp, BP, HR, SpO₂, pain score + their deltas | ⚠️ **only inside the admitted block.** A number without a label is the least self-interpreting clinical datum, and the glance-check on a patient lying 10 metres away is a genuine patient-safety function. **Never** on the queue, the bed board, the live strip or §03. |
| **4 · Clinical assertions** | presenting complaint, working impression, hydration status, plan, escalation triggers, condition names, **drug names** | 🔴 **never on the board — one named exception: the live queue's complaint (A6).** |

### 4.3 §01 — every element classified

| Element | Pairing | Verdict | What the row shows instead |
|---|---|---|---|
| Lede counts | numbers only | ✅ permissible | — |
| Lede `1 active referral (D. Sarpong · Wassa Akropong)` | name + hospital + implied condition | ❌ drop (also Z3) | clause absent |
| Lede `URTI mild cluster watch` | condition, unnamed students | ❌ drop (also Z3) | clause absent |
| Live tile 1 value `1 / 8 beds` | count | ✅ | — |
| **Live tile 1 meta `A. Mensa · bed 3 · SCD crisis`** | **name + bed + CONDITION** | 🔴 **A2 — condition dropped; names suppressed above one patient** | `**A. Mensa** · bed 3` (one) / `{n} on the ward` (many) / no meta (zero) |
| Live tile 2 meta `avg wait 4 min · oldest 7 min` | aggregate durations | ✅ | — |
| Live tile 3 meta `3 discharged · 1 admitted · 1 awaiting` | outcome counts, no names | ✅ | — |
| `.ab-name` `Adwoa Mensa · admitted bed 3` | name + bed | ✅ tier 1+2 | — |
| `.ab-meta` form · House · code · admitted-at · by-whom · elapsed | identity + location + duration | ✅ tier 1+2 (A10 accepted) | — |
| **`.ab-tag.chronic` `Sickle cell SS`** | **name + CONDITION, above the fold, on the landing page** | 🔴 **A3 — omit.** At INCR-23 it returns **inside the visit record only**, never on this board | tag absent |
| `.ab-tag.admitted` `Admitted` | status | ✅ | — |
| `.ab-vitals` 5 measures + sub-lines | name + measurements | ⚠️ **A14 — permitted, and this is the ONLY tier-3 element on the board.** It is the ward-observation instrument; removing it pushes the matron to open full records more often, which is *worse* for exposure overall | unchanged |
| **`.ab-line` narrative** (`Mild vaso-occlusive pain crisis · right shoulder & knee… Hydration started… Paracetamol 1g → 09:30… Hydroxyurea continued… plan discharge tomorrow…`) | **name + working impression + drug names + plan, in prose, on the landing page** | 🔴 **A13 — NEW, and it REVISES the visit map's A8.** This is strictly worse than the bed tile's `SCD` that A1 already removed — it names the impression *and* the drugs (A4's double leak: `hydroxyurea` ⇒ sickle cell to any nurse or curious student), eight lines above the tile A1 sanitised. A8 justified it on the *role* gate; A11 says the role gate is not the threat. **Consistency wins: the board never prints a clinical assertion.** | `Expected discharge **16:00 today**` · `· **reassessment overdue**` when due · `Open record →` (§3.3) |
| **Queue `.q-complaint`** (`Menstrual cramps`, `Headache, since after lunch`) | **name + complaint, beside the queueing students themselves** | ⚠️ **A6 — the ONE named exception. KEEP.** Triage ordering is impossible without it, it is 3–5 live rows about students physically present who already know why they are there, and the alternative (open each record to triage) exposes far more. **On screen only, never on paper** — the independent reason `Print day sheet` is omitted | unchanged, un-truncated |
| Queue `.q-flag` `No chronic flag` | name + a *safety* claim | ❌ **A5 — omit.** A false negative is worse than a false zero. At 23, a **neutral marker** (`Care plan on file`), never the condition | column absent |
| Queue `.triage` `Routine` | unassessed urgency assertion | ❌ omit (R62) | pill absent |
| **Bed tile `.bed-condition` `SCD · 5h 31m`** | **name + CONDITION on the most-shared element of the most-shared screen** | 🔴 **A1 — the map's central ruling. Condition removed, duration only**, and the colour goes `text-terra` → `text-navy-3` (terra signals a clinical alarm; a duration is not an alarm) | `05h 31m` |
| Bed tile `.iso-tag` `Iso` | bed property, not a student property | ✅ — it labels the **bed**, and renders on empty isolation beds too | — |
| Occupied bed `{form} · Slessor` | identity | ✅ | — |
| HM strip rows | name-free by design | ✅ *(omitted at 22c for a different reason — Z4)* | — |

### 4.4 §03 — every element classified

§03 is a **log**, not a triage queue. Nothing on it is being decided. That is what breaks the A6 exception: A6 buys the complaint with an operational necessity that a closed visit does not have.

| Element | Pairing | Verdict | What the row shows instead |
|---|---|---|---|
| `.v-time` `14:22` + `.v-day` `Today` / `Yesterday` | time | ✅ | — |
| `.vs-name` `D. Mensah` | identity | ✅ | — |
| `.vs-complaint` **form · House fragment** (`F2 BUS · **Nkrumah**`) | identity | ✅ | keep — it disambiguates two students with the same surname |
| **`.vs-complaint` complaint fragment** (`cut on left hand from carpentry workshop`, `period pain · routine, no fever`, `fever 37.8°C, headache · malaria RDT negative`, `sickle cell pain crisis · right shoulder, knee · pain 7/10`, `forgot AM inhaler dose · asthma chronic`, `wrist pain after inter-house football · swelling`) | **name + complaint + impression + vitals + chronic condition — SIX rows at once** | 🔴 **A12 — NEW. DROP the entire clinical fragment.** Note what the surface actually put here: three of the six strings are not complaints at all but *impressions*, *readings* and *condition names* (`malaria RDT negative`, `sickle cell pain crisis`, `asthma chronic`, `pain 7/10`). Six of them are legible from across the room at once, versus the queue's three, and none of them earns its place: **nothing about a closed visit is being decided from this list.** The matron needs to *find the row*, and time + name + form + House + outcome finds it. The clinical content is one click away, in the record, where it belongs | `**{form} · {House}**` alone |
| **`.v-action`** (`Cleaned, dressed, tetanus current` · `Paracetamol 1g · rest 45 min` · `Hydroxyurea continued · paracetamol · hydration · bed 3` · `Salbutamol 2 puffs · counselled` · `Referred to Asankrangwa Govt for x-ray`) | **name + treatment + DRUG NAMES, six rows at once** | 🔴 **A12b — DROP the column entirely.** This is A4's drug-re-identification leak (`Hydroxyurea` ⇒ sickle cell, `Salbutamol` ⇒ asthma) rendered per row, on a bench screen. It is *also* half-unbacked: it mixes `plan` with medications that are INCR-24's, so building it would fabricate a shape as well as leak one | column removed; grid 4 → 3 |
| `.d-pill` `Discharged 14:35` / `Admitted` / `Referred` | name + **outcome/location** | ✅ tier 2 — `Referred` says "sent to hospital", `Admitted` says "on a bed": both are exactly the location/status tier the HM strip already discloses in prose | keep, verbatim |
| §03 lede `**1 admitted** (A. Mensa still on bed 3)` | name + bed | ✅ tier 1+2 | keep the *shape*; derive the parenthetical or drop it (§5.1) |
| §03 lede `**1 referred out** (E. Owusu, returned today)` | name + referral + a *return* fact 22c cannot see | ❌ drop the parenthetical (the return is INCR-25) | `**{n} referred**` |
| §03 action `Filter by house` | — | ❌ **omit.** Six rows need no filter (YAGNI), and *"which of my House's students went to the sickbay"* is precisely the housemaster-boundary question R41 defers to INCR-28 with a field-limited reader. Do not build the shape here | absent |
| §03 action `Export day report` | — | ❌ **omit.** Same as `Print day sheet`: an export carries every row out of the room and out of the gate (A6 · B16) | absent |
| §03 head-row `p` `Most recent at top · click any row to open the full visit record` | — | ✅ **keep verbatim** — it is the instruction that makes the sanitised row usable | unchanged |

### 4.5 Two rules that must reach the PR description

1. **`attendance_record.note` stays `null`** (A7 — the module's only outbound leak path into the Basic tier). 22c writes no attendance at all, but it must not *display* the attendance mark either: **no `M` chip on the board.** It adds nothing operationally and adds one more adjacency surface.
2. **The board's reader is structurally incapable of leaking.** §6.1 forbids the impression/plan/red-flag/hydration/escalation columns from appearing in the board reader's `select` **at all**, and forbids `presenting_complaint` on any projection but the queue. A future "helpful" column addition then fails a test rather than shipping. This is the R41 idiom (*"a reader structurally incapable of returning a complaint"*) applied one increment early, because the bench screen needs it more than the housemaster surface does.

---

## 5. §03 — Recent visits · 24-hour log, element by element

### 5.1 Section head (the surface's page head, collapsed into the section)

Rendered as the `.body-shell` + `.head-row` pattern, below §01, with `mt-8`.

| Element | Surface copy | 22c |
|---|---|---|
| *(page crumb `Sickbay · Today · Recent visits`)* | — | **not built** — one route (§1.1) |
| *(page h1 `Recent **visits** · 24-hour log`)* | — | **not built** — collapses into `.hr-l h3` |
| `.hr-l h3` | `Six ` + `<em>visits</em>` + ` · chronological` | **BUILD, derived**: `{Word} <em>visits</em> · chronological`, number-word for 1–12 then digits (`Six`, `One visit` singular), matching the surface's spelled-out style. Simpler acceptable variant if the number-word helper is judged over-built: `{n} <em>visits</em> · chronological`. |
| `.hr-l p` | `Most recent at top · click any row to open the full visit record` | **BUILD verbatim.** |
| *(the surface's page lede)* `**6 visits** in last 24 hours · **4 discharged** · **1 admitted** (A. Mensa still on bed 3) · **1 referred out** (E. Owusu, returned today)` | — | **BUILD as a second `.hr-l p` line**, derived and trimmed: `**{n} visits** in last 24 hours · **{n} discharged** · **{n} admitted** · **{n} referred**`. Zero clauses dropped. Parentheticals dropped (§4.4). |
| `.live-clock` `<span class="lc-dot"></span>14:45 GMT` | — | **REPLACE.** A green pulsing dot beside a frozen server timestamp asserts liveness the page does not have (no polling, B15). Render `as of {HH:MM} GMT` in the same `.live-clock` chrome **without** the dot. A browser reload is the native refresh affordance — do not build a refresh button. |

### 5.2 The window, the membership rule, and the ordering

- **Window:** `presented_at >= now − 24h`. The surface's section meta says `Yesterday 19:40 → Now` — a rolling 24 hours, not "yesterday + today".
- **Membership:** every **non-voided** visit in the window that is **not currently in the queue**. Concretely:
  - `disposition IS NOT NULL` → the closed visits (`Discharged` / `Admitted` / `Referred`) — this reproduces the surface's six rows exactly, including A. Mensa, who is in both the admitted block and the log.
  - `disposition IS NULL AND started_at IS NOT NULL` → **IN_PROGRESS**. ⚠️ **The surface never draws this state and it would otherwise vanish from the board entirely** (`isQueued()` excludes started visits, and §03 as drawn excludes undisposed ones). Include it with the AUTHORED neutral pill `In progress` (`.pill.pending` styling, in-file at line 142 — borrowed, not authored).
  - `voided_at IS NOT NULL` → **excluded.** A voided visit is retracted; re-printing it on the board re-asserts it.
  - queued visits → excluded (they are the queue card).
- **Ordering:** `presented_at` **descending** — "Most recent at top", the opposite of the queue.

### 5.3 Row grammar — 4 columns → 3

| Cell | Surface copy (6 rows verbatim, for the record) | 22c |
|---|---|---|
| `.v-time` + `.v-day` | `14:22` `Today` · `13:50` `Today` · `11:12` `Today` · `09:14` `Today` · `07:18` `Today` · `19:40` `Yesterday` | **BUILD.** `{HH:MM}` from `presented_at`; `.v-day` = `Today` when `civilDate(presentedAt) === civilDate(now)`, else `Yesterday`. Both derived, never stored; the 24h window makes a third value impossible. |
| `.vs-name` | `D. Mensah` · `S. Owusu` · `L. Adjei` · `A. Mensa` · `K. Adusah` · `E. Owusu` | **BUILD.** `{I}. {Surname}`. |
| `.vs-complaint` | `F2 BUS · **Nkrumah** · cut on left hand from carpentry workshop` · `F3 SCI · **Aggrey** · period pain · routine, no fever` · `F1 BUS · **Slessor** · fever 37.8°C, headache · malaria RDT negative` · `F1 GA · **Slessor** · sickle cell pain crisis · right shoulder, knee · pain 7/10` · `F3 GA · **Aggrey** · forgot AM inhaler dose · asthma chronic` · `F2 GA · **Aggrey** · wrist pain after inter-house football · swelling` | **BUILD the identity fragment ONLY** → `{formLabel} · **{House}**` (House clause dropped when null). **The clinical fragment is dropped** (§4/A12). ⚠️ Note the House here is printed **without** the word `House` — the queue prints `Aggrey House`, §03 prints `Aggrey`. Unify on the surface's own per-element form: queue keeps `House`, the log does not. |
| `.v-action` | `Cleaned, dressed, tetanus current` · `Paracetamol 1g · rest 45 min` · `Paracetamol 1g · rest 1h · ORS` · `Hydroxyurea continued · paracetamol · hydration · bed 3` · `Salbutamol 2 puffs · counselled` · `Referred to Asankrangwa Govt for x-ray` | **COLUMN OMITTED** (§4/A12b). |
| `.v-disposition` | `Discharged 14:35` ×2 · `Discharged 12:30` · `Admitted` · `Discharged 07:24` · `Referred` | **BUILD.** `DISCHARGE` → `Discharged {HH:MM}` from `disposition_at` · `ADMIT` → `Admitted` (bare, as drawn — whether the ward stay has since ended is the bed board's job, and the disposition is immutable by R36) · `REFER` → `Referred` (bare, as drawn) · open-and-started → `In progress`. |
| *(row)* | *(notes: "click any row to open the full visit record")* | **BUILD** — the whole row links to `/senior/sickbay/visits/{id}`. **This is the only route into a visit record in the entire app**, which is why the section could not stay unassigned. `hover:bg-bg` (AUTHORED — the surface has no hover state and a clickable row needs one). |

**Empty:** the section renders with its head-row and one line `No visits in the last 24 hours.` (AUTHORED, `text-[12px] italic text-navy-3 p-[18px_22px]`). A quiet 24 hours in a sickbay is a normal, good state — no illustration, no pep, and **not** a hidden section (an absent section reads as a broken page).

---

## 6. Data bindings — against the SHIPPED schema

### 6.1 The reader contract — `lib/sickbay/board-reads.ts` (NEW, server-only)

> 🔴 **22c must NOT reuse `getVisitRecord()`** (board L2497). It returns complaint, impression, red flags, hydration, plan, escalation triggers, every vital and every consult **per visit** — so a per-row call on the board is simultaneously an N×9 round-trip *and* the A6/A12 adjacency leak in payload form.

One server-only module, one exported entry point, four bounded queries. Shapes:

```ts
export interface QueueRowView   { visitId; shortName; formLabel; houseName; studentCode;
                                  presentedAtHHMM; waitLabel;                 // "7 min wait" | "just now"
                                  presentingComplaint }                       // ← the ONLY clinical string in this file
export interface WardRowView    { admissionId; visitId; firstName; lastName; formLabel; houseName;
                                  studentCode; bedNumber; isIsolation; admittedAtHHMM; admittedToday;
                                  admittedByName; elapsed; expectedDischargeAt; overdue;
                                  vitals: { key; label; value; unit; sub; tone }[] }
export interface BedCellView    { bedNumber; isIsolation;
                                  occupant: { visitId; shortName; formLabel; houseName; elapsed } | null }
export interface LogRowView     { visitId; shortName; formLabel; houseName;
                                  presentedAtHHMM; dayLabel; pill: { label; tone } }   // NO complaint field — by type
export interface BoardCounts    { admitted; bedsTotal; queued; avgWaitLabel; oldestWaitLabel;
                                  today: { total; discharged; admitted; referred; awaiting } }
export async function getSickbayBoard(schoolId: string, now: Date): Promise<{...}>
```

**Hard rules, and each is a test:**
1. The file's `select` lists **never** mention `workingImpression`, `redFlagsScreened`, `hydrationStatus`, `plan`, `escalationTriggers`, or any `sickbayDoctorConsult` column. Not filtered later — **never selected**.
2. `presentingComplaint` is selected **once** and lands **only** on `QueueRowView`. `LogRowView` has no field to put it in, so the A12 leak cannot be reintroduced without a type error.
3. No per-row query anywhere (the N+1 that would also be an N×9 leak).

**Queries:**

| # | Source | Predicate | Feeds |
|---|---|---|---|
| **Q1** | `sickbay_visit` ⨝ `students` ⨝ `classes` ⨝ `houses` | `school_id = $1 AND presented_at >= now − 24h AND voided_at IS NULL` | the queue (filter `isQueued()`), the log (filter §5.2), tile 2, tile 3. **Uses the shipped index `sickbay_visit_presented_idx (school_id, presented_at)`** — authored in 0057 with the comment *"the queue and the 'recent visits · 24h' read are both windows on presented_at within a school"*. This map is that comment's cash-out. |
| **Q2** | `sickbay_admission` ⨝ `sickbay_visit` ⨝ `students` ⨝ `classes` ⨝ `houses` ⨝ `sickbay_bed` ⨝ `ref_user` | `school_id = $1 AND discharged_at IS NULL` | admitted block, tile 1 meta, bed-board occupancy. **No time window** — a multi-day stay's visit falls outside Q1's 24h. |
| **Q3** | `sickbay_vital_reading` | `school_id = $1 AND visit_id IN (Q2 visit ids)`, ordered `taken_at` | the `.ab-vitals` grid (latest row) + `painTrend()` (first vs latest pain). Skipped entirely when Q2 is empty. |
| **Q4** | the shipped `getSickbayConfig(schoolId)` | — | `mode` → `capabilities`, `beds` (active rows), `bedCounts.total`, `configured` |

### 6.2 Element → column, exhaustively

| Element | Binding | Status |
|---|---|---|
| h1 date | server `now`, `Intl` `en-GB` UTC | derived |
| lede `{n} admitted` | count(Q2) | **0057 ✓** |
| lede `{n} in queue` / tile 2 value | count(Q1 where `isQueued()`) — shipped predicate | **0057 ✓** |
| lede + tile 3 `{n} visits today` | count(Q1 where `civilDate(presented_at) === civilDate(now)`) | **0057 ✓** |
| tile 1 value / sub-num | count(Q2) / `config.bedCounts.total` | **0056+0057 ✓** |
| tile 1 meta name | Q2 `students.first_name/last_name` | **✓** |
| tile 2 meta `avg wait` / `oldest` | `waitMs()` over the queued subset (shipped) | derived |
| tile 3 meta breakdown | group Q1-today by `disposition` (`DISCHARGE`/`ADMIT`/`REFER`) + `awaiting` = `disposition IS NULL` | **0057 ✓** |
| `.ab-name` | Q2 student + `sickbay_bed.bed_number` + `sickbay_admission.is_isolation` | **✓** |
| `.ab-meta` | `formLabel()` · `houses.name` · `students.student_code` · `admitted_at` · `ref_user.full_name` via `admitted_by_user_id` · `formatElapsed(now − admitted_at)` | **✓** |
| `.ab-vitals` values | Q3 latest `temp_c` (numeric→Number) / `systolic`+`diastolic` / `pulse_bpm` / `spo2_pct` / `pain_score`; colours `vitalSeverity()`; pain sub `painTrend()` | **0057 ✓**, all shipped pure helpers |
| `.ab-vitals` sub `{HH:MM} last` | Q3 latest `taken_at` | **✓** |
| `.ab-line` `Expected discharge` + `overdue` | `sickbay_admission.expected_discharge_at` vs `now`, `discharged_at IS NULL` | **0057 ✓** — this is the "No silent overnight stays" rule the visit map promised would surface as an operational state on this board |
| queue row time / wait | `presented_at`, `waitMs()` | **✓** |
| queue row student | Q1 student joins + `student_code` | **✓** |
| queue row complaint | `sickbay_visit.presenting_complaint` | **0057 ✓** |
| `Begin visit` | shipped `beginVisit({visitId})` | **✓** |
| bed tiles | `config.beds` (active) ⟕ Q2 by `bed_id`; `is_isolation` | **0056+0057 ✓** |
| bed head `1 / 8 · 7 empty` | counts over the same two sets | derived |
| §03 row time / day | `presented_at`, `civilDate()` | **✓** |
| §03 row student | Q1 joins | **✓** |
| §03 pill | `disposition` + `disposition_at`; `started_at` for `In progress` | **0057 ✓** |
| §03 row link | `sickbay_visit.id` | **✓** |
| Mode gating | `sickbay_settings.mode` → `sickbayCapabilities()` | **0056 ✓** |
| unconfigured notice | `sickbay_settings.configured_at IS NULL` → `config.configured === false` | **0056 ✓** |

### 6.3 Two definitions that must be written down before anyone codes them

1. **`Visits today` = every non-voided visit whose `presented_at` falls on the current civil day, INCLUDING those still in the queue.** The breakdown is `{discharged} discharged · {admitted} admitted · {referred} referred · {awaiting} awaiting`, where `awaiting` = `disposition IS NULL`. The surface's own tile proves the intent by carrying an `awaiting` clause — but its `5` excludes the three queued students, so the demo number would read `8` under this (correct) definition. Do not reproduce the surface's arithmetic (F5).
2. **The 24-hour log window is a superset of the civil day** at every hour of the day, so Q1 serves both with one predicate. Do not issue a second query for "today".

### 6.4 🟢 Nothing here needs schema

**Every element in scope is derivable from 0056 + 0057. 22c requires no migration, no new column, no new enum, no new index, and no second prod paste.** The three things that might have forced one, and why they do not:

| Candidate | Resolution |
|---|---|
| `.v-action` (`Cleaned, dressed, tetanus current`) — its closest column is `sickbay_visit.plan`, but the demo strings mix in medications that 0057 does not model | **Moot: the column is omitted on adjacency grounds** (A12b), so the half-binding never has to be resolved. Recorded so INCR-24 does not "reconcile" it. |
| `refresh 15s`, the live clock's liveness | **Omitted** — no polling infrastructure and none is worth building (F11). |
| An index for the 24h window | **Already shipped**: `sickbay_visit_presented_idx (school_id, presented_at)`, authored in 0057 for exactly this read. |

⚠️ One shipped-code watch item, **not** a 22c blocker: `medical-hold.ts`'s `::date` casts are non-sargable and it lacks a `(school_id, student_id, admitted_at)` index — already deferred to INCR-24 on the board. 22c adds no new caller of it.

---

## 7. Per-mode matrix — FULL / FIRST_AID / REFERRAL_ONLY

`capabilities` comes from the shipped `sickbayCapabilities(mode)` — **never re-derive, never store, never hand-set** (R4). **A and B are capability-identical** (AC A2): nothing below may branch on A-vs-B. **Mode C is ~49% of public SHS — a first-class render, empty by design, never degraded and never placeholdered.**

Relevant flags: `beds` · `admissions` (both `false` in C).

### 7.1 §01

| Element | **A · FULL** | **B · FIRST_AID** | **C · REFERRAL_ONLY** |
|---|---|---|---|
| Crumb · h1 | yes | yes | yes |
| Lede | `{n} admitted · {n} in queue · {n} visits today` | same | **`{n} in queue · {n} visits today`** — the `admitted` clause is structurally impossible (no beds ⇒ no admissions ⇒ the count is not "0", it is *not a fact about this school*) |
| `New visit` action | yes | yes | **yes** — a Mode-C school records every visit; it just discharges or refers |
| `Setup` link | yes | yes | yes |
| `Admit patient` action | *(omitted for all modes — §3.1)* | | |
| `Print day sheet` | *(omitted for all modes)* | | |
| **Live strip** | **3 tiles**, `grid-cols-3` | same | **2 tiles**, `grid-cols-2` |
| — tile `Admitted now` | yes | yes | **ABSENT FROM THE DOM** |
| — tile `In queue` | yes | yes | yes |
| — tile `Visits today` | yes | yes | yes |
| **Admitted block** | one per open admission | same | **NEVER RENDERS** — and it cannot exist: `dispositionGuard` refuses ADMIT at the server in Mode C (R55), so there is no row to render |
| **Queue card** | yes | yes | **yes — the primary content of the page**, full width (`.col-2` collapses to one column) |
| **Bed board** | yes | yes | **ABSENT FROM THE DOM** (R5 · R55 · AC A7). Not `0 / 0`, not a disabled card, not a greyed grid, not a `PLACEHOLDER` badge |
| **Mode-C explanatory panel where the board was** | — | — | **NONE.** ⚠️ *This revises the visit map's §2.4 suggestion.* `MODE_C_CAPACITY_PANEL` belongs on **setup**, where an administrator is deciding something and the sentence is new information. On a board the matron opens every morning for the rest of her career, a permanent panel explaining that her school has no beds is daily noise — and the page is not bare: it has the strip, the queue and the 24-hour log. **Empty by design means empty.** |
| HM strip | *(omitted for all modes — Z4)* | | |

### 7.2 §03

| Element | A | B | C |
|---|---|---|---|
| Whole section | yes | yes | **yes — identical.** A visit exists in every mode; the log is mode-independent **by construction** |
| Head counts | `{n} visits · {n} discharged · {n} admitted · {n} referred` | same | same shape; **the `admitted` clause can never be non-zero** (R55), so it simply never renders — a consequence of the data, not a branch in the code |
| `Discharged` / `Referred` / `In progress` pills | yes | yes | yes |
| `Admitted` pill | yes | yes | unreachable |
| Row → visit record | yes | yes | yes |

### 7.3 Unconfigured schools (`configured === false`) — the R25 distinction

A school with **no `sickbay_settings` row** coalesces to `REFERRAL_ONLY` with `configured: false`. That is *not* the same as a school that declared Mode C, and the board must say so once — the declared-C school needs no explanation, but the never-configured school's mode may simply be wrong.

**AUTHORED, one dashed panel above the live strip, rendered only when `configured === false`:**
> `Sickbay not set up yet — declare your school's mode in **Sickbay setup**.`
`rounded-[10px] border border-dashed border-border-2 bg-bg p-[14px_18px] text-[12px] text-navy-2 mb-6`; `Sickbay setup` is a `text-gold font-semibold` link. Shown to every reader (setup gates its own writes).

### 7.4 Mode C — what must be OMITTED rather than placeholdered

| Never render in Mode C | Not even as |
|---|---|
| Bed board card | `0 / 0`, a dashed empty grid, a disabled card, a "no beds" tile |
| `Admitted now` tile | `0 / 0 beds`, a greyed tile |
| Admitted block | an empty-state card, a "no patients on the ward" line |
| `Admit patient` control | a disabled button, a tooltip, a hidden-but-present DOM node |
| Any bed id / bed number | anywhere in the flight payload (the shipped visit page already models this: `availableBeds` is not even computed when `capabilities.admissions` is false) |

### 7.5 Reader-role matrix (all modes)

| Actor | Board |
|---|---|
| **MATRON** | full board + `New visit` + `Begin visit` |
| **HEADMASTER** | full board, **no write controls** (`New visit` and every `Begin visit` absent); rows still link |
| **ADMIN** | 🔴 **`<ClinicalRestricted crumb="Today" />`** — the board carries the queue complaint (tier 4) and ward vitals (tier 3). Module access is kept (the route resolves, no 404, no redirect); **the fetch never happens**, so nothing clinical enters the flight payload (AC Z2, and `getSickbayBoard` must sit *inside* the gate branch exactly as `getVisitRecord` does today) |
| HOUSEMASTER / TEACHER / PARENT / STUDENT | never reach the route |

---

## 8. Interaction states

| State | §01 | §03 |
|---|---|---|
| **Loading** | optional `loading.tsx` with skeletons at real heights — tiles `92px`, queue rows `62px`, bed tiles `100px`. *Skipped: anything more; add if the four queries measure slow.* | log rows `45px` |
| **Empty · queue** | head + `No one waiting.` | — |
| **Empty · ward** | no admitted block; tile 1 = `0` + ` / {total} beds`, no meta | — |
| **Empty · beds (A/B, zero rows)** | card renders with `No beds configured — add capacity in Sickbay setup.` (AUTHORED, gold link) | — |
| **Empty · all beds free** | **not an empty state** — a full grid of dashed `Empty` tiles is the normal good day | — |
| **Empty · log** | — | head-row + `No visits in the last 24 hours.` |
| **Empty · whole page** (new school) | lede `A quiet day so far — no visits recorded yet.` + the §7.3 panel when unconfigured | log empty line |
| **Populated** | as mapped | as mapped |
| **Error (read)** | let it throw to the route error boundary — do not design a bespoke clinical error card | same |
| **Error (write)** | `beginVisit` failure renders the action's **named** error inline under that queue row (`text-[11px] text-terra mt-1`); the row does not disappear | — |
| **Refresh** | none. `force-dynamic` + the browser's own reload. `as of {HH:MM} GMT` in the §03 head-row is the honesty marker; the `.now-dot` is a **state** marker (tile is non-zero), not a liveness claim | same |
| **Overdue admission** (`expected_discharge_at` < now, `discharged_at IS NULL`) | `.ab-line` gains `· **reassessment overdue**` in gold — the encodable half of *"No silent overnight stays"* | — |
| **Read-only actor** (HEADMASTER) | every value renders; `New visit` + all `Begin visit` absent | rows still link |
| **Voided visit** | never in the queue (`isOpen()` excludes it) | never in the log |
| **IN_PROGRESS visit** | not in the queue (the wait clock stopped at `Begin visit`) | **in the log** with the `In progress` pill (§5.2) — the state must not vanish from the board |

---

## 9. Responsive & PWA

**The `today` surface declares NO media query at all.** Every breakpoint below is AUTHORED.

| Width | §01 | §03 |
|---|---|---|
| **≥ 1280** | strip `grid-cols-3` (C: `grid-cols-2`) · `.col-2` `lg:grid-cols-[1.4fr_1fr]` · bed grid 4-up | 3-column rows as specced |
| **768–1279** | strip stays 3-up · `.col-2` → **1 col** (queue above beds) · bed grid **3-up** | unchanged; House fragment may wrap |
| **< 768 (PWA / phone)** | strip **1 col** · admitted block stacks: `.ab-head` wraps tags under the name, `.ab-vitals` **2 cols** with Pain full-width · **queue rows become stacked cards** — `{HH:MM} · {n} min wait` line 1, name + meta line 2, complaint line 3, `Begin visit` **full width, min 44px** line 4 · bed grid **2-up** (4-up at phone width is unreadable) | **rows become stacked cards** — `{HH:MM} {Today}` + pill on line 1 (pill right-aligned), name on line 2, `{form} · {House}` on line 3. Do not horizontally scroll a clinical log |

**PWA:** the matron's bench device is a phone. There is no write on this board except `Begin visit`, which is a single 44px target. *Skipped: an offline queue and a service-worker cache — add when a bench-side action is actually lost to signal, not before.*

---

## 10. Fabricated demo content in scope — never build these as data shapes

| F# | Item | Where | Verdict |
|---|---|---|---|
| **F1** | **The two sections have disjoint casts.** §01's queue is `K. Asante` · `P. Owusu` · `Y. Boateng`; §03's six are `D. Mensah` · `S. Owusu` · `L. Adjei` · `A. Mensa` · `K. Adusah` · `E. Owusu`. Only `A. Mensa` appears in both. §01's queue students appear in **no** log, and §03's students appear in **no** queue — impossible on a real day, since every logged visit was queued minutes earlier | both | Both lists derive from the same `sickbay_visit` rows through one query (Q1). The disjointness disappears by construction. |
| **F2** | **Two student-code formats in scope** — queue prints `#2024/F2/0188`, `#2023/F3/0067`, `#2025/F1/0091`; the admitted block prints `Adm. #2025/F1/0214`. (The visit record adds a third, `AS-2024-F1-0089`, and §04 a fourth.) | §01 | `students.student_code` is free text: **render verbatim as stored.** No format, no regex, no validation, no seed convention, **and no added `#`** — the glyph is demo chrome in one place and part of the label in the other. |
| **F3** | **Adwoa Mensa is three different patients across the file, and two of them are in scope**: `F1 General Arts` (admitted block) vs `F1 GA` (§03 row) vs `F1 SCI` (visit record); `Adm. #2025/F1/0214` vs `AS-2024-F1-0089`; vitals `37.1 / 88 / 4-10 @ 13:00` (block) vs `37.2 / 84 / 2-10 @ 14:30` (visit record); `5h 31m on bed` @ 14:45 vs `admitted 09:14` (which is 5h 31m — ✓ the one number that checks out) | §01, §03 | One `formLabel()`, one `student_code`, one `sickbay_vital_reading` set read through one formatter. The contradiction cannot survive. |
| **F4** | **Adwoa Mensa is not in the dev seed** — the nearest student is **Abena Mensah** | everywhere | Never hardcode her, never seed "her" to match. The preview renders whatever the seed holds; a demo patient is a **seed** task, not a code task. |
| **F5** | 🔴 **A tally that contradicts its own table.** §01 tile 3 says `5` visits today with `3 discharged · 1 admitted · 1 awaiting`. §03's table lists **five** today-rows: 4 discharged + 1 admitted, and **zero** awaiting. §01's lede also says `5 visits earlier today` while three students are simultaneously drawn *in the queue*, i.e. eight visits exist on the day | §01 tile 3 + lede vs §03 | **Derive everything** (§6.3). Counter drift is this module's signature defect (setup §03's "3 reorder alerts" over a 2-alert table). |
| **F6** | 🔴 **A notes-panel tally that contradicts its own table.** §03's notes claim *"Slessor House over-represented today (3 of 6)"*. The table shows Slessor **2** (L. Adjei, A. Mensa), **Aggrey 3** (S. Owusu, K. Adusah, E. Owusu), Nkrumah 1. The panel names the wrong House and the wrong number | §03 notes | The notes are not built. Recorded so nobody ports the claim into a real "house pattern" feature — and as evidence for why `Filter by house` is omitted (§4.4). |
| **F7** | **`Wed 14 May 2026` is a Thursday.** The h1, the section meta (`Now · Wed 14 May 14:45`), and §03's `Wed 08:02 today` all assert Wednesday | both | Harmless because the date is formatted at render — but **never hardcode the weekday**, and do not "fix" the surface by changing the date. |
| **F8** | `.adwoa-block` — **a CSS class named after a fabricated patient** | §01 | rename **`.admitted-block`** / `AdmittedBlock`. |
| **F9** | **Two referral stories on one page.** §01's lede + tile 4 say the active referral is `D. Sarpong · Wassa Akropong` (and §04 agrees); §03's lede + row 6 say the referral is `E. Owusu, returned today`, referred at 19:40 for a wrist x-ray. Both claim "1". Neither appears in the referral-log surface's cast (`Y. Aidoo`, `K. Boateng`) | §01, §03 | §01's clause is omitted (Z3); §03's row is built as a plain `Referred` pill with **no destination and no return** (both are INCR-25). When 25 builds the artefact, **the referral-log cast wins**. |
| **F10** | **Houses that are not in the seed.** `Kufuor` (§01 queue row 3) and `Nkrumah` (§03 row 1). The seeded set is Aggrey · Guggisberg · Fraser · Slessor · Kingsley · Aryee | both | **Houses are read, never named in code.** |
| **F11** | `refresh 15s` — a polling promise nothing implements | §01 queue meta | Omit the literal. |
| **F12** | `Mrs A. Bediako · Matron · N&MC 04827` in the sidebar footer, in a **second** format from the visit record's `N&MC #N-04827` | sidebar (not built) | The shipped footer prints name + role; the licence does not belong there. Store the bare value, one render, on the visit record only. |
| **F13** | The `.notes` claim *"six visits in 24h for a **1,200-student** school is a typical mid-week pattern"* | §03 notes | Editorial in an unbuilt panel; no enrolment figure is asserted anywhere in the UI. |
| **F14** | §02's `06:30 / 12:30 / 17:00 / 21:00` round times (out of scope, adjacent to it) | §02 | Already settled by R13 — the setup surface's slot rows are canonical (`06:30 / 12:30 / 21:00`). **Nothing in 22c may hardcode a round time**, including in any copy string. |

---

## 11. Omit-not-fake register (for the PR body)

| Omitted | Why | Reinstatement trigger |
|---|---|---|
| Live tile `Active referrals` | no referral table | INCR-25 |
| Live tile `Cluster watch` | no surveillance table | INCR-27 |
| Lede clauses `1 active referral (…)` and `URTI mild cluster watch` | advertise absent affordances | 25 / 27 |
| HM awareness strip (both rows, `09:17`) | no notification row — rendering "notified" asserts a message never sent | INCR-26 |
| `.ab-tag.chronic` `Sickle cell SS` | no chronic register **and** adjacency A3 | INCR-23 — **visit record only, never this board** |
| Queue `No chronic flag` column | a false **negative**: asserts safety per a register that does not exist | INCR-23, as a neutral marker |
| Queue `Routine` triage pill | an unassessed clinical-urgency assertion (R62) | a designed urgency workflow |
| Bed tile condition (`SCD`) | **A1** | never |
| Live tile 1 condition + multi-patient names | **A2** | never |
| `.ab-line` clinical narrative (impression · hydration · drugs · plan · parent) | **A13** + Z5/Z6 | the med sentence at 24 and the parent sentence at 26 — **inside the visit record**, not on the board |
| §03 complaint fragment | **A12** | never |
| §03 `.v-action` column | **A12b** + it is half-unbacked (meds are 24's) | never as a column |
| `Print day sheet` / `Export day report` | no print artefact, and both carry every complaint out of the room | an owner-approved print design |
| `Filter by house` | 6 rows need no filter, and it prototypes the HM boundary R41 defers | INCR-28's field-limited HM reader |
| `Admit patient` board action | an admission is a disposition of an open visit; no picker is designed | never (the path is the visit record) |
| `refresh 15s` + the live-clock pulse dot | polls nothing | a real refresh interval |
| Mode-C bed panel | daily noise on an operational board; the explanation lives on setup | never |
| §02 / §04 / §05 entirely — **no shell, no badge, no anchor target, no nav item** | 24 / 25 / 27 | those increments |

**Nothing in this list is placeholdered.** No `LIGHT·PLACEHOLDER` badges, no greyed mock rows, no `0 / 0`, no `—` standing in for an unrecorded clinical value, and — the Mode-C rule — **no disabled control standing in for a capability the school does not have.**

---

## 12. Cross-module hooks — design commitments preserved

| Hook | In scope here | Status at 22c |
|---|---|---|
| **sickbay → attendance "M"** | the board renders **no** attendance mark, deliberately (§4.5/2) | built at 22b; 22c neither writes nor displays it |
| **sickbay config → the board** | mode/capabilities, `sickbay_bed` rows, `bedCounts` | the config spine's second consumer — live reads through the frozen `getSickbayConfig()` contract, never re-derived |
| **boarding → House / housemaster** | queue meta, bed tile, admitted block, §03 row | live reads of `houses.name` |
| **boarding → dorm bunk** | — | **B1 stands: never conflate `sickbay_bed` with `boarding_bunk`** (R7). The board prints a *sickbay* bed number only |
| **boarding in-House count** (R29 / INCR-28) | the open-admission set | 22c reads it for the board. ⚠️ **Do NOT let `getSickbayBoard()` become the housemaster's reader** — R41 requires a separate, field-limited `{studentId, studentName, admittedAt}` signature at 28 |
| **sickbay → the visit record** | every row link | 22c closes the module's navigation loop: this board is **the only route into a visit record in the app** |
| **sickbay → referrals** | §03's `Referred` pill | the pill is the disposition, nothing more; the artefact is INCR-25 |
| **sickbay → MAR / rounds** | §02 boundary + the `.ab-line` med clause | INCR-24; no round time is hardcoded anywhere in 22c |
| **sickbay → notifications** | HM strip | INCR-26; **the privacy grammar (name + location, never condition) binds this board today** |
| **sickbay → WASSCE SC-12** | admission spans | INCR-28 |

---

## 13. Open questions

| # | Question | Owner | Blocks |
|---|---|---|---|
| **Q1** | 🔴 **A13 revises A8** — the visit map kept the admitted block's clinical narrative on the board (justified on the role gate); this map drops it (justified on A11's physical threat model, and on consistency with A1, which removed a *shorter* leak eight lines away). Confirm the ruling | Kofi + owner | §3.3 · §4.3 |
| **Q2** | 🔴 **A12 — §03 rows drop the complaint entirely** while the queue keeps it (A6). Confirm the distinction (live triage vs closed log) is the right place to draw the line, or accept a shared ruling in either direction | Kofi + owner | §5.3 |
| **Q3** | Mode C renders **no** explanatory panel where the bed board was (revising the visit map's §2.4 suggestion). Confirm — the alternative is a permanent daily panel | Owner | §7.1 |
| **Q4** | §03 as a **section of `/senior/sickbay/today`** (recommended) vs its own route `/senior/sickbay/today/visits` as the surface's URL implies | Kofi | §1.1 |
| **Q5** | Sidebar re-point `Sickbay → /senior/sickbay/today` (the visit map's Q1, still open, now blocking: the board is unreachable from the nav without it) | Kofi | §1.2 |
| **Q6** | `/senior/sickbay/visits/new` **survives, re-pointed** (recommended — it *is* the queue's intake writer) vs absorbed into a board dialog | Kofi | §1.2 · board L2497 |
| **Q7** | The `In progress` row in §03 is AUTHORED — the surface draws no such state, but without it a started-and-undisposed visit disappears from the board entirely. Confirm | Kofi | §5.2 |
| **Q8** | **AUTHORED copy needing sign-off:** `No one waiting.` · `No visits in the last 24 hours.` · `No beds configured — add capacity in Sickbay setup.` · `A quiet day so far — no visits recorded yet.` · `Sickbay not set up yet — declare your school's mode in Sickbay setup.` · `just now` · `In progress` · `Expected discharge {t}` · `reassessment overdue` · `Open record →` · `as of {HH:MM} GMT` · `{n} on the ward` · `No readings yet.` · `up from {n}` | Owner | copy review before merge |
| **Q9** | The `Six visits · chronological` number-word formatter (`Six` / `One visit`) — build the 1–12 word list, or render digits? | Owner | §5.1 (cosmetic) |
