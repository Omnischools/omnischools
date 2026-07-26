# Parent Sickbay Tab — Surface Map (INCR-19c · Module 4.4 × parent portal · D8 reversal)

**Author:** Lucy (design cartographer) · **Status:** design spec, ready for Kofi's field-allow-list ruling → Wells (`parent_scope` RLS) → Claude Code.
**Increment:** reverses **D8** for ONE tab only — a parent may now see a **NARROW, condition-free** view of *their own child's* sickbay status. Everything clinical stays parent-denied.
**Scope of THIS map:** the **`Sickbay` tab** of the parent portal (`app/(parent)/…`, the inert tab at `app/(parent)/wassce/page.tsx:130`). Nothing else on the portal changes.

> **Read this first — the load-bearing frame.**
> 1. The source surface (`Surfaces/schoolup-wassce-parent-tracker.html`) **draws the full clinical case** — ward, bed, hospital name, diagnosis, treatment, clinician, NHIS number, the whole call-log. **INCR-19b OMITTED all of it** ("Sickbay hero/Hospital/NHIS cards omitted — module 4.4 unbuilt", build-plan §19b). This map does **not** un-omit that. It maps the **thin allow-listed subset** that survives the deny-list, and inventories — element by element, with its surface line — **exactly what must stay omitted**.
> 2. **The forbidden inventory (Part 3) is the load-bearing output.** A single clinical element sneaking into the parent view is the exact leak this increment exists to prevent. Kofi rules the canonical field allow-list in parallel; **I inventory what the surface *would* leak** so his list has a target.
> 3. **The governing rule is D4/R50: location-not-condition.** A parent already sees `M · Medical` on the attendance surface — a *location* fact ("in care"), never a *condition*. This tab is the same doctrine, slightly fuller: the **fact of care**, never the clinical content of it. The staff precedent is verbatim in the source — the housemaster row reads **`student in sickbay (medical detail withheld)`** (`schoolup-sickbay-today.html:357`). That parenthetical is the whole design.

## Source surfaces (visual source of truth)

| Surface file | Reason in scope |
|---|---|
| `Surfaces/schoolup-wassce-parent-tracker.html` | **PRIMARY.** The only surface that draws sickbay content *inside the parent frame*. Everything I classify below is drawn here: hero cells (`:260–291`), child-card NHIS (`:303`), comms/call-log thread (§4, `:670–748`), Hospital-details card (`:826–840`), NHIS-coverage card (`:842–856`). This is what a parent view **would** show — I allow-list a sliver and forbid the rest. |
| `Surfaces/schoolup-sickbay-today.html` | **Vocabulary + doctrine source.** Disposition pills `Admitted` / `Referred` / `Discharged` (`:542/:554/:524`); the "referred out · students currently at hospital" framing (`:505/:578`); and the **`medical detail withheld`** precedent (`:357`) — the exact allowed-vs-forbidden split, staff-authored. |

**Tokens:** `styles/tokens.css` (verified). All values below name the CSS var: `--navy #1a2b47`, `--navy-2 #2d3f5c`, `--navy-3 #5c6675`, `--gold #c8975b`, `--gold-soft #e8d4b8`, `--gold-bg #f5ebdc`, `--bg #faf7f2`, `--surface #fff`, `--green #2f6b47`, `--green-bg #e5efe8`, `--terra #b84a39`, `--terra-bg #f5e1dc`, `--warn #c58a2e`, `--warn-bg #f5e9d0`, `--border-1 (--border) #e5dfd3`, `--border-2 #d4ccba`.
**Type:** `font-display` = Fraunces (headline, status glyph); `font-body` = Manrope (all body/labels/pills); `font-mono` = JetBrains Mono (**dates only** — never the NHIS/index number on the parent side, per the parent-tracker convention, §O.3 of `wassce-parent-surface-map.md`).

## Constraints this map obeys (build-plan)

| Ref | Rule | Effect on this tab |
|---|---|---|
| **D8** (being reversed here) | Every sickbay table is `parent_deny` by default. | Reversed **for one allow-listed read only.** Wells adds a narrow `parent_scope` over the guardian→student link; **no table loses `parent_deny` wholesale** — the allow-list is column/value-level, enforced above RLS in the loader. |
| **D1** | Store `working_impression`, **never** `diagnosis`; preserve that vocabulary verbatim. | `working_impression` is **🔴 forbidden** to the parent regardless of how it's phrased. The surface's prose `severe malaria` is a `working_impression`-class value → deny. |
| **D4 / R50** | Sickbay writes attendance `MEDICAL`; "Medical" = **location, not condition**. A teacher save can't downgrade it. | The parent already sees `M` on attendance. This tab is the sibling: it may name the **location-category of care**, never the condition. Status and attendance-`M` **must agree** (same episode). |
| **19b omit-not-fake** | A field with no honest parent-safe binding is **omitted, never faked**. | The empty state (Part 4) shows an honest "no current sickbay care" — never a fabricated hero. A forbidden field is omitted, never masked with `—` (an em-dash next to "Treatment" reads as *no treatment*). |

