# Owner TODO — actions only you can do before go-live

Everything here is assigned to **you**, not to the build loop. It is work that needs your credentials,
your data, your judgement, or your eyes on a real browser. Items already queued for me to build in a
later increment are deliberately **not** listed.

Last updated: 2026-07-21 (after INCR-20 — Module 4.3 WASSCE readiness complete, PR #170 merged).
Note: INCR-19b and INCR-20 added **no** new `prod-paste-*.sql` — the paste count in item 1 still stands at 28.

---

## MUST DO — go-live is unsafe without these

### 1. Verify every prod RLS paste has actually been applied
**Why it matters:** `db:policies` only configures local dev. On prod, RLS is applied **only** by hand-pasting
`db/sql/prod-paste-*.sql`. A single missed file means those tables have **no tenant isolation on prod** —
one school reads another school's children's data. This is the highest-severity item on the list.

There are **28** paste files (`prod-paste-0029-*` … `prod-paste-0055-*`). You've been running them per
increment, but nothing has verified the full set end-to-end.

> **This is not hypothetical.** During INCR-19a the security gate found `student_health_record` (blood
> group, allergies, medications) had been missing from the dev policy file since migration 0036 — RLS
> **off on dev**. Prod turned out safe (you confirmed `prod-paste-0036` was run), but that was luck of
> discipline, not a guarantee. The query below is exactly what surfaces this class of gap. Run it.

**▶ Use the script: `db/sql/verify-prod-rls.sql`** (read-only, `SELECT` only, safe on prod). Open the
Supabase SQL editor on the **prod** project and run its **Query 1** (problem report — *zero rows = pass*),
then **Query 2** (confidence summary — proves the check actually saw your data; a zero-row pass means
nothing if it scanned zero tables). The script checks three things, two of which the inline query below
does *not*: that `tenant_isolation` is PERMISSIVE, that every forced tenant table carries a **RESTRICTIVE**
`parent_scope`/`parent_deny` (a PERMISSIVE one would OR with `tenant_isolation` and expose the whole
school to a claimed parent), and that the 3 global reference tables are bare-ENABLE. Validated against dev:
0 problems, 87 tenant tables, 9 parent-readable + 78 denied, 3 global.

**Quick inline version (the headline leak check only — run on prod, expect ZERO rows):**
```sql
-- Any tenant table (has school_id) that is missing FORCE RLS or its policy:
SELECT c.relname,
       c.relrowsecurity  AS rls_enabled,
       c.relforcerowsecurity AS rls_forced,
       (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r'
   AND EXISTS (SELECT 1 FROM pg_attribute a
                WHERE a.attrelid = c.oid AND a.attname = 'school_id' AND NOT a.attisdropped)
   AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity
        OR (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) = 0);
```
Anything returned is a leaking table — paste the matching `prod-paste-*.sql` for it.

> Note: global reference tables (`universities`, `university_programmes`, `benchmark_reference`) are
> *correctly* `ENABLE` without `FORCE` and without a policy. They hold no tenant data. The query above
> only flags tables that have a `school_id`, so it won't false-positive on those.

---

### 2. One manual check before ship — click the WASSCE target write flow in a real browser
Neither I nor Quinn had a browser-driving tool available, so the **write path was verified at the action
boundary only** (role gates, real constraint dispatch, audit writes, tenant re-validation) plus the read
path end-to-end. The actual click was never performed.

**Do this once:** open a candidate's readiness page → **§6 University match** →
- click **"+ Add programme"** and tag a programme → confirm the tile appears with the right tier badge,
- change a target's rank to first choice → confirm the badge flips to **TARGET**,
- **remove** a target → confirm it disappears and the header tally re-counts.

Also worth an eyeball while you're there: the roster avatar tint on the WASSCE registration page. It had
been silently missing since INCR-16 (a Tailwind scanning gap fixed in INCR-17b) and has never been seen
rendered.

**And (INCR-19a):** on a student profile → guardian list, click **"Invite to parent portal"**. No browser
tool here could drive it end-to-end; the writes it performs (the invite, and the guardian→user stamp on
accept) are proven by the DB deny-suite, but the button-to-action path itself was never clicked.

**And (INCR-19b):** log in as a **real claimed parent** and eyeball the portal at `/wassce`. No tool here
could drive an authenticated-parent browser session (dev-bypass is ADMIN; no persistent seeded claimed
parent), so the data path is proven only by the rolled-back-fixture boundary script + copy tests. Confirm
while you're there that the parent sees **no** cohort-tier band vocabulary on screen *or* in the downloaded
statement PDF, and that the acknowledgement line reads "recorded by the school · confirmed by phone".

---

### 3. Patch the 3 high-severity dependency vulnerabilities — ✅ FIXED, awaiting merge
**Resolved in `6ff15c3`.** All three were transitive **dev-only** advisories under `eslint` /
`eslint-config-next` (`brace-expansion` ×2 DoS, `js-yaml` quadratic CPU) — none shipped in the production
bundle, so the practical exposure was a DoS against your own linter. Fixed with pnpm `overrides` pinning
`brace-expansion` to 1.1.16 / 5.0.7 and `js-yaml` ≥4.3.0. `pnpm audit` is now clean; lint, 485 tests, and
the production build all pass. **The GitHub badge will not clear until this merges to `main`** (Dependabot
rescans the lockfile there). Root cause is `eslint: "^8"`; the permanent fix is ESLint 9, but that is a
flat-config migration and not worth it for three dev-only advisories.

<details><summary>Original item</summary>
GitHub Dependabot flags **3 high** vulnerabilities on `main` (`github.com/Omnischools/omnischools/security/dependabot`).
None were introduced by the senior-tier work — they're in the existing dependency tree — but they should be
triaged and patched before go-live. Run `pnpm audit`, review each, and bump the affected packages (or apply
Dependabot's suggested PRs). Flagging here because it's a standing security item, not something the build loop
resolves on its own.
</details>

---

### 4. Run the PWA phase-2 offline self-verify (Score Ledger Item 9)
Cannot be automated in a node test runner — it needs a real device/browser with DevTools. Checklist:
1. Go offline → enter a full class's scores → **close and reopen the app while still offline** → scores
   present and **gold** (held), none showing as saved.
2. Reconnect → auto-flush → all green; flush a second time → **no duplicate rows**.
3. Enter a deliberately invalid score → **red** → close/reopen → **still red**.
4. Log out teacher A → A's pending scores and rosters gone from **both** IndexedDB and the SW cache.
5. Log in teacher B on the same tablet → B sees **none** of A's held scores.

---

### 5. Supply the real data that is currently placeholder
These render to parents/teachers as if authoritative. All are seeded snapshots or constants right now.

| Item | Current state | What's needed |
|---|---|---|
| WAEC **national** benchmark figures | seeded constant | real published figures |
| **Regional** benchmark | seeded, marked `DIRECTIONAL` (± 4–5 pp) | real figures, or keep it explicitly directional |
| Mock **predictive-accuracy** figure (73–82%) | display constant, shown publicly | confirm the number + who updates it annually |
| **University cut-offs** | published **2025** snapshot, 16 programmes, each stamped with its year | refresh for the live admission cycle before parents rely on it |

---

### 6. Decide on Hubtel SMS — nothing sends until you provision it
Every SMS chain is built and wired but **degrades to console**: boarding late-return/overdue reminders,
exeat notifications, visiting-day notices, and the WASSCE parent-acknowledgement OTP. No real message has
ever been sent and no credentials exist.

**To go live:** provision `HUBTEL_CLIENT_ID` / `HUBTEL_CLIENT_SECRET`. **Until you do, treat any feature
described as "notifies the parent" as not actually notifying anyone.** Tell me before you provision —
there's one code change I want to land first (moving the overdue-chain sends outside their DB transaction)
so a slow SMS gateway can't hold a transaction open.

---

### 7. Provide the real brand mark
The Omnischools-branded paper ledger book (Score Ledger Item 6) ships with a placeholder mark. It prints
and goes home with students, so it needs the real asset before anything is printed at scale.

---

## SHOULD DO — decisions I need from you (none block the current build)

### 8. Boarding: enable the 3× fee penalty → invoice write?
Deliberately **stubbed** at your instruction ("build all of INCR-13 except the invoice write"). The
deboardinization ladder computes the penalty but **writes no invoice**. Decide whether it should post to
billing for real, and I'll wire it.

### 9. Confirm the university cut-off source
I defaulted to a **seeded published snapshot** as global reference (updatable per admission cycle, like the
benchmark figures) because it ships without an external dependency and stays portable. The alternatives
were school-entered, or a licensed/maintained dataset feed. Say the word if you'd rather switch.

### 10. Admission-accurate aggregate — refine or leave?
The projection uses the **pure best-3-cores** rule (matches the spec and the surface's own visualizer).
Real Ghanaian *university admission* fixes **English + Core Maths as mandatory** cores. These differ only
when English or Core Maths is a candidate's *worst* core — not the case in any demo data. The concern is
already encoded as a **prerequisite** (every programme requires credits in both), so the practical risk is
small. Decide if you want the stricter variant for cut-off matching.

### 11. Boarding visiting day: public tokenised parent RSVP link?
Deferred earlier. Today visiting-day RSVPs are **staff-entered**. A public tokenised link would let parents
RSVP themselves — a different security surface (public endpoint, token lifetime) that needs your call.

### 12. Marketing copy honesty
`components/marketing/faq.tsx` still says **"offline-first"**. That claim is on the forbidden list for the
shipped PWA (single-device, sync-on-reconnect — *not* offline-first, *not* multi-device). It predates this
work and wasn't touched. Tell me the wording you want and I'll change it.

### 13. Sync the design mockups in `Surfaces/`
Those files are yours and untracked, and two have drifted from what shipped:
- `schoolup-shs-score-ledger-pwa.html` — the Phase-2 roadmap card still reads "later · trigger = real
  demand"; it **ships now**. The section meta and honesty caption need the same graduation.
- `schoolup-wassce-subject-teacher.html` — a **"Mark Mock 3 papers"** button contradicts the ratified
  two-mock model ("we stop at two"); recommend relabelling to Mock 2.

### 14. Consider CI for the migration chain
There is **no CI that replays migrations from empty**. Ordering bugs are therefore invisible until a prod
deploy or a fresh onboarding — this has already bitten once (migration 0033 emitted foreign keys before the
unique constraints they referenced, and drizzle swallowed the error). I verify each new migration against a
throwaway database by hand, but that only covers migrations I author. A CI job running
`db:migrate` from empty would catch it permanently.

---

## Standing process note

**Every future increment that adds a tenant table produces a new `prod-paste-*.sql` that you must paste on
prod by hand.** It is not automated and not covered by CI. If you ever merge an increment without running
its paste, that increment's tables leak across schools until you do.
