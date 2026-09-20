# OC-SEN-MULTI-CATEGORY (R445) — Domain ruling + acceptance criteria

**Author:** Kofi (Domain / Spec Steward) · **Status:** ruling, ready for Wells (schema) + Claude Code (build) · **Series:** GOV10-41..55 (continues GOV10-40) · **2026-08-10**

**The question:** a child may have more than one special-educational-need (e.g. hearing + intellectual). `sen_register` today allows exactly one category per student (`unique(school_id, student_id)`, single NOT-NULL `category`). Does the GES/EMIS annual census §5 count such a child **once** (a single primary/most-significant category → the honesty invariant `total == Σ12 == distinct` holds) or **in each applicable category** (incidence → `distinct headcount` and `Σ12` legitimately diverge)?

---

## 1. Instrument finding (what I consulted — and did not confirm)

I attempted to reach the authoritative GES/EMIS instruments named in `OC-CENSUS-FORM` (top of `docs/governance-census-build-plan.md`):

- **`home.moegh.com`** (EMIS MOE Ghana) — the School Census Manual and the Basic/SHS Student data-collection templates are **download-gated behind the portal**; the fetched page exposes navigation only, not the special-needs section's field structure or its recording instruction.
- **Ghana Annual Schools Census microdata** (`microdata.statsghana.gov.gh` catalog 62) — the catalogue lists the questionnaire sections (identification, enrolment by grade/sex/age, …) but the disability/SEN variable list and its recording rule are **not exposed** without downloading the DDI/PDF; the data dictionary page did not render the disability variables.
- **GES Special Education Division** page and secondary literature — confirm Ghana recognises a per-type taxonomy (sight / hearing / speech / physical / intellect / emotional / other, aligned to the 2010/2021 population-census disability domains) and that the Division operates "seven units" across disability categories, but **none states the school-census multi-disability recording rule**.

**I could not read the exact §5 instruction ("record the primary/most-significant disability" vs "count under each type"). I will not assert it.** What the evidence supports, without resolving the count rule:

- The EMIS `reporting.php` disability domain is a **per-type × sex aggregate headcount** (a grid of counts), not a per-pupil unit record.
- The evidence genuinely **splits**: Ghana's population-census disability module is a per-domain instrument where an individual can be recorded under multiple domains (leans **incidence**); but an aggregate *school* census that must reconcile a "total pupils with SEN" line against enrolment conventionally uses **count-once** (a "primary/most-significant" rule and/or a dedicated "Multiple disabilities" bucket), because pure incidence makes the type-sum exceed the SEN headcount and breaks that reconciliation.

**This split is exactly why the §5 count rule is a genuine owner/GES call, not something I should invent.** It is flagged as `OC-SEN-MULTI-CATEGORY-CENSUS-COUNT` in §7.

---

## 2. Ruling — decisive where I can be, stop-and-ask where I can't

The two sub-questions decouple, which unblocks the build:

- **The DATA-MODEL question ("can a child hold >1 category?") is decidable now: YES.** A child clinically can, and the register must be able to record it. Wells builds multi-category storage.
- **The CENSUS-COUNT question ("does §5 count once or per-type?") is the honesty-critical one, and is the part that is gated/ambiguous.** I rule the **buildable default = (A) primary-category (count once)** and require the data model to be **forward-compatible with incidence**, so the owner's later confirmation flips *only the reader + labels*, never the schema or a migration.

### RULING (census model): **(A) primary-category — §5 counts each SEN student exactly ONCE.**

§5 counts each SEN student once, under a single designated **primary / census category**. The honesty invariant `total == Σ(the 12 cells) == distinct SEN headcount` (the correctness note in `lib/reports/census/sen-data.ts`) is **preserved unchanged**. Additional categories are **OPERATIONAL only** — visible to the admin and to a granted teacher, **never summed into §5**, the census PDF, the CSV export, or the 12-cell hero grid.

