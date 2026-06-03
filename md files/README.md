# Omnischools Design System · Surface Index

> **116 high-fidelity HTML surfaces** designed across multiple sessions for Omnischools, a multi-tenant SaaS school management system for Ghanaian education. Three product lines on one codebase and one operational database.

**Product lines:**

| Product | Audience | Launch |
|---------|----------|--------|
| **Omnischools Basic** | KG, Primary, JHS | MVP1 · launching first |
| **Omnischools Senior** | SHS, SHTS | MVP2 · after Basic is in market |
| **Omnischools Oversight** | GES district/regional directors, MoE staff | After Senior has data flowing through real SHSs |

All three sit on the same Next.js codebase. Operational data lives in one Postgres database with school-level RLS. Oversight reads from a separate analytics database, populated nightly via ETL, never touches raw operational records.

This is the design spec. Each `.html` file is a complete, viewable, self-contained surface with editorial notes documenting design decisions in the right-hand `.notes` panel. Treat the HTML as the source of truth for visual and interaction design — it should be fed to Claude Code as build reference.

---

## How to read this index

Every surface is tagged on three axes:

- **Role** · who uses it (Admin · Teacher · Parent · Student · Multi · System)
- **Module** · which functional area it belongs to
- **Tier** · build priority (see Tier definitions below)

### Tier definitions

| Tier | Meaning | Build window |
|------|---------|--------------|
| **MVP1** | Launch-blocking for Omnischools Basic · ship for first paying basic/JHS school | Day 1 |
| **MVP2** | Post-launch within 6 months · scope for early customers' next ask | Months 2–6 |
| **Tier 3** | Communication depth surfaces · richer parent/admin loop | Month 3+ |
| **Tier 4** | Operational parity · trust artefacts the MoE and auditors expect | Month 4+ |
| **SHS · Batch 0** | Structural foundation for Omnischools Senior · new tables and refactors to Basic | Before any further SHS work |
| **SHS · Modules** | PTA, PLC/CPD, VLC, Boarding, WASSCE — each its own batch | After Batch 0 |
| **Oversight** | GES/MoE-facing surfaces · separate app, separate analytics DB | After Senior has live data |
| **Deferred** | Designed for completeness · launch decision per surface | Case-by-case |

### Role definitions

| Role | Who | Primary device |
|------|-----|----------------|
| **Admin** | Headteacher, accountant, school office | Desktop primary, mobile secondary |
| **Teacher** | Class teacher, subject teacher | Mobile primary (in-class), desktop secondary (planning) |
| **Parent** | Mostly basic-phone, SMS-first | SMS as primary, smartphone web app secondary |
| **Student** | JHS/basic age | Web view, often shared device |
| **Multi** | Spans multiple roles | Various |
| **System** | Cross-cutting concerns | Various |

### Navigation conventions

Design system conventions for sidebar and multi-step nav are documented in `BUILD_STACK.md` under "Navigation conventions · architectural decision worth preserving." In summary: **flat nav by default** (used in the large majority of the 103 surfaces); **sectioned nav only when the sidebar exceeds twelve items**, using canonical section labels in a fixed order — the operational app uses **Academic / Student support / Operations / Settings**, and the Oversight app uses its own fixed set **Overview / Analysis / Records / Account** (its sidebar legitimately exceeds twelve items); **role-grouped nav** is a documented exception for surfaces where one user occupies multiple structurally distinct roles (currently used only in `schoolup-wassce-subject-teacher.html` with sections Teaching / Form Master / PLC / Other); and **vertical step nav** is the canonical pattern for multi-step guided flows, canonized in `schoolup-unified-onboarding.html` and reused in `schoolup-oversight-onboarding.html`. The term "pastoral" is reserved for editorial copy and CSS class names referring to the pastoral-care domain concept; it is not used as a navigation label, where "Student support" is the canonical term.

---

## MVP1 · launch surfaces (28 files)

The minimum viable shipset. Every surface here must work on day one. **This is your build sprint.**

### Onboarding (3 files)

| File | Role | Purpose |
|------|------|---------|
| `schoolup-onboarding-wireframes.html` | Admin | First-time school setup flow overview · early exploration |
| `schoolup-unified-onboarding.html` | Admin | **The school onboarding wizard** · vertical 8-step flow · Basic finishes at 6, SHS continues to 8 · branch point at step 2 · step 4 adapts to school type (classes+subjects for Basic, programmes+electives for SHS) · CSSPS code captured at step 1 · replaces the older `schoolup-wizard-all-steps.html` (6-step MVP1) and `schoolup-shs-school-setup.html` (8-step SHS) which were retired May 2026 |
| `sms-mvp1-wireframes.html` | Multi | Early SMS pattern exploration · superseded by full comms surfaces |

### Attendance (8 files · the flagship MVP1 module)

| File | Role | Purpose |
|------|------|---------|
| `schoolup-attendance-mobile.html` | Teacher | Take attendance on phone · in-class flow |
| `schoolup-attendance-desktop.html` | Teacher | Take attendance on desktop · staffroom flow |
| `schoolup-attendance-admin.html` | Admin | Cross-class attendance dashboard |
| `schoolup-attendance-alerts.html` | Multi | Absent-student alerts to parents |
| `schoolup-attendance-student-view.html` | Student | Student's own attendance record |
| `schoolup-attendance-parent.html` | Parent | Parent's view of their child's attendance |
| `schoolup-attendance-edit-request.html` | Teacher | Request correction to past attendance · admin co-signs |
| `schoolup-attendance-settings.html` | Admin | School-wide attendance configuration |

### Billing & payments (8 files)

| File | Role | Purpose |
|------|------|---------|
| `schoolup-payment-data-model.md` | Doc | Foundational data model for invoices, payments, receipts, refunds |
| `schoolup-record-payment-drawer.html` | Admin | Record manual cash/MoMo payment |
| `schoolup-receipt-pdf.html` | Admin | Printable receipt template |
| `schoolup-discount-management.html` | Admin | Set up discounts (sibling, scholarship, staff child) |
| `schoolup-discounts-report.html` | Admin | Discount audit and reporting |
| `schoolup-void-refund.html` | Admin | Void receipt or issue refund |
| `schoolup-voids-refunds-report.html` | Admin | Voids and refunds audit |
| `schoolup-collection-trend.html` | Admin | Fee collection over time |
| `schoolup-send-reminders.html` | Admin | Bulk fee-due reminders |

### Comms (2 files MVP1)

| File | Role | Purpose |
|------|------|---------|
| `schoolup-announcements.html` | Admin | School-wide announcements |
| `schoolup-sms-library.html` | Admin | SMS template library |

### Reports (2 files)

| File | Role | Purpose |
|------|------|---------|
| `schoolup-reports.html` | Admin | Reports hub · cross-module |
| `schoolup-school-stats.html` | Admin | School at-a-glance dashboard |

### Statutory · GES integration (2 files)

| File | Role | Purpose |
|------|------|---------|
| `schoolup-ges-return.html` | Admin | Generate GES termly return · the MoE-readiness signal |
| `schoolup-annual-census.html` | Admin | EMIS annual census |

### Settings (3 files)

| File | Role | Purpose |
|------|------|---------|
| `schoolup-settings.html` | Admin | School settings hub |
| `schoolup-customise-list.html` | Admin | Customise dropdown lists (classes, sections, etc.) |
| `schoolup-accountant-role.html` | Admin | Accountant role permissions |

### System surfaces (2 files)

| File | Role | Purpose |
|------|------|---------|
| `schoolup-empty-states.html` | Multi | Empty-state library · cross-module |
| `schoolup-empty-states-modules.html` | Multi | Module-specific empty states |

---

## MVP2 · post-launch surfaces (15 files)

Designed and ready · ship in months 2–6 based on customer feedback and revenue.

### Books (financial accounting · 6 files)

The accountant-grade financial module. Distinct from billing — billing tracks fees in/out, books tracks the school as a business.

| File | Role | Purpose |
|------|------|---------|
| `schoolup-books-dashboard.html` | Admin | Books overview · profit & loss snapshot |
| `schoolup-books-income.html` | Admin | Income tracking beyond tuition |
| `schoolup-books-expenses.html` | Admin | Expense recording and categorisation |
| `schoolup-books-fixed-assets.html` | Admin | Fixed assets register |
| `schoolup-books-financial-reports.html` | Admin | P&L, balance sheet, cash flow |
| `schoolup-books-settings.html` | Admin | Chart of accounts configuration |

### Comms · WhatsApp (2 files)

| File | Role | Purpose |
|------|------|---------|
| `schoolup-whatsapp-inbox.html` | Admin | WhatsApp Business API inbox |
| `schoolup-whatsapp-template-authoring.html` | Admin | WhatsApp template authoring (Meta-approved) |

### Aggregator integration (1 file)

| File | Role | Purpose |
|------|------|---------|
| `schoolup-aggregator-integration.html` | Admin | Hubtel payment aggregator · automated reconciliation |

### Special needs (1 file)

| File | Role | Purpose |
|------|------|---------|
| `schoolup-special-needs.html` | Admin | SEN profile and accommodations tracking |

### Staff (1 file)

| File | Role | Purpose |
|------|------|---------|
| `schoolup-staff-compensation.html` | Admin | Salary, allowances, payroll integration |

### Achievements (1 file)

| File | Role | Purpose |
|------|------|---------|
| `schoolup-achievements.html` | Multi | Achievement tracking · gamification layer |

### Deferred-flagship surfaces (just shipped, MVP2-tagged · 4 files)

| File | Role | Purpose |
|------|------|---------|
| `schoolup-parent-teacher-meetings.html` | Multi | Visiting day + ad-hoc PT meeting scheduling · refactored in Forms/PTA batch (PT-vs-PTA disambiguation banner, multi-role staff awareness) |
| `schoolup-offline-mode.html` | System | Offline capability matrix · sync queue · conflict resolution |
| `schoolup-textbook-inventory.html` | Admin | Textbook tracking · end-of-term collection · billing integration |
| `schoolup-backup-dr.html` | Admin | Backup commitments · point-in-time recovery · status page |

---

## SHS · Batch 0 · Structural foundation (5 files)

