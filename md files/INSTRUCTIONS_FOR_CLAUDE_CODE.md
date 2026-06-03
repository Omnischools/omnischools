# Instructions for Claude Code · Omnischools build

This document is the single entry point for the build. Read it top to bottom once, then start at Phase 0. Each phase has a clear goal, the prerequisites that gate it, the deliverables it produces, and the reference MD files where the *details* live. This file is the **orchestration layer** — it tells you the order. The other MD files (`BUILD_STACK.md`, `SHS_SCORE_LEDGER_SPEC.md`, the integration specs) tell you the *what* and the *why*.

If a phase's instructions here conflict with `BUILD_STACK.md`, `BUILD_STACK.md` wins. This file is the conductor, not the constitution.

---

## How to use this document

You (Claude Code) have filesystem access, terminal access, and the ability to install packages and run migrations. You do not have access to the user's Supabase project, Vercel account, Hubtel account, or any external service credentials. When a phase requires one of those, you stop, explain what's needed, and wait for the user to provision it or share credentials.

**Working principles:**

1. **Read the reference MD file before starting a phase.** Don't infer the design from this orchestration doc — the reference docs are richer and may contain decisions this doc summarises in one line.
2. **Commit at phase boundaries.** Each phase produces a coherent, testable slice. Don't leave a phase half-shipped before starting the next one.
3. **The HTML surfaces in `/mnt/user-data/outputs/schoolup-*.html` are the visual spec.** When building a feature, the matching HTML file shows you what the UI looks like at the design-system level — colours, typography, layout, copy. Translate them into Next.js + Tailwind + shadcn components. Don't redesign; the design is settled.
4. **Multi-tenancy is a constraint, not a feature.** Every table has `school_id`. Every query is scoped. RLS policies enforce this at the database layer, not at the application layer. Don't take shortcuts here.
5. **The demo school is Asankrangwa SHS** (fictional, code `WR-WAW-014`, Wassa Amenfi West, Western Region, 1,200 students). Seed this school's data at the end of Phase 1 so subsequent phases have realistic data to build against.
6. **Keep the app portable across hosting providers.** The current stack (Vercel + Supabase) is right for MVP, wrong for 1,000 schools — Vercel bandwidth becomes the cost killer somewhere around 200 schools. `BUILD_STACK.md` "Hosting cost trajectory and migration plan" documents the trigger points; Phase 0 deliverable 11 documents the disciplines that keep migration cheap. Apply those disciplines everywhere, not just in Phase 0. If a feature would be 10% faster to ship using a Vercel-specific API (KV, Blob, ISR cache, Vercel Cron's specific shape), do not use it — write the portable version. Future-you owes present-you nothing; future-you owes the schools who'll be paying you at 200 schools' scale a system that doesn't need a rewrite to keep serving them.

---

## Phase 0 · Repo and tooling foundation

**Goal:** A working Next.js project deployed to a staging URL, with the design system wired in, ready to receive feature code.

**Prerequisites:**
- User has created a Supabase project (`omnischools-prod` or `omnischools-staging`) and shared the connection string + service role key
- User has created a Vercel account and connected the GitHub repo
- User owns the `omnischools.gh` domain (this is one of the user's outstanding items — may not be done yet; ship to a Vercel preview URL in the meantime)

**Stack (from `BUILD_STACK.md` TL;DR table — non-negotiable, already decided):**

| Layer | Choice |
|---|---|
| Framework | Next.js 14+ App Router |
| Language | TypeScript |
| Styling | Tailwind CSS + shadcn/ui |
| Database | PostgreSQL on Supabase (region: EU-West-2 / London) |
| ORM | Drizzle |
| Auth | Supabase Auth (phone OTP + email/password) |
| SMS | Hubtel (primary), abstracted behind an interface |
| Payments | Hubtel aggregator (MVP2) |
| Hosting | Vercel (app) + Supabase (DB/auth/storage) |
| Email | Resend |
| Monitoring | Sentry + PostHog |

**Deliverables:**

1. **Repo initialised** at `omnischools/` with Next.js 14 App Router, TypeScript strict mode, Tailwind, ESLint, Prettier.
2. **Design tokens file** at `/styles/tokens.css` exporting CSS custom properties for the brand colours. Source these from the existing HTML surfaces (look at `:root` declarations in `omnischools-landing.html` for canonical values — navy `#1A2B47`, brass gold `#C8975B`, off-white `#FAF7F2`, forest green `#2F6B47`, terracotta `#B84A39`, warn `#C58A2E`). Wire into `tailwind.config.ts` as theme extension.
3. **Font loading** for Fraunces (display, italic gold accents), Manrope (body), JetBrains Mono (code/data). Use `next/font` with `display: 'swap'`.
4. **shadcn/ui initialised** (`pnpm dlx shadcn-ui@latest init`) with the colour theme bound to the design tokens. Install primitives as you need them, not upfront.
5. **Drizzle configured** at `/db/schema/` (one file per domain) with `drizzle-kit` for migrations. Connection string from `process.env.DATABASE_URL`. Migration scripts in `package.json`: `db:generate`, `db:push`, `db:studio`.
6. **Supabase client** configured for both server (`/lib/supabase/server.ts`) and client (`/lib/supabase/client.ts`) usage. Use `@supabase/ssr` for the App Router-compatible cookie-based session handling.
7. **PWA setup** — the score ledger ships a PWA in Phase 4 — so install `next-pwa` or hand-roll `manifest.json` + service worker now, even if no routes use it yet. Saves a refactor later.
8. **Folder structure:**
   ```
   omnischools/
     app/                      # Next.js routes
       (marketing)/            # Landing page, FAQ, etc.
       (app)/                  # Authenticated app
         basic/                # Basic-tier routes
         senior/               # Senior-tier routes
       api/                    # Route handlers
     components/               # Shared UI primitives (shadcn output here)
     features/                 # Feature-scoped code
       admissions/
       billing/
       score-ledger/
       boarding/
       (etc.)
     db/
       schema/                 # Drizzle schemas, one file per domain
       migrations/             # Generated SQL migrations
       seed/                   # Seed scripts (demo school)
     lib/
       supabase/
       sms/                    # Hubtel + fallback interface
       auth/
     styles/
       tokens.css
   ```
9. **Sentry + PostHog wired in** but kept dormant (no events emitted yet — environment variables present, SDKs imported, but no instrumentation calls). Phase 1 onwards will add events.
10. **Deploy preview** working — push to main triggers Vercel deploy, the landing page placeholder renders, the database connection succeeds.
11. **Portability discipline established** (read `BUILD_STACK.md` "Hosting cost trajectory and migration plan" first). The app must stay deliberately portable so that the planned migration off Vercel at ~200 schools and the optional later migration off Supabase don't become rewrite projects. Concretely:
    - **Don't use Vercel KV, Vercel Postgres, or Vercel Blob.** Use Supabase Storage via the S3-compatible API, Supabase Postgres, and your own caching layer if needed.
    - **`next/image` is fine, but configure the loader explicitly** so it works without Vercel's optimisation path.
    - **Auth logic stays behind a thin interface in `/lib/auth/`** — call functions like `signInWithPhone()`, `getCurrentUser()`, `requireRole()`, never call `supabase.auth.*` directly from feature code. Migrating to Lucia or Better-Auth later becomes one file's worth of work.
    - **Storage URLs are served through your own API route**, not raw Supabase Storage URLs. The route returns a signed URL; the client calls the route. When R2 replaces Supabase Storage, the route changes; the feature code does not.
    - **Background jobs must be triggerable from a generic HTTP cron**, not require Vercel Cron's specific shape. Build them as POST endpoints with a shared-secret header; Vercel Cron calls them today, `pg_cron` or a systemd timer on Hetzner calls them tomorrow.
    
    This discipline costs zero today and saves a 2-month rewrite at migration time.

**Reference:** `BUILD_STACK.md` Sections "TL;DR — the recommended stack," "The decisions in detail," and "Hosting cost trajectory and migration plan."

**Done when:** A `pnpm dev` server runs locally, renders a placeholder home page using the brand colours and fonts, connects to Supabase, and pushes a basic schema migration without error.

---

## Phase 1 · Cross-cutting schema

**Goal:** All schema that affects more than one product tier is created, migrated, and seeded. After this phase, you can build any tier without doubling back to the database layer.

**Prerequisites:** Phase 0 complete.

**This is the highest-leverage phase in the build.** Get it wrong and every subsequent phase costs more. Get it right and the rest is mechanical. Read `BUILD_STACK.md` Sections "Multi-tenancy," "Product tiers," and "SHS data model — additions to MVP1 schema" before writing the first migration.

**Deliverables:**

### 1.1 Tenancy and identity

Tables: `ref_school`, `ref_school_product` (which products a school subscribes to — Basic, Senior, or both), `ref_user`, `ref_role`, `role_assignment` (RBAC mapping user × school × role), `ref_district`, `ref_region` (for Oversight scoping later).

`ref_school` carries `school_type` (BASIC | SENIOR | COMBINED), `category` (A through F for SHS), `ownership` (PUBLIC | PRIVATE | MISSION), and `ges_code` (the official GES school identifier). These columns gate feature visibility in the app.

RLS policies on every table: `WHERE school_id = current_setting('app.current_school')::uuid`. The current school is set via Supabase session JWT claims; the middleware reads it and sets the session variable on every request.

### 1.2 Auth integration

Supabase Auth handles the phone OTP flow. Custom `/lib/auth/` wraps `supabase.auth.signInWithOtp()` for Ghana phone numbers (`+233...` normalisation). After OTP verification, a `ref_user` row is created/matched and `role_assignment` rows determine which schools and roles the user has access to. Middleware enforces that a request can only access data from schools the user is assigned to.

Roles to seed: `ADMIN`, `HEADMASTER`, `VICE_HEADMASTER_ACADEMIC` (Senior only), `TEACHER`, `FORM_MASTER`, `HOUSEMASTER` (Senior only), `STUDENT`, `PARENT`, `BURSAR`, `DEAN_OF_BOARDING` (Senior only), `MATRON` (Senior only). Roles unique to a tier are gated at the role-assignment level.

### 1.3 Academic period configuration · **Item 0 of the score ledger build sequence**

This is the foundational schema for time-bound data across all tiers. From `SHS_SCORE_LEDGER_SPEC.md` Section 3 and `BUILD_STACK.md` Decision 8.

Tables:
```sql
CREATE TABLE ref_academic_period_config (
  school_id      UUID NOT NULL,
  academic_year  TEXT NOT NULL,
  period_type    TEXT NOT NULL,       -- 'TERM' | 'SEMESTER'
  period_count   SMALLINT NOT NULL,   -- 2 | 3
  source         TEXT NOT NULL,       -- 'GES_DEFAULT' | 'SCHOOL_OVERRIDE'
  configured_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  configured_by  UUID NOT NULL,
  PRIMARY KEY (school_id, academic_year)
);

CREATE TABLE academic_period (
  period_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id      UUID NOT NULL,
  academic_year  TEXT NOT NULL,
  period_number  SMALLINT NOT NULL,
  period_label   TEXT NOT NULL,        -- 'Semester 1', 'Term 2'
  starts_on      DATE NOT NULL,
  ends_on        DATE NOT NULL,
  FOREIGN KEY (school_id, academic_year)
    REFERENCES ref_academic_period_config (school_id, academic_year)
);

CREATE TABLE gen_period_defaults (
  academic_year   TEXT NOT NULL,
  product_line    TEXT NOT NULL,        -- 'BASIC' | 'SENIOR' | 'SENIOR_F3'
  period_number   SMALLINT NOT NULL,
  period_label    TEXT NOT NULL,
  starts_on       DATE NOT NULL,
  ends_on         DATE NOT NULL,
  source_url      TEXT,
  extracted_at    TIMESTAMPTZ,
  reviewed_by     UUID,
  reviewed_at     TIMESTAMPTZ,
  PRIMARY KEY (academic_year, product_line, period_number)
);
```

Seed `gen_period_defaults` with the GES 2025/26 dates manually (Basic: 3 terms; Senior: 2 semesters; Senior_F3: shorter Semester 2 ending 21 Jun for the single-track WASSCE schedule). The annual ETL job that automates this refresh is **Item 7** of the user's outstanding list — defer it to Phase 4 or later. For now, the maintainer hand-populates each year's defaults.

The onboarding wizard (built in Phase 2 as part of school sign-up) will write to `ref_academic_period_config` and `academic_period` per-school based on the product they activate and the defaults in `gen_period_defaults`.

### 1.4 Audit log

Append-only `audit_log` table — every mutation across the system writes a row. From `BUILD_STACK.md` "Audit retention" decision. Schema: `(audit_id, school_id, actor_user_id, actor_role, action_type, entity_type, entity_id, before_jsonb, after_jsonb, reason, ip_address, user_agent, occurred_at)`. Indexed on `(school_id, occurred_at DESC)` for school admins reviewing recent activity, and on `(entity_type, entity_id)` for record-history lookups.

Retention policy: hot storage for 18 months in Postgres, cold storage in Supabase Storage (compressed JSON exports) for 5 years, then deletion. Build the hot table now; the cold-storage job comes later.

### 1.5 Anomaly rules

`ref_anomaly_rule` — shared between the Senior Vice Headmaster Academic progress view, the Oversight compliance queue, and any future surface that needs to surface "this thing looks off." Schema: `(rule_id, rule_code, severity, description, applies_to, threshold_jsonb)`. Seed with the rules from `SHS_SCORE_LEDGER_SPEC.md` Section 6.3 (teacher inactivity 14+ days, score-row blank at semester end, score went down without flagged reason, etc.) plus the Oversight anomaly rules from the Oversight specs.

### 1.6 Storage buckets

Supabase Storage buckets:
- `admissions-documents` (ID cards, transcripts, certificates uploaded during admission)
- `score-ledger-uploads` (Path B paper-ledger scans before OCR)
- `profile-photos` (student/staff photos — privacy-controlled per `BUILD_STACK.md` "Profile photos" decision)
- `receipts` (generated payment receipts as PDFs)

Each bucket has RLS policies tied to `school_id` and role. Don't make buckets public.

### 1.7 Seed Asankrangwa SHS

A seed script at `/db/seed/asankrangwa.ts` that populates:
- The school record (1,200 students, 720 boarders, 480 day, Western Region, Wassa Amenfi West, GES code WR-WAW-014)
- Period config: 2 semesters for 2025/26 from `gen_period_defaults`
- Headmaster V. Yanney, Vice Headmaster Academic Mrs P. Anim, Maths teacher Mr K. Owusu, Form Master Mr A. Mensah (Form 2 GA, also Aggrey House housemaster)
- 6 Houses (Aggrey, Guggisberg, Fraser, Slessor, Kingsley, Aryee)
- The student J. Manu (Form 2 General Arts, Aggrey House Dorm D bunk 03, bereaved per VLC narrative)
- The student Y. Aidoo (Form 3, WASSCE 2026 candidate, the predictor demo)

This seed is what every subsequent phase builds against. If the seed is broken, every demo is broken. Test it after each phase to make sure migrations haven't drifted from the seed shape.

**Reference:** `BUILD_STACK.md` Sections "Multi-tenancy," "Product tiers," "SHS data model — additions to MVP1 schema," and Decisions 1–11 in the architectural-decisions section. `SHS_SCORE_LEDGER_SPEC.md` Section 3.

**Done when:** `pnpm db:push` runs cleanly against a fresh Supabase project, the seed script populates Asankrangwa SHS without error, RLS policies prevent cross-school reads in tests, and the audit log records at least one write from a test mutation.

---

## Phase 2 · Landing page

**Goal:** The public marketing site at `omnischools.gh` is live. Schools can read the pricing, the FAQ, and sign up to be contacted. The unified onboarding wizard for self-serve sign-up is built in this phase because it's how schools first interact with the product.

**Prerequisites:** Phase 1 complete (the onboarding wizard writes to the `ref_school`, `ref_school_product`, and `ref_academic_period_config` tables created in Phase 1).

**Why this comes before the tiers:** The landing page doesn't depend on any tier-specific schema. It can ship and start collecting leads while the Basic tier is still being built. Schools that sign up via the wizard during Phase 3 will see "Basic features ready, Senior features coming soon" copy.

**Deliverables:**

### 2.1 Public marketing routes

Translate `omnischools-landing.html` into Next.js. The single HTML file (122/122 divs, 1424 lines) becomes:
- `/` — hero, value props, pricing, FAQ, footer
- `/about` — about the company (placeholder until commissioned photography lands)
- `/pricing` — pricing detail page (extracted from the landing's pricing section)
- `/faq` — FAQ detail page (extracted from the landing's FAQ section)

The hero photography (`img/hero-students.png`, `img/about-headmaster.png`) is currently AI-generated and pending replacement with commissioned shots — **outstanding item 4 on the user's list**. Use the existing placeholders for now and document the replacement path in code comments.

### 2.2 The unified onboarding wizard

From `BUILD_STACK.md` "Unified onboarding wizard" decision. A multi-step form at `/start` that captures:

1. School name, GES code, region, district
2. Product selection: Basic, Senior, or Combined (KG-through-SHS)
3. Headmaster name, phone (Ghana format), email
4. Initial admin user (creates a `ref_user` row + role assignment as ADMIN)
5. Confirmation screen showing the GES-default period config that will be seeded (3 terms for Basic, 2 semesters for Senior, both for Combined)

On submit:
- Creates `ref_school`, `ref_school_product`, `ref_academic_period_config`, and the dated `academic_period` rows (sourced from `gen_period_defaults`)
- Creates the admin user via Supabase Auth phone OTP
- Sends an SMS via Hubtel with a magic-link-style verification
- Triggers a Resend email to the founder (you, the user) flagging a new school sign-up for review

### 2.3 Lead-capture for "not ready to onboard yet"

A simpler `/contact` form for schools that want a conversation before signing up. Captures name, role, school, phone, message. Writes to a `marketing_lead` table (separate from `ref_school` — leads aren't tenants yet). Notifies the founder via email.

### 2.4 SEO and OG

Each public page has proper `<title>`, `<meta description>`, OpenGraph tags, and a `sitemap.xml`. The landing page is the most-visited surface and should rank for "school management system Ghana" queries.

**Reference:** `omnischools-landing.html` for visual spec. `BUILD_STACK.md` "Unified onboarding wizard" decision. `README.md` for the product positioning that informs the marketing copy.

**Done when:** The landing page renders pixel-close to the HTML spec, the onboarding wizard creates a new school end-to-end (verifiable by inspecting the database after a test sign-up), and the contact form delivers a lead notification to the founder's email.

---

## Phase 3 · Basic tier (KG · Primary · JHS)

**Goal:** A KG/Primary/JHS school can run their entire operation through Omnischools Basic — admissions, students, fees, attendance, gradebook, report cards, parent communication.

**Prerequisites:** Phase 1 (schema) and Phase 2 (onboarding wizard) complete. Schools can sign up; this phase gives them something to do once they're in.

**Why Basic before Senior:** Basic is the simpler product. The data model is the same shape as Senior minus the SHS-specific tables. Shipping Basic first proves the architecture, gets paying customers, and validates the multi-tenancy / RLS / auth flows before adding the much heavier Senior surface area.

**The Basic tier modules and their order:**

### 3.1 Admissions

Surface(s) to build: a public-facing application form (the school can share a link), an internal applications-review queue for admin, an approval workflow (decision = ACCEPT | REJECT | WAITLIST), document upload (uses `admissions-documents` storage bucket from Phase 1), and student-record creation on accept.

Schema additions: `admission_application`, `admission_document`, `admission_decision_audit` (links to `audit_log` from Phase 1).

Acceptance rule: every accepted applicant gets a unique student ID per the Section 3.1 admissions spec in the original product brief. Mandatory fields validated client-side and server-side. Audit log entry for every admin decision.

### 3.2 Student records (single source of truth)

The student profile is the central object. Schema: `student` (personal, academic, enrollment status), `student_parent_link` (parents/guardians, one student can have multiple), `student_health_record` (allergies, conditions, emergency contacts), `student_update_history` (which fields changed when, by whom — joins to `audit_log`).

Every other module reads from `student`. No duplicate student records anywhere. The data shape is the same across Basic and Senior; the SHS-specific extension columns (residency type — boarder, day, deboardinized) stay null for Basic students.

### 3.3 Fees and payments

Schema: `fee_structure` (per-grade fee config), `invoice`, `payment`, `payment_method` (cash, MoMo, bank). Mobile money reconciliation via Hubtel (Phase 4-equivalent feature; for MVP1 of Basic, log payments manually with a "reconciled via" field). Receipt generation as PDFs into the `receipts` Supabase Storage bucket.

Payment status reflects in real-time on the student record. Every transaction logged. Downloadable receipts available to parents via SMS link.

### 3.4 Attendance and timetable

Schema: `attendance_record` (per student × per day × per period), `timetable_slot` (per class × period × subject × teacher). Conflict detection at timetable creation. Daily attendance entered by class teacher; absences flag at threshold (configurable per school).

### 3.5 Gradebook and report cards (Basic — 3-term structure)

This is where the period config from Phase 1.3 first earns its keep. Basic schools have 3 terms; the gradebook is keyed by `(student_id, subject_id, period_id)` where `period_id` resolves to Term 1, Term 2, or Term 3 via `academic_period`.

Categories for Basic are simpler than the SHS 5-category structure: typically class score (continuous assessment, in-term work averaged) and exam score (terminal exam). Weighting is school-configurable — most JHS schools use 50/50 per BECE alignment.

Report cards generate at end of each term, downloadable as PDFs, send-able to parents via WhatsApp/SMS link.

### 3.6 Parent communication

SMS via Hubtel for announcements, fee reminders, attendance flags. WhatsApp Business API for richer messaging (deferred to MVP2 if Hubtel WhatsApp isn't ready — abstract behind the same SMS interface so swap is a config change).

Schema: `notification`, `notification_template`, `notification_delivery_log`.

### 3.7 Books and financial reports

Basic accounting surface — total fees collected, outstanding by class/level, monthly trends, exportable as CSV/PDF. Aimed at the bursar role.

**Reference:** The original product brief from your first message (Sections 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7) lays out the requirements. `BUILD_STACK.md` Decision 6 (multi-tenancy via `school_id`) governs the schema shape. `omnischools-landing.html` Basic pricing card lists the feature set.

**Done when:** A Basic-tier school can: (a) accept a student through admissions, (b) issue and collect a term's fees, (c) record daily attendance for a term, (d) input class and exam scores for a term, (e) generate and send report cards to parents, (f) close the term and roll to the next. End-to-end.

---

## Phase 4 · Senior tier (SHS)

**Goal:** An SHS can run their academic, boarding, sickbay, WASSCE, VLC, and PLC operations through Omnischools Senior. The score ledger is the centrepiece — every other Senior module either feeds it or reads from it.

**Prerequisites:** Phase 3 (Basic) is shipped and stable. Senior reuses the Basic admissions, students, fees, attendance, and parent-comm modules; this phase adds SHS-specific layers on top.

**Build order within this phase is non-arbitrary.** The score ledger comes first because every other SHS surface either depends on it or is mocked against the assumption that it exists. See `SHS_SCORE_LEDGER_SPEC.md` Section 11 (the 11-item build sequence) — that sequence governs sub-phases 4.1 through 4.4 below.

### 4.1 Score Ledger (the foundation of the Senior tier)

Follow `SHS_SCORE_LEDGER_SPEC.md` Section 11's 11-item build sequence exactly. Summarising the order:

**Item 0** (already shipped in Phase 1.3): `ref_academic_period_config`, `academic_period`, `gen_period_defaults`.

**Item 1:** The five-category SHS gradebook data model (`senior_score_ledger` keyed by student × subject × period × category) and the auto-compile Path A web UI. The five categories: assignments, mid-semester exam, end-of-semester exam, project work, portfolio. Weights configurable per (subject × school) via `ref_assessment_weights` (default 15/15/40/15/15 per the NaCCA standard).

**Item 2:** Path C — direct digital entry — same web UI as Path A but with blank cells the teacher fills in.

**Item 3:** Vice Headmaster Academic progress view — completion progress per teacher × class × subject, NOT score values (the score values stay the teacher's domain until the semester closes).

**Item 4:** Path B — scan and extract — verification-first OCR for teachers who photograph their paper ledger.

**Item 5:** PWA phase 1 — installable form factor, bad-connection handling, NOT full offline (per the design discipline in the spec).

**Item 6:** The Omnischools-branded paper ledger book — print artifact, optional, paired with Path B.

**Item 7:** Versioned upload + diff logic — handles mid-semester and end-of-semester upload sequences.

**Item 8:** STPSHS printable score sheet generator — the workaround for the WAEC regulator's no-bulk-upload constraint. This is **outstanding item 1** on the user's list (the WAEC ICTD call) — if WAEC opens an API, items 8 becomes a machine-to-machine integration instead of a printable PDF.

**Items 9, 10:** PWA phases 2 and 3 — local IndexedDB store, sync queue, full offline. **Reserved capacity, not v1.** Build only when real teachers in low-connectivity areas ask for it.

**Item 11:** The WAEC API conversation runs in parallel, on the user's timeline. Doesn't gate the build.

Surfaces to translate from HTML to Next.js: `schoolup-shs-score-ledger.html`, `schoolup-shs-score-ledger-pwa.html`, `schoolup-shs-vice-headmaster-progress.html`.

### 4.2 Boarding (7 surfaces)

After the score ledger is shipped, boarding is the next largest SHS module. From `BUILD_STACK.md` "Boarding · architectural decisions worth preserving" section.

Schema: `boarding_house`, `boarding_dormitory`, `boarding_bunk`, `student_residency` (BOARDER | DAY | DEBOARDINIZED), `exeat_request`, `exeat_approval`, `visiting_day_visitor_log`, `discipline_incident`, `discipline_bond`.

Surfaces: `schoolup-boarding-daily-life.html`, `-discipline.html`, `-exeat-management.html`, `-house-roster.html`, `-programme-setup.html`, `-resumption-day.html`, `-visiting-day.html`.

Key cross-module trigger: discipline incidents that breach a bond automatically generate an invoice line item (the "three times the boarding fee per unauthorised day" rule). This is one of the cross-module hooks that proves the architecture — discipline → billing without a manual handoff.

### 4.3 WASSCE cohort and readiness (5 surfaces)

From `BUILD_STACK.md` "WASSCE-readiness · architectural decisions worth preserving." The WASSCE-readiness predictor reads from the score ledger trajectory (6 semesters × 5 categories per student × subject) plus cohort historical Mock-to-WASSCE correlations.

Schema: `wassce_cohort`, `mock_exam`, `mock_score`, `wassce_subject_readiness` (predicted A1–F9 grade per student × subject), `wassce_aggregate_projection`.

Surfaces: `schoolup-wassce-cohort-readiness.html`, `-parent-tracker.html`, `-setup.html`, `-student-readiness.html`, `-subject-teacher.html`.

The student-readiness surface (986 divs, 1713 lines, 7 sections) is the heaviest in this module — Y. Aidoo deep-dive with STPSHS submission status panel, ledger trajectory grid, medical disruption banner, attendance/fees context strip. Build it last in the module; it pulls from every other table.

### 4.4 Sickbay (4 surfaces)

Schema: `sickbay_visit`, `sickbay_referral` (KATH tertiary, Wassa Akropong overflow, etc.), `chronic_register_entry`, `chronic_medication`, `nhis_card_record`.

Surfaces: `schoolup-sickbay-chronic-register.html`, `-referral-log.html`, `-setup.html`, `-today.html`, `-visit-record.html`.

Cross-module hooks: sickbay days flow into attendance as "M" (excused medical) rather than "A" (unauthorised absence). NHIS card expiry feeds the bursar's parent-SMS campaign.

### 4.5 VLC — Values Learning Communities (5 surfaces)

Pastoral module unique to SHS. From `BUILD_STACK.md` "VLC · architectural decisions worth preserving."

Schema: `vlc_value_module`, `vlc_session`, `vlc_session_attendance`, `peer_guide` (PG appointments, 2 cohorts per year per GES semesters), `pg_tenure`, `student_value_journal`.

Surfaces: `schoolup-vlc-peer-guides.html`, `-programme-setup.html`, `-school-dashboard.html`, `-session-register.html`, `-student-journal.html`.

The peer guide tenure cycle remodel from this session (2 cohorts per year aligned to GES semesters) is encoded in the surfaces — translate the surfaces faithfully; the tenure cycle logic is already correct.

### 4.6 PLC — Professional Learning Communities (2 surfaces)

Teacher CPD module — NTC-mandated 20 CPD points per teacher per year, of which 8 must come from school-based PLCs. From `BUILD_STACK.md` "PLC/CPD · architectural decisions worth preserving."

Schema: `plc_group`, `plc_session`, `plc_attendance`, `plc_cpd_point_credit`, `teacher_cpd_balance` (annual).

Surfaces: `schoolup-plc-programme-setup.html`, `-session-register.html`.

### 4.7 Forms and PTA (Form Master surfaces)

Form Master role — the teacher who shepherds a Form-class through the academic year, ↔ the housemaster for boarders. From `BUILD_STACK.md` "Forms/PTA · architectural decisions worth preserving."

Schema additions: `form_class` (Form 1 GA A, Form 2 Science, etc.), `form_master_assignment` (which teacher owns which form class), `pta_meeting`, `pta_meeting_attendance`, `pta_dues_invoice`.

The cross-module hook here: the Form Master sees their form-class's score ledger, attendance, fees, sickbay, and VLC records in one unified surface — the single-pane-of-glass for the pastoral role.

**Reference:** `SHS_SCORE_LEDGER_SPEC.md` (the most detailed spec in the repo). `BUILD_STACK.md` Sections "Score Ledger / VLC / Boarding / Sickbay / WASSCE-readiness / PLC / Forms · architectural decisions worth preserving." `STPSHS_INTEGRATION_SPEC.md` for the WAEC regulator handoff. `SSP_INTEGRATION_SPEC.md` for NaCCA's SSP positioning (Omnischools doesn't compete with SSP; it links out).

**Done when:** Asankrangwa SHS can: run a full Semester 2 through the system, capture scores via Path A/B/C, the Vice Headmaster sees progress without seeing values, the WASSCE-readiness predictor produces aggregate-10 projection for Y. Aidoo from real ledger data, boarding/sickbay/VLC/PLC modules all read from the same student records.

---

## Phase 5 · Oversight tier

**Goal:** GES district directors, regional directors, and MoE national staff can monitor school compliance and aggregate performance without seeing raw student records. Schools opt in to data sharing (or are required to, for public schools); private schools require explicit consent.

**Prerequisites:** Phase 4 (Senior) shipped and at least 10 schools using Basic or Senior operationally. Oversight without operational data is hollow.

### 5.1 Provision the analytics database

A second Supabase project: `omnischools-analytics-prod`. **Don't provision this earlier than 3 months before Oversight launch** — per `BUILD_STACK.md` "Product tiers — three products, one codebase, two databases." Operational complexity scales with what you've provisioned; defer.

### 5.2 ETL pipeline

A nightly job (Vercel Cron or Supabase Edge Function, runs at 02:00 GMT) that:

1. Reads from operational Postgres
2. Computes school-scoped aggregates (attendance rates, score ledger completion, fee collection, WASSCE projections, anomaly counts)
3. Writes to analytics Postgres into `fact_*` tables
4. Excludes schools that haven't opted in to GES data sharing (`ges_data_sharing_agreement` table per school × consent date × scope)

Schema in analytics DB: `fact_performance_internal` (per-school × per-period × per-category SHS scores), `fact_attendance` (per-school × per-day aggregate), `fact_compliance` (anomaly counts, late submissions, etc.), `dim_school`, `dim_district`, `dim_region`.

Reference: `OVERSIGHT_ANALYTICS_SPEC.md` for the analytics schema.

### 5.3 Oversight Next.js app

Separate Next.js app in the same monorepo (or sub-route): `oversight.omnischools.gh`. Separate auth — GES staff accounts via email/password (these aren't school admin accounts).

Jurisdiction-aware RLS on the analytics DB:
- District directors: `WHERE district_id = current_setting('app.current_district')`
- Regional directors: `WHERE region_id = current_setting('app.current_region')`
- MoE national: no filter

13 surfaces to translate (already designed): `schoolup-oversight-*.html`. The Oversight build is mostly translation work since the design is settled and all 6 scoping decisions are resolved (see `OVERSIGHT_ANALYTICS_SPEC.md`).

### 5.4 Compliance and anomaly queue

The Oversight compliance queue reads from the same `ref_anomaly_rule` table seeded in Phase 1.5. District directors see anomalies for their district's schools; regional for their region; national for everything. Anomalies are not actionable from the Oversight app — they're observational. The Oversight director contacts the school out-of-band.

**Reference:** `OVERSIGHT_ANALYTICS_SPEC.md`. `BUILD_STACK.md` "Oversight product line · architectural decisions worth preserving" (covers all 6 scoping decisions). The 13 `schoolup-oversight-*.html` surfaces in `/mnt/user-data/outputs/`.

**Done when:** A district director can log in, see the schools in their district, view aggregate attendance/performance/compliance for the district, drill into a specific school's compliance record, and never see a single student's name or score.

---

## Reference map · which MD file for which subsystem

| Subsystem | Primary reference | Secondary reference |
|---|---|---|
| Stack choices, decisions | `BUILD_STACK.md` | — |
| Score Ledger (Senior) | `SHS_SCORE_LEDGER_SPEC.md` | `BUILD_STACK.md` Decision 8 (period config) |
| STPSHS / WAEC handoff | `STPSHS_INTEGRATION_SPEC.md` | `SHS_SCORE_LEDGER_SPEC.md` Section 8.1 |
| SSP / NaCCA | `SSP_INTEGRATION_SPEC.md` | — |
| Oversight analytics | `OVERSIGHT_ANALYTICS_SPEC.md` | `BUILD_STACK.md` "Product tiers" |
| Product positioning | `README.md` | `omnischools-landing.html` |
| Visual / UI spec | The 50+ `schoolup-*.html` files | — |
| This document | `INSTRUCTIONS_FOR_CLAUDE_CODE.md` (you are here) | — |

---

## What to flag and stop on

You should pause and ask the user before:

1. **Provisioning external services** (Supabase project, Vercel project, Hubtel account, Resend account, Sentry/PostHog projects). The user pays for these and needs to approve.
2. **Making schema decisions not covered by `BUILD_STACK.md`.** The architecture is settled; deviating from it requires the user's explicit sign-off.
3. **Spending more than 1 hour blocked on the same issue.** Surface it, propose 2–3 paths, let the user choose.
4. **Touching production data.** All test runs hit a separate Supabase project; production is the user's call.
5. **Anything the user has flagged as outstanding** (WAEC ICTD call, domain registration, trademark, photography, pricing validation). Don't try to substitute for these — they require the user's involvement.

What you can do without checking in:

1. Install packages, scaffold files, write tests, run migrations against the development database, refactor your own code, commit and push to a branch (never to `main`).
2. Read and reference any file in `/mnt/user-data/outputs/`.
3. Translate HTML surfaces into Next.js components — the design is settled; just port it faithfully.

---

## A note on faithfulness to the design system

The 50+ HTML surfaces represent multiple sessions of design work. Every colour, type weight, spacing, copy choice, anomaly label, and cross-module reference is intentional. When porting them:

- **Don't simplify the copy.** The surfaces are written in a deliberately Ghanaian-school-operations voice (Form Master, Vice Headmaster Academic, Padre, Aggrey House, GHS, "Free SHS," WASSCE, BECE, NHIS card). The voice is the product.
- **Don't substitute icons or imagery without checking.** The brand is text-forward by design — Fraunces italic gold for accents, no emoji, no stock illustrations.
- **Don't refactor the cross-module hooks.** Discipline → billing, sickbay → attendance, score ledger → STPSHS export, ledger trajectory → WASSCE predictor — these aren't accidents of layout, they're architectural commitments.
- **The audit log is mentioned everywhere because every mutation writes to it.** Don't skip the audit write to "ship faster" — the audit log is what makes Omnischools defensible to GES, parents, and the schools themselves.

If a phase's HTML surface says one thing and a spec MD file says another, the spec wins on logic and the HTML wins on visual presentation. They were written iteratively and any drift is in the surfaces, not the specs.

---

## Closing

Build in order: Phase 0 → 1 → 2 → 3 → 4 → 5. Within each phase, follow the sub-order. When you finish a phase, commit, deploy to staging, and ask the user to confirm before starting the next.

The whole product is roughly 12–18 months of solo-dev work. Phases 0–2 are ~2 months. Phase 3 is ~3–4 months. Phase 4 is ~6–9 months (the score ledger alone is 2–3 months). Phase 5 is ~2 months once the operational data exists. The user knows this; don't try to compress unrealistically.

When in doubt, read the relevant MD file. When still in doubt, ask the user.
