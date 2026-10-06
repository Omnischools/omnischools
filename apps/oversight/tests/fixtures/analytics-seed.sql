-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- ANALYTICS FIXTURES — the jurisdiction spine, the EMIS register, the GES establishment register
-- (one FRESH vintage and one STALE one), and a facilities census row for the non-gated C5 drill.
--
-- Five schools, each existing to make exactly one branch of the gate reachable:
--   EMIS-PUB-001  PUBLIC,  fresh establishment, consent GRANTED   → statutory AND consent both pass
--   EMIS-PUB-002  PUBLIC,  fresh establishment, NO consent row    → DENIED_NO_CONSENT
--   EMIS-PRI-003  PRIVATE, fresh establishment, consent GRANTED   → flag-off denial (and only that)
--   EMIS-PUB-004  PUBLIC,  STALE establishment, NO consent row    → DENIED_STALE_ESTABLISHMENT
--   EMIS-PUB-005  PUBLIC,  fresh establishment, consent REVOKED   → DENIED_NO_CONSENT (revoked)
--   EMIS-UNK-006  ownership_type NULL, consent GRANTED            → UNKNOWN_OWNERSHIP (fails closed)
--   EMIS-PRI-007  PRIVATE, NO consent row                         → refused with the flag ON too
--   EMIS-OUT-008  PUBLIC, in the OTHER DISTRICT, consent GRANTED  → the jurisdiction-ceiling probe
--   EMIS-UNM-009  PUBLIC, register operational_school_id IS NULL  → drill-down refused (AC-1.6)
--
-- The statutory branch is keyed on the NTC LICENCE carried by the operational staff row, matched
-- against establishment_teachers[].ntc_licence_number of the max-as_of_date vintage. EMIS-PRI-003
-- carries TWO establishment entries so a private-school GES teacher is statutory even with the flag
-- OFF (AC-3.10), and a name that disagrees with the operational row demotes to consent (OC-NTC-RESIDUAL).
--
-- The last three exist because a security test has to be able to fail for exactly one reason.
-- EMIS-UNK-006 and EMIS-OUT-008 both HAVE live consent, so a refusal there can only be the missing
-- ownership or the ceiling; EMIS-PRI-007 has none, so a refusal there with the flag ON can only be
-- the absent consent. Previously two of these cases were simulated by having the caller LIE about
-- the school's ownership — which stopped being possible once the gate started reading ownership
-- from the register itself, and was never a good test of a real data gap anyway.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

insert into dim_jurisdiction (jurisdiction_id, level, parent_id, name, ges_code, school_type, ownership_type, is_reporting) values
  ('10000000-0000-4000-8000-000000000001', 'NATIONAL', null,                                   'Ghana',                null, null, null, false),
  ('10000000-0000-4000-8000-000000000002', 'REGION',   '10000000-0000-4000-8000-000000000001', 'Western Region',       null, null, null, false),
  ('10000000-0000-4000-8000-000000000003', 'DISTRICT', '10000000-0000-4000-8000-000000000002', 'Wassa Amenfi West',    null, null, null, false),
  ('10000000-0000-4000-8000-000000000004', 'DISTRICT', '10000000-0000-4000-8000-000000000002', 'Sekondi-Takoradi Metro', null, null, null, false),
  ('10000000-0000-4000-8000-000000000011', 'SCHOOL',   '10000000-0000-4000-8000-000000000003', 'Asankrangwa SHS',      'EMIS-PUB-001', 'SHS', 'PUBLIC',  true),
  ('10000000-0000-4000-8000-000000000012', 'SCHOOL',   '10000000-0000-4000-8000-000000000003', 'Amenfiman SHS',        'EMIS-PUB-002', 'SHS', 'PUBLIC',  true),
  ('10000000-0000-4000-8000-000000000013', 'SCHOOL',   '10000000-0000-4000-8000-000000000003', 'St. Monica Mission SHS','EMIS-PRI-003','SHS', 'PRIVATE', true),
  ('10000000-0000-4000-8000-000000000014', 'SCHOOL',   '10000000-0000-4000-8000-000000000003', 'Wassa Akropong JHS',   'EMIS-PUB-004', 'JHS', 'PUBLIC',  true),
  ('10000000-0000-4000-8000-000000000015', 'SCHOOL',   '10000000-0000-4000-8000-000000000003', 'Manso Amenfi JHS',     'EMIS-PUB-005', 'JHS', 'PUBLIC',  true),
  ('10000000-0000-4000-8000-000000000016', 'SCHOOL',   '10000000-0000-4000-8000-000000000003', 'Nkwanta Community JHS','EMIS-UNK-006', 'JHS', null,      true),
  ('10000000-0000-4000-8000-000000000017', 'SCHOOL',   '10000000-0000-4000-8000-000000000003', 'Bethel Academy',       'EMIS-PRI-007', 'JHS', 'PRIVATE', true),
  -- In Sekondi-Takoradi Metro: OUTSIDE a Wassa Amenfi West officer's subtree.
  ('10000000-0000-4000-8000-000000000018', 'SCHOOL',   '10000000-0000-4000-8000-000000000004', 'Takoradi SHS',         'EMIS-OUT-008', 'SHS', 'PUBLIC',  true),
  -- In the officer's district, PUBLIC, but its register row has NO operational_school_id: the
  -- individual drill-down must be REFUSED (AC-1.6), never resolved against a guessed tenant.
  ('10000000-0000-4000-8000-000000000019', 'SCHOOL',   '10000000-0000-4000-8000-000000000003', 'Diaso Community JHS',  'EMIS-UNM-009', 'JHS', 'PUBLIC',  true);

