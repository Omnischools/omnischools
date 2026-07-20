# WASSCE Cohort-Readiness (HoA) — Surface Map (INCR-18 · Module 4.3)

**Author:** Lucy (design cartographer) · **Status:** design spec, ready for the implementation engineer (Claude Code).
**Increment:** INCR-18 — *Cohort-readiness (HoA)* · **no migration** (read/aggregate surface; columns already exist in 0052) · depends on INCR-16 (0052) + INCR-17 (0053) + INCR-17b (0054).
**Scope:** the whole `wassce-cohort-readiness` surface — cohort-at-a-glance, subject heatmap, at-risk list, house × programme breakdown — **plus** the moderation write UI that the build plan assigns to INCR-18 but that **no surface draws** (Part E).

---

## Source surfaces (visual source of truth — replicate 1:1)

| Surface file | Role | Sections |
|---|---|---|
| `Surfaces/schoolup-wassce-cohort-readiness.html` | **PRIMARY** — the entire HoA cohort dashboard. 1136 lines, four app-frame sections. | **§1** cohort at a glance (lines 271–472) · **§2** subject heatmap (474–738) · **§3** at-risk list (740–993) · **§4** house × programme (995–1131) |
| `components/senior/wassce-mock-entry-grid.tsx` (**shipped, INCR-16**) | **The moderated-vs-original visual treatment already exists here.** Reuse verbatim — do not invent a second treatment. | grid cell, lines 143–186 |

### 🔴 BLOCKING FINDING — the moderation UI has no surface

The task brief and `docs/senior-build-plan.md:2076` both place the **moderation trail / moderation controls** in INCR-18. **They are not on this surface.** Verified:

```
grep -c 'moderat|Moderat'  Surfaces/schoolup-wassce-cohort-readiness.html  →  0
```

Zero occurrences across all 1136 lines. The file ends at §4 (house breakdown); there is no §5. The two "moderat" hits elsewhere in the WASSCE surface family (`wassce-subject-teacher.html:1128`, `wassce-student-readiness.html`) are the word **"Moderate"** used as a *data-quality confidence tier* — unrelated to grade moderation.

**Consequence:** Part E below is **designed, not replicated.** Every copy string in Part E is marked `NEW COPY` and must be owner-approved before build. I have kept it to the minimum that satisfies the R3 schema + the three INCR-16 carry-forwards, and I reuse shipped primitives rather than authoring a new visual language.

**Two dead CSS blocks confirm the surface was cut down from a larger draft** — build neither:
- `.save-bar` + children (lines 236–240) — defined, **never used** in the body. This is the sibling surfaces' "unsaved changes" write bar. Its absence is the strongest evidence the write section was removed.
- `.heatmap .hm-row-total` (line 167, `bg-navy text-gold`) — defined, **never used**. No row-total column is rendered in §2.

---

## Tables this map reads (ALL READ-ONLY except Part E)

| Table | Increment | Used by |
|---|---|---|
| `mock_results` (+ the four moderation columns) | 0052 | §1 histogram/tiles · §2 heatmap · §3 projections · §4 house tiers · **Part E (the only WRITE)** |
| `mock_exams` (`is_predictor`, `marking_complete_at`) | 0052 | predictor selection · the partial/loading states |
| `wassce_candidates`, `wassce_candidate_subject`, `wassce_subjects`, `wassce_programmes` | 0051 | cohort roster · heatmap rows (`wassce_candidate_subject.bySubject` index was authored **explicitly for this heatmap** — schema comment `wassce.ts:299`) |
| `wassce_papers`, `wassce_paper_sittings` | 0051 | §1 live banner · "sitting today" tile · §4 house today-row |
| `waec_special_consideration` | 0053 | §1 banner SC-12 · §3 Y. Aidoo row · at-risk clause 3 |
| `readiness_statements` (frozen) | 0053 | **see Part G.4 — do NOT read for the live cohort figures** |
| `university_targets` + `university_programmes` (global, carries `cut_off`) | 0054 | §3 "Lowest target" + gap · "no target tagged" |
| `houses` (`name`, `colour`, `hm_user_id`), `students.house_id` | F0/boarding | §4 house cards |
| `benchmark_reference` (global) | 0052 | **INSUFFICIENT — see Part H.7** |

**No new table, no new column, no migration.** If Kofi rules that the at-risk workflow columns (Part H.1–H.4) ship in this increment, that becomes migration **0055** and this map's Part H must be re-costed.

---

# §0 — Shared chrome, tokens, type & no-alpha discipline

## 0.1 Tokens — identical `:root` to INCR-15/16/17

The surface declares the same palette as `md files/design-tokens.json` v1.0.0. **Reuse the INCR-15 token→Tailwind table** (`docs/senior/wassce-spine-surface-map.md` §0.1) verbatim — do not re-derive.

`font-display` = **Fraunces** (h1, section titles, tile values, card titles, student names, house names, subject row labels, the `<em>` gold italics).
`font-body` = **Manrope** (lede, labels, action prose, button text).
`font-mono` = **JetBrains Mono** (index numbers `0184-0902`, aggregate figures, gap pills, heatmap cell counts, histogram counts, house stat values, programme-segment counts, date stamps).
Empty/missing = em-dash `—` in `text-navy-3`. **Never `0`, never `N/A`.** (Exception: a heatmap cell with a genuine zero count renders `0` — see B.4.)

## 0.2 The A1–F9 grade ramp — REUSE `lib/wassce/grade-colors` (Palette A), with a documented reconciliation

The §2 heatmap paints **one colour per grade column** (see Part B — it is *not* a magnitude heatmap). That is the same semantic axis as the shipped Palette A. The surface's inline hexes **drift** from Palette A:

| Col | Surface class → hex | Palette A (`GRADE_COLORS`) | Verdict |
|---|---|---|---|
| A1 | `.g1` `#1F5A38` (bg text) | `#1E5A35` | ~same — **use Palette A** |
| B2 | `.g2` `var(--green)` `#2F6B47` | `#2F6B47` | **identical** |
| B3 | `.g3` `#5E9272` | `#3D8059` | drift — **use Palette A** |
| C4 | `.g4` `#D4B485` (**navy** text) | `#7C9647` | drift, and the surface's is a *light* fill with dark text | 
| C5 | `.g5` `var(--gold)` `#C8975B` (**navy** text) | `#B59B3D` | drift, light fill |
| C6 | `.g6` `#B07A30` | `#C58A2E` | drift — **use Palette A** |
| D7 | `.g7` `var(--warn)` `#C58A2E` (**surface** text) | `#C58A2E` | **identical hex** |
| E8 | `.g8` `#A77525` | `#A8771F` | ~same — **use Palette A** |
| F9 | `.g9` `var(--terra)` `#B84A39` | `#B84A39` | **identical** |

