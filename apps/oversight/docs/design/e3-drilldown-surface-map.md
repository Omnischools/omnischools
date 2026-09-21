# E3 — Individual drill-down surfaces · design map

**Author:** Lucy (design cartographer) · **Status:** build-ready spec
**Scope:** the §6 gated named-record path (student + NEW staff branch), the access & audit log, and five E3 additions.
**Audited sources (settled visual spec — port 1:1):**

- `Surfaces/schoolup-oversight-compliance-record.html` (925 lines) — the §6 gate → record → own-history.
- `Surfaces/schoolup-oversight-access-audit.html` (682 lines) — the access & audit log + queried-entry review.
- Supporting patterns referenced: `Surfaces/schoolup-oversight-school-detail.html` (non-gated school profile drill), `Surfaces/schoolup-annual-census.html` (facilities/GSFP census fields — the source of `caterer_name`).

> **SUPERSEDED — do not borrow:** `Surfaces/schoolup-oversight-dsa-management.html` ("Data-sharing agreements"). §5.5 removed the DSA/consent-gate concept. The nav item still labelled *Data-sharing agreements* in the two audited mocks is a **stale label**; the implementer must not reproduce a DSA surface. E3 consent is **narrow**: it governs only the individual drill-down of **non-GES staff at a school with no DPO consent** (addition 2). It is NOT a general data-sharing regime.

---

## 0. Global chrome & tokens (shared by every surface below)

All colour maps to `apps/oversight/styles/tokens.css` variables, bound to Tailwind classes in `apps/oversight/tailwind.config.ts`. **Never hardcode hex.** The mock's local `:root` hexes are the same values as the shipped tokens — port to the token classes, not the literals.

| Mock literal / role | Token var | Tailwind class |
|---|---|---|
| `--navy` #1A2B47 (body, CTAs) | `--navy` | `text-navy` / `bg-navy` / `border-navy` |
| `--navy-2` #2D3F5C (secondary) | `--navy-2` | `text-navy-2` |
| `--navy-3` #5C6675 (muted/meta) | `--navy-3` | `text-navy-3` |
| `#13203A` (deep navy chrome: sidebar, record-head, appendonly, rev-head) | `--navy-deep` | `bg-navy-deep` |
| `--gold` #C8975B (accent, italics) | `--gold` | `text-gold` / `bg-gold` |
| `--gold-soft` #E8D4B8 (gold borders) | `--gold-soft` | `border-gold-soft` |
| `--gold-bg` #F5EBDC (gold-tinted surface, hover) | `--gold-bg` | `bg-gold-bg` |
| `--bg` #FAF7F2 (page) | `--bg` | `bg-bg` |
| `--surface` #FFFFFF (cards) | `--surface` | `bg-surface` |
| `--green` / `--green-bg` (success/cleared) | `--green`/`--green-bg` | `text-green` / `bg-green-bg` |
| `--terra` / `--terra-bg` (error/queried/flagged) | `--terra`/`--terra-bg` | `text-terra` / `bg-terra-bg` |
| `--warn` / `--warn-bg` (gate banner, pending, submit CTA) | `--warn`/`--warn-bg` | `text-warn` / `bg-warn-bg` |
| `--border` #E5DFD3 / `--border-2` #D4CCBA | `--border-1`/`--border-2` | `border-border-1` / `border-border-2` |

**Type:** Fraunces (`font-display`) for h1/section titles/panel titles/KPI values/record names/crest — weight 500–600, with **italic gold `em`** accents (e.g. `When a name is *actually needed.*`). Manrope (`font-body`/`font-sans`) for body/labels. JetBrains Mono (`font-mono`) for IDs, refs, timestamps, numeric values. **No emoji, no stock illustration, no icon substitution** — glyphs used are typographic (`!`, `✓`, `→`, `▸`, `⊘`, `⛓`, `⊕`) rendered inside styled badge boxes; keep them or map to a text-forward equivalent, do not swap for an icon set without checking.

**App shell (all Oversight surfaces):** two-column grid `230px 1fr`. Left sidebar is `bg-navy-deep`, contains: GES crest mark (gold `GES` badge + "Omnischools Oversight" / jurisdiction sub-line — "Ghana Education Service" at district/regional tier, "Ministry of Education" at national tier), a gold-tinted **scope-chip** ("Your jurisdiction" → e.g. *Wassa Amenfi West · Municipal District · Western Region*, or *National · Ministry of Education · 16 regions*), nav groups (Overview / Analysis / Records[ & audit] / Account), footer avatar+name+role, "Powered by *Omnischools*". Main column: white `page-head` (uppercase gold-linked breadcrumb `crumb`, Fraunces h1 with gold italic em, `lede`, right-aligned `actions` buttons) over `bg-bg` body with `28px 36px` padding.