-- Two CURRENT rows for the same academic year, deliberately: the TERM row the term-grain facts hang
-- off, and the derived ANNUAL cut that fact_infrastructure is grained to since the re-grain. This is
-- the shape the ETL actually produces (see the `is_current` warning in db/schema/dim.ts), so the
-- fixture carries it rather than a tidier one-period world the app will never see.
-- …and the SITTING COHORT of the 2026 BECE/WASSCE (task H14): `period_type = 'EXAM_COHORT'`, `term IS
-- NULL`, academic_year "(N-1)/N" for sitting year N, and `is_current = false` — a sitting is a CLOSED,
-- immutable cohort, and marking one current would make an `is_current` lookup that forgot to pin
-- `period_type` match three rows for one year (see the warning in db/schema/dim.ts). It shares the
-- academic_year of the ANNUAL row above on purpose: that is exactly the collision a period lookup has to
-- survive, and `period_type` is the only thing that separates them.
insert into dim_period (period_id, academic_year, term, period_type, starts_on, ends_on, is_current) values
  ('20000000-0000-4000-8000-000000000001', '2025/26', 2,    'TERM',        null, null, true),
  ('20000000-0000-4000-8000-000000000002', '2025/26', null, 'ANNUAL',      null, null, true),
  ('20000000-0000-4000-8000-000000000003', '2025/26', null, 'EXAM_COHORT', '2026-05-04', '2026-06-26', false);

