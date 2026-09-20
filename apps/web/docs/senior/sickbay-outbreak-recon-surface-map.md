# Sickbay — Outbreak Monitor · 30-day History · NHIS Reconciliation · Surface Map (INCR-27 · Module 4.4 FINAL)

**Author:** Lucy (design cartographer) · **Status:** build-ready design spec for the implementation engineer (Claude Code).
**Increment:** INCR-27 — *the module's last increment: the 7-day **outbreak monitor** (syndromic surveillance), the **30-day referral history** (window read + diagnosis/hospital-mix charts), and the **outstanding NHIS reconciliation** (per-referral out-of-pocket recon, Bursar-owned). CLOSES MODULE 4.4* (INCR-28 is the cross-module capstone, not a sickbay surface).
**Source surfaces / sections (worktree-ROOT sibling of the app):**
- `Surfaces/schoolup-sickbay-today.html` **§05** (lines 686–789) → the **outbreak monitor** (this map §O5).
- `Surfaces/schoolup-sickbay-referral-log.html` **§04** (lines 924–1162) → the **30-day history** (§R4) + **§05** (lines 1164–1329) → the **NHIS reconciliation / outstanding** (§R5).

**Companions (my prior maps — MATCH their format):** `docs/senior/sickbay-referral-surface-map.md` (INCR-25 — it marked §04/§05 **MAP-ONLY → INCR-27**; this map builds them; N/B/A registers continue from there) · `sickbay-today-surface-map.md` (INCR-22c — it **OMITTED today §05's cluster-watch tile as Z2**, deferring the whole §05 here; F-register continues from its F14) · `sickbay-notifications-surface-map.md` (INCR-26 — authored the `DISTRICT_HEALTH`/`HEADMASTER` notify recipients that fire HERE) · `sickbay-surface-inventory.md` (module breadth · N1–N30 / B1–B14 / 24 NHIS elements / 6 PII classes / 15 fabricated-demo items; §1.4 #10/#12/#13 are THIS increment's three fabrications).

**Board:** `docs/senior-build-plan.md` → **MODULE 4.4** header (L2369) · the **INCR-27 row** (L2396) · **D6** (sickbay→billing STOP-AND-ASK, L2385) · **D9** (district-health outbreak report = printable/console artefact, no integration, L2385) · **R182** (the FORBIDDEN school-wide NHIS card-health matrix `1,108/1,200 · 92.3%` — DO-NOT-BUILD, incl. INCR-27; L2850) · **R190** (surveillance category **deferred to 27**; L2852) · **R185/R195** (cost lines structurally diagnosis-free; Bursar reads only those; L2850/L2856) · **Risk 4** (PII by proximity, L2410). Kofi rules the **surveillance-category enum + outbreak detection IN PARALLEL** off §6 of this map; I own the surface inventory of what these three sections render.

**Shipped spine this map builds on (0062, INCR-25 · on prod since 25a):** `db/schema/sickbay.ts` — `sickbay_referral` (`sickbay_referral_status` enum REFERRED/INPATIENT/RETURNING/RETURNED), `sickbay_referral_cost_line` (item · provider · `nhis_covered` bool · `out_of_pocket` · `billing_line_item_id` **NULL**, **NO clinical column** — structural Risk-4), `sickbay_hospital` (name/distance_km/is_primary/accepts_nhis), `student_nhis_card`, `sickbay_notification` (recipient enum authored with `DISTRICT_HEALTH` + `HEADMASTER`, **never fired until 27**). Readers: `lib/sickbay/referral-reads.ts::getReferralCostLines(schoolId, referralId)` — **forward-authored at 25b explicitly FOR INCR-27**, diagnosis-free by construction (`referral-projection.test.ts` pins it). Gates: `lib/access.ts::SICKBAY_CLINICAL_READ_ROLES = [HEADMASTER, MATRON]`, `SICKBAY_CONFIG_WRITE_ROLES = [ADMIN, HEADMASTER]`, `FINANCE_ROLES = [ACCOUNTANT, BURSAR]`.

> **🔴 Migration number — the board's INCR-27 row reads `0061`, which is STALE.** `0061` was consumed by **INCR-24b** (`stock_item_id`), `0062` by **INCR-25** (the referral table set). This increment's migration, **if one is needed, is `0063`** (the same stale-number correction the referral map made for 0060→0062). **Only the outbreak monitor needs schema** (N33 surveillance category + N34 threshold config — Kofi/Wells). **The 30-day history and the NHIS reconciliation read the shipped 0062 tables and need NO migration** — if Wells finds every §R4/§R5 column already present in 0062 (it is), INCR-27 ships **surveillance-only-or-migration-free**. Prod-paste (if 0063 lands): `db/sql/prod-paste-0063-sickbay-surveillance.sql`.

---

## 0. Scope — three sections, one increment, ONE migration at most

INCR-27 builds the last three of the module's sections, drawn across two files. All three were mapped MAP-ONLY in prior increments; this map makes them build-ready.

### 0.1 Section → source → build status at INCR-27

| Section | Title (verbatim `.section-title`) | Source · lines | Prior marker | Build status |
|---|---|---|---|---|
| **§O5** | *Outbreak monitor · 7-day cluster watch* | `today` §05 · 686–789 | today-map **Z2** (cluster-watch tile OMITTED at 22c) | **BUILD** — reinstate the live tile + the monitor block (6 syndromic rows, thresholds, district notify). **Needs N33+N34 (0063).** |
| **§R4** | *Referral history · last 30 days* | `referral-log` §04 · 924–1162 | referral-map **MAP-ONLY → INCR-27** | **BUILD** — window read, 12-row table, diagnosis-mix + hospital-mix bars. **Reads shipped 0062. No migration.** |
| **§R5** | *Outstanding reconciliation · three families* | `referral-log` §05 · 1164–1329 | referral-map **MAP-ONLY → INCR-27** | **BUILD** — recon strip, outstanding list, cross-module handoff card. **Reads shipped 0062 (`getReferralCostLines`). No migration.** 🚫 **the school-wide `1,108/1,200 · 92.3%` card-health tile = DO-NOT-BUILD (R182, §7).** |

### 0.2 What each section reads / writes

| Section | Reads | Writes (this increment) | Depends on out-of-scope? |
|---|---|---|---|
| **§O5 outbreak** | every non-voided `sickbay_visit` in the 7-day window, categorised by **N33 syndrome**; N34 thresholds | `Configure thresholds` → N34 (config, `[ADMIN, HEADMASTER]`); `Notify GHS-Amenfi` → a `sickbay_notification` row `recipient=DISTRICT_HEALTH` (**console/print only, D9**) | **N33 needs a picker at visit-assessment (visit-record §02)** — the one scope tendril, §6.4 |
| **§R4 history** | `sickbay_referral` + status + `sickbay_referral_cost_line` + `sickbay_hospital`, 30/90/term/year windows | none (a read + export) | none — all 0062 |
| **§R5 recon** | `getReferralCostLines` (diagnosis-free) over unbilled out-of-pocket lines; `student_nhis_card` status **per open case only** | `Send SMS reminder` (Bursar → 26 console-only path or DEFER); `Open in billing` → **D6, no invoice write** | none for the recon itself; the roll-up tile is **forbidden (R182)** |