The data model and onboarding shape that everything else in Omnischools Senior builds on. These surfaces define how SHS-specific concepts (programmes, Houses, multi-role staff, GES ranks, dual student assignment) integrate with the existing Basic-school product. **Three of these are minor refactors to Basic-school surfaces; three are new SHS-only surfaces.** All establish primitives that Forms/PTA, PLC/CPD, VLC, Boarding, and WASSCE batches depend on.

| File | Role | Purpose |
|------|------|---------|
| `schoolup-shs-staff-record-multirole.html` | Admin | Staff profile with multiple concurrent roles + GES rank · the multi-role refactor surface |
| `schoolup-shs-bulk-admission.html` | Admin | **The SHS admissions default · CSSPS placement intake.** Five-state surface · empty state with 17-day countdown / source the list (paste-from-portal / CSV / PDF, no GES API exists) / review &amp; match (240 rows, 8 flags) / programme + House + residency assignment trio / commit + two-week reconciliation showing placed-no-shows and walk-in additions. Built on St. Theresa's SHS demo, continues from the unified wizard's CSSPS code (ST-0741) |
| `schoolup-shs-student-admission.html` | Admin | **Add individual student · the ad-hoc path.** Per-student CSSPS-aware admission flow for self-placement, transfers in, late arrivals, and returning students. Refactored May 2026 from earlier per-student default to its current secondary role; bulk surface now leads |
| `schoolup-shs-class-roster.html` | Multi | Class roster showing both class identity (Form/Programme/Section) and House distribution |
| `schoolup-shs-district-region-ownership.html` | Admin | School geography + ownership type · drives GES termly returns and future Oversight reporting |

**Note:** the older `schoolup-shs-school-type-selection.html` and `schoolup-shs-school-setup.html` surfaces in this batch were retired May 2026 and folded into the unified `schoolup-unified-onboarding.html` wizard (MVP1 section above). The unified wizard handles the type-selection branch point at step 2 and the SHS-specific structural setup at steps 4/7/8. The duplicate file `schoolup-student-admission-shs.html` (a pre-existing copy of the per-student surface) was also deleted as part of the May 2026 admissions refactor.

**Admissions architecture · two surfaces, one cohort.** SHS admissions has two complementary pipelines that both feed a single Form 1 cohort. **Bulk** (`schoolup-shs-bulk-admission.html`) is the September default — once per academic year, ingests the CSSPS placement list of 200+ students in one transaction, atomic commit with Tier B 24-hour undo. **Per-student** (`schoolup-shs-student-admission.html`) is the year-round secondary — handles self-placement walk-ins, transfers, late arrivals, returning students; CSSPS BECE-index lookup still applies for verification. Realistic volume mix: ~94% bulk, ~6% per-student. Provenance flag (`BULK_INTAKE` / `SELF_PLACED` / `TRANSFER_IN` / `RETURNING`) preserved on every student record; the students module sees one cohort with queryable source paths.

**Schema additions triggered by Batch 0** (applies to all schools, not just SHS):

- `schools.school_type` enum (`BASIC`, `JHS`, `SHS`, `SHTS`, `MULTI_TIER`)
- `schools.district_id`, `schools.region_id` FK to seeded `districts` and `regions` reference tables (16 regions, ~260 districts per current GES boundaries)
- `schools.ownership_type` enum (`PUBLIC`, `PRIVATE`, `MISSION`, `INTERNATIONAL`)
- New table: `staff_role_assignments` — multi-role per person · replaces single `staff.role` field
- New table: `ges_data_sharing_agreements` — per-school consent for Oversight tier
- `students.programme_id`, `students.house_id`, `students.residential_status` — nullable, populated only for SHS
- `classes.programme_id`, `classes.section` — nullable, populated only for SHS

**Refactor risk to existing MVP1 work:** small. Three surfaces (the wizard, staff record, class management) need minor updates to consume the new schema. No design throwaways. Documented in BUILD_STACK.md migration section.

---

## SHS · Score Ledger · The five-category assessment record (3 files)

The foundational grading surface for Omnischools Senior. Every SHS in Ghana — public or private — keeps a five-category score ledger per (student × subject × semester): assignments, mid-semester exam, end-of-semester exam, project work, portfolio. The exact weighting is school-configurable per subject; the demo school Asankrangwa SHS runs 15/15/40/15/15 with the end-of-semester examination at 40% as the dominant weight, reflecting how Ghanaian SHS typically structure the balance between continuous assessment and the terminal assessment. The five categories themselves are verified against the NaCCA Government Year 1 Teacher Manual and are universal; weights tune per school. **The score ledger is the primary teacher artifact in Senior** — STPSHS export, report cards, WASSCE prediction, and Oversight aggregation all hang off it. **Three capture paths, medium-agnostic by design**: Path A auto-compiles from in-semester Omnischools entries, Path B scans the teacher's paper ledger with verification-first OCR, Path C takes direct digital entry onto the ledger grid. The three paths are framed as equivalents, not as a progression toward digital — the branded paper ledger book is a feature, not a transitional artifact. **Academic period structure follows the GES standard:** SHS runs **2 semesters per academic year** (the standard since the 2018/19 academic year when GES replaced the trimester system as part of the Free SHS rollout); Basic schools (KG · Primary · JHS) run 3 terms per academic year per the current 2025/26 GES calendar. Both are configurable at school onboarding through `ref_academic_period_config`; the seeded defaults follow the GES standard. Demo school is Asankrangwa SHS, demo teacher is Mr. K. Owusu (Mathematics, Form 2 Science), demo period is Semester 2 of 2025/26 with 17 days to the STPSHS submission window.

| File | Role | Purpose |
|------|------|---------|
| `schoolup-shs-score-ledger.html` | Teacher | **The central ledger surface.** Three-section build: section 1 leads with the **class-tab list** above the grid showing Mr. Owusu's two Form 2 Maths classes (Form 2 Science · 37 students · current · 4 of 5 categories · Form 2 General · 29 students · behind · 4 of 5 categories), then the path chooser (A/B/C cards) with Path A active, then the five-category grid for the active class's 37 students with weighted totals live-computed at the school's configured weights (15/15/40/15/15 for Mathematics, end-of-sem at 40% as the dominant weight), portfolio column pending end-of-term; section 2 is Path B's scan-and-diff workflow with side-by-side handwritten ledger photograph vs OCR-extracted grid and 4 diff flags spanning the four diff cases (low-confidence overlap, blank-to-filled silent accept, score-down re-grade confirmation, score-gone-missing high severity); section 3 is the printable STPSHS-ready score sheet preview with REF-2024-XXXX Assessment Reference IDs in the order STPSHS's Capture Per Subject screen expects |
| `schoolup-shs-score-ledger-pwa.html` | Teacher | **The PWA form-factor.** Phone mockups (not browser-bar mocks) showing four states across four sections: section 1 is the online case with a **view-toggle pill** (Card / Grid) showing both modes side-by-side — Card view with one student per screen + five large inputs, Grid view with the whole class as a compact sticky-left table, both reading and writing the same data; section 2 is the **class switcher** with the bottom sheet slid up over a dimmed body, listing Mr. Owusu's two Form 2 Maths classes with path/student-count/completion-status/STPSHS-readiness on each — chevron beside the class name on every screen, "1 of 2" pill making the multi-class context unambiguous, the active class highlighted; section 3 is connection-dropped state with gold sync strip "3 scores held locally, will sync when reconnected" and pending-tinted inputs; section 4 is the phased connectivity roadmap — Phase 1 ("works on your phone, handles bad connections") ships with v1, Phase 2 (extended offline via IndexedDB) deferred until real demand, Phase 3 (multi-device conflict resolution) hypothetical capacity. **The marketing line is deliberately not "works offline"** — over-promising connectivity is the failure mode that creates angry users |
| `schoolup-shs-vice-headmaster-progress.html` | Vice Headmaster Academic, Headmaster | **The management view of ledger entry.** Three sections: section 1 is the per-teacher × class × subject completion table (23 combinations at Asankrangwa SHS), with path pills (A/B/C), category dots (✓/¾/—), STPSHS readiness pills (Ready/Behind/At-risk), and a discipline banner naming the rule that **this view shows completion progress, not score values** — inspecting actual marks requires gradebook navigation, which is audit-logged like Oversight's compliance view; section 2 is the at-risk flags surface (3 cards: Akoto 19-day inactivity, STPSHS window with 9 of 23 not ready, Coleman entry-rate outlier), rules framed as config in the same `ref_anomaly_rule` table Oversight uses; section 3 is the Headmaster's cascade roll-up — 3 subjects fully ready, 5 partial, 1 at risk, with a gold-bordered action card surfacing the Akoto case and the Vice Headmaster's support plan |

**Three capture paths · one data model:** the five categories live in a single `senior_score_ledger` table keyed by `(student_id, subject_id, term_id)` with `path_used` column (`'A'`, `'B'`, `'C'`) and version history. Path A populates from in-term `assignments` and `exam_events` tables; Path B writes from OCR extraction with `ocr_confidence` per cell; Path C writes from direct user input. All three feed the same downstream — STPSHS export, parent report cards, school-internal analytics, and Oversight aggregation. The diff logic in section 2 of `schoolup-shs-score-ledger.html` applies across paths: a Path C teacher who later photographs their digital-entry ledger triggers cell-by-cell comparison.

**PWA strategy phased honestly · v1 does not promise offline:** the connectivity story explicitly scopes what ships. Phase 1 caches the current term's ledger page and buffers a small number of pending scores on connection drops. Phase 2 (extended offline with IndexedDB, single-device) is built only if real demand surfaces. Phase 3 (multi-device conflict resolution) is hypothetical capacity, built only if the multi-device case proves real. The marketing language for v1 is "works on your phone, handles bad connections," not "works offline" — the gap between marketing and reality is where churn comes from.

**Vice Headmaster discipline · accountability without surveillance:** the progress view shows whether scores have been entered, not what the scores are. Score-value access requires navigating to the gradebook, which is audit-logged the same way Oversight's compliance record view is. The Vice Headmaster's job is to talk to teachers who are behind; it is not to read the marks themselves until the term is closed.

**Schema additions triggered by this batch:**

