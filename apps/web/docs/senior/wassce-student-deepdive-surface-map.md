# WASSCE Student-Readiness Deep-Dive Chrome — Surface Map (INCR-20 · Module 4.3 CAPSTONE)

**Author:** Lucy (design cartographer) · **Status:** design spec, ready for the implementation engineer (Claude Code).
**Increment:** INCR-20 — *Student-readiness deep-dive chrome (the CAPSTONE, final increment of Module 4.3)*. Depends on the shipped INCR-17 (projection engine, migration 0053) + INCR-17b (university match). Reads across `senior_score_ledger` (4.1, shipped), `academic_period`, `attendance_records`, `fees`/`invoices`, `wassce_papers`/`wassce_paper_sittings`, `students.stpshs_ref`. **No new migration is required for the well-bound parts** — this is a READ-and-render increment.

**Surface:** `Surfaces/schoolup-wassce-student-readiness.html` (~1713 lines, Y. Aidoo, the full 7-section deep-dive). **This map covers ONLY the INCR-20 delta** — the chrome drawn on the surface but NOT yet rendered by the shipped candidate page.

**Route (STAFF surface — CONFIRMED):** `app/(app)/senior/wassce/candidates/[index]/page.tsx`, the existing role-gated `WASSCE_SETUP_ROLES` route (ADMIN / HEADMASTER / VICE_HEADMASTER_ACADEMIC). Tenant-scoped, RLS-enforced, index-number keyed. **This is NOT the parent-reachable surface** — the parent view is `wassce-parent-tracker` (INCR-19, parent-scoped RLS). Everything below is added to the same single-page-with-anchors deep-dive the staff already open; no new route.

---

## SHIPPED vs NEW — the exact INCR-20 boundary

The page comment is the contract: *"Full deep-dive chrome (STPSHS panel, schedule, ledger grid) = INCR-20."* Walking all 7 sections:

| Section | SHIPPED (17 / 17b) — do NOT re-map | NEW (INCR-20) — mapped below |
|---|---|---|
| **§1** identity | projected-aggregate cell (`B.4`), trajectory strip (3× `TrajCell`), trust line, **medical-disruption banner** (open SC-12) | **full `.student-card`** (avatar, name, index, House, Form Master, DOB, parent, NHIS, target) — Part A · **STPSHS submission status panel** (8-subject × 3-year table) — Part B |
| **§2** schedule | — (nothing) | **whole paper-by-paper schedule** (summary cells, 9-row table, make-up convention note, footer tallies) — Part C |
| **§3** subjects | subject Mock1→Mock2→projected cards (`SubjectCard`, all 8) | — (fully shipped) |
| **§4** ledger trajectory | the projection **callout** only (compact gold-gradient card, `#ledger-trajectory`) | **the full 30-cell 6-semester × 5-category grid** + weighted-total row + ref-ID row + STPSHS-state row + "What STPSHS sees / What Omnischools sees" foot — Part D. *(The shipped callout stays; the grid mounts ABOVE it.)* |
| **§5** aggregate | aggregate-construction visualizer (`WassceAggregateVisualizer`) | — (fully shipped) |
| **§6** university match | match tiles + add-target + legend (17b) | — (fully shipped) |
| **§7** context | readiness statement + parent-ack + SC-12 xmod card + write panel | **context strip** (attendance/discipline/sickbay/fees/VLC/NHIS 6 cells) · **parent-comms log preview** · **non-SC xmod cards** (Sickbay/Billing/Boarding/VLC/Transcripts) — Part E |

**Two dozen elements below need data from unbuilt modules (Sickbay is module 4.4; VLC / general-discipline / transcripts are unbuilt).** Following the 19b/17 omit-not-fake precedent (the hardcoded hospital bed), every such element is flagged **OMIT — do not placeholder, do not fabricate**. The honest deep-dive renders the well-bound panels (ledger grid, schedule, attendance, fees) in full and drops or "pending"-marks the panels whose tables don't exist. Loudly summarised in Part F.

---

## §0 — Shared chrome, tokens, no-alpha (REUSE the INCR-17 map; deltas only)

All chrome + tokens are **identical** to the shipped surface. **Reuse `docs/senior/wassce-readiness-surface-map.md` §0 verbatim** — same `:root` palette (= `design-tokens.json` v1.0.0), same `.app-shell` sidebar (flat nav: Academic / Student support / Operations; WASSCE 2026 active), same `.head-row`/`.btn` families, same `font-display`/`font-body`/`font-mono` split, same em-dash `—` empty convention. The outer editorial `.page-header` / `.section-head` / `.section-num` / `.section-meta` and the `.notes` right-rail are **design-doc chrome — do NOT build.**

**NEW bespoke colours this increment introduces (NOT tokens — inline / `lib/wassce/` constants; NEVER slash-opacity):**

| Region | Value | Where | Port |
|---|---|---|---|
| Ledger-grid Mock-1 term header | `#3D5478` (bespoke mid-navy) | `.lt-grid th.mock-1` | inline `bg-[#3D5478]` |
| Ledger-grid Mock-2 term header | `#4A6286` (bespoke mid-navy) | `.lt-grid th.mock-2` | inline `bg-[#4A6286]` |
| Ledger category-head cell | `--navy-2` | `.lt-cat-head` | `bg-navy-2` |
| Identity Science pill | `#E5F0EB` bg / `#1E5A35` text | `.sc-pill.sci` | inline — **drift** vs INCR-15 terra Science pill (already logged, §0.3 of the 17 map) |
| Identity House pill (Slessor) | `#E5EAF2` bg / `#2D3F5C` text | `.sc-pill.slessor` | inline per-House tint |

**No-alpha discipline — every translucency in the NEW sections (repo memory `no-alpha-token-opacity`). The ledger grid is the trap-dense one:**

| Element (part) | Raw value | Port to |
|---|---|---|
| `.lt-score.mock-1-col` (D) | `rgba(61,84,120,0.06)` | `bg-[rgba(61,84,120,0.06)]` |
| `.lt-score.mock-2-col` (D) | `rgba(74,98,134,0.08)` | `bg-[rgba(74,98,134,0.08)]` |
| `.lt-total-row` bg (D) | `rgba(200,151,91,0.05)` | `bg-[rgba(200,151,91,0.05)]` |
| `.lt-total-row td` accent (D) | `rgba(200,151,91,0.05)` on `.lt-cat-label` → gold-bg | `bg-gold-bg` for the label cell |
| `.lt-score.empty` (D) | `opacity:0.45` | **`opacity-45`** — NOT `text-*/45` |
| STPSHS panel `td.pending` (B) | `--gold-bg` solid | `bg-gold-bg` (solid token — fine) |
| STPSHS panel `td.blocked` (B) | `--terra-bg` solid | `bg-terra-bg` (solid token — fine) |
| `.sch-row.missed` (C) | `#FBEBE7` (≈ terra-bg) | inline `bg-[#FBEBE7]` or `bg-terra-bg` |
| `.stp-pip-ready` / `.stp-pip-pending` (D bottom row) | `green-bg`/`gold-bg` solid | solid tokens — fine |

