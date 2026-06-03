# Omnischools · Build Stack Recommendation

> An opinionated stack for Omnischools specifically — solo developer, multi-tenant SaaS, Ghana-hosted users, MVP1 in ~16 weeks. Not generic "best practices."

---

## The frame

Before any specific tool, four constraints shape every decision below:

1. **Solo developer.** Every operational burden is yours. Prefer "works without me thinking about it" over "infinitely tunable."
2. **Multi-tenant from day one.** Wrong choices here are expensive to undo. Get the data model right before sprint 1.
3. **Ghanaian schools as primary users.** Latency to West Africa, cheap Android phones, intermittent connectivity, basic-phone parents on SMS.
4. **Trust matters more than features.** Schools, parents, and the MoE need to trust Omnischools before they pay. Stack choices that compromise audit, security, or reliability are not on the table.

---

## TL;DR — the recommended stack

| Layer | Choice | Why |
|-------|--------|-----|
| **Framework** | Next.js 14+ (App Router) | Solo-dev friendly · server components · Vercel one-click deploy |
| **Language** | TypeScript | Non-negotiable for a multi-tenant SaaS |
| **Styling** | Tailwind CSS + shadcn/ui | Consumes `design-tokens.json` directly · accessible primitives |
| **Database** | PostgreSQL on Supabase (EU-West-2, London) | Closest reliable region to Ghana · Postgres for everything |
| **ORM** | Drizzle | Schema-first · type-safe · close to SQL |
| **Auth** | Supabase Auth | Phone OTP + email/password built-in · integrates with database |
| **Multi-tenancy** | Shared schema · `school_id` per row · Postgres RLS · `school_type` gates features | One operational DB · separate analytics DB for Oversight tier (provisioned when needed) |
| **SMS** | Hubtel (primary) · Africa's Talking (fallback abstraction) | Local provider · MTN+Telecel+AirtelTigo coverage |
| **Payments** | Hubtel aggregator (MVP2) · manual MoMo (MVP1) | Per the design decisions already made |
| **Hosting** | Vercel (app) · Supabase (DB + auth + storage) | One bill each · sensible defaults |
| **Email** | Resend | Developer-friendly · cheap · good Ghana deliverability |
| **Monitoring** | Sentry (errors) · PostHog (product analytics) | Trust-grade · privacy-respecting |
| **Status page** | BetterStack | Cheap tier · separate provider from main app |
| **Repo / CI** | GitHub + GitHub Actions | Auto-deploys to Vercel on main |

This stack costs roughly **$45–80/month at MVP1 scale** (1–10 schools), **$200–400/month at 50 schools**.

---

## The decisions in detail

### Frontend framework — Next.js, not React-without-a-framework

For a solo dev shipping a CRUD-heavy multi-tenant app, the pre-baked routing, server components, and file-based conventions are worth the lock-in. The alternative — React + Vite + your own routing + your own SSR + your own data fetching — is six weeks of plumbing you don't need to write.

**Why Next.js specifically:**
- Server components mean you fetch from Postgres directly without API routes for the read path. Less code, less serialization.
- Server Actions handle mutations cleanly without a separate API service.
- Edge middleware for tenant routing (`omnischools.gh/ctkjhs/...` or `ctkjhs.omnischools.gh/...`).
- Vercel deploys are one git push.
- Largest React community → easiest help when you're stuck at midnight.

**Why not the alternatives:**
- *Remix:* Technically excellent, smaller community, less Ghana-relevant tooling. Pick if you have strong React Router muscle memory.
- *SvelteKit:* Lovely DX, but the ecosystem (component libraries, tutorials, hire-able help) is smaller. Risky for a solo dev.
- *Vue/Nuxt:* Same concern — smaller pool of help and components.
- *Astro:* Wrong fit — it's content-leaning. Right answer for the marketing site, wrong for the app.

### Styling — Tailwind, not CSS-in-JS or vanilla CSS modules

You already have `design-tokens.json`. Tailwind's `tailwind.config.ts` consumes it directly:

```ts
import tokens from './design-tokens.json'
export default {
  theme: {
    colors: {
      navy: tokens.color.navy.DEFAULT.value,
      'navy-2': tokens.color.navy['2'].value,
      gold: tokens.color.gold.DEFAULT.value,
      // ...
    },
    fontFamily: {
      display: tokens.font.family.display.value,
      body: tokens.font.family.body.value,
    },
  },
}
```

After that, every utility class (`text-navy`, `bg-gold-bg`, `font-display`) maps to your tokens. You can paste any of the 62 design files into Claude Code and ask it to convert to React + Tailwind — the design tokens line up.

**shadcn/ui** for component primitives: dropdowns, dialogs, tooltips, popovers, accessible by default, copy-pasted into your codebase (not a runtime dependency). Customise to match Omnischools's editorial style — italic gold em tags, Fraunces headings, pill-shaped status badges.

### Database — Postgres on Supabase

