# GOV-9 — Annual GES census DOCUMENT + signed print-and-sign PDF — Surface Map

**Author:** Lucy (design cartographer) · **Status:** design spec, ready for the implementation engineer.
**Scope:** the **full annual census DOCUMENT** and its **signed, print-and-sign PDF** — the artefact produced
when a Headmaster/Admin clicks `Generate PDF →` in the census drawer at **annual** cadence. This maps the
RIGHT half of `Surfaces/schoolup-annual-census.html` (**§02 "PDF preview · 10 pages"**, markup lines
1680–2587, CSS 536–1320, notes 2588–2623).

> **What GOV-8 already owns (do not re-map):** the **generation drawer** (year selector, identification
> preview, auto-fill % band, the A–E checklist, output card, foot) is mapped in
> `docs/governance/gov8-census-drawer-design.md` and **built** (`components/reports/census/census-drawer.tsx`,
> `lib/reports/census/view.ts`). That drawer is already **cadence-parameterised** — at `?cadence=annual` it
> renders the full field set with **nothing greyed**. **GOV-9 is therefore NOT the drawer; it is (a) the
> full annual DOCUMENT the drawer generates and (b) the signed PDF rendered from it.** This map focuses on
> those two net-new artefacts.

> **The one thing that must not be missed:** this is a **print-and-SIGN** document. The mock renders a
> *simulated* headteacher signature (`.sig-mark`, italic "Florence Addo") to show the layout. **The real PDF
> must leave the signature line BLANK for a pen** — auto-rendering a signature would forge a certification.
> Same honest-absence rule that governs the data cells governs the signature: **never fabricate what a human
> must supply.**

---

## Source (verified first-hand)

| Source | Role in this map |
|---|---|
| `Surfaces/schoolup-annual-census.html` §02 "PDF preview" (markup 1680–2587; CSS 536–1320; notes 2588–2623) | **PRIMARY visual + copy source** for every page, table, hatched block, the §5 grid, and the declaration. Untracked — goofy-poitras worktree only. |
| `lib/reports/census/generate.ts` (built) | The annual snapshot GENERATOR — the **real auto values** per section, with frozen coverage tags. Supersedes every static tag in the mock (§10). |
| `lib/reports/census/view.ts` + `schema.ts` (built) | The A–E row registry (`CENSUS_ROWS`), the `CensusCoverage` = `FULL/PARTIAL/NONE/NOT_APPLICABLE` contract, the annual field set. |
| `lib/reports/census/sen-data.ts` + `lib/sen/vocab.ts` (built) | **§5 SEN 12-cell grid** — the de-identified `getCensusSpecialNeeds` (category×sex counts only) + the 6 category labels/order. GOV-10. |
| `db/schema/census-return.ts` (built, migration 0081 / prod-paste-0087) | The persisted filing: `status DRAFT\|COMPLETED`, `auto_snapshot` jsonb, `hand_fill` jsonb, `census_date`, `generated_by`. The DRAFT/COMPLETED lock (§8). |
| `lib/pdf/board-pack-document.tsx` + `render-board-pack.tsx` + `app/(board)/board/board-pack/route.ts` + `docs/governance/gov5-board-pack-pdf-design.md` | **The sibling PDF pattern GOV-9 copies:** `@react-pdf/renderer` `<Document>/<Page>` + `StyleSheet` hex-from-tokens + `lib/pdf/fonts` + a streaming `route.ts`. The render target is react-pdf, **NOT Tailwind** (§0). |
| `styles/tokens.css` + `tailwind.config.ts` + the surface `:root` (11–31) | Canonical tokens. All surface tokens resolve (§9). |
| `docs/governance/gov10-sen-register-surface-map.md` §5 | The §5 census-preview 6×2 grid mapping (DOM order, `✓ Auto · 12 of 12 cells`) — the cross-module hook GOV-9 renders in the PDF. |

> **Referenced-not-present (pre-implementation seams):** the census DOCUMENT view page and the PDF route
> (`lib/pdf/census-document.tsx`, `render-census.tsx`, `app/api/reports/statutory/census/[id]/route.ts`) do
> **not yet exist** — they are GOV-9's net-new build. I map them to the surface + the sibling GOV-5 pattern;
> the engineer wires them.

---

## 0. The render target — react-pdf, NOT Tailwind (read before the token tables)

The GOV-8 drawer is React DOM + Tailwind. **The GOV-9 PDF is `@react-pdf/renderer`** (installed, v4.5.1,
running the vendored React 19 — memory `react-pdf-next15-vendored-react`). That changes the whole token story:

- **No Tailwind classes in the PDF.** Styling is `StyleSheet.create({...})` with **raw hex constants mapped
  from the tokens**, exactly as `board-pack-document.tsx` lines 36–63 does (`const NAVY = "#1A2B47"` …).
  My token tables below give the surface class → the StyleSheet property + hex, not a Tailwind class.
- **The token-opacity trap does NOT bite the PDF.** react-pdf accepts `rgba()` directly, so the surface's
  `rgba(184,74,57,0.06)` stamp fill, `rgba(217,211,194,0.4)` hatch, and `rgba(229,223,211,0.3)` subtotal
  render verbatim as `backgroundColor: "rgba(...)"`. **The trap only returns if any on-screen document
  PREVIEW is built in Tailwind DOM** (§8) — there, use solid/tint tokens, never `bg-terra/6`.
- **Fonts:** reuse `lib/pdf/fonts` (`SERIF`/`SANS`/`MONO`). GOV-5's note "core PDF fonts stand in for the
  brand faces" applies — Fraunces/Manrope/JetBrains Mono are registered there or substituted once, centrally.
  Every `font-family:'Fraunces'` in the surface → `fontFamily: SERIF`; `'Manrope'`/default → `SANS`;
  `'JetBrains Mono'` → `MONO`.
- **A4 portrait, `<Page size="A4">`.** The surface renders 760px-wide screen pages on a grey desk
  (`.preview-stage`, `#E8E1D2→#DDD5C2` gradient) — that desk is **mock chrome, not the document** (§9).
- **The document branches on `arm.coverage` HERE**, exactly like the board pack branches on `arm.status`:
  reading `arm.data` on a non-`FULL/PARTIAL` arm is a compile error (`schema.ts` `CensusArm<T>` discriminated
  union). That compile-fence is what stops a fabricated figure reaching the paper (§2).

---

## 1. Net-new surface inventory (what GOV-9 builds)

| Artefact | File (net-new) | Sibling to copy |
|---|---|---|
| The census **PDF document** | `lib/pdf/census-document.tsx` | `lib/pdf/board-pack-document.tsx` |
| The **PDF renderer** (stream/buffer) | `lib/pdf/render-census.tsx` | `lib/pdf/render-board-pack.tsx` |
| The **download route** | `app/api/reports/statutory/census/[id]/route.ts` | `app/(board)/board/board-pack/route.ts` |
| The **hand-fill merge** (auto_snapshot ⊕ hand_fill → doc props) | in `render-census.tsx` / a `lib/reports/census/document.ts` | `lib/pdf/board-pack-parts.ts` |
| The DRAFT/COMPLETED **lock + download affordance** UI | on the statutory document page | GOV-8 drawer foot |

