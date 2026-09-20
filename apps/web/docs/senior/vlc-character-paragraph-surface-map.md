# VLC Character-Paragraph Card — Surface Map (INCR-43b · Module 4.5 / surface 04 · the ONE wider-read element)

**Author:** Lucy (design cartographer) · **Status:** design spec, ready for the implementation engineer (pending the one Kofi ruling flagged in §2 + the two owner confirms in §7).
**Scope of this map:** the **year-end character-paragraph card** that 43a explicitly deferred — the `.char-card`
block on `Surfaces/schoolup-vlc-student-journal.html` (**L557–587**). This is the school-leaver reference
paragraph: **the ONE VLC element the Headmaster may read**, and the module's only wider-than-FM+Dean read.

**Two owner decisions reshape this card away from the surface:**
- **Owner #6 — FM-AUTHORED, NO AI.** The paragraph is **free text the Form Master types**, not a machine
  summary of the journal. The surface's entire *"Auto-drafted / auto-generated / generated from N entries /
  regenerates after each session / DRAFT · 13 OF 22"* framing is **OVERRIDDEN → OMIT-NOT-FAKE the whole
  auto-generation story** (§Ω). What remains is an **FM-authored draft** with **Edit** + **Lock for year-end**
  affordances — nothing that implies the machine read or summarised the journal.
- **Owner #2 — HM PARAGRAPH-ONLY.** The Headmaster may **READ this paragraph and NOTHING else** on the journal
  (no entries, no FM notes, no PG observations, no case-file — those stay **FM + Dean only**, per 43a). This card
  is the module's single wider-read surface.

**Access contract for the paragraph (the delta from 43a):**

| Verb | Who |
|---|---|
| **READ** the paragraph | own-class FM **+** Dean of Students **+ Headmaster** |
| **WRITE** (author / edit / lock) | own-class FM **+** Dean of Students (**HM read-only**) |
| everyone else (ADMIN / other-class FM / PG / student / parent) | **NOTHING** — `notFound()`, no existence leak |

Rule where surface and spec/owner disagree: **owner wins on logic + visibility, surface wins on visual
presentation.** Drift called out inline + collected in §7.

## Source + the shipped code this extends

| File | Role |
|---|---|
| `Surfaces/schoolup-vlc-student-journal.html` — **`.char-card` CSS L183–198; block L557–587; matrix row L606** | **PRIMARY** for the card's structure, copy, tokens, and both affordances. |
| `docs/senior/vlc-student-journal-surface-map.md` (43a map) — §Ω.1–2, §4 (matrix), §7 (43b forward-dep) | **PARENT MAP** — 43a deferred this card and pre-scrubbed its auto-generation framing; 43b is the honest build. |
| `app/(app)/senior/vlc/journal/[studentId]/page.tsx` (43a, **SHIPPED**) | **SLOT ANCHOR** — the char-card renders as the final block here for FM/Dean (§5). The page gate is **unchanged**. |
| `components/vlc/casework.tsx` (`CaseEditor`, `CaseworkComposer`) | **REUSE PATTERN** — the Edit-draft affordance mirrors `CaseEditor` (textarea + `useTransition` + `router.refresh`); the no-alpha SOLID-token discipline. |
| `components/vlc/chrome.tsx` (`SectionHead`) | **REUSE** — the block header. |
| `lib/vlc/pastoral-data.ts` (`getStudentCasework`, `timeLabel`, `dateLabelOf`, `shortNameOf`) | **REUSE PATTERN** — the `server-only` narrow-projection reader idiom; the paragraph gets its OWN narrow reader (§2). |
| `lib/vlc/authz.ts` (`canAccessPastoralFlag` / `canWritePastoralFlag`) | **WRITE gate reused VERBATIM**; **READ gate is a NEW sibling** `canReadCharacterParagraph` that adds the HM arm (§2). |
| `lib/access.ts` (`VLC_PASTORAL_READ_ROLES` = `[FORM_MASTER, DEAN_OF_STUDENTS]`, `hasAnyRole`) | **REUSE + ADD** one new const `VLC_PARAGRAPH_READ_ROLES` = the pastoral pair **+ HEADMASTER** (§2). |
| `lib/actions/vlc-casework.ts` (`editCase`, `mayWriteFor`, REDACTED-audit pattern) | **REUSE PATTERN** — two new actions `saveCharacterParagraph` + `lockCharacterParagraph`, same gate, same audit shape. |
| `components/ui/confirm-dialog.tsx` | **REUSE** — the "Lock for year-end" confirm (locking is one-way; §1.4). |
| `db/schema/vlc.ts` L630–766 (the four `vlc_pastoral_*` tables) | **CONTEXT** — the paragraph needs a **NEW per-student table**, NOT a column on `vlc_pastoral_case` (§2 · Kofi ruling). |