> **Grade-chip palette (Palette A)** is only used in shipped §3/§5. The NEW sections use no grade chips — the STPSHS panel and ledger grid render **raw mono scores**, not A1–F9 chips.

---

# PART A — §1 full student identity card (`.student-card`) — NEW

**Surface lines 455–477.** The shipped page renders only the **projected-aggregate cell** (right column, `B.4` of the 17 map). INCR-20 builds the **rest of the card**: the avatar + name + two meta rows. White card `bg-surface border border-border rounded-xl`, `padding 24px 28px`, `grid-cols-[auto_1fr_auto] gap-24 items-center`.

| Sub-element | Exact copy | Token | Binds to |
|---|---|---|---|
| `.avatar` | `YA` | 72px circle, `linear-gradient(135deg, gold, gold-soft)`, Fraunces 26px 500 `text-navy` | initials of `students.first_name`/`last_name` |
| `.sc-name` | `Yaa ` + `<em>Aidoo</em>` | Fraunces 26px 500; gold italic `<em>` on surname | `students.first_name` + `last_name` |
| `.sc-meta-row` (line 1) | `**Index** · 0184-0817` · `**F3** · Slessor House` · `[Science pill]` · `**Form Master** · Mr S. Asiedu` · `**Born** · 12 Aug 2008 (17)` | `12px text-navy-3`, bolds `text-navy`; Science `.sc-pill.sci` (green-tint, §0), House inline | `wassce_candidates.index_number` · Form label + `house.name` (via `students.house_id`) · `wassce_programmes.name` → Science pill · **Form Master** = `senior_subject_teacher` / class form-master link · `students.date_of_birth` (+ derived age) |
| `.sc-meta-row` (line 2) | `**Parent** · A. Aidoo (mother) · +233 24 487 6612` · `**NHIS** · 9842-1276-5503 (active to Mar 2027)` · `**Target** · KNUST Biochemistry` | `12px text-navy-3` | Parent = `students` guardian/household contact · **NHIS → OMIT (see below)** · Target = `university_targets` FIRST_CHOICE (17b), or the candidate's tagged primary |

> **Binding notes:**
> - **House:** `students.house_id` → `house.name` (F0 table). `F3 · Slessor House`. The Slessor pill tint is bespoke per-House (`#E5EAF2`/`#2D3F5C`), inline.
> - **Form Master** (`Mr S. Asiedu`): the class's form-master. There is no dedicated `form_master` column; derive from the candidate's class + `senior_subject_teacher` or the class-teacher link. **Flag** — confirm the form-master source (Kofi). If none is modelled, render the label with an em-dash rather than fabricating a name.
> - **DOB + age:** `students.date_of_birth` → `12 Aug 2008 (17)`; age is a derived display value, never stored.
> - **🚩 OMIT — NHIS card number.** `NHIS · 9842-1276-5503 (active to Mar 2027)` has **NO backing field.** `student_health_record` (the only health table) carries `blood_group / allergies / conditions / medications / emergency_contact_* / notes` — **no NHIS number, no NHIS validity date.** NHIS is Sickbay/health-registry data = **module 4.4, not built.** **Drop the NHIS meta item entirely** (do not render `9842-…`; do not render a fake number). Same call as the 19b hardcoded hospital bed. If the health record exists, the most you may honestly surface is a neutral "health record on file" link — but the card number and expiry are OMIT.
> - The **projected-aggregate right column** (`.sc-aggregate`: `Projected aggregate` / `10` / `Mock 2 actual · WASSCE in flight`) is **SHIPPED** (17 map B.4). Do not re-build it — slot the new avatar+meta columns to its left.

---

# PART B — §1 STPSHS submission status panel (`.stpshs-panel`) — NEW · HEAVILY UNBOUND

**Surface lines 506–595.** The regulator-submission integration block: an 8-subject × 3-year table of per-year scores + reference IDs + submission state, with a 4-line footer tally. **This is the most data-starved panel in the increment** — most of its cells have **no table** and must be OMIT-or-derive, not fabricated.

### B.1 Layout & static copy (build the chrome)
White card `bg-surface border border-border rounded-lg overflow-hidden`.
- **`.stpshs-head`** (`border-b`, flex space-between):
  - `.stpshs-eyebrow` `WAEC STPSHS · regulator submission state` (`10px uppercase tracking-[0.18em] text-gold 700`)
  - `.stpshs-title` `8 subjects · per-year score submission · F1, F2 confirmed · F3 in flight` (Fraunces 17px 600) — **the "F1, F2 confirmed · F3 in flight" clause is submission-state copy that has no table (B.3); soften to a subject count only, or OMIT the state phrasing.**
  - `.stpshs-meta` `Last sync · 28 May 2026 · 09:14 · automatic on score-ledger commit` (`10.5px mono text-navy-3`) — **🚩 OMIT the timestamp** (no STPSHS sync log exists). Keep the static "automatic on score-ledger commit" gloss if desired; drop the fabricated datetime.

### B.2 The table — `thead` `bg-navy text-bg`, columns:
`Subject · F1 score · F1 ref · F2 score · F2 ref · F3 score · F3 ref · STPSHS state` (`th` `9.5px uppercase 700`; year/ref cols centred). One row per subject; `td.stp-subj` `12.5px 600 text-navy padding-left 18px`, the alternate-subject tag `.stp-alt` `Fraunces italic 10px text-gold`.

**8 subject rows, verbatim (name / F1·F2·F3 score / state):**

| Subject | F1 | F2 | F3 | STPSHS state (copy) |
|---|---|---|---|---|
| English Language | 68 | 72 | `—` (blocked) | `F3 blocked · missed papers · SC-12 pending` (`.state-blocked` terra 600) |
| Mathematics (Core) | 66 | 75 | 81 | `all three years submitted · ready for WAEC reconciliation` (`.state-ready` green) |
| Integrated Science | 76 | 82 | 87 | `all three years submitted` (green) |
| Social Studies | 64 | 70 | 72 (pending) | `F3 entered locally · awaiting end-of-term sync to STPSHS` (`.state-partial` gold) |
| Chemistry | 72 | 79 | 86 | `all three years submitted` (green) |
| Physics | 68 | 74 | 80 | `all three years submitted` (green) |
| Biology | 70 | 76 | 82 | `all three years submitted` (green) |
| Elective Maths `alternate` | 71 | 78 | 85 | `all three years submitted` (green) |

