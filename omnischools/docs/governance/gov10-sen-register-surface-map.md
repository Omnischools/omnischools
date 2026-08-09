# GOV-10 — Special Educational Needs (SEN) register — Surface Map

**Author:** Lucy (design cartographer) · **Status:** design spec, ready for the implementation engineer.
**Scope:** the in-app **Special needs register** — the admin-only, parent-consented SEN register that
auto-fills the GES annual census special-needs section. Maps `Surfaces/schoolup-special-needs.html`
**1:1** (single section, single in-app surface).

> **The one thing that must not be missed:** this is **sensitive personal data**. The privacy banner is the
> **FIRST element rendered inside the body** and sets the boundary before any student data appears —
> preserve it verbatim and keep it first. Every count on the page (hero splits, census cells, pending-consent
> family) is **hand-authored demo markup**; in the build **every number is DERIVED** from the register +
> consent state and will be self-consistent (the mock has three internal count mismatches — see §12). The
> surface is the *visual grammar*; the register + consent state is the *truth*.

## Source (verified first-hand)

| Source | Role in this map |
|---|---|
| `C:\Users\albas\Documents\Projects\Omnischools\.claude\worktrees\goofy-poitras-03c068\Surfaces\schoolup-special-needs.html` | **PRIMARY visual + copy source.** CSS `:root` line 9; component CSS lines 68–153; markup lines 223–377; design-intent notes lines 384–401. Untracked — exists ONLY in the goofy-poitras worktree. |
| `styles/tokens.css` + `tailwind.config.ts` (senior-live) | Canonical token vocabulary. Note the surface's `--border` = css `--border-1` (Tailwind `border-border`). |
| `docs/senior/ledger-surface-map.md` §0 · `docs/governance/gov8-census-drawer-design.md` | Shape this map follows; token→Tailwind convention (`text-navy-3`, `bg-gold-bg`, `font-display`, **never inline `var(--x)`**). |
| `docs/senior/sickbay-chronic-register-surface-map.md` + tokens.css INCR-23a `--condition-*` block | The **no-brand-token pill precedent** the intellectual category must follow (§8.1). |

> **Not a build target in this map:** the outer editorial design-doc chrome (`.page` → `.page-header`
> eyebrow/mvp-tags/`Children who need more` h1 / `.section-head` "01 · Special needs register" / the right
> `.notes` rail, HTML lines 157–172 + 384–401). That is design-doc scaffolding around the real surface.
> **Build the in-app surface inside `.desktop` → `.app-shell` → `.main`** (HTML 208–380). The notes rail
> is the design rationale, mined into this map.

---

## 0. Surface identity & placement

- **Surface URL (from the browser-bar chrome, line 178):** `app.omnischools.gh / students / special-needs`.
- **Demo school:** Christ the King **JHS**, Accra · Headmistress **Florence Addo** · enrolment **312**.
- **Demo dataset:** **8** students recorded across **3 year groups** (JHS 1/2/3), 5 boys + 3 girls.
- The surface renders the **Basic-tier JHS app shell** (flat 12-item nav, `Students` active). GOV-10 places
  this register in the **governance/census** area (it feeds GOV-8/9). **Shell placement + nav home are a build
  decision (Kofi), not a design one** — map the *body*; the implementer mounts it under the operational shell.
  See §11.

---

## 1. Token & type reference (surface `var(--x)` → Tailwind token class)

The surface declares its palette inline (`:root`, line 9); every value maps to an existing Tailwind token
**except the intellectual pill's two hexes** (§8.1). Use the class, never the raw hex, never inline `var(--x)`.

