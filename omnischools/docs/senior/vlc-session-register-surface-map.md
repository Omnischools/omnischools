# VLC Session Register — Surface Map (INCR-42a · Module 4.5 / surface 03 · OPERATIONAL session register ONLY)

**Author:** Lucy (design cartographer) · **Status:** design spec, ready for the implementation engineer.
**Scope of this map:** VLC surface **03 — the LIVE SESSION register, OPERATIONAL slice only (INCR-42a).** The
session lifecycle (5-phase clock), the facilitator strip, the value focus-banner, the two PG-led small groups,
the class **P / L / A** attendance grid, and the phase-by-phase agenda. Written to the shipped INCR-40/41 VLC
conventions: this becomes the **3rd tab** under the existing `Setup · Peer Guides` sub-nav
(`components/vlc/vlc-tabs.tsx` + the nested `app/(app)/senior/vlc/layout.tsx`), reusing `components/vlc/
chrome.tsx` and the `VLC_CONFIG_*` gate shape.

**HARD SCOPE FENCE — what this map deliberately OMITS (mapped in §Ω only so the implementer *neutralises*, never
fakes, each one):**
- **[INCR-42b · the pastoral flag] the entire `.flag-callout` block** and every string that surfaces a
  student's welfare concern, a "flag raised" affordance, a severity, an "FM + Dean only" boundary, or a private
  case link. `vlc_pastoral_flag` is the FIRST `vlc_pastoral_` (REDACTED) table and is **built in 42b, not here.**
  In 42a this region **renders nothing** — the copy must not imply a working pastoral system exists.
- **[INCR-43 · journal / character paragraph]** the reflection *journal* content, the "Reflection submission ·
  96%" meter, any "pastoral note" / "case note" affordance, any PG facilitation/pastoral-judgement scoring, any
  "read-only anonymised reflections" deep-link, and any cross-session pastoral trend → **stub/omit.** (The
  Reflection *phase* itself stays — it is one of the five frozen phases — but its copy is reworded so it does
  not promise a journal-capture system that ships at 43.)

Rule where surface and spec disagree: **spec wins on logic, surface wins on visual presentation.** Every drift
is called out inline and collected in the **Open questions / drift log** at the end.

## Source

| File | Role |
|---|---|
| `Surfaces/schoolup-vlc-session-register.html` | **PRIMARY.** Section 01 (the `.desktop` app mock) is the INCR-42a build target *minus* the `.flag-callout`. Section 02 ("Why this rhythm") is an editorial explainer, **not a build target** (§6). |

**Sibling surfaces (context):** `schoolup-vlc-programme-setup.html` (surface 01 — **SHIPPED** INCR-40,
`/senior/vlc/setup`); `schoolup-vlc-peer-guides.html` (surface 02 — **SHIPPED** INCR-41, `/senior/vlc/peer-
guides`); `schoolup-vlc-student-journal.html`, `schoolup-vlc-school-dashboard.html` (INCR-43/44 — do not build
here). This is the third of five.

**Build-plan anchors:** `docs/senior-build-plan.md` L3148–3154 (INCR-42 decomposition, SPLIT 42a/42b, owner
calls resolved 2026-07-27). Verbatim 42a scope (L3151): *"`vlc_session` (one row per class×date, refs
programme/value/session_template; phase timings DERIVED from F0 durations, no new schema) + attendance P/L/A
(PG-first capture) + small groups. `VLC_CONFIG_*` gates. Lucy omit-not-fakes the flag-callout. Land the
INCR-41-deferred DRY here."*

## Canonical inputs (mirror INCR-40/41 exactly — the idiom is already in the tree)