Cell states: `td.stp-yr.pending` → `bg-gold-bg` + gold score; `td.stp-yr.blocked` → `bg-terra-bg` + terra `—`; ref cells `9.5px mono text-navy-3` (pending → gold-bg/gold, blocked → terra-bg/terra).

### B.3 Footer (`.stpshs-foot`, `bg-bg border-t`) — 3 tally lines + 1 muted narrative
1. `[green dot]` `**21 of 24 entries** (8 subjects × 3 years) submitted and Reference-ID'd in STPSHS · all WAEC reconciliation requirements met for those subjects`
2. `[gold dot]` `**1 entry** (Social Studies F3) entered into Omnischools ledger and awaiting term-close sync · expected to push automatically on 14 July 2026 when the window opens`
3. `[terra dot]` `**2 entries** (English F3 Lang 1, Lang 2) blocked pending SC-12 make-up sitting · STPSHS does not accept partial-paper entries for a subject · re-opens on WAEC's notification of make-up date`
4. `.muted` (dashed top-border, italic): `**What STPSHS sees · what Omnischools sees.** The 21 ready entries above represent the *terminal* score per subject per year … The *trajectory underneath each number* … is what Omnischools holds and what enables the projection. Section 4 below shows Mathematics in full as the worked example.`

### B.4 Data-binding reality — READ THIS BEFORE BUILDING

| Column | Table? | Verdict |
|---|---|---|
| Subject list (8 rows) | `wassce_candidate_subject` → `wassce_subjects` | ✅ **BOUND** — the candidate's registered subjects, ordered core-then-elective. |
| Per-year F1/F2/F3 **score** (68/72/81 …) | `senior_score_ledger.weighted_total` | ⚠️ **DERIVE, with a wrinkle.** The ledger grain is **per-semester** (6 periods), STPSHS wants **per-year terminal** (3 figures). Map each Form-year to its two semesters and take the **year's terminal figure** (the S2 `weighted_total`, or the school's year-end computation). Also: the ledger keys on **gradebook `subjects`**, WASSCE keys on **`wassce_subjects`** — a name/code join is required (Part D.5). Round to integer for display. |
| Per-year **Reference ID** (`REF-2024-0817-ENG`) | — | 🚩 **OMIT / "pending".** There is **no per-(year × student × subject) STPSHS reference table.** The only STPSHS id is `students.stpshs_ref` — **ONE opaque per-student text column, currently NULL** (INCR-3 schema 0042; renders "pending" until the unbuilt STPSHS bio-data-ingest increment). **Do not synthesize `REF-2024-0817-ENG`.** Render the ref cells as `pending` (the shipped precedent) or drop the ref columns. |
| **STPSHS state** (`all three years submitted` / `F3 blocked` / `awaiting sync`) | — | 🚩 **OMIT / proxy only.** There is **no STPSHS regulator-submission-state table.** The nearest real signal is `senior_score_ledger.status` (`DRAFT / COMPLETE / STPSHS_READY`) — but that is a **per-semester local** state, not a "submitted to / acknowledged by WAEC" state. You may derive a **local** readiness proxy (`STPSHS_READY` → "ready locally"; else "pending"), but the "submitted to WAEC / blocked / acknowledged" phrasing describes a regulator round-trip that has **no backing** and must not be fabricated. The `F3 blocked · SC-12 pending` cell can honestly bind to an open `waec_special_consideration` on that subject (that table IS shipped, INCR-17). |
| `Last sync · 28 May 2026 · 09:14` | — | 🚩 **OMIT** — no sync log. |
| Footer tallies (`21 of 24`, `1 entry`, `2 entries`) | derived from the above | 🚩 **OMIT the fabricated counts.** Only compute a tally over data that exists (e.g. count of subjects with `STPSHS_READY` local ledgers + open-SC-blocked subjects). If the underlying per-year submission concept isn't real, the "21 of 24" is a fabrication — drop it or replace with a locally-true count. |

> **Recommended honest build:** render the panel chrome + subject rows + **per-year ledger-derived scores** (real) + the SC-12-blocked English cell (real, from `waec_special_consideration`). Render the **ref column as "pending"** and the **STPSHS-state column from ledger `status` as a LOCAL readiness proxy** (clearly worded as local, not "submitted to WAEC"). Drop the sync timestamp and the "21 of 24" tally, or recompute them from what exists. This is the omit-not-fake line: the regulator-submission integration is a later increment; INCR-20 shows what the school genuinely holds.

---

# PART C — §2 exam-schedule detail (paper-by-paper) — NEW · WELL BOUND

**Surface lines 616–790.** The candidate's full papers/sittings schedule — the staff deep view. This is a **clean binding** to the shipped `wassce_papers` + `wassce_paper_sittings` (INCR-15).

### C.1 Page-head (`.head-row`)
Crumb `Y. Aidoo › WASSCE 2026 schedule`; `<h1>` `Paper-by-paper <em>completion</em>`; actions `Export schedule` (`.btn`) · `SC-12 make-up calendar` (`.btn`, nav → SC context).

### C.2 Top summary strip (`.sch-summary`, `grid-cols-4`)
White cells `bg-surface border border-border rounded-md`; `.sch-sum-num` Fraunces 22px 500, `.sch-sum-lbl` `10px uppercase text-navy-3`:

| Value | Colour | Label | Binds |
|---|---|---|---|
| `9` | `.total` navy | `Papers · total` | count of `wassce_papers` for candidate's subjects (cohort) |
| `1` | `.sat` green | `Sat` | sittings with `sat_at` set |
| `3` | `.missed` terra | `Missed · medical` | sittings with `exempted_at` set |
| `5` | `.upcoming` gold | `Upcoming` | papers with a future `scheduled_date`, no sitting yet |

### C.3 The schedule table (`.schedule-table`) — 9 rows
Head grid `grid-cols-[90px_1fr_130px_130px_120px_110px]`, `bg-bg`, columns: `Date · Paper · Duration · Type · Status · Action`. Row tints: `.sch-row.missed` `bg-[#FBEBE7]`, `.sch-row.upcoming` `bg-bg`.

**9 rows, verbatim (date/time · paper + sub-line · duration · type · status · action):**