- `senior_score_ledger` table · `(student_id, subject_id, term_id)` primary key, five category columns plus `weighted_total`, `path_used`, `version`, `last_updated_by`, `last_updated_at`
- `senior_score_ledger_history` table · append-only audit, full prior values on each change, reason code where the diff logic prompted one
- `senior_score_ledger_upload` table · for Path B uploads, photograph attachment, OCR confidence map per cell, supersedes-relationship to prior uploads
- `ref_assessment_weights` table · per (subject × school) configurable weights, NaCCA defaults seeded
- `ref_anomaly_rule` table extended · the same table Oversight uses now also holds the five Vice Headmaster rules (teacher inactivity, STPSHS window approach, entry-rate outlier, score-down between uploads, portfolio-only-pending)

**Companion spec:** `SHS_SCORE_LEDGER_SPEC.md` (270 lines) — the canonical design document. Supersedes the STPSHS-first framing in `STPSHS_INTEGRATION_SPEC.md` (which remains useful as research material on the WAEC regulator side). Build sequence is 11 ordered items, with items 1–8 forming the v1 product, items 9–10 reserved PWA capacity, and item 11 the WAEC API conversation that runs in parallel.

---

## SHS · Forms/PTA · The four-tier governance module (6 files)

PTA governance for Ghanaian SHSs, modelled as four parallel tiers (Form / House / General / Emergency) with dues optional per tier and forward-only change posture. **Five new surfaces, plus one in-place refactor of an existing PT meetings file to clarify its scope vs PTA.** This is the first SHS module shipped after Batch 0 — chosen first because PTA touches governance, attendance, and finance simultaneously, and because PTAs were reinstated by the July 2025 Mahama directive, making them an immediate operational reality for any SHS adopting Omnischools now.

| File | Role | Purpose |
|------|------|---------|
| `schoolup-pta-structure-setup.html` | Admin | Settings · which of the four tiers are active · per-tier meeting frequency, officer roles, **optional dues toggle with forward-only change posture** · auto-generates PTA instances from existing class/House structure |
| `schoolup-pta-officer-matrix.html` | Admin, PTA Chair | Tier × role × person matrix · parent officers, teacher officers, ex-officio assignments · multi-hat visibility (one parent can hold concurrent roles at multiple tiers) · vacancy and term-ending warnings |
| `schoolup-pta-meeting-register.html` | Multi (Secretary primary) | Multi-state lifecycle — schedule → register → live attendance → close · **two parallel registers (teachers + parents)** with three statuses each (Present / Late / Absent) · GES tracks both as separate compliance metrics |
| `schoolup-pta-meeting-minutes.html` | Secretary | Post-meeting structured capture · classify each agenda item as **Discussion / Action / Resolution** · actions extract to trackable tasks, resolutions extract to formal records with vote counts · two-stage approval (Secretary drafts → Chair reviews) |
| `schoolup-pta-dues-collection.html` | Admin, PTA Treasurer | Two tabs · Setup (PTA dues as separate fee category, per-tier rates, forward-only changes) and Collection report (per-tier breakdown, aging, outstanding-family drill-down, bulk SMS chaser) |
| `schoolup-parent-teacher-meetings.html` | Multi | **Refactored in place** · existing surface preserved; header reframed; PT vs PTA disambiguation banner inserted; multi-role staff awareness noted (Form Master auto-suggested for Form parents) |

**Schema additions triggered by Forms/PTA:**

- New table: `pta_tiers_config` — per-school per-tier configuration · active flag, frequency norm, officer roles JSON, dues_enabled, dues_amount_ghs, dues_basis (per-family/per-student), dues_cadence (per-term/per-year/one-off)
- New table: `ptas` — the generated instances · tier_type, scope_ref (class_id for Form, house_id for House, NULL for General, NULL for on-demand Emergency)
- New table: `pta_dues_config_history` — append-only audit · every dues change with effective_from date · drives forward-only behaviour
- New table: `pta_officers` — assignment records · person_type (parent/teacher/external), person_id, role, term_start, term_end, election_basis_audit
- New table: `pta_meetings` — scheduled and held meetings · pta_id, scheduled_at, location, agenda, status, called_by_staff_id
- New table: `pta_attendance` — register entries · attendee_type (teacher/parent), attendee_id, status (P/L/A), marked_at, marked_by
- New table: `pta_minutes` — Secretary's record · status (drafting/review/adopted/distributed), text, action_items_json, secretary_id
- New table: `pta_action_items` — auto-extracted from classification · owner, deadline, status, completed_at
- New table: `pta_resolutions` — auto-extracted from classification · resolution text, votes_for/against/abstain, binding flag, resolution_number
- New table: `pta_dues_invoices` — separate fee category invoices · parent_id or family_id, pta_id, amount_ghs, status, paid_at
- Extended: `fee_categories` reference table to include `PTA_DUES` as a sixth category alongside Tuition, Boarding, Feeding, Exam, Other

**Backward compatibility:** all new tables are SHS-only at MVP1. Basic schools that later opt into PTA governance will get these tables provisioned at school-type upgrade. PT meetings refactor is non-breaking to Basic-school usage — the disambiguation banner appears for all schools but is most meaningful where the PTA module is active.

**Architectural note · the separate fee category:** PTA dues live as `PTA_DUES` fee category, not as a tag on existing tuition fees. Reasoning: different accountability (parent Treasurer vs school bursar), different audit chains (PTA AGM vs GES financial audit), different spend governance (resolution-driven vs Headmaster-directed). Documented in BUILD_STACK.md.

**Editorial frame:** "Four tiers, four conversations" · the Form PTA handles class concerns, the House PTA handles boarding and welfare, the General PTA is school-wide governance, the Emergency PTA is convened when something can't wait. Same dues category, different rates per tier, optional at every tier, audit-trailed forward-only changes.

---

## SHS · PLC/CPD · Teacher professional learning &amp; NTC compliance (6 files)

Second SHS module after Forms/PTA. Teachers in Ghana need 20 CPD points per year for licence renewal — **and 8 of those must come from school-based Professional Learning Communities (PLCs)**. The other 12 come from workshops, online courses, mentoring, conferences, and action research. This batch covers the full lifecycle: setup, weekly operations, individual ledger, school-wide oversight, and NTC portal sync. **Five new surfaces, plus one in-place refactor of the multi-role staff record to add a CPD summary section.**

| File | Role | Purpose |
|------|------|---------|
| `schoolup-plc-programme-setup.html` | Admin, Deputy Head Academics | Settings · define the school's PLC architecture · type (subject/cross-cutting/new-teacher), facilitator, members, weekly cadence, term focus · CPD points contract (0.5 attended + 0.5 reflection = 1 pt) |
| `schoolup-plc-session-register.html` | Facilitator (HoD primary) | Weekly session lifecycle — schedule → SMS reminder → live attendance + agenda → 48-hour reflection window → CPD points auto-posted to ledger · **highest-frequency surface in the batch** |
| `schoolup-cpd-points-ledger.html` | Teacher (self-service) | Per-teacher view · 20-pt annual target progress, source breakdown with caps, ledger of every entry with NTC sync state, 3-year licence cycle, gap analysis with realistic next steps |
| `schoolup-cpd-school-dashboard.html` | Headmaster, HoD | All staff CPD progress · at-risk red flags · term-by-term, filterable by department/role/GES rank · licence renewal calendar 24 months ahead · drill-down per teacher |
| `schoolup-ntc-portal-sync.html` | Admin | Integration with NTC portal · pending submissions queue, sync history, errors with retry, manual override, monthly reconciliation between Omnischools ledger and NTC official record |
| `schoolup-staff-record-multirole.html` | Admin, multi | **Refactored in place** · added "CPD &amp; professional learning" section showing annual progress, licence renewal, PLC memberships, last 5 ledger entries · read-only with deep-link to full ledger |

**Schema additions triggered by PLC/CPD:**

- New table: `plcs` — instance per PLC · type enum (SUBJECT/CROSS_CUTTING/NEW_TEACHER), facilitator_staff_id, cadence_override
- New table: `plc_memberships` — staff in PLC · role (member/facilitator), joined_at, left_at (nullable)
- New table: `plc_term_focus` — per-term narrative per PLC · focus_text, set_by_staff_id
- New table: `plc_sessions` — session instance · plc_id, week_no, scheduled_at, started_at, closed_at, agenda_json, focus_text
- New table: `plc_attendance` — per-teacher per-session · attendance_status, marked_at, reflection_submitted_at, reflection_text_json
- New table: `cpd_points_ledger` — append-only CPD records · source_type enum (PLC_ATTEND/PLC_REFLECT/PLC_FACILITATE/WORKSHOP/ONLINE_COURSE/MENTORING/CONFERENCE/ACTION_RESEARCH/SUBJECT_PRO/OTHER), source_ref_id, points, awarded_at, ntc_sync_status, ntc_synced_at, evidence_file_id
- New table: `cpd_source_rules` — per-school configurable point values and annual caps per source type
- New table: `ntc_licences` — per-teacher licence cycle · issued_at, expires_at, cycle_start, cycle_end, cumulative_pts_required
- New table: `cpd_evidence_uploads` — certificate / completion proof files
- New table: `ntc_sync_batches` — push history · scheduled_at, completed_at, status, entry_count, success_count, failure_count
- New table: `ntc_sync_failures` — per-failed-entry · error_code, error_message, attempt_count, resolution_status
- Enums needed: `plc_type_enum` (SUBJECT, CROSS_CUTTING, NEW_TEACHER) · `cpd_source_enum` · `ntc_sync_status_enum` (QUEUED, SYNCED, FAILED)

**Architectural decisions baked into surfaces:**

- **Three PLC types** (subject-based / cross-cutting / new-teacher) modelled as `plc_type` enum. Subject-based: HoD facilitates, mandatory attendance, weekly. Cross-cutting: subject expert facilitates, voluntary, weekly or biweekly. New-teacher: senior leader facilitates, mandatory for years 1-2, supports NTC induction (separate sync track).
- **0.5 attendance + 0.5 reflection = 1 CPD point per PLC session.** Configurable per school but default is the Omnischools opinion. 48-hour reflection window after session close. 3 prompts (takeaway / commitment / question for next time). Voice-to-text supported. Skipping reflection forfeits the 0.5 bonus but preserves the 0.5 attendance pt.
- **NTC rules Omnischools enforces:** 20 pts/year mandatory · 8 of those from PLC (hard floor) · 60 cumulative pts over 3-year licence cycle · evidence upload required for external entries (workshops, courses, conferences) · PLC entries auto-evidence from session register · synced entries are official, pending entries are provisional.
- **School-wide PLC cadence default.** All PLCs meet same Friday 3:30 PM hour to make the time protectable (no classes, no admin meetings during PLC hour). Individual PLCs can override but default forces alignment.
- **Facilitator earns 1.0 fixed CPD pt per session they facilitate** (not 0.5+0.5). Their participation is the session itself; no reflection requirement applies to facilitators.
- **Action research uncapped at 5-10 pts on completion + write-up.** Other source caps: PLC 8/year (NTC mandate), all other categories uncapped per NTC framework.

