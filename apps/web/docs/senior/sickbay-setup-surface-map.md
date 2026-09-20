# Sickbay F0 Spine — Surface Map (INCR-21 · Module 4.4)

**Author:** Lucy (design cartographer) · **Status:** build-ready design spec for the implementation engineer (Claude Code).
**Increment:** INCR-21 — *F0 spine: mode · beds · rounds/hours · clinical staff* · migration **0056** · **ROOT** of Module 4.4 (every other sickbay surface reads this config).
**Source surface:** `Surfaces/schoolup-sickbay-setup.html` (1000 lines, five stacked sections).
**Companion:** `docs/senior/sickbay-surface-inventory.md` (module breadth pass — N1–N30 / B1–B14 numbering used throughout below).
**Board:** `docs/senior-build-plan.md` L2369–2417.

**Scope of this map — three slices of one surface:**

| Slice | Surface lines | What it is | Build status at INCR-21 |
|---|---|---|---|
| **§1 Mode & staff** | 211–390 | mode picker (A/B/C) · clinical staff register · School Health Prefect roster | **BUILD** |
| **§2 Capacity & hours** | 392–553 | bed capacity strip · operating hours & rounds table | **BUILD** (Mode-gated) |
| **§5 Policy anchors** | 854–995 | SHEP + N&MC cards *(the two navy cards only)* | **READ-ONLY CONTEXT — static copy, no schema** |

---

## 0. Scope boundary — what INCR-21 must NOT bleed into

| Section | Title (surface) | Lines | Owner increment | Why it is not here |
|---|---|---|---|---|
| **§3** | *Standing orders & drug stock* | 555–704 | **INCR-24** | 8 standing orders + 24-item stock register + reorder logic. Different actor (**Matron**, not Headmaster — the surface switches the sidebar footer at line 594 to prove it). |
| **§4** | *Referral hospitals* | 706–852 | **INCR-25** | 4 hospital cards + `distance_km` + `accepts_nhis`. Blocked on the NHIS shape ruling (board D3). |
| **§5b** | *Three-tier parent notification rule* (lines 926–966) | | **INCR-26** | The tier table, its action tags, and its channel copy. Only the **two policy-anchor cards** (lines 912–924) are in this map. |
| **§5c** | *Save bar* (lines 968–974) | | **INCR-24** | Its copy is stock-dependent (*"Hydroxyurea is below reorder point…"*). Cannot be built honestly before §3. |

### 0.1 Structural dependencies of §1/§2 on out-of-scope sections — read before writing 0056

Four places where in-scope elements reach into out-of-scope tables. Each has a stated INCR-21 resolution:

| # | In-scope element | Reaches into | INCR-21 resolution |
|---|---|---|---|
| **X1** | §1 clinical-staff row 3: `Dr K. Mensah · Visiting doctor · **Asankrangwa Govt. Hospital** · Thursdays 14:00–17:00` | §4 `sickbay_hospital` (N6, INCR-25) | Store the affiliation as **free text** on the staff row. Do **not** author a hospital FK in 0056. INCR-25 may promote it (nullable FK + keep the text fallback). |
| **X2** | §2 hours row 5: `Visiting doctor · **Dr K. Mensah** · admissions reviewed` | §1 clinical-staff row (in scope, same increment) | Staffing column is **descriptive free text** (`Matron + Prefect` / `Doctor + Matron` / `Matron or Asst.`), **not** an FK to the staff row. The surface prints a role phrase, not a person, in 6 of 7 rows. Do not over-model. |
| **X3** | §2 tile 3: `Currently occupied **1** / 8 · **Adwoa Mensa** · bed 3 · since 09:14` | `sickbay_admission` (N13, INCR-22) | The admission table does not exist at 21. Tile renders the **honest zero** — see §2.3. No fake name, ever. No click-through (its target `/senior/sickbay/today` is INCR-22). |
| **X4** | §2 tile 4: `Avg. weekly load **2.4** beds · Semester 2 to date · was 3.1 in Semester 1` | `sickbay_visit` (N8, INCR-22) | **OMIT the tile entirely at INCR-21.** There is no source table — not an empty value, an absent concept. Capacity strip drops to a 3-column grid. Reinstate at INCR-22 with a real empty state. |

§1/§2 have **zero** dependency on §3 (standing orders / stock) or on the notification tiers. Nothing in INCR-21 reads a drug, a standing order, a hospital row, or a notification policy.

---

## 1. Shared chrome, tokens, type & route

### 1.1 What is design-doc chrome and must NOT be built

The source file is a design document wrapping app frames. Build **only** the in-app frame (`.app-shell` = sidebar + main).

| Do NOT build | Where |
|---|---|
| `.page-header` (eyebrow `Omnischools · Sickbay · Setup & configuration`, `.mvp-tag`, h1 `When the sickbay *holds the dose*`, gold rule, the bimodal-reality paragraph) | lines 203–209 |
| `.section-head` (num `01` / title `Mode & staff` / meta `Asankrangwa SHS · Mode B · 4 staff registered`; num `02` / `Capacity & hours` / meta `8 beds total · 2 isolation · 06:30 anchor round`) | 212–216, 393–397 |
| `.notes` right rail (7 bullets per section) | 377–388, 540–551 |
| `.desktop` / `.browser-bar` / `.url` / drop-shadow `rgba(26,43,71,0.25)` | 219–223, 400–404 |
| `.sidebar.tall` / `.taller` min-height variants | demo canvas sizing only |

The `.notes` panels are **intent documentation** — read them, port their rules (anchor slot immovability, "the two numbers can't pool", credential formats), render none of their text.

### 1.2 Route & navigation

- **Route:** `/senior/sickbay/setup` — one route, both sections. §2 is the `#capacity` anchor on the same page (surface URLs `…/sickbay/setup` and `…/sickbay/setup#capacity`). The surface's bare `/sickbay/…` maps to the repo's `/senior/…` prefix (`/senior/boarding`, `/senior/wassce/setup` precedent).
- **Sidebar entry:** one new `SENIOR_ITEMS` row in `components/app/sidebar.tsx` — `{ href: "/senior/sickbay/setup", label: "Sickbay", Icon: <lucide>, roles: SICKBAY_ROLES }`. The real app nav is flat and role-gated; **the app nav wins over the surface's demo nav.** This map asserts only the Sickbay entry.
- **Sub-nav:** the surface draws four sickbay sub-items (`Setup` / `Today` / `Chronic register` / `Referrals`). At INCR-21 only **Setup** exists → render **no sub-nav**. Sub-items arrive with their increments (22 / 23 / 25).
- The surface's `NEW` gold tag on the Sickbay nav item (line 240) — **OMIT** (no `NEW`-badge convention exists in the app sidebar).
- Twelve-item rule: the app's flat nav plus 5 senior items is already past twelve for a Senior-tier Headmaster. **Sectioned nav is a separate, module-independent decision** — do not open it inside INCR-21; note it for the module close.

### 1.3 Token reference (`:root` in the surface → Tailwind token class)

Identical hexes to `md files/design-tokens.json`. Use Tailwind token classes in JSX, **never inline `var(--x)`**.