| Date | Paper (`.sch-paper`) | Sub-line (`.sch-paper-sub`) | Dur | Type | Status pill | Action |
|---|---|---|---|---|---|---|
| Mon 12 May 08:00 | Social Studies 1 | Objective · 60 questions | 1h 00m | Objective | `Sat` (`.sat` green-bg) | View attendance |
| Tue 13 May 14:00 | English Language · Oral | Practical · listening test | 45m | Oral | `Missed · medical` (`.missed` terra-bg) | SC-12 filed |
| Wed 14 May 08:00 | English Language 1 | Objective · 80 questions | 1h 00m | Objective | `Missed · medical` | SC-12 filed |
| Wed 14 May 10:30 | English Language 2 | Essay · 3 questions, 4 choices each | 1h 30m | Essay | `Missed · medical` | SC-12 filed |
| Wed 3 Jun 08:00 | Mathematics (Core) 1 | Objective · 50 questions | 1h 30m | Objective | `Upcoming · 19 days` (`.upcoming` gold-bg) | Fit-to-sit assessment |
| Wed 3 Jun 11:00 | Mathematics (Core) 2 | Essay · 13 questions, answer 10 | 2h 30m | Essay | `Upcoming · 19 days` | Fit-to-sit assessment |
| Tue 26 May 08:00 | Integrated Science 1 & 2 | Objective + essay combined | 2h 30m | Combined | `Upcoming · 11 days` (`.upcoming-far`) | View prep status |
| Mon 8 Jun 08:00 | Chemistry 1 & 2 | Theory · core elective | 3h 00m | Theory | `Upcoming · 24 days` (`.upcoming-far`) | View prep status |
| Tue 9 Jun 11:00 | Physics 1 & 2 | Theory · core elective | 3h 00m | Theory | `Upcoming · 25 days` (`.upcoming-far`) | View prep status |

### C.4 Make-up convention note (static `lib/wassce/` policy copy)
`bg-bg border border-border rounded-md`, `12px text-navy-2`: `**SC-12 make-up convention.** WAEC offers make-up sittings for candidates with documented medical disruption within the live exam window. For Y. Aidoo, the three English papers will be rescheduled — typically within 10 working days of fitness restoration — at the regional WAEC office in Sefwi-Wiawso, not at the school centre. The school facilitates transport and a teacher accompaniment; the school does not set the date. …` (verbatim, surface line 762–763).

### C.5 Bottom summary strip (`.sch-summary`, 4 cells)
`5` `Cores · remaining` (navy-2) · `3` `Electives · all upcoming` (green) · `3` `Make-up sittings owed` (gold) · `19` `Jun · last paper` (navy).

### C.6 Data-binding

| Element | Binds to | Verdict |
|---|---|---|
| Date + time | `wassce_papers.scheduled_date` + `scheduled_time` | ✅ BOUND |
| Duration | `wassce_papers.duration_minutes` (→ "1h 30m") | ✅ BOUND |
| Paper name + Type | `wassce_papers.name` + `paper_type` (enum) | ✅ BOUND |
| Sub-line detail (`60 questions`, `answer 10 of 13`, `listening test`) | — | 🚩 **OMIT / static.** `wassce_papers` has **no question-count / format-detail field.** Derive the type word from `paper_type`; **do not fabricate "60 questions".** Either drop the numeric detail sub-line or fold it into `waec_paper_code` if the school stored a code. Flag. |
| Status (`Sat` / `Missed · medical` / `Upcoming · N days`) | `wassce_paper_sittings.sat_at` (Sat) · `exempted_at` (Missed) · else future `scheduled_date` (Upcoming) | ✅ BOUND — the "N days" is a derived `scheduled_date − today`, never stored. |
| Action `SC-12 filed` / `Fit-to-sit assessment` | `waec_special_consideration` link (SC-12 filed) · static for fit-to-sit | ✅ / static |
| Summary counts | derived from sittings + papers | ✅ BOUND |
| Make-up convention copy | `lib/wassce/` static policy constant | static |

> **Three attendance-hook note (repo cross-module commitment):** the `View attendance` action on the SAT row is the sickbay→attendance ("M") / schedule↔attendance hook — it links to the candidate's attendance record for that exam day (`attendance_records`, which IS built). Preserve the link; it is a design commitment, not decoration.

---

# PART D — §4 the FULL 30-cell ledger-trajectory grid (`.lt-frame`) — NEW · THE CENTREPIECE

**Surface lines 977–1174.** *"Ledger trajectory · Mathematics · what the predictor sees that STPSHS does not."* INCR-17 shipped only the compact **projection callout** (`#ledger-trajectory` gold card). INCR-20 mounts the **full grid ABOVE that shipped callout**: a 6-semester × 5-category matrix (30 score cells) with a weighted-total row, a reference-ID row, an STPSHS-state row, and a two-column "What STPSHS sees / What Omnischools sees" foot. This is a **frozen READ of `senior_score_ledger`** — it must **NOT** re-run `compile.ts` / `resolveWeights`; it reads the stored ledger + its frozen weight snapshot.

### D.1 Frame head (`.lt-frame-head`, `border-b`, flex)
- `.lt-frame-eyebrow` `Five-category score ledger · Mr. K. Owusu · Mathematics (Core)` (`10px uppercase tracking-[0.18em] text-gold 700`) — teacher = `senior_subject_teacher` for the class-subject; subject = the selected subject.
- `.lt-frame-title` `The <em>evidence underneath</em> · 30 cells of in-semester assessment, six weighted-total checkpoints, two mock placements, Mock-2 projection B2` (Fraunces 19px 600, gold italic `<em>`) — the `B2` clause is the projected grade for THIS subject (shipped projection, `effectiveGrade` of Mock-2).
- `.lt-frame-meta` (`10.5px mono text-navy-3`, right): `**Asankrangwa SHS · Maths**` / `weights 15/15/40/15/15` / `configured 2023-09-04` / `end-of-sem dominant`. **The `weights 15/15/40/15/15` = the frozen weight snapshot (D.4).** `configured 2023-09-04` → `ref_assessment_weights.updated_at` (or OMIT if not meaningful).

### D.2 The grid (`.lt-grid`, `min-width:780px`, `overflow-x:auto`, `font-mono 12px`)

**Header row (`tr.terms`, `bg-navy text-bg`):** first cell `.lt-cat-head` (`Category · weight`, left, `w-170px`, `bg-navy-2`), then **6 semester columns**:

| Col header | Period sub-line (`.lt-term-period`) | Mock tag | Header bg |
|---|---|---|---|
| F1 S1 | Oct 2023 – Feb 2024 | — | navy |
| F1 S2 | May 2024 – Aug 2024 | — | navy |
| F2 S1 | Oct 2024 – Feb 2025 | — | navy |
| F2 S2 | May 2025 – Aug 2025 | — | navy |
| F3 S1 | Nov 2025 – Feb 2026 | `Mock 1` (`.mock-tag` gold-soft italic) | **`#3D5478`** |
| F3 S2 | Mar 2026 – Jun 2026 | `Mock 2` (`.mock-tag`) | **`#4A6286`** |

**5 category rows** (`td.lt-cat-label` left, `11.5px 600 text-navy` on `bg-bg`, with `.lt-cat-weight` mono sub-line; score cells centred `text-navy-2`; F3 S1 col tinted `.mock-1-col`, F3 S2 col tinted `.mock-2-col`):

| Category (`.lt-cat-label` + weight) | F1S1 | F1S2 | F2S1 | F2S2 | F3S1 | F3S2 |
|---|---|---|---|---|---|---|
| Assignments `15%` | 60 | 64 | 68 | 72 | 78 | 80 |
| Mid-semester exam `15%` | 58 | 62 | 66 | 70 | 76 | 78 |
| End-of-semester exam `40%` | 62 | 66 | 72 | 75 | 80 | 82 |
| Project work `15%` | 65 | 68 | 72 | 76 | 82 | 84 |
| Portfolio `15%` | `—` (`.empty` opacity-45) | 62 | 68 | 72 | 78 | 82 |

**Weighted-total row** (`tr.lt-total-row`, `bg-[rgba(200,151,91,0.05)]`, `border-t-2 border-border-2`): label cell `Weighted total` (`bg-gold-bg`, Fraunces italic 13px 600 gold); values `.lt-total-val` Fraunces 15px 600 gold: **61.5 · 64.8 · 69.9 · 73.5 · 79.1 · 81.4**.

**Reference-ID row** (`tr.lt-ref-row`, `bg-bg`): label `Reference ID` (`10px uppercase text-navy-3`); values `9.5px text-navy-3`: `24-MTH-S1 · 24-MTH-S2 · 25-MTH-S1 · 25-MTH-S2 · 26-MTH-S1 · 26-MTH-S2`.

**STPSHS-state row** (`tr.lt-stpshs-row`, `bg-bg`): label `STPSHS state`; three `colspan=2` cells (per Form-year, `border-right` between):
- F1 (cols 1–2): `.stp-pip-ready` pill `F1 submitted · weighted 66` (`green-bg text-green 9.5px 700`)
- F2 (cols 3–4): `.stp-pip-ready` `F2 submitted · weighted 75`
- F3 (cols 5–6): `.stp-pip-pending` pill `F3 pending · expected 81 · auto-push 14 Jul 2026` (`gold-bg text-gold`)

### D.3 Frame foot (`.lt-frame-foot`, `grid-cols-2`, `border-t`)
Two columns:
- **`.see-side`** (`bg-bg border-r`): `<h5>` `What <em>STPSHS</em> sees`; big `.lt-foot-cell-count` **`3`** (Fraunces italic 32px gold); label `terminal weighted totals · one per year`; `<p>` `**F1 · 66 · F2 · 75 · F3 · 81 (projected).** … STPSHS captures the destination, not the journey.` (verbatim, line 1140).
- **right col:** `<h5>` `What <em>Omnischools</em> sees`; `.lt-foot-cell-count` **`30`**; label `in-semester cells · five categories × six semesters`; `<p>` `**The whole table above.** … The trajectory's *slope* — 61.5 climbing to 81.4 with an acceleration in F3 — is what the predictor reads …` (verbatim, line 1146).

### D.4 THE LEDGER-GRID BINDING (incl. the frozen weight display)

The grid reads `senior_score_ledger` for **one student × one subject × six periods**, ordered by period. Grain is exactly what the ledger stores: `(school_id, student_id, subject_id, period_id)`.