**Deep-navy chrome is meaningful:** the sidebar, the `record-head`, the `access-strip`'s parent, the `appendonly` banner and the `rev-head` all use `--navy-deep` — this is the visual signal of "you are inside the audited/named tier." Preserve it.

---

## PART A — Audit of the two existing surfaces (1:1)

### A1. Compliance record surface — `schoolup-oversight-compliance-record.html`

Page eyebrow/hero (the design-doc framing, not app chrome): *"Omnischools Oversight · the gated exception" / "When a name is **actually needed.**"* MVP tag: *"Omnischools Oversight · Batch 3 · surface 1 of 5"*. Three app sections.

#### §A1.1 — The gate (route `.../compliance-records/new`)

Nav active: **Compliance records**. Page-head h1 *"Request a **named record.**"*, lede *"Named-record access is logged and reviewable. State the compliance reason before the record is shown."*, single ghost `Cancel` action.

**Gate banner** (`.gate-banner` — `bg` linear-gradient warn-bg→surface, `1.5px` `border-warn`, radius 14, warn `!` icon box):
- Title (Fraunces, gold-italic em): *"You are about to leave **aggregate view.**"*
- Body: *"This will reveal data about a **named individual**. GES holds the authority to do this for genuine compliance work — but every access is recorded against your name and reviewable by your regional director, the national tier, and GES internal audit. **Use this only when an aggregate view cannot answer the question.**"*

**Justification panel** (`.panel`, head title *"Access **justification**"*, meta *"All fields required"*). Four form rows, each `jf-label` + red `Required` pill (`jf-req`, terra on terra-bg) + `jf-hint`:

1. **Reason for access** — hint: *"Pick the compliance ground. Each reason limits which fields of the record are revealed — claim verification does not unlock health data."* Then `.reason-opts` — a **2-column radio-card grid**. Each `.reason-opt` = radio dot + title + desc; `.selected` gets `border-gold` + `bg-gold-bg` and a thick (5px border) filled radio. The four STUDENT reason codes verbatim:
   - **Free SHS claim verification** — *"Confirm an enrolment or placement claim against the record"* (selected in mock)
   - **Withdrawal-anomaly investigation** — *"Investigate a flagged enrolment or attendance irregularity"*
   - **Statutory audit** — *"Records requested under a formal GES or national audit"*
   - **Safeguarding casework** — *"A child-protection or welfare case requiring the record"*
