# INCR-45 · VLC Capstone — Boarding pastoral card + honesty-copy scrub — Surface Map

**Author:** Lucy (design cartographer) · **Status:** design spec, ready for the implementation engineer.
**Scope:** the boarding **pastoral protection cross-reference card** on Surface 07 (discipline &
deboardinization) — retire the INCR-13 "VLC 4.5 stub" framing, wire the real gated **"Open VLC case
file"** link, preserve the INCR-30 non-disclosure. Plus the two sibling honesty-copy sites (visiting
console, roster board) and the `routedTo` audit label. **This is a copy/behaviour map, not a redesign** —
the card's layout, tokens and existence-only signpost copy are already correct on the built page; the
increment swaps a dead pill for a gated link and deletes every "stub / not shipped yet" caveat.

## Owner decisions (locked — carried verbatim from the task)

- **OC1 — gated link + signpost.** The "Open VLC case file" LINK → `/senior/vlc/journal/[studentId]`
  renders ONLY for a viewer who passes the pastoral gate (Dean of Students OR the flagged student's
  own-class FM). Everyone else (housemaster / HM / Admin) sees the INCR-30 signpost — existence + Dean-route
  — with **NO link, NO severity, NO why, NO case number.**
- **OC2 — any active flag protects.** Existence-only signal; the card NEVER shows severity or reason.
- **OC3 — parent delivery is INCR-46** (out of scope here).

## Source of truth & canonical references

| Ref | What it anchors |
|---|---|
| `Surfaces/schoolup-boarding-discipline.html` L676–689 | The authored pastoral card: `§` icon, `A. Quartey · F3 GA A · Slessor House`, protection paragraph, and the affordance `↳ See VLC pastoral flag · case 2026-014` (case number = the thing INCR-30 already stripped from the built page). |
| `app/(app)/senior/boarding/discipline/page.tsx` L181–201 | The built card. The pill L195–197 is the inert stub to replace. |
| `lib/vlc/authz.ts` `canAccessPastoralFlag` | The gate helper (Dean-of-Students role arm **OR** own-class-FM identity arm). Reuse verbatim — do not re-derive. |
| `components/vlc/pastoral-flag.tsx` L107–112 | The 42b/43a gated-link idiom: server decides `canAccessPastoralFlag` → mounts the callout → `<Link href={`/senior/vlc/journal/${f.studentId}`}>`. Mirror this render-only-when-gated pattern. |
| `lib/boarding/discipline-core.ts` L83, L88 | The pastoral-bypass audit `routedTo` (stub label) + neutralized `reason` (INCR-30). |
| `lib/audit/redaction.test.ts` L96–102 | **Hard-asserts** both strings. Any change to `routedTo` must update L101; `reason` must NOT change (L97). |

---

## 1. The pastoral card — two render states (1:1)

The card is unchanged in structure. Section wrapper stays:
`<Section title="Pastoral" em="protection · cross-reference" meta="FROM VLC · 1 STUDENT FLAGGED">`.
Container / icon / heading / paragraph are **identical in both states**; only the final affordance differs.

**Shared shell (both states) — tokens verbatim from L184–194:**

| Element | Classes (solid tokens — no slash-opacity) | Copy |
|---|---|---|
| Container | `flex items-start gap-4 rounded-xl border border-green bg-green-bg p-5` | — |
| Icon | `flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green font-display italic text-bg` | `§` |
| Heading (`h4`) | `font-display text-base font-semibold text-green` | `{studentName} · {studentSub} · {house} House` |
| Paragraph (`p`) | `mt-1 text-[13px] leading-relaxed text-navy-2`, inner emphasis `<b className="text-navy">` | `Active pastoral case with the Dean. **Any disciplinary action is routed to the Dean before it reaches the ledger.** This student does not accumulate boarding-discipline points the way a peer would — the ladder pauses where pastoral cases run.` (INCR-30 signpost — unchanged, keep) |

The heading names the student and House. This is **kept in both states**: it is the operational point of the
card (it tells the housemaster *which boarder not to ladder*), it is the same disclosure as the boarding
roster this same viewer already sees, and student identity is NOT on the non-disclosure list (§4). Only
severity / reason / why / body / case number are withheld.

### (a) Gated viewer — Dean of Students OR the flagged student's own-class FM (`canViewCase === true`)

Replace the inert `<span>` pill with a real Next `<Link>` to the confidential journal, reusing the pill's
visual so the card reads identically apart from being live:

```
<Link
  href={`/senior/vlc/journal/${board.pastoral.studentId}`}
  className="mt-2 inline-block rounded-pill border border-green bg-surface px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-green hover:brightness-95"
>
  ↳ Open VLC case file
</Link>
```