-- operational_school_id maps each EMIS school to its operational tenant uuid (apps/web ref_school.id
-- = the OPS_SCHOOL.* constants). EMIS-UNM-009 is deliberately UNMAPPED (NULL) — the drill-down gate
-- must refuse it (AC-1.6) rather than fall back to any request-supplied uuid.
insert into ref_emis_school_register (emis_school_id, name, district_id, region_id, school_type, ownership_type, on_schoolup, operational_school_id, source, as_of_date) values
  ('EMIS-PUB-001', 'Asankrangwa SHS',       '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 'SHS', 'PUBLIC',  true, '30000000-0000-4000-8000-000000000001', 'EMIS_EXTRACT', current_date - 30),
  ('EMIS-PUB-002', 'Amenfiman SHS',         '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 'SHS', 'PUBLIC',  true, '30000000-0000-4000-8000-000000000002', 'EMIS_EXTRACT', current_date - 30),
  ('EMIS-PRI-003', 'St. Monica Mission SHS','10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 'SHS', 'PRIVATE', true, '30000000-0000-4000-8000-000000000003', 'EMIS_EXTRACT', current_date - 30),
  ('EMIS-PUB-004', 'Wassa Akropong JHS',    '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 'JHS', 'PUBLIC',  true, '30000000-0000-4000-8000-000000000004', 'EMIS_EXTRACT', current_date - 30),
  ('EMIS-PUB-005', 'Manso Amenfi JHS',      '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 'JHS', 'PUBLIC',  true, '30000000-0000-4000-8000-000000000005', 'EMIS_EXTRACT', current_date - 30),
  -- ownership_type NULL: the register has the school but not its ownership. Fails closed.
  ('EMIS-UNK-006', 'Nkwanta Community JHS', '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 'JHS', null,      true, '30000000-0000-4000-8000-000000000006', 'EMIS_EXTRACT', current_date - 30),
  ('EMIS-PRI-007', 'Bethel Academy',        '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 'JHS', 'PRIVATE', true, '30000000-0000-4000-8000-000000000007', 'EMIS_EXTRACT', current_date - 30),
  -- district_id = Sekondi-Takoradi Metro, so ov_in_subtree() filters it away for a Wassa officer.
  ('EMIS-OUT-008', 'Takoradi SHS',          '10000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000002', 'SHS', 'PUBLIC',  true, '30000000-0000-4000-8000-000000000008', 'EMIS_EXTRACT', current_date - 30),
  -- operational_school_id NULL: registered, in the officer's subtree, but not mapped to a tenant.
  ('EMIS-UNM-009', 'Diaso Community JHS',   '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 'JHS', 'PUBLIC',  true, null,                                   'EMIS_EXTRACT', current_date - 30);

-- FRESH vintages — 30 days old, comfortably inside the 6-month staleness ceiling. establishment_teachers
-- is an array of { ntc_licence_number, name? }; membership-by-NTC (over the max-as_of_date vintage) is
-- the whole statutory test. The optional `name` is a GES display aid the gate cross-checks (OC-NTC-RESIDUAL).
insert into ref_ges_teacher_establishment (establishment_id, emis_school_id, teaching_posts_established, establishment_teachers, source, as_of_date) values
  ('80000000-0000-4000-8000-000000000001', 'EMIS-PUB-001', 42, '[{"ntc_licence_number":"NTC-2019-004417","name":"Ama Boateng"}]'::jsonb, 'GES_ESTABLISHMENT', current_date - 30),
  ('80000000-0000-4000-8000-000000000002', 'EMIS-PUB-002', 38, '[]'::jsonb, 'GES_ESTABLISHMENT', current_date - 30),
  -- Two entries: one whose GES name MATCHES the operational row (statutory), one whose name DISAGREES
  -- (the OC-NTC-RESIDUAL cross-check demotes it to consent + raises an anomaly).
  ('80000000-0000-4000-8000-000000000003', 'EMIS-PRI-003', 12, '[{"ntc_licence_number":"NTC-PRI-003-STAT","name":"Kofi Adomako"},{"ntc_licence_number":"NTC-PRI-003-MISMATCH","name":"Kwabena Otchere"}]'::jsonb, 'GES_ESTABLISHMENT', current_date - 30),
  ('80000000-0000-4000-8000-000000000005', 'EMIS-PUB-005', 21, '[]'::jsonb, 'GES_ESTABLISHMENT', current_date - 30);

-- STALE vintage — 400 days old. It NAMES NTC-2015-000981, and must still refuse the statutory branch:
-- the subject falls through to consent, the school has none, and the access is denied.
insert into ref_ges_teacher_establishment (establishment_id, emis_school_id, teaching_posts_established, establishment_teachers, source, as_of_date) values
  ('80000000-0000-4000-8000-000000000004', 'EMIS-PUB-004', 19, '[{"ntc_licence_number":"NTC-2015-000981","name":"Abena Asare"}]'::jsonb, 'GES_ESTABLISHMENT', current_date - 400);

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- OFFICER DIRECTORY (increment G) — the tier matrix the bootstrap read has to get right.
--
-- ⚠ THIS FILE MUST BE APPLIED AS A SINGLE TRANSACTION. The five directory rows and their five audit
-- rows are separate statements, and that only satisfies the deferred S1 coupling guard
-- (ov_officer_directory_audit_guard) because tests/setup/global-setup.ts hands the WHOLE file to
-- postgres.js `unsafe()` as one implicit transaction — one transaction_timestamp(), which is the
-- value the guard matches audit_officer_provisioning.occurred_at against at COMMIT. Split this file
-- statement-by-statement (the way global-setup splits MIGRATIONS on `--> statement-breakpoint`) and
-- the very first directory insert fails with the coupling error: each statement would be its own
-- transaction, so no audit row ever shares a timestamp with its directory row.
--
-- officer_id IS the Supabase auth uid (Kofi AC14): the same value that becomes
-- OfficerSession.officerId, that withJurisdiction() writes to app.current_officer, and that lands in
-- audit_access_log.officer_id. The two 6000…-0001/0002 uids are the SAME officers the pre-existing
-- §6 gate tests already act as (tests/fixtures/ids.ts OFFICER.districtId / OFFICER.nationalId), so
-- those rows now have a directory entry to resolve from instead of an identity invented by the test.
--
-- There is deliberately NO `level` column to seed: the tier is derived from the joined
-- dim_jurisdiction.level (Kofi R2/AC10), which is what the matrix below actually exercises.
--
--   6000…0001  DISTRICT   Wassa Amenfi West   active        → DISTRICT_OVERSIGHT
--   6000…0002  NATIONAL   Ghana               active        → NATIONAL_OVERSIGHT  (national #1)
--   6000…0003  NATIONAL   Ghana               active        → NATIONAL_OVERSIGHT  (national #2 —
--              two of them, so "exactly one row for a uid" is a real claim and not an artefact of
--              there being only one national officer to find)
--   6000…0004  REGION     Western Region      active        → REGIONAL_OVERSIGHT
--   6000…0005  DISTRICT   Sekondi-Takoradi    is_active=f   → resolves to ZERO rows
--   6000…00ff  —          (no row at all)                   → resolves to ZERO rows
--
-- The deactivated officer and the unprovisioned uid are indistinguishable through
-- ov_resolve_officer() by design: both are "no session", and the function is not an account-state
-- oracle. Note 6000…0005 sits in the OTHER district, so a test that accidentally resolved them would
-- also be crossing the jurisdiction ceiling — two failures for the price of one assertion.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

insert into ref_oversight_officer (officer_id, jurisdiction_id, officer_role, is_active, full_name, work_email, source, as_of_date) values
  ('60000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'DISTRICT_OVERSIGHT', true,  'Akua Mensah',   'akua.mensah@ges.gov.gh',   'GES_HR_DIRECTORY', current_date - 60),
  ('60000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'NATIONAL_OVERSIGHT', true,  'Yaw Darko',     'yaw.darko@moe.gov.gh',     'GES_HR_DIRECTORY', current_date - 60),
  ('60000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'NATIONAL_OVERSIGHT', true,  'Efua Owusu',    'efua.owusu@moe.gov.gh',    'GES_HR_DIRECTORY', current_date - 45),
  ('60000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000002', 'REGIONAL_OVERSIGHT', true,  'Kwesi Appiah',  'kwesi.appiah@ges.gov.gh',  'GES_HR_DIRECTORY', current_date - 30),
  -- Offboarded: the row STAYS (audit attribution must survive offboarding) but resolves to nothing.
  ('60000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000004', 'DISTRICT_OVERSIGHT', false, 'Abena Tetteh',  'abena.tetteh@ges.gov.gh',  'GES_HR_DIRECTORY', current_date - 400);

-- A provisioning history for the matrix above. The two NATIONAL grants and the REGION grant carry an
-- approver (the two-person rule, ck_officer_provisioning_two_person); the DISTRICT one does not, and
-- must still insert. The DEACTIVATE row is what offboarding looks like in the log.
insert into audit_officer_provisioning
  (action, actor_id, approver_id, target_officer_id, target_jurisdiction_id, target_tier,
   role_before, role_after, active_before, active_after, reason) values
  ('PROVISION',  '90000000-0000-4000-8000-000000000001', null,
   '60000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'DISTRICT',
   null, 'DISTRICT_OVERSIGHT', null, true, 'GES posting letter WAW/2026/011 — district director'),
  ('PROVISION',  '90000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000002',
   '60000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'NATIONAL',
   null, 'NATIONAL_OVERSIGHT', null, true, 'MoE directive 2026/04 — national oversight desk'),
  ('PROVISION',  '90000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000002',
   '60000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'NATIONAL',
   null, 'NATIONAL_OVERSIGHT', null, true, 'MoE directive 2026/05 — national oversight desk'),
  ('PROVISION',  '90000000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000001',
   '60000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000002', 'REGION',
   null, 'REGIONAL_OVERSIGHT', null, true, 'Western Region deputy director posting'),
  ('DEACTIVATE', '90000000-0000-4000-8000-000000000001', null,
   '60000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000004', 'DISTRICT',
   'DISTRICT_OVERSIGHT', 'DISTRICT_OVERSIGHT', true, false, 'Transferred out of GES oversight — offboarded');

-- ---- FIXTURE SELF-CHECKS: the write-side guards must actually refuse ---------------------------
--
-- These run as the OWNER, which is the only role that can write these tables at all — and that is
-- the point. Owners bypass RLS but NOT triggers or CHECKs, so this asserts the guards hold against
-- the most privileged writer there is. If a future change loses one of them, global-setup fails
-- loudly here, before any test runs, rather than the suite passing against a schema that no longer
-- enforces Kofi R1 / the two-person rule.
do $$
begin
  -- 1 · NO SCHOOL-TIER OFFICER (Kofi R1). jurisdiction 10000000-…-0011 is a SCHOOL node.
  begin
    insert into ref_oversight_officer (officer_id, jurisdiction_id, officer_role, as_of_date)
    values ('6fffffff-0000-4000-8000-0000000000f1', '10000000-0000-4000-8000-000000000011',
            'DISTRICT_OVERSIGHT', current_date);
    raise exception 'FIXTURE SELF-CHECK FAILED: a SCHOOL-node officer was accepted (Kofi R1 guard lost)';
  exception when others then
    if sqlerrm not like '%SCHOOL-tier oversight officer%' then raise; end if;
  end;

  -- 2 · ROLE MUST MATCH THE NODE'S DERIVED TIER. A district node cannot hold a national post.
  begin
    insert into ref_oversight_officer (officer_id, jurisdiction_id, officer_role, as_of_date)
    values ('6fffffff-0000-4000-8000-0000000000f2', '10000000-0000-4000-8000-000000000003',
            'NATIONAL_OVERSIGHT', current_date);
    raise exception 'FIXTURE SELF-CHECK FAILED: officer_role/tier mismatch was accepted';
  exception when others then
    if sqlerrm not like '%contradicts the%' then raise; end if;
  end;

  -- 3 · TWO-PERSON RULE: a NATIONAL grant with no approver must be refused.
  begin
    insert into audit_officer_provisioning
      (action, actor_id, approver_id, target_officer_id, target_jurisdiction_id, target_tier,
       role_after, active_after, reason)
    values ('PROVISION', '90000000-0000-4000-8000-000000000001', null,
            '6fffffff-0000-4000-8000-0000000000f3', '10000000-0000-4000-8000-000000000001',
            'NATIONAL', 'NATIONAL_OVERSIGHT', true, 'no approver — must fail');
    raise exception 'FIXTURE SELF-CHECK FAILED: an unapproved NATIONAL grant was accepted';
  exception when others then
    if sqlerrm not like '%ck_officer_provisioning_two_person%' then raise; end if;
  end;

  -- 4 · AND THE TIER IT KEYS ON IS NOT FORGEABLE: claiming DISTRICT for a NATIONAL node (which would
  --     dodge check 3 entirely) is refused by the tier guard.
  begin
    insert into audit_officer_provisioning
      (action, actor_id, approver_id, target_officer_id, target_jurisdiction_id, target_tier,
       role_after, active_after, reason)
    values ('PROVISION', '90000000-0000-4000-8000-000000000001', null,
            '6fffffff-0000-4000-8000-0000000000f4', '10000000-0000-4000-8000-000000000001',
            'DISTRICT', 'NATIONAL_OVERSIGHT', true, 'forged tier — must fail');
    raise exception 'FIXTURE SELF-CHECK FAILED: a forged target_tier was accepted (two-person rule bypassable)';
  exception when others then
    if sqlerrm not like '%does not match dim_jurisdiction.level%' then raise; end if;
  end;

  -- 5 · APPEND-ONLY: the provisioning log cannot be rewritten, even by the owner.
  begin
    update audit_officer_provisioning set reason = 'rewritten';
    raise exception 'FIXTURE SELF-CHECK FAILED: audit_officer_provisioning accepted an UPDATE';
  exception when others then
    if sqlerrm not like '%append-only%' then raise; end if;
  end;
end $$;

-- Facilities census for the NON-GATED C5 drill. The analytics fact carries no `captured_by` and no
-- `caterer_name` at all — the ETL never brings them across — which is the structural floor under
-- the query-boundary exclusion in lib/oversight/infrastructure.ts.
--
-- On the ANNUAL period (…0002), not the TERM one: this fact is ANNUAL grain, and the read path pins
-- `dp.period_type = 'ANNUAL'`.
insert into fact_infrastructure (
  jurisdiction_id, period_id, schools_reporting,
  classrooms_total, classrooms_good, classrooms_repair,
  latrines_boys, latrines_girls, latrines_staff,
  student_desks_usable, student_desks_broken, teacher_desks, chalkboards, whiteboards, projectors,
  computers_total, computers_working, library_book_count,
  has_electricity_count, has_water_count, has_handwashing_count, has_library_count,
  has_ict_lab_count, has_internet_count, gsfp_participating_count, has_kitchen_count,
  water_borehole_count, water_pipe_count, water_well_count, water_none_count,
  electricity_grid_count, electricity_solar_count, electricity_generator_count, electricity_none_count,
  latrine_wc_count, latrine_kvip_count, latrine_pit_count, latrine_none_count,
  computers_reporting_count, library_books_reporting_count, furniture_reporting_count,
  source, as_of_date
) values (
  '10000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000002', 1,
  24, 18, 6,
  6, 8, 2,
  480, 35, 24, 24, 2, 1,
  30, 22, 1450,
  1, 1, 1, 1,
  1, 0, 1, 1,
  1, 0, 0, 0,
  1, 0, 0, 0,
  0, 1, 0, 0,
  1, 1, 1,
  'OPERATIONAL_AGG', now() - interval '30 days'
);

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TIER-MATRIX FIXTURES (increment G runtime) — rows on BOTH sides of the district boundary.
--
-- Everything above seeds the §6 gate, which only ever needed data inside ONE district (plus the
-- single out-of-subtree school used as the ceiling probe). Proving the RLS tier matrix — "each tier
-- sees exactly its subtree, across dim / fact / ref / audit" — needs the opposite shape: comparable
-- rows in Wassa Amenfi West AND in Sekondi-Takoradi Metro, so "the district officer sees 1 of 2" is
-- a measurement rather than an absence.
--
-- Why a fact table and a ref table, not just dim_jurisdiction: the predicate is written once
-- (`ov_in_subtree`) but APPLIED per table, through a different column each time —
-- `jurisdiction_id` on fact_*, `district_id` on ref_gss_population, a join through the register for
-- the establishment extract. A policy attached to the wrong column, or not attached at all (a new
-- table added without its policy), is invisible to a test that only reads the spine.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

insert into dim_stage (stage, official_age_low, official_age_high, display_order) values
  ('JHS', 12, 14, 3)
on conflict (stage) do nothing;

-- fact_enrolment: one school row in EACH district. Headcounts differ so a leak is identifiable by
-- value, not only by count.
insert into fact_enrolment (jurisdiction_id, period_id, stage, class_form, sex, headcount, source, as_of_date) values
  ('10000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000001', 'JHS', null, 'ALL', 410, 'OPERATIONAL_AGG', now()),
  ('10000000-0000-4000-8000-000000000018', '20000000-0000-4000-8000-000000000001', 'JHS', null, 'ALL', 720, 'OPERATIONAL_AGG', now());

-- fact_staffing: one school row in EACH district, at the ANNUAL period (the staffing grain), so the
-- tier matrix exercises the policy against a NON-EMPTY table — a policy test over an empty table
-- proves nothing. The pairs are deliberately lopsided (41 teachers for 410 pupils vs 18 for 720) so a
-- leak is identifiable BY VALUE and so Σenrolment ÷ Σteachers (10.00 vs 40.00) differs visibly from
-- avg(ptr): the roll-up rule is readable straight off the fixture. The second row is PRIVATE-shaped —
-- NULL establishment and therefore NULL vacancies, never 0 (Kofi's staffing ruling §4) — so the
-- null-handling path is in the fixture rather than discovered later.
insert into fact_staffing (jurisdiction_id, period_id, teachers_on_roll, teaching_posts_established, enrolment_total, ptr, vacancies, source, as_of_date) values
  ('10000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000002', 41, 38,   410, 10.00, -3,   'OPERATIONAL_AGG', now()),
  ('10000000-0000-4000-8000-000000000018', '20000000-0000-4000-8000-000000000002', 18, null, 720, 40.00, null, 'OPERATIONAL_AGG', now());

-- fact_attendance: one school STAGE-TOTAL row (class_form null) in EACH district, on the TERM period
-- (…0001) — fact_attendance is a FLOW at TERM grain, so it hangs off the same term the enrolment rows
-- above do, NOT the ANNUAL staffing period. The two are lopsided (24000 enrolled-days @ 92% vs 43200
-- @ 87%) so a leak is identifiable BY VALUE and so the weighted Σpresent ÷ Σenrolled (59664 ÷ 67200 =
-- 88.79%) differs visibly from the unweighted mean of the two rates (89.5%): the no-averaging roll-up
-- rule is readable straight off the fixture. Both are far above the comparison engine's marking floor
-- (ATT_MIN_ENROLLED_DAYS = 2000), so each is eligible to be crowned best/worst.
insert into fact_attendance (jurisdiction_id, period_id, stage, class_form, enrolled_days, present_days, attendance_rate, source, as_of_date) values
  ('10000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000001', 'JHS', null, 24000, 22080, 92.00, 'OPERATIONAL_AGG', now()),
  ('10000000-0000-4000-8000-000000000018', '20000000-0000-4000-8000-000000000001', 'JHS', null, 43200, 37584, 87.00, 'OPERATIONAL_AGG', now());

-- ref_gss_population: scoped on `district_id`, not `jurisdiction_id` — a different column for the
-- same predicate, which is exactly the kind of difference a per-table policy gets wrong.
insert into ref_gss_population (district_id, stage, population, source, as_of_date) values
  ('10000000-0000-4000-8000-000000000003', 'JHS', 9100, 'GSS_CENSUS', current_date - 365),
  ('10000000-0000-4000-8000-000000000004', 'JHS', 15400, 'GSS_CENSUS', current_date - 365);

-- audit_access_log: one historical row per district, written as the OWNER (the only writer that can
-- place a row for an officer other than the current one). The matrix then asserts the `audit_scope`
-- policy — own rows OR subtree — rather than only the INSERT predicate that audit-insert-rls covers.
insert into audit_access_log
  (officer_id, officer_role, jurisdiction_id, reason_code, case_reference, record_type, target_ref,
   fields_released, legal_basis, outcome, staff_category)
--
-- legal_basis = CONSENT with an `OPS:` target_ref, deliberately: tests/gate.test.ts asserts a
-- WHOLE-LOG invariant (AC-3.9) that every STATUTORY row carries an `NTC:` ref and record_type
-- TEACHER, and every CONSENT row does not. A fixture row is as much part of "the whole log" as a
-- row the gate wrote, so these two have to satisfy the same shape — which is the invariant doing
-- its job.
values
  ('60000000-0000-4000-8000-000000000001', 'DISTRICT_OVERSIGHT', '10000000-0000-4000-8000-000000000011',
   'STATUTORY_AUDIT', 'CASE-MATRIX-IN', 'STAFF', 'OPS:EMIS-PUB-001:50000000-0000-4000-8000-000000000001',
   '[]'::jsonb, 'CONSENT', 'GRANTED', 'OTHER_STAFF'),
  ('60000000-0000-4000-8000-000000000005', 'DISTRICT_OVERSIGHT', '10000000-0000-4000-8000-000000000018',
   'STATUTORY_AUDIT', 'CASE-MATRIX-OUT', 'STAFF', 'OPS:EMIS-OUT-008:50000000-0000-4000-8000-000000000009',
   '[]'::jsonb, 'CONSENT', 'GRANTED', 'OTHER_STAFF');
