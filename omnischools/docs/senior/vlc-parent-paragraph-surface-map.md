# VLC Character-Paragraph → PARENT delivery — Surface Map (INCR-46 · Module 4.5 × parent portal 4.3)

**Author:** Lucy (design cartographer) · **Status:** design spec, ready for Wells (`parent_scope` RLS + prod paste) → Claude Code. Two owner/Kofi confirms flagged in §6.
**Increment:** INCR-46 · **VLC leaver character-paragraph → PARENT delivery.** The finalised FM-authored school-leaver character paragraph, shown to the parent of a leaver. This is the **first VLC content a parent ever sees** — a deliberate, tight exception to owner-lock #4 ("a parent sees NOTHING VLC-wide"). The forward reference in the 43b prod paste ("they receive the paragraph at leaver via INCR-45") is this delivery; the numbering shifted to 46 (INCR-45 became the capstone stub-retirement, build-plan L3148).

> **There is NO authored surface for this.** The parent surfaces in `Surfaces/` are attendance / conversations / meetings / WASSCE (`schoolup-wassce-parent-tracker.html`). The character paragraph is drawn only on the STAFF journal surface (`schoolup-vlc-student-journal.html`, `.char-card`). So this map does **not** transcribe a mock 1:1 — it places a **net-new, small parent-portal addition faithfully in the EXISTING parent portal**, matching its shipped conventions (the WASSCE tab's conditional-section stack + the INCR-29 sickbay confidential-but-scoped precedent).

## The boundary (the whole point — read first)

| Rule | Effect |
|---|---|
| **Own child only** | The parent sees ONLY their own child's paragraph. `studentId` is resolved server-side from the session (`children[0].studentId`), **never** a URL param — the shipped parent-portal contract. |
| **Finalised only** (`locked_at IS NOT NULL`) | A **draft** or an **absent** paragraph → the parent sees **nothing**. The parent never learns an unfinished paragraph exists. |
| **Body only** | ONLY the paragraph **body** + a dignified attribution. **NEVER** journal / notes / observations / case / flags / severity / draft state / lock stamps / other children — those stay parent-invisible. |
| **FM-authored, no AI** (owner #6) | Free text the Form Master typed. The copy must never imply a machine drafted, summarised, or generated it. No "DRAFT · N of 22", no "auto-generated", no session counter, no progress meter. |
| **Read-only** | No edit / lock / unlock / any write affordance. There is no parent write path anywhere in the portal (Kofi R4). |

## Source + the shipped code this extends

| File | Role |
|---|---|
| `app/(parent)/wassce/page.tsx` | **PLACEMENT ANCHOR** — the leaver's parent surface; renders `ChildPortal` with a stack of **conditional** cards (Hero iff open SC, ReadinessCard iff a statement, SmsThread iff rows). A finalised paragraph is one more such conditional card (§1). |
| `app/(parent)/wassce/page.tsx::ReadinessCard` (L523–580) | **PRIMARY VISUAL IDIOM** — the parent-side *dignified leaver artefact* card: gold gradient (`READINESS_GRADIENT`), `border-gold-soft`, Fraunces heading, calm navy body. The reference card mirrors this, NOT the staff navy confidential panel (§2). |
| `app/(parent)/parent-chrome.tsx` | **CHROME** — the fixed 6-flat-tab nav (`WASSCE · Sickbay · Communications · Billing · Boarding · School calendar`) + `ParentHeader`. Reused verbatim; **no new tab** (§1.1). |
| `lib/parent/parent-portal-data.ts::loadParentPortal` | **CHILD RESOLVE** — resolves the parent + `children[0]` under `withParentScope`. Already called by the WASSCE page; the reference reader runs beside it (§3), exactly as the Sickbay page calls `loadParentSickbayStatus` beside it. |
| `lib/parent/parent-sickbay-data.ts` | **THE PRECEDENT** — the confidential-but-scoped parent reader idiom (INCR-29): `withParentScope`, a **frozen narrow projection** that is the column guard, `studentId` an input-only filter never returned, **joins NOTHING** it doesn't need. The reference reader is built to this shape (§3). |
| `lib/vlc/paragraph-data.ts::getCharacterParagraph` | **THE STAFF READER (pattern, not reused)** — the structural guarantee that a reader that projects only `vlc_pastoral_paragraph` cannot surface casework. The parent reader is a **sibling** with a narrower still projection (body + author name only) and a hard `locked_at IS NOT NULL` filter. |
| `db/sql/policies.sql` (L303–530, `parent_student_ids()`, sickbay `parent_scope`) | **RLS PRECEDENT** — the `parent_scope` shape Wells adds to `vlc_pastoral_paragraph` (§4). |
| `db/sql/prod-paste-0072-vlc-paragraph.sql` | **CURRENT RLS STATE** — the table is `ENABLE+FORCE+tenant_isolation` **+ `parent_deny`** (catalog loop, no `parent_scope`). A parent read returns **zero rows today**. INCR-46 flips this ONE table to `parent_scope` (§4). |

---

# Part 1 — Placement recommendation

## 1.1 What it is NOT

- **NOT a new nav tab.** The parent chrome is a **fixed 6-tab drawn surface** (`parent-chrome.tsx` L56). Adding a 7th ("Reference") breaks the 1:1 chrome fidelity, and a permanent tab that is empty for every non-leaver would imply pending content — the exact "no pending" trap the boundary forbids. **Rejected.**
- **NOT a new dedicated `/reference` route under `(parent)`** (as primary). A non-tab route (the `/account` precedent) is *possible*, but it needs an entry link somewhere — and the only sensible place for that link is the leaver's WASSCE surface. So a dedicated route = *(the same WASSCE-surface link)* + a new route file + new page chrome, for identical reach. Heavier, for no gain. **Noted as the alternative in §1.3; not recommended.**

## 1.2 Recommendation — a conditional card on the existing `/wassce` parent tab

**Place the "School-leaver character reference" as one more conditional card inside `ChildPortal`, rendered ONLY when the child has a finalised paragraph.** This is the smallest faithful addition and matches two shipped conventions exactly:

1. **The WASSCE tab already stacks conditional dignified cards** — `{liveSc && <Hero/>}`, `{statement && <ReadinessCard/>}`, `{thread.length > 0 && <SmsThread/>}`. A finalised paragraph is the same shape: `{reference && <LeaverReference/>}`. No new pattern.
2. **The audience already matches.** A school-leaver *is* a Form 3 WASSCE candidate; the WASSCE tab is literally the "your child is finishing school" surface, and the `ReadinessCard` (a dignified, signed, reference-adjacent artefact) already lives there. The character reference is its natural sibling.

| Question | Answer |
|---|---|
| **Route** | `/wassce` (the existing parent WASSCE tab). **No new route.** |
| **How it's reached** | The leaver's parent opens the WASSCE tab they already use; the card renders as a section. No new nav, no new link, no click target to discover. |
| **Gate** | Rendered iff `loadParentLeaverReference(...)` returns non-null — i.e. the parent's own child has a **finalised** paragraph (§3–§4). Absent/draft → the card does not render (§5). |
| **Position** | The **final block of `ChildPortal`** (after the FAQ) — the closing word as the child leaves. *Alternative: immediately after `ReadinessCard`, grouping the two dignified leaver artefacts. Either is defensible; final-block reads most like a closing reference.* |
| **Chrome** | Unchanged. `ParentHeader` + `ParentNav active="WASSCE"` as built; the reference is body content, not chrome. |

## 1.3 The alternative (if the owner wants a standalone keepsake page)

A dedicated non-tab route `app/(parent)/reference/page.tsx` (mirroring the `/account` precedent — `ParentHeader` only, no `ParentNav`, a `← Back to portal` crumb), reached via a `View {First}'s character reference →` link placed on the WASSCE tab. This mirrors the STAFF `/senior/vlc/reference/[studentId]` for symmetry and gives the reference a letter-like page of its own. **Cost:** one route file + one page chrome + one WASSCE-tab link, for the same reach as §1.2. Recommend only if the owner explicitly wants the reference as a separate ceremonial page; otherwise the card (§1.2) is the lazy, faithful choice.

---

# Part 2 — The parent view, 1:1 (read-only, dignified)

**Component:** `components/parent/leaver-reference.tsx` (a small parent-side presentational component; the reference card is parent-only, so it does NOT reuse the staff `components/vlc/character-paragraph.tsx` — that one carries edit/lock affordances and the navy confidential idiom, neither of which belongs on the parent side).

**Card shell (the dignified idiom — mirror `ReadinessCard`, NOT the staff navy panel):** `rounded-xl border border-gold-soft px-6 py-[22px]` with the warm gold gradient inline style (`READINESS_GRADIENT = linear-gradient(135deg,#F5EBDC 0%,#FAF7F2 100%)`), matching the readiness artefact. Navy signals "internal/confidential/withheld" on the staff side; on the parent side the reference is a **gift**, presented warm. *(Acceptable simpler fallback: the plain `bg-surface border-border` info-card shell used by Sickbay/NHIS — but the gold treatment reads as the dignified keepsake the brief asks for.)*

| # | Element | Exact copy (proposed) | Token · type |
|---|---|---|---|
| **R1** | Eyebrow | `School-leaver character reference` | 10px/600 uppercase `tracking-[0.14em]` `text-navy-3` (the `ReadinessCard` "University target" eyebrow idiom) |
| **R2** | Heading (the child, reference-document style) | `{First} <em>{Last}</em>` (gold `<em>` on the surname — the `ChildCard` idiom, L289) | Fraunces `font-display text-[22px] font-medium leading-tight text-navy`; `<em className="not-italic text-gold">` |
| **R3** | Attribution (43b provenance, dignified) | `Written by {FM full name}, Form Master · {School name}` | 11px `text-navy-3` (dignified reference-letter attribution; **not** an audit stamp) |
| **R4** | Divider | — | `border-t border-gold-soft` (SOLID, matches `ReadinessCard`) |
| **R5** | Paragraph body (the FM's own free text) | the finalised `body`, verbatim, `whitespace-pre-wrap` | Fraunces `font-display text-[15px] leading-relaxed text-navy-2`, `whitespace-pre-wrap`; any inline `<b>`/`<em>` → `text-gold` (mirror the staff body treatment, on a light card so text is navy not `text-bg`) |
| **R6** | Closing gloss *(optional)* | `This reference was written by {First}'s Form Master as {First} completes {School}. It is shared with you as a record of {First}'s character; it is separate from the WASSCE results.` | 11px `text-navy-3`, above a small `border-t border-gold-soft` — reinforces "reference letter, not transcript" in parent voice |

**Copy notes:**
- **R2/R3 name resolution.** `{First}/{Last}/{First}` come from the already-resolved `child` (`loadParentPortal`); `{FM full name}` is the paragraph's `author_user_id` → `users.fullName` (the staff reader already resolves this as `authorName`, defaulting to `the Form Master` when null); `{School name}` is `school.name` (already in the page). No new identity read.
- **R3 role label.** "Form Master" is owner #6's design intent (FM-owned scaffold). A **Dean** can also author (write set = own-class FM + Dean). If strict author-accuracy matters, drop ", Form Master" and show only `Written by {author name} · {School name}` — confirm in §6.
- **NO status pill, NO date-locked stamp, NO "View PDF" link** (the paragraph has no PDF artefact — that is the readiness statement's, not this). NO edit / lock / write button. NO severity, flag, journal, or case anything.

---

# Part 3 — The parent reader (server-only, the column + state guard)

**NEW `lib/parent/parent-reference-data.ts`** (`"server-only"`), built to the `parent-sickbay-data.ts` shape. This projection is the guard: RLS is row-level and **cannot mask a column**, so the tightness of this SELECT — and the fact it touches only `vlc_pastoral_paragraph` (+ `users` for the author name) and **joins none of the four casework tables** — is what keeps everything but the body off the wire.

```
export interface ParentLeaverReference {
  body: string;         // the finalised paragraph, verbatim
  authorName: string;   // users.fullName of author_user_id, or "the Form Master"
}
// studentId is an INPUT filter (resolved from session), NEVER returned. locked_at / ids / draft
// state / journal / note / observation / case / flag / severity are NEVER in the SELECT.

loadParentLeaverReference(schoolId, userId, studentId): Promise<ParentLeaverReference | null>
  = withParentScope(schoolId, userId, (tx) =>
      tx.select({ body: vlcPastoralParagraph.body, authorName: users.fullName })
        .from(vlcPastoralParagraph)
        .leftJoin(users, eq(users.id, vlcPastoralParagraph.authorUserId))
        .where(and(
          eq(vlcPastoralParagraph.schoolId, schoolId),
          eq(vlcPastoralParagraph.studentId, studentId),
          isNotNull(vlcPastoralParagraph.lockedAt),   // 🔴 the finalised gate (belt; RLS is the braces)
        ))
        .limit(1)
      // → { body, authorName: row.authorName ?? "the Form Master" } | null
    );
```

- **Always `withParentScope`, never `withoutTenantScope`** (the D10 parent-loader rule). The `parent_scope` RLS predicate independently guarantees the `studentId` can only be one of this parent's own children — a forged id yields zero rows (fail-closed).
- **`locked_at IS NOT NULL` filter is enforced HERE and in RLS** (§4). Belt-and-braces because draft-invisibility is a hard privacy boundary (not display logic) — a reader bug alone cannot leak a draft.
- **Wire it in the page** beside the existing loader:
  `const reference = child ? await loadParentLeaverReference(school.id, user.id, child.studentId) : null;`
  then pass into `ChildPortal` and render `{reference && <LeaverReference child={child} school={school.name} reference={reference} />}`.

---

# Part 4 — RLS (Wells) — flip this ONE table from `parent_deny` to `parent_scope`

**Current state (prod-paste-0072):** `vlc_pastoral_paragraph` has `ENABLE + FORCE + tenant_isolation` and is caught by the **catalog-driven `parent_deny` loop** (it has no `parent_scope`). **A parent read returns zero rows today** — fail-closed, honest, but non-functional. INCR-46's entire DB delta is adding a narrow `parent_scope` to this one table; the catalog loop then auto-**skips** it (it selects only tables lacking `parent_scope`), so the deny→scope swap is structural, no hand-list edit.

**The policy Wells adds** (byte-shaped like the sickbay `parent_scope`, `policies.sql` L488, using the sanctioned `parent_student_ids()` SECURITY DEFINER helper), with the finalised gate baked in:

```sql
DROP POLICY IF EXISTS parent_deny  ON vlc_pastoral_paragraph;
DROP POLICY IF EXISTS parent_scope ON vlc_pastoral_paragraph;
CREATE POLICY parent_scope ON vlc_pastoral_paragraph AS RESTRICTIVE FOR ALL TO public
  USING (
    NULLIF(current_setting('app.current_parent_user', true), '') IS NULL
    OR (
      locked_at IS NOT NULL                              -- 🔴 a parent reaches ONLY finalised rows
      AND student_id IN (
        SELECT parent_student_ids(
          school_id, NULLIF(current_setting('app.current_parent_user', true), '')::uuid)
      )
    )
  );
```

**Notes for Wells:**
- **Baking `locked_at IS NOT NULL` into RLS is stronger than the sickbay precedent** (which leaves open-state to the reader, because open-vs-closed is *display* logic). Here draft-invisibility is a **privacy boundary** — a draft must be structurally unreadable by a parent even if a future reader forgets the filter. Recommend baking it in **and** the reader filter (§3). This is a Wells call; flagged in §6.
- **Staff writes/reads are unaffected.** Staff paths run under `withSchool` (no `app.current_parent_user`), so the `pu IS NULL` short-circuit passes them through `tenant_isolation` exactly as before. The staff reader (`getCharacterParagraph`) and the write actions are byte-unchanged.
- **`FOR ALL` USING doubles as WITH CHECK** — but there is no parent write path anywhere (Kofi R4), so this only ever runs on SELECT.
- **🔴 PROD PASTE REQUIRED** (repo memory `prod-rls-manual-paste`): RLS is not auto-applied on prod. Ship a `db/sql/prod-paste-00NN-parent-paragraph-scope.sql` mirroring this block (the sickbay `prod-paste-0064-parent-sickbay-scope.sql` precedent), hand-run on prod, then `verify-prod-rls.sql`: **`parent_readable` +1, `parent_denied` −1** for this table. Without the paste, the table keeps `parent_deny` on prod and the card is an honest empty state (fail-closed, never a leak).

---

# Part 5 — Empty / absent state

**Recommendation: the section simply does not appear. No line, no placeholder, no "not yet available."**

| Situation | `loadParentLeaverReference` returns | Parent sees |
|---|---|---|
| Finalised paragraph exists | `{ body, authorName }` | the reference card (Part 2) |
| Only a **draft** exists (`locked_at IS NULL`) | `null` (RLS + reader filter it) | **nothing** — no card |
| **No** paragraph row at all | `null` | **nothing** — no card |
| Loading | — | the surrounding WASSCE tab renders; the card just isn't there yet (no skeleton needed — it's a leaf card, not a hero) |

**Why omit, not a neutral "not yet available":**
- **A draft and an absence are indistinguishable to the parent** — both return `null` → no card. A "not yet available" line would (a) for a draft, leak that a paragraph is being written (breaching the "no pending content" rule), and (b) for a genuine absence, falsely promise a reference that may never come. Omitting reveals nothing in every case.
- **It matches the shipped convention exactly** — the WASSCE tab omits `Hero`/`ReadinessCard`/`SmsThread` when their data is absent (no "no readiness statement yet" line), and the sickbay tab's forbidden fields are omitted-not-faked. The reference card is the same doctrine.

---

# Part 6 — Non-disclosure checklist (the load-bearing output)

The parent view must show **ONLY their own child's finalised paragraph body + the FM/school attribution.** Everything below must NEVER appear — most are structurally impossible because the reader never touches their table/column, which is the point.

| # | Must NEVER show the parent | Enforced by |
|---|---|---|
| N1 | **A draft body** (`locked_at IS NULL`) | RLS `locked_at IS NOT NULL` **+** reader `isNotNull(lockedAt)` — draft → `null` → no card |
| N2 | **"DRAFT" / "LOCKED" status, session counters** ("13 of 22"), any progress/finalise state | not projected; the parent card has no status pill (owner #6 / 43b omit-not-fake) |
| N3 | **Any "auto-generated / auto-drafted / summarised / regenerates" framing** | FM-authored free text; no such copy anywhere (owner #6) |
| N4 | **Journal entries** (`vlc_pastoral_journal.body`) | reader never selects/joins that table |
| N5 | **FM pastoral notes** (`vlc_pastoral_note.body`) | reader never selects/joins that table |
| N6 | **PG observations** (`vlc_pastoral_observation.body`) | reader never selects/joins that table |
| N7 | **Case file / case summary** (`vlc_pastoral_case.summary`) | reader never selects/joins that table |
| N8 | **Pastoral flag existence / severity / concern level** (`vlc_pastoral_flag`) | reader never selects/joins that table; INCR-30 non-disclosure preserved |
| N9 | **Any OTHER child's paragraph** | `parent_scope` + `parent_student_ids()`; `studentId` resolved from `children[0]` (session), never a URL param |
| N10 | **Edit / lock / unlock / any write affordance** | read-only component; no server action mounted; RLS `FOR ALL` has no parent write path (Kofi R4) |
| N11 | **Audit / lock stamps** (`locked_by_user_id`, `updated_by_user_id`, raw `updated_at`/`locked_at` timestamps) | not projected; the parent gets a dignified attribution (FM name + school), not audit metadata |
| N12 | **Existence leak of a draft** | draft → `null` → card absent; the parent cannot distinguish "no paragraph" from "draft in progress" (N1 + Part 5) |

**Reviewer tripwire (mirror the sickbay R227/28b discipline):** grep the served parent-WASSCE HTML for a draft paragraph's body, any journal/note/observation/case text, any flag/severity token, any "DRAFT"/session-count string — **zero hits**. Only a *finalised* body + the attribution may appear.

---

# Part 7 — Repo-convention flags (for the implementer)

1. **Reuse the parent chrome verbatim** — `ParentHeader` + `ParentNav active="WASSCE"`. **No new tab, no new nav item** (§1.1). The card is body content inside the shipped `mx-auto max-w-[980px]` frame.
2. **Reuse the `ReadinessCard` visual idiom** (gold gradient + `border-gold-soft`), NOT the staff navy confidential panel. New file `components/parent/leaver-reference.tsx`; do **not** import `components/vlc/character-paragraph.tsx` (it carries write affordances + the navy idiom).
3. **No-alpha token discipline** (repo memory `no-alpha-token-opacity`): use SOLID tokens only — `text-navy-3`, `text-navy-2`, `border-gold-soft`, `text-gold` `<em>`. **Never** slash-opacity on raw-hex tokens (`text-navy/70`, `bg-gold/80`). The gradient is an inline `style` (as `ReadinessCard` does it), not a Tailwind alpha. **Verify tints in the live preview, not the build.**
4. **Server-only reader** (repo memory `reports-data-is-server-only`): `lib/parent/parent-reference-data.ts` imports the db driver — the client card component must take pre-formatted `{ body, authorName }` and never import the reader. Only `pnpm build` catches that leak.
5. **`withParentScope` always** (D10). `studentId` is an input filter resolved from the session (`children[0].studentId`), never a URL param — the shipped parent-portal contract.
6. **Ghanaian school-operations voice** — keep "Form Master", "School-leaver character reference", "completes {School}" in the deliberate register; the copy is text-forward (Fraunces heading, Manrope attribution), no emoji, no icons.
7. **Read-only, everywhere** — component has no button, no form, no action import; RLS is `FOR ALL` but no parent write path exists.

---

# Part 8 — Cross-module hooks (preserve)

| Hook | On this surface | Status |
|---|---|---|
| **Journal casework → the paragraph** (the module's arc) | the parent receives the **human output** of the confidential record — the body only, never the record | ✅ preserved: the reader never bridges casework → parent; owner #6, no data pipeline |
| **Paragraph → school-leaver reference letter, NOT the transcript** | R6 closing gloss restates this in parent voice; the reference is separate from WASSCE results shown on the same tab | ✅ preserved: no wiring of the paragraph into any score/transcript/STPSHS export |
| **VLC parent-visibility = NONE, except this** (owner #4) | this card is the **single, tight exception** — the first and only VLC content a parent sees, and only when finalised | ✅ preserved: no other VLC table gains `parent_scope`; the catalog `parent_deny` loop re-affirms every other VLC table with zero edits |
| **Lock ↔ delivery** | the FM's `Lock for year-end` (43b) is the one-way commitment that *is* the parent-delivery trigger — locking makes the row parent-visible | ✅ the `locked_at IS NOT NULL` gate is the same commitment point the staff card documents; no new state |

---

# Part 9 — Open questions (Wells / owner / Kofi)

1. **Finalised gate in RLS or reader-only? (Wells)** Recommend **both** — bake `locked_at IS NOT NULL` into the `parent_scope` USING predicate (§4) **and** filter in the reader (§3). Stronger than the sickbay precedent because draft-invisibility here is a privacy boundary, not display logic. Confirm.
2. **Attribution role label (R3).** Recommend `Written by {FM name}, Form Master · {School}`. If Dean-authored accuracy matters, drop the role → `Written by {author name} · {School}`. Confirm.
3. **Card position on the WASSCE tab.** Recommend the **final block of `ChildPortal`** (closing word); grouping right after `ReadinessCard` is the alternative. Confirm.
4. **Card vs dedicated `/reference` parent page.** Recommend the **card** (§1.2); the standalone page (§1.3) only if the owner wants a ceremonial letter-page. Confirm.
5. **Closing gloss (R6).** Optional. Recommend including it (reinforces "reference, not transcript" in parent voice). Confirm keep/drop.

---

*Map produced against the SHIPPED parent portal (`app/(parent)/wassce/page.tsx` incl. `ReadinessCard`, `app/(parent)/parent-chrome.tsx`, `app/(parent)/account/page.tsx`, `lib/parent/parent-portal-data.ts`, `lib/parent/parent-sickbay-data.ts`), the SHIPPED 43b staff paragraph (`lib/vlc/paragraph-data.ts`, `components/vlc/character-paragraph.tsx`, `lib/vlc/authz.ts::canReadPastoralParagraph`, `lib/access.ts::VLC_PARAGRAPH_READ_ROLES`), the RLS layer (`db/sql/policies.sql` `parent_student_ids()` + sickbay `parent_scope` L488/L501; `db/sql/prod-paste-0072-vlc-paragraph.sql` current `parent_deny` state), and the build plan (owner-lock #4 "parents NOTHING VLC-wide, they receive it at leaver"; #6 FM-authored no-AI; R341 leaver read key `SELECT body WHERE student_id=X AND locked_at IS NOT NULL`). Companion to `docs/senior/vlc-character-paragraph-surface-map.md` (43b) and `docs/senior/parent-sickbay-surface-map.md` (the confidential-but-scoped parent precedent).*
