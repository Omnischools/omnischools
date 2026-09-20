# Sickbay — Medication layer · Surface Map (INCR-24 · Module 4.4)

**Author:** Lucy (design cartographer) · **Status:** build-ready design spec for the implementation engineer (Claude Code).
**Increment:** INCR-24 — *the append-only MAR · derived rounds · standing orders · drug stock · controlled-substance register + N&MC witness* · migration **0060** · **SPLIT 24a (config) / 24b (clinical), one migration (R166).**
**Source surfaces:** `Surfaces/schoolup-sickbay-setup.html` **§3** (555–704, standing orders + stock — omitted at INCR-21, built now) · `Surfaces/schoolup-sickbay-today.html` **§2** (379–467, rounds — omitted at 21/22, built now) · `Surfaces/schoolup-sickbay-visit-record.html` **§3** (638–788, the MAR — omitted at INCR-22, built now).
**Board (authoritative on LOGIC):** `docs/senior-build-plan.md` → **`## INCR-24 · Sickbay medication layer`** (L2743–2782), Kofi R141–R170 + the 2026-07-25 owner decisions (O1–O5). **Where the surface and the ruling disagree, the ruling wins on logic; I win on visual presentation.**
**Prior maps (the idiom):** `sickbay-setup-surface-map.md`, `sickbay-today-surface-map.md`, `sickbay-visit-surface-map.md`, `sickbay-chronic-register-surface-map.md`.
**Shipped spine this map builds on:** `db/schema/sickbay.ts` (`sickbay_settings`/`sickbay_bed`/`sickbay_schedule_slot` + `sickbay_slot_kind`), `lib/sickbay/{config,defaults}.ts`, the visit atom `sickbay_visit`/`sickbay_admission` (0057), the chronic register `sickbay_chronic_med`/care-plan (0058/0059), `assertSchoolClinician` (extracted at 24a per R158), `lib/access.ts::SICKBAY_ROLES`.

---

## 0. Scope — three surfaces, one migration, the 24a/24b split

| Surface | Source | Split | Route | What it is |
|---|---|---|---|---|
| **A · Standing orders / stock / controlled register** | setup **§3** (+ an authored controlled-register block) | **24a** (config) | `/senior/sickbay/setup#standing-orders` · `#stock` · `#controlled-register` | The Matron's clinical-authority list, the school-level drug stock, and the derived controlled-substance balance + movement ledger. **`[ADMIN, MATRON]` write, `SICKBAY_ROLES` read.** **NO student beside a drug (R162).** |
| **B · Medication rounds** | today **§2** | **24b** (clinical) | `/senior/sickbay/rounds` (see §1.2) | The three daily rounds, each showing its DERIVED due-doses, each dose's status, and the affordance to record a MAR row. **Clinical-read gated.** |
| **C · The visit MAR** | visit-record **§3** | **24b** (clinical) | `/senior/sickbay/visits/[ref]#medications` | The per-episode administration log — append-only, a correction rendered as a footnoted amendment. **Clinical-read gated.** |

**24a** = spine + config (all 4 tables + 3 enums + the `sickbay_doctor_consult_tenant_uk` ADD-UNIQUE in 0060; `assertSchoolClinician` extract; standing-order / stock / controlled-register writes; setup §3; the carried Wells fixes R167 (b)–(e)). **24b** = the clinical MAR (append-only write + witness gate + controlled deduction; derived rounds read; today §2 + visit §3; Doctor-ordered provenance).

**What is SOURCED vs AUTHORED.** The surface draws standing orders, stock, the rounds, and the MAR table. It draws **no** controlled-substance register, **no** amendment row, **no** override affordance, **no** overdue-round state, and **no** per-dose record control. Those five are authored here from the ruling and flagged for owner sign-off (§7).

### 0.1 In-scope elements that reach into other increments

| # | Element | Reaches into | INCR-24 resolution |
|---|---|---|---|
| **Z1** | rounds §2 & MAR §3 read the chronic schedule (`slot_id`, chronic doses) | `sickbay_chronic_med` (INCR-23) | **BACKED** — 23a/23b shipped (board L2739). The derived due-list (R148) and the MAR `Chronic` source both read it live. |
| **Z2** | MAR `Doctor-ordered` source hyperlinks a consult timestamp | `sickbay_consult` (INCR-22, shipped) | **BACKED** — 0060 only ADDs `sickbay_doctor_consult_tenant_uk` so the composite RESTRICT pointer resolves (Wells, R143). |
| **Z3** | rounds §2 lede & MAR next-dose cards imply notification / task-list follow-up | `sickbay_notification` (INCR-26) | **OMIT** the notification framing; render the derived clinical fact only (the visit-map Y5 precedent: never assert a message that was never sent). |
| **Z4** | stock cluster-note "7-day procurement window" | procurement/PO (explicitly EXCLUDED from the "brief", R152) | **OMIT** the procurement clause; re-author the note to a student-free derived reorder line (§2.3). |
| **Z5** | MAR row-3 hydroxyurea "brought from home · NHIS-supplied · her own bottle" | R163 patient-own-supply | **BUILD as a MAR `source=CHRONIC` note** — correct here; it is NOT a stock row (§2.3 / N-DIV-5). |

---

## 1. Shared chrome, routes, gates, tokens, type

### 1.1 Design-doc chrome — do NOT build

All three files are design documents wrapping app frames. Build **only** `.app-shell` (shipped `components/app/sidebar.tsx` + main); the `.notes` right rails are intent documentation — port their rules, render none of their text.

| Do NOT build | Where |
|---|---|
| setup `.section-head` `03` / `Standing orders & drug stock` / `8 first-line treatments · 24 stock items · 3 reorder alerts` | 556–560 |
| today `.section-head` `02` / `Today's medication rounds · scheduled dispensing` / `06:30 / 12:30 / 17:00 / 21:00` | 380–384 |
| visit `.section-head` `03` / `Medications administered · this visit` / `Log · append-only` | 640–644 |
| every `.desktop` / `.browser-bar` / `.url` / drop-shadow `rgba(26,43,71,0.25)` | per section |
| every `.notes` right rail (setup 691–702, today 456–465, visit 777–785) | — |
| the surfaces' three contradictory demo navs incl. the `NEW` tag on the setup Sickbay row (584) and the sub-nav lists | — |

**Notes-panel rules to PORT (not render):** setup — "standing orders are the Matron's clinical authority registered with the visiting doctor", "critical reorder uses terra-bg, not red alarm", "the system narrates the consequence"; today — "each round is append-only", "the prefect assists with check-off but never handles meds · only the matron dispenses", "A. Mensa appears in three rounds because she is admitted"; visit — the three (→four) source tags, "if a Doctor-ordered tag appears, the consult timestamp is hyperlinked · nothing untraceable".

### 1.2 Routes & navigation

- **A (config):** `/senior/sickbay/setup` — anchors `#standing-orders`, `#stock`, and the **new `#controlled-register`** are in-page sections of the one setup route (the INCR-21 `#capacity` precedent). Surface URL `app.omnischools.gh/sickbay/setup#standing-orders`.
- **B (rounds):** **`/senior/sickbay/rounds`.** Surface URL is `…/sickbay/today/rounds`; I map it to a **sibling board of `/today`, not a child** — `/today` (INCR-22) already owns the queue+beds, and rounds is a distinct daily worklist. Reach it from a secondary `Rounds` link on the `/today` page head (the same pattern the today-map used for `Setup`). **Q1 for Kofi:** confirm `/senior/sickbay/rounds` vs the surface-literal `/senior/sickbay/today/rounds`. Nav stays flat, one Sickbay row → `/today`; **no new sub-item.**
- **C (MAR):** `/senior/sickbay/visits/[ref]#medications` — an in-page section of the shipped visit route, reached by scrolling the visit record (the visit-map declared `#medications` "does not exist at 22"; it exists now). Route by `sickbay_visit.reference`, resolved server-side inside `withSchool` (the three-layer no-IDOR pattern).
- **Sidebar:** unchanged — the shipped flat Sickbay row. The app nav wins over all three surfaces' demo navs.

### 1.3 Gates — the three reader sets (R164 / R165)

| Surface | Read | Write | Grounding |
|---|---|---|---|
| **A** stock / standing orders / controlled register | `SICKBAY_ROLES = [ADMIN, HEADMASTER, MATRON]` (the setup-module gate) | **`SICKBAY_STOCK_WRITE_ROLES = [ADMIN, MATRON]`** (new — R165, the matron **GAINS** §3 write) | Config, not the clinical graph. **ADMIN can READ this screen — which is the whole reason R162 forbids a student name here.** |
| **B** rounds & **C** MAR | **`SICKBAY_CLINICAL_READ_ROLES = [HEADMASTER, MATRON]`** (NOT ADMIN — D2) | **`SICKBAY_CLINICAL_WRITE_ROLES = [MATRON]`** | R164 — the MAR is the acute/round clinical graph, gated by the app-layer clinical pair, **NOT `staff_grant_scope`**. |

