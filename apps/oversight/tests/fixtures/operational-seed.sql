-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- OPERATIONAL FIXTURES. `ges_code` on each school EQUALS its EMIS id — that equality is what
-- `confirmSchoolIdentity()` checks, and it is the only thing standing between a request-supplied
-- tenant uuid and a cross-tenant read.
--
-- Every staff member has a compensation row. None of it is readable by the read-back role, and no
-- reason code releases any of it. The rows exist so the tests are refusing something real.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

insert into ref_school (id, name, ges_code, ownership_type) values
  ('30000000-0000-4000-8000-000000000001', 'Asankrangwa SHS',        'EMIS-PUB-001', 'PUBLIC'),
  ('30000000-0000-4000-8000-000000000002', 'Amenfiman SHS',          'EMIS-PUB-002', 'PUBLIC'),
  ('30000000-0000-4000-8000-000000000003', 'St. Monica Mission SHS', 'EMIS-PRI-003', 'PRIVATE'),
  ('30000000-0000-4000-8000-000000000004', 'Wassa Akropong JHS',     'EMIS-PUB-004', 'PUBLIC'),
  ('30000000-0000-4000-8000-000000000005', 'Manso Amenfi JHS',       'EMIS-PUB-005', 'PUBLIC'),
  ('30000000-0000-4000-8000-000000000006', 'Nkwanta Community JHS',  'EMIS-UNK-006', 'PUBLIC'),
  ('30000000-0000-4000-8000-000000000007', 'Bethel Academy',         'EMIS-PRI-007', 'PRIVATE'),
  ('30000000-0000-4000-8000-000000000008', 'Takoradi SHS',           'EMIS-OUT-008', 'PUBLIC');

-- ⚠ Note EMIS-UNK-006: the OPERATIONAL row says PUBLIC while the GES register says nothing. The
-- gate reads ownership from the REGISTER, so it fails closed on UNKNOWN_OWNERSHIP — a school's own
-- record of what it is must not be able to move the line the non-public flag draws.

insert into ref_user (id, phone, email, full_name) values
  ('40000000-0000-4000-8000-000000000001', '+233200000001', 'a.boateng@example.gh',  'Ama Boateng'),
  ('40000000-0000-4000-8000-000000000002', '+233200000002', 'k.mensah@example.gh',   'Kojo Mensah'),
  ('40000000-0000-4000-8000-000000000003', '+233200000003', 'e.darko@example.gh',    'Efua Darko'),
  ('40000000-0000-4000-8000-000000000004', '+233200000004', 'y.owusu@example.gh',    'Yaw Owusu'),
  ('40000000-0000-4000-8000-000000000005', '+233200000005', 'a.asare@example.gh',    'Abena Asare'),
  ('40000000-0000-4000-8000-000000000006', '+233200000006', 'k.frimpong@example.gh', 'Kwesi Frimpong'),
  ('40000000-0000-4000-8000-000000000007', '+233200000007', 'n.tetteh@example.gh',   'Naa Tetteh'),
  ('40000000-0000-4000-8000-000000000008', '+233200000008', 'j.quaye@example.gh',    'Joana Quaye'),
  ('40000000-0000-4000-8000-000000000009', '+233200000009', 's.appiah@example.gh',   'Selorm Appiah');

insert into ref_role (id, code, label) values
  ('41000000-0000-4000-8000-000000000001', 'TEACHER',    'Teacher · JHS Maths'),
  ('41000000-0000-4000-8000-000000000002', 'ACCOUNTANT', 'Non-teaching · Accounts');