| Surface `var(--x)` | Hex | Tailwind class | Used on this surface for |
|---|---|---|---|
| `--navy` | `#1A2B47` | `text-navy` / `bg-navy` / `border-navy` | body text, `.btn.primary`, hero-main bg, privacy `.ic`, avatar text |
| `--navy-2` | `#2D3F5C` | `text-navy-2` | secondary text, lede bold, `.support-cell b`, census `.meta b` |
| `--navy-3` | `#5C6675` | `text-navy-3` | crumb, meta, labels, `.accom-tag` text, `.diag-by`, `.student-name .meta` |
| `--gold` | `#C8975B` | `text-gold` / `bg-gold` | every italic `<em>`, privacy `.ic` bg, `.category-tag.visual` text, avatar text, mvp-tag bg |
| `--gold-soft` | `#E8D4B8` | `border-gold-soft` / `bg-gold-soft` | privacy banner border |
| `--gold-bg` | `#F5EBDC` | `bg-gold-bg` | privacy banner bg, `.category-tag.visual` bg, `.student-av` bg |
| `--bg` | `#FAF7F2` | `bg-bg` | page ground, `thead th` bg, `.census-cell` bg, `.accom-tag` bg |
| `--surface` | `#FFFFFF` | `bg-surface` | every card, table, hero-tile, census-preview, student-card |
| `--green` | `#2F6B47` | `text-green` / `bg-green` | census `.ic`/`.top-tag`, `.category-tag.hearing`, `.severity-tag.mild` |
| `--green-bg` | `#E5EFE8` | `bg-green-bg` | census `.ic`/`.top-tag` bg, hearing tag bg, mild-severity bg |
| `--terra` | `#B84A39` | `text-terra` | `.category-tag.physical`, `.severity-tag.severe` |
| `--terra-bg` | `#F5E1DC` | `bg-terra-bg` | physical tag bg, severe-severity bg |
| `--warn` | `#C58A2E` | `text-warn` | `.category-tag.speech`, `.severity-tag.moderate`, **`.diag-cell .pending`** ("Diagnosis pending") |
| `--warn-bg` | `#F5E9D0` | `bg-warn-bg` | speech tag bg, moderate-severity bg |
| `--border` (css `--border-1`) | `#E5DFD3` | `border-border` | default borders, row/section dividers, `.accom-tag` border |
| `--border-2` | `#D4CCBA` | `border-border-2` | `.btn` border (stronger) |
| **`#E8E5F2`** | `#E8E5F2` | **NO TOKEN — see §8.1** | `.category-tag.intellectual` **bg** |
| **`#5847B5`** | `#5847B5` | **NO TOKEN — see §8.1** | `.category-tag.intellectual` **text** |

**Type families:** `font-display` = Fraunces (all headings, stat numbers, italic gold `<em>` accents,
category "Visual" value); `font-body`/default = Manrope (body, labels, student names, tags); `font-mono` =
JetBrains Mono (**census cell counts `.cv` and filter-pill `.count` only** — those are the only numeric-data
glyphs on this surface). Empty count renders as the literal digit `0` in the census grid (`Hearing · girls 0`,
`Speech · boys 0`, both `Other` cells) — **this is the one surface where `0` is correct**: a census cell is a
true zero-count, not a missing value, so do **not** substitute an em-dash here.

---

## 2. App shell + in-app page header (chrome around the body)

### 2.1 App shell (`.app-shell` = 220px sidebar + `.main`)
- **Sidebar** `bg-navy`, brand block: gold `logo-mini` `CK` + `Christ the King JHS` (`font-display 13px`) /
  `JHS · Accra` meta (`text-gold-soft`). **Flat 12-item nav** (verbatim): Dashboard · **Students (active)** ·
  Staff · Classes · Attendance · Billing · Books `NEW` · Reports · Announcements · Inbox · Achievements ·
  Settings. Active item = `bg-[rgba(200,151,91,0.08)] text-bg border-l-2 border-gold`; the `NEW` tag on Books =
  `bg-gold text-navy text-[8px]`. Footer: avatar `FA` / `Florence Addo` / `Headmistress`. `on Omnischools`
  powered-by strip (`text-gold` on `Omnischools`).
  > **This is the demo Basic JHS shell.** For GOV-10 the built nav home (which module, flat vs sectioned) is
  > Kofi's routing call — see §11. Map the body; don't hard-code this nav.

### 2.2 In-app page header (`.page-head`, `bg-surface border-b border-border`)
- **Crumb** (line 210): `Students / Special needs` — `text-navy-3 text-[11px] uppercase tracking-[0.12em]`;
  `Students` is a link (`text-gold`, `<a>`).
- **`<h1 class="font-display">`** (line 213): **`Special needs register`** — `font-display 28px 500
  tracking-[-0.018em]`, with italic gold `<em>` on **`needs register`** → `Special <em class="text-gold
  italic font-normal">needs register</em>`.
- **Lede** (line 214, `text-[13px] text-navy-3 max-w-[740px]`), verbatim:
  > Tracks students who need additional support · feeds the GES annual census special needs section ·
  > **admin-only access** · parents must consent before recording

  Bold span (`text-navy-2 font-semibold`): **`admin-only access`**.
- **Actions** (`.actions`, right-aligned, `gap-8px`):
  1. **`Export anonymised stats →`** — `.btn` = `border-border-2 bg-surface text-navy rounded-md px-3.5 py-2.5
     text-xs font-semibold`.
  2. **`+ Record support need`** — `.btn.primary` = `bg-navy text-bg border-navy font-bold`.

---

## 3. Privacy banner (`.privacy-banner`) — FIRST element in the body