**O2 (owner-ratified): NO grantee MAR.** A housemaster's chronic `FULL_PLAN` grant reaches the care **PLAN** (INCR-23), never the administration log or the rounds board. Do not widen either clinical gate for grant-holders at 24. **Every clinical actor pointer** (administered_by, witness, movement actor/witness) passes `assertSchoolClinician(schoolId, userId[, {requireNmc}])` at the app layer — the DB cannot (ref_user is global; the licence lives on the tenant `staff_profile`). **Sarah's highest item, carried from the visit map:** confirm ADMIN is refused `/rounds` and `#medications` (module access ≠ clinical read).

### 1.4 Token reference (`:root` identical across all three files → Tailwind token class)

Identical hexes to `md files/design-tokens.json`. Tailwind token classes in JSX, **never inline `var(--x)`**.

| Surface var | Hex | Tailwind | Used in scope for |
|---|---|---|---|
| `--navy` | `#1A2B47` | `text-navy` / `bg-navy` | body, `.s-complaint`, `.s-treat b`, `.drug-table td.name b`, `.med-log td.drug b`, `.r-time`, `.r-stu`, `.live-clock` |
| `--navy-2` | `#2D3F5C` | `text-navy-2` | `.s-treat`, `.med-log td.time`, `.med-log .by b`, `.med-tag.prn` text, `.r-list`, cluster-note amendment text |
| `--navy-3` | `#5C6675` | `text-navy-3` | crumb, lede, every `.sub`/`.by`/`.r-helper`/`.r-label` sub-line, table `th`, `.pill.pending` text |
| `--gold` | `#C8975B` | `text-gold` / `bg-gold` / `border-gold` | every italic `<em>`, `.s-treat .arrow`, `.med-tag.standing`, `.r-time em`, `.r-stu + .r-stu::before` sep, `.pill.due-soon`, next-dose PRN time |
| `--gold-soft` | `#E8D4B8` | `border-gold-soft` | amendment cluster-note border, next-dose card border |
| `--gold-bg` | `#F5EBDC` | `bg-gold-bg` | `.med-tag.standing`, `.round-row.due-now` gradient start, `.pill.due-soon`, amendment cluster-note fill |
| `--bg` | `#FAF7F2` | `bg-bg` | page ground, table `th` ground, `.standing-row`, `.med-tag.prn` fill, `.pill.pending` fill, `.live-clock` fill |
| `--surface` | `#FFFFFF` | `bg-surface` | cards, `.body-shell`, `.btn` |
| `--green` | `#2F6B47` | `text-green` | `.stock-pill.ok`, `.med-tag.scheduled`, `.pill.done`, `.round-row .r-helper b`, next-dose chronic time, `.lc-dot` |
| `--green-bg` | `#E5EFE8` | `bg-green-bg` | `.stock-pill.ok`, `.med-tag.scheduled`, `.pill.done`, `.round-row.done` gradient start |
| `--terra` | `#B84A39` | `text-terra` / `bg-terra` | `.stock-pill.critical`, **the authored overdue-round pill (§3.5)**, the authored controlled-balance-negative guard |
| `--terra-bg` | `#F5E1DC` | `bg-terra-bg` | `.stock-pill.critical`, overdue-round gradient |
| `--warn` | `#C58A2E` | `text-warn` | `.stock-pill.low` |
| `--warn-bg` | `#F5E9D0` | `bg-warn-bg` | `.stock-pill.low` |
| `--border` | `#E5DFD3` | `border-border` | card borders, `.standing-row`, `.drug-table td`, `.med-log td`, `.round-row` dividers, `.med-tag.prn` border, `.pill.pending` border |
| `--border-2` | `#D4CCBA` | `border-border-2` | every table `th` bottom |

**Type families:** `font-display` = **Fraunces** (h1, `.s-complaint`, `.drug-table td.name b`? no — that is Manrope bold; the Fraunces set is `.s-complaint`, `.r-time`, `.ch-title`, next-dose card titles, avatar glyphs, every gold `<em>`) · default = **Manrope** · `font-mono` = **JetBrains Mono** (`.drug-table td.r` numeric columns, `.med-log td.time` + `td.dose`, `.r-time`? no — `.r-time` is Fraunces; the mono set is the stock numerics, the MAR time & dose, the `.live-clock`, the controlled-register quantities, the N&MC number, the `02/27` expiry).

**Absent-value convention:** em-dash `—` in `text-navy-3` for *unknown*; a genuine count of `0` renders `0`. **Neither applies to a clinical field** — an absent witness renders nothing (or the override reason), never `—`; an un-given dose is a state, not a dash.

### 1.5 No-alpha discipline (repo memory `no-alpha-token-opacity`)

**In-scope finding: every fill in all three §3/§2 body regions is a solid token or a dedicated `-bg` tint — translucency-free.** The `.round-row.done` / `.due-now` gradients use `linear-gradient(90deg, var(--green-bg)|var(--gold-bg) 0%, transparent 60%)` — a token→**transparent** fade, **not** slash-opacity; port as `bg-[linear-gradient(90deg,var(--green-bg)_0%,transparent_60%)]`, never `bg-green-bg/60`. The only `rgba()` literals are the shipped navy sidebar (already built). **Verify in the live preview, not the build.**

### 1.6 Bespoke / non-token values — reproduce exactly

**Surface A — setup §3** (CSS 135–166)

| Element | Bespoke value |
|---|---|
| `.standing-list` | `grid grid-cols-2 gap-2` → **`grid-cols-1` below 1280px** (media query 197) |
| `.standing-row` | `bg-bg border border-border rounded-lg p-[10px_14px]` |
| `.s-complaint` | Fraunces `13px` 600 `tracking-[-0.005em]` navy `mb-[3px]` |
| `.s-treat` | `11px text-navy-2 leading-[1.5]`; `b` → navy 600; `.arrow` → `text-gold mx-1` |
| `.drug-table` | `w-full border-collapse`; `th` `bg-bg p-[8px_12px] 9px/0.14em uppercase 700 text-navy-3 text-left border-b border-border-2` (`.r` → right); `td` `p-[9px_12px] text-[12px] border-b border-border align-middle`; last row no border |
| `.drug-table td.r` | **`font-mono font-semibold text-right`** (the numeric columns) |
| `.drug-table td.name b` / `.sub` | navy 600 · `.sub` `block 10px text-navy-3 italic mt-px` |
| `.stock-pill` | `inline-block px-2 py-[2px] rounded-full 9px/0.06em uppercase 700`; `.ok` `bg-green-bg text-green` · `.low` `bg-warn-bg text-warn` · `.critical` `bg-terra-bg text-terra` |
| §3 h3 headings | inline Fraunces `16px` 600 navy + inline gold italic `<em>` |

**Surface B — today §2** (CSS 126–142, 210–218)

| Element | Bespoke value |
|---|---|
| `.body-shell` | `bg-surface rounded-[14px] overflow-hidden border border-border` |
| `.head-row` | `p-[18px_22px_16px] border-b border-border flex justify-between items-end gap-[14px]` + `bg-[linear-gradient(180deg,var(--bg)_0%,var(--surface)_100%)]` |
| `.hr-l h3` / `p` | Fraunces `20px` 600 `tracking-[-0.01em]`, em italic gold · `12px text-navy-3 mt-[3px]`, b navy-2 600 |
| `.live-clock` / `.lc-dot` | `font-mono 13px 600 navy p-[5px_10px] bg-bg border border-border rounded-md` · dot `inline-block size-[6px] rounded-full bg-green mr-[6px] align-middle` |
| `.round-row` | `grid grid-cols-[110px_1fr_110px] gap-[18px] p-[16px_20px] items-center border-b border-border`; last none |
| `.round-row.done` / `.due-now` | `bg-[linear-gradient(90deg,var(--green-bg)_0%,transparent_60%)]` / `…var(--gold-bg)…` |
| `.r-time` / `.r-label` | Fraunces `22px` 600 navy, em italic gold · `.r-label` `block 9px/0.14em uppercase 700 text-navy-3 mt-[2px]` **font-body** (Manrope inside a Fraunces cell — deliberate) |
| `.r-list` / `.r-stu` / sep / `.r-helper` | `12px text-navy-2 leading-[1.6]` · `.r-stu` navy 600 · `.r-stu + .r-stu::before` = `content:" · "` gold 700 (render a real `<span aria-hidden> · </span>`) · `.r-helper` `block 10px text-navy-3 italic mt-1`, b → `text-green not-italic 600` |
| `.r-status .pill` | `inline-block p-[4px_10px] rounded-full 9px/0.08em uppercase 700`; `.done` `bg-green-bg text-green` · `.due-soon` `bg-gold-bg text-gold` · `.pending` `bg-bg text-navy-3 border border-border` |

**Surface C — visit §3** (CSS 173–188 + inline)