**Ruling I recommend (per the parent's "REUSE the established A1–F9 band styling"): render the heatmap with `GRADE_COLORS` + `GRADE_CHIP_TEXT`.** One 9-step grade ramp per module, not two. The visible change is the C4/C5 columns going from light-gold-with-navy-text to olive-with-light-text; the credit/below-credit read survives intact. The surface's literal hexes are recorded above so the decision is reversible.

**Do NOT use `HEAT_COLORS`** from the same file. That is INCR-16's *count-driven* 6-step scale (h0–h5, thresholds 0-2/3-5/6-9/10-13/14+). This surface's heatmap is grade-driven, not count-driven. Using it here would be a category error.

## 0.3 Tier ladder — REUSE `TARGET_TIER_BANDS`, NOT `AGGREGATE_BANDS`

Two aggregate ladders already ship and they are **different**:

| Lib | Shape | Labels |
|---|---|---|
| `projection.ts` → `AGGREGATE_BANDS` | **5** bands, 6-12/13-18/19-24/25-36/37-54 | "Top tier" / "Very good" / "Fair" / "Weak" / "No clear path" |
| `university-match.ts` → `TARGET_TIER_BANDS` | **4** tiers, 6-12/13-18/19-24/**25+ (open)** | "Tier 1" … "Tier 4" |

**This surface uses `TARGET_TIER_BANDS` everywhere** — the histogram legend (`Tier 1 · 6–12`), the programme bars, the house cards (`Tier 1 (6–12)`), and the "in Tier 2 band" tile sub-line. Exact match, including the open-ended `25+`. Bind to it; do not re-derive tier ranges and do not mix in `AGGREGATE_BANDS` labels.

## 0.4 Programme track colours — REUSE `PROGRAMME_TRACKS` (`lib/wassce/constants.ts`)

The §3 `.prog-pill` classes map 1:1 onto the shipped constant, **including** the bespoke General-Arts purple and its explicit `rgba()` pill tint:

| Surface class | Surface value | `PROGRAMME_TRACKS` key |
|---|---|---|
| `.prog-pill.sci` | `bg var(--terra-bg)` / `color var(--terra)` | `GENERAL_SCIENCE` → `pillBgClass: "bg-terra-bg text-terra"` |
| `.prog-pill.bus` | `bg var(--gold-bg)` / `color var(--gold)` | `BUSINESS` → `"bg-gold-bg text-gold"` |
| `.prog-pill.ga` | `bg rgba(123,74,138,0.12)` / `color #7B4A8A` | `GENERAL_ARTS` → `pillBgStyle: "rgba(123,74,138,0.12)"`, `color: "#7B4A8A"` |
| `.prog-pill.he` | `bg var(--green-bg)` / `color var(--green)` | `HOME_ECONOMICS` → `"bg-green-bg text-green"` |

Short labels also match: `Science` / `Business` / `Gen. Arts` / `Home Ec.` = `shortLabel`. **Zero new constants needed.**

⚠️ The **house** colours (§4) are the *same four hexes* (terra / gold / green / `#7B4A8A`) but they are **not** programme colours — they are per-House data. See D.2.

## 0.5 No-alpha discipline — EVERY translucency on this surface

Repo memory `no-alpha-token-opacity`: Tailwind slash-opacity on a raw-hex token (`bg-gold/8`, `text-bg/70`) **silently renders nothing**. Verify in the **live preview**, never the build. Port each to an arbitrary `rgba()` or an `opacity-N` utility.

| # | Element (section) | Raw value | Port to |
|---|---|---|---|
| 1 | `.nav-item` colour (all) | `rgba(250,247,242,0.7)` | `text-[rgba(250,247,242,0.7)]` — or reuse INCR-15 §0.2 sidebar ports verbatim |
| 2 | `.nav-item.active` bg (all) | `rgba(200,151,91,0.08)` | `bg-[rgba(200,151,91,0.08)]` |
| 3 | `.nav-item.sub` colour (all) | `rgba(250,247,242,0.55)` | `text-[rgba(250,247,242,0.55)]` |
| 4 | sidebar `.brand`/`.footer` borders | `rgba(255,255,255,0.08)` | `border-[rgba(255,255,255,0.08)]` |
| 5 | `.powered-by` colour | `rgba(200,151,91,0.55)` | `text-[rgba(200,151,91,0.55)]` |
| 6 | `.live-banner::before` orb (§1) | `rgba(200,151,91,0.07)` | decorative — `bg-[rgba(200,151,91,0.07)]` or drop |
| 7 | `.desktop` shadow (doc chrome) | `rgba(26,43,71,0.25)` | **do not build** (editorial chrome) |
| 8 | **`.risk-list tr:hover td` (§3)** | `rgba(245,235,220,0.18)` | `hover:bg-[rgba(245,235,220,0.18)]` — **NOT `hover:bg-gold-bg/18`** |
| 9 | **`.risk-list tr.terra-row` (§3)** | `rgba(245,225,220,0.16)` | `bg-[rgba(245,225,220,0.16)]` — **NOT `bg-terra-bg/16`**. This is the Y. Aidoo medical-row tint; it is load-bearing. |
| 10 | `.filter-pill .ct` bg (§3) | `rgba(200,151,91,0.18)` | `bg-[rgba(200,151,91,0.18)]` |
| 11 | `.filter-pill.active .ct` bg (§3) | `rgba(200,151,91,0.2)` | `bg-[rgba(200,151,91,0.2)]` |
| 12 | `.xmod-card::before` orb (§4) | `rgba(200,151,91,0.06)` | decorative — arbitrary rgba or drop |
| 13 | `.nav-item .ic` (all) | `opacity:0.8` | `opacity-80` |
| 14 | `.browser-bar` dots/url | `rgba(255,255,255,0.18)` / `0.08)` | **do not build** (editorial chrome) |

**Heatmap band tints: there are none.** Every §2 cell fill is a **solid** hex (`#1F5A38`, `var(--green)`, `#5E9272`, …). No alpha anywhere in the heatmap — the no-alpha trap does not apply there, and it must stay that way after the Palette-A reconciliation (Palette A is also all-solid). Flagged because the parent asked specifically.

**Gradients (all solid-stop, safe):**
- `.s-tile.flag` `linear-gradient(135deg, var(--warn-bg) 0%, var(--surface) 100%)`; `.ok` uses `--green-bg`; `.terra` uses `--terra-bg`
- `.live-banner` / `.xmod-card` `linear-gradient(135deg, var(--navy) 0%, var(--navy-2) 100%)`

## 0.6 In-app chrome (build once; reuse across all four sections)

The outer editorial `.page-header` / `.section` / `.section-head` / `.section-num` / `.section-meta` / `.gold-rule` / `.mvp-tag` and the right-rail `.notes` panel are **design-doc chrome — DO NOT BUILD.** Build the `.app-shell` interior only.

**Sidebar** (identical in all four frames). 10 top-level items → **flat nav is correct** (under the 12-item threshold), with one nested sub-group under the active WASSCE item:

```
[A] Asankrangwa SHS / Semester 2 · Week 2
Dashboard · Students · Classes & courses · Attendance · Boarding · Sickbay
WASSCE (active)
    ↳ Setup
    ↳ Cohort readiness (active)
    ↳ Student reports
    ↳ Subject view
    ↳ Live exam tracker
Discipline · Communications · Reports
footer: [CO] C. Owusu-Ansah / Head of Academics
Powered by *Omnischools*
```

**Route mapping — one sub-item has no target:**

| Sub-item | Real route | Status |
|---|---|---|
| Setup | `/senior/wassce/setup` | ✅ shipped |
| **Cohort readiness** | `/senior/wassce/cohort` | 🆕 **THIS INCREMENT** |
| Student reports | `/senior/wassce/candidates/[index]` | ✅ shipped |
| Subject view | `/senior/wassce/subject` | ✅ shipped |
| Live exam tracker | — | 🔴 **no route, no increment.** Render disabled/omitted; do not link to 404. See H.10. |

*(The mock-config route `/senior/wassce/mocks` has no sub-item on this surface. **The real Senior app nav wins where it differs** — this map only asserts the new `cohort` entry. Reconcile against the INCR-17 map's grouped sidebar at build time.)*

**`.page-head`** (`bg-surface border-b border-border`, `padding 24px 36px 22px`): `.crumb` (11px, `0.12em` tracking, uppercase, `text-navy-3` 600; links `text-gold no-underline`) → `.top-row` (flex, `justify-between`, `align-items:end`) → left `<h1>` (Fraunces 28px/500, `-0.018em`, gold italic `<em>`) + `.lede` (13px `text-navy-3`, `max-w-[760px]`, `<b>` → `text-navy-2` 600) / right `.actions`.

**`.btn` families:** `.btn` = `border-border-2 bg-surface text-navy 12px/600 px-[14px] py-[9px] rounded-md`; `.btn.primary` = `bg-navy text-bg border-navy 700`; `.btn.gold` = `bg-gold text-navy border-gold 700` *(gold variant is defined but unused on this surface — reserved for Part E)*.

**`.body`** = `padding 28px 36px 60px`. **`.card`** = `bg-surface border-border rounded-xl overflow-hidden mb-[18px]`; `.card-head` = `p-[14px_20px_12px] border-b border-border flex justify-between items-baseline`, `.ch-title` Fraunces 16px/600 + gold italic `<em>`, `.ch-meta` 10px/600 `text-navy-3` `0.06em`; `.card-body` = `p-[18px_20px_20px]`.

URLs (cosmetic browser-bar only): `…/wassce/cohort-readiness` (§1) · `/subjects` (§2) · `/risk-list` (§3) · `/houses` (§4).

## 0.7 Responsive — one breakpoint, `max-width:1280px`

| Rule | Change |
|---|---|
| `.col-2`, `.col-2.even` | 2-col → `1fr` |
| `.summary-strip` | `repeat(5,1fr)` → `repeat(2,1fr)` |
| `.house-grid` | `repeat(4,1fr)` → `repeat(2,1fr)` |
| `.xmod-strip` | `repeat(3,1fr)` → `1fr` |
| `.live-banner` | `auto 1fr auto` → `1fr` (icon/text/CTA stack) |
| **`.heatmap`** | `130px repeat(9,1fr)` → `100px repeat(9,1fr)`, `font-size 10px → 9px` |
| `.layout` | doc chrome — do not build |

**No PWA variant.** This is a desktop HoA analysis surface; there is no offline/PWA treatment in the source and none should be invented. The `.risk-list` table needs a horizontal scroll container below ~900px (the source does not specify one — **NEW**, flag as an accessibility addition, not a replication).

---

# PART A — §1 Cohort at a glance

**Surface lines 271–472.** Editorial head (do-not-build): `01 · The cohort at a glance · 240 candidates · Head of Academics · all F3`.

## A.1 Page-head

| Element | Exact copy | Token / binding |
|---|---|---|
| Crumb | `WASSCE` (gold link) ` · ` `Cohort readiness` | `text-navy-3` |
| `<h1>` | `Cohort ` + `<em>readiness</em>` + ` · F3 2025/26.` | Fraunces 28px/500; the `F3 2025/26` = `wassce_cohort.name`/`exam_year` |
| `.lede` | `<b>Mock 2 projection frozen.</b> Updates with live results in August. Today's overlay shows who's sitting, who's exempted, where the risk concentrates. <b>Mrs C. Owusu-Ansah · 14 May 2026 · 14:45 GMT</b>` | "Mock 2 projection frozen" ← the predictor mock's `marking_complete_at IS NOT NULL`. Name/time = current user + render time. ⚠️ "Updates with live results in August" is **static editorial** (`wassce_results` is deferred entirely — see H.11). |
| Action 1 | `Distribution chart` | READ · view toggle (this is the default view — render `active`) |
| Action 2 | `Risk list` | READ · nav → §3 |
| Action 3 | `Export · GES district` | 🔴 **WRITE-ish / no target.** See H.9. |

## A.2 Live banner (`.live-banner`)

Grid `auto 1fr auto`, navy→navy-2 gradient, `rounded-xl p-[16px_22px]`.

| Element | Exact copy | Binding |
|---|---|---|
| `.lb-dot` | `W` | static; 44px `rounded-xl bg-gold text-navy` Fraunces 18px/600 |
| `.lb-dot .pulse` | — | 12px terra dot, `border 2px var(--navy)`, top/right `-3px`. **Render only when an anomaly exists** (≥1 exempted/absent sitting today); otherwise omit. |
| `.lb-title` | `WASSCE 2026 · ` `<em>Day 2</em>` ` · 239 of 240 in centre` | `WASSCE {exam_year}` · `Day {N}` = day index of today within the cohort's paper window (`min(wassce_papers.scheduled_date)` → today) · `{sat} of {total}` from `wassce_paper_sittings` for today's papers |
| `.lb-sub` | `English Language Paper 2 (Essay) wrapped <b>12:00</b> · Paper 1 (Objective) <b>14:00–15:00 underway</b>. <b>Y. Aidoo (Slessor SCI)</b> on medical exemption · SC-12 filed · awaiting hospital discharge. No other anomalies.` | Paper names/times ← `wassce_papers.name` + `scheduled_time` + `duration_minutes`. `wrapped`/`underway` derived from now vs the window. Exemption name ← the sitting with `exempted_at IS NOT NULL` + `houses.name` + programme short label. `SC-12 filed` ← `waec_special_consideration.sc_form` + `status`. 🔴 **`awaiting hospital discharge` has no binding** — see H.12. `No other anomalies` renders when the anomaly count is exactly 1. |
| `.lb-cta button` | `Open live tracker` | 🔴 **no route** — see H.10. `bg-gold text-navy 11px/700 rounded-md` |

**Banner states:**
- **Before the exam window** (today < first paper): hide the banner entirely, or render `WASSCE {year} · opens {date}`. **NEW COPY — flag.**
- **After the window**: hide. The lede's "Updates with live results in August" covers the gap.
- **Zero anomalies**: drop the pulse dot; `.lb-sub` ends after the paper clause; **do not** render "No other anomalies" (it reads wrong with nothing preceding it). **NEW state — flag.**
- **>1 anomaly**: the copy's `No other anomalies` must become a count. **NEW COPY — flag.**

## A.3 Summary strip (`.summary-strip`, 5 tiles)

`.s-tile` = `bg-surface border-border rounded-[10px] p-[14px_16px]`. `.st-lbl` 9px/700 uppercase `0.16em` `text-navy-3` · `.st-val` Fraunces 28px/500 `-0.02em` (`<em>` = gold italic; `.unit` = Manrope 12px `text-navy-3` 500, `ml-[5px]`, upright) · `.st-sub` 10px `text-navy-3` (`<b>` → `text-navy-2` 700).

| # | Variant | Label | Value | Sub | Binding |
|---|---|---|---|---|---|
| 1 | `.ok` (green grad + `text-green` value) | `Sitting today` | `239` + `.unit` `/ 240` | `<b>99.6%</b> · 1 medical exemption` | sittings today; `99.6%` = `sat/total` to 1dp; sub pluralises on the exemption count |
| 2 | *(plain)* | `Mock 2 median agg.` | `<em>18</em>` (gold italic) | `Mean <b>18.7</b> · in Tier 2 band` | median + mean of the cohort's projected aggregates (1dp mean); band ← `TARGET_TIER_BANDS` for the **median** |
| 3 | `.ok` | `Credit-pass rate` | `94` + `.unit` `%` | `<b>225 of 240</b> have all-credit Mock 2` | count of candidates whose **every registered subject's** effective grade `isCredit`; 225/240 → 94 |
| 4 | `.flag` (warn grad + `text-warn`) | `At-risk · target` | `28` | `Projected agg. above target cut-off` | the §3 at-risk count. ⚠️ the sub-copy describes **only clause 1** of a 3-clause rule — see C.5 |
| 5 | `.terra` (terra grad + `text-terra`) | `No tertiary path` | `4` | `Dean exit-planning conversations` | candidates with **zero** `university_targets` rows. ⚠️ the sub-copy names a workflow with no table — see H.3 |

**Tile states:** loading → skeleton at tile height (do **not** render `0`). Not-computable cohort-wide (no predictor mock, or marking incomplete) → tiles 2/3/4 render `—` with sub `Projection pending · marking incomplete`. **NEW COPY — flag.** See Part F.

## A.4 Histogram card — `Projected <em>aggregate</em> distribution · Mock 2` / meta `240 candidates · binned by aggregate point`

`.histogram` = flex, `height 200px`, `gap 6px`, `align-items:flex-end`, `border-b border-border`. Per `.h-bar`: `.h-count` (JetBrains Mono 10px/700 `text-navy`) above `.h-rect` (`rounded-t`, `min-height 4px`).

**20 bins. The source's bin labels are broken — fix them.**

| Bin index | Axis label (source) | Count | `.h-rect` class | Tier |
|---|---|---|---|---|
| 1–6 | `7` `8` `9` `10` `11` `12` | 2, 5, 8, 9, 11, 14 | `.t1` `var(--green)` | Tier 1 |
| 7–12 | `13` `14` `15` `16` `17` `18` | 17, 19, 21, 17, 16, 14 | `.t2` `var(--gold)` | Tier 2 |
| 13–18 | `19` `20` `21` `22` `23` `24` | 16, 15, 13, 12, 10, 8 | `.t3` `var(--warn)` | Tier 3 |
| 19 | **`25+`** | 7 | `.t4` `var(--terra)` | Tier 4 |
| 20 | **`28+`** | 6 | `.t4` `var(--terra)` | Tier 4 |

Counts sum to **240** ✓ and reconcile exactly to the legend (49/104/74/13) ✓ and to the §4 house tiers ✓ — the demo data is internally consistent.

🔴 **Two label bugs to fix, not port:**
1. **`25+` and `28+` overlap.** Given the bins sum correctly, bin 19 semantically covers **25–27** and bin 20 covers **28–54**. Render **`25–27`** and **`28+`**.
2. **The axis starts at `7`, but the aggregate floor is 6** (`AGGREGATE_MIN`). Tier 1 counts (49) reconcile only if aggregate-6 is folded into bin 1. Render bin 1 as **`6–7`**, or add a true `6` bin and let it be 0. Recommend `6–7` (preserves the 20-bin layout and the 49 total).

**`.h-rect` heights: compute, do not port.** The inline `style="height:N%"` values are hand-tuned (`count × ~2.857`, i.e. max-count 21 → 60%, with the 2-count bar fudged from 5.7% up to 8%). Render `height = count / maxCount * 100` of the 200px track; the CSS `min-height:4px` already guarantees a visible non-zero bar. *(Same precedent as `aggregateScalePct` replacing the university surface's hand-tuned `left:` values.)*

**`.h-legend`** (flex, `gap 18px`, `border-t border-border pt-[14px] mt-[14px]`, 11px, `.dot` 10px `rounded-[3px]`) — exact copy:

| Dot | Copy |
|---|---|
| `var(--green)` | `<b>Tier 1 · 6–12</b> · 49 students` |
| `var(--gold)` | `<b>Tier 2 · 13–18</b> · 104 students` |
| `var(--warn)` | `<b>Tier 3 · 19–24</b> · 74 students` |
| `var(--terra)` | `<b>Tier 4 · 25+</b> · 13 students` |

Labels + ranges ← `TARGET_TIER_BANDS` (`name` + `range`); counts derived.

**Benchmark callout** (`mt-[14px] p-[11px_14px] bg-gold-bg rounded-lg border-l-[3px] border-gold` 11px `text-navy-2`):

> `<b>Asankrangwa Mock 2 median (18)</b> sits below Western Region Mock 2 median (20) · slightly above national Mock 2 median (17). The school over-indexes on Tier 2 (43% vs Western 38%) and under-indexes on Tier 4 (5.4% vs Western 12%).`

Own figures check out (104/240 = 43.3% → 43; 13/240 = 5.4%). 🔴 **The four external figures have no binding** — see **H.7**. This callout is the single largest data gap on the surface.

## A.5 Programme breakdown card — `By <em>programme</em>` / meta `Tier distribution per programme`

`.prog-break` = grid `80px 1fr`, `gap 18px`, `py-[11px]`, `border-b border-border` (last: none).
`.pb-name` Fraunces 14px/600 + `.pb-count` (block, 10px, Manrope 500, `text-navy-3`, `mt-[2px]`).
`.pb-bar` = flex, `h-[24px] rounded-md overflow-hidden bg-bg`; `.pb-seg` = JetBrains Mono 9px/700, centred, `text-bg` — **except `.t2` (gold) which uses `text-navy`** (contrast).

| Programme | `.pb-count` | T1 | T2 | T3 | T4 | Σ |
|---|---|---|---|---|---|---|
| `Science` | `60 students` | 18 (30%) | 27 (45%) | 12 (20%) | 3 (5%) | 60 ✓ |
| `Business` | `60 students` | 11 (18%) | 28 (47%) | 16 (27%) | 5 (8%) | 60 ✓ |
| `Gen. Arts` | `80 students` | 14 (17%) | 34 (42%) | 28 (35%) | 4 (6%) | 80 ✓ |
| `Home Ec.` | `40 students` | 6 (15%) | 15 (38%) | 18 (45%) | 1 (2%) | 40 ✓ |

Column totals = 49/104/74/13 ✓ — reconciles to the histogram legend exactly.

**Segment widths: compute** (`count/programmeTotal*100`), do not port. The source's inline widths are these percentages with per-row rounding fudged to sum 100 (Gen. Arts T4 is written `6%` where `4/80 = 5%`).

Names ← `PROGRAMME_TRACKS[key].shortLabel`; row order ← `PROGRAMME_ORDER`.

**Insight callout** (`mt-[14px] p-[11px_14px] bg-bg rounded-lg` 11px `text-navy-2`):

> `<b>Science is the strongest programme</b> by Mock 2 distribution (30% Tier 1 vs school 20%). <b>Home Ec is the weakest cohort</b> in tier mix but the programme prepares students for vocational pathways where aggregate is less determinative.`

Both percentages are derivable (18/60 = 30%; 49/240 = 20.4% → 20). The *sentence structure* (which programme is "strongest"/"weakest", and the vocational-pathways clause) is **editorial**. Recommend: static template with the two figures injected, and the strongest/weakest programme names selected by Tier-1 share. The vocational clause stays literal static copy. **Flag the templating as a NEW derivation.**

## A.6 §1 state matrix

| State | Treatment |
|---|---|
| Loading | Tile + card skeletons at final height; no layout shift. |
| No predictor mock for the cohort | Histogram + programme card replaced by an empty card: `No predictor mock yet — projection pending.` (**reuses the shipped INCR-16 string** `"no predictor mock yet — predicted grade pending"` — keep the vocabulary aligned). Tiles 2/3/4 → `—`. |
| Predictor exists, `marking_complete_at IS NULL` | **Render the distribution**, but stamp the card meta `{N} of 240 candidates · marking in progress` and change the lede's `<b>Mock 2 projection frozen.</b>` → `<b>Mock 2 marking in progress.</b>`. Candidates whose projection is **not computable** are **excluded from the histogram and from the median/mean**, and the excluded count is stated. **NEVER a partial number** (INCR-17 Decision 12). **NEW COPY — flag.** |
| Zero candidates | Whole body → single empty card: `No candidates registered for this cohort.` **NEW COPY — flag.** |
| Error | Card-level error, `bg-terra-bg border-l-[3px] border-terra`, retry action. Do not blank the page. |

---

# PART B — §2 Subject heatmap

**Surface lines 474–738.** Editorial head (do-not-build): `02 · Subject heatmap · where the cohort is weak · Mock 2 · 240 candidates × subjects sat`.

## B.1 Page-head

| Element | Exact copy | Type |
|---|---|---|
| Crumb | `WASSCE` · `Cohort readiness` · `Subject heatmap` | READ |
| `<h1>` | `Subject ` + `<em>heatmap.</em>` | — |
| `.lede` | `Each row is a WASSCE subject. Each cell is the count of students who scored at that grade in Mock 2. <b>Green = credit pass concentrations (A1–C6); red = below-credit concentrations (D7–F9).</b> Highlights cohort-wide weaknesses before each paper arrives.` | — |
| Action 1 | `By programme` | READ · regroup toggle |
| Action 2 | `By teacher` | READ · regroup toggle. ⚠️ requires the fragile `subjects.name ↔ wassce_subjects.name` seam (Dex FORWARD-1) — see I.4 |
| Action 3 | `Export · staff brief` | 🔴 no target — H.9 |

## B.2 🔑 What a heatmap cell encodes — **the colour is the GRADE, not the count**

This is the single most misread element on the surface. Reading the markup: in **every** row the class sequence is `g1 g2 g3 g4 g5 g6 g7 g8 g9` in column order, regardless of the counts inside. English `g1=12 … g9=1`; Math `g1=8 … g9=4`; Social Studies `g9=0` still carries `.g9` terra.

**Therefore:**
- **Cell colour = the column's grade band.** Constant down each column. It is a *grade gradient table*, not a magnitude heatmap.
- **Cell content = the count** of candidates at that grade in that subject (JetBrains Mono 10px/700, centred).
- **There are no count thresholds and no band tints on this surface.** The parent's question "which tokens/tints does each band use" resolves to: nine solid per-grade fills, table 0.2 above, zero alpha.

The "heat" the eye reads is the *distribution of the numbers across the coloured columns* — a row whose big numbers sit in the terra columns is a weak subject. The lede states exactly this (`Green = credit pass concentrations (A1–C6); red = below-credit concentrations (D7–F9)`) and the `.notes` panel confirms it: *"The colour gradient encodes pass-band intuition without needing a legend."*

**Do not** substitute a value-driven scale (`HEAT_COLORS`). It would destroy the design.

## B.3 Grid + header

`.heatmap` = grid `130px repeat(9, 1fr)`, `gap 3px`, 10px base.
`.hm-cell` = `p-[8px_6px] text-center` JetBrains Mono 700 `rounded-[3px]`.
`.hm-head` = `bg-bg text-navy-3` 9px uppercase `0.08em` — first cell empty, then `A1 B2 B3 C4 C5 C6 D7 E8 F9` (← `WASSCE_GRADES`).
`.hm-row-lbl` = `bg-bg text-navy` **Fraunces** 11px/600, `text-left pl-[12px]` (the one non-mono cell).

Card: `Mock 2 · <em>grade × subject</em> distribution` / meta `Numbers = students at each grade`.

## B.4 Rows — exact labels + counts (source demo data)

| Row label (exact) | A1 | B2 | B3 | C4 | C5 | C6 | D7 | E8 | F9 | Σ | Below-credit |
|---|--|--|--|--|--|--|--|--|--|--|--|
| `English Lang.` | 12 | 28 | 62 | 58 | 44 | 22 | 10 | 3 | 1 | 240 | 14 |
| `Math (Core)` | 8 | 18 | 34 | 48 | 50 | 38 | 28 | 12 | 4 | 240 | **44** |
| `Int. Science` | 14 | 32 | 58 | 52 | 42 | 28 | 10 | 3 | 1 | 240 | 14 |
| `Social Studies` | 18 | 34 | 68 | 62 | 38 | 14 | 5 | 1 | **0** | 240 | 6 |
| `Chemistry` | 4 | 8 | 9 | 12 | 10 | 8 | 5 | 3 | 1 | 60 | 9 |
| `Physics` | 3 | 6 | 9 | 11 | 12 | 10 | 6 | 2 | 1 | 60 | 9 |
| `Biology` | 5 | 10 | 12 | 13 | 10 | 7 | 2 | 1 | 0 | 60 | 3 |
| `Elective Math` | 2 | 4 | 8 | 11 | 14 | 12 | 18 | 12 | 5 | **86** | **35** |
| `F. Accounting` | 3 | 8 | 12 | 14 | 12 | 8 | 3 | 0 | 0 | 60 | 3 |
| `Business Mgt.` | 4 | 10 | 14 | 16 | 10 | 5 | 1 | 0 | 0 | 60 | 1 |
| `Economics` | 6 | 14 | 22 | 28 | 24 | 18 | 8 | 2 | 0 | 122 | 10 |
| `Literature` | 8 | 16 | 22 | 14 | 10 | 6 | 2 | 2 | 0 | 80 | 4 |
| `Geography` | 6 | 12 | 18 | 18 | 12 | 8 | 4 | 2 | 0 | 80 | 6 |
| `Government` | 10 | 14 | 20 | 16 | 10 | 8 | 2 | 0 | 0 | 80 | 6 |
| `French` | 1 | 2 | 3 | 4 | 6 | 5 | 8 | 5 | 2 | 36 | 15 |

**Zero cells render `0`, not an em-dash** (Social Studies F9, Biology F9, etc.) — the count is a real measured zero and the coloured cell carries the meaning. This is the documented exception to the §0.1 em-dash rule.

🔴 **Do not hard-code 15 rows.** The four cores total 240 ✓ (whole cohort), the programme electives total their cohorts ✓ — but **every Home Ec elective is missing** (Food & Nutrition, Management in Living, Clothing & Textiles — the 40 Home-Ec students appear in no elective row). Bind rows to `wassce_subjects WHERE active_flag` that have ≥1 `mock_results` row on the predictor mock, ordered cores-first then electives by programme. The live surface will render more than 15 rows. See H.13.

## B.5 Concern / watch cards

`mt-[18px]` grid `repeat(3, 1fr)` gap 12px. Each `p-[11px_14px] rounded-lg border-l-[3px]` 11px `text-navy-2`.

| # | Tint | Exact copy |
|---|---|---|
| 1 | `bg-terra-bg` / `border-terra` | `<b>Concern subject 1 · Elective Math.</b> 35 students (33%) below credit · 5 F9s. Largest below-credit concentration of any single subject. Mr Bediako's elective math team needs intervention plan for the 35 affected before the Jun 3 paper.` |
| 2 | `bg-terra-bg` / `border-terra` | `<b>Concern subject 2 · French.</b> 15 of 36 French students (42%) below credit · 2 F9s. Asankrangwa has no L1 French teacher; current part-time staffing has been the gap for 2 years. HOD Languages co-signed.` |
| 3 | `bg-warn-bg` / `border-warn` | `<b>Watch subject · Math (Core).</b> 44 below credit (18%) · cohort-wide weakness familiar to every Ghanaian SHS. Six remedial slots running Wed/Sat afternoons through May. Paper is Jun 3 — there's time.` |

**Arithmetic audit — card 1 is wrong twice; cards 2 and 3 are correct:**
- Card 2: 8+5+2 = 15 below credit of 36 ✓; 15/36 = 41.7% → 42% ✓; F9 = 2 ✓.
- Card 3: 28+12+4 = 44 ✓; 44/240 = 18.3% → 18% ✓.
- Card 1: 18+12+5 = 35 ✓ and F9 = 5 ✓, but **`(33%)` is wrong** — 35/86 = **40.7%**. And **"Largest below-credit concentration of any single subject" is false by count** (Math Core's 44 > 35); it is only true as a *share* (40.7% > 18.3%).

**Ruling: compute both figures, don't port them.** Render `{n} students ({share}%) below credit · {f9} F9s` where `share = n / subjectEntrants`. Re-word the superlative to what the data supports — **`Largest below-credit share of any single subject.`** **NEW COPY (one word changed) — flag.**

**Selection rule the surface implies:** rank subjects by below-credit **share**; the top 2 become "Concern subject 1/2" (terra) and the next becomes "Watch subject" (warn). Check against the data: French 41.7%, Elective Math 40.7%, Math Core 18.3%, Physics 15.0%, Chemistry 15.0% — which would order **French first, Elective Math second**, whereas the surface shows Elective Math as Concern 1. The demo ordering is by raw count among the top-share subjects (35 > 15). 🟠 **Kofi ruling needed** on the exact selection + ordering rule and the concern/watch threshold. See H.14. The trailing prose in every card ("Mr Bediako's elective math team…", "no L1 French teacher…", "Six remedial slots…") is **pure editorial with no binding** — see H.15.

## B.6 §2 state matrix

| State | Treatment |
|---|---|
| Loading | Grid skeleton, header row rendered, cells shimmering. |
| No predictor mock | Empty card: `No predictor mock yet — heatmap pending.` **NEW COPY.** |
| Marking incomplete | Render the grid over graded results only; card meta becomes `Numbers = students at each grade · {n} of {total} results entered`. **NEW COPY.** |
| A subject with zero results | Omit the row entirely (do not render nine `0`s). |
| Fewer than 3 subjects qualify for concern/watch | Render only the cards that qualify; the grid collapses to 1–2 columns. **NEW state.** |
| No concern/watch subjects at all | Omit the card strip entirely. **NEW state.** |

---

# PART C — §3 At-risk list

**Surface lines 740–993.** Editorial head (do-not-build): `03 · At-risk list · 28 students above target cut-off · Dean Mensa-Ofori + Form Masters · individual interviews`.

## C.1 Page-head

| Element | Exact copy | Type |
|---|---|---|
| Crumb | `WASSCE` · `Cohort readiness` · `At-risk` | READ |
| `<h1>` | `The ` + `<em>28</em>` + ` at-risk students.` | count injected |
| `.lede` | `<b>Projected aggregate higher than their lowest tagged target's cut-off.</b> These are the candidates whose Mock 2 result says "your safety school isn't actually safe". The Dean and the Form Master have done at least one interview per student. Some progressed; some need a second conversation. Sorted by gap size.` | ⚠️ describes only clause 1 of 3 — C.5 |
| Action 1 | `By Form Master` | READ · regroup |
| Action 2 | `Parent SMS log` | 🔴 no binding — H.5 |
| Action 3 | `Dean's worklist` (`.primary`) | 🔴 no binding — H.5 |

## C.2 Filter strip (`.filter-strip`)

`.fs-lbl` 10px/700 uppercase `0.14em` `text-navy-3`. `.filter-pill` = `bg-surface border-border-2 rounded-full p-[6px_12px]` 11px/600 `text-navy-2`; `.active` = `bg-navy text-bg border-navy`. `.ct` = count chip, `rgba(200,151,91,0.18)` bg / `text-gold`, JetBrains Mono 10px, `rounded-full ml-[5px]`; on `.active` → `rgba(200,151,91,0.2)` / `text-gold-soft`.

| Group | Pills (exact copy + count) | Binding |
|---|---|---|
| `Show` | `At-risk · all` **28** (active) · `Tier 1 stretch` **9** · `Tier 2 stretch` **12** · `No target tagged` **4** · `Followup pending` **8** | ✅ all · ✅ tier of the candidate's projection × at-risk · ✅ zero `university_targets` (matches tile 5) · 🔴 **`Followup pending` has no binding** — H.4 |
| `Sort` | `Gap size · descending` (active) · `Programme` · `Last interview` | ✅ gap · ✅ programme · 🔴 **`Last interview` has no binding** — H.2 |

⚠️ `Tier 1 stretch` 9 + `Tier 2 stretch` 12 + `No target tagged` 4 = 25, not 28. The remaining 3 are Tier-3/4 at-risk rows with no pill. **Not a bug** — the pills are a partial filter set, not a partition. Do not "fix" it into a partition.

## C.3 The table (`.risk-list`)

Card: `Sorted by <em>gap</em> · projected aggregate vs lowest target cut-off` / meta `28 candidates · Mock 2 source`. `.card-body` has `padding:0` (the table is flush).

`th` = `bg-bg p-[10px_12px]` 9px/700 uppercase `0.14em` `text-navy-3` left, `border-b border-border-2`; `.r` right, `.c` centre.
`td` = `p-[10px_12px]` 11.5px `border-b border-border` `text-navy-2`, `align-middle`; last row no border.

**Columns:** `Candidate` · `Programme` · `Mock 2` (right) · `Lowest target` · `Gap` (centre) · `Last action` · `Next` (centre)

### Cell anatomy

| Part | Class | Style | Binding |
|---|---|---|---|
| Avatar | `.st-av` | 30px circle, `bg-gold-soft text-navy` Fraunces 10px/600. Variants `.terra` (`bg-terra-bg text-terra`), `.warn` (`bg-warn-bg text-warn`) | initials. **Variant = severity**, see C.4 |
| Name | `.st-name` | Fraunces 12px/600 | `students.name` abbreviated `J. Anokye` |
| Meta | `.st-meta` | JetBrains Mono 9px `text-navy-3` | `F3 {PROG} · {index_number}` — programme code `GA`/`HE`/`BUS`/`SCI` |
| Programme | `.prog-pill.{sci\|bus\|ga\|he}` | 9px/700 uppercase `0.08em` `rounded-full p-[3px_7px]` | `PROGRAMME_TRACKS[key].shortLabel` (§0.4) |
| Mock 2 | `.agg-num` + `.tight`/`.warn`/`.ok` | JetBrains Mono 13px/700 | projected aggregate. `.tight` = terra, `.warn` = warn, `.ok` = green |
| Target | `.target` Fraunces 12px/500 + `.t-uni` (block, 10px, Manrope 500, `text-navy-3`) | | `{qualification} {programme} · {shortName}` / `cut-off {n}` |
| Gap | `.gap-pill.{over\|tight\|ok}` | JetBrains Mono 10px/700 `rounded-full p-[3px_8px]`; `over` = `bg-terra-bg text-terra`, `tight` = `bg-warn-bg text-warn`, `ok` = `bg-green-bg text-green` | see C.4 |
| Last action | `.action` 10px `text-navy-3`, `<b>` → `text-navy-2` 600 | | 🔴 **no binding** — H.1 |
| Next | `.stat-pill.{scheduled\|done\|pending}` | 9px/700 uppercase `0.08em rounded-full`; `scheduled` = `bg-gold-bg text-gold`, `done` = `bg-green-bg text-green`, `pending` = `bg-bg text-navy-3 border border-border-2` | 🔴 **no binding** — H.2 |
| Row hover | `tr:hover td` | `bg-[rgba(245,235,220,0.18)]` | §0.5 #8 |
| **Medical row** | `tr.terra-row` | `bg-[rgba(245,225,220,0.16)]` + `td:first-child border-l-[3px] border-terra` | §0.5 #9 |

### The 11 demo rows (exact copy)

| # | Name | Meta | Prog | Mock 2 | Lowest target / cut-off | Gap | Last action | Next |
|---|---|---|---|---|---|---|---|---|
| 1 | `J. Anokye` (av `.terra`) | `F3 GA · 0184-0902` | Gen. Arts | `31` `.tight` | `No target tagged` / `considering deferment` | `no path` `.over` | `<b>Dean call w/ parent</b> · 8 May · agreed exit-planning meeting` | `Wed 21 May` `.scheduled` |
| 2 | `R. Boampong` (`.terra`) | `F3 HE · 0184-0934` | Home Ec. | `28` `.tight` | `B.Sc. Nutrition · UEW` / `cut-off 22` | `+6 over` | `FM interview · 2 May · advised broader target set` | `Sat 17 May` `.scheduled` |
| 3 | `E. Owusu` (`.terra`) | `F3 BUS · 0184-0867` | Business | `27` `.tight` | `B.Sc. Banking · UEW` / `cut-off 21` | `+6 over` | `FM interview · 28 Apr · added Takoradi Tech as safety` | `Resolved` `.done` |
| 4 | `K. Antwi` (`.warn`) | `F3 GA · 0184-0888` | Gen. Arts | `24` `.warn` | `B.A. Sociology · KNUST` / `cut-off 18` | `+6 over` | `<b>Mother declined</b> Dean call · FM follow-up needed` | `Pending` `.pending` |
| 5 | `A. Quartey` (`.warn`) | `F3 GA · 0184-0879` | Gen. Arts | `22` `.warn` | `B.A. Sociology · UCC` / `cut-off 17` | `+5 over` | `<b>Pastoral case</b> · Dean co-monitoring · VLC flag active` | `Thu 22 May` `.scheduled` |
| 6 | `P. Donkor` (`.warn`) | `F3 HE · 0184-0918` | Home Ec. | `21` `.warn` | `B.A. Family & Consumer Sci · UEW` / `cut-off 17` | `+4 over` | `FM interview · 5 May · target widened` | `Resolved` `.done` |
| 7 | `S. Asante` (`.warn`) | `F3 BUS · 0184-0852` | Business | `19` `.warn` | `B.Sc. Acc & Finance · KNUST` / `cut-off 15` | `+4 over` | `FM interview · 25 Apr · added UCC as match target` | `Resolved` `.done` |
| 8 | `A. Mensah` (`.warn`) | `F3 SCI · 0184-0810` | Science | `18` `.warn` | `B.Sc. Civil Eng · KNUST` / `cut-off 13` | `+5 over` | `FM interview · 1 May · UCC eng as match` | `Resolved` `.done` |
| 9 | `F. Boakye` (`.warn`) | `F3 BUS · 0184-0841` | Business | `16` `.warn` | `B.A. Bus Admin · Legon` / `cut-off 14` | `+2 tight` | `FM interview · 30 Apr · UCC added as match` | `Resolved` `.done` |
| 10 | **`Y. Aidoo`** (`.terra`) — **`tr.terra-row`** | `F3 SCI · 0184-0817` | Science | `10` **`.ok`** | `B.Sc. Biochemistry · KNUST` / `cut-off 11` | **`−1 within` `.ok`** | `<b>Medical · inpatient</b> · WAEC SC-12 filed · papers missed` | `Make-up TBD` `.scheduled` |
| 11 | `J. Tetteh` (`.warn`) | `F3 SCI · 0184-0823` | Science | `14` `.warn` | `B.Sc. Comp Sci · KNUST` / `cut-off 12` | `+2 tight` | `FM interview · 6 May · alt target Legon CS as match` | `Resolved` `.done` |

**Overflow row** (`colspan=7`, `text-center p-[14px]` `text-navy-3` **italic** 11px):
> `+ 17 more rows · 8 pending Dean follow-up · 9 resolved last week`

🔴 Both trailing clauses depend on H.1/H.2. Bind the `+ N more rows` half; the follow-up/resolved counts are unbindable today.

## C.4 🔑 Gap arithmetic + pill thresholds

**`gap = projectedAggregate − lowestTargetCutOff`.** Verified against all 10 targeted rows: 28−22 = +6 ✓, 27−21 = +6 ✓, 24−18 = +6 ✓, 22−17 = +5 ✓, 21−17 = +4 ✓, 19−15 = +4 ✓, 18−13 = +5 ✓, 16−14 = +2 ✓, 14−12 = +2 ✓, 10−11 = −1 ✓.

⚠️ **This is the NEGATIVE of the shipped `matchMargin` δ** (`δ = cutOff − projected`). Use `matchMargin(projected, cutOff)` and render `direction: "outside"` as `+{points} over`, `"inside"` as `−{points} within`, `"on"` as `0 on`. **Do not add a second sign convention to the codebase.**

**"Lowest target" is a wording trap.** It means the candidate's *least ambitious* target — i.e. the one with the **largest (worst) `cut_off` number**: `MAX(university_programmes.cut_off)` across the candidate's `university_targets`. "Lowest" refers to rank/ambition, not to the numeral. Getting this backwards inverts the whole list.

**Pill thresholds (from observed data):**

| `.gap-pill` | Observed gaps | Implied rule |
|---|---|---|
| `.over` (terra) | +4, +5, +6, and `no path` | `gap ≥ 3` **or** no target tagged |
| `.tight` (warn) | +2 | `gap` in 1…2 |
| `.ok` (green) | −1 | `gap ≤ 0` |

🟠 **`gap = +3` is unobserved** — the boundary is inferred. And this **third vocabulary conflicts with the shipped 5-tier ladder**: `matchBand` puts `gap = +2` (δ = −2) in **STRETCH**, while this surface calls it `tight`. **Kofi ruling needed** — either (a) accept "over/tight/within" as a distinct HoA triage vocabulary layered on `matchMargin` (my recommendation — different audience, different question), or (b) collapse it onto `matchBand`. Do not silently pick one.

**`.agg-num` severity** (colour of the Mock 2 number) tracks the tier of the aggregate itself, not the gap: `31, 28, 27` → `.tight` (terra, Tier 4); `24, 22, 21, 19, 18, 16, 14` → `.warn` (Tier 2/3); `10` → `.ok` (green, Tier 1). Implied rule: **`aggregate ≥ 25` → `.tight`; `13–24` → `.warn`; `≤ 12` → `.ok`** — i.e. `TARGET_TIER_BANDS` with Tier 2+3 sharing warn. Reuse the tier lookup; do not re-threshold.

**`.st-av` variant** matches `.agg-num`: `.terra` for Tier 4, `.warn` for Tier 2/3 — **except Y. Aidoo**, who is Tier 1 (agg 10) yet gets `.terra` because of the medical clause. So: **avatar variant = `.terra` if (Tier 4 OR the medical/external-risk clause fired), else `.warn`.**

## C.5 🔑 What the surface implies the at-risk rule is (for Kofi to ratify)

The lede states one clause. The data shows **three**:

| Clause | Evidence | Count |
|---|---|---|
| **1 · Academic** — `projectedAggregate > MAX(cut_off)` across tagged targets (`gap > 0`) | Rows 2–9, 11. Tile 4 sub-copy `Projected agg. above target cut-off`. `<h1>` `The 28`. | 24 |
| **2 · No path** — the candidate has **zero** `university_targets` rows | Row 1 (J. Anokye): gap pill `no path`, target cell `No target tagged`. Filter pill `No target tagged` **4**. Tile 5 `No tertiary path` **4**. | 4 |
| **3 · External risk** — an open/approved SC filing **or** a missed/exempted live paper, *regardless of projection* | Row 10 (Y. Aidoo): agg 10, gap **−1 within** — comfortably *inside* her cut-off — yet listed, `tr.terra-row`. The `.notes` panel is explicit: *"Y. Aidoo appears here despite being projected within target… not for academics but for **medical disruption**… The system widens 'at-risk' to include external risk factors, not just Mock 2 projection."* | ≥1 |

⚠️ 24 + 4 = 28, and Y. Aidoo is one of the 24 by position — so the demo's `28` does **not** cleanly include clause 3 as an addend. Kofi must decide whether clause-3 rows are additive to the 28 or overlap it.

🟠 **A fourth clause the surface never shows: the not-computable candidate.** INCR-17 established `{computable: false}` → **"projection pending", never a partial number**. Such a candidate has no `gap` at all, so clauses 1 and 3 cannot evaluate. **Kofi must rule:** are they (a) excluded from the list, (b) included as a fourth clause with `projection pending` in the Mock-2 cell and `—` in the gap cell, or (c) surfaced in a separate "cannot assess" strip? **My recommendation: (b)** — a candidate whose marking is incomplete is exactly who the HoA needs to see before the paper, and silently dropping them is the failure mode this rule exists to prevent. Render `.agg-num` → `projection pending` (11px, `text-navy-3`, italic, **not** mono — it is not a number) and `.gap-pill` → em-dash.

## C.6 🔴 The sort contract does not match the demo data

Card head says `Sorted by gap` and the lede says `Sorted by gap size`; the active pill says `Gap size · descending`. **The 11 demo rows are not sorted by gap** — gaps run `no path, +6, +6, +6, +6, +5, +4, +4, +5, +2, −1, +2` (row 8's +5 after row 7's +4 breaks it). They are sorted by **Mock 2 descending** (31, 28, 27, 24, 22, 21, 19, 18, 16) for rows 1–9, with rows 10–11 appended out of order.

**Build the stated contract** (gap descending, `no path` rows pinned first), not the demo ordering. Flag the surface data as illustrative. Secondary sort: Mock 2 descending, then name.

## C.7 Dean's interview cadence card

Card: `<em>Dean's</em> interview cadence` / meta `28 cases · target close-out before WASSCE end`.
Body: `flex-col gap-[9px]` 12px `text-navy-2`; each row `flex justify-between py-[8px] border-b border-border` (last: none), right value `.mono` 700.

| Left (exact) | Right (exact) | Right colour |
|---|---|---|
| `<b>9 resolved</b> · targets widened` | `since 22 Apr` | default navy |
| `<b>11 scheduled</b> · interview booked` | `14–24 May` | default |
| `<b>4 no-target</b> · exit-planning conversations` | `deferment likely` | `text-terra` |
| `<b>4 followup</b> · parents declined` | `FM tertiary` | `text-warn` |

Footer note (`mt-[12px] p-[11px_14px] bg-bg rounded-lg` 11px `text-navy-3`):
> `<b>Target close-out</b>: Dean Mensa-Ofori aims to have every at-risk case resolved (target widened, alternative path agreed, or deferment discussed) <b>before 19 Jun</b>. Cases unresolved at WASSCE end roll into post-results admissions counselling in Aug.`

🔴 **This entire card is unbindable except the `4 no-target` row** (which = tile 5). See **H.3** — it is the largest single block of unbacked UI on the surface.

## C.8 Vocabulary card (100% static — build verbatim)

Card: `Why <em>"resolved"</em> doesn't mean "they passed"` / meta `Vocabulary discipline`. Body 12px `text-navy-2` `leading-[1.6]`.

> ¶1 `<b>Resolved</b> means the school has done its part — the Dean or Form Master has had the conversation, the student understands their position, and a revised target set has been agreed. The student may still not get their first choice in August; the gap between their Mock 2 and their original target may persist.`
>
> ¶2 `The status the academic head tracks isn't <b>"the gap closed"</b> — that depends on what each student does in the next 8 weeks of WASSCE. The status is <b>"the conversation happened"</b>.`
>
> ¶3 *(pull-quote: italic `text-navy-3`, `border-l-[3px] border-gold`, `p-[6px_12px]`, `bg-gold-bg`)* `"A school can't will a student into KNUST Medicine. We can be honest about what's likely, what's possible, and what other paths exist. The honesty is the deliverable; the result is theirs."`
>
> ¶4 *(10px italic `text-navy-3`, `mt-[10px]`)* `— Mrs Owusu-Ansah, faculty briefing, 28 Apr 2026`

**No binding needed.** This is editorial voice and it is the product — port it exactly. Do not paraphrase, do not shorten.

## C.9 §3 state matrix

| State | Treatment |
|---|---|
| Loading | Table skeleton, 6 ghost rows. |
| **Zero at-risk candidates** | Replace the table with an empty state: `No candidate is projected above their lowest target cut-off.` **NEW COPY — flag.** Keep the filter strip (disabled) and the C.8 card. Tile 4 → `0` (a real measured zero — this is the one place `0` beats an em-dash). |
| No `university_targets` seeded at all | Every candidate falls into clause 2 → the list becomes the whole cohort. **Guard this.** Render instead: `No university targets tagged for this cohort — at-risk cannot be assessed.` **NEW COPY — flag.** 🟠 Kofi ruling. |
| Marking incomplete | Per C.5 clause 4. |
| Filter yields zero rows | `No candidates match this filter.` + a `Clear filter` action. **NEW COPY.** |
| Error | Card-level error strip; the C.8 card still renders (it is static). |

---

# PART D — §4 House × programme breakdown

**Surface lines 995–1131.** Editorial head (do-not-build): `04 · House × programme breakdown · Pastoral cross-cut · Housemasters + Form Masters`.

*(Note the editorial voice uses "Pastoral"; per the nav convention, the **user-facing** label is "Student support". This is editorial chrome and is not built, so no conflict.)*

## D.1 Page-head

| Element | Exact copy | Type |
|---|---|---|
| Crumb | `WASSCE` · `Cohort readiness` · `House breakdown` | READ |
| `<h1>` | `By ` + `<em>house.</em>` | — |
| `.lede` | `Each of Asankrangwa's four houses runs across all four programmes — boarding allocation is academic-blind, so each house's WASSCE readiness reflects the mix of students inside it, not any cohort selection effect. The HMs each receive a weekly digest with their house's stats.` | static editorial |
| Action 1 | `Boarding view` | READ · cross-module nav → boarding module |
| Action 2 | `HM digest` (`.primary`) | 🔴 no binding — H.8 |

## D.2 House cards (`.house-grid`, `repeat(4, 1fr)` gap 12px)

`.house-card` = `bg-surface border-border rounded-[10px] p-[14px_16px]` + **`border-top: 3px solid {houseColour}`**.
`.hc-name` Fraunces 14px/600 with the whole name in gold italic `<em>` · `.hc-cohort` 10px `text-navy-3 mb-[10px]` · `.hc-row` = `flex justify-between py-[5px] border-t border-border` (first: none), `.hc-lbl` 10px `text-navy-3`, `.hc-val` JetBrains Mono 700 `text-navy`.

🔑 **The four border-top hexes are `houses.colour` data, NOT constants.** The surface hard-codes `.slessor` terra / `.aggrey` gold / `.kufuor` green / `.busia` `#7B4A8A` — these coincide with the programme-track hexes but are semantically unrelated. Bind `border-top-color` to `houses.colour` via **inline `style`** (the boarding House-hex idiom), with `var(--navy-3)` as the null fallback. **Never** a per-house CSS class, never slash-opacity.

| House | `.hc-cohort` | Median | T1 (6–12) | T2 (13–18) | T3 (19–24) | T4 (25+) | At-risk | Last row |
|---|---|---|---|---|---|---|---|---|
| `Slessor` | `62 F3 students · HM Mr A. Boateng` | 17 | 15 | 26 | 17 | 4 | **8** | `Today · medical` → `1 (Y. Aidoo)` (`text-terra`) |
| `Aggrey` | `58 F3 students · HM Mr D. Tetteh` | 18 | 13 | 27 | 15 | 3 | **6** | `Today · sitting` → `58 / 58` (`text-green`) |
| `Kufuor` | `60 F3 students · HM Mr K. Mensah` | 19 | 11 | 25 | 21 | 3 | **8** | `Today · sitting` → `60 / 60` (`text-green`) |
| `Busia` | `60 F3 students · HM Mrs A. Owusu` | 18 | 10 | 26 | 21 | 3 | **6** | `Today · sitting` → `60 / 60` (`text-green`) |

Row labels verbatim: `Mock 2 median` · `Tier 1 (6–12)` · `Tier 2 (13–18)` · `Tier 3 (19–24)` · `Tier 4 (25+)` · `At-risk count` · `Today · sitting` \| `Today · medical`.

**The at-risk row is styled apart:** `border-top: 1px solid var(--gold)`, `.hc-lbl` → `color: var(--gold)`, `.hc-val` → `color: var(--terra)`. Inline style (per-row override), solid tokens only.

**Arithmetic audit — fully consistent ✓:** cohorts 62+58+60+60 = 240 ✓; each house's tiers sum to its cohort ✓; tier columns sum to 49/104/74/13 ✓ (matches the histogram legend and the programme table exactly); at-risk 8+6+8+6 = 28 ✓; medians 17/18/19/18 span 2 points ✓.

**Bindings:** house name/HM ← `houses.name` + `houses.hm_user_id → users.name`; cohort count ← candidates whose `students.house_id` = the house; median/tiers ← the same projected aggregates as §1, grouped by house; at-risk ← the §3 set grouped by house.

**Last-row conditional:** if the house has ≥1 candidate with an `exempted_at` sitting today → `Today · medical` / `{n} ({names})` in `text-terra`; else `Today · sitting` / `{sat} / {total}` in `text-green`. If **not** during the exam window → omit the row entirely. **NEW state — flag.**

## D.3 House insight callout

(`mt-[18px] p-[12px_14px] bg-bg rounded-lg` 11px `text-navy-2`)

> `<b>House comparison is the gentlest of the cross-cuts.</b> Slessor is slightly stronger (median 17 vs school 18) but the spread is small. The four houses run within 2 aggregate points of each other; the variation is mostly noise around the cohort mean. Useful for the Headmaster's monthly HM meeting where each HM walks through their pastoral readings of their boys/girls; not useful for high-stakes academic comparison.`

The strongest-house name, the two medians, and the "within N aggregate points" span are derivable; the framing is editorial. Same treatment as A.5 — static template, three figures injected. **Flag the templating as NEW.**

## D.4 Cross-module strip (`.xmod-strip`, `repeat(3, 1fr)` gap 14px)

`.xmod-card` = navy→navy-2 gradient, `rounded-[10px] p-[14px_16px]`, decorative `::before` orb `rgba(200,151,91,0.06)`. `.xm-lbl` 9px/700 uppercase `0.16em text-gold` · `.xm-title` Fraunces 14px/500 + gold italic `<em>` · `.xm-body` 11px `text-gold-soft` (`<b>` → `text-bg` 600).

**These are the design-commitment cross-module hooks — preserve all three.**

| `.xm-lbl` | `.xm-title` | `.xm-body` |
|---|---|---|
| `Cross-module · Boarding` | `HM ` `<em>weekly digest</em>` ` auto-sent` | `Every Friday afternoon, each HM gets a one-page digest of their house's WASSCE readiness — tier counts, at-risk names, this week's interview log. Built into the boarding module's HM weekly comms cadence.` |
| `Cross-module · VLC` | `A. Quartey ` `<em>pastoral × academic</em>` | `She appears in the at-risk list with a +5 gap. The Dean's <b>academic</b> interview runs in parallel with the FM's <b>pastoral</b> support. Two threads, same student, both flagged, neither conflated.` |
| `Cross-module · Sickbay` | `Y. Aidoo ` `<em>live link</em>` | `When the matron updates Y. Aidoo's referral status, this dashboard's "1 medical · Slessor" tile updates. Discharge will trigger the make-up paper scheduling workflow.` |

**Binding status:** all three describe **future** wiring. Boarding→HM-digest (H.8) and Sickbay→referral-status (H.12) have no implementation; the VLC card is narrative about row 5. Build them as **static explainer cards** (which is what they are on the surface) — do not attempt live wiring, and do not delete them. They are the documented seams.

## D.5 §4 state matrix

| State | Treatment |
|---|---|
| Loading | 4 card skeletons. |
| School has no houses (day school) | Omit §4 entirely — no empty state. Houses are a boarding-tier concept. |
| A house with 0 F3 candidates | Render the card with `0 F3 students`, all stats `—`. |
| Houses ≠ 4 | `.house-grid` is `repeat(4,1fr)` → make it `repeat(auto-fill, minmax(200px,1fr))` so 3 or 6 houses don't break. **NEW — flag as a replication deviation.** |
| Outside the exam window | Drop the `Today · …` row (D.2). |

---

# PART E — 🔑 Moderation controls + trail — **DESIGNED, NOT REPLICATED**

> ⚠️ **Every copy string in this Part is `NEW COPY`.** No surface draws this. See the blocking finding at the top. Owner/Kofi must approve before build. I have deliberately kept it to the smallest thing that satisfies the R3 schema + the three INCR-16 carry-forwards, and I reuse shipped primitives everywhere rather than authoring a new visual language.

## E.1 What already exists (reuse — do not re-derive)

| Piece | Where | Status |
|---|---|---|
| Schema: `moderated_grade` / `moderator_user_id` / `moderated_at` / `moderation_reason` | `db/schema/wassce.ts:500–504` | ✅ shipped in 0052 |
| Structural trail invariant: `CHECK moderated_grade IS NULL OR (moderator_user_id IS NOT NULL AND moderated_at IS NOT NULL)` | `wassce.ts:519–523` (`mock_results_moderation_trail`) | ✅ shipped — a half-populated moderation is **rejected by the DB** |
| Effective-grade derivation `COALESCE(moderated, teacher)` | `lib/wassce/mock-grades.ts:47` `effectiveGrade()` | ✅ shipped; already consumed by `projectAggregate` (`projection.ts:92`) |
| **The moderated-vs-original visual treatment** | `components/senior/wassce-mock-entry-grid.tsx:154–163` | ✅ shipped |
| Read-only lockout of a moderated cell for the teacher | same file, line 145: `editable = canWrite && !c.locked && (!cell \|\| cell.moderatedGrade == null)` | ✅ shipped |
| Moderator role = `VICE_HEADMASTER_ACADEMIC` | Kofi R3, build-plan:2143 | ✅ ruled |
| **No moderation writer exists yet** | `lib/actions/wassce-mocks.ts:19` — *"The moderation write is DEFERRED to INCR-18 (columns exist; this file never writes moderated_grade)"* | 🔴 **this increment builds it** |

## E.2 🔑 The moderated-vs-original treatment (reuse verbatim)

The original teacher grade is **never overwritten** — structurally (`grade` is a separate NOT NULL column) and visually. The shipped cell renders a **vertical stack**:

```
  ┌────────────────────────────┐
  │  [C5 chip]  [MOD]          │   ← row 1: effective (moderated) grade + badge
  │  [C4 chip, dimmed]         │   ← row 2: the teacher's ORIGINAL, dimmed, still legible
  └────────────────────────────┘
```

| Part | Exact spec |
|---|---|
| Container | `inline-flex flex-col items-center gap-0.5` |
| Row 1 | `inline-flex items-center gap-1` → `<GradeChip grade={moderatedGrade} small />` + badge |
| **Badge** | `<span className="rounded bg-navy px-1 py-0.5 text-[8px] font-bold uppercase text-gold">MOD</span>` — copy is literally `MOD` |
| Row 2 | `<GradeChip grade={grade} small dim />` — the teacher's original, `dim` variant |
| Teacher's edit affordance | **suppressed** — the `<select>` is not rendered when `moderatedGrade != null` |

**This is the whole crown-jewel treatment and it is already built.** Do not restyle it, do not replace the dim chip with a strikethrough (the file's own header comment says "struck through" but the code renders a `dim` chip — **the code is the truth**; flag the stale comment as a one-line docs fix).

## E.3 The moderate affordance — where it lives

**Recommendation: no new screen.** Add the write to the **existing INCR-16 mark-entry grid** (`/senior/wassce/subject`), gated to `VICE_HEADMASTER_ACADEMIC`, and give this cohort surface the **read-only trail** + a deep link.

Rationale (the lazy-correct call): the HoA moderating a grade needs the candidate × subject context the grid already provides, plus the trajectory and cohort-mean columns already rendered there. A second grid on the cohort surface would be a duplicate with worse context. The cohort surface's job is *oversight of what was moderated*, not the act of moderating.

| Control | Where | Type | Authz |
|---|---|---|---|
| **Moderate** (opens the panel on a cell) | mark-entry grid cell, replaces the teacher `<select>` for a moderator | **WRITE** | `VICE_HEADMASTER_ACADEMIC` only |
| **Clear moderation** (revert to teacher grade) | inside the panel, only when `moderatedGrade != null` | **WRITE** | `VICE_HEADMASTER_ACADEMIC` only |
| **Moderation trail card** | 🆕 **this surface** (see E.6) | READ | HoA set (Part I) |
| **Open in subject view** (deep link per trail row) | trail card row | READ · nav | HoA set |

## E.4 The moderate panel — fields + copy (ALL NEW COPY)

Reuse `.card` + the `.btn` families; a popover anchored to the cell, or an inline row expansion. No new primitives.

| Field | Control | Copy | Validation |
|---|---|---|---|
| Original | read-display | `Teacher grade · {grade} · entered by {markedBy} on {markedAt}` | — |
| New grade | `<select>` over `WASSCE_GRADES` | label `Moderated grade` | **required**; must be a valid `WassceGrade` (`isWassceGrade`); **must differ from the teacher grade** → error `The moderated grade must differ from the teacher's grade. To undo a moderation, use Clear moderation.` |
| Reason | `<textarea>` | label `Reason for moderation`, placeholder `e.g. Re-mark of Section B after script review — 4 marks restored.` | **REQUIRED at the app layer** (the DB column is nullable). Min 10 chars, max 500. Error: `A reason is required — the moderation trail is an audit record.` |
| Submit | `.btn.gold` | `Moderate grade` | disabled until both fields valid |
| Cancel | `.btn` | `Cancel` | — |
| Clear | `.btn` (terra text) | `Clear moderation` → confirm `Clear the moderation and restore the teacher's grade of {grade}?` | sets all **four** columns to NULL together (the CHECK enforces the set) |

🟠 **Why reason is required despite being nullable in DB:** the schema comment calls this "the audit trail". A moderation with no rationale is exactly the audit hole Sarah's carry-forward names. Enforce in the Zod schema, not with a migration. **Kofi confirm.**

## E.5 Panel state matrix

| State | Treatment |
|---|---|
| Idle / un-moderated cell | Effective chip (= teacher grade); moderator sees a `Moderate` affordance on hover/focus. |
| Panel open | Original read-display + the two inputs. |
| Pending | `bg-gold-bg` cell tint (**solid token — the shipped grid already does exactly this**, `wassce-mock-entry-grid.tsx:152` `style={{background:"var(--gold-bg)"}}` — never `bg-gold/8`); submit disabled + spinner. |
| Validation error | Inline 11px `text-terra` under the offending field; panel stays open; nothing written. |
| Server error | `bg-terra-bg border-l-[3px] border-terra` strip in the panel: `Could not save the moderation. {message}` |
| Success | Panel closes; cell re-renders as E.2 (moderated chip + `MOD` + dimmed original); trail card gains a row. |
| Already moderated | Panel opens pre-filled with the current moderated grade + reason; submit copy becomes `Update moderation`; `Clear moderation` shown. |
| **Not authorised** | The affordance is **not rendered at all** (not disabled). A crafted POST is rejected server-side. |
| **Mock marking closed** (`marking_complete_at IS NOT NULL`) | 🟠 **See E.7 — Kofi ruling required.** |

## E.6 The moderation trail card (READ-ONLY — on THIS surface)

🆕 Append to §1, below the `.col-2` block. Built from primitives already on this surface (`.card` + `.risk-list` table). **All copy NEW.**

Card head: `Moderation <em>trail</em>` / meta `{n} moderated results · Mock 2`

| Column | Content | Token |
|---|---|---|
| `CANDIDATE` | `.st-name` + `.st-meta` (index) | as C.3 |
| `SUBJECT` | `wassce_subjects.name` | 11.5px `text-navy-2` |
| `GRADE` | the E.2 stack: `[moderated] [MOD]` over `[original, dim]` | reuse verbatim |
| `MODERATED BY` | `{users.name}` + `.st-meta` `{moderated_at}` formatted `14 May 2026 · 14:45` | Fraunces 12px/600 + mono 9px |
| `REASON` | `moderation_reason`, truncated to 2 lines | 10px `text-navy-3` |
| — | `Open in subject view` deep link | `.btn` small · READ nav |

**States:** empty → `No results have been moderated for this mock.` (the honest zero — no rows, no fake). Loading → 3 ghost rows. Sort → `moderated_at` descending.

## E.7 🟠 Open rulings for Kofi/Wells (BLOCKING the Part E build)

1. **Does moderation respect `mock_exams.marking_complete_at`?** `saveMockResult` blocks teacher entry when marking is closed. **Moderation exists precisely to correct grades after marking closes** — my strong recommendation is that moderation is **NOT** gated by `marking_complete_at`, only by role. If it is gated, moderation becomes unusable in its main scenario. **Must be ruled before build.**
2. **Does moderating a predictor-mock grade require re-freezing the readiness statement?** `readiness_statements.projection_snapshot_json` is frozen from `effectiveGrade`. A post-freeze moderation makes the frozen statement diverge from the live projection — by design (AC15 established that a later edit changes the live board, never the frozen json). But the HoA should be **told**. Recommend a warn strip after a moderation that affects a candidate with a current statement: `This candidate has a frozen readiness statement. Regenerate it to reflect the moderated grade.` **NEW COPY.**
3. **INCR-16 carry-forward #1 (Quinn):** `saveMockResult` doesn't verify the candidate is REGISTERED for the subject via `wassce_candidate_subject`. **Fold the check into both the existing write and the new moderation write** — this increment is the designated place (build-plan:2160).
4. **INCR-16 carry-forward #2 (Sarah):** an oversight (`WASSCE_SETUP_ROLES`) open-window write currently overwrites the teacher's authoritative `grade` **with no trail**. **Route oversight edits through the moderation columns now that the UI exists** (build-plan:2161). This is the real fix Sarah asked for.
5. **INCR-16 carry-forward #3 (Dex FORWARD-1):** the `subjects.name ↔ wassce_subjects.name` authz seam. Not required for the HoA surface (HoA is whole-cohort, not subject-gated) but the moderation write on the grid rides the same route — confirm the moderator path does **not** depend on the name match.
6. **Audit:** every moderation write goes through `recordAudit` (the existing `lib/db/audit` idiom used by `saveMockResult`). Confirm the audit action name.

---

# PART F — Cross-cutting state discipline

## F.1 The three "no number" cases — keep them distinct

| Case | Cause | Render | Never |
|---|---|---|---|
| **Projection pending** | `projectAggregate` → `{computable:false}` (<3 graded cores or electives) | `projection pending` — 11px italic `text-navy-3`, **non-mono** | a partial 5-subject aggregate |
| **Marking incomplete** | predictor `marking_complete_at IS NULL` | figures render over graded results, **stamped with the denominator** | an unqualified cohort figure |
| **Empty** | zero rows | em-dash `—` `text-navy-3` (heatmap cells excepted, B.4) | `0`, `N/A`, blank |

INCR-17's rule is the governing one: **never a partial number**. It propagates here — a not-computable candidate is excluded from the median/mean/histogram/tiers and the exclusion is **stated**, never silently absorbed.

## F.2 Loading

Skeletons at final height everywhere; no layout shift on the summary strip, the histogram, the heatmap grid, or the house cards. Never render `0` as a loading placeholder.

## F.3 Error

Card-scoped, not page-scoped: `bg-terra-bg border-l-[3px] border-terra p-[11px_14px] rounded-lg` 11px `text-navy-2` + a retry action. The static cards (C.8, D.4) render regardless.

---

# PART G — Derived figures that MUST come from an existing pure lib

**Do not re-derive any of these.** Every one has a shipped, unit-tested source.

| Figure | Lib | Note |
|---|---|---|
| Per-subject effective grade | `mock-grades.effectiveGrade()` | `COALESCE(moderated, teacher)`. **Every** figure on this surface derives from the effective grade, never the raw teacher grade. |
| Projected aggregate (per candidate) | `projection.projectAggregate()` | Feeds tiles 2/4, the histogram, programme bars, house medians/tiers, the §3 Mock-2 column. **Never** re-implement best-3. |
| Not-computable handling | `projection.ProjectionResult.computable` | Drives F.1 and C.5 clause 4. |
| Tier band for an aggregate | `university-match.TARGET_TIER_BANDS` | **NOT `AGGREGATE_BANDS`** — §0.3. |
| Credit / distinction predicates | `mock-grades.isCredit()` / `isDistinction()` | Tile 3, heatmap below-credit counts, B.5 shares. *(Also closes Dex NIT-1 — the inline boundary in `mock-data.ts:388,393`.)* |
| Per-grade counts | `mock-grades.gradeDistribution()` | The heatmap row is exactly this over the subject's effective grades. |
| Credit rate | `mock-grades.creditRate()` + `toPct()` | Tile 3's 94%. |
| Gap / margin vs cut-off | `university-match.matchMargin()` | **The sign convention is inverted from the surface** — C.4. |
| Grade ramp hexes | `grade-colors.GRADE_COLORS` + `GRADE_CHIP_TEXT` | §0.2. |
| Programme labels + pill tints | `constants.PROGRAMME_TRACKS` + `PROGRAMME_ORDER` | §0.4. |
| Grade order / ordinal | `mock-grades.WASSCE_GRADES` / `gradeOrdinal()` | Heatmap column order. |

**Genuinely new pure helpers this surface needs** (add to `lib/wassce/`, keep DB-free, unit-test):
- `median(aggregates: number[]): number | null` — tile 2, house cards. *(Mean is a one-liner; median needs the even-length rule stated. Kofi: lower-median or mean-of-two? The demo's 240 candidates with median 18 doesn't disambiguate. **Recommend lower-median** — an aggregate must be an integer.)*
- `histogramBins(aggregates: number[])` → the 20-bin layout of A.4 **with the corrected labels** (`6–7`, `8`…`24`, `25–27`, `28+`).
- `atRiskCandidates(...)` → the C.5 three-clause rule, once Kofi ratifies it. **This is the one that must be a tested pure function** — it drives tile 4, the `<h1>` count, the filter counts, and the house at-risk counts, and every one of those must agree.

**G.4 ⚠️ Do NOT read `readiness_statements` for the live cohort figures.** It is the *frozen* artifact. Cohort figures are **derived on read** from `mock_results`, exactly as INCR-17 established (`projected_aggregate` stays NULL; the snapshot is the only stored copy and it is deliberately allowed to diverge). Reading frozen statements here would make the cohort dashboard stale the moment a grade is moderated — which is the whole point of this increment.

---

# PART H — 🔴 Elements with NO clean data binding

Flagged, not invented. Each needs an owner decision: **build the table**, **cut the element**, or **ship it static**.

| # | Element | What's missing | Recommendation |
|---|---|---|---|
| **H.1** | §3 `Last action` column (`Dean call w/ parent · 8 May · agreed exit-planning meeting`, `Mother declined Dean call`, `FM interview · 2 May · target widened`, …) | **No table.** No interview/contact/case-note entity exists anywhere in the schema (`grep interview\|worklist\|followup` over `db/schema` → 0 hits). Would need `wassce_guidance_interviews (candidate_id, actor_user_id, actor_role, interview_type, occurred_on, outcome_text, parent_contacted, parent_declined)`. | **Cut for INCR-18; render the column with `—`, or drop the column.** It is a whole workflow entity, not a display field. Propose as **INCR-18b** if the owner wants the Dean's worklist. |
| **H.2** | §3 `Next` column (`Wed 21 May` / `Resolved` / `Pending` / `Make-up TBD`) + the `Last interview` sort pill | Same missing table (a `next_action_at` + `status` on the interview row). *(`Make-up TBD` alone is bindable — `waec_special_consideration.make_up_scheduled_at`.)* | Same as H.1. Bind **only** the `Make-up TBD` case from the SC table; everything else `—`. |
| **H.3** | §3 **entire "Dean's interview cadence" card** (`9 resolved`, `11 scheduled · 14–24 May`, `4 followup · parents declined`, close-out `before 19 Jun`) | Same missing table. Only the `4 no-target` row binds (= tile 5). | **Cut the card, or ship the three prose lines static with the `4 no-target` row live.** The close-out paragraph is editorial and can ship as static copy. |
| **H.4** | §3 filter pill `Followup pending` **8** | Same missing table. | Remove the pill for INCR-18. |
| **H.5** | Buttons `Dean's worklist`, `Parent SMS log` | No worklist route; no comms-log route in this module. | Render disabled with a title, or omit. **Do not link to 404.** |
| **H.6** | §3 target-cell sub-copy `considering deferment` (row 1) | Free prose on a candidate with no targets. `wassce_candidates.note` exists (nullable, `§4.5 display prose`) and could carry it. | Bind to `wassce_candidates.note` if present; else render only `No target tagged`. |
| **H.7** | **A.4 benchmark callout** — `Western Region Mock 2 median (20)`, `national Mock 2 median (17)`, `Western 38%` (T2), `Western 12%` (T4) | 🔴 **Structurally unbindable.** `benchmark_reference.subject_name` is **NOT NULL** (no school-wide row is representable) and `benchmark_metric` is **only** `CREDIT_RATE \| DISTINCTION_RATE` — there is **no aggregate-median metric and no tier-share metric**. Would need a nullable `subject_name` + two new enum values (`AGGREGATE_MEDIAN`, `TIER_SHARE`) + a `tier` discriminator → **a migration**. | **Escalate to owner.** Either (a) cut the callout for INCR-18, (b) ship it as static labelled-placeholder copy with a provenance stamp (the INCR-16 precedent for placeholder benchmark figures), or (c) fund the schema change. **My recommendation: (b)** — render the school's own two figures live and the external four as an explicitly-sourced static line (`GES Western Region statistics, published Nov` / `WAEC national chief examiner report, published Oct` — the `.notes` panel already documents this provenance and admits the data is "out-of-date by 6–12 months"). |
| **H.8** | §4 `HM digest` button + the Boarding xmod card's Friday auto-send | No scheduler, no digest generator, no boarding→WASSCE comms hook. | Ship the xmod card **static** (it is an explainer). Disable/omit the button. **Design commitment preserved, not built.** |
| **H.9** | `Export · GES district`, `Export · staff brief` | No export route. *(The receipt/readiness PDF path from #136/INCR-17 exists and is the obvious reuse, but neither export's content is specified anywhere.)* | Omit for INCR-18 or wire to a CSV of the visible table. Flag scope. |
| **H.10** | Sidebar `Live exam tracker` + banner `Open live tracker` | No route, no increment assigned. | Render the nav item **disabled**; make the banner CTA inert or remove it. |
| **H.11** | Lede `Updates with live results in August` | `wassce_results` (post-release actuals) is **deferred entirely** (`wassce.ts:610`). | Ship as static copy — it is a true statement of intent, not a data claim. |
| **H.12** | Banner `awaiting hospital discharge` + the Sickbay xmod card's live link | Sickbay is module **4.4**, not built. `waec_special_consideration.notes` (free text) could carry the phrase manually. | Bind to `waec_special_consideration.notes` if present; omit the clause if null. Ship the xmod card static. |
| **H.13** | §2 heatmap row set | The surface's 15 rows **omit every Home Ec elective** — 40 Home-Ec students appear in no elective row. | **Do not hard-code the row list.** Derive from `wassce_subjects` with ≥1 result. The live surface will have more rows; that is correct, not a regression. |
| **H.14** | §2 concern/watch **selection rule** | The surface shows the outcome, not the rule. By below-credit share the order would be French (41.7%) then Elective Math (40.7%); the surface shows Elective Math first. No threshold is stated for concern-vs-watch. | 🟠 **Kofi ruling.** Proposal: rank by below-credit share desc; share ≥ 30% → **Concern** (terra), 15–29% → **Watch** (warn), below 15% → not shown; cap at 2 concerns + 1 watch. Check against demo: French 41.7% + Elective Math 40.7% = concerns ✓, Math Core 18.3% = watch ✓ (Physics/Chemistry at 15.0% tie on the boundary — needs a tiebreak, suggest raw count desc). |
| **H.15** | §2 concern-card trailing prose (`Mr Bediako's elective math team needs intervention plan…`, `no L1 French teacher; part-time staffing… HOD Languages co-signed`, `Six remedial slots running Wed/Sat…`) | Intervention plans, staffing history, remedial scheduling, HOD sign-off — **none exist as data.** | Ship as **static per-subject annotation copy** or omit the trailing sentence. **Do not fabricate an interventions table.** The Jun 3 paper date IS bindable (`wassce_papers.scheduled_date`). |
| **H.16** | §1 tile-5 sub `Dean exit-planning conversations`, §3 row-1 `agreed exit-planning meeting` | Workflow prose (see H.1). | Static label; the **count** is live. |

---

# PART I — Read vs WRITE + authz register

## I.1 🔑 The authz shape of this surface

**This is a whole-cohort HoA surface. A subject teacher must NOT reach it.** INCR-16's `/senior/wassce/subject` is the per-subject teacher surface, gated by the `senior_subject_teacher` correspondence (`resolveAuthorizedWassceSubjectIds`). This surface has **no subject scoping at all** — it renders every candidate, every subject, every house.

**Recommended gate: `WASSCE_SETUP_ROLES`** = `ADMIN` · `HEADMASTER` · `VICE_HEADMASTER_ACADEMIC`. Exactly the existing WASSCE leadership set; the persona in the surface footer (`C. Owusu-Ansah · Head of Academics`) **is** `VICE_HEADMASTER_ACADEMIC` (the map in `access.ts:39` states this explicitly: *"Vice Headmaster Academic (= Head of Academics)"*).

`TEACHER` / `FORM_MASTER` are **NOT** in that set → a subject teacher is denied at the page guard. ✅ **This is the required outcome.** Note that `SENIOR_LEDGER_ROLES` **does** include `TEACHER`/`FORM_MASTER` — **do not use it here.**

🟠 **Kofi/Wells to confirm two edge roles the surface implies but the gate excludes:**
- **`DEAN_OF_BOARDING`** — the surface's §3 is titled "Dean Mensa-Ofori + Form Masters" and the primary action is "Dean's worklist". If the Dean is a real consumer, either add the role or accept that the Dean's worklist is a *boarding-module* view. *(Moot for INCR-18 since the worklist is unbindable — H.1.)*
- **`HOUSEMASTER`** — §4 and the xmod card describe an HM weekly digest. Boarding's `canAccessHouse` scopes an HM to their own House. If an HM ever reaches §4, it must be house-scoped, not whole-cohort. **Recommend: HMs do NOT get this surface in INCR-18** (the digest is the delivery mechanism, per the design) — which is also the lazy answer.

## I.2 Control register

| Control | Section | Type | Authz |
|---|---|---|---|
| Every tile, chart, heatmap cell, table row, house card, xmod card | all | **READ-display** | page gate |
| `Distribution chart` / `Risk list` | §1 | READ · view toggle | page gate |
| `By programme` / `By teacher` | §2 | READ · regroup | page gate |
| Filter + Sort pills | §3 | READ · client filter | page gate |
| `By Form Master` | §3 | READ · regroup | page gate |
| `Boarding view` | §4 | READ · cross-module nav | page gate + boarding's own gate at the target |
| `Open live tracker` | §1 | 🔴 inert (H.10) | — |
| `Export · GES district` / `Export · staff brief` | §1/§2 | 🔴 unbuilt (H.9) | would be page gate |
| `Dean's worklist` / `Parent SMS log` / `HM digest` | §3/§4 | 🔴 unbuilt (H.5/H.8) | — |
| **`Moderate grade`** | Part E | **🔑 WRITE** | **`VICE_HEADMASTER_ACADEMIC` ONLY** — narrower than the page gate. Kofi R3. |
| **`Clear moderation`** | Part E | **🔑 WRITE** | same |
| Moderation trail card + deep links | Part E / §1 | READ | page gate |

**The moderation write is the ONLY write in INCR-18.** Everything else is read-display.

## I.3 Server-side enforcement

- Page guard: `assertAnyRole(WASSCE_SETUP_ROLES)` in the route's server component (the shipped WASSCE-page idiom).
- Moderation action: `assertAnyRole(["VICE_HEADMASTER_ACADEMIC"])` — **not** `WASSCE_SETUP_ROLES`. An ADMIN or HEADMASTER can *see* the trail; only the VHA moderates. 🟠 **Confirm with Kofi** — R3 names the moderator role singular, but ADMIN is usually a superset in this codebase. *(If ADMIN is added, note it in the trail's attribution — the trail must show who, and "Admin" is a weaker signal than a named academic head.)*
- Every write inside `withSchool(...)` + `recordAudit(...)` + `safeRevalidate(...)`, matching `lib/actions/wassce-mocks.ts`.
- **All data reads are server-only.** Repo memory `reports-data-is-server-only`: `lib/wassce/*-data.ts` imports the db driver. The cohort table/chart client components must take **pre-formatted view objects** (a `cohort-view.ts` pure module, mirroring `readiness-view.ts` / `mock-view.ts`). Only `pnpm build` catches a leak.

## I.4 Fragile seam to keep in view

The `By teacher` regroup (§2) needs subject→teacher, which rides the `subjects.name ↔ wassce_subjects.name` match (Dex FORWARD-1, build-plan:2162). It is guarded for case/whitespace only. **If `By teacher` ships, a name drift silently mis-attributes a subject to the wrong teacher on an HoA dashboard.** Recommend deferring `By teacher` until the seam is an explicit FK, or render it with an "unmatched subjects" bucket.

---

# PART J — Cross-module hooks (design commitments — preserve)

| Hook | Where | Status |
|---|---|---|
| **Sickbay → WASSCE** (matron updates referral → the `1 medical · Slessor` tile + banner update; discharge triggers make-up scheduling) | §1 banner · §4 Slessor card · xmod card 3 | Static explainer in INCR-18 (Sickbay is 4.4). `waec_special_consideration.make_up_scheduled_at` is the landing column. |
| **Boarding → WASSCE** (HM weekly Friday digest; house allocation is academic-blind) | §4 whole section · xmod card 1 | House grouping is **live** (`students.house_id` → `houses`). The digest cadence is static (H.8). |
| **VLC → WASSCE** (pastoral × academic, two parallel threads on one student, `neither conflated`) | §3 row 5 `<b>Pastoral case</b> · Dean co-monitoring · VLC flag active` · xmod card 2 | Narrative today. The *principle* — pastoral and academic tracks stay separate — is a design commitment; do not merge them into one status field. |
| **Mock ledger → projection → cohort** (moderation changes the effective grade → changes the projection → changes the histogram, tiles, tiers, at-risk list) | Part E → everything | **LIVE and load-bearing.** This is why G.4 forbids reading frozen statements. |
| **Projection → WASSCE predictor / university match** | §3 target + gap | Live via `university_targets` + `matchMargin`. |
| **Discipline pause during WASSCE** (`GES_POLICY_ANCHORS`) | not on this surface | Noted for completeness; no element here. |

---

# PART K — Surface-sync notes (issues in the source HTML)

Report back to the surface author; **do not edit the HTML**.

| # | Issue |
|---|---|
| K.1 | **The moderation section is absent** from a surface the build plan says owns it. `.save-bar` and `.hm-row-total` are orphaned CSS from the removed block. **Highest-priority sync item.** |
| K.2 | Histogram axis: `25+` and `28+` overlap; the axis starts at `7` while the aggregate floor is `6`. Should read `6–7 … 24 · 25–27 · 28+`. |
| K.3 | B.5 card 1: `35 students (33%)` — the true share is **40.7%** (35/86). And `Largest below-credit concentration of any single subject` is false by count (Math Core = 44); true only by share. |
| K.4 | §3 is captioned "Sorted by gap size · descending" but the demo rows are ordered by Mock 2 descending, with rows 10–11 out of order. |
| K.5 | The heatmap omits every Home Ec elective; 40 Home-Ec students appear in no elective row. |
| K.6 | §3's lede + tile 4 sub-copy describe only clause 1 of a 3-clause at-risk rule that the data plainly implements. |
| K.7 | Filter pills `9 + 12 + 4 = 25 ≠ 28` — intentional (partial filter set, not a partition), noted so it isn't "fixed". |
| K.8 | `wassce-mock-entry-grid.tsx` header comment says the original is "struck through"; the code renders a `dim` chip. One-line docs fix. |
| K.9 | Heatmap grade hexes drift from the shipped Palette A (`grade-colors.ts`) on 5 of 9 columns — §0.2. |

---

## Build order (suggested)

1. Route + page guard + the shared `.app-shell` chrome (§0.6) — reuse the shipped WASSCE page shell.
2. `lib/wassce/cohort-data.ts` (server) + `cohort-view.ts` (pure) — the three new helpers in Part G, unit-tested.
3. §1 tiles + histogram + programme bars (Part A) — the highest-value read.
4. §2 heatmap (Part B) — Palette A reconciliation first.
5. §4 house cards (Part D) — cheapest section, fully bindable.
6. §3 at-risk list (Part C) — **after** Kofi ratifies the three-clause rule (C.5) and the gap vocabulary (C.4); ship with H.1/H.2 columns as `—`.
7. **Part E moderation** — after the E.7 rulings. The write on the existing grid + the read-only trail card here.
