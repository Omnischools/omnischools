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
  ('10000000-0000-4000-8000-000000000018', 'SCHOOL',   '10000000-0000-4000-8000-000000000004', 'Takoradi SHS',         'EMIS-OUT-008', 'SHS', 'PUBLIC',  true);

insert into dim_period (period_id, academic_year, term, period_type, is_current) values
  ('20000000-0000-4000-8000-000000000001', '2025/26', 2, 'TERM', true);

insert into ref_emis_school_register (emis_school_id, name, district_id, region_id, school_type, ownership_type, on_schoolup, source, as_of_date) values
  ('EMIS-PUB-001', 'Asankrangwa SHS',       '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 'SHS', 'PUBLIC',  true, 'EMIS_EXTRACT', current_date - 30),
  ('EMIS-PUB-002', 'Amenfiman SHS',         '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 'SHS', 'PUBLIC',  true, 'EMIS_EXTRACT', current_date - 30),
  ('EMIS-PRI-003', 'St. Monica Mission SHS','10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 'SHS', 'PRIVATE', true, 'EMIS_EXTRACT', current_date - 30),
  ('EMIS-PUB-004', 'Wassa Akropong JHS',    '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 'JHS', 'PUBLIC',  true, 'EMIS_EXTRACT', current_date - 30),
  ('EMIS-PUB-005', 'Manso Amenfi JHS',      '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 'JHS', 'PUBLIC',  true, 'EMIS_EXTRACT', current_date - 30),
  -- ownership_type NULL: the register has the school but not its ownership. Fails closed.
  ('EMIS-UNK-006', 'Nkwanta Community JHS', '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 'JHS', null,      true, 'EMIS_EXTRACT', current_date - 30),
  ('EMIS-PRI-007', 'Bethel Academy',        '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 'JHS', 'PRIVATE', true, 'EMIS_EXTRACT', current_date - 30),
  -- district_id = Sekondi-Takoradi Metro, so ov_in_subtree() filters it away for a Wassa officer.
  ('EMIS-OUT-008', 'Takoradi SHS',          '10000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000002', 'SHS', 'PUBLIC',  true, 'EMIS_EXTRACT', current_date - 30);

-- FRESH vintages — 30 days old, comfortably inside the 6-month staleness ceiling.
insert into ref_ges_teacher_establishment (establishment_id, emis_school_id, teaching_posts_established, staff_ids, source, as_of_date) values
  ('80000000-0000-4000-8000-000000000001', 'EMIS-PUB-001', 42, '["GES/WR/00001"]'::jsonb, 'GES_ESTABLISHMENT', current_date - 30),
  ('80000000-0000-4000-8000-000000000002', 'EMIS-PUB-002', 38, '["GES/WR/00002"]'::jsonb, 'GES_ESTABLISHMENT', current_date - 30),
  ('80000000-0000-4000-8000-000000000003', 'EMIS-PRI-003', 12, '["GES/WR/00003"]'::jsonb, 'GES_ESTABLISHMENT', current_date - 30),
  ('80000000-0000-4000-8000-000000000005', 'EMIS-PUB-005', 21, '["GES/WR/00005"]'::jsonb, 'GES_ESTABLISHMENT', current_date - 30);

-- STALE vintage — 400 days old. It NAMES GES/WR/00004, and must still refuse the statutory branch:
-- the subject falls through to consent, the school has none, and the access is denied.
insert into ref_ges_teacher_establishment (establishment_id, emis_school_id, teaching_posts_established, staff_ids, source, as_of_date) values
  ('80000000-0000-4000-8000-000000000004', 'EMIS-PUB-004', 19, '["GES/WR/00004"]'::jsonb, 'GES_ESTABLISHMENT', current_date - 400);

-- Facilities census for the NON-GATED C5 drill. The analytics fact carries no `captured_by` and no
-- `caterer_name` at all — the ETL never brings them across — which is the structural floor under
-- the query-boundary exclusion in lib/oversight/infrastructure.ts.
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
  '10000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000001', 1,
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