-- ⚠ Note for anyone reading the classification code: the TEACHER role code below is attached to
-- BOTH a register teacher and a non-register staff member in places, on purpose. `ref_role.code` is
-- school-authored and must never decide the lawful basis; the register does.
insert into role_assignment (id, user_id, school_id, role_id, scope_ref, start_date, end_date) values
  ('42000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001', null, current_date - 900, null),
  ('42000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000002', null, current_date - 600, null),
  ('42000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000002', '41000000-0000-4000-8000-000000000001', null, current_date - 400, null),
  ('42000000-0000-4000-8000-000000000004', '40000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000003', '41000000-0000-4000-8000-000000000002', null, current_date - 300, null),
  ('42000000-0000-4000-8000-000000000005', '40000000-0000-4000-8000-000000000005', '30000000-0000-4000-8000-000000000004', '41000000-0000-4000-8000-000000000001', null, current_date - 1200, null),
  ('42000000-0000-4000-8000-000000000006', '40000000-0000-4000-8000-000000000006', '30000000-0000-4000-8000-000000000005', '41000000-0000-4000-8000-000000000002', null, current_date - 200, null),
  ('42000000-0000-4000-8000-000000000007', '40000000-0000-4000-8000-000000000007', '30000000-0000-4000-8000-000000000006', '41000000-0000-4000-8000-000000000002', null, current_date - 150, null),
  ('42000000-0000-4000-8000-000000000008', '40000000-0000-4000-8000-000000000008', '30000000-0000-4000-8000-000000000007', '41000000-0000-4000-8000-000000000002', null, current_date - 120, null),
  ('42000000-0000-4000-8000-000000000009', '40000000-0000-4000-8000-000000000009', '30000000-0000-4000-8000-000000000008', '41000000-0000-4000-8000-000000000001', null, current_date - 500, null);

insert into staff_profile (
  id, school_id, user_id, date_of_birth, gender, address, emergency_contact,
  qualification_level, highest_qualification, undergraduate,
  ntc_licence_number, ntc_licence_expiry, nmc_licence_number, nmc_licence_expiry, specialisations
) values
  ('50000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
   '1988-04-12', 'Female', 'House 14, Asankrangwa', 'Yaa Boateng · sister · +233200000101',
   'BACHELORS', 'BEd Mathematics Education · UCC · 2012', 'University of Cape Coast',
   'NTC-2019-004417', '2027-08-31', null, null, 'Core Maths, Elective Maths'),
  ('50000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002',
   '1991-11-02', 'Male', 'Plot 9, Asankrangwa', 'Adwoa Mensah · wife · +233200000102',
   'HND', 'HND Accountancy · Takoradi Technical University · 2014', 'Takoradi Technical University',
   null, null, null, null, null),
  ('50000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000003',
   '1990-02-19', 'Female', 'Amenfiman staff quarters', 'Kofi Darko · brother · +233200000103',
   'BACHELORS', 'BSc Integrated Science · UEW · 2013', 'University of Education, Winneba',
   'NTC-2018-002210', '2026-12-31', null, null, 'Integrated Science'),
  ('50000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000004',
   '1985-07-07', 'Male', 'Mission house, Wassa', 'Akua Owusu · wife · +233200000104',
   'DIPLOMA', 'Diploma in Business Studies · 2009', null,
   null, null, null, null, null),
  ('50000000-0000-4000-8000-000000000005', '30000000-0000-4000-8000-000000000004', '40000000-0000-4000-8000-000000000005',
   '1979-01-23', 'Female', 'Wassa Akropong', 'Kwame Asare · husband · +233200000105',
   'BACHELORS', 'BEd Basic Education · UEW · 2004', 'University of Education, Winneba',
   'NTC-2015-000981', '2025-10-31', null, null, 'Basic Maths'),
  ('50000000-0000-4000-8000-000000000006', '30000000-0000-4000-8000-000000000005', '40000000-0000-4000-8000-000000000006',
   '1993-09-30', 'Male', 'Manso Amenfi', 'Esi Frimpong · sister · +233200000106',
   'HND', 'HND Secretarialship · 2016', null,
   null, null, null, null, null),
  ('50000000-0000-4000-8000-000000000007', '30000000-0000-4000-8000-000000000006', '40000000-0000-4000-8000-000000000007',
   '1987-06-14', 'Female', 'Nkwanta', 'Ayele Tetteh · mother · +233200000107',
   'DIPLOMA', 'Diploma in Basic Education · 2010', null,
   null, null, null, null, null),
  ('50000000-0000-4000-8000-000000000008', '30000000-0000-4000-8000-000000000007', '40000000-0000-4000-8000-000000000008',
   '1995-03-08', 'Female', 'Bethel staff quarters', 'Kofi Quaye · brother · +233200000108',
   'HND', 'HND Marketing · 2018', null,
   null, null, null, null, null),
  ('50000000-0000-4000-8000-000000000009', '30000000-0000-4000-8000-000000000008', '40000000-0000-4000-8000-000000000009',
   '1983-12-01', 'Male', 'Takoradi', 'Mawuli Appiah · brother · +233200000109',
   'MASTERS', 'MPhil Chemistry · KNUST · 2011', 'KNUST',
   'NTC-2012-000114', '2028-01-31', null, null, 'Chemistry');