| Grid element | `senior_score_ledger` column | Notes |
|---|---|---|
| 6 columns (F1S1…F3S2) | 6 `academic_period` rows (`period_label` + `academic_year`, ordered `academic_year, period_number`) for the candidate's SHS cycle | Column count is the number of SENIOR periods across F1–F3 (6 semesters). Period sub-line = `starts_on – ends_on` formatted. Mock-1/Mock-2 tags = the two `mock_exams` periods (calibration + predictor) mapped to F3 S1 / F3 S2. |
| 30 score cells | `asgn_score`, `mid_sem_score`, `end_sem_score`, `project_score`, `portfolio_score` (5 rows × 6 period columns) | Each cell = the category column of that period's ledger row. `NULL` → em-dash `.empty opacity-45` (the F1S1 portfolio blank is a real NULL — portfolio is entered at semester end; do not render 0). |
| Category weight labels `15/15/40/15/15` | **frozen `*_weight_used`** (`asgn_weight_used`, `mid_sem_weight_used`, `end_sem_weight_used`, `project_weight_used`, `portfolio_weight_used`) | **The frozen snapshot is REAL and stored** (Q4 accepted — the columns exist on `senior_score_ledger`). Read the weight **from the ledger row**, not `ref_assessment_weights`, so the displayed weight is the weight the total was actually compiled with. **⚠️ Per-period wrinkle:** the frozen weights are per-row (per-period), but the surface shows ONE weight per category in the left label column. If a school re-weighted mid-cycle, the six periods could differ. Display rule: show the frozen weight of the **latest** period (F3 S2), and if any earlier period's frozen weight differs, that period's total already reflects its own frozen weight (correct) — the label is a representative display only. The `.lt-frame-meta` `weights 15/15/40/15/15` line shows the same representative snapshot. |
| Weighted-total row (61.5…81.4) | `weighted_total` per period | Stored, not recomputed — read it as-is (it was compiled with that period's frozen weights). One decimal. |
| Reference-ID row (`24-MTH-S1` …) | — | 🚩 **OMIT / derive-as-display-label.** There is **no per-(period × subject) reference table.** `students.stpshs_ref` is one per-student NULL id. These look like `${yearCode}-${subjectCode}-${semesterCode}` display strings — you MAY synthesize them from period + subject as a **display label** (clearly a local identifier, not an STPSHS ref), or **OMIT the row**. Do not present them as STPSHS-assigned reference IDs. |
| STPSHS-state row (`F1 submitted · weighted 66` …) | `senior_score_ledger.status` (per-period) → LOCAL proxy | 🚩 **OMIT / proxy.** Same as Part B.4: no regulator-submission table. Derive a **local** per-year readiness from the year's ledger `status` (`STPSHS_READY` → "ready locally"; `DRAFT`/`COMPLETE` → "pending") and the year's `weighted_total`. **"submitted [to WAEC]"** overstates what's known — reword to a local-readiness state or OMIT. The `F3 pending · auto-push 14 Jul 2026` date is a static window constant, not stored per-candidate. |
| Foot count `3` | number of Form-years (static per SHS cycle) | derived |
| Foot count `30` | 5 categories × 6 periods (count of non-null-eligible cells) | derived |
| Foot narratives | static `lib/wassce/` copy | static |

> **D.5 — the subject-table join wrinkle (must resolve):** the ledger keys on **gradebook `subjects`** (`senior_score_ledger.subject_id → subjects.id`), while the candidate's WASSCE subjects key on **`wassce_subjects`**. To read Mathematics' ledger for this candidate you must map the selected `wassce_subjects` row to its gradebook `subjects` row (by name/code within the tenant). **Flag Kofi/Wells:** confirm the wassce_subject ↔ gradebook_subject mapping (a shared code, a name match, or a FK). Without it the ledger grid cannot resolve which `subject_id` to read. If a subject has no gradebook-ledger counterpart (e.g. an alternate elective never taught through the ledger), the grid renders an empty/"no ledger" state — do not fabricate cells.

> **D.6 — subject selector:** the surface shows Mathematics as the worked example; the head-action `Switch subject` implies a per-subject selector (the grid is one subject at a time). Build a subject dropdown driven from the candidate's ledger-bound subjects; default to the primary/target-relevant subject. `Export trajectory` / `Open in Path A` head-actions → nav/export (stub or wire).

> **D.7 — scope discipline (Decision B):** this grid is **CONTEXTUAL evidence, not the projection formula.** The prediction is Mock-2-anchored (shipped). The grid must **not** drive a ledger-slope→grade model. It is a frozen read that *shows* the trajectory the shipped callout narrates. The shipped compact callout (`#ledger-trajectory`, subject-generic copy) stays mounted below the grid.

---

# PART E — §7 context strips + parent-comms log + non-SC xmod — NEW

**Surface lines 1514–1706.** The pastoral / financial / parent context around the candidate. **Two of six context cells + the SC xmod card are real; the rest need Sickbay / VLC / general-discipline / transcripts — all unbuilt → OMIT.** The parent-ack block + SC-12 xmod are **SHIPPED** (17 map E.1/D.3).

### E.1 Context strip (`.context-strip`, `grid-cols-3`) — 6 cells
White cells `bg-surface border border-border rounded-lg`; `.cc-label` `10px uppercase text-navy-3`, `.cc-value` Fraunces 16px 500, `.cc-meta` `12px text-navy-3`. Left-accent variants: `.flag` warn, `.linked` gold.

| Cell | Label | Value | Meta | Binds |
|---|---|---|---|---|
| 1 | `Attendance · Semester 2` | `98.4%` | `2 absences before today's hospitalisation. Both routine sickbay visits.` | ✅ **BOUND** — `attendance_records` (per student per day); % over the term. The "routine sickbay visits" clause is Sickbay narrative → **drop that clause**, keep the attendance %. |
| 2 | `Discipline · last 12 mo.` | `No record` | `F3 discipline ladder paused during WASSCE per school policy.` | 🚩 **OMIT / defer.** No general-discipline records table exists in Senior (only `boarding_infractions`, a different concept). Either render `No record` honestly only if you can prove zero across a real table, or **OMIT the cell.** Do not fabricate a "ladder paused" state. |
| 3 (`.linked`) | `Sickbay history · this year` | `3 visits` | `2 routine (headache, common cold) + 1 referral today. [View log →]` | 🚩 **OMIT — Sickbay 4.4 not built.** No visit/referral records exist (`student_health_record` is a static bio record, not a visit log). **Drop the whole cell.** This is the canonical omit-not-fake case. |
| 4 | `Fees · Semester 2` | `Paid in full` | `Free SHS · GHS 0 outstanding. WASSCE exam fees absorbed by GES.` | ✅ **BOUND** — `invoices` + `invoice_line_items` (fees module built). Compute outstanding = billed − paid. "Free SHS · absorbed by GES" is true editorial for a public SHS; keep. Currency `GHS 0.00` per token convention. |
| 5 | `VLC character paragraph` | `Drafted` | `FM Mr Asiedu finalising. Pending parent review at school-leaver.` | 🚩 **OMIT / defer.** VLC (Values/Life/Character) module is a nav item, **not built** — no draft-paragraph table. **OMIT the cell.** |
| 6 (`.linked`) | `NHIS status` | `Active` | `Card 9842-1276-5503 · valid to Mar 2027 · used at admission today.` | 🚩 **OMIT — no NHIS data** (same as Part A). Drop the cell. |

> **Honest render:** the context strip becomes **2 real cells** (Attendance, Fees). Present them cleanly rather than padding to six with fabricated Sickbay/NHIS/VLC/Discipline data. If the design wants a 3-column grid, let it be a short 2-cell row — the omit-not-fake discipline beats a full-looking grid of invented numbers.

### E.2 Parent-comms log preview
**Surface lines 1606–1645.** White card, title `Today's parent communications · A. Aidoo (mother)`, then 6 timestamped rows (`grid-cols-[90px_1fr_auto]`, mono time, message, channel+status badge): `06:52 PHONE·DELIVERED`, `07:14 SMS·DELIVERED`, `11:00 PHONE·DELIVERED`, `11:32 SMS·DELIVERED`, `14:30 PHONE·DELIVERED`, `21:00 SMS·SCHEDULED` (gold).

> **Binding:** channel + delivery status could bind to `notification_log` (SMS delivery log, built). BUT the **message content** ("Admission to Asankrangwa Govt Hospital confirmed", "Clinician confirms responding to IV artesunate", "ward round complete") is **Sickbay / hospital narrative = 4.4, not built.** 🚩 **OMIT the hospital-specific rows.** At most surface the real `notification_log` SMS deliveries for this candidate's guardian (generic), never the ward-round content. If no real comms rows exist, **OMIT the whole preview.** The Tier-3-phone concept is a comms feature that may not be modelled — do not fabricate call logs.

### E.3 Non-SC cross-module cards (`.xmod-grid`, `grid-cols-3`) — 6 cards, 5 NEW
**Surface lines 1650–1687.** `.xmod-eyebrow` (gold uppercase) + `.xmod-title` (Fraunces 15px) + `.xmod-meta` + `.xmod-link` (gold).

| Card | Title | Meta | Verdict |
|---|---|---|---|
| Sickbay | `Referral · severe malaria` | `Mrs G. Bediako (matron) · admission 06:45 · Ward B bed 7 · IV artesunate started 07:20.` | 🚩 **OMIT — Sickbay 4.4.** Ward/bed/clinician/matron/drug all unbuilt (the 19b hospital-bed case). Drop the card. |
| WAEC | `SC-12 special consideration` | `Form filed 11:00 … ref SC-12-184-2026-0044.` | ✅ **SHIPPED** (17 map D.3) — `waec_special_consideration`. Do not re-build. |
| Billing | `NHIS itemised reconciliation` | `IV artesunate covered · ward bed covered · meals not covered (GHS 24 line).` | 🚩 **OMIT — NHIS itemisation is Sickbay/health-billing 4.4.** No line-item source. Drop. |
| Boarding | `Slessor House · prep absence` | `HM Mr E. Boateng excused all evening prep and Saturday inspection until further notice.` | ⚠️ **DEFER.** Boarding IS built (`prep_attendance`, `inspections`), but this is a cross-module 4.2 read outside 4.3 scope. Render as a **static/inert link** to boarding, or OMIT; do not fabricate the excusal text. |
| VLC | `Character paragraph` | `Drafted from 22 reflections + 3 FM notes + 8 PG observations …` | 🚩 **OMIT — VLC not built.** |
| Transcripts | `Pre-WASSCE transcript` | `Final 3-year academic record · already drafted …` | 🚩 **OMIT / defer — transcripts not built** as a Senior surface. Drop or inert link. |

> **Honest render:** the only real non-SC xmod is **none in 4.3** (SC-12 is already shipped; Boarding/Transcripts are inert cross-links at best). The xmod grid collapses to the shipped SC-12 card plus, optionally, inert boarding/transcript links. Everything sickbay/NHIS/VLC = OMIT.

---

# PART F — Data-binding & OMIT summary (the omit-not-fake ledger)

**BOUND — build these against existing tables:**

| Panel / element | Table(s) | Increment origin |
|---|---|---|
| §1 identity card (name, index, House, DOB, parent, Science pill, target) | `students`, `wassce_candidates`, `house`, `wassce_programmes`, `university_targets` (17b) | F0 / 15 / 17b |
| §1 STPSHS panel — **subject rows + per-year ledger-derived scores + SC-12-blocked cell** | `wassce_candidate_subject`/`wassce_subjects`, `senior_score_ledger.weighted_total`, `waec_special_consideration` | 15 / 4.1 / 17 |
| §2 full schedule (dates, durations, types, status, counts, actions) | `wassce_papers`, `wassce_paper_sittings`, `waec_special_consideration` | 15 / 17 |
| §4 **30-cell grid + weighted totals + frozen weights** | `senior_score_ledger` (5 cats + `weighted_total` + `*_weight_used` + `status`), `academic_period` | 4.1 |
| §7 context — Attendance cell | `attendance_records` | Basic/attendance |
| §7 context — Fees cell | `invoices`, `invoice_line_items` | fees |

**🚩 OMIT — needs Sickbay (4.4) or another unbuilt module; do NOT placeholder, do NOT fabricate (the 19b/17 precedent):**

| Element | Missing data / module |
|---|---|
| §1 card **NHIS card number + expiry** (`9842-1276-5503`, `active to Mar 2027`) | No NHIS field anywhere (`student_health_record` has no NHIS) — Sickbay/health-registry 4.4 |
| §1 STPSHS panel **per-year Reference IDs** (`REF-2024-0817-ENG`) | No per-(year×student×subject) STPSHS ref table; `students.stpshs_ref` is ONE NULL per-student id → render "pending" or drop |
| §1 STPSHS panel **regulator submission state** (`submitted / blocked / awaiting sync`) | No STPSHS submission-state table; only local ledger `status` exists (proxy, reworded — not "submitted to WAEC") |
| §1 STPSHS panel **`Last sync` timestamp + `21 of 24` tally** | No STPSHS sync log; tally is derived from unbound state → drop or recompute from local truth |
| §2 schedule **sub-line detail** (`60 questions`, `answer 10 of 13`, `listening test`) | No question-count/format field on `wassce_papers` → static from `paper_type` or drop |
| §4 grid **Reference-ID row** (`24-MTH-S1`) | No per-period ref table → display-label synth or OMIT |
| §4 grid **STPSHS-state row** (`F1 submitted · weighted 66`) | No submission table → local ledger-status proxy or OMIT |
| §7 **Discipline cell** (`No record`, `ladder paused`) | No general-discipline records table in Senior |
| §7 **Sickbay-history cell** (`3 visits`, referral log) | Sickbay 4.4 — no visit/referral log |
| §7 **NHIS-status cell** (`Active`, card, expiry) | No NHIS data |
| §7 **VLC character-paragraph cell** (`Drafted`) | VLC module not built |
| §7 **parent-comms log** hospital/ward-round rows | Sickbay + Tier-3 comms narrative not built (generic `notification_log` deliveries only, if any) |
| §7 xmod **Sickbay referral card** (ward/bed/clinician/matron/drug) | Sickbay 4.4 — the canonical hardcoded-bed case |
| §7 xmod **Billing NHIS-itemised card** | NHIS itemisation = Sickbay/health-billing 4.4 |
| §7 xmod **VLC / Transcripts cards** | VLC + transcripts not built |

**⚠️ No clean binding — flag to Kofi/Wells before building:**
- **wassce_subject ↔ gradebook subject mapping** (D.5) — the ledger grid can't resolve `subject_id` without it.
- **Form Master source** (Part A) — no `form_master` column; derive or em-dash.
- **Per-semester → per-year terminal** aggregation for the STPSHS panel scores (B.4) — define the year-figure rule (S2 weighted_total vs year-end computation).
- **Frozen weights differing across periods** (D.4) — the single-column weight label is representative; each period's total already uses its own frozen snapshot.
- **`ref_assessment_weights.updated_at`** vs the surface's `configured 2023-09-04` — OMIT if not meaningful.

---

# PART G — States, responsive, PWA, route

**Interaction states per NEW panel:**

| Panel | empty | loading | populated | special |
|---|---|---|---|---|
| §1 identity card | candidate-not-found dashed card (shipped page already handles null) | server-render (force-dynamic) | full card | House/Form-master missing → em-dash, never a fake name |
| §1 STPSHS panel | no ledger for cycle → "no submission data yet" | — | subject rows + ledger scores | ref col "pending"; state col local proxy; blocked cell only when open SC-12 exists |
| §2 schedule | no papers for cohort → empty state | — | 9 rows + summaries | missed rows require an `exempted_at` sitting; upcoming = future `scheduled_date` |
| §4 ledger grid | subject has no ledger → "no ledger for this subject" (never fabricate cells) | — | 30 cells + totals | NULL cell → `—` `opacity-45`; ref/state rows omit-or-proxy; horizontal scroll on narrow |
| §7 context | Attendance/Fees only; others OMITted | — | 2 real cells | do not pad to 6 |

**Responsive** (surface `@media` collapses ≈1280px, per house rule): `.stpshs-table` + `.lt-grid` keep `overflow-x:auto` with a **sticky-left category/subject column** (reuse `ColumnScoreGrid` sticky/overflow mechanics — `docs/senior/ledger-surface-map.md` §1). `.sch-summary` 4-col → 2-col; `.schedule-table` grid rows reflow (min-width + scroll); `.context-strip` 3-col → 1-col; `.xmod-grid` 3-col → 1-col; `.lt-frame-foot` 2-col → 1-col.

**PWA:** no dedicated `-pwa.html` variant for the deep-dive. The ledger grid reuses the desktop `overflow-x:auto` + sticky-left pattern at phone width. No new offline surface.

**Route (reaffirmed):** `app/(app)/senior/wassce/candidates/[index]/page.tsx` — one candidate page with anchored regions (`#schedule`, `#ledger-trajectory`, `#context`). STAFF-only (`WASSCE_SETUP_ROLES`), tenant-scoped RLS, index-number keyed. NOT parent-reachable. The loader `lib/wassce/readiness-data.ts::loadCandidateReadiness` is extended (or a sibling `loadCandidateDeepDive` added) to fetch: the ledger rows (per subject × 6 periods incl. frozen weights + status), the paper sittings + papers, attendance aggregate, fees aggregate, health record presence, House + DOB — all inside `withSchool(...)`, server-only, returning **pre-formatted primitives** to the client (repo memory `reports-data-is-server-only`).

---

## SUMMARY FOR THE IMPLEMENTER (Claude Code)

**The exact NEW panels INCR-20 must build (vs the SHIPPED 17/17b sections):**
1. **§1 full `.student-card`** — avatar + name + two meta rows (index, House, Form Master, DOB, parent, target). *(The projected-aggregate right column is SHIPPED — slot the new columns to its left.)*
2. **§1 STPSHS submission status panel** — chrome + 8 subject rows + per-year ledger-derived scores + SC-12-blocked cell. *(Ref column, submission-state column, sync timestamp, and "21 of 24" tally are unbound — pending/proxy/drop.)*
3. **§2 full exam-schedule detail** — summary strips + 9-row paper table + make-up-convention note. *(Nothing of §2 was shipped.)*
4. **§4 the full 30-cell ledger-trajectory grid** — 6 semesters × 5 categories + weighted-total row + foot columns, mounted ABOVE the SHIPPED compact projection callout.
5. **§7 context strip** (Attendance + Fees only), **parent-comms preview** (generic deliveries only, if any), **non-SC xmod** (SC-12 card is SHIPPED; the rest OMIT/inert).

**The ledger-grid binding (how the 6×5 grid reads `senior_score_ledger`):** read one `senior_score_ledger` row per **(student × subject × period)** for the candidate's **6 SENIOR `academic_period` rows** (F1S1…F3S2, ordered `academic_year, period_number`). The **5 category rows** = `asgn_score / mid_sem_score / end_sem_score / project_score / portfolio_score`; the **weighted-total row** = the stored `weighted_total` (read as-is, never recompiled); the **category weight labels (15/15/40/15/15)** = the **frozen `*_weight_used` snapshot on the ledger row** (Q4 columns exist — read from the ledger, NOT `ref_assessment_weights`, so the shown weight is the weight the total was compiled with; display the latest period's snapshot as the representative label). NULL score → em-dash `opacity-45`. **Must NOT re-run `compile.ts`/`resolveWeights`.** Resolve the subject via the **wassce_subject ↔ gradebook `subjects` mapping** (D.5 — flag, no FK today).