**External integration note:** The NTC portal API doesn't formally exist yet — the surface is designed against the publicly described 2024 NTC digital licence renewal roadmap. When the real API ships, Omnischools will adapt. **Fallback is monthly PDF export → manual upload** to the NTC portal by the Headmaster.

**Editorial frame:** "Twenty points, one year at a time" · "Six PLCs, one Friday afternoon" · the rhythm is the design. Daily-use surfaces stay calm; the school dashboard makes the year-end audit panic impossible.

---

## SHS · VLC · Values Learning Communities &amp; Peer Guide programme (5 files)

The student-facing counterpart to PLC. Where PLC is teacher professional learning, **VLC is structured character formation for students** — eleven core values, two sessions each (introduction + application), running weekly across the school year. Form Master leads, two student Peer Guides co-facilitate, whole class participates. **Not RME**, not Citizenship Education — those are examinable NaCCA subjects with grades; VLC is pastoral, school-designed, journaled rather than graded. **The Peer Guide pattern is the Omnischools design contribution** on top of the curriculum: two students per class (one boy, one girl, drawn from Form 2 or 3), elected term-by-term with Form Master approval, trained monthly by the Dean of Students. By the end of three SHS years a school running VLC will have rotated a third of its students through Peer Guide service.

| File | Role | Purpose |
|------|------|---------|
| `schoolup-vlc-programme-setup.html` | Admin, Dean of Students | Configure the 11 values · 22-session curriculum (intro + application per value) · Wednesday 2:30 PM cadence default · Term arc (foundations → interpersonal → integration) · Twi names for each value |
| `schoolup-vlc-peer-guides.html` | Dean of Students | The 36 active Peer Guides · class-by-class roster · selection &amp; term rotation · monthly training calendar · leadership-development framing |
| `schoolup-vlc-session-register.html` | Form Master + Peer Guides | Weekly class session · whole-class attendance (40 cells) · 5-phase rhythm (5+25+15+10+5 min) · small-group split visualisation · **pastoral flag** capture · in-session journal post |
| `schoolup-vlc-student-journal.html` | Form Master, Dean | Per-student record across 22 sessions · verbatim reflections (append-only) · PG observations · FM pastoral notes (private from student) · auto-drafted year-end character paragraph |
| `schoolup-vlc-school-dashboard.html` | Dean of Students, Headmaster | School-wide rollup · 18-class matrix with curriculum progress, attendance, reflection rate · pastoral flag drilldown with owner + next action · value emphasis chart (which values produce longest reflections) |

**Schema additions triggered by VLC:**

- New table: `vlc_values` — the 11 values · school_id, value_no, name_en, name_twi, name_ga, description, term_assignment, sequence_order, customisable
- New table: `vlc_curriculum` — the 22 sessions · value_id, session_type enum ('INTRO' | 'APPLICATION'), week_no, default_focus_text, default_activities_json
- New table: `vlc_programme_config` — school-level cadence · cadence_day, start_time, session_length_min
- New table: `peer_guides` — term assignment · class_id, student_id, term_no, term_count (1st/2nd/3rd term), assigned_at, stepped_down_at, reason_text
- New table: `peer_guide_training_sessions` — monthly trainings · scheduled_at, topic, led_by_staff_id, duration_min, materials_file_id
- New table: `peer_guide_training_attendance` — per-guide per-training · status, marked_at
- New table: `peer_guide_selection_history` — audit trail used in school-leaver reports
- New table: `vlc_sessions` — session instance · class_id, value_id, session_type, week_no, scheduled_at, started_at, closed_at, focus_text, status
- New table: `vlc_attendance` — per-student per-session · status, marked_at, marked_by_staff_id (FM, not PG)
- New table: `vlc_session_groups` — small-group split · session_id, peer_guide_id, group_label, member_student_ids[]
- New table: `vlc_pastoral_flags` — concerns raised in session · session_id, student_id, raised_by, severity, narrative_text, escalated_to, resolution_status, resolved_at
- New table: `vlc_reflections` — per-student per-session · journal_text, written_at, word_count, committed_action_text (parsed)
- Enums needed: `vlc_session_type_enum` (INTRO, APPLICATION) · `vlc_flag_severity_enum` (LOW, MED, HIGH) · `vlc_flag_status_enum` (OPEN, FM_CHECKIN, ESCALATED, RESOLVED)

**Architectural decisions baked into surfaces:**

- **11 values modelled as ordered list, Twi names locked.** 9 universal values + 2 GH-contextual (Patriotism, Wisdom as capstone). Each value has 2 sessions (introduction + application). Term arc is foundations (V1-4) → interpersonal (V5-8) → integration (V9-11). Schools can add a 12th school-specific value (e.g., "Honour" for boarding houses) but most stick with 11.
- **5-phase session rhythm locked.** 5 min opener (FM frames) + 25 min small groups (Peer Guides lead 4-5 students each) + 15 min plenary share-back + 10 min individual journal reflection + 5 min close = 60 min. Form Masters don't redesign the session shape; only the content within phases is flexible.
- **Peer Guides are not Prefects.** Distinct student leadership role: facilitation rather than authority. Two per class (one boy, one girl default), Form 2 or 3 only (no Form 1, who are still settling in), 1-term tenure default with extension possible. Selected by class vote + Form Master approval + Dean sign-off. A student can be both a Prefect and a Peer Guide; the roles are exercised differently.
- **Wednesday 2:30 PM cadence default.** Different day from PLC's Friday to spread teacher load. 60-minute slot is master-timetable protected, can't be displaced by ad-hoc events.
- **Pastoral flags are private from students.** Raised by FM or PG during/after session. Captured privately on the session record, visible only to FM and Dean of Students, never to other students. Three resolution paths: 1-on-1 check-in, escalate to Dean, or note as resolved.
- **Three distinct pastoral record layers, not one.** Session-tied flags (`vlc_pastoral_flags`) capture in-session events. Case-level FM notes (`vlc_fm_pastoral_notes`) are the FM's running notebook on a student — may or may not be session-tied. PG observations (`vlc_pg_observations`) are visible to FM only. The character paragraph (`vlc_character_paragraphs`) is auto-drafted from all three plus journal reflections, finalised by FM, and is the only artefact the parent ever sees.
- **In-session reflection, not 48-hour like PLC.** Phase 4 is silent journal-writing during the session itself. Faster, more honest, no overnight forgetting. Append-only — once written, an entry can't be edited or deleted. Builds across 22 sessions into the character paragraph in the school-leaver report.
- **Form 1 doesn't supply Peer Guides.** Structural, not a gap. Form 1 students are being supported into the school; Peer Guide service starts in Form 2.

**Editorial frame:** "Eleven values, twenty-two sessions" · "Two per class · rotated by term" · "The journal accumulates." VLC produces no examinable output, no league table, no parent-facing grade — the school-leaver character paragraph is its only externalisation. The dashboard is the only place the programme's effectiveness becomes visible, so it must be honest, not vanity-metric.

---

## SHS · Boarding · House, dormitory & residential life operations (7 files)

The parallel operating system that runs alongside academics in any Ghanaian SHS with residential students. Ghana's Category A and B schools (Achimota, Mfantsipim, Wesley Girls', PRESEC, Prempeh, Adisadel, OWASS, KETASCO, St Augustine's, Holy Child) are predominantly boarding institutions — a direct inheritance from the British public-school model imported from 1876 onwards. The Free SHS policy from 2017 added day students to most schools, producing a mixed boarding/day population at almost every SHS today. **The boarding module is not a feature of the school module; it is structurally adjacent to it.** A student is one of three residency types — boarder, day, or deboardinized — and almost every academic surface in Senior has to be aware of which.

The demo school across all 7 surfaces is **Asankrangwa SHS** (fictional, co-ed, 1,200 students = 720 boarders + 480 day), with **six Houses** named for historical figures: Aggrey (boys, red, 1956), Guggisberg (boys, navy blue, 1956), Fraser (boys, bottle green, 1958), Slessor (girls, white, 1965), Kingsley (girls, yellow, 1972), Aryee (girls, mauve, 2014). Each House holds 120 students across 8 dormitories of 15 bunks. The surfaces are set in **Semester 2, Week 2, Wednesday 14 May 2026** — 11 days after resumption (May 3), 3 days before the next visiting Sunday (May 17). Per the GES SHS academic calendar, SHS runs 2 semesters per year (the standard since 2018/19), so Semester 2 covers Jan 5 through Aug 21 of the academic year.

J. Manu, the bereaved Form 2 General Arts student from the VLC batch, appears as a boarder in **Aggrey House, Dorm D, bunk 03** since Form 1 — his Form Master (Mr Mensah) is also his Housemaster, by design. The cross-batch narrative thread continues; his mother is scheduled to visit on Sunday.

