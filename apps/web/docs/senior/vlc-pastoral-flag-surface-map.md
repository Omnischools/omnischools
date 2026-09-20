# VLC Pastoral Flag — Surface Map (INCR-42b · Module 4.5 / surface 03 · the CONFIDENTIAL half of the session register)

**Author:** Lucy (design cartographer) · **Status:** design spec, ready for the implementation engineer.
**Scope of this map:** the ONE region my INCR-42a map (`docs/senior/vlc-session-register-surface-map.md`,
§2.8 + §Ω.1) deliberately deferred — the terra **`.flag-callout`** and every place a flag surfaces on the
live-session register. 42a shipped the operational register (`components/vlc/session-register.tsx`,
`lib/vlc/session-data.ts`, the page at `app/(app)/senior/vlc/sessions/[classId]/[date]/page.tsx`) and rendered
**nothing** in the flag position. 42b lights that position up **for the two gated viewers only** and wires the
FIRST `vlc_pastoral_` table.

**This increment is a SECURITY increment (Sarah is the star), not a layout increment.** The build is small; the
gate is the whole point. Two concentrated risks (build-plan L3169): **(1)** FM **own-class** read scoping
(tighter than the sickbay role-only precedent — get it wrong and an FM reads another class's flags); **(2)** the
`vlc_pastoral_` REDACTED prefix branch (one line, re-classifies a whole family).

**HARD BOUNDARY — 42b builds the FLAG only: metadata + ONE short context string.** Anything that is a rich
**narrative / private case note / case-file / journal-history link** is **INCR-43 → omit-not-fake** (§Ω). The
`Open private case note` button and the long "What Akua noticed / father died in February" bereavement paragraph
are INCR-43; the copy must never imply a working case-file exists (the `lib/boarding/pastoral-stub.ts`
precedent: *"There is NO working VLC system behind this; the copy … must not imply one."*).

Rule where surface and spec disagree: **spec wins on logic, surface wins on visual presentation.** Drift called
out inline + collected at the end.

## Source

| File | Role |
|---|---|
| `Surfaces/schoolup-vlc-session-register.html` L173–184 (CSS), **L513–531** (the `.flag-callout` markup), L255 (lede clause), L341 (small-groups meta), L495/L507 (agenda welfare clauses), L547–551 (foot stat) | **PRIMARY** for the flag's visual + copy. |
| `components/vlc/session-register.tsx`, `app/(app)/senior/vlc/sessions/[classId]/[date]/page.tsx`, `lib/vlc/session-data.ts` | **SHIPPED 42a** — the built register 42b extends. The callout inserts between the agenda `<section>` and the foot-bar `<section>` (page L307↔L309). |
| `lib/vlc/authz.ts` (`canWriteSession`), `lib/audit/redaction.ts` (`isRedactedAuditEntity` + the two entity sets), `lib/boarding/pastoral-stub.ts` (`isPastorallyFlagged`, ASK-24-0118), `db/schema/vlc.ts` L354–491 (`vlc_session`/`vlc_session_attendance`) | **REUSE + EXTEND anchors** (§6). |

**Build-plan anchors:** `docs/senior-build-plan.md` L3165–3171 (INCR-42 decomposition, owner calls RESOLVED
2026-07-27). Owner decisions LOCKED for 42b: **(b)** flag READ gate = **FM(own-class) + Dean of Students ONLY**
(ADMIN barred, HM excluded — tightest); **(c)** flag CREATE = **FM + Dean**, the PG recorded as a `surfaced_by`
**data** field (no PG write; true PG-write deferred to INCR-43); **(#4)** parents see **nothing** VLC-wide
(`parent_deny`). Continuity (L3171): the stub's ASK-24-0118 (Joseph Manu) **is** the surface's "J. Manu"
bereavement flag.

---

## 0. Token & type reference (the flag-callout delta only — the terra family)

Same `:root` as every Senior surface. The callout is the surface's ONE all-terra region (my 42a §0 flagged
`--terra`/`--terra-bg` as "OMITTED §Ω" — 42b un-defers exactly these).

| Surface `var(--x)` | Hex | Tailwind class | Used for on the callout |
|---|---|---|---|
| `--terra` | `#B84A39` | `text/border-terra`, `bg-terra` | 1.5px callout border; the `!` icon tile ground; the `FM + DEAN ONLY` badge ground; `.sub b` (severity, student); `.fc-body em`; the dashed head divider |
| `--terra-bg` | `#F5E1DC` | `bg-terra-bg` | the whole callout ground |
| `--bg` | `#FAF7F2` | `text-bg` | text ON terra — the `!` icon glyph, the badge label |
| `--navy` | `#1A2B47` | `text-navy` | `.fc-body b` bold |
| `--navy-2` | `#2D3F5C` | `text-navy-2` | `.sub` line, `.fc-body` body copy |
| `--border-2` | `#D4CCBA` | `border-border-2` | the two non-terra action buttons |

**Type:** Fraunces (`font-display`) — the `h4` heading, its gold→terra `<em>`, the `!` icon glyph, the `.fc-body
em`; Manrope (default) — the `.sub` metadata, the body paragraph, all three buttons. **No JetBrains Mono in the
callout** (the `3:08 PM` in the heading is Fraunces italic, not mono — do not reach for `font-mono` here).

**No-alpha token trap (memory `no-alpha-token-opacity`) — the callout is terra-tinted, the classic trap
surface.** Every terra usage is a **solid** token; there is NO alpha anywhere in the callout CSS. Translate 1:1:
- ground → **`bg-terra-bg`** (NOT `bg-terra/10`); border → **`border-terra`**; text → **`text-terra`**.
- text on the terra icon/badge → **`text-bg`** (solid), NOT `text-white/90`.
- This mirrors the **already-shipped** terra pattern in `session-register.tsx` (the absent P/L/A cell uses
  `border-terra bg-terra-bg` + `text-terra` — L25). **Reuse that exact idiom; do not invent a slash-opacity
  variant.** A broken slash-opacity compiles clean — verify the callout tint in the **live preview**, not the
  build.

---

## 1. Placement, route & the confidential gate (the crux)

### 1.1 Placement — on the session register, one gated block
- The flag lives **ON** `/senior/vlc/sessions/[classId]/[date]` (the shipped 42a page), inserted **between the
  agenda `<section>` and the foot-bar `<section>`** (page L307↔L309), exactly where the surface draws it
  (L511→L531, after the agenda block, before `.foot-bar`).
- **No new route.** The page read-gate is unchanged (`VLC_CONFIG_READ_ROLES`); the callout is gated **narrower,
  inside** the page (§1.2). A non-gated staffer still loads the register — they simply get no flag block.

### 1.2 The flag gate — narrower than the page (the sickbay-narrower-than-page precedent)
The page renders to **`VLC_CONFIG_READ_ROLES` = [DEAN_OF_STUDENTS, ADMIN, HEADMASTER, FORM_MASTER]** (school-wide;
the operational register carries no PII). **The flag is read-gated NARROWER than that** — the same relationship
the INCR-30 audit feed has to clinical entries (renders to all-staff; the confidential class is suppressed).

**READ = WRITE = FM(own-class) OR Dean of Students.** Owner (b)+(c) locked read and create to the same set:

```
canAccessPastoralFlag({ roles, userId, classTeacherUserId }) =
     roles.includes("DEAN_OF_STUDENTS")                              // school-wide pastoral authority
  || (!!userId && !!classTeacherUserId && userId === classTeacherUserId)  // the class's OWN Form Master
```

- **🔴 THE OWN-CLASS TRAP (risk #1).** `FORM_MASTER` must **NOT** be in the role-set. A blanket
  `roles.includes("FORM_MASTER")` gives **every** FM **every** class's flags — the exact IDOR the owner call
  guards. The FM arm is an **identity match** (`userId === class.classTeacherUserId`), not a role membership.
  This mirrors the shipped `canWriteSession` (`lib/vlc/authz.ts`) — but the flag **adds the Dean** to the gate
  (the session-register write is FM-only; the *flag* is FM-own-class + Dean). **Do not reuse `canWriteSession`
  verbatim** — add a sibling `canAccessPastoralFlag` in the same file.
- **The Dean is school-wide, not own-class-scoped** — Dean of Students is the school's pastoral authority; the
  Dean reaching any class's register sees that class's flags. No own-class clause for the Dean.
- **ADMIN barred, HM excluded** — both are in `VLC_CONFIG_READ_ROLES` (they see the whole operational register)
  but are **absent from the flag gate**. `canAccessPastoralFlag` must **not** fall back to the page read set.
- **`VLC_PASTORAL_READ_ROLES` / `_WRITE_ROLES`** (mirror `SICKBAY_CLINICAL_*`, build-plan L3169) each =
  `["DEAN_OF_STUDENTS"]` — the role arm only; the own-class-FM arm is the identity clause above, never a role.
- **Defense in depth — the flag never enters a non-gated viewer's props.** The read is a **separate server
  query** (`getPastoralFlags(schoolId, sessionId)` in a new `server-only` lib) called **only after**
  `canAccessPastoralFlag` passes server-side. A non-gated viewer's page never fetches a flag row — the callout
  is absent from the React tree, not hidden by CSS. RLS (`FORCE` + `tenant_isolation` + `parent_deny`) is the
  tenant/parent boundary; the app-layer own-class+Dean gate is the intra-tenant read scoping.
- **Quinn's non-vacuous matrix (build-plan L3169):** own-class FM **sees** / other-class FM = **0** / Dean
  **sees** / HM = **0** / ADMIN = **0** / parent = **0**. This is the whole increment's proof.

---

## 2. The `.flag-callout`, 1:1 (surface L513–531)

Terra panel (`bg-terra-bg`, `border-terra` 1.5px, `rounded-xl`, `p-[18px_22px]`). Three parts: head · body ·
actions.

### 2.1 `.fc-head` — the flag metadata line (THIS is the 42b build target)
Flex row, dashed terra bottom-border (`border-b border-dashed border-terra pb-3 mb-3`):
- **`.ic`** — a 36px `rounded-lg bg-terra text-bg` tile, Fraunces 700 16px, glyph **`!`**. (Static severity
  glyph; not a data field.)
- **`.info h4`** (Fraunces 600, 16px): **`Pastoral flag raised`** + `<em class="italic text-terra">· 3:08 PM</em>`.
  - The `3:08 PM` DERIVES from `raised_at` (formatted to the school tz, the `formatVlcTime` idiom).
- **`.info .sub`** (`text-[11px] text-navy-2`), **VERBATIM**, with `<b class="text-terra font-bold">` on the
  bolded spans:
  > `Raised by ` **`Akua Gyamfi (PG)`** ` · student: ` **`J. Manu`** ` · context: Group B plenary share-back ·
  > severity: ` **`CONCERN`** ` (intermediate level, not crisis)`
  - **`Raised by {PG}` = the `surfaced_by` attribution, NOT the writer** (drift #1). The body says Akua *"quietly
    told Mr Mensah"* — Mensah (the FM) recorded it. Owner (c): the **PG does not write**; the FM/Dean records
    with the PG named as `surfaced_by` **data**. **Recommend the built copy read `Surfaced by Akua Gyamfi (PG)`**
    (honest) rather than `Raised by` (implies the PG wrote it, which the owner decision forbids). The PG name +
    `(PG)` DERIVE from the `surfaced_by_peer_guide_id` join to the INCR-41 roster.
  - `student: J. Manu` DERIVES from `student_id` → `students` (the `shortNameOf` "J. Manu" idiom). *(Surface
    demo-data note: the P/L/A grid shows "CC. Manu" not "J. Manu" — demo noise; the flag's student is a real FK,
    not the grid cell. The grid does **not** mark the flagged student — see §4.)*
  - `context: Group B plenary share-back` = **the ONE short context string** (the free-text the raiser types —
    where/when). This is the 42b context field. It is **short**; the long bereavement paragraph is NOT it (§Ω).
  - `severity: CONCERN (intermediate level, not crisis)` = the `severity` enum; the parenthetical confirms a
    **3-level scale, CONCERN = middle** (recommend `('WATCH','CONCERN','CRISIS')` — Kofi's exact values, flag #4).
- **The confidential-visibility badge** (`.fc-head` right, inline style on the surface): a terra pill,
  `bg-terra text-bg`, `text-[9px] font-bold uppercase tracking-[0.08em]`, label **`FM + DEAN ONLY`**.
  - This label is the surface's own statement of the gate. **Render it verbatim** — it is the human-readable
    confirmation of §1.2 (visible only to the two who can already see the callout; a non-gated viewer sees
    neither the callout nor the badge). Surface wording is `FM + DEAN ONLY`; an equally faithful long form is
    *"Visible to Form Master & Dean only."* Keep the surface's short pill.

### 2.2 `.fc-body` — the bereavement paragraph → **SPLIT: short context is 42b, the narrative is INCR-43**
`text-[12px] text-navy-2 leading-relaxed`, one paragraph (surface L524), **verbatim** for the map:
> **What Akua noticed:** J. Manu became visibly upset (tearful, quiet) during the discussion of "what Ghana
> means to me" — specifically when another student mentioned a family member abroad sending money home. *J.
> Manu's father died in February*, the family has been struggling financially, and this is the first time the
> topic has come up in a group setting. He asked to step outside; Akua walked him out, sat with him for two
> minutes, then quietly told Mr Mensah on his way back to plenary. **Queued for FM check-in** at end of session
> (Phase 5 close).

- **This whole paragraph is a rich pastoral narrative — it is NOT the 42b "ONE short context string."** It names
  a bereavement, family financial hardship, the child's visible distress, and a walk-out account. That is a
  **private case note (INCR-43)**, not a flag field. **42b does NOT store or render this paragraph.** (§Ω.1)
- **What 42b renders in the body slot instead:** the ONE context string from §2.1 (`Group B plenary share-back`)
  — that's already in the head `.sub`. So in 42b the callout is **head + actions**, with the body either absent
  or a single neutral line (e.g. the derived active status **`Queued for FM check-in`** — see §2.3). Do **not**
  render a rich free-text body; a multi-sentence note box IS the INCR-43 case note.
- **`Queued for FM check-in`** (the bold span) = the DERIVED status of an **active** flag (`resolved_at IS
  NULL`). Render it as a derived label, not a stored string. (Matches the lede + foot-stat "FM check-in queued".)

### 2.3 `.flag-actions` — the three buttons (map each; only ONE is a clean 42b action)
`flex gap-2`, three buttons (surface L526–530):

| Surface button | class | 42b disposition |
|---|---|---|
| **`Open private case note`** | `.btn.terra` | **INCR-43 → OMIT** (§Ω.1). A "case note" is the append-only private narrative/case-file — the thing 42b explicitly does not build. **Do not render** (not even disabled/"coming soon" — a case-note button implies a case-file system, the pastoral-stub anti-pattern). |
| **`Add to FM check-in queue`** | `.btn` | **No separate queue entity in the locked shape.** "Queued for FM check-in" is the DERIVED status of an active flag (`resolved_at IS NULL`), not a table. **Omit the literal button**; render the derived status (§2.2). If the owner wants a real check-in queue, that is beyond owner (c)'s locked flag shape — flag #5. |
| **`Escalate to Dean`** | `.btn.ghost` | **The Dean already reads every flag** (Dean is in the gate, §1.2), so "escalate" is **not a new visibility grant** and **not a notification pipeline** (out of scope). Cleanest 42b reading: escalation = **bump `severity` to `CRISIS`** (a one-field update on the existing column). **Recommend folding it into the severity control on the raise form** and dropping the separate button; if kept, it is a severity-set shortcut, nothing more. Flag #4/#6. |

**The 42b action the surface does NOT draw but the schema demands: RESOLVE.** The flag lifecycle is `raised
(resolved_at NULL = active)` → `resolved (resolved_at set)`. The live snapshot shows an active flag, so no
resolve control is drawn — but 42b needs one. Add a **`Mark resolved`** affordance (own-class FM / Dean), which
stamps `resolved_at` + `resolved_by_user_id`; a resolved flag renders muted / drops out of the "raised" count.
(Reopen = clear `resolved_at`, optional.)

---

## 3. Raise + resolve affordances — who sees them, and the Peer Guide's non-role

### 3.1 Raise a flag (the CREATE affordance)
- **Who sees the "Raise flag" control:** **own-class FM + Dean only** (= `canAccessPastoralFlag`). NOT HM, NOT
  ADMIN, NOT another class's FM, NOT a PG. Non-gated viewers never see the control (same gate as the callout).
- **Form fields (the locked flag shape, owner c):**
  - **student** — a picker over the class roster (`student_id`, composite FK). Required.
  - **severity** — the enum (WATCH / CONCERN / CRISIS). Required; default CONCERN.
  - **context** — ONE short free-text line (the `Group B plenary share-back` string). Short; **not** a rich
    narrative box (that's the INCR-43 case note).
  - **surfaced_by** — optional attribution: which active PG surfaced it (a select over this class's INCR-41
    `vlc_peer_guide` roster) → `surfaced_by_peer_guide_id`. **Data, not a writer.** Nullable (an FM/Dean can raise
    a flag with no PG surfacer).
  - (auto) `raised_at = now`, `session_id` = the current session, `raised_by_user_id` = the actor,
    `resolved_at = NULL`.
- **Write re-check server-side.** Every raise/resolve server action re-runs `canAccessPastoralFlag` (the
  disabled control is convenience, the action is the boundary — the shipped `markAttendance` idiom).

### 3.2 Resolve a flag
- **Who:** own-class FM + Dean (same gate). Stamps `resolved_at` + `resolved_by_user_id`. §2.3.

### 3.3 What a Peer Guide sees — **nothing, and no raise button** (owner c)
- A PG **surfaces a concern verbally** to the FM/Dean, who **records** it (PG named as `surfaced_by`). **There is
  NO PG raise button and NO PG UI** — PGs are not even in `VLC_CONFIG_READ_ROLES`, so a PG cannot open the
  register at all. (True PG-write is deferred to INCR-43.) The surface's `Raised by Akua Gyamfi (PG)` is the
  attribution of a flag **Mr Mensah wrote**, not a PG action (§2.1 drift #1).

---

## 4. Confidential rendering contract across the register — **what a NON-gated viewer sees = NOTHING**

This is the security-sensitive display contract. The **only** sites a flag may render are the three gated ones
below; every school-wide-read region of the register carries **no** per-student flag information for **anyone**.
The invariant: **a non-gated viewer's register is byte-identical to the shipped 42a register** (which is also
identical to a gated FM's register when their class has zero flags) — so existence cannot be inferred.

| Render site | Region visibility | Gated viewer (own-class FM / Dean) | **NON-gated viewer** (HM · ADMIN · other-class FM · PG · parent) |
|---|---|---|---|
| **`.flag-callout`** (§2) | gated block | full callout (head + actions), OR an empty state only for a gated FM whose own class has none | **NOT RENDERED** — component absent from the tree; the flag row is never fetched into props. No panel, no stub, no "0 flags", no "restricted" placeholder. |
| **head-row lede clause** `· 1 pastoral flag raised at 3:08 PM` (surface L255) | school-wide-read lede | the gated build **appends** `· {n} pastoral flag{s} raised` to the 42a lede | **42a lede UNCHANGED** — no clause. (A gated FM with zero flags also gets no clause → non-gated == zero-flag == indistinguishable.) |
| **foot-bar "Pastoral flags" stat** `1 raised · Concern · FM check-in queued` (surface L547–551) | navy foot-bar | a **4th** `FootStat` renders (grid → `repeat(4,1fr)_auto`) | **3-stat foot-bar** (the shipped 42a `repeat(3,1fr)_auto`) — no 4th stat, no gap, no layout shift. |
| **per-student flag indicator in the P/L/A grid** | school-wide-read grid | **NONE** — the grid never marks the flagged student | **NONE** — same. |
| **agenda `what` welfare clauses** (Plenary `· J. Manu stepped out … visibly upset · Akua handled it well`; Close `· FM holds back J. Manu for 1-on-1 check-in`) | school-wide-read agenda | **NOT re-added** — the agenda stays the shipped operational `w.description` | **NOT re-added** — same. |
| **small-groups meta** `monitors energy & flags` (surface L341) | school-wide-read meta | stays operational `monitors energy` (optional `& flags` — low value, §Ω) | operational `monitors energy` — same. |

**Three rulings that make this hold:**
1. **The grid must NOT gain a per-student flag dot.** The P/L/A grid is `VLC_CONFIG_READ_ROLES` (HM, ADMIN,
   other-class FM all see it). A flag marker on J. Manu's cell would leak a confidential welfare flag into a
   school-wide region. The surface, correctly, marks nothing there. **Do not add one.** The flag lives ONLY in
   the gated callout (+ gated lede clause + gated foot stat).
2. **The agenda welfare clauses stay OMITTED — for the gated viewer too.** "J. Manu stepped out visibly upset"
   is confidential welfare narrative, and the agenda is a school-wide region rendered once for everyone. Putting
   it back (even conditionally) is fragile and mixes confidential copy into a non-gated component. The welfare
   event belongs to the **gated callout**, not the agenda. Keep the agenda operational (§Ω.1).
3. **Gate the lede clause and foot stat on the SAME server decision as the callout**, and default them to the
   42a absence. Never render a "0 pastoral flags" / "no flags to show" affordance to anyone non-gated — that is
   itself an existence-of-system leak the owner ruled out ("nothing, not a redacted stub").

**Parent:** `parent_deny` (owner #4) blocks the whole VLC module — a parent never reaches the register. The
gate above is belt-and-suspenders on top of that.

**Audit-feed caveat (adjacent surface, NOT the register — flag #7).** If a raise/resolve emits an all-staff
`/settings/audit` entry, the INCR-30 model shows the row's **existence** with content **suppressed**
(`REDACTED_MARKER`) — weaker than the register's "nothing". 42b's `vlc_pastoral_` prefix branch (§6) guarantees
content suppression; whether to audit the flag at all (and thus whether existence shows in the feed) is a
choice. The register-surface "nothing" contract is separate and stronger. Note for the owner: hiding *existence*
in the audit feed too would be a broader INCR-30 change, out of 42b scope.

---

## Ω. Omit-not-fake (INCR-43) — the rich-narrative / case-file strand

Render **neutral / absent**; copy must never imply a working case-file or journal. No placeholder, no disabled
control, no "coming soon".

1. **`Open private case note` button** (§2.3) — the private case-note / case-file is INCR-43. **Omit the button.**
   (The `lib/boarding/pastoral-stub.ts` precedent — a stubbed pastoral surface must not imply a working system.)
2. **The `.fc-body` bereavement narrative** (§2.2) — "father died in February", "family struggling financially",
   the tearful walk-out account, the "queued … Phase 5 close" prose. A rich case note (INCR-43). **42b stores
   and renders only the ONE short context string**, not this paragraph.
3. **`Add to FM check-in queue` as a distinct entity** (§2.3) — no queue table in the locked shape; "queued for
   FM check-in" is the derived active status. Omit the button; render the derived status.
4. **Any journal / case-file / journal-history deep-link** off the flag — INCR-43. None in 42b.
5. **The agenda welfare clauses + the "& flags" meta** (§4) — stay omitted (they are school-wide-read regions;
   the welfare event surfaces only in the gated callout). The `& flags` word is low-value; leave the operational
   `monitors energy`.

**NOT omitted (guard against over-scrubbing):** the flag **metadata** (raised_at, severity, student,
surfaced_by, the ONE context string), the **FM + DEAN ONLY** badge, the **raise** + **resolve** actions, and the
gated **lede clause** + **foot stat** are all 42b — they ARE the increment.

---

## 5. Interaction-state inventory (42b)

| Region | State | Behaviour |
|---|---|---|
| Flag callout (gated) | **none / active / resolved / read-only** | **none:** a gated FM/Dean whose class has no flag → no callout (or a bare "Raise flag" affordance for the writer). **active** (`resolved_at NULL`): full callout + `Mark resolved`. **resolved:** muted / dropped from the "raised" count (optional history view). **read-only:** a gated viewer who cannot write this class's flag — n/a here (read gate == write gate), but a Dean viewing while the session is auto-locked still writes (flags are not clock-locked; see flag #8). |
| Flag callout (non-gated) | **absent** | never rendered, in any state (§4). |
| Raise form | idle / submitting / error | own-class FM / Dean only; server re-checks the gate; optimistic add + revert on refusal (the `markAttendance` idiom). |
| Resolve | idle / submitting | stamps `resolved_at`; server re-checks. |
| Lede clause / foot stat | present (gated, n≥1) / absent | gated on `canAccessPastoralFlag` AND a non-empty flag read; else absent (= 42a). |

---

## 6. Component / build mapping + the first `vlc_pastoral_` table

| Region | Reuse | New for 42b |
|---|---|---|
| Page gate | shipped `requireSchoolRole(VLC_CONFIG_READ_ROLES)` + BASIC redirect (page L28–29) — **unchanged** | after it, a server-side `canAccessPastoralFlag` decision; fetch flags only if it passes |
| Flag gate | `lib/vlc/authz.ts` (`canWriteSession` shape) | **`canAccessPastoralFlag`** (Dean role OR own-class FM identity) + `VLC_PASTORAL_READ_ROLES/_WRITE_ROLES = ["DEAN_OF_STUDENTS"]` |
| Flag read | `lib/vlc/session-data.ts` (`server-only`, `withSchool`, plain view types) | **`getPastoralFlags(schoolId, sessionId)`** — a SEPARATE server read, called only past the gate (never into non-gated props) |
| Callout UI | the shipped terra idiom in `session-register.tsx` (L25) | **`PastoralFlagCallout`** (server-rendered wrapper; raise/resolve are a small client form) + `raise/resolvePastoralFlag` server actions (new `lib/actions/vlc-pastoral.ts`, or extend `vlc-sessions.ts`) |
| Lede clause / foot stat | the shipped `<FootStat>` + lede in the page | conditional 4th `FootStat` + appended lede span, gated on the flag decision |
| Audit redaction | `lib/audit/redaction.ts` | **one line:** add `entityType.startsWith("vlc_pastoral_")` to `isRedactedAuditEntity` (the `sickbay_` fail-safe precedent) — re-classifies the whole future family. **Do NOT** add `vlc_pastoral_flag` to `SHOWN_AUDIT_ENTITIES` (the classify-guard invariant: the two sets are disjoint; the prefix branch makes it redacted → guard passes with no SHOWN entry). |

**`vlc_pastoral_flag` — the first `vlc_pastoral_` table (Wells/Kofi; owner c shape).** Mirror the shipped
`vlc_session*` conventions (composite `(school_id, …)` FKs, actor-stamp SET NULL to `users`):

| Column | Type / FK | Note |
|---|---|---|
| `id` | uuid pk | |
| `school_id` | uuid → `schools` cascade | |
| `session_id` | uuid, composite `(school_id, session_id)` → **`vlc_session.tenant_uk`** cascade | the target UNIQUE **already exists** (schema L416, authored ahead) |
| `student_id` | uuid, composite `(school_id, student_id)` → `students` cascade | **first-class column** — the INCR-45 forward-dep requires it (existence check, L3171) |
| `severity` | small CHECK enum, e.g. `('WATCH','CONCERN','CRISIS')` notNull | the F0 `slot`-CHECK precedent (flag #4) |
| `context` | text | the ONE short context string; short, not a narrative |
| `surfaced_by_peer_guide_id` | uuid nullable, composite `(school_id, …)` → `vlc_peer_guide` | the PG attribution (owner c) — data, not a writer |
| `raised_by_user_id` | uuid → `users` **SET NULL** (single col) | actor stamp (the FM/Dean who recorded) |
| `raised_at` | timestamptz notNull default now | the "3:08 PM" |
| `resolved_at` | timestamptz **nullable** | **NULL = active** (the `ended_at` open-row idiom); `active = resolved_at IS NULL` |
| `resolved_by_user_id` | uuid nullable → `users` SET NULL | |
| `created_at` / `updated_at` | timestamptz | |

- **LEAF in 42b → no `tenant_uk`** (nothing references it yet; the INCR-43 case-note that will reference it adds
  the composite-FK target then — YAGNI, the `vlc_session_attendance` leaf precedent). No `(session,student)`
  unique — two distinct concerns in one session are allowed.
- **RLS = the leak boundary.** `ENABLE + FORCE + tenant_isolation + parent_deny` (catalog loop) + a
  **leak-critical hand-run prod-paste** (next slot after `prod-paste-0069-vlc-session-register.sql`, i.e.
  ~`0070`; Wells assigns — flag #3). Verify via `verify-prod-rls.sql` (own rows only; wrong-school / parent =
  0). This table ships with NO RLS on prod until the paste is run → cross-school + non-gated leak, so it is the
  gating deploy step.
- **NOT `SHOWN_AUDIT_ENTITIES`** (§ above) — it is the first REDACTED `vlc_pastoral_` entity.

---

## 7. Cross-module hooks (design commitments — preserve)

- **Discipline / boarding stub → this flag (INCR-13/45).** `lib/boarding/pastoral-stub.ts::isPastorallyFlagged`
  hard-codes `ASK-24-0118` (Joseph Manu) — the same "J. Manu" the callout flags. 42b **does not retire the stub**
  (that is INCR-45), but it **must make the retire satisfiable**: `student_id` is a first-class column and
  `active = resolved_at IS NULL`, so INCR-45 can swap the stub for an **existence check** (`a flag exists for
  this student where resolved_at IS NULL`) with **no confidential-content read** — preserving the INCR-30
  non-disclosure. Do not build a schema that forces INCR-45 to read flag content to answer "is flagged?".
- **Flag ↔ INCR-41 Peer Guide roster.** `surfaced_by_peer_guide_id` references the class's active
  `vlc_peer_guide` (INCR-41) — the PG attribution reuses the shipped roster, not a new person model.
- **Flag ↔ the shipped 42a session.** `session_id` → `vlc_session.tenant_uk`; the flag hangs off the held
  session, and its `3:08 PM` sits inside the derived phase clock (Plenary window).
- **[INCR-43 chains to NOT build now]:** `Open private case note` → `vlc_case_file` / `vlc_pastoral_note`
  (append-only, journal); the bereavement narrative → the private case note; a Dean cross-class flag roll-up →
  the **INCR-44 school dashboard** (§ below). 42b must not preclude these but must not surface or deep-link them.

**Is there a Dean-facing flag LIST, or only the in-session callout?** The surface implies **only the in-session
callout** (the flag is drawn once, on the register). Owner decisions lock no roll-up. In 42b the Dean reaches
each class's flags by opening that class's register (Dean is school-wide in the gate). **A Dean-facing
cross-class active-flag roll-up is INCR-44 (the `vlc-school-dashboard` surface) — map/build it there, not here.**
Default for 42b: **in-session callout only.**

---

## Open questions / drift log
1. **`Raised by` vs `Surfaced by` (copy accuracy).** The surface says `Raised by Akua Gyamfi (PG)` but the PG did
   not write it (owner c: PG = `surfaced_by` data, not a writer). **Recommend `Surfaced by {PG}`** so the copy
   does not imply a PG write. Confirm the label.
2. **Where the body renders.** 42b renders the head + the ONE context string + the derived `Queued for FM
   check-in` status; the rich bereavement paragraph is INCR-43. Confirm no free-text narrative box in 42b.
3. **Migration + prod-paste slot.** Next migration after 42a's (0067) and next prod-paste after
   `prod-paste-0069` (~`0070`). Wells assigns; leak-critical hand-run on prod (verify RLS). Confirm.
4. **`severity` enum values.** Surface shows `CONCERN (intermediate level, not crisis)` → a 3-level scale,
   CONCERN middle. Recommend `('WATCH','CONCERN','CRISIS')` (Kofi's exact tokens). Confirm.
5. **`Add to FM check-in queue`.** Recommend **omit** (no queue entity; "queued" = derived active status). A real
   check-in queue is beyond owner (c)'s locked shape → separate call if wanted.
6. **`Escalate to Dean`.** The Dean already reads every flag → recommend folding escalation into the `severity`
   control (bump to CRISIS) and dropping the button; no notification pipeline in 42b. Confirm.
7. **Audit-feed existence visibility.** The `vlc_pastoral_` prefix branch suppresses *content* in
   `/settings/audit` (sickbay model), but the row's *existence* may show. The register-surface "nothing"
   contract is stronger and separate. Confirm the audit behaviour is acceptable (or whether the flag is audited
   at all).
8. **Flags vs the session auto-lock.** The register auto-locks attendance at Close (42a). A flag can be raised /
   resolved after the clock locks (a Dean follows up next day) — **flags are NOT clock-locked**; the write gate
   is `canAccessPastoralFlag`, independent of `isSessionWriteLocked`. Confirm.

---

*Map produced against: `Surfaces/schoolup-vlc-session-register.html` L513–531 (+ L255, L341, L495/507,
L547–551); the shipped INCR-42a build (`app/(app)/senior/vlc/sessions/[classId]/[date]/page.tsx`,
`components/vlc/session-register.tsx`, `lib/vlc/{session-data,authz}.ts`, `db/schema/vlc.ts` L354–491); the
security anchors `lib/audit/redaction.ts` + `lib/boarding/pastoral-stub.ts`; the INCR-42 decomposition in
`docs/senior-build-plan.md` L3165–3171 (owner calls 2026-07-27); and the token vocabulary shared with
`docs/senior/vlc-session-register-surface-map.md` §0. Companion to that 42a map (this un-defers its §2.8 + §Ω.1).*
