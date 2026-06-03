# Omnischools Senior · The SHS Score Ledger

**Status:** Design proposed, ready to build. Supersedes the earlier "STPSHS-first" framing in the STPSHS integration spec — the score ledger is the primary teacher artifact, and STPSHS, the Omnischools gradebook, and the SSP integration all hang off it.

This document specifies how Omnischools Senior models, captures, and works with **the score ledger** that SHS teachers in Ghana keep — historically the paper book in which assignment, exam, project, and portfolio marks are recorded as the semester progresses, and now extended to a digital ledger that lives on the same five-category model. It lays out the three capture paths (auto-compile, scan-and-extract, direct digital entry), the validation logic between them, the PWA strategy for direct entry, the Vice Headmaster's progress view, and the implications for the downstream systems (gradebook, STPSHS export, parent reports, Oversight aggregation).

It is informed by direct feedback from a Ghanaian SHS teacher currently using STPSHS, and verified against the NaCCA Government Year 1 Teacher Manual which enumerates the official assessment categories: *"project work, practical demonstration, performance assessment, skills-based assessment, class exercises, portfolios as well as end-of-term examinations."*

---

## 1. The principle the spec rests on

The earlier specs (STPSHS, SSP) treated Omnischools' gradebook as the operational source and the regulator's systems as downstream destinations. The teacher's feedback corrects this: in actual SHS classrooms today, **the paper score ledger is the source of truth**, and every digital system — STPSHS included — is downstream of it. Teachers update the ledger as the semester progresses. STPSHS receives a copy of the ledger's totals at semester end. Parent reports are derived from the ledger. WASSCE Continuous Assessment Scores are derived from the ledger.

This isn't a workflow Omnischools should fight. It's the workflow Omnischools should *absorb* — preserving teacher autonomy over the paper artifact while turning it into a digital record automatically, then propagating that record everywhere it needs to go.

## 2. The five-category data model

Per the teacher's account and NaCCA's published vocabulary, every SHS score ledger in Ghana records five categories per student per subject per semester:

| # | Category | Source | Weight (typical) |
|---|---|---|---|
| 1 | **Assignments / class exercises** | Multiple in-semester entries, averaged | 15% |
| 2 | **Mid-semester examination** | Single mid-semester entry | 15% |
| 3 | **End-of-semester examination** | Single end-of-semester entry | 40% |
| 4 | **Individual project work** | One or more project submissions | 15% |
| 5 | **Portfolio** | Discretionary, end-of-semester only | 15% |

The five categories are universal across SHS in Ghana — verified against the NaCCA Government Year 1 Teacher Manual. **Exact weighting is set per (subject × school)** and varies meaningfully in practice: schools weight differently between subjects, and individual schools tune the balance between continuous assessment and the terminal examination. The 15/15/40/15/15 schedule above is the demo school Asankrangwa SHS's configuration, with the end-of-semester examination carrying 40% — the dominant weight — reflecting how most Ghanaian SHS treat the terminal assessment in line with the WASSCE-style summative model. Omnischools models the weights as **configurable per (subject × school)** with a system default the school sets at enrolment, and surfaces the configured weights on every report so a parent or auditor can see how a final score was computed. Where NaCCA publishes guidance, the system can seed defaults from it; that guidance is non-binding and schools tune in practice.

The portfolio category warrants a specific note. Unlike the other four, portfolio scores are *not the result of an assessment event*. A teacher awards a portfolio mark at the end of the semester based on the student's care and organisation of their own assessment papers across the semester — essentially a meta-judgment of how well the student kept their own record. There are no in-term events to aggregate; the score is a one-shot discretionary entry. This is the one category Omnischools cannot auto-compile from in-term entries, and the spec treats it accordingly.

**Universality check.** This five-category structure is the NaCCA SHS curriculum's standard, applied to all SHS regardless of public/private status — Category A through F schools all teach the same curriculum and all submit to WAEC for WASSCE. Private schools may track *additional* categories internally (some Christian schools track scripture separately; some international-track schools run parallel IGCSE assessment), but the five NaCCA categories are the universal baseline. Omnischools should not split the data model by school type; it should support optional *additional* categories as a school-level extension on top of the five.

## 3. Academic period configuration

The five-category ledger is keyed by `(student, subject, period)`. Critically, **the *period* differs by product line** because Ghanaian SHS and Basic schools run different academic calendars, and the GES standard for each is settled:

| Product | Period structure | GES standard | Omnischools default |
|---|---|---|---|
| **Basic** (KG · Primary · JHS) | 3 terms per academic year, ~12–15 weeks each | Yes — current 2024/25 and 2025/26 calendars use the 3-term structure | 3 terms |
| **Senior** (SHS) | 2 semesters per academic year, ~8 months total schooling, 162 teaching days | Yes — semester system introduced 2018/19 academic year, still in force 2025/26 | **2 semesters** |

### 3.1 Why SHS is 2 semesters, not 3 terms

GES replaced the SHS trimester system with a 2-semester structure at the start of the 2018/19 academic year as part of the Free SHS rollout, when capacity pressures from expanded enrolment made the 3-term schedule unworkable. The semester system increased classroom hours from 1,080 per year (under the old trimester) to 1,134 per year (a 54-hour gain), while restructuring the calendar around two contiguous in-school blocks separated by a single vacation rather than three blocks separated by two. Sources: GES Public Relations statement Jan 2019; GES 2023/24, 2024/25, and 2025/26 academic calendars all confirm the 2-semester structure for SHS. Basic schools (KG · Primary · JHS) were *not* part of this change and continue on the 3-term calendar.

This split is not a transitional inconsistency Omnischools needs to abstract away — it is the standing GES position for two distinct school populations, and the data model should reflect it directly.

### 3.2 Configurable, not hard-coded

Although the GES defaults are clear, Omnischools models the period structure as **configurable per school at setup**, not hard-coded by product line. Three reasons:

1. **Private schools may deviate.** A private SHS running an international-track parallel (Cambridge IGCSE, IB, American Common Core) may operate on a different calendar than the GES public-system semester. Forcing GES-default semesters on every Senior school would create a mismatch between the ledger and the school's actual academic year.
2. **Transitional double-track variants exist.** Some SHS under the double-track system run a modified calendar (alternating cohorts on different periods); the schema must accommodate this without surgery.
3. **Future GES changes are routine.** Ghana's education calendar has been revised multiple times in the last decade (the 2018 trimester→semester shift; the 2021 announcement that JHS would also move to semesters, which was then *not implemented*). Hard-coding the current GES default would mean a schema migration every time GES moves; a configurable model means a config change.

### 3.3 The schema

Two tables:

```sql
CREATE TABLE ref_academic_period_config (
    school_id              UUID NOT NULL,
    academic_year          TEXT NOT NULL,     -- e.g. '2025/26'
    period_type            TEXT NOT NULL,     -- 'TERM' | 'SEMESTER'
    period_count           SMALLINT NOT NULL, -- 2 or 3 (or 4 for rare cases)
    configured_at          TIMESTAMPTZ NOT NULL,
    configured_by          UUID NOT NULL,
    source                 TEXT NOT NULL,     -- 'GES_DEFAULT' | 'SCHOOL_OVERRIDE'
    PRIMARY KEY (school_id, academic_year)
);

CREATE TABLE academic_period (
    period_id              UUID PRIMARY KEY,
    school_id              UUID NOT NULL,
    academic_year          TEXT NOT NULL,
    period_number          SMALLINT NOT NULL, -- 1, 2, (3)
    period_label           TEXT NOT NULL,     -- 'Semester 1', 'Term 2' etc.
    starts_on              DATE NOT NULL,
    ends_on                DATE NOT NULL,
    FOREIGN KEY (school_id, academic_year) REFERENCES ref_academic_period_config
);
```

The `senior_score_ledger` (and the analogous `basic_score_ledger`) is then keyed by `(student_id, subject_id, period_id)` where `period_id` resolves to either a term or a semester depending on the school's configuration. Surface labels read from `academic_period.period_label`, so a Basic-school teacher sees "Term 2" and a Senior teacher sees "Semester 2" without code branching.

### 3.4 Defaults at school onboarding

The unified onboarding wizard (`schoolup-onboarding-unified-wizard.html`) seeds defaults at school creation:

- If the school registers as Basic-only (KG · Primary · JHS): seed 3 terms per academic year.
- If the school registers as Senior-only (SHS): seed 2 semesters per academic year.
- If the school registers as Basic-and-Senior (the J-S configuration common in Ghana, KG through SHS on one campus): seed 3 terms for the Basic levels *and* 2 semesters for the Senior level — both in the same school record, governed by different period configs. The data model supports this without ambiguity because `ref_academic_period_config` keys on (school_id, academic_year) and the same school can hold separate configs for its Basic and Senior products.