The **annual DRAWER checklist** is NOT net-new — it is the built GOV-8 drawer at `cadence=ANNUAL`
(`computeCensusView(snapshot, "ANNUAL")`), all A–E rows in-scope, nothing greyed. GOV-9 consumes the SAME
frozen `auto_snapshot` the drawer displays, so a drawer row and its PDF section can never disagree (§2).

---

## 2. The coverage → cell contract (auto value vs hatched blank) — the spine

The seam GOV-8 §11 promised. Every PDF cell/section is one arm's `coverage` rendered as either a **real
auto value** or a **hatched hand-fill blank**. **One source** (`snapshot.sections[key].coverage`) drives both
the drawer tag and the PDF cell:

| `coverage` | PDF renders | Visual grammar (surface class) |
|---|---|---|
| `FULL` | the **real auto value** from `arm.data` | plain table cell; `.auto-cell` green-dot on the anchor number |
| `PARTIAL` | captured cells filled, the rest **hatched blank** | mixed — `.staff-table td.manual-col` hatch on the empty cells |
| `NONE` | **hatched hand-fill block** carrying `arm.reason` as the prompt | `.manual-fill` (dashed, 45° hatch, `!` warn icon) |
| `NOT_APPLICABLE` | the section is **omitted or NA-noted**, never zero-filled (e.g. a JHS runs no WASSCE) | — |

**The honest-absence invariant (never a fabricated 0):** a source that isn't there renders a **hatched
blank**, never a zero and never a guessed value. `generate.ts` freezes this per section — e.g. age cells for
students with no DOB "stay blank, never guessed" (line 118); a not-adopted SEN register is `NONE` "never a
fabricated zeros payload" (line 78); `circuit` is structurally `null` → always a hatched blank (line 67).

---

## 3. The annual document, page by page (copy verbatim; auto vs hand marked)

The mock is **10 pages / 13 numbered sections**. **The page count is dynamic in the build** — an adopted-SEN
grid is compact, an un-captured facilities section expands to hatched forms, etc. Do NOT hard-code "10" /
"Page X of 10"; the drawer output card already computes `{n} pages` (GOV-8 §3.5). Section NUMBERS (1–13) are
the GES form's and are stable; render them.

### Shared page chrome (every content page, 2–10)