| Element | Bespoke value |
|---|---|
| `.med-log` | `w-full border-collapse`; `th` `bg-bg p-[9px_12px] 9px/0.14em uppercase 700 text-navy-3 text-left border-b border-border-2` (`.r` right); `td` `p-[10px_12px] text-[12px] border-b border-border align-middle`; last row no border |
| `.med-log td.time` | **`font-mono 11px text-navy-2 font-semibold whitespace-nowrap`** |
| `.med-log td.drug b` / `.sub` | navy 600 · `.sub` `block 10px text-navy-3 italic mt-px` |
| `.med-log td.dose` | **`font-mono font-medium`** |
| `.med-log td .by` / `.by b` | `10px text-navy-3 italic` · b → `text-navy-2 not-italic 600` |
| `.med-tag` | `inline-block p-[2px_7px] rounded-full 9px/0.06em uppercase 700`; `.standing` `bg-gold-bg text-gold` · `.scheduled` `bg-green-bg text-green` · `.prn` `bg-bg text-navy-2 border border-border` |
| next-dose cards (inline) | `grid grid-cols-2 gap-[14px] mt-5`; card `bg-surface border border-border rounded-xl`; head `.ch-title` Fraunces `16px` 600 + em gold; body time `font-mono 20px 600` (gold for PRN / green for chronic); title Fraunces `14px` 600 + em gold; sub `11px text-navy-3` |
| amendment cluster-note (inline) | `bg-gold-bg border border-gold-soft rounded-[10px] p-[14px_18px] mt-5 text-[12px] text-navy-2 italic`; b → `not-italic 600` |

**AUTHORED token additions** (no surface source — §7): a **4th `.med-tag` variant** `Doctor-ordered`; an **overdue `.pill`**; an **amendment row** left-border; a **controlled-register** movement list.

---

## 2. Surface A — setup §3 (24a) · Standing orders / stock / controlled register

**Surface lines 555–704.** Sidebar actor: the surface switches the footer to `Mrs Bediako · Senior Matron` (line 593–594) — proof the actor gains §3. Render the acting user; do not hardcode.

### 2.1 Page head

| Element | Exact copy | Call |
|---|---|---|
| Crumb | `Sickbay` *(link)* ` / Setup / Standing orders & stock` | BUILD |
| `<h1>` | `Standing orders & ` + `<em>stock</em>` | BUILD |
| Lede | `First-line treatments the Matron is cleared to administer without doctor sign-off · plus the master drug stock register · <b>3 items at or below reorder point</b>` | **RE-AUTHOR** — the `3 items` fragment is a DERIVED count and it is fabricated (N-DIV-1). Render `…the master drug stock register · <b>{n} items at or below reorder point</b>` where `n = count(qty_on_hand < reorder_point)`. |
| Action 1 | `N&MC scope ↗` | **OMIT** — dead outbound link, the setup-map FLAG-L2 precedent (`↗` promising a target the `href="#"` does not have). |
| Action 2 | `+ Add standing order` | **BUILD** — `SICKBAY_STOCK_WRITE_ROLES` only. |

### 2.2 Standing orders (`#standing-orders`)

- h3: `<em>Standing orders</em> · what the Matron treats without escalation` — **BUILD verbatim.**
- Intro `<p>`: `These are the first-line treatments registered with the visiting doctor under N&MC scope of practice. Anything outside this list waits for Dr Mensah on Thursdays — or escalates to referral.` — **RE-AUTHOR:** the specific `Dr Mensah on Thursdays` is one school's demo. Render the doctor-generic form and bind the name if desired: `Anything outside this list waits for the visiting doctor — or escalates to referral.` (R160: `ordered_by_doctor_name` is attribution, not a gate; the intro must not imply a named external actor is required.)
- `.standing-list` — 2-col grid, 8 rows. Each `.standing-row` = `.s-complaint` + `.s-treat`, mapping to `sickbay_standing_order` (R159): `complaint` → `.s-complaint`; `treatment` → `.s-treat` (the freeform line incl. the gold `→` arrow).

