# Running Oversight & provisioning officers

Two jobs in one place:

- **Part A — Local dev login.** Run `apps/oversight` on your machine and land in the dashboards as
  the dev officer, no credentials. For building and demoing against the grounded demo dataset.
- **Part B — Go-live provisioning.** The runbook for giving a *real* GES officer (or yourself) a
  sign-in on the deployed Oversight: Supabase Auth user → `ref_oversight_officer` row → TOTP. Ready
  to apply when go-live is approved; it touches prod nowhere until you run the marked steps.

This is a companion to `docs/PROVISIONING.md` (the analytics-DB runbook) and `../README.md`. Where
they overlap, those files are the source of truth for the database posture; this file is the
operator's checklist.

---

## Part A — Run Oversight locally and sign in as the dev officer

Oversight's local login is the **dev bypass**: with `AUTH_DEV_BYPASS=true` (outside production) the
app issues a **NATIONAL** officer session with no authentication and drops you straight into the
dashboards — there is no sign-in form in this mode. The flag is a hard stop in production
(`lib/auth/index.ts` refuses to boot if it is `true` with `NODE_ENV=production`), so it is safe to
keep `true` locally and it can never reach a deployed environment.

You still need a **local analytics Postgres** (PG16+) for the dashboards to have data to read; the
dev session is synthetic but the pages read `fact_*`.

### Steps (verified end-to-end 2026-10-08)

From `apps/oversight`:

```bash
pnpm install

# 1 · a local analytics Postgres. Any PG16+ works. Two easy options:
#   (a) the repo's throwaway cluster (prints a superuser URL on stdout):
bash scripts/test-pg.sh                       # e.g. postgresql://postgres@127.0.0.1:55999/postgres
psql "postgresql://postgres@127.0.0.1:55999/postgres" -c "create database oversight_analytics_dev;"
#   (b) or Docker:  docker run -e POSTGRES_PASSWORD=pg -p 55432:5432 -d postgres:16
#       then create a database on it and use its URL below.

# 2 · point the app at it and turn the dev bypass on
cat > .env.local <<'EOF'
ANALYTICS_DATABASE_URL="postgresql://postgres@127.0.0.1:55999/oversight_analytics_dev"
AUTH_DEV_BYPASS=true
NEXT_PUBLIC_SITE_URL=http://localhost:3100
EOF
# Leave NEXT_PUBLIC_SUPABASE_* and PROVISIONER_DATABASE_URL UNSET locally — the bypass wins and
# does not read them. A stale Supabase pair here changes nothing (one flag, one answer).

# 3 · schema + RLS + config seed, then the grounded demo dataset, then the ETL that fills fact_*
pnpm db:setup           # drizzle-kit migrate + apply RLS policies + seed dim_stage/dim_subject/rules
pnpm db:seed-demo       # 969 registered schools, 849 on Schoolup; writes the demo EMIS extract + demo_source
pnpm etl:run            # decomposes demo_source → fact_infrastructure / enrolment / attendance / exam / fees

# 4 · run it
pnpm dev                # http://localhost:3100 — you arrive signed in as the NATIONAL dev officer
```

The sidebar footer will read **“Dev officer (AUTH_DEV_BYPASS) · National · Ministry of Education.”**
That confirms the bypass is active. Every gated surface (including the §6 named-record step-up) is
open locally because the shim declares the step-up satisfied.

> **Notes.**
> - `pnpm db:generate` is **not** needed — the migrations are committed under `db/migrations/`.
> - `pnpm db:setup` is for a *fresh* database. On a database that already has the schema, just run
>   `pnpm db:seed-demo && pnpm etl:run` to refresh the data.
> - The demo generator is deterministic — re-running `db:seed-demo` + `etl:run` is byte-identical.
> - First `next dev` compile is heavy; give it a minute before the first page responds.
> - To rehearse **real** auth locally instead of the bypass, set `AUTH_DEV_BYPASS=false` and the
>   three Supabase vars, and follow Part B against a throwaway Supabase project. You will then need a
>   real auth user, a directory row, and a TOTP enrolment — i.e. there is no shortcut; that is the point.

---

## Part B — Go-live: provision a real GES officer