**Why (A) is the right default, not a guess:**
1. It is **correct under the most likely instrument reading** for an aggregate school census (primary/most-significant, or a distinct "Multiple" bucket — both count once).
2. It is the **only model that keeps every already-shipped honest surface honest with zero de-id-contract change** — GOV-8/9 §5 auto-fill, the census PDF §5 (`lib/pdf/census-document.tsx` `SpecialNeeds`), the CSV `Total` row (`app/api/sen/census-export/route.ts`), the not-adopted hand-fill (`census-return.hand_fill.specialNeeds`, a count-once partialRecord), and the admin hero (`{totalWithNeeds} of {totalEnrolment}` + "12 of 12 cells") all remain true verbatim.
3. The data model I require below is **forward-compatible**: if the owner/GES later confirms incidence, only the §5 reader flips to sum-all + two labelled numbers (§7 fallback, spec'd in GOV10-55). No schema change, no data migration — because every category is already stored.

Building incidence now would instead *break* the shipped invariant and every §5 surface's labelling for an **unconfirmed** benefit — the wrong trade under the honesty rule.

### 2.2 Honesty adaptation (what each number means; how it must be labelled)

Under the (A) default, `total` retains its exact current meaning — **"students with recorded support needs" = distinct SEN headcount = Σ12** — and every existing label stays true and unchanged. The adaptation is a set of *guards* so nothing can silently start claiming Σ12 == headcount when a divergent (operational-incidence) figure is on screen:

- The secondary/operational categories must **never** appear in any §5-facing artefact (census PDF §5, CSV export, 12-cell hero grid, not-adopted hand-fill). They appear only in the admin detail record and the grantee card.
- Any **admin-only operational tally** that includes secondary categories (e.g. category filter-pill counts) MUST be **labelled distinctly from the census count** — e.g. hero "students with recorded support needs" = distinct headcount; a category-incidence tally, if shown, reads "support needs recorded across students" — so a viewer can never read an incidence sum as the headcount.
- If incidence is EVER adopted (§7): §5 must present **two separately-labelled numbers** — "Students with support needs (headcount): N" and "Support-need incidences by category (a child with more than one need is counted in each): Σ ≥ N" — and the 12-cell caption changes from an implied "sums to headcount" to "a child may appear in more than one cell." `total` and `Σ12` must never share one label once they diverge.

---

## 3. Data-model requirement for Wells (I rule the requirement; Wells picks the DDL)

**Keep ONE parent `sen_register` row per (school × student). `unique(school_id, student_id)` STAYS.** Do **not** switch to multiple `sen_register` rows per student — that would ripple through consent, the detail cluster, the grantee filter, the candidate picker (`getSenCandidateStudents` keys off `isNull(senRegister.id)`), and the census invariant. The one-parent-row model is load-bearing; multi-category is an *attribute set on that row*, not extra rows.

- **Primary/census category:** the existing `category` column (NOT NULL, `senCategoryEnum`) becomes the designated **primary / census bucket**. NOT-NULL is preserved (R409 — a PENDING row still needs its census bucket).
- **Secondary categories:** zero-or-more per student, each from the same 6-value `sen_category` enum, each **distinct from the primary and from each other** (a student never carries a category twice). **Wells picks the mechanism.** My lean, on the laziest-safe rung: a **`secondary_categories` enum array column on `sen_register`** — no new table ⇒ no new migration-of-a-table, no new RLS policy, no new prod-paste, no composite FK. A child table (`sen_register_category`) is warranted *only* if per-category detail is ever needed — my §3 detail ruling says it is not, so the array is sufficient. (If Wells prefers the child table for enum-array ergonomics, it carries **only** `(school_id, student_id, category, is_primary)` — never a detail column.)
- **The DETAIL cluster is PER-STUDENT, not per-category.** Severity, the diagnosis cluster (`diagnosis_source`/`diagnosing_clinician`/`diagnosing_institution`/`diagnosis_year`), `support_notes`, `accommodations`, `consent_state`, `consent_on_file_at` stay exactly where they are — on the parent row, one per child. A child's consent and dossier are about the child, not replicated per impairment; R408 already bars severity from the census and R417 bars clinical granularity, so per-category severity is out of scope. (`OC-SEN-CATEGORY-DETAIL-GRANULARITY`, §7, if a school ever asks.)
- **Census reader:** `getCensusSpecialNeeds` / `aggregateCensusSpecialNeeds` (`lib/reports/census/sen-data.ts`) read the **primary category only** → still exactly one `(category, sex)` per student → the invariant and the sole-content-path (it reads no detail column) are **untouched**. Only the *selection* changes (read `category` = primary), not the aggregation logic or the `sen-data.ts` correctness note.

---

## 4. Grantee card (ties OC-SEN-TEACHER-SURFACE, Lucy in parallel)

A granted teacher plans accommodations for the **whole child** → the grantee sees **all** of a multi-category student's categories (primary + secondary), not just the census-primary. Categories are **not** the diagnosis cluster, so the R436 accommodation-only exclusion is unchanged: `SenAccommodationRecord` still carries **no** diagnosis field; its `category: SenCategory` widens to the full category set (e.g. `categories: SenCategory[]`, or `category` + `secondaryCategories[]`). A teacher accommodating a deaf-and-intellectually-disabled pupil needs both to plan honestly. The admin detail record (`SenRecord`) likewise shows the full set with the primary flagged.

**Implementer reconciliation (Claude Code note, not Kofi's words):** the DETAIL (severity / support_notes / accommodations) is PER-STUDENT (this §3 ruling), so the grantee card is ONE student card carrying MULTIPLE category pills + the SINGLE per-student severity/notes/accommodations — NOT per-category detail blocks. On the **grantee** card the categories render UNIFORMLY (no primary marker) — the primary/secondary split is a census concept with little teaching value, and a teacher plans the whole child (this matches Lucy's grantee design language). The primary flag lives on the **admin** register table only (GOV10-52), where it is a `title="Primary (census) category"` marker on the solid pill vs muted secondary pills. Lucy's surface-map assumed per-category detail; this ruling supersedes that part. The rest of Lucy's card anatomy (identity header, pills, notes block, tags, states, privacy strip, responsive) stands.

---

## 5. PENDING consent under multi-category

R410's minimal-row holds **per student** (consent is per-student, not per-category):

- Categories — primary **and** secondary — are **census/operational tags, not the sensitive detail cluster**. The `sen_register_pending_no_detail` CHECK gates only severity + the diagnosis cluster + support_notes + accommodations; **it is unchanged and continues to permit a full category set on a PENDING row** (all detail NULL). If Wells uses a child table, it holds only `(student, category)` — census-bucket data, no detail — so no CHECK is needed there.
- A PENDING multi-category student contributes their **primary category to §5, counted once, with no detail** (exactly as today via `sen-data.ts`), never appears in the admin detail table or the grantee card (grantee excludes PENDING, R436), and their stored secondary categories are withheld from every detail/grantee surface just like the rest of the PENDING row until consent is GRANTED.

---

## 6. Backfill / migration safety

Every existing single-category `sen_register` row **remains valid with no data entry**: its `category` becomes the primary/census category and its secondary set is empty. Nothing is orphaned. The §5 aggregate over the pre-existing rows is **byte-identical** to pre-migration (each student → one primary category → one `(category, sex)`), so GOV-8/9 §5 auto-fill, the census PDF, the CSV export, and every shipped SEN/census test stay green with no fixture change. This is a hard migration requirement, not an aspiration.

---

## Acceptance criteria (GOV10-41 .. GOV10-55)

**Data model (Wells):**

- **GOV10-41** — Given a school with two SEN students, when both are recorded, then `sen_register` holds **exactly one parent row per (school, student)** and `unique(school_id, student_id)` still rejects a second parent row for the same student. Multi-category is stored as an attribute set on that one row (or a detail-free child table), never as a second `sen_register` row.
- **GOV10-42** — Given any SEN record (GRANTED or PENDING), then its `category` column (the **primary/census** category) is NOT NULL and holds exactly one `sen_category` value.
- **GOV10-43** — Given a student recorded with primary=HEARING and secondaries {INTELLECTUAL}, then the store accepts it; and given an attempt to add a secondary equal to the primary, or a duplicate secondary, the write is rejected (each category appears at most once per student).
- **GOV10-44** — Given a multi-category student, then the DETAIL cluster (severity, diagnosis cluster, support_notes, accommodations, consent_state, consent_on_file_at) is stored **once per student**, not per category; no detail column is stored against a secondary category.
- **GOV10-45** — Given a PENDING student with primary + secondary categories, then the `sen_register_pending_no_detail` CHECK still passes (categories are not detail) while every detail-cluster column is NULL; and adding any detail value to a PENDING row is still rejected.

**Census count (the (A) default):**

- **GOV10-46** — Given the owner has NOT confirmed incidence, when §5 is generated, then `getCensusSpecialNeeds`/`aggregateCensusSpecialNeeds` count each SEN student **exactly once under their primary category**; secondary categories are never read into §5.
- **GOV10-47** — Given a fixture containing at least one multi-category student, when §5 is aggregated, then `total == Σ(the 12 cells) == distinct SEN student headcount`. (A mutation that sums secondary categories into §5 must turn this test RED.)
- **GOV10-48** — Given the census reader, then it projects `(primary category, sex)` only and never a detail column or a secondary-category detail; the GOV10-18 SEN sole-content-path sweep `offenders` set is unchanged (`["lib/sen/register-data.ts"]`).

**Honesty labelling:**

- **GOV10-49** — Given the (A) default, when §5 renders on the admin hero, the census PDF `SpecialNeeds` section, the CSV export `Total` row, and the not-adopted hand-fill, then every count-vs-headcount claim ("`{totalWithNeeds} of {totalEnrolment}`", "12 of 12 cells", "counts by category × sex", the CSV `Total`) remains true because Σ12 == headcount; no surface gains a caption or total that conflates Σ12 with headcount in a way that would become false under incidence.
- **GOV10-50** — Given an admin-only operational tally that includes secondary categories (e.g. category filter counts), then it is labelled distinctly from the census/headcount count so a viewer cannot read an incidence sum as the headcount.

**Grantee + admin display:**

- **GOV10-51** — Given a teacher holds a live grant on a multi-category student, when the grantee card renders, then it shows **all** of that student's categories (primary + secondary) and still shows **no** diagnosis-cluster field (R436 unchanged); `SenAccommodationRecord` remains structurally diagnosis-free.
- **GOV10-52** — Given the admin register table, when a multi-category GRANTED student renders, then all their categories show with the primary flagged.

**PENDING:**

- **GOV10-53** — Given a PENDING multi-category student, then they contribute their **primary** category to §5 (counted once, no detail), never appear in the admin detail table or the grantee card, and their secondary categories are withheld from every detail/grantee surface until consent is GRANTED.

**Backfill:**

- **GOV10-54** — Given existing single-category `sen_register` rows, when the migration runs, then each row's `category` is its primary/census category with an empty secondary set, nothing is orphaned, no data entry is required, and the §5 aggregate over those rows is byte-identical to pre-migration (GOV-8/9 §5, the PDF, the CSV, and all existing SEN/census tests stay green with no fixture change).

**Incidence fallback (only if the owner confirms `OC-SEN-MULTI-CATEGORY-CENSUS-COUNT` = incidence):**

- **GOV10-55** — Given the owner confirms GES §5 is incidence, then the ONLY change is the §5 reader + labelling — **no schema change, no data migration**: `getCensusSpecialNeeds` sums **all** categories (primary + secondary) per student; §5 presents two separately-labelled numbers — "Students with support needs (headcount): N" (distinct) and "Support-need incidences by category: Σ ≥ N" (Σ12) — and the 12-cell caption reads "a child with more than one need is counted in each applicable cell"; `total` and `Σ12` are never conflated under one label. (`CensusSpecialNeeds.data` is `z.unknown()` at the jsonb boundary, so this is a type-widen with **no `CENSUS_SNAPSHOT_VERSION` bump**.)

---

## 7. Residual owner open-calls

- **`OC-SEN-MULTI-CATEGORY-CENSUS-COUNT` (the live one — owner is the domain authority).** The GES §5 count rule (primary vs incidence) could not be confirmed from the gated instrument. **Recommend: PRIMARY (count once)** — it is the invariant-preserving default (GOV10-46/47) and the data model is built forward-compatible so incidence is a reader-only flip (GOV10-55). Owner confirms against the actual School Census template (or an EMIS contact), ideally checking whether the real template carries a distinct **"Multiple disabilities"** bucket — if it does, that bucket *is* the instrument's count-once mechanism and would fold into `OC-SEN-TAXONOMY` as a 7th category rather than incidence.
- **`OC-SEN-CATEGORY-DETAIL-GRANULARITY`** — whether severity/accommodations are ever needed *per category* (would move secondaries from an array column to a child table). **Recommend: defer** — per-student detail suffices; R408/R417 bar per-category clinical granularity.
- **`OC-SEN-PRIMARY-DESIGNATION`** — how the primary/census category is chosen among a student's categories. **Recommend: the recorder designates it** (default = the first/most-significant category entered on the record form); no automated "most significant" inference (we hold no severity ordering to justify it, and severity is out of the census).
- Ties into the standing **`OC-SEN-TAXONOMY`** (real GES template may enumerate a finer list, incl. a "Multiple" bucket) — unchanged.

---

## Handoff notes

- **Wells (schema):** GOV10-41..45 + GOV10-54. Keep one parent row per student + `unique(school_id, student_id)`; `category` stays NOT-NULL primary; add a **detail-free** secondary-category mechanism (lean: `secondary_categories` enum array on `sen_register` — no new table/RLS/prod-paste); the `pending_no_detail` CHECK is unchanged. Backfill is a no-op for existing rows.
- **Claude Code (build):** GOV10-46..53 + GOV10-55. Census reader reads primary only (invariant intact, sole-content-path untouched); admin/grantee surfaces show the full category set; PENDING minimal-row holds per student. Do not touch §5 labels under the (A) default; GOV10-55 is dormant until the owner flips `OC-SEN-MULTI-CATEGORY-CENSUS-COUNT`.
- **Blocking status:** the build is **UNBLOCKED** under (A). The owner open-call `OC-SEN-MULTI-CATEGORY-CENSUS-COUNT` only chooses between two fully-spec'd §5 behaviours, and the data model ships forward-compatible with both.