PostgreSQL is the right database for Omnischools full stop. Not MySQL (weaker JSON, weaker constraints), not MongoDB (you have relations everywhere), not SQLite (multi-tenant doesn't fit).

**Why Supabase as the host:**
- One product gives you Postgres + auth + storage + realtime
- EU-West-2 (London) is the closest reliable Supabase region to Ghana — measured latency is ~120ms which is fine for a non-realtime app
- Row-Level Security (RLS) policies for tenant isolation enforced at the database, not just the application
- Branching for staging environments
- Free tier covers MVP1 development; Pro at $25/mo is plenty for the first dozen schools

**Trade-offs to be aware of:**
- Supabase = vendor lock-in to a degree. Migration to raw Postgres on AWS RDS later is doable (it's just Postgres) but the auth and storage portions will need replacement.
- For higher scale (100+ schools or specific compliance needs), self-hosted Postgres becomes worth it. Not now.

### ORM — Drizzle, not Prisma

Both are excellent. Drizzle wins for Omnischools because:
- Lighter runtime — Prisma's binary engine is overkill
- Closer to SQL — when you need to write complex multi-tenant queries with RLS-aware joins, Drizzle gets out of your way
- Faster cold starts on Vercel — matters for serverless

Prisma is friendlier for absolute beginners but has a steeper bill at runtime. Pick Drizzle.

### Multi-tenancy — shared schema with `school_id`, RLS-enforced

This is the most important architectural decision in the document. **Get it right before you write a line of feature code.**

**The model:**

Every table that holds school data carries a `school_id` column. Postgres RLS policies enforce that no query can ever return rows from another tenant. Application-level checks (the `school_id` on the session) are defense in depth, not the primary boundary.

```sql
-- Example RLS policy on the students table
CREATE POLICY tenant_isolation ON students
  USING (school_id = current_setting('app.current_school')::uuid);
```

The session sets `app.current_school` after auth resolves the user's school context. Every query is automatically tenant-scoped — including queries you forgot to scope explicitly.

**Why not the alternatives:**
- *Schema per tenant:* Doesn't scale beyond ~100 tenants. Migrations become per-school, which is operational hell.
- *Database per tenant:* Wrong unless you have specific compliance reasons. Multiplies your operational burden by N.
- *Serverless functions per tenant:* Resume CV-driven architecture; not a fit.

**The cross-tenant case:**

Some queries must span tenants — MoE reporting, support staff helping a school, internal analytics. Build these as explicit "admin" queries that bypass RLS, with logging. Don't let normal app code do this; auditors and security reviewers will look for exactly this.

### Product tiers — three products, one codebase, two databases

Added 13 May 2026 after research into SHS structure and conversations with an ex-GES member about Ministry-side monitoring needs.

**Omnischools ships as three product lines:**

| Product | What it is | Shape |
|---------|-----------|-------|
| **Omnischools Basic** | KG, Primary, JHS | Operational SaaS · admins use daily · per-school subscription |
| **Omnischools Senior** | SHS, SHTS | Operational SaaS · same shape as Basic with extra modules |
| **Omnischools Oversight** | GES district/regional directors, MoE | Observational dashboards · no school admins · jurisdiction-scoped |

**One codebase.** Same Next.js app, same repo. SHS-specific features gate on `schools.school_type`. Oversight is a separate Next.js app in the same monorepo at `oversight.omnischools.gh`.

**Two databases.** Operational data lives in one Postgres (the one already designed). Oversight reads from a separate analytics database, populated nightly via ETL.

**Why a separate analytics database for Oversight:**

1. **RLS doesn't compose.** Postgres RLS gives "this school sees only its own rows" cleanly. Adding "this district director sees rows where school.district_id = their district" on top requires nested policies that interact unpredictably with operational queries. The kind of complexity that produces security incidents.

2. **Aggregation kills operational latency.** "Today's attendance for JHS 2A" is fast. "Monthly attendance trends for all 312 schools in Eastern Region over 3 years" is slow. Running both on the same database degrades the operational experience or forces over-provisioning. Pre-computing nightly is cheaper.

3. **Privacy boundary.** GES doesn't need raw student records to do their job — they need rates, counts, compliance percentages. Architecturally barring access to raw records is something you can promise private-school subscribers truthfully.

**The ETL job:**

Runs at 02:00 GMT (same window as the nightly snapshot from `backup-dr.html`). Reads from operational, computes school-scoped aggregates, writes to analytics. Schools that haven't opted in to GES data sharing are excluded. Public schools opt in by default (GES is the regulator); private schools require explicit consent recorded in `ges_data_sharing_agreements`.

**Provisioning timing:**

Provision the operational database now (Supabase project · `omnischools-prod`). **Don't provision the analytics database until Oversight is ~3 months from launch.** Don't carry operational complexity until you need it. But design the data shape from day one so that aggregating later is a script, not a redesign.

When the time comes:
- Second Supabase project (`omnischools-analytics-prod`) or a managed warehouse if scale demands (ClickHouse, BigQuery)
- Cron job in the main app does the ETL (start simple — `pg_dump` selected aggregates and `\COPY` them across)
- Separate Next.js app for `oversight.omnischools.gh` with its own auth (GES staff accounts, not school accounts)
- Jurisdiction-aware RLS on the analytics DB: `WHERE district_id = current_setting('app.current_district')::uuid` for district directors, region equivalent for regional directors, no filter for MoE national view

### SHS data model — additions to MVP1 schema

The SHS Batch 0 design surfaces drive these schema changes. **All are backward-compatible with MVP1 Basic-school data.** For a basic-school subscriber, the new tables exist but stay empty; the new nullable columns stay NULL.

**On the existing `schools` table** (small additions, useful even for Basic):

```sql
ALTER TABLE schools
  ADD COLUMN school_type school_type_enum NOT NULL DEFAULT 'BASIC',
  ADD COLUMN district_id UUID REFERENCES districts(id),
  ADD COLUMN region_id UUID REFERENCES regions(id),
  ADD COLUMN ownership_type ownership_enum NOT NULL DEFAULT 'PRIVATE';

CREATE TYPE school_type_enum AS ENUM ('BASIC', 'JHS', 'SHS', 'SHTS', 'MULTI_TIER');
CREATE TYPE ownership_enum AS ENUM ('PUBLIC', 'PRIVATE', 'MISSION', 'INTERNATIONAL');
```

**Reference tables** (seeded once from GES's official lists, ~260 districts and 16 regions):

```sql
CREATE TABLE regions (id UUID PK, name TEXT, code TEXT UNIQUE);
CREATE TABLE districts (id UUID PK, region_id UUID FK, name TEXT, code TEXT UNIQUE);
```

**On the existing `students` table** (nullable, populated only for SHS):

```sql
ALTER TABLE students
  ADD COLUMN programme_id UUID REFERENCES programmes(id),
  ADD COLUMN house_id UUID REFERENCES houses(id),
  ADD COLUMN residential_status residential_enum;

CREATE TYPE residential_enum AS ENUM ('DAY', 'BOARDING');
```

**On the existing `classes` table** (nullable, populated only for SHS):

```sql
ALTER TABLE classes
  ADD COLUMN programme_id UUID REFERENCES programmes(id),
  ADD COLUMN section TEXT; -- A, B, C, etc.
```

**Refactor to the staff model** — most consequential change because it touches Basic-school code:

```sql
-- BEFORE: staff.role TEXT (single role)
-- AFTER:  staff_role_assignments table (multi-role per person)

CREATE TABLE staff_role_assignments (
  id UUID PK,
  staff_id UUID FK,
  role_type TEXT, -- 'SUBJECT_TEACHER', 'HOUSEMASTER', 'AHM_ACADEMIC', etc.
  scope_ref UUID, -- programme_id for subject teacher, house_id for housemaster
  start_date DATE,
  end_date DATE, -- NULL = currently active
  compensation_impact_ghs DECIMAL(10,2)
);

-- staff.role becomes a derived view from this table
```

This refactor applies to Basic too — primary-school teachers often hold multiple roles (Class 3 teacher + Sports coordinator). Better to model multi-role from the start than retrofit.

**New tables — SHS-only, empty for Basic schools:**

```sql
CREATE TABLE programmes (id, school_id, name, code, active_since);
CREATE TABLE houses (id, school_id, name, colour, gender, residency_type);
CREATE TABLE house_assignments (id, student_id, house_id, assigned_at);
CREATE TABLE subjects (id, school_id, name, programme_id, is_core, form_levels);
CREATE TABLE ges_ranks (id, name, level, salary_band); -- seeded reference data

-- PLC/CPD batch · the complete schema (May 2026)
CREATE TYPE plc_type_enum AS ENUM ('SUBJECT', 'CROSS_CUTTING', 'NEW_TEACHER');
CREATE TYPE cpd_source_enum AS ENUM ('PLC_ATTEND', 'PLC_REFLECT', 'PLC_FACILITATE', 'WORKSHOP', 'ONLINE_COURSE', 'MENTORING', 'CONFERENCE', 'ACTION_RESEARCH', 'SUBJECT_PRO', 'NTC_INDUCTION', 'OTHER');
CREATE TYPE ntc_sync_status_enum AS ENUM ('QUEUED', 'SYNCED', 'FAILED', 'SKIPPED');

CREATE TABLE plcs (id, school_id, plc_type plc_type_enum, name, facilitator_staff_id, cadence_override_json, active);
CREATE TABLE plc_memberships (id, plc_id, staff_id, role, joined_at, left_at);  -- role: 'member' or 'facilitator'
CREATE TABLE plc_term_focus (id, plc_id, term, focus_text, set_by_staff_id, set_at);
CREATE TABLE plc_sessions (id, plc_id, week_no, term, scheduled_at, started_at, closed_at, agenda_json, focus_text, status);
CREATE TABLE plc_attendance (id, plc_session_id, staff_id, status attendance_status_enum, marked_at, marked_by_staff_id, reflection_submitted_at, reflection_text_json);
CREATE TABLE cpd_points_ledger (id, staff_id, source_type cpd_source_enum, source_ref_id, points, awarded_at, ntc_sync_status ntc_sync_status_enum, ntc_synced_at, ntc_sync_batch_id, ntc_response_code, evidence_file_id);  -- append-only
CREATE TABLE cpd_source_rules (id, school_id, source_type cpd_source_enum, points_per_unit, cap_pts_annual, evidence_required);  -- per-school configurable
CREATE TABLE cpd_evidence_uploads (id, staff_id, file_id, source_ledger_id, uploaded_at);
CREATE TABLE ntc_licences (id, staff_id, ntc_id, issued_at, expires_at, cycle_start, cycle_end, cumulative_pts_required, status);
CREATE TABLE ntc_sync_batches (id, school_id, batch_code, scheduled_at, completed_at, status, entry_count, success_count, failure_count, duration_ms);
CREATE TABLE ntc_sync_failures (id, ledger_entry_id, batch_id, error_code, error_message, attempt_count, resolution_status, resolved_at);
CREATE TABLE ntc_api_health (id, school_id, checked_at, response_ms, status_code, healthy);  -- 5-min health checks

-- VLC batch · the complete schema (May 2026)
CREATE TYPE vlc_session_type_enum AS ENUM ('INTRO', 'APPLICATION');
CREATE TYPE vlc_flag_severity_enum AS ENUM ('LOW', 'MED', 'HIGH');
CREATE TYPE vlc_flag_status_enum AS ENUM ('OPEN', 'FM_CHECKIN', 'ESCALATED', 'RESOLVED');

CREATE TABLE vlc_values (id, school_id, value_no, name_en, name_twi, name_ga, description, term_assignment, sequence_order, customisable);  -- the 11 (or 12) values
CREATE TABLE vlc_curriculum (id, value_id, session_type vlc_session_type_enum, week_no, default_focus_text, default_activities_json);  -- the 22 sessions
CREATE TABLE vlc_programme_config (id, school_id, cadence_day, start_time, session_length_min, active);  -- school-level cadence

CREATE TABLE peer_guides (id, class_id, student_id, term_no, term_count, assigned_at, stepped_down_at, reason_text);  -- term assignment · term_count tracks 1st/2nd/3rd term
CREATE TABLE peer_guide_training_sessions (id, school_id, scheduled_at, topic, led_by_staff_id, duration_min, materials_file_id);
CREATE TABLE peer_guide_training_attendance (id, training_session_id, peer_guide_id, status attendance_status_enum, marked_at);
CREATE TABLE peer_guide_selection_history (id, student_id, class_id, term_no, served_at, ended_at, fm_observation);  -- audit trail for school-leaver reports

CREATE TABLE vlc_sessions (id, class_id, value_id, session_type vlc_session_type_enum, week_no, scheduled_at, started_at, closed_at, focus_text, status);
CREATE TABLE vlc_attendance (id, vlc_session_id, student_id, status attendance_status_enum, marked_at, marked_by_staff_id);  -- FM marks, not PG
CREATE TABLE vlc_session_groups (id, vlc_session_id, peer_guide_id, group_label, member_student_ids[]);  -- the small-group split
CREATE TABLE vlc_pastoral_flags (id, vlc_session_id, student_id, raised_by_staff_id, raised_by_peer_guide_id, severity vlc_flag_severity_enum, narrative_text, status vlc_flag_status_enum, escalated_to_staff_id, resolved_at, resolution_notes);  -- session-tied event · private FM+Dean only
CREATE TABLE vlc_reflections (id, vlc_session_id, student_id, journal_text, written_at, word_count, committed_action_text);  -- append-only · phase 4 in-session
CREATE TABLE vlc_fm_pastoral_notes (id, student_id, fm_staff_id, vlc_session_id, severity vlc_flag_severity_enum, narrative_text, case_status, created_at);  -- case-level FM notebook · may or may not be session-tied · FM+Dean only · append-only
CREATE TABLE vlc_pg_observations (id, peer_guide_id, student_id, vlc_session_id, narrative_text, created_at);  -- PG observations of group members · visible to FM only · feeds character paragraph draft
CREATE TABLE vlc_character_paragraphs (id, student_id, academic_year, draft_text, finalised_text, finalised_by_fm_staff_id, finalised_at, source_reflection_ids[], source_fm_note_ids[], source_pg_obs_ids[]);  -- auto-drafted from journal+notes+observations · FM finalises · feeds school-leaver letter, not transcript

-- Forms/PTA batch · the complete schema (May 2026)
CREATE TYPE pta_tier_enum AS ENUM ('FORM', 'HOUSE', 'GENERAL', 'EMERGENCY');
CREATE TYPE pta_dues_basis_enum AS ENUM ('PER_STUDENT', 'PER_FAMILY');
CREATE TYPE pta_dues_cadence_enum AS ENUM ('PER_TERM', 'PER_YEAR', 'ONE_OFF');
CREATE TYPE pta_classification_enum AS ENUM ('DISCUSSION', 'ACTION', 'RESOLUTION');
CREATE TYPE attendance_status_enum AS ENUM ('PRESENT', 'LATE', 'ABSENT');

CREATE TABLE pta_tiers_config (id, school_id, tier pta_tier_enum, active, meeting_frequency_norm, officer_roles_json, dues_enabled, dues_amount_ghs, dues_basis pta_dues_basis_enum, dues_cadence pta_dues_cadence_enum, quorum_rule_text, UNIQUE(school_id, tier));
CREATE TABLE ptas (id, school_id, tier pta_tier_enum, scope_ref_type, scope_ref_id, created_at);  -- scope_ref points to class_id for FORM, house_id for HOUSE, NULL for GENERAL/EMERGENCY
CREATE TABLE pta_dues_config_history (id, pta_tier_config_id, effective_from, amount_ghs, basis, cadence, changed_by_staff_id, change_reason);  -- append-only · forward-only dues changes
CREATE TABLE pta_officers (id, pta_id, person_type, person_id, role, term_start, term_end, election_basis_text, assigned_by_staff_id, assigned_at);
CREATE TABLE pta_meetings (id, pta_id, scheduled_at, location, agenda_text, status, called_by_staff_id, sms_invite_sent_at, started_at, closed_at);
CREATE TABLE pta_attendance (id, pta_meeting_id, attendee_type, attendee_id, status attendance_status_enum, marked_at, marked_by_staff_id);  -- two parallel registers via attendee_type
CREATE TABLE pta_minutes (id, pta_meeting_id, status, preamble_json, secretary_staff_id, draft_at, submitted_at, adopted_at, distributed_at);
CREATE TABLE pta_agenda_items (id, pta_minutes_id, item_number, item_title, narrative_text, classification pta_classification_enum);
CREATE TABLE pta_action_items (id, pta_minutes_id, action_text, owner_type, owner_id, deadline, status, completed_at);
CREATE TABLE pta_resolutions (id, pta_minutes_id, resolution_number, resolution_title, resolution_text, votes_for, votes_against, votes_abstain, passed, binding);
CREATE TABLE pta_dues_invoices (id, pta_id, billing_invoice_id, parent_id, family_id, student_id, amount_ghs, status, issued_at, paid_at);  -- links into the standard billing pipeline
CREATE TABLE pta_dues_reminders (id, pta_dues_invoice_id, channel, sent_at, sent_by_staff_id);

CREATE TABLE ges_data_sharing_agreements (id, school_id, version, agreed_at, scope_json);

-- Boarding batch · the complete schema (May 2026)
CREATE TYPE residency_type_enum AS ENUM ('BOARDER', 'DAY', 'DEBOARDINIZED');
CREATE TYPE house_gender_enum AS ENUM ('BOYS', 'GIRLS', 'COED');
CREATE TYPE prefect_role_enum AS ENUM ('HEAD', 'DINING', 'SANITATION', 'PREP', 'SICKBAY');
CREATE TYPE day_type_enum AS ENUM ('WEEKDAY', 'SATURDAY', 'SUNDAY', 'VISITING_SUNDAY');
CREATE TYPE inspection_type_enum AS ENUM ('DAILY', 'WEEKLY');
CREATE TYPE exeat_type_enum AS ENUM ('SCHEDULED', 'SPECIAL', 'FEE_COLLECTION');
CREATE TYPE exeat_status_enum AS ENUM ('REQUESTED', 'APPROVED', 'DEPARTED', 'RETURNED', 'OVERDUE', 'CANCELLED');
CREATE TYPE infraction_severity_enum AS ENUM ('NOTE', 'WARNING', 'BOND', 'SUSPENSION', 'DEBOARDINIZATION');

CREATE TABLE houses (id, school_id, name, gender house_gender_enum, colour_hex, founded_year, named_after, capacity, hm_staff_id, assistant_hm_staff_id, building_location, active, UNIQUE(school_id, name));
CREATE TABLE dormitories (id, house_id, name, building_location, bunk_count, section_label, active);  -- e.g., 'Dorm D · Aggrey · upper floor'
CREATE TABLE bunks (id, dormitory_id, position_number, prefect_designation prefect_role_enum NULL, active, UNIQUE(dormitory_id, position_number));

CREATE TABLE student_residency (id, student_id, residency_type residency_type_enum, current_bunk_id NULL, became_boarder_at, became_day_at, last_changed_at, last_changed_by_staff_id);  -- one row per student · partial UNIQUE on current_bunk_id WHERE NOT NULL
CREATE TABLE bunk_allocation_history (id, student_id, bunk_id, from_at, to_at NULL, reason_enum, reason_text, allocated_by_staff_id);  -- append-only · open-ended to_at is current allocation

CREATE TABLE house_prefects (id, house_id, student_id, role prefect_role_enum, term, academic_year, appointed_by_staff_id, appointed_at, stepped_down_at NULL, reason_text);

CREATE TABLE daily_schedule_template (id, school_id, day_type day_type_enum, activities_json, active, version);  -- the YAGSHS 4:30 AM → 9:30 PM template by default
CREATE TABLE inspections (id, dormitory_id, inspected_at, inspected_by_staff_id, type inspection_type_enum, findings_json, pass_fail, anomalies_count);

CREATE TABLE exeats (id, student_id, type exeat_type_enum, requested_at, requested_by, approved_by_staff_id, approved_at, departure_at, expected_return_at, actual_return_at NULL, fee_owing_flag, status exeat_status_enum, exeat_card_pdf_file_id, escalation_sms_sent_at NULL);

CREATE TABLE visiting_day_log (id, school_id, date, parent_name, parent_phone, student_id, relationship, signed_in_at, signed_out_at NULL, sod_staff_id, area_allocated, visitor_approved_in_advance, anomaly_flag, anomaly_narrative);

CREATE TABLE prospectus_check (id, student_id, term, items_json, fees_status, bunk_confirmed_at NULL, checked_by_staff_id, completed_at);  -- items_json: {chop_box, mattress, mackintosh, mosquito_net, bucket, bible_or_quran}
CREATE TABLE resumption_records (id, student_id, term, academic_year, expected_window, arrived_at, prospectus_check_id, fees_status_at_arrival, issues_text);
CREATE TABLE vacation_records (id, student_id, term, academic_year, departed_at, room_cleared, transport_contact_verified, belongings_storage_decision);

CREATE TABLE boarding_infractions (id, student_id, severity infraction_severity_enum, narrative_text, logged_by_staff_id, logged_at, parents_notified_at NULL, co_signs_json, parent_infraction_id NULL, status);  -- append-only · parent_infraction_id allows escalation chain
CREATE TABLE bond_artefacts (id, infraction_id, student_signature_at, hm_witness_staff_id, hm_witness_at NULL, senior_hm_witness_staff_id, senior_hm_witness_at NULL, scanned_pdf_file_id, bond_text);
CREATE TABLE deboardinization_records (id, student_id, infraction_id, hm_sign_staff_id, hm_sign_at, senior_hm_sign_staff_id, senior_hm_sign_at, headmaster_sign_staff_id, headmaster_sign_at, effective_at, board_review_at NULL, board_decision_text NULL, reinstated_at NULL, fee_penalty_invoice_id);

-- Sickbay batch · the complete schema (May 2026)
CREATE TYPE sickbay_mode_enum AS ENUM ('FULL', 'FIRST_AID', 'REFERRAL_ONLY');
CREATE TYPE disposition_enum AS ENUM ('DISCHARGE', 'ADMIT', 'REFER');
CREATE TYPE chronic_condition_enum AS ENUM ('SICKLE_CELL', 'ASTHMA', 'EPILEPSY', 'ALLERGY', 'MENTAL_HEALTH', 'DIABETES', 'OTHER');
CREATE TYPE transport_method_enum AS ENUM ('SCHOOL_VEHICLE', 'AMBULANCE', 'TAXI', 'MOTORBIKE', 'PARENT_COLLECT');
CREATE TYPE hospital_role_enum AS ENUM ('PRIMARY', 'OVERFLOW', 'AFTER_HOURS', 'TERTIARY');
CREATE TYPE notification_tier_enum AS ENUM ('T1', 'T2', 'T3');
CREATE TYPE notification_channel_enum AS ENUM ('SMS', 'PHONE', 'EMAIL', 'WHATSAPP');
CREATE TYPE grant_scope_enum AS ENUM ('FULL_PLAN', 'PARTIAL', 'REFERRAL_ONLY');

CREATE TABLE sickbays (id, school_id, mode sickbay_mode_enum, capacity_beds, isolation_beds, operating_hours_json, matron_staff_id, assistant_matron_staff_id NULL, visiting_doctor_schedule_json, school_health_prefect_student_ids JSONB);  -- prefect_ids array · mode determines surface affordances

CREATE TABLE sickbay_visits (id, student_id, sickbay_id, presented_at, presenting_complaint, vitals_json, assessment_text, disposition disposition_enum, attending_staff_id, parent_notified_at NULL, tier_fired notification_tier_enum NULL, discharged_at NULL);
CREATE TABLE sickbay_admissions (id, visit_id, bed_id, admitted_at, discharged_at NULL, isolation_flag, discharged_by_staff_id NULL);

CREATE TABLE medications_administered (id, visit_id NULL, student_id, drug_name, dose, administered_at, administered_by_staff_id, nhis_covered, drug_stock_id NULL);  -- visit_id null for scheduled rounds outside a sickbay visit
CREATE TABLE medication_rounds (id, sickbay_id, scheduled_time, day_type day_type_enum, target_student_ids JSONB, fired_at NULL, fired_by_staff_id NULL, students_received_json, students_missed_json);  -- append-only when fired · canonical 06:30 morning round

CREATE TABLE chronic_conditions_register (id, student_id, condition chronic_condition_enum, condition_detail_text, action_plan_text, emergency_protocol_text, daily_med_schedule_json, nhis_card_number NULL, on_site_treatable_flag, referral_managed_flag, dorm_side_artefact_pdf_file_id NULL, last_reviewed_at, last_reviewed_by_staff_id, active);  -- admin-private by default
CREATE TABLE chronic_register_access_grants (id, chronic_record_id, granted_to_staff_id, granted_by_staff_id, granted_at, expires_at NULL, scope grant_scope_enum, reason_text, revoked_at NULL, revoked_by_staff_id NULL);  -- append-only · row-level security enforces read access

CREATE TABLE referrals (id, visit_id NULL, student_id, hospital_id, transport_method transport_method_enum, accompanying_staff_id, parent_notified_at, departed_at, expected_return_at NULL, actual_return_at NULL, nhis_used, er_handoff_notes, discharge_diagnosis_text NULL, follow_up_required, follow_up_scheduled_at NULL);
CREATE TABLE referral_hospitals (id, school_id, name, distance_km, nhis_accepted, after_hours_capability, contact_phone, role hospital_role_enum, location_text, notes_text, UNIQUE(school_id, role) WHERE role='PRIMARY');  -- one primary per school
CREATE TABLE referral_updates (id, referral_id, update_at, update_text, source_staff_id NULL, source_text NULL);  -- ward updates, hospital calls, status changes

CREATE TABLE drug_stock (id, sickbay_id, drug_name, current_units, reorder_point, last_restocked_at, last_restocked_quantity, supplier_text NULL, nhis_essential_drug, controlled_substance);
CREATE TABLE drug_stock_movements (id, drug_stock_id, movement_type_enum, quantity_delta, occurred_at, staff_id, reason_text, medications_administered_id NULL);  -- append-only · dispense, restock, expire, adjust

CREATE TABLE parent_notifications (id, visit_id NULL, referral_id NULL, sent_at, channel notification_channel_enum, tier notification_tier_enum, message_text, delivery_status, delivered_at NULL, failed_at NULL, retry_count, acknowledged_at NULL, scheduled_for NULL);

-- WASSCE-readiness batch · the complete schema (May 2026)
CREATE TYPE programme_type_enum AS ENUM ('SCIENCE', 'BUSINESS', 'GENERAL_ARTS', 'HOME_ECONOMICS', 'VISUAL_ARTS', 'AGRICULTURE', 'TECHNICAL');
CREATE TYPE subject_type_enum AS ENUM ('CORE', 'ELECTIVE', 'OPTIONAL');
CREATE TYPE paper_type_enum AS ENUM ('OBJECTIVE', 'ESSAY', 'PRACTICAL', 'ORAL', 'COMBINED');
CREATE TYPE university_type_enum AS ENUM ('PUBLIC_UNIVERSITY', 'PRIVATE_UNIVERSITY', 'TECHNICAL_UNIVERSITY', 'POLYTECHNIC', 'NURSING_COLLEGE', 'EDUCATION_COLLEGE');
CREATE TYPE target_rank_enum AS ENUM ('TARGET', 'COMFORTABLE', 'MATCH', 'STRETCH', 'SAFETY');
CREATE TYPE sc_form_enum AS ENUM ('SC-3', 'SC-7', 'SC-12');  -- WAEC special-consideration forms · SC-3 pre-exam accommodations, SC-7 chronic-condition extra time, SC-12 in-window medical disruption
CREATE TYPE candidate_status_enum AS ENUM ('REGISTERED', 'ACTIVE', 'WITHDRAWN', 'COMPLETED');
CREATE TYPE wassce_grade_enum AS ENUM ('A1', 'B2', 'B3', 'C4', 'C5', 'C6', 'D7', 'E8', 'F9');

CREATE TABLE wassce_programmes (id, school_id, programme_type programme_type_enum, name, code, active_flag, notes_text NULL);
CREATE TABLE wassce_subjects (id, programme_id, name, subject_type subject_type_enum, waec_subject_code, paper_count, has_practical_flag, has_oral_flag);

CREATE TABLE wassce_candidates (id, student_id, programme_id, index_number, centre_code, waec_registered_at, subjects_sitting_json, accommodations_json NULL, status candidate_status_enum, mock_2_aggregate NULL, projected_aggregate NULL, UNIQUE(index_number));  -- accommodations_json = SC-3/SC-7 details if applied
CREATE TABLE wassce_papers (id, subject_id, name, paper_number, scheduled_date, scheduled_time, duration_minutes, paper_type paper_type_enum, waec_paper_code);
CREATE TABLE wassce_paper_sittings (id, candidate_id, paper_id, sat_at NULL, exempted_at NULL, exemption_reason_text NULL, make_up_at NULL, make_up_centre NULL, UNIQUE(candidate_id, paper_id));  -- one row per candidate per paper · append-only

CREATE TABLE mock_exams (id, school_id, name, mock_number, scheduled_start, scheduled_end, cohort_year, marking_complete_at NULL);  -- Mock 1 (Nov) and Mock 2 (Mar)
CREATE TABLE mock_results (id, mock_id, candidate_id, subject_id, grade wassce_grade_enum, raw_score, max_score, marked_by_staff_id, marked_at, moderator_staff_id NULL, moderated_at NULL);  -- append-only · subject-teacher-marked, HoA-moderated via cohort view

CREATE TABLE universities (id, name, location, university_type university_type_enum, public_or_private, accreditation_status, notes_text NULL);
CREATE TABLE university_programmes (id, university_id, name, current_cut_off, cut_off_history_json, prerequisite_subjects_json, programme_duration_years, updated_at, updated_by_staff_id);  -- cut_off_history_json = [{year, cut_off}, ...] rolling 3+ years
CREATE TABLE university_targets (id, candidate_id, university_programme_id, target_rank target_rank_enum, tagged_at, tagged_by_staff_id, parent_acknowledged_at NULL, notes_text NULL);  -- multiple per candidate · one TARGET, others by rank

CREATE TABLE waec_special_consideration (id, candidate_id, sc_form sc_form_enum, filed_at, filed_by_staff_id, status, medical_cert_file_id NULL, clinician_letter_file_id NULL, waec_acknowledged_at NULL, waec_ref NULL, approved_at NULL, make_up_scheduled_at NULL, make_up_centre NULL, completed_at NULL);

CREATE TABLE wassce_results (id, candidate_id, subject_id, grade wassce_grade_enum, raw_score NULL, released_at);  -- populated post-Aug from WAEC release · one row per candidate per subject
CREATE TABLE readiness_statements (id, candidate_id, mock_2_id, generated_at, generated_by_staff_id, projected_aggregate, projected_band, target_universities_json, parent_acknowledged_at NULL, parent_acknowledged_signature_method, parent_acknowledged_phone NULL, parent_signature_pdf_file_id NULL, parent_concerns_text NULL);

-- Audit log · cross-cutting · append-only with field-level pseudonymisation at retention horizon (May 2026)
CREATE TYPE audit_severity_enum AS ENUM ('ROUTINE', 'SENSITIVE', 'ANOMALY');
CREATE TYPE audit_pii_tombstone_reason_enum AS ENUM ('RETENTION_POLICY', 'SUBJECT_REQUEST', 'REGULATOR_ORDER');

CREATE TABLE audit_log (id, school_id, occurred_at, actor_staff_id NULL, actor_parent_id NULL, actor_student_id NULL, actor_system_process_id NULL, module, action_text, target_record_type NULL, target_record_id NULL, target_subject_name_snapshot NULL, target_subject_phone_snapshot NULL, target_subject_other_pii_json NULL, severity audit_severity_enum, ip_address NULL, user_agent_text NULL);
-- target_subject_*_snapshot fields hold PII at the time of the action; they are the redaction targets
-- audit_log itself is append-only: no UPDATE, no DELETE, ever, including by school owners

CREATE TABLE audit_pii_tombstones (id, audit_log_id, redacted_field_name, redacted_at, tombstone_marker, reason audit_pii_tombstone_reason_enum, triggered_by_retention_policy_id NULL, triggered_by_request_id NULL);
-- One row per redacted field per audit entry. Also append-only.
-- tombstone_marker example: '[REDACTED-2032-08]'

CREATE TABLE retention_policies (id, school_id, module_enum, retention_years, regulatory_floor_years, effective_from, set_by_staff_id, locked_flag);
-- module_enum maps to: ACADEMIC=7yr default, FINANCIAL=5yr, OPERATIONAL=3yr · regulatory_floor_years is a hard min the school cannot go below
-- locked_flag prevents accidental shortening below floor

-- The retention sweep job runs nightly:
--   For each underlying record (student, parent, fee, visit, etc.) past its module's retention horizon AND scheduled for purge:
--     1. Find every audit_log row whose target_record_type + target_record_id matches
--     2. UPDATE each target_subject_*_snapshot field on those rows to the tombstone_marker for the redaction year-month
--     3. INSERT into audit_pii_tombstones one row per (audit_log_id, field_name) pair
--     4. Delete the underlying record itself
-- This is the ONLY operation that touches audit_log columns post-write. It touches PII snapshot fields only; it never touches actor, action, module, occurred_at, or severity.

-- Audit anomaly rules · rule-based heuristics, configurable per school (May 2026 · Tier 4 sub-decision #1 resolved)
CREATE TYPE anomaly_rule_type_enum AS ENUM ('AFTER_HOURS_LOGIN', 'REPEATED_LOGIN_FAILURE', 'MASS_EXPORT', 'PRIVILEGE_ESCALATION', 'STALE_VIEW_MODIFICATION', 'FIRST_TIME_IP', 'BULK_OUTSIDE_HOURS', 'CUSTOM');
CREATE TYPE anomaly_action_enum AS ENUM ('FLAG_ONLY', 'EMAIL_ADMIN', 'EMAIL_AND_FLAG', 'BLOCK_AND_ALERT');

CREATE TABLE audit_anomaly_rules (id, school_id, rule_type anomaly_rule_type_enum, rule_name, threshold_json, time_window_minutes NULL, severity audit_severity_enum, action anomaly_action_enum, active_flag, created_by_staff_id, created_at, last_modified_at);
-- threshold_json shape varies by rule_type, e.g.:
--   AFTER_HOURS_LOGIN: {"business_hours_start":"06:00","business_hours_end":"19:00","exceptions":["headteacher"]}
--   REPEATED_LOGIN_FAILURE: {"max_attempts":4,"window_minutes":6}
--   MASS_EXPORT: {"row_threshold":1000}

CREATE TABLE audit_anomaly_flags (id, audit_log_id, rule_id, flagged_at, dismissed_at NULL, dismissed_by_staff_id NULL, dismissal_reason_text NULL);
-- Append-only flag log · dismissal is a record, not a deletion · 1 audit_log row can have multiple flags

-- Unified scheduler · one table for all scheduled work (May 2026 · Tier 4 sub-decision #2 resolved)
CREATE TYPE scheduled_job_type_enum AS ENUM ('REMINDER_SERIES', 'BULK_OPERATION', 'RETENTION_SWEEP', 'MOCK_REPORT_RUN', 'PII_EXPORT_EXECUTION', 'AUDIT_NIGHTLY_SEAL');
CREATE TYPE scheduled_job_status_enum AS ENUM ('SCHEDULED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED');

CREATE TABLE scheduled_jobs (id, school_id, job_type scheduled_job_type_enum, scheduled_for, timezone TEXT DEFAULT 'Africa/Accra', status scheduled_job_status_enum, created_at, created_by_staff_id, payload_json, last_run_at NULL, last_run_status NULL, retry_count, max_retries, next_retry_at NULL, cancelled_at NULL, cancelled_by_staff_id NULL, cancellation_reason_text NULL);
CREATE TABLE scheduled_job_runs (id, scheduled_job_id, started_at, completed_at NULL, status scheduled_job_status_enum, result_json, errors_json NULL);
-- Append-only execution history · one scheduled job may have multiple runs if retried

-- Bulk operations with tier-based undo (May 2026 · Tier 4 sub-decision #3 resolved)
CREATE TYPE bulk_operation_type_enum AS ENUM ('BULK_ATTENDANCE', 'BULK_GRADE_PROVISIONAL', 'BULK_CLASS_ASSIGNMENT', 'BULK_PARENT_LINK', 'BULK_SMS_UNSENT', 'BULK_FEE_ASSIGNMENT', 'BULK_DISCOUNT', 'BULK_VOID_PRE_EOD', 'BULK_ROLE_ASSIGNMENT', 'BULK_SMS_SENT', 'BULK_MOMO_RECONCILIATION', 'BULK_TRANSCRIPT_RELEASE', 'BULK_FEE_ADJUSTMENT_POST_STATEMENT');
CREATE TYPE undo_tier_enum AS ENUM ('TIER_A_60MIN', 'TIER_B_24HR', 'TIER_C_7DAY_COSIGN', 'NONE');

CREATE TABLE bulk_operations (id, school_id, operation_type bulk_operation_type_enum, undo_tier undo_tier_enum, executed_at, executed_by_staff_id, child_count, undo_window_expires_at, undone_at NULL, undone_by_staff_id NULL, undo_co_signer_staff_id NULL, undo_reason_text NULL, reversal_audit_log_id NULL);
CREATE TABLE bulk_operation_children (id, bulk_operation_id, target_record_type, target_record_id, snapshot_before_json, snapshot_after_json);
-- snapshot_before_json + snapshot_after_json drive the atomic inverse · Tier C undo writes compensating entries to the target table rather than restoring from snapshot

-- PII export approval flow (May 2026 · Tier 4 sub-decision #4 resolved)
CREATE TYPE pii_export_status_enum AS ENUM ('AWAITING_HT_APPROVAL', 'AWAITING_DPO_APPROVAL', 'APPROVED_PENDING_EXECUTION', 'EXECUTED', 'REJECTED', 'EXPIRED');
CREATE TYPE pii_export_kind_enum AS ENUM ('COLUMN_PII_ONLY', 'RECORD_LEVEL_PII');

CREATE TABLE pii_export_requests (id, school_id, requested_by_staff_id, requested_at, export_kind pii_export_kind_enum, columns_json, row_filter_json, recipient_text, recipient_organisation_text NULL, purpose_text, recipient_retention_days, status pii_export_status_enum, ht_decision_at NULL, ht_decision_by_staff_id NULL, ht_decision_reason_text NULL, dpo_decision_at NULL, dpo_decision_by_staff_id NULL, dpo_decision_reason_text NULL, dpo_fallback_to_ht_flag, expires_at, executed_at NULL, executed_file_id NULL, executed_row_count NULL);
CREATE TABLE pii_export_audit (id, request_id, action_enum, actor_staff_id, occurred_at, details_json);
-- action_enum: CREATED, HT_APPROVED, HT_REJECTED, DPO_APPROVED, DPO_REJECTED, EXECUTED, EXPIRED_WITHOUT_EXECUTION
-- expires_at = approved_at + 7 days · single-use; cannot be reused
```

**Storage cost of empty SHS tables for a Basic-school subscriber:** essentially zero. These cost nothing until populated.

### Score Ledger · architectural decisions worth preserving

Seven decisions made during the score ledger batch deserve durability beyond surface code. The full spec is in `SHS_SCORE_LEDGER_SPEC.md`; the decisions worth preserving here are the ones that shape the data model, the workflow architecture, and the language used in marketing.

**1. The five categories are the canonical assessment record, not Omnischools-invented categories.** Assignments, mid-semester exam, end-of-semester exam, project work, portfolio — verified against the NaCCA Government Year 1 Teacher Manual and confirmed universal across public and private SHS. Weights are **configured per (subject × school)** at enrolment, not hard-coded — Ghanaian SHS weight differently between subjects and tune the balance between continuous assessment and the terminal end-of-semester examination. The demo school Asankrangwa SHS runs 15/15/40/15/15 with end-of-semester at 40% as the dominant weight, reflecting how most schools treat the terminal assessment. The schema is `senior_score_ledger` with one row per (student × subject × term) and five typed score columns, plus a `weights_config_id` foreign key into `ref_assessment_weights` recording which weight schedule produced the weighted total; **not** a generic key-value structure. The five categories themselves are stable enough to be schema; the weights are not, and live in a configurable reference table whose history is preserved so a parent or auditor can always see how a historical term's totals were computed.

**2. The three capture paths are equivalents, not a progression.** Path A (auto-compile from in-term entries), Path B (scan paper ledger with OCR verification), Path C (direct digital entry on the grid) all produce the same `senior_score_ledger` row with a `path_used` discriminator. The teacher chooses per (subject × class × term); Omnischools does not nudge from Path B toward Path C. Marketing language explicitly avoids "go paperless." The branded paper ledger book is a *feature*, not a transitional artifact. This is the strategic differentiation from every other edtech product in the market — and the harder story to tell.

**3. Verification-first, not extraction-first for Path B.** OCR is honest about its uncertainty. Every cell has an `ocr_confidence` score; low-confidence cells are visually flagged and require teacher acknowledgement before commit. The product promise is *"we save you typing, you confirm the read,"* never *"we read your ledger correctly."* The trust posture this creates protects against the genuine error case. Schema: `senior_score_ledger_upload` table holds the photograph attachment, the OCR confidence map per cell, and the supersedes-relationship to prior uploads.

**4. The PWA's connectivity story is phased, and the marketing line follows the phasing.** Phase 1 (ships with v1) supports bad connections with a small buffer and a clearly visible sync strip; the marketing line is **"works on your phone, handles bad connections"** — *not* "works offline." Phase 2 (extended offline via IndexedDB, single-device) and Phase 3 (multi-device conflict resolution) are reserved capacity, built only when real demand surfaces. Over-promising connectivity is the failure mode that creates angry users; the discipline is to not create that expectation gap in the first place.

**5. Diff-flagging is the integrity layer, not an optional check.** Every score change between uploads (Path B) or between sessions (Path C) is diffed against the prior committed value and severity-graded: low (blank-to-filled, expected), medium (score down, requires reason), high (score gone missing). The history table `senior_score_ledger_history` is append-only with reason codes where the diff prompted one. **This is what makes the digital ledger more trustworthy than paper** — paper allows silent re-writes; Omnischools records who changed what, when, with what reason.

**6. The Vice Headmaster view shows completion progress, not score values.** Accountability without surveillance. The progress dashboard names whether each category has been entered, never displays the marks themselves. Score-value access requires navigating to the gradebook, which is audit-logged using the same `access_audit` infrastructure as Oversight's compliance record view. The Vice Headmaster's role is to chase teachers who are behind, not to read every cell — and the surface enforces that posture by what it shows.

**7. The at-risk flag rules share the `ref_anomaly_rule` table with Oversight.** Five rules run at the school level (teacher inactivity, STPSHS window approach, entry-rate outlier, score-down between uploads, portfolio-only-pending), and they live in the same configurable rule table the Oversight anomaly queue uses. Rules are inspectable as readable logic, severity-graded, enable/disable-able per school. The Headmaster or Vice Headmaster can add school-specific rules without a deploy. This is the same anomaly discipline applied at two levels: school-internal management, and GES-external supervision.

**8. Two view modes and a class chevron, identical across the PWA and the desktop ledger.** The ledger has two layouts of the same data — card view (one student per screen, large inputs, swipe to navigate) and grid view (whole class as a compact table) — toggled by a single pill in the header. Card view is the marking-session shape; grid view is the scan-and-review shape. Both read and write the same `senior_score_ledger` rows. The user's last-chosen view persists per `(teacher × subject × class × term)` — preserved in `user_ui_preferences` so a teacher who prefers grid view on a 37-student roster does not get pushed back to card view tomorrow. **The class chevron beside the active class name is the switch between classes a teacher teaches**, surfaced on every screen (PWA and desktop). Tapping opens a bottom sheet (PWA) or expands a horizontal tab list (desktop), listing all the teacher's classes this term with student count, path used, completion summary, and a status pill (current / ready / behind). The active class persists per teacher across sessions — the PWA opens fresh on the class the teacher last touched, not on a "pick a class" interstitial. Switching is non-destructive — pending unsaved scores in the prior class stay buffered, the audit trail records the switch, the teacher's cursor position in the prior class is preserved exactly. **The chevron itself carries status**: a class with STPSHS deadline in less than 7 days renders the chevron gold; a class with teacher inactive for more than 14 days renders it with a warn-dot — using the same `ref_anomaly_rule` infrastructure as decision 7, so a teacher juggling several classes can see at a glance from any screen whether one of their other classes needs attention. The chevron is suppressed entirely if the teacher teaches only one class — first-year teachers do not need to be told their single class is one of one. This pattern matters because **almost no SHS teacher teaches one class** — a Mathematics teacher typically teaches two to four, an Integrated Science teacher four to five, an English teacher running across forms up to six — and the surface architecture must make that workflow seamless without making single-class teachers see superfluous machinery.

**Schema migrations required by this batch:**

```sql
CREATE TABLE senior_score_ledger (
  ledger_id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES schools(school_id),
  student_id BIGINT NOT NULL REFERENCES students(student_id),
  subject_id BIGINT NOT NULL REFERENCES subjects(subject_id),
  term_id BIGINT NOT NULL REFERENCES academic_terms(term_id),
  assignments_score NUMERIC(5,2),
  mid_sem_score NUMERIC(5,2),
  end_sem_score NUMERIC(5,2),
  project_score NUMERIC(5,2),
  portfolio_score NUMERIC(5,2),
  weighted_total NUMERIC(5,2),  -- generated, computed at write
  path_used CHAR(1) NOT NULL CHECK (path_used IN ('A','B','C')),
  weights_config_id BIGINT REFERENCES ref_assessment_weights(weights_id),
  version INT NOT NULL DEFAULT 1,
  last_updated_by BIGINT REFERENCES users(user_id),
  last_updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (student_id, subject_id, term_id)
);
CREATE TABLE senior_score_ledger_history (...);  -- append-only audit
CREATE TABLE senior_score_ledger_upload (...);   -- Path B photographs + OCR
CREATE TABLE ref_assessment_weights (...);       -- per (subject × school) weights
-- ref_anomaly_rule extended with five new Vice Headmaster rules
```

The migration is non-destructive to existing Basic-school data. Score ledger tables sit empty until a Senior school populates them; storage cost for a Basic-school subscriber is essentially zero.

**8. Academic period structure differs by product line and is schema-configurable, not hard-coded.** GES sets two different standards for Basic vs Senior schools: **Basic** (KG · Primary · JHS) runs 3 terms per academic year, confirmed in the 2024/25 and 2025/26 GES calendars. **Senior** (SHS) runs 2 semesters per academic year, the standard since the 2018/19 academic year when the trimester system was replaced as part of the Free SHS rollout. The semester system increased classroom hours from 1,080 to 1,134 per year. Omnischools models this with two tables — `ref_academic_period_config` (school × academic_year × period_type × period_count) and `academic_period` (the dated periods themselves) — and keys the score ledger by `period_id`, not `term_id`. Defaults seed at school onboarding: Basic-only → 3 terms; Senior-only → 2 semesters; combined Basic-and-Senior → both, in the same school record under different configs (since the same school operates both calendars side-by-side for its different levels — a J-S configuration like a KG-through-SHS campus is common in Ghana). Surface labels read from `academic_period.period_label` so a Basic teacher sees "Term 2" and a Senior teacher sees "Semester 2" without code branching. Private schools running parallel international tracks (Cambridge IGCSE, IB, American Common Core) can override the GES default at setup. Annual ETL job refreshes period dates from the GES-published calendar each July–August.

```sql
CREATE TABLE ref_academic_period_config (
  school_id UUID,
  academic_year TEXT,             -- '2025/26'
  period_type TEXT,               -- 'TERM' | 'SEMESTER'
  period_count SMALLINT,          -- 2 | 3
  source TEXT,                    -- 'GES_DEFAULT' | 'SCHOOL_OVERRIDE'
  PRIMARY KEY (school_id, academic_year)
);
CREATE TABLE academic_period (
  period_id UUID PRIMARY KEY,
  school_id UUID, academic_year TEXT,
  period_number SMALLINT, period_label TEXT,
  starts_on DATE, ends_on DATE
);
```

This decision settles an ambiguity that was previously hidden in surface copy: pre-this-decision, several Senior surfaces used "Term 2 of 2025/26" demo data that was actually wrong for the GES standard. Surfaces have been rewritten to "Semester 2 of 2025/26" for SHS demo, with the configuration story made explicit. Schools that need to deviate from GES defaults set this at onboarding; nothing about the schema or rendering layer needs to change.

**Decision worth flagging explicitly:** the score ledger spec **supersedes the STPSHS-first framing** in `STPSHS_INTEGRATION_SPEC.md`. The earlier framing positioned STPSHS as the primary integration story; the ledger spec correctly inverts this — the score ledger is the primary teacher artifact, and STPSHS is one of several destinations (alongside parent reports, school analytics, and Oversight aggregation). The STPSHS spec remains useful as research material on the WAEC regulator side, but the build sequence is governed by the ledger spec's 11-item order, not by the STPSHS spec.

### VLC · architectural decisions worth preserving

Six decisions made during the VLC batch deserve durability beyond surface code:

> **Updated May 2026** · two further decisions (7, 8 below) emerged from the student-journal surface design that didn't sit cleanly inside the original six.

**1. Eleven values as an ordered list with locked Twi names.** Nine universal values (Respect, Integrity, Responsibility, Discipline, Perseverance, Compassion, Tolerance, Service, Excellence) plus two GH-contextual (Patriotism, Wisdom as capstone). Each value has 2 sessions (introduction + application) across the school year. Term arc is foundations → interpersonal → integration. Schools can add a 12th school-specific value, but most stick with 11. The Twi names (`Obu`, `Nokwaredi`, `Asɛyɛde`, etc.) are part of the curriculum, not decoration — the Ga and Ewe equivalents are also stored.

**2. The 5-phase session rhythm is locked.** 5 min opener (FM frames) + 25 min small groups (Peer Guides lead 4-5 students each) + 15 min plenary share-back + 10 min individual journal reflection + 5 min close = 60 minutes. Form Masters don't redesign the session shape; only the content within phases is flexible per curriculum template. This locks the rhythm at the schema level — `vlc_sessions` and `vlc_session_groups` assume the 5-phase model.

**3. Peer Guides are distinct from Prefects.** Different schema (`peer_guides`, not `prefects`), different selection process (class vote + FM approval + Dean sign-off vs. Headmaster appointment), different tenure (1 term default vs. 1 year), different role (facilitation, not authority). A student can be both — the data models don't unique-constrain across roles. Two per class (one boy, one girl default), Form 2 or 3 only — Form 1 doesn't supply Peer Guides, a structural choice enforced at the application layer.

**4. Pastoral flags are private from students, append-only, FM + Dean only.** Schema-enforced: `vlc_pastoral_flags` has no `visible_to_student` column because visibility to the student is never an option. Row-level security restricts read access to the named Form Master + the Dean of Students. The flag has three resolution paths: 1-on-1 check-in (`FM_CHECKIN`), escalate to Dean (`ESCALATED`), or note as resolved (`RESOLVED`). Once resolved, the row is preserved but no longer surfaces on the dashboard.

**5. Journal entries are append-only and become school-leaver source material.** `vlc_reflections` has no UPDATE or DELETE permissions for any role. Once a student writes a reflection in phase 4 of a session, the entry is permanent — including typos, including casual language. Across 22 sessions per year × 3 years = 66 reflections per student, which becomes the source material for the character paragraph in the school-leaver report. Omnischools auto-drafts the paragraph; the Form Master finalises it; the parent sees only the finalised paragraph, never the verbatim journal.

**6. Wednesday afternoon, not Friday.** VLC and PLC have separate cadence days deliberately. PLC (teacher PLC) is Friday afternoon; VLC (student VLC) is Wednesday 2:30 PM. Different days spread the teaching load and prevent Form Masters from running two structured-discussion sessions in one afternoon. The `vlc_programme_config.cadence_day` defaults to Wednesday and is configurable but actively discouraged from matching PLC's day.

**7. Three distinct pastoral record layers, not one.** Surface 4 makes the separation explicit: `vlc_pastoral_flags` are session-tied events (something happened in this Wednesday's session, severity assigned, resolution path picked), `vlc_fm_pastoral_notes` are case-level FM notebook entries that may or may not be session-tied (a phone call from a parent on Tuesday morning is not a session event), and `vlc_pg_observations` are Peer Guide observations of group members across sessions. Visibility is layered: flags & FM notes are FM + Dean only; PG observations are FM only (the other PG cannot read them). Conflating these into one table would lose the semantic distinction that drives the visibility matrix.

**8. The character paragraph is a separate artefact from the journal.** `vlc_character_paragraphs` is its own table, auto-drafted from reflection + FM note + PG observation source IDs (tracked for provenance), but the finalised text is the FM's own writing. The parent sees the finalised paragraph at school-leaver only — never the verbatim journal, never the FM notes, never the PG observations. The journal accumulates; the paragraph publishes. They are different documents serving different audiences.

### Boarding · architectural decisions worth preserving

Nine decisions made during the Boarding batch deserve durability beyond surface code:

**1. Boarding is structurally adjacent to the school module, not a feature of it.** The boarding module reads from and writes to academic surfaces (a student's class, a teacher's roster) but is not subordinate to them. A school can run with boarding switched off entirely (day-only schools, common at the JHS level and at newer Community Day SHSs). A school can run with boarding switched on for a subset of students (the mixed-residence reality of every Free SHS-era school). The only join between the modules is `student_residency.residency_type_enum` on the student record, taking values `BOARDER`, `DAY`, or `DEBOARDINIZED`. Every boarding surface filters its dataset on residency type; every academic surface ignores it. Treating boarding as a feature of the school module would have forced a single combined data shape that doesn't reflect operational reality — boarding has different time horizons (4:30 AM → 9:30 PM), a different staff hierarchy (HM → Senior HM → Headmaster, distinct from class teacher → HOD → Headmaster), and different financial flows (penalty fees triggered by discipline, distinct from termly tuition).

**2. House → Dormitory → Bunk is the three-level placement hierarchy, with the bunk as primary spatial key.** A House (~120 students) is the pastoral/social unit a student belongs to for all three SHS years; a Dormitory (~15 students) is the physical building/room they sleep in; a Bunk is the specific bed. `houses` has one resident `hm_staff_id`; `dormitories` belong to one house; `bunks` belong to one dormitory. The student-to-bunk relationship is the operating primary key for daily inspection, prep attendance, sick-bay queue, and incident routing. `student_residency.current_bunk_id` is the live FK; `bunk_allocation_history` is append-only with `from_at`/`to_at` ranges, capturing every reallocation with a reason and the staff member who authorised it. One student per bunk, one bunk per student at any given time, enforced at the database via partial unique index on `(current_bunk_id) WHERE current_bunk_id IS NOT NULL`.

**3. Co-ed schools use one unified House list with `gender_enum` per House, not separate boys'/girls' systems.** Achimota has 17 Houses total — six boys', six girls', plus mixed-newer. Modelling these as two parallel tables would have doubled the schema and forced gender-conditional joins in every query. Instead, `houses.gender_enum` is `BOYS`, `GIRLS`, or `COED` (the latter rare but legal for boarding houses at international schools). Co-ed school staff see all six houses in one list, filterable by gender. Single-sex schools just have all Houses set to one gender; the schema is identical. This is the right level of generality.

**4. 5-rung discipline ladder schema-locked, no sixth rung permitted.** The canonical General SHS Rules document, reflected in published rule sets at YAGSHS and similar schools, defines five disciplinary severities for boarding offences: Note (informal verbal), Warning (1-day internal suspension + exeat block), Bond (signed bond of good behaviour + counselling), Suspension (2 weeks external), Deboardinization (removal from boarding roll). Schools differ in which offence carries which severity, but no school invents a sixth rung. `infraction_severity_enum` is locked to these five values. The co-sign count per severity is enforced at the database: Note and Warning require one signature (HM), Bond requires three (student, HM, Senior HM), Suspension requires two (HM, Headmaster), Deboardinization requires three (HM, Senior HM, Headmaster). A Deboardinization record with only two signatures simply cannot be written via the API — the constraint is in the schema, not just the UI.

**5. Deboardinization is reversible only by the Board, never by the school.** This is a deliberate architectural constraint on a politically dangerous action. A Headmaster who imposes deboardinization on a student in week six, under genuine cause, cannot quietly reverse it in week eight under parental pressure. `deboardinization_records.reinstated_at` can only be set by an action that requires the Board's recorded decision, and `deboardinization_records.board_review_at` exists as a first-class field. Surface 7 shows this in operation: K. Donkor (Form 1, age 14) has a Board review pending for Friday with the Headmaster filing a motion for Bond reinstatement; the motion exists as a tracked object regardless of outcome. The Board meets termly. Reversing deboardinization in any other way is not possible through the application.

**6. 3× boarding fee penalty per unauthorised day is the first cross-module trigger from discipline into billing.** The General SHS Rules specify a 3× fee penalty for unauthorised days in the boarding house (e.g., a deboardinized student attempting return, or housing a deboardinized peer). Omnischools models this as a discipline-to-billing trigger: the moment a relevant infraction is logged, `boarding_infractions.penalty_invoice_id` is populated with a freshly-generated `invoices` row in the billing module. The invoice line carries `category = PENALTY` and references back via FK. Headmaster has discretion to adjust the figure via a documented reason (PEN-2026-009 in surface 7 shows a Head's-discretion reduction from GHS 1,500 to GHS 510, logged), but the adjustment itself is auditable. This is the only discipline-to-billing trigger in the platform.

**7. Resumption and Vacation are the same surface in two modes — symmetry as user mercy.** These are the highest-volume single-day operations a boarding school runs all year — hundreds of students arriving (or departing) over a few hours, luggage being checked, beds being allocated, fees verified, prospectus items confirmed. Each happens twice per academic year (twice in, twice out). Surface 3 uses a mode-bar tab at the top to flip the entire surface between `RESUMPTION` and `VACATION`. The summary tiles, live counter, arrival windows, checklist rows, and issues queue all preserve their grid positions; only their semantics flip. Staff who run resumption six months ago can run vacation today without learning a new layout. Six staggered arrival windows by Form (F3 first, F1 last) on resumption mirror six staggered departure windows on vacation. The pattern aligns with "a surface used twice a year, worth designing harder than any other."

**8. Inspection has two distinct cadences with separate datasets.** Daily inspection (6:10–6:20 AM, ten minutes, bunks/lockers/attire) is a fast pass by the on-duty HM or Assistant HM, capturing pass/fail per dormitory and any specific anomalies. Weekly inspection (Saturday 8:00–9:00 AM, sixty minutes, whole-house deep) is led by the Senior HM with more granular findings. Both write to `inspections` but with distinct `type_enum` values (`DAILY` and `WEEKLY`). The findings JSON shape differs; the reporting cadence differs; the escalation path differs (a daily inspection failure produces a Note; a weekly inspection failure produces a Warning). Surface 4 reads both but presents them in separate UI panes.

**9. Pastoral protection cross-reference is the humane layer over the punitive one.** Students with active pastoral cases — flagged through the VLC pastoral system (`vlc_pastoral_flags`), through external social services referrals, or through the Dean of Students' caseload — bypass the disciplinary ladder. Near-incidents that would produce a Note for another student are re-routed to the Dean. Surface 7 shows A. Quartey (Form 3 General Arts, Slessor House) — escalated through the VLC pastoral flag system in the prior batch — appearing not as an offender but as a flagged student whose discipline route runs through the Dean. The ladder pauses where pastoral cases run. This is a hard line at the application layer: `boarding_infractions.insert` checks `vlc_pastoral_flags.status = OPEN` and `pastoral_caseload.active = true` for the student, and prompts the HM to confirm escalation-via-Dean before allowing the infraction to be logged. No child carrying social services involvement accumulates disciplinary points the same way a peer would.

### Sickbay · architectural decisions worth preserving

Twelve decisions made during the Sickbay batch deserve durability beyond surface code:

**1. The module supports three operational modes via `sickbay_mode_enum`, reflecting Ghana's bimodal reality.** Research surfaced that 49% of public SHS in Eastern/Western/Central regions have no sickbay at all, 30% have a health professional on staff, and only ~16% have a visiting doctor arrangement. Of those without sickbays, 59% appoint School Health Prefects as a front line. The schema accommodates all three modes (`FULL`, `FIRST_AID`, `REFERRAL_ONLY`) with the same tables — chronic register, referrals, parent notifications, drug stock — but the surfaces flex their affordances. A `REFERRAL_ONLY` school sees no bed-allocation UI, no medication rounds, no admission workflow; it sees the referral log, the chronic register (with the matron role filled by the most senior staff designated for health), and the notification system. Schools that build a sickbay later switch modes without data migration.

**2. The 06:30 morning medication round is a first-class concept, not an aggregation of individual dispensings.** `medication_rounds` is a separate table from `medications_administered` because the round is a scheduled school-wide event with its own provenance (which students were targeted, which received, which missed, who fired the round). This matches Ghana boarding-school protocol verbatim — students with chronic conditions surrender their meds at admission and receive them at the morning round before breakfast. Modelling it as an aggregation would have lost the operational semantics: "did the morning round happen today, and did everyone who was supposed to be dosed get dosed". The 06:30 time is configurable per school via `sickbays.operating_hours_json`, but the role (scheduled, named-student, append-only dispensing event) is universal.

**3. The three-tier parent notification rule is schema-locked.** `notification_tier_enum` (`T1`, `T2`, `T3`) on `parent_notifications` and on `sickbay_visits.tier_fired`. Tier 1 (routine sickbay visit with pastoral or chronic context) gets an SMS only, no obligation to acknowledge. Tier 2 (sickbay admission, chronic register event) gets a phone call followed by SMS within an hour. Tier 3 (any referral out, hospital escalation) gets a phone-first within 5 minutes, SMS confirm, ongoing updates on cadence (06:00 / 11:00 / 17:00 / 21:00 while inpatient). The tier is set by trigger event, not chosen by the matron — she can choose to override upward but not downward, and overrides are logged. Visible on the setup page; enforced at every notification call site.

**4. The chronic register carries explicit `on_site_treatable_flag` and `referral_managed_flag` per condition.** Mental health is the case that forced this. In every school we examined, mental health appears in the chronic register because students with depression, anxiety, or social-emotional difficulties are on the register — but their care is provided off-site through district hospital referral, family doctors, or pastoral channels, not through the school sickbay's clinical workflow. Conflating "is on chronic register" with "is treated on-site" would have produced false confidence in the school's clinical capacity. The two flags make the truth explicit: the school knows about the condition; the school does not pretend to treat it.

**5. The chronic register is admin-private by default with explicit per-staff per-student grants.** Housemasters, dorm-mates, class teachers, and other staff do not see a student's chronic condition by default. The matron grants access explicitly via `chronic_register_access_grants`, with three scopes: `FULL_PLAN` (housemaster of a student with anaphylaxis), `PARTIAL` (dorm-side reference card only), `REFERRAL_ONLY` (kitchen knows about the peanut allergy without seeing the rest of the medical context). Every grant is append-only with revocation logged separately. Every read is in the audit trail — not just every write. Row-level security on Postgres enforces this; the application layer cannot bypass it.

**6. Sickle cell disease is the chronic register's anchor case.** Ghana has among the world's highest SCD prevalence (~2% of births, ~25% sickle trait carriers). Designing the care plan around SCD — hydration protocols, pain ladder, hydroxyurea schedule, hospital escalation criteria, NHIS coverage, dorm-side reference card — generalises cleanly to other conditions but anchors the schema to the most common chronic case in Ghanaian SHS. The Adwoa Mensa demo case across surfaces 2/3/4 makes this concrete. Anchoring to SCD also forced the chronic register to handle the operational reality that the same student appears multiple times in the referral history (Adwoa twice in 30 days) — the longitudinal view comes from the register, the operational repetition comes from the referral log.

**7. NHIS card status is captured per student; coverage is captured per drug administration and per referral item.** `chronic_conditions_register.nhis_card_number` and `students.nhis_card_number_nullable` (added to MVP1 schema). Per administration, `medications_administered.nhis_covered` captures whether the matron's dispensing was coverable. Per referral, `referrals.nhis_used` and the line-item reconciliation table captures item-by-item coverage. Cross-module trigger: when `nhis_covered` is false on any dispensing or referral item, a billing line is created. This means the matron never sees billing UI but every uncovered cost becomes a receivable automatically. NHIS card health (active / expired / expiring / no card) rolls up to a school-level monitor on the reconciliation surface.

**8. Referral is its own surface and its own table because referrals have a multi-day tail.** A single referral generates parent calls, hospital reassessments, ward updates, NHIS itemised reconciliation, ER handoff notes, follow-up appointment scheduling, return logistics, and a long tail of post-discharge tracking. Folding all of that into `sickbay_visits` would have made the visit record either too thin (omitting the tail) or too wide (carrying fields that only apply when `disposition = REFER`). The `referrals` table and the `referral_updates` append-only table make the tail first-class. `referral_log.html` surfaces it.

**9. SHEP and N&MC are named in the setup page as policy anchors.** The School Health Education Programme (SHEP, GES unit established 1992) and the Nursing and Midwifery Council (N&MC, LI 683 1971) are referenced explicitly in `sickbays.notes_json.policy_anchors`. This signals to schools that the module is Ghana-designed, not imported from a UK boarding-school or US K-12 nurse-station template. N&MC scope of practice bounds what a matron can do without escalation (IV cannulation outside scope without protocol; oral analgesia within scope) and is reflected in the standing-order template. SHEP provides the policy frame for school-based health service delivery. References both, doesn't pretend they are optional.

**10. Pastoral protection cross-reference pattern continues from Boarding into Sickbay.** A student with an active VLC pastoral flag who appears for a sickbay visit (e.g., J. Manu with a headache + appetite concern) auto-elevates the visit's tier_fired to Tier 1 notification of the pastoral contact (grandmother in J. Manu's case) even though the medical event is routine. The matron sees the pastoral flag on the visit record but not the pastoral narrative — that stays with VLC. The rule is enforced at the application layer: `sickbay_visits.insert` checks `vlc_pastoral_flags.status = OPEN` for the student and elevates the tier. Same pattern as Boarding's discipline-bypass for pastoral cases.

**11. The matron creates the cost; billing carries it; comms sends the SMS-at-moment-of-incurring. Three modules, one source of truth.** The matron does not chase money. When a referral produces an out-of-pocket cost (parent-supplied cast materials, comfort items, private room upgrade, expired-NHIS items), three things happen automatically: (a) billing creates the line item against the student account with a "sickbay referral" tag, (b) comms sends a one-line SMS to the parent at the moment of incurring ("Referral today incurred GHS 80 for cast materials. NHIS-covered items are 0. Details on your statement."), (c) reconciliation surface (`referral-log.html` section 5) shows the open balance, age, and SMS history. The matron sees that the line was created; she does not edit it. Clean separation per the resolved Tier 2 chart-of-accounts decisions.

**12. Drug stock lives as a setup tab, not a separate pharmacy module.** A full pharmacy/inventory module is out of scope for MVP2. The 24-item drug master with reorder points and three alert thresholds (low / critical / out) is enough to drive procurement decisions without a parallel inventory system. `drug_stock` + `drug_stock_movements` (append-only ledger) gives a defensible audit trail. The 47% of Ghanaian SHS that report drug shortages as their #1 sickbay pain need a stock signal, not a pharmacy management system. Future enhancement when shortages become structurally manageable.

### WASSCE-readiness · architectural decisions worth preserving

Thirteen decisions made during the WASSCE-readiness batch deserve durability beyond surface code:

**1. WASSCE setup is FROZEN once the cohort is in flight.** Programme matrix, subject roster, mock results, university targets — none of these can be edited for an F3 cohort once WASSCE registration closes with WAEC (typically February of the exam year). Schema enforces this via a per-school `wassce_setup_frozen_at` timestamp set by HoA + Headmaster co-sign. Application layer blocks mutations on dependent tables once frozen. A change-control flow exists for typos (e.g., correcting a candidate's index number) with HoA + Headmaster co-sign and append-only audit; substantive changes require formal WAEC amendment via the regional office. Surfaces signal frozen state visually so staff don't waste time trying to edit. Prevents the most damaging class of WASSCE error: pre-exam roster shifts that desync school records from WAEC's registration.

**2. Mock 2 is the source of truth for the readiness statement; Mock 1 is calibration.** The two-mock cycle (Mock 1 in November, Mock 2 in March) reflects Ghana SHS convention. Mock 1 is the baseline, used by teachers to scope final-term teaching; Mock 2 is predictive (5-year accuracy 73–82% per internal data) and drives the parent-signed readiness statement. `readiness_statements.mock_2_id` is required (FK); Mock 1 is referenced via `mock_results` but not bound to the statement. This forces clarity: the parent-acknowledged projection is anchored to one specific mock cycle with one specific marking event, not to a rolling weighted average that could drift.

**3. Five-tier university band, not three.** Refined from initial 3-tier (Reach/Match/Safety) to five (Target/Comfortable/Match/Stretch/Safety) after Ghana-specific research. Modelled as `target_rank_enum`. Definitions: `TARGET` = the candidate's primary choice (typically cut-off within 2 of projected aggregate); `COMFORTABLE` = cut-off 2–4 points worse than projected (high probability); `MATCH` = cut-off at projected ± 1 (mid-probability); `STRETCH` = cut-off 2+ points better than projected (low probability, worth applying); `SAFETY` = cut-off 4+ points worse than projected (high-confidence backup). The richer band reflects how Ghanaian guidance counsellors actually triage applications and makes the parent conversation more honest than three buckets allow. Multiple `university_targets` rows per candidate; exactly one with rank=`TARGET` enforced at application layer.

**4. WAEC SC-form workflow with three forms.** `sc_form_enum` covers `SC-3` (pre-exam accommodations applied during registration, e.g., enlarged-print papers for visual impairment), `SC-7` (extra time for chronic conditions, e.g., 15-minute accommodation for sickle cell with required medical evidence), and `SC-12` (in-window medical disruption, the live-case form for Y. Aidoo). All three captured in `waec_special_consideration`. SC-3 and SC-7 are filed pre-WASSCE during candidate registration; SC-12 is filed reactively when a candidate misses one or more papers. Each row carries the medical certificate file, clinician letter, WAEC acknowledgement timestamp, and WAEC reference number. Workflow is school-owned filing → WAEC acknowledgement → fit-to-sit clinician confirmation → WAEC scheduling → make-up sitting.

**5. Free SHS rule schema-locked: no candidate denied a WASSCE sitting for unpaid fees.** Per Free SHS policy (2017–), F3 candidates cannot be blocked from sitting WASSCE for fee arrears. The `wassce_candidates` table has no fee-status field; the billing module carries arrears independently. Setup surface displays fee status as context only — never as a blocker. The candidate roster shows registered candidates with fees-outstanding as a non-blocking flag for the bursar's separate workflow. Surface 1 carries this explicitly: a candidate with GHS 240 outstanding still appears as `REGISTERED`. Cross-module rule: the billing module never raises a hold flag against `wassce_candidates.status` for outstanding fees during exam window.

**6. F3 discipline pause during WASSCE.** Per school policy and broader Ghana SHS convention, discipline ladder enforcement is paused for F3 candidates during the WASSCE window (typically late-April through mid-June). The discipline module checks the candidate's `wassce_candidates.status` and the `wassce_papers.scheduled_date` range; if a candidate is `ACTIVE` and the date falls within the WASSCE window, the discipline ladder skips F3 students. Disciplinary records continue to accrue (append-only), but enforcement actions (suspension, ladder escalation) are deferred until post-WASSCE. Pastoral cross-references (VLC) continue without disciplinary outcomes. Surface 3 documents this with the cross-module note that the VLC case remains visible without consequence. Cross-module rule enforced at the discipline-action site, not at the discipline-record site.

**7. The 2026 International WASSCE narrative is preserved in the editorial frame.** Ghana's first International WASSCE since 2019 — public framing matters. All schedule data anchors to the published WAEC syndicated timetable (May–Jun 2026, five-country anglophone cycle), not to any school-only calendar. Centre code SU-0184 (Asankrangwa) is registered with WAEC Regional Office in Sefwi-Wiawso for Western Region. Surfaces date everything against WAEC's published dates; no rounding, no approximation.

**8. Mock predictive accuracy is publicly disclosed.** The 73–82% 5-year accuracy band is shown on the setup page (surface 1) and in the parent-facing readiness statement preamble. Honest framing — not hidden behind marketing copy. Parents who ask "how reliable is the projection?" get a real, evidence-backed answer. Builds trust in the readiness statement and protects the school from misaligned expectations. The accuracy figure updates annually after WAEC releases real scores and the diff against Mock 2 projections is computed.

**9. Cross-module integration is the unique value of WASSCE-readiness as a module.** Sickbay → WASSCE: when a sickbay admission overlaps a paper date (`sickbay_admissions.admitted_at` overlaps `wassce_papers.scheduled_date`), the matron triggers an auto-suggested HoA SC-12 filing workflow. The Y. Aidoo case is the canonical example — sickbay admission triggers SC-12 suggestion within 30 minutes. VLC → WASSCE: pastoral cross-references visible without granting exemption (no SC-form granted for pastoral; surfaces show the pastoral flag for context). Billing → WASSCE: Free SHS coverage status surfaced as info only. Boarding → WASSCE: F3 prep absence excused automatically during WASSCE window via `prep_attendance.exemption_reason = 'WASSCE_CANDIDATE_WINDOW'`. The Sickbay referral log surface and the WASSCE student-readiness surface share Y. Aidoo's case file in shared schema (`sickbay_visits` ↔ `waec_special_consideration` linked via `student_id` + same-day timestamp).

**10. Subject teachers mark their own cohort's mocks.** Mr Asiedu marks his 28 Chemistry candidates' Mock 1 and Mock 2 papers personally. The diagnostic value (teacher knows which student understands which topic, can target interventions) beats the grade-inflation risk (teacher inflates own cohort's marks). School-wide moderation is enforced via the cohort-readiness HoA view (surface 2) cross-checking distribution against school and regional history — if a cohort's grade distribution shifts materially against historical patterns, the HoA escalates to moderation. `mock_results` carries both `marked_by_staff_id` and optional `moderator_staff_id` + `moderated_at` for the moderation trail. The cohort distribution histogram on surface 4 makes the teacher's marking transparent and self-checking.

**11. Aggregate projection HOLDS during medical disruption.** When papers are missed and SC-12 is filed, `wassce_candidates.projected_aggregate` does not adjust — it holds at the Mock-2-derived value. False precision is worse than no update. Surface 3 explicitly states the projection caveat on the trajectory strip. Aggregate recomputes once after WAEC releases real scores in mid-August (`wassce_results.released_at` is set). The recompute is a one-time event: real scores replace projected grades on a subject-by-subject basis for the best-3-cores + best-3-electives calculation. If a SC-12 make-up grade ultimately differs materially from the projection, the readiness statement is annotated post-hoc but never deleted (append-only).

**12. Best-3 cores + best-3 electives calculation is transparent and auditable.** The WAEC aggregate rule (best 3 of 4 cores + best 3 of 4 electives, dropped subjects do not count, minimum 6 / maximum 54) is implemented as a deterministic computation that runs on every mock-result and on WAEC release. Dropped subjects stay visible in the surface (greyed) so the reasoning is shown — HoAs, parents, and candidates can verify the rule has been applied correctly. The aggregate construction visualizer on surface 3 is auditable both forward (projection from Mock 2 + holding projection during disruption) and backward (actual results computation after WAEC release). No "hidden" logic; the rule is the rule.

**13. Parent tracker is the simplest surface, by deliberate design.** No sidebar. No benchmarks. No cohort data. Just the child's status, today's events, the SC-12 process, the schedule, the readiness statement she signed in March, and a FAQ. Mobile-leaning layout (rendered in desktop frame for design fidelity but ordered for narrow viewport). Tone is second-person ("called you", not "called the parent") and emotionally calibrated to the live moment — the parent is at her child's bedside, the page must respect that. Schema-level: the parent view reads from a parent-scoped role that grants access to one student's wassce + sickbay + comms records, never to cohort tables. RLS-enforced at the database layer; the parent literally cannot query cohort distributions even if they bypassed the UI. Six-question FAQ is the longest section by intent — most of what a parent worries about can be answered without a phone call.

**14. Benchmark provenance is shown explicitly on every column; the region figure is honestly labelled as directional.** The subject-teacher benchmark surface (`schoolup-wassce-subject-teacher.html`) compares "my cohort" against "school", "region", and "national". The first two are direct measurements from Omnischools's own data; "national" comes from WAEC's annual chief examiner report; "region" is the weak link — WAEC's regional summaries do not consistently publish subject-level breakdowns. Rather than hiding this, each row carries a source line with a quality dot (green = strong direct measurement, gold = moderate annual snapshot, warn = directional interpolation), and the region row carries a caveat note (`bench-note.caveat`) stating the figure is ± 4–5 pp and interpolated from coarser aggregate data. Schema implication: `benchmark_data_points` table carries `source_enum` (`SCHOOLUP_DIRECT` / `WAEC_NATIONAL` / `WAEC_REGIONAL_SUMMARY` / `INTERPOLATED` / `MULTI_SCHOOL_POOL`) and `quality_enum` (`STRONG` / `MODERATE` / `DIRECTIONAL`) with `confidence_interval_pp` numeric. The long-term fix for the region column is multi-school pooling — once 5+ Omnischools schools sit in the same region, the WR figure can be derived from anonymised cohort data and the quality moves from `DIRECTIONAL` to `STRONG`. Until then, honesty in the UI beats false precision; teachers know which numbers to trust.

### Audit retention · architectural decision worth preserving

One cross-cutting decision resolved 15 May 2026, closing the Tier 4 audit-retention sub-decision (#2 of 5):

**Audit entries are append-only and retained indefinitely; PII embedded in audit entries is tombstoned at the underlying record's retention horizon.** The Tier 3 retention policy file (`retention_policies`) and the audit log's "append-only forever" property were superficially in conflict — one made retention configurable, the other refused to delete anything. The resolution recognises that the conflict was real at the field level but false at the record level. Audit logs record *events*, not *subjects*; the value of an audit log is its completeness (if entries can be deleted, the log cannot prove what didn't happen, which is half the reason audit logs exist). The retention policy's purpose is data-subject rights and storage hygiene; both are honoured by redacting PII fields inside audit entries while keeping the event record itself.

**Schema mechanism.** `audit_log` rows are inserted at the time of every meaningful action and never updated except by one specific process: the nightly retention sweep. When the sweep purges an underlying record (a student record at 7-year horizon, a fee record at 5-year horizon, an operational record at 3-year horizon — per module defaults configurable above their regulatory floors via `retention_policies.regulatory_floor_years`), it finds every audit_log row referencing the purged record by `target_record_type` + `target_record_id` and replaces the snapshot PII fields (`target_subject_name_snapshot`, `target_subject_phone_snapshot`, `target_subject_other_pii_json`) with a tombstone marker like `[REDACTED-2032-08]`. The sweep never touches actor, action, module, occurred_at, severity, or IP — the *who did what when* is preserved. Every field-level redaction creates one row in `audit_pii_tombstones`, which is itself append-only.

**Why this resolves both goals.** The audit log viewer's "append-only · entries cannot be edited or deleted" claim stays accurate at the row level. Data-subject deletion requests (GDPR-style "right to be forgotten") are honoured — the subject's PII disappears from the audit log when their underlying record is purged. Storage hygiene is achieved — old PII does not accumulate indefinitely. Regulatory and operational audit value is preserved — historical events remain queryable and auditable by event class, actor, and timing. A parent disputing a 4-year-old fee waiver can still confirm an action took place; they cannot retrieve someone else's PII that was incidentally redacted at horizon.

**Default retention horizons** (configurable per school within regulatory floors): Academic records 7 years (GES/WAEC convention; floor 5). Financial records 5 years (Ghana Revenue Authority convention; floor 5). Operational/general records 3 years (floor 1). Audit entries themselves: indefinite (no floor, no ceiling — they only ever lose PII content, never the row).

**Visible in the audit log viewer.** Tombstoned fields display as `[REDACTED-2032-08]` in italic muted text on the audit-log-viewer surface, with a tooltip explaining the redaction was triggered by retention policy. The "append-only" framing now reads "append-only · entries cannot be edited or deleted; PII fields are pseudonymised at retention horizon per module policy" — one extra clause, full transparency.

### Audit anomaly detection · architectural decision worth preserving

Resolved 15 May 2026, closing Tier 4 sub-decision #1 of 5.

**Rule-based heuristics for MVP1 and MVP2; ML deferred to MVP3+ as an explainable suggestion layer over rules.** Three reasons. First, ML anomaly detection on audit logs needs 6–12 months of per-school baseline behaviour and a fleet of schools for transfer learning — at the solo-dev scale with 5–10 schools in year one, there is no training corpus and no statistical power. Second, false positives in security alerts cause alert fatigue; admins who aren't security professionals will rapidly learn to ignore the system, which kills its value. Rule-based heuristics let admins tune the false-positive rate to their tolerance because they understand the rule. Third, explainability is a hard requirement for an audit tool. Every flag must say *why* it fired in human-readable terms; "the model thought this was unusual" fails that test.

The seven shipped rules (`anomaly_rule_type_enum`): after-hours login (default 19:00–06:00 except Headteacher), repeated login failure (default 4 attempts in 6 minutes), mass export (default >1,000 rows), privilege escalation (any role-change event, no threshold), stale-view modification (a record edited based on data the actor viewed more than 30 minutes earlier), first-time IP for a user (any IP not seen in last 90 days), and bulk operation outside business hours. Each rule is configurable per school via `audit_anomaly_rules.threshold_json` with sensible defaults; turning a rule off requires Headteacher action and is itself audit-logged. Flags are append-only via `audit_anomaly_flags` — dismissal records a row, never deletes one.

ML in MVP3+ is allowed as a suggestion overlay only: if and when Omnischools has enough fleet-level data, an ML model can highlight *additional* candidate anomalies for admin review, but it cannot fire its own alerts and every ML-surfaced flag must include the top contributing features in plain English. Rule-based fires alerts; ML suggests further inspection. The audit log viewer surface already shows the anomaly pattern correctly — the "⚠ login attempt outside normal hours · 4 failed attempts in 6 minutes" entry is exactly what rule-based fires, with explainable terms.

### Bulk operations scheduling · architectural decision worth preserving

Resolved 15 May 2026, closing Tier 4 sub-decision #2 of 5 (renumbered to #3 in this batch).

**Bulk operations are schedulable; the scheduler is unified with the reminder-series scheduler under one `scheduled_jobs` table, not two parallel schedulers.** Schools genuinely need scheduling: end-of-term bulk withdrawals committed Friday afternoon to execute Friday night after final review, Friday end-of-day overdue-fee SMS to all parents (already a reminder-series pattern), start-of-term bulk attendance reset, mid-month bulk MoMo reconciliation. The question is *where the scheduler lives*, and the answer is: in one place.

Two parallel schedulers would double-maintain time specs, timezone handling (Africa/Accra), failure retry policy, cancellation UI, and audit-log integration — for no architectural benefit. The unified approach treats `job_type_enum` as the only discriminator: `REMINDER_SERIES`, `BULK_OPERATION`, `RETENTION_SWEEP` (which the audit-retention decision above introduced), `MOCK_REPORT_RUN`, `PII_EXPORT_EXECUTION`, `AUDIT_NIGHTLY_SEAL`. Each job type knows how to execute itself via a handler reference; the scheduler's only job is "wake up at the right time and call the right handler".

Critically, scheduled bulk operations still go through the same commit → audit → undo path as immediate bulk operations. Scheduling is a "when" wrapper, not a behaviour change. A scheduled bulk withdrawal that fires at Friday 23:00 lands in the audit log at Friday 23:00 with the executor recorded as the original scheduler (with a `scheduled_job_id` reference), enters the appropriate undo tier from that moment, and respects every downstream constraint that immediate bulk ops respect. The scheduler does not bypass policy; it just defers execution.

In-app affordances: 30 minutes before execution, an in-app notification fires to the creator; cancellable until execution starts; visible in a "Scheduled" section of the audit log viewer with future-event tint. Failed jobs retry with exponential backoff up to `max_retries` (default 3) and then surface as a Tier 2 anomaly flag.

### Bulk undo tiers · architectural decision worth preserving

Resolved 15 May 2026, closing Tier 4 sub-decision #3 of 5 (renumbered to #4 in this batch).

**Lock the three-tier reversibility model already shown on `schoolup-bulk-undo.html`, with explicit thresholds and atomic batch undo at every tier.** The surface was designed correctly; the policy needed sign-off.

Tier A (60-minute window, no confirmation needed) is for pure-reversal operations that touch only Omnischools internal state and have no external consequence: bulk attendance marking, bulk provisional grade entry, bulk class assignment, bulk parent-link updates, bulk SMS that has not yet been transmitted. The 60-minute window catches the "wait, I picked the wrong class" moment without inviting actions to sit in limbo.

Tier B (24-hour window, diff-modal confirmation required) is for operations that have settled into reports and dashboards but no external state has changed: bulk fee assignment, bulk discount application, bulk role assignment, bulk void of a receipt before bursar end-of-day. The diff modal shows what reverting will change so the undo decision is informed.

Tier C (7-day window, Headteacher co-sign required, generates compensating reversal entries rather than deletions) is for operations with external state changes that cannot be physically undone: bulk SMS that have been transmitted (you cannot un-send), bulk MoMo reconciliation (already pushed to parents' statements), bulk transcript releases (already in parent hands), bulk fee adjustments after a statement has been sent. The compensating-reversal pattern means the original entry stays and a new entry records the reversal — both are visible in audit, both contribute to the financial record.

Beyond Tier C: no undo path. Correction proceeds by new offsetting entries only; the original action is part of permanent record.

Atomic batch undo across all tiers: each bulk operation gets one `bulk_operations.id`, all child records inherit it via `bulk_operation_children.bulk_operation_id`, and the inverse runs in a single database transaction so the undo is either fully applied or fully not — never half-done. For Tier C the "inverse" is the compensating-entry generator rather than a restore-from-snapshot.

The reversibility tier is shown to the operator at commit time, on the bulk-operations confirm dialog — green/warn/terra badge — not just on the audit log. Admin trust comes from knowing the answer to "can I undo this?" *before* committing, not from discovering it after.

### PII export approval flow · architectural decision worth preserving

Resolved 15 May 2026, closing Tier 4 sub-decision #4 of 5 (renumbered to #5 in this batch).

**Two-stage approval, single-use, 7-day expiry.** The custom data export builder already flags PII columns with "approval needed" in italic gold; the workflow that approval triggers is now specified.

Three flow classes. Aggregate exports without PII columns (counts, distributions, trends) require no approval and proceed immediately. Column-only PII exports (e.g., names + phone numbers for an SMS campaign that doesn't need rows-per-student) require Headteacher approval only — the operational head of school decides whether the marketing purpose is appropriate. Record-level PII exports (rows containing PII, used for parent-shared transcripts, GES reports, individual case files) require Headteacher approval *plus* Data Protection Officer approval — a step above operational head, with explicit data-protection accountability. Schools that have not designated a DPO fall back to Headteacher for both stages, with `dpo_fallback_to_ht_flag` set on the request record so any subsequent audit shows the school had no separate DPO at the time.

Approval is single-use and grants for one specific request with stated purpose, recipient name and organisation, recipient retention period, exact columns, and exact row filter. Approval cannot be reused for a different export and expires 7 days after grant if not exercised. Expiry without exercise generates an audit entry — "approval lapsed unused" — which is forensically useful for understanding whether requests are speculative or genuine.

Every step generates an append-only entry in `pii_export_audit`: request created, Headteacher decision, DPO decision (or fallback), execution with row count, expiry without execution. The exported file itself is stored encrypted with a 30-day TTL, after which the file is purged but the audit trail remains — recipient retention is the recipient's responsibility, attested at request time.

The custom data export surface needs a multi-step modal when PII columns are selected — the user states purpose, recipient, retention; the request is created; approval status is shown on a per-request dashboard. The PII-export queue surface appears in the audit log viewer's anomaly/sensitive area for Headteacher and DPO action. Both UX flows are buildable from the existing surfaces; no new design work blocks the decision.

### Unified onboarding wizard · architectural decision worth preserving

Resolved 15 May 2026. Two prior surfaces (`schoolup-wizard-all-steps.html`, 6-step MVP1 universal wizard; `schoolup-shs-school-setup.html`, 8-step SHS-specific wizard) were merged into one canonical `schoolup-unified-onboarding.html` surface.

**The pattern.** School onboarding is one flow with a branch point. The unified wizard uses a vertical step navigation pinned to a 300px left column with the content panel filling the rest — the same pattern Stripe Connect, Linear, and Notion use for multi-step setup. Step subtitles show the decision made or current state inline, so the user can scan the nav and see what they've already configured. Steps 7 and 8 (residency + WAEC) are visible but dashed/greyed by default; they activate only if the step 2 answer was SHS, SHTS, or Multi-tier. Basic and JHS schools complete at step 6 with a celebration card and a "Go to dashboard" handoff; they never see steps 7–8 fill in. The step count in the header reflects the chosen path ("Step 2 of 8 · SHS path" or "Step 2 of 6" for Basic).

**Step canon — 6 universal + 2 SHS-only.**
1. School identity — name, GES code, **CSSPS school code** (one-field addition that wires `hm.cssps.gov.gh` placement lists into the admissions module later), ownership type, region, district, postal/GPS.
2. School type — the branch point. Five live options (Basic, JHS, SHS, SHTS, Multi-tier) plus a dashed-disabled TVET-only option flagged for future Q3 2026 work. Cannot be changed later without Headmaster + GES code re-verification.
3. Academic calendar — term structure, holidays, week numbering. Defaults from GES.
4. Academic structure — **same step number, branched content**. Basic gets classes + subjects per class; SHS gets programmes (Sci/Bus/GA/HE/etc.) with universal cores and per-programme electives. Both paths load defaults from the relevant syllabus authority (GES Basic, WAEC SHS); the user confirms or edits rather than typing from scratch.
5. Staff & roles — Headmaster auto-populated, senior staff registered, role grants assigned.
6. Billing & payments — fee structure, term-based vs monthly, MoMo and bank integration, Free SHS eligibility flag for public SHS.
7. **[SHS only]** Residency model (Day 7% / Mixed 81% / Boarding-only 12% based on real Ghana distribution) and house system configuration with visiting day cadence.
8. **[SHS only]** WAEC centre code, regional WAEC office, first cohort year, calendar sync mode, confirmation of WASSCE programmes inherited from step 4.

A final review step (post-step-6 for Basic, post-step-8 for SHS) shows all decisions in confirm-cards with edit-from-here affordances, then the "Launch school" CTA initialises the Headmaster dashboard.

**Why this pattern is the convention for any future multi-step flow.** Vertical step nav scales to N steps without redesign — adding step 9 or 10 (oversight onboarding, multi-campus configuration, accreditation flows) doesn't break the layout. Inline subtitles let each step carry its own context without modal-stuffing. Conditional steps via the dashed-greyed visual state make the product story honest (users see what doesn't apply to them) without forcing the developer to maintain parallel wizards. Same-step-different-content (step 4) keeps navigation consistent — users at step 4 are doing "academic structure" regardless of school type; the data shape adapts. Any future Omnischools wizard (e.g., the bulk admission flow with its five internal phases) should inherit this exact pattern: vertical nav, dashed conditionals, branched content over branched step counts.

**Schema implication.** Setup decisions land in `schools` (identity, type, ownership, region/district, CSSPS code), `academic_calendars`, `programmes` + `classes` + `subjects` (branched by school_type_enum), `staff` + `staff_role_assignments`, `billing_config`, and (SHS only) `residency_config` + `houses` + `waec_centres`. The wizard writes incrementally — every Save & continue commits the step's data, so partial setups survive session interruption. The `onboarding_progress` table tracks completion per step per school for resume logic.

### SHS admissions architecture · two surfaces, one cohort · architectural decision worth preserving

Resolved 15 May 2026 alongside the unified onboarding wizard. The decision establishes the SHS admissions pipeline as bulk-default with per-student secondary, and codes the integration constraint with GES's CSSPS placement system.

**The shape of the operational reality.** Ghana's Computerised School Selection and Placement System (CSSPS) auto-places ~447,000 BECE candidates into SHS, SHTS, and TVET institutions every year, with placements released in mid-September. School heads access placement lists via `hm.cssps.gov.gh` with a school-specific CSSPS code and password; the portal exposes student count, individual grades and aggregates, JHS attended, and vacancy status. The portal supports **view and print only** — no public API, no public CSV/Excel download. Heads typically print the list and an admissions clerk re-types it into the school's records. Beyond the auto-placed cohort, schools handle self-placement students (separately via `sp.cssps.gov.gh`), transfers in from other SHS, late arrivals after the main intake, and returning students re-entering after withdrawal. Realistic intake mix for a 240-student Form 1: 94% bulk auto-placed, 6% one of the ad-hoc categories.

**Two surfaces, one cohort.** Bulk (`schoolup-shs-bulk-admission.html`) is the September default — five-state internal flow over a four-week admission window (empty state with countdown, source the list, review and match, programme + House + residency assignment, commit + reconciliation). Per-student (`schoolup-shs-student-admission.html`) is the year-round secondary path — single-screen CSSPS-aware form for the 6% non-bulk cases. Both pipelines write to the same Form 1 cohort with a `student_admission_source_enum` provenance flag (`BULK_INTAKE` / `SELF_PLACED` / `TRANSFER_IN` / `RETURNING`) on each student record. Every downstream surface reads the cohort as one; provenance is queryable for GES filing and ad-hoc analysis but not foregrounded in operational views.

**Three input paths because GES gives no integration.** The bulk surface accepts paste-from-portal (head copies the placement table from `hm.cssps.gov.gh`, parser purpose-built for the CSSPS column order: index, name, sex, DOB, aggregate, programme, choice number, JHS, district, residency — recommended path, ~99% parse accuracy), CSV upload (head built a spreadsheet from portal data, or district office distributed one — template enforced on column headers), and PDF/printed-list upload (paper copy from district directorate, OCR'd — fallback only, expect 10–15 minutes of row-by-row verification after upload). The portal walkthrough card on the surface tells heads the four-step procedure for getting their list — `hm.cssps.gov.gh` is treated as part of the Omnischools workflow rather than external help, because operationally it is part of the workflow.

**Review and match catches the 3% predictable noise.** CSSPS portal data is mostly structured, but every intake produces a small number of flagged rows. Three categories: duplicate match against existing students (siblings already enrolled — most common; the head confirms sibling link, marks as coincidence, or merges returning-student record), missing parent phone (portal export occasionally drops this — hard stop, will not commit without, because every downstream module depends on it), and parse anomaly (OCR-confused name characters, malformed BECE index — fix-in-place workflow). Cannot continue until all flags resolved; no partial commit; atomic batch or nothing.

**Schema additions for admissions:**

```sql
CREATE TYPE student_admission_source_enum AS ENUM ('BULK_INTAKE', 'SELF_PLACED', 'TRANSFER_IN', 'RETURNING', 'OTHER_AD_HOC');
CREATE TYPE bulk_admission_input_path_enum AS ENUM ('PASTE_FROM_PORTAL', 'CSV_UPLOAD', 'PDF_UPLOAD');
CREATE TYPE bulk_admission_status_enum AS ENUM ('DRAFT_SOURCING', 'DRAFT_REVIEWING', 'DRAFT_ASSIGNING', 'COMMITTED', 'UNDONE');

ALTER TABLE students
  ADD COLUMN admission_source student_admission_source_enum,
  ADD COLUMN bulk_admission_id UUID NULL REFERENCES bulk_admissions(id),
  ADD COLUMN cssps_index_text TEXT,
  ADD COLUMN cssps_choice_number INTEGER NULL,
  ADD COLUMN cssps_placed_programme_text TEXT NULL,
  ADD COLUMN cssps_residential_preference TEXT NULL,
  ADD COLUMN jhs_attended_text TEXT;

CREATE TABLE bulk_admissions (id, school_id, intake_year, intake_form_level, source_path bulk_admission_input_path_enum, source_raw_text NULL, source_csv_file_id NULL, source_pdf_file_id NULL, parsed_row_count, flagged_row_count, status bulk_admission_status_enum, created_by_staff_id, created_at, committed_at NULL, committed_by_staff_id NULL, bulk_operation_id UUID NULL REFERENCES bulk_operations(id));

CREATE TABLE bulk_admission_parsed_rows (id, bulk_admission_id, row_number, cssps_index, name_text, sex, dob, aggregate, programme_text, choice_number, jhs_text, district_text, residential_preference, flag_type_enum NULL, flag_resolution_text NULL, resolved_at NULL, resolved_by_staff_id NULL, committed_student_id NULL);

CREATE TYPE admission_flag_type_enum AS ENUM ('DUPLICATE_SIBLING', 'DUPLICATE_RETURNING', 'MISSING_PARENT_PHONE', 'PARSE_ANOMALY', 'CAPACITY_OVERFLOW');
```

**The reconciliation surface.** Two weeks after bulk commit, the admissions team needs to close the gap between CSSPS-placed and physically-arrived. The bulk surface's section 5 surfaces three counts: enrolled (228 of 240), placed-but-not-arrived (12, with sub-categories: confirmed-self-placed-elsewhere = safe to mark non-enrol, vs contact-pending = parent calls in progress), and walked-in additions (14, breakdown by source: self-placement / transfer / returning). The 24-hour Tier B bulk-undo window from the original commit has long expired by this point; corrections at the reconciliation stage are per-record actions (per-student withdrawal, per-student admission), not bulk reversals. Once the head files the GES Free SHS return (Saturday after intake close), the admission cycle officially closes. Until then, the reconciliation surface keeps showing the gap.

**Cross-module integration:**
- Students module sees the unified cohort, provenance flag queryable
- Programmes & classes module receives populated class rosters at commit time
- Houses module receives populated House rosters at commit time
- Fees module opens 1 fee account per admitted student (Free SHS coverage applied for public schools and CSSPS-placed students; private and ad-hoc require fee structure setup before bulk commit)
- Communications module fires welcome SMS + parent-app invite link to 240 parents 18 hours post-commit (delay is intentional — gives the head a chance to undo the bulk operation within Tier B window before parents are notified)
- Free SHS claim filing module receives batch of provisional claims, auto-submits at admission window close
- Audit log records the bulk operation with full provenance, child records under `bulk_operation_id`

### Navigation conventions · architectural decision worth preserving

Resolved 18 May 2026, Phase 1 of a two-phase reconciliation that was deferred from Session 23. Phase 1 locks the conventions in this document and fixes a single inconsistent surface; Phase 2 (mechanical surface-level enforcement) is unnecessary because the audit revealed that the codebase is already substantially compliant with the conventions being locked.

**The trigger.** During Session 23 wizard work, three navigation observations surfaced. First, the codebase had two competing sidebar patterns — flat nav (used in 99 of 101 surfaces) and sectioned nav (used in just 2 of 101, both WASSCE surfaces from the WASSCE batch). Second, the one surface that did use sectioned nav labelled one of its groups "Pastoral," a term that reads naturally in Ghanaian SHS context but carries mission-school baggage in some interpretations and is less durable for non-Ghanaian markets. Third, the unified onboarding wizard had just locked vertical step nav as the canonical multi-step pattern, raising the question of whether that pattern was intended as a universal design system convention or a one-off for onboarding. All three needed to be answered before any new SHS surface was built.

**Audit findings before deciding.** The summary that motivated this work overestimated the rename scope. "17 surfaces affected by the Pastoral rename" turned out to be the count of surfaces in the *pastoral-domain modules* (VLC = 5 + Boarding = 7 + Sickbay = 5 = 17), not the count of surfaces that use "Pastoral" as a navigation label. Only one surface uses "Pastoral" as a nav-group label (`schoolup-wassce-student-readiness.html`, six sidebar renders × one label per render). Twenty-two surfaces use the word "pastoral" *somewhere* in their content — CSS class names like `.pastoral-card`, code comments, editorial copy like "active pastoral flags" or "pastoral cross-reference," and section meta breadcrumbs. The distinction matters: navigation labels are user-facing structural identifiers and should be normalised; editorial use of the term "pastoral care" is a legitimate domain concept and should not be touched.

**Convention 1 · Flat nav by default; sectioned nav only when the sidebar exceeds twelve items.** Most Omnischools surfaces fit comfortably in flat nav with 8–10 items. Sectioning adds visual weight and forces the user to scan for group headers before finding items; it earns its keep only when the alternative is an unscannable wall of twelve-plus undifferentiated items. The 99/101 split shows this is already the de facto convention; codifying it just means new surfaces start there. Basic schools always flat — their sidebars are inherently shorter (no Houses, no programmes, no boarding/sickbay/VLC). SHS surfaces flat by default, sectioned only when the role's full sidebar exceeds twelve items.

**Convention 2 · Domain-grouped section labels, when used.** Four canonical sections in this order: **Academic** (subjects, classes, gradebook, transcripts, assessments, WASSCE prep), **Student support** (replaces "Pastoral" — covers VLC, Boarding, Sickbay, Discipline, anything in the non-academic welfare and formation space), **Operations** (billing, attendance, communications, reports, admissions, day-to-day administration), **Settings** (school configuration, staff records, integrations, audit). When a section would have fewer than three items it folds upward — Settings as a single nav item under Operations is preferable to a one-item Settings section. The rename of "Pastoral" to "Student support" reflects a deliberate choice: pastoral care is a real concept widely understood in Ghanaian education and remains valid in editorial prose, but as a top-level navigation category "Student support" is more inclusive of secular government schools, more legible to first-time users, and more durable if Omnischools expands beyond Ghana. The word "pastoral" survives in surface copy, CSS class names, and conceptual references; it loses only its role as a navigation label.

**Convention 3 · Role-grouped nav is a documented exception for multi-role users.** The teacher view `schoolup-wassce-subject-teacher.html` uses sections **Teaching / Form Master / PLC / Other** because Mr S. Asiedu wears three genuinely distinct roles in his work day — subject teacher, Form Master of F3 Slessor, and PLC participant — and grouping by role rather than by domain matches how he mentally context-switches. This is not the default; it's the right answer for surfaces where one user occupies multiple structurally distinct roles simultaneously. Documented as an exception so future surfaces that face the same situation know it's permitted, and so future surfaces that don't face it know to default to domain-grouped or flat.

**Convention 4 · Wizard pattern is the canonical multi-step flow.** Vertical step nav on the left (following Stripe Connect / Linear / Notion conventions), content panel filling the rest, sticky step indicator, completed steps showing checkmarks, future steps greyed. Locked in `schoolup-unified-onboarding.html` and referenced from any future multi-step guided flow. Distinct from the horizontal stage-progress pattern used in the bulk admission surface — wizards are one-time setup flows worked top-to-bottom in a single session; stage progress fits multi-week operational flows where the user opens, leaves, returns, and picks up where they left off (e.g., admission window over four weeks).

**Phase 1 surface change required.** Six occurrences in `schoolup-wassce-student-readiness.html` updated from `<div class="nav-group">Pastoral</div>` to `<div class="nav-group">Student support</div>`. No other surface refactor is needed; the codebase is already substantially compliant. `schoolup-wassce-subject-teacher.html` remains as-is and is referenced as the role-grouped-exception canonical example.

**Phase 2 deferred — and likely never needed.** The original deferral assumed mechanical refactor work at build time would be required to reconcile a divergent codebase. The audit showed the divergence was much smaller than memory suggested. Phase 2's only standing trigger is *new* surfaces being built that violate the conventions — those should be caught at build review, not via batch refactor. The pastoral-domain modules (VLC, Boarding, Sickbay) keep their existing copy and CSS class names; "pastoral" stays in editorial prose where it reads naturally and only loses its role as a structural navigation label.

### Profile photos · architectural decision worth preserving

Resolved 18 May 2026. Every user profile view in Omnischools (student, teacher, parent, admin/accountant) supports an uploaded profile photo. This decision codifies the convention; existing surfaces are not refactored to add the upload affordance, because the rendering pattern is identical to the initials-based avatar already used throughout the design system, and surfaces will adopt the upload UI organically when next touched.

**The visual pattern is the existing avatar pattern.** Circular crop, gold-soft (`#E8D4B8`) background when no photo is uploaded, initials in Fraunces over the gold-soft. This is the same `.av` / `.r-av` / `.gr-av` pattern repeated across the codebase — sidebar footers showing user identity, review tables showing student rows, gap lists showing reconciliation cases, parent-app surfaces showing the family. When a photo is uploaded, it replaces the initials behind the same circular mask at the same dimensions. No surface needs to choose between "with photo" and "without photo" styling; one pattern handles both states.

**Three canonical sizes:** small (32–40px) for sidebar footers, list rows, table cells; medium (56–64px) for inline mentions in detail views; large (96–128px) for profile-header positions. The upload affordance (camera icon overlay or "Change photo" link) appears only at the medium and large sizes, never on the small list-row avatars. Tap or click the large avatar on the user's own profile view to open the upload modal.

**Storage and lifecycle.** Photos stored in Supabase Storage under bucket `user-photos`, path `{school_id}/{user_role}/{user_id}.jpg`. Server-side resize on upload to three pre-rendered sizes (40 / 64 / 128px); originals discarded. Max upload size 5MB before resize. JPG and PNG accepted; HEIC converted server-side. Photos are PII and are governed by the audit retention rules — when a student record reaches its retention horizon (or a parent/staff record their respective horizon), the associated photo files are deleted alongside the tombstoning of related audit log entries. The `users` table gains a single nullable `photo_path TEXT` column; presence indicates an uploaded photo, absence indicates fall-back to initials.

**Audit treatment.** Photo upload is an audit-logged event (`PHOTO_UPLOADED`, `PHOTO_REPLACED`, `PHOTO_REMOVED`). Photo-replacement preserves the prior path in the audit entry for the retention window before tombstoning. Photo removal is a soft delete in the audit trail (entry remains, file path tombstoned at retention horizon). Self-uploads (a teacher uploading their own photo) and admin-uploads (an office admin uploading a student's photo at admission time) are distinguished in the audit type but follow the same flow.

**Consent for minors.** A student's photo can be uploaded by the student themselves (where age permits self-consent under the school's policy) or by an authorised parent/guardian or admission officer. The upload modal surfaces this on student profiles ("Photo uploaded by · {name} · {timestamp}" appears below the avatar on detail views). Schools can disable student photo collection entirely via a setting at the school level; the avatar then renders permanent initials and the upload affordance is hidden.

**No surface refactor required.** The avatar pattern is already on every surface that surfaces a user identity. Adding the photo affordance to a specific surface is a five-line component swap (`<Avatar>` becomes `<AvatarWithUpload>` on the user's own profile, or `<Avatar src={user.photo_path} initials={user.initials} size="lg" />` everywhere else). Surfaces adopt incrementally as they're touched for other reasons; meanwhile, all existing surfaces continue to render the same gold-soft + initials pattern they always have, which is now formally the "no photo uploaded yet" state.

### Oversight product line · architectural decisions worth preserving

Scoped 18 May 2026. This section settles five of the six Oversight scoping decisions (audience, core questions, surface inventory, deployment/auth, the operational boundary). The sixth — analytics DB schema and ETL job specification — is deliberately deferred until the surface inventory is built and the exact data each surface needs is known. The two-database architecture, the nightly 02:00 GMT ETL window, jurisdiction-aware RLS, and the `apps/oversight` repo placeholder are already specified above under "Product tiers" and "What to do in week 0"; this section does not restate them.

**Decision 1 · Three roles, hierarchical visibility.** Oversight launches with exactly three roles and adds more only on explicit request. **District director** sees only the schools in their district. **Regional director** sees all districts and schools in their region. **MoE/national staff** see national. Visibility is strictly hierarchical and nesting — a regional director's view is the union of their districts' views; the national view is the union of all regions. No sub-roles at launch (no circuit supervisors below district directors, no separate GES-HQ vs MoE-policy distinction); these can be added later as finer jurisdiction scopes without re-architecting, because the access model keys on `jurisdiction_id` and `jurisdiction_level`, not on a fixed three-way enum of capabilities. Ghana has ~260 districts and 16 regions, so the district tier is by far the largest population of Oversight users.

**Decision 2 · Core questions · academic, performance, and school-bio insights.** Oversight is observational and comparative, not operational. The questions it answers, by theme:

- *Enrolment and bio.* Enrolment by school, by class/Form, by sex (e.g., boys vs girls enrolled this year). Year-over-year enrolment trend. **Comparative bio** — the signature Oversight analysis. The comparison is strictly **stage-for-stage on a matched school-going-age basis**: enrolment at a given stage is compared against the population of children who are *of the official age for that stage*, in the same catchment. Concretely — if 230 schools' worth of children are enrolled in JHS across a district, that JHS enrolment is compared against the GSS-estimated count of children aged ~12–14 (the official JHS age band) living in that district, **not** against total district population and not against a different stage's age band. KG enrolment compares against the KG-age population (~4–5), Primary against ~6–11, JHS against ~12–14, SHS against ~15–17. Requires a GSS population reference dataset in the analytics DB broken down by single year of age (or at least by these official stage bands) and by district/region, with the official age-for-stage mapping held as configuration so it can track curriculum changes.

  **Critical methodology constraint · partial coverage means no out-of-school headline.** Omnischools only records enrolment at schools that are *on the platform*. While platform coverage of a jurisdiction is incomplete (e.g., 34 of 40 schools in the demo district), the difference between age-matched population and recorded enrolment is an **unmeasured gap**, NOT an out-of-school-children count — a portion of that gap is children genuinely enrolled at schools Omnischools cannot see. Surfaces must never present this difference as a single "out of school" figure. Instead the gap is **split and never re-merged**: (1) an explainable portion, estimated as enrolment at the non-Omnischools schools (inferred from those schools' capacity in the EMIS register), resolved by *onboarding* not intervention; and (2) the remainder, a *possible* out-of-school signal worth investigating. A true out-of-school count is only claimable at full jurisdiction coverage. Every level of drill-down (district, circuit, stage) must show coverage alongside the rate, because a low recorded-enrolment rate at partial coverage is ambiguous, not a confirmed under-enrolment finding. This constraint is the reason onboarding the remaining schools is framed throughout Oversight as the route from estimate to measured count. (For SHS specifically, a second caveat also applies even at full coverage: CSSPS placement is national, so district children are routinely placed at SHS outside their home district and would not appear in the home district's enrolment.)
- *Academic performance.* Two distinct kinds of performance data, deliberately not conflated:
  (a) **External examination outcomes** — BECE for JHS, WASSCE for SHS — by school, class/Form, subject, and sex. Aggregate distribution (grade bands), trend over cohorts, progression indicators (transition, completion rates). These are *terminal* (final-year classes only), *authoritative* (WAEC-graded, externally moderated), and arrive once a year as a loaded reference extract (Decision 7).
  (b) **Internal / continuous performance** — termly and annual results from a school's own assessments, plus **mock examination** results for candidate classes. These are generated *live* from schools' own Omnischools gradebook use, cover *every* class/Form not just exam years, and exist *only for schools actually using Omnischools's gradebook* — so internal performance carries a coverage caveat exactly like the enrolment surface (a director must see how many schools' internal data is present), and a moderation caveat (this is the school's own unmoderated marking, comparable within a school but only loosely comparable between schools). Mock results are operationally important to GES as a *leading indicator* — a weak mock cohort predicts a weak WASSCE/BECE — so the surface treats mocks both as a selectable period and as a *predictor* shown beside the eventual real result for the same cohort. **For SHS specifically, internal performance rolls up from the five-category score ledger** (`SHS_SCORE_LEDGER_SPEC.md`): assignments, mid-semester exam, end-of-semester exam, project work, and portfolio, each with weights configured per (subject × school) at enrolment, surfaced in the analytics DB as per-category score means alongside the weighted total (`fact_performance_internal` columns `assignments_score_mean`, `mid_sem_score_mean`, `end_sem_score_mean`, `project_score_mean`, `portfolio_score_mean`). Basic and JHS rows continue to use a single weighted subject score, NULL on the five SHS-specific columns. This per-category structure is what enables the mock-vs-WASSCE predictor at Oversight — a school whose mid-sem scores predict end-of-sem scores predict WAEC outcomes well is structurally different from one where they don't, and the analytics can surface that difference rather than collapsing the assessment journey into one number. The five-category structure also carries through to coverage reporting: `score_ledger_coverage_flag` distinguishes SHS schools where the ledger is lived from schools where teachers enter only a final mark, and `paths_used` records the distribution of capture paths (A/B/C) per cut.
  The academic performance surface exposes this through a two-level period selector: an exam-type selector (WASSCE / BECE / Mock / Internal termly / Internal annual) crossed with a period selector (year, and term where applicable). External exams drive the headline/subject/sex/trend/school sections; internal performance gets its own dedicated section with its coverage and moderation caveats stated. Performance is the metric GES leans on most heavily for school evaluation and intervention targeting, so it sits alongside enrolment as a primary theme.
- *Attendance.* Attendance rates by school, class/Form, and term. Trends and outliers.
- *Teacher statistics.* Teacher counts, postings, vacancies, qualification mix, GES rank distribution. Student-to-teacher ratios by school and by class/Form — a core GES planning metric.
- *Fees.* Breakdown of tuition and related fees charged to students, by class/Form. Lets GES see fee-level variation across schools in a district and against policy ceilings, and is relevant to Free SHS reconciliation.

All of these roll up the hierarchy: the same shape of question is answered at school, district, region, and national scope.

**Comparative analysis is a first-class mode, not just rollup.** Beyond aggregating upward, Oversight must support *side-by-side comparison across peer jurisdictions and selected schools* on any of the themes above. A district director compares their schools against each other and their district against neighbouring districts; a regional director compares the districts within their region; MoE compares regions, and compares any hand-picked set of schools nationally (e.g., all schools of one ownership type, or a watch-list). Comparison is scoped by the user's jurisdiction ceiling — a district director can compare schools and districts but cannot compare regions they have no visibility into. This comparative capability is what makes the dashboards analytical rather than merely informational, and it shapes the surface design: every dashboard needs a compare affordance, and the school detail view needs a "compare against" picker. The signature enrolment-vs-population surface is one instance of this broader comparative pattern.

**Decision 3 · Data model · resolved 24 May 2026.** GES needs both aggregated data and student-record-level detail; aggregates are used most often, named records sparingly and only for compliance views (Decision 6). The analytics DB schema and ETL specification was deliberately deferred until the surface inventory was built and each surface's data needs were concrete — it is now written, in full, in **`OVERSIGHT_ANALYTICS_SPEC.md`**. Summary: a separate analytics Postgres holding dimension tables (`dim_jurisdiction` — the self-referencing school→district→region→national spine; `dim_period`; `dim_stage` — the age-matching config; `dim_subject`), fact tables at one-row-per-school-per-period grain (`fact_enrolment`, `fact_attendance`, `fact_performance_exam`, `fact_performance_subject`, `fact_performance_internal`, `fact_staffing`, `fact_fees`, `fact_anomaly`) with district/regional/national figures computed as roll-ups never stored, and reference tables for data Omnischools does not generate (`ref_emis_school_register`, `ref_gss_population`, `ref_waec_results_extract`, `ref_ges_teacher_establishment`, `ref_ges_data_sharing_agreements`, `ref_anomaly_rule`). Named records are never in the analytics DB — the compliance view reaches them via a gated, append-only-logged read back to operational Postgres. Every fact and reference row carries `source` and `as_of_date`. The nightly 02:00 GMT ETL, jurisdiction RLS, and build order are all specified in the document. With this, all six Oversight scoping decisions are resolved.

**Decision 4 · Surface inventory.** Oversight surface set — Batch 1 built, the rest planned:

| Surface | Audience | Purpose | Status |
|---------|----------|---------|--------|
| District director dashboard | District director | The anchor surface · district-wide enrolment, performance, attendance, teacher stats, fee overview · school list with drill-down | **Built** · 4 sections · `schoolup-oversight-district-dashboard.html` |
| School detail view | All three | Drill-down target from any tier · one school's full Oversight profile · compare-against picker · the compliance boundary | **Built** · 3 sections · `schoolup-oversight-school-detail.html` |
| Oversight user onboarding | New Oversight user | First-sign-in flow for a newly GES-provisioned district/regional director | **Built** · 3 sections · `schoolup-oversight-onboarding.html` |
| Regional dashboard | Regional director | Same shape aggregated to region · district comparison · drill into any district or school | **Built** · 3 sections · `schoolup-oversight-regional-dashboard.html` |
| National dashboard | MoE/national | National rollup · regional comparison · policy-level indicators | **Built** · 3 sections · `schoolup-oversight-national-dashboard.html` |
| Enrolment vs population analysis | All three | The signature comparative surface · stage-for-stage enrolment vs GSS age-band population · out-of-school-children estimate per stage | **Built** · 3 sections · `schoolup-oversight-enrolment-population.html` |
| Academic performance analysis | All three | External (BECE/WASSCE) outcomes by school, Form, subject, sex, trend · plus internal termly/annual/mock performance with coverage & moderation caveats · two-level period selector | **Built** · 4 sections · `schoolup-oversight-academic-performance.html` |
| Comparison workspace | All three | Side-by-side comparison of selected schools / districts / regions on any theme · jurisdiction-ceiling scoped · the compare affordance the dashboards link into | **Built** · 3 sections · `schoolup-oversight-comparison-workspace.html` |
| Compliance record view | All three | Named-record access for specific compliance needs · justification-gated and audit-logged (see Decision 6) | **Built** · 3 sections · `schoolup-oversight-compliance-record.html` |
| Anomaly / investigation queue | District director, MoE | Flagged outliers (enrolment spikes, attendance collapse, fee outliers) for follow-up | **Built** · 2 sections · `schoolup-oversight-anomaly-queue.html` |
| Data sharing agreement management | MoE/national | Which schools have signed, agreement versions, scope per school | **Built** · 2 sections · `schoolup-oversight-dsa-management.html` |
| Oversight access &amp; audit log | MoE/national | Who accessed what, when, and the justification given for named-record pulls | **Built** · 2 sections · `schoolup-oversight-access-audit.html` |
| Exports | All three | CSV / PDF for official GES reporting · coverage stamp travels with the file · named-record exports gated &amp; logged | **Built** · 2 sections · `schoolup-oversight-exports.html` |

Build order: **Batch 1 — district director dashboard, school detail view, Oversight user onboarding — is complete (3 of 3).** **Batch 2 is complete (5 of 5)** — the enrolment-vs-population surface, the academic performance analysis, the comparison workspace, the regional dashboard, and the national dashboard. **Batch 3 is complete (5 of 5)** — the compliance record view, the anomaly/investigation queue, the data-sharing-agreement management surface, the Oversight access &amp; audit log, and exports. **The entire Omnischools Oversight product line — all 13 surfaces across 3 batches — is now built.** The operational-app "what GES can see about us" trust surface was dropped (see Decision 6 rewrite). Note on counting: each batch is counted separately — a surface from one batch is never folded into another batch's numerator.

**Decision 5 · Deployment and authentication · separate user pool, GES-provisioned.** Oversight runs from the same monorepo as the `apps/oversight` Next.js app, served at the subdomain `oversight.omnischools.gh`, reading exclusively from the analytics database. Oversight users are a **separate top-level user pool** — structurally distinct accounts scoped by `jurisdiction_id` and `jurisdiction_level` (district / region / national), not by `school_id`. They are not borrowed from any school's user roster. This is deliberate: a district director sits above schools and does not belong to one; conflating an Oversight account with a school account (e.g., a former headteacher keeping their school login) breaks when the person changes posting and muddies the audit trail.

Provisioning chain: Omnischools creates an initial **GES Oversight super-admin** at Oversight launch (a GES national IT or M&E officer); that super-admin provisions regional directors; regional directors provision district directors within their region, or the super-admin provisions centrally. Account creation is itself an audit-logged event. Because the jurisdiction hierarchy is enforced, no Oversight user can self-elevate their own scope. Authentication uses the same mechanism as the rest of Omnischools — phone OTP or email/password via Supabase Auth — so there is no dependency on a GES national identity system.

**Federation deferred, abstraction preserved.** Ghana's GES does not today run a dependable national staff directory or SSO that a third-party SaaS could federate against. Building for a system that may not exist, or may be unreliable, is a real risk, so Oversight does not depend on one. But the auth layer is abstracted (mirroring the SMS-provider decision elsewhere in this document) so that if GES later stands up a real staff identity system, federation can be added without re-architecting the user model — the `jurisdiction_id` scoping does not change, only the credential source.

**Decision 6 · The data-access boundary · GES holds governing authority; named access is justification-gated for GES's own audit trail.** GES is the governing body of the schools Oversight observes. It has standing statutory authority to view and request school data — Oversight is an exercise of that authority, not a courtesy a school grants. This corrects an earlier framing: school data sharing with GES is **not** opt-in in the consumer sense, and GES access is **not** something a school "watches back." The boundary that matters is therefore not GES-versus-school; it is an *internal-to-GES* discipline about how broadly identifiable data is exposed within the GES hierarchy.

Two modes of access are distinguished. **Aggregate access** — counts, rates, ratios, trends, with no individual identifiable — is the default and the overwhelming majority of Oversight use; any Oversight user sees aggregates for their jurisdiction freely. **Named-record access** — an individual student's or teacher's record — is reserved for specific compliance work (Free SHS claim verification, withdrawal-anomaly investigation, statutory audit, disciplinary or safeguarding casework) and is used sparingly. Named-record access is **justification-gated and audit-logged**: the Oversight user selects or states a reason from a controlled list, and that reason, the accessing user, the jurisdiction, the record accessed, and the timestamp are written to the Oversight access &amp; audit log.

**Students and teachers are looked up differently, because GES holds different identifiers.** GES maintains the teacher establishment/payroll register, so a teacher record is found directly by **GES staff ID** (with a name search against the school's staff list as a fallback). GES holds **no student identifier** — student IDs are assigned by each school's own operational system, not by GES — so a student record cannot be looked up by ID. Instead the officer, having stated the reason and chosen the school, browses that **school's student roster**, narrowed by mandatory filters (form/class, programme, gender). Because a roster of a school's students is itself named data, it opens **only after the justification is logged** — browsing the roster is part of what the logged access authorises, not a free pre-step, and the audit entry records that a roster was browsed in addition to the record finally opened. The roster also opens **filtered, never as a full-school dump** — the officer must narrow before the list populates, so a single-record lookup exposes one class, not the whole enrolment. This is implemented in the compliance record view: a record-type selector (student / teacher) drives which lookup method is offered.

**Accountability runs upward and lateral within GES, not down to schools.** The audit log exists so that the regional and national tiers — and GES internal audit — can review what district and regional officers accessed and why. A district director's named-record pulls are visible to their regional director and to national; they are not surfaced to the schools concerned. This is the correct shape for a governing body: GES polices its own officers' use of access, the same way any government agency audits staff access to citizen records, without implying the governed institution authorises or monitors the regulator. The justification gate is retained not as a school-facing trust gesture but as GES's own internal control — it keeps named-record access deliberate, purpose-bound, and reviewable by GES leadership.

Consequently the previously-noted operational-app "what GES can see about us" school-facing trust surface is **dropped**. A school does not need a surface to monitor its regulator. (A school may still see, within its own operational app, the plain fact of which data categories GES receives — that is ordinary transparency about a statutory reporting relationship — but there is no feed of named GES officers or their individual accesses.)

**Demo jurisdiction · Wassa Amenfi West.** Oversight surfaces use a fixed demo jurisdiction the way the operational app uses St. Theresa's SHS and Achiase JHS. The anchor is the **Wassa Amenfi West Municipal District** in the **Western Region** — the real district that contains the operational app's existing SHS demo school, Asankrangwa SHS (ASANCO, founded 1960, located in Asankrangwa, the district capital). This gives genuine continuity across the two product lines: the district director in the Oversight demo oversees a school list that includes Asankrangwa SHS, and drilling into that school's detail view shows the same institution a head and teachers use in the operational demo. The district's real 2021 GSS census population (129,882) anchors the enrolment-vs-population surface with a plausible reference figure rather than an invented one. The demo district director is a named GES officer over Wassa Amenfi West; the regional tier sits over the Western Region's fourteen districts; the national tier over all sixteen regions. Other schools in the demo district list are illustrative (not all real institutions), but the jurisdiction geography itself is accurate.

**Decision 7 · Data sources &amp; provenance · Oversight is only as complete as its feeds.** Oversight's analytics database is populated from feeds of differing reliability, and the product must be honest about which is which — a director presenting figures upward needs to know their vintage and origin. The five themes break into two groups.

*School-generated, live.* Enrolment and bio, attendance, and fees come directly from schools' own operational Omnischools use. A school that records enrolment, marks attendance, and configures its fee structure in the Basic/Senior app produces these figures as a byproduct; they roll up into Oversight on the nightly analytics sync. These are the reliable feeds.

*Reference / extract-dependent.* Two themes depend on data Omnischools does not itself generate. **Examination results** (BECE, WASSCE) are held by the **West African Examinations Council (WAEC)**. WAEC exposes per-candidate results via PIN-checked portals (`eresults.waecgh.org` for BECE, `ghana.waecdirect.org` for WASSCE) and publishes only *aggregate national* statistics in press releases and Chief Examiner's reports — there is **no public school-level results dataset**. School-level results therefore reach Oversight one of two ways: the school enters or imports its own results into the operational app (then they roll up like any other school data), or GES loads an official WAEC extract into the analytics DB under a GES–WAEC data arrangement. **Teacher establishment, postings, ranks, and qualifications** are GES payroll/HR data, captured in the Ministry of Education's **EMIS personnel module**; not public, supplied to Oversight as a GES-side reference feed or surfaced up from a school's own operational staff roster.

*The school register and the coverage gap.* The authoritative list of every recognised school in a district — needed to compute the "X of Y schools reporting" coverage figure — lives in the Ministry of Education's **EMIS**, whose backbone is the **Annual School Census** collected from all public and private schools via district education offices. EMIS has historically had no public website; the openly downloadable census microdata on the Ghana Statistical Service catalogue is dated (most recent public rounds ~2012/13). For a real build, Omnischools obtains the current EMIS school register for each district through a GES data agreement / official extract and loads it as a reference table; the coverage gap is then computed as *EMIS register minus Omnischools-onboarded schools*. This is legitimate precisely because Oversight is a GES tool — GES has access to its own EMIS register.

Implication for the analytics schema (Decision 3, still deferred): the schema needs reference tables — `ges_school_register` (from EMIS), `waec_results_extract`, `ges_teacher_establishment`, and the already-noted `gss_population` — each tagged with a source and an as-of date, kept distinct from the live school-generated tables. Every Oversight surface that shows a reference-fed figure should be able to state its source and vintage; the district dashboard's provenance row and data-period banner are where this surfaces in the UI.

### PLC/CPD · architectural decisions worth preserving

Six decisions made during the PLC/CPD batch deserve durability beyond surface code:

**1. Three PLC types modelled as an enum, not three tables.** Subject-based, cross-cutting, and new-teacher PLCs share most of their data shape (sessions, attendance, agenda, focus). Modelling them as `plc_type_enum` on a single `plcs` table avoids three parallel tables and lets the schema express "this PLC" uniformly. The three types differ in business logic (attendance requirements, facilitator selection, NTC induction credit), enforced in application code, not schema.

**2. 0.5 attendance + 0.5 reflection = 1 PLC point.** The participation contract is a Omnischools design choice, not an NTC rule. NTC says PLC participation earns points; Omnischools weights half on attendance and half on a 48-hour reflection. This is configurable per school via `cpd_source_rules`, but the default is the Omnischools opinion. Modelling it as two separate `cpd_source_enum` values (PLC_ATTEND and PLC_REFLECT) means each half-point is its own append-only ledger entry — auditable, partially-syncable, individually traceable.

**3. CPD points ledger is append-only.** No row in `cpd_points_ledger` is ever updated or deleted. If a point needs to be reversed (e.g., NTC rejects an entry post-sync), a compensating negative entry is appended. This matches the audit pattern used throughout Omnischools (discounts, dues, fee changes) and survives any regulator audit of historical state.

**4. NTC portal is the source of truth for licence decisions; Omnischools is the operational ledger.** Every ledger entry carries a `ntc_sync_status` and is either QUEUED, SYNCED, FAILED, or SKIPPED. The monthly reconciliation step pulls the NTC's current state of cumulative points and diffs against Omnischools. Drift is caught within a month, not within a year. When Omnischools and NTC disagree, NTC wins by definition.

**5. NTC sync retries 3 times then locks for manual intervention.** Prevents infinite loops on schema mismatches or rejected entries. Each failed entry records its error code, attempt count, and resolution path. Manual override is audit-logged with an actor and reason.

**6. The school-wide PLC cadence default.** All PLCs at a given school meet at the same Friday afternoon hour by default, making the time protectable (no classes, no admin meetings, no parent calls). Per-PLC override is supported via `plcs.cadence_override_json`, but the default forces school-wide alignment. Soft-enforced in scheduling logic.

### Forms/PTA · architectural decisions worth preserving

Five decisions made during the Forms/PTA batch deserve durability beyond surface code:

**1. PTA dues live as a separate fee category (`PTA_DUES`), not as a tag on tuition.** Different accountability (parent Treasurer vs school bursar), different audit chains (PTA AGM vs GES financial audit), different spend governance (resolution-driven vs Headmaster-directed). This costs one extra category enum value and a separate dues-invoice table but prevents permission and audit ambiguity that would have been expensive to retrofit. The `fee_categories` reference table should include `TUITION`, `BOARDING`, `FEEDING`, `EXAM`, `PTA_DUES`, `OTHER`.

**2. PTA dues changes are forward-only with mandatory reason.** Pattern: an admin edits the dues amount, the new amount is appended to `pta_dues_config_history` with `effective_from` date and `change_reason` text. Existing `pta_dues_invoices` are not retroactively modified. New invoices use the new amount. This matches the existing discount-management pattern in Omnischools and the same audit ergonomics apply.

**3. Two parallel attendance registers (teachers + parents) at every PTA meeting.** Same `pta_attendance` table, distinguished by `attendee_type`. GES reports parent attendance rate and teacher participation rate as separate compliance metrics; combining them into one register would lose the distinction. UI displays them side by side in the meeting register surface.

**4. Multi-hat officer assignments are first-class.** A single parent can hold concurrent PTA officer roles at multiple tiers (e.g., Form PTA member + House PTA Vice-Chair + General PTA Treasurer). The `pta_officers` table doesn't unique-constrain on person_id; the matrix surface makes multi-hat visible without preventing it.

**5. Four tiers are non-negotiable in the data model, optional in school config.** The `pta_tier_enum` always has all four values; the `pta_tiers_config.active` flag determines which a given school is actually running. A school can switch tiers on/off without schema migration, and Oversight reporting can compare schools regardless of which subset they activate.

### Auth — Supabase Auth (phone OTP + email/password)

The design has been clear: parents are phone-primary (basic phones, SMS OTP), admins/teachers are email-primary. Supabase Auth supports both natively. SMS OTP routes through Supabase's MessageBird/Twilio gateway by default — for Ghana you'll override this to use Hubtel for cost reasons (about 1/3 the price per SMS).

**The flow:**
- Admin creates account with email + password
- Admin invites parent via SMS link sent through Hubtel (not Supabase's default)
- Parent clicks link, completes OTP verification, links to their child(ren)
- Student-code fallback for parents who lose their invite link (per the design spec)

2FA: TOTP for admins (Supabase Auth has this), encouraged but not required for teachers, not surfaced for parents in MVP1.

### SMS — Hubtel primary, abstract behind an interface

Hubtel is Ghanaian, integrates with all three mobile networks (MTN, Telecel, AirtelTigo), and is the same provider you'll use for payments later. Pricing is roughly GHS 0.06 per SMS — meaningfully cheaper than international providers.

**Build the SMS layer behind an interface:**

```ts
interface SMSGateway {
  send(to: string, message: string): Promise<SMSResult>
  sendBulk(messages: SMSPayload[]): Promise<BulkSMSResult>
}

class HubtelGateway implements SMSGateway { /* ... */ }
class AfricasTalkingGateway implements SMSGateway { /* fallback */ }
```

When Hubtel has issues (it will, occasionally), flip the env var to Africa's Talking. The application code doesn't change.

### Payments — design has decided this

Per existing design decisions: manual MoMo recording for MVP1 (admin enters the parent's transaction confirmation), Hubtel aggregator integration for MVP2 (automated reconciliation with parent paying directly into a Hubtel-hosted account that maps to school account).

Build the payment layer with a similar interface pattern — `ManualPaymentRecorder` and `HubtelAggregatorWebhook` both produce the same `PaymentEvent` that flows into the billing module.

### Offline — defer to MVP2, but design for it now

The offline-mode surface we designed maps to:
- **Service worker** registered via [Workbox](https://developer.chrome.com/docs/workbox/) — handles caching, background sync
- **IndexedDB** for local cache (via [Dexie](https://dexie.org/) or raw API)
- **Background Sync API** for queued writes when connection returns
- **Conflict resolution UI** at the application layer when the queue can't auto-merge

You don't build any of this for MVP1. But **make sure your data model and API design don't assume online**. Specifically: receipt numbers should come from a server-allocated pool (so offline cash recording can reserve numbers locally without duplicates), and every mutation should be idempotent (so retried sync doesn't duplicate).

### Hosting & latency — be honest about Ghana

Ghanaian fiber to London is ~120ms. To US East ~150ms. To Cape Town ~80ms. There is no major hosted-Postgres provider with a Cape Town region.

**The realistic choice:**
- Database in Supabase EU-West-2 (London) — ~120ms RTT from Accra
- App on Vercel — edge-cached static assets globally, dynamic routes still hit the origin
- For the first 50 schools, this is fine. App responsiveness is acceptable; nothing is real-time.

**For higher scale or sensitive perf:**
- Self-host Postgres on Cape Town (~$120/mo for a managed VPS)
- Or use AWS RDS in `af-south-1` with read replicas
- This is a year-2 problem, not an MVP1 problem.

### Domain & SSL

Get `omnischools.gh` and `*.omnischools.gh` early. Vercel handles SSL automatically. Set up `app.omnischools.gh`, `status.omnischools.gh`, `docs.omnischools.gh`, `www.omnischools.gh` (marketing) as separate Vercel projects.

Tenant URL pattern decision:
- **Subdomain** (`ctkjhs.omnischools.gh/dashboard`) — feels like "their app"
- **Path** (`omnischools.gh/ctkjhs/dashboard`) — simpler, shared SSL cert
- Recommendation: **path-based for MVP1**, reserve subdomain feature for MVP2/MVP3 as a paid tier ("custom domain" or "white-label").

### Email — Resend

Cheaper than Postmark, simpler API, decent deliverability for Ghana. For trust-sensitive emails (password reset, archive download links), email is the secondary channel — SMS is primary for parents.

### Monitoring & status

- **Sentry** — error tracking. Free tier covers MVP1.
- **PostHog** — product analytics. Self-hosted option if data sovereignty matters; cloud is fine to start.
- **BetterStack** (formerly Better Uptime) — status page + uptime monitoring. ~$20/mo. **Critical:** host the status page on a different provider than the main app, so it survives when Omnischools is down.

---

## What to do in week 0 — before any feature work

This is the unsexy week that determines whether sprints 1–4 go smoothly.

1. **Buy the domain.** `omnischools.gh` and any close variants. Also reserve `oversight.omnischools.gh` subdomain for the future Oversight tier app.
2. **Create accounts:** Vercel, Supabase (Pro from day 1, $25/mo — free tier hides issues you'll hit later), GitHub (private repo), Resend, Sentry, PostHog, BetterStack, Hubtel (developer account).
3. **Set up the repo.** `apps/web` (Next.js · operational app · Basic + Senior + Multi-tier), `apps/oversight` (placeholder Next.js, build out when Oversight phase starts), `apps/marketing` (Astro), `packages/db` (Drizzle schema · operational), `packages/analytics-db` (Drizzle schema · analytics, scaffold only for MVP1), `packages/ui` (shadcn-based components shared across all apps), `packages/tokens` (the `design-tokens.json` and `design-tokens.css`).
4. **Write the multi-tenancy migration first.** Every table has `school_id`. Every RLS policy is in place. Test that a query in Tenant A's session genuinely cannot see Tenant B's data, even with a SQL injection attempt. **Get this test green before sprint 1.**
5. **Add the `school_type` enum and the Senior-tier nullable columns to the initial migration**, even though Senior is post-MVP1. The columns being there from day one means existing basic-school records won't need backfilling when Senior launches. Same for the Oversight-readiness columns (`district_id`, `region_id`, `ownership_type`) and the `ges_data_sharing_agreements` table.
6. **Seed the regions and districts reference tables** with GES's official 16 regions and ~260 districts. Source: GES public directory. Versioned snapshot in the migration. Schools fill in their district via dropdown in the Geography & ownership settings page (`schoolup-district-region-ownership.html`).
7. **Wire up auth flow end-to-end.** Email/password admin signup, phone OTP parent signup. Confirm Hubtel SMS routing works. Even with no other features, you should be able to sign up, log in, log out.
8. **Set up CI.** GitHub Actions running typecheck + tests on every PR. Vercel preview deploys per branch. No code goes to main without passing CI.
9. **Write the schema for one full module — attendance.** Use it as the reference for shape. Every other module will follow the same patterns: `school_id`, `created_at`, `created_by_user_id`, soft delete via `deleted_at`, audit-log insert via trigger.

Once those nine things are done, sprint 1 starts. Don't skip them — coming back to fix multi-tenancy after you've shipped 12 features is the kind of work that drowns SaaS startups. Same logic applies to the Senior-tier columns: adding nullable columns to a 200-school production database is a much harder operation than adding them on day zero.

---

## Things this stack does NOT include — and why

- **Redis / caching layer.** Not needed for MVP1. Postgres is fast enough for the workloads Omnischools generates.
- **Message queue (RabbitMQ, SQS).** Not needed for MVP1. Use Postgres + a simple cron-driven worker if you need async work; introduce a queue only when concurrency demands it.
- **Microservices.** Absolutely not for solo dev. Monolith with clear module boundaries.
- **Kubernetes.** No.
- **GraphQL.** Server components + Server Actions cover the same ground with less ceremony.
- **A separate native mobile app.** PWA covers MVP1, MVP2, and likely MVP3.
- **Real-time sync (Supabase Realtime).** Tempting but not needed. Polling every 30 seconds for the few surfaces that benefit (attendance live view) is simpler and cheaper.

These are all good tools that are wrong for Omnischools at this stage.

---

## Hosting cost trajectory and migration plan

The Vercel + Supabase stack is the right choice for shipping fast at MVP. It is not the right choice at 1,000 schools. The cost curve gets uncomfortable somewhere around 200 schools and painful somewhere around 500. This section documents the trigger points so future-you (or a hire) knows when to revisit, and the sequence to migrate in when the time comes.

### What the costs look like at each stage

| Stage | Schools | Vercel | Supabase | Total infra | Comment |
|---|---|---|---|---|---|
| MVP | 1–10 | $20/mo (Pro, 1 seat) | $25/mo (Pro) | ~$50/mo | Honeymoon period |
| Growth | 50 | $20–80/mo | $25–60/mo | $80–200/mo | Still fine |
| Scaling | 200 | $40–150/mo (1–2 TB bandwidth overage at $0.15/GB) | $60–150/mo | $150–400/mo | First pinch point |
| Target | 1,000 | $200–600/mo (mostly bandwidth) | $200–500/mo | $600–1,500/mo | Migrate before reaching here |

The killer cost is Vercel bandwidth: $0.15/GB after the 1 TB included in Pro. Omnischools serves a lot of bandwidth — PWA bundles to every teacher's phone, scanned paper ledgers via Path B, profile photos, receipt PDFs, parent-facing report cards. 1,000 schools means 50,000+ users actively pulling data, comfortably into overage territory. Hetzner charges roughly $1 per 100 GB of equivalent bandwidth — a 40× difference at the same workload.

### The three migration triggers, in order

**Trigger 1: Cloudflare in front of Vercel** — pull this lever as soon as you have measurable bandwidth. No code changes; configure Cloudflare as a proxy in front of `omnischools.gh`. Cloudflare caches static assets at edge, and bandwidth between users and Cloudflare doesn't count against the Vercel quota. Realistic 60–85% bandwidth reduction for an app like Omnischools where dashboards and assets are reused across users. Free tier covers most of what you need. Cloudflare also has POPs in Accra and Lagos, so end-user latency improves for actual customers. This alone probably buys 6–12 months of additional Vercel runway. Do it at ~50 schools or as soon as you see the bandwidth line on the Vercel bill go non-zero.

**Trigger 2: Hetzner + Coolify for hosting, keep Supabase** — when Vercel hits $300/month or you're at ~200 schools. A Hetzner CX31 (€9/month) running Coolify handles substantially more traffic than a $200 Vercel bill. Coolify (open-source, self-hostable) gives Vercel-like DX — push to GitHub, automatic SSL via Traefik, container management, database backups. The Hetzner Falkenstein data center sits ~100ms from Ghana, comparable to Vercel's London or Frankfurt regions. Migration is roughly a week if the app is stateless and uses environment variables properly (which it should be from day one — see the portability discipline noted in `INSTRUCTIONS_FOR_CLAUDE_CODE.md` Phase 0).

The honest warning: self-hosting means you own security. Coolify disclosed 11 critical CVEs in January 2026, three with CVSS 10.0 scores. Keeping Coolify updated is mandatory. The hybrid pattern — self-host the app, keep the database on a managed service — is the right move for a multi-tenant SaaS with student data. Don't self-host Postgres at this stage; the security responsibility for student records is bigger than the cost savings on the database tier.

**Trigger 3: Full Hetzner stack or hybrid with Neon** — when Supabase hits $300/month or you're at ~500 schools. Two paths:

- **Self-hosted Postgres on Hetzner** (separate VPS from the app, with proper streaming replication, automated `pg_dump` to Hetzner Object Storage, monitoring via Uptime Kuma + PostHog). Costs collapse to ~$30/month for the database tier but you've now taken on real DBA responsibility.
- **Neon serverless Postgres** (managed, generous free tier, scales to zero, pay for compute time). Keeps the managed-DB convenience without Supabase's bundled-features tax. Pair with **Lucia** or **Better-Auth** as the auth library to replace Supabase Auth, and **Cloudflare R2** (S3-compatible, free egress) for storage. By this point you should have hired or have revenue to justify the engineering time for the auth migration, which is the hardest part.

At 1,000 schools on the full Hetzner stack + Cloudflare, total infra costs sit around $150–300/month — vs $1,500+/month on the original stack at the same scale.

### What's safe to lock into at any stage

The risky lock-ins are the managed services (Vercel, Supabase). The safe choices stay safe:

- **PostgreSQL itself**: never migrate away. Every migration path above keeps Postgres as the database.
- **TypeScript, Next.js, Tailwind**: industry-standard, portable, easy to hire for. No lock-in risk.
- **Drizzle**: even if you switch ORMs later, the SQL schema doesn't move. The Drizzle definitions become the documentation.
- **Hubtel for SMS**: local provider, no alternative makes sense for Ghana. Stay.
- **Resend for email**: cheap, portable, no lock-in concern.

### Things that need to be portable from day one

To keep all three migration triggers cheap to execute, the app needs to avoid Vercel- and Supabase-specific features that don't translate cleanly:

- **Don't use Vercel KV, Vercel Postgres, or Vercel Blob.** Use Supabase Storage (via the standard S3-compatible API where possible), Supabase Postgres, and your own caching layer if needed. Vercel-branded data products are pure lock-in.
- **Don't rely on Vercel ISR cache or `next/image`'s Vercel-optimised path** in ways that break when self-hosted. `next/image` works without Vercel, but configure the loader explicitly.
- **Keep auth logic in `/lib/auth/` behind an interface** so swapping Supabase Auth for Lucia or Better-Auth later is a single file's worth of work, not a full audit.
- **Storage URLs go through your own API**, not raw Supabase Storage URLs. When you migrate to R2, the URLs change but the API surface to the app does not.
- **Background jobs should be triggerable from a generic cron**, not require Vercel Cron's specific shape. The annual GES calendar ETL job, the nightly Oversight aggregation, the weekly fee-reminder SMS batch — all of these run fine on Vercel Cron today and on `pg_cron` or a Hetzner systemd timer tomorrow.

This discipline costs zero engineering time today and saves a 2-month rewrite at migration time. The amendment is now reflected in `INSTRUCTIONS_FOR_CLAUDE_CODE.md` Phase 0 as a working principle.

### What to ask for help on

You should not solo-build:
- **The multi-tenancy + RLS implementation.** Get a security-leaning Postgres consultant for one day to review your policies before any school's data goes in.
- **The payment reconciliation logic.** When MVP2 Hubtel integration arrives, get a Ghanaian fintech engineer to review for half a day.
- **The legal/compliance checklist.** Data Protection Commission registration, terms of service, privacy policy. A lawyer for one day, once.
- **The first Hetzner migration** (trigger 2 above). Get someone who has shipped self-hosted Next.js at scale to pair with you for 2–3 days. Worth more than the $1,500 it costs.

These four reviews — maybe US$2,000–4,000 total over 18 months — save the kind of mistakes that lose customer trust permanently.

---

## Resolved sub-decisions · locked defaults

Across the early-May Tier 2 (statutory completeness), Tier 3 (communications maturity), and Tier 4 (operational parity) batches, surfaces were designed with sensible defaults and a list of sub-decisions deferred for explicit sign-off. **As of 14 May 2026**, the user has accepted the proposed defaults for all but five Tier 4 items. The locked decisions below should not be re-opened without explicit reason; they are part of the build spec.

### Tier 2 · statutory completeness — locked defaults

- **Chart of accounts customisation depth.** Fixed top-level (5 income + 8 expense locked categories) with up to 5 custom additions per side. Cross-school comparability for the MoE pitch wins over full flexibility.
- **Activation segregation of duties.** Dual-control required when a school has multiple admins; solo-acknowledge path opens when there is only one admin. Built in `schoolup-activation-segregation.html`.
- **Depreciation method default.** Straight-line by default, declining-balance as an option. Sum-of-years and units-of-production not supported.
- **GES-seconded staff visibility.** Visible to all admins via a separate hero tile and footnote treatment. Not hidden from class teachers in the staff list.
- **Special needs vocabulary.** GES census-aligned five categories (Visual / Hearing / Physical / Intellectual / Speech). The vocabulary in the schema matches the form the school must submit; modern social-model framing can be considered post-MVP1.
- **Special needs teacher visibility.** Admin-only by default with explicit per-student grant for accommodation planning. Homeroom teachers do not see the special-needs roster automatically.
- **Backfill audit treatment.** Backfilled entries carry a "backfilled · admin estimate" tag. Bank-ready PDF includes them; no separate headteacher signature required per backfill batch.

### Tier 3 · communications maturity — locked defaults

- **Parent conversation history visibility.** Parents see a filtered timeline of their own conversations with the school (internal notes and system events hidden). Built in `schoolup-parent-portal-conversations.html`.
- **Scheduled-sends day-of confirmation.** Schedules fire automatically with a one-hour pre-fire notification. No manual approve-each-day step. Trades a small safety margin for the automation value that justifies the feature.
- **Conversation history retention period.** Three-layer policy: statutory records forever, financial records 7 years minimum (GRA), communications configurable. Built in `schoolup-retention-policy.html`.
- **Saved segments scope.** Shared school-wide; any admin can use any segment. The risk of one admin misusing another's filter logic is judged smaller than the friction of ownership in small schools.
- **Failed-delivery escalation.** WhatsApp-fail → SMS-fall is automatic and visible in the delivery view. After SMS also fails, the row stays as "Failed all" until admin acts on it; no automatic inbox notification. Inbox noise risk outweighs proactive-intervention benefit at MVP1 scale.

### Tier 4 · operational parity — locked defaults

- **Admin editing own audit notes.** Append-only, no edits permitted. Anyone can append; nobody can rewrite history. Matches the audit pattern elsewhere in the system.
- **Co-signing threshold for bulk operations.** Voids over 10 records require co-sign. Single threshold applied to voids; other bulk operations remain single-admin.
- **Custom query sharing.** Saved queries are admin-private; no sharing across admins.
- **Archive password recovery.** Re-request a fresh archive — the old one expires. No password reset on existing archives.
- **Re-download retention window.** 90 days, configurable per school.
- **Admin self-service 2FA disable.** Not permitted. Disabling requires Omnischools support to verify the school's identity through MoE channels. Protects against compromised admin sessions.
- **2FA recovery code count and format.** 10 codes, 8-digit groups. Printable on a school-stamp template for the trusted-documents folder.
- **2FA trusted device duration.** 30 days. Phone re-prompts after that window.
- **2FA SMS OTP fallback rails.** Same SMS rails as the rest of the system. No separate "security SMS" rail; same costs.

### Tier 4 · still open · zero sub-decisions

All five Tier 4 sub-decisions are now resolved. Closure dates:

1. ~~**Audit anomaly detection.**~~ Resolved 15 May 2026 — rule-based heuristics for MVP1/MVP2, ML deferred to MVP3+ as explainable suggestion layer. See "Audit anomaly detection · architectural decision worth preserving" above.
2. ~~**Audit retention alignment.**~~ Resolved 15 May 2026 — audit rows append-only and retained indefinitely; PII fields tombstoned at underlying record's retention horizon. See "Audit retention · architectural decision worth preserving" above.
3. ~~**Bulk operations scheduling.**~~ Resolved 15 May 2026 — schedulable; unified scheduler shared with reminder series under one `scheduled_jobs` table. See "Bulk operations scheduling · architectural decision worth preserving" above.
4. ~~**Bulk undo window and policy.**~~ Resolved 15 May 2026 — three-tier model locked (Tier A 60min / Tier B 24hr / Tier C 7day + co-sign), atomic batch undo at every tier. See "Bulk undo tiers · architectural decision worth preserving" above.
5. ~~**PII export approval flow.**~~ Resolved 15 May 2026 — two-stage approval (Headteacher + DPO for record-level), single-use, 7-day expiry. See "PII export approval flow · architectural decision worth preserving" above.

The build spec is now complete on the Tier 4 axis. The next decision frontier is the Omnischools Oversight product line (district/regional/national surfaces over the analytics database).

---

*Last updated: 15 May 2026 · all five Tier 4 sub-decisions resolved · five new architectural-decision sections + cross-cutting schema additions for audit/anomaly/scheduling/bulk-undo/PII-export*
*Sub-decisions resolved/flagged: 15 May 2026 · 22 of 22 reviewed, 22 locked, 0 still open*