The seeded period dates align with the GES-released academic calendar for the current academic year, refreshed annually from a small ETL job that reads the GES calendar PDF when GES publishes it (typically July–August each year). Schools can override any of the seeded dates during onboarding or later through the academic-year settings page.

### 3.5 Implications across surfaces

Period labelling propagates through every surface that shows time:

- Score ledger grid headers: "Semester 2 of 2025/26" for SHS, "Term 2 of 2025/26" for Basic.
- WASSCE-readiness ledger trajectory: 6 semesters for SHS (F1 S1, F1 S2, F2 S1, F2 S2, F3 S1, F3 S2), not 8 terms. Mock 1 sits in F3 S1, Mock 2 in F3 S2. WASSCE follows F3 S2.
- Parent report cards: one per period. Basic parents get three reports per year; Senior parents get two.
- STPSHS export: the regulator's ledger captures one terminal weighted-total per (subject × form), so the SHS school's two semester scores are aggregated into the one Year-N submission. The aggregation rule is configurable (default: weighted average of the two semesters, weighted by `period.weight` on `academic_period`).
- Oversight academic-performance surface: the `assessment_type` dimension distinguishes `TERMLY` (Basic only), `SEMESTERLY` (SHS only), `ANNUAL` (both), `MOCK` (SHS final-year only).

## 4. The three capture paths

A teacher choosing to use Omnischools' SHS gradebook makes one default choice and can override per semester:

### 4.1 Path A — Auto-compile (default for teachers using Omnischools through the semester)

The teacher uses Omnischools as their day-to-day gradebook. Each assignment, quiz, mid-sem exam, end-of-sem exam, and project submission produces a score in the system as it happens. At semester end, Omnischools auto-compiles the four computable categories:

- **Assignments / class exercises** — average of all in-semester assignment scores, weighted by the teacher's configuration (equal weight by default; configurable to weight by maximum mark)
- **Mid-semester examination** — the score from the mid-semester exam event
- **End-of-semester examination** — the score from the end-of-semester exam event
- **Individual project work** — score from the project event (or aggregate of multiple, if the subject has more than one)

The teacher then enters the **portfolio score manually** at semester end as the final step. This is the one row Omnischools cannot fill in for them, and the system should make this clear in the UI — a single field that needs the teacher's judgment.

After portfolio entry, the gradebook is complete for the semester and feeds the STPSHS export, the parent report, and the Oversight aggregation.

### 4.2 Path B — Scan and extract (the path for teachers who keep their paper ledger as primary)

This is the more important of the two paths strategically, because adoption of full digital gradebook use will be slow. Many SHS teachers will continue keeping their paper ledger as primary for years. Omnischools should not penalise them.

The workflow:

1. **Teacher photographs the ledger page(s)** — typically one page per class per subject, sometimes spanning two pages for larger classes. Multiple photos can be attached to a single upload.
2. **Omnischools extracts scores** via OCR/handwriting recognition, attempting to populate the five-category grid for each student in the class. Low-confidence cells are visually flagged.
3. **Teacher reviews the extracted grid alongside the original photograph**, side by side. They confirm correct extractions, correct wrong ones, and fill in any cells the OCR couldn't read. The original photograph is retained as an attachment.
4. **The verified grid becomes the semester's gradebook record**, feeding the same downstream as Path A.

Two specific design refinements that make this path actually work:

**Verification-first, not extraction-first.** The teacher does not approve a "this is what we read" decision in aggregate — they cell-by-cell confirm. Omnischools highlights low-confidence cells (which it knows from the OCR confidence scores) and dim-shades them until reviewed. The product promise is *"we save you typing, and you confirm the read,"* never *"we read your ledger correctly."* The trust posture this creates is honest and protects against the genuine error case.

**An Omnischools-branded ledger book (optional, free).** Schools that want higher OCR accuracy can request a free Omnischools ledger book at the start of the semester — a standard template with known column positions, a printed grid that helps OCR, a QR code on each page identifying class/subject/semester/teacher, and pre-printed student names in the leftmost column (since Omnischools knows the class roster). Teachers using this book get near-perfect extraction. Teachers using their own existing ledger still benefit from the workflow, just with more verification needed. The branded book also becomes a small marketing artifact — Omnischools' name in every classroom.