| Surface var | Hex | Tailwind class | Used in §1/§2 for |
|---|---|---|---|
| `--navy` | `#1A2B47` | `text-navy` / `bg-navy` | body text, sidebar ground, h3 headings, `.cap-tile` values, `.hours-table td.lbl`, gold-pill text |
| `--navy-2` | `#2D3F5C` | `text-navy-2` | `.mode-desc`, `.hours-table td.time`, `.staff-row .role b`, `.cap-tile .desc b`, `.status-pill.weekly/.roster` text |
| `--navy-3` | `#5C6675` | `text-navy-3` | crumb, lede, `.ch-meta`, `.mode-stat`, `.cap-tile .lbl` + `.desc`, table `th`, slot `.desc` sub-lines |
| `--gold` | `#C8975B` | `text-gold` / `bg-gold` / `border-gold` | every italic `<em>`, `.mode-tag`, active mode border + dot, `.anchor-tag` bg, `.add-staff` text+border, `.btn.gold` bg, `.status-pill.scheduled` text |
| `--gold-soft` | `#E8D4B8` | `text-gold-soft` / `border-gold-soft` | sidebar school meta + footer role; `.mode-card.active .mode-stat` top border |
| `--gold-bg` | `#F5EBDC` | `bg-gold-bg` | active mode-card gradient end, `.staff-row .av` avatar tint, `.status-pill.scheduled` tint |
| `--bg` | `#FAF7F2` | `bg-bg` | page ground, `.main`, table `th` ground, `.staff-row .av.visiting` fill, `.status-pill.weekly/.roster` fill |
| `--surface` | `#FFFFFF` | `bg-surface` | cards, tiles, `.page-head`, `.btn` fill, `.add-staff::before` glyph colour |
| `--green` | `#2F6B47` | `text-green` | `.status-pill.on-shift` text, prefect avatar glyph |
| `--green-bg` | `#E5EFE8` | `bg-green-bg` | `.status-pill.on-shift` tint, `.staff-row .av.prefect` tint |
| `--terra` / `--terra-bg` | `#B84A39` / `#F5E1DC` | `text-terra` / `bg-terra-bg` | **declared, unused in §1/§2** |
| `--warn` / `--warn-bg` | `#C58A2E` / `#F5E9D0` | `text-warn` / `bg-warn-bg` | **declared, unused in §1/§2** |
| `--border` | `#E5DFD3` | `border-border` | card borders, row dividers, `.mode-card` rest border, `.staff-row` dividers, `.hours-table td` dividers |
| `--border-2` | `#D4CCBA` | `border-border-2` | `.btn` border, `.hours-table th` bottom |

**Type families:** `font-display` = **Fraunces** (h1, `.ch-title`, `.mode-name`, `.cap-tile .val`, all avatar glyphs, all gold `<em>`); default/`font-body` = **Manrope** (everything else); `font-mono` = **JetBrains Mono** (`.hours-table td.time` time windows, `.cap-tile .sub-num` `/ 8`, and the N&MC licence number — see §1.5).

**Convention (`design-tokens.json._conventions`):** an absent value renders **em-dash `—`** in `text-navy-3`, never `0` / `N/A` / `null`. Exception, stated once: a **count that is genuinely zero renders `0`** (see §2.3 X3) — `—` is for *unknown*, `0` is for *known-empty*.

### 1.4 No-alpha discipline (repo memory `no-alpha-token-opacity`)

**In-scope finding: the §1/§2 body content area contains ZERO translucency.** Every colour in the mode strip, staff cards, capacity strip and hours table is a solid token or a dedicated `-bg` tint. The only `rgba()` literals in scope are in the **navy sidebar**, which is shared app chrome.

| Region | Raw value | Port to (NOT slash-opacity) |
|---|---|---|
| `.nav-item` label | `rgba(250,247,242,0.7)` | `text-[rgba(250,247,242,0.7)]` — **never** `text-bg/70` |
| `.nav-item.active` bg | `rgba(200,151,91,0.08)` | `bg-[rgba(200,151,91,0.08)]` — **never** `bg-gold/8` |
| `.nav-item.sub` label | `rgba(250,247,242,0.55)` | `text-[rgba(250,247,242,0.55)]` (moot at 21 — no sub-nav) |
| brand / footer / powered dividers | `rgba(255,255,255,0.08)`, `rgba(255,255,255,0.05)` | `border-[rgba(255,255,255,0.08)]` |
| `.powered-by` label | `rgba(200,151,91,0.55)` | `text-[rgba(200,151,91,0.55)]` |
| `.nav-item .ic` glyph | `opacity:0.8` | `opacity-80` utility |

**Verify in the live preview, not the build.** Slash-opacity on a raw-hex token renders *nothing* and `next build` passes.

### 1.5 Bespoke / non-token values in scope — flag list

Every one of these is a hand-value the implementer must reproduce with an arbitrary Tailwind value, not approximate to the nearest scale step.

| Element | Bespoke value | Port |
|---|---|---|
| `.mode-card` border | **1.5px** (rest) → **2px** (active) | `border-[1.5px]` → `border-2` |
| `.mode-card` radius | `14px` | `rounded-[14px]` |
| `.mode-card.active` fill | `linear-gradient(180deg, #FFFFFF 0%, #F5EBDC 100%)` | `bg-[linear-gradient(180deg,var(--surface)_0%,var(--gold-bg)_100%)]` — token-referencing gradient, no alpha |
| `.mode-card.active::after` dot | 18px circle, `top:14px right:14px`, `bg-gold` | absolute-positioned `size-[18px] rounded-full bg-gold` |
| `.mode-tag` | `9px` / `letter-spacing 0.16em` / uppercase / 700 | `text-[9px] tracking-[0.16em] uppercase font-bold` |
| `.mode-name` | Fraunces `20px` 600, `letter-spacing -0.01em` | `font-display text-[20px] font-semibold tracking-[-0.01em]` |
| `.mode-stat` | `10px` italic, `border-top` `--border` → `--gold-soft` when active | `text-[10px] italic border-t border-border` / `border-gold-soft` |
| `.add-staff` | **1px dashed gold**, `border-radius 8px`, `9px 14px`, full-width, left-aligned | `border border-dashed border-gold rounded-lg` |
| `.add-staff::before` | 18px gold circle containing a white `+`, 12px 700 | render as a real `<span aria-hidden>+</span>`, not a pseudo-element |
| `.staff-row` grid | `36px 1fr auto`, `gap 12px`, `padding 11px 0` | `grid grid-cols-[36px_1fr_auto] gap-3 py-[11px]` |
| `.staff-row .av` | 36px circle, Fraunces **12px 700**; `.prefect` green tint; `.visiting` `bg-bg` + 1px border | three avatar variants |
| `.status-pill` | `9px` / `0.08em` / uppercase / 700 / `3px 9px` / pill radius | `text-[9px] tracking-[0.08em] uppercase font-bold px-[9px] py-[3px] rounded-full` |
| `.cap-tile .val` | Fraunces **28px 600**, `letter-spacing -0.018em`, `line-height 1.05` | `font-display text-[28px] font-semibold tracking-[-0.018em] leading-[1.05]` |
| `.cap-tile .sub-num` | mono **14px** 500 `text-navy-3`, inline after the gold `<em>` | `font-mono text-sm font-medium text-navy-3` |
| `.cap-tile .lbl` | `9px` / `0.14em` / uppercase / 700 | `text-[9px] tracking-[0.14em] uppercase font-bold` |
| `.hours-table th` | `9px` / `0.14em` / uppercase / 700 / `bg-bg` / `border-b border-border-2` | as written |
| `.hours-table td` | `12px`, `padding 10px 14px`; last row no border | as written |
| `.anchor-tag` | `8px` / `0.08em` / uppercase / 700 / `bg-gold text-navy` / `margin-left 6px` | inline gold pill |
| h3 section headings | inline `font-size:18px` (§1) / `16px` (§2), `font-weight:600`, `color:var(--navy)` + inline gold italic `<em>` | `font-display text-[18px]/[16px] font-semibold text-navy`, `<em>` → `italic text-gold font-normal` |
| `.page-head` | `padding 24px 36px 22px`, `bg-surface`, `border-b border-border` | as written |
| `.body` | `padding 28px 36px 60px` | as written |

---

## §1 — Mode & staff (`/senior/sickbay/setup`)

**Surface lines 211–390.** Actor rendered in the sidebar footer: `AM` / **`Mr Asare-Mensah`** / **`Headmaster`**.

### §1.1 Page head — exact copy

| Element | Exact copy | Token / type |
|---|---|---|
| Crumb | `Sickbay` (as `<a>`) ` / Setup & configuration` | `text-navy-3 text-[11px] tracking-[0.12em] uppercase font-semibold`; `<a>` `text-gold no-underline` |
| `<h1>` | `Sickbay ` + `<em>configuration</em>` | `font-display text-[28px] font-medium tracking-[-0.018em] leading-[1.1]`; `<em>` `italic text-gold font-normal` |
| Lede (surface verbatim) | `How your sickbay is run · **mode**, **staff**, **capacity**, **standing orders**, **referral hospitals**, and **policy anchors** · all editable here` | `text-navy-3 text-[13px] max-w-[720px]`; `<b>` → `text-navy-2 font-semibold` |
| Action 1 | `SHEP policy ↗` | `.btn` secondary |
| Action 2 | `Save changes` | `.btn.gold` = `bg-gold text-navy border-gold font-bold` |

