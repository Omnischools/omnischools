# VLC Student Journal — Surface Map (INCR-43a · Module 4.5 / surface 04 · the CASEWORK layer)

**Author:** Lucy (design cartographer) · **Status:** design spec, ready for the implementation engineer.
**Scope of this map:** the FOUR casework surfaces on `Surfaces/schoolup-vlc-student-journal.html` —
**journal entries + FM pastoral notes + PG observations + the case-file summary** — plus the derived
scaffolding they hang on (student hero, year strip, 22-session timeline). This is a **NEW confidential
page** `/senior/vlc/journal/[studentId]`; there is nothing built here yet (42a shipped the operational
register, 42b lit the confidential flag *on* that register). 43a builds the per-student casework document
those flags point into.

**This is a CONFIDENTIAL, STAFF-FACING increment — the same sensitivity class as 42b, one page deeper.**
READ = WRITE = **FM(own-class) + Dean of Students ONLY** — the already-cleared 42b `canAccessPastoralFlag`
gate, reused whole. **ADMIN barred. HM excluded** (HM's only VLC read is the *character paragraph*, which is
**INCR-43b → OUT OF SCOPE**). **NO student and NO Peer Guide login/read/write anywhere** — the Form Master
records everything; a Peer Guide is a named `observed_by` **data attribution**, never a user (exactly the 42b
`surfaced_by` idiom). The **whole page is behind the pastoral gate**: a non-gated viewer (HM / ADMIN /
other-class FM / PG / student / parent) sees **NOTHING** — not a redacted stub, `notFound()`.

**HARD BOUNDARY — 43a builds the four casework tables + their read/append/edit affordances. The
character-paragraph card is INCR-43b → OMIT-NOT-FAKE (§Ω).** AND its whole *"auto-drafted / auto-generated /
regenerates after each session"* framing is **owner-#6-overridden** (the paragraph is **FM-authored, no AI**) —
so even 43b will not auto-generate; 43a must omit the card **and** never imply a working auto-summary anywhere
(no keyword detection, no theme extraction, no "generated from N entries" copy).

Rule where surface and spec disagree: **spec/owner wins on logic, surface wins on visual presentation.**
Drift called out inline + collected at the end (§Open questions).

## Source

| File | Role |
|---|---|
| `Surfaces/schoolup-vlc-student-journal.html` — CSS L52–207; **§01 body** L349–587 (the four casework blocks); the visibility matrix L600–608; the editorial L613–643 | **PRIMARY** for casework copy, fields, states, tokens. |
| `components/vlc/pastoral-flag.tsx` (42b) | **REUSE ANCHOR** — the terra confidential-panel treatment: `bg-terra-bg`/`border-terra`, the `FM + DEAN ONLY` pill, "Surfaced by" honesty fix, "Mark resolved", the `RaiseForm` append pattern, the no-alpha SOLID-token discipline. |
| `components/vlc/chrome.tsx` (`SectionHead`, `SumCard`) | **REUSE** — block headers + the year-strip summary cards. |
| `lib/vlc/authz.ts` (`canAccessPastoralFlag`, `canWritePastoralFlag`), `lib/access.ts` (`VLC_PASTORAL_READ_ROLES`/`_WRITE_ROLES` = `[FORM_MASTER, DEAN_OF_STUDENTS]`, `hasAnyRole`) | **REUSE WHOLE** — the page + every append/edit action re-checks the SAME gate 42b shipped. |
| `lib/vlc/pastoral-data.ts` (`shortNameOf`, `timeLabel`, the `server-only` own-class WHERE) | **REUSE PATTERN** — the confidential reader idiom for the journal-data readers. |
| `app/(app)/senior/vlc/sessions/[classId]/[date]/page.tsx` (42a/42b page: `Crumb`, `FootStat`, the gated-callout wiring), `db/schema/vlc.ts` L354–589 (`vlc_session*`, `vlc_pastoral_flag`) | **REUSE + EXTEND anchors** (§5, §6). The 22-session timeline reads 42a session data + 42b flags. |
| `components/app/sidebar.tsx` L110–119 (the single flat **"Student support"** item), `components/vlc/vlc-tabs.tsx` (Setup · Peer Guides · Sessions) | Nav conventions (§5). |

**Owner decisions LOCKED for 43a (carried from the task brief):** confidential + staff-facing; READ = WRITE =
FM(own-class) + Dean; ADMIN barred, HM excluded (paragraph-only = 43b); **no student/PG user** (FM records,
PG/student are data attributions); the character-paragraph card + its auto-generation are **43b + owner-#6 →
omit-not-fake**.

---

## 0. Token & type reference (the casework delta — three confidential panel families)

Same `:root` as every Senior surface. 43a introduces **three tinted confidential panel families** beyond 42b's
lone terra callout. **All are the no-alpha trap** (repo memory `no-alpha-token-opacity`) — translate every tint
to a **SOLID** token, never Tailwind slash-opacity. Verify tints in the **live preview**, not the build.