| File | Role | Purpose |
|------|------|---------|
| `schoolup-boarding-programme-setup.html` | Admin, Senior HM | The configuration foundation · 6 Houses with gender, colour, capacity, HM · daily schedule (YAGSHS-canonical 4:30 AM → 9:30 PM template) · exeat policy (3/term) · visiting day cadence (2nd Sunday) · 5-rung discipline ladder · GES single-track calendar |
| `schoolup-boarding-house-roster.html` | Housemaster | Mr Mensah's view of Aggrey House · 5 prefect cards (Head, Dining, Sanitation, Prep, Sick Bay) · 8 dormitories × 15 bunks visualised · drag-drop bed allocation · J. Manu's detail card with VLC cross-link |
| `schoolup-boarding-resumption-day.html` | Senior HM + 6 HMs | The chaos-day surface · 96px live clock · 6 staggered arrival windows by Form (F3 first, F1 last) · prospectus 6-pip checklist (CHOP/MATTRESS/MAC/NET/BUCKET/BIBLE) per arrival · fee-shortfall flags · escalation issues queue · **same surface flips to vacation day** |
| `schoolup-boarding-daily-life.html` | Housemaster | Mr Mensah's regular Wednesday · this morning's 6:10 AM inspection (8 dorms) · tonight's prep attendance · siesta/lights-out compliance · mid-week scrubbing flag · sick-bay queue (light, deferred to separate batch) |
| `schoolup-boarding-exeat-management.html` | Housemaster + parents | Request → review → card → depart → return cycle · scheduled vs special exeats · fee-owing-student auto-flag · return-by-4PM enforcement with SMS escalation · printable exeat card · live exeat in flight + upcoming May 31 window |
| `schoolup-boarding-visiting-day.html` | Senior HM | Digital Visitor's Book replacing the paper one · gate sign-in by parent + student + relationship · approved-visitor verification · in/out timestamping · area allocation · unauthorised zone/time flags · J. Manu's mother on the inbound list for May 17 |
| `schoolup-boarding-discipline.html` | HM + Senior HM + Headmaster | 5-rung disciplinary ledger (NOTE → WARNING → BOND → SUSPENSION → DEBOARD) · 3 currently deboardinized · 1 Board review pending Friday · bond-of-good-behaviour artefact in flight (14:30 today) · penalty fees cross-linking into billing |

**Schema additions triggered by Boarding (~15 tables):**

- New table: `houses` — school_id, name, gender_enum, colour, founded_year, named_after, capacity, hm_staff_id, assistant_hm_staff_id, building_location
- New table: `dormitories` — house_id, name, building_location, bunk_count, junior_or_senior_section
- New table: `bunks` — dormitory_id, position_number, prefect_designation_nullable
- New table: `student_residency` — student_id, residency_type_enum (BOARDER/DAY/DEBOARDINIZED), current_bunk_id_nullable, became_boarder_at, became_day_at
- New table: `bunk_allocation_history` — student_id, bunk_id, from_at, to_at, reason, allocated_by_staff_id — **append-only**
- New table: `house_prefects` — house_id, student_id, role_enum (HEAD/DINING/SANITATION/PREP/SICKBAY), term, appointed_by_staff_id
- New table: `daily_schedule_template` — school_id, day_type_enum (WEEKDAY/SAT/SUN/VISITING), activities_json
- New table: `inspections` — dormitory_id, inspected_at, inspected_by_staff_id, type_enum (DAILY/WEEKLY), findings_json, pass_fail
- New table: `exeats` — student_id, type_enum (SCHEDULED/SPECIAL/FEE_COLLECTION), requested_at, approved_by_staff_id, departure_at, expected_return_at, actual_return_at, fee_owing_flag, status
- New table: `visiting_day_log` — date, parent_name, student_id, relationship, signed_in_at, signed_out_at, sod_staff_id, area_allocated
- New table: `prospectus_check` — student_id, term, items_json (chop/mattress/mac/net/bucket/bible), fees_status, bunk_confirmed_at, checked_by_staff_id
- New table: `resumption_records` — student_id, term, expected_window, arrived_at, prospectus_check_id
- New table: `vacation_records` — student_id, term, departed_at, room_cleared, transport_contact_verified
- New table: `boarding_infractions` — student_id, severity_enum (NOTE/WARNING/BOND/SUSPENSION/DEBOARD), narrative, logged_by_staff_id, parents_notified_at, co_signs_json — **append-only**
- New table: `bond_artefacts` — infraction_id, student_signature_at, hm_witness_id, senior_hm_witness_id, scanned_pdf_file_id
- New table: `deboardinization_records` — student_id, infraction_id, hm_sign_at, senior_hm_sign_at, headmaster_sign_at, effective_at, board_review_at_nullable, reinstated_at_nullable, fee_penalty_invoice_id
- Enums: `residency_type_enum` (BOARDER/DAY/DEBOARDINIZED) · `house_gender_enum` (BOYS/GIRLS/COED) · `prefect_role_enum` · `day_type_enum` · `inspection_type_enum` · `exeat_type_enum` · `exeat_status_enum` · `infraction_severity_enum`

**Architectural decisions baked into surfaces:**

- **Boarding is structurally adjacent to the school module, not a feature of it.** `residency_type` on the student record is the only join. Day-student schools flip the entire module off; mixed schools see boarding surfaces only for boarders + currently-deboardinized students.
- **House → Dormitory → Bunk** is the three-level placement hierarchy. House has one resident HM. Bunk is the primary spatial key. `current_bunk_id` + `bunk_allocation_history` append-only. One student per bunk, one bunk per student, enforced at the database.
- **6 Houses with `gender_enum` per House** for co-ed schools — one unified roster, easy to filter, no separate boys'/girls' systems to maintain. Single-sex schools just have all Houses set to one gender.
- **5-rung discipline ladder schema-locked** (NOTE/WARNING/BOND/SUSPENSION/DEBOARDINIZATION) aligned with the canonical General SHS Rules. No sixth rung permitted. Co-sign counts enforced at the database — Deboardinization with only two signatures cannot be written.
- **Deboardinization requires 3 co-signs** (HM + Senior HM + Headmaster) and is **reversible only by the Board.** A Head cannot quietly reverse it under parental pressure. Board review window is a first-class object on the record.
- **3× boarding fee penalty per unauthorised day** creates a billing line item the moment the discipline action is logged — the first cross-module trigger from discipline into billing. Head has discretion to adjust with reason logged.
- **Resumption and Vacation are the same surface in two modes** — symmetry as user mercy. Six staggered arrival windows by Form (F3 first, F1 last). Used twice a year, worth designing harder than any other.
- **Daily schedule is the canonical YAGSHS template** (4:30 AM Rising → 9:30 PM Lights Out, SH3 extension to 10:00). Configurable per school within the GES-default reference rhythm. Saturday (weekly inspection 8 AM) and Sunday (church 7-9 PM) have separate templates; Visiting Sundays displace normal Sunday rhythm.
- **Inspection has two distinct cadences:** daily 6:10 AM (bunks, lockers, attire — 10-minute check) and weekly Saturday 8 AM (whole-house, 60 minutes). Separate datasets, separate routines.
- **Exeat policy** default: 3 scheduled per term, return-by 16:00, fee-owing students must collect fees on exeat. Special exeats Senior HM only. Approved-guardian list per student.
- **Visiting Day digital Visitor's Book** replaces paper. Gates monthly 2nd Sunday 12-4 PM with lunch shifted to 11:30. Approved-visitor verification at the gate against student record.
- **Append-only ledger** for both bunk allocation history and disciplinary infractions. No infraction is deletable; corrections appear as additional rows.
- **Pastoral protection cross-reference.** Students with active VLC pastoral cases (e.g., A. Quartey from the VLC batch) bypass the disciplinary ladder and route through the Dean instead. The ladder pauses where pastoral cases run. Hard line: no child carrying social services involvement accumulates disciplinary points the same way a peer would.
- **Sick bay/matron module shipped in its own batch.** Light placeholder on Boarding surface 4 expands into the 5-surface Sickbay module (see below). The cross-link from Boarding daily life into Today's Sickbay is the integration point.

**Editorial frame:** "Boarding is not a feature of the school module. It is structurally adjacent to it." · "The bunk is the address." · "A surface used twice a year, worth designing harder than any other." · "The signing room is a room — the software just makes sure the right people show up with the right paper." The surfaces treat boarding as the parallel operating system it actually is — different time horizons (4:30 AM → 9:30 PM), different staff hierarchy (HM → Senior HM → Headmaster), different financial flows (penalty fees), different discipline regime (5-rung, append-only, Board-reversible-only).

---

## SHS · Sickbay · Matron operations & student health (5 files)

The school-based health module. **Ghana's sickbay reality is bimodal**: nearly half of public SHS have no sickbay at all (research found 49% of 210 public SHS in Eastern/Western/Central regions lack a school-based health facility), and 59% of those without sickbays appoint **School Health Prefects** instead. The module supports three operational modes — Full sickbay (Cat A schools, ~16% with visiting doctors), First-aid station (most Cat B-C boarding schools with a matron and basic stock), and Referral-only (no on-site facility, student prefects as front line). Same schema, configurable shape per school.

The five surfaces are set in continuity with Boarding — same Asankrangwa SHS, same Wed 14 May 2026 day, advanced 23 minutes from the boarding discipline timestamp. The Matron is **Mrs Akua Bediako** (N&MC registered, 11 years on site, Asst Matron Ms Grace Antwi); the visiting doctor is **Dr K. Mensah** from Asankrangwa Government Hospital (Thursdays 14:00–17:00); the Sick Bay Prefect is **F. Tetteh** from Aggrey House (already established in Boarding surface 2). The anchor narrative case is **Adwoa Mensa** (F1 Slessor House, sickle cell disease, hydroxyurea 500mg) admitted to sickbay bed 3 at 09:14 with a mild SCD pain crisis — she appears across the live ops, visit detail, and chronic register surfaces. A second active case, **Y. Aidoo** (F3 Slessor, severe malaria, referred to district hospital at 06:45), anchors the referral log surface. **J. Manu**'s pastoral case from VLC and Boarding continues here as a pastoral-medical cross-reference pattern.

