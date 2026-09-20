-- ============================================================================================
-- PRE-DEPLOY CHECK for PR #167 (auth: scope roles to the active school)
--
-- STRICTLY READ-ONLY. No INSERT/UPDATE/DELETE/DDL. Safe to paste into the prod SQL editor.
--
-- WHY: before #167, role_assignment.start_date / end_date were documented ("null = currently
-- active") but NEVER enforced — getCurrentUser() ignored both columns. After #167 they are
-- enforced, so any assignment that has ended (or has not started) stops conferring its role
-- THE MOMENT THIS DEPLOYS. That is the correct behaviour, but to whoever it hits it looks
-- exactly like an outage, so find them first.
--
-- The count of stale rows is NOT the number that matters. Someone holding an expired
-- assignment AND a live one is completely unaffected. Section B is the real answer.
--
-- Run top-to-bottom. If A returns all zeros, nothing changes and you can stop.
-- ============================================================================================

-- ---------------------------------------------------------------------------- A · headline
-- Does anything change at all? One row. All zeros ⇒ this deploy is a no-op for access.
SELECT
  count(*)                                                              AS total_assignments,
  count(*) FILTER (WHERE end_date   IS NOT NULL AND end_date   < current_date) AS ended_rows,
  count(*) FILTER (WHERE start_date IS NOT NULL AND start_date > current_date) AS not_started_rows,
  count(DISTINCT user_id) FILTER (
    WHERE (end_date IS NOT NULL AND end_date < current_date)
       OR (start_date IS NOT NULL AND start_date > current_date)
  )                                                                     AS users_with_a_stale_row
FROM role_assignment;


-- ------------------------------------------------------------- B · THE OUTAGE LIST (read this)
-- People who LOSE ALL ACCESS: every one of their assignments is stale, so after #167 they
-- resolve to no active school and land on /start instead of a working session.
--
-- Expected here: genuinely departed staff. If a CURRENT member of staff appears, their
-- end_date is wrong in the data — fix the row, do not delay the deploy.
SELECT
  u.full_name,
  u.phone,
  s.name                                   AS school,
  r.code                                   AS role,
  ra.start_date,
  ra.end_date,
  CASE
    WHEN ra.end_date   IS NOT NULL AND ra.end_date   < current_date
      THEN 'ended '        || (current_date - ra.end_date)   || ' day(s) ago'
    WHEN ra.start_date IS NOT NULL AND ra.start_date > current_date
      THEN 'starts in '    || (ra.start_date - current_date) || ' day(s)'
  END                                      AS why_stale
FROM role_assignment ra
JOIN ref_user   u ON u.id = ra.user_id
JOIN ref_school s ON s.id = ra.school_id
JOIN ref_role   r ON r.id = ra.role_id
WHERE ra.user_id IN (
  -- users with at least one assignment, but ZERO currently-active ones
  SELECT user_id
  FROM role_assignment
  GROUP BY user_id
  HAVING count(*) FILTER (
    WHERE (start_date IS NULL OR start_date <= current_date)
      AND (end_date   IS NULL OR end_date   >= current_date)
  ) = 0
)
ORDER BY u.full_name, s.name, r.code;


-- ------------------------------------------------- C · quieter risk: active school CHANGES
-- People who keep access but may land in a DIFFERENT school. After #167 the active school is
-- the earliest-CREATED still-current assignment; if their earliest assignment is the stale one,
-- the school they land in shifts. Only possible for users attached to more than one school.
--
-- Expected: zero rows on a single-school-per-user deployment.
WITH live AS (
  SELECT ra.*
  FROM role_assignment ra
  WHERE (ra.start_date IS NULL OR ra.start_date <= current_date)
    AND (ra.end_date   IS NULL OR ra.end_date   >= current_date)
),
old_pick AS (  -- pre-#167: unordered, but the planner's practical answer was earliest-created overall
  SELECT DISTINCT ON (user_id) user_id, school_id
  FROM role_assignment ORDER BY user_id, created_at, school_id
),
new_pick AS (  -- post-#167: earliest-created among CURRENTLY-ACTIVE only
  SELECT DISTINCT ON (user_id) user_id, school_id
  FROM live ORDER BY user_id, created_at, school_id
)
SELECT
  u.full_name,
  u.phone,
  so.name AS was_school,
  sn.name AS now_school
FROM old_pick o
JOIN new_pick n  ON n.user_id = o.user_id
JOIN ref_user   u  ON u.id = o.user_id
JOIN ref_school so ON so.id = o.school_id
JOIN ref_school sn ON sn.id = n.school_id
WHERE o.school_id <> n.school_id
ORDER BY u.full_name;


-- ------------------------------------------------------ D · every stale row, for the record
-- Full detail incl. people who are NOT losing access (they hold a live assignment elsewhere).
-- Useful for spotting data-entry mistakes; not an outage list.
SELECT
  u.full_name,
  s.name          AS school,
  r.code          AS role,
  ra.start_date,
  ra.end_date,
  ra.created_at,
  EXISTS (
    SELECT 1 FROM role_assignment ok
    WHERE ok.user_id = ra.user_id
      AND (ok.start_date IS NULL OR ok.start_date <= current_date)
      AND (ok.end_date   IS NULL OR ok.end_date   >= current_date)
  )               AS keeps_access_via_another_assignment
FROM role_assignment ra
JOIN ref_user   u ON u.id = ra.user_id
JOIN ref_school s ON s.id = ra.school_id
JOIN ref_role   r ON r.id = ra.role_id
WHERE (ra.end_date   IS NOT NULL AND ra.end_date   < current_date)
   OR (ra.start_date IS NOT NULL AND ra.start_date > current_date)
ORDER BY keeps_access_via_another_assignment, u.full_name;


-- ------------------------------------------------------------------ E · timezone sanity check
-- #167 computes "today" in UTC (new Date().toISOString()) while these DATE columns are written
-- with the DB session TimeZone. Ghana is UTC+0 with no DST, so these should agree. If they do
-- NOT, an assignment created right now could be dated "tomorrow" and briefly deny a new starter.
SELECT
  current_setting('TimeZone')        AS db_session_timezone,
  current_date                       AS db_today,
  (now() AT TIME ZONE 'UTC')::date   AS utc_today,
  current_date = (now() AT TIME ZONE 'UTC')::date AS agrees_with_app;
