# WASSCE Readiness — Projection + Readiness-Statement + SC-Form — Surface Map (INCR-17 · Module 4.3)

**Author:** Lucy (design cartographer) · **Status:** design spec, ready for the implementation engineer (Claude Code).
**Increment:** INCR-17 — *Projection engine + readiness statement + SC-form* · migration **0053** · depends on INCR-16 (0052) · **Analytical spine (heaviest).**
**Scope of THIS map (the INCR-17 slice only):** the **aggregate-construction visualizer** (best-3-cores + best-3-electives → aggregate 6–54), the **Mock 1 → Mock 2 → projected** projection display, the **SC-12 / special-consideration** context + **SC-form artifact**, and the **readiness-statement artifact** (generate + parent-acknowledgement). This is the **non-university** slice of INCR-17.

> **The INCR-17 / INCR-17b split (build-plan line 2075).** INCR-17 = "Projection engine + university targets + readiness statement + SC-form," with an explicit instruction to **split `university_*` → INCR-17b if it runs long.** This map covers **projection + readiness-statement + SC-form = INCR-17**. The **university target / match** pieces (`wassce-setup` §3 + student-readiness **Section 6**) are **deferred to INCR-17b** and are mapped **nowhere below** — only noted where they bleed into an in-scope element (e.g. the readiness statement's target line, the aggregate-vs-cut-off explainer copy).

## Source surfaces (visual source of truth — replicate 1:1)

| Surface file | Role in this map | Sections in scope |
|---|---|---|
| `Surfaces/schoolup-wassce-student-readiness.html` | **PRIMARY.** Y. Aidoo's deep-dive (7 app-frame sections). This map covers only the **projection + aggregate + SC + readiness-statement** slices. | **§1** (projected-aggregate card, trajectory strip, medical/SC-12 banner — NOT the STPSHS panel) · **§3** (subject Mock1→Mock2→projected cards, incl. dropped Elective Maths) · **§4** (ledger projection **callout** only — grid is contextual) · **§5** (aggregate-construction visualizer — **crown jewel**) · **§7** (parent-ack artifact + SC-12 xmod card only) |
| `Surfaces/schoolup-wassce-setup.html` **§5** | **SC-form anchors** (SC-3/SC-7/SC-12). | **Policy-display only** — see Part D.5. No filing UI on this surface; the real SC-form artifact lives on student-readiness §1/§7. |

**Tables this map reconciles against (BUILD_STACK WASSCE batch; INCR-17 migration 0053 — Kofi has NOT yet ruled INCR-17, so every binding below is a *proposal for Kofi/Wells confirmation*, mirroring how the INCR-16 map pre-specified `mock_*` before the ruling):**
- **`waec_special_consideration`** (TENANT, composite FKs, FORCE RLS, prod-paste) — the SC-3/SC-7/SC-12 filing artifact. **NEW in 0053.**
- **`readiness_statements`** (TENANT, FORCE RLS, prod-paste) — the generated statement + parent signature. `parent_signature_pdf_file_id` **reuses the portable receipt-PDF path (#136)** — no new PDF dep. **NEW in 0053.**
- **`wassce_candidates.mock_2_aggregate`** — exists since INCR-15 as **seeded/display-only** (Ruling K4); **INCR-17 makes it REAL** (computed best-3 from `mock_results` Mock-2 grades).
- **`wassce_candidates.projected_aggregate`** — **stays NULL through INCR-15/16** (K4, AC-G16); **INCR-17 computes it** (the projection engine). For the medical-hold case it equals `mock_2_aggregate` and **holds** (Decision 11).
- **Reused reads (frozen contracts, NEVER written here):** `mock_results` (per-subject Mock-1/Mock-2 grade = the projection input; INCR-16), `wassce_candidates`/`wassce_candidate_subject`/`wassce_subjects`/`wassce_programmes` (INCR-15 spine), `wassce_papers`/`wassce_paper_sittings` (missed-paper / make-up context), `senior_score_ledger` + frozen `*_weight_used` snapshot (the §4 6-semester ledger **context** strip — READ-ONLY, must NOT re-run `compile.ts`/`resolveWeights`), `wassce_setup_frozen_at` (freeze read).

**Projection engine = pure lib, NO triggers** (build-plan line 2082: "best-3 aggregate = pure lib like `compile.ts`; freeze = app-layer; Sickbay→SC-12 auto-suggest deferred to 4.4"). Best-3 lives in `lib/wassce/` (e.g. `projection.ts`), consumes stored Mock-2 grades, computes deterministic aggregate. INCR-17 ships **SC-12 as MANUAL filing** — the Sickbay auto-suggest is a later app-layer cross-module call (Decision 9, deferred to 4.4).

## Explicitly OUT of scope (noted, NOT mapped)

| Item | Surface region | Owner | Why out |
|---|---|---|---|
| **University targets / match** (KNUST/Legon/UCC, cut-offs, target/comfortable/stretch/safety tiers, prerequisites, cut-off table) | student-readiness **§6** (whole section) + `wassce-setup` §3 | **INCR-17b** | The uni-match slice; split off per build-plan line 2075. Cut-off dataset source is owner-gated (licensed vs school-entered). |
| **Cohort-readiness** (HoA whole-cohort distribution) | `wassce-cohort-readiness` | INCR-18 | Cross-candidate aggregate view. |
| **Parent-tracker** (parent portal, one child) | `wassce-parent-tracker` | INCR-19 | Parent-facing capstone; parent-scoped RLS. |
| **Non-projection deep-dive** (STPSHS submission panel §1, paper-by-paper schedule §2, the 30-cell ledger **grid** §4, the pastoral/financial context strip §7, the parent-comms log §7, the non-SC xmod cards §7) | student-readiness §1/§2/§4/§7 | **INCR-20** | Full student-readiness is built LAST, pulling from every table. This map takes only the projection + SC + readiness-statement pieces. |

---

## §0 — Shared chrome, tokens, type & no-alpha discipline

### 0.1 Token & type reference — REUSE INCR-15/16 verbatim

The surface declares the **identical `:root` palette** as INCR-15/16 (same hexes as `design-tokens.json` v1.0.0). **Reuse the INCR-15 token→Tailwind table** (`docs/senior/wassce-spine-surface-map.md` §0.1) — do not re-derive. `font-display` = **Fraunces** (headings, aggregate/stat numbers, section titles, gold italic `<em>`); `font-body` = **Manrope** (body, labels, names); `font-mono` = **JetBrains Mono** (index `0184-0817`, SC ref `SC-12-184-2026-0044`, points `3 pts`, aggregate figures, weighted totals, Reference IDs). Empty/missing = em-dash `—` in `text-navy-3` (never `0`/`N/A`). Headings weight 500 with gold italic `<em>` (`Aggregate · <em class="text-gold italic">10</em> · construction shown`).

### 0.2 Grade-chip palette (Palette A) — REUSE `lib/wassce/grade-colors` (shipped INCR-16)

The subject-trajectory cards (§3) and the aggregate explainer strip (§5) render A1–F9 chips with the **same bespoke 9-step scale** INCR-16 already stored as `lib/wassce/grade-colors.ts` (built PR #160). **Reuse it; do not re-hex.**

| Grade | Hex | Token? |
|---|---|---|
| A1 | `#1E5A35` | bespoke dark forest |
| B2 | `#2F6B47` | = `--green` |
| B3 | `#3D8059` | bespoke |
| C4 | `#7C9647` | bespoke olive |
| C5 | `#B59B3D` | bespoke gold-olive |
| C6 | `#C58A2E` | = `--warn` |
| D7 | `#C58A2E` | = `--warn` |
| F9 | `#B84A39` | = `--terra` |

`.grade-chip` = 36px `rounded-md` Fraunces 14px 600 white text; `.grade-chip.sm` = 28px `rounded-sm` 11px.

### 0.3 NEW bespoke colours introduced by the in-scope sections (NOT tokens — flag)

| Region | Value | Where | Store as |
|---|---|---|---|
| Medical banner gradient tail | `#8B3829` (dark terra) | `.disruption-banner` `linear-gradient(135deg,#B84A39,#8B3829)` | inline / `lib/wassce/` constant — **not a token** |
| Banner headline `<em>` | `#F5D4C9` (light terra) | `.db-headline em` | inline |
| Banner pulse dot | `#FFD4C9` (pale terra) | `.db-pulse-dot` + pulse-ring rgba | inline |
| Identity Science pill | `#E5F0EB` bg / `#1E5A35` text | `.sc-pill.sci` | **DRIFT** — INCR-15 Science programme pill is `terra-bg/terra`; here it is green-tinted. Reconcile (Part J). |
| Identity Slessor House pill | `#E5EAF2` bg / `#2D3F5C` text | `.sc-pill.slessor` | bespoke **House** tint (mirrors boarding House-hex drift) — per-House inline color |

### 0.4 No-alpha discipline — EVERY translucency in the in-scope sections (repo memory `no-alpha-token-opacity`)

The surface hand-writes `rgba()` literals — fine as-is. The trap is the **Tailwind port**: slash-opacity on a raw-hex token (`bg-gold/8`, `bg-navy/80`) **renders nothing**. Verify in the **live preview**, not the build. Port each below to an **arbitrary rgba** or an `opacity-N` utility — **never** slash-opacity.

| Element (section) | Raw value | Port to |
|---|---|---|
| `.db-icon` bg (§1 banner) | `rgba(255,255,255,0.16)` | `bg-[rgba(255,255,255,0.16)]` |
| `.db-pulse` bg (§1) | `rgba(255,255,255,0.12)` | `bg-[rgba(255,255,255,0.12)]` |
| `.db-pulse-dot` glow (§1) | `rgba(255,212,201,0.7 → 0)` keyframe | decorative pulse; arbitrary rgba or drop the animation |
| `.db-cell` bg ×4 (§1) | `rgba(255,255,255,0.08)` | `bg-[rgba(255,255,255,0.08)]` |
| `.db-btn` bg (§1) | `rgba(255,255,255,0.92)` | `bg-[rgba(255,255,255,0.92)]` |
| `.db-btn-ghost` bg + border (§1) | `rgba(255,255,255,0.12)` / `rgba(255,255,255,0.3)` | `bg-[rgba(...)]` / `border-[rgba(...)]` |
| `.disruption-banner` shadow (§1) | `rgba(184,74,57,0.4)` | decorative shadow; arbitrary rgba or drop |
| **`.agg-row.dropped` (§5) — the Decision-12 grey-out** | `opacity:0.45` on a solid row | **`opacity-45`** — NOT `bg-*/45`. This is the crown-jewel "dropped-but-visible" mechanic. |
| `.lt-score.mock-1-col` / `.mock-2-col` (§4, context) | `rgba(61,84,120,0.06)` / `rgba(74,98,134,0.08)` | `bg-[rgba(...)]` (only if §4 grid is built as context) |
| `.lt-total-row` bg (§4, context) | `rgba(200,151,91,0.05)` | `bg-[rgba(200,151,91,0.05)]` |
| `.lt-score.empty` (§4, context) | `opacity:0.45` | `opacity-45` |
| Sidebar nav (all sections) | INCR-15 `rgba(...)` literals | **reuse INCR-15 §0.2 ports verbatim** |

### 0.5 In-app chrome (build once; reuse across the mapped sections)

`.desktop` → `.browser-bar` (navy, cosmetic dots + `.url`) → `.app-shell` (`sidebar 220px + main 1fr`). The outer editorial `.page-header` / `.section-head` / `.section-num` / `.section-meta` and the `.notes` right-rail are **design-doc chrome — do NOT build.** Build the in-app frame only.
- **Sidebar** (this surface): admin/HoA persona, **flat** nav (under 12 top-level → flat correct). Groups `Academic` (Dashboard · Classes & courses · Gradebook · **WASSCE 2026 (active)** · Transcripts) / `Student support` (VLC · Boarding · Sickbay · Discipline) / `Operations` (Billing · Communications · People · Settings). Brand `A` + `Asankrangwa SHS` + `Mrs C. Owusu-Ansah · Head of Academics`. The real Senior app nav wins where it differs; this map only asserts the WASSCE entry.
- **`.head-row`** (`bg-surface border-b border-border`, `padding 20px 32px`): `.crumb` (`11px text-navy-3`, `<b>›</b>` separator) → `<h1 font-display 24px 500>` gold italic `<em>` → `.head-actions`.
- **`.btn` families:** `.btn` = `border-border-2 bg-surface text-navy 12px/600`; `.btn-primary` = `bg-navy text-bg`; `.btn-gold` = `bg-gold text-navy`; `.btn-ghost` (§4) = ghost secondary.
- **`.body-shell`** = `padding 28px 32px 40px`.

URLs (cosmetic; all one candidate route with anchors): `…/wassce/candidates/0184-0817` (§1) · `#subjects` (§3) · `#ledger-trajectory` (§4) · `#aggregate` (§5) · `#context` (§7).

---

# PART A — Aggregate-construction visualizer (§5) — **CROWN JEWEL**

**Surface lines 1177–1298.** Editorial head (do-not-build): `05 · Aggregate construction · the WAEC best-3 calculation · Best 3 cores (English missing — projection) + best 3 electives`. URL `#aggregate`. **This is the deterministic best-3 projection display (Decision 12) — the single most load-bearing element of INCR-17.**

### A.1 In-app page-head

| Element | Exact copy | Token / state |
|---|---|---|
| Crumb | `Y. Aidoo › Aggregate construction` | `text-navy-3` |
| `<h1>` | `Aggregate · ` + `<em>10</em>` + ` · construction shown` | `font-display 24px`; gold italic `<em>` (the `10` = `projected_aggregate` / `mock_2_aggregate`) |
| Action `WAEC rule` | `WAEC rule` | `.btn` — read/nav to the WAEC best-3 rule reference (`lib/wassce/` grading constant). OK. |
| Action `Universe match panel` | `Universe match panel` | `.btn` — **nav → INCR-17b** (university match, §6). **Inert in INCR-17** (target not built). *(Surface typo "Universe" for "Universities" — flag at surface-sync, Part J.)* |

### A.2 Layout

`.layout` inner grid `grid-template-columns:1fr 360px; gap:32px` — **left** the `.agg-builder` (the calculation), **right** the "How aggregate works" explainer + "Projection caveat" cards.

### A.3 The builder (`.agg-builder`) — the best-3 calculation — **THE binding**

White card `rounded-lg border-border padding 24px`. Two `.agg-section` blocks (Cores, Electives) + one `.agg-total`.

**Row anatomy (`.agg-row`, flex, `border-b border-border`, last no border):**
- `.agg-subj` (`13px`, subject name `<b>text-navy</b>` + ` · ` + grade)
- `.agg-points` (`font-mono 12px 600 text-navy-2`, right, min-w 50px — e.g. `3 pts`)
- `.agg-status` pill (`10px uppercase tracking-[0.1em] 600 rounded-full`): `.counted` = `bg-green-bg text-green` · `.dropped` = `bg-bg text-navy-3 border border-border`
- **`.agg-row.dropped`** = whole row **`opacity:0.45`** → **`opacity-45`** (the Decision-12 "greyed-but-visible" mechanic — the dropped subject stays in the DOM, dimmed, so the calculation is auditable).

**Cores block** — `.agg-section-title` `Cores · 4 subjects · best 3 count`:

| Subject (`.agg-subj`) | `.agg-points` | `.agg-status` | Counted? |
|---|---|---|---|
| `English Language · B3 (projected)` | `3 pts` | `Counted` | ✅ (grade is **projected** — medical hold) |
| `Mathematics (Core) · B2` | `2 pts` | `Counted` | ✅ |
| `Integrated Science · A1` | `1 pt` | `Counted` | ✅ |
| `Social Studies · B3` | `3 pts` | `Dropped — 4th core` | ❌ `.dropped` `opacity-45` |

**Electives block** — `.agg-section-title` `Electives · 4 subjects · best 3 count`:

| Subject | `.agg-points` | `.agg-status` | Counted? |
|---|---|---|---|
| `Chemistry · A1` | `1 pt` | `Counted` | ✅ |
| `Biology · A1` | `1 pt` | `Counted` | ✅ |
| `Physics · B2` | `2 pts` | `Counted` | ✅ |
| `Elective Mathematics · C4` | `4 pts` | `Dropped — lowest` | ❌ `.dropped` `opacity-45` |

**`.agg-total`** (`flex justify-between border-t-2 border-navy padding-top 14px`):
- `.agg-total-lbl` `Aggregate · best 3 cores + best 3 electives` (`11px uppercase tracking-[0.14em] text-navy-3 600`)
- `.agg-total-val` `10` (`font-display 36px 500 text-green`)

**The math (deterministic best-3, Decision 12):** cores best 3 = English 3 + Math 2 + IntSci 1 = **6**; electives best 3 = Chem 1 + Bio 1 + Phys 2 = **4**; **aggregate = 10** (min 6 / max 54). Lower = better.

> **Binding (proposed — Kofi/Wells confirm at INCR-17):**
> - **Per-subject grade + points** → `mock_results.grade` (Mock-2, `is_predictor`) for each `wassce_candidate_subject` of the candidate, mapped to points via the `lib/wassce/` A1–F9 point scale (A1=1…F9=9 — the same constant as INCR-15 §1.5/§5.2). `English Language · B3 (projected)` = the Mock-2 grade held through the SC-12 disruption (Part F).
> - **counted vs dropped** → computed by the **best-3 lib** (`lib/wassce/projection.ts`): of the 4 cores keep the 3 lowest-point; of the 4 electives keep the 3 lowest-point. Dropped subject stays rendered (`opacity-45`) — **do NOT filter it out of the payload**; the drop is a display state, not a data omission (Decision 12).
> - **`.agg-total-val 10`** → `wassce_candidates.projected_aggregate` (INCR-17 computes; INCR-15/16 left NULL). Equals `mock_2_aggregate` for the holding case.
> - **⚠️ TIE-BREAK FLAG (Part J):** English B3 (**projected**, 3 pts) is **counted** while Social Studies B3 (**actual**, 3 pts) is **dropped** — both are 3 pts, a tie. The best-3 lib needs a **deterministic tie-break rule** (and it must be reproducible: here the projected core is kept over the actual core). Kofi must rule the tie-break order (subject registration order? core-priority? deterministic sort key) so the visualizer and the stored aggregate never disagree. This is a real projection-engine decision, not a display nicety.

### A.4 Right rail — "How aggregate works" explainer (`bg-surface border-border rounded-lg padding 20px 22px`)

`.agg-section-title` `How aggregate works`. Three `<p>` (`12px text-navy-2 leading-[1.7]`):
1. `WASSCE grades convert to points on a 1–9 scale: **A1=1, B2=2, B3=3, C4=4, C5=5, C6=6, D7=7, E8=8, F9=9**. A1–C6 are credit passes (count for university). D7–F9 do not count.`
2. `The **aggregate** is the sum of points from the best 3 cores plus the best 3 electives. The minimum possible is 6 (six A1s); the maximum is 54.`
3. `Lower aggregate = better. Universities publish a **cut-off**, which is the worst aggregate they admit for that programme. KNUST Biochemistry cut-off is 11 — Y. Aidoo's 10 is one place inside.`

Then a grade-chip strip (`.grade-chip.sm` × 8: A1 B2 B3 C4 C5 C6 D7 F9 — palette A) + a 3-col band legend (`10px text-navy-3`): `**1–6** credit pass` (green) · `**7–8** below credit` (warn) · `**9** fail` (terra).

> **Binding:** all of A.4 is the **WAEC grading/aggregate constant** (`lib/wassce/` — the same one INCR-15 §1.5/§5.2 established). **No DB table.** The `cut-off 11` / `one place inside` clause references KNUST Biochemistry = **INCR-17b** (university target) — render the copy, but the cut-off comparison is a 17b binding; in pure INCR-17 either soften to the generic cut-off explainer or gate the target-specific line behind 17b.

### A.5 Right rail — "Projection caveat" card (`bg-gold-bg border-gold-soft rounded-lg padding 16px 18px`)

Eyebrow `Projection caveat` (`11px uppercase tracking-[0.12em] text-gold 700`). Body (`12px text-navy-2 leading-[1.6]`):
`English Language is projected at B3 from Mock 2. If the SC-12 make-up sitting yields a different grade, aggregate updates automatically. Current projection holds at 10 until WAEC releases scores in mid-August.`

> **Binding:** the caveat is the **medical-hold narration** (Part F / Decision 11). "projected at B3 from Mock 2" ← the counted English grade is `mock_results` Mock-2 (not a WASSCE result). "If the SC-12 make-up sitting yields a different grade, aggregate updates automatically" ← on `waec_special_consideration` resolution → make-up `wassce_results` posted → recompute. "holds at 10 until WAEC releases scores in mid-August" ← `projected_aggregate` frozen while `wassce_results` absent. **Show this card only when the candidate has an active/unresolved `waec_special_consideration` affecting a counted subject** — it is the conditional medical-hold affordance.

---

# PART B — Projection display · Mock 1 → Mock 2 → projected

The projection is shown at three grains: the **trajectory strip** (whole-candidate aggregate, §1), the **subject cards** (per-subject grade trajectory, §3), and the **ledger projection callout** (the reasoning, §4 — contextual).

## B.1 Trajectory strip (`.traj-strip`, §1) — whole-candidate aggregate trajectory

**Surface lines 480–499.** Three `.traj-cell` (`grid-cols-3 gap-16`), white `rounded-lg border-border padding 18px 20px`; the third carries `.traj-projected`.

| Cell | `.traj-stage` | `.traj-aggregate .num` | `.traj-band` | `.traj-bar-fill` |
|---|---|---|---|---|
| 1 | `Mock 1 · Nov 2025` | `14` + `aggregate` | `Very good band · 13–18` | `.t1` `bg-warn` width **35%** |
| 2 | `Mock 2 · Mar 2026` + `<span class="traj-arrow">↑ 4 places</span>` | `10` + `aggregate` | `Top tier · 6–12` | `.t2` `bg-green` width **78%** |
| 3 (`.traj-projected`) | `WASSCE projected` + `<span class="traj-arrow">→ holding</span>` | `10` + `aggregate` | `Med-disruption risk on English papers` | `.t3` `bg-gold` width **74%** |

`.traj-aggregate .num` = Fraunces 36px 500. `.traj-arrow` = green 12px 700; `.traj-arrow.down` = terra. `.traj-projected` bg = `linear-gradient(135deg,#F5EBDC,var(--gold-bg))` border `gold-soft`.

**Trust line** (below strip, `12px text-navy-3 leading-[1.6] padding 10px 4px 18px`):
`The Mock 2 → projected step is a holding projection. Omnischools does not adjust the projected aggregate based on the missed English papers until the SC-12 make-up sitting is scored — adjusting now would build false signal into university-target conversations. The aggregate band reads as projected; the disruption banner reads as live.`

> **Binding (proposed):**
> - **Mock 1 `14`** → best-3 aggregate of `mock_results` **Mock-1** grades. **⚠️ K4 named only `mock_2_aggregate`** — the strip needs a **Mock-1 aggregate too.** Recommend **compute both on-read** via the best-3 lib (consistent with INCR-16's "no stored `predicted_grade`, derive on read"); store at most a snapshot. Flag Kofi: add `mock_1_aggregate` or derive-on-read.
> - **Mock 2 `10`** → `mock_2_aggregate` (INCR-17 real).
> - **Projected `10`** → `projected_aggregate` (INCR-17). `→ holding` = medical-hold (Part F).
> - **`↑ 4 places`** → derived Mock1→Mock2 aggregate delta (14→10 = 4 lower = 4 places better). Not stored.
> - **Bands** (`Very good band · 13–18`, `Top tier · 6–12`) → `lib/wassce/` aggregate-band constant (**same bands** as INCR-16 cohort-distribution: 6–12 top / 13–18 very good / 19–24 fair / 25–36 weak / 37+ no path). Reuse.
> - **Bar widths (35/78/74%)** → **display scale only** (lower aggregate → fuller bar; inverted). Derive from aggregate, do NOT store. Note the projected bar (74%) sits just under the Mock-2 bar (78%) to visually encode "holding, slight disruption risk."

## B.2 Subject-by-subject cards (`.subj-grid`, §3) — per-subject grade projection

**Surface lines 838–955.** Editorial head: `03 · Subject-by-subject readiness · Mock 1 → Mock 2 → projected · 8 subjects · 4 cores · 4 electives (1 alternate)`. URL `#subjects`. Page-head: crumb `Y. Aidoo › Subject trajectory`; `<h1>` `Subjects · <em>Mock 1</em> → <em>Mock 2</em> → projected`; actions `Compare to cohort` (`.btn`, nav → INCR-18, inert) · `Subject teachers` (`.btn`, nav, read).

`.subj-grid` = `grid-cols-2 gap-12`. Each `.subj-card` = white `rounded-lg border-border padding 18px 20px`; `.core` = `border-t-3 border-gold`; `.elective` = `border-t-3 border-green`.

**Card anatomy:**
- `.subj-head`: `.subj-name` (Fraunces 16px) + `.subj-type` (`10px uppercase text-navy-3 600`) · right `.subj-grades` with the **projected/final** `.grade-chip` (36px, palette A)
- `.subj-traj-row` (`bg-bg rounded-sm padding 10px`, `grid-cols-[60px_1fr_60px_1fr_60px]`): `M1` → `.grade-chip.sm` → `M2` → `.grade-chip.sm` → `WASSCE` (empty; populates after August results)
- `.subj-comment` (`12px text-navy-2 border-t padding-top 12px`): named-teacher comment, bold lead `text-navy`
- `.subj-paper-meta` (`11px text-navy-3 border-t-dashed`): paper status

**8 cards (verbatim — name / type / M1→M2→final chip / comment author + tail / paper-meta):**

| # | Subject | Type | M1 | M2 | Final chip | Comment (author + key clause) | Paper-meta |
|---|---|---|---|---|---|---|---|
| 1 | English Language | `Core · all programmes` | C4 | B3 | **B3** | `Mrs A. Pomaa (English HOD):` … `Missed all three English papers due to hospitalisation — projection held at B3 pending make-up sitting.` | `Oral · MISSED` · `Lang 1 · MISSED` · `Lang 2 · MISSED` |
| 2 | Mathematics (Core) | `Core · all programmes` | B3 | B2 | **B2** | `Mr K. Asare (Math HOD):` … `Math 1+2 sit Wed 3 Jun.` | `Paper 1 · 3 Jun · 08:00` · `Paper 2 · 3 Jun · 11:00` |
| 3 | Integrated Science | `Core · all programmes` | B2 | A1 | **A1** | `Mrs C. Owusu (Int Sci):` … `Mock 2 raw score 89/100 — top quartile … Paper sits Tue 26 May.` | `Paper 1+2 combined · 26 May · 08:00` |
| 4 | Social Studies | `Core · all programmes` | C4 | B3 | **B3** | `Mr E. Boateng (Social):` … `Paper 1 sat Mon 12 May — performance pending. Paper 2 (essay) scheduled but not yet timetabled by WAEC.` | `Paper 1 · 12 May · SAT` · `Paper 2 · pending` |
| 5 | Chemistry | `Elective · Science programme` | B2 | A1 | **A1** | `Mr S. Asiedu (Chem · Form Master):` … `Paper sits Mon 8 Jun.` | `Paper 1+2 combined · 8 Jun · 08:00` |
| 6 | Physics | `Elective · Science programme` | B3 | B2 | **B2** | `Mr D. Owusu (Phys):` … `Practical paper sat in April — no medical issue at that time.` | `Practical · 22 Apr · SAT` · `Paper 1+2 · 9 Jun · 11:00` |
| 7 | Biology | `Elective · Science programme` | B2 | A1 | **A1** | `Mrs F. Annan (Bio):` … `Paper sits Thu 11 Jun.` | `Practical · 24 Apr · SAT` · `Paper 1+2 · 11 Jun · 08:00` |
| 8 | Elective Mathematics | **`Elective · Science programme · dropped`** | C5 | C4 | **C4** | `Mr K. Asare (Elec Math):` … `drops out of the best-3 calculation … this paper does not count for her aggregate per WAEC's best-3 rule.` | `Paper 1+2 · 13 Jun · 08:00 · not in best-3` |

> **Binding (proposed):**
> - **M1 / M2 chips** → `mock_results.grade` (Mock-1, Mock-2) per subject. **In scope for INCR-17's read** (the projection input; the grades themselves are INCR-16 data). The **final chip** = the **projected WASSCE grade = Mock-2 grade** (Decision 2, `COALESCE(moderated_grade, grade)` of the predictor mock). Not a separate field.
> - **`WASSCE` column empty** → populates from `wassce_results` after WAEC release (Aug). Render em-dash / empty band until then.
> - **`.subj-comment`** → `mock_results.moderation_reason` / teacher note (INCR-16 free text; author = subject teacher). Append-only. Raw scores in prose ("raw 89/100") = `mock_results.raw_score`. **Read-only here** (authored on the subject-teacher surface, INCR-16).
> - **Card 8 "dropped"** → the §3 dropped treatment is **by label** (`.subj-type` "· dropped" + comment + "not in best-3"), **NOT** by opacity (unlike §5's `opacity-45`). The card stays **fully visible** so the reasoning is auditable (Decision 12). The `dropped` flag = output of the same best-3 lib as §5. Two surfaces, one calculation.
> - **`.subj-paper-meta` MISSED / SAT / pending** → `wassce_paper_sittings` sitting status + `waec_special_consideration` link (the three English MISSED entries ← the SC-12). This is the SC/schedule join (Part D), rendered per-subject.

## B.3 Ledger projection callout (`.lt-projection-callout`, §4) — CONTEXTUAL reasoning

**Surface lines 1150–1153.** The §4 section (`04 · Ledger trajectory · Mathematics · what the predictor sees that STPSHS does not`) renders a **30-cell 6-semester ledger grid** — **this grid is CONTEXTUAL** (build-plan Decision B: "the 6-semester ledger trajectory is CONTEXTUAL … a supporting strip, not the formula") and is a **frozen READ of `senior_score_ledger`** (INCR-20 chrome; must NOT re-run `compile.ts`). **This map takes only the projection CALLOUT** at the foot, which explains *how* the trajectory produces the projected grade:

Gold-gradient card (`linear-gradient(135deg,#F5EBDC,var(--gold-bg))` border-top `gold-soft`, `padding 18px 22px`). `<h5>` `How <em>this trajectory</em> produces the projected B2`. Body (`12px text-navy-2 leading-[1.6]`):
`The model that turns ledger trajectory into WASSCE-grade projection reads three signals from this table. **Level** — F3 S2 weighted total 81.4 sits squarely in the A1 / B2 boundary band … **Slope** — the F2-S2-to-F3-S2 acceleration (73.5 → 81.4 …) is itself predictive … **Component shape** — end-of-sem scores (62 → 82) climbing faster than mid-sem (58 → 78) is the WASSCE-shaped profile … Mock 2 said B2; the trajectory says B2 is the floor, not the ceiling. The projection holds the floor.`

> **Binding / scope note:** the callout **narrates** the projection but the **operative projection is Mock-2-anchored, NOT ledger-weighted-total→band math** (build-plan Decision B, emphatic). So this callout is **explanatory copy**, not a formula the engine runs. Render it as **static per-subject narration** (or a `lib/wassce/` template) — do **not** implement a ledger-slope model in INCR-17. The one open domain nuance (is the trajectory purely contextual, or a tie-breaker/confidence adjust?) is a **Kofi call** — flag Part J. The 30-cell grid + "What STPSHS sees / What Omnischools sees" foot (lines 1024–1148) = **INCR-20 ledger context, NOT INCR-17** — noted, not mapped.

## B.4 Projected-aggregate on the identity card (`.student-card`, §1)

**Surface lines 455–477.** The §1 identity card is mostly INCR-20 chrome (avatar, index, House, parent, NHIS), but its **right column is the projected-aggregate display** — in scope:
- `.sc-agg-label` `Projected aggregate` (`10px uppercase tracking-[0.14em] text-navy-3 600`)
- `.sc-agg-value` `10` (Fraunces **48px** 500 `text-green`)
- `.sc-agg-meta` `Mock 2 actual · WASSCE in flight`

> **Binding:** `.sc-agg-value` → `wassce_candidates.projected_aggregate` (INCR-17). `Mock 2 actual · WASSCE in flight` = the provenance label (projected from Mock 2, no WASSCE result yet). **Render the rest of the identity card as INCR-20** — take only the aggregate cell here. (Identity-card `.sc-pill.sci` green-tint drift noted §0.3.)

---

# PART C — (reserved)

*(No standalone Part C section; projection grains folded into Part B.)*

---

# PART D — SC-12 / special-consideration context + SC-form artifact

INCR-15 rendered SC-3/SC-7/SC-12 as **static policy display** (`wassce-setup` §5). **INCR-17 makes SC-filing a real artifact** (`waec_special_consideration` table). The surface shows the **filed SC-12 as a read artifact** (banner + xmod + per-paper markers) — it does **NOT** draw a blank filing form, so the **filing UI is DERIVED** below (D.6), following house style, per the increment's write requirement.

## D.1 Medical-disruption banner (`.disruption-banner`, §1) — the live SC-12 case header

**Surface lines 408–452.** Terra-gradient card (`linear-gradient(135deg,#B84A39,#8B3829)` — dark-terra tail bespoke, §0.3), `text-bg`, shadow `rgba(184,74,57,0.4)`. Sticky to page top while the case is live.

| Sub-element | Exact copy | Token / state |
|---|---|---|
| `.db-icon` | `⚕` (Fraunces glyph) | 38px `rounded-md` `bg-[rgba(255,255,255,0.16)]` |
| `.db-eyebrow` | `Active medical disruption · WASSCE day 2` | `10px uppercase tracking-[0.16em] opacity-70 600` |
| `.db-headline` | `Y. Aidoo missed <em>Oral English</em> (Tue) and <em>English Lang 1 + 2</em> (Wed) · WAEC SC-12 filed at 11:00 · make-up scheduling in progress` | `font-display 20px 500`; `<em>` `#F5D4C9` italic |
| `.db-pulse` | `Live case` + pulsing dot | pill `bg-[rgba(255,255,255,0.12)]`; `.db-pulse-dot` `#FFD4C9` pulse |
| `.db-body` | `Admitted to Asankrangwa Govt Hospital Ward B bed 7 at 06:45 with severe malaria (NHIS-covered). Matron Mrs G. Bediako accompanied; clinician declared candidate "unfit to sit" before the 08:00 paper. WAEC special consideration form SC-12 filed by Mrs Owusu-Ansah at 11:00 with attached hospital admission slip and clinician's letter. WAEC Regional Office acknowledged 11:32. Make-up paper sitting expected within the WASSCE window per WAEC convention; date pending. All four parties (parent A. Aidoo, KNUST Admissions liaison, WAEC, school) are on the comms thread.` | `13px leading-[1.6] opacity-92 max-w-860` |

**`.db-grid`** — 4 cells (`grid-cols-4`, each `bg-[rgba(255,255,255,0.08)] rounded-md padding 12px 14px`; label `10px uppercase opacity-65 600`, value Fraunces 15px 500, meta `11px opacity-70`):

| Cell | Label | Value | Meta |
|---|---|---|---|
| 1 | `Admitted` | `Tue · 06:45` | `Ward B · bed 7` |
| 2 | `Papers missed` | `3 of 3 scheduled` | `Oral · Lang 1 · Lang 2` |
| 3 | `SC-12 status` | `Acknowledged` | `WAEC ref · SC-12-184-2026-0044` |
| 4 | `Next paper` | `Math · Wed 3 Jun` | `19 days · fit-to-sit pending` |

**`.db-actions`** (`flex gap-8 flex-wrap`):
- `View SC-12 form` (`.db-btn` `bg-[rgba(255,255,255,0.92)] text-terra 700`) — **read → opens the filed SC-form artifact (D.6).**
- `Sickbay referral log` · `Parent comms thread` · `Hospital ward updates` (`.db-btn-ghost` `bg-[rgba(255,255,255,0.12)] border-[rgba(255,255,255,0.3)]`) — **cross-module nav, targets not built (Sickbay 4.4 / comms) → inert.**

> **Binding (proposed → `waec_special_consideration`):**
> - `sc_type` = `SC-12` (exam-day medical); enum `SC-3` (sensory/physical) · `SC-7` (known chronic) · `SC-12` (exam-day medical) — the `lib/wassce/` SC vocabulary from INCR-15 §5.2 becomes an enum here.
> - `candidate_id` → `wassce_candidates` (composite FK). `filed_by_user_id` = "Mrs Owusu-Ansah" (HoA / staff, single-column SET NULL). `filed_at` = `11:00`. `status` enum `FILED → ACKNOWLEDGED → APPROVED → (make-up) RESOLVED` (INCR-15 roster also showed "SC-7 filed", "SC-3 approved" → filing/approval states exist). `waec_ref` = `SC-12-184-2026-0044` (mono). `acknowledged_at` = `11:32`.
> - **Attached docs** ("hospital admission slip and clinician's letter") → file refs (reuse the receipt-PDF/file path). **Affected papers** ("Oral · Lang 1 · Lang 2", `3 of 3`) → link rows to `wassce_paper_sittings` (the MISSED sittings) — a `waec_special_consideration_paper` join, OR a paper-id array. Flag Wells.
> - `clinician "unfit to sit"`, `NHIS-covered`, ward/bed, matron escort → **cross-module Sickbay (4.4, not built)** — in INCR-17 these are **static fields on the SC record / candidate flag**, NOT a live sickbay pull (Sickbay→SC-12 auto-suggest is Decision 9, deferred). Same treatment as INCR-15 §4.2 banner.
> - **Conditional render:** show the banner only when the candidate has an **open** `waec_special_consideration` (`status != RESOLVED`). The "sticky until case closes" behaviour = client sticky positioning driven by open-status.

## D.2 Per-paper SC markers (§2 schedule — SC context only)

**Surface lines 688–713, 762–763.** §2 is the paper-by-paper schedule (**INCR-20**, not mapped whole), but its **SC-12 markers** are the SC context: missed rows (`.sch-row.missed` `bg-#FBEBE7`) carry status pill `Missed · medical` (`.sch-status.missed` `bg-terra-bg text-terra`) + action `SC-12 filed` (`.sch-action text-gold 600`), and a make-up convention note (`SC-12 make-up convention. WAEC offers make-up sittings … within the live exam window … rescheduled — typically within 10 working days of fitness restoration — at the regional WAEC office in Sefwi-Wiawso, not at the school centre …`).

> **Binding:** the `Missed · medical` / `SC-12 filed` markers are the **join between `wassce_paper_sittings` (missed sitting) and `waec_special_consideration` (the SC covering it).** In-scope as **SC context**; the full schedule table is INCR-20. The make-up convention copy = static `lib/wassce/` policy text (WAEC handles make-ups off-centre — the school does not set the date).

## D.3 SC-12 cross-module card (`.xmod`, §7) — the SC-form artifact link

**Surface lines 1657–1662.** One `.xmod` card (white `rounded-lg border-border padding 16px 18px`):
- `.xmod-eyebrow` `WAEC` (`10px uppercase text-gold 600`)
- `.xmod-title` `SC-12 special consideration` (Fraunces 15px 500)
- `.xmod-meta` `Form filed 11:00 by Mrs Owusu-Ansah · acknowledged 11:32 · ref SC-12-184-2026-0044.`
- `.xmod-link` `View form PDF →` (`11px text-gold 600`)

> **Binding:** same `waec_special_consideration` row as D.1. `View form PDF →` → the SC-form rendered as a PDF (reuse receipt-PDF path #136). **The other 5 §7 xmod cards** (Sickbay referral, Billing NHIS, Boarding, VLC, Transcripts) = **INCR-20 cross-module context, NOT mapped.**

## D.4 Aggregate-visualizer SC linkage (recap)

The §5 "Projection caveat" (A.5) and the counted **English B3 (projected)** row (A.3) are driven by the same open `waec_special_consideration` — the SC record is what makes English's grade "projected" and the aggregate "held." See Part F.

## D.5 SC-form anchors on `wassce-setup` §5 — POLICY-DISPLAY ONLY

Per the INCR-15 map (`docs/senior/wassce-spine-surface-map.md` §5.2), `wassce-setup` §5 renders the SC vocabulary as **static policy text**: `**SC-3** (sensory/physical), **SC-7** (known chronic condition), **SC-12** (exam-day medical). Filed via WAEC online portal; medical cert from registered facility required.` — a `lib/wassce/` **constant**, **no filing UI**. **INCR-17 does NOT add a filing form to setup §5.** The real SC-form **artifact + filing** lives on the **student-readiness** surface (D.1/D.3/D.6). Setup §5 stays policy-display; INCR-17 may promote the constant to a `sc_type` enum backing `waec_special_consideration`.

## D.6 SC-form FILING — WRITE state spec (DERIVED; INCR-17 makes SC-filing real)

The surface shows the **filed** SC-12 (read). INCR-17 builds the **filing** flow. Reuse the setup/ledger `.card` + `.btn` chrome + native inputs; no new form lib.

| State | Spec | Binds to |
|---|---|---|
| **entry point** | From the medical banner (`View SC-12 form` opens the filed record) and/or a `File SC-form` affordance on the candidate. **No blank-form button is drawn** — derive one. | — |
| **empty / new** | Form fields: `sc_type` select (SC-3 / SC-7 / SC-12), `candidate` (pre-filled), affected `papers` (multi-select from the candidate's `wassce_paper_sittings`), `reason` text, medical-cert / attachment upload (file), `filed_by` (session user). Native `<input>`/`<select>`. | new `waec_special_consideration` row |
| **validation-error** | `sc_type` required; at least one affected paper for SC-12 (exam-day); attachment required for SC-12 (medical cert). Inline `text-terra`. | validation on write |
| **filed** | `status=FILED`, `filed_at`, `waec_ref` captured; banner flips to "filed, awaiting acknowledgement"; per-paper markers show `SC-N filed`. Audit-log. | `waec_special_consideration.status` |
| **acknowledged** | `status=ACKNOWLEDGED`, `acknowledged_at`, `waec_ref` (e.g. `SC-12-184-2026-0044`) — banner cell 3 "Acknowledged". | |
| **approved** | `status=APPROVED` (SC-3/SC-7 chronic accommodations approved ahead of time — INCR-15 roster "SC-3 approved Jan"). | |
| **resolved** | Make-up sitting scored / accommodation applied → `status=RESOLVED`; banner un-sticks; projection may recompute (Part F). | |

> **Authz (proposed — Kofi/Sarah confirm):** filing = **`WASSCE_SETUP_ROLES`** (ADMIN / HEADMASTER / **VICE_HEADMASTER_ACADEMIC** = Head of Academics). The surface files SC-12 as "Mrs Owusu-Ansah" (HoA). Possibly also **Form Master** for the candidate's form — flag. **Sickbay→SC-12 auto-suggest is DEFERRED to 4.4** — INCR-17 is **manual filing only** (build-plan line 2086). Do NOT wire a sickbay trigger.

---

# PART E — Readiness-statement artifact + parent-acknowledgement

The readiness statement is the **generated, parent-signable artifact** that snapshots the projection (Part A/B) — described in INCR-16 setup §2 as *"the Mock 2 grade is the readiness statement's projected WASSCE grade"* and *"Mock 2 drives the readiness statement."* The surface shows the **parent-acknowledged** end-state (§7); the **generate** and **unsigned** states are DERIVED (E.2).

## E.1 Parent-acknowledgement block (`.parent-ack`, §7) — the signed artifact

**Surface lines 1594–1603.** White card `rounded-lg border-border padding 20px 24px`; `.pack-row` = `grid-cols-[auto_1fr_auto] gap-20 items-center`:
- `.pack-icon` = 48px `rounded-md bg-green-bg`, `::before` `✓` `text-green 22px` (the acknowledged state)
- `.pack-title` `Parent acknowledged Mock 2 readiness statement on 28 Mar 2026` (Fraunces 16px 500)
- `.pack-meta` `**A. Aidoo** · phone-OTP signature · agreed with KNUST Biochemistry as primary target · agreed with three supporting programmes · expressed concern about commute distance to KNUST` (`12px text-navy-3`, bolds `text-navy`)
- `.pack-link` `View signed PDF →` (`12px text-gold 600`)

> **Binding (proposed → `readiness_statements`):**
> - one row per candidate × mock-cycle (the "Mock 2 readiness statement"). `generated_from_mock_id` → the `is_predictor` mock. `projected_aggregate_snapshot` = the aggregate at generation (10). `per_subject_grades_snapshot` = the Mock-2 grades (§3) — a JSON snapshot so the statement is immutable even if grades later change.
> - `parent_ack_at` = `28 Mar 2026`; `parent_ack_by` = `A. Aidoo` (mother; the candidate's `guardian`/`parent` contact). `signature_method` = **`phone-OTP`** (convention `OTP`, never "code/PIN" — `design-tokens.json._conventions.terminology`). `parent_note` = free text ("expressed concern about commute distance to KNUST").
> - **`parent_signature_pdf_file_id`** → `View signed PDF` — **reuse the portable receipt-PDF path (#136)** (build-plan line 2082). No new PDF dep.
> - **⚠️ 17b bleed:** "agreed with KNUST Biochemistry as primary target · agreed with three supporting programmes" references **university targets = INCR-17b.** The **artifact + signature capture is INCR-17**; the **target lines in the statement body are 17b.** In pure INCR-17, generate the statement with the **projection + aggregate** sections real and the **university-target section deferred/omitted** until 17b (or rendered from seeded targets). Flag Kofi: does the readiness statement ship without the target section in 17, or wait for 17b?

## E.2 Readiness-statement GENERATE + ACK — WRITE state spec (DERIVED)

The surface draws only the **acknowledged** state. INCR-17 builds **generate → send → acknowledge**. Reuse `.card`/`.btn` chrome + the receipt-PDF path.

| State | Visual | Binds to / behaviour |
|---|---|---|
| **none** | No statement yet → an affordance to generate (the §1 head-action **`Share with parent`** is the closest drawn control; a dedicated `Generate readiness statement` may be added). | — |
| **generated / unsigned** | Statement PDF exists (snapshot of projection + aggregate); `.pack-icon` neutral (not green-check), `.pack-title` "Readiness statement generated · awaiting parent acknowledgement", `.pack-link` `View PDF →`. | `readiness_statements` row created; `parent_ack_at IS NULL` |
| **sent (parent notified)** | Parent notified via SMS/OTP link (**owner-gated — see below**). Status "Sent · awaiting signature". | send event |
| **parent-acknowledged** | The drawn state: green `✓`, "Parent acknowledged … on {date}", `phone-OTP signature`, `View signed PDF →`. | `parent_ack_at`, `signature_method=phone-OTP`, `parent_signature_pdf_file_id` |
| **superseded / regenerated** | If Mock/projection changes, a new statement supersedes (append-only, per `design-tokens.json._conventions.audit` — never erase; the prior signed PDF stays). | new row referencing prior |

> **Authz (proposed):** **generate** = HoA / `WASSCE_SETUP_ROLES` (the school issues the statement; persona is Mrs Owusu-Ansah, Head of Academics). **Parent-ack** is **parent-side** (parent portal = INCR-19) OR captured by the school on the parent's behalf via OTP — confirm with Kofi (the ack UI may live in INCR-19; the artifact + signature-capture columns are INCR-17). `Share with parent` (§1 head-action) triggers the send.
>
> **🚩 OWNER-GATED / CONSOLE-DEGRADING SLICE — the parent-ack SMS.** Build-plan line 2084: *"parent-ack SMS provider (same Hubtel gate as 4.2 — blocks the parent-ack slice of INCR-17/19)."* The **phone-OTP signature capture depends on the Hubtel SMS provider**, which is owner-gated. **Flag to owner:** ship INCR-17 with the readiness-statement **generate + PDF + View** working, and **degrade the parent-ack-via-SMS to a console/manual path** (or defer the OTP send) until the SMS provider is provisioned — exactly as 4.2 handled it. The statement artifact does NOT block on SMS; only the OTP-signature leg does.

---

# PART F — Medical-hold state (Decision 11) — cross-cutting master spec

**Decision 11 (build-plan line 2065): the projection HOLDS through medical disruption.** Y. Aidoo is the canonical medical-hold candidate: hospitalised on WASSCE day 2, missed all three English papers, SC-12 filed. The projection does **not** degrade the aggregate for the missed papers until the SC-12 make-up sitting is scored. This state threads through every in-scope section:

| Where | Medical-hold expression | Data |
|---|---|---|
| §1 banner (D.1) | The live SC-12 case, sticky | open `waec_special_consideration` (SC-12) |
| §1 trajectory strip (B.1) | Projected cell `→ holding`; band "Med-disruption risk on English papers"; bar 74% (just under Mock-2 78%) | `projected_aggregate = mock_2_aggregate` (unchanged) |
| §1 trust line (B.1) | "does not adjust the projected aggregate … until the SC-12 make-up sitting is scored — adjusting now would build false signal" | policy narration |
| §3 English card (B.2) | Final chip B3; comment "projection held at B3 pending make-up sitting"; paper-meta all MISSED | `mock_results` Mock-2 grade held; sittings MISSED |
| §5 English row (A.3) | `English Language · B3 (projected)` **Counted** (not dropped, despite being projected) | best-3 counts the projected grade |
| §5 caveat (A.5) | "If the SC-12 make-up sitting yields a different grade, aggregate updates automatically. … holds at 10 until WAEC releases scores in mid-August." | recompute-on-resolution |

> **Engine rule (proposed for Kofi):** while a candidate has an **open `waec_special_consideration`** covering a **counted** subject, the projection uses that subject's **Mock-2 grade** (the last valid signal) and **freezes `projected_aggregate`** — it does **not** substitute a fail/absent grade for the missed papers. On SC resolution (make-up `wassce_results` posted, or accommodation applied), the engine **recomputes once** (no manual adjustment — §5 notes "aggregate recomputes once"). The **medical-hold is a boolean/derived state** (`has_open_sc_affecting_counted_subject`) that drives: the sticky banner, the `→ holding` arrow, the caveat card, and the "(projected)" label on the counted grade. **This is the behaviour that must survive the SC-12 disruption unchanged (Decision 11).**

---

# PART G — Write / generation / authz control inventory

| Control (section) | Kind | Authz (proposed) | INCR-17 treatment |
|---|---|---|---|
| **File SC-form** (D.6; entry via `View SC-12 form`, §1) | **WRITE** | `WASSCE_SETUP_ROLES` (HoA/Headmaster/Admin); possibly Form Master — confirm | **Build manual SC filing** (`waec_special_consideration`). Manual only; NO sickbay auto-suggest (deferred 4.4). |
| **Generate readiness statement** (E.2; `Share with parent`, §1) | **WRITE** | HoA / `WASSCE_SETUP_ROLES` | Build generate + PDF (reuse receipt-PDF #136). |
| **Parent-acknowledge** (E.1) | **WRITE** (signature) | Parent-side (portal → INCR-19) or school-captured via OTP | Artifact + signature columns in INCR-17; **ack-via-SMS owner-gated (Hubtel) → degrade/defer.** |
| `View SC-12 form` (§1 `.db-btn`) | Read | any in-scope reader | Opens filed SC artifact. OK. |
| `View form PDF →` (§7 xmod) · `View signed PDF →` (§7 ack) | Read | reader | PDF read (reuse #136). OK. |
| `WAEC rule` (§5) | Read/nav | reader | To grading constant. OK. |
| `Print profile` (§1) · `Export trajectory` (§4) | Read/export | reader | OK to wire/stub. |
| `Compare to cohort` (§3) | Nav → INCR-18 | reader | **Inert** — target not built. |
| `Universe match panel` (§5) · `Subject teachers` (§3) · `Make-up scheduling` (§1) | Nav | reader | **Uni panel → INCR-17b (inert)**; subject-teachers → INCR-16 surface; make-up scheduling = WAEC-owned process (inert/out). |
| `Sickbay referral log` / `Parent comms thread` / `Hospital ward updates` (§1 `.db-btn-ghost`) | Nav (cross-module) | reader | **Inert** — Sickbay (4.4) / comms not built. |
| `Switch subject` / `Open in Path A` (§4) | Nav (ledger context) | reader | INCR-20 ledger context — inert here. |

> **Authz spine (for Kofi/Sarah/Wells):** three **write-actions** in INCR-17 — **(1) file SC-form** (HoA), **(2) generate readiness statement** (HoA), **(3) parent-ack signature** (parent-side / SMS-OTP, **owner-gated**). All tenant-scoped, RLS-enforced, audit-logged (append-only). No trigger writes — projection recompute is app-layer/pure-lib. Confirm: does Form Master also file SC / generate statements for their form? Does parent-ack live in 17 or 19?

---

# PART H — Table reconciliation & no-clean-binding flags

**Clean bindings (build against 0053 / read prior migrations):**

| Table | Surface elements |
|---|---|
| `waec_special_consideration` (NEW 0053) | §1 medical banner (D.1) · §2 SC paper markers (D.2) · §7 SC xmod (D.3) · §5 caveat trigger (A.5) · SC filing write (D.6) |
| `readiness_statements` (NEW 0053) | §7 parent-ack (E.1) · generate/ack write (E.2); `parent_signature_pdf_file_id` reuses receipt-PDF #136 |
| `wassce_candidates.projected_aggregate` (INCR-17 computes; was NULL) | §5 `.agg-total-val 10` (A.3) · §1 `.sc-agg-value 10` (B.4) · §1 trajectory projected cell (B.1) |
| `wassce_candidates.mock_2_aggregate` (INCR-15 seeded → INCR-17 real) | §1 trajectory Mock-2 `10` (B.1); equals projected for the holding case |
| `mock_results` (read; INCR-16) | §3 M1/M2 grade chips + comments (B.2) · §5 per-subject grades→points (A.3) · Mock-1/Mock-2 aggregate inputs |
| `wassce_paper_sittings` (read; INCR-15) | §3 paper-meta MISSED/SAT (B.2) · §2 SC markers (D.2) · missed-paper links on the SC record |
| `wassce_candidate_subject` / `wassce_subjects` / `wassce_programmes` (read) | §3/§5 subject set, core/elective classification, best-3 grouping |
| `lib/wassce/` constants (no table) | A1–F9 point scale + aggregate 6→54 rule (A.4) · aggregate bands 6–12/13–18/… (B.1) · SC vocabulary → `sc_type` enum (D.5) · make-up convention copy (D.2) · ledger-callout narration template (B.3) |

**NO clean binding (reconcile / defer / static / flag):**

| Element | Belongs to | INCR-17 render |
|---|---|---|
| **§5 `cut-off 11` / `one place inside`** (A.4) · **§7 ack target lines** (E.1) | **INCR-17b** university target | soften/omit target-specific copy, or seed; the artifact ships without the 17b section |
| **§6 university match** (whole section) | **INCR-17b** | not mapped; nav inert |
| **§1 tie-break: projected English counted over actual Social** (A.3) | projection engine | **needs a deterministic tie-break rule** — Kofi call |
| **Mock-1 aggregate `14`** (B.1) | K4 named only `mock_2_aggregate` | add `mock_1_aggregate` OR derive-on-read via best-3 lib |
| **§4 30-cell ledger grid + STPSHS foot** (B.3) | INCR-20 (frozen `senior_score_ledger` read) | contextual; NOT built in INCR-17. Only the projection **callout** is in-scope (static narration). |
| **§1 STPSHS submission panel, §2 full schedule, §7 context strip + comms log + non-SC xmod** | INCR-20 | not mapped |
| **Sickbay/clinician/NHIS fields on SC banner** (D.1) | Sickbay 4.4 (not built) | static fields on SC record / candidate flag; no live pull; no auto-suggest |
| **parent-ack SMS-OTP send** (E.2) | **owner-gated (Hubtel)** | degrade to console/manual or defer; artifact does not block on it |
| **`.disruption-banner` `#8B3829` / `#F5D4C9` / `#FFD4C9`, `.sc-pill.sci`/`.slessor` tints** (§0.3) | no design token | inline / per-programme/House color; never slash-opacity |
| **trajectory bar widths, `↑4 places`, trajectory delta** (B.1) | display-derived | compute from aggregate; do NOT store |

---

# PART I — Route, responsive & PWA

- **Route:** the browser-bar URLs (`…/wassce/candidates/0184-0817` + `#subjects` / `#ledger-trajectory` / `#aggregate` / `#context`) map to **one candidate route with anchored regions** (mirror the INCR-15/16 single-page-with-anchors precedent). **Tenant-scoped + RLS.** The candidate id in the URL is a **student/candidate** id, not a teacher id (no scope leak like INCR-16's) — but confirm the reader is role-gated (HoA/Form Master/subject teacher scoped to their candidates; parent → INCR-19 portal only).
- **Responsive** (surface `@media` collapses at ~1280px per INCR-15/16 house rule): `.agg-builder` layout `1fr 360px` → **1-col** (builder above explainer); `.traj-strip` 3-col → 1-col; `.subj-grid` 2-col → 1-col; `.db-grid` 4-col → 2-col; `.context-strip`/`.xmod-grid` (INCR-20) → 1-col. The §4 ledger grid (context) keeps `overflow-x:auto` with sticky-left category column (reuse `ColumnScoreGrid` mechanics). The **aggregate builder rows stack cleanly** (flex) — no special collapse.
- **PWA:** no dedicated `-pwa.html` variant for INCR-17. The readiness-statement **PDF** reuses the portable receipt-PDF path (#136, one-page). No new offline surface.

---

# PART J — Open questions / drift log (for Kofi / Wells / Sarah)

1. **Best-3 TIE-BREAK rule (projection-engine decision).** §5 counts **English B3 (projected)** and drops **Social Studies B3 (actual)** — both 3 pts. The best-3 lib needs a **deterministic, reproducible tie-break** (e.g. registration order, core-priority, or a stable sort key) so the visualizer and the stored `projected_aggregate` never disagree. Notable that a **projected** core is kept over an **actual** core under the tie — confirm that is intended.
2. **`projected_aggregate` semantics + Mock-1 aggregate.** `projected_aggregate` = best-3 of Mock-2 grades = `mock_2_aggregate` for the holding case. K4 named only `mock_2_aggregate`; the trajectory strip also needs a **Mock-1 aggregate** (`14`). Recommend **derive both on-read** via the best-3 lib (consistent with INCR-16 "no stored `predicted_grade`"). Add `mock_1_aggregate` only if a stored snapshot is wanted.
3. **Medical-hold as a first-class derived state (Decision 11).** Confirm the engine freezes `projected_aggregate` while an **open `waec_special_consideration`** covers a **counted** subject, uses the last-valid Mock-2 grade for the missed papers, and **recomputes once** on SC resolution / `wassce_results`. This boolean drives the sticky banner + `→ holding` + caveat + "(projected)" label.
4. **`waec_special_consideration` shape.** `sc_type` enum (SC-3/SC-7/SC-12), `status` enum (FILED→ACKNOWLEDGED→APPROVED→RESOLVED), `filed_by`/`filed_at`/`acknowledged_at`/`waec_ref`, affected-papers link (join to `wassce_paper_sittings` vs id array), attachment file refs. Sickbay/clinician/NHIS fields are **static in INCR-17** (4.4 unbuilt); **no auto-suggest** (Decision 9 deferred). Filing authz = HoA/`WASSCE_SETUP_ROLES` (± Form Master?).
5. **`readiness_statements` shape + snapshot immutability.** Per candidate × mock-cycle: `generated_from_mock_id`, `projected_aggregate_snapshot`, `per_subject_grades_snapshot` (JSON, immutable), `parent_ack_at`/`parent_ack_by`/`signature_method` (`phone-OTP`, convention `OTP`), `parent_signature_pdf_file_id` (**reuse receipt-PDF #136**), `parent_note`. Append-only supersede (never erase a signed PDF).
6. **Readiness statement × INCR-17b bleed.** The statement/ack references **university targets** ("KNUST Biochemistry", "three supporting programmes") = **INCR-17b**. Decide: ship the statement in INCR-17 with **projection + aggregate real** and the **target section deferred/seeded/omitted**, backfilling the target section when 17b lands. The **artifact + signature = 17**; the **target lines = 17b**.
7. **Parent-ack ownership + owner-gated SMS.** Does parent-ack live in INCR-17 (school-captured OTP) or **INCR-19** (parent portal)? Either way the **SMS-OTP send is owner-gated (Hubtel, same gate as 4.2)** — **degrade to console/manual or defer** the OTP leg; the generate + PDF + View do NOT block on SMS. **Flag to owner.**
8. **Ledger trajectory is CONTEXTUAL, not a formula (Decision B).** §4's 30-cell grid + slope/shape callout must **not** become a ledger-weighted-total→band model — prediction is **Mock-2-anchored**. The one open nuance (trajectory as pure context vs a tie-breaker/confidence adjust) is a **Kofi call at INCR-16/17**. Render the callout as static narration; do not import `compile.ts`/`resolveWeights`.
9. **`mock_2_aggregate` goes from seeded → real.** INCR-15/16 rendered it **seeded/display-only** (K4, AC-G16); **INCR-17 computes it** from `mock_results` via the best-3 lib. Verify the INCR-15 seed value (10 for Y. Aidoo) matches the computed best-3 so the surface stays 1:1 after the engine lands.
10. **Bespoke banner/pill colours (§0.3).** `#8B3829` (dark-terra tail), `#F5D4C9`/`#FFD4C9` (light-terra) are **not tokens** — inline / `lib/wassce/` constants. `.sc-pill.sci` renders **green-tinted** (`#E5F0EB`/`#1E5A35`) on the identity card, contradicting INCR-15's **terra** Science programme pill — **drift**; reconcile the Science pill styling. `.sc-pill.slessor` = bespoke House tint (mirrors boarding House-hex drift). Never slash-opacity any of them.
11. **Surface typos (surface-sync, non-blocking).** §5 action reads `Universe match panel` (should be "Universities"/"University"). Render as-is in a faithful port; flag for a surface-sync fix (mirrors the INCR-16 "Mark Mock 3" relabel note).
12. **`.notes` right-rail + outer editorial `.page-header`/`.section-head` are design-doc chrome — do not build.** Only the in-app `.app-shell` frame is the target (same rule as INCR-15/16 / ledger map).

---

*Map produced against: `Surfaces/schoolup-wassce-student-readiness.html` §1 (medical banner + identity aggregate + trajectory strip, lines 408–504), §3 (subject cards, lines 792–972), §4 (projection callout, lines 1150–1153; grid = INCR-20 context), §5 (aggregate visualizer, lines 1177–1298), §7 (parent-ack + SC xmod, lines 1594–1603, 1657–1662); `Surfaces/schoolup-wassce-setup.html` §5 (SC anchors = policy-display, per INCR-15 map); `md files/design-tokens.json` v1.0.0; house style + grade palette + no-alpha discipline from `docs/senior/wassce-spine-surface-map.md` (INCR-15) and `docs/senior/wassce-mock-surface-map.md` (INCR-16); `docs/senior-build-plan.md` MODULE 4.3 / INCR-17 framing (Decisions 2/11/12, BUILD_STACK tables `waec_special_consideration`/`readiness_statements`, `mock_2_aggregate`/`projected_aggregate`, receipt-PDF reuse #136, parent-ack SMS owner-gate). **INCR-17 Kofi rulings not yet written — bindings above are proposals for confirmation.** University match (§6 + setup §3) = INCR-17b · cohort-readiness = INCR-18 · parent-tracker = INCR-19 · non-projection deep-dive (STPSHS panel, full schedule, ledger grid, context strip, comms log) = INCR-20 — deliberately NOT mapped.*