**INCR-27 fires two enum values authored-but-dormant since 0062:** `sickbay_notify_recipient = DISTRICT_HEALTH` (the outbreak district report, D9) and `= HEADMASTER` (the digest — the board's F-E deferral from 26). Both were explicitly excluded from INCR-26's fan-out (`notify.ts::recipientsForTier` never returns them; `notify.test.ts` asserts it). INCR-27 is where they light up.

---

## 1. Shared chrome, routes, gates, tokens, type

### 1.1 Design-doc chrome — do NOT build

Same rule as every sickbay map: the files wrap app frames in a design document. Build only `.app-shell` (shipped `components/app/sidebar.tsx` + main). **Port the `.notes` right-rail rules; render none of their text.**

| Do NOT build | Where |
|---|---|
| `.page-header` (both files' `.mvp-tag`, `The referral *log.*` / `Today's *sickbay*`, gold rules, hero paragraphs) | per file |
| every `.section-head` (`05`/`Outbreak monitor · 7-day cluster watch`/`URTI cluster · low alert`; `04`/`Referral history · last 30 days`/`12 referrals · 10 returned · 2 active`; `05`/`Outstanding reconciliation · three families`/`GHS 340.00 total · 1 over 30 days`) | 686–691, 924–929, 1164–1169 |
| every `.desktop` / `.browser-bar` / `.url` / drop-shadow | per section |
| every `.notes` right rail (§O5 779–788, §R4 1151–1160, §R5 1318–1327) | — |
| `.sidebar.tall` variants + the surfaces' demo nav | — |

**Notes-panel rules to PORT (not render):**
- **§O5:** *"Six district-aligned categories match what Ghana Health Service tracks for school-age surveillance"* (the enum is district-aligned — §6) · *"4+ cases / 7 days triggers **monitor**; 8+ or 50% week-over-week rise triggers **amber** and prompts notification to Wassa Amenfi GHS"* (the threshold rule — N34) · *"**Apollo (conjunctivitis)** kept on the watch list explicitly · past Ghana-wide outbreaks have spread fast in boarding schools"* (a category stays even at 0 — the monitor shows the full set, not only the active) · *"**Sports injury** tracked here so a sudden spike triggers a campus safety review · separate from infectious surveillance"* (one category is a safety trigger, not an infectious one — §6.3).
- **§R4:** *"the mix bar isn't analytics — it's a **procurement instrument**"* (7 malaria → AL/RDT reorder; reads INTO setup §3 stock, §11) · *"Adwoa twice in 30 days… SCD crises are part of her chronic register pattern"* (a name recurs by construction) · *"J. Tetteh's expired NHIS card is the only 'parent due' of consequence… drives a real receivable"* (the one over-30 row).
- **§R5:** *"Most lines say zero… the reconciliation surface exists for the two-out-of-twelve where it doesn't"* · *"**the age column is the operational signal, not the amount**"* · *"**The matron never sees billing.** Mrs Bediako can read this (audit) but the bursar owns it. Sickbay creates the cost; billing carries it."* (the §R5 gate, §1.3) · *"NHIS-covered items don't show here — only the gaps NHIS doesn't fill."*

### 1.2 Routes & navigation

- **§O5 outbreak:** surface URL `app.omnischools.gh/sickbay/today/outbreak`. **Recommend its own route `/senior/sickbay/today/outbreak`** reached from the reinstated `Cluster watch` live-strip tile on `/senior/sickbay/today` (the tile links to it) — the monitor carries its own two actions (`Notify GHS`, `Configure thresholds`) and the board (22c) is already dense; a self-bounding 6-row panel doesn't warrant crowding the bench board. **Alternative** (acceptable): a section below today §03, same as 22c collapsed §01+§03 into one route. **Q1.** Whichever wins, **the 22c-omitted `Cluster watch` live tile is reinstated** (the today-map Z2 reinstatement trigger fires now) and the today live-strip returns from its 22c `grid-cols-2/3` toward its fuller count (mirrors how INCR-25 reinstated the `Active referrals` tile).
- **§R4 history:** `/senior/sickbay/referrals/history` — surface URL `…/sickbay/referrals/history`. A section of the referrals module reached by the module's own in-page nav (the referral-map §1.2 idiom), not a sidebar sub-item.
- **§R5 reconciliation:** `/senior/sickbay/referrals/reconciliation` — surface URL `…/sickbay/referrals/reconciliation`. **Bursar-owned** (§1.3).
- **Sidebar:** unchanged — the shipped flat nav's one Sickbay row → `/senior/sickbay/today` (repointed at 22c). No new nav item. The surfaces' demo sub-nav loses to the app nav (module-wide ruling).
- `export const dynamic = "force-dynamic"` on all three — every window/threshold/age derivation is server-computed at request time and rendered as a static string; **no ticking client clock** on a clinical/financial page (the 22c B15 rule; the `.live-clock` `14:45 GMT` renders `as of {HH:MM} GMT`, no pulse dot).

### 1.3 🔴 Gates — three different readers, deliberately

| Section | Read | Write | Grounding |
|---|---|---|---|
| **§O5 outbreak** | **`SICKBAY_CLINICAL_READ_ROLES = [HEADMASTER, MATRON]`** — the monitor is **counts-only** (no names, §5) but it aggregates the school's disease surveillance; keep it clinical, **not ADMIN** | `Notify GHS-Amenfi` → **`[MATRON]`** (a clinical escalation the matron owns); `Configure thresholds` → **`SICKBAY_CONFIG_WRITE_ROLES = [ADMIN, HEADMASTER]`** (config, the hospital-config precedent — the MATRON reads thresholds but does not set policy) | notes: *"matron escalates to Wassa Amenfi GHS"*; thresholds are a per-school policy fact like `accepts_nhis` |
| **§R4 history** | **`SICKBAY_CLINICAL_READ_ROLES = [HEADMASTER, MATRON]`** — every row pairs a **name** with a **working-impression** (A10) | display-only + the `Export`/`Term report` affordances (**A10 — gate/omit; see below**) | R195: full clinical detail = MATRON/HEADMASTER only; ADMIN gets module access, **no clinical read** |
| **§R5 recon** | 🔴 **`[BURSAR, HEADMASTER, MATRON]` — and the BURSAR reads ONLY the diagnosis-free cost lines** (`getReferralCostLines`, structurally clinical-free per R185/R195). The matron/headmaster may also read it (their names are in the audit) but the Bursar **owns** it. | `Send SMS reminder` → **`[BURSAR]`** (26 console path or DEFER); `Open in billing` → **D6, no write** | notes: *"the matron never sees billing… the bursar owns it"*; R195: *"BURSAR = the diagnosis-free cost lines only"* |

**The §R5 build's central obligation:** the Bursar's projection is **diagnosis-free by construction** — it reads `sickbay_referral_cost_line` (item · provider · `nhis_covered` · `out_of_pocket`), which has **no clinical column** (0062, `referral-projection.test.ts` pins it). The surface **draws** the diagnosis in each outstanding-list line (`Malaria 22 Apr`, `SCD crisis 08 May`); **the build must NOT** — that line renders cost + age + a generic `Sickbay referral` tag, never the impression (A12, §5). This is the same leak the referral-map flagged as A4; INCR-27 is where it is enforced.

### 1.4 Token reference

`:root` is **identical** to every sickbay surface (same 14 hexes as `md files/design-tokens.json`). Token classes in JSX, **never inline `var(--x)`**. The full table lives in the referral map §1.4 and today map §2.1 — reproduced here only for the classes **new to these three sections**.

**§O5 (today file, lines 169–182) — the outbreak-row family:**

| Class | Value → Tailwind |
|---|---|
| `.outbreak-row` | `grid grid-cols-[1fr_80px_100px_110px] gap-[14px] p-[12px_20px] items-center border-b border-border`; last none |
| `.o-cond` / `.o-sub` | `font-display text-[13px] font-semibold text-navy tracking-[-0.005em]` · `.o-sub` `block text-[10px] text-navy-3 italic font-body font-normal mt-px` (**Manrope-inside-a-display cell — deliberate**, the visit-map convention) |
| `.o-count` / `.o-count em` | `font-mono text-[18px] font-semibold text-navy text-right` · `em` `not-... italic text-gold font-medium text-[9px] block font-body tracking-[0.08em] uppercase mt-[2px]` (the `past 7 days` label under the count) |
| `.o-trend` + `.up`/`.flat`/`.down` | `text-[11px] font-semibold text-navy-2`; `.up` → **`text-warn`**, `.flat` → **`text-navy-3`**, `.down` → **`text-green`** (⚠️ `.down` is defined but **no row uses it** in the demo — authored-capable, §5/F17) |
| `.o-status .pill` + `.monitor`/`.normal` | `inline-block px-[9px] py-[3px] rounded-full text-[9px] tracking-[0.08em] uppercase font-bold`; `.monitor` `bg-warn-bg text-warn` · `.normal` `bg-green-bg text-green` (⚠️ **an `amber` variant is named in copy but never drawn** — `bg-terra-bg text-terra`, authored, §5/F17) |

§O5 reuses the today §03 shell verbatim: `.body-shell`, `.head-row`/`.hr-l h3`/`.hr-l p`, `.live-clock`/`.lc-dot` (dot dropped, `as of {HH:MM} GMT`). All in the today map §2.1.

**§R4 / §R5 (referral file) — the history/recon families were captured in the referral map §1.4** (`.filter-strip`/`.filter-pill`/`.ct`; `.history-table` th/td, `.h-date`/`.h-student`/`.h-av` [5 tints]/`.h-cond`/`.h-hosp`/`.h-stat`/`.h-cost`/`.h-nhis`; `.recon-strip`/`.recon-card`/`.outstanding`; `.outstanding-list`/`.outstanding-row`/`.ol-av`/`.ol-amt`/`.ol-action`). Reproduce from there. The **two inline-styled mix-bar cards** (§R4, lines 1121–1145) and the **inline-styled key/value rows** in §R5's DO-NOT-BUILD card + cross-module card are authored as real components — every colour resolves to a token; only the widths (`58%`…) and the alpha literals are raw (§1.5).

### 1.5 No-alpha discipline (repo memory `no-alpha-token-opacity`)

**These three sections introduce NO new named hex.** Every colour is a declared `:root` token. The only raw values are **alpha literals** — precisely where a Tailwind slash-opacity translation renders *nothing* while `next build` stays green.

| Region | Raw value | Port to (NOT slash-opacity) |
|---|---|---|
| `.filter-pill .ct` / `.filter-pill.active .ct` count badges (§R4) | `rgba(200,151,91,0.18)` / `(0.2)` | `bg-[rgba(200,151,91,0.18)]` — **never** `bg-gold/18` |
| `.history-table tr.active-row` gradient 2nd stop (§R4) | `linear-gradient(90deg, var(--terra-bg) 0%, rgba(245,225,220,0.2) 100%)` | reproduce the literal in the arbitrary gradient — **never** `terra-bg/20` |
| `.history-table td .h-av.navy` (§R4) | `rgba(45,63,92,0.12)` (navy-2 at 12%) | 🔴 the chronic/referral-map precedent: recommend the shared **dedicated `--navy-bg` tint token** (`#E9EBEF`), not a per-component alpha |
| mix-bar tracks (§R4, inline) | bars sit on `var(--bg)` with token fills (`--terra`/`--warn`/`--gold`/`--navy-3`/`--gold-soft`); widths `58% 17% 8%…` | fills are solid tokens; **widths are DERIVED** (§5) — never hardcode `58%` |
| decorative `::before` glows (`.xmod`, `.ref-head` — not in these sections) | — | n/a in §O5/§R4/§R5 |

**Verify in the live preview, not the build.** Slash-opacity on a raw-hex token renders nothing and the build passes.

### 1.6 Type families

`font-display` = **Fraunces** (`.section-title`(not built), `.o-cond`, `.rc-val`, `.h-name`/`.h-av`, `.ol-name`/`.ol-av`, `.hr-l h3`, the DO-NOT-BUILD/handoff card `.ch-title`, every gold `<em>`) · default = **Manrope** · `font-mono` = **JetBrains Mono** (`.o-count`, `.h-date`/`.h-time`, `.h-cost`, `.h-nhis`? no — `.h-nhis` is Manrope, `.km`, `.filter-pill .ct`, `.ol-amt`, `.rc-val .mono`, the DO-NOT-BUILD card's `1,108 / 1,200`/`92.3%` figures). **Manrope-inside-mono cells** (deliberate): `.o-sub`, `.h-time`, `.h-status`, `.ol-since`, `.h-nhis`. Reproduce the mix; do not "correct" to mono.

**Absent-value convention:** em-dash `—` in `text-navy-3` for *unknown*; a genuine `0` renders `0` (the outbreak's `0` counts render `0`, never `—` — a category at baseline is a measured zero, not an unknown). A referral cost of `GHS 0.00` renders `0.00` (covered), never `—`.

---

## §O5 — today §05 · Outbreak monitor · 7-day cluster watch

**Surface lines 686–789.** Counts-only syndromic surveillance. **The single most important PII fact of this whole increment: the monitor names NO students — only category + count + trend + status (A9, §5).**

### O5.1 Page head — exact copy

| Element | Exact copy (verbatim) | Token / type · INCR-27 |
|---|---|---|
| Crumb | `Sickbay` *(link)* ` · ` `Today` *(link)* ` · Outbreak monitor` | `text-navy-3 text-[11px] tracking-[0.12em] uppercase font-semibold`; links `text-gold no-underline` |
| `<h1>` | `Outbreak ` + `<em>monitor</em>` + ` · 7-day window` | `font-display text-[28px] font-medium tracking-[-0.018em] leading-[1.1]`; `<em>` italic gold 400. ⚠️ **7-day**, not 30 (the 30-day is §R4) |
| Lede | `URTI cluster at **6 cases** past 7 days · above the 4-case threshold for "monitor". No malaria spike. No GI cluster. Skin clean.` | **DERIVED + AUTHORED** — read the highest-status category and phrase it: `{topCategory} cluster at **{n} cases** past 7 days · {monitor/amber phrase}` + one clause per notable-or-clean group. Never hardcode `URTI`/`6`. **Empty state:** `No clusters this week — all categories at baseline.` (all counts below monitor) |
| Action 1 | `Notify GHS-Amenfi (district health)` | **BUILD — `[MATRON]`.** Writes a `sickbay_notification` `recipient=DISTRICT_HEALTH` row. 🔴 **D9: printable/console artefact, NO integration** — the row is `status=QUEUED`, `provider='console'` (the 26 boundary), and the action ALSO offers a printable district-report PDF/console artefact. **No SMS/email is dispatched to a real district office** (§8, B15). |
| Action 2 | `Configure thresholds` | **BUILD — `SICKBAY_CONFIG_WRITE_ROLES` [ADMIN, HEADMASTER].** Edits N34 per-category `monitor_threshold`/`amber_threshold` + the WoW-rise %. The MATRON reads them, cannot set them. |

### O5.2 Head row

| Element | Exact copy | INCR-27 |
|---|---|---|
| `.hr-l h3` | `Six ` + `<em>conditions</em>` + ` tracked · district-aligned categories` | **DERIVED** — `{n} <em>conditions</em> tracked · district-aligned categories`; `{n}` = the count of active N33 categories (6 in the seed, but the enum count wins — never hardcode `Six`). |
| `.hr-l p` | `Categories align with Ghana Health Service district surveillance · matron escalates to **Wassa Amenfi GHS** on amber cluster (8+ cases or 50% rise week-over-week)` | **BUILD verbatim** — `Wassa Amenfi GHS` is the school's district health office; derive the district name if stored, else the AUTHORED static (Asankrangwa's district). The `8+ / 50% WoW` clause is the N34 policy, rendered from config not hardcoded. |
| `.live-clock` | `<span class="lc-dot"></span>14:45 GMT` | **REPLACE** — `as of {HH:MM} GMT`, no pulse dot (a frozen server timestamp is not live; 22c §5.1 rule). |

### O5.3 The six syndromic rows — the surveillance category set (verbatim; the enum for Kofi is §6)

Each `.outbreak-row`: `.o-cond` (label + `.o-sub` description) / `.o-count` (`{n}` + `past 7 days`) / `.o-trend` (arrow + delta) / `.o-status` (pill).

| # | `.o-cond` (label) | `.o-sub` (verbatim description) | count | `.o-trend` | `.o-status` |
|---|---|---|---|---|---|
| 1 | **Upper respiratory tract** | `cough, sore throat, mild fever, runny nose` | `6` | `↑ from 2` (`.up` warn) | `Monitor` (warn) |
| 2 | **Malaria suspected** | `fever ≥ 38°C with RDT or referral for blood film` | `1` | `↔ steady` (`.flat`) | `Normal` (green) |
| 3 | **Diarrhoea / vomiting** | `acute GI symptoms · key sentinel for food-related outbreak` | `0` | `↔ baseline` (`.flat`) | `Normal` (green) |
| 4 | **Skin · rash, scabies, ringworm** | `dorm-spread risk · monthly inspection in boarding` | `0` | `↔ baseline` (`.flat`) | `Normal` (green) |
| 5 | **Eye · conjunctivitis** | `"Apollo" · high contagion risk in boarding houses` | `0` | `↔ baseline` (`.flat`) | `Normal` (green) |
| 6 | **Sports injury · sprain, strain, fracture** | `tracked separately from infectious watch · safety review trigger` | `3` | `↔ from 4` (`.flat`) | `Normal` (green) |

**Every row's label + description is STORED config (N33/N34)** — they are the district-aligned category definitions, not derived. **Every count + trend + status is DERIVED** (§5): count = non-voided visits in `[now−7d, now]` with that `surveillance_category`; trend = this-window count vs the prior 7-day window (`↑ from {prev}` / `↓ from {prev}` / `↔ steady` when equal / `↔ baseline` when both 0); status = `Normal` < monitor_threshold ≤ `Monitor` < amber_threshold ≤ **`Amber`** (authored, §5). **The full category set always renders**, including the zero rows — a category at 0 is a *measured baseline*, not an omission (the "Apollo kept on the list explicitly" note). Order: the surface draws infectious categories first, sports-injury last; preserve (§6.3).

### O5.4 What the monitor does NOT show — and must never

- **No student names, ever.** The monitor is the school's **counts-only** disease surveillance. The temptation to add "view the 6 cases" (which would list the six URTI students) is **A9 — refuse it.** The category + count is the disclosure ceiling. (The `.notes` panel's *"dorm 4 boys (3 of the 6)"* is editorial, unbuilt; it must NOT become a named drill-down — that would re-identify sick students by dorm, the sharpest proximity leak in the module.)
- **No diagnosis vocabulary.** N33 is **syndromic** (what a student presented with), not diagnostic — `Malaria suspected`, not `malaria`; `Upper respiratory tract`, not a named infection (§6, R43/R190: the `diagnos` token appears in no column/enum/type).

---

## §R4 — referral-log §04 · Referral history · last 30 days

**Surface lines 924–1162.** Clinical-read gated (§1.3). Reads shipped 0062. **Day-one empty state is mandatory** (§9) — the whole table + both bars are empty until a term of referral history exists; never a fabricated 12/7/58%.

### R4.1 Page head — exact copy

| Element | Exact copy | Token / type · INCR-27 |
|---|---|---|
| Crumb | `Sickbay` *(link)* ` · ` `Referrals` *(link)* ` · History · 30 days` | standard crumb |
| `<h1>` | `30-day ` + `<em>history.</em>` | `font-display` 28px; `<em>` italic gold |
| Lede | `**Twelve referrals** in 30 days · ten closed · two still active. Malaria leads at **seven of twelve** — Semester 2 sits inside Ghana's main malaria season. Two SCD crises, both Adwoa. One sports injury (today). One asthma exacerbation.` | **DERIVED + PII-trimmed** — `**{n} referrals** in 30 days · {closed} closed · {open} still active. {topCategory} leads at **{n} of {total}**…`. The `both Adwoa` clause names a student and a condition (A10) → render only to a clinical reader; derive the count, drop the name if the mix is shown separately. **Empty:** `No referrals in the last 30 days.` |
| Action 1 | `Export CSV` | **A10 — OMIT or clinical-gate.** A CSV carries every name+impression out of the room (the A6/`Print day sheet` precedent). If retained, it is MATRON/HEADMASTER-only and audit-logged. |
| Action 2 | `Export PDF` | same — **OMIT** at 27 (a term report for procurement needs the mix, not the named rows; §11). |
| Action 3 | `Term report` (primary) | **the procurement artefact** — the diagnosis-mix drives the next term's AL/RDT order (§11). Build as a **counts-only** report (no named rows) or OMIT; it must not become a named-diagnosis export. **Q2.** |

### R4.2 Filter strip — range + category facets

Two label groups (`.filter-strip`, `.filter-pill` with `.ct` count badge; `.active` = navy):

| Group | Pills (verbatim, count badges) | Binding |
|---|---|---|
| `Range` | `30 days` **12** *(active)* · `90 days` **31** · `This term` **27** · `This year` **68** | window over `sickbay_referral.departed_at`; each count DERIVED, never copied (the module's signature counter-drift defect) |
| `Filter` | `Malaria` **7** · `SCD` **2** · `Injury` **1** · `Asthma` **1** · `Other` **1** | 🔴 **the category facet = proof a categorised referral field exists** — see §6.2 (**Vocabulary B**, distinct from the outbreak's syndromic set). This is a DIFFERENT axis from N33; flag to Kofi. |

The `Range` counts (12/31/27/68) and the `Filter` counts are all derived over the same referral rows; the active range drives the table below.

### R4.3 The 30-day table — 7 columns, 12 rows (all fabricated demo; §9/§10)

`.history-table`: cols `Date` / `Student` / `Diagnosis` / `Hospital` / `NHIS`(centre) / `Status` / `Out-of-pocket`(right). `tr.tier-N` left-border encodes the notification tier (gold-soft/warn/terra); `tr.active-row` = the two open rows (terra gradient).

| Cell | Rendering | Binding (0062) |
|---|---|---|
| `.h-date` | `{DD MMM}` + `.h-time` `{HH:MM}` (Manrope sub) | `departed_at` |
| `.h-student` | `.h-av` (initials, one of 5 tints keyed to tier/status) + `.h-name` (Fraunces) + `.h-class` (`F3 Slessor · SCI`) | `students` + `houses` + programme short code |
| `.h-cond` | `**{impression}**` + `.sub` (`{detail}`) — e.g. `Severe malaria` / `P. falciparum · RDT+` | 🔴 **the visit's `working_impression`** (R190 — never a stored `diagnosis`) + `diagnosis_detail`; **PII (A10)** |
| `.h-hosp` | `**{hospital}**` + `.km` (`4.2 km · primary`) | `sickbay_hospital` (N6) |
| `.h-nhis` | `Yes` (green) / `Partial` (warn) / `Expired` (terra) | the referral's **snapshot** `nhis_valid` (R184), not the live card |
| `.h-stat` | pill: `Inpatient · Day 1` · `Returning · today` · `Returned {date}` · `Returned same day` · `Outpatient · returned same day` | `sickbay_referral_status` + day-N derived |
| `.h-cost` | `GHS {amount}` + `.h-status` (`Covered` green / `Parent due` terra / `Comfort items`/`ORS pack` warn) | sum of `sickbay_referral_cost_line.out_of_pocket`; status derived |

**The 12 rows verbatim (all demo — day-one empty; §9):** `14 May · Y. Aidoo · F3 Slessor SCI · Severe malaria (P. falciparum · RDT+) · Asankrangwa Govt · NHIS Yes · Inpatient · Day 1 · GHS 0.00 Covered` [active] · `13 May · K. Boateng · F2 Aggrey BUS · Mild wrist fracture (Sports field · distal radius) · NHIS Partial · Returning · today · GHS 80.00 Parent due` [active] · `08 May · Adwoa Mensa · F1 Slessor GA · SCD pain crisis (Moderate · IV opioid) · NHIS Yes · Returned 10 May · GHS 45.00 Comfort items` · `05 May · E. Owusu · F2 Nkrumah SCI · Severe asthma · NHIS Yes · Returned 06 May · GHS 0.00 Covered` · `02 May · S. Asante · F3 Kufuor BUS · Malaria (Moderate · IV) · NHIS Yes · Returned 03 May · GHS 0.00 Covered` · `30 Apr · P. Darko · F1 Aggrey GA · Suspected appendicitis (Ruled out · gastroenteritis) · NHIS Yes · Returned same day · GHS 25.00 ORS pack` · `28 Apr · Adwoa Mensa · F1 Slessor GA · SCD pain crisis (Mild) · NHIS Yes · Returned 30 Apr · GHS 60.00 Comfort items` · `25 Apr · E. Mensa · F2 Slessor BUS · Malaria (Moderate) · NHIS Yes · Returned 26 Apr · GHS 0.00 Covered` · `22 Apr · J. Tetteh · F3 Aggrey SCI · Malaria (Moderate · vomiting) · **NHIS Expired** · Returned 23 Apr · GHS 215.00 Parent due` · `19 Apr · N. Antwi · F1 Kufuor GA · Malaria (Mild) · NHIS Yes · Returned 20 Apr · GHS 0.00 Covered` · `17 Apr · F. Boakye · F3 Slessor BUS · Malaria (Moderate) · NHIS Yes · Returned 18 Apr · GHS 0.00 Covered` · `15 Apr · R. Acquah · F2 Aggrey GA · Malaria (Mild · day-case) · NHIS Yes · Outpatient · returned same day · GHS 0.00 Covered`.

**Adjacency (A10):** twelve rows, each a **name beside a working-impression**. **ACCEPT within the clinical gate** (§1.3 — the same posture as the referral-map A1: the impression IS the referral record and the reader is MATRON/HEADMASTER). The leak to guard is the **export** (A10 above) and the **mix bars** (below, which are counts-only — safe).

### R4.4 Two analysis cards — the mix bars (counts-only, safe aggregate)

Two inline-styled cards below the table (lines 1121–1145). **Author as a real bar component; every colour is a token, every width is DERIVED.**

| Card | Head | Bars (verbatim, demo) | Footer note (verbatim) |
|---|---|---|---|
| **Diagnosis mix · 30 days** | `Diagnosis mix · 30 days` | `Malaria` **7** (58%, terra) · `SCD crisis` **2** (17%, terra) · `Asthma` **1** (8%, warn) · `Injury` **1** (8%, warn) · `Other` **1** (8%, navy-3) | `**Malaria sits at 58%.** Apr–Jun in this part of the Western Region is rainy + breeding season. Stock projection for AL + RDT kits on the setup page is rebuilding from this pattern.` |
| **Hospital mix · 30 days** | `Hospital mix · 30 days` | `Asankrangwa Govt` **12** (100%, gold) · `Wassa Akropong` **0** · `St. Martin's Clinic` **0** · `KATH Kumasi` **0** | `**Asankrangwa Govt takes everything.** St. Martin's after-hours and Wassa Akropong overflow have not been needed this semester. KATH tertiary referral is reserved for cases beyond the district hospital's capacity.` |

- **Diagnosis-mix bars are counts-only** — no names, safe aggregate (A11). ⚠️ but the **category axis is Vocabulary B** (malaria/SCD/asthma/injury/other), NOT the outbreak's syndromic set — see §6.2. The bar labels are the referral categories; do not hardcode the `58%` (derive width from count/total).
- **Hospital-mix** reads `sickbay_hospital` (N6); the four names are the seeded hospital config, the widths derived. The zero-width bars (`0%`) render as an empty track — reproduce (a `0` hospital renders honestly, not hidden).
- Both footer notes are editorial (unbuilt panel copy) — but the *"Stock projection… on the setup page is rebuilding from this pattern"* line is the **procurement cross-module hook** (§11): the mix reads INTO setup §3 stock. Preserve the commitment, render the note as derived-or-static.

---

## §R5 — referral-log §05 · Outstanding reconciliation · three families

**Surface lines 1164–1329.** 🔴 **BURSAR-OWNED, diagnosis-free (§1.3).** Reads `getReferralCostLines` (shipped 0062, forward-authored for this increment). **No invoice write (D6).** 🚫 **contains the FORBIDDEN roll-up tile (§7).**

### R5.1 Page head — exact copy

| Element | Exact copy | Token / type · INCR-27 |
|---|---|---|
| Crumb | `Sickbay` *(link)* ` · ` `Referrals` *(link)* ` · Reconciliation` | standard |
| `<h1>` | `Outstanding ` + `<em>reconciliation.</em>` | `font-display` 28px; `<em>` italic gold |
| Lede | `Three families carry referral-related balances. **GHS 340.00 total.** One sits over 30 days and is on the Bursar's chase list. The other two are recent and within the normal pay window. NHIS-covered items don't show here — only the gaps NHIS doesn't fill.` | **DERIVED** — `{n} families carry referral-related balances. **GHS {total} total.** {overThirty} over 30 days…`. The final sentence is the **design commitment** (only out-of-pocket gaps render, never covered items) — preserve verbatim. **Empty:** `No outstanding balances — every referral this window was NHIS-covered.` |
| Action 1 | `Open in billing` | 🔴 **D6 — NO invoice write.** Either a **read-only link** to the billing module (`billing_line_item_id` is NULL on every cost line — nothing to open yet) or **OMIT** at 27. The STOP-AND-ASK financial write is parked like the boarding 3× penalty. |
| Action 2 | `Print reminders` | **OMIT** (A6 — a printed reminder carries the referral fact out; and the SMS path is the real channel). |
| Action 3 | `Send SMS reminder` (primary) | **`[BURSAR]`.** A payment-reminder SMS to the parent → route through the **26 console-only path** (`notification_log` QUEUED/console) or **DEFER** — the matron never chases money, so this is a Bursar-initiated comms action, not a clinical one. **Q3.** |

### R5.2 Recon strip — 3 cards

| # | `.rc-lbl` | `.rc-val` | `.rc-trend` (verbatim) | Binding |
|---|---|---|---|---|
| 1 `.outstanding` (terra) | `Total outstanding` | `GHS 340.00` | `**3 families** · 1 over 30 days · 2 within normal pay window` | **sum of `out_of_pocket` where unbilled** (`billing_line_item_id IS NULL AND out_of_pocket > 0`); families = distinct students; over-30 = age since `departed_at` |
| 2 | `NHIS-covered (30d)` | `GHS 2,180.00` | `Estimated value of NHIS coverage · 10 of 12 referrals fully covered` | ⚠️ **an ESTIMATE (F19)** — the covered-value is not a stored figure; either derive from covered cost lines (if amounts are stored for covered items) or **OMIT the tile** (do not fabricate `2,180`). The `10 of 12` is derivable (referrals with zero out-of-pocket). |
| 3 | `Average parent-cost` | `GHS 28.33` | `Per referral · 30-day average · trending down from **GHS 35** last semester` | derived (`total out-of-pocket / referral count`); the `GHS 35 last semester` needs a prior term — **empty/omit at launch** (F19), never a fake baseline |

### R5.3 The outstanding list — 3 rows (🔴 the diagnosis-strip is the build's job)

`.outstanding-list` / `.outstanding-row`: `.ol-av` (initials, tinted) / `.ol-body` (`.ol-name` + `.ol-line`) / `.ol-amt` (`GHS {n}` + `.ol-since`) / `.ol-action`.

| Row | `.ol-name` (verbatim) | `.ol-line` (surface, VERBATIM) | `.ol-amt` / `.ol-since` | action |
|---|---|---|---|---|
| 1 (terra av) | `J. Tetteh` · `F3 Aggrey BUS` | `Malaria 22 Apr · **NHIS card expired** at time of admission · IV artesunate course + 2-day inpatient · parent informed 22 Apr 16:30` | `GHS 215.00` / `22 days · over 30d soon` (terra) | `Send SMS` (primary) |
| 2 (warn av) | `K. Boateng` · `F2 Aggrey BUS` | `Wrist fracture today · NHIS active · **cast materials (parent-supplied)** · father acknowledged at hospital · normal pay window` | `GHS 80.00` / `Today · within window` (green) | `View case` |
| 3 (warn av) | `Adwoa Mensa` · `F1 Slessor GA` | `SCD crisis 08 May · NHIS active · **comfort items + private room upgrade** · mother elected upgrade · within window` | `GHS 45.00` / `6 days · within window` (green) | `View case` |

🔴 **A12 — the central build rule for §R5.** The surface `.ol-line` opens with the **diagnosis** (`Malaria 22 Apr`, `SCD crisis 08 May`). **The Bursar's build must NOT render it.** `getReferralCostLines` is structurally diagnosis-free (no clinical column, 0062). The line renders instead: the **cost reason from the cost-line item** (`cast materials (parent-supplied)`, `comfort items + private room upgrade`, `IV artesunate course + 2-day inpatient` — these ARE the diagnosis-free `sickbay_referral_cost_line.item`/`provider` strings) + the age + the NHIS-status fact (`NHIS card expired at time of admission` — a payment-relevant fact, not a diagnosis) + a generic `Sickbay referral` tag. **The age (`.ol-since`) is the operational signal** (the §R5 note); the over-30 tint is terra, within-window is green. `View case` links to the referral case detail (§R2, clinical-gated — a MATRON/HEADMASTER can drill in; the Bursar cannot).

### R5.4 Two secondary cards — one forbidden, one editorial

**🚫 Card A — `NHIS card health across the school` (lines 1265–1290) — DO-NOT-BUILD (R182, §7).** The `1,108 / 1,200 · 52 · 31 · 40 · 92.3%` matrix. **Omit entirely — no shell, no badge, no anchor target.** Full call-out in §7.

**Card B — `Cross-module handoff · Sickbay → Billing → Comms` (lines 1292–1310) — editorial, render honestly.**

| Element | Verbatim | INCR-27 |
|---|---|---|
| intro | `The matron does not chase money. When a referral incurs an out-of-pocket cost, three things happen automatically:` | preserve (the §R5 design principle) |
| step 1 | `**Billing module** creates the line item against the student's account with a "sickbay referral" tag. Parent sees it on the next invoice.` | 🔴 **D6 — the invoice write is DEFERRED** (`billing_line_item_id` NULL). Render as the *design commitment*, not a claim that it fires. |
| step 2 | `**Comms module** sends a one-line SMS to the parent at the moment of incurring: "Referral today incurred GHS 80 for cast materials. NHIS-covered items are 0. Details on your statement."` | a **cost-incurred SMS** — NOT built in 26 (26 built admission/referral tiers). Either extend the 26 console-only path or DEFER. The verbatim SMS template is diagnosis-free by design (`cast materials`, not `wrist fracture`) — a good pattern. **Q3.** |
| step 3 | `**Reconciliation surface** (here) shows the open balance, age, and SMS history. The Bursar opens this when the over-30 list grows.` | **THIS surface — BUILD.** |
| gold note | `**Matron, Bursar, parent — three audiences, one source of truth.** No spreadsheet, no double-entry, no "did the parent get told". The SMS at moment-of-incurring is the rule that closes most of the disputes before they start.` | preserve verbatim (the separation-of-concerns statement) |

**The handoff card narrates a partially-deferred flow** (steps 1 & 2 are D6/26-deferred, step 3 is this build). Render it as the honest design commitment — do not fabricate the billing/SMS writes.

---

## 6. 🔴 SURVEILLANCE-CATEGORY INVENTORY — the enum(s) for Kofi (the headline schema deliverable)

The task hands Kofi the **surveillance-category modelling + outbreak detection** in parallel; my job is the exact vocabulary. **There are TWO distinct category axes in this increment — do not conflate them.**

### 6.1 Vocabulary A — the OUTBREAK syndromic set (today §O5) — **6 categories**

The district-aligned syndromic-surveillance enum. **This is the primary enum Kofi rules.** Verbatim label + description + a suggested stable key:

| # | Suggested enum key | Label (verbatim) | Description (verbatim) | Nature |
|---|---|---|---|---|
| 1 | `UPPER_RESPIRATORY` | Upper respiratory tract | cough, sore throat, mild fever, runny nose | infectious |
| 2 | `MALARIA_SUSPECTED` | Malaria suspected | fever ≥ 38°C with RDT or referral for blood film | infectious |
| 3 | `DIARRHOEA_VOMITING` | Diarrhoea / vomiting | acute GI symptoms · key sentinel for food-related outbreak | infectious (food sentinel) |
| 4 | `SKIN` | Skin · rash, scabies, ringworm | dorm-spread risk · monthly inspection in boarding | infectious (dorm-spread) |
| 5 | `EYE_CONJUNCTIVITIS` | Eye · conjunctivitis | "Apollo" · high contagion risk in boarding houses | infectious (high-contagion) |
| 6 | `SPORTS_INJURY` | Sports injury · sprain, strain, fracture | tracked separately from infectious watch · safety review trigger | **non-infectious · safety trigger** |

**Rulings this vocabulary forces (for Kofi):**
- **Syndromic, NOT diagnostic** — `Malaria suspected`, not `malaria`; `Upper respiratory tract`, not a named infection. The name/key must contain **no `diagnos` token** (R43/R190, grep-testable) — call it `surveillance_category` / `syndrome_category`, never `diagnosis_category`.
- **The set is CONFIG, not derived** — the six labels + descriptions + thresholds are per-school config (N33 enum + N34 thresholds); the `Configure thresholds` action edits them. Whether the set is a fixed enum (like `chronic_condition_enum`) or a per-school editable list is Kofi's call — the `.notes` say *"district-aligned,"* arguing a fixed GHS-aligned enum with per-school threshold overrides.
- **One category is a safety trigger, not infectious** (#6 Sports injury) — *"tracked separately from infectious watch · safety review trigger."* The amber escalation for #6 is a **campus safety review**, not a GHS district notification. Kofi may want a `category_kind {INFECTIOUS, SAFETY}` axis so the escalation target differs.
- **Order is meaningful** — infectious first, sports last; store a `sort_order` or rely on enum declaration order.

### 6.2 Vocabulary B — the 30-day HISTORY mix set (referral-log §R4) — **5 categories** (a DIFFERENT axis)

The referral-outcome category, drawn in the §R4 filter facet + the diagnosis-mix bars:

| Suggested key | Label (verbatim) | Applies to |
|---|---|---|
| `MALARIA` | Malaria | referrals only |
| `SCD` | SCD crisis | referrals only |
| `ASTHMA` | Asthma | referrals only |
| `INJURY` | Injury | referrals only |
| `OTHER` | Other | referrals only |

**Why it is a separate axis (flag to Kofi):** Vocabulary A is **syndromic and applies to every VISIT** (the outbreak counts walk-in URTI cases that never became referrals). Vocabulary B is a **confirmed-condition category and applies to REFERRALS only** (the 30-day mix buckets the 12 referrals). They overlap (`Malaria`) but are not the same list, at different granularities, on different entities. **Kofi's modelling question:** does the referral carry its OWN `referral_category` (Vocab B), or does the mix DERIVE from the visit's syndrome (Vocab A) mapped up? Both avoid `diagnos` in the identifier. The referral map already flagged this as `N21 diagnosis_category` — **rename it** (`referral_category`) to satisfy R190's grep ceiling.

### 6.3 The threshold rule (N34) — verbatim from the surface

- `4+ cases / 7 days` → **`Monitor`** (warn pill).
- `8+ cases OR 50% rise week-over-week` → **`Amber`** → prompts `Notify Wassa Amenfi GHS`.
- below monitor → **`Normal`** (green pill).
- Per-category `monitor_threshold` (default 4) + `amber_threshold` (default 8) + `wow_rise_pct` (default 50) — the `Configure thresholds` action edits these. Store per-category-per-school; counts/trends/status are **DERIVED** at read time, never stored (R10/R32 idiom — a stored status that can disagree with its rows is the STPSHS-matrix failure in miniature).

### 6.4 🔴 The one scope tendril — WHERE the syndrome is assigned (Kofi ruling needed)

The outbreak counts **visits** by syndrome. Every visit therefore needs a `surveillance_category`. The realistic path (no NLP, no diagnosis vocabulary, Risk 8): **the matron picks a syndrome at visit assessment** → a **new picker on the shipped visit-record §02 assessment form**. This means **INCR-27 touches the visit-record surface** (a small categorised field added to the assessment), not only the three new sections. **Options for Kofi:**
- **(a)** nullable `surveillance_category` on `sickbay_visit` (0057 ALTER at 0063), matron-set at assessment; uncategorised visits don't count (slight undercount, acceptable — the matron categorises the notable presentations).
- **(b)** derive from the presenting-complaint via a fixed keyword map (fragile; rejected — half-unbacked, and it re-introduces the categorisation-from-free-text problem the module avoided).
- **(c)** categorise only at disposition (fewer rows, but misses the walk-in URTI cases the outbreak is FOR).

**Recommend (a).** It is the only option that populates the URTI count from walk-in visits. It adds one picker to a shipped form and one nullable column at 0063. **This is the whole reason INCR-27 might carry migration 0063.** If Kofi rules the category derivable/deferrable, INCR-27 is migration-free and the outbreak monitor ships as a counts-only read over a categorisation that lands separately.

---

## 7. 🚫 DO-NOT-BUILD — the forbidden school-wide NHIS roll-up (R182, load-bearing)

The **`NHIS card health across the school`** card in §R5 (lines 1265–1290):

| Row (verbatim) | Value |
|---|---|
| `Active cards` | `1,108 / 1,200` (green) |
| `Expired this semester` | `52` (warn) |
| `Expiring next 30 days` | `31` (warn) |
| `No card on file` | `40` (terra) |
| `Coverage rate` | `92.3%` (green) |
| warn note | `**Bursar SMS campaign opens Monday.** Parents of 83 students with expired-or-expiring cards get a one-line SMS asking to renew before the 2026/27 academic year. Saves the school GHS 200+ per future malaria referral.` |

**This is THE canonical STPSHS-matrix fiction in this module — DO-NOT-BUILD, ever, including INCR-27.** Board **R182** is explicit: *"four shapes / three homes / **ZERO school-wide roll-up** (the `1,108/1,200·92.3%` card-health tile is the forbidden STPSHS matrix — never build, incl. INCR-27)."* Owner D3 names it: *"the school-wide card-health roll-up… is this module's STPSHS matrix — DO NOT BUILD IT."* Quinn already shipped an **R182 roll-up guard** at INCR-25a (`e7bdb62`) that reds on an injected school-wide NHIS aggregate count. Labelled *"Synced from student records,"* it has **zero backing** until `student_nhis_card` covers the whole student body (it is a per-open-referral snapshot today, one row per referred student). **Omit the whole card — no shell, no `LIGHT·PLACEHOLDER` badge, no anchor target.**

**Distinguish clearly from the LEGITIMATE per-referral cost recon (§R5.1–R5.3):** the recon strip + outstanding list read `getReferralCostLines` — **real, per-referral, diagnosis-free out-of-pocket** for the ≤3 open cases. That IS built. The forbidden tile is the **school-wide aggregate over all 1,200 students' card status** — a derivation that becomes real only when NHIS card identity lands school-wide (a later increment, never a fabrication; the WASSCE-STPSHS precedent).

---

## 8. 🔴 PII-by-proximity (Risk 4) — A-numbering continued from the referral map (A1–A8 → A9+)

Every place a condition/diagnosis sits beside a name in these three sections, and which aggregates are counts-only vs student-named. Continues the referral map's §6 register (A1–A8); cross-refs the today map where relevant.

| # | Adjacency | Where | Counts-only or named? | Ruling |
|---|---|---|---|---|
| **A9** | 🟢 **the outbreak monitor is COUNTS-ONLY** — category + count + trend + status, **no student names anywhere** | §O5 all six rows, lede, head | **counts-only aggregate** | **The safe design — preserve it.** The temptation to add a "view the N cases" drill-down (which would name the sick students, and by dorm) is **REFUSED**. Category+count is the disclosure ceiling. The `.notes` *"dorm 4 boys (3 of the 6)"* is editorial, unbuilt, and must never become a named view — a dorm+syndrome re-identifies sick students, the sharpest proximity leak in the module. |
| **A10** | working-impression beside a name, ×12 | §R4 table `.h-cond` beside `.h-student`; §R4 lede `both Adwoa` | **student-named** | **ACCEPT within the clinical gate** (MATRON/HEADMASTER, R195 — same posture as the referral-map A1: the impression IS the referral record). The leak to gate is the **`Export CSV/PDF`/`Term report`** (carries names+impressions out) → OMIT or counts-only + audit (A6 precedent). |
| **A11** | 🟢 **the mix bars are counts-only** | §R4 diagnosis-mix + hospital-mix | **counts-only aggregate** | Safe — no names. Derive widths; never hardcode `58%`. |
| **A12** | 🔴 **diagnosis beside a name, shown to the BURSAR** | §R5 outstanding-list `.ol-line` opens with `Malaria 22 Apr` / `SCD crisis 08 May` | **student-named, to a NON-clinical reader** | **THE sharp leak of §R5.** The Bursar's reader (`getReferralCostLines`) is **structurally diagnosis-free** (no clinical column, 0062). Render cost + age + the cost-line **item** string (`cast materials`, `comfort items`) + a generic `Sickbay referral` tag — **NEVER the impression.** This is the referral-map A4 enforced. |
| **A13** | school-wide NHIS status aggregate | §R5 `1,108/1,200` roll-up | aggregate over all students | **DO-NOT-BUILD (R182, §7)** — distinct from PII-adjacency but recorded here: it aggregates every student's insurance status, a school-wide surveillance matrix. Omit entirely. |

**Deliberate non-disclosure copy — preserve VERBATIM (it is the product):** *"NHIS-covered items don't show here — only the gaps NHIS doesn't fill"* · *"the matron never sees billing… the bursar owns it"* · *"Categories align with Ghana Health Service district surveillance"* · *"tracked separately from infectious watch."* The whole point of the outbreak monitor is that it surveils **without naming** — the counts-only shape IS the privacy design.

---

## 9. Seed-drift + day-one empty states (Risk 9 · R201) — demo-only vs what the build needs

The referral map §5 already ruled the referral cast; INCR-27's sections are almost entirely **history/aggregate**, so **the dominant flag is: every table + bar + tile is EMPTY on day one** and needs a real empty state, never a fabricated baseline.

| Item | Where | Seeded reality | Verdict for INCR-27 |
|---|---|---|---|
| **The whole 30-day table (12 rows)** | §R4 | INCR-25b reconciled **Yaa Aidoo** (`SHS-2023-0817`, Slessor + BOARDER, marker-scoped) + K. Boateng as the active cast. The other 10 rows (S. Asante, P. Darko, E. Mensa, N. Antwi, F. Boakye, R. Acquah, E. Owusu, + Adwoa ×2, J. Tetteh) are **fabricated demo history**. | **DAY-ONE EMPTY STATE MANDATORY** (inventory §1.4 #12). The table renders only real `sickbay_referral` rows; a fresh school shows `No referrals in the last 30 days.` Never seed 12 fake rows to fill it. Optionally seed a small demo history scoped to marker rows for the preview (a **seed** task, not a code task). |
| **Adwoa Mensa** (SCD anchor) | §R4 (08 May + 28 Apr, *"both Adwoa"*), §R5 (GHS 45 outstanding) | Seed has **`Abena Mensah`**, not Adwoa Mensa. | **DEMO-ONLY / reconcile.** She appears in §R4/§R5 (this increment) and §05 admission (INCR-26). Recommend renaming the demo to the seeded **Abena Mensah** module-wide (one name, one student), OR marker-seed Adwoa. Not a build blocker — the surfaces render whatever the seed holds. |
| **J. Tetteh's over-30 balance** | §R4 (22 Apr, NHIS Expired, GHS 215) + §R5 (the one over-30 outstanding row) | Not seeded (fabricated). | **DEMO-ONLY** — the over-30 escalation-tone case. To exercise the `over 30 days` terra tint + the escalation copy in the preview, marker-seed **one** referral with an expired-NHIS out-of-pocket cost line aged >22 days. Otherwise §R5 shows the empty state (`No outstanding balances`). |
| **Kufuor / Nkrumah houses** | §R4 rows (`F3 Kufuor`, `F1 Kufuor`, `F2 Nkrumah`) | Seeded houses: Aggrey · Guggisberg · Fraser · Slessor · Kingsley · Aryee. Kufuor/Nkrumah **not seeded**. | **DEMO-ONLY** — only in the fabricated §R4 rows (mandatory empty state), so no reconciliation needed. Houses are **read, never named in code**. Discard, do not seed. |
| **Outbreak counts 6/1/0/0/0/3 + trends `↑ from 2` / `↔ from 4`** | §O5 | Needs a real 7-day window + a prior 7-day window for the trend. | **DAY-ONE EMPTY** (inventory §1.4 #13): *"Outbreak trends… need a prior 7-day window; blank for the first 14 days of operation."* A fresh school shows every category at `0 · ↔ baseline · Normal`. The trend arrow is BLANK (not `↔ steady`) until a prior window exists — **never fabricate `↑ from 2`.** |
| **NHIS-covered `GHS 2,180.00` + `GHS 28.33` avg + `GHS 35 last semester`** | §R5 recon strip | Estimated/prior-term figures with no backing. | **OMIT or empty** (F19) — the `2,180` covered-value is an estimate (do not fabricate); the `GHS 35 last semester` needs a prior term (blank at launch, no fake baseline). |
| **The `Notify GHS-Amenfi` / `Wassa Amenfi GHS` district name** | §O5 | The district office is not a stored integration target. | **D9 — printable/console artefact.** The district name is derivable-or-static (Asankrangwa's district); the notify writes a `DISTRICT_HEALTH` console/print row, **no real channel** (B15). |

---

## 10. NEEDS-SCHEMA / NO-BINDING / fabricated registers — counts continued

### 10.1 N-items (NEEDS SCHEMA) — continued from N32 (referral map)

INCR-27 needs **at most three** new shapes, all for the outbreak; the history + recon read shipped 0062.

| N# | Shape | Fed by | Notes for Wells / Kofi |
|---|---|---|---|
| **N33** | `surveillance_category` — the 6-category syndromic enum (§6.1), assigned per **visit** (`sickbay_visit`, nullable, matron-set at assessment §6.4) | §O5 counts | 🔴 **the migration driver (0063).** ALTER `sickbay_visit` + a category enum/config. Name must contain **no `diagnos` token** (R190). Whether a fixed enum or per-school editable list = Kofi (§6.1). |
| **N34** | `sickbay_surveillance_threshold` — per-category-per-school `monitor_threshold` (4) · `amber_threshold` (8) · `wow_rise_pct` (50) + the category label/description | §O5 thresholds, `Configure thresholds` | Config write `[ADMIN, HEADMASTER]`. Counts/trends/status DERIVED, never stored (R10/R32). |
| **N35** *(conditional)* | `referral_category` — Vocabulary B (§6.2), on `sickbay_referral`, IF Kofi rules it a separate field from N33 (not derived up from the visit syndrome) | §R4 filter facet + diagnosis-mix bars | The referral-map's `N21 diagnosis_category` — **rename to `referral_category`** (R190 grep ceiling). May be derivable from N33; Kofi's call. |

**Everything else in §R4/§R5 reads the shipped 0062 tables** — `sickbay_referral` (status, departed_at, hospital_id), `sickbay_referral_cost_line` (item/provider/nhis_covered/out_of_pocket/billing_line_item_id NULL), `sickbay_hospital` (N6), `student_nhis_card` (per-open-case snapshot), `sickbay_notification` (the `DISTRICT_HEALTH`/`HEADMASTER` recipients authored-not-fired since 0062). **No new table for the history or the recon.**

### 10.2 B-items (NO CLEAN BINDING) — continued from B14

| # | Element | Resolution at INCR-27 |
|---|---|---|
| **B15** | `Notify GHS-Amenfi (district health)` — an outbound district-health channel | 🔴 **D9 — printable/console artefact, NO integration.** Writes a `sickbay_notification` `recipient=DISTRICT_HEALTH`, `status=QUEUED`, `provider='console'` (the 26 boundary) + a printable district-report PDF/console dump. **No SMS/email/API to a real GHS office.** The channel is deliberately un-integrated (same posture as the 26 console-only SMS). |
| **B16** | the `Term report` / `Export CSV/PDF` (§R4) + `Print reminders` (§R5) | **OMIT** (A6/A10) — an export carries names+impressions out; `Term report` may be built as a **counts-only** procurement artefact (no named rows) if the owner wants it. |
| **B17** | a cost-incurred parent SMS (§R5 handoff step 2) | no billing-triggered comms path built (26 built admission/referral tiers only) → **26 console path extension or DEFER.** |

### 10.3 F-items (fabricated demo) — continued from the today map's F14 → F15+

| F# | Item | Where | Verdict |
|---|---|---|---|
| **F15** | 🔴 **counter drift, the module's signature defect** — §R4 lede `Twelve referrals` + meta `12 referrals · 10 returned · 2 active`; the Range facet `30 days 12` vs the Filter facet sum (7+2+1+1+1=12 ✓ here, but the section-meta `10 returned` vs `ten closed` and `2 active` must all derive from one query). | §R4 | **Derive every count** from one referral query; never copy the copy. |
| **F16** | **the 12 history rows are a fabricated cast** — 10 of 12 students unseeded (§9); Kufuor/Nkrumah houses unseeded; two mutually-consistent Adwoa rows (unlike the today file's three-way Adwoa contradiction). | §R4 | **Day-one empty state** (§9). Optionally marker-seed a small demo history. Houses read, never named. |
| **F17** | **outbreak states the surface never draws** — the `.o-trend.down` (green `↓ from N`) class and the **`Amber`** status (terra, 8+/50%) are DEFINED in copy/CSS but **no row uses them**. | §O5 | **AUTHORED** — build the `down` trend and the `Amber` pill (terra) from the N34 rule even though the demo shows only `up`/`flat` and `Monitor`/`Normal`. The threshold copy defines Amber; the monitor must render it when a category crosses 8+ or +50% WoW. |
| **F18** | outbreak demo counts `6/1/0/0/0/3` + trends `↑ from 2` / `↔ from 4` | §O5 | **Day-one blank** (§9, inventory #13) — trend arrows are BLANK until a prior 7-day window exists; never fabricate `↑ from 2`. |
| **F19** | §R5 recon strip figures — `NHIS-covered GHS 2,180.00` (estimate), `Average parent-cost GHS 28.33`, `trending down from GHS 35 last semester` | §R5 | **OMIT the un-derivable ones** — the covered-value estimate and the prior-term baseline have no backing; the average is derivable but blank at launch. Never a fake baseline. |
| **F20** | §R5 forbidden roll-up `1,108/1,200 · 92.3% · 52 · 31 · 40` + `83 students · Bursar SMS campaign` | §R5 | 🚫 **DO-NOT-BUILD (R182, §7)** — the whole card omitted, no shell. |
| **F21** | editorial mix-note assertions — `Malaria sits at 58%` (Western Region rainy season), `Asankrangwa Govt takes everything`, `about one every 2.5 days for a 1,200-student school` | §R4 notes | Editorial in unbuilt panels; the `58%` is derivable (width from count/total), the enrolment/season prose is static-or-dropped. No enrolment figure asserted in built UI. |

---

## 11. Cross-module hooks (design commitments, preserve exactly)

- **Referral history → Setup stock (procurement, the §R4 headline hook):** the diagnosis-mix bar reads INTO the setup §3 stock page — *"the mix bar isn't analytics, it's a **procurement instrument**"* (7 malaria cases → AL/RDT/artesunate reorder before the next academic year). The `Term report` is the procurement artefact. This is the one place the 30-day history feeds another surface's write (the reorder decision) — preserve the commitment even though the actual reorder is the matron's manual act on setup §3.
- **Outbreak → District health (GHS, the §O5 hook):** the amber escalation fires a `DISTRICT_HEALTH` notification — **D9: printable/console artefact, no integration** (B15). The `HEADMASTER` digest recipient (authored 0062, F-E deferred from 26) also lights up here if a headmaster-facing outbreak digest is built.
- **Reconciliation → Billing (D6, the §R5 hook, PARKED):** an out-of-pocket writes a `sickbay_referral_cost_line` (coverage + amount, shipped 0062); the `billing_line_item_id` write with the `Sickbay referral` tag is **display-only at 4.4** (`invoice_id`/`billing_line_item_id` NULL) — the actual financial write is a **STOP-AND-ASK** (D6, same shape as the parked boarding 3× penalty). *"Sickbay creates the cost; billing carries it."*
- **Reconciliation → Comms (the moment-of-incurring SMS):** the cost-incurred parent SMS (handoff step 2) — a new billing-triggered notification not built in 26; the 26 console-only path or deferred (B17).
- **Referral → WASSCE (SC-12, INCR-28):** an inpatient referral during an exam window is the SC-12 special-consideration case; the auto-suggest is app-layer, DRAFT-only, never a trigger (INCR-28, F6). The 30-day history is where a matron/VHM would spot an exam-window referral.
- **Surveillance → Boarding (soft):** the §O5 Skin category note *"monthly inspection in boarding"* is a soft link to `boarding.ts::inspections` (real) — narrative, not a live join.

---

## 12. Interaction states

| State | §O5 outbreak | §R4 history | §R5 recon |
|---|---|---|---|
| **Loading** | 6 row skeletons at real height + head skeleton | table + 2 bar-card skeletons | recon strip + outstanding-list skeletons |
| **Empty · true zero** | 🔴 **the common good state** — every category renders at `0 · ↔ baseline · Normal` (the full set always shows; a clean week is not a hidden section). Trend arrows BLANK until a prior window exists (§9) | `No referrals in the last 30 days.` (`text-navy-3 italic`) — the table + both bars absent, not faked | `No outstanding balances — every referral this window was NHIS-covered.` — the strip still renders (`GHS 0.00` total is an honest zero) |
| **Empty · first 14 days** | every count real (may be 0), **trend column blank** (no prior window) — never `↑ from N` | as above | as above |
| **Populated** | as mapped | as mapped | as mapped |
| **Amber crossing** | a category at `≥ amber_threshold` OR `+≥50% WoW` → **`Amber` pill (terra) + the `Notify GHS-Amenfi` action highlighted** (AUTHORED, F17) | — | — |
| **Over-30 outstanding** | — | — | `.ol-since` terra + the escalation-tone copy (the age, not the amount, is the signal) |
| **Error (read)** | throw to the route error boundary — no bespoke clinical error card | same | same |
| **Error (write)** | `Notify` / `Configure thresholds` failure inline; the panel does not disappear | — (read + export) | `Send SMS` failure inline; row persists |
| **Read-only / wrong actor** | ADMIN refused (no clinical read); MATRON reads thresholds, cannot `Configure`; HEADMASTER reads, no `Notify` write | ADMIN refused (server-side, D2); export gated | 🔴 **BURSAR reads diagnosis-free cost lines only**; MATRON/HEADMASTER read (audit), Bursar owns the write; ADMIN refused |

---

## 13. Mode C (REFERRAL_ONLY) — where these three sections stand

~49% of public SHS are Mode C (Risk 7). None of these sections draws Mode C, so this is authored from R4/R29/R198.

| Section | A/B (drawn) | **C · REFERRAL_ONLY** |
|---|---|---|
| **§O5 outbreak** | as drawn | **renders — and matters MORE.** A Mode-C school has no beds/rounds but still surveils syndromes; the outbreak monitor is one of the few clinical instruments it has. Counts derive from REFER/DISCHARGE visits (no admissions). The `surveillance_category` picker (§6.4) sits on the Mode-C visit assessment identically. |
| **§R4 history** | as drawn | **renders identically — first-class.** A Mode-C school's referral history IS its whole clinical footprint (every serious case is a referral). The mix bars are MOST informative here. |
| **§R5 recon** | as drawn | **renders identically.** NHIS reconciliation is entirely referral-driven, so a Mode-C school's recon is as rich as an A/B school's. Bursar-owned, diagnosis-free. |

**Quinn AC at INCR-27, not discovered later:** a Mode-C school with no beds must produce a complete outbreak monitor + 30-day history + reconciliation end-to-end, empty-by-design where there is no data, never `0/0`-placeholdered.

---

## 14. Responsive / PWA

- **§R4/§R5** inherit the referral file's one media query `@media (max-width:1280px)` (referral-log 317–327): `.recon-strip`→1-col, `.stats-strip`→2-up, the two-column mix-bar grid + the two-column §R5 secondary-card grid→1-col. On phone width the **history table becomes stacked cards** (date+name line 1, impression line 2, status+cost line 3) — do not horizontally scroll a clinical log. The recon outstanding-list rows stack (name+line, then amount+age+action) — the age and amount must both survive a phone width (the Bursar chases from a phone).
- **§O5** inherits the today file (NO media query — authored): the 6 outbreak rows stack their 4 columns on phone (category+description line 1, count line 2, trend+status line 3). The monitor is a glance surface; the amber pill must stay legible at phone width.
- **PWA:** no section-specific variant drawn; the module inherits the app-shell PWA behaviour. The one write worth a 44px target on phone is §R5's `Send SMS` (Bursar) and §O5's `Notify GHS` (matron).

---

## 15. Open questions

| # | Question | Owner | Blocks |
|---|---|---|---|
| **Q1** | §O5 as its own route `/senior/sickbay/today/outbreak` reached from the reinstated live tile (recommended) vs a section of `/senior/sickbay/today` | Kofi | §1.2 |
| **Q2** | 🔴 **§6.4 — WHERE the syndrome is assigned.** Option (a) a nullable `surveillance_category` on `sickbay_visit` set by a NEW matron picker at visit-assessment (recommended — the only way the walk-in URTI count populates), which makes INCR-27 also touch the visit-record §02 form + carry migration 0063. Confirm. | Kofi + Wells | §6.4 · N33 · the migration decision |
| **Q3** | 🔴 **Two vocabularies, one or two fields?** N33 syndromic (Vocab A, per-visit, 6) vs the §R4 mix (Vocab B, per-referral, 5). Is the referral mix its own `referral_category` or derived up from the visit syndrome? Both must avoid the `diagnos` token (R190). | Kofi | §6.1/§6.2 · N35 |
| **Q4** | §R5 `Send SMS reminder` + the handoff-card cost-incurred SMS — route through the 26 console-only path, or DEFER (no billing-triggered comms built)? | Kofi + owner | §R5.1 · B17 |
| **Q5** | §R4 `Term report` — build as a **counts-only** procurement artefact (no named rows) or OMIT? A named-diagnosis export is A10. | Owner | §R4.1 · B16 |
| **Q6** | Migration number: board says `0061` (stale — consumed by 24b); real is **0063** if §6.4 (a) is ruled. Confirm — and confirm INCR-27 is otherwise migration-free (history + recon read shipped 0062). | Wells | header · §10.1 |
| **Q7** | **AUTHORED copy needing sign-off:** the empty-state lines (`No clusters this week — all categories at baseline.` · `No referrals in the last 30 days.` · `No outstanding balances — every referral this window was NHIS-covered.`), the `Amber` pill label + `↓ from {n}` trend, `as of {HH:MM} GMT`, the diagnosis-free §R5 line reconstruction (`Sickbay referral` tag). | Owner | copy review before merge |
| **Q8** | §O5 `Configure thresholds` gate — `[ADMIN, HEADMASTER]` (config, recommended) vs `[MATRON]` (the surface's actor). The matron escalates; who sets policy? | Kofi | §1.3 |

---

## 16. Omit-not-fake register (for the PR body)

| Omitted / not-built | Why | Reinstatement trigger |
|---|---|---|
| 🚫 `NHIS card health across the school` roll-up (`1,108/1,200 · 92.3%`) | **R182 — the forbidden STPSHS matrix**; zero backing until NHIS covers the whole student body | never by fabrication; a real derivation a later increment |
| §R4 `Export CSV` / `Export PDF` / §R5 `Print reminders` | carry names+impressions out of the room (A6/A10) | an owner-approved counts-only artefact |
| §R5 `Open in billing` invoice write | **D6 — STOP-AND-ASK** production financial write | an owner-approved billing-write slice |
| §R5 `NHIS-covered GHS 2,180` estimate + `GHS 35 last semester` | no backing / needs a prior term | when covered amounts / a prior term exist |
| §O5 trend arrows on a fresh school | no prior 7-day window | after 14 days of operation |
| the whole §R4 table + both bars on a fresh school | no referral history | when real referrals exist (day-one empty, not faked) |
| a "view the N cases" drill-down on §O5 | **A9 — names sick students by dorm** | never |
| the diagnosis in the §R5 outstanding line, for the Bursar | **A12 — diagnosis-free cost lines only** | never (structural) |

**Nothing in this list is placeholdered.** No `LIGHT·PLACEHOLDER` badges, no greyed mock rows, no `0/0`, no `—` standing in for an unrecorded value, no disabled control standing in for a deferred write. The empty states are honest and calm — a quiet week in surveillance and a fully-NHIS-covered term are the *good* states.