- **Honest link copy: `↳ Open VLC case file`** — the surface's `See VLC pastoral flag` reworded to the
  increment's own verb; **no "stub", no case number, no severity.** (`↳` affordance glyph kept from the
  surface/built pill; `hover:brightness-95` = the roster-board hover precedent, keeps tokens solid.)
- Destination self-gates server-side (`VLC_PASTORAL_READ_ROLES` + `canAccessPastoralFlag`); a
  mis-rendered link still `notFound()`s. Same defense-in-depth as the 43a/44 R349 nav links.

### (b) Non-gated boarding viewer — housemaster / HM / Admin / Dean of Boarding (`canViewCase === false`)

The affordance is a **plain, non-interactive `<span>`** — existence + Dean-route only, no link:

```
<span className="mt-2 inline-block rounded-pill border border-green bg-surface px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-green">
  ↳ Dean-routed · action is routed to the Dean before the ledger
</span>
```

- **NO link, NO severity, NO reason, NO case number.** Reveals only THAT a case exists and that it is
  Dean-routed — nothing about its content.

**Which arm renders is decided purely by `canViewCase` (server-computed), never by the client.** On *this*
page the gated arm is naturally rare: the discipline page is gated to `BOARDING_ROLES`, and a plain Admin /
HM / Dean of Boarding / Housemaster fails `canAccessPastoralFlag`. The gated arm lights up only for a viewer
who *also* holds `DEAN_OF_STUDENTS` or *is* the flagged student's own-class Form Master by identity — which
is exactly why we defer to the shared helper rather than a local role check. (Do **not** widen
`BOARDING_ROLES` to admit Dean of Students — that is an access decision, not this map's lane, and not
requested. The link simply renders for whoever legitimately reaches the page and passes the gate.)

### Data contract this requires (for the implementer / Kofi)

`PastoralCard` (currently `{ studentName, studentSub, house }`, `discipline-data.ts` L102–106) needs two
additive fields, both computed server-side in `getDisciplineBoard` (which already receives `roles` + `userId`):

- **`studentId: string`** — the flagged student's id, for the `href`.
- **`canViewCase: boolean`** = `canAccessPastoralFlag({ roles, userId, classTeacherUserId })`, where
  `classTeacherUserId` is the **flagged student's class's** `class_teacher_user_id`, loaded server-side
  (un-spoofable). The build block L400–413 already loads the flagged row; add a join to that class's
  `class_teacher_user_id` and one call to the helper. Server decides, client renders conditionally — the
  42b/43a idiom exactly.

*Upstream dependency (not this map's copy, but the card's trigger):* the card renders when the **real**
`vlc_pastoral_flag` read (replacing `lib/boarding/pastoral-stub.ts` `isPastorallyFlagged`) returns an active
flag for a scoped boarder. Same shape as today; the card's UI does not change with the swap.

---

## 2. Copy scrub — exact replacement strings (all three sites)

Drop every "VLC 4.5 stub / no working pastoral system / no journal write / arrives with the pastoral module"
caveat. The pastoral system now EXISTS; the caveats are lies.

| # | File · line | BEFORE (delete) | AFTER (exact) |
|---|---|---|---|
| 1a | `app/(app)/senior/boarding/discipline/page.tsx` L196 — **gated** | `↳ Dean-routed (VLC 4.5 stub — no working pastoral system behind this yet)` | `↳ Open VLC case file` (as a `<Link>` — see §1a) |
| 1b | same, L196 — **non-gated** | *(same)* | `↳ Dean-routed · action is routed to the Dean before the ledger` (plain `<span>` — see §1b) |
| 2 | `components/boarding/visiting-console.tsx` L509 | `Pastoral-sensitive · needs Dean of Boarding to approve (VLC 4.5 stub — no journal write)` | `Pastoral-sensitive · needs Dean of Boarding to approve` |
| 3 | `components/boarding/roster-board.tsx` L381–382 | `A pastoral flag is set on this boarder. The full case file arrives with the pastoral (VLC) module — it is not part of this release.` | `A pastoral flag is set on this boarder. Any boarding discipline is routed to the Dean before the ledger — details stay with the Dean.` |

Notes:
- **Site 2 keeps "Dean of Boarding" — that is correct.** The visiting-console "pastoral-sensitive visitor"
  gate is a *boarding-operations* approval (`canManagePastoral` → `DEAN_OF_BOARDING`, see L456 + the action
  `boarding-visiting.ts` L191), **not** the VLC pastoral-flag system. Only the `(VLC 4.5 stub — no journal
  write)` parenthetical is a lie (the box still doesn't write a VLC journal, and shouldn't — out of scope);
  delete the parenthetical, leave the operational copy. Do **not** turn this into a VLC link.
