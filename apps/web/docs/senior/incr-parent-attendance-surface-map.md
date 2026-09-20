# INCR — Parent-portal Attendance tab (read-only) · build-ready spec

**Status:** spec-complete, front-half done (Kofi ACs + Lucy surface map). **BUILD BLOCKED on PR #342 (INCR #278) merging** — the nav wiring collides with `app/(parent)/parent-chrome.tsx` and the route can't compile without it, so the whole increment lands as ONE unit off the post-#342 main. Also awaiting owner **OC-PARENT-ATT-KEYSET** (conservative defaults below are shippable as-is).

Clone the shipped sibling: `app/(parent)/sickbay/page.tsx` + `lib/parent/parent-sickbay-data.ts` (frozen-key-set reader under `withParentScope`, projection = the only column guard, honest-empty). Surface source (goofy-poitras primary wd, absent from senior-live): `Surfaces/schoolup-attendance-parent.html`.

## The RLS widening (mandatory prod-paste)
`attendance_record` is in the `parent_deny` catalog today (`db/sql/policies.sql`) → parent reads 0 rows (fail-closed). This is the **8th widening of the 19a parent boundary (24 → 25 parent_scope tables)**. Add ONE policy, byte-shaped like the `wassce_candidates` policy (`policies.sql` ~L359):
```sql
CREATE POLICY parent_scope ON attendance_record AS RESTRICTIVE FOR ALL TO public
  USING (
    NULLIF(current_setting('app.current_parent_user', true), '') IS NULL
    OR student_id IN (SELECT parent_student_ids(school_id, NULLIF(current_setting('app.current_parent_user', true),'')::uuid))
  );
```
Add the INCR block to `policies.sql` (dev) AND author **`prod-paste-0093`** (owner hand-runs on prod — RLS is not auto-applied). `attendance_correction` + `attendance_settings` STAY `parent_deny` (correction rows carry staff `decisionNote`/`requestedByUserId`/`decidedByUserId`).

## OC-PARENT-ATT-KEYSET — ruling (owner-confirmable; conservative defaults)
1. **Medical (M) → FOLD into Excused** in the SQL projection (`CASE status WHEN 'MEDICAL' THEN 'EXCUSED' ELSE status END`). The string `"MEDICAL"` never crosses the wire. Kofi proved the fold costs **zero rate accuracy** (Medical & Excused both out of numerator, both in denominator). Owner-widenable to distinct Medical (one-line projection change).
2. **`reasonCode` OMITTED** by default (owner-widenable to structured category only — never free-text). **`note` (free-text) PERMANENT omit** (DPA hazard — third-party/health/disciplinary text). 
3. **`markedByUserId` / `markedAt` clock OMITTED** (staff PII / surveillance-shaped); the only temporal field is the date-only `date`.

## Frozen key-set (final — reconciled Kofi + Lucy; the enforcement point)
Reader `loadParentAttendanceStatus(schoolId, userId, studentId)` under `withParentScope` ONLY. `studentId` = server-resolved input filter, NEVER a URL param, NEVER returned. Reads ONLY `attendance_record` (+ `academic_period`/`school_holiday` — already parent_scoped — for term bounds + school-day/holiday classification). Joins NOTHING to `users`/`attendance_correction`/comms.
```
Day    = { date:'YYYY-MM-DD', bucket:'PRESENT'|'LATE'|'EXCUSED'|'ABSENT' }   // MEDICAL folded→EXCUSED
Status = {
  today:   Day | null                                   // null = no mark / weekend / holiday
  week:    { date, bucket, isToday, isSchoolDay }[]      // Mon–Fri current school week
  term:    { label, startsOn, asOf, atSchoolDays, markedDays, atSchoolPct,
             counts:{ present, late, excused, absent } } | null   // NO `medical` key
  priorTerm: { label, atSchoolPct, atSchoolDays, markedDays } | null
  recentAbsences: { date, bucket:'ABSENT'|'EXCUSED' }[] // dates + bucket ONLY
}
```
**NEVER selected/returned:** `reason_code`, `note`, `marked_by_user_id` (+ any `users` join), `marked_at` clock, `attendance_correction.*`, the value `"MEDICAL"`, `studentId`/ids/free-text.

## OMIT from the surface (write affordances / cross-module PII — R234 / omit-not-fake)
- Teacher name in hero ("Mr. Mensah") → "Marked present today." (no name, no clock).
- State B **school-contact card** (named HM + WhatsApp/call = comms `parent_deny` + staff PII) → OMIT whole card; at most a static un-named "contact the school office" line.
- **Planned-absence CTA + "tell the school / correction" links** → write affordances, OMIT (read-only v1).
- **State C (planned-absence form)** → a parent WRITE surface (new mutation + SMS-suppression + reason taxonomy) → DEFER to its own increment.
- No at-risk/threshold/pattern/predictive labels (parent surface is information, not coaching).

## Two open reconciliations (flag to owner; default per note)
1. **"At school %" numerator — present-only vs present+late.** Surface demo = **present-only** (State B 29/47 = 61%); staff canonical (`attendance-summary-data.ts`) = `(present+late)/marked`. Exact-surface-replication → **default present-only** (`atSchoolPct = round(present/markedDays*100)`, `null` when markedDays=0), matching the surface. Confirm with Kofi/owner. Kofi's AC-PATT-12 assumed present+late — reconcile to present-only unless owner rules otherwise. Either way: `present+late+excused+absent === markedDays`.
2. **Multi-child switcher** — surface implies multi-child; shipped portal is single-child (`data.children[0]`). Build single-child (like sickbay) for v1.

## Acceptance criteria
Kofi's **AC-PATT-01..21** govern (scope/plumbing, own-child + cross-tenant isolation, frozen-key-set projection guard, honest rollup incl. `ratePct=null` when markedDays=0, fold-costs-no-accuracy, honest-empty states, per-day `{date,status}` only). Test as source-shape (reader projection / withParentScope-only / no PII columns) + pure rollup fixtures (mirror the #278 `buildParentCalendar` split — extract a pure `buildParentAttendance(rows, termWindow, today)`).

## Build order (after #342 merges)
1. `prod-paste-0093` + `policies.sql` INCR block (Wells).
2. `lib/parent/parent-attendance-data.ts` (reader + pure rollup) + `lib/parent/parent-attendance-copy.ts` (jargon-guarded copy, mirror `wassce/parent-copy.ts`).
3. `app/(parent)/attendance-summary/page.tsx` (States A+B card bodies 1:1; NoChild + honest-empty from sickbay). URL is `/attendance-summary` — `/attendance` is the STAFF marking route (parent routes share the `(app)` namespace), so the tab needs a unique segment; the tab LABEL stays "Attendance".
4. `app/(parent)/parent-chrome.tsx` — add `Attendance → /attendance-summary` as the 5th tab.
5. `lib/parent/parent-attendance.test.ts`.
6. Gates: Quinn ALONE (mutation-probe), then Dex + Sarah (Sarah verifies the parent_scope grant is own-child leak-safe + billing/correction stay denied).

Sources: full Kofi ruling (AC-PATT + OC reasoning) and Lucy surface map (3 states, token table, §8 SHOW/OMIT table) in the session transcript.