**Every element needing Sickbay / unbuilt-module data → OMIT (not placeholder):** NHIS card number + expiry (§1 card, §7 NHIS cell, §7 billing-NHIS xmod); Sickbay-history cell + Sickbay-referral xmod (ward/bed/clinician/matron/drug — the 19b hardcoded-bed case); STPSHS per-year Reference IDs + regulator submission state + sync timestamp + "21 of 24" tally (§1 panel, §4 ref/state rows — no submission table); Discipline cell (no Senior discipline table); VLC character-paragraph cell + VLC xmod; Transcripts xmod; the hospital/ward-round rows of the parent-comms log. **Drop them; do not fabricate. An honest 2-cell context strip beats a full grid of invented numbers.**

**Elements with no clean table binding (flag Kofi/Wells):** wassce_subject ↔ gradebook-subject mapping (blocks the ledger grid); Form-master source; per-semester→per-year terminal aggregation for the STPSHS scores; schedule sub-line detail (`60 questions`) has no field; frozen-weights-differ-across-periods display rule; `configured 2023-09-04` date source.

**Surface confirmation:** this is a **STAFF** surface — the existing role-gated `/senior/wassce/candidates/[index]` route (`WASSCE_SETUP_ROLES`, tenant RLS, index-keyed). It is **NOT parent-reachable**; the parent equivalent is `wassce-parent-tracker` (INCR-19). No new route, no new migration for the bound parts — INCR-20 is a read-and-render capstone over tables that already ship.

---

*Map produced against: `Surfaces/schoolup-wassce-student-readiness.html` §1 (identity card 455–477, STPSHS panel 506–595), §2 (schedule 616–790), §4 (30-cell grid 1024–1148; callout 1150–1153 = SHIPPED), §7 (context strip 1560–1591, comms log 1606–1645, xmod 1650–1687); shipped `app/(app)/senior/wassce/candidates/[index]/page.tsx` + `lib/wassce/readiness-data.ts` (INCR-17/17b); `db/schema/score-ledger.ts` (`senior_score_ledger` incl. frozen `*_weight_used`), `students.ts` (`student_health_record`, `stpshs_ref`), `wassce.ts` (`wassce_papers`/`wassce_paper_sittings`), `attendance.ts`, `fees.ts`, `periods.ts`; `docs/senior/wassce-readiness-surface-map.md` (INCR-17), `docs/senior/ledger-surface-map.md`, `docs/senior/incr3-stpshs-ref-schema.md`, `docs/senior/f0-ledger-schema.md`; `md files/design-tokens.json` v1.0.0. No-alpha discipline per repo memory `no-alpha-token-opacity`; omit-not-fake per the 19b/17 precedent.*
