# INCR-55b · Parent PTA Records & Directory — Surface Map (Module 4.7)

**Author:** Lucy (design cartographer) · **Status:** design spec, ready for the implementer (Claude Code).
**Increment:** INCR-55b — the RECORDS & DIRECTORY half of the parent-portal PTA tab. Appends **two sections**
below the shipped 55a participation slice (*Your PTAs · Your dues · Your attendance*) in
`app/(parent)/pta/page.tsx`. **No new page, no new nav, no new migration** — reader projections + RLS
(`parent_readable_minutes_ids`, `parent_scope` on `pta_officer`) only.

**This is a FOCUSED map: the PARENT-VISIBLE projection only.** It maps two STAFF surfaces down to what a
parent sees per the spec's public/officer-only split. It is **not** a full staff-surface map — the
drafting view, the assign drawer, the matrix admin controls, attendance aggregates, and the editorial
"why classify" panels are all **out of scope and must not render for a parent**. Every officer-only field
is flagged in an **STRIP** table so the implementer can hold the column-guard line.

## Source surfaces (visual source of truth — projected, not replicated 1:1)

| Surface file (goofy-poitras worktree, untracked) | Staff role it serves | What the parent projects from it |
|---|---|---|
| `Surfaces/schoolup-pta-officer-matrix.html` | Admin / PTA-Chair officer matrix (all tiers, assign/edit/vacancy audit) | **Section A — Officers.** Current holders of the parent's OWN PTAs: `{office, holder name, term, PTA name}`. |
| `Surfaces/schoolup-pta-meeting-minutes.html` | Secretary drafting view + validator + distribution | **Section B — Adopted minutes.** ADOPTED minutes of the parent's PTAs: agenda narratives, resolutions, action items, `quorum_met`. |

**Spec authority:** `docs/senior-build-plan.md` → INCR-55 **R478** (adopted minutes public/officer split) +
**R479** (officer matrix projection). R479 **NARROWS** R429/OC1's literal "tenant-wide" officer read to
**membership-scoped** (`ended_at IS NULL AND pta_id ∈ parent_pta_ids`) — 🔴 owner-flagged in the spec; this
map builds to the narrowed R479 form.

## Composition — where these two sections land

Exactly at the marker already left open in `app/(parent)/pta/page.tsx:65`:

```
<Memberships … />   ← 55a
<Dues … />          ← 55a
<Attendance … />    ← 55a
<Officers … />      ← 55b · Section A  (NEW)
<AdoptedMinutes … />← 55b · Section B  (NEW)
```

Same `<section className="…">` grammar, same `space-y-6` stack, same honest-empty discipline. The child is
resolved from the SESSION (never a URL id); both readers run under `withParentScope` only (never
`withSchool`), mirroring `lib/parent/parent-pta-data.ts`. **Read-only by construction — no server action.**

## Shared grammar reuse (do NOT reinvent — extend 55a)

- **Section shell** (matches `Dues`/`Attendance`): `overflow-hidden rounded-xl border border-border bg-surface`,
  header `border-b border-border bg-bg px-6 py-[18px]` with `h3.font-display text-base font-medium text-navy`
  + `div.text-[11px] text-navy-3` sub-caption.
- **Tier chip** — reuse the file's existing `TIER_CHIP` / `TIER_LABEL` maps verbatim (`FORM`→`bg-navy text-bg`
  "Form"; `HOUSE`→`bg-gold-bg text-navy` "House"; `GENERAL`→`bg-gold text-navy` "General"). Chip =
  `inline-flex items-center rounded-pill px-2.5 py-[3px] text-[11px] font-semibold`.
- **Pill base:** `rounded-pill … text-[11px] font-semibold` (as in `STATUS_PILL`).
- **Fonts:** `font-display` (Fraunces) for names/titles/office labels/resolution nos; `font-body`
  (Manrope) for narrative/labels/pills; `font-mono` (JetBrains Mono) for dates/vote counts. Empty/missing =
  em-dash `—` in `text-navy-3`, never `0`/`N/A`.
- **Dates:** reuse `parentLongDate` (`lib/wassce/parent-copy.ts`) → "14 May 2026" (no time), rendered in the
  55a idiom `font-mono text-xs … text-navy-3`. Officer terms use the same helper.