| Region | Copy (verbatim) | Tokens → StyleSheet | Build note |
|---|---|---|---|
| `.pdf-page-band` (navy strip) | `crest-mini` = school initials · `.school` = **school name** · `.return-type` = **`Annual Census {year}`** · `.ges-id` = **`GES {code}`** | `backgroundColor: NAVY`, text `BG`; crest `bg GOLD text NAVY`; return-type `GOLD_SOFT` uppercase; ges-id `MONO GOLD` | year + code + name from `identification`. Demo: `Annual Census 2025/26` · `GES 4-2305-018` |
| `.pdf-foot-band` | `footer-pre` **`{initials} · GES Census`** · `footer-mid` **`{school} · GES {code}`** · `powered` **`Generated by `**`<em>Omnischools</em>`** | `bg BG`, top border `PAPER_LINE`; pre/mid-span `MONO NAVY2`; powered em `SERIF italic GOLD` | Omnischools brand line stays (surface note: it's the provenance mark, not a submission channel). |
| `.pdf-page-num` | **`Page {n} of {total}`** (n `MONO`) | `SERIF italic NAVY3`, `span MONO` | `{total}` = computed page count. |

### PAGE 1 — Cover (`.pdf-page` › `.pdf-cover`)

| Element | Copy (verbatim) | Tokens → StyleSheet | Auto/build |
|---|---|---|---|
| `.pdf-ges-band` | `crest`=`G` · **`Republic of Ghana · Ministry of Education`** · `<em>Ghana Education Service</em>` | `bg NAVY`, text `GOLD_SOFT` 9px .18em upper; crest `bg GOLD text NAVY`; em `SERIF italic GOLD` | static GES chrome (constant copy) |
| `.ges-line` | **`Annual School Census`** | `NAVY2` 11px .22em upper 700 | constant |
| `h1` | **`Annual `**`<em>Census</em>` | `SERIF 36px 500`; em `italic GOLD 400` | constant |
| `.academic-year` | **`Academic year {year}`** | `SERIF 17px italic NAVY3 500` | `snapshot.academicYear` (demo `2025/26`) |
| `.crest-block` | school initials `CK` | `70px bg NAVY text GOLD SERIF 26px` | derived initials |
| `.school-name` | **`{School} `**`<em>{suffix}</em>` (demo `Christ the King ` `JHS`) | `SERIF 26px 500`; em `italic GOLD` | `identification.schoolName` |
| `.school-tagline` | **`{type} · {circuit} Circuit · GES School ID `**`<span class="mono">{code}</span>` (demo `Junior High School · Korle Klottey Circuit · GES School ID 4-2305-018`) | `NAVY3 11px`; mono `MONO NAVY2 600` | **circuit is `null` (never stored)** → drop the "· {circuit} Circuit" fragment rather than print an empty one (§10 drift #1) |
| `.cover-stats` (4-up) | `Enrolment` **312** `students` · `Teaching staff` **14** `8 male · 6 female` · `Attendance rate` **93.5%** `last full term` · `Established` **1962** `63 years` | grid `bg SURFACE border PAPER_LINE`; `.lbl` 8px upper `NAVY3`; `.val` `SERIF 22px 600`; `.val.gold` `italic GOLD`; `.meta` 9px italic `NAVY3` | **enrolment** ← `enrolment.roll` (FULL); **teaching** ← `teachingStaff.data` count+sex; **attendance** ← `attendance` arm — **if `NONE`, show `—`, never a % (honest-absence on the cover)**; **established/age** ← `yearFounded`, `null` → `—` |
| `.cover-foot` | **`Filed by {head} · {title}`** · `.filed` **`Census window {open} — {close}`** | `NAVY3 10px`, top dashed `PAPER_LINE`; filed `MONO 600` | head name from identification; **census-window dates are NOT stored → omit the window line unless a field exists** (§10 drift #2) |

### PAGE 2 — §1 Identification + §2 Enrolment

**§1 School identification** — head: `num` **1** · `title` **`School identification`** · `source`
**`from school settings`**. `.pdf-id-grid` (2-col, 8 cells):

| `.lbl` | `.val` (demo) | Build source |
|---|---|---|
| `School name` | `Christ the King JHS` | `identification.schoolName` |
| `GES School ID` | `4-2305-018` (`.mono`) | `identification.gesCode` |
| `School type` | `Junior High School · public` | `schoolType` + `ownership` (ownership `null` → drop `· {ownership}`) |
| `Year established` | `1962` (`.mono`) | `yearFounded`, `null` → hatched blank |
| `District` | `Accra Metropolitan` | `identification.district`, `null` → `—` |
| `Circuit` | `Korle Klottey` | **always `null` → hatched blank** |
| `Region` | `Greater Accra` | `identification.region`, `null` → `—` |
| `Headteacher` | `Florence Addo` | school head (annual-only field; the mid-year id grid omits it) |

Tokens: `.pdf-id-cell` `border PAPER_LINE`; `.lbl` 8px upper `NAVY3` 700; `.val` `SERIF 13px 600`; `.val.mono`
`MONO 12px`.

**§2 Enrolment by class & gender** — head: `num` **2** · title **`Enrolment by class & gender`** · source
**`from student records · as of {censusDate}`** (demo `as of 22 Oct`). `.pdf-table`, columns
**`Class · Boys · Girls · Total · Last yr · Δ`**, `.auto-cell` green-dot on **Total**; per-year `.subtotal`
rows (`JHS 1 total` …); `.total` **`School total`**. Δ colours: `+` `GREEN`, `−` `TERRA`, no-change `—`
`NAVY3`.

- **Build (FULL when roll>0):** `enrolment.byClass` (sex split per class) + `enrolment.roll` + `gender`.
- **`Last yr` / `Δ` divergence (flag):** the enrolment arm is **current-roll only** — there is no prior-year
  frozen roll to diff against. **Either omit the `Last yr`/`Δ` columns for v1, or hand-fill them.** Do NOT
  fabricate a prior-year figure (§10 drift #3). The mock's `+5` etc. are demo.
- Table tokens: `thead th` `bg BG border PAPER_LINE` 9px upper 700; `td.num` `MONO NAVY 600`;
  `.total` `bg BG bold NAVY`; `.subtotal` `bg rgba(229,223,211,0.3) 600`.

### PAGE 3 — §3 Age distribution + §4 Repetition

**§3 Age distribution by class** — head: `num` **3** · **`Age distribution by class`** · source
**`computed from student dates of birth`**. `.pdf-table` cols
**`Class · Age 11 · Age 12 · Age 13 · Age 14 · Age 15 · Age 16 · Age 17+ · Total`**, `.auto-cell` on the
modal-age cell; `.total` `School total`. Body-text callout (verbatim, keep):
> *"Modal age for each year group falls within the GES expected range (12 for JHS 1, 13 for JHS 2, 14 for
> JHS 3). **Over-aged students** (above 15 in JHS 3): **6 students** · these are typically late starters or
> repeaters."*

- **Build:** age arm — `FULL` when all have DOB; `PARTIAL` when some DOBs missing (those age cells stay
  **blank, never guessed** — `generate.ts` 118–123); `NONE` when no DOBs → hatched. The over-aged callout is
  computed from the age buckets; keep the interpretive sentence (it is the deliberate GES-form voice).

**§4 Repetition & promotion** — head: `num` **4** · **`Repetition & promotion`** · source
**`from year-end records · {prevYear}`** (demo `2024/25`). `.pdf-table` cols
**`Class · End of yr · Promoted · Repeated · Withdrew · Repetition rate`**, `.auto-cell` on **Repeated**;
`.total` `All transitions`. Body-text (verbatim):
> *"Overall repetition rate of **4.6%** is within the GES national benchmark of 5%. Highest repetition in JHS
> 2 → JHS 3 transition (6.7%) reflects the rigour of preparation for BECE entry."*

- **Build — SUPERSESSION:** the mock shows this **auto** (green dots), but the repetition arm is **`HAND`**
  (`generate.ts` 160: *"Promotion history is not tracked in Omnischools — repeaters are hand-filled
  (annual)"*). **Render §4 as a hatched hand-fill table**, not auto. Keep the benchmark note as static form
  guidance (or drop until real figures exist — flag). This is one of the task's named annual hand sections.

### PAGE 4 — §5 Special needs (the 12-cell grid) + §6 Movement

**§5 Special needs enrolment** — head: `num` **5** · **`Special needs enrolment`** · source: **`from the SEN
register`** when adopted, else **`manual entry`**. **See §4 of this map for the full grid spec.** Two states:

- **Adopted (GOV-10 live) → AUTO 6×2 grid.** Render the **12 counts** + a confirmation pill (GOV-10 map:
  **`✓ Auto · 12 of 12 cells`**) in the `.auto-fill-block` grammar (green `✓`, `Auto` pill). **A captured
  zero is still `FULL`** ("a truth the school is entitled to state" — `generate.ts` 77) → all-`0` cells with
  the auto pill, NOT a hatched blank.
- **Not adopted → NONE, hatched.** Render the surface's exact `.manual-fill` + `.manual-fields-grid` block
  (12 hatched blanks), heading **`To be filled by hand`**. Prompt — **replace the mock's stale copy**
  (*"Omnischools does not yet capture special needs data; this section will be added in a future update"* is
  pre-GOV-10) with the real reason: *"SEN register not adopted — special-needs enrolment is hand-filled
  (annual). Enable the SEN register to auto-fill §5."* (`generate.ts` 80–83).

**§6 Movement during the year** — head: `num` **6** · **`Movement during the year`** · source
**`from admissions & withdrawals records`**. `.pdf-table` cols **`Movement type · Boys · Girls · Total`**,
`.auto-cell` on **Total**; rows: `Admissions (new enrolments)` · `Withdrawals · relocation` · `Withdrawals ·
financial` · `Withdrawals · other` · `Transfers in (from other schools)` · `Transfers out (to other
schools)`; `.total` **`Net change`**.

- **Build — PARTIAL / SUPERSESSION (task: "full movement/exits" is a hand section):** the movement arm auto-
  fills **admissions-this-period × sex only** (`movement.admissionsThisPeriod`, `intakeMale`, `intakeFemale`
  — `generate.ts` 136–149). **Withdrawals (by reason) and transfers in/out are NOT tracked** → render those
  rows as **hatched blanks**; auto-fill only the Admissions row. `Net change` cannot total until the hand
  rows are filled → leave it hatched (never a fabricated net). The mock's fully-auto table is demo.

### PAGE 5 — §7 Teaching staff (mixed auto/manual columns)

Head: `num` **7** · **`Teaching staff`** · source **`from staff records · qualifications partial`**.
Body-text: **`{n} teaching staff total · {m} male, {f} female · qualifications fields with hatched background
need hand-fill against your school's records.`** `.pdf-table.staff-table` (10px), cols:
**`# · Name · Sex · Role · Qualification `**`<span class="inline-pill manual">Manual</span>`** ` · **`Salary `**`<span class="inline-pill manual">Manual</span>`**. Manual cells use `.manual-col` (45° hatch +
underline `.blank`). PTR body-text (verbatim, keep):
> *"**Pupil-teacher ratio:** 312 students ÷ 14 teachers = **22.3 to 1** · within GES recommended range for
> JHS (≤ 25:1)."*

- **Build:** the roster (`#`, Name, Sex, Role) auto-fills from `teachingStaff` (count+sex) — the per-teacher
  list is `census-staff-data`. PTR ← `ptr` arm (`1 : {ratio}`, single-sourced from the same teaching count so
  "14 teachers" and the PTR denominator can never disagree — `generate.ts` 185–194).
- **Qualification column — SUPERSESSION toward HAND:** the census GES field is a **trained/untrained split**,
  and `generate.ts` 196 marks `qualifications` **`HAND`** (*"Trained/untrained split is not yet captured on
  staff profiles — hand-fill (annual)"*). So render the Qualification column as **hatched hand-fill**
  (`Manual` pill stands). The mock's mixed per-teacher degrees (`B.Ed. English` …) are demo; do not invent
  degrees. (Task's "trained/untrained qualifications" hand section.)
- **Salary column — SUPERSESSION toward AUTO-when-captured:** the mock shows Salary all-`Manual`, but
  `salaryStatus` is **`AUTO_WHEN_CAPTURED`** — `FULL` when payroll runs (`{schoolPaid} school-paid ·
  {gesPaid} GES-paid · {allowance} allowance`), **`NOT_APPLICABLE`** when the school runs no payroll in
  Omnischools (`generate.ts` 201–204). The GES form asks **status, not amount** (privacy — surface note).
  When `FULL`, drop the `Manual` pill and fill the status; when `NA`, the column is hand or omitted.

### PAGES 6–7 — §8 Infrastructure & facilities (A–H)

Head (page 6): `num` **8** · **`Infrastructure & facilities`** · source **`manual entry · all sections`**;
`.manual-fill` heading **`To be filled by hand · entire section`**, prompt: *"Omnischools does not yet track
facilities. Walk through the school grounds and complete the fields below before signing the declaration.
**Tick boxes for status, write counts in the underlined fields.**"* Head (page 7, continued): `num` **8** ·
**`Infrastructure & facilities (continued)`** · source **`manual entry`**.

Eight sub-sections, each a serif sub-head + its own micro-form (`.infra-counts-grid` for counts,
`.infra-block`+`.infra-card` for choices; `checkbox-circle` = "tick one", `checkbox-empty` = "tick all").
**Verbatim option labels — the honest Ghanaian vocabulary is the product; do not genericise:**

| Sub | Heading | Fields / options (verbatim) |
|---|---|---|
| A | `A. Classrooms` | counts: `Total classrooms` · `In good condition` · `Needing repair` |
| B | `B. Water source` | tick-one: `Borehole` · `Piped (GWCL)` · `Hand-dug well` · `Rainwater harvesting` · `Tanker delivery` · `None` |
| C | `C. Electricity` | tick-one: `National grid (ECG)` · `Solar` · `Generator only` · `None` |
| D | `D. Sanitation` | counts: `Latrines · boys` / `· girls` / `· staff`; tick: `Latrine type` → `Water closet (flush)` · `KVIP / VIP` · `Pit latrine` · `None`; `Hand-washing facilities · tick all that apply` → `Tippy taps` · `Wash basins with running water` · `Veronica buckets` · `None` |
| E | `E. Library` | tick: `Library status` → `Dedicated library room` · `Shared room / corner` · `None`; blanks: `Approx. book count` · `Library staff (FTE)` |
| F | `F. ICT lab` | tick: `ICT lab status` → `Functional · all working` · `Partial · some working` · `Computers but no power / connectivity` · `No ICT lab`; blanks: `Total computers` · `Working computers`; `Internet · tick` → `Broadband` · `Mobile data` · `None` |
| G | `G. Kitchen / feeding facilities` | tick-one: `Kitchen status` → `Dedicated kitchen building` · `Open-air cooking area` · `Caterer prepares off-site` · `No on-site feeding`; `Cooking fuel · tick all` → `LPG (gas)` · `Firewood` · `Charcoal` · `Electric` |
| H | `H. Furniture & equipment` | counts: `Student desks · usable` / `· broken` · `Teacher desks` · `Chalkboards` · `Whiteboards` · `Projectors` |

- **Build — SUPERSESSION toward AUTO-when-captured (partial):** `infrastructure` is **`AUTO_WHEN_CAPTURED`**
  from the GOV-3/7 **facilities snapshot** (`generate.ts` 248–250). When `FULL`, auto-fill the fields the
  snapshot carries — `FacilitiesSnapshotRow`: `classroomsGood/classroomsTotal` (A), `waterSource` (B),
  `electricitySource` (C), `latrinesBoys/Girls/Staff` (D), `hasLibrary/hasIctLab/hasKitchen` (E/F/G). Render
  those as **filled** (with the `.auto-fill-block` `Auto` confirmation), and the sub-fields the snapshot does
  **not** carry (latrine type, hand-washing, book count, computer counts, internet, cooking fuel, furniture
  counts) as **hatched blanks**. When `NONE`, the whole section is the surface's hatched form; reason:
  *"No facilities snapshot captured yet — capture one at /reports/facilities."* The "Fill by hand"
  affordance for §8 routes to `/reports/facilities`, not a bespoke blank (`view.ts` CAPTURE_HREF).

### PAGE 8 — §9 Attendance + §10 Terminal results

**§9 Attendance · annual** — head: `num` **9** · **`Attendance · annual`** · source **`from attendance
module`**. `.auto-fill-block`: heading **`Attendance auto-filled `**`<span class="auto-pill">Auto</span>`,
body **`Computed from {d} marked school days over the {year} academic year. Includes excused absences per GES
guidance.`** `.pdf-table` cols **`Term · School days · Boys avg · Girls avg · Total avg · Rate`**, `.auto-cell`
on **Total avg**; `.total` **`Year average`**. Body-text (verbatim):
> *"Annual rate of **93.7%** meets the GES target of 90%+. Term 3 had the highest attendance, typical of the
> academic year approaching exams."*

- **Build — AUTO-when-captured:** `attendance` `FULL` → `schoolRate` + `totalMarked`; `NONE` (no days marked)
  → **hatched block, never a fabricated %** (`generate.ts` 207–213). The per-term breakdown is the fuller
  annual arm; if only current-period marks exist, fill what's captured and hatch the rest.

**§10 BECE / WASSCE results** — head: `num` **10** · **`BECE results · {cohortYear} graduating cohort`** ·
source **`from assessment module`**. `.pdf-table` cols **`Subject · Sat · Pass (≤ 6) · Pass rate · Avg
grade`**, `.auto-cell` on **Pass**; `.total` **`Aggregate average`**. Scale-reminder body-text (verbatim,
keep — the deliberate BECE voice):
> *"**BECE scale reminder:** grades 1—9 where 1 is highest and 9 is lowest · pass threshold is 6 · aggregate
> is the sum of best 6 subjects. CTK aggregate average of **4.0** is competitive for Greater Accra public
> JHS."*

- **Build — AUTO-when-captured:** `terminalResults` `FULL` when BECE/WASSCE captured (`generate.ts` 215–227) →
  `{exam} {year}: {passRate}% ({passed}/{total})`; `NONE` (not entered) → hatched, **never a blind Auto**;
  `NOT_APPLICABLE` (school sits no terminal exam) → the section is omitted/NA-noted, not zero-filled. **Title
  is exam-aware** — a SHS renders WASSCE, a JHS renders BECE (the mock hard-codes BECE).

### PAGE 9 — §11 Feeding (GSFP) + §12 Textbooks

**§11 School feeding programme** — head: `num` **11** · **`School feeding programme`** · source **`manual
entry`**. `.manual-fill` heading **`To be filled by hand`**, prompt: **`Ghana School Feeding Programme`**
*"participation, meal counts, and supplier details. Omnischools does not yet integrate with the GSFP
register."* `.infra-card` tick-one **`GSFP participation status · tick one`** → `Active participant` ·
`Suspended (specify reason in notes)` · `Never enrolled`; `.infra-counts-grid`: `Meals served · last term` ·
`Pupils fed · daily avg` · `Caterer / supplier name`.

- **Build — genuinely HAND (stays):** `feeding` `NONE` (`generate.ts` 253: *"GSFP participation is hand-
  filled (annual) — no feeding register integration exists"*). Render the surface's hatched form verbatim.

**§12 Textbook availability** — head: `num` **12** · **`Textbook availability`** · source **`manual entry ·
stockroom`**. `.manual-fill` heading **`To be filled by hand`**, prompt: *"Count the textbooks available in
stockroom **by subject and class**. Used by GES to plan supplementary distribution."* `.pdf-table` cols
**`Subject · JHS 1 books · JHS 2 books · JHS 3 books · Need (per pupil)`** — the three book columns are
`.manual-col` hatched blanks; **`Need` is auto = current enrolment (312)**. Subject rows (verbatim Ghanaian
JHS list): `English Language · Math · Integrated Science · Social Studies · R.M.E. · French · Ghanaian
Language · Career Tech · Creative Arts · ICT`. `.provenance` note (verbatim, keep):
> *"**Note for the headteacher:** "Need" column is computed from current enrolment (312 students). Fill the
> boxes with the number of books actually in stock for that class. The District Officer uses this to plan
> supplementary distribution."*

- **Build — genuinely HAND (stays):** `textbooks` `NONE` (`generate.ts` 257). The **`Need` column auto-fills
  from `enrolment.roll`** (the one computed value in a hand section); the book counts are hatched. Subject
  list is exam-tier-aware for SHS (flag — the JHS list is JHS-specific).

### PAGE 10 — §13 Declaration & signature + filing

**See §5 of this map for the full declaration + signature spec.** Head: `num` **13** · **`Declaration &
signature`** · source (blank). Contains `.pdf-declaration` (certification text + `.dec-signature-grid` with
headteacher + District Officer blocks + `.school-stamp`) and the `.filing-block` (9 numbered filing steps).

---

## 4. §5 — the Special-needs 12-cell grid (dedicated spec)

The task's headline net-new: §5 is a **6 categories × 2 sexes = 12-cell grid**, now **AUTO from the GOV-10 SEN
register** (built: `lib/reports/census/sen-data.ts`). The register is confidential; the census reads it
**de-identified — counts only** (`CensusSpecialNeeds` structurally cannot hold PII; Sarah §10).

**Categories & DOM order** (`SEN_CATEGORY_ORDER`, `lib/sen/vocab.ts`; matches the surface's 6 rows):
`VISUAL · HEARING · PHYSICAL · INTELLECTUAL · SPEECH · OTHER`. Labels: `Visual · Hearing · Physical ·
Intellectual · Speech · Other`.

**The 12 cells** — category-major, boys then girls (GOV-10 map §5), each a `.manual-field`-shaped cell with
label + value:

| # | Cell label (surface verbatim) | Value | | # | Cell label | Value |
|---|---|---|---|---|---|---|
| 1 | `Visual impairment · boys` | `byCategory.VISUAL.male` | | 7 | `Intellectual disability · boys` | `byCategory.INTELLECTUAL.male` |
| 2 | `Visual impairment · girls` | `byCategory.VISUAL.female` | | 8 | `Intellectual disability · girls` | `byCategory.INTELLECTUAL.female` |
| 3 | `Hearing impairment · boys` | `byCategory.HEARING.male` | | 9 | `Speech impairment · boys` | `byCategory.SPEECH.male` |
| 4 | `Hearing impairment · girls` | `byCategory.HEARING.female` | | 10 | `Speech impairment · girls` | `byCategory.SPEECH.female` |
| 5 | `Physical disability · boys` | `byCategory.PHYSICAL.male` | | 11 | `Other (specify) · boys` | `byCategory.OTHER.male` |
| 6 | `Physical disability · girls` | `byCategory.PHYSICAL.female` | | 12 | `Other (specify) · girls` | `byCategory.OTHER.female` |

**Two render states (drives auto vs hatched):**

| State | `specialNeeds.coverage` | Render | Copy |
|---|---|---|---|
| **Adopted** (register on) | `FULL` (even at all-zero) | 12 **filled** cells + `.auto-fill-block` confirmation pill **`✓ Auto · 12 of 12 cells`**; drawer meta = `{total} students with recorded needs · by category × sex` | source line: `from the SEN register` |
| **Not adopted** | `NONE` | 12 **hatched** `.manual-field` blanks (`.mf-blank` underline) under a `.manual-fill` `!`-block | reason: *"SEN register not adopted — special-needs enrolment is hand-filled (annual). Enable the SEN register to auto-fill §5."* |

- **Honest-absence crux (Kofi R413):** a not-adopted school and an adopted-but-zero school both have zero
  register rows — **only the `sen_module_adoption` marker distinguishes "hatched hand-fill" (NONE) from
  "captured zero" (FULL-zero)**. Never derive adoption from row-existence.
- **Tokens:** filled cells = `.manual-field` (`border PAPER_LINE bg SURFACE`, label 8px upper `NAVY3`, value
  `SERIF/MONO NAVY`); the `Auto` pill = `.auto-pill` `bg GREEN_BG text GREEN` 7px upper; the `!` block on the
  hatched state = `.manual-fill` (`bg` 45° `rgba(217,211,194,0.4)` hatch, dashed `PAPER_LINE`, `!` chip
  `bg WARN text white`).
- **Cross-module hook (preserve):** recording a support need in the SEN register flips these cells from
  hatched to auto — the 12 cells ARE the register's live aggregate over ACTIVE students, counting
  GRANTED+PENDING alike (consent gates the DETAIL, not the COUNT). **Counts only, never names** (GOV-10 §5).

---

## 5. §13 — the Declaration + signature block (the print-and-sign core)

The certification the whole PDF exists to carry. `.pdf-declaration` (`bg SURFACE border PAPER_LINE`).

**Declaration text (verbatim; `{...}` = template):**
> *"I, the undersigned headteacher of **{School}**, GES School ID **{code}**, certify that the information
> contained in this annual census for the academic year **{year}** is, to the best of my knowledge, accurate
> and complete. I understand that **auto-filled sections** derived from Omnischools records and
> **manually-completed sections** filled in by hand are equally my responsibility. I confirm that this census
> has been prepared in accordance with the directives of the Ghana Education Service and that the school's
> records support every figure reported herein."*

- Tokens: `.dec-text` `NAVY2 11px lh1.65`; `b` → `NAVY 600`. Demo binds `Christ the King JHS` / `4-2305-018`
  / `2025/26`. **Keep the "equally my responsibility" sentence — it is the load-bearing clause** that
  preserves full headteacher accountability across the hybrid auto/hand document (surface note).

**`.dec-signature-grid` (2 blocks):**

| Block | `.sig-label` | `.sig-name` | `.sig-meta` | Extra |
|---|---|---|---|---|
| Headteacher (left) | `Headteacher` | **`{head name}`** (`SERIF 14px 600`) | `Date: `**`______ Oct {year}`** (`.mono`, blank for pen) | `.school-stamp` (terra ring, top-right) |
| District Officer (right) | `District Education Officer` | **`To be filled at submission`** (`NAVY3 italic 500`) | `Receiving date: ___________________` | — |

- **`.sig-mark` (the simulated signature) — DO NOT RENDER in the real PDF.** The mock draws italic Fraunces
  "Florence Addo" rotated −3° above the line to show placement. **The real print-and-sign PDF leaves the
  signature line blank** (`.dec-sig-block` top border = the pen line). Auto-rendering a signature forges the
  certification (the headline honesty rule). The headteacher NAME (`.sig-name`) prints; the signature MARK
  does not.
- **`.school-stamp`** — decorative terra ring the mock draws to show where the physical rubber stamp lands:
  `border 2.5px TERRA`, `bg rgba(184,74,57,0.06)`, rotated −8°, three lines (`{School}` / `{suffix}` /
  `{TOWN · founded}`). **In the real PDF this is a placeholder outline, not a printed stamp** — the school
  applies its physical stamp in the ring after printing. Render the empty ring (or omit); never synthesise a
  stamp graphic.

**`.filing-block`** — head **`Filing instructions`**, 9 numbered steps (verbatim; the operational
print-and-sign runbook):
1. `Print this census on A4 paper, double-sided where possible.`
2. `Walk through the school grounds with a clipboard and complete `**`Section 8 (Infrastructure)`**` — classrooms, water, electricity, sanitation, library, ICT, kitchen, furniture.`
3. `Complete `**`Section 5 (Special needs)`**` from school records.` *(build: when SEN adopted, §5 is auto — soften/omit this step conditionally; when not adopted it stands.)*
4. `Complete `**`Section 7 (Staff qualifications & salary)`**` using personnel files; the staff list is auto-filled but qualifications and salary status need hand entry.` *(build: salary auto-when-captured — conditional.)*
5. `Complete `**`Sections 11 (Feeding) and 12 (Textbooks)`**` from your stockroom records and GSFP correspondence.`
6. `Verify the auto-filled sections against your physical records before signing.`
7. `Sign the declaration above and apply the school stamp where indicated.`
8. `Submit `**`two copies`**` to the District Education Office before `**`31 October {year}`**`, or upload the scanned signed PDF via the SRIMPR portal.`
9. `Retain a signed copy in the school's records for a minimum of `**`five years`**`.`

- Tokens: `.filing-block` `bg BG border PAPER_LINE NAVY3 10px`; `.head` `SERIF 600 NAVY`; `ol` numbered.
- **No electronic-submission button anywhere** (task + surface note + build plan): Omnischools generates the
  PDF; the admin prints, signs, stamps, and files two copies / uploads to SRIMPR themselves. The mock's
  step-8 SRIMPR mention is the ONLY reference to it and it is **manual** (out-of-app upload). **EMIS/MOE
  direct feed is a deferred, MOE-agreement-gated increment (OC-EMIS-INTEGRATION) — not GOV-9.**

---

## 6. Print/PDF page structure (composition rules)

- **A4 portrait**, `<Page size="A4">`, white page background; a fixed 6px gold `.strip`-style top accent is
  optional (board pack uses one) — the surface uses the navy `.pdf-page-band` per content page instead. Match
  the surface: **cover page → navy `.pdf-ges-band`**; **content pages 2–N → navy `.pdf-page-band`** header +
  `.pdf-foot-band` footer + `.pdf-page-num`.
- **One coherent topic per page** (surface note): cover / id+enrolment / age+repetition / SEN+movement /
  staff / infrastructure (×2) / attendance+results / feeding+textbooks / declaration+filing. In react-pdf use
  `wrap` + `break` to keep a section from splitting mid-table; the **page count is dynamic** (adopted-SEN grid
  vs hatched forms change height) — compute `{total}` after layout, don't hard-code 10.
- **`.auto-cell` green-dot** = the "this number came from the system" indicator (a 5px `GREEN` dot,
  top-right of the anchor number). In react-pdf, an absolutely-positioned 5px dot `View`. Keep it — it is the
  document's auto/hand legend at the cell level.
- **Hatch textures** (the honest-absence signal, identical to the drawer's manual progress-bar slice):
  `.manual-fill` / `.manual-col` / `.infra-card` / `.infra-count-cell` all use a 45° `repeating-linear-
  gradient`. react-pdf has no gradient border/fill primitive → **substitute a dashed border + a light
  `BG`/`rgba(217,211,194,0.4)` fill** (a flat tint reads as "hatched/hand" well enough in print), or
  pre-rasterise a hatch tile. Flag to the implementer: verify the hatch reads in a printed proof.
- **No charts, no graphs, no district/national comparison, no student-level rows, no facility photos, no
  finances/salary amounts** (surface note "what's not in this PDF"): the annual census is a **record, not a
  dashboard**. The census generator **never reads the finance arm** (`generate.ts` header) — finance is the
  board pack's, not the census's.

---

## 7. Auto vs hand-fill nature matrix (which sections fill how)

`nature` per `CENSUS_ROWS` (`view.ts`) + the arm coverage in an ANNUAL run:

| # | Section | Group | Nature (`view.ts`) | Annual render | Honest-absence read when empty |
|---|---|---|---|---|---|
| 1 | Identification | — | AUTO (config) | filled | `circuit` always hatched; `null` fields → `—` |
| 2 | Enrolment by class & gender | A | `AUTO` | filled (`FULL`) | `NONE` "No students currently enrolled." |
| 3 | Age distribution | A | `AUTO` | filled / `PARTIAL` blanks | missing DOB cells "stay blank, never guessed" |
| — | Ownership | A | `AUTO` | id/type value | `NONE` "ownership is not set in the school profile" |
| 6 | Movement | A | `AUTO` (admissions only) | admissions filled; **withdrawals/transfers hatched** | reason per arm; net-change hatched |
| 5 | **Special needs (12-cell)** | A | **`AUTO_WHEN_CAPTURED`** (GOV-10) | adopted→auto grid; else hatched | `NONE` "SEN register not adopted…" |
| 4 | Repetition | A | **`HAND`** | **hatched** | `NONE` "Promotion history is not tracked…" |
| 7 | Teaching staff (list, sex) | B | `AUTO` | filled | `NONE` "No teaching staff on record." |
| — | PTR | B | `AUTO` | `1 : {ratio}` | `NONE` "No teaching staff (or no roll)…" |
| — | Non-teaching staff | B | `AUTO` | filled | `NONE` "No non-teaching staff on record." |
| 7q | Qualifications (trained/untrained) | B | **`HAND`** | **hatched column** | `NONE` "Trained/untrained split is not yet captured…" |
| 7s | Salary status | B | **`AUTO_WHEN_CAPTURED`** | status filled / `NA` | `NA` "does not run payroll in Omnischools" |
| 9 | Attendance | C | `AUTO` | filled | `NONE` — reason from attendance arm (never a fabricated %) |
| 10 | Terminal results (BECE/WASSCE) | C | `AUTO_WHEN_CAPTURED` | filled / hatched / `NA` | `NONE` "No BECE/WASSCE results captured yet." |
| — | Academic performance | C | `AUTO_WHEN_CAPTURED` | filled / hatched | `NONE` "No end-of-term academic performance recorded yet." |
| 8 | Infrastructure (A–H) | D | `AUTO_WHEN_CAPTURED` (facilities) | captured fields filled, rest hatched | `NONE` "No facilities snapshot captured yet — capture one at /reports/facilities." |
| 11 | Feeding (GSFP) | E | **`HAND`** | **hatched** | `NONE` "GSFP participation is hand-filled…" |
| 12 | Textbooks | E | **`HAND`** | **hatched** (Need col auto) | `NONE` "Textbook inventory is hand-filled from the stockroom…" |

**The task's "annual-only hand sections" = repetition, trained/untrained qualifications, full movement/exits,
GSFP, textbooks.** All confirmed above. Every "not tracked" reads as **"→ fill by hand"** with the arm's real
reason string — **never a fabricated value** (`generate.ts` is the source of every reason).

---

## 8. Interaction / empty states

| Region | State | Render / copy |
|---|---|---|
| Document | **no census generated yet** | the statutory page routes to the GOV-8 drawer ("Generate the annual census first"); no PDF until a `census_return` row exists |
| Document | **DRAFT** (`status='DRAFT'`) | editable: hand-fill inputs live (persist to `hand_fill` jsonb); the PDF is the working document with hatched blanks for NONE/HAND sections; **`Download PDF`** available |
| Document | **COMPLETED (locked)** (`status='COMPLETED'`) | frozen filing = the record; hand-fill inputs **read-only**; the `auto_snapshot` is immutable (frozen at `census_date`); `Download PDF` still available; a `Completed · filed {date}` badge |
| Download | affordance | a **`Download PDF`** button → the streaming route (`Content-Type: application/pdf`, `Content-Disposition: attachment; filename="{CODE}_GES_Census_{year}.pdf"`). **No "Submit to GES" button** (print-and-sign only) |
| Section | **FULL** | real auto value + `.auto-cell` dot / `.auto-fill-block` `Auto` pill |
| Section | **PARTIAL** | captured cells filled, empty cells hatched (staff qualifications, age-missing-DOB, facilities-subset, movement-withdrawals) |
| Section | **NONE** | full `.manual-fill` hatched block with the arm `reason`; in-app "Fill by hand" routes to the capture module (`view.ts` CAPTURE_HREF: attendance→`/attendance`, terminal→`/reports/terminal-results`, SEN→`/students/special-needs`, infra→`/reports/facilities`) or print-and-pen |
| §5 SEN | adopted-zero | all-`0` filled + `✓ Auto · 12 of 12 cells` (a captured zero is FULL, not hatched) |
| §5 SEN | not-adopted | 12 hatched blanks |
| Signature | always | line blank for pen; name printed; District Officer block `To be filled at submission`; stamp ring empty |
| PDF route | **loading / generating** | the download button → disabled/spinner while react-pdf composes; server-streamed |
| PDF route | **error** (an arm read throws) | fail loud (route error) — **never stream a fabricated-complete census**; a false 100% must never ship |
| Access | **role gate** | management-only (Headmaster/Admin); the route + `census_return` are `FORCE RLS` + `tenant_isolation`, no `parent_scope` (auto-denied to parents). Sarah §10 |

---

## 9. Token audit (surface `:root` → tokens; flag anything without a brand token)

Every surface `:root` token resolves to `styles/tokens.css`. In the **PDF** they become StyleSheet hex
constants (§0); in any **DOM preview** they become Tailwind classes (with the slash-opacity trap live).

| Surface var | Hex | tokens.css | PDF const / Tailwind | Used by |
|---|---|---|---|---|
| `--navy` | `#1A2B47` | `--navy` | `NAVY` / `text-navy` | bands, body, headings |
| `--navy-2` | `#2D3F5C` | `--navy-2` | `NAVY2` / `text-navy-2` | table cells, mono meta |
| `--navy-3` | `#5C6675` | `--navy-3` | `NAVY3` / `text-navy-3` | labels, sources, page-num |
| `--gold` | `#C8975B` | `--gold` | `GOLD` / `text-gold` | section nums, em accents, crest |
| `--gold-soft` | `#E8D4B8` | `--gold-soft` | `GOLD_SOFT` | ges-band text, borders |
| `--gold-bg` | `#F5EBDC` | `--gold-bg` | `GOLD_BG` | (drawer fill band) |
| `--bg` | `#FAF7F2` | `--bg` | `BG` / `bg-bg` | thead, foot-band, hatch base |
| `--surface` | `#FFFFFF` | `--surface`/`#fff` | `#FFFFFF` | page, id-grid, cards |
| `--green` | `#2F6B47` | `--green` | `GREEN` | auto-cell dot, `+Δ`, Auto pill |
| `--green-bg` | `#E5EFE8` | `--green-bg` | `GREEN_BG` | auto-pill bg |
| `--terra` | `#B84A39` | `--terra` | `TERRA` | `−Δ`, stamp ring, PDF chip |
| `--terra-bg` | `#F5E1DC` | `--terra-bg` | `TERRA_BG` | — |
| `--warn` | `#C58A2E` | `--warn` | `WARN` | `!` hand-fill icon, Manual pill |
| `--warn-bg` | `#F5E9D0` | `--warn-bg` | `WARN_BG` | manual pill/tint |
| `--border` | `#E5DFD3` | `--border-1` | `BORDER` / `border-border` | note: surface `--border` → tokens `--border-1` |
| `--border-2` | `#D4CCBA` | `--border-2` | `BORDER2` | drawer buttons |
| `--paper` | `#FBFAF6` | `--paper` | `PAPER` | **PDF page background** (warmer than pure white) |
| `--paper-line` | `#C9C2B0` | `--paper-line` | `PAPER_LINE` | **every PDF table/cell border, dashed hatch border** |

**Colours WITHOUT a brand token (flag):**
- `.preview-stage` / `.drawer-stage` grey desk gradient **`#E8E1D2 → #DDD5C2`** — **mock chrome only** (the
  grey desk the scaled pages sit on). Not part of the document; **no token needed** — the PDF page is `PAPER`,
  the in-app preview background is `bg-bg`. Do not port the gradient.
- Alpha values `rgba(184,74,57,0.06)` (stamp fill), `rgba(217,211,194,0.4)` (hatch), `rgba(229,223,211,0.3)`
  (subtotal), `rgba(197,138,46,0.3)` (warn border) — **tints of existing tokens.** In the PDF: use the `rgba`
  verbatim (react-pdf is fine with alpha). In any DOM preview: **do NOT use `bg-terra/6` etc.** (the
  slash-opacity trap on raw-hex tokens) — use `--terra-bg-soft`-style named tints or `opacity-N`.
- `--sen-intellectual` `#5847B5` / `--sen-intellectual-bg` `#E8E5F2` — the GOV-10 Intellectual category pill;
  **already a NAMED token** in tokens.css (not a raw hex). Only relevant if §5's category pills are shown in a
  DOM preview; the PDF grid is count cells, not pills.

---

## 10. SUPERSESSION / build-differs log — flag every one (Kofi / Wells / Sarah own the truth)

The mock's tags/values are frozen at authoring (pre-GOV-3/6/7/10). **Do not port them literally.** Each row:
what the mock *shows* vs what the build *computes*, and who owns it.

| # | Section | Mock shows | Build computes (render this) | Owner |
|---|---|---|---|---|
| 1 | **§5 Special needs** | hatched manual · *"not yet captured… future update"* | **AUTO 12-cell grid from GOV-10 SEN register** (adopted→FULL even at zero; not-adopted→NONE with the real reason). De-identified, counts only | **Kofi** (R413 narrowing) · **Wells** (SEN migration 0082/prod-paste-0088) · **Sarah** (confidential sole-content-path fence, counts-not-names) |
| 2 | **§7 Salary** | `Manual` column | **AUTO-when-captured** — `{schoolPaid}/{gesPaid}/{allowance}`; `NA` when no payroll | Kofi |
| 3 | **§8 Infrastructure** | all `Manual` (×8 sub-sections) | **AUTO-when-captured** from the facilities snapshot (classrooms/water/electricity/latrines/library/ICT/kitchen); the sub-fields the snapshot lacks stay hatched | Kofi (arm) · Wells (facilities_snapshot) |
| 4 | **§4 Repetition** | auto (green dots) | **HAND** — promotion history not tracked → hatched | Kofi |
| 5 | **§7 Qualifications** | mixed per-teacher degrees | **HAND** — trained/untrained split not captured → hatched | Kofi |
| 6 | **§6 Movement** | fully auto (all reasons) | **PARTIAL** — admissions-this-period × sex auto; withdrawals/transfers/net hatched | Kofi |
| 7 | **§9 / §10 Attendance & results** | auto (blind) | **AUTO-when-captured** — `NONE` if unmarked/not-entered (hatched, never a fabricated %/blind Auto) | Kofi |
| 8 | Every static number (`312`, `93.5%`, `14`, `4.6%`, `22.3`, `Page X of 10`, `31 Oct 2025`) | hard-coded demo | **all from the frozen `auto_snapshot`** — carry NONE of the literals; page count + deadline computed | Kofi |
| 9 | **Simulated signature `.sig-mark`** | italic "Florence Addo" drawn on the line | **blank pen line** (never auto-rendered) | Lucy (design rule) · Sarah (no forged certification) |
| 10 | **School stamp graphic** | terra ring with school text | **empty placeholder ring** (physical stamp applied post-print) | Lucy |
| 11 | Census-window / deadline dates (`1 Sep — 31 Oct`) | hard-coded | **not stored** (`academic_period.census_window_*` absent) → omit until a field exists | Kofi / Wells (schema decision) |
| 12 | `Last yr` / `Δ` enrolment columns | demo prior-year figures | **no prior-year frozen roll** → omit or hand-fill; never fabricate | Kofi |
| 13 | DRAFT/COMPLETED lock | not shown (mock is a static preview) | `census_return.status` gates edit vs read-only; frozen at `census_date` | Kofi (lifecycle) · Wells (table, shipped) |

---

## 11. Cross-module hooks (design commitments to preserve)

| Hook | Where | Preserve as |
|---|---|---|
| **GOV-10 SEN register → §5 census grid** | §5 12-cell grid | recording a support need flips hatched→auto; the 12 cells ARE the register's de-identified live aggregate (category×sex, GRANTED+PENDING, ACTIVE students). **Counts only, never names.** Adoption via the marker, not row-existence |
| **GOV-3/7 facilities snapshot → §8 infrastructure** | §8 A–H | AUTO-when-captured; "Fill by hand" routes to `/reports/facilities`, not a bespoke blank |
| **GOV-6 terminal-results → §10** | §10 BECE/WASSCE | AUTO-when-captured; not-entered = `NONE` (hatched), never blind Auto; title is exam-tier-aware |
| **GOV-7 staff compensation → §7 salary** | §7 salary column | AUTO-when-captured (status, not amount); `NA` when no payroll |
| **attendance / enrolment / staff modules → auto sections** | §2/§3/§6/§7/§9 | the census is a **read/reduction** of live module data, frozen at `census_date` — never a re-entry form; one arm per section |
| **drawer coverage ↔ PDF cell** | GOV-8 drawer → GOV-9 PDF | the SAME `arm.coverage` drives a drawer row's tag AND whether the PDF cell auto-fills or hatches — **one `auto_snapshot`, so they can never disagree** |
| **census → District Education Office (SRIMPR)** | §13 filing step 8 | Omnischools generates; the admin prints, signs, stamps, files two copies / uploads the scanned PDF themselves. **No in-app submission.** EMIS/MOE direct feed is a deferred, MOE-agreement-gated increment |
| **census explicitly EXCLUDES finance** | whole document | the generator never reads the finance arm; no fees/budget/salary-amounts on the census (that's the board pack) |

---

## 12. Responsive / PWA

- **The PDF is fixed A4 portrait** — no responsive variant. It is a print artefact.
- **No PWA / phone-first variant.** GOV-9 is a Headmaster/Admin desktop statutory task (same posture as the
  drawer, GOV-8 §7). The in-app document/preview page is a desktop management surface.
- The surface's only media query (`max-width:1280px`) single-columns the mock's doc/notes layout — **mock
  chrome, not the document.** An in-app on-screen preview (if built as scaled A4 pages) scrolls; below 1280px
  it single-columns. The download/print path is viewport-independent.

---

## 13. Drift / open questions (for PO / Kofi / Wells)

1. **Circuit not stored on `ref_school`** (`generate.ts` 67, `schema.ts` 43) → always `null` → hatched blank
   in id grid + cover tagline. Recommend adding `ref_school.circuit`; until then, drop the tagline fragment
   rather than print an empty "· Circuit".
2. **Census-window / deadline dates not stored.** Cover `.filed` window line + filing step-8 deadline are demo
   copy; no `academic_period.census_window_open/close`. Same gap as GOV-8 §10.1 / `ledger-surface-map §3.7`.
   **Omit the window/deadline lines until a per-`(school × cadence)` window field exists.**
3. **Enrolment `Last yr` / `Δ` columns.** No prior-year frozen roll exists. Confirm: omit the two columns for
   v1, or make them hand-fill. Do not fabricate.
4. **PDF hatch fidelity.** react-pdf has no repeating-gradient primitive — the hatched hand-fill signal must
   be substituted (dashed border + flat tint, or a rasterised hatch tile). Verify it reads as "hand-fill" in a
   printed proof (§6).
5. **Page count is dynamic.** Do not hard-code "10 / Page X of 10". Compute after layout (adopted-SEN grid vs
   hatched forms change height).
6. **Exam-tier awareness (§10 title, §12 subject list).** The mock is JHS/BECE-hard-coded. Confirm SHS renders
   WASSCE + the SHS subject list; the census is tier-agnostic (GOV-10 R416).
7. **Conditional filing-instructions copy.** Steps 3 (SEN) and 4 (salary) tell the admin to hand-fill sections
   the build now auto-fills. Recommend making steps 3/4 conditional on the section's coverage, so the runbook
   matches the rendered document.
8. **In-app hand-fill vs print-and-pen for the annual run.** GOV-8 §10.7's open question applies: does GOV-9
   ship the in-app hand-fill capture (persisting to `hand_fill`, routing NONE sections to their capture
   modules) for v1, or defer to print-and-pen? The `hand_fill` jsonb column exists either way.

---

*Map produced against `Surfaces/schoolup-annual-census.html` §02 (PDF preview markup 1680–2587, CSS 536–1320,
notes 2588–2623); the built census pipeline (`lib/reports/census/generate.ts` / `view.ts` / `schema.ts` /
`sen-data.ts`, `lib/sen/vocab.ts`, `db/schema/census-return.ts` migration 0081/prod-paste-0087,
`db/schema/sen-register.ts` migration 0082/prod-paste-0088); the react-pdf sibling pattern
(`lib/pdf/board-pack-document.tsx` / `render-board-pack.tsx` / `app/(board)/board/board-pack/route.ts`,
`docs/governance/gov5-board-pack-pdf-design.md`); tokens (`styles/tokens.css`); and the GOV-8 drawer half
(`docs/governance/gov8-census-drawer-design.md`) + GOV-10 SEN grid (`docs/governance/gov10-sen-register-
surface-map.md`). Follows the shape of `docs/senior/ledger-surface-map.md`.*