**The 8 rows — SOURCED copy (BUILD verbatim as the school's data, NOT as a seed):**

| `.s-complaint` | `.s-treat` (verbatim, `<b>` on the drug, `<span class="arrow">→</span>`) |
|---|---|
| `Headache · uncomplicated` | `<b>Paracetamol</b> 500mg → 1–2 tabs · rest 30 min · review` |
| `Menstrual pain` | `<b>Paracetamol</b> 500mg + hot water bottle → rest in sickbay if needed` |
| `Sore throat · viral` | `<b>Saline gargle</b> + paracetamol → review 24h · refer if fever rises` |
| `Diarrhoea · uncomplicated` | `<b>ORS sachet</b> + observation → refer if >6 episodes or fever` |
| `Suspected malaria` | `<b>RDT test</b> · if positive → AL first dose + refer to OPD same day` |
| `Minor cuts & abrasions` | `<b>Saline wash</b> + povidone iodine + dressing → tetanus check on chronic register` |
| `Sprains · sports injury` | `<b>RICE protocol</b> + paracetamol → X-ray referral if weight-bearing fails` |
| `Insect bites · allergic skin` | `<b>Chlorpheniramine</b> 4mg + topical calamine → refer if facial swelling` |

- **Do NOT seed these 8.** Standing orders are clinical authority *registered with a doctor* (R159/R160) — auto-seeding them asserts a clinical claim the product has not been authorised to make (the O3 "don't seed a national schedule" reasoning applied to orders). Ship an **empty state + Add** (§2.5); the 8 rows are the canonical starter *content the matron enters*, offered as a form template if anything, never a silent seed. **Q2 for Kofi** — confirm no-seed.
- **`Minor cuts` row keeps the cross-module hook** `tetanus check on chronic register` — a design commitment (discipline→billing / sickbay→attendance class). It is free text here (no FK); preserve the string. The notes panel calls this out ("a routine first-aid event triggers a check against the student's immunization history").
- **N-DIV-4 (flag):** R159 models `treatment` **and** `escalation` as separate fields, plus `ordered_by_doctor_name`. This compact row renders ONE freeform `.s-treat` line and shows neither the escalation as a distinct slot nor the attribution. **Recommend:** `.s-treat` binds `treatment` verbatim (the arrow-and-escalation prose is how a matron writes a first-line order); render `escalation` as an optional second sub-line only if the school enters it separately, and surface `ordered_by_doctor_name` in the edit/detail affordance, not the list row (provenance need not appear in the list). Confirm with Wells/Kofi.

**Control — `+ Add standing order`:**

| Field | Input | Validation |
|---|---|---|
| Complaint | text | required, ≤ 64 |
| Treatment | text (multiline) | required, ≤ 240 |
| Escalation | text | optional, ≤ 160 |
| Ordered by (doctor) | text — `ordered_by_doctor_name`, **copied text, NOT a `ref_user`** (R21/R159) | optional, ≤ 96 |
| Active | toggle | default on |

Edit is an ordinary update (standing orders are **config, not the append-only clinical record** — do not conflate with the MAR). Every mutation audited.

### 2.3 Drug stock register (`#stock`)

- h3: `Drug stock register · top 12 of 24 items` — **RE-AUTHOR** the `top 12 of 24 items` demo-pagination string to a real paginated/derived count: `Drug stock register · {n} items` (or paginate; the surface's "top 12" is a static screenshot artefact).
- `.drug-table` — columns `Item` / `In stock` (r) / `Reorder at` (r) / `Last restocked` (r) / `Status` (r). Maps to `sickbay_stock_item` (R161): `drug_name` + `form_label`/`unit` (`.sub`), `qty_on_hand` (In stock — the manual reorder aid, `ponytail:` corner), `reorder_point` (Reorder at), `last_restocked_at` (Last restocked), `is_controlled` (see below), `active`.

**The 12 rows — SOURCED, with the Risk-4 refusals applied:**

| `.name` b | `.sub` (form/unit) | In stock | Reorder at | Last restocked | Status |
|---|---|---|---|---|---|
| `Paracetamol 500mg` | `tablets · adult dose` | `412` | `200` | `28 Apr` | `OK` |
| `ORS sachets` | `oral rehydration · standard` | `84` | `40` | `2 May` | `OK` |
| `Artemether-lumefantrine` | `AL · 20/120mg · malaria first-line` | `14` | `12` | `14 Apr` | `Low` |
| `Malaria RDT kits` | `rapid diagnostic · SD Bioline` | `22` | `20` | `20 Apr` | `Low` |
| `Hydroxyurea 500mg` | ~~`sickle cell chronic · for Adwoa Mensa`~~ → **`500mg tablet`** | `8` | `14` | `15 Apr` | `Reorder` |
| `Salbutamol inhaler` | `100mcg · asthma rescue` | `3` | `2` | `5 Mar` | `OK` |
| `Chlorpheniramine 4mg` | `antihistamine · allergies` | `68` | `40` | `28 Apr` | `OK` |
| `Povidone iodine 10%` | `antiseptic · 100ml` | `4 bottles` | `2` | `12 Mar` | `OK` |
| `Adhesive bandages` | `various sizes` | `240` | `100` | `2 May` | `OK` |
| `Sterile gauze` | `10cm × 10cm packs` | `38` | `30` | `2 May` | `OK` |
| `Calamine lotion` | `topical · 100ml` | `2` | `3` | `14 Feb` | `Reorder` |
| `Sanitary pads` | `menstrual supply · school-issued` | `112` | `60` | `28 Apr` | `OK` |

- 🔴 **R162 REFUSAL (the headline).** The `Hydroxyurea 500mg` sub-line `sickle cell chronic · for Adwoa Mensa` is **REFUSED**. `for Adwoa Mensa` is a student beside a drug on a screen ADMIN can read — a sickle-cell re-identification. Render the drug's **form/unit only** (`500mg tablet`). The therapeutic-indication fragment `sickle cell chronic` is **also dropped** (softer call, MA4): a stock row is *form + quantity*, not a clinical indication; hydroxyurea's name already carries the inference and the indication adds nothing operational to a stock-keeper. **Q3 for owner** — confirm dropping the indication descriptor, or keep form-only.
- 🔴 **R163 / N-DIV-5 (flag).** The surface lists Hydroxyurea as *school stock* while also tagging it `for Adwoa Mensa` — but **a patient's own surrendered NHIS-supplied bottle is NOT school stock and not in the register** (R163). Two mutually-exclusive readings: either this is genuine general school stock (keep the row, drug + qty, no student) **or** it is Adwoa's own supply (then it does not belong on this register at all — it lives as a MAR `source=CHRONIC` note, see §4.2 row 3). The register must never carry a patient-supply row. Ship the row **only as general school stock**; if the school does not stock hydroxyurea generally, the row does not exist.
- **Status pill is DERIVED** from `qty_on_hand` vs `reorder_point` (R161), never stored: `qty < reorder_point → Reorder` (`.critical` terra) · `reorder_point ≤ qty ≤ reorder_point × 1.25 → Low` (`.low` warn) · else `OK` (`.ok` green). This reproduces all 12 surface pills (AL 14/12 & RDT 22/20 → Low; Salbutamol 3/2 & Povidone 4/2 → OK; Hydroxyurea 8/14 & Calamine 2/3 → Reorder). **The 1.25 margin is a tunable heuristic** — `ponytail:` comment it; the owner may set the "Low" band per school.
- **AUTHORED addition — a `Controlled` indicator.** `is_controlled` (R151) drives whether a GIVEN dose needs a witness (R154); the stock-keeper must see which items are controlled. Render a small `Controlled` pill (`bg-navy-2 text-bg` — reuse the attendance-M tint idiom, or a bespoke navy pill) on controlled rows. **A drug name + a `Controlled` flag is NOT a leak** (no student). Flag for owner (§7). No surface source.

**Cluster note** (surface 684): `<b>Three items below reorder point</b> · Hydroxyurea (Adwoa's chronic supply) · Calamine lotion · Malaria RDT kits are within margin. The 7-day procurement window means Hydroxyurea needs ordering this week to avoid a gap in Adwoa Mensa's chronic dose schedule.` — **RE-AUTHOR fully:**
  - 🔴 REFUSE `(Adwoa's chronic supply)` and `to avoid a gap in Adwoa Mensa's chronic dose schedule` (R162 — student beside a drug).
  - OMIT `The 7-day procurement window` (Z4 — procurement is excluded from the "brief", R152).
  - Fix the fabricated `Three` (N-DIV-1) — derive the count.
  - **Authored replacement (§7):** `<b>{n} items at or below reorder point</b> · {drug names, no student}. Reorder before the next dispensing gap.` Rendered in the same dashed-note idiom (`.cluster-note`, terra-bg-free — calm, not alarm, per the notes panel).

### 2.4 Controlled-substance register (`#controlled-register`) — **fully AUTHORED (no surface source)**

Built from R151/R152/R156. A new sub-section on the setup §3 page. **NO student, NO per-student linkage on this screen (R152).**

- h3 (authored): `Controlled ` + `<em>substances</em> · running balance` — Fraunces 16px + gold em, matching §3's h3 idiom.
- Intro (authored, §7): `A running balance derived from receipts, administrations, and wastage. No stored count — the number below is computed each time you open this page.`
- **One block per controlled `sickbay_stock_item`** (`is_controlled = true`). Each block:
  - **Header row:** `drug_name` (navy 600) · a **derived balance** rendered `font-mono` — `balance = Σ RECEIPT − Σ(controlled GIVEN MAR dispensed_qty) − Σ WASTAGE ± Σ ADJUSTMENT` (R152/R153). A negative balance is a reconciliation error → render the number `text-terra` with an authored `Balance below zero — reconcile` note.
  - **Movement list** — an append-only ledger styled like `.med-log` rows. Columns: `Date` · `Type` · `Qty` · `Actor` · `Witness` · `Batch` · `Reason`. Rows drawn from `sickbay_controlled_movement` (RECEIPT / WASTAGE / ADJUSTMENT) **plus** the controlled GIVEN administrations **read from the MAR** (R152 — administrations are NOT a movement row; they are derived from `sickbay_med_admin`, one source of truth).
    - A movement row: `+{qty}` (RECEIPT, green) / `−{qty}` (WASTAGE/administration, terra) / `±{qty}` (ADJUSTMENT).
    - The MAR-derived administration row renders `−{dispensed_qty} · administered · {actor} · {witness or override}` — **and carries NO student** even though the source MAR row does (MA6). The projection strips `student_id`.
    - **Witness column (R152):** a controlled **WASTAGE** requires a `witness_user_id` (the diversion point) — render the witness name; a controlled administration shows its MAR witness/override. **A staff witness name beside a drug is intended accountability, not a student leak (MA7).**
- Controls (`SICKBAY_STOCK_WRITE_ROLES`): `+ Record receipt`, `+ Record wastage` (witness required for controlled), `+ Adjustment` (reason required). Each field: `quantity` (>0), `occurred_at`, `batch_ref` (optional), `reason` (required for ADJUSTMENT/WASTAGE), `witness` (required for controlled WASTAGE, `assertSchoolClinician`). Append-only — no edit, a correction is a new ADJUSTMENT row.

### 2.5 Surface A interaction states

| State | Render |
|---|---|
| **Loading** | Card/table skeletons at real row heights; standing-list at 8, stock at 12. |
| **Empty · standing orders** | `.standing-list` absent; one dashed line + CTA: `No standing orders registered.` (authored) + `+ Add standing order`. |
| **Empty · stock** | Table head renders; one body row: `No stock items yet.` + `+ Add item`. |
| **Empty · controlled register** | Two sub-states: (a) **no controlled items flagged** → `No controlled substances flagged. Mark an item "controlled" in the stock register.` (authored); (b) **item flagged, no movements** → the balance block renders `Balance 0` + `No movements recorded.` |
| **Error (write)** | Inline under the field; the row does not disappear. |
| **Disabled (read-only ADMIN vs HEADMASTER)** | ADMIN/HM read every row; ADMIN **has write** (R165), HEADMASTER does not (not in `SICKBAY_STOCK_WRITE_ROLES`) — hide the CTAs for HM, keep the data. |

---

## 3. Surface B — today §2 (24b) · Medication rounds (`/senior/sickbay/rounds`)

**Surface lines 379–467.** Sidebar actor: `Mrs A. Bediako · Matron`. Clinical-read gated (§1.3).

### 3.1 Page head

| Element | Exact copy | Call |
|---|---|---|
| Crumb | `Sickbay` *(link)* ` · ` `Today` *(link)* ` · Medication rounds` | BUILD |
| `<h1>` | `Medication ` + `<em>rounds</em>` + ` · today` | BUILD |
| Lede | `<b>06:30 ✓</b> 4 students · <b>12:30 ✓</b> 1 student · <b>17:00</b> due 2h 15m · <b>21:00</b> due 6h 15m` | **RE-AUTHOR — THREE rounds, all counts/times derived.** Drop the `17:00` clause (R13). Render one segment per `MEDICATION_ROUND` slot: `<b>{HH:MM} ✓</b> {n} given` for a completed round, `<b>{HH:MM}</b> due {relative}` for the next, `<b>{HH:MM}</b> {relative}` for a pending one, `<b>{HH:MM}</b> overdue {relative}` for a lapsed one. |
| Action 1 | `View 7-day history` | **DEFER / OMIT at 24 (N-DIV-8)** — a real read but no historical-rounds view is mapped; do not ship a dead button. Re-open as a follow-up. |
| Action 2 | `Mark 17:00 ready` | **OMIT / RE-AUTHOR (N-DIV-7)** — the 17:00 round does not exist (R13) **and** there is no "round-ready" model. R148/R149: a dose closes when the matron writes a MAR row, per dose. Replace with the per-dose `Record` affordance (§3.4). |

### 3.2 The derived round mechanics (R148 / R149 / R150) — the surface's core logic

**The rounds are NOT hardcoded.** They are `sickbay_schedule_slot WHERE sickbay_slot_kind = 'MEDICATION_ROUND'` (R15), ordered by `start_time`, **anchor first** (R16). Canonically **THREE** — `06:30` (anchor) / `12:30` / `21:00` (R13) — because that is the canonical seed, but the board renders `count(MEDICATION_ROUND slots)` rows for whatever the school configured. **The surface's 17:00 round and its `06:30/12:30/17:00/21:00` meta are demo drift and do not render (R13).**

**Per round, the due-doses are a DERIVED READ, never a table (R148):** live `sickbay_chronic_med` where `slot_id = round.slot_id` AND the entry is active AND `on_site_treatable` AND today's **Accra civil weekday** ∈ `slot.days_of_week` AND (`runs_on_holidays` OR not a holiday). A dose is **"done"** once a **terminal** MAR row (`GIVEN`/`REFUSED`/`HELD`/`OMITTED`) exists for `(student, med, civil-day)`. **Statement-count guard stays flat** (R148 — no N+1).

- **R149 overdue is DERIVED at read time, NO scheduler.** Nothing auto-writes `OMITTED`. A round whose `start_time` (or a window past it) has passed on today's civil day, with ≥1 non-terminal due dose, renders **overdue** (§3.5). The matron closes an overdue dose by writing a MAR row.
- **R150 PRN is not round-driven.** A PRN med appears in **no** round list; a PRN dose enters the MAR directly (`is_prn`, `slot_id NULL`, criteria in `notes`). The surface's `A. Mensa (bedside · … paracetamol PRN)` fragment shows a PRN *alongside* a chronic round dose — render the chronic dose in the round; the PRN is an entry the matron makes, not a due row.

### 3.3 The round rows — element by element

Section `.head-row`: h3 `Four <em>rounds</em> · today's dispensing schedule` → **RE-AUTHOR** to `Three <em>rounds</em> · today's dispensing schedule` (or derive `{n}`). The `.hr-l p` `Standing rule from sickbay setup · all chronic-condition meds dispensed by matron in person · <b>F. Tetteh</b> (Sick Bay Prefect, Aggrey) assists with 06:30 round check-off` → **RE-AUTHOR:** drop the prefect-assist clause (the prefect-supervision model is retired for the witness rule; a prefect's help is an optional free-text note, R155). Bind the remainder to the anchor slot's stored description (R13: "the description is the handoff document"). `.hr-r .live-clock` `14:45 GMT` → a client wall-clock in **Africa/Accra**; keep as a live element, render derived time.

**THREE `.round-row`s (the 17:00 `.due-now` row is OMITTED):**

| Round | `.r-time` / `.r-label` | `.r-list` (SOURCED, re-authored) | `.r-status` |
|---|---|---|---|
| **06:30** `done` | `06:30` / `Morning · pre-breakfast` | `A. Mensa · Y. Mensah · B. Antwi · K. Adusah` + helper `Dispensed by Mrs Bediako · 06:30 to 06:47` (prefect clause → optional note) | `✓ Done · 06:47` (`.done`) |
| **12:30** `done` | `12:30` / `Lunch · post-meal` | `A. Mensa (in-bed dose · paracetamol 1g)` + helper `Dispensed bedside · 12:32` | `✓ Done · 12:32` (`.done`) |
| ~~**17:00** `due-now`~~ | ~~`17:00` / `Evening · pre-prep`~~ | ~~`A. Mensa (bedside · hydroxyurea check, paracetamol PRN)` · `Y. Mensah (Keppra 500mg · second dose)`~~ | ~~`Due in 2h 15m`~~ **OMIT (R13)** |
| **21:00** `pending`→derived | `21:00` / `Night · post-prep` | `B. Antwi (Cetirizine 10mg)` · `A. Mensa (if still admitted · evening vitals check)` + helper `Asst Matron Ms G. Antwi on duty` | `Pending` (`.pending`) — or `Due in {rel}` / `Overdue {rel}` derived |

- `.r-time` = `slot.start_time`; `.r-label` = the slot's short label (SOURCED short forms above; bind to a slot field, do not hardcode).
- `.r-list .r-stu` = **student name + drug** (the derived due dose). **The `· ` separator is the gold `::before` — render a real `<span aria-hidden>`.** The parenthetical `(Keppra 500mg · second dose)` = the drug + `dose_label` snapshot; `(if still admitted …)` is a derived conditional (only render the row when the admission is open).
- `.r-helper` = optional. The prefect note (`F. Tetteh (Sick Bay Prefect) assisted with check-off`) renders only if the matron recorded it — a `note`, never a witness (R155). The green-bold fragment is the assistant clause.
- **`.r-stu` naming — full vs abbreviated (MA-cross-ref C0):** the surface abbreviates (`A. Mensa`). This is an operational worklist the matron dispenses from — **recommend FULL names** (a mis-identified dose is a medication error; the chronic-register C0 reasoning), and **state it in the PR** so nobody imports the today-board abbreviation control. **Q4 for Kofi + Sarah.**

### 3.4 The record-a-dose affordance + witness (replaces "Mark round ready")

Each **non-terminal** due dose in a round carries a `Record` affordance (`.btn-sm`, gold — the shipped `px-[11px] py-[6px] text-[11px] rounded-[5px] border border-gold bg-gold text-navy`). It opens the **same append-dose form as the MAR** (§4.4), pre-filled: `student_id`, `drug_name`/`dose_label`/`route`/`is_controlled` snapshot from the chronic plan (R144), `slot_id` = this round, `source = CHRONIC`. On save it writes a `sickbay_med_admin` row; the dose leaves the due-list and the round advances toward `Done`. `SICKBAY_CLINICAL_WRITE_ROLES` (MATRON) only — a HEADMASTER reading the board sees no `Record` control.

**Witness (R154–R157) surfaces in this form when the dose is controlled:** see §4.4 — identical affordance in both entry points.

### 3.5 Surface B interaction states — the derived-round + overdue states

| State | Render |
|---|---|
| **Loading** | `.body-shell` + `.round-row` skeletons at 3 rows. |
| **Round · complete** (`done`) | Green-fade `.round-row.done`; pill `✓ Done · {last MAR time}`; due-list rendered as the given students. |
| **Round · due next** (`due-now`) | Gold-fade `.round-row.due-now`; pill `Due in {relative}` (`.due-soon`) — the next round whose window is open/approaching. |
| **Round · pending** | No fade; pill `Pending` (`.pending`) — a future round, window not yet open. |
| **Round · OVERDUE** (AUTHORED, R149) | **Terra-fade** `bg-[linear-gradient(90deg,var(--terra-bg)_0%,transparent_60%)]`; **authored pill `Overdue {relative}`** `bg-terra-bg text-terra` — window passed, ≥1 non-terminal dose remains. Nothing auto-writes OMITTED; the matron closes each dose by recording it. |
| **Round · partial** (AUTHORED) | Some doses terminal, some open, window passed → the round shows the **overdue** treatment with a count `{given} of {total} given · {open} overdue` in the helper line. |
| **Round · nothing due today** | The round row renders with an empty due-list and pill `None due` (`.pending` styling) — a legitimate state (no chronic student is scheduled on this weekday). **Not an error, not `—`.** |
| **Board · no rounds configured** (Mode C, or no MEDICATION_ROUND slots) | The `/rounds` board does not render its schedule; an authored dashed panel: `No medication rounds configured. Set them up in Sickbay setup.` (mirrors the today-map unconfigured pattern). |

---

## 4. Surface C — visit §3 (24b) · The visit MAR (`…/visits/[ref]#medications`)

**Surface lines 638–788.** Clinical-read gated. **The MAR IS the clinical record — a drug beside a student is CORRECT here (R164); this is the one surface where the adjacency inverts.**

### 4.1 Page head

| Element | Exact copy | Call |
|---|---|---|
| Crumb | `Sickbay` *(link)* ` · Visit <b>VR-2026-05-14-0089-001</b> · Medications` | BUILD (route by reference) |
| `<h1>` | `Medications ` + `<em>administered.</em>` | BUILD |
| Lede | `Five entries this visit · every dose, the route, who gave it, and which standing order it sits inside.` | **RE-AUTHOR** — derived count + source-generic: `{n} entries this visit · every dose, the route, who gave it, and its source.` (`standing order` is one of four sources.) |
| Action 1 | `Add dose` | **BUILD** — the append affordance (§4.4), `SICKBAY_CLINICAL_WRITE_ROLES`. |
| Action 2 | `Print MAR sheet` | **OMIT at 24** — no print infra; a printed MAR carries drug-beside-student out of the room (the day-sheet reasoning). Note the future pattern: a **print-stylesheet route + an audit `Export` row** (the chronic-register C12 idiom), honestly labelled as *intent to print*. |

### 4.2 The MAR table (`.med-log`) — element by element

Columns: `Time` · `Drug` · `Dose · route` · `Source` · `Administered by` (r). Rows map to `sickbay_med_admin` (R142), every clinical field a **SNAPSHOT at administration** (R144), never read live from the plan.

| Time | Drug + `.sub` | Dose · route | Source | Administered by + `.by` |
|---|---|---|---|---|
| `09:20` | `Paracetamol` / `acetaminophen tablet · school stock` | `1000mg · oral` | `Standing · SCD pain` → `STANDING_ORDER` | `A. Bediako` · ~~`witnessed F. Tetteh`~~ **(RE-AUTHOR, §4.4)** |
| `09:22` | `ORS (oral rehydration salts)` / `WHO formulation · 500ml prepared` | `500ml · oral` | `Standing · hydration` → `STANDING_ORDER` | `A. Bediako` |
| `11:00` | `Hydroxyurea` / `brought from home · NHIS-supplied · her own bottle` | `500mg · oral` | `Scheduled · chronic` → **`CHRONIC`** | `A. Bediako` · `double-checked label, expiry 02/27` *(a `note`)* |
| `13:00` | `Paracetamol` / `school stock` | `1000mg · oral` | `PRN · pain ≥4/10` → **`STANDING_ORDER` + PRN marker** (N-DIV-2) | `G. Antwi` · ~~`witnessed F. Tetteh`~~ **(RE-AUTHOR)** |
| `14:00` | `ORS (oral rehydration salts)` / `refresh 250ml prepared` | `250ml · oral` | `Standing · hydration` → `STANDING_ORDER` | `A. Bediako` |

- **Bindings:** `Time` = `administered_at` (Accra civil, `HH:MM`). `Drug` b = `drug_name` snapshot; `.sub` = the route/source descriptor. `Dose · route` = `dose_label` + `route`. Row-3 `.sub` `brought from home · NHIS-supplied · her own bottle` is the **R163 patient-own-supply note** rendered inside the MAR — correct, and it is NOT a stock row (N-DIV-5 confirmed from this side).
- **Administered by** = `{initial}. {Surname}` of `administered_by_user_id` (abbreviate at render; store the FK; `assertSchoolClinician`). Row 4 is `G. Antwi` (the assistant matron, also a clinical actor).

### 4.3 The source tags (`.med-tag`) — the 4-value reconciliation (N-DIV-2/N-DIV-3)

The surface draws THREE tag styles (`standing`/`scheduled`/`prn`); R143's enum is FOUR values (`CHRONIC`/`STANDING_ORDER`/`DOCTOR_ORDERED`/`AD_HOC`) and **PRN is an orthogonal attribute, not a source (R150)**. Reconcile:

| Enum value | Tag copy | `.med-tag` style | Source |
|---|---|---|---|
| `STANDING_ORDER` | `Standing · {complaint}` | `.standing` `bg-gold-bg text-gold` (surface) | `standing_order_id` pointer — hyperlink to the order |
| `CHRONIC` | `Chronic` (was `Scheduled · chronic`) | `.scheduled` `bg-green-bg text-green` (surface) | `chronic_med_id` pointer |
| `DOCTOR_ORDERED` | `Doctor-ordered` | **AUTHORED 4th variant** — `bg-navy-2 text-bg` (or a bespoke navy pill; §7) | `consult_id` pointer — **hyperlink the consult timestamp** (R143/R160: attribution, never approval — "recorded by {matron}") |
| `AD_HOC` | `Ad-hoc` | reuse `.prn` `bg-bg text-navy-2 border border-border` | no pointer |

- **PRN becomes a separate marker, not a source.** The surface's `PRN · pain ≥4/10` (row 4) → source `Standing · pain` (paracetamol is a standing order) **+ a small `PRN` marker + the criteria in `notes`** (`is_prn = true`, `notes = "pain ≥4/10"`, R150). Render the `PRN` marker as a mono chip beside the source tag; the criterion renders in the `.by`/note area.
- **CHECK (R143):** the non-null pointer must match `source`. A `DOCTOR_ORDERED` row without a `consult_id` is a build error, not a render fallback.

### 4.4 The witness + override affordance (R154–R157) — the sharpest rule

**Witness is MANDATORY only for a controlled GIVEN administration.** The surface's `witnessed F. Tetteh` (a Sick Bay Prefect) is the **OLD prefect-supervision model — REFUSED (R155).** The witness of record is a **second N&MC-licensed staff clinician**, never a student.

**The `Add dose` / `Record` form (shared by §3.4 and §4.1):**

| Field | Input | Rule |
|---|---|---|
| Drug / dose / route | prefilled snapshot (round) or select (ad-hoc) | `drug_name`/`dose_label`/`route`/`is_controlled`/`dispensed_qty` PINNED at save (R144) |
| Source | radio `Chronic` / `Standing order` / `Doctor-ordered` / `Ad-hoc` | the matching pointer required (R143 CHECK) |
| Status | `Given` / `Refused` / `Held` / `Omitted` | R145 — a refused/held/omitted dose is a recorded EVENT (SELF_ADMIN is NOT a status → O1: `Given` + note) |
| PRN | toggle + criteria text | `is_prn`, criteria → `notes` (R150) |
| Dispensed qty | mono number | **required for a controlled GIVEN** (R153 CHECK) — the controlled-balance deduction |
| **Witness** | **staff-clinician select** — `assertSchoolClinician(schoolId, witnessUserId, {requireNmc:true})` | **shown when `is_controlled && status === GIVEN`.** Never free text, never a student (R155). Self-witness forbidden — `witness_user_id ≠ administered_by_user_id` (R157). A non-controlled dose: witness OPTIONAL but still clinician-only (R157). |
| **Override** | **`No witness available — reason`** — a toggle that reveals a required reason textarea | R156 — the documented, **single-signature** override (no second approver — a co-signed override defeats "no witness available"). Writes `witness_override_reason`; renders in the controlled register (R156). One of `witness_user_id` / `witness_override_reason` must be non-null for a controlled GIVEN (R154 DB CHECK). |
| Note | text | free text — incl. a prefect's assist ("F. Tetteh (Sick Bay Prefect) assisted with check-off"), the R163 own-bottle note, the label/expiry check |

- **Render of the `.by` sub-line** on a controlled GIVEN row: `witnessed by <b>{Clinician}</b>` **or** `no witness — <b>{override reason}</b>` (authored, §7). On a non-controlled row with no witness: **render nothing** (never `—`).
- **DB CHECK (R154), for the map's completeness:** `NOT (is_controlled AND status='GIVEN') OR witness_user_id IS NOT NULL OR witness_override_reason IS NOT NULL` — a controlled GIVEN reaches the table only with a witness OR an override, never silently.

### 4.5 The append-only amendment visual (R146) — **AUTHORED (no surface source)**

The surface draws no correction. **The MAR has no edit control** (R142 — no `updated_at`/`voided_at`/delete; absence IS the constraint). A correction is a **NEW row** setting `corrects_admin_id` + `amendment_note`; the original is byte-unchanged; the reader renders a **footnoted amendment**.

**The visual (authored):**
- The **original** row stays exactly as recorded, and gains an inline marker after its time: a small gold **`amended ↓`** chip (`text-gold text-[9px] uppercase tracking-[0.08em] font-bold`) — non-destructive; the row's data is untouched.
- The **correcting** row renders **immediately after the original**, tied by a **left gold border** (the `.consult-card` `border-l-[3px] border-l-gold` idiom), styled as an amendment: an `Amendment` eyebrow (`text-gold 9px uppercase`), the corrected values in the normal columns, and a footnote line carrying `amendment_note` + a back-reference to the original: **`Amends the {HH:MM} {drug} entry — {amendment_note}. Original retained.`** (authored, §7).
- Both rows remain in the table forever. An amendment can itself be amended (a chain via `corrects_admin_id`); render each link as its own footnoted row. **No row is ever removed or greyed to "voided"** — a byte-unchanged original beside a visible correction is the whole point.

### 4.6 The two "next dose" cards — DERIVED projections

The `grid grid-cols-2` pair below the table (surface 735–766) — derived reads, no stored row (R148 doctrine).

| Card | Head | Meta | Body | Binding |
|---|---|---|---|---|
| 1 · next PRN eligibility | `Next scheduled <em>dose</em>` | `if needed` | time (gold, mono) + `Paracetamol <em>1000mg</em>` + `<b>only if</b> pain ≥4/10 at reassessment · 4h min interval cleared` | derived from the last PRN dose + its interval — **NOT a round.** The surface's `17:00` here is `last_prn_at + interval`, not the (omitted) 17:00 round; it does not collide with the 3-round rule. |
| 2 · next chronic round dose | `Daily hydroxyurea <em>continuation</em>` | `tomorrow` | time (green, mono) + `Morning round · <em>500mg</em>` + `resumes <b>Thursday 15 May</b> · standard schedule from chronic register` | derived from the chronic schedule (INCR-23) — the next `MEDICATION_ROUND` due dose (`06:30`, a REAL round). |

**BUILD both as derived** (the chronic register is shipped). If the MAR must shed weight, these two cards are the first slice to drop (the visit-map Y3 precedent) — the table is the record; the cards are a convenience. Card-2 body names the drug (`hydroxyurea`) on a MATRON/HM-gated page — fine (MA11).

### 4.7 The append-only cluster note (surface 768) — RE-AUTHOR

Surface: `<b>Append-only log.</b> Once a dose is recorded it cannot be deleted — only corrected with a footnoted amendment. The <b>witness</b> column is required for any drug taken from school stock by a non-Matron staff member; this is the N&MC double-signature standard adapted to Sick Bay Prefect supervision.`
- **Sentence 1 SHIPS verbatim** (append-only + footnoted amendment — exactly R146).
- **Sentence 2 REFUSED** — "any drug … by a non-Matron … Sick Bay Prefect supervision" is the OLD model. **Authored replacement (§7):** `The <b>witness</b> column is required for a controlled substance given — a second N&MC-licensed clinician, or a recorded override reason. Non-controlled doses need no witness.`
- Rendered in the gold-bg amendment note idiom (inline style, §1.6).

### 4.8 Surface C interaction states

| State | Render |
|---|---|
| **Loading** | `.med-log` skeleton at the visit's row count; next-dose cards as two skeleton cards. |
| **Empty · no doses** | Table head renders; one body row: `No medications recorded for this visit.` (authored). `Add dose` remains the recovery action. **Not `—`.** |
| **Populated** | As mapped; amendments (§4.5) render inline where present. |
| **Overdue chronic round dose visible from the visit** | Not this surface's job — it lives on `/rounds` (§3.5). The MAR shows only what was administered *this visit*. |
| **Error (write)** | Inline under the offending field; a rejected controlled GIVEN (no witness/override) surfaces the R154 message: `A controlled dose needs a witness or a recorded override reason.` (authored). |
| **Disabled (HEADMASTER read)** | Every row visible; `Add dose` / `Record` absent (write is MATRON-only). |

---

## 5. The adjacency pass — the MAR adjacency ladder (MA1–MA13)

Numbered **MA**, deliberately not continuing the today-board **A**-ladder or the chronic-register **C**-ladder (importing a board ruling onto the MAR, or vice-versa, is exactly the failure to prevent). **This surface's fresh question:** *a drug name beside a student is a re-identification (hydroxyurea ⇒ sickle cell, Keppra ⇒ epilepsy, sertraline ⇒ a psychiatric label). It is CORRECT inside the MAR (the clinical record, R164) and FORBIDDEN on the shared stock/register (ADMIN-readable, R162).* Every element where the two meet:

| # | Element | Surface | Pairing | Verdict |
|---|---|---|---|---|
| **MA1** | MAR table drug + student + dose | visit §3 | the full administration fact | ✅ **KEEP IN FULL.** The MAR *is* the clinical record, MATRON/HEADMASTER-gated (R164). This is the case the board rulings reserved. Nothing here licenses putting it on a wider surface. |
| **MA2** | rounds `.r-stu` student + drug | today §2 | drug-beside-student on a LIST | ✅ **KEEP, named ceiling.** Clinical-read gated (HM/MATRON); it is a worklist, not a decision surface. **Ceiling: the FIRST content to drop if `/rounds` is ever widened past the clinical read set.** (The chronic C2 idiom.) |
| **MA3** | stock `Hydroxyurea … for Adwoa Mensa` sub-label | setup §3 | student beside a drug, ADMIN-readable | 🔴 **REFUSE.** R162, the headline. Sub → form/unit only. |
| **MA4** | stock `sickle cell chronic` indication descriptor | setup §3 | condition-use beside a drug, ADMIN-readable | ⚠️ **DROP** (softer). A stock row is form + qty, not an indication; the descriptor adds nothing operational and edges the same inference. **Q3 for owner.** |
| **MA5** | cluster-note `(Adwoa's chronic supply)` / `Adwoa Mensa's chronic dose schedule` | setup §3 | student named/implied, ADMIN-readable | 🔴 **REFUSE.** R162 — re-authored to a student-free derived line. |
| **MA6** | controlled register administration rows (derived from the MAR) | setup §3 | the MAR carries `student_id`; the register must not | 🔴 **STRIP the student.** The projection shows `−qty · administered · actor · witness`, **never the student**, even though the source MAR row identifies them (R152: no per-student linkage on this screen). |
| **MA7** | witness/actor NAMES beside a controlled dose | visit §3 + register | a second **staff** member beside a drug | ✅ **KEEP — intended accountability.** A staff clinician's name is not a student; drug + staff-witness is not a re-identification. On the register (ADMIN-readable) it is drug + qty + **staff** actor/witness — the D5.3 accountability the whole ledger exists for. **Confirmed: it never carries the student, so it never reaches a wider *student* disclosure.** |
| **MA8** | MAR `Doctor-ordered` → hyperlinked consult timestamp | visit §3 | external doctor named, MATRON/HM-gated | ✅ **KEEP.** The consult names an external doctor (R21), not a student; provenance, hyperlinked, traceable (R143/R160). |
| **MA9** | MAR source tag `Standing · SCD pain` (condition on the tag) | visit §3 | student + drug + **condition** on one row | ✅ **KEEP inside the MAR** (R164 — the clinical record). 🔴 **Ceiling: this tag's condition suffix must NEVER travel to `/rounds` or the register.** On the rounds board render `Standing`, not `Standing · SCD pain`. |
| **MA10** | rounds drug names `Keppra` (⇒ epilepsy), `Cetirizine` (⇒ allergy, benign), `hydroxyurea` (⇒ SCD) | today §2 | drug ⇒ condition inference | ✅ **KEEP** (= MA2, clinical-read gated). The inference is why the board is `SICKBAY_CLINICAL_READ_ROLES` and never grant-scoped. |
| **MA11** | next-dose card names `hydroxyurea` | visit §3 | drug on the visit page | ✅ **KEEP** — MATRON/HM-gated. |
| **MA12** | `.r-stu` abbreviation vs full name | today §2 | shoulder-surf vs mis-dose | ⚠️ **FULL names recommended** (MA-cross-ref chronic C0) — a mis-abbreviated dose is a medication error; **Q4 for Kofi + Sarah.** |
| **MA13** | stock `Controlled` pill (authored) | setup §3 | drug + controlled flag, ADMIN-readable | ✅ **KEEP** — a drug name + a controlled flag names no student; the stock-keeper must see it (drives the witness rule). |

### 5.1 Reader × content matrix (the boundary made explicit)

| Content | **ADMIN** | **HEADMASTER** | **MATRON** | **HOUSEMASTER** (chronic grantee) |
|---|---|---|---|---|
| Stock / standing orders (drug + qty, **no student**) | ✅ read + **write** | ✅ read | ✅ read + write | ❌ |
| Controlled register (drug + balance + movements, **no student**) | ✅ read + write | ✅ read | ✅ read + write | ❌ |
| Rounds board (student + drug) | ❌ | ✅ read | ✅ read + **record** | ❌ (O2 — grant reaches the PLAN, not the log) |
| MAR (student + drug + dose + condition-tag) | ❌ | ✅ read | ✅ read + write | ❌ (O2) |

**The one-line invariant:** *ADMIN sees drugs without students; the clinical pair sees students with drugs; the grantee sees the care plan, never the administration.* Every element above resolves to that line.

---

## 6. Surface ⟂ spec divergences — NEW (flag for owner; not the four Kofi already named)

Kofi already ruled (board L2780): witness = controlled + N&MC clinician (not a prefect); rounds = 3 not 4, no 13:00; stock `for Adwoa`/`Adwoa's supply` refused; `witnessed F. Tetteh` → a note. **The following I found and did not silently absorb:**

| # | Divergence | Where | My call (confirm) |
|---|---|---|---|
| **N-DIV-1** | The **`3` reorder count is fabricated** — header meta `3 reorder alerts`, lede `3 items at or below reorder point`, cluster note `Three items below reorder point` all cite 3, but the table has 2 below (Hydroxyurea, Calamine) + 2 within-margin (AL, RDT). (Lucy flagged this class in the setup map — "claims 3 alerts over a 2-alert table".) | setup §3 | **Derive every count.** Ship no hardcoded 3. |
| **N-DIV-2** | **PRN is modelled as a SOURCE tag** on the surface (`PRN · pain ≥4/10`), but R150 makes PRN an orthogonal attribute; and the surface's 3-tag palette (`standing`/`scheduled`/`prn`) does not map 1:1 to the 4-value enum. | visit §3 | **PRN → a marker + `notes`;** add `Doctor-ordered` + `Ad-hoc` tags (§4.3). |
| **N-DIV-3** | Tag copy **`Scheduled`** vs enum **`CHRONIC`.** | visit §3 | Render `Chronic`. |
| **N-DIV-4** | Standing-order row renders **ONE freeform `treatment` line**; R159 has separate `treatment` + `escalation` + `ordered_by_doctor_name`, none of the latter two with a slot in the compact row. | setup §3 | `treatment` verbatim in the list; escalation as an optional sub-line; attribution in the edit/detail view (§2.2). Wells/Kofi. |
| **N-DIV-5** | Hydroxyurea listed as **school stock AND tagged to a patient** — but R163 says a patient's own surrendered NHIS bottle is **not** school stock and not in the register. The surface conflates the two supplies. | setup §3 | The register carries **general school stock only**; patient supply is a MAR `source=CHRONIC` note (§4.2 row 3). |
| **N-DIV-6** | `Mark 17:00 ready` implies a **round-ready state** with no model (R148/R149 close doses individually). | today §2 | **Replace with the per-dose `Record` affordance** (§3.4). |
| **N-DIV-7** | `View 7-day history` action — a real read with **no mapped surface** at 24. | today §2 | **Defer** (do not ship a dead button); re-open as a follow-up read. |
| **N-DIV-8** | The **controlled register has no surface at all** — the entire §2.4 block, the override affordance, the amendment visual, and the overdue-round state are **authored from the ruling**. Not a contradiction, but the largest authored surface in this increment. | all | Owner sign-off on §7 copy. |

---

## 7. Authored copy for owner sign-off

No surface source for any of these — they are assembled in the product's Ghanaian school-operations voice from the ruling. **Owner may veto or reword; nothing ships until signed.**

**Override-reason affordance (R156):**
- Toggle label: `No witness available — reason`
- Reason textarea placeholder: `Why no second N&MC clinician was available for this controlled dose.`
- `.by` render on the row: `no witness — <b>{reason}</b>`
- Rejected-save message (R154): `A controlled dose needs a witness or a recorded override reason.`

**Append-only amendment (R146):**
- Original-row chip: `amended ↓`
- Amendment eyebrow: `Amendment`
- Footnote: `Amends the {HH:MM} {drug} entry — {amendment_note}. Original retained.`

**Append-only cluster note (§4.7 sentence 2, replacing the refused prefect copy):**
- `The witness column is required for a controlled substance given — a second N&MC-licensed clinician, or a recorded override reason. Non-controlled doses need no witness.`

**Empty states:**
- MAR (no doses): `No medications recorded for this visit.`
- Rounds (a round with none due today): pill `None due`
- Rounds (no rounds configured): `No medication rounds configured. Set them up in Sickbay setup.`
- Standing orders (empty): `No standing orders registered.`
- Stock (empty): `No stock items yet.`
- Controlled register (no controlled items): `No controlled substances flagged. Mark an item "controlled" in the stock register.`
- Controlled register (item, no movements): `No movements recorded.`

**Stock cluster note (re-authored, §2.3):**
- `{n} items at or below reorder point · {drug names, no student}. Reorder before the next dispensing gap.`

**Stock-register intro / controlled-register intro (§2.4):**
- `A running balance derived from receipts, administrations, and wastage. No stored count — the number below is computed each time you open this page.`
- Negative-balance guard: `Balance below zero — reconcile.`

**Standing-orders intro (re-authored, §2.2):**
- `These are the first-line treatments registered with the visiting doctor under N&MC scope of practice. Anything outside this list waits for the visiting doctor — or escalates to referral.`

**Authored tag/pill styles:** `Doctor-ordered` `.med-tag` = `bg-navy-2 text-bg`; overdue-round `.pill` = `bg-terra-bg text-terra`; stock `Controlled` pill = `bg-navy-2 text-bg`.

---

## 8. Omit register

### 8.1 SHIPS character-exact (copy-paste verbatim — no re-authoring)

```
=== SURFACE A · setup §3 · standing orders (8 rows, verbatim) ===
Headache · uncomplicated | Paracetamol 500mg → 1–2 tabs · rest 30 min · review
Menstrual pain | Paracetamol 500mg + hot water bottle → rest in sickbay if needed
Sore throat · viral | Saline gargle + paracetamol → review 24h · refer if fever rises
Diarrhoea · uncomplicated | ORS sachet + observation → refer if >6 episodes or fever
Suspected malaria | RDT test · if positive → AL first dose + refer to OPD same day
Minor cuts & abrasions | Saline wash + povidone iodine + dressing → tetanus check on chronic register
Sprains · sports injury | RICE protocol + paracetamol → X-ray referral if weight-bearing fails
Insect bites · allergic skin | Chlorpheniramine 4mg + topical calamine → refer if facial swelling

h3: Standing orders · what the Matron treats without escalation
h1: Standing orders & stock

=== SURFACE A · setup §3 · stock (12 rows — sub-lines as shown, Hydroxyurea sub RE-AUTHORED) ===
Paracetamol 500mg | tablets · adult dose | 412 | 200 | 28 Apr | OK
ORS sachets | oral rehydration · standard | 84 | 40 | 2 May | OK
Artemether-lumefantrine | AL · 20/120mg · malaria first-line | 14 | 12 | 14 Apr | Low
Malaria RDT kits | rapid diagnostic · SD Bioline | 22 | 20 | 20 Apr | Low
Hydroxyurea 500mg | 500mg tablet | 8 | 14 | 15 Apr | Reorder    ← sub re-authored (Risk 4)
Salbutamol inhaler | 100mcg · asthma rescue | 3 | 2 | 5 Mar | OK
Chlorpheniramine 4mg | antihistamine · allergies | 68 | 40 | 28 Apr | OK
Povidone iodine 10% | antiseptic · 100ml | 4 bottles | 2 | 12 Mar | OK
Adhesive bandages | various sizes | 240 | 100 | 2 May | OK
Sterile gauze | 10cm × 10cm packs | 38 | 30 | 2 May | OK
Calamine lotion | topical · 100ml | 2 | 3 | 14 Feb | Reorder
Sanitary pads | menstrual supply · school-issued | 112 | 60 | 28 Apr | OK

=== SURFACE B · today §2 · rounds (THREE — the 17:00 row is OMITTED) ===
06:30 | Morning · pre-breakfast | ✓ Done · 06:47
12:30 | Lunch · post-meal | ✓ Done · 12:32
21:00 | Night · post-prep | Pending
h1: Medication rounds · today

=== SURFACE C · visit §3 · MAR (5 rows) + cluster sentence 1 ===
09:20 | Paracetamol / acetaminophen tablet · school stock | 1000mg · oral | Standing · SCD pain | A. Bediako
09:22 | ORS (oral rehydration salts) / WHO formulation · 500ml prepared | 500ml · oral | Standing · hydration | A. Bediako
11:00 | Hydroxyurea / brought from home · NHIS-supplied · her own bottle | 500mg · oral | Chronic | A. Bediako · double-checked label, expiry 02/27
13:00 | Paracetamol / school stock | 1000mg · oral | Standing · pain [+ PRN: pain ≥4/10] | G. Antwi
14:00 | ORS (oral rehydration salts) / refresh 250ml prepared | 250ml · oral | Standing · hydration | A. Bediako
h1: Medications administered.
Cluster sentence 1 (verbatim): Append-only log. Once a dose is recorded it cannot be deleted — only corrected with a footnoted amendment.
```

### 8.2 OMITTED / RE-AUTHORED (does NOT ship as drawn)

| Item | Surface | Disposition |
|---|---|---|
| `Hydroxyurea … sickle cell chronic · for Adwoa Mensa` (stock sub) | setup §3 | 🔴 **REFUSED** (R162) → `500mg tablet` (MA3/MA4). |
| `Three items below reorder point · Hydroxyurea (Adwoa's chronic supply) … to avoid a gap in Adwoa Mensa's chronic dose schedule` (cluster note) | setup §3 | 🔴 **REFUSED** (R162/MA5) + count fabricated (N-DIV-1) + procurement clause dropped (Z4) → re-authored (§7). |
| `8 first-line treatments · 24 stock items · 3 reorder alerts` (section meta) / `top 12 of 24 items` (h3) / lede `3 items` | setup §3 | **RE-AUTHOR** — derived counts (N-DIV-1); section-meta is design-doc chrome (not built). |
| `N&MC scope ↗` action | setup §3 | **OMIT** — dead link (FLAG-L2 precedent). |
| **17:00 round** (whole `.round-row.due-now`) + `06:30 / 12:30 / 17:00 / 21:00` meta + lede `<b>17:00</b> due 2h 15m` | today §2 | 🔴 **OMIT** — demo drift (R13). |
| `Four rounds` (h3) / `Mark 17:00 ready` action / `View 7-day history` action | today §2 | **RE-AUTHOR** `Three`/derived (N-DIV-6); **OMIT** both actions (N-DIV-6/N-DIV-7). |
| `F. Tetteh (Sick Bay Prefect, Aggrey) assists with 06:30 round check-off` + the round-1 helper prefect clause | today §2 | **RE-AUTHOR** → an optional free-text `note`, never structural (R155). |
| `witnessed F. Tetteh` (MAR rows 09:20, 13:00) | visit §3 | 🔴 **REFUSED** — the OLD prefect-supervision model (R155). A prefect's help is a `note`; the witness of record is a second N&MC clinician (§4.4). |
| Cluster sentence 2 (`… required for any drug … by a non-Matron … Sick Bay Prefect supervision`) | visit §3 | 🔴 **REFUSED** (R154–R157) → re-authored (§4.7 / §7). |
| `PRN · pain ≥4/10` as a source tag / `Scheduled · chronic` tag copy | visit §3 | **RE-AUTHOR** — PRN → marker+notes; `Chronic` (N-DIV-2/N-DIV-3). |
| `Print MAR sheet` / `Print day sheet`-class actions | visit §3 | **OMIT at 24** — no print infra; future print-stylesheet + audit Export (C12 idiom). |
| Every `.section-head`, `.notes` rail, `.browser-bar`, demo nav, `NEW` tag | all | **Design-doc chrome — not built** (§1.1). |

---

## 9. Open questions for Kofi / owner (carried through the map)

- **Q1** `/senior/sickbay/rounds` (my recommendation) vs the surface-literal `/senior/sickbay/today/rounds`? (§1.2)
- **Q2** Confirm standing orders are **not seeded** — the 8 rows are entered content, not a silent default (the O3 reasoning). (§2.2)
- **Q3** Drop the `sickle cell chronic` indication descriptor from the hydroxyurea stock sub-line (form-only), or keep it? (MA4)
- **Q4** Rounds `.r-stu` **full names** (mis-dose safety) vs the today-board abbreviation control — Kofi + Sarah. (MA12)
- **Q5** Confirm the `SICKBAY_ROLES` **read** set for setup §3 includes HEADMASTER (write is `[ADMIN, MATRON]`) — and confirm ADMIN is refused `/rounds` + `#medications`. (§1.3, Sarah's carried item)
- **Q6** The authored **controlled register** (§2.4), **override** copy, **amendment** visual, **overdue-round** state, and the **`Doctor-ordered`/`Controlled`/overdue** tag palette (§7) — none have a surface; sign off the copy and the token choices.