| Panel / element | Surface tint | Tailwind (SOLID — the mandated translation) | Type |
|---|---|---|---|
| **Journal entry** `.entry` | `bg-surface` + `border-border`; left edge `border-l-[3px]` in `--terra` / `--gold` / `--green` per session tone | `bg-surface border-border`, `border-l-terra` / `border-l-gold` / `border-l-green` | reflection body = **Fraunces** 14px `text-navy`; meta = Manrope; num-pill + dates + word-count = **JetBrains Mono** |
| **Journal entry (absent marker)** `.entry.absent-marker` | `bg-terra-bg` + dashed `border-terra` | `bg-terra-bg border border-dashed border-terra`, `text-terra` | Manrope 11px |
| **FM pastoral note** `.fm-note` | `bg-gold-bg` + `border-gold-soft` 1.5px + `border-l-gold` 3px | `bg-gold-bg border-[1.5px] border-gold-soft border-l-[3px] border-l-gold` | h5 = Fraunces, `text-gold` `<em>`; body Manrope 12px `text-navy-2`; **`FM + DEAN` pill** = `bg-gold text-navy`; `when` = **JetBrains Mono** |
| **PG observation** `.pg-obs` | `bg-bg` + `border-l-[3px] border-l-navy-3` | `bg-bg border-l-[3px] border-l-navy-3`, avatar `bg-navy text-gold` | `by` Manrope 11px bold; text 11px **italic** `text-navy-2`; `when` = **JetBrains Mono** |
| **Case-file summary strip** `.pastoral-context` | `bg-terra-bg` + `border-terra` 1.5px (the 42b callout family) | `bg-terra-bg border-[1.5px] border-terra` — **identical to the 42b `pastoral-flag.tsx` ground** | h4 Fraunces + `text-terra` `<em>`; body Manrope 12px `text-navy-2`, `<b>` `text-navy`, `<em>` = Fraunces italic `text-terra`; **`FM + DEAN ONLY · NOT VISIBLE…` pill** = `bg-terra text-bg` |
| **Student hero** `.student-hero` | navy gradient + `rgba(232,212,184,0.7)` sub-text | `bg-navy text-bg`; **SOLID `text-gold-soft`** for the muted meta (NOT `text-gold-soft/70`) — the 42a focus-banner precedent | h2 Fraunces + `text-gold` `<em>`; **`PASTORAL · ACTIVE CASE` tag** = `bg-terra text-bg` |
| **Character-paragraph card** `.char-card` | navy + `rgba(255,255,255,0.04)` | — | **INCR-43b → OMIT (§Ω); its alphas are irrelevant, do not port** |

**No-alpha translation is mandatory, not cosmetic.** The surface CSS leans on `rgba()` in the hero
(`rgba(232,212,184,0.7)`), the entry prompt border (`--gold-soft`), and the char-card. Every ported tint must be
a solid `-bg` token or a solid muted token (`text-gold-soft`, `text-navy-3`). The 42b `pastoral-flag.tsx`
already proves the terra family clean — reuse its classes verbatim for the case-file strip.

---

## 1. Route, placement & the page-level confidential gate (the crux)

### 1.1 Route — NEW, confirmed `/senior/vlc/journal/[studentId]`
- The surface browser bar reads `app.omnischools.gh / pastoral / vlc / journal / student-2024-0317` and the
  crumb `Pastoral & values → VLC → Student journal → J. Manu`. Per repo convention **"pastoral" is
  editorial/CSS only, never a route or nav segment** — so the built route is
  **`/senior/vlc/journal/[studentId]`**, sibling of the shipped `/senior/vlc/sessions/[classId]/[date]`. File:
  `app/(app)/senior/vlc/journal/[studentId]/page.tsx`. (`params` is a Promise — Next 15 async, the shipped
  register-page idiom.)