- **No-alpha discipline** (repo memory `no-alpha-token-opacity`): every token below is a **solid** token
  (`bg-navy`, `text-bg`, `bg-warn`, `text-green`, `bg-green-bg`, `bg-terra-bg`, `bg-gold`). **No slash-opacity
  on raw-hex tokens** (`text-bg/70` renders nothing). `bg-warn` / `text-warn` / `warn-bg` are wired in
  `tailwind.config.ts` (verified). Verify the classification chips in the **live preview**, not the build.

---

# Section A — Officers (from `schoolup-pta-officer-matrix.html` · R479)

## A.0 — Projection rule (the column guard)

Parent sees **CURRENT holders only** (`ended_at IS NULL`) of **THEIR OWN PTAs only** (`pta_id ∈
parent_pta_ids`). Each projected row is exactly:

```ts
// FROZEN KEY-SET (R479) — mirror the parent-pta-data.ts frozen-shape discipline.
// NEVER project electionRef / endReason / contact / holderUserId / the holder's child-class caption.
interface ParentPtaOfficer {
  ptaName: string;      // reuse the 55a ptaNameFor() derivation (General PTA / "{class} PTA" / House PTA)
  tier: ParentPtaTier;  // FORM | HOUSE | GENERAL — for the group chip + ordering
  office: string;       // the STORED office label (OC3 data, school-configurable) — NOT a hardcoded enum
  holderName: string;   // server-resolved display name STRING; public governance fact
  term: string;         // "{parentLongDate(start)} → {parentLongDate(end)}"; ex-officio → "While in post"
  isYou: boolean;       // reader derivation: row.personUserId === session userId; project the BOOLEAN, never the id
}
```

RLS is row-level and cannot mask a column — **this frozen key-set is the only guard.** A confidential field
(`election_ref`, `end_reason`, contact, the officer's child's class) spread onto this shape changes the
key-set and must red `parent-pta.test.ts`, not leak in production.

## A.1 — Section shell + copy

| Element | Copy | Token / class |
|---|---|---|
| Section wrapper | — | `overflow-hidden rounded-xl border border-border bg-surface` |
| Header title | **PTA officers** | `h3.font-display text-base font-medium text-navy` |
| Header sub-caption | Who leads the PTAs your family belongs to | `text-[11px] text-navy-3` |

(Editorial voice mirrors "What the PTA has billed for your family" / "your own attendance only" from 55a —
scoped, plain, no jargon. "Officers" not "matrix"; the parent never sees the word *matrix*.)

## A.2 — Group header (one per PTA the parent belongs to)

Officers **group by PTA**. A parent belongs to at most ~3 PTAs (their child's Form, their child's House,
General), so there are at most 3 groups. Reuse the `Memberships` row grammar for each group header:

- `div.font-display text-[15px] font-medium text-navy` = **`ptaName`** (from `ptaNameFor`)
- tier chip (right-aligned) = `TIER_LABEL[tier]` with `TIER_CHIP[tier]`
- separator between groups: `border-t border-border`

## A.3 — Holder row (office · name · term)

`grid grid-cols-[1fr_auto] items-center gap-4 border-b border-border px-6 py-3.5 last:border-b-0` (the Dues
row idiom). Left column stacks office over holder; right column holds the term.

| Sub-element | Content | Class |
|---|---|---|
| Office label | `office` (e.g. **Chair**, **Vice-Chair**, **Secretary**, **Treasurer**, **Financial Secretary**) | `font-display text-[15px] font-medium text-navy` |
| Holder name | `holderName` (e.g. "Mr Emmanuel Mensah-Yeboah") | `text-xs text-navy-3` sub-line |
| Term | `term` — "14 Oct 2025 → 12 Oct 2027" | `font-mono text-xs text-navy-3` (right col) |

**Office vocabulary** (the surface's canonical seed set — the labels come from stored `officer_roles`, do
NOT hardcode): General PTA — Chair, Vice-Chair, Secretary, Assistant Secretary, Treasurer, Financial
Secretary, Organising Secretary, Headmaster *(ex-officio)*. House PTA — Chair, Vice-Chair, Secretary
*(Housemaster/Housemistress · ex-officio)*, Treasurer. Form PTA — Chair, Vice-Chair, Secretary *(Form
Master/Form Mistress · ex-officio)*, Treasurer.