---

# Part 1 — The Sickbay tab: chrome, activation, and the ONE allowed section

The parent portal is **six flat tabs** (`WASSCE · Sickbay · Communications · Billing · Boarding · School calendar`, `app/(parent)/wassce/page.tsx:130`). Flat nav is correct (six < twelve). This increment lights up tab #2 only.

## 1.1 Tab-activation copy & chrome

| Element | Copy / behaviour | Token / type | Notes |
|---|---|---|---|
| Nav tab label | **`Sickbay`** (verbatim — "Student support" is the app-nav word elsewhere; this parent tab keeps the drawn label `Sickbay`) | `.pn-item` 13px/500 `--navy-3`; active = 14px pad, 600, `--navy`, `border-bottom:2px solid --gold` | mirror the built `ParentNav` (page.tsx:132–147); flip `Sickbay` from inert to a real route |
| Unread `.dot` | 6px circle `--terra`, `margin-left:6px` | attention marker | **NOW bindable** (was omit-or-fake in 19b): render the dot iff this child has an **open sickbay episode** (in-sickbay OR referred-out, not yet discharged). No open episode → **no dot** (never a permanent dot). |
| Header | unchanged — `{School} · Parent portal · {child}` / guardian initial-surname + relation | as built (`ParentHeader`) | one child, resolved from session (never a URL param) |

**Activation states of the tab body (the multi-state this surface defines):**

| Episode state | Body renders | Source binding |
|---|---|---|
| **In the school sickbay** (admitted to *school* sickbay, not discharged) | the **Care-status card** (Part 2), status = *in the school sickbay* | sickbay visit/admission with disposition `ADMIT`, `discharged_at IS NULL` |
| **Referred for further care** (referred out, not yet returned/closed) | Care-status card, status = *referred for further care* | `sickbay_referral` open (returned/closed → back to empty) |
| **No current care** (the common case) | the **empty state** (Part 4) — honest "no current sickbay care" | no open episode for this child |
| **Loading** | one skeleton card holding the layout — never a spinner over blank | — |
| **Error** | one calm line + the school's phone; **never** a table name, id, or stack | copy: *"We can't load the sickbay status right now. Please call the school office."* (author; reuse the portal error convention) |

> Discharged/closed episodes **drop straight to the empty state** — the parent portal shows *current* care only (past visits are staff-side; a discharge history to the parent is a separate, later decision). This matches D4's "location, not a clinical record."

---

# Part 2 — The ALLOWED subset (the narrow view to build)

**This is the entire buildable parent Sickbay body: one card, condition-free.** It re-expresses the surface's clinical hero as the *fact of care* only. Everything here is the guardian's own child's location/status — legitimate for this reader under D4/R50.

**Card shell:** `--surface`, `rounded-xl`, `border --border`, `padding 22px 26px` (reuse `.child-card`/`.info-card` shell already in the portal). **No terra "Active case" alarm hero** — that gradient is the WASSCE-tab disruption twin; the sickbay fact is calm, not an emergency banner. Status colour is **navy/gold**, not terra.