**FLAG L1 — the lede advertises three sections INCR-21 does not build.** `standing orders` (INCR-24), `referral hospitals` (INCR-25), `policy anchors` (static, optional). Shipping it verbatim promises absent affordances.
**Ruling:** ship the trimmed lede at INCR-21 —
> `How your sickbay is run · **mode**, **staff**, **capacity** · all editable here`

and restore each clause verbatim as its section lands (24 → `standing orders`, 25 → `referral hospitals`, 26 → `policy anchors`). Record the restoration trigger in the component as a comment. In **Mode C**, drop `capacity` too (see §3 matrix).

**FLAG L2 — `SHEP policy ↗` has no target.** The `↗` promises an outbound link; the surface's `href` is `#`. **OMIT the button at INCR-21** (dead-link precedent: WASSCE map §1.4 drift log). The SHEP framing survives intact in the §5 policy-anchor card, which is where it belongs.

### §1.2 Mode strip — heading + three cards

Heading (line 271), exact: `<em>Sickbay mode</em> · what kind of medical operation is this?` — `font-display text-[18px] font-semibold text-navy`, `<em>` italic gold 400.

Layout `.mode-strip` = `grid-cols-3 gap-[14px] mb-8`.

| | **Mode A** | **Mode B** | **Mode C** |
|---|---|---|---|
| `.mode-tag` | `Mode A` | `Mode B` | `Mode C` |
| `.mode-name` | `Full ` + `<em>sickbay</em>` | `First-aid ` + `<em>station</em>` | `Referral ` + `<em>only</em>` |
| `.mode-desc` | `Beds, isolation ward, resident matron, visiting doctor, drug stock. Can admit overnight, manage outbreaks on-site, run scheduled medication rounds.` | `Matron on-site, basic capacity for short-stay observation, drug stock, weekly visiting doctor. Refers serious cases to district hospital within hours.` | `No sickbay. School Health Prefect roster handles first response, all cases route to nearest hospital. SHEP-coordinated, no on-site clinical capacity.` |
| `.mode-stat` | `Typical for **Cat. A** schools · ~16% of public SHS` | `Typical for **Cat. B–C** schools · ~30% of public SHS` | `~59% of public SHS without sickbays use this` |
| enum value | `FULL` | `FIRST_AID` | `REFERRAL_ONLY` |

**Selected-state grammar:** the active card gains ` · selected` appended to its `.mode-tag` (surface line 281 renders `Mode B · selected`), `border-2 border-gold`, the white→`gold-bg` vertical gradient, the 18px gold dot top-right, and `.mode-stat` border flips to `border-gold-soft`. The suffix and the styling are **state-driven — attach them to whichever card is active**, never hardcode them to Mode B.

**Control:** a native radio group. `role="radiogroup"` on `.mode-strip`, each card a `<label>` wrapping a visually-hidden `<input type="radio" name="sickbay-mode">`. Keyboard: arrow keys move selection (native). Focus ring on the card, not the hidden input.

- **Default (fresh school):** `REFERRAL_ONLY`. A school that has never configured a sickbay does not have one — and Mode C is ~49% of the market. Any other default asserts capacity that does not exist. *(Shape recommendation for Wells/Kofi, not a Lucy ruling.)*
- **Validation:** exactly one of three; no null state in the UI.
- **Write:** `Save changes` persists it (see §4 write table). Mode is a **render gate, never a delete** — switching B→C must preserve stored beds and schedule slots so a later C→B switch restores them intact (BUILD_STACK Decision 1: *"Schools that build a sickbay later switch modes without data migration"*).
- **Confirmation:** switching to a mode that hides stored rows shows a confirm step naming what will stop rendering (`N beds · N schedule slots stay saved and stop showing`). AUTHORED copy — flag for owner review.
- **Forward guard (INCR-22):** switching away from A/B while an admission is open must be blocked. Trivially satisfied at 21 (no admission table) — write the guard where the mode action lives so INCR-22 only adds the query.
- **Percentages are fabricated editorial** (16 + 30 + 59 = 105%). See §6 item F1. Static copy, never computed, never stored, never a seed column.

### §1.3 Clinical staff card

Card head: `Clinical ` + `<em>staff</em>` (`font-display text-base font-semibold`, `<em>` italic gold 400) · meta `2 active · 1 visiting` (`text-[10px] text-navy-3 font-semibold tracking-[0.06em]`).

**The meta is a DERIVED count** — compute `{active} active · {visiting} visiting`, never copy the literal. (Lesson from the §3 header that claims 3 reorder alerts over a 2-alert table.) Zero state: see §1.6.

Three rows, verbatim:

| Avatar | `.name` | `.role` (bold spans in `text-navy-2`) | `.status-pill` |
|---|---|---|---|
| `AB` (gold-bg tint) | `Mrs Akua Bediako` | `Senior Matron · **N&MC #N-04827** · 11 years here` | `On shift` — `.on-shift` green |
| `GA` (gold-bg tint) | `Ms Grace Antwi` | `Assistant Matron · CHN cert. · weekend & nights` | `Off · back 18:00` — `.scheduled` gold |
| `DM` (`.visiting`: `bg-bg` + `border-border`) | `Dr K. Mensah` | `Visiting doctor · **Asankrangwa Govt. Hospital** · Thursdays 14:00–17:00` | `Tomorrow` — `.weekly` neutral |

CTA: `Add clinical staff member` (`.add-staff`, dashed gold, full width, left-aligned, `+` glyph).

**Field decomposition of the `.role` line** — one line, four sources:

| Fragment | Source | Binding |
|---|---|---|
| `Senior Matron` / `Assistant Matron` / `Visiting doctor` | staff designation within the sickbay | **NEEDS SCHEMA · N30** (seniority/designation on the sickbay staff row — *not* a new app role; `MATRON` already exists) |
| `N&MC #N-04827` | nursing-council licence | **NEEDS SCHEMA · N29**. `staff_profile` has `ntc_licence_number` + `ntc_licence_expiry` (teaching council) and **no nursing field**. Store the bare value `N-04827`; `N&MC #` is render chrome. Render in `font-mono` (repo idiom: every licence/index/code is mono). |
| `CHN cert.` | second, free-form credential | **NEEDS SCHEMA · N30** — a nullable `credential_note text`. Do not enumerate Ghanaian nursing credentials. |
| `11 years here` | staff tenure | **NO CLEAN BINDING · B10** — no staff start-date field anywhere. **OMIT this fragment at INCR-21.** Do not compute from `created_at` (account creation ≠ tenure); do not store a hand-typed "11 years" (rots annually). Reinstate only if a real `staff_profile.started_on` lands. |
| `weekend & nights` / `Thursdays 14:00–17:00` | working pattern | **NEEDS SCHEMA · N30** — a nullable `shift_note text`, typed by the Headmaster, rendered verbatim. Cheap, honest, no scheduler. |
| `Asankrangwa Govt. Hospital` | external affiliation | **NEEDS SCHEMA · N30** free text — see X1. |

**FLAG P1 — status pills are time-derived and have no source at INCR-21.** `On shift` / `Off · back 18:00` / `Tomorrow` require a per-staff shift assignment resolved against the §2 hours table and the wall clock. That machinery is not in scope and is not worth inventing for three pills.
**Ruling: OMIT the clinical-staff status pills at INCR-21.** The row keeps avatar + name + role line; the `.status-pill` column collapses (grid becomes `36px 1fr`). The working pattern the pill was compressing (`weekend & nights`, `Thursdays 14:00–17:00`) is already in the role line, so **no information is lost** — only the live-status glaze. Reinstatement trigger: a per-staff shift assignment (N30 second half), earliest INCR-22.

**FLAG A1 — the visiting doctor is an actor without a login (B4).** `Dr K. Mensah` is external, has no `ref_user`, and later (INCR-22) authors clinical artefacts. At INCR-21 he is only a **directory row**, so the lazy correct shape is a sickbay-staff row that carries either a nullable `user_id` **or** a free-text `person_name` + `affiliation`, with a not-both/not-neither check. Naming that at 0056 avoids a painful backfill at INCR-22. Kofi/Wells call — flagged, not ruled.

**Control — `Add clinical staff member`:**