## A.4 — Your own hats ("You" pill)

The spec calls for noting **the parent's OWN hats**. Surface it as a gold **You** pill on the parent's own
officer rows (rows where `isYou === true`), reusing the pill base:

- Pill: `inline-flex items-center rounded-pill bg-gold px-2.5 py-[3px] text-[11px] font-semibold text-navy`
  · text **You** · sits inline after the office label.

This IS the own-hats treatment (a signed-in Treasurer sees "Treasurer · You" under General PTA). No separate
"multi-hat" callout — that card in the surface is admin-only (see STRIP). Optionally the same fact can badge
the 55a "Your PTAs" card, but the "You" pill in this section is the single source; don't duplicate.

## A.5 — Ex-officio holders

Ex-officio rows (Headmaster on General; Housemaster/Form Master as Secretary) ARE current holders
(`ended_at IS NULL`, auto-attached to the staff role) and **do project** — the holder is a staff name, which
is a public governance fact (who secretaries/chairs the PTA), not contact PII. Render:

- office label carries the "(ex-officio)" suffix from the stored label; **term** = "While in post" (their
  `term_end` is null — the surface's "Permanent (while in post)"). No "non-voting" / "auto-reassigns" /
  "read-only" meta — those are admin affordances (STRIP).

## A.6 — Vacancies do NOT render (structural)

The parent read projects **rows** (`ended_at IS NULL`), not office **slots**. A vacant office = the *absence*
of a current-holder row, so it simply doesn't appear. **There is NO "Vacant" pill, no red vacancy row, no
"awaiting by-election", no "63 days vacant" in the parent projection.** The `ended_at`-in-predicate
structurally defends this. Do not enumerate `officer_roles` config to synthesise empty slots.

## A.7 — OFFICER-ONLY fields on this surface — **STRIP** (must NOT reach the parent)

| Surface element | Where in `schoolup-pta-officer-matrix.html` | Why officer-only |
|---|---|---|
| `election_ref` / "Elected · AGM 2025" / basis-of-appointment | "Last edit" col + assign drawer "Election reference" | R479 — audit field, officer-only |
| `end_reason` / "Previous holder Mr Nkrumah relocated" / "Resigning June 2026 · son completes Form 3" | vacancy row + warn pmeta | R479 — `end_reason`, officer-only; also a departed holder ≠ current row |
| Holder's own child-class caption — "Parent · Form 3 General Science B" | `.person-cell .role-tag` | reveals another family's child class; NOT in `{office,name,term,PTA}` |
| PARENT / TEACHER / EX-OFFICIO `tag-mini` | `.person-cell .role-tag .tag-mini` | omit; ex-officio nature already carried by the office label |
| Multi-hat callout — "+2 other PTA roles", "One parent, three concurrent roles", the hat chips for another parent | `.multi-hat-card` | cross-PTA info about ANOTHER person; the parent's OWN hats = A.4 only |
| Vacancy state (red rows, "Assign", "by-election", days-vacant) | `.row-vacant`, `.tier-section` vacant minis | see A.6 — no slot enumeration |
| Term progress bar + "7 months in · 17 months remaining" | `.term-cell .progress`, `.pmeta` | derivable but not in the projection; keep the plain date range only |
| Filters / "+ Assign officer" / "Export to PDF" / "Edit" / completion counts ("22 / 24 filled") | header + `.filter-bar` + `.action-cell` + `.completion` | admin controls / aggregates |
| The whole Assign drawer (§02 of the surface) | `.drawer-mock` | write path — parent read-only |

## A.8 — Empty state (honest zero)

If the parent has PTAs but no current-holder rows are visible (offices unfilled, or none recorded):

> **No PTA officers have been recorded for your PTAs yet.**

Class: `px-6 py-6 text-[13px] leading-relaxed text-navy-2` (the Dues/Attendance empty idiom). If the parent
has no PTAs at all, this section can be omitted entirely (the 55a `Memberships` empty already tells that
story) — don't stack two "you have no PTA" messages.

## A.9 — Ordering

Groups: match 55a `TIER_RANK` — **FORM (0) → HOUSE (1) → GENERAL (2)**, then `ptaName` A–Z. Within a group,
order offices by a canonical office rank (Chair, Vice-Chair, Secretary, Assistant Secretary, Treasurer,
Financial Secretary, Organising Secretary, then ex-officio last — the surface's badge-num 1..7 + EX order).
Own rows are NOT floated to the top; the "You" pill is enough.

---

# Section B — Adopted minutes (from `schoolup-pta-meeting-minutes.html` · R478)

## B.0 — Projection rule (adopted only + the column guard)

Parent sees minutes where **`status = 'ADOPTED'` AND `meeting.pta_id ∈ parent_pta_ids`**
(`parent_readable_minutes_ids`). **Any DRAFT / CHAIR_REVIEW minutes are invisible** — even if the meeting
happened, un-adopted minutes never appear. The projected subtree (`pta_minutes` → `pta_agenda_item` →
`pta_action_item` / `pta_resolution`) is:

```ts
// FROZEN KEY-SETS (R478). Public = narratives + resolutions + actions + quorum_met boolean.
// NEVER project attendance aggregates, per-parent attendance, action deadlines, or any DRAFT/CHAIR_REVIEW row.
interface ParentPtaMinutes {
  ptaName: string;            // reuse ptaNameFor()
  tier: ParentPtaTier;
  meetingLabel: string;       // pta_meeting.meetingType (e.g. "Term 2 Regular Meeting")
  meetingDateLabel: string;   // parentLongDate(meeting.meetingDate)
  quorumMet: boolean;         // the ONLY attendance-derived fact that is public
  agendaItems: ParentPtaAgendaItem[];
  actionItems: ParentPtaActionItem[];
  resolutions: ParentPtaResolution[];
}
interface ParentPtaAgendaItem {
  order: number;
  title: string;
  classification: "Discussion" | "Action" | "Resolution";
  narrative: string;          // the ai-body text; final (no draft/textarea/in-progress states)
}
interface ParentPtaActionItem {
  description: string;
  owner: string;              // owner display name + role caption ("Mrs O. Sarpong · Treasurer")
  status: "Pending" | "Completed";
  // NEVER: deadline / countdown / SMS-reminder (R478 lists description, owner, status only)
}
interface ParentPtaResolution {
  resolutionNo: string;       // "FORM-2-GA-A-2026-Q2-001"
  title: string;
  body: string;               // "RESOLVED THAT …" full text
  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
  result: "PASSED" | "NOT_PASSED";
  binding: boolean;
}
```

## B.1 — Section shell + copy

| Element | Copy | Token / class |
|---|---|---|
| Section wrapper | — | `overflow-hidden rounded-xl border border-border bg-surface` |
| Header title | **Adopted minutes** | `h3.font-display text-base font-medium text-navy` |
| Header sub-caption | Decisions from meetings of your PTAs, once adopted | `text-[11px] text-navy-3` |

## B.2 — Per-minutes header + quorum pill

One block per adopted minutes (card or `border-b` row group). No preamble attendance line, no venue/chair
re-statement (chair/secretary already live in Section A — don't re-derive convened_by, which is staff PII
per R480). Header carries only:

| Sub-element | Content | Class |
|---|---|---|
| Meeting label | `meetingLabel` | `font-display text-[15px] font-medium text-navy` |
| PTA name | `ptaName` | `text-xs text-navy-3` |
| Date | `meetingDateLabel` | `font-mono text-xs text-navy-3` |
| Quorum pill | **Quorum met** / **Quorum not met** | met → `rounded-pill bg-green-bg px-2.5 py-[3px] text-[11px] font-semibold text-green`; not met → `bg-warn-bg text-warn` |

The quorum pill is the **only** attendance fact that survives the projection. The surface's "22 parents
present (need 17)" numeric detail is STRIPPED — pill carries the boolean, nothing more.

## B.3 — Agenda items

Static read list (no drafting states). Each item, reusing the surface's `agenda-item` grammar minus the
textareas/status-badges:

- Container: `rounded-lg border border-border bg-bg px-5 py-4 … space-y`
- Number badge: `order` in `w-[26px] h-[26px] rounded-md bg-navy text-bg … font-display text-[11px] font-bold`
- Title: `font-display text-[15px] font-medium text-navy`
- **Classification chip** (each item shows exactly one — always the "selected" style, one per item):
  - **Discussion** → `bg-navy text-bg`
  - **Action** → `bg-warn text-bg`
  - **Resolution** → `bg-green text-bg`
  - chip base: `rounded-pill px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.04em]`
- Narrative: the `narrative` text, `text-[13px] leading-relaxed text-navy-2`, `<b>` emphasis → `text-navy`.

## B.4 — Action items

R478 public fields = **description, owner, status only** (no deadline/countdown/SMS). A simple list (drop the
staff `deadline` + `countdown` columns entirely):

| Sub-element | Content | Class |
|---|---|---|
| Description | `description` | `text-[13px] leading-relaxed text-navy` |
| Owner | `owner` — "Mrs O. Sarpong · Treasurer" | `text-xs text-navy-3` |
| Status pill | **Pending** / **Completed** | Pending → `rounded-pill bg-gold-bg px-2.5 py-[3px] text-[11px] font-semibold text-gold`; Completed → `bg-green-bg text-green` |

## B.5 — Resolutions

Reuse the surface's green `resolution-card` — this is the most visually distinct block and it ports fully
(all its fields are R478-public):

- Card: `rounded-xl border-[1.5px] border-green bg-green-bg px-6 py-5`
- Resolution no: `resolutionNo` → `text-[11px] font-bold uppercase tracking-[0.12em] text-green`
- Title: `title` → `font-display text-base font-semibold text-navy`
- Binding tag (only if `binding`): **Binding** → `rounded-pill bg-green px-2.5 py-1 text-[9px] font-bold tracking-[0.06em] text-bg`
- Body: `body` ("RESOLVED THAT …") → `bg-surface border-l-[3px] border-green rounded-r-lg px-3.5 py-3 text-[13px] leading-relaxed text-navy-2`, `<b>` → `text-navy`
- Vote row: `grid grid-cols-4 gap-3 border-t border-green pt-3` — four tiles:
  - **In favour** → val `font-display text-xl font-semibold text-green`
  - **Against** → val `text-terra`
  - **Abstain** → val `text-navy-3`
  - **Result** → `result` label: **PASSED** → `text-green font-display italic`; **NOT PASSED** → `text-terra font-display italic`
  - tile label: `text-[9px] uppercase tracking-[0.1em] text-navy-3 font-bold`
  - vote counts render in mono-friendly weight; use `votesFor/Against/Abstain` integers.

**NOT-PASSED variant:** the surface only shows a PASSED example. Spec requires both — when `result ==
"NOT_PASSED"`, the Result tile reads **NOT PASSED** in `text-terra`. (Card border/bg stay green as the
resolution container; only the Result tile signals the outcome. Optional: swap card accent to terra for
not-passed — flag to owner, default keep green container + terra result.)

## B.6 — OFFICER-ONLY on this surface — **STRIP** (must NOT reach the parent)

| Surface element | Where in `schoolup-pta-meeting-minutes.html` | Why officer-only |
|---|---|---|
| Any DRAFT / CHAIR_REVIEW minutes | whole surface is a DRAFT view ("DRAFT · auto-saved", lifecycle pill "Minutes · drafting") | R478 — only `status='ADOPTED'` projects |
| Preamble attendance line — "21 parents present, 1 late · 10 absent · 3 teachers present" | `.tape-row` Attendance | numeric attendance aggregate |
| Quorum numeric detail — "22 parents present (need 17)" | `.tape-row` Quorum | keep boolean only (B.2); strip the count |
| "Who was there" side card — 22 / 3 / 10 / 69% | `.side-card.attendance` | numeric attendance aggregates (RLS COUNT sees only own row → NEVER aggregate for a parent) |
| "Officers in the room" side card — per-officer present ✓ | `.side-card` "For voting quorum" | per-person attendance |
| Action **deadline / countdown / "SMS reminder day-before"** | `.deadline-cell` | not in R478 public action fields (description/owner/status only) |
| Agenda `ai-status` (Discussed / Drafting / Not yet drafted) + textareas + "5 of 7 classified" | `.ai-status`, `.minutes-textarea`, badges | drafting state; adopted items are final |
| Distribution channels card (SMS / PDF / email / GES toggles) | `.distrib-card` | Secretary control |
| Validation-before-submit card (checks passed 5/7 etc.) | `.side-card` "Checks passed" | Secretary drafting |
| Footer actions — "Submit for Chair review", "Preview as PDF", "Save & resume" | `.foot-summary` | write path |
| Editorial §02 "Why three classifications" | `.dvr-grid` | staff explainer, not a parent record |
| Chair/Secretary/venue preamble re-statement | `.context-bar`, `.tape-row` Chair/Secretary/Venue | omit (chair/secretary already in Section A; `convened_by` is staff PII per R480) |

## B.7 — Empty state (honest zero)

> **No adopted PTA minutes yet.** Once minutes from a meeting are adopted, they&apos;ll appear here.

Class: `px-6 py-6 text-[13px] leading-relaxed text-navy-2`. Note this stays empty even when meetings have
occurred — un-adopted (DRAFT/CHAIR_REVIEW) minutes never surface, so "no adopted minutes" is honest and
expected shortly after a meeting.

## B.8 — Ordering

Minutes: most-recent meeting first (`meeting.meetingDate` DESC — matches the 55a attendance ordering). Within
a minutes block: agenda items by `order` ASC; then Action items; then Resolutions (numbered order). Reads
top-to-bottom as a meeting record.

---

# Responsive / PWA

The parent portal is a single responsive page (`mx-auto max-w-[980px]`, inner `px-7`) — there is no separate
PWA build. Both new sections stack in the existing `space-y-6` column:

- Officer group headers + holder rows: `grid grid-cols-[1fr_auto]` collapses gracefully; term wraps under the
  office/name stack on narrow widths — acceptable.
- Resolution **vote row** `grid grid-cols-4` is the one tight spot on a phone. Collapse to `grid-cols-2`
  (2×2) below `sm`. Flag: verify the four vote tiles don't overflow at 360px — the known
  `no-alpha-token-opacity` live-preview check applies to the classification/quorum/result pills too.

# Cross-module hooks (design commitments to preserve — read-only display, do NOT wire here)

1. **Adopted binding financial resolution → "Your dues" (55a).** A binding resolution "Treasurer mandated to
   issue invoices … GHS 150/student" is the *governance origin* of a dues line the parent already sees in the
   55a `Dues` section. Preserve the narrative link (a parent can read the decision here and see the resulting
   charge there); the parent tab does not create the fee category — that's the staff resolution→fee-category
   hook (deferred, INCR-54 lineage).
2. **`quorum_met` ↔ "Your attendance" (55a).** The quorum pill (B.2) is the transparency bridge to the
   attendance slice: a parent who was marked **Absent** in "Your attendance" can still read *what was decided*
   in their absence (adopted minutes) — the whole point of opening adopted minutes to parents.
3. **Ex-officio officer ↔ staff role.** Headmaster (General), Housemaster (House Secretary), Form Master (Form
   Secretary) auto-attach to the staff role; the parent sees the current holder, and it silently re-points
   when the staff role changes. Read-only, no parent action.

# Copy index (quick reference)

| String | Location |
|---|---|
| PTA officers | A.1 header title |
| Who leads the PTAs your family belongs to | A.1 sub-caption |
| You | A.4 own-hat pill |
| While in post | A.5 ex-officio term |
| No PTA officers have been recorded for your PTAs yet. | A.8 empty |
| Adopted minutes | B.1 header title |
| Decisions from meetings of your PTAs, once adopted | B.1 sub-caption |
| Quorum met / Quorum not met | B.2 pill |
| Discussion / Action / Resolution | B.3 classification chips |
| Pending / Completed | B.4 action status pill |
| Binding | B.5 binding tag |
| In favour / Against / Abstain / Result | B.5 vote tiles |
| PASSED / NOT PASSED | B.5 result |
| No adopted PTA minutes yet. Once minutes from a meeting are adopted, they'll appear here. | B.7 empty |