| # | Element | Exact / template copy | Token · type | Binding (allowed) |
|---|---|---|---|---|
| **A1** | Tab + unread dot | `Sickbay` + `.dot` | see 1.1 | open-episode predicate |
| **A2** | Status glyph + headline (the FACT) | in-sickbay: `{First} is in the school sickbay under the matron's care.` · referred: `{First} has been referred for further care.` | Fraunces 20px/500 `--navy`; `<em>` phrase italic `--gold` | disposition **category only** (`ADMIT` → "in the school sickbay"; `REFER` → "referred for further care"). **No ward, no bed, no hospital name, no condition.** |
| **A3** | Care-start date | in-sickbay: `In the sickbay since {longDate}.` · referred: `Referred on {longDate}.` | 13px `--navy-2`; date in mono | `admitted_at` / `referred_at`, **date-granularity** (day, not the `06:45` timestamp — a timestamp is proximity-precise and unnecessary) |
| **A4** | Expected return *(if shown)* | `Expected back in class: {date}.` | 13px `--navy-2` | **The surface shows NONE for sickbay** (the WASSCE hero's "fit-to-sit pending" is WASSCE-tab, not this). **Omit A4 in v1**; render only if a future sickbay `expected_return_date` field exists. Never infer/fabricate a return date. |
| **A5** | Contact the matron | `Call the Matron` (button) | reuse `.sh-btn` style, but **navy/gold not terra**: `bg-navy text-bg` 12px/700 | **`tel:` link** to the `MATRON` role phone. Name allowed (`Call Matron Bediako` as drawn) — a role contact, not clinical. **No hospital-info button, no clinician-contact button** (those are 🔴, Part 3). |
| **A6** | Reassurance line | `The school is caring for {First}. The matron will call you with any update.` | 12px `--navy-3` | authored (Kofi to confirm copy); the tone contract from the portal notes — *"everything heavy is done by school… you will be informed."* End on reassurance, not action. |
| **A7** | Attendance cross-note | `Marked M (Medical) on today's attendance.` *(optional, low-priority)* | 11px `--navy-3`; `M` glyph = navy-2 tint (repo memory `attendance-five-statuses`) | the child's own `attendance_record` status `MEDICAL` for the day — the parent **already sees this** on the attendance tab; this only restates the same location-fact. Consistency, D4. |

**Nothing else renders in the allowed body.** No vitals, no drug, no treatment note, no ward, no bed, no hospital name, no clinician, no NHIS, no call-log — all Part 3.

> **Why "referred for further care" and not the hospital name:** D4/R50 caps the parent at the *location-category* of care. "Referred out" is a category (like `M`); "Asankrangwa Govt Hospital, Ward B bed 7" is a locatable, clinical-adjacent fact. The category is the allow-listed value; the specifics are the deny-list.

---

# Part 3 — 🔴 The FORBIDDEN inventory (the deny-list · DO-NOT-BUILD)

**Every element the source renders inside the parent frame that a parent must NEVER see.** Each is flagged with its surface line. Kofi rules the canonical field-level allow-list; this is the surface-side target he rules against. **Classification: 🔴 FORBIDDEN = clinical / financial-identity / narrative-leak — omit even though the surface draws it.**

| # | Forbidden element | Verbatim value on the surface | Surface line | Deny-class |
|---|---|---|---|---|
| **A8** | Hero cell "location" — **ward + bed** | `Ward B · bed 7` (label `Yaa's location`) | `parent-tracker:271–272` | ward/bed (locatable clinical) |
| **A9** | **Hospital NAME** | `Asankrangwa Govt Hospital` | `:273, :832` | facility name |
| **A10** | Hero cell "Treatment" — **drug/treatment** | `Responding well` / `IV artesunate` | `:277–278` | treatment + clinical progress |
| **A11** | **Vitals / ward-round** | `14:30 ward round`; (call-log) `no fever for the past four hours` | `:278, :731` | vitals |
| **A12** | Hero headline — ward/bed beside name | `Yaa is at <em>Ward B bed 7</em>.` | `:265` | ward/bed + **PII-adjacency (A20)** |
| **A13** | Hero body — **diagnosis / `working_impression`** | prose incl. `severe malaria` (D1: this is a `working_impression`-class value, never shown) | `:266–267, :683` | condition / `working_impression` |
| **A14** | **Clinician name** | `Dr E. Nyarko` | `:835` | clinician identity |
| **A15** | "Hospital ward info" action | `Hospital ward info` button | `:289` | routes to clinical/facility detail |
| **A16** | Child-card **NHIS number** | `NHIS 9842-1276-5503 (active)` (beside name + DOB) | `:303` | NHIS card/number + **PII-adjacency (A22)** |
| **A17** | **Comms / call-log thread (ENTIRE §4)** | 6 rows: admission narrative, `severe malaria`, `NHIS card in use`, ward/bed, `IV artesunate`, ward-round vitals, clinician "unfit to sit" | `:670–748` | the single largest leak — diagnosis + NHIS + ward + treatment + clinician, all in one thread |
| **A18** | **Hospital-details card (ENTIRE)** | rows: Hospital / Ward / Admitted / Clinician / Treatment / Ward round + `Hospital map & directions →` | `:826–840` | facility + ward/bed + clinician + treatment |
| **A19** | **NHIS-coverage card (ENTIRE)** | Card number `9842-1276-5503`, Status, and the **coverage itemisation** (`Bed Covered`, `IV medication Covered`, `Diagnostic tests Covered`, `Meals Not covered · GHS 24/day`) | `:842–856` | NHIS number **+ the itemisation is a treatment leak** — "IV medication covered" reveals the drug; deny the whole card |

**Three deny-class notes for Kofi/Wells:**
- **A17 is the priority target.** A future parent-readable comms channel (the `Communications` tab) must run through the **same allow-list** — a call-log that quotes the matron re-introduces every forbidden field. The comms tab is *not* this increment; note the hook (Part 6).
- **A19's itemisation is a treatment leak, not just a finance leak.** "IV medication covered" names the drug. Even a clinical-free finance view (staff `getNhisReconciliation`, R217/R223 — *no condition* by design) is **not** parent-safe here, because on the parent side the OOP line sits beside the child's name (A22). Deny the whole NHIS card to the parent.
- **`working_impression` (A13) is denied by field, not by phrasing.** Whether the value is `severe malaria`, `SCD crisis`, or a mental-health impression (R116 keeps `MENTAL_HEALTH` out of even the *headmaster* default read), the parent sees the **fact of care only**. Never the field.

---

# Part 4 — The empty state (child NOT in sickbay · omit-not-fake)

**The common case, and the surface never draws it** (the mock is a live case). Build it per the 19b omit-not-fake precedent.

| Element | Copy | Token · type |
|---|---|---|
| Card | honest, calm — **no hero, no red, no fabricated fields** | `--surface` `rounded-xl` `border --border` `padding 24px`, centered |
| Line 1 | `{First} has no current sickbay care.` | Fraunces 16px/500 `--navy` |
| Line 2 | `If {First} visits the sickbay, you'll see the status here and the matron will be in touch.` | 13px `--navy-2` |

**Hard rule:** an empty sickbay state is a **known-zero** (no open episode), which is honest to render — unlike a *false zero* against an unbuilt entity. Never draw a greyed hero, never `—` against clinical labels, never "0 visits" implying a visit count the parent isn't entitled to. The empty state asserts only the location-fact "not in care."

---

# Part 5 — 🔴 PII-by-proximity (continues the A-numbering)

**The whole point of the deny-list: a clinical value *beside the child's name* is the leak.** These are the adjacencies the source creates and the parent view must never reproduce. Each is a *placement* rule, not a new field — the fields are already forbidden (A8–A19); these name **where** the surface puts a condition next to the identified child, so the loader/RLS can be checked against them.

| # | Adjacency on the surface | Where | Rule |
|---|---|---|---|
| **A20** | **Condition/location beside name** — `Yaa is at Ward B bed 7` | hero headline `:265` | the parent headline (A2) names the child + **care-category only** (`in the school sickbay` / `referred for further care`) — never a ward/bed/condition in the same sentence as the name. |
| **A21** | **Diagnosis beside name** — `Yaa admitted … with severe malaria` | call-log `:683` | the whole thread is denied (A17); the adjacency is *why* — the child's name + a `working_impression` in one line. |
| **A22** | **NHIS number beside name + DOB** — `Yaa Aidoo … Born 12 August 2008 · NHIS 9842-1276-5503` | child card `:296–303` | the parent child-card (already built for WASSCE) must **not** carry the NHIS line. It is identity-grade PII whose only use here is clinical/financial. Strip A16 from the card; keep name/form/house/index. |
| **A23** | **`working_impression` beside name** (if the staff sickbay hero is ever ported) | staff `sickbay-today:290–293` (`Adwoa Mensa · admitted bed 3 … Sickle cell SS`) | the staff admitted-patient block names child + chronic condition + bed. **Do not port it to the parent.** The parent equivalent is A2 (fact only). |
| **A24** | **Ward/bed beside name** — locatable third-party-style exposure | hero `:265`, hospital card `:833` | even the guardian's *own* child: a precise ward+bed in a portal that can be screenshotted/logged is unnecessary proximity. The parent needs "in care," not a room number. |

> **The test Wells/Kofi can hand a reviewer:** grep the served parent-Sickbay HTML for every forbidden token — a ward id, a bed number, a hospital name, a drug name, a clinician name, an NHIS digit-string, any `working_impression` value. **Zero hits.** (Same tripwire discipline as R227/28b: *zero clinical tokens in served HTML*.)

---

# Part 6 — Fabricated demo items, cross-module hooks, responsive/PWA

## 6.1 Fabricated demo content (flag — none of this binds; it is the mock's narrative)

The entire Yaa-Aidoo hospital scenario is demo. Specifically **fabricated / no honest binding**: `Asankrangwa Govt Hospital`, `Ward B · bed 7`, `Dr E. Nyarko`, `IV artesunate`, `severe malaria`, `NHIS 9842-1276-5503`, `Mrs G. Bediako` (as a hard-coded name), and **every call-log row** (`:670–748` — phone-call direction/duration/"you were at bedside" have no table; this was flagged unbuildable in the 19b comms gap, `wassce-parent-surface-map.md` K.1). Build the **allowed** fields from real sickbay tables; render **nothing** where the mock's value is demo narrative — omit, don't placeholder.

## 6.2 Cross-module hooks (design commitments — preserve)

| Hook | On this tab | Status |
|---|---|---|
| **Sickbay → attendance (`M`)** | A7 restates the day's `MEDICAL` mark | ✅ live (D4 shipped in 22b): sickbay writes `MEDICAL`, a teacher can't downgrade. The parent's sickbay status and attendance `M` **must describe the same episode** — one source, no drift. |
| **Sickbay → SC-12 (WASSCE tab)** | *not on this tab* | The WASSCE tab already stays clinical-stripped (28b R227 — SC-12 banner carries name/index/status/ref/dates, **never** hospital/diagnosis/clinician). A referred-out WASSCE candidate shows "referred for further care" here and a clinical-free SC-12 banner there — **two calm, condition-free views, never joined into a clinical one.** |
| **Sickbay → comms/`Communications` tab** | A17 (denied here) | The future parent comms tab must reuse **this same allow-list** or it re-leaks everything A17 contains. Design commitment, unbuilt. |
| **Sickbay `parent_deny` catalog** | tab body | Wells adds a **narrow `parent_scope`** over the guardian→student link for the allow-listed read only; the sickbay tables keep `parent_deny` as the default (D8) — the allow-list is enforced in the loader (column/value projection), not by opening a table. |

## 6.3 Responsive / PWA

Phone-first (the portal is phone-leaning; the desktop frame is presentation only). One narrow card, already single-column — **no responsive work beyond the portal's `max-w-[980px]` centered body.** No `-pwa.html` variant; the tab is a live read, no offline surface, no PDF. The `Call the Matron` `tel:` link is the mobile-native affordance.

---

# Part 7 — Open questions (Kofi / Wells / owner)

1. **🔴 The field allow-list (Kofi, in parallel).** This map inventories the surface leak (A8–A19) and the adjacencies (A20–A24); Kofi rules the canonical column/value allow-list. **Recommended allowed set:** disposition **category** (in-sickbay / referred), care-**start date** (day granularity), matron **role contact**. Everything else denied.
2. **Care-start granularity (A3).** Day vs timestamp — recommend **day** (`06:45` is proximity-precise, unneeded). Confirm.
3. **Attendance cross-note (A7).** Include or omit? Low value if the parent already reads the attendance tab; recommend **omit in v1** to keep the card minimal — the fact lives on attendance already.
4. **Discharge history.** Recommend **current-care-only** (discharged → empty state). A parent-facing visit history is a separate, later decision.
5. **`parent_scope` shape (Wells).** Same guardian→student link the 19b/19a per-user boundary uses (`wassce-parent-surface-map.md` L.1: phone-match today, `student_guardian.user_id` the right column). This tab **inherits** that boundary — no new link mechanism, just the narrow allow-listed read over it.
6. **Copy sign-off (A2/A6/empty state).** The re-expressed status strings and reassurance line are authored to the portal tone contract; Kofi to confirm before build.

---

*Map produced against: `Surfaces/schoolup-wassce-parent-tracker.html` (sickbay content: hero `:260–291`, child-card NHIS `:303`, comms/call-log §4 `:670–748`, Hospital card `:826–840`, NHIS card `:842–856`); `Surfaces/schoolup-sickbay-today.html` (disposition vocabulary `:524/:542/:554`, the `medical detail withheld` precedent `:357`, referred-out framing `:505/:578`); `styles/tokens.css` (verified var names); `app/(parent)/wassce/page.tsx:130` (the inert tab bar). Constraints: `docs/senior-build-plan.md` D8 (reversal), D1 (`working_impression`≠`diagnosis`), D4/R50 (location-not-condition), the INCR-19b omit-not-fake precedent. Prior parent map reused, not re-derived: `docs/senior/wassce-parent-surface-map.md` (Parts H/K.1/K.2/L.1–L.3/M — hard boundary, comms gap, clinical no-binding, parent→child link, PII). **Kofi's field-level allow-list is authored in parallel and governs; this map is the surface-side inventory it rules against.***
