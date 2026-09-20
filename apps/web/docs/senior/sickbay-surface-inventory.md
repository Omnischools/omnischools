# Module 4.4 — Sickbay · Module Surface Inventory

**Author:** Lucy (design cartographer) · **Status:** planning-stage inventory. This is the breadth pass that
precedes the per-increment 1:1 surface maps. It is **not** a build spec — no pixel-level token tables here.
**Scope:** all five sickbay surfaces, every data element classified BACKED / NEEDS SCHEMA / NO CLEAN BINDING,
every write action, every cross-module hook, the full NHIS catalogue, the medical-PII inventory, and a
recommended increment grouping.

---

## 0. Board discrepancy — the module has FIVE surfaces, not four

`docs/senior-build-plan.md` line 14 records:

```
5. **4.4 Sickbay** (4) — sickbay→attendance "M" hook. _size: M_
```

There are **five** surfaces on disk, and each one self-labels its position in the batch:

| # | File | Self-label in the mvp-tag |
|---|---|---|
| 1 | `Surfaces/schoolup-sickbay-setup.html` | `SHS · Boarding · Sickbay batch` (no ordinal — it is surface 1 by nav order) |
| 2 | `Surfaces/schoolup-sickbay-today.html` | `MVP2 · Sickbay · Boarding · Surface 2 of 5` |
| 3 | `Surfaces/schoolup-sickbay-visit-record.html` | `MVP2 · Sickbay · surface 3 of 5` |
| 4 | `Surfaces/schoolup-sickbay-chronic-register.html` | `MVP2 · Sickbay · surface 4 of 5` |
| 5 | `Surfaces/schoolup-sickbay-referral-log.html` | `MVP2 · Sickbay · surface 5 of 5` |

**Action for the board:** change `(4)` to `(5)` and list the five filenames. The missed surface is almost
certainly `schoolup-sickbay-setup.html` — it is the only one without an "N of 5" ordinal in its tag, and it is
also the **configuration spine every other surface reads from**. Undercounting it means the phase estimate is
missing the whole config table set.

**Second board correction:** line 1448 currently records the BINDING sickbay override for the *boarding*
dashboard card ("module 4.4 is unbuilt — render the shell + `LIGHT·PLACEHOLDER` badge, no medical PII").
That override remains correct until 4.4 ships. When it ships, that placeholder becomes a real derived count
and the override must be explicitly retired — otherwise the boarding surface keeps rendering a stub next to a
live sickbay.

---

## 1. Module-level flags (read these before any per-surface detail)

### 1.1 🔴 NHIS — no field exists anywhere in the schema. Owner decision required.

The surfaces reference NHIS **24 distinct times** across four of the five surfaces (full catalogue in §8).
`db/schema/students.ts::studentHealthRecords` (migration 0036) holds blood group, allergies, conditions,
medications, emergency contact, notes — **and no NHIS field of any kind**. Neither does `students`,
`households`, `studentGuardians`, `invoices`, nor any boarding table. Confirmed by reading the schema, not
assumed. The existing `docs/senior/wassce-student-deepdive-surface-map.md` already flagged this same gap
(line 315) and resolved it by OMITTING the NHIS card from the WASSCE deep-dive.

**The gap is not one column.** The surfaces demand at least four separate NHIS shapes:

| Shape | Where it appears | What it needs |
|---|---|---|
| **Card identity** — number, holder, validity window, status | chronic register §02, referral log §01/§02/§04 | number (text, formats differ: `8005-4287-6611-09` vs `NHIS-9842-1276-5503`), valid-from/valid-to date, status derived from expiry |
| **Card holder ≠ student** | referral log §02: `NHIS-9842-1276-5503 · A. Aidoo · Yaa Aidoo (minor)` | the card belongs to the **mother**; the student is a dependent. So the natural home is `households` or `student_guardian`, **not** `students` — but the referral log looks it up per-student. Modelling decision, not a detail. |
| **Per-line-item coverage** | referral log §02 reconciliation table (8 rows, each `NHIS · covered` / out-of-pocket) | a coverage flag + out-of-pocket amount on a referral-cost line row |
| **Facility acceptance** | setup §04 (`NHIS accepted` tag on 3 of 4 hospitals) | a boolean on the referral-hospital config row |

**Plus a school-wide roll-up** (referral log §05: `Active cards 1,108 / 1,200`, `Expired this semester 52`,
`Expiring next 30 days 31`, `No card on file 40`, `Coverage rate 92.3%`, labelled *"Synced from student
records"*) which is a pure derivation over the card-identity field — and is the module's single most
STPSHS-matrix-shaped fiction if built before the field exists.

**Owner decision needed, three parts:** (a) does NHIS live on the student, the household, or the guardian?
(b) is it in scope for 4.4 at all, or does it stay OMITTED (WASSCE precedent) and every NHIS element drops?
(c) if in scope, does the **Bursar** own the renewal-chase campaign (referral log §05 implies yes) — which
makes NHIS a billing field with a sickbay reader, not a sickbay field.

### 1.2 🔴 Medical PII — this is the highest-sensitivity module in the product

Full element-by-element inventory in §9. Summary of the classes present:

diagnosis · working impression · vitals (temp/BP/HR/SpO₂/pain score) · lab results (RDT, PCV, Hb, HbF, HbA1c)
· drugs administered with dose/route/time/administrator/witness · chronic medication schedules · clinician
free-text notes · presenting-complaint verbatim quotes · doctor consult content · menstrual data (`Menses ·
Not currently · LMP 22 Apr`) · mental-health data including bereavement and self-harm escalation triggers ·
family history (`maternal aunt deceased age 19 from acute chest syndrome`) · blood group · allergies ·
bed/ward occupancy tied to a named student · NHIS card numbers · parent phone numbers.

**Three boundary decisions this forces, all for Sarah:**

1. **The parent boundary.** Setup §05 Tier 1 says routine visits are *"Visible in parent portal · weekly
   digest if opted in"* — a direct commitment against the INCR-19a parent portal (`app/(parent)/`), which
   currently omits sickbay entirely because 4.4 is unbuilt. Which of {visit occurred, complaint, diagnosis,
   vitals, MAR, NHIS itemisation} does a parent see? The surfaces never answer it.
2. **The housemaster boundary.** Deliberately designed: today §01 HM strip says *"student in sickbay (medical
   detail withheld)"*; referral log §01 says HMs see *"student under sickbay care, off-campus"*; chronic
   register §04 grants HMs `Full plan` for life-threatening conditions and `Partial` (dorm card only)
   otherwise. This is **the product**, not a nicety — preserve it exactly.
3. **The student-actor boundary.** `F. Tetteh · Sick Bay Prefect` — a *student* — records the presenting
   complaint at intake (visit record §01 byline) and **witnesses drug administration** (visit record §03, two
   rows). A student writing into another student's clinical record is the sharpest PII question in the
   module. See §1.3.

**Masking is a design commitment:** the chronic register renders phone numbers masked (`0244 ███ 089`,
`+233 32 202 ████`). That is a *render* rule — store the full number, mask at display. Do not store masked.

### 1.3 🔴 Roles — `MATRON` exists; five other actors do not

`lib/auth/index.ts::KnownAppRole` already includes **`MATRON`**. `lib/access.ts` has no sickbay group yet —
the boarding comment (line 53) explicitly says *"MATRON is sickbay-only and NOT here"*, so a
`SICKBAY_ROLES` group is expected and reserved. **No enum add is needed for the matron.**

Actors the surfaces name that have **no** role and **no** representation:

| Actor | Where | Problem |
|---|---|---|
| **Assistant Matron** (`Ms G. Antwi`, CHN cert.) | setup §01, today §02 (21:00 round), visit record §04 (night cover) | A second `MATRON` assignment covers authz, but the surfaces distinguish "Senior Matron" from "Assistant Matron" in copy and in shift cover. Needs a seniority attribute on the sickbay staff record, not a new role. |
| **Visiting doctor** (`Dr K. Mensah`) | setup §01/§02/§04, visit record §02 (consult card), referral log §02 (ward rounds) | External clinician. **Approves the matron's care plan** and his consult is a logged clinical artefact — an actor with no `ref_user`. Needs an actor-without-login pattern (name + affiliation on the record) or a real user. Kofi call. |
| **School Health / Sick Bay Prefect** (`F. Tetteh`) | setup §01 (roster of 6), today §02 (round assist), visit record §01 (intake) + §03 (dose witness) | **Partially backed**: `_enums.ts::prefectRoleEnum` includes `SICKBAY`, set on `boarding_bunk.prefect_role` — but it is **display-only, bunk-scoped, one-per-bunk, with the appointment workflow deferred (Kofi OQ4)**. Setup §01 wants a 6-student roster with rotation, house coverage, and training dates. And nothing lets a student *write*. |
| **Deputy Head (Welfare)** | chronic register §01 privacy banner + §04 ("4 default-access staff") | Does not exist. `VICE_HEADMASTER_ACADEMIC` is the only vice-head role and is academic by definition. Either a new role or the default-access set drops to three. |
| **School Nurse** | chronic register §04 ("School Nurse if appointed") | Does not exist. Could collapse into `MATRON`. |
| **Sports master / Games master / Catering supervisor / Senior prefect / Transport officer** | chronic register §04 grant rows | Grant *recipients*. A grant table referencing `ref_user` covers those who have logins; a catering supervisor plausibly has none. Grant-to-a-non-user is an unresolved shape. |
| **VLC counsellor** (`Mrs N. Owusu`) | chronic register §03 | VLC module unbuilt. The "Open VLC case" cross-link and `VLC Case 2024-VLC-0047` have no target. |

**Recommendation:** `SICKBAY_ROLES = [ADMIN, HEADMASTER, MATRON]` as the base gate, mirroring
`BOARDING_ROLES`'s shape, with `HOUSEMASTER` reaching only the granted subset (the `canAccessHouse`
precedent, but grant-scoped rather than house-scoped). Everything else is a grant, not a role.

### 1.4 🔴 Fabricated demo content — do not build these as data shapes

The WASSCE surface's hardcoded STPSHS matrix has direct analogues here. Fifteen items called out:

| # | What | Where | Verdict |
|---|---|---|---|
| 1 | **Four different Slessor housemasters**: `Mr Owusu`, `Mr S. Bonsu`, `Mr E. Akoto`, `Mr Mensah` | today §01 / visit record §02 / chronic register §02 / referral log §01 | Demo noise. HM is derived from `houses.hm_user_id`. |
| 2 | **Four student-code formats**: `2025/F1/0214`, `AS-2024-F1-0089`, `SHS-2023-0817`, `2023/F3/0142` | today / chronic+visit / referral log / today §04 | `students.student_code` is free text so all are storable — but the surfaces must settle on one for the map. |
| 3 | **Adwoa Mensa is internally inconsistent**: programme `General Arts` vs `SCI` vs `GA`; adm# `2025/F1/0214` vs `AS-2024-F1-0089`; pain `4/10` (today, 14:45) vs `2/10` (visit record, 14:30) | across 3 surfaces | Same patient, three data sets. Pick the visit-record version (it is the most complete). |
| 4 | **Three different medication-round schedules**: `06:30/12:30/17:00/21:00` (today §02) vs `06:30/12:30/21:00` (setup §02 hours table) vs `06:30/13:00/21:00` (chronic register §02 grid columns) | 3 surfaces | Proves rounds **must be config-driven from setup** and the grid columns must render from config, never hardcoded. |
| 5 | Today §01 tile says **5 visits today**, §03 says **6 visits** | today | Counter drift. |
| 6 | Today §04's active referral is **D. Sarpong** (appendicitis, Wassa Akropong); the referral log's active referrals are **Y. Aidoo + K. Boateng**, and D. Sarpong appears nowhere in its 30-day history | today §04 vs referral log §01/§04 | **Two mutually exclusive referral casts.** The referral-log cast is richer — use it. |
| 7 | Referral log §03 counters don't reconcile: section meta `6 sent · 1 due`, lede `fired seven times`, stat `Tier 1 = 3`, timeline shows 2 Tier-1 rows, 7 sent + 1 future | referral log §03 | Counter drift. |
| 8 | Setup §03 header says **3 reorder alerts**; table shows 2 `Reorder` + 2 `Low`. `Salbutamol 3 / reorder-at 2 = OK` while `Calamine 2 / reorder-at 3 = Reorder` — the *rule* is consistent, the *header count* isn't | setup §03 | Derive the count; don't copy it. |
| 9 | **Mode percentages** `~16% / ~30% / ~59%` (sums to 105%) presented as research figures | setup §01 | Editorial copy. Ship as static copy or drop — never computed, never stored. |
| 10 | 🔴 **"NHIS card health across the school"** — `1,108 / 1,200`, `92.3%`, `52 expired`, `31 expiring`, `40 no card`, labelled *"Synced from student records"* | referral log §05 | **The canonical STPSHS-matrix case in this module.** Zero backing. Do not build until the NHIS field lands; then it is a real derivation. |
| 11 | `Avg. weekly load 2.4 beds · was 3.1 in Semester 1` | setup §02 | Needs a term of visit history. Will read `0.0` at launch — needs a real empty state, not a fake baseline. |
| 12 | Diagnosis-mix and hospital-mix bar charts | referral log §04 | Genuinely derivable, but only after data exists. Day-one empty states are mandatory. |
| 13 | Outbreak trends `↑ from 2`, `↔ baseline`, `↔ from 4` | today §05 | Needs a prior 7-day window; blank for the first 14 days of operation. |
| 14 | `F. Tetteh (Sick Bay Prefect, Aggrey)` cross-referenced from the boarding batch | setup §01 note | Narrative continuity between surfaces, not a data shape. |
| 15 | Masked phones `0244 ███ 089`, `+233 32 202 ████` | chronic register §02 | Render rule, not stored data (see §1.2). |

### 1.5 Navigation — the sidebar is inconsistent across the five surfaces, and it breaks the 12-item rule

| Surface | Top-level items | Sickbay sub-items (in order) |
|---|---|---|
| today | Dashboard, Students, **Academics**, Boarding, Sickbay, Discipline, **VLC**, Communications, **Billing & fees**, Reports | Today · Visit records · Chronic register · **Referrals & comms** · Setup |
| visit record | Dashboard, Students, **Attendance**, Boarding, Sickbay, Discipline, Communications, Reports | **Today's sickbay** · **Visit record** · Chronic register · **Referrals** · Setup |
| chronic register | as visit record | as visit record |
| referral log | as visit record | as visit record |
| setup | Dashboard, Students, **Staff, Classes**, Attendance, **Billing**, Boarding, Sickbay `NEW`, Communications, Reports, **Settings** | **Setup · Today · Chronic register · Referrals** (only 4 — *no* Visit record) |