**Render position:** the very first child of `.body` (HTML line 225), **before the hero row, before any student
data.** This is non-negotiable — the notes rail (line 387) states it "sets the boundary before the data
appears." Keep it first.

- **Container:** `bg-gold-bg border border-gold-soft rounded-[10px] px-4.5 py-3.5`, 2-col grid `28px 1fr`,
  `items-start gap-3.5`.
- **Icon** (`.ic`): `26px` gold circle, `bg-gold text-navy font-display font-bold`, glyph **`!`**.
- **Heading** (`.heading`, `font-display 13px 600`): **`Treated as sensitive personal data`** with italic gold
  `<em>` on **`sensitive personal data`** → `Treated as <em class="text-gold italic">sensitive personal
  data</em>`.
- **Body text** (`.body-text`, `text-[12px] text-navy-2 leading-[1.55]`), **verbatim** (line 229):

  > Records here are visible only to **school administrators**, not teachers (unless an administrator
  > explicitly grants access for accommodation planning). Parents must **provide written consent** before a
  > record is created. Categories describe **support needs**, not medical diagnoses — formal diagnoses are
  > recorded only when supplied by a qualified clinician. Schools that prefer not to record at student level
  > can still complete the GES census section **by hand**; this module is opt-in.

  Bold spans (`.privacy-banner b` → `text-navy font-semibold`): **`school administrators`**,
  **`provide written consent`**, **`support needs`**, **`by hand`**.

**Four policy commitments this copy encodes (each is a build constraint, not decoration):**
1. **Admin-only default** + explicit teacher-grant exception → real RBAC gate (§11, Kofi).
2. **Parent written consent before record creation** → consent is a precondition of INSERT (§11, Wells/Sarah).
3. **Categories = support needs, not diagnoses** → the vocabulary (§8) is operational, not clinical; formal
   diagnosis is a separate, clinician-sourced field (§7, `.diag-cell`).
4. **Opt-in with hand-fill fallback** → a school may decline student-level recording and still hand-fill the
   GES census section. The module must not assume adoption (honest-empty state, §9).

---

## 4. Hero row (`.hero-row`) — 4 tiles, `grid-cols-[1.2fr_1fr_1fr_1fr]` gap-3.5

### Tile 1 — hero-main (`.hero-main`, navy, `bg-navy text-bg rounded-[14px]` + gold radial glow top-right)
- **Label** (`.lbl`, `text-[10px] uppercase tracking-[0.16em] text-gold-soft font-bold`):
  `Students with recorded support needs`.
- **Value** (`.val`, `font-display 38px 600 text-gold`): **`8 of 312`** — italic `<em>` on **`8`** →
  `<em class="italic">8</em> of 312`.
- **Meta** (`.meta`, `text-[12px]`, base `rgba(232,212,184,0.85)` = gold-soft-ish; bold = `text-bg`), verbatim:
  > **2.6%** of enrolment · **5 boys, 3 girls** · spread across all 3 year groups · **3 with formal
  > diagnosis**, 5 with informal/observed need

  Bold spans (`.meta b`): **`2.6%`**, **`5 boys, 3 girls`**, **`3 with formal diagnosis`**.

### Tiles 2–4 (`.hero-tile`, `bg-surface border border-border rounded-xl`)
Label `.lbl` = `text-[9px] uppercase tracking-[0.16em] text-navy-3 font-bold`; value `.val` = `font-display
22px 600` with gold italic `<em>`; sub `.sub` = `text-[11px] text-navy-3` (bold = `text-navy-2 font-semibold`).

| Tile | `.lbl` | `.val` (em-gold on) | `.sub` (bold on) |
|---|---|---|---|
| **2 By gender** | `By gender` | `5 boys · 3 girls` (`<em>5</em>`, `<em>3</em>`) | `JHS 1: 3 · JHS 2: 3 · JHS 3: 2` |
| **3 Largest category** | `Largest category` | `Visual` (`.val.display`, no em — plain Fraunces) | `3 students · 2 wear glasses` (bold **`3 students`**) |
| **4 Pending consent** | `Pending consent` | `1 family` (`<em>1</em>`) | `In census aggregate without student detail` (bold **`without student detail`**) |

> **Tile 4 is the consent-boundary made visible.** A pending-consent family's child is counted in the GES
> census **aggregate only, with no student-level row** (they do NOT appear in the §7 table). This is the
> aggregate-vs-detail redaction invariant — a build commitment owned by Wells/Sarah (§11), not a display
> nicety. **In the mock the demo census does not actually add this child** — a hand-authored inconsistency;
> the build's derived census will (see §12).