- **Shipped page idiom:** `app/(app)/senior/vlc/peer-guides/page.tsx` — server component, `export const dynamic
  = "force-dynamic"`, `requireSchoolRole(VLC_CONFIG_READ_ROLES)` → `if (school.schoolType === "BASIC")
  redirect("/dashboard")` → `canEdit = hasAnyRole(roles, VLC_CONFIG_WRITE_ROLES)`. **Reuse this guard chain**;
  the ONE divergence is the writer (this surface's writer is the **FM of the class**, not just Dean/Admin — §1.3).
- **Nested layout + sub-nav already exist:** `app/(app)/senior/vlc/layout.tsx` renders `<VlcTabs/>` above every
  VLC page; `components/vlc/vlc-tabs.tsx` holds the `TABS` array. **Adding this surface = one new entry in that
  array** (§1.2) + a new page under `app/(app)/senior/vlc/`. No sidebar change (single flat `Student support`).
- **Shared chrome:** `components/vlc/chrome.tsx` exports `SectionHead` (eyebrow + display `<h3>` + right meta) and
  `SumCard` (default / `featured` / `warn`). `SectionHead` fits every `.block-head` on this surface 1:1
  (§2.6/2.7/2.8). `SumCard` does **not** fit the navy foot-bar stats (different layout) — see §4/flag #7.
- **F0 frozen contract is the SOURCE for everything editorial:** `lib/vlc/defaults.ts` —
  - `VLC_PHASES` (the five phase names/who/description, order LOCKED; `defaultMin` 5·25·15·10·5 = 60) drives the
    lifecycle bar **and** the agenda rows. **No new schema for phase names/order.**
  - `coalesceVlcProgramme(row)` + `addMinutes` / `formatVlcTime` / `formatVlcWindow` turn the school's
    `vlc_programme` durations (or the frozen defaults) + the session's actual start into every clock window
    ("2:33 — 2:38", …). **No stored per-phase clock.**
  - the value name + Twi + descriptor come off the `vlc_value` row (ordinal 7 = "Patriotism" / "Ɔman dɔ"); the
    session title + prompt come off the `vlc_session_template` row (value 7, slot **B** = "Service project
    planning" / "today · what we will do"). **No re-stored value/session copy** — the `vlc_session` row carries
    only a composite FK to the template.
- **Data-layer idiom:** `lib/vlc/peer-guides-data.ts` — `"server-only"`, one `withSchool(schoolId, …)` read,
  **counts/status DERIVED not stored**, coalesce for an unseeded/empty state, returns plain serializable view
  types; the page passes primitives to the client editors (never the DB driver). Build `lib/vlc/session-data.ts`
  to the same shape.
- **Form resolver:** `lib/vlc/eligibility.ts::classFormNumber` (the `(?:Form|F)\s*([123])` regex over
  `level`/`name`) — 42a is roadmap-directed to **extract the now-4th copy** into a shared senior resolver
  (build-plan L3151). This surface reads the class form only for display ("Form 2 GA A"); it does not gate on it.

---

## 0. Token & type reference (delta from the shipped Tailwind vocabulary)

Same `:root` block as every Senior surface (byte-identical to `ledger-surface-map.md` §0, the F0 map, and the
Peer Guides map §0). Tokens **this** surface actually uses:

| Surface `var(--x)` | Hex | Tailwind class | Used for on THIS surface |
|---|---|---|---|
| `--navy` | `#1A2B47` | `text/bg/border-navy` | body text; **focus-banner** & **foot-bar** grounds; boy PG chip/lead-chip; browser bar |
| `--navy-2` | `#2D3F5C` | `text-navy-2` | secondary copy, agenda `what` bold, project-line body |
| `--navy-3` | `#5C6675` | `text-navy-3` | ledes, metas, role labels, att-cell text, "Whole class attends" |
| `--gold` | `#C8975B` | `text/bg/border-gold` | all italic accents; value-number tile; **PG att-cells + PG summary pill**; active-phase left border; FM facilitator chip; gold "Close session" button |
| `--gold-soft` | `#E8D4B8` | `text/border-gold-soft` | focus-banner frame/meta labels, foot-stat labels/subs (**rgba trap — §0 note**) |
| `--gold-bg` | `#F5EBDC` | `bg-gold-bg` | FM chip ground, `.active` agenda-row ground, PG att-cell ground, value-number context |
| `--bg` | `#FAF7F2` | `bg-bg` | page ground; att-cell default ground; facilitator-strip ground; lead-chip ground |
| `--surface` | `#FFFFFF` | `bg-surface` | cards (group / att / agenda), facilitator chips |
| `--green` | `#2F6B47` | `text/bg-green` | present dot; `.done` agenda status; present summary pill text |
| `--green-bg` | `#E5EFE8` | `bg-green-bg` | `.done` status-pill ground, present summary-pill ground |
| `--terra` | `#B84A39` | `text/border-terra` | **absent** att-cell + roster mem + dot; live-dot pulse; **[the whole `.flag-callout` uses terra — OMITTED §Ω]** |
| `--terra-bg` | `#F5E1DC` | `bg-terra-bg` | absent att-cell/roster ground; **[flag-callout ground — OMITTED]** |
| `--warn` / `--warn-bg` | `#C58A2E` / `#F5E9D0` | `text-warn` / `bg-warn-bg` | **late** att-cell + roster mem + dot; late summary pill |
| `--border` / `--border-2` | `#E5DFD3` / `#D4CCBA` | `border-border` / `border-border-2` | card borders, dashed dividers, button borders |

**Type families:** `font-display` = Fraunces (all headings, the value-number `07`, phase names, group `<h4>`,
avatar initials `.av`, italic gold `<em>`, foot-stat values); `font-body`/default = Manrope (body, labels, PG
names, att-cell names); `font-mono` = JetBrains Mono (the lifecycle `stage-time`, agenda `time` windows,
live-dot "41 min in", focus-banner elapsed value).

**No-alpha token trap (memory `no-alpha-token-opacity`) — the TWO navy regions on this surface.** Same
translation discipline as the F0 / Peer Guides maps. Offenders here:
- **`.focus-banner`** (`bg-navy`): `.info .frame` = `rgba(232,212,184,0.8)`, `.meta .lab` =
  `rgba(232,212,184,0.6)` → use **solid `text-gold-soft`**, NEVER `text-gold-soft/80`. `.frame b` /
  `.meta .val` are solid gold — fine.
- **`.foot-bar`** (`bg-navy`): `.foot-stat .lab` and `.sub` = `rgba(232,212,184,0.6)` → **solid
  `text-gold-soft`**, not slash-opacity on the raw hex.
- **Any navy side-card** (if a live side-panel is built, §2.9): `.side-card.navy p` = `rgba(232,212,184,0.8)` →
  solid `text-gold-soft`.
- **Browser-bar** rgba is on `white` (`rgba(255,255,255,0.18)` / `0.08`) — white slash-opacity is safe
  (`bg-white/18`); but the browser bar is design-doc chrome, not built.
- **Attendance / agenda tints are already correct:** the P/L/A cells use the dedicated `-bg` tint tokens
  (`green-bg` / `warn-bg` / `terra-bg` / `gold-bg`) — **keep those solid tint tokens, do NOT reach for
  `bg-green/10` etc.** on the raw-hex greens.
Verify every tint in the **live preview**, not the build (a broken slash-opacity compiles clean).

---

## 1. Route, nav, and RBAC

### 1.1 Route
- **Recommended route:** **`/senior/vlc/sessions`** (server component, `dynamic = "force-dynamic"`, same guard
  chain as the peer-guides page). The surface's own URL bar reads `app.omnischools.gh / pastoral / vlc / session
  / form-2-ga-a / 2026-05-14` — editorial; the app convention is `/senior/<module>/…` and drops "pastoral".
  - The surface is a **single class's single-date live session**, i.e. a deep route. Recommended shape:
    `/senior/vlc/sessions` = the landing (today's / this-Wednesday's session(s) — for an FM, their own class;
    for Dean/HM, the roster of classes) → the live session at **`/senior/vlc/sessions/[classId]/[date]`**
    (mirrors the surface URL `.../session/form-2-ga-a/2026-05-14`). **How deep 42a goes is a scope lever —
    flag #1** (a lazy 42a could ship just the landing + one session view).
- **School-type guard:** identical — `if (school.schoolType === "BASIC") redirect("/dashboard")`. VLC is
  Senior-only; the nested `layout.tsx` already enforces this as defence-in-depth, but the page keeps its own.

### 1.2 Nav — the 3rd VLC tab (NO new sidebar item)
- The sidebar stays a **single flat `Student support` item** (well under twelve items → no sectioned nav; the
  README convention). VLC's three surfaces live under the **in-page sub-nav** already shipped in
  `components/vlc/vlc-tabs.tsx`.
- **Change = one array entry.** Append to `TABS`:
  ```ts
  { href: "/senior/vlc/sessions", label: "Sessions" },
  ```
  giving `Setup · Peer Guides · Sessions`. The existing active-state logic (`pathname === href ||
  pathname.startsWith(`${href}/`)`) already lights the tab for the deep `[classId]/[date]` child routes — no
  change needed.
- **Tab label — recommend `Sessions`** (short, matches the 1–2-word existing tabs). Alternative `Session
  register` is faithful to the batch title but longer; **confirm the label — drift #2.** Whichever is chosen,
  the sidebar label stays `Student support`; "Pastoral & values" is the in-page crumb only.

### 1.3 RBAC — reuse the F0 READ gate; the WRITE scope is the ONE new thing
- **READ = `VLC_CONFIG_READ_ROLES`** = `DEAN_OF_STUDENTS, ADMIN, HEADMASTER, FORM_MASTER` — unchanged; the whole
  operational register is SHOWN, no confidential PII, so a school-wide read is fine.
- **WRITE — diverges from the roster.** On the Peer Guides roster, WRITE = `VLC_CONFIG_WRITE_ROLES`
  = `[DEAN_OF_STUDENTS, ADMIN]` (the FM does not write the roster). **On THIS surface the FM IS the writer:**
  owner decision (d), build-plan L3149 — *"PG-first attendance = FM-only DB write (PG-first = UI capture-order)."*
  So the session-register mutations (create/advance/close the session, mark P/L/A, set the small-group split)
  are written by the **Form Master of the session's class** (own-class), plus Dean/Admin as fallback. This is a
  **new, session-scoped write authority** that `VLC_CONFIG_WRITE_ROLES` does not express.
  - Roadmap-directed home for it: **`lib/vlc/authz.ts`** — the INCR-41-deferred DRY the build plan says to land
    in 42a (L3151/L3158). It should expose an `canWriteSession({ roles, classId, fmClassIds })`-style check:
    `FM(own class) || Dean || Admin`. **Own-class scoping must be enforced server-side in every action**, not
    just in the UI. **Flag #3** — confirm the own-class FM write (vs any-FM write); an FM writing another class's
    session is the operational analogue of 42b's own-class-flag-read risk.
- **`canEdit` in the UI** = the same `canWriteSession` result; `!canEdit` renders the register read-only (no
  P/L/A controls, no Pause/Close, no group edits) and appends the italic *"You have read-only access to this
  surface."* line the shipped VLC pages use.
- **Per-role read (map 1:1):** **Form Master** — full write on their own class's session (mark attendance, run
  the phase clock, split groups, close). **Dean of Students / Admin** — write fallback + read across classes.
  **Headmaster** — read-only across classes. **Students / Peer Guides** — never see this surface (not in the
  read gate; parent_deny module-wide). NB the surface's `.facilitator-strip` naming a PG does **not** grant the
  PG surface access — "PG-first" is a capture-*order* convention the FM performs, not a PG login (§2.7).

---

## 2. Surface structure — Section 01 (the INCR-42a build target), top to bottom

The outer `.page-header` (§5) and the Section-01 `.section-head` ("01 · Session live · attendance, groups,
**flags**, time remaining", meta "Pastoral & values → VLC → This Wednesday → Form 2 GA A") are **design-doc
chrome.** Note the section title's word **"flags"** is the 42b element — the built surface title drops it. The
build target is the `.desktop` browser mock. Regions in order:

### 2.1 `.head-row` (in-app header — build this)
- **Crumb** (`text-navy-3 text-[11px] uppercase tracking-[0.08em] font-semibold`):
  `VLC · Week 26 · Value 7 Patriotism · Session B`.
  - Every clause DERIVES: `Week 26` from the academic calendar vs the session date; `Value 7 Patriotism` from
    the referenced `vlc_value` (ordinal + `name_en`); `Session B` from the referenced `vlc_session_template.slot`.
- **`<h2 class="display">`** (28px, 500): `Form 2 GA A ` + `<em class="text-gold italic">· 14 May 2026</em>` —
  class name + session date.
- **Lede** (`text-navy-3 text-[13px] max-w-[660px]`), verbatim on the surface:
  `Started 2:33 PM (3 min late · sports prefect briefing ran long) · 36 of 40 present · `**`1 pastoral flag
  raised at 3:08 PM`**` · 18 minutes remaining`.
  - **[42b — OMIT the flagged clause]:** drop `· 1 pastoral flag raised at 3:08 PM`. The 42a lede reads
    `Started {start} ({lateness}) · {present} of {total} present · {minsRemaining} minutes remaining`. The "3
    min late · sports prefect briefing ran long" is an optional operational start-note (§4); the minimal build
    needs only `started_at`, present-count, and remaining = derived from the phase clock.
- **Actions (right):**
  - `Open curriculum` — `.btn.ghost`. Cross-links to the F0 curriculum library (the setup surface's Value-7
    Session-B toolkit). Read-only cross-tab link; safe for read-only viewers.
  - `Pause session` — `.btn`. Stops the phase clock (see the lifecycle/agenda "Auto-advances · FM can pause").
    Implies a session run-state (running/paused). **Write-gated** (FM own-class). Keep this operational; do
    **not** wire the "pause when a flag arises" behaviour Section 02 describes — the flag trigger is 42b.

### 2.2 `.facilitator-strip` (who is running today — build this)
- `.lab`: `FACILITATING TODAY`.
- Three chips (verbatim), each `.av` initials + `.nm` name + `.role`:
  - **FM chip** (`.fm`, gold ground): `AM` · **Mr A. Mensah** · `Form Master · GA A`.
  - **PG boy chip** (`.pg-b`, navy border): `PO` · **Prince Otoo** · `Peer Guide · boys' rep`.
  - **PG girl chip** (`.pg-g`, terra border): `AG` · **Akua Gyamfi** · `Peer Guide · girls' rep`.
- Right label: `Whole class attends`.
- **Data (Kofi — all DERIVED, no new fields):** the FM = the class's `class_teacher_user_id` → user; the two PGs
  = the **active `vlc_peer_guide` rows for this class × current period** (INCR-41 data), name + `initials` +
  `rep` (boy/girl from `students.sex`) already produced by `peer-guides-data.ts`. "Whole class attends" is a
  static string (VLC sessions are whole-class, unlike the small-group PG conversations of Phase 2).

### 2.3 `.lifecycle` bar (the 5-phase clock — RENDERS FROM F0, build this)
- `.lc-head`: `SESSION LIFECYCLE · 5 PHASES · 60 MIN`.
- Five `.lc-stage`s, each `stage-num` (Fraunces italic) + `stage-name` + `stage-time` (mono window), with a
  state class `done | active | pending`:

  | # | stage-name (verbatim) | stage-time | state | F0 source |
  |---|---|---|---|---|
  | 01 | `Opener` | `2:33 — 2:38` | done | `VLC_PHASES[0]` (openerMin 5) |
  | 02 | `Small groups` | `2:38 — 3:03` | done | `VLC_PHASES[1]` (smallGroupMin 25) |
  | 03 | `Plenary · LIVE` | `3:03 — 3:18` | **active** | `VLC_PHASES[2]` (plenaryMin 15) |
  | 04 | `Reflection` | `3:18 — 3:28` | pending | `VLC_PHASES[3]` (reflectionMin 10) |
  | 05 | `Close` | `3:28 — 3:33` | pending | `VLC_PHASES[4]` (closeMin 5) |

- **RENDER-FROM-F0 (no new schema for the phases):** the five phase names + order come from `VLC_PHASES`
  (LOCKED); the per-phase minutes come from `coalesceVlcProgramme(programmeRow).phases[i].min` (the school's
  editable `vlc_programme` durations, coalesced to 5·25·15·10·5). Each `stage-time` window = the session's
  **actual start** (2:33 — i.e. `vlc_session.started_at`, which is 3 min after the F0 cadence 2:30) fed through
  `addMinutes` / `formatVlcTime`, accumulating the phase minutes. The `done/active/pending` state DERIVES from
  now() vs those windows (plus any pause offset). `vlc_session` stores at most `started_at` (+ optional
  paused state) — **not** a per-phase clock, not the phase names. `· LIVE` on the active phase is presentation.

### 2.4 `.focus-banner` (the week's value + question — RENDERS FROM F0, build this)
- `.v-num` tile (navy→gold): `07` / `VALUE`.
- `.eb`: `Today's value · Session B · applied`.
- `<h3 class="display">`: `Patriotism ` + `<em>· Ɔman dɔ</em>` + ` · Service project planning`.
- `.frame`: `Today's question:` `<em>"What is one thing we, as a class, can do for our community in the next
  two weeks?"</em>` ` · Today's outcome: a project brief, two volunteer leads, a date · paired with Value 9
  Service session B in two weeks.`
- `.meta`: `Time elapsed` / `41 min · 18 to go`.
- **RENDER-FROM-F0:** `07` = `vlc_value.ordinal`; `Patriotism` = `name_en`; `Ɔman dɔ` = `name_twi` (locked Twi
  diacritic — do not simplify); `Session B · applied` = the template's `slot` (B = application, per F0's slot
  semantics); `Service project planning` = `vlc_session_template.title` (value 7, slot B). The `vlc_session` row
  carries only the composite FK to that template — everything else is a join, **no re-stored value/session copy.**
  - **`paired with Value 9 Service session B`** = the **F0 intra-curriculum pairing** (value 9 slot B's frozen
    prompt is literally "paired with Value 7B"). **Cross-module hook — preserve verbatim** (§7).
  - **The "Today's question"** (the long italic string) is richer than the F0 template `prompt` ("today · what
    we will do"). Two options: render the template `prompt` as-is, or treat the focus question as an FM-set /
    per-session field. **Drift #4** — recommend rendering the template prompt (minimal) and, if the richer
    per-session question is wanted, widen the template or add an optional `focus_question` note; do not
    hard-code the surface string.
  - `Time elapsed 41 min · 18 to go` DERIVES from the phase clock (now − `started_at`; remaining = window end −
    now). No stored elapsed/remaining.

### 2.5 Body block A — `.block` "Small groups" (build this)
- `.block-head`: eyebrow `Phase 2 just closed · what the groups discussed`; `<h3 class="display">Small groups
  <em>· two PG-led conversations</em></h3>`; meta `FM walks between · monitors energy · doesn't intervene unless
  asked`.
  - **[42b micro-edit]:** the surface meta reads `monitors energy & flags` — drop `& flags` (the flag is 42b);
    render `monitors energy`.
- **`.groups-grid`** = `grid-cols-2`, two `.group-card`s:

  **Group A** (`.lead-chip.boy` navy):
  - `<h4>Group A <em>· led by Prince</em></h4>`; sub `10 students · 18 of 25 min talking time used`;
    lead-chip `PO` · `Prince Otoo`.
  - `.project-line`: `Idea brought back:` `<em>"Clean-up of the road from school gate to the JHS"</em>` ` · 250m
    stretch · two Saturday mornings, May 24 & 31 · partnership with the local JHS PTA`.
  - `.roster` (10 `.mem`, 2 cols): `B. Adusei`, `C. Mensah`, `D. Aryeetey`, `E. Annan` **(absent)**,
    `F. Boateng`, `G. Owusu`, `H. Tetteh`, `I. Bediako`, `J. Asante`, `K. Larbi` **(late)**.

  **Group B** (`.lead-chip.girl` terra):
  - `<h4>Group B <em>· led by Akua</em></h4>`; sub `10 students · 21 of 25 min talking time used`;
    lead-chip `AG` · `Akua Gyamfi`.
  - `.project-line`: `Idea brought back:` `<em>"Saturday morning maths tutoring at the local JHS"</em>` ` · 8
    Form 2 GA volunteers · 4 Saturdays in June · materials supplied by the school`.
  - `.roster` (10): `L. Kpodo`, `M. Yiadom`, `N. Quartey`, `O. Sarpong`, `P. Adjei`, `Q. Mensah` **(absent)**,
    `R. Owusu`, `S. Tetteh` **(late)**, `T. Bonsu`, `U. Akoto`.
- **What the card shows / what to project:** per group — the **lead PG** (name + initials + boy/girl styling,
  from the active roster), the **member roster** (student names, with the member's own P/L/A status mirrored as
  the `.absent` / `.late` mem style), the talking-time sub (`{used} of {smallGroupMin} min` — `smallGroupMin`
  is the F0 duration; `used` is elapsed within Phase 2), and the **project brief** (`.project-line`).
- **§3 — table-vs-derived (Kofi's call, flag #5):** the surface shows **which PG leads which students**. Two
  readings: (a) an **ephemeral in-session split** — derive Group A/B by assigning the class roster to the two
  active PGs (no persisted group rows); or (b) a **persisted `vlc_session_group` / `vlc_session_group_member`**
  pair so the split (and the `.project-line` note) survives the session. The surface implies persistence *within*
  the session (the brief is captured, feeds "next week Value 7B project execution"), but shows **no cross-session
  group history**. **Recommendation:** a lightweight per-session group table keyed to `vlc_session` (group →
  lead PG + members), with the `.project-line` as an optional `note` — but this is a **Kofi/Wells shaping call**
  the build plan explicitly leaves open (L3153: *"small-group table-vs-derived (Kofi/Wells shaping)"* — NOT an
  owner call). If 42a wants the leanest cut, ship the split as **derived** (round-robin the two PGs over the
  class) and defer the persisted brief. Flag #5.
- **Do NOT persist any cross-session group trend** (a "which group a student was in each week" history is a
  pastoral-adjacent trail — out of 42a).

### 2.6 Body block B — `.block` "Attendance" — the P/L/A grid (build this — 42a core)
- `.block-head`: eyebrow `Class attendance · 36 of 40 present`; `<h3 class="display">Marked at 2:35 PM <em>·
  auto-locked at 3:33 PM</em></h3>`; meta `PGs marked first · roll-call took 4 min · 2 late entries reconciled`.
  - The eyebrow count + the h3 times DERIVE (present-count; `Marked at` ≈ first-capture time; `auto-locked at` =
    the session's Close-phase end = the F0 clock). The meta "roll-call took 4 min · 2 late entries reconciled"
    is editorial colour — render it static or drop it; no data dependency.
- **`.att-card` grid** — 40 `.att-cell`s in 5 rows of 8. Each cell = a status **dot** + the student `.nm`. Four
  cell states:

  | Cell state | class | dot / ground | meaning |
  |---|---|---|---|
  | Present | `.att-cell` | green dot, `bg-bg` | status **P** |
  | **PG (present-first)** | `.att-cell.pg` | gold dot, `bg-gold-bg` | a Peer Guide, marked **first** — capture-order, still status P |
  | Late | `.att-cell.late` | warn dot, `bg-warn-bg` | status **L** |
  | Absent | `.att-cell.absent` | terra dot, `bg-terra-bg` | status **A** |

  - **The 40 names, in grid order** (first two are the PGs, gold): `Prince Otoo`(pg), `Akua Gyamfi`(pg),
    `B. Adusei`, `C. Mensah`, `D. Aryeetey`, `E. Annan`**(A)**, `F. Boateng`, `G. Owusu`, `H. Tetteh`,
    `I. Bediako`, `J. Asante`, `K. Larbi`**(L)**, `L. Kpodo`, `M. Yiadom`, `N. Quartey`, `O. Sarpong`,
    `P. Adjei`, `Q. Mensah`**(A)**, `R. Owusu`, `S. Tetteh`**(L)**, `T. Bonsu`, `U. Akoto`, `V. Boateng`,
    `W. Ofori`, `X. Kufuor`, `Y. Asare`, `Z. Boakye`, `AA. Kwapong`, `BB. Lartey`, `CC. Manu`, `DD. Nkrumah`,
    `EE. Osei`, `FF. Pepra`, `GG. Quaye`, `HH. Roberts`**(A)**, `II. Sasu`, `JJ. Tagoe`, `KK. Ulzen`,
    `LL. Vroom`**(A)**, `MM. Wiredu`. → 2 PG + 32 plain present, 2 late, 4 absent = 36 present / 40.
- **`.att-summary`** (4 pills, verbatim): `36 PRESENT · 90%` (present), `2 LATE · ARRIVED BY 2:45` (late),
  `4 ABSENT` (absent), `2 PG (GOLD) FIRST` (pg). All DERIVE from the P/L/A rows + the PG flag.
- **What each student row is (Kofi/Wells — project ONLY these):** the **student** (name from `students`), a
  **P/L/A status** (three states — Present / Late / Absent), and a **PG flag** (derived: is this student an
  active `vlc_peer_guide` for this class? → gold styling + the "PG-first" summary). **The datum is a 3-value
  status per (session × student).** Nothing else — no reason, no note, no time-of-mark is required by the grid
  (the "arrived by 2:45" is a summary-line string, not a per-student column).
  - **PG-first is a UI capture-ORDER convention, not a data field and not a PG write.** Owner decision (d): the
    **FM writes** the attendance; the grid simply surfaces the two PGs first (gold) so the FM marks them, then
    the class. Do not model "who marked" per row; do not let a PG write attendance.
  - **Attendance-status set — DISTINCT from the school-day register.** The main attendance module keeps **five**
    statuses (P/L/E/M/A; Medical = the sickbay→attendance "M" hook — memory `attendance-five-statuses`). **VLC
    session attendance is its own narrower P / L / A (three).** Do **not** reuse the 5-status enum here and do
    **not** surface Medical/"M" — there is no sickbay hook on this surface. Kofi to confirm the VLC status set is
    its own small domain (a two-value-CHECK-style `('P','L','A')`, the F0 `slot`-CHECK precedent), not the
    school `attendance_status`. Flag #6.
- **State/write:** the grid is the FM's write surface (mark each student P/L/A; toggle to `L`/`A`; PGs default
  present-first). `auto-locked at 3:33` = attendance locks when the session closes (Close-phase end) — a
  read-only state after lock (edits by Dean only, if at all). Write-gated (FM own-class). See §3.

### 2.7 Body block C — `.block` "Agenda timeline" — the 5 phase rows (RENDERS FROM F0, build this)
- `.block-head`: eyebrow `Session agenda · running by phase`; `<h3 class="display">The <em>rhythm</em> · 5
  phases × 60 min</h3>`; meta `Auto-advances · FM can pause if needed`.
- Five `.agenda-row`s (`grid-cols-[60px_100px_1fr_110px]`: time · phase · what · status), state `done | active
  | pending`. The **time window** and **phase name** RENDER-FROM-F0 exactly as the lifecycle bar (§2.3); the
  `what` is a per-phase description — **the F0 `VLC_PHASES[i].description` is the neutral default**; the surface
  shows a richer live-narration `what` that MUST be scrubbed of 42b/43 leaks:

  | # | time | phase (verbatim) | `what` — **42a rendering** | status |
  |---|---|---|---|---|
  | 01 | `2:33 — 2:38` | `01. Opener` | `FM framed Value 7B · referenced last week's session A on belonging beyond family · posed today's focus question · `**`3 minutes over by sports prefect briefing`** | `DONE · 5 MIN` |
  | 02 | `2:38 — 3:03` | `02. Small groups` | `Two PG-led groups in opposite corners of room · Prince on the clean-up idea, Akua on the JHS tutoring idea · `**`energy strong in both groups`** — **[43 — DROP `· FM observed both, took two pastoral notes`]** ("pastoral notes" is the INCR-43 note affordance) | `DONE · 25 MIN` |
  | 03 | `3:03 — 3:18` | `03. Plenary · LIVE NOW` | `Both groups share back · class debates feasibility of both projects · `**`FM moderating`** — **[42b — DROP `· J. Manu stepped out at 3:08 visibly upset · Akua handled it well, came back to plenary`]** (a student welfare event) | `ACTIVE · 12 MIN IN` |
  | 04 | `3:18 — 3:28` | `04. Reflection` | **[43 — REWORD]** render the neutral phase: `Silent reflection · students write privately · 10 minutes` — **DROP** the surface's `Silent journal · reflection book · FM and PGs do not read · entries are append-only · today's prompt "…"` (the journal/append-only capture is INCR-43; do not imply it exists) | `PENDING · 10 MIN` |
  | 05 | `3:28 — 3:33` | `05. Close` | `FM previews next week (Value 7B continues with project execution prep) · acknowledges PG work · session formally closed` — **[42b — DROP `· FM holds back J. Manu for 1-on-1 check-in`]** | `PENDING · 5 MIN` |

  - **RENDER-FROM-F0:** rows 1–5 are `VLC_PHASES` in order; the `status` pill's minutes = the F0 phase `min`;
    `DONE/ACTIVE/PENDING` derive from now() vs the phase clock. The **neutral fallback `what`** for any phase is
    `VLC_PHASES[i].description` (e.g. Opener = *"Value of the week introduced · today's focus question posed"*).
    The richer live-narration `what` shown on the surface would need a per-phase free-text — **optional**; if
    built it MUST be scrubbed per the table above (a live-narration field is an easy 42b/43 leak vector, so the
    lazy 42a cut is the F0 `description` + the scrubbed operational clauses only, no free narration box).
  - `Auto-advances · FM can pause if needed` — the clock auto-advances by the F0 windows; Pause (§2.1) freezes
    it. **Do not** wire the Section-02 "pause when a flag arises" path (42b).

### 2.8 `.flag-callout` — **[INCR-42b · OMIT ENTIRELY — see §Ω]**
This whole block (the terra "Pastoral flag raised · 3:08 PM" panel, the `FM + DEAN ONLY` badge, the "What Akua
noticed / J. Manu" body, and the three flag-action buttons) is the **first `vlc_pastoral_flag` affordance** and
is built in **42b, not 42a.** In 42a the register renders **nothing** in this position — no placeholder, no
disabled button, no "0 flags" counter. Full detail + why in §Ω.

### 2.9 `.foot-bar` (the persistent session stat bar — build this, MINUS the flag stat)
Navy bar, `grid-cols-[repeat(4,1fr)_auto]` on the surface → **`repeat(3,1fr)_auto` in 42a** (one stat omitted).
Each `.foot-stat` = `.lab` (gold-soft) + `.val` (Fraunces, gold `<em>`) + `.sub` (gold-soft):

| # | `.lab` | `.val` | `.sub` | 42a? |
|---|---|---|---|---|
| 1 | `Attendance` | `36 / 40` (em `36`) | `90% present · 2 late · 4 absent` | **42a** — from the P/L/A grid |
| 2 | `Phases complete` | `2 / 5` (em `2`) | `In plenary · 12 min in` | **42a** — from the phase clock |
| 3 | `Pastoral flags` | `1 raised` | `Concern · FM check-in queued` | **[42b — OMIT this stat]** |
| 4 | `Time remaining` | `18 min` (em `18`) | `Closes 3:33 PM` | **42a** — from the phase clock |

- Drop stat 3 (`Pastoral flags`) entirely → the 42a foot bar carries **Attendance · Phases complete · Time
  remaining** + the close button. Do **not** replace it with a "0 flags" stat (that still implies a flag system).
- Button: `Close session at 3:33` — `.btn.gold`. Closes the session (locks attendance, ends the phase clock).
  Write-gated (FM own-class). The "at 3:33" is the Close-phase end from the F0 clock.
- **No-alpha reminder (§0):** foot-stat `.lab`/`.sub` on the navy ground → **solid `text-gold-soft`.**

### 2.10 `.notes` aside (design-doc chrome — intent, mostly deferred content)
The 280px right rail is the surface's `.notes` design-doc panel (house convention: documents intent, **not a
build target**). It is NOT the app surface — but note what it contains so nobody ports it wholesale, because
most of it is deferred:
- **"Phase 4 prompts · in 12 min"** + 4 prompts — these are facilitation prompts; the operational ones would
  come from the `vlc_session_template.prompt`. If a live side-panel is ever built, the prompts are
  buildable-from-F0; but they are **not** part of the 42a build target as drawn.
- **"Reflection submission · live" + `96%` meter** — **[43 — OMIT].** A journal-submission metric
  (`vlc_journal_entry` completion) — no journal exists until INCR-43.
- **"Curriculum library"** 3 items — items 1–2 (Value 7 Session B toolkit, "Pairing note · V9 Service Session
  B") are the F0 curriculum cross-link (operational); item 3 **"Linked: Value 7 Session A reflections · read-
  only, anonymised summaries" — [43 — OMIT]** (journal reflections).
- **"Peer Guide notes"** (Prince `+1 facilitation point`; Akua `+2 pastoral judgement points · recognised J.
  Manu's distress`) — **[42b/43 — OMIT].** PG facilitation/pastoral-judgement scoring is the leadership-
  development / character strand, and the Akua line surfaces the welfare event.
- If a side-panel is desired in 42a at all, the only clean content is the F0 prompts + the F0 curriculum links —
  **recommend NOT building the side-panel in 42a** (it is majority-deferred; ship the register body + foot-bar
  and add the panel when 43 lands the reflection/journal data). Flag #8.

---

## Ω. Omit-not-fake list (be explicit — each element, and why it is deferred)

The rule: render **neutral / omit**; the copy must never imply a working pastoral/journal system. Nothing below
gets a placeholder, a disabled control, a zero-count, or a "coming soon" — it is simply absent in 42a.

### Ω.1 — [INCR-42b · `vlc_pastoral_flag`] — the confidential flag apparatus
1. **The entire `.flag-callout` block (§2.8)** — heading `Pastoral flag raised · 3:08 PM`; the `FM + DEAN ONLY`
   badge; the sub `Raised by Akua Gyamfi (PG) · student: J. Manu · context: Group B plenary share-back ·
   severity: CONCERN (intermediate level, not crisis)`; the body `What Akua noticed: J. Manu became visibly
   upset … J. Manu's father died in February … Queued for FM check-in at end of session (Phase 5 close).`; and
   the three buttons `Open private case note` / `Add to FM check-in queue` / `Escalate to Dean`. **Why:**
   `vlc_pastoral_flag` is the first `vlc_pastoral_` (REDACTED, parent_deny, FM-own-class + Dean-only gate) table
   — built in 42b for a focused Sarah gate. The `redaction.ts` `vlc_pastoral_` branch is not even wired yet.
2. **Head-row lede clause** `· 1 pastoral flag raised at 3:08 PM` (§2.1) — omit.
3. **Foot-bar stat 3** `Pastoral flags · 1 raised · Concern · FM check-in queued` (§2.9) — omit the whole stat
   (foot bar → 3 stats). No "0 flags" replacement.
4. **Agenda `what` welfare clauses** (§2.7): Plenary's `· J. Manu stepped out at 3:08 visibly upset · Akua
   handled it well, came back to plenary`; Close's `· FM holds back J. Manu for 1-on-1 check-in` — drop; keep
   the operational remainder of each row.
5. **Small-groups meta** `& flags` in `monitors energy & flags` (§2.5) — drop `& flags`.
6. **Section-01 doc title** word `flags` and the page-lede's `One student has just been flagged for follow-up`
   (§5) — design-doc chrome; not built, but noted so the in-app title is `Session live · attendance, groups,
   time remaining` (no "flags").
   - **Continuity note for 42b (do not build now):** the surface's "J. Manu" bereavement flag is the same case
     the INCR-13 discipline stub forward-references (ASK-24-0118, Joseph Manu — build-plan L3154). 42b's
     `vlc_pastoral_flag` carries `student_id` + `session` ref + `raised_at` + `severity` + `resolved_at`
     (nullable = active) + one context string; PG recorded as a `surfaced_by` **data** field (no PG write).
     None of that exists in 42a.

### Ω.2 — [INCR-43 · journal / character paragraph] — the reflection/journal + recognition strand
7. **The Reflection *journal* content** (§2.7 row 04): `Silent journal · students write privately in their
   reflection book · FM and PGs do not read · entries are append-only · today's prompt "What would I want to
   remember about today's discussion?"` — the **Reflection phase stays** (it is a frozen phase), but its copy is
   reworded to `Silent reflection · students write privately · 10 minutes`; the journal-capture claim is omitted
   (`vlc_journal_entry` is INCR-43).
8. **Agenda `pastoral notes`** (§2.7 row 02): `· FM observed both, took two pastoral notes` → drop the
   note-count (the note affordance is INCR-43).
9. **"Reflection submission · 96%" side meter** (§2.10) — journal completion metric, INCR-43.
10. **"Linked: Value 7 Session A reflections · read-only, anonymised summaries"** (§2.10) — a deep-link into
    prior-session journal reflections; **cross-session pastoral read = INCR-43.**
11. **"Peer Guide notes" scoring** (§2.10): `+1 facilitation point` / `+2 pastoral judgement points` — PG
    leadership/character scoring feeds the character paragraph (INCR-43); the Akua line also surfaces the welfare
    event (Ω.1).
12. **No cross-session pastoral trend anywhere** — no "how J. Manu has been across sessions", no per-student
    journal history, no "recognised on character ref". None of it in 42a.

### Ω.3 — what is NOT omitted (guard against over-scrubbing)
The **Reflection phase row**, the **small-group split + rosters + project briefs**, the **P/L/A grid**, the
**Pause/Close session controls**, and the **"paired with Value 9 Service"** curriculum pairing are all
**operational and IN 42a.** Do not drop them chasing the pastoral scrub — they carry no confidential PII.

---

## 3. Interaction-state inventory (INCR-42a, per region)

Each mutating region is a client component receiving `canEdit` (= `canWriteSession`, FM-own-class ∥ Dean ∥
Admin); `!canEdit` renders read-only. Every mutation is a server action that re-checks the write scope
(`lib/vlc/authz.ts`).

| Region | State | Behaviour / visual |
|---|---|---|
| Session (whole) | **not-started / live / paused / closed** | `not-started`: no `started_at` yet → a "Start session" affordance (the surface shows a live session; the pre-start state is implied). `live`: phase clock advancing. `paused`: `Pause session` freezes the clock (run-state on `vlc_session`). `closed`: `Close session` locks attendance; register becomes read-only. |
| Session index (`/senior/vlc/sessions`) | empty / populated | **empty:** VLC enabled but no session today / no eligible period → muted `EmptyState` ("No VLC session scheduled today"), not a blank page (mirror the peer-guides coalesce). **populated:** today's session(s) for the viewer's scope. |
| Attendance grid | loading / capturing / locked / read-only | FM marks each student P/L/A (default present; PGs surfaced first, gold); `capturing` until Close; `locked` after Close (auto-lock at Close-phase end). `!canEdit` → dots render, no toggles. Write-gated. |
| Small groups | derived / (persisted) / read-only | the split + lead PG render; if persisted (flag #5), an edit affordance to move a student between groups + capture the `.project-line` note. `!canEdit` → read-only. |
| Phase clock (lifecycle + agenda) | running / paused | auto-advance derived from `started_at` + F0 durations vs now; Pause freezes. FM-only (own class). |
| `Open curriculum` | read (all) | cross-links the F0 curriculum library (setup surface). Shows for read-only viewers. |
| `Pause` / `Close session` | edit | run-state mutations; write-gated (FM own-class). |
| Whole surface — `!canEdit` | read-only | no P/L/A toggles, no Pause/Close, no group edits; hero lede appends *"You have read-only access to this surface."* |
| **`.flag-callout`** | **absent** | **[42b] — not rendered in any state.** |

---

## 4. Component / build mapping + implied data model

| Surface region | Reuse | New work for INCR-42a |
|---|---|---|
| VLC sub-nav | `components/vlc/vlc-tabs.tsx` | **one `TABS` entry** (`/senior/vlc/sessions`, "Sessions") |
| Page guard | peer-guides page guard chain (`requireSchoolRole(READ)` + BASIC redirect + `canEdit`) | swap `canEdit` to `canWriteSession` (FM own-class ∥ Dean ∥ Admin) |
| `.head-row` hero | peer-guides hero shape (crumb → display h2 w/ gold `<em>` → lede + `!canEdit` line) | VLC-session crumb/date; scrubbed lede; `Open curriculum` + `Pause` actions |
| `.block` headers (§2.5/2.6/2.7) | **`SectionHead`** (chrome.tsx) — fits eyebrow + display h3 + meta 1:1 | copy strings verbatim |
| `.facilitator-strip` | — (net-new) | `FacilitatorStrip` — FM (class teacher) + active PGs (INCR-41 data) |
| `.lifecycle` bar | `lib/vlc/defaults.ts` (`VLC_PHASES`, `coalesceVlcProgramme`, `addMinutes`, `formatVlcTime`) | `PhaseClock` (net-new client) — derive windows + done/active/pending |
| `.focus-banner` | F0 `vlc_value` + `vlc_session_template` join | `SessionFocusBanner` (net-new) — value/Twi/title/pairing from F0 rows |
| `.groups-grid` | INCR-41 active-PG data | `SessionGroups` (net-new) — split + rosters + project note; table-vs-derived (flag #5) |
| `.att-card` P/L/A grid | — (net-new) | `SessionAttendance` (net-new client) — P/L/A capture, PG-first order, summary pills |
| `.agenda-card` | `VLC_PHASES` (descriptions as neutral fallback) | `SessionAgenda` (net-new) — phase rows + scrubbed `what` |
| `.foot-bar` | — (**`SumCard` does NOT fit** — navy foot-bar is a different layout, flag #7) | `SessionFootBar` (net-new) — 3 stats + Close button |
| `.flag-callout` | — | **NONE — omitted (42b)** |
| Data lib | `lib/vlc/peer-guides-data.ts` shape (`"server-only"`, `withSchool`, derived, plain view types) | new `lib/vlc/session-data.ts` |
| Actions | peer-guides action idiom (re-check write scope every action) | new `lib/actions/vlc-session.ts` (or extend `lib/actions/vlc.ts`) |
| Write authz | — | **new `lib/vlc/authz.ts`** (the INCR-41-deferred DRY, roadmap-directed to land here): `canWriteSession` = FM(own class) ∥ Dean ∥ Admin; own-class scoping enforced server-side (flag #3) |
| Form resolver | `lib/vlc/eligibility.ts::classFormNumber` | **extract the 4th copy** into a shared senior resolver (roadmap-directed DRY, build-plan L3151) |
| Frozen copy | `lib/vlc/defaults.ts` | **no new strings** — phases/values/templates already frozen; the neutral phase `description`s are the agenda fallback |

**Data model this surface implies (Kofi/Wells — 42a builds these; F0 + INCR-41 tables already exist):**
- **`vlc_session`** — **one row per (class × date)**, the operational session instance. Columns (minimal):
  `school_id`, `class_id` (composite `(school_id, class_id)` FK → classes), `academic_period_id` (composite FK),
  `session_template_id` (composite `(school_id, session_template_id)` FK → **`vlc_session_template_tenant_uk`**,
  which F0 already **authored ahead** exactly for this — `vlc.ts` L145-147/172), `session_date`, `started_at`
  (nullable — null = not started; carries the "2:33, 3 min late"), optional run-state (paused flag / `closed_at`
  or a small status), optional `start_note` (the "sports prefect briefing ran long"). **NO stored phase clock,
  NO stored value/session copy, NO stored elapsed/remaining** — all derived from `started_at` + F0 durations +
  the template join (the R302/R307 derived discipline). Fix the **stale `vlc.ts` "for INCR-41's vlc_session"
  comment** while in the file (build-plan L3151/L3165).
- **`vlc_session_attendance`** — one row per (session × student): `school_id`, composite FK to `vlc_session` +
  to `students`, `status` (a small **`('P','L','A')` CHECK** — the F0 `slot`-CHECK precedent, NOT the school's
  5-status enum; flag #6), `marked_at?`. Present is NOT default-absent here (the surface marks all 40) — but a
  present-by-default (absence-row-only) model like `vlc_training_absence` is also viable if P is overwhelmingly
  the norm. **Kofi's call — flag #6.** The **PG flag is DERIVED** (join to active `vlc_peer_guide`), never a
  stored column; "PG-first" is UI order only.
- **Small groups** — **table-vs-derived is the open shaping call (flag #5).** If persisted: `vlc_session_group`
  (session → group label + lead `peer_guide_id`, composite FKs) + `vlc_session_group_member` (group × student),
  optional `note` (the project brief). If derived: no rows — split the class over the 2 active PGs at read time.
- **Do NOT build** `vlc_pastoral_flag` (42b), `vlc_journal_entry` / `vlc_pastoral_note` / `vlc_case_file` /
  `vlc_character_paragraph` (43) here.
- **Tenant-scoping (mirror INCR-40/41):** every new `vlc_session*` table gets ENABLE + FORCE RLS +
  `tenant_isolation` + `parent_deny` (catalog loop), composite `(school_id, …)` FKs, and **prod-paste run by
  hand** (memory `prod-rls-manual-paste`; next migration slot ~0067 per L3150). Add the new tables to
  **`SHOWN_AUDIT_ENTITIES`** — they are operational, **none uses the `vlc_pastoral_` prefix**, so they must be
  explicitly listed or the INCR-30/31 classify-at-creation guard fails the build (the R308 precedent).

---

## 5. The outer editorial page-header (design-doc chrome — do NOT build verbatim)
Above the `.desktop` mock: eyebrow `Omnischools · VLC batch · 03 of 05`; `.mvp-tag` `SHS · Form Master view ·
live session`; `.related-tag` `The Wednesday surface · 60 minutes, every class`; `<h1>The <em>live session</em>
· Wednesday 2:33 PM</h1>` (56px); a lede describing the Form-2-GA-A / Value-7-Patriotism / Session-B live
session — **its last sentence `One student has just been flagged for follow-up` is [42b], omit.** Its facts are
carried by the in-app head-row + focus-banner. Not built as-is.

## 6. Section 02 — "Why this rhythm" (editorial, NOT a build target)
`.section` 02 is a two-column editorial (`.editorial` article + `.notes` aside): *Five phases · because the work
is different in each.* An explainer, not a configurable surface — **do not build it.** But it encodes hard
constraints the register must honour:
- **The five phases + their minutes are the design** (5 · 25 · 15 · 10 · 5). The register renders them from F0;
  the durations are the school's `vlc_programme` values (editable in the setup surface), not re-invented here.
- **"The system absorbs ±3 min · Phase 5 still closes at 3:33."** The phase clock may drift within a tolerance
  but the Close anchor holds — the clock derivation should key the close to the scheduled end, not accumulate
  unbounded drift.
- **"The reflection phase is non-negotiable · cut the plenary, never the journal time."** A design invariant for
  when the clock runs over — Reflection stays 10 min. (The *journal capture* it protects is INCR-43; the *phase*
  is 42a.)
- **"FM can pause if a flag arises mid-session · the Pause button stops the clock · pastoral takes precedence
  over schedule."** The **Pause control is 42a** (operational, stops the clock). The **flag that triggers it is
  42b** — build Pause; do not wire the flag-triggered auto-pause.

## 7. Cross-module hooks (design commitments — preserve in the map)
- **Session ↔ F0 curriculum (value + template pairing).** `Value 7 Patriotism · Session B · Service project
  planning` + `paired with Value 9 Service session B in two weeks` mirror F0's intra-curriculum pairing (value 9
  slot B prompt = "paired with Value 7B"). The `vlc_session` references the `vlc_session_template`; the pairing
  copy renders from F0 — **keep it verbatim, it is a design commitment.**
- **Facilitator strip ↔ INCR-41 roster.** The two PGs on the strip and the two group leads are the class's
  active `vlc_peer_guide` rows (name + rep-gender from `students.sex`) — the same INCR-41 data, reused, not
  re-modelled.
- **Attendance ↔ the school register (deliberately SEPARATE).** VLC session P/L/A is its **own** 3-status
  capture, NOT the school-day 5-status register (P/L/E/M/A with the sickbay→attendance "M"/Medical hook). No
  Medical status, no sickbay hook surfaces here. Keep the VLC status domain small and separate (flag #6).
- **Training ↔ this session (INCR-41 forward-ref made good).** INCR-41's 19-May training "planning & running
  Value 7B · Patriotism→Service paired session block" is prep for exactly this Session-B service-project surface
  — the copy the Peer Guides map preserved lands here.
- **[42b/43 chains to note now — do NOT build]:** the plenary welfare event → `vlc_pastoral_flag` (42b, and the
  INCR-45 discipline-stub existence-check keys off it, student "J. Manu" = ASK-24-0118); the Reflection phase →
  `vlc_journal_entry` (43); PG facilitation notes → the school-leaver **character paragraph** (43). The register
  must not preclude these, but must not surface or deep-link to them this increment.

---

## Open questions / drift log
1. **Route depth.** Recommend `/senior/vlc/sessions` (landing) → `/senior/vlc/sessions/[classId]/[date]` (live
   session), mirroring the surface URL. Confirm whether 42a ships the full deep route or a leaner single-session
   page + a today-index. Scope lever.
2. **Tab label.** Recommend `Sessions` (matches the 1–2-word `Setup` / `Peer Guides`); `Session register` is
   the faithful alternative. Confirm; sidebar label stays `Student support`.
3. **FM own-class WRITE scoping.** This surface's writer is the **FM of the class** (owner decision (d)), not the
   roster's Dean/Admin. `lib/vlc/authz.ts::canWriteSession` = FM(own class) ∥ Dean ∥ Admin, enforced
   server-side. Confirm own-class (not any-FM) — the operational analogue of 42b's own-class-flag-read risk.
4. **Focus question source.** The long "Today's question" is richer than the F0 template `prompt`. Recommend
   rendering the template prompt (minimal); if the richer per-session question is wanted, widen the template or
   add an optional `focus_question` note — do not hard-code the surface string.
5. **Small groups — table vs derived (Kofi/Wells shaping, per build-plan L3153).** The surface shows which PG
   leads which students + a captured project brief, implying within-session persistence but **no cross-session
   history**. Recommend a lightweight per-session group table (+ optional `note`); the leanest cut derives the
   split over the 2 active PGs and defers the brief. Kofi/Wells call — NOT an owner call.
6. **VLC attendance status set.** VLC session attendance is **P / L / A (three)** — its own small domain (a
   `('P','L','A')` CHECK, F0 slot-CHECK precedent), DISTINCT from the school-day 5-status enum (P/L/E/M/A). No
   Medical/"M". Confirm the domain + whether it is all-marked (surface shows 40 cells) or present-by-default
   (absence-row-only, the `vlc_training_absence` idiom). Kofi's call.
7. **Foot-bar reuse.** `SumCard` does not fit the navy foot-bar (different layout) — `SessionFootBar` is
   net-new. Confirm net-new (vs forcing SumCard). The block heads DO reuse `SectionHead` cleanly.
8. **Live side-panel (`.notes` rail).** Majority-deferred (reflection-submission meter + PG scoring + linked
   reflections are 43; PG notes touch 42b). Recommend **not** building the side-panel in 42a — ship the register
   body + foot-bar; add the panel when 43 lands. Confirm.
9. **Land the INCR-41-deferred DRY here (roadmap-directed, build-plan L3151):** extract the shared senior
   form-resolver (now the 4th copy), create `lib/vlc/authz.ts`, fix the redundant page `getCurrentUser()`, and
   fix the stale `vlc.ts` "for INCR-41's vlc_session" comment. Confirm OK to touch the shipped VLC files.

---

*Map produced against: `Surfaces/schoolup-vlc-session-register.html`; the shipped INCR-40/41 idiom
(`app/(app)/senior/vlc/{layout,peer-guides/page}.tsx`, `components/vlc/{vlc-tabs,chrome}.tsx`,
`lib/vlc/{defaults,peer-guides-data,eligibility}.ts`, `db/schema/vlc.ts`); the INCR-42 decomposition in
`docs/senior-build-plan.md` L3148–3154 (SPLIT 42a/42b, owner calls 2026-07-27); and the token vocabulary shared
with `docs/senior/ledger-surface-map.md` §0 and `docs/senior/vlc-peer-guides-surface-map.md` §0.*