2. **School** — hint: *"The record's school — within Wassa Amenfi West only. This scopes the lookup below."* Read-only text input, value *"Asankrangwa SHS"*. (Jurisdiction ceiling: school picker is constrained to the officer's own district.)
3. **Record type** — hint: *"Students and teachers are found differently — GES holds teacher staff IDs, but students have no GES-side identifier."* A 2-col `rectype-row` radio grid:
   - **Student record** — *"Found by browsing the school's roster — no GES student ID exists"* (selected)
   - **Teacher record** — *"Found by GES staff ID, or by name from the staff list"*
   Below it, **two lookup blocks** whose enabled/muted state follows the record-type choice:
     - `.lookup-block` **Student lookup** (`lb-tag student` = gold pill "Student lookup"), title *"Browse the school roster"*, long note explaining no GES student ID exists, roster opens **only after justification is logged**, and the log records that a roster was browsed. Contains a `filter-mini` chip row: **Form** (Form 1 / **Form 2**★ / Form 3), **Programme** (**Science**★ / Business / Gen. Arts / VA/HE), **Gender** (Boys / Girls / **All**★). Footnote: *"Filtered to **Form 2 · Science · all** — the roster will open at **132 students**. Add a gender filter to narrow further."*
     - `.lookup-block.muted` (opacity 0.45) **Teacher lookup** (`lb-tag teacher` = navy pill), title *"By GES staff ID or name"*, note ending *"(Inactive — student record type is selected.)"*
4. **Case reference & explanation** — hint: *"A case number where one exists, and one line on why the aggregate data cannot answer this. This text is stored in the audit log verbatim."* `jform-textarea` (min-height 64), value verbatim: *"FSHS-WAW-2026-0094 — Free SHS disbursement reconciliation flagged a placement as unmatched between the CSSPS list and the school's Form 2 Science enrolment return. Browsing the Form 2 Science roster to identify and verify the affected student's recorded enrolment status, to clear or escalate the claim."*

**Consent line** (`.consent-line`, gold checkbox `✓`): *"I confirm this access is for the stated compliance purpose only, that an aggregate view cannot answer it, and that I understand **this access will be permanently logged against my name** and is subject to GES audit review."*

**Footer buttons:** ghost `Cancel` (left) + the primary submit pushed right, styled **warn** (bg-warn, text-bg): *"Log access & open roster →"*.

#### §A1.2 — The record (route `.../compliance-records/r-0094`)

h1 *"Roster, **then record.**"*; lede *"Free SHS claim verification · access R-0094 logged 21 May 2026, 11:04 GMT · roster browsed, record opened."* Actions: ghost `Close record`, `Add to case`.

- **Roster banner** (`.roster-banner`, gold-bg, gold `▸`): *"Step 1 of 2 · **roster browsed** — access R-0094 is already logged. Pick the student whose record the case concerns; opening it reveals the field-scoped record below."*
- **Roster table panel** — head *"Asankrangwa SHS **· Form 2 Science roster**"*, meta *"132 students · filtered from gate"*. `.roster-table` columns: Student / School ID (mono) / Sex / Enrolment / Free SHS claim / (pick). Rows are `pickable` (hover `bg-bg`); the matching row has class `match` (gold-bg tint) and a `rs-flag` warn pill *"Claim flagged"*. Sample rows: K. Adjei, **A. Boateng (match, flagged)**, E. Darko, M. Frimpong; each ends in gold `Open →`. Footer: *"Showing 4 of 132 · the row matching the flagged claim is highlighted · narrow with the gender filter to shorten the list"*.
- **Record head** (`.record-head`, `bg-navy-deep`): gold-soft avatar `AB`, name (Fraunces) *"A. Boateng"*, meta *"Student · ASANCO/2024/0317 · Asankrangwa SHS · Form 2 Science"*, right tag pill *"Named record"*.
- **Access strip** (`.access-strip`, terra-bg, terra dot, attached under record-head): *"This access is **logged** as R-0094 against **D. Mensah-Bonsu** · reason **Free SHS claim verification** · visible to GES regional, national & audit review"*.
- **Fields-released panel** — head *"Fields released **for this reason**"*, meta *"Free SHS claim verification"*. `.rec-grid` (2-col) of `.rec-field` (label uppercase + value). Released: Student name (Ama Boateng), Student ID (mono), School, Class & programme, Enrolment status (green "Enrolled & active"), Enrolment date (mono), Free SHS status (green "Covered · placement confirmed"), CSSPS placement code (mono CSSPS-2024-WR-04471). **Withheld** (`.rec-field.redacted`, greyed italic): Health & emergency info → *"Withheld — not released for this reason"*; Guardian contact details → *"Withheld — not released for this reason"*. `scope-line` (gold `⊘`): *"Two fields are withheld. **Free SHS claim verification** releases enrolment, placement and fee-status fields only — health and guardian contact data require a safeguarding-casework reason."*
- **Audit-confirm** (`.audit-confirm`, green-bg, green `✓`): title *"Claim resolved — and the access closed cleanly"*, body *"The CSSPS placement code matches the disbursement record; **claim FSHS-WAW-2026-0094 can be cleared**. This access, the fields viewed, and the outcome are recorded in the Oversight access & audit log as entry R-0094."*
- **Provenance** row: *Field scope · reason determines which fields release* / *Logged · R-0094 · accessing user, reason, fields, timestamp* / *Source · operational record · read-only via the analytics boundary*.

#### §A1.3 — Officer's own access history (route `.../compliance-records`)

h1 *"Your access **history.**"*, lede *"Every named-record access you have made — the same entries GES audit reviews."*, actions ghost `Filter` + primary `New record access →`.

- **KPI strip** (4 cards, first is `.lead` gold-gradient): *Your accesses · 12 months* → **9** records / *Most common reason* → **FSHS** 5 of 9 / *Open cases* → **1** case / *Audit review status* → **Clear** ("No access queried by regional audit").
- **Log panel** — head *"Named-record accesses **by you**"*, meta *"Most recent first"*. `.log-table` columns: Ref (mono) / Reason (`lg-reason` pill) / Record & school / When (mono) / Outcome. Reason-pill variants: `fshs` (gold on gold-bg), `anomaly` (warn), `safeguard` (terra), `audit` (green). Sample rows: R-0094 FSHS "Claim cleared", R-0091 anomaly "Transferred — confirmed", R-0088 FSHS "Claim cleared", R-0085 **safeguard "record withheld · case-restricted"** → "Referred to welfare unit", R-0082 FSHS "Claim escalated". Footer: *"Showing 5 of 9 accesses · safeguarding record details are case-restricted even in your own history"*.
- **Provenance**: *This history · your accesses only · the full district log is audit-tier* / *Append-only · entries cannot be edited or deleted, by anyone* / *Audit log · the same entries feed the Oversight access & audit surface*.

### A2. Access & audit log surface — `schoolup-oversight-access-audit.html`

Hero framing: *"Omnischools Oversight · GES auditing itself" / "Who looked at **what, and why.**"* MVP tag *"Batch 3 · surface 4 of 5"*. National tier (scope-chip = *National*; footer = E. Mahama · MoE · National Oversight). Two sections.

#### §A2.1 — The log (route `national/access-audit-log`)

h1 *"Access & **audit log.**"*, lede *"Every named-record access across all 16 regions — the record GES internal audit reviews."*, actions ghost `Filter` + `Export log`.

- **Append-only banner** (`.appendonly`, `bg-navy-deep`, gold `⛓` icon): *"This log is **append-only**. Entries cannot be edited or deleted — by anyone, including national administrators. A reviewer may **add a query or a note** to an entry, but the original access record is immutable. An audit log that could be altered would not be an audit log."*
- **KPI strip:** *Named-record accesses · 90 days* → **284** entries ("Across 16 regions · 0.4% of all Oversight sessions") / *Most common reason* → **FSHS** 61% / *Queried by audit* → **3** entries / *Cleared on review* → **279** entries.
- **Log panel** with `.audit-filters` chip toolbar row: **Reason** (All★ / Free SHS / Anomaly / Audit / Safeguarding), divider, **Review** (All★ / Queried / Cleared), divider, **Region** (Western / Ashanti). `.alog-table` columns: **Entry & time** (mono ref + mono timestamp) / **Accessing officer** (`al-who` bold + `al-role` meta) / **Reason** (`al-reason` pill) / **Record accessed** (`al-target`) / **Review** (`al-rev` status pill: `cleared` green / `queried` terra / `pending` neutral). Rows are `drill` (hover gold-bg); a `flagged` row is terra-bg tinted (hover stays terra-bg). Sample rows: R-0094 D. Mensah-Bonsu FSHS Cleared; **R-0461 K. Asare FSHS Queried (flagged)**; R-0458 A. Owusu (Regional Director · Western) **Statutory audit · Teacher · GES/WR/08841 · Amenfiman SHS** Cleared; R-0455 safeguarding "record case-restricted · school withheld" Cleared; R-0451 anomaly Cleared. Footer: *"Showing 5 of 284 entries · sorted most recent first · **R-0461 flagged — queried by audit**"*.
- **Provenance**: *Written by · the compliance record view · one entry per named-record access* / *Append-only · immutable · queries and notes attach, nothing is removed* / *Reviewed by · regional directors, national tier, GES internal audit*.

#### §A2.2 — A queried entry (route `.../access-audit-log/r-0461`)

h1 *"Entry **R-0461.**"*, lede *"A queried access — the reviewer's question, and the officer's response."*, ghost `Back to log`.

- **Review head** (`.rev-head`, `bg-navy-deep`): gold mono ref `R-0461`, Fraunces title *"Named-record access · queried"*, meta *"19 May 2026, 16:52 GMT · written by the compliance record view"*, right status pill `rv-status queried` *"Under query"*.
- **Two-col triage grid** `1fr 290px`:
  - Left: **The logged entry** panel (meta *"Immutable · as written"*) of `.entry-field` rows: Accessing officer (*K. Asare · District Director, Sekondi-Takoradi Metro*), Reason given (*Free SHS claim verification*), Record accessed (mono *Student · STMA/2025/1180 · Takoradi SHS · Form 1*), Case reference & explanation · as entered (`ef-value quote` italic: *"Checking enrolment status for a parent enquiry about Free SHS placement."*), Fields released (*Enrolment status, placement code, Free SHS status — claim-verification scope*). Then **Review timeline** panel (`.rev-timeline`): dot `done ✓` "Access logged"; dot `flag !` "Queried by GES internal audit" (*Flagged because the explanation cites **"a parent enquiry"** — no case reference…*); dot `now 3` "Officer asked to explain — awaiting response · current step"; dot `next 4` (neutral outline) "Resolution" (*Cleared if a genuine basis is confirmed · escalated to the officer's line manager if not · the entry stays either way*).
  - Right rail: **review-action** card (warn-bg): title *"Why this was queried"*, body reading the explanation against the reason, then two buttons — green `Clear entry` + terra `Escalate`. Below, **"What the query cannot do"** note card (bg-bg): *"The query **does not undo the access**… prevention is at the gate, accountability is here."*
- **Provenance**: *The entry · immutable · the query attaches, the record is unchanged* / *Reviewer · GES internal audit · with national-tier visibility* / *Outcome · cleared, or escalated to the officer's line manager*.

---

## PART B — shadcn/ui primitive mapping (for both audited surfaces + E3 additions)

| Surface element | shadcn/ui primitive | Notes |
|---|---|---|
| App sidebar / nav | custom (or `NavigationMenu` vertical) | `bg-navy-deep`; not a shadcn concern — port markup. |
| Page-head breadcrumb | `Breadcrumb` | uppercase, gold links. |
| Gate banner / consent-denied / append-only / audit-confirm | `Alert` (variant per token: warn / info / navy-deep / success) | do **not** use `destructive` for consent-denied — see addition 2. |
| Reason radio-card grid, record-type grid, staff reason grid | `RadioGroup` + `RadioGroupItem` wrapped in card labels | selected = `border-gold bg-gold-bg`, thick radio. Single-select. |
| School picker (scoped) | `Select` or `Combobox` | constrained to jurisdiction; readonly-styled when pre-scoped. |
| Filter-mini / audit-filters / staff-list filters | `ToggleGroup` (chips) | `active` = `bg-navy text-bg`. |
| Case-reference textarea | `Textarea` | stored verbatim; required. |
| Consent line | `Checkbox` + label | gold checked box. |
| Roster table / staff-list / log tables / audit log | `Table` | rows `data-state` for `pickable`/`drill`/`match`/`flagged`. |
| Record fields grid, entry fields | plain `Card`/`div` grid | `rec-field` / `entry-field`. |
| Withheld field | `Card` w/ muted style + `Badge`-like value | see addition 7. |
| Reason / review / claim pills | `Badge` (custom variants) | fshs=gold, anomaly=warn, safeguard=terra, audit=green, + STATUTORY/CONSENT, GRANTED/DENIED (addition 6). |
| KPI cards | `Card` | first card `.lead` gold-gradient. |
| Submit / clear / escalate CTAs | `Button` | warn submit, green clear, terra escalate, ghost cancel, navy primary. |
| Review timeline | custom stepper | dot states done/flag/now/next. |

**Responsive:** the `.layout` design-doc grid collapses at `max-width:1280px` (`grid-template-columns:1fr`; kpi-strip → 2-col; dash-grid → 1-col). Inside the app frame, `rec-grid`, `rectype-row`, `reason-opts`, `triage-grid` are the columns to collapse to single-column on narrow. The sidebar is a fixed 230px rail — for a real responsive port it becomes a drawer under `md`, but the mocks are desktop-first (this is a government desktop tool); match desktop faithfully first.

---

## PART C — E3 additions the implementer must build

> These are **new**. They extend the audited patterns; reuse the exact components/tokens above. Copy below is the authored spec copy — keep it verbatim.

### C1. Staff branch of the gate

Same four-step gate flow (§A1.1), but for a **staff subject**. Reached when **Record type = Teacher / Staff record** is selected — the muted "Teacher lookup" block becomes active and the student roster block mutes. Differences:

- **Reason step** shows the STAFF reason set (not the student set), same `RadioGroup` card grid. New codes (from Kofi) — each reveals a **different field set** (see the field-scope matrix). Verbatim titles + suggested descs:
  - **ESTABLISHMENT_PAYROLL_VERIFICATION** — "Establishment & payroll verification" — *"Confirm a posting, rank or payroll entry against the GES establishment register."*
  - **TEACHER_ABSENCE_INVESTIGATION** — "Teacher-absence investigation" — *"Investigate a flagged attendance or absence irregularity for a posted teacher."*
  - **LICENSURE_QUALIFICATION_VERIFICATION** — "Licensure & qualification verification" — *"Verify NTC licence status or a stated qualification."*
  - **STATUTORY_AUDIT** — "Statutory audit" — *"Staff records requested under a formal GES or national audit."*
  - **SAFEGUARDING_MISCONDUCT** — "Safeguarding / misconduct casework" — *"A safeguarding or professional-misconduct case requiring the staff record."* (case-restricted — behaves like student safeguarding: identity withheld in own-history and audit log.)
- **Lookup step:** two paths (see C4) — by **GES staff ID** (direct, when the subject is on the establishment register) or **name from the staff list** (browse). The block note carries over: *"For teachers, GES holds the staff ID from the establishment register — so a staff record is found directly by staff ID, with a name search against the school's staff list as a fallback."*
- **Record-head tag** reads *"Named staff record"* (vs *"Named record"* for students). Access strip identical pattern.

**Field-scope matrix (staff)** — the released set per reason; every field NOT in the set renders **Withheld** (addition 7), never hidden:

| Field | PAYROLL_VERIF | ABSENCE_INVEST | LICENSURE_VERIF | STATUTORY_AUDIT | SAFEGUARDING |
|---|:--:|:--:|:--:|:--:|:--:|
| Staff name | ● | ● | ● | ● | ● |
| GES staff / establishment no. | ● | ● | ● | ● | ● |
| School / current posting | ● | ● | ● | ● | ● |
| Rank / grade / appointment date | ● | ● | — | ● | — |
| Payroll status / salary grade & step | ● | — | — | ● | — |
| SSNIT no. | ● | — | — | ● | — |
| Attendance / leave record | — | ● | — | ● | — |
| NTC licence no. / status / expiry | — | — | ● | ● | — |
| Qualifications / CPD points | — | — | ● | ● | — |
| Safeguarding / disciplinary / misconduct record | — | — | — | — | ● |
| Welfare-relevant contact | — | — | — | — | ● |

(● released · — Withheld for this reason.) STATUTORY_AUDIT is the broad establishment/payroll/licensure scope; it still **withholds** safeguarding/misconduct + welfare contact — those require the safeguarding reason. The scope-line copy mirrors §A1.2, naming which reason unlocks the withheld fields.

### C2. Consent-denied state (the pivotal new state)

Triggered when a **non-GES / non-teaching staff** drill-down is attempted at a school that has **not granted DPO consent** for individual staff oversight (or the school's private/mission flag is off). This replaces the record — it is reached at the point the gate would open the record.

**It is NOT an error and NOT blank.** Use an informational `Alert` on **`bg-gold-bg` / `border-gold-soft`** (calm, brand-informational) — **never `terra`/destructive**, never a spinner-then-nothing. Layout mirrors the `audit-confirm`/banner shape (icon box + title + body + action), inside the record column where the record would have been.

- Icon box: gold, typographic `⊘` (or `i`) — no red.
- Title (Fraunces): *"Individual record not available."*
- Body (verbatim): *"This school has not granted DPO consent for individual staff oversight. The aggregate view remains available. Individual staff records at non-GES schools are released only where the school has recorded DPO consent; GES-establishment staff are covered by statute and do not require it."*
- Primary action button (navy `primary`): **"Return to aggregate view →"** routing back to the school/district aggregate.
- Secondary muted line: *"No record was opened, and nothing was logged as an access — this attempt is recorded only as a consent-denied event in the access & audit log."* (This ties to addition 6: the audit log shows a **DENIED / CONSENT** row.)

Because this state is entered *before* a record is revealed, the gate consent-line + submit still precede it; the denial is the response to submit when consent is absent.

### C3. Statutory vs consent framing

For a **GES-establishment teacher**, the flow **proceeds** (statutory basis) — no consent check blocks it. Make the legal basis legible:

- In the gate, once record-type = staff and the subject resolves to a GES-establishment teacher, show a small **basis chip / inline line** near the school/subject: **legal-basis pill `STATUTORY`** (style: navy pill or green — reuse `al-reason.audit` green family; label uppercase mono-ish) with helper text: *"This teacher is on the GES establishment register. GES accesses the record under statutory authority — no school consent is required. The access is still logged and reviewable."*
- For a **non-GES staff subject at a consenting school**, the equivalent pill is **`CONSENT`** (gold family) with helper: *"This school has recorded DPO consent for individual staff oversight. The record is released on that basis; the access is logged and the consent basis is recorded."*
- The record-head / access-strip carries the same basis pill so the basis stays visible on the record screen, alongside the R-#### access ref.
- Non-GES + no consent → C2 (denied). Non-GES + consent → proceeds under CONSENT. GES teacher → always proceeds under STATUTORY.

### C4. Staff-list browse (staff with no GES id)

Mirrors the student roster-pick pattern (§A1.2 roster table) for staff who are **not on the GES establishment register** (no staff ID to look up directly). Logged as a **roster/staff-list browse**, exactly like the student roster: the list opens **only after the justification is logged**, and the log records that a staff list was browsed, not only the record finally chosen.

- Reuse `.roster-table` structure/tokens. Columns: **Staff** (name, bold) / **Staff / establishment ID** (mono — shows the GES no. for establishment staff, or *"— not on register"* for non-GES) / **Role** (e.g. Teacher · JHS Maths / Non-teaching · Accounts) / **Register status** (`rs-flag`-style pill: gold `GES establishment` vs warn `Not on register`) / **(pick)** gold `Open →`.
- Filter-mini chip row scoping the list before it loads (mirror the student filters): **Role** (Teaching / Non-teaching / All), **Department/subject** where relevant, plus a name search. Footnote pattern: *"Filtered to … — the staff list will open at N staff. Narrow further before it loads."* (never a full-school dump).
- Banner (mirror `roster-banner`): *"Step 1 of 2 · **staff list browsed** — access R-#### is already logged. Pick the staff member whose record the case concerns."*
- Register-status is the branch signal: picking a **GES establishment** row → proceeds under STATUTORY (C3); picking a **Not on register** row → consent check (C2/C3 CONSENT). A row that would resolve to consent-denied should still be pickable but lead to the C2 state (never a dead/blank click).

### C5. Infrastructure school-detail panel (NON-gated)

A drill from **district/region aggregate → an individual school's facilities census row**. This is **infrastructure/facilities data about a *school*, not a person** — so it is **NOT gated**: **no §6 gate, no "leaving aggregate view" warning banner, no access-strip, no audit-log entry.** It behaves like the ordinary school-profile drill in `schoolup-oversight-school-detail.html` (breadcrumb `Schools · <School> · Facilities`, hover-drill rows `bg-gold-bg`), reusing `panel` + `school-table`/`rec-grid` + `stat-list` patterns.

- Reached from an aggregate facilities view (e.g. district WASH coverage %) by drilling into the school row — same non-gated drill idiom as enrolment/performance profiles.
- Panel head: *"<School> **· facilities census**"*, meta e.g. *"Annual Census 2025/26 · manual + system entry"*. Present the census facilities fields as `rec-field`/`stat-list` rows: classrooms, furniture adequacy, water/WASH, sanitation/toilets (by sex), electricity, ICT, library/labs, GSFP participation status, meals served, pupils fed.
- **HARD EXCLUSION — must NOT surface `captured_by` or `caterer_name`.** The census (`schoolup-annual-census.html`) captures *"Caterer / supplier name"* (`caterer_name`) and an operational *who-entered-it* (`captured_by`) field. These are person-identifying / operational-provenance fields and must be **omitted entirely** from the Oversight facilities panel — not shown as Withheld, simply absent (this is aggregate-derived school data, not a named-record path, so the "show as withheld" rule of addition 7 does **not** apply here; there is no reason-scope to explain). Implementer note: filter these keys at the data/query boundary so they never reach the client.
- No provenance line implying an audit access; instead a neutral provenance: *"Source · annual census · read-only via the analytics boundary"* (same wording family as other non-gated profiles). No R-#### ref.

### C6. Legal-basis + outcome columns on the access & audit log

Extend the §A2.1 `alog-table` (and the §A2.2 entry-detail + the §A1.3 own-history log) with the E3 accountability columns:

- **New "Legal basis" column** — `Badge` pill: **`STATUTORY`** (green/`audit` family) or **`CONSENT`** (gold/`fshs` family). Every named-record access now records which basis it was made under. Add matching filter chips to `audit-filters`: **Basis** (All / Statutory / Consent).
- **Outcome / access-result column** — the existing "Review" column stays (cleared/queried/pending); add an **access-outcome** value distinguishing **GRANTED** vs **DENIED**:
  - `GRANTED` — green pill; the record was released (the normal case).
  - `DENIED` — **this is how a consent-denied attempt (C2) renders in the log.** A denied access is a **first-class logged event**, not a silent no-op. Row style: use a **neutral/warn tint** (not the terra `flagged` tint reserved for *queried* entries — denial is not misconduct). `al-target` reads e.g. *"**Staff** · not on register · <School>"*; Legal basis = `CONSENT`; outcome pill `DENIED`; and a detail line *"Consent not recorded — record not released; officer returned to aggregate view."* No fields-released set (there were none).
- Filter row gains **Outcome** (All / Granted / Denied). KPI strip may add a *"Denied — no consent"* count card (optional, same `kpi-card` pattern) to make denials visible as a proportion.
- In the entry-detail (§A2.2), a DENIED entry's "Fields released" row reads *"None — access denied, no consent on record"*, and the timeline ends at a "Denied at the gate — no record opened" step (green/neutral dot, not a flag).

### C7. Withheld-field presentation (reinforced, applies to student + staff records)

Fields not unlocked by the chosen reason **always render as a visible Withheld field** — never silently hidden. This is the existing `.rec-field.redacted` pattern (greyed, italic, muted `--navy-3`), value string exactly **"Withheld — not released for this reason"**. Rules:

- The field **label stays visible** (e.g. "Payroll status", "Health & emergency info") so the officer sees *what more exists*; only the value is withheld.
- Always pair with the `scope-line` (gold `⊘`) summarising how many fields are withheld and **which reason would unlock them** (e.g. *"Payroll and SSNIT fields require an establishment & payroll verification reason."*).
- **Distinction from C5:** withheld ≠ excluded. Withheld = a named-record field the *reason* did not earn (shown, greyed). Excluded (`captured_by`/`caterer_name` in C5) = a field that has no place in that surface at all (absent). Do not conflate them.
- **Case-restricted** (safeguarding / SAFEGUARDING_MISCONDUCT) is a stronger tier: even the *record identity* is withheld in own-history (§A1.3, R-0085) and in the audit log (§A2.1, R-0455) — rendered as *"record withheld · case-restricted"* / *"record case-restricted · school withheld"*, not as an ordinary field-level withhold.

---

## Interaction-state catalogue (quick reference for the implementer)

- **Gate — default/empty:** reason unselected → submit disabled; hint text visible. Selecting a reason applies `border-gold bg-gold-bg` to the card and (for staff) recomputes the previewed field-scope.
- **Gate — record-type toggle:** switching Student↔Staff swaps which lookup block is active vs `muted` (opacity 0.45) and swaps the reason set (student 4 vs staff 5).
- **Lookup — pre-load:** roster/staff-list does not load until justification is logged; filters must narrow first ("opens at N"). Loading = brief; on open, matching row highlighted (`match`, gold-bg).
- **Roster/staff-list rows:** `pickable` hover `bg-bg`; `drill` rows in log tables hover `bg-gold-bg`; `flagged` (queried) rows terra-bg (hover stays terra-bg).
- **Record — released:** normal `rec-field`. **Withheld:** greyed italic (C7). **Case-restricted:** identity withheld.
- **Consent-denied (C2):** gold-bg informational alert + "Return to aggregate view" — never blank, never terra error, never a spinner dead-end.
- **Audit log — outcome:** GRANTED green / DENIED neutral-warn / queried terra flag / cleared green / pending neutral.
- **Review actions:** `Clear entry` (green) / `Escalate` (terra); the query never edits the immutable entry — it attaches.
- **Disabled:** submit before consent checkbox + required fields; `muted` lookup block; ghost `Cancel` always enabled.

## Cross-module references to preserve exactly (architectural commitments)

- Reason codes are controlled lists — student (4) and staff (5) sets are fixed enums; the staff enum keys are `ESTABLISHMENT_PAYROLL_VERIFICATION`, `TEACHER_ABSENCE_INVESTIGATION`, `LICENSURE_QUALIFICATION_VERIFICATION`, `STATUTORY_AUDIT`, `SAFEGUARDING_MISCONDUCT`.
- Every gated access writes exactly **one append-only entry** to the access & audit log; denials (C2) also write an entry (DENIED). Nothing is edited or deleted.
- Jurisdiction ceiling holds inside the gate (school picker scoped to the officer's district/region).
- Oversight is **read-only across the analytics boundary** — it never writes back to the operational record.
- `captured_by` and `caterer_name` must never cross the analytics boundary into the infrastructure panel (C5).
- "Data-sharing agreements" nav label is stale (dsa-management superseded); E3 consent is only the non-GES individual-staff drill-down.