---

## 5. Census-preview (`.census-preview`) — the 6×2 auto-fill grid · **cross-module hook to GOV-8/9**

`bg-surface border border-border rounded-xl px-5.5 py-4.5`, below the hero, above the register.

### 5.1 Header row (`.top`)
- **Icon** (`.ic`): `28px` rounded square, `bg-green-bg text-green font-display font-bold`, glyph **`G`**
  (GES). Green — the "this connects to the statutory return" colour, distinct from the gold privacy `!`.
- **Heading** (`.heading`, `font-display 15px 600`): **`Auto-fills the GES annual census special needs
  section`** with italic gold `<em>` on **`special needs`**.
- **Meta** (`.meta`, `text-[11px] text-navy-3`), verbatim:
  > 12 hatched manual fields → counts derived from this register · **updated as you add records** · privacy
  > preserved (no names exported)

  Bold span (`.meta b`): **`updated as you add records`**.
- **Top-tag** (`.top-tag`, right, `bg-green-bg text-green text-[9px] uppercase tracking-[0.06em] font-bold
  rounded-pill px-2.5 py-1`): **`✓ Auto · 12 of 12 cells`**.

### 5.2 The grid (`.census-grid`, `grid-cols-[repeat(6,1fr)]` gap-2 → renders as **6 columns × 2 rows**)
Each `.census-cell` = `bg-bg border border-border rounded-md px-2.5 py-2`: `.cl` label (`text-[8px] uppercase
tracking-[0.1em] text-navy-3 font-bold`) over `.cv` count (**`font-mono 14px 700 text-navy`**).

**DOM order is category-major (boys then girls), 12 cells, verbatim label · count:**

| # | `.cl` | `.cv` | | # | `.cl` | `.cv` |
|---|---|---|---|---|---|---|
| 1 | `Visual · boys` | `2` | | 7 | `Intellectual · boys` | `1` |
| 2 | `Visual · girls` | `1` | | 8 | `Intellectual · girls` | `0` |
| 3 | `Hearing · boys` | `1` | | 9 | `Speech · boys` | `0` |
| 4 | `Hearing · girls` | `0` | | 10 | `Speech · girls` | `1` |
| 5 | `Physical · boys` | `1` | | 11 | `Other · boys` | `0` |
| 6 | `Physical · girls` | `1` | | 12 | `Other · girls` | `0` |

Row 1 (cols 1–6) = Visual·b, Visual·g, Hearing·b, Hearing·g, Physical·b, Physical·g. Row 2 (cols 7–12) =
Intellectual·b, Intellectual·g, Speech·b, Speech·g, Other·b, Other·g. Sum = **8** (matches the register).