-- Salary rows: present, populated, and unreadable by the read-back role.
insert into staff_compensation (school_id, user_id, salary_status, monthly_amount, ssnit_deduction, paye_deduction, effective_from, notes)
select sp.school_id, sp.user_id, 'GES_PAID', 3250.00, 178.75, 412.50, current_date - 365,
       'Confidential pay note — must never reach Oversight.'
from staff_profile sp;

insert into facilities_snapshot (school_id, period_id, classrooms_total, classrooms_good, classrooms_repair, caterer_name, captured_by)
values ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 24, 18, 6,
        'Auntie Adwoa Catering Services', '40000000-0000-4000-8000-000000000002');

-- ── consent state ───────────────────────────────────────────────────────────────────────────────
insert into school_staff_oversight_consent (id, school_id, scope, state, granted_by_user_id, granted_by_role, granted_at, revoked_at, consent_statement_version) values
  -- GRANTED, live: the consent branch's happy path.
  ('70000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'NON_GES_STAFF', 'GRANTED',
   '40000000-0000-4000-8000-000000000002', 'HEADMASTER', now() - interval '60 days', null, 'v1.0-2026-05'),
  -- GRANTED at a PRIVATE school: everything is in place EXCEPT the flag, so a denial here can only
  -- be the flag. That is what makes the flag test meaningful.
  ('70000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000003', 'NON_GES_STAFF', 'GRANTED',
   '40000000-0000-4000-8000-000000000004', 'ADMIN', now() - interval '40 days', null, 'v1.0-2026-05'),
  -- REVOKED: a school that granted and changed its mind. Must refuse exactly like never granting.
  ('70000000-0000-4000-8000-000000000005', '30000000-0000-4000-8000-000000000005', 'NON_GES_STAFF', 'REVOKED',
   '40000000-0000-4000-8000-000000000006', 'ADMIN', now() - interval '90 days', now() - interval '5 days', 'v1.0-2026-05'),
  -- GRANTED at the unknown-ownership school: so a refusal there can ONLY be the missing ownership.
  ('70000000-0000-4000-8000-000000000006', '30000000-0000-4000-8000-000000000006', 'NON_GES_STAFF', 'GRANTED',
   '40000000-0000-4000-8000-000000000007', 'HEADMASTER', now() - interval '20 days', null, 'v1.0-2026-05'),
  -- GRANTED outside the officer's subtree: so a refusal there can ONLY be the jurisdiction ceiling.
  ('70000000-0000-4000-8000-000000000008', '30000000-0000-4000-8000-000000000008', 'NON_GES_STAFF', 'GRANTED',
   '40000000-0000-4000-8000-000000000009', 'HEADMASTER', now() - interval '10 days', null, 'v1.0-2026-05');

-- EMIS-PUB-002 and EMIS-PUB-004 have NO consent row at all. Absence is the commonest real state and
-- must behave identically to an explicit refusal.
