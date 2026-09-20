# WASSCE University — Targets + Match — Surface Map (INCR-17b · Module 4.3)

**Author:** Lucy (design cartographer) · **Status:** design spec, ready for the implementation engineer (Claude Code).
**Increment:** INCR-17b — *University targets + match* · migration **0054** · depends on INCR-17 (0053). **The uni-match layer split off INCR-17** (build-plan line 2075: "split `university_*`→INCR-17b if it runs long"; confirmed line 2168/2173).
**Scope of THIS map (the INCR-17b slice ONLY):** the **university-match tiles** on `wassce-student-readiness` **§6** (KNUST/Legon/UCC programme tiles, cut-off + projected-vs-cut-off, the **TARGET / COMFORTABLE / MATCH / STRETCH / SAFETY** badge, prerequisites, the match-logic legend) and the **university-targets config** on `wassce-setup` **§3** (tier-band strip, top-destinations list, the 5-step match explainer, the cut-off table). 17b **ADDS the university layer on top of** the projection/aggregate spine INCR-15/16/17 already shipped — it re-derives none of it.

> **What 17b builds vs what already shipped.** INCR-17 (PR #161, migration 0053, merged-pending) shipped `lib/wassce/projection.ts` (the deterministic best-3 aggregate = crown jewel of 17), `waec_special_consideration`, and `readiness_statements` with **`target_universities_json` deliberately NULL** and **no university enum/table/column** (AC17 no-leak). 17b lands the three university tables + the match-tier lib + these two surface regions + per-target parent-ack, and **backfills** `readiness_statements.target_universities_json` and the §1 identity-card "Target ·" line / §7 parent-ack target lines that INCR-17 rendered omitted.

## Source surfaces (visual source of truth — replicate 1:1)

| Surface file | Role in this map | Region in scope |
|---|---|---|
| `Surfaces/schoolup-wassce-student-readiness.html` | **PRIMARY.** Y. Aidoo's deep-dive; **§6 university match** is the crown-jewel display. | **§6 ONLY** (lines 1301–1512). §1/§3/§4/§5/§7 projection slices = INCR-17 (shipped); the rest = INCR-20. **§6 is the ONLY new surface area on this file.** |
| `Surfaces/schoolup-wassce-setup.html` | **SECONDARY.** The cohort-level config. | **§3 ONLY** (lines 649–857): "University target system · per-student tagging". §1/§4/§5 = INCR-15; §2 = INCR-16. |

**Tables this map reconciles against (BUILD_STACK WASSCE batch; INCR-17b migration 0054 — Kofi's 17b schema rulings NOT yet written, so every binding below is a *proposal for Kofi/Wells confirmation*, mirroring how the INCR-15/16/17 maps pre-specified their tables before the ruling):**
- **`universities`** (**GLOBAL** — bare `ENABLE ROW LEVEL SECURITY`, **never FORCE/`tenant_isolation`**, the `benchmark_reference` idiom; build-plan line 2082) — the institution (KNUST, Legon/University of Ghana, UCC, UEW, UDS, Takoradi Tech). **NEW in 0054.**
- **`university_programmes`** (**GLOBAL**, bare ENABLE RLS) — a programme under a university, carrying its **cut-off + reference year + prerequisites**. **NEW in 0054.**
- **`university_targets`** (**TENANT**, composite `(school_id, …)` FKs, FORCE RLS `tenant_isolation`, prod-paste-0054) — one row per candidate × tagged programme; **has its OWN `parent_acknowledged_at`** (build-plan line 2173: BUILD_STACK gives `university_targets` a separate parent-ack from `readiness_statements`). **NEW in 0054.**
- **Enums deferred here from INCR-17 (build-plan line 2173):** `university_type_enum`, `target_rank_enum`. **The match tier is DERIVED, not an enum** — see Part A.7.
- **Reused reads (frozen contracts, NEVER written here):** `wassce_candidates` (`projected_aggregate` is NULL in the live path — the match reads the **derived** best-3 via `lib/wassce/projection.ts`, per INCR-17 AC9), `wassce_candidate_subject`/`wassce_subjects` (prerequisite check — which subjects a candidate sits + their predicted grades), `mock_results` (predictor-mock grades → per-subject credit for the prereq-met flag), `readiness_statements` (17b backfills `target_universities_json`).

**Match tier = pure lib, NO trigger, DERIVED on read** — exactly the `projection.ts` idiom (build-plan line 2082: "best-3 aggregate = pure lib; no triggers"). Add `lib/wassce/match-tier.ts` (Kofi's match-tier function): `matchTier(projectedAggregate, cutOff, isPrimary) → TARGET | COMFORTABLE | MATCH | STRETCH | SAFETY`. **`university_targets` stores NO `match_tier` column** — the tier is computed on every read from the candidate's derived aggregate vs the programme's snapshot cut-off, so it never drifts when either moves.

## Explicitly OUT of scope (noted, NOT mapped)

| Item | Where | Owner | Why out |
|---|---|---|---|
| Projection engine · aggregate visualizer · Mock1→Mock2 display · SC-form · readiness statement + parent-ack | student-readiness §1/§3/§4/§5/§7 · setup §5 | **INCR-17 (shipped)** | The academic spine 17b sits on top of. Mapped in `docs/senior/wassce-readiness-surface-map.md`. **Do not re-derive.** |
| STPSHS panel · full paper schedule · 30-cell ledger grid · pastoral/financial context strip · comms log · non-uni cross-module cards | student-readiness §1/§2/§4/§7 | **INCR-20** | Full student-readiness built LAST. **§6 is the ONLY 17b region on this file.** |
| Cohort-readiness distribution (HoA whole-cohort) | `wassce-cohort-readiness` | INCR-18 | The setup §3 tier-band student counts (39/91/74/36) and "students targeting" tallies are cohort aggregates that lean on INCR-18's derivation — render from `university_targets` counts + the derived-aggregate band, don't build a distribution engine here. |
| Parent portal (parent-facing signing UI for the per-target ack) | `wassce-parent-tracker` | INCR-19 | 17b captures the per-target parent-ack **school-side** (console-degrade OTP); the parent's own signing surface is INCR-19. |
| `wassce_results` (post-WASSCE actuals) | — | Deferred entirely (17/17b) | Cut-off matching is against the **projected** aggregate; real results are a later increment. |

---

## §0 — Shared chrome, tokens, type & no-alpha discipline

### 0.1 Token & type reference — REUSE INCR-15/16/17 verbatim
Both surfaces declare the **identical `:root` palette** as INCR-15/16/17 (same hexes as `design-tokens.json` v1.0.0). **Reuse the INCR-15 token→Tailwind table** (`docs/senior/wassce-spine-surface-map.md` §0.1) — do not re-derive. `font-display` = **Fraunces** (tile/programme names, tier labels' host cards, section titles, gold italic `<em>`); `font-body` = **Manrope** (body, meta labels, pill text); `font-mono` = **JetBrains Mono** (every cut-off number, aggregate figures, "You · 10", "Cut-off · 11", the setup §3 median-cut-off / students-targeting / %-F3 columns, the cut-off table's cut-off column). Empty/missing = em-dash `—` in `text-navy-3` (never `0`/`N/A` — matches the setup §3 "Other" row's `—` median cut-off). Headings weight 500 with gold italic `<em>` (`Five <em>programmes</em> · matched and ranked`; `University <em>target</em> system.`).

### 0.2 Grade-chip / A1–F9 palette (Palette A) — REUSE `lib/wassce/grade-colors` (shipped INCR-16)
Prerequisite "credit" checks reference the A1–F9 credit band (A1–C6 = credit). **Reuse `lib/wassce/grade-colors.ts` + `WASSCE_GRADING_BANDS` in `lib/wassce/constants.ts`** — do not re-hex. Credit threshold = A1–C6 (already `isCredit` in `mock-data.ts`, deduped at INCR-17 Dex NIT-1).

### 0.3 In-app chrome — reuse each surface's OWN frame (both already built)
The two surfaces sit in **different app frames** (both already shipped):
- **student-readiness §6** rides the **INCR-17/20 candidate frame** — `.desktop → .browser-bar → .app-shell` with the **flat Academic/Student-support/Operations** sidebar (persona `Mrs C. Owusu-Ansah · Head of Academics`, `WASSCE 2026` active). URL `…/wassce/candidates/0184-0817#match`. `.head-row` crumb `Y. Aidoo › University match` → `<h1>` `Five <em>programmes</em> · matched and ranked` → actions. **Build §6 as a section inside the existing candidate route** (`app/(app)/senior/wassce/candidates/[index]/page.tsx`, shipped INCR-17), not a new page.
- **setup §3** rides the **INCR-15 setup frame** — the sectioned setup sidebar (`Dashboard · Students · Classes & courses · Attendance · Boarding · Sickbay · WASSCE(active) › Setup(active)/Cohort readiness/Student reports/Subject view/Live exam tracker · Discipline · Communications · Reports`, footer `C. Owusu-Ansah · Head of Academics`). URL `…/wassce/setup/university-targets`. **Build §3 as a section of the existing setup page/route** (`app/(app)/senior/wassce/setup/page.tsx`, shipped INCR-15).

The outer editorial `.page-header` / `.section-head` / `.section-num` / `.section-meta` and the `.notes` right-rail on **both** surfaces are **design-doc chrome — do NOT build.** Build the in-app frame only (same rule as every prior WASSCE map).

### 0.4 No-alpha discipline — EVERY translucency in the 17b regions (repo memory `no-alpha-token-opacity`)
The surfaces hand-write `rgba()` / gradient literals — fine as-is. The trap is the **Tailwind port**: slash-opacity on a raw-hex token (`bg-gold/8`, `bg-navy/80`) **renders nothing**. Verify in the **live preview**, not the build. Full table in **Part F** — including the **5 tier-badge tints**, which are the ones most likely to be fat-fingered into slash-opacity. Every one of the five badges is a **solid** background (token or bespoke hex) — none needs alpha; port each as a solid class.

---

# PART A — student-readiness §6 · University match tiles — **CROWN JEWEL**

**Surface lines 1301–1512.** Editorial head (do-not-build): `06 · University match · five programmes scored · 1 target · 1 comfortable · 2 stretch · 1 safety`. URL `#match`. This is the **projected-aggregate-vs-cut-off match display** — the visible payoff of the whole projection spine.

### A.1 In-app page-head
| Element | Exact copy | Token / kind |
|---|---|---|
| Crumb | `Y. Aidoo › University match` | `text-navy-3`, `›` separator |
| `<h1>` | `Five ` + `<em>programmes</em>` + ` · matched and ranked` | `font-display 24px 500`; gold italic `<em>` |
| Action `View cut-off table` | `View cut-off table` | `.btn` — **read/nav → the setup §3 cut-off table (B.5)**. OK to wire. |
| Action `Add programme` | `Add programme` | `.btn` — **WRITE** (tag a new target; see A.9 + Part D). |

### A.2 Layout
`.uni-match-grid` = `grid-cols-2 gap-14`. Five `.uni-match` programme tiles + one dashed **"+ Add programme"** tile (A.9), then a full-width **match-logic legend** card (A.6) below the grid.

### A.3 Tile anatomy (`.uni-match`) — white `rounded-lg border-border padding 18px 20px`, `position:relative overflow:hidden`
- **TARGET-only decoration:** `.uni-match.target` = `border-left 4px solid gold` + `linear-gradient(to right, gold-bg 0%, surface 12%)` (a gold wash on the left edge). The primary target is the only tile with this treatment.
- **`.uni-match-head`** (`flex justify-between items-start`): left `.uni-match-name` (`font-display 15px 500`) + `.uni-match-prog` (`12px text-navy-3`); right the **tier badge** `.match-pill` (A.7).
- **`.uni-match-bar-row`** (`grid-cols-[80px_1fr_80px] gap-10 items-center 11px`): `Best <b>6</b>` · the bar · `Worst <b>54</b>` — the aggregate scale (A.8).
- **`.uni-match-meta`** (`flex gap-12 11px text-navy-3 border-t pt-10`, bolds `text-navy`): 2–4 fact chips (cut-off, trend/margin/gap, prerequisites/outcome).

### A.4 The five programme tiles — VERBATIM (name / programme / badge / cut-off / You / margin-or-gap / prereq-or-outcome)

| # | `.uni-match-name` | `.uni-match-prog` | `.match-pill` (tier) | Cut-off marker | You marker | Meta line 1 | Meta line 2 | Meta line 3 | Meta line 4 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `KNUST · Biochemistry` | `B.Sc. · 4 years · Kumasi` | **`Target · primary choice`** | `Cut-off · 11` | `You · 10` | `Cut-off · 11 (2025)` | `Trend · stable 3 yrs` | `Margin · 1 inside` | `Prerequisites · Chem + Bio credit · met` |
| 2 | `Legon · Biochemistry` | `B.Sc. · 4 years · Accra` | **`Comfortable`** | `Cut-off · 12` | `You · 10` | `Cut-off · 12 (2025)` | `Margin · 2 inside` | `Prerequisites · met` | — |
| 3 | `KNUST · Pharmacy` | `PharmD · 6 years · Kumasi` | **`Stretch`** | `Cut-off · 8` | `You · 10` | `Cut-off · 8 (2025)` | `Gap · 2 outside` | `Likely outcome · waitlist` | — |
| 4 | `Legon · Medicine` | `MB ChB · 6 years · Accra` | **`Stretch · highly competitive`** | `Cut-off · 6` | `You · 10` | `Cut-off · 6 (2025)` | `Gap · 4 outside` | `Likely outcome · unlikely · interview required` | — |
| 5 | `UCC · Biochemistry` | `B.Sc. · 4 years · Cape Coast` | **`Safety`** | `Cut-off · 14` | `You · 10` | `Cut-off · 14 (2025)` | `Margin · 4 inside` | `Prerequisites · met` | — |

Header section-meta count (do-not-build editorial, but it's the truth-of-tiles): **`1 target · 1 comfortable · 2 stretch · 1 safety`** — note **no MATCH tile in the demo** (see A.7). On tiles 3 & 4 (STRETCH) the marker DOM order is `cut-off` **before** `you` (cut-off is to the left / harder); on 1, 2, 5 the order is `you` before `cut-off` (you're to the left / inside). The build must place markers by **value on the shared 6→54 scale**, not by DOM order (A.8).

### A.5 Binding — each tile's data
> **Proposed (Kofi/Wells confirm at 17b):**
> - **Name / programme / degree / duration / city** → `universities.name`(short display "KNUST"/"Legon"/"UCC") + `university_programmes.name`("Biochemistry"), `.degree`("B.Sc."/"PharmD"/"MB ChB"), `.duration_years`(4/6), `universities.city`("Kumasi"/"Accra"/"Cape Coast"). **GLOBAL tables** — same programme rows serve every tenant.
> - **Cut-off + `(2025)`** → `university_programmes.cut_off_aggregate`(11/12/8/6/14) + `.reference_year`(2025). The `(2025)` label is **not decoration — it is the honesty flag** (Part E): the cut-off is a seeded published snapshot, not live admissions data.
> - **You · 10** → the candidate's **derived** best-3 aggregate via `lib/wassce/projection.ts` (INCR-17; `wassce_candidates.projected_aggregate` stays NULL in the live path — read the derived value, one source of truth).
> - **Tier badge** → **DERIVED** `matchTier(projectedAggregate=10, cutOff, isPrimary)` (A.7). Never stored.
> - **Margin / Gap** → derived `cutOff − projected` (positive = "N inside", inside/admissible) or `projected − cutOff` (positive = "N outside", a reach). Not stored.
> - **Trend · stable 3 yrs** → **no clean single-snapshot binding** — implies a rolling cut-off history; see Part G. Render static/seeded or from a `cut_off_history` the owner may not license.
> - **Likely outcome · waitlist / unlikely · interview required** → a **derived label** off the tier + gap magnitude (a `lib/wassce/match-tier.ts` copy function), not a column.
> - **Prerequisites · Chem + Bio credit · met** → **DERIVED** prereq-met check (A.10) against `university_programmes.prerequisites_json` (required subjects) vs the candidate's registered + predicted-credit subjects.
> - **rank / "primary choice"** → `university_targets.rank` (`target_rank_enum`) — the candidate/counsellor's ordering; the "· primary choice" suffix on tile 1 comes from `rank = PRIMARY` (feeds the TARGET tier via `isPrimary`, A.7). See the rank-vocabulary drift in Part G.

### A.6 The match-logic legend — VERBATIM (`bg-surface border-border rounded-lg pt-18`)
Full-width card below the grid. Title `Match logic — five-tier band` (`font-display 14px 500`). Then `grid-cols-5 gap-10 11px`, each cell a `.match-pill` + a `text-navy-3` gloss:

| Tier pill | Gloss (verbatim) — **the aggregate-vs-cut-off rule** |
|---|---|
| `Target` | `The primary choice; cut-off within 2 of projected.` |
| `Comfortable` | `Cut-off 2–4 above projected aggregate.` |
| `Match` | `Cut-off equal to projected ± 1.` |
| `Stretch` | `Cut-off 2+ below projected. Worth applying; not realistic outcome.` |
| `Safety` | `Cut-off 4+ above projected. Comfort floor.` |

**MATCH is defined here but no A.4 tile uses it** — the MATCH badge is an **unexercised-in-demo state**; it MUST still be implemented + tested (a non-primary programme whose cut-off sits within ±1 of the projected aggregate). See A.7 precedence + Part I.

### A.7 THE 5-TIER MATCH BADGE — crown-jewel binding (each tier's exact colour + the aggregate-vs-cut-off rule)

**Colours** — from `.match-pill.*` (surface lines 300–304). **Cut-off = the WORST aggregate a programme admits; lower cut-off = more competitive; you are "inside/admissible" when `projected ≤ cut-off`.** All five backgrounds are **SOLID** (no alpha — Part F):

| Tier | `.match-pill` bg | text | Token status | Aggregate-vs-cut-off rule (what the badge encodes) | Y. Aidoo instance |
|---|---|---|---|---|---|
| **TARGET** | `var(--gold)` `#C8975B` | `var(--navy)` `#1A2B47` | **solid tokens** | The candidate's **primary-ranked** choice AND `|cut-off − projected| ≤ 2`. Brass-gold = the brand "this is THE one". | KNUST Biochem: cut-off 11, proj 10, +1, `rank=PRIMARY` → TARGET |
| **COMFORTABLE** | `var(--green-bg)` `#E5EFE8` | `var(--green)` `#2F6B47` | **solid tokens** | Inside by a healthy band: `cut-off − projected ∈ [2, 3]` (surface says "2–4"; the 4 boundary goes to SAFETY — see precedence). Success green = safely in. | Legon Biochem: cut-off 12, proj 10, +2 → COMFORTABLE |
| **MATCH** | `#E5EFE8` (**= green-bg hex**) | `#1E5A35` (**bespoke dark forest = A1 grade hex**) | bg = green-bg token; text = **bespoke** (Palette-A A1) — **not a token** | Right at the line: `|cut-off − projected| ≤ 1` and **not** the primary. Deeper forest text distinguishes it from COMFORTABLE (same bg, different text). | *(none in demo — must implement)* |
| **STRETCH** | `var(--warn-bg)` `#F5E9D0` | `var(--warn)` `#C58A2E` | **solid tokens** | A reach — you're **outside**: `projected − cut-off ≥ 2` (cut-off is lower/harder than you can reach). Caution amber. | KNUST Pharmacy (8, gap 2) + Legon Medicine (6, gap 4) → STRETCH |
| **SAFETY** | `#E5EAF2` (**bespoke blue-grey**) | `#2D3F5C` (`= navy-2` token) | text = navy-2 token; bg = **bespoke** (same hex as the Slessor House pill) — **not a token** | The comfort floor: inside by `cut-off − projected ≥ 4`. Calm blue-grey = neutral fallback. | UCC Biochem: cut-off 14, proj 10, +4 → SAFETY |

**Proposed deterministic precedence for `lib/wassce/match-tier.ts`** (the surface's stated bands OVERLAP — "within 2" vs "±1", "2–4 above" vs "4+ above" — so a first-match order is required; this order reproduces all five A.4 tiles + assigns MATCH to the near-equal case):
1. `isPrimary && |cutOff − projected| ≤ 2` → **TARGET**  *(primary within 2 wins over MATCH — KNUST Biochem is +1 but TARGET, not MATCH)*
2. `projected − cutOff ≥ 2` → **STRETCH**  *(you're a reach below the cut-off)*
3. `cutOff − projected ≥ 4` → **SAFETY**  *(4+ inside — takes the "4" boundary off COMFORTABLE)*
4. `cutOff − projected ∈ [2, 3]` → **COMFORTABLE**
5. else (`|cutOff − projected| ≤ 1`, non-primary) → **MATCH**

> **⚠️ Kofi call (Part I #1):** the surface's five glosses have **overlapping numeric bands** (Target ≤2 & Match ≤1; Comfortable 2–4 & Safety 4+). Kofi must ratify a **single non-overlapping precedence** so the badge and any stored analytics never disagree. The order above is the minimal one that is 1:1 with the rendered tiles; confirm the tie-at-boundary behaviour (does `cut-off − projected == 2` go COMFORTABLE, does `== 4` go SAFETY, does primary-within-1 go TARGET over MATCH). **This pairs with Kofi's match-tier function — it is the load-bearing logic of 17b.**

### A.8 The projected-vs-cut-off bar (`.uni-match-bar-row`) + markers
- **Scale labels** flank the bar: `Best <b>6</b>` (left) · `Worst <b>54</b>` (right) — the aggregate runs 6 (best) → 54 (worst), matching `AGGREGATE_RANGE_LABEL`.
- **`.uni-match-bar`** = `h-8 rounded bg-bg`, with a decorative `.uni-match-bar-fill` `linear-gradient(to right, green 0%, gold 70%, terra 100%)` (the difficulty gradient).
- **Two markers**, each `w-2 h-14` with an above-label: `.uni-match-marker.you` = **navy** `#1A2B47` (`You · N`, label `text-navy`) and `.uni-match-marker.cutoff` = **terra** `#B84A39` (`Cut-off · N`, label `text-terra`).
- **⚠️ NO clean derivation from the surface's inline positions (Part G):** the surface hard-codes `left:` and `width:` per tile (`you` always `16%`; cut-offs at `6/8/18/22/28%`; fills `2/4/8%`) and these are **hand-tuned and NOT internally consistent** (they don't fit one linear scale). The build must **compute both marker positions from ONE linear map over the labelled 6→54 domain** (e.g. `left% = (value − 6) / (54 − 6) × 100`) so `You` and `Cut-off` are visually comparable across tiles. Treat the fill width as decorative (derive from the better of you/cut-off, or drop). Do **not** copy the inline percentages.

### A.9 "+ Add programme" tile + the empty state
Sixth grid cell: `.uni-match` with `bg-bg border-dashed`, centered, `min-h-160`:
- `+ Add programme` (`font-display 14px 500 text-navy-3`)
- `SHS guidance counsellor and candidate together. 3–5 programmes is the norm; 1 target, 1 comfortable, 1–2 stretch, 1 safety.` (`11px text-navy-3`, max-w 240)

This is the **write entry-point** (Part D) and doubles as the **empty state**: when a candidate has **zero** `university_targets`, §6 renders **only** this dashed tile (no programme tiles) + the match-logic legend (A.6) still renders (it's static copy). Copy for the true-empty headline may soften to "No target programmes tagged yet" above the same affordance.

### A.10 Prerequisite-met vs not-met state
- **Met (the only state in the demo):** `Prerequisites · Chem + Bio credit · met` (tile 1, subjects named) or `Prerequisites · met` (tiles 2 & 5, subjects elided). Render `· met` in `text-navy`/neutral.
- **NOT-met (unexercised in demo — MUST implement, Part I):** when the candidate is not sitting, or not projected to credit, a required subject → `Prerequisites · [subject] · not met` in **`text-terra`** (mirrors the setup §3 flag styling + the identity-card constraint colour). Tile still renders (auditable), badge still computes, but the not-met flag warns.
- **Binding:** `university_programmes.prerequisites_json` = the required-subject list (setup §3 step 2 spells KNUST Biochem's: "credits in English, Math, Int Sci, Biology, Chemistry + Physics or Elec Math"). Met = candidate is **registered** for each required subject (`wassce_candidate_subject`) **AND** projected to **credit** it (predictor-mock `effectiveGrade` A1–C6). **⚠️ sitting-vs-crediting nuance (Part I #4):** §3 step 2 checks "sitting all required subjects" (registration-time); §6 tile 1 + §6 notes say "credit at C6 or better" (projection-time). Kofi must rule which the flag encodes (recommend: **registered → structural block; not-credit-projected → soft warn** — two shades, not one).

---

# PART B — setup §3 · University-targets config (per-student tagging)

**Surface lines 649–857.** Editorial head (do-not-build): `03 · University target system · per-student tagging · Headmaster + Dean of Students · academic guidance`. URL `…/wassce/setup/university-targets`.

### B.1 In-app page-head
| Element | Exact copy | Kind |
|---|---|---|
| Crumb | `WASSCE · Setup · University targets` | nav |
| `<h1>` | `University ` + `<em>target</em>` + ` system.` | `font-display`, gold italic `<em>` |
| Lede | `Every F3 student tags <b>up to three target programmes</b> after Mock 1 (revised after Mock 2). The system stores the WAEC cut-off for each programme and matches it against the student's projected aggregate. <b>The Dean runs a guidance interview</b> with every student whose Mock 2 aggregate exceeds their lowest target's cut-off.` | `.lede` |
| Action `Cut-off table` | `Cut-off table` | `.btn` — read/nav → B.5 |
| Action `Unmatched list` | `Unmatched list` | `.btn` — read/nav → the untagged worklist (B.3 flag row) |
| Action `Run match · all students` | `Run match · all students` | `.btn primary` — **see Part D: match is DERIVED-on-read, so this is a refresh/worklist-build, NOT a stored batch write.** |

### B.2 Tier-band strip (`.target-strip`) — cohort **aggregate** bands (NOT the 5-tier match badge)
`grid-cols-4 gap-12`. **These are the cohort's projected-aggregate distribution bands — a different axis from the A.7 match tiers. Do not conflate.** Each `.target-band` shows a mono aggregate range chip (`.tb-aggr`), a Fraunces `Tier <em>N</em>`, and a count line:

| Band | `.tb-aggr` | `.tb-name` | `.tb-line` (verbatim) | Styling |
|---|---|---|---|---|
| tier-1 | `6 – 12` | `Tier 1` | `Medicine, Pharmacy, Engineering, Law. KNUST/Legon competitive. <b>39 students</b> in this band.` | `linear-gradient(135deg, gold-bg 0%, surface 100%)` + `border gold`; `.tb-aggr` = `bg-gold text-navy` |
| tier-2 | `13 – 18` | `Tier 2` | `Most degrees at top 3 unis. Business Admin, Sciences, Education. <b>91 students.</b>` | `bg-surface border-border-2`; `.tb-aggr` = `bg-bg text-navy` |
| tier-3 | `19 – 24` | `Tier 3` | `Less competitive programmes, teacher training, second-tier unis. <b>74 students.</b>` | same as tier-2 |
| tier-4 | `25 +` | `Tier 4` | `Technical universities, polytechnics, vocational paths, work track. <b>36 students.</b>` | same as tier-2 |

> **Binding:** band ranges = `lib/wassce/` constant (the same 6–12/13–18/19–24/25+ bands as the INCR-16/17 aggregate-band label). Student **counts (39/91/74/36)** = derived `COUNT` of candidates whose **derived** projected aggregate falls in each band — a **cohort aggregate (leans on INCR-18)**, not a 17b table. Render from the derived aggregate; no stored band column.

### B.3 Top-destinations list (`.uni-list`) — first-choice university tally
Card `Top <em>destinations</em> · how the cohort is targeting` · meta `First-choice university (most popular)`. `.uni-row.head` columns: `(logo)` · `University` · `Median cut-off` · `Students targeting` · `% F3`.

| Logo | `.uni-name` + `.uni-loc` | `.uni-aggr-r` (median cut-off + `.sub` range) | Students targeting | % F3 | Logo colour |
|---|---|---|---|---|---|
| `KN` | `Kwame Nkrumah Univ. of Science & Technology` · `Kumasi · public` | `11` · `range 6–24` | `68` | `28%` | `.knust` terra bg / bg text |
| `UG` | `University of Ghana` · `Legon · public` | `14` · `range 8–24` | `52` | `22%` | default navy bg / gold text |
| `UC` | `University of Cape Coast` · `Cape Coast · public` | `16` · `range 9–24` | `41` | `17%` | `.ucc` green bg / bg text |
| `UE` | `Univ. of Education, Winneba` · `Winneba · public` | `17` · `range 10–24` | `28` | `12%` | `.uew` gold bg / navy text |
| `TT` | `Takoradi Technical Univ.` · `Takoradi · technical` | `22` · `range 15–30` | `21` | `9%` | `.takoradi` warn bg / surface text |
| `UD` | `Univ. for Development Studies` · `Tamale · public` | `18` · `range 12–24` | `14` | `6%` | `.uds` **`#7B4A8A`** bg / bg text (**bespoke — same as General Arts purple; NOT a token, inline only**) |
| `CA` | `Other (private, vocational, abroad)` · `Various` | `—` · `range varies` | `12` | `5%` | default navy/gold |
| *(flag row)* | `No first-choice tagged yet` (italic `text-navy-3`) | `flag` · `Dean follow-up` (**`text-terra`**) | `4` (`text-terra`) | `2%` | `bg-bg`, `border-top 2px navy` |

Warn callout below (`bg-warn-bg border-left-3 warn`): `<b>4 students have not tagged a first-choice university</b> as of 12 May. Dean Mensa-Ofori is scheduled to meet each individually before Friday — three are Tier 3 candidates undecided between technical universities and teacher training; one (J. Anokye, F3 GA) is considering deferment.`

> **Binding:** row = a `university` (GLOBAL) joined to a derived tally. **Median cut-off + range** = derived `MIN/median/MAX(cut_off_aggregate)` across that university's `university_programmes` (**not stored** — a per-university summary). **Students targeting + % F3** = derived `COUNT(university_targets WHERE rank=PRIMARY GROUP BY university) / cohort size`. **`—` for "Other"** = the em-dash convention (no programmes catalogued). **Flag row** = `COUNT(candidates with zero primary university_target) = 4` — the untagged worklist behind `Unmatched list` (B.1). The logo initials/colours = a `lib/wassce/` per-university constant keyed to `universities.id` (the House-hex idiom); `UDS` purple is bespoke.

### B.4 "How the match works" — 5-step explainer (`.col-2` left card) — VERBATIM
Card `How the <em>match</em> works` · `Per student × per programme`. Five gold-italic-numbered steps (`1.`–`5.` Fraunces italic gold):
1. `<b>Programme cut-off published by university.</b> KNUST Biochemistry = 11. Legon Medicine = 6. UCC Nursing = 12. The cut-off table is updated annually from each university's admissions page.`
2. `<b>Subject prerequisites checked.</b> KNUST Biochem requires credits in English, Math, Int Sci, Biology, Chemistry + Physics or Elec Math. The system checks whether the student is sitting all required subjects (set at registration).`
3. `<b>Mock 2 aggregate compared to cut-off.</b> Student's projected aggregate vs programme cut-off. Margin reported in points. Less than 2 points = "tight"; 2–5 points = "comfortable"; more than 5 = "very comfortable".`
4. `<b>Three target programmes per student.</b> The "stretch" (top choice), the "match" (most likely), and the "safety" (back-up). Three is the maximum; some students tag fewer.`
5. `<b>Dean reviews mismatches.</b> Any student whose top 2 targets exceed their Mock 2 aggregate gets a guidance interview. The Dean has reviewed <b>87 such cases</b> across the 2024/25 academic year.`

> **Binding:** all static explainer copy → `lib/wassce/` constant (like `waecPolicyAnchors`). Step 4's **"stretch (top choice) / match / safety"** three-slot vocabulary **contradicts §6's five-tier** (where "stretch" is the unlikely reach, "target" is the top choice) and step 3's **margin bands** (tight/comfortable/very-comfortable) are a **third** vocabulary — all three conflict. **Adopt §6's five-tier as canonical** (it drives the badge CSS + Kofi's `matchTier`); render step 3/4 copy 1:1 but flag the drift for surface-sync (Part G). "87 cases · 2024/25" = a historical stat with no 17b table → static/seed.

### B.5 Cut-off table · sample (`.col-2` right card) — VERBATIM
Card `Cut-off <em>table</em> · sample` · `2025/26 academic year · 12 referenced programmes`. Table cols `University` · `Programme` · `Cut-off` (mono, right, difficulty-coloured):

| University | Programme | Cut-off | Cut-off colour |
|---|---|---|---|
| KNUST | Medicine | `6` | `text-terra` |
| Legon | Medicine | `6` | `text-terra` |
| KNUST | Pharmacy | `8` | `text-terra` |
| **KNUST** | **Biochemistry** | `11` | `text-gold` (**row highlighted `bg-gold-bg`** — the candidate's target) |
| UCC | Nursing | `12` | `text-warn` |
| Legon | Business Admin | `14` | `text-warn` |
| KNUST | Civil Engineering | `13` | `text-warn` |
| UEW | B.Ed. Mathematics | `17` | `text-warn` |
| Legon | B.A. Political Science | `18` | `text-warn` |
| UCC | B.Ed. Economics | `19` | `text-warn` |
| Legon | General cut-off (lowest) | `24` | `text-green` |
| Takoradi Tech | B.Tech. Marketing | `28` | `text-green` |

Foot (`bg-bg 10px text-navy-3`): `Cut-offs verified <b>Apr 2026</b> from each university's admissions portal. Universities sometimes adjust cut-offs after WASSCE results come in if applicant pool changes. The figures here are <b>indicative</b>, not guarantees.`

> **Binding:** each row = a `university_programmes` row (`universities.name` + `.name` + `.cut_off_aggregate`). **Cut-off colour is difficulty-coded and INVERTED from the usual green=good semantics** — here `text-terra` = lowest/hardest cut-off (6–8), `text-warn` = mid (11–19), `text-green` = highest/easiest (24+). Map via a `lib/wassce/` `cutOffDifficultyColor(cutOff)` (thresholds ≤~8 terra, ~9–19 warn, ≥~20 green — confirm exact boundaries with Kofi). The KNUST-Biochem `bg-gold-bg` highlight = "this candidate's target row" (on the setup surface it's the demo's canonical row; in the per-candidate context highlight the candidate's tagged programmes). The `Apr 2026 verified` / `2025/26 academic year` / `indicative, not guarantees` foot is the **snapshot-honesty** binding (Part E).

---

# PART C — Data model: the three university tables + derived match tier

> **Proposed shapes (for Wells/Kofi at 17b; mirrors how prior maps pre-specified schema):**

**`universities` — GLOBAL (bare ENABLE RLS, no FORCE, no `tenant_isolation`, prod-paste GLOBAL block):**
`id`, `name` (full, "Kwame Nkrumah Univ. of Science & Technology"), `short_name` ("KNUST"/"Legon"/"UCC" — the §6 tile prefix + logo initials source), `city` ("Kumasi"/"Accra"/"Cape Coast"/"Winneba"/"Takoradi"/"Tamale"), `university_type` (`university_type_enum` — PUBLIC / TECHNICAL / PRIVATE, from setup §3 loc "public"/"technical"; "Other" bucket handled in the loader, not a row). No `school_id` (a university exists for every tenant). Keyed by a tenant-agnostic natural key (name) like `benchmark_reference.subject_name`.

**`university_programmes` — GLOBAL (bare ENABLE RLS), FK `university_id` → `universities.id` (single-column; global-to-global):**
`id`, `university_id`, `name` ("Biochemistry"/"Medicine"/"Pharmacy"/"Nursing"/…), `degree` ("B.Sc."/"MB ChB"/"PharmD"/"B.Ed. …"), `duration_years` (4/6), `cut_off_aggregate` smallint (6..54, the published cut-off), **`reference_year` smallint NOT NULL** (2025 — the snapshot honesty column, Part E), `prerequisites_json` (required-subject list for the A.10 prereq check), optional `cut_off_trend_json`/history (the "stable 3 yrs" — owner-gated, Part G). No `school_id`.

**`university_targets` — TENANT (composite `(school_id, …)` FKs, FORCE RLS `tenant_isolation`, prod-paste TENANT block, LEAF):**
`id`, `school_id`, `candidate_id` (**composite FK `(school_id, candidate_id)` → `wassce_candidates`**), `university_programme_id` (single-column FK → the GLOBAL `university_programmes.id` — the tenant→global link, SET NULL / no composite, the `benchmark`/actor-stamp idiom), **`rank`** (`target_rank_enum` — the candidate's ordering; drives `isPrimary`), `notes`, and the **OWN parent-ack block** (build-plan line 2173): `parent_acknowledged_at`, `parent_acknowledged_signature_method` (reuse `parent_ack_method_enum` PHONE_OTP/IN_PERSON/PDF_UPLOAD), `parent_acknowledged_phone`, `parent_signature_pdf_file_id` (nullable placeholder, no FK — no files table, the INCR-17 idiom). `UNIQUE(school_id, candidate_id, university_programme_id)` (no double-tag). **No `match_tier` column** — derived.

**Derived (no column, `lib/wassce/match-tier.ts`, no trigger):** `match_tier` (A.7), `margin/gap` (A.4), `prereq_met` (A.10), `likely_outcome` label (A.5), the setup §3 median-cut-off/range/students-targeting/%-F3/band-counts (B.2/B.3) — all computed on read from the derived aggregate + the global cut-off snapshot + `university_targets` counts.

**17b backfills into INCR-17 tables:** `readiness_statements.target_universities_json` (INCR-17 left NULL) ← the candidate's `university_targets` + their derived tiers at generation time (frozen snapshot); the §1 identity-card `Target · KNUST Biochemistry` line + the §7 parent-ack `agreed with KNUST Biochemistry as primary target · agreed with three supporting programmes` lines (INCR-17 rendered omitted) ← the primary + supporting `university_targets`.

---

# PART D — Write / read / authz control inventory

| Control (region) | Exact label | Kind | Binds to | Authz (proposed) |
|---|---|---|---|---|
| **Add / tag a target** | `Add programme` (§6) · `+ Add programme` tile (§6) | **WRITE** | INSERT `university_targets` (candidate × programme) | `WASSCE_SETUP_ROLES` (ADMIN / HEADMASTER / **VICE_HEADMASTER_ACADEMIC = HoA**) — **see role flag below** |
| **Rank a target** | (implied by "· primary choice" + step 4 "stretch/match/safety" slotting; drag/select rank) | **WRITE** | UPDATE `university_targets.rank` (`target_rank_enum`) | same |
| **Remove / edit a target** | (implied — drop a tagged programme) | **WRITE** | DELETE/UPDATE `university_targets` | same |
| **Per-target parent-ack** | (implied — §7 "agreed with … as primary target"; the per-target ack is `university_targets`' OWN, separate from `readiness_statements`') | **WRITE** (signature) | UPDATE `university_targets.parent_acknowledged_at`/method/phone | **school-captured** (HoA records) in 17b; parent's own signing UI = INCR-19. **SMS-OTP owner-gated (Hubtel) → console-degrade** (same gate as INCR-17 parent-ack / boarding) |
| **Run match** | `Run match · all students` (§3) | **READ / refresh** (NOT a stored write) | recompute derived tiers on read; build the `Unmatched list` worklist | reader (`WASSCE_SETUP_ROLES` view) |
| **View cut-off table** | `View cut-off table` (§6) · `Cut-off table` (§3) | Read/nav | `university_programmes` snapshot (B.5) | reader |
| **Unmatched list** | `Unmatched list` (§3) | Read/nav | candidates with zero primary target (B.3 flag) | reader |
| Tier badge · bar · markers · margin/gap · prereq flag · median-cut-off · students-targeting · band counts | (display) | **Read-display (derived)** | `lib/wassce/match-tier.ts` + projection + counts | reader |

> **⚠️ Role flag (Part I #3 — the task's "who sets a candidate's university targets — HoA?"):** the surfaces name **"Dean of Students" / "Dean Mensa-Ofori" / "SHS guidance counsellor"** as the actor who tags targets and runs guidance interviews — but this codebase's `appRoleEnum` has **no Dean / guidance-counsellor role** (`lib/access.ts`). The closest existing gate is **`WASSCE_SETUP_ROLES` = ADMIN / HEADMASTER / VICE_HEADMASTER_ACADEMIC (Head of Academics)** — so **proposed answer: the HoA (VICE_HEADMASTER_ACADEMIC) sets a candidate's university targets**, same gate as SC-form filing + readiness generation in INCR-17. Confirm with Kofi/Sarah whether to (a) keep `WASSCE_SETUP_ROLES`, (b) add a `DEAN_OF_STUDENTS`/`GUIDANCE_COUNSELLOR` role, or (c) also let a **Form Master** tag targets for their own form's candidates. STUDENT/PARENT/TEACHER never reach the write. All writes tenant-scoped, RLS-enforced, audit-logged, no triggers.

---

# PART E — Cut-off / reference-year honesty framing (the snapshot discipline)

**The cut-offs are a SEEDED PUBLISHED SNAPSHOT, not live admissions data — and the surface must say so, honestly, everywhere it shows one.** This is an owner-gated dataset call (build-plan line 2084: "university cut-off dataset source — licensed vs school-entered — blocks the uni-match slice"). The surface already carries the honesty labels; the build must preserve and enforce them:

- **§6 every cut-off is stamped `(2025)`** — `Cut-off · 11 (2025)`, `· 12 (2025)`, etc. → `university_programmes.reference_year`. **Never render a cut-off without its reference year.**
- **§3 cut-off table foot:** `Cut-offs verified Apr 2026 … indicative, not guarantees` + header `2025/26 academic year · 12 referenced programmes`. → static honesty copy tied to the snapshot's `reference_year` / verified-date.
- **Where the surface IMPLIES live/current data, label it as a snapshot:**
  - §3 step 1 "the cut-off table is **updated annually** from each university's admissions page" — render as "last verified Apr 2026" not "live".
  - §6 tile 1 **"Trend · stable 3 yrs"** + §6 notes "keeps the **rolling 3-year history**" — this implies a live multi-year series the single-year snapshot **cannot** back (Part G). Either seed the 3-year history explicitly or render "Trend" as a static/seeded label — and keep each year's figure stamped.
  - §3 **"Median cut-off"** + `range 6–24` — a **derived** min/median/max over the snapshot's programmes; label the summary as of the snapshot year, not "current".
- **Guarding copy already present, keep verbatim:** "indicative, not guarantees"; "Universities sometimes adjust cut-offs after WASSCE results come in". The projection number is likewise **advisory, never WAEC-authoritative** (build-plan line 2182).

---

# PART F — No-alpha discipline — EVERY translucency in the 17b regions

| Element (region) | Raw value | Port to | Note |
|---|---|---|---|
| **`.match-pill.target` (§6 badge)** | `bg var(--gold)` solid | `bg-gold text-navy` | **SOLID token — no alpha.** |
| **`.match-pill.comfortable` (§6 badge)** | `bg var(--green-bg)` solid | `bg-green-bg text-green` | **SOLID token — no alpha.** |
| **`.match-pill.match` (§6 badge)** | `bg #E5EFE8` / `text #1E5A35` | `bg-green-bg text-[#1E5A35]` | bg = green-bg token; **text = bespoke Palette-A A1 hex** (inline arbitrary, not a token). No alpha. |
| **`.match-pill.stretch` (§6 badge)** | `bg var(--warn-bg)` solid | `bg-warn-bg text-warn` | **SOLID token — no alpha.** |
| **`.match-pill.safety` (§6 badge)** | `bg #E5EAF2` / `text #2D3F5C` | `bg-[#E5EAF2] text-navy-2` | **bg = bespoke blue-grey** (= Slessor House pill; inline arbitrary, not a token); text = navy-2 token. No alpha. |
| `.uni-match.target` left wash (§6) | `linear-gradient(to right, gold-bg 0%, surface 12%)` | `bg-[linear-gradient(...)]` arbitrary | decorative; keep as gradient, no slash-opacity |
| `.uni-match-bar-fill` gradient (§6) | `linear-gradient(to right, green 0%, gold 70%, terra 100%)` | arbitrary gradient | decorative difficulty bar |
| `.uni-match-marker.you / .cutoff` (§6) | solid `navy` / `terra` | `bg-navy` / `bg-terra` | solid |
| `.target-band.tier-1` gradient (§3) | `linear-gradient(135deg, gold-bg 0%, surface 100%)` | arbitrary gradient | — |
| `.uni-logo.uds` (§3) | `#7B4A8A` solid | `bg-[#7B4A8A] text-bg` | **bespoke — same as General Arts purple; NEVER `bg-[#7B4A8A]/N`.** Reuse the `PROGRAMME_TRACKS` inline idiom. |
| `.target-band tier-1 .tb-aggr` / cut-off table gold-bg highlight (§3) | `bg-gold` / `bg-gold-bg` solid | `bg-gold` / `bg-gold-bg` | solid tokens |
| Sidebar nav (both frames) | INCR-15 `rgba(...)` literals | **reuse INCR-15 §0.2 ports verbatim** | already-built chrome |

**The 5 tier tints are all SOLID** — none needs alpha; the only trap is porting `bg #E5EFE8` / `bg #E5EAF2` as tokens when they're bespoke (match text `#1E5A35`, safety bg `#E5EAF2`). Verify all five in the **live preview**, not the build.

---

# PART G — No-clean-binding flags & drift log (for Kofi / Wells / Sarah)

| Element | Issue | Resolution |
|---|---|---|
| **§6 marker `left%` + bar `width%`** | Hand-tuned inline positions (`you` 16%, cut-offs 6/8/18/22/28%, fills 2/4/8%) are **not one consistent scale** | **Derive both markers from a single linear 6→54 map** (A.8); treat fill as decorative. Do not copy inline %. |
| **§6 "Trend · stable 3 yrs" / "rolling 3-year history"** | No binding in a single-year snapshot | Owner-gated cut-off history (Part E); seed 3 years or render static/seeded, each year stamped |
| **§6 MATCH badge** | Defined in the legend, **no tile uses it** | Unexercised-in-demo state — **implement + test** the non-primary within-±1 case (A.7 rule 5) |
| **§6 prereq NOT-met state** | All met in demo | Implement terra "not met" (A.10); rule sitting-block vs credit-warn (Part I #4) |
| **Match-tier vocabulary drift** | §6 five-tier ("stretch" = unlikely reach, "target" = top choice) **vs** §3 step 4 three-slot ("stretch" = top choice, "match" = most likely, "safety" = back-up) **vs** §3 step 3 margin bands (tight/comfortable/very-comfortable) — **three conflicting vocabularies** | **Adopt §6 five-tier as canonical** (drives the badge + `matchTier`); render §3 copy 1:1 but flag §3's "stretch = top choice" for surface-sync. Kofi ratify. |
| **A.7 overlapping tier bands** | "within 2" vs "±1"; "2–4 above" vs "4+ above" | Kofi ratify the non-overlapping precedence (A.7 / Part I #1) |
| **`rank` vs `match_tier` collision** | The surface conflates the student's **rank** (primary/supporting) with the computed **tier** ("Target · primary choice" = tier TARGET + rank PRIMARY) | Store `rank` (`target_rank_enum`); **derive** `match_tier`; TARGET tier requires `isPrimary` (A.7). Define `target_rank_enum` values (PRIMARY/SUPPORTING or ordinal) — Kofi. |
| **§3 median-cut-off / range / students-targeting / %-F3 / band counts** | Derived aggregates, no stored column; band counts lean on INCR-18 | Derive from `university_programmes` GROUP BY university + `university_targets` counts + derived-aggregate bands |
| **§3 "Other (private, vocational, abroad)" `—` cut-off** | Not a catalogued programme row | Loader bucket, em-dash; not a `universities` row |
| **§3 cut-off colour is INVERTED** | terra = hardest (low cut-off), green = easiest (high cut-off) — opposite of usual green=good | `lib/wassce/cutOffDifficultyColor()`; document the inversion so it isn't "fixed" |
| **§3 "Dean of Students" / "guidance counsellor" persona** | No such role in `appRoleEnum` | Authz = `WASSCE_SETUP_ROLES` (HoA); flag optional Dean/counsellor/Form-Master role (Part D / Part I #3) |
| **`universities`/`university_programmes` GLOBAL** | No `school_id` — the module's 2nd/3rd global tables | Bare ENABLE RLS, no FORCE/no `tenant_isolation`, GLOBAL prod-paste block (the `benchmark_reference` idiom, build-plan line 2082). Only `university_targets` is tenant. |
| **`university_targets → university_programmes` FK** | Tenant → global reference | Single-column FK (not composite), SET NULL — the actor-stamp / `benchmark_reference` idiom; a composite FK to a global table is impossible (no `school_id` there) |
| **Pure best-3 vs Ghana admission rule** | INCR-17 ships pure best-3; real admission mandates English + Core Maths | Owner-escalate at 17b (build-plan line 2182/2197) — cut-off matching makes admission-accurate aggregates load-bearing; diverges only when Eng/Maths is a candidate's worst core (not in the Y. Aidoo demo). Ship pure best-3; flag. |

---

# PART H — Route, responsive & PWA

- **Routes:** §6 = a section of the existing candidate route `app/(app)/senior/wassce/candidates/[index]/page.tsx` at `#match` (tenant-scoped + RLS, HoA/Form-Master/subject-teacher readers; parent → INCR-19). §3 = a section of the existing setup route `app/(app)/senior/wassce/setup/page.tsx`. **Both frames already exist — 17b adds the region, not the page.**
- **Responsive** (surface `@media` collapses ~1280px, per prior WASSCE maps): §6 `.uni-match-grid` 2-col → **1-col**; §3 `.target-strip` 4-col → **2-col** (surface line 275 already declares `.target-strip { grid-template-columns:repeat(2,1fr); }`); §3 `.col-2` (how-it-works + cut-off table) → **1-col**; the `.uni-list` rows keep their grid but the cut-off table gets `overflow-x:auto`. Tier badges/pills never wrap.
- **PWA:** no dedicated `-pwa.html` variant. If a target set flows into the readiness-statement **PDF** (17b backfill of `target_universities_json`), it reuses the portable receipt-PDF path (#136) — no new offline surface, no new dep.

---

# PART I — Open questions (for Kofi / Wells / Sarah)

1. **Match-tier precedence (the crown-jewel logic).** Ratify the non-overlapping order in A.7 (Target primary-within-2 beats Match; Safety takes the `≥4` boundary off Comfortable; Stretch = `projected − cutOff ≥ 2`). Confirm exact tie-at-boundary behaviour. This is `lib/wassce/match-tier.ts`.
2. **`match_tier` is DERIVED, never stored** (the `projection.ts` idiom) — confirm no `match_tier` column, computed on read from derived aggregate vs snapshot cut-off, so it never drifts.
3. **Who sets a candidate's university targets?** Proposed **HoA (`VICE_HEADMASTER_ACADEMIC` / `WASSCE_SETUP_ROLES`)** — the codebase has no Dean/guidance role despite the surface persona. Decide: keep `WASSCE_SETUP_ROLES`, add a Dean/counsellor role, or also allow Form Master for their form.
4. **Prereq: sitting vs crediting.** §3 step 2 = "sitting all required subjects" (registration); §6 = "credit at C6 or better" (projection). Recommend registered → structural not-met (terra); not-projected-to-credit → soft warn. Kofi rule + define `university_programmes.prerequisites_json` shape (incl. "Physics **or** Elec Math" alternation).
5. **`target_rank_enum` values** (PRIMARY/SUPPORTING vs ordinal 1–3) + the "up to three targets" cap (§3 lede "up to three"; §6 add-tile "3–5 is the norm" — reconcile the cap). Resolve the rank/tier vocabulary collision (Part G).
6. **Global tables `universities`/`university_programmes`** shapes + the tenant→global single-column FK from `university_targets`; the GLOBAL prod-paste block (bare ENABLE RLS). Wells.
7. **Cut-off dataset source = OWNER-GATED** (licensed vs school-entered, build-plan line 2084) — blocks the *dataset*, not the *surface*: ship with the seeded 2025 snapshot + honesty labels (Part E); confirm the source before treating any cut-off as authoritative. Also the "Trend · stable 3 yrs" 3-year history (seed vs license).
8. **Per-target parent-ack** = `university_targets`' OWN `parent_acknowledged_at` (separate from `readiness_statements`', build-plan line 2173); school-captured in 17b, SMS-OTP console-degrade, parent signing UI = INCR-19. Confirm the two acks stay independent.
9. **17b backfill** of `readiness_statements.target_universities_json` + the §1 identity "Target ·" line + §7 parent-ack target lines (INCR-17 rendered omitted) — confirm 17b writes them and whether it regenerates/supersedes existing statements or backfills in place.

---

*Map produced against: `Surfaces/schoolup-wassce-student-readiness.html` §6 (university-match tiles + legend, lines 1301–1512) and `Surfaces/schoolup-wassce-setup.html` §3 (university-target config, lines 649–857); tier-badge/bar/logo CSS (student-readiness lines 292–315, setup lines 160–188); `md files/design-tokens.json` v1.0.0; house style + grade palette + no-alpha discipline reused from `docs/senior/wassce-{spine,mock,readiness}-surface-map.md` (INCR-15/16/17 — not re-derived); existing schema `db/schema/wassce.ts` (the tables 17b FKs into) + `lib/wassce/{constants,projection}.ts` + `lib/access.ts` (`WASSCE_SETUP_ROLES`); `docs/senior-build-plan.md` INCR-17/17b framing (split lines 2075/2168/2173, global-table portability 2082, owner-gated dataset 2084, pure-best-3 vs admission rule 2182/2197). **INCR-17b Kofi rulings NOT yet written — every table/binding above is a proposal for confirmation.** Projection/aggregate/SC/readiness spine = INCR-17 (shipped, `docs/senior/wassce-readiness-surface-map.md`); the rest of student-readiness = INCR-20; cohort distribution = INCR-18; parent portal = INCR-19 — deliberately NOT mapped. §6 is the ONLY new surface area on student-readiness.*