### 4.3 Path C — Direct digital entry (for teachers comfortable with digital devices)

Some teachers will neither work in Omnischools through the semester (Path A) nor keep a paper ledger they photograph (Path B). They will want to **enter scores directly onto the digital ledger** — the same five-category grid, but typed into a phone or laptop rather than written on paper or computed from individual assignments.

This is a real third persona that the earlier two-path spec missed: the digitally comfortable teacher who thinks in ledger rows-and-columns, not in assignment-events. Forcing them into Path A's assignment-tracking mismatches how they think about their gradebook; forcing them into Path B's "write on paper then photograph" wastes the digital comfort they already have.

The workflow:

1. **Teacher opens the digital ledger** for their class-subject-semester on phone, tablet, or laptop. Same five-category grid as Path B's verification view, but blank (no scan to read from).
2. **Teacher enters scores cell-by-cell** as assessments happen — a mid-sem score goes in when mid-sem is marked, project scores when projects are returned, end-of-sem at semester close, portfolio at the very end. The ledger grows over the semester.
3. **The grid is the gradebook record.** No compile step, no scan to verify — what's entered *is* the record.

Path C uses the same data model as A and B (one record per student per subject per period, five category scores plus audit history), and shares the same downstream flows in section 8. The diff logic in section 7 applies automatically: a Path C teacher who later photographs their digital-entry view as a verification step would trigger cell-by-cell comparison with the typed values — useful for catching a teacher who entered a score wrong and never noticed.

**Path C is the case the PWA is built for** (section 5 below). Direct digital entry on a phone in a staff room or on a laptop at home is the workflow the PWA optimises for.

### 4.4 The teacher chooses per semester, and the three paths are medium-agnostic equivalents

A teacher might use Path A for one semester, Path B for the next, Path C the semester after. The choice is per (teacher × subject × class × semester), set at the start of the semester and switchable. Defaults: new teachers default to Path B (preserves existing workflow); teachers who have used Path A or Path C for a previous semester default to that path.

The strategic framing matters and should govern how this is marketed: **the three paths are medium-agnostic equivalents, not a progression from paper toward digital.** Omnischools does not nudge teachers from Path B (paper) toward Path C (digital); the branded paper ledger is a *feature*, not a transitional artifact. Three ways to keep the ledger, the same five categories underneath, the same downstream output, the same Vice Headmaster visibility. *The teacher chooses the medium; Omnischools handles the rest.*

This is deliberately the opposite of the generic edtech "go paperless" pitch. Every competing product markets paperless. Omnischools' distinctive promise is medium-agnosticism — respecting that a teacher who has kept paper for fifteen years should not be implicitly told their workflow is the inferior one. The harder story to tell, but the one no one else is telling, and the one that fits how Ghanaian SHS adopt software.

## 5. The Omnischools Score Ledger PWA

Path C requires a digital ledger UI that runs well on a phone, where most Ghanaian teachers will actually use it. The right vehicle is a Progressive Web App — installable from the Omnischools web app to the phone's home screen, browser-based, no app-store dependency. This section specifies the PWA scope honestly, including what is in and out of v1.

### 5.1 What the PWA is

A view of the score ledger optimised for the phone form factor. Same five-category data model as the web app, two layout options for the same data, the same class-switching affordance the web app uses, and a phased connectivity story. Installable on Android (the dominant platform among Ghanaian teachers) and iOS, both phone and tablet.

The PWA is **not a separate product**. It is the Omnischools web app's ledger view, surfaced in a form factor that works well on a phone home screen. The same authentication, the same data, the same audit trail. A teacher who enters a score on the PWA sees it instantly in the web app, and vice versa.

### 5.2 Two view modes — card and grid

A toggle pill in the header switches between two layouts of the same underlying ledger. Neither is the "right" view; they serve different tasks within the same workflow.

**Card view** shows one student per screen with five large input fields and the weighted total live-computed. This is the right shape for *entering scores as you mark*, where a teacher wants visual confirmation that this row is for this student — useful in the staff room when scores are coming straight out of a paper booklet, where misattribution to the wrong student is the biggest single error source.

