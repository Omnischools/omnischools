# Todo — apps/web

## Oversight staff-consent capture (Settings) — basic + senior tiers

**Owner decision (2026-09):** Omnischools Oversight lets GES drill down to an
individual staff member's record through the gated, audit-logged §6 path
(`md files/OVERSIGHT_ANALYTICS_SPEC.md` §6). Consent rules:

- **GES-licensed teachers on the GES establishment register → NO consent**
  (statutory oversight; works at every ownership type).
- **Non-teaching staff, and any staff NOT on the GES register (incl.
  private/mission-school staff) → per-school DPO consent required** before GES
  may drill down to an individual. Without consent, Oversight shows aggregates
  only and refuses the individual record (fails closed).
- **Private / mission (non-PUBLIC ownership): consent branch stays FLAG-OFF in
  production** until a DPO writes the lawful-basis position — an employer's
  click is not the employee's consent under the Data Protection Act 2012
  (Act 843). Build the capture, but it must not enable GES drill-down for
  non-public schools until that sign-off exists.

**This task = the CAPTURE surface AND the consent table.** The Oversight
drill-down increment (branch `claude/oversight-individual-drilldown`) builds the
*enforcement* against the contract below and fails closed until this lands. Build
the table exactly to this contract so the two sides meet:

### Consent table contract (build in `apps/web/db/schema/oversight-consent.ts`)

`school_staff_oversight_consent` — current state, one row per `(school_id, scope)`:
- `id` uuid PK
- `school_id` → `ref_school` (FK, CASCADE), tenant-scoped
- `scope` enum — v1 only `NON_GES_STAFF` (column present so a per-person scope can be added later)
- `state` enum `GRANTED | REVOKED` (reuse the `senConsentState` idiom)
- `granted_by_user_id` → `ref_user` (SET NULL), `granted_by_role`
- `granted_at`, `revoked_at` (timestamptz, nullable)
- `consent_statement_version` text — the exact wording the grantor agreed to (this is the DPA defence)
- UNIQUE `(school_id, scope)`
- standard `tenant_isolation` FORCE-RLS tenant policy + a `prod-paste-*.sql`

`school_staff_oversight_consent_event` — append-only history (grant / revoke /
re-grant), same immutability posture as `audit_access_log` (a Postgres trigger
rejecting UPDATE/DELETE). Consent that can be silently rewritten is not consent.

**Oversight reads it** (already built on the drill-down branch) inside the
read-back transaction, before any staff column is selected:
`state = 'GRANTED' AND revoked_at IS NULL` for `(school_id, 'NON_GES_STAFF')`.
No cache. Oversight never writes consent.

### The capture surface

- A Settings page (`apps/web/app/(app)/settings/…`, following the
  `settings/retention` pattern) where a school **Admin or Headmaster** grants or
  revokes consent for GES individual drill-down of non-GES / non-teaching staff.
- Server action writes `school_staff_oversight_consent` and appends the event
  log; role check server-side; RLS tenant-scoped. Store `consent_statement_version`.
- Explain plainly what consent does / does not cover: it does **not** affect
  aggregate reporting (statutory, always on), does **not** cover students (never
  individually visible), does **not** cover GES-register teachers (statutory).
- Revocation is immediate and one click from the same page; show who granted it and when.
- Available on **both BASIC and SENIOR tiers**.

### Do NOT
- Do not build any Oversight-side read/enforcement here (already on the drill-down branch).
- Do not re-introduce a school-level data-sharing / ETL consent gate — that was
  deliberately removed (`OVERSIGHT_ANALYTICS_SPEC.md` §5.5). This consent is
  narrow: individual drill-down of non-GES staff only.

### Blocked on
- DPO position on whether employer consent is a sufficient lawful basis under
  Act 843 for private/mission-school staff. Build the surface + table; the
  Oversight side keeps the non-public branch flag-off until that position exists.