- **Site 3 stays existence-only.** The roster occupant detail is viewed by housemasters (non-gated by
  default); the honest replacement is the same INCR-30 signpost — existence + Dean-route, no severity, no
  "case file" promise, no link. (The gated "Open VLC case file" link is the discipline card's job, §1a;
  adding one here would be an out-of-scope parity extra — leave it.)

---

## 3. The `routedTo` audit label + the neutralized `reason`

`lib/boarding/discipline-core.ts` L83 (the pastoral-bypass audit `after`):

- **`routedTo`** — propose the honest replacement:
  `routedTo: "Dean of Students · VLC pastoral"` (was `"Dean of Boarding (VLC 4.5 stub)"`).
  Rationale: the bypass routes to the VLC pastoral owner (Dean of Students, INCR-40), not the Dean of
  Boarding, and the "(VLC 4.5 stub)" tag is now false.
  **⚠ COUPLING:** `lib/audit/redaction.test.ts` **L101** asserts the literal old string
  (`routedTo: "Dean of Boarding (VLC 4.5 stub)"`). This assertion MUST be updated to the new string in the
  same commit or the build fails. (The `after: { severity, sourceKind, routedTo` shape check at L102 is
  unaffected.)
- **`reason` (L88) stays exactly `"Discipline routing — details restricted"`** — this is the INCR-30 R240
  write-site redaction, asserted at `redaction.test.ts` L97. **Do NOT change it.** The safeguarding fact
  survives only in `after.{severity, routedTo}` for a narrower-gated reader; the human-readable reason must
  stay neutral in both audit feeds.

---

## 4. Non-disclosure checklist — what the boarding CARD must NEVER show (any viewer)

The gate opens the **journal** (its own terra confidential treatment, `pastoral-flag.tsx` / 43a); the **card**
stays existence-only for everyone, gated or not.

**NEVER on the card, for ANY boarding viewer (gated included):**
- ✗ **Severity** (CONCERN / etc.) — OC2.
- ✗ **Reason / context / "why"** — the free-text locator or any narrative.
- ✗ **Note / case body / summary / observation text** — journal content.
- ✗ **`surfaced_by` / the Peer Guide** who raised it.
- ✗ **Case number** (the surface's `case 2026-014` — INCR-30 already stripped it; keep it stripped).
- ✗ **A link, for a non-gated viewer** (OC1).

**Allowed on the card (both states — existence signal, operationally required):**
- ✓ Student name · class · House (identity — same disclosure as the roster; tells the housemaster whom not
  to ladder).
- ✓ THAT an active pastoral case exists with the Dean, and that discipline is Dean-routed before the ledger.
- ✓ (gated only) the `↳ Open VLC case file` link — the *entry point*, not the content.

---

## 5. Repo-convention flags (for the implementer)

- **Reuse the existing card + Section** — no new component. The only structural change is `<span>` → `<Link>`
  under the `canViewCase` branch.
- **Gate = `canAccessPastoralFlag` verbatim** (`lib/vlc/authz.ts`), decided server-side in
  `discipline-data.ts`; the client renders on the boolean only. Mirrors the 42b/43a/44 `canAccess`-conditional
  render (`pastoral-flag.tsx` L3–7, R349). Never a bare `roles.includes("FORM_MASTER")` — the FM arm is an
  own-class identity match.
- **Destination self-gates** — `/senior/vlc/journal/[studentId]` re-enforces its gate server-side; a
  mis-rendered link `notFound()`s. Defense-in-depth, not the only guard.
- **No-alpha tokens** — every token in the card is already solid (`bg-green`, `border-green`, `bg-green-bg`,
  `text-green`, `bg-surface`, `text-navy`/`text-navy-2`, `text-bg`). Keep it that way; the link's hover is
  `hover:brightness-95`, never a slash-opacity. (memory `no-alpha-token-opacity`.)
- **Test coupling** — updating `discipline-core.ts` `routedTo` REQUIRES the paired edit at
  `redaction.test.ts` L101 (§3).

## Open questions / drift log

1. **`meta="FROM VLC · 1 STUDENT FLAGGED"` + single-card shape.** The data layer picks the *first* flagged
   boarder (`scopedBoarders.find(...)`, `discipline-data.ts` L406) and renders one card. With the real
   `vlc_pastoral_flag` read, >1 boarder in scope could be flagged; the "1 STUDENT FLAGGED" meta and the
   single card would then under-report. Preserving the existing single-card behaviour is in-scope for a
   stub-swap; a multi-flag list is a separate ask. **Flag to Kofi** — default: keep single-card, derive the
   meta count from the real result rather than hardcoding "1".
2. **`routedTo` wording.** "Dean of Students · VLC pastoral" is a proposal; owner may prefer "Dean of
   Students" alone. Either way L101 of the test moves in lockstep (§3).