**Grid view** shows the whole class in a compact table — student names sticky-left, five category columns and a weighted total column, scrollable rows. This is the right shape for *scanning, spotting outliers, or doing a final review before STPSHS export* — when the question is "is anyone missing a mid-sem score?" or "does the project-work column look right?" rather than "what is this student's assignment mark?"

Both views read and write the same underlying records. Switching is non-destructive — the teacher's pending unsaved scores stay buffered, the cursor returns where they left it, the sync state is preserved across the switch. The teacher's last choice persists per (teacher × subject × class × semester) — a teacher who prefers grid view on a 37-student class roster does not get pushed back to card view tomorrow. Card view is the default for first use because it matches the typical "marking session" workflow most teachers describe; grid view becomes the default after the teacher has chosen it once.

The same two-view-toggle exists on the desktop ledger view, in the same form (the desktop default is grid view, since the wider screen makes the whole class scannable without scrolling).

### 5.3 The class chevron — switching between the teacher's classes

Almost no SHS teacher teaches one class. Mr. Owusu has two Form 2 Maths classes; a typical Integrated Science teacher might teach four classes across forms; an English teacher running across all three forms might teach six. The PWA and the desktop ledger both surface a clear affordance for switching between a teacher's classes, with the active class always named at the top of every screen.

The affordance has two parts. **The class name and a small "1 of 2" pill** sit at the top of every PWA screen (and at the top of every desktop ledger view), making the active class unambiguous and the existence of other classes visible without taking up much space. **A chevron beside the class name** opens the switcher — on the PWA, a bottom sheet sliding up from below; on the desktop, a horizontal class-tab list expanding above the grid. The chevron is suppressed entirely if the teacher teaches only one class — first-year teachers do not need to be told their single class is one of one.

The switcher panel lists every class the teacher teaches this semester, each row showing:

- Class name and subject
- Student count
- Path used (A, B, or C)
- Completion summary across the five categories
- A status pill — "current," "ready" (all five categories complete and STPSHS-exportable), or "behind" (at risk of missing the STPSHS deadline or otherwise flagged)

Tapping a class entry switches the active context. The bottom sheet dismisses (PWA) or the tab activates (desktop), and the ledger view — whichever layout the teacher last used, card or grid — reloads with the new class's roster, scores, and progress indicators. Two taps end-to-end on the phone.

Three design disciplines apply:

**Switching is non-destructive.** Pending unsaved scores in the prior class stay buffered in the local sync queue, the audit trail records the switch (who looked at which class, when), and the teacher's working state in the prior class is preserved exactly. They can switch back and find the cursor where they left it.

**The current class is the default on app open.** When a teacher opens the PWA fresh from the home screen, it lands on the class they last touched — not on the first class alphabetically, not on a "pick a class" interstitial. The state of the world the teacher last left is the one Omnischools restores. Switching is the deliberate action; staying put is the default.

**The chevron itself carries status.** A class with an STPSHS deadline in less than 7 days shows the chevron in gold; a class with the teacher inactive for more than 14 days shows it with a small warn-dot. Without opening the switcher, a teacher juggling several classes can see at a glance from any screen whether one of their other classes needs attention — and tap through directly. This uses the same `ref_anomaly_rule` infrastructure the Vice Headmaster's progress view uses, surfaced for the teacher's own benefit before it surfaces upward to management.

### 5.4 Connectivity — phased, honest about cost