**Identity model (why the steps are in this order).** Authentication is **Supabase Auth on the
analytics project** (the GES-staff pool, *not* `omnischools-prod`'s school pool). Authorisation is a
row in `ref_oversight_officer` in the analytics DB, and **that row's node is the officer's RLS
ceiling**. The crucial fact: `ref_oversight_officer.officer_id` **is** the Supabase auth uid — one
id, no second surrogate. So the auth user must exist *first*, because the directory row is keyed by
its uid; a directory row whose uid matches no auth user is an officer who can never sign in and
whose audit rows attribute to nobody.

**The tier is derived, never typed.** You give the loader a *node* (`jurisdiction_id`); the tier
(DISTRICT / REGION / NATIONAL) and role come from that node on every load. There is no `tier` /
`level` / `role` field — supplying one is a hard rejection. There is **no SCHOOL-tier officer**.

### B0 · Prerequisites on the deployed environment (one-time, see `docs/PROVISIONING.md` §2a, §4b)

These are set/applied by whoever operates the deploy — listed here so a missing one is recognisable:

- Analytics DB prod-paste **0004 → 0005** applied (the officer directory + its functions), and
  **0006 re-run** after (so the app role gets `EXECUTE` on the resolver). Without 0005, every
  sign-in raises `function ov_resolve_officer(uuid) does not exist`.
- The `ov_provisioner` **non-owner** role exists (0005's marked block), and
  `PROVISIONER_DATABASE_URL` points at it. It is the *only* credential that may write the directory;
  the app role cannot (self-promotion is a missing GRANT, not a policy).
- On the Vercel `omnischools-oversight` project: `AUTH_DEV_BYPASS=false`,
  `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the **analytics** project's Auth),
  and — for the admin console path — `OVERSIGHT_ADMIN_UIDS` + `PROVISIONING_APPROVAL_SECRET`.
- `SUPABASE_SERVICE_ROLE_KEY` is **not** set and must never be (it is unused by the runtime and a
  test fails if any source mentions it).

### B1 · Create the Supabase Auth user (manual — no service key in the repo)

In the **analytics** Supabase project → **Authentication → Users → Add user**:

- Email = the officer's **GES work email** (this is the primary factor; see the note on phone-OTP below).
- Set a temporary password (or send an invite). **Do not post the password in chat or any shared
  channel** — hand it over out of band, or use Supabase's invite email.
- Optionally set **user_metadata.full_name** to the officer's name — the app chrome shows the name
  from the officer's own JWT, never from the directory.
- **Copy the user's UID.** That UID is the `officer_id` in the next step.

(The repo deliberately has no admin/service credential, so this step is a dashboard or Supabase-CLI
act, not a script.)

### B2 · Write the directory row + audit row (one transaction)

**Pick the node.** Find the `jurisdiction_id` for the officer's node — node uuids are
`gen_random_uuid()`, so they differ per environment; **query, never hardcode**:

```sql
-- national:
select jurisdiction_id, name from dim_jurisdiction where level = 'NATIONAL';           -- "Ghana"
-- a region or district, by name:
select jurisdiction_id, level, name from dim_jurisdiction
  where level in ('REGION','DISTRICT') and name ilike '%<place>%';
```

**Two ways to provision — pick one:**

**(1) `pnpm db:load-officers <file.json>`** — a GES posting list over `PROVISIONER_DATABASE_URL`.
Copy `db/officers/officers.example.json`, fill it in (template fields explained inline), then:

```bash
PROVISIONER_DATABASE_URL="postgresql://ov_provisioner:…@…:6543/postgres?pgbouncer=true" \
  pnpm db:load-officers path/to/officers.json
```

It writes `ref_oversight_officer` + `audit_officer_provisioning` together, one transaction per
officer (a bad row N commits rows before it and stops naming N). It will **reject** a file that
names a tier/role, a SCHOOL node, a row with no reason, or a REGION/NATIONAL row whose `approver_id`
is missing or equals `actor_id`.

**(2) The admin console, `/admin/officers`** — signed in as an `OVERSIGHT_ADMIN_UIDS` admin (a GES
officer session is refused here at every tier, including national). Officer list + provision +
withdraw + the append-only history. For a REGION/NATIONAL grant it runs the **synchronous two-person
rule**: a second administrator mints a short-lived HMAC approval code bound to `(action, uid, node)`
and the proposer submits it.

> **⚠ The one decision for a NATIONAL demo sign-in.** A REGION or NATIONAL grant requires a **second,
> distinct administrator** (`approver_id` ≠ `actor_id`) — by CHECK, trigger, and the console. So
> signing yourself in as a *national* officer needs two admin uids. Options: (a) a **DISTRICT** grant
> needs only a reason, no approver, so a single-admin demo is simplest as a district director;
> (b) have a second Omnischools admin act as the approver for a region/national grant; (c) settle the
> demo officer's real node with GES first. Confirm the email, the node, and the timing before this
> step is run against prod.

### B3 · TOTP — mandatory second factor, every session

The officer's **first sign-in** at `oversight.omnischools.gh`: GES work email + password →
**authenticator enrolment** (a QR code to scan with Google/Microsoft Authenticator, plus a manual
key) → enter the 6-digit code to confirm. Every later sign-in re-challenges for the current code, and
the §6 named-record step-up re-checks it within a 5-minute window.

There is **no self-service recovery** — a lost authenticator is recovered only by re-enrolling the
officer's factor in Supabase Auth at this desk. Therefore (`docs/PROVISIONING.md` §5): **enrol/confirm
the officer can sign in before you tell them they have access.**

### B4 · Verify

```sql
-- as the APP role (ANALYTICS_DATABASE_URL), not the owner:
select officer_id, jurisdiction_id, officer_role from ref_oversight_officer;  -- the new row, right node
-- audit_officer_provisioning must be permission-denied to the app role, readable to the provisioner.
```

Then confirm the officer can complete B3 (sign in + TOTP) and sees only their jurisdiction.

### Offboarding

`is_active = false`, **never DELETE** (deleting orphans the audit trail), on both the directory row
and the Supabase auth user. Withdrawing a REGION/NATIONAL officer is itself a two-person action.

### Do-not list

- Don't post passwords or approval codes in shared channels (an approval code is a bearer token for
  its 15-minute TTL).
- Don't set `SUPABASE_SERVICE_ROLE_KEY`, and don't reach for the DB owner credential when a
  provisioning write fails with an RLS error — that means paste 0005 wasn't applied.
- Don't create real production users or touch prod until the email, node, and timing are confirmed.

> **Primary-factor note (owner to ratify — `docs/PROVISIONING.md` §4b).** What is built is **GES work
> email + password** as the primary factor; the onboarding mock showed phone-OTP. If the owner
> ratifies phone-OTP, exactly one function changes (`signInWithCredentials` in `lib/auth/mfa.ts`);
> the TOTP second factor, session policy, resolver and step-up are unaffected.
