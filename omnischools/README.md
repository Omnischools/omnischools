# Omnischools

Multi-tenant school-management platform for Ghana — **Basic** (KG/Primary/JHS),
**Senior** (SHS), and **Oversight** (GES/MoE) on one Next.js codebase and one
operational Postgres (school-scoped via RLS), with a separate analytics DB for Oversight.

> Build order and architecture: see `../md files/INSTRUCTIONS_FOR_CLAUDE_CODE.md`,
> `../md files/BUILD_STACK.md`, and the plan at `~/.claude/plans/`.

## Stack

Next.js 14 (App Router) · TypeScript (strict) · Tailwind + shadcn/ui (design tokens) ·
PostgreSQL + Drizzle ORM · Supabase (Auth/Storage at deploy) · Hubtel SMS · Resend ·
Sentry/PostHog. Local dev uses **Docker Postgres**; production uses **Supabase Postgres**.

## Prerequisites

- Node 20+ (works on 24) · pnpm 10 · Docker Desktop

## Getting started

```bash
pnpm install
cp .env.example .env.local        # local defaults already point at Docker Postgres
pnpm db:up                        # start Docker Postgres (docker-compose.yml)
pnpm db:setup                     # push schema + apply RLS policies + seed Asankrangwa SHS
pnpm dev                          # http://localhost:3000
```

### Useful scripts

| Script | What it does |
|---|---|
| `pnpm db:up` / `db:down` | Start / stop local Docker Postgres |
| `pnpm db:generate` | Generate SQL migrations from Drizzle schema |
| `pnpm db:push` | Push schema to the dev DB |
| `pnpm db:policies` | Apply Row-Level Security policies (`db/sql/policies.sql`) |
| `pnpm db:seed` | Seed the Asankrangwa SHS demo tenant |
| `pnpm db:rls-test` | Prove cross-tenant isolation (RLS) |
| `pnpm db:studio` | Open Drizzle Studio |
| `pnpm typecheck` / `lint` / `format` | Quality gates |

## Architecture guardrails

- **Multi-tenancy is a constraint:** every tenant table has `school_id`; reads/writes go
  through `withSchool()` (`lib/db/rls.ts`), which sets `app.current_school` so Postgres RLS
  applies. Tenant isolation is verified by `pnpm db:rls-test`.
- **Append-only audit:** every mutation calls `recordAudit()` (`lib/db/audit.ts`) in the
  same transaction. Corrections are new events, never silent edits.
- **Portability (BUILD_STACK):** no Vercel KV/Postgres/Blob; auth behind `lib/auth/`;
  SMS/email/observability behind `lib/{sms,email,observability}`; storage via our own API
  route; background jobs are POST endpoints guarded by a shared secret (`app/api/cron/*`).

## Layout

```
app/(marketing)   public site (landing, pricing, onboarding) — Phase 2
app/(app)/basic   Basic tier — Phase 3 (MVP1)
app/(app)/senior  Senior tier — Phase 4 (MVP2)
db/schema         Drizzle schema, one file per domain
db/seed           demo-tenant seeds
db/sql            RLS policies
features/*        domain feature modules
lib/*             auth, db, supabase, sms, email, observability (thin interfaces)
```