"Works offline" is the marketing line that sells, but full offline-first ledger entry — with a local device store, sync queue, conflict resolution between devices, and cache invalidation when rosters change — is a substantial engineering commitment with a long bug tail. Several months of focused engineering, and the failure modes (a sync conflict that silently keeps the wrong version of a student's score) are precisely the trust-eroding kind.

Score entry is also not the daily-attendance case. A teacher enters scores at specific moments — after marking an exam, at mid-sem, at end-of-sem. Usually at home, in a staff room, or at a desk — typically with at least intermittent connectivity. The case for full offline-first is weaker here than for the daily class register.

The PWA's connectivity story therefore phases:

**Phase 1 — Works on bad connections (v1, ships first).** The PWA caches the current ledger page so it loads with no signal. Entered scores are held in a small local buffer that retries on the next successful connection. A connection drop mid-entry does not lose work. A clear sync indicator shows the teacher which scores are server-confirmed and which are pending. **No conflict resolution, no extended offline session support, no promise that the teacher can disconnect for a day and come back.** This is honestly scoped and delivers most of the practical value.

**Phase 2 — Offline buffering for extended sessions (later, if demand surfaces).** Local IndexedDB store of the teacher's rosters and recent entries. A teacher can enter scores for a full class with no connectivity and sync when connectivity returns. Still single-device — no multi-device conflict resolution. The trigger to build this is real demand from teachers in low-connectivity areas, not speculation.

**Phase 3 — Full offline-first with multi-device sync (later still, if v2 proves the need).** The full architecture with conflict resolution, last-write-wins rules, and recovery from conflicting edits. The trigger is real evidence that teachers are working from two devices and hitting the conflict case, which is not the most likely actual workflow.

The marketing line for v1 is **"works on your phone, handles bad connections."** Not "works offline." The latter implies extended offline sessions we will not yet support, and over-promising on connectivity is the kind of expectation gap that creates angry users.

### 5.5 What the PWA does not do (v1)

To be precise about scope:

- No syncing across multiple devices of one teacher's edits made while offline on different devices simultaneously. (Phase 3.)
- No support for entering scores while disconnected for more than the few minutes a buffer holds. (Phase 2.)
- No offline access to historical semesters — only the current semester's ledger is cached.
- No PWA-specific features beyond what the web app does. The PWA is a form-factor optimisation, not a feature expansion.

## 6. The Vice Headmaster Academic progress view

A surface not previously specified: a dashboard for the **Vice Headmaster Academic** (or Head of Academic, depending on the school) showing **per-teacher, per-class entry progress** against the semester's milestones.

### 6.1 What it shows

For each teacher × class × subject the school runs:

| Column | Content |
|---|---|
| Teacher | Name and subject(s) they teach to this class |
| Class | Form, programme, e.g. "Form 2 Science" |
| Path | A, B, or C — which path the teacher chose this semester |
| Assignments | Count entered / expected, progress bar |
| Mid-semester exam | Entered (date) / not entered |
| End-of-semester exam | Entered (date) / not entered |
| Project work | Entered (date) / not entered |
| Portfolio | Entered (date) / not entered |
| STPSHS export ready | Yes (all five categories complete) / No (missing X) |
| Last activity | When the teacher last touched the ledger |

The view supports filtering by teacher, subject, form, programme, and submission status. The default sort is by "STPSHS export ready" status — at semester end, the Vice Headmaster wants to see which teachers are behind first.

### 6.2 Completion progress, not score surveillance

The crucial design discipline: this surface shows **whether** scores have been entered, not **what** the scores are. The Vice Headmaster sees that Mr. Owusu has entered all assignment scores and the mid-sem exam for Form 2A Mathematics — they do not see *what* those scores are at this level. The score values remain the teacher's domain until the semester is closed and the ledger flows to the parent report and STPSHS export.

This is the right posture for a tool that respects teacher autonomy over marks themselves. Accountability is on *progress against deadlines*, not on *every cell of every gradebook*. A Vice Headmaster who wants to inspect actual scores has to navigate to the gradebook itself — which logs the access, the same way Oversight's compliance record view does. The progress dashboard is a management view; it is not a surveillance view.

### 6.3 Surfacing at-risk submissions

The view highlights risks the Vice Headmaster needs to act on:

- **STPSHS window opens in less than 7 days, teachers not yet complete** — a high-severity flag, drives a follow-up message from the Vice Headmaster
- **Teacher has not touched the ledger in 14+ days during the semester** — medium severity, suggests the teacher may have left or be ill
- **Path C teacher entering scores significantly faster or slower than the class median** — low severity, possible data-quality concern (a teacher entering 40 scores in 5 minutes may be guessing; one entering nothing may be stuck)

These flags are the same anomaly-detection discipline the Oversight anomaly queue uses, applied at the school-internal level.

### 6.4 Cascading to the Headmaster

A roll-up view for the Headmaster shows the same data aggregated to "subjects with all teachers complete / partial / behind" — the Headmaster doesn't need per-teacher detail unless something is going wrong, but does want to know that English Year 1 has 4 of 5 teachers complete on the day STPSHS opens.

## 7. Versioned uploads and diff-flagging

This is the part of your proposal that's strategically most important, and the spec needs to be precise about it.

### 7.1 The model

A teacher using Path B uploads the ledger more than once per semester — typically:

- **First upload** at mid-semester (assignments-to-date, mid-sem exam, possibly partial project)
- **Second upload** at end-of-semester (everything, including the final entries and portfolio)

Each upload is a **version** of the ledger record. Versions are stored, never overwritten. The latest verified version is what feeds the downstream systems; earlier versions are retained for audit and for diff-comparison.

### 7.2 The diff logic

When a new upload supersedes an earlier one, Omnischools computes a cell-by-cell diff:

- **Cells blank in earlier version, populated in new version** → expected; new value accepted silently
- **Cells populated in both versions, values identical** → expected; no flag
- **Cells populated in both versions, values differ** → **flagged for teacher review**
- **Cells populated in earlier version, blank in new version** → flagged (suggests the teacher missed a row in the new ledger, or that the score has been removed deliberately — either way needs confirmation)

The flagging UI surfaces these as a "changes review" step the teacher works through before the new version is committed. For each flagged cell, the teacher sees the old value, the new value, and a one-tap "keep new" / "keep old" / "enter manually" choice. The reason for the change is recorded; recorded changes feed the audit trail.

### 7.3 Why this matters beyond convenience

The diff-flagging logic is the surface where Omnischools earns trust beyond just digitisation. A score that *changed* between mid-semester and end-of-semester is the case where errors and deliberate alterations both live — a teacher who legitimately corrected a mid-semester typo, but also potentially a teacher who quietly raised a student's mark for non-academic reasons. Surfacing these as a reviewed and reasoned set of changes:

- Protects the honest teacher (clear record of why a score was updated)
- Deters the dishonest case (changes are visible and timestamped)
- Provides an audit trail STPSHS and parent communications can reference

This is the small but meaningful integrity contribution Omnischools can make to the SHS assessment ecosystem. The paper ledger alone has none of this — a teacher can erase and rewrite a score with no record.

### 7.4 Diffing across paths

The diff logic also applies when paths cross — i.e., when a Path A teacher uploads a scan of their ledger at semester end as a verification step (which is a workflow some teachers may want). Omnischools compares the scan-extracted scores to the auto-compiled scores and flags differences the same way. This is *especially* valuable because it catches cases where the teacher wrote a different mark in their paper ledger than they entered in Omnischools — exactly the inconsistency that erodes trust in any digital system that runs in parallel with paper.

## 8. What flows out of the ledger

Once the term's ledger is finalised (Path A complete, or Path B latest version verified), four downstream flows draw from it:

### 8.1 STPSHS export (the main compliance flow)

The five categories map to STPSHS's modes of assessment per semester. Omnischools generates the **printable per-teacher score sheet** (per the earlier STPSHS integration spec) pre-filled with the verified totals. The teacher uses this sheet to enter scores into STPSHS one student at a time — much faster and less error-prone than computing the totals fresh from a paper ledger during the STPSHS window.

If WAEC eventually opens a bulk-upload or API path, this same data flows automatically. The ledger is the source either way; the sheet is just the manual-entry interface to STPSHS until the API exists.

### 8.2 Parent report cards

Term reports for parents flow from the ledger automatically — the five category scores, the weighted total, and the teacher's qualitative comment. Parents see exactly the structure WAEC and NaCCA recognise, in the format they will encounter again on the WASSCE transcript.

### 8.3 Oversight aggregation

For GES Oversight, the ledger feeds the *internal continuous performance* section of the academic performance surface (per Decision 2's distinction between external WAEC and internal/continuous). The coverage caveat already specified — only schools using the Omnischools gradebook are visible — applies here unchanged.

### 8.4 The Omnischools school-side analytics

Within the school, the ledger feeds the readiness predictor (mock-exam comparison), the Head-of-Department review of teacher gradebook consistency, the parent-teacher meeting preparation views, and the student detail page's performance section.

## 9. What this changes upstream

The STPSHS integration spec's section 7 ("Implications for the four affected Omnischools Senior surfaces") needs to be revised in light of this. Specifically:

- `schoolup-wassce-subject-teacher.html` is no longer "the teacher's daily gradebook" — it is **the SHS score ledger view**, with the five-category structure, the path-A/path-B choice, the upload/diff workflow, and the STPSHS-export affordance.
- The Omnischools Senior gradebook *is* the ledger, not something separate from it. There is one assessment record per (student × subject × term), with five category scores and an audit history.

Similarly, the operational schema in the analytics spec needs revising. The `fact_performance_internal` table currently models a generic `credit_rate`; it should be replaced with per-category scores (`asgn_score`, `mid_sem_score`, `end_sem_score`, `project_score`, `portfolio_score`) plus the computed weighted total and the weights used. This makes the analytics DB structurally match how teachers actually record marks.

I will not rebuild these surfaces here — they are pending the WAEC verification call and the broader rework that the teacher's feedback now informs. But the spec is recorded so that rework happens against this design, not against the older "STPSHS-shaped modes of assessment" guess.

## 10. The open question this *answers*

The STPSHS integration spec's open question — "does STPSHS accept bulk upload of assessment scores?" — is now answered indirectly: per the teacher's report, no, single-entry only from the teacher's interface. The earlier spec's section 8 should be updated to record this finding, and the four options from the follow-up analysis (printable score sheet, browser extension, formal WAEC API agreement, position around the constraint) carry forward.

The right next action remains a formal WAEC conversation, but **the ledger spec above ships independently of that conversation**. The score sheet, the auto-compile, the scan-and-extract, the versioned upload diff — none of this needs WAEC's cooperation. The ledger is the school's own record; Omnischools turning it into a verified digital artifact is a school-side service that makes STPSHS submission easier without requiring API access.

If the WAEC API conversation succeeds, the ledger data flows to STPSHS programmatically. If it doesn't, the ledger data populates the printable score sheet for manual entry. The ledger spec is robust to either outcome.

## 11. Build sequence

The ledger spec sits ahead of the STPSHS API question in the build order. The PWA and the Vice Headmaster view interleave with the path implementations:

0. **Item zero · the academic period configuration tables** (`ref_academic_period_config`, `academic_period`). Foundational, ships in the same migration as `senior_score_ledger`. Defaults seeded from the unified onboarding wizard: 3 terms for Basic-only schools, 2 semesters for Senior-only schools, both configs for combined Basic-and-Senior schools. A small ETL job reads the GES academic-calendar PDF on annual release to refresh seeded dates. Nothing else in the build sequence runs without this — `period_id` is the third key on every score-ledger row, and surface labels read from `academic_period.period_label`.
1. **First**, build the five-category SHS gradebook (the data model and the web UI for it) and the auto-compile path (Path A). Clean operational module; ships standalone.
2. **Second**, build **Path C — direct digital entry** in the same web UI. Path C is essentially Path A's view in blank-grid mode, so it is cheap to add once Path A's view exists. This is the platform the PWA will optimise.
3. **Third**, build the **Vice Headmaster progress view**. Wraps Paths A and C as soon as both are live, and provides the management visibility the school needs immediately — well before Path B's OCR work is complete.
4. **Fourth, in parallel**, build **Path B — scan and extract** with verification-first UI. The OCR work is the larger technical lift; budget realistically. Once Path B exists, the progress view extends to cover Path B teachers as well.
5. **Fifth**, the **PWA phase 1** — installable form-factor optimisation with bad-connection handling. Builds on Path C's web UI; reuses the same data layer. The marketing line is "works on your phone, handles bad connections" — not "works offline."
6. **Sixth**, design and (optionally) commission the printed **Omnischools ledger book**. Low-priority engineering, high-marketing-value. Pairs with Path B.
7. **Seventh**, the **versioned upload + diff logic**. Builds on Path B; ships once Path B is stable. Also catches cross-path inconsistencies (Path C scores vs. later-scanned ledger).
8. **Eighth**, the **STPSHS printable score sheet generator** (the manual-entry helper). Trivial once the ledger is captured digitally — a single PDF template populated from the gradebook record.
9. **Later — PWA phase 2** if real demand surfaces for extended offline sessions. Local IndexedDB store, sync queue on reconnect, single-device only. Trigger is evidence from real teachers in low-connectivity areas, not speculation.
10. **Later still — PWA phase 3** if multi-device conflict cases prove real. Full offline-first with conflict resolution. Trigger is real evidence, not the marketing line.
11. **The WAEC API conversation happens on its own timeline.** If it succeeds, the export becomes machine-to-machine instead of printable. The rest of the system is unchanged.

The first eight items together are the v1 SHS Senior product. Items 9 and 10 are reserved capacity for if the connectivity story needs to evolve; item 11 is the regulator relationship that runs in parallel.

---

**End of spec. No blocking external dependencies for the core capture-and-compile work; the WAEC API conversation remains separate and longer-horizon.**