---

## 1. The char-card, 1:1 — verbatim surface, then the honest FM-authored rewrite

The surface block has two parts: an outer **block header** (L558–565) and the navy **`.char-card`** (L567–586).
I transcribe every string, then give the OMIT / KEEP / REWRITE verdict per line. **Surface strings in _italic_;
the honest replacement in `code`.**

### 1.1 Block header (L558–565)

| Element | Surface (verbatim) | Verdict → honest copy |
|---|---|---|
| eyebrow | _"Year-end output · school-leaver character paragraph"_ | **KEEP** — true. `Year-end output · school-leaver character paragraph` |
| h3 (Fraunces, gold `<em>`) | _"Auto-drafted from journal + pastoral notes + PG observations"_ | **REWRITE** (owner #6) → `The Form Master's character paragraph` (or `Written by the Form Master`). Drop "Auto-drafted"; drop the "+ pastoral notes + PG observations" machine-inputs list. |
| meta | _"FM finalises · this goes on the school-leaver reference letter, NOT the transcript"_ | **KEEP** — the `reference letter, NOT the transcript` distinction is true + load-bearing (cross-hook §6). Trim "FM finalises" (implied) → `Goes on the school-leaver reference letter, not the transcript`. |

### 1.2 Card head — `.cc-head` (L568–575)

| Element | Surface (verbatim) | Verdict → honest copy |
|---|---|---|
| eyebrow — **the provenance line** | _"Draft · auto-generated · 14 May 2026"_ | **REWRITE** (owner #6) → see §1.3 (the provenance rewrite). |
| h3 (Fraunces, gold `<em>`) | _"Character paragraph · Joseph Manu · Form 2 GA A"_ | **KEEP** the shape → `Character paragraph` + gold `<em>` `· {student} · {form/class}`. |
| sub | _"Generated from 11 reflection entries + 4 FM pastoral notes + 3 PG observations · FM may edit before publication · revised at year-end with 9 remaining sessions"_ | **OMIT** the whole "Generated from N entries …" count **and** "revised at year-end with 9 remaining sessions" (§Ω.3, §Ω.4 — both imply machine summarisation over a session counter). Replace with the provenance line only (§1.3). |
| status-pill (`bg-warn text-navy`) | _"DRAFT · 13 OF 22 SESSIONS"_ | **REWRITE** → bare `DRAFT` (drop "· 13 OF 22 SESSIONS", §Ω.5 — the counter reads as a regenerate-per-session progress meter). Locked → `LOCKED · YEAR-END`. |

### 1.3 The provenance line — the specific rewrite the task asks for

The surface's _"Draft · auto-generated · 14 May 2026"_ implies a machine drafted it. The honest equivalent
mirrors the **case-file `Opened … · last revised …` idiom already shipped** (43a page L166–169) — an author name
+ a last-edited stamp, no AI:

- **Draft state:** `Draft · written by {FM name} · last edited {DD Mon YYYY}`
  (e.g. `Draft · written by Mr A. Mensah · last edited 14 May 2026`)
- **Locked state:** `Locked for year-end · written by {FM name} · locked {DD Mon YYYY}`

`{FM name}` = the student's class `class_teacher_user_id` full name (the reader already resolves this as
`hero.fmName`; when a Dean authored/edited, stamp the **last editor**, exactly the case-file `revisedByName`
pattern). No "auto", no "generated", no session count.

### 1.4 Card body + foot — the paragraph, and the two affordances

**Paragraph body** (`.draft-text`, L576–580): three Fraunces paragraphs on the navy card. **These three
paragraphs are DEMO/illustrative copy — do NOT ship them as a placeholder, template, or starter draft** (§Ω.8).
The FM-authored equivalent is an **empty draft the FM fills**. The body treatment (what the FM's own text renders
as) is: **Fraunces (`font-display`) 14px, `leading-relaxed`, `text-bg`**, inline `<b>`/`<em>` accents in
`text-gold`, `whitespace-pre-wrap` (the FM's own paragraph breaks — same as the case summary render, page L171).

> The demo paragraph is transcribed once for reference only (NOT a fixture): _"Joseph completed Form 2 having
> engaged thoughtfully with the year's values curriculum… His thinking on the smallness of word-keeping
> (discipline)… 'I'm the one I didn't expect' — was twenty-eight words that said more than many longer pieces…
> His Form Master recommends he be considered for a service-project lead role in next year's Form 3 VLC
> programme, contingent on his readiness at that point."_ (surface L577–579). This is the **register of prose an
> FM types**; ship an empty draft, not this text.

**Foot** (`.draft-foot`, L581–585):

| Element | Surface (verbatim) | Verdict → honest copy |
|---|---|---|
| note | _"Auto-draft regenerates after each session · FM owns the final text · paragraph appears on school-leaver reference letter, not transcript"_ | **OMIT** "Auto-draft regenerates after each session" (§Ω.6 — the core lie). **KEEP** the rest → `Written and owned by the Form Master · appears on the school-leaver reference letter, not the transcript`. |
| button (ghost) | _"Edit draft"_ | **KEEP** as a real FM/Dean write. `Edit draft` → opens an inline textarea (mirror `CaseEditor`), calls `saveCharacterParagraph`. Hidden for HM (read-only) + everyone non-gated. Hidden once locked. |
| button (gold) | _"Lock for year-end"_ | **KEEP** as a real FM/Dean write. `Lock for year-end` → `confirm-dialog` ("Locking freezes the paragraph for the year-end reference letter — you can't edit it after.") → `lockCharacterParagraph`. Hidden for HM + non-gated. |

### 1.5 The three card states (the multi-state flow this surface defines)

| State | When | Presentation | Affordances (own-class FM / Dean) |
|---|---|---|---|
| **Empty** | no paragraph row yet | navy card, no body; muted line `text-gold-soft`: for FM/Dean `No character paragraph yet — write {student}'s school-leaver reference.`; for HM (§4) `The Form Master has not yet written {student}'s character paragraph.` | a single `Write the paragraph` button (opens the textarea). |
| **Draft** | paragraph exists, `locked_at IS NULL` | status pill `DRAFT` (`bg-warn text-navy`); provenance = §1.3 draft line; Fraunces body; foot note + both buttons | `Edit draft` + `Lock for year-end`. |
| **Locked / frozen** | `locked_at` set | status pill flips → `LOCKED · YEAR-END` (`bg-green text-bg`); provenance = §1.3 locked line; **body unchanged, no textarea, NO buttons**; foot note gains `· locked — final for the reference letter`. | **none** — no Edit, no Lock, no Unlock renders even for FM/Dean (locked is one-way; §7 open question on whether an unlock path is ever allowed). |

Loading / error follow the shipped idiom: `useTransition` `pending` → button label `Saving…` / `Locking…`;
server refusal → inline `text-terra` message (the `CaseEditor` pattern, casework.tsx L127/L231).

---

## 2. Data + gate — the paragraph is NOT a casework field (the schema tail + the new gate)

**🔴 Kofi/Wells ruling flagged — the paragraph needs its own PER-STUDENT store.** The character paragraph is
written for **every school-leaver**, whether or not a pastoral case ever existed. It therefore **cannot live on
`vlc_pastoral_case`** — that table is **1:1 per _flag_** (`UNIQUE(school_id, flag_id)`, schema L758) and only
exists for flagged students. A well-behaved, unflagged Form 3 leaver still gets a paragraph. So:

> **New table `vlc_character_paragraph`** — keyed **per student** (`UNIQUE(school_id, student_id)`, at most one),
> columns: `body text`, `author_user_id` (SET NULL), `created_at`, `last_edited_at`, `last_edited_by_user_id`
> (SET NULL), `locked_at timestamptz NULL`, `locked_by_user_id` (SET NULL). Composite `(school_id, student_id)`
> FK → `students.tenant_uk`, CASCADE. Body cap ≤8000 (the case-summary precedent). EDITABLE while
> `locked_at IS NULL`, frozen after. **This is Kofi/Wells's column call — I map the contract, not the shape.**
> *(If the owner scopes the paragraph to final-year only, the row is still per-student; gating to "leaver year"
> is a read filter, not a schema change.)*

**Audit posture (flag for Kofi):** the paragraph is FM-authored character prose about a minor that ultimately
goes to an external reader (employer / tertiary institution). It is **less secret than casework** but still
sensitive. Recommend it **records a REDACTED audit** (metadata only — actionType + entityType + entityId +
actor; no body in the reason), same as the four casework tables, but note it is a **separate entity type**
(`vlc_character_paragraph`), not necessarily under the `vlc_pastoral_` redaction prefix. Confirm the prefix.

### 2.1 The read gate — the one place HM is admitted (NEW)

```
// NEW in lib/access.ts — the paragraph's wider read (the ONLY VLC gate HEADMASTER is in):
VLC_PARAGRAPH_READ_ROLES = [FORM_MASTER, DEAN_OF_STUDENTS, HEADMASTER]

// NEW in lib/vlc/authz.ts — read narrowing (Dean + HM are school-wide; FM is own-class identity):
canReadCharacterParagraph({ roles, userId, classTeacherUserId }):
    roles.includes("DEAN_OF_STUDENTS")  // school-wide pastoral authority
 || roles.includes("HEADMASTER")        // school-wide leadership — the paragraph-only widen (owner #2)
 || userId === classTeacherUserId       // the student's OWN-class Form Master (identity, never a bare role)

// WRITE stays VERBATIM 43a — HM is NOT here (read-only):
canWritePastoralFlag  === canAccessPastoralFlag   // Dean OR own-class-FM identity; no HM arm
```

The FM arm is an **identity match**, never `roles.includes("FORM_MASTER")` — the same IDOR fence 43a documents.
The HM arm is **school-wide** (like the Dean): a Headmaster reads any leaver's reference. An **other-class FM**
fails the identity clause and is refused (HM/Dean are school-wide; a plain FM is not).

### 2.2 The narrow reader — the structural guarantee HM sees ONLY the paragraph

**NEW `server-only` reader `getCharacterParagraph(schoolId, caller, studentId)`** (in `pastoral-data.ts`, beside
`getStudentCasework`). Its projection is **ONLY**: the paragraph `body`, `locked_at`, author/editor name +
timestamps, and the student's `fullName` / `className` / `formLabel`. **It does not join — cannot return —
`vlc_pastoral_journal.body`, `vlc_pastoral_note.body`, `vlc_pastoral_observation.body`, or
`vlc_pastoral_case.summary`.** Sequence mirrors `getStudentCasework` L248–279:
1. role-gate `VLC_PARAGRAPH_READ_ROLES` (ADMIN / PG / student / parent never reach content) → else `null`.
2. resolve student → class → `class_teacher_user_id` (server-loaded, un-spoofable).
3. `canReadCharacterParagraph(...)` → false → `null`.
4. project the paragraph row (or `null` for empty-state).

**This is why (a) below is safe: HM's reader physically cannot return casework.** The projection IS the boundary.

---

## 3. Confidential-panel treatment (reuse the 42b/43a solid-token idiom — no-alpha)

The `.char-card` is the surface's one **navy** confidential panel. Its alphas (`rgba(255,255,255,0.04)` box,
`rgba(232,212,184,0.7/0.6)` muted text, `rgba(255,255,255,0.1)` divider) are the **no-alpha trap** (repo memory
`no-alpha-token-opacity`). Translate every one to a **SOLID** token — the shipped 43a hero (`bg-navy` +
**SOLID `text-gold-soft`**, page L67/L75) already proves this clean. **Verify tints in the live preview, not the
build.**

| Element | Surface tint | SOLID translation (mandated) |
|---|---|---|
| card ground | `bg-navy` | `bg-navy text-bg` (43a hero ground, verbatim) |
| inner `.draft-text` box | `rgba(255,255,255,0.04)` + `rgba(232,212,184,0.15)` border | **`bg-navy-2`** (solid) + optional `border border-navy-3`; **never** `bg-bg/5` |
| eyebrow / provenance / foot note (muted) | `rgba(232,212,184,0.7/0.6)` | **SOLID `text-gold-soft`** (NOT `text-gold-soft/70`) |
| h3 + `<em>` | `text-bg` + `text-gold` | `font-display text-bg`, `<em className="italic text-gold">` |
| paragraph body | `rgba(250,247,242,0.92)` | `text-bg` (Fraunces); `<b>`/`<em>` → `text-gold` |
| divider under head | `rgba(255,255,255,0.1)` | `border-b border-navy-3` (solid) |
| DRAFT pill | `bg-warn text-navy` | keep `bg-warn text-navy` |
| LOCKED pill | (new) | `bg-green text-bg` |

### 3.1 The "+ HM" labelling — the paragraph's wider visibility vs the casework "FM + DEAN"

Every casework panel on the journal page carries a **`FM + DEAN`** pill (the note card, casework composer) or the
long **`FM + DEAN ONLY · NOT VISIBLE TO STUDENT, PARENT, OR PG`** pill (the case-file header, page L160–162). The
character-paragraph card is the **exception** — it is the one wider-read element — so its visibility label must be
**different**, and say so:

- **On the card:** a `bg-gold text-navy` pill reading **`FM + DEAN + HM`** (not `FM + DEAN`) — the "+ HM" is the
  whole point; a reader must be able to tell at a glance this panel is the one the Headmaster can see.
- **On the slim HM route (§4):** a header line under the crumb: `The only VLC element visible to the Headmaster ·
  read-only`. This is the human-readable statement of owner #2 — HM reads this, and only this.

Do **not** reuse the casework `FM + DEAN ONLY · NOT VISIBLE…` pill on the paragraph card; it is the opposite
contract and would mislabel the module's one wider-read surface.

---

## 4. The HM-read placement — (a) vs (b), and the recommendation

**The design question (Lucy + Kofi):** the 43a journal page `/senior/vlc/journal/[studentId]` is gated to
FM(own-class)+Dean — **an HM `notFound`s it** (page L33–39). But HM must read the paragraph. So where?

### Candidate (a) — a SEPARATE HM-reachable slim route *(RECOMMENDED)*

A new page **`app/(app)/senior/vlc/reference/[studentId]/page.tsx`** ("reference" = the school-leaver reference;
"journal" implies the confidential casework page, and "pastoral" is CSS-only per repo convention). It:
- gates on `requireSchoolRole(VLC_PARAGRAPH_READ_ROLES)` (FM + Dean + **HM**);
- calls **`getCharacterParagraph`** (§2.2) — the narrow reader → `null` → **`notFound()`**;
- renders **ONLY the char-card** — read-only for HM, write-enabled (`Edit`/`Lock`) for FM/Dean via `canWrite`.

The 43a journal page is **untouched**: still FM+Dean, still whole-page `notFound` for HM/ADMIN/everyone else.

### Candidate (b) — the journal page admits HM, renders ONLY the card

Loosen the 43a page's role gate to include HEADMASTER, widen `getStudentCasework` to return a paragraph-only view
for an HM, and branch the page: if the viewer is HM-only, render the char-card and **suppress every other
section** (hero case badge, year-strip, timeline, case-file summary, journal stream, composers).

### Recommendation: **(a).** Reasons, in order of weight:

1. **Zero change to the shipped confidential page's invariant.** 43a's security value is "the WHOLE page is
   confidential; a non-gated viewer gets `notFound` with no existence leak" (page L36–39, 43a map §1.2). (b)
   breaks that by admitting HM and then relying on a **per-section `if (canReadCasework)` guard** — the hero
   already renders `PASTORAL · ACTIVE CASE · N open FM notes` (page L83–92), the case badge, the timeline flags:
   every one must be hidden from HM, and **every future section added to that page is a new leak if someone
   forgets the guard.** (a) makes the leak *structurally impossible* — HM never reaches the page or its reader.
2. **The reader is the boundary, and (a) gives HM a reader that cannot leak.** (a)'s `getCharacterParagraph`
   projects only the paragraph — the casework bodies are **not in its SELECT**, so no bug can surface them. (b)
   reuses `getStudentCasework`, which returns the whole document, and asks the page to null-out fields per role —
   leak-prone the moment the projection and the render branch drift.
3. **Matches the shipped idiom** — the codebase already runs **two readers, two projections** for the same data
   (`getPastoralFlags` for the register callout vs `getStudentCasework` for the deep page). A third narrow reader
   is cheap and consistent, not a new pattern.
4. **Clean audiences per surface.** HM's mental model is "I can see the reference paragraph" — that maps to its
   own URL, not a degraded view of a page HM is otherwise told they cannot enter.

Cost of (a): one route file, one narrow reader, one role const, one `canReadCharacterParagraph`, two write actions
— all small, all following shipped patterns. The char-card is a **shared component** rendered on both the journal
page (43a, FM/Dean write) and the slim route (HM read).

### The exact visibility contract (both surfaces)

| Role | `/senior/vlc/journal/[studentId]` (43a) | `/senior/vlc/reference/[studentId]` (43b, NEW) |
|---|---|---|
| **own-class FM** | full casework **+ char-card (write: edit/lock)** | paragraph **read** (+ write — same gate) |
| **Dean of Students** | full casework **+ char-card (write)** | paragraph **read** (+ write) |
| **Headmaster** | **`notFound`** (unchanged) | **paragraph READ-ONLY — the one VLC element** |
| **other-class FM** | `notFound` | **`notFound`** (own-class identity fails; HM/Dean are school-wide, a plain FM is not) |
| **ADMIN** | `notFound` | **`notFound`** (not in `VLC_PARAGRAPH_READ_ROLES`) |
| **PG / student / parent** | `notFound` / no login | **`notFound`** / no login |

**Contract restated:** an **HM sees the paragraph and nothing else confidential** (own route, own narrow reader,
own projection); a **non-gated viewer sees nothing** (`notFound`, no "a paragraph exists" leak). Every write
re-checks `canWritePastoralFlag` server-side (HM never passes it), so HM's read-only is enforced at the action,
not just the hidden button.

**HM reach path (open question §7.3):** HM is not on the flag callout or the journal page, so HM needs an entry
point. Recommend a **`Character reference` link on the student record / F0 roster**, visible to HM+FM+Dean →
`/senior/vlc/reference/[studentId]`; the deep-linkable route works regardless. Minimum 43b = route + reader +
gate; the HM entry-link is a small follow-on.

---

## 5. How the card slots into the 43a page (per the HM-read ruling)

On the **43a journal page** (`/senior/vlc/journal/[studentId]`, page L185–205), the char-card renders as the
**final block, after the journal stream** — the surface order (the `.char-card` is the last block in
`.body-shell`, L557). It is a **shared client component `components/vlc/character-paragraph.tsx`**:

- **Props:** `{ studentId, student: {name, formLabel}, paragraph: { body, locked, authorName, provenanceLabel } | null, canWrite }`.
- **Rendered on the 43a page** inside `{canWrite && …}`-style logic — but note the card renders for **read too**;
  gate it on the SAME `getStudentCasework` return the page already has (add `characterParagraph` to
  `StudentCaseworkView`, or a sibling fetch). FM/Dean on the journal page get the **write** affordances; the card
  is present for them as the year-end output.
- **Rendered on the slim `/reference` route** for HM read-only (`canWrite=false` → no Edit/Lock buttons mount;
  the server action refuses HM regardless).
- **Header:** reuse `SectionHead` from `chrome.tsx` — eyebrow `Year-end output · school-leaver character
  paragraph`, title `The <em>character paragraph</em>`, meta `Goes on the school-leaver reference letter, not the
  transcript`.
- **Edit affordance:** mirror `CaseEditor` (casework.tsx L138–234) — a `useTransition` textarea (`bg-surface
  text-navy`, ≤8000), Save → `saveCharacterParagraph`, Cancel, inline `text-terra` error. **No delete.**
- **Lock affordance:** `Lock for year-end` → `confirm-dialog` → `lockCharacterParagraph`. One-way (§1.5).

**Component/action reuse summary:**

| Need | Reuse | New |
|---|---|---|
| block header | `chrome.tsx::SectionHead` | — |
| Edit-draft textarea + submit | `casework.tsx::CaseEditor` pattern | `components/vlc/character-paragraph.tsx` |
| Lock confirm | `components/ui/confirm-dialog` | — |
| write gate | `authz.ts::canWritePastoralFlag` (verbatim) | — |
| read gate | — | `authz.ts::canReadCharacterParagraph` |
| role const | `access.ts::VLC_PASTORAL_READ_ROLES` (pattern) | `access.ts::VLC_PARAGRAPH_READ_ROLES` (+ HEADMASTER) |
| reader | `pastoral-data.ts::getStudentCasework` (pattern) | `pastoral-data.ts::getCharacterParagraph` (narrow) |
| write actions | `vlc-casework.ts::editCase` + `mayWriteFor` + REDACTED audit (pattern) | `saveCharacterParagraph`, `lockCharacterParagraph` |
| slim route | 43a journal `page.tsx` (pattern) | `app/(app)/senior/vlc/reference/[studentId]/page.tsx` |
| store | `db/schema/vlc.ts` (pattern) | `vlc_character_paragraph` table (Kofi/Wells, §2) |

**Nav:** like the journal, the `/reference` route is a **per-student drill-down, NOT a sidebar item and NOT a
`VlcTabs` tab** (repo nav convention; 43a map §1.1). Standalone with a back-crumb.

---

## Ω. Omit-not-fake (owner #6 · the auto-generation story) — be explicit

Render **absent**; copy must never imply a machine read, summarised, or drafted the paragraph. No placeholder
paragraph, no disabled "regenerate", no progress meter.

1. **The block h3** _"Auto-drafted from journal + pastoral notes + PG observations"_ — **REWRITE** to
   `The Form Master's character paragraph`. Drop "Auto-drafted" and the machine-inputs list.
2. **The provenance eyebrow** _"Draft · auto-generated · 14 May 2026"_ — **REWRITE** to the §1.3 author-stamp
   line (`Draft · written by {FM} · last edited {date}`). No "auto-generated".
3. **The inputs count** _"Generated from 11 reflection entries + 4 FM pastoral notes + 3 PG observations"_ —
   **OMIT ENTIRELY.** A "generated from N entries" line is the exact machine-summarisation claim owner #6
   forbids; the paragraph is typed by a human who happens to have read the journal.
4. **The regeneration horizon** _"revised at year-end with 9 remaining sessions"_ — **OMIT** (implies the draft
   re-computes as sessions accrue).
5. **The session counter** `DRAFT · 13 OF 22 SESSIONS` — **OMIT** the "· 13 OF 22 SESSIONS"; keep bare `DRAFT`.
   The counter reads as a regenerate-per-session progress bar.
6. **The foot regeneration note** _"Auto-draft regenerates after each session"_ — **OMIT** (the core lie). Keep
   `Written and owned by the Form Master · appears on the school-leaver reference letter, not the transcript`.
7. **Any keyword detection / theme extraction / AI summarisation / content analytics** — the editorial §02 aside
   already lists these as deliberate non-features; reaffirm for 43b: the paragraph is a **human-typed free-text
   field**, no derived-from-content anything.
8. **The demo paragraph body itself** (surface L577–579, Joseph's three paragraphs) — **do NOT ship as a
   placeholder, template, or pre-filled starter.** The honest empty-state is a **blank draft the FM writes** (§1.5
   Empty). The demo text is illustrative of the FM's register only.

**NOT omitted (guard against over-scrubbing):** the char-card itself (navy panel, Fraunces body, DRAFT/LOCKED
states); the `Edit draft` + `Lock for year-end` affordances (real FM/Dean writes); the `reference letter, NOT
transcript` line (true); the FM-author provenance; and the **HM read** (owner #2 — this card is the one wider-read
element, it must render for HM).

---

## 6. Cross-module hooks (design commitments — preserve)

- **Journal casework → the paragraph (the module's arc).** The whole 43a casework document exists so the FM can
  write THIS paragraph ("the journal becomes the document", surface L218). The paragraph is the **human output**
  of that record — the FM reads the entries/notes/observations (on the journal page) and **types** the paragraph;
  the system never bridges them automatically (owner #6). Preserve the narrative link (same student, same page
  family) **without** any data pipeline from casework → paragraph text.
- **Paragraph → school-leaver reference letter, NOT the transcript** (surface L564, L582). The paragraph is
  character prose for the reference letter (module-external); the **STPSHS/WASSCE transcript carries scores, never
  this**. This is a deliberate separation — keep the copy; do not wire the paragraph into any score/transcript
  export. *(Contrast the ledger→STPSHS and ledger→WASSCE-predictor hooks, which ARE data pipelines; this one is
  explicitly not.)*
- **HM read = the module's one leadership window.** Owner #2 makes the paragraph the single VLC element leadership
  sees. Preserve the boundary in both directions: HM **gains** the paragraph (via `VLC_PARAGRAPH_READ_ROLES`) and
  **gains nothing else** (still absent from `VLC_PASTORAL_READ_ROLES`, still `notFound` on the journal page).
- **Lock ↔ append-only ethos.** The journal is append-only "so it can be trusted" (editorial §02); the paragraph
  borrows the same trust posture at the **lock** point — once locked for the year-end letter it is **frozen**
  (§1.5). It is not append-only before the lock (a draft is revised in place, like the case summary), but the lock
  is the one-way commitment.

---

## 7. Open questions / drift log

1. **Owner #6 override (the whole card).** The surface presents the paragraph as auto-generated; owner: it is
   **FM-authored, no AI**. This map builds an FM-typed draft + lock, and omits every auto-generation string (§Ω).
   Confirm no machine-drafting affordance ships.
2. **Store is per-student, NOT per-flag (Kofi/Wells).** The paragraph is for every leaver, so it **cannot** be a
   column on `vlc_pastoral_case` (1:1 per flag) — it needs a new **per-student `vlc_character_paragraph`** table
   (§2). Confirm the table + its audit-redaction prefix.
3. **HM-read placement = recommend (a), the slim `/senior/vlc/reference/[studentId]` route** (§4), NOT (b)
   admitting HM into the journal page. Confirm the route + that the 43a journal gate stays FM+Dean-only.
4. **HM reach path.** HM has no journal/flag entry point; recommend a `Character reference` link on the student
   record / roster (visible HM+FM+Dean). Confirm where HM enters, or accept deep-link-only for 43b.
5. **Does HM see a DRAFT, or only the LOCKED paragraph?** The surface matrix (L606) says HM _"sees **finalised**
   character paragraph only"_ — arguably locked-only. **Recommend: HM sees the paragraph in whatever state it is,
   clearly badged `DRAFT`/`LOCKED`** (least machinery; the badge does the honesty). The stricter "locked-only for
   HM" is a one-line read filter if the owner prefers the surface's "finalised" wording. Confirm.
6. **Is lock one-way (no unlock)?** Recommend **locked = final for 43b** (mirrors the append-only trust ethos). If
   a school needs to correct a locked reference, that's a later decision (an ADMIN/HM unlock, or a superseding
   row). Confirm no unlock ships in 43b.
7. **Write scope = FM(own-class) + Dean, HM read-only** (owner). The Dean **can author/edit/lock** (same as FM,
   the shipped `canWritePastoralFlag` includes Dean); the HM **cannot** (not in the write gate). Confirm the Dean
   write + HM read-only split renders correctly.

---

*Map produced against: `Surfaces/schoolup-vlc-student-journal.html` (`.char-card` CSS L183–198, block L557–587,
matrix L606); the SHIPPED INCR-43a build (`app/(app)/senior/vlc/journal/[studentId]/page.tsx`,
`components/vlc/casework.tsx`, `components/vlc/chrome.tsx`, `lib/vlc/pastoral-data.ts`, `lib/vlc/authz.ts`,
`lib/actions/vlc-casework.ts`, `db/schema/vlc.ts` L630–766) and its access constants
(`lib/access.ts::VLC_PASTORAL_*_ROLES`); and the parent map `docs/senior/vlc-student-journal-surface-map.md`
(§Ω.1–2, §4, §7). Companion to that 43a map — the one wider-read card it deferred.*
