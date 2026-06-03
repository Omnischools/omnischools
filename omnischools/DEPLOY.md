# Omnischools — Production Deploy (MVP1)

The app is **portable** (BUILD_STACK): no Vercel-only services, auth behind `lib/auth`,
SMS/email behind `lib/{sms,email}`, jobs as HTTP POST + shared secret. Hosting today is
**Supabase Postgres + Supabase Auth + Vercel**.

> Prerequisite: all MVP1 PRs merged into `main` (Students/Admissions, Fees, Attendance,
> Gradebook, Communications). Deploy from `main`.

## What you'll need
- A Supabase account (free tier) → project **omnischools-prod**.
- A Vercel account connected to the **Omnischools** GitHub org.
- (Optional, can come later) Hubtel SMS, Resend, Sentry, PostHog keys — stubbed until set.

---

## 1 · Supabase project
1. Create project **omnischools-prod**, region **EU (London / eu-west-2)** (closest to Ghana).
2. **Settings → API** — copy:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` public key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (secret — server only)
3. **Settings → Database → Connection string**:
   - **Direct** (port 5432) → use for migrations/policies/seed below (call it `DIRECT_URL`).
   - **Transaction pooler** (port 6543, add `?pgbouncer=true`) → app runtime `DATABASE_URL`.
4. **Authentication → Providers → Phone** — enable, and attach an SMS provider
   (Twilio / MessageBird / Vonage) per Supabase docs. For first tests you can add test
   phone numbers with fixed OTPs under Auth → Phone.

## 2 · Apply schema + RLS to prod (run locally, once)
Run from `omnischools/` with the **direct** connection string. These are safe on an empty DB.
Run as the project's `postgres` user so the RLS bypass role is granted to it.

```bash
# point at prod just for these commands (do NOT commit this value)
export DATABASE_URL="<DIRECT_URL>"
pnpm db:migrate        # creates all tables (migrations 0000–0006)
pnpm db:policies       # enables/forces RLS + tenant policies + app/admin roles
pnpm db:seed           # optional: seeds the Asankrangwa demo school
```
Tip: `pnpm db:rls-test` against prod should pass (cross-tenant reads blocked).

## 3 · Vercel
1. **Add New → Project** → import `Omnischools/omnischools`.
2. **Root Directory = `omnischools`** (important — the app lives in the subdir).
3. Framework preset: **Next.js** (auto-detected). Build: `pnpm build`.
4. **Environment Variables** (Production):

   | Key | Value |
   |---|---|
   | `DATABASE_URL` | transaction-pooler URI (`...:6543/postgres?pgbouncer=true`) |
   | `NEXT_PUBLIC_SUPABASE_URL` | project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role key |
   | `AUTH_DEV_BYPASS` | `false`  ← flips on real phone-OTP auth |
   | `NEXT_PUBLIC_SITE_URL` | your Vercel URL (e.g. `https://omnischools.vercel.app`) |
   | `CRON_SECRET` | a long random string |
   | `HUBTEL_CLIENT_ID` / `_SECRET` / `_SENDER_ID` | optional (SMS goes live when set) |
   | `RESEND_API_KEY` | optional (email goes live when set) |

5. **Deploy.** Pushes to `main` auto-deploy thereafter.

## 4 · Smoke test the live URL
1. `/` landing renders; `/pricing`, `/faq` OK.
2. `/start` → onboard a school (creates the admin **ref_user** with the phone you enter).
3. `/login` → enter that admin phone → receive OTP → verify → lands on `/dashboard`.
4. Admissions: `/apply/<GES-code>` submit → `/admissions` accept → student appears.
5. Fees: issue invoice → record payment → receipt + balance update.
6. Attendance: create class, enroll, take register (absences would SMS once Hubtel is set).
7. Gradebook: enter scores → generate report card → print.
8. Communication: post an announcement; send a template SMS (logs as SENT once Hubtel is set).

## Notes
- **Migrations use the direct connection; the app uses the pooler.** Our `postgres.js`
  client sets `prepare: false`, which is pgbouncer-safe.
- **RLS in prod:** the app connects as the project `postgres` role; FORCE RLS + the
  `tenant_isolation` policies enforce per-school isolation. `withSchool()` sets
  `app.current_school`; identity/onboarding paths use the `omnischools_admin` bypass role
  (granted to `postgres` when `db:policies` ran as `postgres`).
- **Phone OTP:** `signInWithOtp` auto-creates the Supabase auth user; `getCurrentUser`
  maps the verified phone to the `ref_user` created at onboarding. So onboard a school
  before signing in with that admin's phone.
- **Scaling later** (Scaling Plan.txt): Cloudflare in front → Hetzner+Coolify → self-hosted
  Postgres. Nothing here is Vercel-locked.