**Resolve before building:** (a) one sub-label set — recommend `Today · Visit records · Chronic register ·
Referrals · Setup`, five items, matching the URL segments `/sickbay/{today,visits,chronic-register,referrals,setup}`;
(b) `Visit record` is a *detail* route (`/sickbay/visits/{ref}`) reached by clicking a row — the setup surface
is right to drop it from nav, the others are wrong to include it. Recommend keeping it as a nav item pointing
at a **visit list** (`/sickbay/visits`), which the today surface §03 already implies ("click any row to open
the full visit record"); (c) top-level nav on the setup surface reaches **11 items + 5 subs = 16**, which
crosses the twelve-item threshold — sectioned nav applies (Academic / Student support / Operations /
Settings), with Sickbay under **Student support**.

**Actor drift on the setup surface:** §01/§02/§04/§05 render the sidebar footer as `Mr Asare-Mensah ·
Headmaster`; **§03 switches to `Mrs Bediako · Senior Matron`**. This is intentional and load-bearing —
the Headmaster owns mode/staff/capacity/hospitals/policy, the Matron owns standing orders and stock.
Two write scopes on one page.

### 1.6 Token-opacity trap

Every sickbay surface uses solid hex tokens with dedicated tint variants already declared
(`--gold-bg`, `--green-bg`, `--terra-bg`, `--warn-bg`) — plus **`rgba()` literals inside the navy sidebar**
(`rgba(255,255,255,0.18)`, `rgba(250,247,242,0.7)`, `rgba(200,151,91,0.08)`). Those rgba values are the exact
places a Tailwind slash-opacity translation (`text-bg/70`, `bg-gold/8`) will silently fail on raw-hex tokens.
Use `opacity-N` utilities or dedicated tint tokens, and **verify in the live preview, not the build**.

---

## 2. Surface 1 — `schoolup-sickbay-setup.html` · Sickbay setup & configuration

**Purpose:** tells the system *what kind of medical capacity this school actually has, who runs it, and which
hospitals catch the cases the sickbay can't.* It is the **configuration spine** — every other surface reads
from it (bed count, round times, standing orders, hospitals, notification tiers).
**Primary actor:** **Headmaster** (§01/§02/§04/§05) with the **Matron** owning §03 (standing orders & stock).
**Reached via:** `Sickbay → Setup` · `app.omnischools.gh/sickbay/setup` (+ `#capacity`, `#standing-orders`,
`#hospitals`, `#policy`).
**Page hero:** eyebrow `Omnischools · Sickbay · Setup & configuration` · h1 `When the sickbay *holds the dose*`.

### §01 Mode & staff (`/sickbay/setup`)
`Sickbay configuration` · lede *"How your sickbay is run · **mode**, **staff**, **capacity**, **standing
orders**, **referral hospitals**, and **policy anchors** · all editable here"* · actions `SHEP policy ↗`,
`Save changes` (gold).

- **Mode strip · 3 cards.** `Mode A · Full sickbay` ("Beds, isolation ward, resident matron, visiting doctor,
  drug stock. Can admit overnight, manage outbreaks on-site, run scheduled medication rounds." / *Typical for
  Cat. A schools · ~16% of public SHS*); `Mode B · selected · First-aid station` ("Matron on-site, basic
  capacity for short-stay observation, drug stock, weekly visiting doctor. Refers serious cases to district
  hospital within hours." / *Cat. B–C · ~30%*); `Mode C · Referral only` ("No sickbay. School Health Prefect
  roster handles first response, all cases route to nearest hospital. SHEP-coordinated, no on-site clinical
  capacity." / *~59% of public SHS without sickbays use this*). Note panel names the field
  **`sickbay_mode_enum`** and states *"surfaces below adapt their affordances based on this choice"*.
  → **NEEDS SCHEMA** (mode enum on a per-school config row). Percentages = **fabricated/editorial** (§1.4 #9).
  **Mode C is a real branch the other four surfaces must degrade into** — no beds, no rounds, no MAR, referral
  log + hospital list only. Flag for Kofi: is Mode C in 4.4 scope or deferred?
- **Clinical staff card** (`2 active · 1 visiting`): 3 rows — `Mrs Akua Bediako · Senior Matron · N&MC
  #N-04827 · 11 years here` [On shift]; `Ms Grace Antwi · Assistant Matron · CHN cert. · weekend & nights`
  [Off · back 18:00]; `Dr K. Mensah · Visiting doctor · Asankrangwa Govt. Hospital · Thursdays 14:00–17:00`
  [Tomorrow]. CTA `Add clinical staff member`.
  → user + role = **BACKED** (`ref_user`, `role_assignment`, `MATRON`). **N&MC licence number = NEEDS SCHEMA**
  — `staff_profile` has `ntc_licence_number` + `ntc_licence_expiry` (teaching council) but **no nursing
  council field**. Two options: add `nmc_licence_number`/`nmc_licence_expiry` beside NTC (clean, mirrors the
  existing pattern), or generalise to `licence_body`/`licence_number`/`licence_expiry`. Kofi call.
  "11 years here" → **NO CLEAN BINDING** (no staff start-date field). Status pills (`On shift` / `Off · back
  18:00` / `Tomorrow`) → **NEEDS SCHEMA** (derived from the §02 hours table + a per-staff shift assignment).
  Visiting doctor → see §1.3 (actor without login).
- **School Health Prefects card** (`6 students · SHEP-aligned`): `F. Tetteh · F3 BUS · Senior · Aggrey House ·
  06:30 round assist` [Roster lead]; `A. Osei · F3 GA · Senior · Aggrey House · first-aid trained` [Roster];
  `E. Asare · F2 SCI · Slessor House · trained Feb 2026` [Roster]; `+3 · 3 more prefects · Aggrey, Kufuor,
  Nkrumah · Full roster covers all 6 houses · two-week rotation` [View all]. CTA `Add School Health Prefect`.
  → student identity + house = **BACKED** (`students`, `houses`). Prefect designation = **PARTIALLY BACKED**
  (`prefect_role = 'SICKBAY'` on `boarding_bunk`, display-only, bunk-scoped, appointment workflow deferred).
  Roster seniority, training date, rotation cadence, house coverage = **NEEDS SCHEMA**.

### §02 Capacity & hours (`#capacity`)
`Capacity & hours` · lede naming the **06:30 medication round** as *"the anchor that defines a boarding
sickbay's daily shape"* · action `Reset to defaults`.

- **Capacity strip · 4 tiles.** `General beds 6 / Mixed-use · short observation`; `Isolation beds 2 /
  Cross-infection containment`; `Currently occupied 1 / 8 / **Adwoa Mensa** · bed 3 · since 09:14`;
  `Avg. weekly load 2.4 beds / Semester 2 to date · was 3.1 in Semester 1`.
  → bed counts **NEEDS SCHEMA** (a bed table or a general/isolation count pair — the note says *"The two
  numbers can't pool"*, so they are distinct capacities, and the today surface renders **8 individually
  numbered beds with per-bed isolation flags**, so a **`sickbay_bed` table wins**). Currently-occupied +
  patient name = derived from the admission record (**NEEDS SCHEMA**), and note-panel says this tile
  click-throughs to the today surface. Avg weekly load = **fabricated at launch** (§1.4 #11).
- **Hours & rounds table** — cols `Schedule slot` (label + `Anchor` tag + description sub-line) / `Time
  window` / `Staffing` / `Day type`. **7 rows verbatim:**
  1. `Morning medication round` **[Anchor]** — *"Chronic-condition students collect dose · sickle cell
     hydration check"* — `06:30 – 07:00` — `Matron + Prefect` — `Every school day`
  2. `Morning clinic` — *"Walk-in · students before assembly"* — `07:00 – 08:00` — `Matron` — `Every school day`
  3. `Daytime clinic` — *"Walk-ins with HM exeat slip from class"* — `10:00 – 17:00` — `Matron` — `Mon · Tue · Wed · Thu · Fri`
  4. `Noon medication round` — *"Mid-day chronic doses · post-lunch"* — `12:30 – 13:00` — `Matron` — `Every school day`
  5. `Visiting doctor` — *"Dr K. Mensah · admissions reviewed"* — `14:00 – 17:00` — `Doctor + Matron` — `Thursdays`
  6. `Evening medication round` — *"After prep · pre-bed doses"* — `21:00 – 21:30` — `Matron or Asst.` — `Every day incl. weekend`
  7. `On-call overnight` — *"Asst. Matron sleeps in adjoining room"* — `22:00 – 06:00` — `Asst. Matron` — `Every day · 365`
  → **NEEDS SCHEMA** (a `sickbay_schedule_slot` table). The **`Anchor` flag is a real column** — the note says
  *"the anchor tag tells the schema this slot can't be moved; everything else flexes around it."* The `Day
  type` axis mirrors `boarding.ts::dailyScheduleTemplate`'s day-type enum — **reuse it, don't invent a second
  one**. "Walk-ins with HM exeat slip from class" is a soft link to `boarding_exeat` (INCR-9, real) — likely
  narrative, not a live join; confirm with Kofi.

### §03 Standing orders & drug stock (`#standing-orders`) — **Matron is the actor here**
`Standing orders & stock` · lede *"First-line treatments the Matron is cleared to administer without doctor
sign-off · plus the master drug stock register · **3 items at or below reorder point**"* · actions
`N&MC scope ↗`, `+ Add standing order`. Body preamble: *"These are the first-line treatments registered with
the visiting doctor under N&MC scope of practice. Anything outside this list waits for Dr Mensah on Thursdays
— or escalates to referral."*

- **Standing orders list · 8 rows** (complaint → treatment):
  `Headache · uncomplicated` → *Paracetamol 500mg → 1–2 tabs · rest 30 min · review* ·
  `Menstrual pain` → *Paracetamol 500mg + hot water bottle → rest in sickbay if needed* ·
  `Sore throat · viral` → *Saline gargle + paracetamol → review 24h · refer if fever rises* ·
  `Diarrhoea · uncomplicated` → *ORS sachet + observation → refer if >6 episodes or fever* ·
  `Suspected malaria` → *RDT test · if positive → AL first dose + refer to OPD same day* ·
  `Minor cuts & abrasions` → *Saline wash + povidone iodine + dressing → tetanus check on chronic register* ·
  `Sprains · sports injury` → *RICE protocol + paracetamol → X-ray referral if weight-bearing fails* ·
  `Insect bites · allergic skin` → *Chlorpheniramine 4mg + topical calamine → refer if facial swelling*
  → **NEEDS SCHEMA** (`sickbay_standing_order`: complaint, first-line treatment, escalation trigger). This
  table is **the FK target for the visit record's med-log `Source` tag** (`Standing · SCD pain`, `Standing ·
  hydration`) — that dependency is why setup and the visit record belong in the same increment.
  *"tetanus check on chronic register"* is a real cross-link to the chronic register / immunisation history —
  and **no immunisation field exists** (`student_health_record` has none). Flag.
- **Drug stock register** — `top 12 of 24 items`; cols `Item` (name + sub-line) / `In stock` / `Reorder at` /
  `Last restocked` / `Status` pill (`OK` / `Low` / `Reorder`). 12 rows: Paracetamol 500mg 412/200/28 Apr/OK ·
  ORS sachets 84/40/2 May/OK · Artemether-lumefantrine (AL 20/120mg · malaria first-line) 14/12/14 Apr/Low ·
  Malaria RDT kits (SD Bioline) 22/20/20 Apr/Low · **Hydroxyurea 500mg — *"sickle cell chronic · for Adwoa
  Mensa"*** 8/14/15 Apr/Reorder · Salbutamol inhaler 3/2/5 Mar/OK · Chlorpheniramine 4mg 68/40/28 Apr/OK ·
  Povidone iodine 10% 4 bottles/2/12 Mar/OK · Adhesive bandages 240/100/2 May/OK · Sterile gauze 38/30/2
  May/OK · Calamine lotion 2/3/14 Feb/Reorder · Sanitary pads (menstrual supply · school-issued)
  112/60/28 Apr/OK.
  → **NEEDS SCHEMA** (`sickbay_stock_item`: name, form/sub-label, quantity, reorder point, last-restocked
  date; status derived, never stored). **The Hydroxyurea row carries a student link** — *"Chronic-condition
  meds are tied to specific students through the chronic register. If Adwoa transfers or graduates, the schema
  knows her supply was a function of her case."* That is an explicit **`student_id` nullable FK on the stock
  item** (or a join through the care plan). Design commitment — decide it, don't discover it.
  Cluster note: *"Three items below reorder point · Hydroxyurea (Adwoa's chronic supply) · Calamine lotion ·
  Malaria RDT kits are within margin. The 7-day procurement window means Hydroxyurea needs ordering this week
  to avoid a gap in Adwoa Mensa's chronic dose schedule."* → the **7-day procurement window is a config
  value**; the narrated consequence is a derived string.
  ⚠️ **A per-student drug-stock row leaks a chronic diagnosis to whoever reads the stock table** (Hydroxyurea +
  a name = sickle cell). Sarah gate.

### §04 Referral hospitals (`#hospitals`)
`Where serious cases go` · lede *"When the sickbay can't, the hospital does · **Asankrangwa Government** is the
primary referral; three more cover specialised cases and after-hours · NHIS acceptance tracked because
**parent cost matters**"* · action `+ Add hospital`.

Four hospital cards (name / meta chips / tags):
| Hospital | Meta | Tags |
|---|---|---|
| `Asankrangwa Government Hospital` (gold, primary) | `4.2 km` · `OPD · in-patient · X-ray · pharmacy` · `Dr K. Mensah (visiting MO) here` · `24h emergency` | `Primary referral`, `NHIS accepted` |
| `Wassa Akropong District Hospital` | `38 km` · `Higher capacity · 2 ambulances` · `For cases beyond Asankrangwa's scope` | `NHIS accepted`, `After-hours backup` |
| `St. Martin's Clinic · Asankrangwa` | `1.8 km` · `Private · faster waits` · `Some sickle-cell expertise` | `Private · cost`, `After-hours` |
| `Komfo Anokyé Teaching Hospital · Kumasi` | `198 km` · `Tertiary care · specialist referrals only` · `By onward referral from district` | `NHIS accepted` |

→ **NEEDS SCHEMA** (`sickbay_hospital`: name, `distance_km` — the note names the field explicitly — services
text, notes, `is_primary`, `accepts_nhis`, tag set). Links to the visiting-doctor staff record. This table is
the **FK target for every referral row** on surface 4.

### §05 Policy anchors & parent notification (`#policy`)
`Policy anchors` · lede *"The two outside frameworks this sickbay sits inside · and the **three-tier parent
notification rule** that turns sickbay events into parent calls"*.

- **Two policy-anchor cards** (static editorial copy — **no schema**, ship verbatim):
  `GES side · SHEP · School Health Education Programme` — full paragraph naming the School Health Prefect
  roster, health-education curriculum, district health team links, outbreak reporting.
  `MoH side · N&MC · Scope of Practice` — Nursing and Midwifery Council of Ghana, **LI 683, 1971**, the
  matron's authority deriving from licence + registered standing orders, *"The N&MC license number is captured
  on the staff record and shows on every dispensary action she signs."*
- **Three-tier parent notification rule** (the policy anchor every notification on surfaces 2/3/4 keys off):
  | Tier | Trigger | Description | Action | Channel |
  |---|---|---|---|---|
  | `01` | `Routine visit · discharge same day` | *"Headache treated, sore throat, period pain, minor cut dressed · student walks back to class or dorm within the hour. **No automatic notification**; weekly digest mentions the visit if parent has opted in."* | `No notification` | *"Visible in parent portal · **weekly digest if opted in**"* |
  | `02` | `Sickbay admission · overnight or beyond class hours` | *"Student admitted to a sickbay bed · suspected malaria with positive RDT · chronic-condition pain episode · injury requiring observation. **Parent notified by SMS within the hour**; matron's note includes condition and expected duration."* | `Notify parent` | *"SMS within **1 hour** · phone call by HM if no acknowledgement"* |
  | `03` | `Doctor consultation or hospital referral` | *"Visiting doctor reviews · or student transported to Asankrangwa Govt., Wassa Akropong, or further · serious injury · suspected fracture · severe sickle-cell crisis · mental health crisis. **Parent called immediately** · phone-first, SMS confirmation. HM also notified in parallel."* | `Call now` | *"Phone call · **matron + HM in parallel** · SMS confirms after"* |
  → **NEEDS SCHEMA** for the tier→trigger→channel policy rows; **the parent opt-in preference is a NEW
  parent-preference field** (`student_guardian` has none). **Tier 1's parent-portal line is a direct INCR-19a
  commitment — see §1.2.**
- **Save bar:** *"Setup is complete for Asankrangwa SHS · Mode B operation. One outstanding alert: Hydroxyurea
  is below reorder point and Adwoa Mensa's chronic supply needs replenishment this week. **Save and
  acknowledge** to make the configuration live across the sickbay surfaces."* · `Cancel` / `Save & acknowledge →`.

### Write actions (surface 1)
`Save changes` (§01) · `Add clinical staff member` · `Add School Health Prefect` · mode-card selection ·
`Reset to defaults` (§02 hours) · `+ Add standing order` · implicit stock edit (quantity / reorder point /
restock) · `+ Add hospital` · `Save & acknowledge` (makes config live). Every one of these is a school-level
config mutation → `audit_log` writes with `entityType` per config table.

### Cross-module touch points (surface 1)
**Boarding** — day-type axis should reuse `dailyScheduleTemplate`'s enum; "HM exeat slip" references
`boarding_exeat`; prefect roster leans on `prefect_role = 'SICKBAY'`; School Health Prefects are listed by
House. **Billing/NHIS** — `accepts_nhis` per hospital; `Private · cost` tag. **Comms** — the three-tier rule
is the trigger policy for every `notification_log` write in the module. **Attendance** — none directly.
**WASSCE** — none.

---

## 3. Surface 2 — `schoolup-sickbay-today.html` · Today's sickbay

**Purpose:** *"The matron's live operational view. Current queue, admitted patients with bedside vitals,
today's medication rounds, the last 24 hours of visits, active referrals out, and the outbreak monitor — one
page she keeps open beside the dispensing bench from morning round to lights-out."*
**Primary actor:** **Matron** (`Mrs A. Bediako · Matron · N&MC 04827`).
**Reached via:** `Sickbay → Today` · `/sickbay/today` (+ `/rounds`, `/visits`, `/referrals-active`, `/outbreak`).

### §01 Live situation · admissions, queue, key vitals (`/sickbay/today`)
`Today's *sickbay* · Wed 14 May 2026` · lede *"**1 admitted** · **3 in queue** · **5 visits** earlier today ·
**1 active referral** (D. Sarpong · Wassa Akropong) · URTI mild cluster watch"* · actions `Print day sheet`,
`New visit`, `Admit patient`.

- **Live strip · 5 tiles** (all **NEEDS SCHEMA**, all derived):
  `Admitted now` `1 / 8 beds` — *A. Mensa · bed 3 · SCD crisis* [active] ·
  `In queue` `3` — *avg wait 4 min · oldest 7 min* [active] ·
  `Visits today` `5` — *3 discharged · 1 admitted · 1 awaiting* ·
  `Active referrals` `1` — *D. Sarpong · post-op Akropong* ·
  `Cluster watch` `URTI` — *6 cases past 7 days · monitor* [alert].
  "avg wait / oldest" derives once the queue row carries `queued_at`. `refresh 15s` on the queue card is a
  **polling interval, not data**.
- **Admitted-patient block** (`.adwoa-block`) — *"the single most clinically important piece of information"*:
  name `Adwoa *Mensa* · admitted bed 3`; meta `F1 General Arts · **Slessor House** · Adm. #2025/F1/0214 ·
  admitted **09:14 today** by Mrs Bediako · 5h 31m on bed`; tags `Sickle cell SS` (chronic, terra) +
  `Admitted` (gold); **vitals row of 5**: `Temp 37.1°C` / `Pulse 88 bpm` / `BP 108/68` / `SpO₂ 98%` /
  `Pain score 4/10` (warn) — each with a sub-line (`13:00 last`, `down from 7`); narrative line: *"Mild
  vaso-occlusive pain crisis · right shoulder & knee. Hydration started 09:25 (oral, 200ml/h target).
  Paracetamol 1g → 09:30 and 12:30. Hydroxyurea continued. **Pain trending down 7 → 4** over 5 hours · hold
  admission, recheck vitals 17:00, plan discharge tomorrow morning if pain ≤ 2 and no fever. Parent (Mrs
  Mensa) notified **09:22** via SMS + phone call."*
  → student identity/class/house = **BACKED**. Everything clinical = **NEEDS SCHEMA** + **🔴 medical PII**.
- **Queue card** (`Queue · *waiting now*` · `3 students · refresh 15s`) — row grammar: `HH:MM` + `N min wait`
  / student name + `F2 SCI · **Aggrey House** · #2024/F2/0188` / complaint text + triage pill (`Routine`) /
  chronic flag (`No chronic flag`) / `Begin visit` button. 3 rows: `K. Asante` *Headache, since after lunch*;
  `P. Owusu` *Knee scrape · sports field*; `Y. Boateng` *Menstrual cramps*.
  → **NEEDS SCHEMA** (queue = a visit in `QUEUED` state). **Triage level is an enum** — only `Routine` shown,
  so the full ladder (Routine / Urgent / Emergency?) is **undefined by the surfaces** → Kofi call. The chronic
  flag is a **derived read of the chronic register** (cross-surface dependency).
- **Beds card** (`Beds · *occupancy*` · `1 / 8 · 7 empty`) — 8 tiles: `Bed 01`–`Bed 06` general, `Bed 07`/
  `Bed 08` with `Iso` tag; empty tiles show `Empty` (dashed border); the occupied tile shows name,
  `F1 · **Slessor**`, and a condition footer `SCD · 5h 31m`.
  → **NEEDS SCHEMA** (`sickbay_bed` with `is_isolation`; occupancy derived from the open admission).
  ⚠️ **The bed tile prints the diagnosis** (`SCD`) — a PII decision, because bed occupancy is arguably the
  least-private view in the module.
- **Housemaster awareness strip** — heading `Housemaster awareness · auto-notified of admissions`; 2 rows:
  `Slessor` / *"**Mr Owusu** notified · student in sickbay (medical detail withheld)"* / `09:17`;
  `Office` / *"**Mr Asare-Mensah** (HM) auto-notified of admission"* / `09:17`.
  → HM identity = **BACKED** (`houses.hm_user_id`). The notification event = **NEEDS SCHEMA** (or a
  `notification_log` row with an in-app channel — see §4 cross-module). **The "medical detail withheld"
  clause is the privacy design, keep it verbatim.**

### §02 Today's medication rounds (`/sickbay/today/rounds`)
`Medication *rounds* · today` · lede *"**06:30 ✓** 4 students · **12:30 ✓** 1 student · **17:00** due 2h 15m ·
**21:00** due 6h 15m"* · actions `View 7-day history`, `Mark 17:00 ready`. Head: `Four *rounds* · today's
dispensing schedule` + *"Standing rule from sickbay setup · all chronic-condition meds dispensed by matron in
person · **F. Tetteh** (Sick Bay Prefect, Aggrey) assists with 06:30 round check-off"* + live clock
`14:45 GMT`.

Four round rows (`time` + label / student list + helper line / status pill):
1. `06:30 · Morning · pre-breakfast` — A. Mensa · Y. Mensah · B. Antwi · K. Adusah — *"Dispensed by Mrs
   Bediako · **F. Tetteh (Sick Bay Prefect, Aggrey)** assisted with check-off · 06:30 to 06:47"* — `✓ Done · 06:47`
2. `12:30 · Lunch · post-meal` — A. Mensa (in-bed dose · paracetamol 1g) — *"Dispensed bedside · 12:32"* — `✓ Done · 12:32`
3. `17:00 · Evening · pre-prep` — A. Mensa (bedside · hydroxyurea check, paracetamol PRN) · Y. Mensah (Keppra
   500mg · second dose) — *"Y. Mensah will report after prep ends 16:30 · A. Mensa is on bed 3"* — `Due in 2h 15m`
4. `21:00 · Night · post-prep` — B. Antwi (Cetirizine 10mg) · A. Mensa (if still admitted · evening vitals
   check) — *"Asst Matron **Ms G. Antwi** on duty for 21:00 round"* — `Pending`

→ **NEEDS SCHEMA** (`sickbay_round` instance per day×slot + `sickbay_round_item` per student×drug, with
dispenser, witness, start/end). Note panel: *"Each round is **append-only** · every dispense logged with time,
student, drug, dose, dispenser, and witness"* and *"**F. Tetteh** as Sick Bay Prefect assists with check-off
but never handles meds · only the matron dispenses"* — **that constraint is a rule to encode, not copy.**
The round roster is **derived from the chronic register's medication schedules + the setup hours table**
(cross-surface dependency in both directions). Round times here (`06:30/12:30/17:00/21:00`) **contradict**
setup and the chronic register — see §1.4 #4.

### §03 Recent visits · last 24 hours (`/sickbay/today/visits`)
`Recent *visits* · 24-hour log` · lede *"**6 visits** in last 24 hours · **4 discharged** · **1 admitted**
(A. Mensa still on bed 3) · **1 referred out** (E. Owusu, returned today)"* · actions `Filter by house`,
`Export day report`. Head: `Six *visits* · chronological` + *"Most recent at top · click any row to open the
full visit record"*.

Row grammar: `HH:MM` + day (`Today` / `Yesterday`) / name + `F2 BUS · **Nkrumah** · <complaint>` / action text
/ disposition pill (`Discharged HH:MM` green · `Admitted` gold · `Referred` terra). 6 rows: `D. Mensah` cut on
left hand from carpentry workshop → *Cleaned, dressed, tetanus current*; `S. Owusu` period pain · routine, no
fever → *Paracetamol 1g · rest 45 min*; `L. Adjei` fever 37.8°C, headache · malaria RDT negative →
*Paracetamol 1g · rest 1h · ORS*; `A. Mensa` sickle cell pain crisis · right shoulder, knee · pain 7/10 →
*Hydroxyurea continued · paracetamol · hydration · bed 3* [Admitted]; `K. Adusah` forgot AM inhaler dose ·
asthma chronic → *Salbutamol 2 puffs · counselled*; `E. Owusu` wrist pain after inter-house football ·
swelling → *Referred to Asankrangwa Govt for x-ray* [Referred].
→ **NEEDS SCHEMA** (the visit table, 24h window). `Filter by house` = a real facet on `students.house_id`
(**BACKED** dimension). **Every complaint string here is medical PII.**

### §04 Active referrals out (`/sickbay/today/referrals-active`)
`Active *referrals*` · lede *"**1 student** currently at hospital · expected return 3–5 days · parent on site
with student"* · actions `Open full referral log`, `Log new referral`.

- **Referral card** — eyebrow `Active referral · day 1`, title `D. Sarpong · *post-op*`. **12 label/value
  rows:** `Student` D. Sarpong · F3 SCI · `House` Kufuor · `Adm. #` `2023/F3/0142` · `Condition` Acute
  appendicitis · `Hospital` Wassa Akropong District · `Departed` `Tue 13 May 16:20` · `Transport` School
  pickup truck · `Accompanied by` Mrs Bediako (Matron) · `Surgery` Tue 23:14 · Dr Akoto · `Parent with
  student` Mrs Sarpong · since 21:10 Tue · `Expected return` Sat 17 May / Sun 18 May · **`NHIS used` `Yes ·
  valid card`**. Status footer: `Recovering · day 1 post-op` + `22h elapsed`.
- **Communication thread card** (`Communication *thread* · D. Sarpong` · `5 entries · 22h`) — 5 entries, each
  `who → who` + timestamp + body: matron→parent phone call (8 min, appendicitis explanation, travel from
  Tarkwa); matron→HM SMS (referral notification, HM acknowledged 16:51, **authorised matron absence from
  sickbay during transport**); hospital→matron handoff confirmation (Dr Akoto, surgery 23:14, *"ER handoff
  notes attached (uncomplicated appendectomy, 4-night stay anticipated, **NHIS card processed**)"*);
  parent→matron inbound SMS verbatim; matron→parent SMS with academic-notes arrangement.
  → all **NEEDS SCHEMA**. Note panel makes two schema-shaping claims: *"**NHIS card status** is captured
  because cost reconciliation flows downstream to billing"* and *"**Mr Asare-Mensah** (HM) sign-off is
  recorded because matron leaving site mid-shift requires Headmaster authorisation"* — the second is a
  **co-sign/authorisation field on the referral**, not decoration.
  ⚠️ This surface's referral cast (D. Sarpong) is **incompatible** with surface 4's (Y. Aidoo, K. Boateng).

### §05 Outbreak monitor · 7-day cluster watch (`/sickbay/today/outbreak`)
`Outbreak *monitor* · 7-day window` · lede *"URTI cluster at **6 cases** past 7 days · above the 4-case
threshold for 'monitor'. No malaria spike. No GI cluster. Skin clean."* · actions `Notify GHS-Amenfi (district
health)`, `Configure thresholds`. Head: `Six *conditions* tracked · district-aligned categories` + *"Categories
align with Ghana Health Service district surveillance · matron escalates to **Wassa Amenfi GHS** on amber
cluster (8+ cases or 50% rise week-over-week)"*.

Six rows (condition + sub-description / count `past 7 days` / trend / status pill):
| Condition | Sub | Count | Trend | Status |
|---|---|---|---|---|
| `Upper respiratory tract` | *cough, sore throat, mild fever, runny nose* | 6 | `↑ from 2` | `Monitor` |
| `Malaria suspected` | *fever ≥ 38°C with RDT or referral for blood film* | 1 | `↔ steady` | `Normal` |
| `Diarrhoea / vomiting` | *acute GI symptoms · key sentinel for food-related outbreak* | 0 | `↔ baseline` | `Normal` |
| `Skin · rash, scabies, ringworm` | *dorm-spread risk · monthly inspection in boarding* | 0 | `↔ baseline` | `Normal` |
| `Eye · conjunctivitis` | *"Apollo" · high contagion risk in boarding houses* | 0 | `↔ baseline` | `Normal` |
| `Sports injury · sprain, strain, fracture` | *tracked separately from infectious watch · safety review trigger* | 3 | `↔ from 4` | `Normal` |

→ **NEEDS SCHEMA** (a surveillance-category config table + a per-category threshold pair). Counts and trends
are **derived** from visit complaint categorisation — which means **every visit needs a category FK**, not just
free text. Thresholds: `4+ / 7 days → monitor`; `8+ or 50% WoW → amber + notify Wassa Amenfi GHS`. The
`Notify GHS-Amenfi` action implies an outbound district-health notification with no channel defined → **NO
CLEAN BINDING** (SMS? email? PDF?). "monthly inspection in boarding" is a soft link to
`boarding.ts::inspections` (real).

### Write actions (surface 2)
`New visit` (creates a queued visit) · `Admit patient` (visit → admitted, allocates a bed) · `Begin visit`
(queued → in-progress, per row) · `Mark 17:00 ready` (round state) · `Log new referral` · `Configure
thresholds` · `Notify GHS-Amenfi` · `Print day sheet` / `Export day report` (exports — audit-logged reads).
Implicit state transitions: **queued → in progress → {discharged | admitted | referred}**; admitted → bed
occupied → discharged frees the bed; round: pending → due → done.

### Cross-module touch points (surface 2)
**Boarding** — house on every queue/visit/bed row; `Filter by house`; HM auto-notification strip; Sick Bay
Prefect from the boarding prefect vocabulary; "monthly inspection in boarding". **Attendance** — implicit
(admission → MEDICAL); the explicit statement is on surfaces 3 and 4. **Billing/NHIS** — `NHIS used` on the
referral card, `NHIS card processed` in the thread. **Comms** — the notification thread + HM strip. **WASSCE**
— none on this surface.

---

## 4. Surface 3 — `schoolup-sickbay-visit-record.html` · The visit record

**Purpose:** *"One visit, completely captured."* — the **atom of the whole module**. Every other surface is a
projection of this record: today's queue/visits are visits in a state, the referral log is a visit whose
disposition is `referred`, the chronic register's "last visit" column is a visit lookup.
**Primary actor:** **Matron** (record author) · secondary readers: visiting doctor, housemaster (scoped),
Headmaster (digest line).
**Reached via:** clicking any row on today §03, or the chronic register's "View visit history".
**URL / reference format:** `/sickbay/visits/VR-2026-05-14-0089-001` → **`VR-{YYYY-MM-DD}-{student seq}-{visit
seq}`** — a human-readable visit reference (**NEEDS SCHEMA**: a generated reference column, same idiom as
`invoice.invoice_number`).

### §01 Patient, presentation & vitals timeline
`Visit *record.*` · lede *"Admitted **09:14** · Wed 14 May 2026 · Bed **3** · Day-shift attending **Mrs A.
Bediako**"* · actions `Print summary`, `Add note`, `Update vitals`.

- **Patient header** — avatar `AM`; `Adwoa *Mensa*`; detail chips `**F1 SCI** · age 15` · `**Slessor** House ·
  bed S-12-B` · `Mother **Mrs E. Mensa** · primary contact`; flags: `Sickle cell · HbSS` (chronic-flag),
  `NHIS · active` (nhis-flag), `AS-2024-F1-0089` (id-flag).
  → name/class/programme/house/student code = **BACKED** (`students` + `classes` + `houses`); age = **BACKED**
  (derive from `date_of_birth`); primary contact = **BACKED** (`student_guardian.is_primary` +
  `relationship`); chronic flag = **NEEDS SCHEMA** (chronic register); **NHIS = 🔴 no field**;
  `bed S-12-B` = **NO CLEAN BINDING** — `boarding_bunk` is `dormitory.name` (`"A".."H"`) + `position_number`,
  with **no upper/lower bunk suffix**; `S-12-B` implies a third axis. Either a display convention to define or
  a schema addition. Kofi call.
- **Status strip · 4 tiles.** `Disposition` `*Admitted*` — *general ward · **bed 3*** · `Time on ward`
  `05h 31m` — *from **09:14*** · `Pain · current` `2/10 ↓` — *was **6/10** on arrival* · `Expected discharge`
  `16:00` — *if criteria **met***. All **NEEDS SCHEMA**.
- **SCD protocol banner** — `SCD` icon; `Sickle cell pain crisis protocol *· active*`; *"Following standing
  order: **hydroxyurea continuation + paracetamol PRN + oral hydration**. Escalate if pain >7/10, fever
  >38.5°C, chest pain, or breathlessness."*; link `View care plan →`.
  → **NEEDS SCHEMA** + a **live cross-link into the chronic register's care plan** (design commitment).
- **Vitals card** (`Vitals *timeline*` · `4 readings · last **14:30**`):
  - **Trend strip · 5 tiles**: `Temp 37.2°C` (−0.6 from arrival) · `BP 108/68` (stable) · `Heart rate 84bpm`
    (−12 from arrival) · `SpO₂ 98%` (stable) · `Pain (0-10) 2` (−4 from arrival).
  - **Vitals table** — cols `Time` / `Temp` / `BP` / `HR` / `SpO₂` / `Pain` / `Taken by`; 4 rows with context
    labels `on arrival` `2h obs` `post-meds` `current`; the current row is gold-tinted (`.now`); cells carry
    `warn`/`ok`/`normal` colour classes; pain renders as a pill with `mod`/`low`/`min` severity.
    Rows: `09:14` 37.8/110-72/96/98%/6-10/A. Bediako · `11:00` 37.6/109-70/92/98%/5-10/A. Bediako · `13:30`
    37.4/108-70/88/98%/3-10/**G. Antwi** · `14:30` 37.2/108-68/84/98%/2-10/A. Bediako.
  → **NEEDS SCHEMA** (`sickbay_vitals`, one row per reading, with `taken_by_user_id`). **🔴 medical PII.**
  Note panel: *"A sickle cell crisis is **not a snapshot**. It evolves over hours."* — the timeline shape is
  the design, not a table styling choice.
- **Presenting complaint block** — label `Presenting complaint · as recorded`; **verbatim quoted text**:
  *"Joint pain — **knees, lower back, both wrists**. Started overnight. Worsened after morning prep run before
  06:30 round. Mild abdominal discomfort, no nausea. No fever felt by patient. Took her usual hydroxyurea at
  06:30 morning round."*; byline *"Recorded by **F. Tetteh · Sick Bay Prefect** at intake 09:11 · confirmed by
  Matron at **09:14**"*.
  → **NEEDS SCHEMA** + **🔴 the student-actor problem** (§1.3). The note panel calls the matron's 09:14
  confirmation *"the medico-legal anchor"* — so the record needs **two actor stamps: recorded_by and
  confirmed_by**, with confirmation restricted to the registered nurse. That is a real constraint.

### §02 Matron's assessment & visiting doctor consult
`Assessment & *consult.*` · lede *"Matron's clinical reasoning, the visiting doctor's input, and the line where
each takes responsibility."*

- **Matron's assessment card** (`recorded **09:42** · A. Bediako · N&MC #N-04827`) — **6 labelled rows**:
  `Working impression` (*"**Mild sickle cell pain crisis** — vaso-occlusive type, joint & lower-back
  distribution. Likely triggered by *dehydration + cold dawn + physical exertion*. No acute chest signs, no
  fever spike, oxygen saturation maintained."*) · `Red flags screened` (*"**Negative** · chest pain ·
  breathlessness · pallor change · jaundice progression · severe headache · neurological signs · abdominal
  guarding · fever above 38.5°C."*) · `Hydration status` · `Plan` · `Escalation triggers` (*"Pain rises to
  **≥7/10** · temperature **>38.5°C** · any chest pain or breathlessness · SpO₂ **<94%** · vomiting unable to
  retain fluids · drowsiness. → **Same-day referral to Asankrangwa Government Hospital**."*) · `Recorded by`
  (*"**Mrs Akua Bediako** · School Matron · Nursing & Midwifery Council reg. `N-04827` · within scope of
  practice for first-line vaso-occlusive management."*).
  → **NEEDS SCHEMA** · **🔴 the densest clinical PII on any surface**. Note panel: *"The Matron documents her
  **working impression** — what she clinically thinks. **She does not write 'diagnosis'; that's a doctor's
  word.**"* → **the field is literally named `working_impression`, not `diagnosis`.** Preserve the wording;
  it is a scope-of-practice commitment. The N&MC number stamped on the record is the audit anchor.
- **Doctor consult card** — `Dr K. *Mensah* · visiting doctor` [`phone consult` mode pill] · `11:30 · 14 May` ·
  body: approves the matron's plan, no transfer, in-person Thursday 14:00 round, ER fallback instruction.
  → **NEEDS SCHEMA** (a consult artefact **separate from** the matron's note — the note panel is explicit:
  *"logged as a separate artefact — not folded into the Matron's note"*). Mode is an enum (`phone consult` /
  in-person implied).
- **HM notification card** — `Mr S. *Bonsu* · Slessor housemaster` [`notified`] · `09:20 · 14 May` · body:
  *"Informed Adwoa admitted, sickle cell crisis, mild. **Attendance auto-excused** for the day. Slessor house
  dorm-side care plan PDF is on file with him; he confirmed possession. Will visit ward at 16:00 if she's
  discharged before evening prep."*
  → **the attendance hook stated in-line** (see §10).

### §03 Medications administered · this visit
`Medications *administered.*` · lede *"Five entries this visit · every dose, the route, who gave it, and which
standing order it sits inside."* · actions `Add dose`, `Print MAR sheet`.

**Med log table** — cols `Time` / `Drug` (name + sub-line) / `Dose · route` / `Source` (tag) / `Administered
by` (+ secondary line). 5 rows:
| Time | Drug | Dose · route | Source tag | Administered by |
|---|---|---|---|---|
| `09:20` | **Paracetamol** *acetaminophen tablet · school stock* | `1000mg · oral` | `Standing · SCD pain` | A. Bediako · *witnessed **F. Tetteh*** |
| `09:22` | **ORS** (oral rehydration salts) *WHO formulation · 500ml prepared* | `500ml · oral` | `Standing · hydration` | A. Bediako |
| `11:00` | **Hydroxyurea** *brought from home · **NHIS-supplied** · her own bottle* | `500mg · oral` | `Scheduled · chronic` | A. Bediako · *double-checked label, expiry **02/27*** |
| `13:00` | **Paracetamol** *acetaminophen tablet · school stock* | `1000mg · oral` | `PRN · pain ≥4/10` | G. Antwi · *witnessed **F. Tetteh*** |
| `14:00` | **ORS** *refresh 250ml prepared* | `250ml · oral` | `Standing · hydration` | A. Bediako |

Plus two cards: `Next scheduled *dose*` — `17:00` `Paracetamol **1000mg**` *"**only if** pain ≥4/10 at
reassessment · 4h min interval cleared"*; `Daily hydroxyurea *continuation*` — `06:30` `Morning round ·
**500mg**` *"resumes **Thursday 15 May** · standard schedule from chronic register"*.
Cluster note (gold): *"**Append-only log.** Once a dose is recorded it cannot be deleted — only corrected with
a footnoted amendment. The **witness** column is required for any drug taken from school stock by a non-Matron
staff member; this is the N&MC double-signature standard adapted to Sick Bay Prefect supervision."*

→ **NEEDS SCHEMA** (`sickbay_medication_administration`, **append-only**, with `administered_by_user_id`,
`witness_*`, source FK + source kind enum). **Source kinds are a fixed vocabulary**, spelled out in the note
panel: **`Standing`** (pre-approved in setup §03, matron may give without doctor authorisation) ·
**`Scheduled`** (the patient's own chronic medication, surrendered on arrival per Ghana boarding protocol) ·
**`PRN`** (*pro re nata*, criteria must be met, each dose creates an audit trail showing the criterion was
satisfied) · **`Doctor-ordered`** (*"If a fourth tag appears, the consult timestamp is hyperlinked from that
row. Nothing untraceable."*).
**Amendment-not-delete is a hard requirement** — the same append-only + correction idiom as
`attendance_correction`; reuse the pattern, don't invent one.
🔴 **PII + the witness problem**: two of five rows are witnessed by a *student*.

### §04 Disposition · admitted, discharge target
`Disposition *& discharge.*` · lede *"Currently admitted · target discharge **16:00 today** if four criteria
met. The criteria are explicit, checkable, and visible to the Matron who covers night shift."*

- **Disposition card** — `Admitted · *general ward, bed 3*`; fields `Admitted` `09:14 · 14 May` / `Target
  discharge` `*16:00 today*` / `Fallback overnight plan` `stay on ward, Mrs Antwi covers`.
- **Discharge criteria card** (`3 of 4 met · pending reassessment at 16:00`) — 4 rows, each check-state +
  text + status: `**Pain ≤2/10** at reassessment` → `Met · 14:30` · `**Temperature normal range**
  (36.5-37.5°C)` → `Met · 14:30` · `**Oral intake adequate** — ≥750ml fluids since admission` → `Met · 850ml
  total` · `**Mobilising independently** — ward to bathroom unassisted` → `Pending · 16:00 test`.
  → **NEEDS SCHEMA**. Note panel: *"The criteria are **per-condition** in the chronic register's action plan —
  SCD has these four, asthma has different ones, anaphylaxis has its own."* → **criteria templates live on the
  care plan; the visit holds the instance + met/pending state.** Another visit↔chronic-register dependency.
- **Two path cards** — `If criteria *met*` (discharge to Slessor at 16:00, **excused from tomorrow's 06:00
  prep run auto-applied to roll-call**, resume hydroxyurea, Slessor HM checks at evening prep 19:00) and
  `If criteria *not met*` (stay bed 3, Mrs Antwi from 17:00, re-call Dr Mensah on escalation triggers, **Mrs
  Mensa re-notified by 18:00**, reassess 06:00 Thursday).
  → *"auto-applied to roll-call"* is a **boarding `prep_attendance` hook** (that table exists — INCR-9).
- Cluster note: *"...Either criterion-pass writes the discharge stamp; either criterion-fail extends admission
  with the parent re-notified. **No silent overnight stays.**"* → a rule to encode.

### §05 Communications, follow-up & cross-links
`The *communications* trail.` · lede *"Tier-2 admission → parent notified within **4 minutes**. Housemaster
within 6. Doctor consult logged. The chronic register link sits two clicks from any future visit."*

- **Notification log card** (`4 entries · per the three-tier rule`) — row grammar: time / recipient + role /
  detail line / message body / channel pill. 4 rows:
  `09:18` `Mrs E. *Mensa* · mother · primary contact` — *+233 24 567 8901 · **answered on 2nd ring** · call
  duration **3m 12s*** — verbatim script — [`Phone`] ·
  `09:18` `Mrs E. *Mensa* · written confirmation` — *SMS sent immediately after call · **delivered** at
  09:18:47* — verbatim SMS (*"Omnischools / Asankrangwa SHS: Adwoa admitted to sickbay 09:14 — mild sickle
  cell pain crisis, following care plan. Comfortable. Update at 16:00. **Reply CALL to request callback.** —
  Matron Bediako"*) — [`SMS`] ·
  `09:20` `Mr S. *Bonsu* · Slessor housemaster` — *In-app notification + walk-over · **acknowledged** at 09:23
  from house office* — *"...Please flag classmates if they ask, **no medical detail to share**."* — [`In-app`] ·
  `09:42` `Mr P. *Asare-Mensah* · Headmaster` — *Daily sickbay summary (rolled into 09:45 admin digest) ·
  **auto-routed*** — one-line digest — [`System`].
  → SMS delivery = **PARTIALLY BACKED** (`comms.ts::notificationLog` has schoolId/studentId/phone/message/
  status QUEUED|SENT|FAILED/provider/providerRef/templateId/sentByUserId/createdAt). **Missing:** channel
  (phone/in-app/system — the log is SMS-shaped), call duration, answered-state, acknowledgement timestamp,
  tier, and the link back to the visit. Either extend `notification_log` (channel + tier + entity link) or add
  a sickbay-scoped notification table. **Wells/Kofi call — this is the single biggest reuse-vs-new decision in
  the module.**
- **Cross-links card** — 4 cards, each `eyebrow / title / meta`:
  `Chronic register` → `Sickle cell care *plan*` · *last visit **23 Jan 2026** · 2 crises this semester · plan
  reviewed Apr 14* ·
  `Attendance` → `Today's excuse *auto-applied*` · ***5 periods** · all classes · attendance flags "excused
  (sickbay)"* ·
  `Boarding` → `Slessor *house roll*` · *marked "sickbay" on bed S-12-B · HM has read receipt* ·
  `Billing` → `School stock *only*` · *paracetamol + ORS · **no charge** · within sickbay standing supply*.
  ⚠️ **"5 periods · all classes" has no binding** — `attendance_record` is **one row per student per day**
  (`uniq_attendance_student_day`). Per-period attendance does not exist. Either restate as a day-level excuse
  (recommended) or escalate a per-period attendance model to Kofi (large, out of 4.4 scope).
- **Follow-up plan card** (`next 72 hours`) — 5 numbered steps `i`–`v`, each `when` + `text`: 16:00 discharge
  reassessment (Mrs Bediako, mobilisation test, call Mrs Mensa) · 19:00 HM evening check (Mr Bonsu, SMS ack) ·
  Thursday 06:30 morning round (resume hydroxyurea, **excused from morning prep run auto-applied**, F. Tetteh
  sent to retrieve if she doesn't appear by 06:35) · Thursday 14:00 doctor in-person review · Friday afternoon
  close visit (**add to chronic register's visit history**, generate term-end summary line for parent).
  → **NEEDS SCHEMA** (a follow-up task list with an owner and a due time). "Term-end summary line for parent"
  is another parent-boundary commitment.
- **Action bar** — *"This record is **not yet closed**. It closes when the 16:00 discharge fires and the
  follow-up plan completes, or when Mrs Antwi extends admission overnight. **Closing creates an immutable
  audit entry signed by A. Bediako.**"* · `Save draft` / `Mark for 16:00 reassessment`.

### Write actions (surface 3)
`Add note` · `Update vitals` (append a reading) · `Add dose` (append to MAR) · `Save draft` · `Mark for 16:00
reassessment` · discharge / extend-admission transitions · `Print summary` / `Print MAR sheet` (exports) ·
implicit: matron confirmation of a prefect-recorded intake; criterion met/pending toggles; close-record
(**immutable, signed**).
**State machine:** `queued → in progress → admitted → {discharged | extended | referred}` with `closed` as the
terminal record state. Append-only sub-logs: vitals, MAR, notifications.

### Cross-module touch points (surface 3)
**Attendance** — HM card *"Attendance auto-excused for the day"*; xlink card *"attendance flags 'excused
(sickbay)'"*. **Boarding** — house/bed/roll-call marking, HM read receipt, prep-run exemption (`prep_attendance`),
Sick Bay Prefect. **Billing** — the school-stock/no-charge xlink (the negative case that keeps billing clean).
**Comms** — the whole §05 notification log + the three-tier rule from setup. **Chronic register** — the SCD
protocol banner, care-plan link, discharge-criteria templates, hydroxyurea "standard schedule from chronic
register". **WASSCE** — none directly, but this is where an SC-12 (in-window medical disruption) would
originate; see §10.

---

## 5. Surface 4 — `schoolup-sickbay-chronic-register.html` · The chronic register

**Purpose:** *"Six students at Asankrangwa SHS live with conditions that don't go away between visits. The
register holds **care plans, not just diagnoses** — daily medication schedules, emergency protocols, dorm-side
reference artefacts for housemasters, and NHIS card details. Privacy is admin-private by default; housemasters
see only what the matron explicitly grants, and every read is in the audit trail. Mental health appears here
honestly: referral-managed, not on-site treated."*
**Primary actor:** **Matron** (author) · **Headmaster** + **Deputy Head (Welfare)** default-read · housemasters
and specialists per-grant.
**Reached via:** `Sickbay → Chronic register` · `/sickbay/chronic-register`, `/{studentCode}`, `/access-grants`.

**🔴 This is the surface most people assume `student_health_record` already backs. It does not.** The existing
table is a **1:1 static bio record** (one row per student: bloodGroup, allergies, conditions, medications,
emergencyContact*, notes, updatedBy, updatedAt). The register needs **one row per condition** with status,
**versioned care plans**, **structured medication schedules by round**, **ordered protocol steps**, an
**access-grant subsystem**, and a **read-audit trail**. `student_health_record` supplies the *seed values*
(condition text, medication text, allergy text, emergency contact) and nothing structural.

### §01 Active register · six students (`/sickbay/chronic-register`)
`Chronic *register.*` · lede *"**6 active** care plans · last review **Mon 12 May** · next monthly review
**Mon 19 May** · **admin-private** by default"* · actions `Export PDF`, `Audit trail`, `+ Add student`.

- **Privacy banner** — lock glyph `⚿`; `Admin-private · *per-grant access only*`; *"Chronic medical records are
  visible to **Matron, Headmaster, and Deputy Head (Welfare)** by default. Housemasters and class teachers see
  **only what the matron explicitly grants**, scoped per student and per field. **Every read and write is
  recorded in the audit trail.**"*; CTA `Manage grants ›`.
- **Filter strip** — `All 6` (active) · `Active crisis 1` · `Monitor 2` · `Stable 2` · `Referral-managed 1` ·
  `Sort · last visit ↓`. → **status is a 4-value enum**, and note panel is explicit: *"**Status separates from
  condition.** Asthma can be 'stable' or 'monitor' or 'active'; SCD can be 'stable' or 'crisis'. A condition is
  forever, a status is today."* → two columns, not one.
- **Register table** — cols `Student` (avatar + name + `**F1 SCI** · Slessor · `AS-2024-F1-0089``) /
  `Condition` (pill, colour-coded per condition family: scd terra, asthma warn, epilepsy purple, allergy gold,
  mental navy, diabetes green-blue) / `Status` (pill) / `Daily medication` (drug bold + sub-line) / `Last
  visit` (datetime + ago + reason) / `HM grants` (avatar stack + `N staff`) / `Plan` (`Open ›`). **6 rows:**
  | Student | Condition | Status | Daily medication | Last visit | Grants |
  |---|---|---|---|---|---|
  | Adwoa Mensa · F1 SCI · Slessor · AS-2024-F1-0089 | `Sickle cell · HbSS` | `Active crisis` | **Hydroxyurea 500mg** OD *+ paracetamol PRN, oral hydration* | 14 May 09:14 · *admitted now* | 3 staff |
  | Kofi Asante · F2 SCI · Aggrey · AS-2023-F2-0142 | `Asthma · moderate` | `Monitor` | **Beclomethasone** BD inhaler *+ salbutamol PRN, peak flow Mon/Thu* | 04 May 14:22 · *10 days ago · attack* | 2 staff |
  | Akua Owusu · F3 GA · Slessor · AS-2022-F3-0034 | `Epilepsy` | `Monitor` | **Carbamazepine 200mg** BD *morning 06:30 + evening 21:00 round* | 29 Mar 22:40 · *6 wk ago · nocturnal sz* | 2 staff |
  | Yaw Boateng · F1 BUS · Kufuor · AS-2024-F1-0203 | `Anaphylaxis · peanut` | `Stable` | **Epi-pen ×2** on standby *kitchen alert · 0 exposures this semester* | 11 May 13:15 · *3 days ago · contact* | 3 staff |
  | J. Manu · F2 GA · Aggrey · AS-2023-F2-0091 | `Anxiety · referral-managed` | `Referral-managed` | *no on-site medication* · *monthly Asankrangwa DMHU clinic* | 02 May 10:00 · *12 days ago · DMHU visit* | 2 staff |
  | Esi Antwi · F3 SCI · Nkrumah · AS-2022-F3-0167 | `Type 1 diabetes` | `Stable` | **NovoMix 30** BD insulin *pre-breakfast + pre-dinner · HbA1c 7.4%* | 12 May 18:40 · *2 days ago · routine* | 3 staff |
- **4 summary tiles** — `Active crises (today)` `1 of 6` (*Adwoa M. · SCD pain crisis*) · **`NHIS coverage`
  `5 of 6`** (*Yaw B. is private (epi-pen not covered)*) · **`WASSCE candidates` `2 of 6`** (*Akua O., Esi A. ·
  examination accommodations on file*) · `Plans needing review` `0 overdue` (*Next monthly review **Mon 19
  May***).
  → the **WASSCE tile is a real cross-module join** (`wassce_candidates`, and "examination accommodations on
  file" maps to `waec_special_consideration` `SC-7` chronic-condition extra time — both **BACKED**). The
  **NHIS tile is 🔴 unbacked.**

**Classification for §01:** student identity/class/house/code = **BACKED**. Condition text and medication text
= **PARTIALLY BACKED** (`student_health_record.conditions` / `.medications`, free text, 1:1, unstructured —
cannot carry per-condition status, per-round doses, or 6 rows for one student). Everything else = **NEEDS
SCHEMA**.

### §02 Care plan detail (`/sickbay/chronic-register/AS-2024-F1-0089`)
`Care *plan.*` · lede *"Sickle cell disease · **HbSS** · diagnosed age 3 · plan version **v4** last reviewed
**Mon 21 Apr** by Mrs A. Bediako"* · actions `Print dorm copy`, `View visit history`, `Edit plan`.
Patient header identical to the visit record's (same component).

- **Plan details card** (`v4 · 21 Apr 2026 · Mrs A. Bediako`) — 4 rows: `Condition` (full paragraph incl.
  **family history**: *"maternal aunt deceased age 19 from acute chest syndrome"*, phenotype, crisis frequency,
  splenic dysfunction) · `Crisis triggers` (**5 bullets**: Dehydration / Cold exposure / Infection / Physical
  exertion / Emotional stress, each with operational detail e.g. *"exempt from cross-country and prolonged
  outdoor PE"*) · `Baseline status` (**Hb 7.8 g/dL**, **HbF 11.2%** target >15%, last KATH outpatient review
  27 Mar 2026 with named consultant, next review 27 Jun 2026) · `Care goals · term` (`on track` signal, *"Zero
  school days lost to preventable crisis · **2 of 5 terms achieved**. Hydroxyurea adherence **97%**.
  Examination accommodations for end-of-term: extra time, separate room, water bottle access."*).
  → **NEEDS SCHEMA**, **versioned** (`v4`, reviewer, review date — supersede-not-overwrite, the
  `readiness_statements` idiom is the closest precedent in the repo). **🔴 heavy PII incl. family history and
  lab values.** *"Examination accommodations"* → **WASSCE SC-7 hook** (see §10).
- **Daily medication schedule grid** — columns `Medication` / `06:30 Morning` / `13:00 Lunch` / `21:00 Evening`
  / `PRN As needed`; 6 drug rows with per-column dose or `—`: Hydroxyurea (*capsule · 500mg · with food*) 500mg
  / — / — / — · Folic acid (*tablet · 5mg · with food*) 5mg / — / — / — · Penicillin V (*tablet · 250mg ·
  prophylaxis*) 250mg / — / 250mg / — · Paracetamol (*tablet · 500mg · max 4×/day*) — / — / — / **500mg PRN** ·
  Ibuprofen (*tablet · 400mg · with food*) — / — / — / **400mg PRN** · Oral rehydration (*sachet · 200ml
  water*) — / — / — / **1 sachet PRN**.
  Round-timing rule note: *"Morning 06:30 round happens before breakfast (per boarding standing order). Adwoa
  attends in person with her dorm pass; **meds are recorded at the round, not retrospectively**. Lunch round is
  for students who can't get to the dining hall... Evening 21:00 round is back at sickbay before lights-out."*
  → **NEEDS SCHEMA** (`care_plan_medication` × `round slot`). Note panel: *"**Medication schedule maps to
  rounds.** ...When a round fires, Adwoa's entries appear in the round task list automatically."* → **this
  table is the source of the today-surface round roster.** The **column headers must render from the setup
  hours table**, not be hardcoded (§1.4 #4).
- **Emergency protocol block** — `SCD pain crisis · *escalation protocol*`, **5 numbered steps**, each with a
  heading and a detail paragraph: `1 Recognise · vaso-occlusive crisis presenting` · `2 Admit to sickbay ·
  begin protocol` (bed, warm blanket, **200ml ORS or water every 30min**, initial vitals, paracetamol 500mg PO,
  notify HM Slessor) · `3 Notify parent · admission tier` (**SMS within 1hr**, masked number, escalate to phone
  if uncontrolled in 2hr) · `4 Red flags · immediate referral` (**7 explicit criteria**: pain >7/10 unresponsive,
  fever >38.5°C, chest pain/breathlessness, neurological signs, **priapism (boys)**, sustained vomiting, O₂ sat
  <95% · call ahead, request named doctor) · `5 Tertiary escalation · KATH transfer` (named consultant, masked
  phone, *"Adwoa's full chart is on file at KATH; her ID will retrieve it"*).
  → **NEEDS SCHEMA** (ordered protocol steps, per plan). Note panel: *"Emergency protocol is matron's plan **in
  their own words** — not a generic SCD reference."* → free-text steps, not a template library.
- **Dorm-side artefact card** — `Adwoa *Mensa* · Slessor House`; sub *"Dorm-side reference · **HM-only** ·
  auto-printed every term"*; **8 rows**: `Condition` **Sickle cell · HbSS** · `Bed` *S-12-B · lower bunk · near
  door* · `Triggers` *dehydration, cold, infection, stress* · `Daily med` *06:30 round at sickbay (must
  attend)* · `Red flags` *severe pain · fever · breathlessness · chest pain* · `Action` ***Walk her to
  sickbay** · do not let her wait* · `Parent` *Mrs Mensa · `0244 ███ 089`* · `Matron` *Mrs Bediako ·
  `0277 ███ 412`*; foot: *"Print this card and post inside the HM's cabinet door. **Do not display in dorm
  common area** — medical privacy applies. Replaced each term and on plan revision."*
  → **NEEDS SCHEMA** (a derived/print artefact; the *"HM-only"* scope is a grant level). Note panel: *"HMs
  aren't clinicians and shouldn't have full medical detail; the artefact gives them the four things they need —
  triggers, red flags, action, who to call. **Printed and posted, not in the app.**"* — a deliberate
  out-of-app deliverable; the app produces a PDF.
  `bed S-12-B · lower bunk · near door` again exceeds `boarding_bunk`'s shape (§4 §01).
- **🔴 NHIS & billing card** (`card valid to 2027`) — `NHIS card` `8005-4287-6611-09` · `Card status`
  `active` *renewed Jan 2026 · valid Dec 2027* · `Coverage` *"Hydroxyurea, folic acid, penicillin V,
  paracetamol — **all covered**. Outpatient SCD reviews at KATH — covered. Acute admission care — covered."* ·
  `Not covered` *"Pulse oximetry consumables (school provides). Private hospital consultations — none
  scheduled."* · `YTD school cost` *"GHS 0.00 to family for routine care · GHS 340.00 covered via NHIS
  reimbursement to school stock"*.
  → **entirely unbacked** (§8). The YTD figure implies a **cost ledger per care plan** on top of NHIS itself.
- **Cross-module integration strip** — 3 cards:
  `Attendance · *auto-excuse*` — *"Days admitted to sickbay register as **excused medical absence**
  automatically. **Class teachers see 'M' not 'A'.** Adwoa has **3 excused days** this semester — all SCD."* ·
  `Boarding · *HM alert*` — *"Mr E. Akoto (Slessor HM) receives admission SMS **within 5min** of sickbay
  admission. Dorm-side artefact reminds him of red flags. **No medical detail shared — only 'in sickbay'
  status.**"* ·
  `Communications · *parent SMS*` — *"Three-tier rule fires automatically: **admission** → SMS · **refer** →
  immediate call + SMS. Mother's number is locked at parent record; **no manual entry per visit.**"*
  → **the canonical statement of all three hooks.** See §10.

### §03 Pastoral · referral-managed · J. Manu (`/sickbay/chronic-register/AS-2023-F2-0091`)
`Pastoral *cross-reference.*` · lede *"Mental health appears in the register honestly: **referral-managed**,
not on-site treated · primary care held by **VLC pastoral system** · sickbay role is monitoring, not
treatment"* · actions `Open VLC case`, `Log monthly visit`.

- **Pastoral block** — eyebrow `Why mental health sits here this way`; title `No on-site treatment ·
  *referral-managed only.*`; full paragraph (*"A real Ghanaian SHS sickbay does not provide mental health
  treatment. The matron is not a psychiatrist or counsellor, and pretending otherwise creates harm..."*);
  **3 handoff fields**: `Clinical home` **Asankrangwa District Mental Health Unit** [`DMHU`] · `Pastoral home`
  **VLC · pastoral** · Mrs Owusu, counsellor · `Sickbay role` **Monitoring only** · monthly check-in, escalation.
- **Plan details card** (`v2 · 28 Apr 2026 · Mrs A. Bediako + Mrs N. Owusu` — **two co-authors**) — 6 rows:
  `Condition` (**anxiety with sleep disturbance, in context of bereavement (father, Feb 2026)**, DMHU initial
  assessment 02 May 2026, *adjustment disorder with anxiety features*, not on medication) · `Pastoral home`
  (**VLC Case 2024-VLC-0047**, weekly Tue 16:00, open since 18 Feb 2026) · `DMHU schedule` (monthly first
  Friday, next **Fri 06 Jun 2026, 10:00**, mother accompanies, transport) · `Sickbay monitoring` (4 bullets
  incl. *"Distress escalations route to **Mrs Owusu first**, sickbay second"* and *"Watch for: weight loss,
  sleep complaints presenting as somatic (stomach pain, headache)"*) · `Red flags · escalation` (`immediate`
  signal — *"Any disclosure of self-harm thoughts, refusal of food >48hr, or significant deterioration — **call
  Mrs Owusu immediately** (`0244 ███ 178`), then DMHU duty officer. Do not wait for monthly review."*) ·
  `What the matron doesn't do` (*"Treatment, counselling, diagnosis, medication. If J. presents with headache
  or stomach pain, treat the physical symptom — but route the underlying concern to Mrs Owusu the same day."*).
- **DMHU visit log card** (`2 visits · monthly cadence`) — 2 rows: `02 May 2026 · Fri · 10:00` **Initial
  assessment** (named psychiatrist, mother accompanied, diagnosis, plan, *"Return-to-school clearance: **no
  restrictions**"*) [`Initial`]; `06 Jun 2026 · Fri · 10:00` **Monthly review** scheduled [`Scheduled`].

→ **NEEDS SCHEMA** across the board. **🔴🔴 the most sensitive data in the product**: bereavement, psychiatric
diagnosis, self-harm escalation triggers. **`Open VLC case` has no target — VLC is unbuilt.** Two options:
(a) drop the pastoral section from 4.4 entirely and file it with VLC, or (b) ship the register's
`referral-managed` status + external-clinical-home fields without the VLC link. **Recommend (b)** — the status
is what the matron needs; the case link can be inert until VLC exists. Owner/Kofi call.

### §04 Access grants & the audit trail (`/sickbay/chronic-register/access-grants`)
`Who can see *what.*` · lede *"**13 active grants** across 6 students · **4 default-access** staff (Matron, HM,
Deputy Welfare, School Nurse) · housemasters grant explicitly · every read logged"* · actions `Export grant
log`, `+ Grant access`.

- **Active grants table** (`13 grants · 8 unique staff`) — cols `Staff member` (avatar + name + role sub-line) /
  `Student / scope` / `Access level` (pill) / `Expires` / `Reason` / revoke button. **Access-level vocabulary
  across the 13 rows:** `Full plan` · `Partial` · `Exam-only` · `Restrict-only` · `Alert-only` ·
  `Catering-only` · `Allergen-only` · `Pastoral-only` · `Removed`. **Expiry vocabulary:** `no expiry ·
  housemaster role` · `no expiry · sports role` · `no expiry · catering oversight` · `standing` · `tied to VLC
  case` · a date · `28 Apr 2026 · ended`.
  Representative rows: `E. Akoto · HM · Slessor House` → Adwoa Mensa · dorm-side card · `Partial` ·
  *HM of student's house · standing grant per house role* · `S. Henneh · Class teacher · F1 SCI` → Adwoa ·
  exam accommodations only · `Exam-only` · expires `31 Jul 2026` · *End-of-term examinations · extra time +
  separate room arrangements* · `D. Kufuor · Sports master` → Adwoa · physical restrictions · `Restrict-only` ·
  *PE exemption list · sees only "no cross-country, no prolonged outdoor"* · `P. Essien · Games master` →
  Kofi Asante · asthma + inhaler location · *Inhaler access during games · pre-positioned at sports field* ·
  `Y. Kwaku · HM · Kufuor House` → Yaw Boateng · anaphylaxis protocol · `Full plan` · *Life-threatening allergy
  · HM holds epi-pen #2* · `Mr Boampong · Bursar` → Yaw Boateng · kitchen alert · `Catering-only` · *cook
  informed of peanut exclusion only — not medical detail* · `C. Tetteh · Catering supervisor` → allergen list ·
  `Allergen-only` · `P. Kwakye · Senior prefect` → Akua Owusu · alert-only · expires `31 Aug 2026` · *Dorm-mate
  · sees only "call matron immediately if Akua appears unwell"* · `J. Osei · HM · Aggrey` → J. Manu ·
  `Pastoral-only` · *sees only "VLC pastoral active · refer to Mrs Owusu"* · `E. Akoto` → J. Manu ·
  **`Removed`** · *House transfer · J. moved from Slessor to Aggrey · **grant auto-expired***.
  → **NEEDS SCHEMA** (`sickbay_access_grant`: grantee, student, scope/level enum, expires_at, reason,
  granted_by, revoked_at). **Two mechanics the note panel makes explicit and that shape the model:**
  *"HM grants are **role-based, not personal**. When E. Akoto moves out of Slessor next semester, his grants
  auto-transfer to the new HM."* → **derive the HM grant from `houses.hm_user_id`, don't store a user id** for
  house-role grants; store user ids only for personal grants. And *"Time-limited grants **expire
  automatically**."*
  ⚠️ **A `Senior prefect` grant means a STUDENT holds a medical access grant.** Sarah gate.
  ⚠️ Granting to a Catering supervisor who may have no login = an unresolved grantee shape (§1.3).
- **Audit trail card** (`last 24 hours` · `11 events · append-only`) — rows: time + day / event text (actor,
  verb, target, scope) / tag (`View` · `Update` · `Grant` · `Export`). 11 rows including
  *"Mrs A. Bediako opened Adwoa Mensa care plan · viewed full plan + med schedule"* [View] · *"Mr E. Akoto
  viewed Adwoa Mensa · dorm-side card (HM scope)"* [View] · *"Mr T. Asare-Mensah (Headmaster) viewed Adwoa
  Mensa · full plan · linked from admission alert"* [View] · *"Mrs A. Bediako logged crisis admission to Adwoa
  Mensa visit history · linked to register · status updated **stable → active crisis**"* [Update] · *"Mr E.
  Akoto printed dorm-side card"* [Export] · *"Mrs A. Bediako granted Mr P. Essien (Games master) **Partial**
  access to Kofi Asante · scope: **asthma + inhaler location**"* [Grant] · *"Mrs N. Owusu (VLC counsellor)
  viewed J. Manu · pastoral cross-reference"* [View] · *"Mrs A. Bediako conducted **monthly review** · all 6
  plans reviewed · v4 created for Adwoa Mensa"* [Update].
  → **PARTIALLY BACKED.** `audit.ts::auditLog` is already append-only with `actorUserId`, `actorRole`,
  `actionType`, `entityType`, `entityId`, `beforeState`/`afterState`, `reason`, `occurredAt` — writes,
  grants, and status changes all fit today with no schema change.
  🔴 **What does NOT exist: read logging.** `lib/db/audit.ts` writes on *mutations*. *"Every read is in the
  trail"* is a **new behaviour** — 8 of the 11 rows are `View`/`Export` events. That is a policy + volume
  decision (Sarah for the policy, Wells for the write path and retention), not necessarily new schema:
  `actionType = 'viewed'` on `audit_log` works, but at read volume. **Escalate.**
- **Save bar** — *"Audit trail is *append-only*. Reads, writes, grants, revocations, exports — every action is
  recorded with timestamp and actor. **Cannot be edited or deleted, even by Headmaster.** Retention: **7 years
  after student leaves the school per GES records policy.**"* · `Export 30-day log` / `Full trail ›`.
  → **7-year retention is a stated policy with no retention machinery anywhere in the repo.** Flag for Wells.

### Write actions (surface 4)
`+ Add student` (to register) · `Edit plan` (creates a new version) · `Log monthly visit` · `+ Grant access` ·
`Revoke` (per grant row) · `Manage grants ›` · `Print dorm copy` / `Export PDF` / `Export grant log` /
`Export 30-day log` (exports — **each writes an audit `Export` event**) · status transitions (`stable → active
crisis`, logged) · monthly-review completion.

### Cross-module touch points (surface 4)
**Attendance** — *"Class teachers see 'M' not 'A'"*, 3 excused days this semester. **Boarding** — house on
every row, HM grants derived from `houses.hm_user_id`, dorm-side artefact, bed reference, HM admission SMS
within 5min, house-transfer auto-expiry of grants. **WASSCE** — the `WASSCE candidates 2 of 6` tile +
*"examination accommodations on file"* + *"Examination accommodations for end-of-term: extra time, separate
room, water bottle access"* → `wassce_candidates` + `waec_special_consideration` **SC-7**. **Billing/NHIS** —
the NHIS & billing card, YTD school cost, `Bursar` grant row. **Comms** — the three-tier rule, *"Mother's
number is locked at parent record; no manual entry per visit"* (= `student_guardian`, **BACKED**). **VLC** —
`Open VLC case`, `VLC Case 2024-VLC-0047`, counsellor as a reader (**unbuilt**). **Discipline** — none.

---

## 6. Surface 5 — `schoolup-sickbay-referral-log.html` · The referral log

**Purpose:** *"When a sickbay sends a student out, the work doesn't end at the gate. Parents need to know,
hospitals need a handoff, NHIS cards need presenting, and someone has to track when the student is coming
back. This is the multi-day tail of every referral — calls made, SMS sent, ER doctors' notes, costs reconciled,
follow-ups scheduled."*
**Primary actor:** **Matron** (all five sections) · **Bursar** owns §05 in practice (*"The matron never sees
billing... Mrs Bediako can read this surface (her name appears in the audit) but the bursar owns it."*).
**Reached via:** `Sickbay → Referrals` · `/sickbay/referrals`, `/referrals/{ref}`, `/notifications`,
`/history`, `/reconciliation`. Case reference format `r-2026-05-14-0817` / `R-2026-05-14-0817`.

### §01 Active referrals · two students out (`/sickbay/referrals`)
`Referrals *log.*` · lede *"**Two students out right now.** Y. Aidoo at the district hospital since 06:45 with
severe malaria — still inpatient. K. Boateng returning now from orthopaedic — wrist cast, ETA 15:45."* ·
actions `Filter`, `Export`, `+ New referral`.

- **Stats strip · 4:** `Active right now` `2 students` (*Y. Aidoo · K. Boateng*) · `This week` `4 total`
  (***3 returned** · 1 inpatient*) · `This semester` `27 total` (*19 malaria · 4 injury · 2 SCD · 2 other*) ·
  `Outstanding cost` `GHS 340` (*3 families · 1 over 30 days*).
- **Referral cards · the seven-line pattern.** Note panel: *"**The seven-line card pattern.** Diagnosis,
  hospital, transport, NHIS, parent, status, expected back. Every active referral fills the same seven lines.
  **Anything missing is a real gap — not a UX gap.** Forces the right operational discipline."* → **the seven
  lines are the required-field set of the referral row.**
  Header per card: avatar / name / `F3 Slessor House · **Science** · ID **SHS-2023-0817**` / status pill
  (`Inpatient` terra · `Returning` warn) / day pill (`Day 1 · since 06:45` · `Discharged 15:10`).
  Card 1 (Y. Aidoo): `Diagnosis` **Severe malaria** [`P. falciparum`] *RDT positive 06:20 · temp 38.9°C ·
  vomiting · referred when matron could not start IV* · `Hospital` **Asankrangwa Government Hospital** *Ward B
  · bed 7 · Dr K. Mensah (visiting doctor here, attending there)* · `Transport` [`School van`] **15 min drive**
  *Matron Bediako accompanied · arrived 07:02* · **`NHIS` [`Active`] `NHIS-9842-1276-5503` *Card presented at
  ER · valid through Dec 2026 · IV artesunate covered*** · `Parent` Mother — **A. Aidoo** `+233 24 487 6612`
  *Notified by phone 06:50 · 4 min · followed up SMS · last update 14:20* · `Status` **Improving.** *Fever down
  to 37.4°C at 14:00 reassessment...* · `Expected back` **Thu 15 May, afternoon**...
  Actions: `Open case detail` / `Call hospital` / `Message parent` / `Mark returned`.
  Card 2 (K. Boateng): same seven lines with `Follow-up` and `ETA back` variants; **NHIS `NHIS-9842-2208-1144`
  *Consultation + X-ray covered · cast materials **parent-supplied (GHS 80)****; actions `Mark returned` /
  `Open case detail` / `Schedule follow-up` / `Print cast-care card`.
- **Cross-module strip · 3 cards:** `Attendance` — *"Y. Aidoo **marked excused** for Wed, Thu · SCI class
  register and morning attendance auto-flagged. **Teachers see medical · excused without seeing diagnosis.**
  Marks back to normal when matron clears return."* · `Boarding` — *"HMs **notified** · no medical detail ·
  ...see 'student under sickbay care, off-campus' on their dorm rosters. **Diagnosis stays inside the sickbay
  module per privacy default.**"* · `Billing` — *"K. Boateng **GHS 80** cast cost · ...**NHIS-covered items
  don't touch billing.**"*

→ Referral row = **NEEDS SCHEMA** (`sickbay_referral`, FK to the visit + to the setup hospital). Transport
mode, accompanying staff, ward/bed at the hospital, day counter, ETA = all new. **🔴 NHIS × 2 per card.**

### §02 Case detail (`/sickbay/referrals/r-2026-05-14-0817`)
`Y. Aidoo · *severe malaria.*` · lede with ward/bed/vitals trend · actions `Print case`, `Add update`,
`Call parent`. Note panel: *"**'Call parent' is the primary action.** Top right of the page. The matron uses
this surface most often **during a phone call** — she's looking at it while talking."*
Patient header: `Yaa *Aidoo*` · `**Form 3 Science**` · `**Slessor House** · dorm S-12` · `Age **17**` ·
`**HM** Mr E. Akoto`; flags `Severe malaria · P. falciparum` (dx-flag), `NHIS active`,
`SHS-2023-0817 · NHIS-9842-1276-5503`.

- **ER handoff card** (`07:02 · Matron → Dr K. Mensah`) — **two columns, 14 rows total.**
  `Presenting`: `Complaint` *Vomiting + fever since 04:00* · `RDT` **Positive** *taken 06:20* · `Temp` **38.9°C**
  *at sickbay arrival* · `BP` **98/62** · `Pulse` **112** · `SpO₂` **97%** · `Hydration` *Dry mucous · refused
  ORS · re-vomited at 06:35*.
  `Pre-referral care`: `Given` **Paracetamol 1g** *oral 06:25 · spat back at 06:35* · `ORS` *Started 06:22 ·
  refused after 2 sips* · `Reason out` ***Cannot retain oral meds.** Needs IV antimalarial. **Beyond N&MC scope
  for matron-only.*** · `Chronic` *None on register · no known drug allergies* · `Last meal` *Last solid Tue
  dinner 19:30 (12h ago)* · **`Menses` *Not currently · LMP 22 Apr*** · `Travel` *No · in school since term
  start 28 Apr*.
  → **NEEDS SCHEMA** — a structured handoff snapshot frozen at referral time (the note panel calls it
  *"verbatim recall... the clinical handoff that determines whether the receiving doctor wastes time
  re-investigating"*). **`Chronic` is a live read of the chronic register.** **`Reason out` referencing N&MC
  scope ties back to the setup standing orders.** **🔴 menstrual data.**
- **Hospital updates card** (`3 reassessments logged` — 4 rows rendered) — timestamped external clinical
  updates with inline vitals (`08:30` Dr Mensah ward round, IV artesunate 120mg, bloods sent · `11:00` Nurse
  update, temp 38.2°C, pulse 98, **PCV 32% — mild anaemia, not transfusion threshold** · `14:00` Dr Mensah,
  temp 37.4°C, switched to oral artemether-lumefantrine, plan · `15:25` **Latest** — mother visited, brought
  soup).
  → **NEEDS SCHEMA** (append-only external-update log with an author who is not a school user). **🔴 PII.**
- **Parent comms thread card** (`7 events · phone **+233 24 487 6612**`) — row grammar: time + ago / channel
  glyph (`→` call-out, `S` sms-out, `×` call-fail, `←` call-in) / header (direction + actor + **tier tag** +
  duration or delivery state) / body narrative / `ct-note` (**matron's private note**) or `ct-msg` (verbatim
  SMS). 7 rows: outbound call `4m 12s` [`Tier 3 · referral`] + private note · outbound SMS auto-confirm
  [`Tier 3 · auto`] delivered 06:53 with **verbatim body** · **outbound call · no answer** [`attempted`]
  `3 rings` · inbound call `6m 04s` [`Tier 3 · parent-initiated`] (*"Wanted to confirm the **NHIS card** was
  being used — said she didn't want any out-of-pocket"*) + private note · outbound SMS ward update
  [`Tier 3 · update`] · outbound call `8m 31s` [`Tier 3 · update`] + private note · inbound call `2m 47s`
  [`Tier 3 · update`] + note (*"No further action unless overnight call. **Mother has matron's direct
  line.**"*).
  → **NEEDS SCHEMA / partially reuses `notification_log`** (§4 §05 — the same reuse-vs-new decision, now with
  **inbound** events, **call duration**, **failure + retry**, **direction**, **tier**, and a **private matron
  note** field that must never reach the parent). **The private note is a parent-boundary landmine — flag it.**
- **🔴 NHIS reconciliation card** (`Card 9842-1276-5503 · valid Dec 2026`) — head `Itemised costs *· Day 1*` +
  holder line **`NHIS-9842-1276-5503 · A. Aidoo · Yaa Aidoo (minor)`**; table cols `Item` / `Provider` /
  `Coverage` / `Out-of-pocket`; **8 rows** (ER consultation · Malaria RDT confirmation · IV cannulation +
  fluids (3 bags Ringer's) · IV artesunate 120mg × 3 doses · IV paracetamol 1g · FBC + PCV bloods · Ward B bed
  (Day 1 night) · Take-home AL course (6 tablets)), each `NHIS · covered` / `—`; footer **`Total parent
  out-of-pocket` `GHS 0.00`**; green note *"**Clean NHIS case.** All items covered. **No billing module
  entry.** If Day 2 charges arise tomorrow they'll append here; if anything falls outside NHIS, **billing
  module gets a flag and parent gets an SMS before incurring the cost.**"*
  → the itemised-cost table is a **new referral-cost-line table**; the coverage flag is NHIS; the
  billing handoff is an `invoice_line_item` write (**BACKED target**: `fees.ts::invoiceLineItems` has
  `description` + `amount` + optional `feeCategoryId` — a "sickbay referral" fee category covers the tag the
  §05 handoff copy describes).

### §03 Today's parent notifications · timeline (`/sickbay/referrals/notifications`)
`Today's *notifications.*` · lede *"The three-tier rule fired **seven times** today across two referrals, two
admissions, and three discharges. **Every event keyed off the setup-page policy anchor.** One Tier 3
notification is due in 90 minutes."* · actions `Filter by tier`, `Export day`, `Send manual`.

- **Stats strip · 4:** `Tier 1 today` `3 SMS` (*Sickbay admission notify*) · `Tier 2 today` `1 call + SMS`
  (*Inpatient day update*) · `Tier 3 today` `3 phone-first` (*2 referrals · 1 follow-up*) · `Delivery rate`
  `85%` (***1 fail** · retried successfully*).
- **Filter strip:** `All today 7` · `Tier 1 3` · `Tier 2 1` · `Tier 3 3` · `Failed 1` · `Due / queued 1`.
- **Notify timeline · 8 rows** (7 fired + 1 future at reduced opacity): time + ago / tier icon (1/2/3) / line
  (student · class · house · *event* · recipient + channel + duration) / meta (channel pills + **the rule that
  fired**) / tier pill. Notable: `09:45` J. Manu — *"Tier 1 **because of pastoral cross-reference flag** on
  J. Manu's record · auto · delivered 09:46"* (a chronic-register flag **elevating** a notification tier);
  `17:00` future row — *"Tier 3 inpatient day cadence: **06:00, 11:00, 17:00, 21:00** · evening slot due"* with
  pill `Due 17:00`.
- **Failure note (gold):** *"One delivery failed and was retried. Mother's first SMS at 06:52 came back as
  **undelivered** from **MTN** at 06:55 — network issue. **Auto-retry at 07:02 succeeded.** Failed deliveries
  appear in the manual-handling queue per the comms setup defaults."* + `View retry log`.

→ tier engine = **NEEDS SCHEMA** (policy rows from setup §05 + a per-event tier stamp). Delivery status +
provider = **PARTIALLY BACKED** (`notification_log.status/provider/providerRef` covers QUEUED/SENT/FAILED and
the MTN reference; **retry linkage and scheduled/future sends do not exist**). Note panel: *"**Cadence is per
case, not per school.** Y. Aidoo gets 06:00/11:00/17:00/21:00 while inpatient. A discharged outpatient drops to
one final SMS. **Cadence comes from referral status, not a school-wide schedule.**"* → cadence is a per-referral
schedule, not a config constant. **Scheduled future notifications need a queue with a due time** — nothing in
the repo does this today (`notification_log` is fire-and-log). Wells call.

### §04 Referral history · last 30 days (`/sickbay/referrals/history`)
`30-day *history.*` · lede *"**Twelve referrals** in 30 days · ten closed · two still active. Malaria leads at
**seven of twelve** — Semester 2 sits inside Ghana's main malaria season..."* · actions `Export CSV`,
`Export PDF`, `Term report`.
- **Filter strip:** Range `30 days 12` / `90 days 31` / `This term 27` / `This year 68`; Filter `Malaria 7` /
  `SCD 2` / `Injury 1` / `Asthma 1` / `Other 1`.
- **History table** — cols `Date` (+ time) / `Student` (avatar + name + `F3 Slessor · SCI`) / `Diagnosis` (+
  sub) / `Hospital` (+ `4.2 km · primary`) / **`NHIS`** (`Yes` / `Partial` / `Expired`) / `Status` / `Out-of-
  pocket` (amount + status label). **12 rows.** Status vocabulary: `Inpatient · Day 1` · `Returning · today` ·
  `Returned <date>` · `Returned same day` · `Outpatient · returned same day`. Cost-status vocabulary:
  `Covered` · `Parent due` · `Comfort items` · `ORS pack`.
- **Two analysis cards:** `Diagnosis mix · 30 days` (Malaria 7 / SCD crisis 2 / Asthma 1 / Injury 1 / Other 1 +
  note: *"**Malaria sits at 58%.**... Stock projection for AL + RDT kits **on the setup page** is rebuilding
  from this pattern."*) and `Hospital mix · 30 days` (Asankrangwa Govt 12 / Wassa Akropong 0 / St. Martin's 0 /
  KATH 0 + note about single-point-of-failure and the setup fallback).
  → both **derived** from the referral rows once they exist; **empty at launch** (§1.4 #12). The
  diagnosis-mix→stock-procurement link (*"The mix bar isn't analytics — it's a procurement instrument"*) is a
  **read** from the referral log **into** the setup stock page — a genuine two-way surface dependency.
  **`diagnosis` must be a categorised field**, not free text, for the mix bar and the outbreak monitor to work.

### §05 Outstanding reconciliation (`/sickbay/referrals/reconciliation`)
`Outstanding *reconciliation.*` · lede *"Three families carry referral-related balances. **GHS 340.00 total.**
One sits over 30 days and is on the Bursar's chase list... **NHIS-covered items don't show here — only the gaps
NHIS doesn't fill.**"* · actions `Open in billing`, `Print reminders`, `Send SMS reminder`.

- **Recon strip · 3:** `Total outstanding` `GHS 340.00` · **`NHIS-covered (30d)` `GHS 2,180.00`** (*Estimated
  value of NHIS coverage · 10 of 12 referrals fully covered*) · `Average parent-cost` `GHS 28.33` (*trending
  down from **GHS 35** last semester*).
- **Outstanding list · 3 rows** — avatar / name + class / event line / amount + age label / action:
  `J. Tetteh` GHS 215.00 *22 days · over 30d soon* — *"Malaria 22 Apr · **NHIS card expired** at time of
  admission · IV artesunate course + 2-day inpatient · parent informed 22 Apr 16:30"* [`Send SMS`] ·
  `K. Boateng` GHS 80.00 *Today · within window* [`View case`] · `Adwoa Mensa` GHS 45.00 *6 days · within
  window* — *"comfort items + private room upgrade · mother elected upgrade"* [`View case`].
  Note panel: *"**Over-30 changes the tone.** ...at 30 the SMS escalation script changes from courteous
  reminder to formal demand, and at 60 the Bursar adds a phone call. **The age column is the operational
  signal, not the amount.**"*
- **🔴 `NHIS card health across the school` card** (*"Synced from student records"*) — `Active cards`
  **1,108 / 1,200** · `Expired this semester` **52** · `Expiring next 30 days` **31** · `No card on file`
  **40** · `Coverage rate` **92.3%**; warn note: *"**Bursar SMS campaign opens Monday.** Parents of **83
  students** with expired-or-expiring cards get a one-line SMS asking to renew before the 2026/27 academic
  year. **Saves the school GHS 200+ per future malaria referral.**"*
  → **the module's canonical fabricated tile** (§1.4 #10). Zero backing today.
- **`Cross-module handoff` card** (`Sickbay → Billing → Comms`) — *"The matron does not chase money. When a
  referral incurs an out-of-pocket cost, three things happen automatically:"* 1. **Billing module** creates the
  line item against the student's account with a **"sickbay referral" tag**; parent sees it on the next
  invoice. 2. **Comms module** sends a one-line SMS **at the moment of incurring**: *"Referral today incurred
  GHS 80 for cast materials. NHIS-covered items are 0. Details on your statement."* 3. **Reconciliation
  surface** (here) shows open balance, age, SMS history. Gold note: *"**Matron, Bursar, parent — three
  audiences, one source of truth.** ...The SMS at moment-of-incurring is the rule that closes most of the
  disputes before they start."*
  → **the billing hook, fully specified.** Target is **BACKED**: `invoice_line_item` (description + amount +
  fee category). A `"Sickbay referral"` **fee category** is the clean implementation. The SMS is a
  `notification_log` write. **Ageing/over-30 escalation is derived from the invoice**, not stored.

### Write actions (surface 5)
`+ New referral` · `Mark returned` · `Call hospital` · `Message parent` · `Add update` (hospital update) ·
`Call parent` · `Schedule follow-up` · `Send manual` (notification) · `Send SMS reminder` · `Open in billing` ·
`View retry log` · `Print case` / `Print cast-care card` / `Print reminders` / `Export` / `Export CSV` /
`Export PDF` / `Export day` / `Term report` (exports).
**State machine:** `referred → inpatient (day N) → returning → returned` and `outpatient · returned same day`;
plus the notification sub-states `queued → sent | failed → retried`.

### Cross-module touch points (surface 5)
**Attendance** — auto-excused for the referral days, *"Teachers see medical · excused without seeing
diagnosis"*, *"Marks back to normal when matron clears return"* (the **MEDICAL** hook, plus a **clear-return
write**). **Boarding** — house on every row, HM notification without medical detail, *"off-campus"* on the dorm
roster (interacts with the boarding-dashboard in-House count — see §10). **Billing/NHIS** — §02 reconciliation,
§05 outstanding list + card-health tile + the three-step handoff, `Open in billing`, the Bursar as owner.
**Comms** — §03 in its entirety, the tier engine, retry/failure, scheduled sends. **Setup** — hospital list,
standing-order scope (`Beyond N&MC scope`), stock procurement fed by the diagnosis mix. **Chronic register** —
`Chronic` line on the ER handoff, `SCD 2` filter, the pastoral flag elevating a notification tier. **WASSCE** —
none rendered, but an inpatient referral during an exam window is exactly the **SC-12** case (§10).

---

## 7. Consolidated schema gap ledger

**BACKED today (name the table):**

| Element | Table |
|---|---|
| Student identity, code, sex, DOB (→ age), status, programme, residency | `students` |
| Class label / form | `classes` + `students.current_class_label` |
| House name, colour, gender, housemaster | `houses` (incl. `hm_user_id`) |
| Dormitory / bunk (partial — see the `S-12-B` gap) | `boarding_dormitory`, `boarding_bunk`, `bunk_allocation` |
| Sick Bay Prefect designation (display-only, bunk-scoped) | `boarding_bunk.prefect_role = 'SICKBAY'` |
| Parent/guardian name, relationship, phone, primary flag, portal link | `student_guardian` |
| Blood group, allergies, conditions (free text), medications (free text), emergency contact, notes | `student_health_record` |
| Attendance day record + **MEDICAL** status + reason code + note | `attendance_record`, `attendance_status` enum |
| Attendance correction (the append-only-with-amendment idiom to copy) | `attendance_correction` |
| SMS send + delivery status + provider ref | `notification_log` (partial — see gaps) |
| Audit of **writes** (actor, role, action, entity, before/after, reason) | `audit_log` |
| Invoice + line item (the referral-cost billing target) | `invoice`, `invoice_line_item`, `fee_category` |
| WASSCE candidacy + SC-3/SC-7/SC-12 filings | `wassce_candidates`, `waec_special_consideration` |
| Boarding prep attendance (the "excused from prep run" target) | `prep_attendance` |
| Staff user + role (`MATRON` already in `KnownAppRole`) | `ref_user`, `role_assignment`, `ref_role` |
| Boarding day-type axis (reuse for the hours table) | `daily_schedule_template` day-type enum |

**NEEDS SCHEMA (new tables/columns):**

| # | Shape | Serves |
|---|---|---|
| N1 | `sickbay_config` — mode enum (A/B/C), general bed count, isolation bed count, procurement window days | setup §01/§02/§03 |
| N2 | `sickbay_bed` — number, `is_isolation`, active | setup §02, today §01 beds |
| N3 | `sickbay_schedule_slot` — label, description, start/end, staffing, day type, **`is_anchor`** | setup §02, today §02, chronic med grid columns |
| N4 | `sickbay_standing_order` — complaint, first-line treatment, escalation trigger | setup §03; **FK target for the MAR `Source` tag** |
| N5 | `sickbay_stock_item` — name, sub-label, quantity, reorder point, last restocked, **nullable `student_id`** | setup §03 |
| N6 | `sickbay_hospital` — name, `distance_km`, services, notes, `is_primary`, `accepts_nhis`, tags | setup §04; **FK target for every referral** |
| N7 | `sickbay_notification_policy` — tier, trigger, channel(s), window | setup §05; drives surfaces 3/5 |
| N8 | **`sickbay_visit`** — the atom: student, reference (`VR-…`), queued/started/ended timestamps, complaint (free text + **categorised** code), triage level, `recorded_by`, `confirmed_by`, disposition, state | **everything** |
| N9 | `sickbay_vitals` — visit, timestamp, temp, BP, HR, SpO₂, pain 0–10, `taken_by` | visit record §01, today §01, ER handoff |
| N10 | `sickbay_assessment` — visit, working impression, red flags screened, hydration, plan, escalation triggers, `recorded_by` + N&MC stamp | visit record §02 |
| N11 | `sickbay_consult` — visit, clinician (external), mode enum, timestamp, body | visit record §02, referral §02 |
| N12 | **`sickbay_medication_administration`** — append-only; visit, time, drug, dose, route, **source kind enum (Standing/Scheduled/PRN/Doctor-ordered)** + source FK, `administered_by`, `witness_*`, amendment link | visit record §03, today §02 |
| N13 | `sickbay_admission` — visit, bed FK, admitted/discharged timestamps, target discharge, fallback plan | visit record §04, today §01 |
| N14 | `sickbay_discharge_criterion` — admission, text, met/pending, met-at, met-detail (templated from the care plan) | visit record §04 |
| N15 | `sickbay_round` + `sickbay_round_item` — day × slot instance; per student × drug, dispenser, witness, done-at | today §02 |
| N16 | `sickbay_surveillance_category` + threshold pair | today §05 |
| N17 | **`sickbay_care_plan`** — student, condition, condition family, status enum (crisis/monitor/stable/referral-managed), **version**, reviewer, reviewed-at, condition detail, baseline, care goals | chronic register §01/§02 |
| N18 | `care_plan_trigger` / `care_plan_protocol_step` (ordered) / `care_plan_medication` (× round slot, dose, PRN criteria) | chronic register §02 |
| N19 | `care_plan_external_care` — clinical home (DMHU/KATH), schedule, next visit, pastoral home, "what the matron doesn't do" | chronic register §02/§03 |
| N20 | **`sickbay_access_grant`** — grantee (user **or** house-role derivation), student, scope/level enum (9 values), expires_at, reason, granted_by, revoked_at | chronic register §04 |
| N21 | **`sickbay_referral`** — visit, hospital FK, diagnosis (categorised) + detail, ward/bed, attending clinician, transport mode, accompanied_by, departed_at, expected return, status enum, returned_at, HM authorisation | referral log §01/§04 |
| N22 | `referral_handoff` — the frozen ER snapshot (presenting + pre-referral care, 14 fields) | referral log §02 |
| N23 | `referral_update` — append-only external clinical updates | referral log §02 |
| N24 | `referral_cost_line` — item, provider, **NHIS coverage flag**, out-of-pocket amount, billing link | referral log §02/§05 |
| N25 | **NHIS card identity** — number, holder (guardian/household), valid-from/to, status. **Location undecided — owner call (§1.1)** | four surfaces |
| N26 | **Notification extension** — channel enum (phone/SMS/in-app/system), direction (in/out), tier, duration, answered/ack state, retry link, scheduled due-at, **private matron note**, entity link (visit/referral). Reuse-vs-new decision on `notification_log` | visit record §05, referral log §02/§03, today §01/§04 |
| N27 | Parent notification **opt-in preference** (weekly digest) | setup §05 Tier 1 |
| N28 | Follow-up task list — visit/referral, when, owner, text, done | visit record §05, referral log §01 |
| N29 | N&MC licence on the staff profile (`nmc_licence_number`/`_expiry`, or generalise the NTC pair) | setup §01, every clinical signature |
| N30 | Sickbay staff roster attributes — seniority (Senior/Assistant), shift, start year; Health Prefect roster (student, house, seniority, trained-on, rotation) | setup §01 |

**NO CLEAN BINDING — escalate to Kofi/Wells:**

| # | Element | Why |
|---|---|---|
| B1 | `bed S-12-B · lower bunk · near door` | `boarding_bunk` = dorm name + position number. No upper/lower axis, no positional note. Display convention or schema addition? |
| B2 | `5 periods · all classes` attendance excuse | `attendance_record` is one row per student per **day** (`uniq_attendance_student_day`). Per-period attendance does not exist. |
| B3 | **Student as a clinical actor** — prefect records the complaint, witnesses doses; senior prefect holds a medical grant | No student write path; `STUDENT` role has no operational surface; attributable witnessing needs an identity. |
| B4 | **Visiting doctor / hospital clinician as an actor** | Approves care plans, authors consults and ward updates — no `ref_user`, no login. Actor-without-account pattern needed. |
| B5 | **Read logging** (*"every read is in the trail"*) | `audit_log` exists but `lib/db/audit.ts` writes on mutations only. Read-audit is a new behaviour + a volume/retention question. |
| B6 | **7-year retention after the student leaves** | No retention machinery anywhere in the repo. |
| B7 | Grant to a **non-user** (catering supervisor, cook) | Grant table would reference `ref_user`; these people may have no account. |
| B8 | `Notify GHS-Amenfi (district health)` | Outbound to an external body with no channel, no recipient record, no template. |
| B9 | **Scheduled/future notifications** (`Due 17:00`, per-case cadence 06:00/11:00/17:00/21:00) | `notification_log` is fire-and-log; no queue, no due-at, no scheduler. |
| B10 | `11 years here` (staff tenure) | No staff start-date field. |
| B11 | `Immunisation / tetanus check on chronic register` | No immunisation field on `student_health_record` or anywhere. |
| B12 | `VLC Case 2024-VLC-0047` / `Open VLC case` | VLC module unbuilt. |
| B13 | **Deputy Head (Welfare)** as a default-access role | Role does not exist. |
| B14 | `Mode C` degradation of surfaces 2/3 | The setup surface promises the module adapts; no other surface renders a Mode-C state. |

---

## 8. NHIS catalogue — every element, all 24

| # | Surface · section | Element | Verbatim |
|---|---|---|---|
| 1 | today §04 | referral row `NHIS used` | `Yes · valid card` |
| 2 | today §04 | comms thread, hospital handoff | *"NHIS card processed"* |
| 3 | today §04 | note panel | *"**NHIS card status** is captured because cost reconciliation flows downstream to billing"* |
| 4 | visit record §01 | patient flag | `NHIS · active` |
| 5 | visit record §03 | MAR drug sub-line | *"brought from home · **NHIS-supplied** · her own bottle"* |
| 6 | chronic register §01 | summary tile | `NHIS coverage` `5 of 6` — *Yaw B. is private (epi-pen not covered)* |
| 7 | chronic register §01 | note panel | *"Each entry has a daily medication schedule, emergency protocol, **NHIS card detail**, and an emergency parent contact."* |
| 8 | chronic register §02 | patient flag | `NHIS · active` |
| 9 | chronic register §02 | `NHIS & billing` card — **card number** | `8005-4287-6611-09` |
| 10 | chronic register §02 | card status | `active` · *renewed Jan 2026 · valid Dec 2027* |
| 11 | chronic register §02 | coverage list | *"Hydroxyurea, folic acid, penicillin V, paracetamol — **all covered**..."* |
| 12 | chronic register §02 | not-covered list | *"Pulse oximetry consumables (school provides). Private hospital consultations..."* |
| 13 | chronic register §02 | YTD school cost | *"GHS 0.00 to family for routine care · **GHS 340.00 covered via NHIS reimbursement to school stock**"* |
| 14 | chronic register §02 | note panel | *"**NHIS panel reflects Ghana reality.** Card number, expiry, what's covered, what costs the family. SCD is a chronic exemption category in some NHIS interpretations."* |
| 15 | referral log §01 | card 1 NHIS line | `[Active]` `NHIS-9842-1276-5503` — *Card presented at ER · valid through Dec 2026 · IV artesunate covered* |
| 16 | referral log §01 | card 2 NHIS line | `[Active]` `NHIS-9842-2208-1144` — *Consultation + X-ray covered · cast materials **parent-supplied (GHS 80)*** |
| 17 | referral log §01 | note panel | *"**NHIS card number is visible.** Matrons present it physically at ER. Mono-font, copy-pasteable, visible without drilling. **The most operationally important number on the page.**"* |
| 18 | referral log §01 | Billing xmod card | *"**NHIS-covered items don't touch billing.**"* |
| 19 | referral log §02 | patient flags | `NHIS active` + id-flag `SHS-2023-0817 · NHIS-9842-1276-5503` |
| 20 | referral log §02 | parent comms, inbound call | *"Wanted to confirm the **NHIS card** was being used — said she didn't want any out-of-pocket."* |
| 21 | referral log §02 | reconciliation card | header `Card 9842-1276-5503 · valid Dec 2026`; **holder line `NHIS-9842-1276-5503 · A. Aidoo · Yaa Aidoo (minor)`**; 8 itemised rows each `NHIS · covered`; total `GHS 0.00` |
| 22 | referral log §03 | SMS body | *"...Matron Bediako accompanying. **NHIS card with us.**"* |
| 23 | referral log §04 | history table **NHIS column** | `Yes` / `Partial` / `Expired` (per referral) |
| 24 | referral log §05 | recon strip + outstanding row + **card-health card** + handoff copy | `NHIS-covered (30d) GHS 2,180.00` · *"**NHIS card expired** at time of admission"* · **`Active cards 1,108 / 1,200`, `Expired this semester 52`, `Expiring next 30 days 31`, `No card on file 40`, `Coverage rate 92.3%`, "Synced from student records", Bursar SMS campaign 83 students** · *"NHIS-covered items are 0"* |
| — | setup §04 | hospital tags | `NHIS accepted` × 3, `Private · cost` × 1; lede *"NHIS acceptance tracked because **parent cost matters**"* |

**Nothing in this table has a schema home.** The four required shapes and the three-part owner decision are in
§1.1. Until it lands, the **WASSCE precedent applies**: omit the element, do not placeholder, do not fabricate.

---

## 9. Medical-PII inventory (Sarah's gate)

Every element below is clinical or otherwise sensitive. Ordered by sensitivity class.

**Class 1 — clinical diagnosis & assessment (highest)**
`working impression` (visit record §02 — the field is deliberately *not* named diagnosis) · `red flags
screened` (8 negatives listed) · `hydration status` · `plan` · `escalation triggers` · diagnosis strings on the
referral log (`Severe malaria · P. falciparum`, `Mild wrist fracture · right radius distal`, `Suspected
appendicitis · ruled out at ER · gastroenteritis`) · condition names in the chronic register (`Sickle cell ·
HbSS`, `Asthma · moderate`, `Epilepsy`, `Anaphylaxis · peanut`, `Type 1 diabetes`) · the SCD protocol banner ·
condition detail paragraphs · **family history** (*"maternal aunt deceased age 19 from acute chest syndrome"*)
· visiting-doctor consult bodies · hospital ward-round updates.

**Class 2 — mental health (special category)**
`Anxiety · referral-managed` · *"anxiety with sleep disturbance, in context of **bereavement (father, Feb
2026)**"* · DMHU diagnosis *"adjustment disorder with anxiety features"* · **self-harm escalation trigger**
(*"Any disclosure of self-harm thoughts, refusal of food >48hr"*) · VLC case reference · DMHU visit log ·
somatic-presentation watch list · *"What the matron doesn't do"*. **Treat as a separate access tier from
physical health — the surface already does (`Pastoral-only` grant level).**

**Class 3 — measurements, labs, medication**
Vitals: temp, BP, HR, SpO₂, **pain score 0–10** (visit record trend strip + 4-row table; today's bedside tile;
ER handoff) · labs: `RDT positive`, `PCV 32%`, `Hb 7.8 g/dL`, `HbF 11.2%`, `HbA1c 7.4%`, X-ray result ·
**MAR rows** (drug, dose, route, time, administered-by, **witness**, source tag, label/expiry check) ·
chronic medication schedules (hydroxyurea, folic acid, penicillin V, carbamazepine, Keppra, NovoMix 30,
beclomethasone, salbutamol, cetirizine, epi-pen ×2) · discharge-criteria measurements (`850ml total` oral
intake) · `peak flow Mon/Thu`.

**Class 4 — reproductive / intimate**
`Menses · Not currently · LMP 22 Apr` (ER handoff) · `Menstrual cramps` / `period pain` (queue + visit rows) ·
`Menstrual pain` standing order · `Sanitary pads · menstrual supply · school-issued` (stock) · `priapism
(boys)` red flag.

**Class 5 — identifiers & contact**
NHIS card numbers (§8) · student admission numbers · parent phone numbers (**rendered masked in the chronic
register** — a design commitment) · matron's direct line · N&MC licence number · named external clinicians and
their phone numbers.

**Class 6 — inferable-by-proximity (the sneaky ones)**
Bed tile printing `SCD · 5h 31m` next to a name (today §01) · stock row `Hydroxyurea 500mg · for Adwoa Mensa`
(setup §03 — **a diagnosis leak through an inventory table**) · grant-table rows whose `Reason` column states
the condition (`Life-threatening allergy`, `Nocturnal seizure risk`, `Hypoglycaemia risk`) · the chronic-
register avatar-stack showing *who* can see a record · a Tier-1 notification firing *because of* a pastoral
flag (referral log §03) · `Filter by house` on the visits log (small houses → identification).

**Deliberate non-disclosure the design already encodes — preserve verbatim:**
*"student in sickbay (medical detail withheld)"* · *"Please flag classmates if they ask, **no medical detail to
share**"* · *"student under sickbay care, off-campus"* · *"Teachers see **medical · excused** without seeing
diagnosis"* · *"Class teachers see **'M' not 'A'**"* · *"cook informed of peanut exclusion only — not medical
detail"* · *"Do not display in dorm common area — medical privacy applies"* · *"**Diagnosis stays inside the
sickbay module per privacy default.**"*

**The three boundary decisions this forces: §1.2.**

---

## 10. Cross-module touch points (module-level roll-up)

### 10.1 Attendance — the **MEDICAL "M"** hook (the board's headline hook for 4.4)
**BACKED.** `attendance_status` enum already carries `MEDICAL`; `attendance_record` carries `reason_code` and
`note`; the repo memory rule *"keep all 5 statuses (P/L/E/M/A); Medical = navy-2"* is already honoured in
`lib/attendance-status.ts`.
Stated on three surfaces: *"Attendance auto-excused for the day"* (visit record §02); *"attendance flags
'excused (sickbay)'"* (visit record §05); *"Days admitted to sickbay register as excused medical absence
automatically. **Class teachers see 'M' not 'A'**"* (chronic register §02); *"marked excused for Wed, Thu ·
Teachers see medical · excused without seeing diagnosis · **Marks back to normal when matron clears return**"*
(referral log §01).
**Design commitments to preserve:** (a) the write is `status = MEDICAL`, `reason_code = 'MEDICAL'` (or a
sickbay-specific reason), and the **note must not carry the diagnosis**; (b) the referral case has a
**clear-return** write that stops the auto-excuse; (c) `5 periods · all classes` has no binding (B2).
**Also touches** `prep_attendance` (boarding) — *"excused from tomorrow's 06:00 prep run auto-applied to
roll-call"*.

### 10.2 Boarding — house, dorm, bunk, housemaster, prefect
House on **every** student row across all five surfaces (**BACKED** via `students.house_id` → `houses`).
Housemaster identity **BACKED** via `houses.hm_user_id` — and the chronic register's *"HM grants are
role-based, not personal... auto-transfer to the new HM"* means the grant should **derive** from that column.
Dorm/bunk **partially backed** (B1). Sick Bay Prefect **partially backed** via `prefect_role = 'SICKBAY'`.
HM auto-notification on admission (today §01 strip; chronic register *"within 5min"*) — a real write.
`Filter by house` on visits. *"student under sickbay care, off-campus"* on the dorm roster.
⚠️ **Board interaction:** `senior-build-plan.md` OQ5 already ruled *"in-House (on-premises) = active BOARDERs −
DEPARTED-on-exeat; **sick-bay is NOT subtracted** (sickbay is on-site, still 'in House')"*. **A referred-out
student, however, is genuinely off-campus** — surface 5 says so explicitly (*"off-campus"* on the dorm roster).
When 4.4 ships, the in-House formula needs revisiting for **referrals** (not for sickbay admissions). Flag to
Kofi.
Also: the setup hours table's day-type axis should reuse `daily_schedule_template`'s enum; "HM exeat slip"
soft-references `boarding_exeat`; "monthly inspection in boarding" soft-references `inspections`.

### 10.3 WASSCE — SC-7 / SC-12 and exam fitness
**BACKED targets.** `wassce_candidates` + `waec_special_consideration` (`sc_form` = `SC-3` | `SC-7` | `SC-12`,
with a full workflow status enum) already exist.
- Chronic register §01 tile `WASSCE candidates 2 of 6 · examination accommodations on file` → a join to
  `wassce_candidates` + the candidate's SC filings. **Real, buildable, no new schema.**
- Chronic register §02 `Care goals` → *"Examination accommodations for end-of-term: **extra time, separate
  room, water bottle access**"* and §04 grant row `S. Henneh · Class teacher · F1 SCI · exam accommodations
  only · Exam-only · expires 31 Jul 2026` → **SC-7 (chronic-condition extra time)** is exactly this shape.
- An **inpatient referral during an exam window** is the **SC-12 (in-window medical disruption)** case. The
  build plan already records this: *"**Sickbay→SC-12 auto-suggest (Decision 9)** ... DEFERRED to 4.4 Sickbay;
  INCR-17 ships SC-12 as **manual filing**; auto-suggest is a later **app-layer cross-module call (never a
  trigger)**"* (line 2086). **4.4 is where that debt comes due.** The referral row is the trigger source; the
  call must be an app-layer suggestion, not a DB trigger.
**Recommendation:** ship the chronic-register↔WASSCE read in the chronic-register increment (cheap, real), and
scope SC-12 auto-suggest as an explicit line item in the referral increment.

### 10.4 Billing / NHIS
Referral log §05's three-step handoff is fully specified: **billing line item** (`invoice_line_item`,
description + amount + a `"Sickbay referral"` **fee category** — **BACKED target**), **comms SMS at moment of
incurring** (`notification_log`), **reconciliation view** (derived from the invoice, with the age column as
the operational signal). Negative case on the visit record: *"School stock only · no charge · within sickbay
standing supply"* — the hook must be able to record **no** billing event.
NHIS: §8, entirely unbacked. The `NHIS card health` tile and the **Bursar renewal campaign** make NHIS look
like a **billing-owned field with a sickbay reader**, which argues for putting it on the household/guardian,
not the student.

### 10.5 Communications
The **three-tier rule** (setup §05) is the policy anchor for every notification on surfaces 2/3/5.
`notification_log` covers SMS send + delivery status + provider ref. It does **not** cover channel, direction,
tier, call duration, acknowledgement, retry linkage, scheduled sends, or the matron's private note (N26, B9).
*"Mother's number is locked at parent record; **no manual entry per visit**"* → `student_guardian` (**BACKED**,
and a good constraint: never let the matron type a phone number).

### 10.6 Parent portal (INCR-19a)
Setup §05 Tier 1: *"Visible in parent portal · **weekly digest if opted in**"*. The parent portal exists
(`app/(parent)/`) and currently **omits sickbay entirely** because 4.4 is unbuilt (build plan line 2336).
4.4 must make the parent-boundary decision explicit and add the opt-in preference (N27). Nothing in the module
should reach the parent scope by default.

### 10.7 Discipline / VLC
**Discipline:** nav-only. No sickbay↔discipline data flow on any of the five surfaces. (The repo's
discipline→billing hook is unrelated.)
**VLC:** the chronic register's pastoral section depends on it and it is unbuilt (B12).

---

## 11. Recommended increment grouping

**Schema spine = Setup + Visit record.** They are inseparable: the MAR's `Source` tag is an FK into setup's
standing orders, the disposition's bed is an FK into setup's bed table, the round schedule reads setup's hours
table, and the referral hospital is a setup row. Building the visit record first would mean inventing
placeholder config; building setup first alone ships zero operational value.

| Increment | Surfaces | New tables (from §7) | Gates | Why grouped |
|---|---|---|---|---|
| **A — Sickbay spine** | **Setup** + **Visit record** | N1–N7 (config), N8–N14 (visit atom), N29, N30 | `SICKBAY_ROLES`; Sarah's **first medical-PII gate** (vitals, MAR, working impression); the **attendance MEDICAL write**; the append-only/amendment idiom | The config and the atom are FK-coupled. Ships a matron who can configure her sickbay and record a complete visit end-to-end. Attendance "M" — the board's headline hook — lands here. |
| **B — The live view** | **Today** | N15 (rounds), N16 (surveillance) | Rounds read A's config + C's schedules → **ship B's round roster reading setup only, and enrich after C**; queue-state transitions; HM auto-notification | Pure projection of A plus two small tables. Low schema risk, high operational payoff. No new PII class. |
| **C — Chronic register** | **Chronic register** | N17–N20 (care plans + grants), extends `student_health_record` usage | **Sarah's heaviest gate**: per-field grants, read-audit (B5), 7-year retention (B6), mental-health tier, student-as-grantee (B3/B7), parent boundary. **Blocked on the NHIS decision (§1.1).** Delivers the **WASSCE SC-7 read** | The access-grant + audit subsystem is a self-contained security deliverable. Care plans then feed B's rounds and A's discharge-criteria templates as an enrichment, not a dependency. |
| **D — Referral log** | **Referral log** | N21–N24, N26 (notification extension), N28 | Largest cross-module blast radius: billing line-item write, comms tier engine + scheduled sends (B9), the boarding in-House formula revisit, **SC-12 auto-suggest**. **Blocked on the NHIS decision.** | A referral is a visit disposition — it cannot precede A. It touches billing, comms, boarding, attendance-clear-return and WASSCE at once, so it should land last with everything else stable. |

**Variant if the owner wants a smaller first slice:** split A into **A0 = Setup only** (config tables, near-zero
PII, cheapest Sarah gate, gives Wells the enums and the migration early, and lets the boarding dashboard's
`LIGHT·PLACEHOLDER` override start winding down) and **A1 = Visit record**. The cost is one extra increment
boundary; the benefit is that the module's riskiest gate (clinical PII) is isolated in A1 rather than bundled
with config review.

**Hard sequencing constraints:**
1. **NHIS owner decision (§1.1) before C.** Both C and D render NHIS prominently; without the ruling both
   surfaces ship with visible holes.
2. **Parent-boundary ruling (§1.2) before C.** The chronic register defines the default-access set and the
   grant levels; the parent scope has to be one of them (or explicitly excluded).
3. **Role ruling (§1.3) before A.** `SICKBAY_ROLES` gates every route in the module.
4. **Read-audit ruling (B5) before C.** It changes whether every page load in the module writes a row.
5. **Do not build any element in §1.4 as data.** Especially the `NHIS card health` tile (#10) — it is this
   module's STPSHS matrix.

---

## 12. Open questions for the module owner / Kofi / Wells / Sarah

| # | Question | Owner |
|---|---|---|
| Q1 | **NHIS**: student, household, or guardian? In scope for 4.4 or OMIT per the WASSCE precedent? Billing-owned with a sickbay reader? | **Owner** |
| Q2 | **Parent boundary**: which of {visit occurred, complaint, diagnosis, vitals, MAR, NHIS itemisation, cost} reaches `app/(parent)/`? | **Owner + Sarah** |
| Q3 | `SICKBAY_ROLES` membership; and do `Deputy Head (Welfare)` / `School Nurse` / `Assistant Matron` become roles, attributes, or nothing? | Kofi |
| Q4 | **Student-as-clinical-actor** — prefect intake recording, dose witnessing, senior-prefect grants. Allow with attribution, allow un-attributed, or drop from 4.4? | Sarah + Kofi |
| Q5 | **Visiting doctor / hospital clinician** — actor-without-account pattern, or a real `ref_user`? | Kofi |
| Q6 | **Read logging** — `audit_log` with `actionType='viewed'`, a separate read log, or drop the "every read is logged" claim? Volume and retention implications. | Sarah + Wells |
| Q7 | **7-year retention after the student leaves** — build it, or restate the copy? | Wells |
| Q8 | **`notification_log`**: extend (channel/direction/tier/duration/ack/retry/scheduled/entity link/private note) or add a sickbay-scoped notification table? | Wells + Kofi |
| Q9 | **Scheduled notifications** (per-case cadence, `Due 17:00`) — is there any scheduler in the stack, or does the matron fire manually in 4.4? | Wells |
| Q10 | **`bed S-12-B · lower bunk`** — display convention or a `boarding_bunk` addition? | Kofi |
| Q11 | **`5 periods · all classes`** — restate as day-level (recommended) or escalate per-period attendance? | Kofi |
| Q12 | **Mode C (referral-only)** — in 4.4 scope? If yes, every surface needs a Mode-C degradation spec. | Owner |
| Q13 | **Pastoral / mental health** — ship the `referral-managed` status without VLC (recommended), or defer the whole pastoral section to VLC? | Owner |
| Q14 | **Triage vocabulary** — only `Routine` appears. What is the full ladder? | Kofi |
| Q15 | **Diagnosis/complaint categorisation** — the outbreak monitor and diagnosis-mix bars both need a categorised field, not free text. Fixed category list, or school-configurable? | Kofi |
| Q16 | **Stock item → student link** (`Hydroxyurea · for Adwoa Mensa`) — a nullable FK on the stock row (leaks a diagnosis into inventory), or a join through the care plan? | Kofi + Sarah |
| Q17 | **In-House count** — a *referred-out* student is off-campus; the OQ5 ruling only exempted sickbay admissions. Revisit the boarding formula? | Kofi |
| Q18 | **SC-12 auto-suggest** — in the referral increment, or deferred again? (App-layer call, never a trigger.) | Kofi |
| Q19 | Sub-nav labels + whether `Visit record` is a nav item (recommend a `/sickbay/visits` list) + sectioned nav at 16 items. | Owner (design) |
| Q20 | Which demo cast survives into the maps — the today-surface referral (D. Sarpong) or the referral-log cast (Y. Aidoo / K. Boateng)? Recommend the latter. | Lucy (resolve in the 1:1 maps) |

---

**Next step:** with Q1–Q4 answered, I produce the 1:1 surface map for **Increment A (Setup + Visit record)**
in the shape of `docs/senior/ledger-surface-map.md` — sections in order, every copy string, per-element token
and typography, all interaction states, responsive/PWA variants, and the cross-module hooks bound to real
tables.