| Field | Input | Validation | Default | Empty/disabled |
|---|---|---|---|---|
| Person | select from existing school staff **or** free-text name (external clinician) | exactly one branch; name trim ≥ 2 chars | none | staff select is empty for a school with no staff → free-text branch still works |
| Designation | text (surface values: `Senior Matron`, `Assistant Matron`, `Visiting doctor`) | required, ≤ 48 chars | none | — |
| N&MC licence no. | `text` | optional; trim; ≤ 32 chars; no format regex (`N-04827` is one school's format, not a national one) | empty | renders nothing when absent, not `—` inside a sentence |
| Credential note | text | optional, ≤ 48 | empty | omit fragment |
| Shift note | text | optional, ≤ 64 | empty | omit fragment |
| Affiliation | text | optional, ≤ 96 | empty | omit fragment |

Avatar glyph = initials of the two leading name words (repo `initials()` helper in `components/app/sidebar.tsx` — reuse it). `.visiting` avatar variant when the row has no `user_id`.

### §1.4 School Health Prefects card

Card head: `School Health ` + `<em>Prefects</em>` · meta `6 students · SHEP-aligned` → render `{n} students · SHEP-aligned` (**derived count**, static suffix).

Four rows, verbatim:

| Avatar (`.prefect`, green tint) | `.name` | `.role` | `.status-pill` |
|---|---|---|---|
| `FT` | `F. Tetteh · F3 BUS` | `Senior · **Aggrey House** · 06:30 round assist` | `Roster lead` |
| `AO` | `A. Osei · F3 GA` | `Senior · **Aggrey House** · first-aid trained` | `Roster` |
| `EA` | `E. Asare · F2 SCI` | `Slessor House · trained Feb 2026` | `Roster` |
| `+3` | `3 more prefects · Aggrey, Kufuor, Nkrumah` | `Full roster covers all 6 houses · two-week rotation` | `View all` |

CTA: `Add School Health Prefect`.

**Row grammar:** `{initial}. {Surname} · {Form}{Programme abbrev}` — e.g. `F. Tetteh · F3 BUS`. The abbreviations (`BUS` / `GA` / `SCI`) are the WASSCE programme short codes already in the repo. Name is abbreviated to initial + surname **at render**; store the full student reference (FK), never the abbreviation.

**The `+N` overflow row is a real interaction state, not demo filler.** Grammar: show the first **3** roster rows, then one summary row when `count > 3`:
- avatar `+{count-3}`
- name `{count-3} more prefects · {distinct house names of the hidden rows, comma-joined}`
- role `Full roster covers all {n} houses` — **AUTHORED trim**: drop ` · two-week rotation`. Rotation cadence is drawn by no control and read by nothing; skipping it saves a column. Add when a rounds roster actually needs it (INCR-24).
- pill `View all` → expands the card in place (all rows), no route change.

**Per-fragment binding:**

| Fragment | Binding |
|---|---|
| student name, `F3 BUS`, House | **BACKED** — `students` + `classes` + `houses` |
| "is a health prefect" | **PARTIALLY BACKED → NEEDS SCHEMA · N30.** `_enums.ts::prefectRoleEnum` includes `SICKBAY` but it sits on `boarding_bunk.prefect_role`: bunk-scoped, one-per-bunk, display-only, appointment workflow deferred (Kofi OQ4). It cannot express a 6-student school-wide roster. **Author a distinct sickbay health-prefect roster row; do not overload `boarding_bunk`.** A day student can be a health prefect and has no bunk at all — that alone settles it. |
| `Senior` (seniority) / `Roster lead` pill | **NEEDS SCHEMA · N30** — a stored attribute, not time-derived. **These pills SHIP at INCR-21** (unlike the clinical ones). Suggested shape: an ordinal or a `is_roster_lead boolean`; `Senior` and `Roster lead` are two renderings of the same seniority fact — confirm with Wells before splitting into two columns. |
| `06:30 round assist` / `first-aid trained` / `trained Feb 2026` | **NEEDS SCHEMA · N30** — one nullable free-text `roster_note`. All three strings are the same slot rendered differently; a date column cannot express "trained, date unknown" and a boolean cannot express "Feb 2026". One text column renders all three verbatim and nothing queries it. Shape note for Wells. |
| `06:30 round assist` referencing the §2 anchor slot | **NOT an FK.** Free text. Modelling prefect→slot assignment is INCR-24's problem (round staffing), not the roster's. |

**Control — `Add School Health Prefect`:**

| Field | Input | Validation | Default |
|---|---|---|---|
| Student | searchable select over active students (name / class / house) | required; must be ACTIVE; **unique per student** (no duplicate roster rows) | none |
| Seniority | select (`Senior` / member) + roster-lead toggle | at most **one** roster lead per school | member |
| Roster note | text | optional, ≤ 64 | empty |

Remove: a per-row remove affordance is **not drawn on the surface**. Ship it anyway — a roster with no removal is a bug, not a simplification (prefects graduate every year). Minimal form: row-hover `Remove` with confirm. AUTHORED.

**B3 does not bite at INCR-21.** The prefect roster is a *listing* of students; no student writes anything. The student-as-clinical-actor problem (prefect records a complaint, witnesses a dose) arrives at INCR-22/24. Say so in the PR so Sarah's gate scopes correctly.

### §1.5 Two-column layout

`.col-2` = `grid-cols-2 gap-[18px] mb-6`. Below 1280px → single column (surface media query). See §7.

### §1.6 §1 interaction states

| State | Render |
|---|---|
| **Loading** | Card skeletons at the real row heights (`.staff-row` = 59px incl. divider). No spinner over the whole page — the mode strip is server-rendered and should paint first. |
| **Empty · clinical staff** | Card renders with head meta `0 active · 0 visiting`, no rows, and the `Add clinical staff member` CTA as the only body content. **No illustration, no "nothing here yet" pep.** Optional AUTHORED one-liner in `text-navy-3 text-[12px]`: `No clinical staff registered.` — owner may veto; the bare CTA alone is also correct. |
| **Empty · prefects** | Same shape, meta `0 students · SHEP-aligned`, CTA `Add School Health Prefect`. **In Mode C this is the section's primary content and must never look like a failure** — see §3. |
| **Error (write)** | Inline error under the offending field; the row does not disappear. Toast for action-level failures. Never blank the card. |
| **Populated** | As mapped above. |
| **Disabled (read-only actor)** | A MATRON reading §1 sees every row and **no** CTAs, no radio interaction (`.mode-card` loses `cursor:pointer`, gains `aria-readonly`), no `Save changes`. Do not hide the data; hide the affordance. |
| **Dirty tracking** | `Save changes` is **disabled until a field changes** (mode radio is the only §1 field it owns; staff/prefect rows write immediately). Enabled state = `.btn.gold`; disabled = same fill at `opacity-50`, `cursor-not-allowed`. |

---

## §2 — Capacity & hours (`/senior/sickbay/setup#capacity`)

**Surface lines 392–553.** Same sidebar actor: **Headmaster**.

### §2.1 Page head — exact copy

| Element | Exact copy | Token / type |
|---|---|---|
| Crumb | `Sickbay` (`<a>`) ` / Setup / Capacity & hours` | as §1.1 |
| `<h1>` | `Capacity & ` + `<em>hours</em>` | as §1.1 |
| Lede | `Beds, isolation, operating hours, and the **06:30 medication round** · the anchor that defines a boarding sickbay's daily shape` | `text-navy-3 text-[13px]`; `<b>` → `text-navy-2 font-semibold` |
| Action | `Reset to defaults` | `.btn` secondary |

Because §1 and §2 are one route, the second `.page-head` becomes an in-page section header at `#capacity`; the crumb is not repeated. Keep the h1 copy as the section heading (`font-display text-[28px]`), keep the lede, keep `Reset to defaults` right-aligned against it.

### §2.2 Bed capacity

Heading (line 451): `Bed capacity` — `font-display text-[16px] font-semibold text-navy`.

`.capacity-strip` = `grid-cols-4 gap-[14px] mb-[18px]` → **`grid-cols-3` at INCR-21** (tile 4 omitted, X4).

| # | `.lbl` | `.val` | `.desc` | INCR-21 |
|---|---|---|---|---|
| 1 | `General beds` | `<em>6</em>` (gold italic Fraunces 28px) | `Mixed-use · short observation` | **BUILD** |
| 2 | `Isolation beds` | `<em>2</em>` | `Cross-infection containment` | **BUILD** |
| 3 | `Currently occupied` | `<em>1</em>` + `<span class="sub-num"> / 8</span>` | `**Adwoa Mensa** · bed 3 · since 09:14` | **BUILD, empty-by-truth** |
| 4 | `Avg. weekly load` | `<em>2.4</em>` + `<span class="sub-num"> beds</span>` | `Semester 2 to date · was 3.1 in Semester 1` | **OMIT** (X4) |

- The `.desc` static strings on tiles 1 and 2 (`Mixed-use · short observation`, `Cross-infection containment`) are **fixed editorial labels, not data**. Ship verbatim as constants.
- Tile 3 denominator `/ 8` = general + isolation. **"The two numbers can't pool"** (notes line 543) — they are separate capacities; the sum is display-only.

**Tile 3 at INCR-21 (X3):** there is no admission table, so occupancy is *known to be zero*, not unknown.
- `.val` → `<em>0</em><span class="sub-num"> / {total}</span>`
- `.desc` → `No one admitted` (AUTHORED, `text-navy-3 italic`) — **not** `—`, not a fake name, not a hidden tile.
- **No click-through.** The notes panel promises this tile links to the live ops surface; that surface is INCR-22. Render as plain text now; add the link when `/senior/sickbay/today` exists.
- When `total = 0` (Mode C, or a Mode-B school with no beds): the tile is **not rendered at all**, not `0 / 0`.

**Controls — bed counts:**

The surface draws tiles 1 and 2 as *displays*, with no visible input affordance, while the §1 lede claims *"all editable here"*. **Interpretation (flag it as an interpretation):** make the two values inline number inputs styled exactly as the tile value (Fraunces 28px gold), saved by the §1 `Save changes` bar. No separate editor screen, no modal.

| Field | Input | Validation | Default | Disabled |
|---|---|---|---|---|
| General beds | `<input type="number" inputmode="numeric">` | integer, `min 0`, `max 200`; blank → 0 | `0` on a fresh school | disabled in Mode C (§3); read-only for MATRON |
| Isolation beds | same | integer, `min 0`, `max 200` | `0` | same |

**Reconciliation write:** if beds are rows (`sickbay_bed`, N2 — required by the today surface's 8 individually numbered beds with per-bed `Iso` tags), the count input is a **reconciler**: raising it inserts numbered rows, lowering it deactivates the highest-numbered free rows. **Never hard-delete a bed** and (INCR-22 guard) never deactivate an occupied one. Whether 0056 authors `sickbay_bed` rows or two integer columns on the config is a **Wells shape call** — the surface's setup view is satisfied by counts; the *today* surface (INCR-22) is not. Deciding it at 0056 avoids a migration two increments later.

### §2.3 Operating hours & rounds

Heading (line 476): `Operating hours & rounds` — `font-display text-[16px] font-semibold text-navy`, `margin:24px 0 12px`.

Table inside a `.card`. Columns: `Schedule slot` · `Time window` · `Staffing` · `Day type` (last column right-aligned, `th:last-child` and `td:last-child`).

**Seven rows, verbatim — this is the canonical Mode-B day and the module's config source of truth:**

| # | `td.lbl` (label) | `.anchor-tag` | `.desc` sub-line | `td.time` (mono) | Staffing | Day type |
|---|---|---|---|---|---|---|
| 1 | `Morning medication round` | **`Anchor`** | `Chronic-condition students collect dose · sickle cell hydration check` | `06:30 – 07:00` | `Matron + Prefect` | `Every school day` |
| 2 | `Morning clinic` | — | `Walk-in · students before assembly` | `07:00 – 08:00` | `Matron` | `Every school day` |
| 3 | `Daytime clinic` | — | `Walk-ins with HM exeat slip from class` | `10:00 – 17:00` | `Matron` | `Mon · Tue · Wed · Thu · Fri` |
| 4 | `Noon medication round` | — | `Mid-day chronic doses · post-lunch` | `12:30 – 13:00` | `Matron` | `Every school day` |
| 5 | `Visiting doctor` | — | `Dr K. Mensah · admissions reviewed` | `14:00 – 17:00` | `Doctor + Matron` | `Thursdays` |
| 6 | `Evening medication round` | — | `After prep · pre-bed doses` | `21:00 – 21:30` | `Matron or Asst.` | `Every day incl. weekend` |
| 7 | `On-call overnight` | — | `Asst. Matron sleeps in adjoining room` | `22:00 – 06:00` | `Asst. Matron` | `Every day · 365` |

The en-dash separator in the time window is `–` (U+2013) with spaces: `06:30 – 07:00`. The `.desc` sub-line renders as a `block` under the label at `10px text-navy-3`.

**The `Anchor` flag is a real column, not a decoration** (notes line 546): *"the anchor tag tells the schema this slot can't be moved; everything else flexes around it."* → `is_anchor boolean`, exactly one anchor row per school, its **start time is not editable** and the row is **not removable**.

**FLAG D1 — the `Day type` axis does NOT fit `boardingDayTypeEnum`.** My module inventory said "reuse `dailyScheduleTemplate`'s day-type enum". **That is wrong and I am correcting it here.** `boardingDayTypeEnum = ('WEEKDAY','SATURDAY','SUNDAY','VISITING_SUNDAY')` cannot express `Thursdays` (a specific weekday), cannot distinguish `Every school day` (term calendar) from `Mon · Tue · Wed · Thu · Fri` (literal weekdays), and cannot distinguish `Every day incl. weekend` from `Every day · 365` (vacation coverage). Five distinct semantics across seven rows.

Shape options for Wells (I map the requirement; the ruling is his + Kofi's):
- **(a) small enum + nullable weekday** — `('SCHOOL_DAY','WEEKDAY','SPECIFIC_WEEKDAY','EVERY_DAY')` + `weekday smallint NULL` (ISO 1–7, required iff `SPECIFIC_WEEKDAY`) + `includes_vacation boolean default false` to separate rows 6 and 7. Labels rendered by one pure function in `lib/`.
- **(b) `days_of_week smallint[]`** + the same two booleans — more general, more render logic.
Either way: **do not reuse the boarding enum, and do not store the display string.** Labels are derived, so INCR-23's chronic-med grid and INCR-24's rounds can render the same slot differently without a copy fork.

**FLAG D2 — the overnight row wraps midnight.** `22:00 – 06:00`. Any `end > start` validation rejects the canonical Mode-B configuration. Validation must be: `end != start`, wrap permitted, and (optional) warn when a wrapping slot overlaps the anchor round.

**Controls — hours table:**

| Field | Input | Validation | Default | Disabled |
|---|---|---|---|---|
| Slot label | text | required, ≤ 48 | seeded from the canonical 7 | anchor row: **editable** |
| Description | text | optional, ≤ 96 | seeded | — |
| Start / End | **`<input type="time">`** (native — no picker dependency) | HH:MM; wrap allowed (D2) | seeded | anchor row **start is locked** (`readonly` + `title` explaining the anchor rule) |
| Staffing | text | optional, ≤ 32 | seeded | — |
| Day type | select (+ weekday select when `SPECIFIC_WEEKDAY`) | required | seeded | — |
| Slot active | toggle | — | on | anchor row: **cannot be deactivated** |

- **Row add/remove is NOT drawn on the surface.** Ship the `active` toggle (a Mode-B school with no noon round needs an off switch) and **defer `+ Add schedule slot`** until a school asks. Skipped: custom slots; add when a Mode-A school needs an isolation round.
- **`Reset to defaults`** — restores the canonical 7 rows from a `lib/` constant (verbatim table above, including descriptions and the anchor flag). **Destructive → confirm step required** (`This replaces all {n} schedule slots with the 7 default slots.` — AUTHORED). In Mode C, `Reset to defaults` resets to the **empty set**, and the button is hidden along with the section.
- The canonical 7 are also the **seed on first mode selection** for Modes A and B: choosing `FULL`/`FIRST_AID` on a school with no slots seeds them. Mode C seeds nothing. *(Consistent with repo memory `onboarding-inputs-cascade`: an input must create its artefact, never make the admin re-enter it.)*

### §2.4 §2 interaction states

| State | Render |
|---|---|
| **Loading** | Tile skeletons at real height; table skeleton at 7 rows. |
| **Empty · no slots** (Mode A/B, slots all removed or pre-seed) | Table head renders; body renders one row spanning all columns: `No schedule slots configured.` + `Reset to defaults` as the recovery action. AUTHORED. |
| **Empty · zero beds** (Mode B with beds = 0) | Tiles 1 and 2 render `0` (a real configured value, not `—`); tile 3 is **omitted** (no denominator). |
| **Error** | Field-level inline; a failed time save reverts the input to its stored value and shows the message under the row. |
| **Populated** | As mapped. |
| **Disabled (MATRON)** | Every input `readonly`, `Reset to defaults` hidden. She must *read* her own hours; she does not set them. |

---

## §5 — Policy anchors (read-only context only)

**Surface lines 912–924.** Two `.policy-anchor` cards in a `.col-2`. **Pure editorial — zero schema, zero controls, zero state.** They exist in this map because they are the regulatory grounding for the §1 N&MC licence field. Shipping them is optional at INCR-21 and costs one static component.

| | Card 1 | Card 2 |
|---|---|---|
| `.pa-eyebrow` | `GES side` | `MoH side` |
| `h3` | `SHEP · ` + `<em>School Health Education Programme</em>` | `N&MC · ` + `<em>Scope of Practice</em>` |
| `.pa-body` | `The Ghana Education Service's unit responsible for school-based health promotion and delivery. SHEP coordinates the **School Health Prefect roster**, sets the curriculum for health education, and links public schools to district health teams. The sickbay's prefects, drug stock guidance, and outbreak reporting all sit under SHEP.` | `Nursing and Midwifery Council of Ghana, the statutory regulator (LI 683, 1971). The **Matron's clinical authority** derives from her N&MC license and her registered standing orders with the visiting doctor. Anything outside scope routes to Dr Mensah or the hospital. The N&MC license number is captured on the staff record and shows on every dispensary action she signs.` |

**Tokens:** `background: linear-gradient(135deg, var(--navy) 0%, var(--navy-2) 100%)`, `rounded-[14px]`, `padding 24px 28px`, body text `text-gold-soft text-[13px] leading-[1.65]`, `<b>` → `text-bg font-semibold`, `h3` `font-display text-[24px] font-medium text-bg` with italic gold `<em>`, eyebrow `text-gold text-[10px] tracking-[0.18em] uppercase font-bold`.
**One translucency:** the decorative `::before` glow — `140px` circle, `rgba(200,151,91,0.08)`, `top:-30px right:-30px`, inside `overflow:hidden`. Port as `bg-[rgba(200,151,91,0.08)]`, **never** `bg-gold/8`. Purely decorative — dropping it is acceptable.

**Not in INCR-21:** the `Three-tier parent notification rule` heading, its 13-line preamble, the three `.notify-tier` rows and their action tags/channels (INCR-26), and the `.save-bar` (INCR-24 — its copy is stock-dependent).

In **Mode C** both cards still render. SHEP is *more* relevant to a Mode-C school (its prefect roster is the entire front line), and N&MC still bounds whoever the designated health focal person is.

---

## 3. Mode render matrix — A / B / C, element by element

**The surface only ever draws Mode B.** Every Mode-A and Mode-C behaviour below is derived from the mode-card copy, the notes panel, and BUILD_STACK Decision 1 (*"A `REFERRAL_ONLY` school sees no bed-allocation UI, no medication rounds, no admission workflow"*). **Mode C is ~49% of public SHS — it is a first-class render, not a degraded one.**

### 3.1 §1 Mode & staff

| Element | **A · FULL** | **B · FIRST_AID** (drawn) | **C · REFERRAL_ONLY** |
|---|---|---|---|
| Mode strip | 3 cards, A active | 3 cards, B active | 3 cards, C active |
| Lede | full clause list as sections land | same | drop `capacity` → `How your sickbay is run · **mode**, **staff** · all editable here` |
| Clinical staff card | renders; expects matron + assistant + doctor | renders as drawn | **renders, usually empty.** Same card, same CTA. A Mode-C school may register the designated health focal person (BUILD_STACK D1: *"the matron role filled by the most senior staff designated for health"*). Empty state per §1.6 — **never a placeholder, never a "not applicable" scold.** |
| Prefect card | renders (secondary — a Mode-A school still runs SHEP prefects) | renders as drawn | **PRIMARY content.** This is the school's entire first-response capability. |
| Two-column layout | `col-2` | `col-2` | **single column**, prefect card **first**, clinical staff card **second** (or the pair kept side-by-side with prefects on the left). Reordering by importance is the whole point of a mode-aware surface. |
| `Save changes` | yes | yes | yes |

### 3.2 §2 Capacity & hours

| Element | **A · FULL** | **B · FIRST_AID** (drawn) | **C · REFERRAL_ONLY** |
|---|---|---|---|
| Section visible | yes | yes | **NO** — the whole `#capacity` section does not render |
| Bed tiles | general + isolation, both expected > 0 | as drawn; isolation may legitimately be `0` | not rendered |
| Occupied tile | renders (0 at INCR-21) | renders (0 at INCR-21) | not rendered |
| Hours table | 7 canonical rows, plus room for A-only slots (isolation rounds, resident-doctor hours) — deferred, see §2.3 | 7 canonical rows | not rendered |
| `Reset to defaults` | yes | yes | not rendered |
| Stored data | — | — | **preserved, not deleted.** A B→C switch hides beds and slots; C→B restores them exactly. |

**Mode C's §2 substitute — one card, no tiles, no table.** Rather than a headless gap where a section used to be, render a single explanatory card in the `#capacity` slot:

> **AUTHORED copy (owner review required — not in the surface):**
> heading `Capacity & hours` · body: `Referral-only operation · no beds, no medication rounds, no admissions. First response runs through the School Health Prefect roster; every case routes to a referral hospital.`

That sentence is assembled from Mode C's own card copy (`No sickbay. School Health Prefect roster handles first response, all cases route to nearest hospital.`) so the voice stays the surface's. If the owner prefers total absence, omitting the section entirely is also honest — what is **not** acceptable is rendering the tiles at `0` or the table empty, which reads as a broken Mode-B school.

**Mode A additions (not drawn, do not invent at INCR-21):** an isolation *ward* concept distinct from isolation *beds*, resident-doctor hours, and outbreak-management-on-site affordances are all implied by the Mode-A card copy and drawn nowhere. **Mode A at INCR-21 renders exactly like Mode B** (same tiles, same table, higher expected numbers). Say so in the PR; do not scaffold speculative Mode-A UI.

---

## 4. Data bindings — §1 and §2 only

### 4.1 BACKED (existing tables, no migration)

| Element | Table / column |
|---|---|
| School identity in the sidebar brand (`Asankrangwa SHS`, `SHS · Western North`) | `schools.name` / `schoolType` / `location` — existing sidebar component |
| Sidebar footer actor (`Mr Asare-Mensah` / `Headmaster`) | `ref_user` + `role_assignment` — existing |
| Clinical staff person (when internal) | `ref_user` / `staff_profile`, role `MATRON` (already in `appRoleEnum`, `KnownAppRole`, and `db/seed/asankrangwa.ts`) — **no enum add** |
| Prefect student identity | `students` (name, status) |
| Prefect class label `F3 BUS` | `classes` + programme short code |
| Prefect House `Aggrey House` | `houses` |
| Every mutation's audit row | `audit_log` via `lib/db/audit.ts` |

### 4.2 NEEDS SCHEMA — migration 0056 (N-numbers carried from the inventory)

| N# | Shape | Fed by (§1/§2 elements) | Notes for Wells |
|---|---|---|---|
| **N1** | `sickbay_config` — one row per school: `mode sickbay_mode_enum` (`FULL`/`FIRST_AID`/`REFERRAL_ONLY`, per BUILD_STACK L344), bed counts if not modelled as rows | §1 mode strip; §2 tiles 1–2 | Mirror `boarding_settings`: single-column `school_id UNIQUE` FK, leaf, FORCE RLS, column DEFAULTs carrying the sane default so a bare `INSERT (school_id)` yields a correct row. Recommended `mode` default `REFERRAL_ONLY`. **Omit** the §3 procurement-window column until INCR-24. |
| **N2** | `sickbay_bed` — number, `is_isolation`, `active` | §2 tiles 1–3 | Required by the today surface's 8 numbered beds with per-bed `Iso` tags (INCR-22). Authoring it at 0056 avoids a count→rows migration at 0057. Alternative (counts on N1) satisfies **this** surface only. |
| **N3** | `sickbay_schedule_slot` — label, description, start, end, staffing, day-type axis (FLAG D1), **`is_anchor`**, `active`, sort order | §2 hours table (7 rows) | Exactly one `is_anchor` per school. This table is the config INCR-23's med grid and INCR-24's rounds must read — **the three contradictory round schedules across the surfaces (F4 below) are the proof that rounds cannot be hardcoded.** |
| **N29** | N&MC licence on the staff profile — `nmc_licence_number` / `nmc_licence_expiry` beside the existing `ntc_licence_number` / `ntc_licence_expiry` (`db/schema/staff.ts:44–45`), **or** generalise to `licence_body` / `licence_number` / `licence_expiry` | §1 clinical staff row 1 | The mirror-NTC option is the smaller diff and matches the existing import/action code paths (`lib/import/staff-import.ts`, `lib/actions/staff.ts`). Generalising touches the shipped staff importer. |
| **N30a** | Sickbay clinical-staff roster — `user_id NULL` **or** external `person_name` + `affiliation` (FLAG A1 / B4), `designation`, `credential_note`, `shift_note`, sort order, `active` | §1 clinical staff card | The N&MC number lives on `staff_profile` (N29) for internal staff; an external clinician with no `staff_profile` needs it on this row too, or it is simply absent for them. |
| **N30b** | Health-prefect roster — `student_id` FK, seniority / `is_roster_lead`, `roster_note`, `active` | §1 prefect card | **Do not overload `boarding_bunk.prefect_role`** — bunk-scoped, one-per-bunk, and a day student has no bunk. |

**Out of 0056 (explicitly):** N4 standing orders, N5 stock, N6 hospitals, N7 notification policy, N8–N15 the visit atom and rounds, N16 surveillance, N17–N20 chronic register, N21–N24 referrals, N25 NHIS, N26–N28 notifications. INCR-21 authors **six shapes**, not thirty.

### 4.3 NO CLEAN BINDING (B-numbers) — how each resolves in §1/§2

| B# | Element | INCR-21 resolution |
|---|---|---|
| **B10** | `11 years here` (staff tenure) | **OMIT the fragment.** No staff start-date field; `created_at` is account creation, not tenure. |
| **B4** | Visiting doctor as an actor with no login | Directory row only at INCR-21 (name + affiliation as text). Decide the actor-without-account shape at 0056 so INCR-22's consult record does not force a backfill. Kofi/Wells. |
| **B3** | Student as a clinical actor | **Does not bite at INCR-21** — the prefect roster is a listing; no student writes. Bites at INCR-22/24. |
| **B14** | Mode-C degradation of the other surfaces | Owned here for §1/§2 (§3 matrix). Surfaces 2–5 must each declare their Mode-C render in their own increment; INCR-21 sets the precedent: **empty-by-design, reordered by importance, never zeroed.** |
| — | Status pills `On shift` / `Off · back 18:00` / `Tomorrow` | Time-derived with no source at 21 → **OMIT** (FLAG P1). Not a B-number; a deferred derivation. |

---

## 5. Write actions & authz

**Read gate (both sections):** `SICKBAY_ROLES = [ADMIN, HEADMASTER, MATRON]` — the board's ruling, mirroring `BOARDING_ROLES`'s shape in `lib/access.ts`. `STUDENT` / `PARENT` / `TEACHER` / `HOUSEMASTER` never reach `/senior/sickbay/setup`. The MATRON **must** read §1/§2 — they are her staff list and her working hours.

**Write gate (both sections):** `HEADMASTER` + `ADMIN` only. **MATRON is read-only across §1 and §2.** This is not an assumption — the surface encodes it: the sidebar footer reads `Mr Asare-Mensah · Headmaster` on §1/§2/§4/§5 and switches to `Mrs Bediako · Senior Matron` on §3 alone (line 594). Two write scopes on one page; INCR-21 builds only the Headmaster one.

> Note on `ADMIN`: board D2's "admin-private" means *school leadership*, not this codebase's `ADMIN` (proprietor/IT). D2 constrains **clinical** reads. §1/§2 are configuration, not clinical, so `ADMIN` writing config is consistent. The one PII-adjacent element in scope — §2 tile 3's patient name — is empty at INCR-21 and must carry the clinical read gate when INCR-22 fills it.

| # | Action | Trigger | Writes | Authz | Guards |
|---|---|---|---|---|---|
| **W1** | Set sickbay mode | mode radio + `Save changes` | `sickbay_config.mode` (N1) | HEADMASTER, ADMIN | Confirm when hiding stored rows; **never delete** beds/slots; seeds the canonical 7 slots on first A/B selection; INCR-22 forward guard: block while an admission is open |
| **W2** | Save bed counts | number inputs + `Save changes` | `sickbay_bed` rows (N2) or N1 counts | HEADMASTER, ADMIN | integer ≥ 0; reconcile rows, deactivate never delete; INCR-22: cannot go below occupied |
| **W3** | Add clinical staff member | `.add-staff` CTA | N30a row (+ N29 licence on `staff_profile` for internal staff) | HEADMASTER, ADMIN | person XOR external name; designation required |
| **W4** | Remove / deactivate clinical staff | row action (AUTHORED — not drawn) | N30a `active = false` | HEADMASTER, ADMIN | soft-deactivate only |
| **W5** | Add School Health Prefect | `.add-staff` CTA | N30b row | HEADMASTER, ADMIN | student ACTIVE; unique per student; ≤ 1 roster lead |
| **W6** | Remove prefect | row action (AUTHORED) | N30b `active = false` | HEADMASTER, ADMIN | soft-deactivate |
| **W7** | Edit schedule slot | inline field blur/save | N3 row | HEADMASTER, ADMIN | anchor start locked; wrap-midnight allowed (D2); label required |
| **W8** | Toggle slot active | row toggle (AUTHORED) | N3 `active` | HEADMASTER, ADMIN | anchor row cannot be deactivated |
| **W9** | `Reset to defaults` | §2 header button | replaces N3 rows with the canonical 7 | HEADMASTER, ADMIN | **destructive → confirm**; Mode C resets to the empty set |

Every W-action writes `audit_log` with an `entityType` per config table (existing `lib/db/audit.ts` mutation path — no read-audit in INCR-21; that is INCR-23's novel problem).

**RLS:** every new table is school-scoped with the tenant-isolation family + FORCE RLS, composite `(school_id, id)` FKs per repo memory, and — free of charge — `parent_deny` is catalog-driven, so all six shapes are parent-denied with zero edits (board risk 1). **Prod RLS must be hand-pasted** (repo memory `prod-rls-manual-paste`): 0056 is the first of the module's five pastes.

---

## 6. Fabricated demo content appearing in §1/§2 — do not build these as data shapes

Six of the module's fifteen fabricated items land in this increment. None becomes a column, a seed, or a computed value.

| F# | Item | Where | Verdict |
|---|---|---|---|
| **F1** | Mode percentages `~16%` / `~30%` / `~59%` (sum = 105%) presented as research figures | §1 mode strip `.mode-stat` | **Static editorial copy.** Ship verbatim inside the card component. Never computed, never stored, never a config row. If the owner wants them gone, the cards read fine without the `.mode-stat` line. |
| **F2** | Card meta counts `2 active · 1 visiting`, `6 students · SHEP-aligned`; section metas `4 staff registered`, `8 beds total · 2 isolation` | §1 card heads (+ design-doc `.section-head`, not built) | **Derive, never copy.** The §3 header that claims "3 reorder alerts" over a 2-alert table is the module's proof that hand-written counters drift. |
| **F3** | Houses **Kufuor** and **Nkrumah** in the prefect overflow row | §1 prefect row 4 | **Seed drift.** The dev seed's six houses are Aggrey · Guggisberg · Fraser · Slessor · Kingsley · Aryee. The house list in that row is **derived from the roster's own rows** — it renders whatever houses exist. No hardcoded house names anywhere. |
| **F4** | Three contradictory medication-round schedules across the module: `06:30/12:30/21:00` (**this surface, §2**) vs `06:30/12:30/17:00/21:00` (today §02) vs `06:30/13:00/21:00` (chronic register §02 grid columns) | §2 hours table | **This is the argument for N3.** §2 is the source of truth; INCR-23's grid columns and INCR-24's rounds **render from N3**, never from a constant. The contradiction is not a bug to reconcile in copy — it is the requirement. |
| **F5** | `Avg. weekly load 2.4 beds · was 3.1 in Semester 1` | §2 tile 4 | **OMIT the tile** at INCR-21 (X4). No source table exists. Reinstate at INCR-22 with a real empty state — never a fabricated baseline. |
| **F6** | `Adwoa Mensa · bed 3 · since 09:14` (the SCD anchor patient; the seed's nearest student is *Abena Mensah*) | §2 tile 3 desc | **Never rendered at INCR-21** — the tile shows the honest zero (X3). When INCR-22 fills it, the name comes from the admission record. |

Also noted, and **absent** from §1/§2: the four conflicting Slessor housemaster names and the four student-code formats (inventory F#1/F#2) appear on the *today*, *visit-record*, *chronic-register* and *referral-log* surfaces — **neither a housemaster nor a student code is printed anywhere in §1/§2.** Nothing to guard here.

`F. Tetteh` as Senior Health Prefect (cross-referenced from the boarding batch) is **narrative continuity, not a data shape** — he is a demo student like any other.

---

## 7. Responsive & PWA

The surface declares **one** breakpoint (line 197, `max-width:1280px`): `.mode-strip` → 1 column, `.col-2` → 1 column, `.capacity-strip` → 2 columns. Everything below 1280px is unspecified and must be authored.

| Width | §1 | §2 |
|---|---|---|
| ≥ 1280px | mode strip 3-col; staff cards 2-col | capacity strip 3-col (4 when tile 4 returns); full table |
| 768–1279px | mode strip **1-col** (surface rule); staff cards **1-col** | capacity strip **2-col**; table intact |
| < 768px (PWA / phone) | mode cards stack full-width — they stay tappable radio targets, min 44px hit area; staff rows keep the `36px 1fr` grid, the (omitted) pill column is moot | capacity tiles **1-col**; **the hours table becomes stacked slot cards**: label + `Anchor` tag on line 1, description line 2, mono time window line 3, `staffing · day type` line 4. Do not horizontally scroll a 4-column config table on a phone. |

Number and time inputs use native mobile keyboards (`inputmode="numeric"`, `type="time"`) — no picker dependency. Skipped: an offline write queue; this is a low-frequency config surface, add when someone configures a sickbay on a bus.

---

## 8. Cross-module hooks preserved in this increment

| Hook | Where in §1/§2 | Status at INCR-21 |
|---|---|---|
| **sickbay → attendance "M"** (the board's headline hook) | not on this surface | INCR-22. Nothing in §1/§2 writes attendance. |
| **Boarding — House** | prefect roster rows print House; overflow row aggregates houses | **live read** of `houses` (BACKED) |
| **Boarding — prefect vocabulary** | `prefectRoleEnum.SICKBAY` exists on `boarding_bunk` | **deliberately not reused** (see N30b) — record the divergence in the PR so it is not read as an oversight |
| **Boarding — exeat** | §2 slot 3 description `Walk-ins with HM exeat slip from class` | **narrative text only.** Not a join, not a link. `boarding_exeat` (INCR-9) is real, but this string is a description, not a query. |
| **Boarding — day rhythm** | §2 `Day type` column | **NOT the boarding enum** (FLAG D1). Correcting my own inventory. |
| **Config → rounds / med grid** | §2 hours table (N3) | The forward commitment: INCR-23's grid columns and INCR-24's round instances read N3. **Design commitment, not layout accident.** |
| **Config → hospitals** | §1 doctor affiliation text | free text at 21, promotable at INCR-25 (X1) |
| **Boarding sick-bay placeholder retirement** | not on this surface | INCR-28. The `"· sick-bay not subtracted"` gloss stays (OQ5 ruling). |

---

## 9. Omit-not-fake register (the honest-omission list for the PR)

| Omitted | Why | Reinstatement trigger |
|---|---|---|
| §2 tile 4 `Avg. weekly load` | no visit table exists — an absent concept, not an empty value | INCR-22 (+ real empty state) |
| §1 clinical status pills (`On shift` / `Off · back 18:00` / `Tomorrow`) | time-derived; no shift assignment; the underlying fact is already in the role line | a per-staff shift assignment (N30a), earliest INCR-22 |
| `11 years here` | B10 — no staff start-date field | a real `staff_profile.started_on` |
| `SHEP policy ↗` button | dead link | a real SHEP URL the owner approves |
| `NEW` badge on the sidebar nav item | no such convention in the app sidebar | never |
| ` · two-week rotation` in the prefect overflow line | rotation cadence is drawn by no control and read by nothing | INCR-24 round rostering |
| §1 lede clauses `standing orders`, `referral hospitals`, `policy anchors` | advertise sections this increment does not build | 24 / 25 / 26 respectively |
| §2 tile 3 click-through to the live ops surface | target route does not exist | INCR-22 |
| `+ Add schedule slot` | not on the surface; the canonical 7 + an active toggle cover Mode A/B | a Mode-A school needing a custom slot |
| Mode-A-only affordances (isolation ward, resident-doctor hours) | drawn nowhere; speculative | a Mode-A design pass |
| §5 three-tier notification rule + save bar | INCR-26 / INCR-24 | those increments |

**Nothing in this list is placeholdered.** No `LIGHT·PLACEHOLDER` badges, no greyed mock rows, no `0.0` standing in for unknown.

---

## 10. Open questions / drift log

| # | Question | Owner | Blocks |
|---|---|---|---|
| **Q1** | `sickbay_bed` rows vs two integer counts on `sickbay_config`. Setup alone is satisfied by counts; the today surface (INCR-22) needs numbered beds with per-bed isolation flags. | Wells + Kofi | 0056 shape; deciding late costs a 0057 migration |
| **Q2** | Day-type axis shape — enum + nullable weekday + `includes_vacation`, or `days_of_week smallint[]` (FLAG D1) | Wells + Kofi | 0056 |
| **Q3** | Actor-without-login for the visiting doctor: nullable `user_id` vs external name+affiliation vs both-with-a-check (B4) | Kofi | 0056; INCR-22 backfill risk |
| **Q4** | N&MC licence: mirror the NTC pair, or generalise to `licence_body`/`number`/`expiry` (touches the shipped staff importer) | Wells | 0056 |
| **Q5** | Default mode for a school that has never configured sickbay. Recommended `REFERRAL_ONLY` (~49% of schools; asserts no capacity) | Kofi | 0056 column default |
| **Q6** | Mode-C §2 substitute: one explanatory card (AUTHORED copy in §3.2) or total section absence | Owner / Lucy | INCR-21 render |
| **Q7** | AUTHORED strings needing owner sign-off: `No one admitted`, `No clinical staff registered.`, `No schedule slots configured.`, the mode-switch confirm, the reset confirm, the Mode-C capacity card | Owner | copy review before merge |
| **Q8** | Do the bed-count tiles become inline inputs (this map's interpretation), or does a separate edit affordance appear? The surface draws displays and the lede claims "all editable here". | Lucy + owner | §2.2 control |
| **Q9** | Seniority: is `Senior` (role line) the same stored fact as `Roster lead` (pill), or two attributes? | Wells | N30b |

**Inventory correction recorded:** `docs/senior/sickbay-surface-inventory.md` §2 §02 states the Day-type axis *"mirrors `boarding.ts::dailyScheduleTemplate`'s day-type enum — reuse it, don't invent a second one."* **That is incorrect** — `boardingDayTypeEnum` is `('WEEKDAY','SATURDAY','SUNDAY','VISITING_SUNDAY')` and cannot express `Thursdays`, nor separate `Every school day` from `Mon · Tue · Wed · Thu · Fri`, nor `Every day incl. weekend` from `Every day · 365`. This map (FLAG D1) supersedes it.