> **Six census categories, not five.** The census grid has a **sixth bucket — `Other`** (2 zero cells here) —
> that the register's tags and filters (§6, §8) **do not surface**. The GES census defines 6 special-needs
> categories × 2 genders = 12 hatched fields; the operational register uses 5 named categories (no student is
> `Other` in the demo). Build the category enum as **6 for census aggregation** (Visual/Hearing/Physical/
> Intellectual/Speech/**Other**), with 5 exposed as filter pills + coloured tags and `Other` reachable only via
> the record form. Flagged in §12.

> **CROSS-MODULE HOOK (design commitment — preserve):** this grid **IS** the SEN section of the GES annual
> census. Its 12 cells are the live aggregate that GOV-8's census generation drawer consumes: recording here
> flips a **hatched manual census field** to **auto-filled** (the `.status-tag.ready` / auto tag in
> `gov8-census-drawer-design.md`). "no names exported" = the export is **counts only**; student-level data
> never leaves the school instance. This is the SEN-register→census arm, analogous to score-ledger→STPSHS and
> salary→GOV-7-arm. **In the build the "12 of 12" and every cell count are COMPUTED from the register +
> consent state at read time** (Wells/Kofi), not the static markup here.

---

## 6. Region head + filter pills

### 6.1 Region head (`.region-head`, HTML 282)
- `.num` `01` (`font-display italic 18px text-gold`) · **`<h2 class="font-display">Student register</h2>`**
  with italic gold `<em>` on **`register`** · `.meta` (right, `text-navy-3 italic 11px`):
  **`Click any row for full record · accommodations · diagnosis & consent files`**.

### 6.2 Filter pills (`.filter-row`) — one per named category + All
`.filter-pill` = `bg-surface border border-border rounded-pill px-3.5 py-2 text-[11px] font-semibold
text-navy-2`; count = `.count` `font-mono 10px 700 opacity-60`. **Active** = `bg-navy text-bg border-navy`
(count `opacity-85`).

| Pill (verbatim) | `.count` | State |
|---|---|---|
| `All` | `8` | **active** (demo default) |
| `Visual` | `3` | inactive |
| `Hearing` | `1` | inactive |
| `Physical` | `2` | inactive |
| `Intellectual` | `1` | inactive |
| `Speech` | `1` | inactive |

Counts sum 3+1+2+1+1 = 8 = `All`. **No `Other` pill** (see §5.2 note). Filter is a single-select category
facet over the register table (§7); selecting a category narrows the rows and moves the `active` state.
Counts are **derived per category** in the build.

---

## 7. Student register table (`.student-card` → `.student-table`) — THE CORE

White card, `border border-border rounded-xl overflow-hidden`. `border-collapse`. **Row hover** =
`bg-bg cursor-pointer` → opens the **full record** (accommodations · diagnosis · consent files; region-head
meta line). The full-record drawer/page is referenced but **not drawn on this surface** — see §12.

### 7.1 Columns (`thead th`, `bg-bg border-b border-border text-[9px] uppercase tracking-[0.14em] text-navy-3
font-bold`, left-aligned)
`Student` · `Category` · `Severity` · `Support & accommodations` · `Diagnosis & consent`.

### 7.2 Cell anatomy
- **Student** (`.student-name-cell`, grid `36px 1fr`): `.student-av` = `32px` circle `bg-gold-bg text-navy
  font-display 11px` initials, then `.student-name` (`font-semibold text-navy 13px`) + `.meta` block
  (`text-[10px] text-navy-3 italic`, format **`{class} · {sex} · age {n}`**).
- **Category** = `.category-tag.{cat}` pill (§8.1).
- **Severity** = `.severity-tag.{level}` pill (§8.2).
- **Support & accommodations** (`.support-cell`, `text-[11px] text-navy-2 leading-[1.45]`): a plain-English
  description sentence (bold key phrase = `.support-cell b` → `text-navy`) followed by `.accom-tag`s (§8.3).
- **Diagnosis & consent** (`.diag-cell`, `text-[11px] text-navy-2`): the source-of-determination line +
  `.diag-by` sub (`text-[10px] text-navy-3 italic`) carrying clinic/year + **`consent on file`** (bold). A
  formal row bolds **`Diagnosed`**; an observed row shows **`Diagnosis pending`** in `.pending` (`text-warn
  font-semibold`).

### 7.3 The 8 rows (exhaustive, verbatim — this is the demo dataset; DO NOT ship it, see §12)

| # | Av | Name | Class · sex · age | Category | Severity | Support sentence | Accom-tags | Diagnosis main | `.diag-by` |
|---|---|---|---|---|---|---|---|---|---|
| 1 | KA | Kwame Antwi | JHS 3A · boy · age 14 | Visual | Mild | Wears prescription glasses · seated front row | Front-row seating · Larger print | **Diagnosed** by ophthalmologist | Dr. Asare Eye Clinic · 2022 · **consent on file** |
| 2 | AO | Akua Owusu-Ampofo | JHS 3B · girl · age 14 | Visual | Mild | Glasses for reading | Front-row seating | **Diagnosed** by optometrist | UGMC · 2024 · **consent on file** |
| 3 | SM | Stephen Mensah | JHS 1A · boy · age 12 | Visual | Moderate | Suspected vision issue · referred for assessment | Front-row seating · Reading buddy | Observed by class teacher | **Diagnosis pending** · **consent on file** |
| 4 | YA | Yaw Amponsah | JHS 2A · boy · age 13 | Hearing | Mild | Mild hearing loss in left ear | Right side of class · Visual cues during instruction | **Diagnosed** by audiologist | Korle Bu ENT · 2023 · **consent on file** |
| 5 | EA | Esi Asante | JHS 3C · girl · age 14 | Physical | Moderate | Walks with crutches after polio | Ground-floor classroom · Extra time between periods | **Diagnosed** at infancy | Long-standing condition · **consent on file** |
| 6 | KO | Kofi Okine | JHS 1C · boy · age 12 | Physical | Mild | Limited fine motor control · right hand | Extended writing time · Oral assessment option | Observed since enrolment | **Diagnosis pending** · **consent on file** |
| 7 | FK | Faith Kwakye | JHS 2B · girl · age 13 | Speech | Mild | Stammer · receives weekly speech therapy | Patience during oral answers · No forced public reading | Speech & language therapist | Private practice · 2024 · **consent on file** |
| 8 | SA | Samuel Addo | JHS 1B · boy · age 13 | Intellectual | Moderate | Significant learning gap · individualised plan | Modified curriculum · Smaller-group instruction · Extra exam time | Educational psychologist | Accra Psychology Centre · 2023 · **consent on file** |

**Formal-vs-observed pattern (the honest-reporting affordance, notes line 395):** rows 1,2,4,5,7,8 are
clinician-sourced (formal); rows 3,6 are teacher-observed with **`Diagnosis pending`** in warn. The system
records **operational support needs**, and marks a *formal diagnosis* only when a **qualified clinician**
supplied it — parents/reviewers can see what is clinical vs school-observed.

**Consent on every row (notes line 396):** every visible row carries **`consent on file`** because
**consent is enforced before record creation — if consent isn't on file, the record doesn't exist.** The
pending-consent family (hero tile 4) has NO row here; it lives in the census aggregate only. This is the
sole-content-path/redaction shape (cf. VLC pastoral) — a build invariant, not markup (§11).

**Ghanaian clinical realism (notes line 397) — keep verbatim, it is the product voice:** Dr. Asare Eye
Clinic · UGMC (University of Ghana Medical Centre) · Korle Bu ENT · Accra Psychology Centre. Plain-English
condition descriptions ("Walks with crutches after polio", "Stammer", "Limited fine motor control") over
clinical jargon (notes line 398).

---

## 8. Vocabularies + token mapping (category · severity · accom · diagnosis)

### 8.1 Category tags (`.category-tag.{cat}`, `rounded-pill px-2.5 py-[3px] text-[10px] uppercase
tracking-[0.04em] font-bold`)

| Category | Surface bg / text | Tailwind | Token status |
|---|---|---|---|
| `visual` | `--gold-bg` / `--gold` | `bg-gold-bg text-gold` | ✅ token |
| `hearing` | `--green-bg` / `--green` | `bg-green-bg text-green` | ✅ token |
| `physical` | `--terra-bg` / `--terra` | `bg-terra-bg text-terra` | ✅ token |
| **`intellectual`** | **`#E8E5F2` / `#5847B5`** | **NO TOKEN — must be added** | ❌ **see below** |
| `speech` | `--warn-bg` / `--warn` | `bg-warn-bg text-warn` | ✅ token |
| (`Other` — census only) | — | — (no tag; census bucket only) | n/a |

> **INTELLECTUAL = no brand token — flag it exactly like the chronic-condition pills (INCR-23a).** The purple
> pair `#E8E5F2` (bg) / `#5847B5` (text) is **absent from `design-tokens.json` / `tokens.css`**. It is a
> **solid pill** (no alpha), so there is **no slash-opacity trap** — but per the tokens.css INCR-23a rule
> ("Named, never inlined as a raw hex in a className") and the `no-alpha-token-opacity` convention, it must be
> a **named token**, not `className="bg-[#E8E5F2] text-[#5847B5]"`. **Recommended (mirror the `--condition-*`
> precedent):**
> ```css
> /* tokens.css :root — SEN intellectual category pill (GOV-10) — no brand token, same treatment as chronic pills */
> --sen-intellectual:    #5847B5;
> --sen-intellectual-bg: #E8E5F2;
> ```
> ```ts
> // tailwind.config.ts colors — alongside condition-epilepsy / condition-diabetes
> "sen-intellectual": { DEFAULT: "var(--sen-intellectual)", bg: "var(--sen-intellectual-bg)" },
> ```
> → class `bg-sen-intellectual-bg text-sen-intellectual`. **Do NOT reuse `--condition-epilepsy` (`#7b4a8a`)** —
> it is a different purple; the two must not be conflated. This token addition is the ONE sanctioned palette
> extension for this surface; everything else stays on existing tokens.

### 8.2 Severity tags (`.severity-tag.{level}`, `rounded-pill px-[7px] py-[2px] text-[9px] tracking-[0.04em]
font-bold`)

| Level | Surface | Tailwind | Token |
|---|---|---|---|
| `mild` | `--green-bg` / `--green` | `bg-green-bg text-green` | ✅ |
| `moderate` | `--warn-bg` / `--warn` | `bg-warn-bg text-warn` | ✅ |
| `severe` | `--terra-bg` / `--terra` | `bg-terra-bg text-terra` | ✅ |

3-tier, green→warn→terra (mild→moderate→severe). **Operationally meaningful without clinical assessment**
(notes 393) — a teacher can describe severity without diagnosing. `severe` has **no demo row** but the class
exists; render it.

### 8.3 Accommodation tags (`.accom-tag`)
`inline-block bg-bg text-navy-3 border border-border rounded-[4px] px-1.5 py-[2px] text-[9px] font-semibold`
(margins `mr-[3px] mt-[3px]`). Neutral, uncoloured — deliberately not a status. Full observed vocabulary from
the demo (notes 394), all concrete/actionable: `Front-row seating` · `Larger print` · `Reading buddy` ·
`Right side of class` · `Visual cues during instruction` · `Ground-floor classroom` · `Extra time between
periods` · `Extended writing time` · `Oral assessment option` · `Modified curriculum` · `Smaller-group
instruction` · `Extra exam time` · `Patience during oral answers` · `No forced public reading`. Build as a
free/repeatable tag set per record, not a fixed enum.

### 8.4 Diagnosis cell (`.diag-cell`) sub-states
- Main line `text-navy-2 11px`; **`Diagnosed`** bold when clinician-sourced (`.diag-cell b`).
- `.diag-by` = `text-[10px] text-navy-3 italic`; its bold (`consent on file`, clinic name) → `text-navy-2
  font-semibold not-italic`.
- **`.pending`** (`text-warn font-semibold`) renders **`Diagnosis pending`** for teacher-observed rows.

---

## 9. Interaction / honest-empty states (exhaustive)

| State | Trigger | Visual / copy |
|---|---|---|
| **Module not adopted (opt-in off)** | school has not enabled student-level recording | Honest-empty per privacy-banner point 4: a dashed `EmptyState` (tone="muted") explaining the module is **opt-in** and the census section can be **completed by hand**; CTA `+ Record support need` to adopt. Do NOT auto-populate. |
| **Zero records (adopted, none yet)** | module on, 0 students recorded | Hero shows `0 of {enrolment}`; census grid all `0` with `✓ Auto · 12 of 12 cells` (a zero census is still "auto" and complete); register table → dashed empty card "No support needs recorded yet." Filter pills all `0`. |
| **Pending-consent-in-aggregate-only** | consent not on file for a family | child counted in §5 census cells + hero tile 4 (`N families`), **never rendered as a §7 row**. Redaction invariant (§11). |
| **Filter active** | click a category pill | that pill → `bg-navy text-bg`; `All` → inactive; table narrows to the category; `.count`s unchanged (they show totals, not filtered counts). |
| **Row → full record** | hover (`bg-bg cursor-pointer`) + click | opens full record (accommodations · diagnosis · consent files). Drawer/page not on this surface — §12. |
| **Category tag / severity / diag** | data-driven | per §8 vocab; `severe` + `Other` render if present though absent from demo. |
| **Loading** | data fetch | not specified on the surface; reuse the module's standard skeleton — the banner (§3) should render immediately (it is static policy copy, not data-dependent). |
| **Export anonymised stats** | click `.btn` | produces counts-only export (no PII) — behaviour, not a drawn state (§11, Wells/Sarah). |

**Responsive/PWA:** the surface defines one breakpoint (`@media max-width:1280px`, line 149) affecting only the
**outer design-doc layout** (`.layout` → 1 col) and the **hero-row → 2 col** / **census-grid → 3 col** reflow.
No dedicated PWA surface exists for GOV-10; the register table should go horizontally scrollable (sticky-left
Student column, per the gradebook `overflow-x-auto` idiom) at narrow widths. Flag to PO if a phone card-view is
wanted (none is designed).

---

## 10. Cross-module hooks (design commitments — preserve in the build)

| Hook | Where on this surface | Commitment |
|---|---|---|
| **SEN register → GES annual census (GOV-8/9)** | §5 census-preview 6×2 grid; `✓ Auto · 12 of 12 cells`; "no names exported" | The 12 cells ARE the census SEN section's live aggregate. Recording flips a hatched manual field to auto-filled in GOV-8's drawer. Counts-only, never names. |
| **Consent state → record existence** | §7 every row `consent on file`; hero tile 4 | Consent is the gate: no consent → no student-level row; child appears in census aggregate only. |
| **Anonymised export → external/GES stats** | header `Export anonymised stats →` | Aggregate, no PII. Same "counts not names" guarantee as the census arm. |
| **Admin-only + teacher-grant** | privacy banner; lede `admin-only access` | Teachers see nothing unless an admin grants access for accommodation planning — an authz relationship, not a global role flip. |

**Deliberate non-scope (notes line 399 — do NOT let the build creep past it):** no detailed clinical history,
no medication tracking, no behavioural incident logs, no IEP authoring. This is a **census-level fact +
practical accommodation** register, **not an SEN platform**.

---

## 11. Where the BUILD necessarily differs from the static mock (owner-flagged)

Design owns the *visual grammar, copy, tokens, layout*. The following are **not design** — they are logic/data/
security the mock only gestures at, and they are load-bearing (the surface's entire privacy premise fails
without them):

| Mock shows (static) | Build reality | Owner (not design) |
|---|---|---|
| Banner says "visible only to administrators … unless an admin grants access"; lede `admin-only access` | **Real RBAC route + read gate**: admin-only by default, per-teacher accommodation-planning grant as an explicit authz relationship. Gate the gate against this spec (cf. `builds-widen-ratified-authz`). | **Kofi** (authz/RBAC) |
| Every row `consent on file`; "if consent isn't on file the record doesn't exist" | **Consent enforced as a precondition of INSERT** — the server action rejects a record with no consent artefact; consent is modelled in the schema. Sole-content-path (mutation-proven) so no code path writes a SEN record without consent. | **Wells** (schema + server action) · **Sarah** (security fence / can't-bypass review) |
| Hero tile 4 "1 family · in census aggregate without student detail" | **Aggregate query counts consent-pending children WITHOUT exposing student rows** — a redaction invariant (cf. VLC pastoral `sole-content-path`). Mock does not actually add the child to its census (§12). | **Wells** (aggregate) · **Sarah** (redaction invariant) |
| Census `✓ Auto · 12 of 12`, every cell count, hero splits, filter counts | **All DERIVED at read time** from the register + consent state; feeds the GOV-8 census arm. None hard-coded. | **Wells** (rollup) · **Kofi** (census-arm wiring) |
| `Export anonymised stats →` | **Counts-only export, no PII** — Sarah verifies the no-name guarantee before it ships. | **Wells** (export) · **Sarah** (PII review) |
| The Basic JHS app shell + `students/special-needs` route | **Shell/nav home is a routing decision** — mount under the operational (governance/census) shell; keep the register body 1:1. | **Kofi** (routing) |

Design deliverable stops at: the banner-first ordering, the copy verbatim, the token map (incl. the
`--sen-intellectual` addition, §8.1), the 6×2 census layout, the 5-tag/3-severity vocabulary, the table
anatomy, and the honest-empty states.

---

## 12. Drift log / mock-data caveats (do NOT ship the demo numbers)

The mock's counts are hand-authored and have **three internal mismatches** — proof they are illustrative, not
truth. The build derives every count, so it will be self-consistent. Flagged so the implementer does not treat
the markup as fixtures:

1. **Formal-vs-observed split.** Hero: "**3 with formal diagnosis**, 5 with informal/observed need." Table:
   **6 clinician-sourced** (rows 1,2,4,5,7,8) + **2 observed/pending** (rows 3,6). 3/5 ≠ 6/2. Derive from the
   `diagnosis_source` field.
2. **Pending-consent not in the census.** Hero tile 4 says the pending family sits "in census aggregate
   without student detail", but the demo census sums to **8** = exactly the 8 visible rows, adding no 9th.
   The derived census must add consent-pending children to the aggregate (only) — that IS the invariant (§11).
3. **Year-group split.** Tile 2 sub: "JHS 1: 3 · JHS 2: 3 · JHS 3: 2." Table: JHS 1 = 3 (rows 3,6,8), JHS 2 =
   **2** (rows 4,7), JHS 3 = **3** (rows 1,2,5). Actual is 3/2/3, not 3/3/2. Derived.

Additional open items:

4. **Six census categories vs five register categories.** Census grid has an **`Other`** bucket (§5.2); tags +
   filters do not. Build the enum with 6 (Other reachable via the record form), surface 5. Confirm with PO the
   `Other` label matches the GES census wording.
5. **Full-record view is referenced, not drawn.** Region-head + row-hover promise a full record
   (accommodations · diagnosis · consent files). No such drawer/page exists in this surface — needs its own map
   before build (or PO confirms the row expands inline).
6. **`+ Record support need` form is not on this surface.** The create flow (which must capture consent up
   front, §11) has no mock here. Flag: needs a companion surface/spec — it is the enforcement point for the
   consent invariant, so it cannot be improvised.
7. **`--sen-intellectual` token addition** (§8.1) touches `tokens.css` + `tailwind.config.ts` — a shared token
   file. Coordinate so it lands once (alongside the INCR-23a `--condition-*` block), not inlined per component.

---

*Map produced against: `Surfaces/schoolup-special-needs.html` (goofy-poitras worktree, full read); live
`styles/tokens.css` + `tailwind.config.ts` (senior-live); shape per `docs/senior/ledger-surface-map.md` §0 and
`docs/governance/gov8-census-drawer-design.md`; no-token pill precedent per `docs/senior/
sickbay-chronic-register-surface-map.md` + tokens.css INCR-23a. No app code was modified.*