| File | Role | Purpose |
|------|------|---------|
| `schoolup-sickbay-setup.html` | Matron + Headmaster | The configuration foundation · sickbay mode picker (Full/First-aid/Referral-only with Ghana percentages) · clinical staff register + School Health Prefects · 8-bed capacity (6 general + 2 isolation) · 7-slot operating hours with 06:30 morning round canonical · 8 standing-order medications + 24-item drug stock with 3 reorder alerts · 4-hospital referral hierarchy (Asankrangwa Govt primary, Wassa Akropong overflow, St. Martin's after-hours, KATH tertiary) · SHEP + N&MC policy anchors · 3-tier parent notification rule |
| `schoolup-sickbay-today.html` | Matron | Live ops view · Wed 14 May 14:45 · current queue + Adwoa admitted bed 3 + today's medication rounds (06:30 done, 12:30 done, 21:00 due) with named students · recent visits log · active referrals out · outbreak monitor · F. Tetteh assisting with morning round |
| `schoolup-sickbay-visit-record.html` | Matron | Single visit detail for Adwoa Mensa SCD admission · vitals (temp/BP/pulse) · presenting complaint with common-complaint shortcuts · matron's assessment · hydroxyurea + paracetamol administered · admission disposition · Tier 2 parent notification fired · chronic register cross-link |
| `schoolup-sickbay-chronic-register.html` | Matron + Headmaster | 6 active cases · Adwoa (sickle cell), asthma, epilepsy, severe allergy, mental health (referral-managed not on-site), diabetes · per-student action plan as printable artefact for dorm-side HM reference · daily med schedule · emergency protocol · NHIS card status · admin-private by default with explicit per-grant for HMs · cross-link to attendance for crisis-day excused-auto-marking · J. Manu pastoral cross-reference pattern |
| `schoolup-sickbay-referral-log.html` | Matron + Headmaster | Active and historical referrals out · 2 active right now (Y. Aidoo inpatient, K. Boateng returning) · Y. Aidoo case deep-dive with ER handoff, hospital updates, 7-event parent comms thread, NHIS itemised reconciliation · today's notification timeline (3-tier rule firing 7 times today) · 30-day history table with diagnosis + hospital mix · outstanding reconciliation across 3 families · NHIS card health monitor |

**Schema additions triggered by Sickbay (~10 tables):**

- New table: `sickbays` — school_id, mode_enum (FULL/FIRST_AID/REFERRAL_ONLY), capacity_beds, isolation_beds, operating_hours_json, matron_staff_id, visiting_doctor_schedule_json, school_health_prefect_student_ids[]
- New table: `sickbay_visits` — student_id, presented_at, presenting_complaint, vitals_json, assessment_text, disposition_enum (DISCHARGE/ADMIT/REFER), attending_staff_id, parent_notified_at_nullable, tier_fired
- New table: `sickbay_admissions` — visit_id, bed_id, admitted_at, discharged_at_nullable, isolation_flag
- New table: `medications_administered` — visit_id, drug_name, dose, time, administered_by_staff_id, nhis_covered
- New table: `medication_rounds` — sickbay_id, scheduled_time, day_type, target_student_ids[] — append-only when fired
- New table: `chronic_conditions_register` — student_id, condition_enum (SICKLE_CELL/ASTHMA/EPILEPSY/ALLERGY/MENTAL_HEALTH/DIABETES/OTHER), action_plan_text, emergency_protocol_text, daily_med_schedule_json, nhis_card_number, on_site_treatable_flag, referral_managed_flag, dorm_side_artefact_pdf_file_id
- New table: `chronic_register_access_grants` — chronic_record_id, granted_to_staff_id, granted_by_staff_id, granted_at, expires_at_nullable, scope_enum (FULL_PLAN/PARTIAL/REFERRAL_ONLY)
- New table: `referrals` — visit_id, hospital_id, transport_method_enum (SCHOOL_VEHICLE/AMBULANCE/TAXI/MOTORBIKE/PARENT_COLLECT), accompanying_staff_id, parent_notified_at, departed_at, expected_return_at, actual_return_at_nullable, nhis_used, er_handoff_notes
- New table: `referral_hospitals` — school_id, name, distance_km, nhis_accepted, after_hours_capability, contact_phone, role_enum (PRIMARY/OVERFLOW/AFTER_HOURS/TERTIARY)
- New table: `drug_stock` — sickbay_id, drug_name, current_units, reorder_point, last_restocked_at
- New table: `parent_notifications` — visit_id_nullable, referral_id_nullable, sent_at, channel_enum, tier_enum (T1/T2/T3), message_text, delivery_status, acknowledged_at_nullable
- New enums: `sickbay_mode_enum`, `disposition_enum`, `chronic_condition_enum`, `transport_method_enum`, `hospital_role_enum`, `notification_tier_enum`, `notification_channel_enum`

**Architectural decisions baked into surfaces:**

- **Three operational modes via `sickbay_mode_enum`** reflecting Ghana reality. Same schema, different surface affordances. Schools without sickbays still get the chronic register and referral log; they just don't get admission workflows.
- **06:30 morning medication round is a first-class concept** — `medication_rounds` table separate from individual administrations. The morning-round time is configurable per school, but the role (scheduled named-student dispensing event) is universal.
- **3-tier parent notification rule schema-locked.** Tier 1 (gold, SMS only, light touch for routine visits with pastoral cross-reference). Tier 2 (warn, call + SMS within 1h, for sickbay admissions or chronic register events). Tier 3 (terra, phone-first within 5 min + SMS confirm, for any referral out). Visible on the setup page; enforced by every notification event.
- **Chronic register has explicit `on_site_treatable_flag` + `referral_managed_flag`** so mental health appears truthfully as referral-managed, not falsely as on-site treated. The schema captures what's known about each condition's care reality.
- **Chronic register privacy: admin-only by default** with explicit `chronic_register_access_grants` per-staff-member per-student. HMs get per-student access only where the matron decides their role requires it. Every read is in an append-only audit trail.
- **Sickle cell as anchor case.** Care plan structure built around SCD reality (hydration protocols, pain ladder, hospital escalation, hydroxyurea schedule, NHIS coverage). Generalizable to other conditions but designed around the most common chronic case in Ghanaian SHS.
- **NHIS card status captured per student.** Per drug admin captures whether covered. Cross-module trigger from non-NHIS meds into billing. Per-referral itemised reconciliation. NHIS card health monitor at the school level (92.3% coverage = healthy, expired/expiring drives bursar SMS campaign).
- **Referral as its own surface.** A referral has a multi-day tail (parent calls, hospital return, follow-up visit, NHIS reconciliation) that does not fit cleanly inside a single visit record. The referral log surfaces the operational tail.
- **SHEP + N&MC named in setup as policy anchors.** Signals the module is Ghana-designed: SHEP is the GES School Health Education Programme (oversight), N&MC scope of practice (LI 683, 1971) bounds what the matron can do without escalation. References both.
- **Pastoral protection cross-reference pattern** (J. Manu) mirrors boarding discipline. Chronic register includes mental health honestly, but the actual case management routes through VLC pastoral, not through the sickbay's clinical workflows.
- **The matron does not chase money.** Sickbay creates the cost (drug stock, parent-supplied items, NHIS-uncovered procedures); the billing module carries the receivable; the comms module sends the SMS-at-moment-of-incurring. Three modules, one source of truth, clean handoff per the resolved Tier 2 chart-of-accounts decisions.
- **Drug stock as setup tab, not separate surface.** A full pharmacy/inventory module is out of scope for MVP2; the 24-item drug master with reorder points and 3-alert thresholds is enough to drive procurement decisions without a parallel inventory system. Future enhancement.

**Editorial frame:** "The Ghanaian sickbay reality is bimodal: well-equipped, first-aid only, or referral-only." · "The 06:30 morning medication round is canonical — meds surrendered, matron dispenses, breakfast follows." · "Sickle cell is the chronic register's anchor — not because it's the only condition, but because designing for it gets all the others right." · "The matron creates the cost; the bursar carries it; the comms module tells the parent at the moment of incurring." · "Mental health appears in the chronic register honestly: referral-managed, not on-site treated." The surfaces sit at the intersection of clinical workflow (N&MC scope), policy environment (SHEP + 'One SHS, One Sickbay'), financial reality (NHIS reconciliation), and pastoral care (cross-references to VLC and Boarding) without overreaching what a school matron can actually do.

---

## SHS · WASSCE-readiness · F3 candidate trajectory & university match (5 files)

The terminal-academic module — what F3 candidates, their teachers, and their parents see in the final months before the West African Senior School Certificate Examination. Ghana's WASSCE 2026 is significant: it is the country's **first International WASSCE since 2019**, sat alongside Nigeria, Liberia, Sierra Leone, and The Gambia per the WAEC-syndicated five-anglophone-country timetable. The module covers the full cycle: programme/subject setup, two mock exams (Mock 1 in November, Mock 2 in March — predictive accuracy ~73–82% over the past 5 years), university target system with five-tier band (Target/Comfortable/Match/Stretch/Safety), and live WASSCE-window event handling.

The five surfaces are set in continuity with Sickbay — same Asankrangwa SHS, same Wed 14 May 2026, 14:45 GMT (15 minutes after sickbay's "today" timestamp). WASSCE is in progress: candidates have sat Social Studies Paper 1 on Mon 12 May; English Oral on Tue 13 May; English Language 1 and 2 on Wed 14 May morning. The narrative anchor case from Sickbay's referral log — **Y. Aidoo** (F3 Slessor, severe malaria, hospitalised at Asankrangwa Govt Hospital since 06:45 Tue) — is the WASSCE module's live disruption case. WAEC special-consideration form SC-12 was filed at 11:00 by **Mrs C. Owusu-Ansah** (Head of Academics) and acknowledged 11:32 (ref SC-12-184-2026-0044). Three English papers missed; make-up sitting pending. Per-student readiness deep-dive (surface 3), Form Master & Chem teacher view (surface 4), and parent tracker (surface 5) all center on this live case. The cohort is 240 F3 candidates across four programmes (SCI 60, BUS 60, GA 80, HE 40). Top university destinations: **KNUST 68 students** (28%), Legon 52 (22%), UCC 41 (17%), UEW 28 (12%), Takoradi Tech 21 (9%).

| File | Role | Purpose |
|------|------|---------|
| `schoolup-wassce-setup.html` | Head of Academics + Headmaster | The configuration foundation · 4 programmes × subjects matrix (SCI/BUS/GA/HE with universal cores + electives) · Mock exam cycle config (Mock 1 Nov 2025 + Mock 2 Mar 2026 + 5-yr accuracy disclosure) · University target system with 5-tier band + cut-off table (12 programmes across KNUST/Legon/UCC/UEW) · WASSCE registration roster with 240-candidate breakdown + medical exemption banner for Y. Aidoo + 9 sample candidates + cross-module ties (Sickbay/VLC/Billing) · WAEC + GES + Free SHS policy anchors |
| `schoolup-wassce-cohort-readiness.html` | Head of Academics | 240-candidate cohort view · Mock 2 distribution histogram (16% top tier 6–12, 38% very good 13–18, 31% fair 19–24, 13% weak 25+) · subject heatmap showing cohort weak spots · at-risk list of 28 students above target cut-off · house × programme breakdown (Slessor/Kufuor/Nkrumah/Aggrey × SCI/BUS/GA/HE) |
| `schoolup-wassce-student-readiness.html` | Form Master + HoA + Parent | Per-student deep-dive on Y. Aidoo, now 7 sections · sticky medical-disruption banner with SC-12 ref + 4-cell live status grid · trajectory strip (Mock 1 agg 14 → Mock 2 agg 10 → projected 10 holding) · **STPSHS submission status panel** at the foot of the deep-dive showing 21 of 24 entries submitted across 8 subjects × 3 years with per-subject Assessment Reference IDs, 1 entry locally pending (Social Studies F3, auto-pushes 14 Jul 2026), 2 entries blocked (English F3 Lang 1+2 pending SC-12 make-up) · 9-paper WASSCE schedule with completion status · 8 subject cards Mock 1 → Mock 2 → projected with teacher comments · **new Section 4: ledger trajectory for Mathematics** showing the full 40-cell evidence base (5 categories × 8 terms across F1 T1 → F3 T2), weighted totals computed at Asankrangwa's 15/15/40/15/15 configuration climbing 61.5 → 81.4, Mock 1 and Mock 2 column markers, Reference IDs per term-row, three-signal explanation of how slope and shape (not just level) produce the B2 projection · STPSHS-vs-Omnischools comparison (3 numbers vs 40 cells) embedded as the structural argument · aggregate construction visualizer (best 3 cores + best 3 electives, dropped subjects greyed not hidden) · 5 university matches (KNUST Biochem TARGET, Legon Biochem COMFORTABLE, KNUST Pharmacy STRETCH, Legon Medicine STRETCH, UCC Biochem SAFETY) · pastoral/fees/NHIS context strip · parent acknowledgment signed-PDF link · 6-event comms log Wed 14 May |
| `schoolup-wassce-subject-teacher.html` | Subject teacher | Mr S. Asiedu's Chemistry F3 cohort view · 5-cell summary strip (24 days to paper, 100% credit rate, 43% distinction, B3 cohort mean) · 9-bar grade distribution histogram · 28-candidate trajectory table with ↑→↓ flags and FOCUS/MED/SC-7 tags · 10-topic heatmap showing equilibria + electrochemistry as soft spots · 3-tier 24-day intervention plan (URGENT 3 candidates, FOCUS 12 candidates, CONSOLIDATE 13 candidates including Y. Aidoo) · benchmark vs school/region/national (100% vs 71% national credit; 43% vs 19% national distinction) · teacher CPD record + NTC licence cycle |
| `schoolup-wassce-parent-tracker.html` | Parent | A. Aidoo's view (mother of Y. Aidoo, day 2 of WASSCE) · simpler chrome, no sidebar · live status hero (Ward B bed 7, treatment responding, next paper Math Wed 3 Jun) · child quick card · 9-paper schedule with "Postponed" not "Missed" language · 5-step SC-12 process visualizer (Filed → Acknowledged → Awaiting fit-to-sit → Date scheduled → Yaa sits) with school owning steps 1–4 · 6-event chronological today's-thread with "called you" tone · Mock 2 readiness statement summary with phone-OTP signature ref · 4 info cards (Hospital · NHIS · School contacts · WAEC) · 6-question FAQ |

**Schema additions triggered by WASSCE (~13 tables):**

- New table: `wassce_programmes` — school_id, name, code, active_flag
- New table: `wassce_subjects` — programme_id, name, subject_type_enum (CORE/ELECTIVE/OPTIONAL), waec_code
- New table: `wassce_candidates` — student_id, programme_id, index_number, centre_code, waec_registered_at, subjects_sitting_json, accommodations_json, status_enum
- New table: `wassce_papers` — subject_id, name, paper_number, scheduled_date, duration_minutes, paper_type_enum (OBJECTIVE/ESSAY/PRACTICAL/ORAL)
- New table: `wassce_paper_sittings` — candidate_id, paper_id, sat_at_nullable, exempted_at_nullable, exemption_reason_nullable, make_up_at_nullable
- New table: `mock_exams` — school_id, name, scheduled_start, scheduled_end, cohort_year
- New table: `mock_results` — mock_id, candidate_id, subject_id, grade, raw_score, marked_by_staff_id, marked_at (append-only)
- New table: `university_targets` — candidate_id, university_id, programme_text, cut_off_at_target, rank_enum (TARGET/COMFORTABLE/MATCH/STRETCH/SAFETY), tagged_at, tagged_by_staff_id
- New table: `universities` — name, location, university_type_enum, public_or_private
- New table: `university_programmes` — university_id, name, cut_off_current, cut_off_history_json, prerequisite_subjects_json, updated_at
- New table: `waec_special_consideration` — candidate_id, sc_form_enum (SC-3/SC-7/SC-12), filed_at, filed_by_staff_id, status, medical_cert_file_id_nullable, waec_acknowledged_at_nullable, waec_ref_nullable, approved_at_nullable
- New table: `wassce_results` — candidate_id, subject_id, grade, raw_score, released_at (populated post-Aug from WAEC release)
- New table: `readiness_statements` — candidate_id, mock_2_id, generated_at, generated_by_staff_id, projected_aggregate, parent_acknowledged_at_nullable, parent_acknowledged_signature_pdf_file_id_nullable
- New enums: `programme_type_enum`, `subject_type_enum`, `paper_type_enum`, `university_type_enum`, `target_rank_enum`, `sc_form_enum`, `candidate_status_enum`

**Architectural decisions baked into surfaces:**

- **WASSCE setup is FROZEN for the in-flight cohort.** Programme matrix, mock results, university targets — none of these can be edited for F3 once WASSCE registration closes (typically Feb of the exam year). A change-control flow exists for typos with HoA + Headmaster co-sign and append-only audit trail; substantive changes require formal WAEC amendment. Surfaces signal frozen state visually.
- **Mock 2 = source of truth for the readiness statement.** Mock 1 (Nov, baseline) calibrates; Mock 2 (Mar, predictive) drives. The parent-signed readiness statement is generated from Mock 2 results only. Surface 3 makes the Mock 1 → Mock 2 → projected trajectory legible; surface 5 surfaces the signed statement as a stable receipt.
- **Five-tier university band, not three.** Refined from initial 3-tier (Reach/Match/Safety) to five (Target/Comfortable/Match/Stretch/Safety) after Ghana-specific research. A "Target" is the primary choice; "Comfortable" is 2–4 points below cut-off; "Match" is at cut-off ± 1; "Stretch" is 2+ points above cut-off; "Safety" is 4+ points above cut-off. The richer band reflects how Ghanaian guidance counsellors actually triage applications.
- **WAEC SC-form workflow with three forms.** SC-3 (accommodations applied pre-exam, e.g. visual impairment), SC-7 (extra time for chronic conditions, e.g. sickle cell), SC-12 (medical disruption during exam window). All three captured in `waec_special_consideration`. Filed by HoA with attached medical certificate file. WAEC acknowledgement timestamp + reference number persisted.
- **Free SHS rule: no candidate denied for fees.** Per Free SHS policy (2017–), no F3 candidate can be denied a WASSCE sitting for unpaid fees. The setup roster surfaces fee status as context only — never as a blocker. The billing module handles outstanding balances post-WASSCE. Surface 1 carries this explicitly: P. Donkor has GHS 240 outstanding and still appears in the roster as registered.
- **F3 discipline pause during WASSCE.** Per school policy (and broader Ghana SHS convention), the discipline ladder is paused for F3 candidates during the WASSCE window. Pastoral cross-references in surface 3 (A. Quartey from VLC, Dean co-monitoring) continue without disciplinary outcomes. Cross-module rule.
- **2026 International WASSCE narrative.** First International WASSCE for Ghana since 2019 — public framing matters. Surfaces date everything against the published WAEC syndicated timetable (May–Jun 2026), not against any school-only calendar. Centre code SU-0184 is registered with WAEC Regional (Sefwi-Wiawso for Western Region).
- **Mock predictive accuracy publicly disclosed.** The 73–82% 5-year accuracy is shown on the setup page as honest framing — not hidden. Parents who ask "how reliable is the projection?" get a real answer. Builds trust in the readiness statement.
- **Cross-module integration is the unique value.** Sickbay → WASSCE: medical exemption auto-suggested when sickbay admission overlaps a paper date (matron triggers HoA workflow). VLC → WASSCE: pastoral cross-reference visible without affecting eligibility (no exemption granted for pastoral; surfaces show without compromising). Billing → WASSCE: Free SHS coverage status surfaced as info only. Boarding → WASSCE: F3 prep absence excused automatically during WASSCE window. Sickbay surface 5 (`schoolup-sickbay-referral-log.html`) and WASSCE surface 3 (`schoolup-wassce-student-readiness.html`) share Y. Aidoo's case file in shared schema.
- **Subject teachers mark their own cohort's mocks.** Mr Asiedu marks his 28 Chemistry candidates' Mock 1 and Mock 2 papers. The diagnostic value (teacher knows which student understands which topic) beats the grade-inflation risk. School-wide moderation is enforced via the cohort-readiness HoA view (surface 2) cross-checking distribution against school + region history.
- **Aggregate projection HOLDS during medical disruption.** When papers are missed and SC-12 is filed, projection does not adjust — it holds at the Mock-2-derived value. False precision is worse than no update. Surface 3 explicitly states the projection caveat. Aggregate recomputes once after WAEC releases real scores in mid-August.
- **Best-3 cores + best-3 electives calculation is transparent and auditable.** Dropped subjects stay visible (greyed) on the aggregate construction visualizer. The reasoning is shown so HoAs, parents, and candidates can verify the WAEC rule has been applied correctly. Auditable both forward (projection) and backward (actual results).
- **Parent tracker is the simplest surface, by design.** No sidebar. No benchmarks. No cohort data. Just the child's status, today's events, the SC-12 process, the schedule, the readiness statement she signed in March, and a FAQ. Mobile-leaning; tone is second-person ("called you", not "called the parent").
- **The five surfaces are deliberately complementary, not redundant.** Surface 1 (Setup) defines the rules; Surface 2 (Cohort) is the HoA's analytical view; Surface 3 (Student) is the candidate-centric file used by FM + HoA + Parent; Surface 4 (Subject teacher) is the teacher's-own-cohort view with intervention planning; Surface 5 (Parent) is the parent-facing distillation. One module, five perspectives.

**Editorial frame:** "WASSCE 2026 is Ghana's first International WASSCE since 2019 — the regional calendar is back." · "Mock 2 in March is predictive; Mock 1 in November is calibration." · "Aggregate is 6 (lower is better); cut-off is the worst aggregate a university admits." · "Best 3 cores + best 3 electives — dropped subjects stay visible." · "The projection holds during medical disruption. Adjusting now is false precision." · "The school owns the SC-12 process from filing to make-up. The parent owns fit-to-sit confirmation with the clinician." · "The parent view is what we send when the child is in hospital — the chrome must not get in the way."

---

## Tier 3 · communication depth (5 files)

Richer parent-comm loop. Build after MVP1 core lands and you have feedback on which conversations need more structure.

| File | Role | Purpose |
|------|------|---------|
| `schoolup-inbox-routing.html` | Admin | Route incoming SMS/WhatsApp to correct staff |
| `schoolup-per-recipient-delivery.html` | Admin | Per-parent delivery tracking |
| `schoolup-delivery-detail.html` | Admin | Drill into single message delivery |
| `schoolup-cross-module-delivery.html` | Admin | SMS-vs-WhatsApp routing per parent preference |
| `schoolup-parent-conversations.html` | Admin | Threaded parent conversation view |
| `schoolup-reminder-series.html` | Admin | Multi-message fee reminder sequences |

---

## Tier 4 · operational parity (6 files)

Trust artefacts. The MoE and auditors expect these. Without them, Omnischools is a "pilot tool" not a "platform of record."

| File | Role | Purpose |
|------|------|---------|
| `schoolup-audit-log-viewer.html` | Admin | Append-only audit log feed and drill-down |
| `schoolup-data-export.html` | Admin | Quick exports + custom builder + full archive |
| `schoolup-bulk-operations.html` | Admin | Bulk-action pattern · selection → confirm → result → audit |
| `schoolup-2fa-enrolment.html` | Admin | Two-factor authentication enrolment |
| `schoolup-bulk-undo.html` | Admin | Tiered undo for bulk operations |
| `schoolup-archive-password-recovery.html` | Admin | "Forgot password" → generate fresh archive flow |

---

## Deferred · scope-aware extras (3 files)

Designed for completeness. Launch decision per surface — most are MVP2 or later.

| File | Role | Purpose |
|------|------|---------|
| `schoolup-activation-segregation.html` | Admin | Active vs dormant parent segmentation |
| `schoolup-parent-portal-conversations.html` | Parent | Parent's conversation thread view |
| `schoolup-retention-policy.html` | Admin | Data retention policy configuration |

---

## Omnischools Oversight · GES district/regional/national surfaces (13 files)

The third product line. Observational dashboards for GES district directors, regional directors, and MoE/national staff, reading from a separate analytics database (never the operational DB). Served from `oversight.omnischools.gh`, separate `apps/oversight` app in the monorepo. Oversight users are a separate GES-provisioned user pool scoped by jurisdiction, not by school. Full scope in `BUILD_STACK.md` under "Oversight product line · architectural decisions worth preserving" — **all six scoping decisions resolved**, including the analytics DB schema and ETL spec which is documented separately in `OVERSIGHT_ANALYTICS_SPEC.md`.

**Surface inventory** (all 13 built across three batches):

| Surface | Audience | Purpose | Status |
|---------|----------|---------|--------|
| District director dashboard | District director | Anchor surface · district enrolment, performance, attendance, teacher stats, fees · school list with drill-down | **Built** · `schoolup-oversight-district-dashboard.html` |
| School detail view | All three | Drill-down target from any tier · one school's full Oversight profile · compare-against picker · the compliance boundary | **Built** · `schoolup-oversight-school-detail.html` |
| Oversight user onboarding | New Oversight user | First-sign-in flow for a newly GES-provisioned district/regional director | **Built** · `schoolup-oversight-onboarding.html` |
| Enrolment vs population analysis | All three | Signature comparative surface · stage-for-stage enrolment vs GSS age-band population · out-of-school-children per stage | **Built** · `schoolup-oversight-enrolment-population.html` |
| Academic performance analysis | All three | External BECE/WASSCE outcomes plus internal termly/annual/mock performance · by school, Form, subject, sex | **Built** · `schoolup-oversight-academic-performance.html` |
| Comparison workspace | All three | Side-by-side comparison of selected schools/districts/regions on any theme | **Built** · `schoolup-oversight-comparison-workspace.html` |
| Regional dashboard | Regional director | District comparison · drill into any district or school | **Built** · `schoolup-oversight-regional-dashboard.html` |
| National dashboard | MoE/national | National rollup · regional comparison · policy indicators | **Built** · `schoolup-oversight-national-dashboard.html` |
| Compliance record view | All three | Named-record access · justification-gated and audit-logged | **Built** · `schoolup-oversight-compliance-record.html` |
| Anomaly / investigation queue | District director, MoE | Flagged outliers for follow-up · triage workflow | **Built** · `schoolup-oversight-anomaly-queue.html` |
| Data sharing agreement management | MoE/national | Which schools signed, agreement versions, scope per school | **Built** · `schoolup-oversight-dsa-management.html` |
| Oversight access &amp; audit log | MoE/national | Who accessed what, when, with what justification | **Built** · `schoolup-oversight-access-audit.html` |
| Exports | All three | CSV / PDF for official GES reporting · coverage stamp travels with the file · named-record exports gated &amp; logged | **Built** · 2 sections · `schoolup-oversight-exports.html` |

**Access model — a note on a corrected decision:** an earlier draft of Oversight Decision 6 included a school-facing "what GES can see about us" surface in the operational app, letting schools monitor which GES officers accessed their data. This was dropped. GES is the statutory governing body of these schools and has standing authority to view and request their data; framing GES access as something a school monitors wrongly implied a peer relationship. Accountability for GES officers' use of access runs *upward and lateral within GES* — regional, national, and internal-audit review of the access log — not downward to schools. See `BUILD_STACK.md` Decision 6.

---

## Build priority — concrete recommendation

If you're solo-developing, build in this order:

### Sprint 1 (weeks 1–4) · the spine
1. **Onboarding wizard** — without this nothing else exists
2. **Attendance mobile + desktop** — the daily-use flagship
3. **Settings + customise list** — admins need to configure their school
4. **Empty states** — small but ubiquitous

### Sprint 2 (weeks 5–8) · the money
5. **Payment data model** — implement first, design with the model in mind
6. **Record payment drawer + receipt PDF**
7. **Send reminders + collection trend**
8. **Discount management**

### Sprint 3 (weeks 9–12) · the loop
9. **Announcements + SMS library**
10. **Attendance alerts + parent attendance view**
11. **GES return** — the MoE pitch needs this working
12. **Reports + school stats**

### Sprint 4 (weeks 13–16) · trust before launch
13. **Audit log viewer**
14. **Data export**
15. **2FA enrolment**
16. **Static "Trust & Reliability" landing page** (distilled from `schoolup-backup-dr.html`)

That's launch-ready MVP1 in roughly 16 weeks of solo dev, assuming the stack is chosen and the design system is consolidated before sprint 1.

### After MVP1 · Omnischools Senior build sequence

When Basic is in market and earning revenue, open the SHS track. The build sequence mirrors the design sequence:

1. **SHS · Batch 0** — apply the schema additions above. Ship the six Batch 0 surfaces. Onboarding wizard now branches by school type.
2. **Forms/PTA module** — four-tier PTA (Form / House / General / Emergency) with attendance registers for both teachers and parents.
3. **PLC/CPD module** — weekly teacher PLC attendance, CPD points ledger across the four NTC categories, license-renewal report.
4. **VLC module** — weekly student Values Learning Community attendance, Peer Guide role, 22-session curriculum tracker.
5. **Boarding operations** — requires its own research session first, then design batch.
6. **WASSCE-readiness reports** — programme-specific grade tracking, mock exams, Form 3 transcripts.

### After Senior · Omnischools Oversight track

Only when Senior has real schools sending real data:

1. **Analytics database provisioning** — separate Postgres or warehouse, ETL'd nightly from operational.
2. **Oversight app skeleton** — `oversight.omnischools.gh` · separate Next.js app · GES staff login · jurisdiction-aware RLS.
3. **Oversight dashboards** — district view, regional view, national view · cross-tier filters (Basic/JHS/SHS/SHTS) · SHS-specific compliance metrics (PLC/VLC/CPD).

Don't build Oversight first hoping to win GES as anchor customer. Build schools-facing first; let Oversight be expansion when data is flowing.

---

## Files NOT in this index

There are likely a few earlier files (`wireframes.html`, `wireframes.bak.html`, `routing.html`, etc.) that exist in the design archive but were superseded by later iterations. Use only the `schoolup-*.html` files in `/mnt/user-data/outputs/` as the canonical design spec.

**Marketing artefacts** (not product surfaces, kept separate):

- `omnischools-landing.html` — the public marketing landing page · sticky nav, hero with student image, six-feature grid, pricing tiers, book-a-demo form, FAQ, dark-navy footer · uses the same design tokens as the product surfaces · companion images in `img/hero-students.png` and `img/about-headmaster.png` (AI-generated, flagged for replacement with commissioned local photography before launch)

---

## Companion files

- `design-tokens.css` — extracted CSS custom properties from all surfaces
- `design-tokens.json` — same tokens in JSON for Tailwind/Style Dictionary consumption
- `BUILD_STACK.md` — recommended technology stack (separate doc)
- `SHS_SCORE_LEDGER_SPEC.md` — the canonical design document for the five-category score ledger and three capture paths (supersedes the STPSHS-first framing)
- `OVERSIGHT_ANALYTICS_SPEC.md` — analytics DB schema and ETL spec for Omnischools Oversight (all six Oversight decisions resolved)
- `STPSHS_INTEGRATION_SPEC.md` — research and integration design for WAEC's STPSHS portal (now subordinate to the score ledger spec, retained as research material on the regulator side)
- `SSP_INTEGRATION_SPEC.md` — research and integration design for the NaCCA/CENDLOS Subject Specific Apps (the QR-distributed Playlab.ai apps)

---

*Last updated: 31 May 2026 · Three SHS Score Ledger surfaces added · Score Ledger architectural decisions documented · Oversight section reclassified as fully built*