- **NOT a new tab, NOT a sidebar item.** The single flat **"Student support"** sidebar slot
  (`components/app/sidebar.tsx` L116) stays exactly one item. The `VlcTabs` row (Setup · Peer Guides · Sessions)
  gains **no** "Journal" tab — the journal is a per-student **confidential drill-down**, not a top-level
  operational surface. (Whether the page renders under `VlcLayout` at all — and therefore shows the tab row with
  none active — is drift #6; recommend a plain back-crumb to the register instead of the operational tabs.)

### 1.2 The page-level gate — the WHOLE page is confidential (tighter than the register)
The 42a/42b register is a **shared operational page** with a *gated block* inside it. **The journal is the
opposite: the entire page is confidential.** So the gate is at the page top, and a non-gated viewer never gets
the chrome.

```
READ = WRITE = canAccessPastoralFlag({ roles, userId, classTeacherUserId })   // the 42b gate, verbatim
             = roles.includes("DEAN_OF_STUDENTS")                             // school-wide pastoral authority
            || userId === classTeacherUserId                                  // the student's OWN-class Form Master
```

Page sequence (mirror the register page, but the narrow gate is the **page** boundary, not a block):
1. `requireSchoolRole(VLC_PASTORAL_READ_ROLES)` — role arm `[FORM_MASTER, DEAN_OF_STUDENTS]` (NOT the wider
   `VLC_CONFIG_READ_ROLES`; ADMIN + HM must not even reach the role gate). BASIC-school redirect as in the layout.
2. Load the target student → their `class_teacher_user_id` (server-side, un-spoofable).
3. `canAccessPastoralFlag({ roles, userId, classTeacherUserId })` — the own-class narrowing. **False →
   `notFound()`** (not a redacted page; nothing). This is the whole-page equivalent of the register's
   "callout absent from the tree".
4. Only past the gate: fetch the casework (a `server-only` reader per the `pastoral-data.ts` idiom).

- **🔴 THE OWN-CLASS TRAP (inherited from 42b).** The FM arm is an **identity match**
  (`userId === class.classTeacherUserId`), never `roles.includes("FORM_MASTER")` — a bare role check hands every
  FM every student's journal (the IDOR this table family exists to prevent). Dean = school-wide, no own-class
  clause. **Reuse `canAccessPastoralFlag` — do not re-implement.**
- **Every append/edit action re-checks `canWritePastoralFlag`** (= `canAccessPastoralFlag`) server-side. The
  disabled control is convenience; the action is the boundary (the shipped `markAttendance` / `raisePastoralFlag`
  idiom).
- **Non-gated viewer render = NOTHING.** HM `notFound`; ADMIN `notFound`; other-class FM `notFound` (own-class
  fails); PG/student/parent never hold the role and are `parent_deny`/no-login besides. There is **no** "0
  entries", no "restricted", no stub — existence of the case is itself confidential.

### 1.3 How the page is reached (what the surface implies)
- **From the 42b flag callout on the register.** The pastoral-flag callout points at a flagged student; the
  journal is that flag's destination. The 42b map explicitly parked this as an INCR-43 chain ("`Open private
  case note` → `vlc_case_file`/journal"). **43a adds an `Open journal` link** from the callout (and/or the flag
  row) to `/senior/vlc/journal/[studentId]` — the honest replacement for 42b's omitted `Open private case note`
  button. Gated identically (only a gated viewer sees the callout, so only a gated viewer sees the link).
- **No Dean roll-up list yet.** The surface draws the journal **once, per student** — there is no cross-class
  "Dean's flagged-students list" on this surface. That roll-up is **INCR-44** (the `vlc-school-dashboard`). In
  43a the Dean reaches a journal the same way they reach a flag: by opening the class's register and following
  the flag, or by a direct `studentId` URL. **Do not invent a Dean list here** (§7).

---

## 2. The four casework sections, 1:1

Rendered order on the surface, inside `.body-shell` (L349), newest-first within each stream. The journal block
**interleaves** three append-only streams (entries · FM notes · PG observations) in one reverse-chronological
timeline; the case-file summary sits **above** the body (L335, the terra strip) as the page's confidential
header. I map them by TYPE (the four tables), noting the interleave.

### 2.1 Journal entries — `vlc_journal_entry` · APPEND-ONLY (the reflection stream)

**Block header** (L351–358): eyebrow `The journal · 11 entries · append-only`; h3 `Joseph's reflections ·
September 2025 — today`; meta `Newest first · entries cannot be edited or deleted · FM may add private notes
alongside`.

**Per-entry fields** (`.entry`, e.g. L396–414 the V7A entry):
- **num-pill** (mono): `SESSION 11` — the running session ordinal.
- **value tag**: Fraunces italic ordinal `07` + name + Twi + slot — `Patriotism · Ɔman dɔ · session A`. Twi is
  **load-bearing product copy, transcribe verbatim**: `Ɔman dɔ` (Patriotism), `Mmɔborɔhunu` (Compassion),
  `Akwankyerɛ` (Discipline), `Obu` (Respect). Perseverance (V5) shows no Twi in the surface.
- **date** (mono): `WED · 07 MAY 2026`.
- **prompt** (italic, gold-soft left border): `Prompt: What does belonging beyond family look like for me?`
  (per-entry, verbatim — each entry carries its own prompt).
- **reflection-text** (Fraunces 14px, the one place the student's own voice renders) — verbatim multi-paragraph;
  a `.quote` span italicises an inline quotation. **Transcribe in full** (the Ghanaian school-operations voice
  is the product): e.g. *"When my father died the school sent flowers and three teachers came to the
  funeral…"*, *"I want my small words to be the same as my big words. That's discipline I think. Not exercise.
  Word-keeping."*, *"I'm the one I didn't expect."*
- **foot**: `Submitted 3:24 PM` (mono) · **`APPEND-ONLY · LOCKED`** pill · `142 words` (right-aligned).

**Entry sub-states on the surface:**
- **Populated / locked** (the norm) — `APPEND-ONLY · LOCKED` + word count. No edit, no delete affordance
  anywhere.
- **Pending** (L363–379, today's session-13 entry, `gold-edge`) — placeholder body *"Submission pending ·
  reflection phase 4 begins in 12 minutes · this entry will appear after submission · today's session is
  currently in plenary phase 3"*, foot pill **`PENDING SUBMISSION`**, `— words`. **⚠ Owner override (drift #1):**
  this is a **student-in-session capture flow** ("reflection phase 4 begins in 12 min"). There is **no student
  login** — the FM records reflections. **Omit-not-fake the live-submission flow**; the honest 43a empty slot is
  *"Not yet recorded — the Form Master enters this session's reflection."* Do not imply the student is writing
  live.
- **Absent marker** (L473–478, `absent-marker`) — a terra dashed row, no reflection: `SESSION 8 · V5B
  Perseverance · 26 Feb · absent · bereavement-excused by FM · no reflection`. Two of these (V5A 19 Feb, V5B
  26 Feb). Derives from 42a attendance (ABSENT) + the excuse note; **not** a journal row.
- **Collapse** (L552): `6 earlier entries hidden · V1B Respect → V4A Discipline · click to expand the full
  year` — the stream paginates/collapses older entries.

**Empty state (whole stream, a fresh case):** the surface shows an 11-entry stream; the honest empty is *"No
reflections recorded yet"* (append-only, so it only ever grows). **No student-self "write your reflection"
CTA** — the FM records.

### 2.2 FM pastoral notes — `vlc_pastoral_note` · APPEND-ONLY (`N of 4`, none edited)

**Interleaved** into the journal stream as gold cards (`.fm-note`), reverse-chron, each numbered against a
running total that **only accretes** — the surface shows `4 of 4`, `3 of 4`, `1 of 4 · case opener`. **Note "2
of 4" is not in the visible window** (it's inside the 6 collapsed entries) — the numbering proves the
append-only accretion: notes are never renumbered, never edited, never deleted.

**Per-note fields** (`.fm-note`, e.g. L382–393 the today note):
- eyebrow: `FM PASTORAL NOTE · 4 of 4 total` (case-opener adds `· case opener`).
- h5 (Fraunces, `text-gold` `<em>`): `V7B plenary · tearful, stepped out, returned`.
- **vis** block: `FM + DEAN` pill (`bg-gold text-navy`) + `when` (mono) `14 MAY · 3:08 PM`.
- body (Manrope 12px, `<b>` navy, `<em>` gold-Fraunces) — **verbatim, in full** (confidential FM prose). The
  four notes:
  - **4 of 4** (14 MAY · 3:08 PM): *"Akua Gyamfi (PG, girls' rep) flagged at 3:08 PM during plenary share-back…
    Joseph became tearful, asked to step out… Considering whether to bring this up at Friday Dean check-in. Not
    crisis level — concern level — but the second flag in three weeks."* **⭑ This note IS the 42b flag's
    narrative** (same PG Akua, same 3:08 PM, same V7 Patriotism, same "concern not crisis"). Cross-module hook
    §7.
  - **3 of 4** (16 APR · 4:12 PM): `V6A return · first session back from bereavement` — *"…first session back
    after the two-session absence… Reflection submitted, 28 words, but submitted. That alone matters more than
    the words. No flag this session. Watching."*
  - **1 of 4 · case opener** (19 FEB · 8:22 AM): `Bereavement · case opened` — *"Mother called yesterday
    evening. Joseph's father died Saturday 7 Feb… Have notified subject teachers (Maths, English, Geography,
    History, RME, Social Studies, French, ICT, GH Lang)… **Family situation also flagged in finance — mother
    enquiring about boarding fees concessions for next semester.**"* ⭑ finance cross-hook §7.
- **No edit/delete affordance.** Append-only; the only write is **add a new note**.

**Empty state:** *"No pastoral notes on this student."* **Write affordance:** `Add note` (own-class FM / Dean),
the confidential gold/terra treatment, re-checks the gate.

### 2.3 PG observations — `vlc_pg_observation` · APPEND-ONLY (time-stamped + signed, PG is DATA)

**Interleaved** as `.pg-obs` navy-edged cards (L517–529). Year-strip says `3 recorded`; one is shown (Prince
Otoo, 22 JAN). **Per-observation fields:**
- avatar (`bg-navy text-gold`, PG initials `PO`).
- **by** (bold): `Prince Otoo`; **role**: `Peer Guide · boys' rep · Group A`.
- **when** (mono): `22 JAN · 3:34 PM`.
- text (italic 11px `text-navy-2`, inline `<b>` quote): *"In small group today Joseph led the conversation about
  what discipline looks like outside school… he brought up his father's mason work — **'finishing the row even
  when no one's watching.'** Group went quiet, then several people built on it. He's stronger in small group than
  plenary."*

**⚠ Owner override (drift #2 — the load-bearing one):** the surface visibility-matrix row says *"Peer Guides: log
their own observations"*. **Under the owner decision there is NO PG login and NO PG write.** A PG **verbally
tells the FM**, who **records** the observation with the PG named as **`observed_by` data** — the exact 42b
`surfaced_by` mechanism. So: `Prince Otoo · Peer Guide · boys' rep · Group A` is a **display attribution string**
(name + role), not a user FK, not a PG-authored row. **There is no PG-facing UI anywhere in 43a.**

**Empty state:** *"No Peer Guide observations recorded."* **Write affordance:** `Record observation` (own-class
FM / Dean) — a form whose `observed_by` is a free-text PG attribution (the `RaiseForm.surfacedBy` pattern from
`pastoral-flag.tsx`), or a select over the class's INCR-41 `vlc_peer_guide` roster. **No edit/delete** (append-only).

### 2.4 Case-file summary — `vlc_case_file` · **EDITABLE** (the one mutable section, "last revised 14 May")

The terra strip **above** the body (`.pastoral-context`, L335–347) — **visually the 42b confidential-callout
family** (`bg-terra-bg border-terra`). This is the FM-maintained, revised-in-place case summary.
- eyebrow: `Pastoral context · FM-maintained · visible to FM + Dean only`.
- h4 (Fraunces, `text-terra` `<em>`): `Active case · bereavement & school re-engagement`.
- **sub** (two timestamps, both load-bearing): `Opened 19 Feb 2026 · last updated today 3:08 PM · 4 entries
  total · 2 currently open`. → `Opened` = case created; `last updated … 3:08 PM` = last **note** appended;
  `4 entries total · 2 currently open` = the note count / open count (derives from §2.2, NOT stored).
- **visibility pill** (`bg-terra text-bg`): `FM + DEAN ONLY · NOT VISIBLE TO STUDENT, PARENT, OR PG` — the
  surface's own statement of the gate; render verbatim (the 42b `FM + DEAN ONLY` idiom, long form).
- **body — the EDITABLE summary**, prefaced *"Summary (drafted by Mr Mensah, Form Master · **last revised 14
  May**):"* then the narrative — verbatim: *"Joseph's father died unexpectedly 7 February 2026… Mother now sole
  provider… Academic performance steady — no slip in Maths or English assessments. Social engagement returning
  gradually — quieter than before, fewer interactions in common room observed by prefects. VLC engagement is the
  most sensitive surface — values material (Compassion, Patriotism, Service) is closest to the bone for him right
  now. **Hold the journal lightly. Watch for triggers. He is doing the work.**"*

**This is the append-only contract's ONE exception.** `last revised 14 May` (not an `N of N` accretion number)
signals it is **edited in place** — a single living summary the FM revises, versus the three streams that only
grow. **Write affordance:** `Edit case-file summary` (own-class FM / Dean), stamps a new `last revised`.

**Case status:** `Active case` / `ACTIVE CASE` (hero tag §3.1) + `2 currently open` derive from an open/closed
flag on the case-file (the `resolved_at IS NULL` open-row idiom from `vlc_pastoral_flag`) and the open-note
count. A `Close case` affordance is implied (own-class FM / Dean) but not drawn — treat as the 42b `Mark
resolved` sibling (drift #7).

---

## 3. Derived scaffolding (context the casework hangs on — map, but it is NOT new casework)

These three regions are the page header; they **derive** from the four tables + 42a/42b data. Map them so the
page renders whole, but none is a new store.

### 3.1 Student hero (`.student-hero`, L239–258) — confidential identity + case badge
- avatar `JM`; eyebrow `Form 2 General Arts A · 2025/26`; h2 `Joseph Manu · age 15` (Fraunces, gold `<em>`).
- meta-row: `Form Master: Mr A. Mensah` · `House: Aggrey` · `Joined: Sept 2024 (Form 1)` · `VLC year: 2 of 3`.
- **pastoral-tag** (confidential, `bg-terra`): `PASTORAL · ACTIVE CASE` + sub `Bereaved · father d. Feb 2026 ·
  2 open FM notes`. Derives from `vlc_case_file` status + open-note count. **SOLID `text-gold-soft`** on the
  muted sub (no-alpha).

### 3.2 Year overview strip (`.year-strip`, 5 × `SumCard`, L261–287) — all DERIVED
`Sessions attended 11 / 13` (`85% · 2 absences … bereavement-excused`) · `Reflections written 11 / 11` (`100%
submission`) · `Avg reflection length 74 words` (`Range 12—186`) · **terra card** `FM pastoral notes 2 open · 4
total` (`Last: today 3:08 PM · V7 Patriotism plenary`) · `PG observations 3 recorded`. Reuse `SumCard` (the
terra card = a new `terra` ground alongside `featured`/`warn`, or the existing `warn` idiom recolored). **⚠ The
editorial (§02) forbids an "engagement score" and any content analytics** — these five are **counts/averages
only** (length ≠ depth); do not add a quality/engagement metric (owner-#6-adjacent, drift #4).

### 3.3 22-session timeline (`.timeline-card`, L290–332) — DERIVED from 42a + 42b
A 22-cell grid (`13 held · 9 ahead`), legend `Attended / Absent / Pastoral flag / Upcoming`, each cell = session
label `7A` + value `V7`, states `held`/`absent`/`flag`/`upcoming`/`today`. **Reads 42a `vlc_session` +
`vlc_session_attendance` for held/absent, and 42b `vlc_pastoral_flag` for the `flag` cells** (the badge dot).
The `today` cell = the current session. Below it a **"Reading the year"** narrative block (L329) — a short
FM/derived reading referencing the bereavement; confidential, part of this gated page. This region is mostly a
**cross-surface read**, not a new table (§7).

---

## 4. The visibility matrix (surface L600–608) — transcribed, then corrected to the owner gate

**Verbatim from the `.notes` aside (this IS the surface's gate statement):**

| Role | Surface says (L602–607, verbatim) |
|---|---|
| **Student** | *"their own reflections, read-only · cannot see FM notes, PG notes, character draft"* |
| **Form Master** | *"everything · adds notes · finalises character paragraph"* |
| **Dean of Students** | *"reads notes (case oversight) · cannot edit · cannot delete"* |
| **Headmaster** | *"sees finalised character paragraph only · no journal access"* |
| **Parent / guardian** | *"sees nothing on this surface · they receive the character paragraph at school-leaver"* |
| **Peer Guides** | *"log their own observations · cannot read others'"* |

**The owner-corrected 43a gate matrix (what to BUILD — flags on every drifting row):**

| Role | 43a access | Correction vs surface |
|---|---|---|
| **own-class FM** | **READ + WRITE** — reads all four; appends entries/notes/observations; edits the case-file summary. (Append-only ⇒ nobody edits/deletes the three streams, incl. the FM.) | surface "finalises character paragraph" = **43b, out of scope** — 43a's FM write is the four casework tables, NOT the paragraph. |
| **Dean of Students** | **READ + WRITE** (school-wide, no own-class clause). | ⚠ surface says Dean *"cannot edit · cannot delete"* — that is the **append-only** contract (true for everyone), NOT a Dean read-only. Owner: **READ = WRITE = FM + Dean**, so the **Dean CAN append notes/observations and edit the case-file** (the 42b `canWritePastoralFlag` already includes Dean). |
| **other-class FM** | **NOTHING** (`notFound`). | own-class identity fails — the IDOR fence. |
| **Headmaster** | **NOTHING** on this page. | ⚠ surface *"sees finalised character paragraph only"* — the paragraph is the **43b** card, and even in 43b it decorates THIS page for HM as a *separate* read; **in 43a the HM has zero access to the journal page.** |
| **ADMIN** | **NOTHING** (`notFound`). | barred (not even in `VLC_PASTORAL_READ_ROLES`), despite being in the wider `VLC_CONFIG_READ_ROLES`. |
| **Student** | **NOTHING — no login.** | ⚠ surface *"own reflections, read-only"* implies a student self-view. **OUT OF SCOPE — there is no student user, no student read, no self-view** (owner). The student is the data subject; the FM records. |
| **Peer Guide** | **NOTHING — no login.** | ⚠ surface *"log their own observations"* — **OUT OF SCOPE**. No PG user, no PG write; a PG is an `observed_by` **data attribution** (the 42b `surfaced_by` idiom). |
| **Parent / guardian** | **NOTHING** (`parent_deny`, VLC-wide, owner #4). | surface agrees ("sees nothing"). The "receives character paragraph at school-leaver" is a **43b / reference-letter** concern, out of 43a. |

**Net:** only **own-class FM + Dean** touch this page, for both read and write. Everyone else = `notFound`. The
`FM + DEAN ONLY · NOT VISIBLE TO STUDENT, PARENT, OR PG` pill (§2.4) is the human-readable proof.

---

## 5. The append-only vs editable contract

| Section | Mutability | Surface evidence | Build contract |
|---|---|---|---|
| **Journal entries** (§2.1) | **APPEND-ONLY** | `APPEND-ONLY · LOCKED` pill; meta *"entries cannot be edited or deleted, by anyone"*; lede *"can be added to but never edited or deleted"* | insert-only; **no** UPDATE/DELETE affordance in the UI; immutable rows. |
| **FM pastoral notes** (§2.2) | **APPEND-ONLY** | `N of 4 total` accreting numbers, never renumbered; no edit control | insert-only; only write = `Add note`. |
| **PG observations** (§2.3) | **APPEND-ONLY** | *"time-stamped and signed"* (L597); no edit control | insert-only; only write = `Record observation` (FM records, PG = data). |
| **Case-file summary** (§2.4) | **EDITABLE** (the sole exception) | *"drafted by Mr Mensah… **last revised 14 May**"* — a "last revised" stamp, not an accretion count | single living row, updated in place; write = `Edit case-file summary` (stamps `last_revised_at` / `updated_at`). |

The editorial (§02) is the *why*, and it is a design commitment, not decoration: *"A journal that cannot be
edited is a journal that can be trusted."* Append-only is the point — a retrospectively edited reflection
"becomes a performance for a future reader". **Do not add an edit/delete path to the three streams even as an
admin convenience.** The case-file summary is deliberately the one revisable surface (it is the FM's working
picture, not the student's record).

---

## Ω. Omit-not-fake (INCR-43b + owner #6) — be explicit

Render **absent**; copy must never imply a working paragraph generator, a student self-view, or any AI. No
placeholder, no disabled control, no "coming soon".

1. **The entire character-paragraph card** (`.char-card` block, surface L557–587) — the *"Year-end output ·
   school-leaver character paragraph"* block, its navy card, the three drafted paragraphs, and both buttons
   (`Edit draft`, `Lock for year-end`). **This whole block is INCR-43b. Omit it — do not stub it.** 43a ends at
   the four casework sections + their affordances.
2. **All auto-generation framing** (owner-#6-overridden — the paragraph is FM-authored, NO AI): the strings
   *"Auto-drafted from journal + pastoral notes + PG observations"*, *"Draft · auto-generated · 14 May 2026"*,
   *"Generated from 11 reflection entries + 4 FM pastoral notes + 3 PG observations"*, *"Auto-draft regenerates
   after each session"*, `DRAFT · 13 OF 22 SESSIONS`, and the aside item L598 *"Auto-draft … regenerates after
   each session"*. **Even 43b will not auto-generate** — so 43a must not render, imply, or scaffold any
   auto-summary. No "we'll draft this for you", no progress-to-draft meter.
3. **Any student self-view / student login** (owner). The surface's *"The student writes; the FM reads weekly"*
   framing, the `PENDING SUBMISSION` live-capture flow (§2.1), the *"reflection phase 4 begins in 12 minutes"*
   in-session prose, and the matrix's *"Student: own reflections, read-only"* — **omit-not-fake**. There is no
   student-facing surface; the FM records reflections after the fact.
4. **Any Peer-Guide UI / PG write** (owner). The matrix's *"Peer Guides: log their own observations"* — omit.
   The PG is `observed_by` **data**, never a user (§2.3).
5. **Any keyword detection / theme extraction / content analytics / bulk export** — the editorial §02 aside
   lists these as **deliberate non-features** (*"No keyword detection or AI summarisation of journal contents"*,
   *"No analytics on what students wrote"*, *"No exports of journal text outside the system"*). Keep them absent;
   the year-strip stays **counts + averages only** (§3.2). This is the same owner-#6 no-AI posture as (2).

**NOT omitted (guard against over-scrubbing):** the four casework sections and every field/copy string in §2;
the derived hero/year-strip/timeline (§3); the confidential visibility pills; and the **append** (entry / note /
observation) + **edit case-file** affordances — those ARE 43a.

---

## 6. Interaction-state inventory (43a)

| Region | States | Behaviour |
|---|---|---|
| **Page** | gated / non-gated | gated (own-class FM / Dean) → full page. non-gated → `notFound()` (no chrome, no stub). |
| **Journal stream** | empty / populated / collapsed / (absent-marker) | empty → *"No reflections recorded yet"*; populated → newest-first locked entries; `6 earlier entries hidden` collapse expander; absent-marker rows derive from 42a ABSENT + excuse. **No** live `PENDING SUBMISSION` flow (§Ω.3). |
| **Add entry / note / observation** | idle / submitting / error | own-class FM / Dean; server re-checks `canWritePastoralFlag`; optimistic add + revert on refusal (the `raisePastoralFlag` idiom in `pastoral-flag.tsx`). Append-only ⇒ no edit/delete. |
| **Case-file summary** | view / editing / saving | own-class FM / Dean; edit-in-place; stamps `last revised`. The one mutable surface. |
| **Case status** | active / closed | `Active case` badge; a `Close case` affordance (own-class FM / Dean) mirrors 42b `Mark resolved` (drift #7). |
| **Timeline / year-strip** | derived | read-only; recompute from 42a sessions + 42b flags + the casework counts. |
| **Responsive / PWA** | desktop-primary | the surface is a desktop `.desktop` mock (a Form Master at a desk). The 22-cell grid + 5-card strip need a mobile stack (grid → 1–2 col); the reflection body stays readable at 14px. No PWA-specific variant drawn. |

---

## 7. Cross-module hooks (design commitments — preserve)

- **42b flag ↔ this journal (the primary chain).** FM note **4 of 4** (§2.2) is the *narrative* behind the 42b
  `vlc_pastoral_flag` (same PG Akua Gyamfi, same 3:08 PM, same V7 Patriotism, same "concern not crisis"). The
  42b callout's omitted `Open private case note` button becomes 43a's **`Open journal` deep-link**
  (`/senior/vlc/journal/[studentId]`). The flag is the *pointer*; the journal is the *document*.
- **Case-file / notes → finance-billing.** Note 1 of 4 (case opener) records *"mother enquiring about boarding
  fees concessions for next semester"* and the summary notes the family is "sole-provider" — the
  discipline→billing / bereavement→fee-concession cross-module hook. Preserve the copy; **do not** auto-wire a
  billing action (out of scope), but keep the narrative that a pastoral case surfaces a fees concern.
- **Timeline → 42a session register + 42b flags.** The 22-cell grid reads `vlc_session` / `vlc_session_attendance`
  (held/absent) and `vlc_pastoral_flag` (the flag cells). The `today` cell + the reflection's `3:08 PM` sit
  inside the 42a derived phase clock.
- **PG observation ↔ INCR-41 Peer Guide roster.** `observed_by` references the class's active `vlc_peer_guide`
  (Prince Otoo · boys' rep · Group A; Akua Gyamfi · girls' rep) — the attribution reuses the shipped roster, not
  a new person model. Data, not a writer.
- **INCR-45 forward-dep.** `vlc_pastoral_flag.student_id` is already first-class so `isPastorallyFlagged` can do
  an existence check without reading confidential content; the 43a case-file's open/closed state should stay
  answerable the same way (existence, not content read) — preserve the INCR-30 non-disclosure.
- **[INCR-43b / -44 chains to NOT build now]:** the character-paragraph card → 43b (decorates THIS page later,
  FM-authored, no AI); the paragraph → school-leaver **reference letter, not the transcript** (out of module);
  a Dean cross-class flagged-students roll-up → **INCR-44** `vlc-school-dashboard`. 43a must not preclude these
  but must not surface or deep-link them.

**Schema note (Wells/Kofi own the shape — I map the contract, not the columns).** 43a implies **four new
`vlc_pastoral_*` tables**: `vlc_journal_entry`, `vlc_pastoral_note`, `vlc_pg_observation` (append-only) +
`vlc_case_file` (editable, one row per student-case). All carry the **`vlc_pastoral_` prefix** → REDACTED audit
(`isRedactedAuditEntity` branch already wired by 42b) and **ENABLE + FORCE RLS + tenant_isolation + parent_deny**
+ a **leak-critical hand-run prod-paste** (the `prod-paste-0070-vlc-pastoral-flag.sql` precedent — the most
leak-critical class). Composite `(school_id, …)` FKs to `students` / `vlc_session` / `vlc_peer_guide`; the SOLE
confidential reader per table follows the `pastoral-data.ts` `server-only` own-class-WHERE idiom. **`context`/
narrative caps** keep the journal body a real narrative here (unlike the 42b flag's ≤280 locator) — but that is
Kofi's column call, flagged for him, not mine to set.

---

## Open questions / drift log

1. **No student login / no submission flow (drift #1).** Surface frames journal entries as student-written with
   a live `PENDING SUBMISSION` phase flow. Owner: no student user — the FM records. **Recommend the empty slot
   read *"Not yet recorded — the Form Master enters this session's reflection"***; omit the phase-timer flow.
   Confirm.
2. **PG = `observed_by` data, no PG UI (drift #2).** Surface matrix says PGs "log their own observations". Owner:
   no PG login; the FM records with the PG named as data (42b `surfaced_by`). Confirm no PG-facing surface.
3. **Dean is READ = WRITE, not read-only (drift #3).** Surface matrix says Dean "cannot edit · cannot delete"
   (which is the universal append-only rule); owner grants Dean the SAME write as FM (append notes/obs, edit
   case-file). Confirm the Dean append/edit affordances render for a Dean.
4. **Counts-only, no engagement score (drift #4).** The year-strip is counts + averages; the editorial forbids
   an engagement/quality score and content analytics (owner-#6 no-AI). Confirm no scored metric.
5. **Character paragraph = 43b, no auto-generation ever (drift #5).** Omit the card + all auto-draft framing;
   43b will render an **FM-authored** paragraph (no AI). Confirm 43a renders nothing in that block.
6. **Layout / tabs on the journal page (drift #6).** Does the journal page render under `VlcLayout` (showing the
   Setup · Peer Guides · Sessions tab row with none active), or standalone with a back-crumb to the register?
   **Recommend standalone with a crumb** — the journal is confidential casework, not an operational tab. Confirm.
7. **`Close case` affordance (drift #7).** The hero shows `ACTIVE CASE` / `2 currently open`; a close/resolve
   control is implied but not drawn. **Recommend the 42b `Mark resolved` sibling** (own-class FM / Dean, open-row
   idiom). Confirm whether a case closes explicitly or derives from all-notes-resolved.
8. **Reach path + no Dean list (drift #8).** The journal is reached from the 42b flag callout (an `Open journal`
   link, the honest replacement for the omitted `Open private case note`); there is **no Dean roll-up list** in
   43a (that is INCR-44). Confirm the `Open journal` link and that no cross-class list ships here.

---

*Map produced against: `Surfaces/schoolup-vlc-student-journal.html` (§01 body L349–587, matrix L600–608,
editorial L613–643); the shipped INCR-42b build (`lib/vlc/authz.ts::canAccessPastoralFlag`,
`lib/access.ts::VLC_PASTORAL_*_ROLES`, `lib/vlc/pastoral-data.ts`, `components/vlc/pastoral-flag.tsx`,
`db/schema/vlc.ts::vlcPastoralFlag`); the 42a/42b page + chrome
(`app/(app)/senior/vlc/sessions/[classId]/[date]/page.tsx`, `components/vlc/chrome.tsx`,
`components/vlc/vlc-tabs.tsx`, `components/app/sidebar.tsx`); and the token vocabulary shared with
`docs/senior/vlc-pastoral-flag-surface-map.md` §0. Companion to that 42b map (this is one page deeper — the
document the flag points into).*
