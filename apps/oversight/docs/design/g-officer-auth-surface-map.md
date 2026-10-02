# Increment G — Officer auth + provisioning surfaces · design map

**Author:** Lucy (design cartographer) · **Status:** build-ready spec · **Branch:** `claude/oversight-officer-auth`
**Scope:** the Oversight GES-officer authentication surfaces (sign-in, mandatory MFA enrol + challenge, post-sign-in landing + identity strip, sign-out), the four non-happy-path identity states (unprovisioned, deactivated, session-expired/idle, §6 step-up), and the Omnischools-operated admin **provisioning** console.
**This is the increment that turns `getOfficerSession()` real.** Today `apps/oversight/lib/auth/index.ts` returns a NATIONAL dev shim (`AUTH_DEV_BYPASS=true`) or `null` (fail-closed). G replaces that with a real Supabase-Auth session, and the shell stops reading fallback `"Not signed in"` / `"—"` / `"Ghana Education Service"` and reads a real officer + jurisdiction + tier.

**Audited sources (settled visual spec — port 1:1):**

- `Surfaces/schoolup-oversight-onboarding.html` (562 lines) — **the first-sign-in mock**: the deep-navy sign-in frame + white sign-in card + OTP boxes + "provisioned-by" panel, and the 5-step vertical onboarding wizard (verify identity → confirm jurisdiction → access briefing → acknowledge terms → enter dashboard). This is the direct source for G1–G2.
- `Surfaces/schoolup-oversight-compliance-record.html` — the §6 gate whose SUBMIT the G7 step-up intercepts.
- `Surfaces/schoolup-oversight-access-audit.html` — the append-only audit idiom the provisioning-audit log (G8) mirrors.

**Companion shipped code to reuse (do not re-decide):**

- `apps/oversight/styles/tokens.css` — the only colour source. **Never hardcode hex.**
- `apps/oversight/components/oversight/primitives.tsx` — `Panel`, `Pill` (tones `gold|green|terra|warn|navy|muted`), `Banner` (tones `warn|gold|green|navy`), `Provenance`, `RecField`, `ScopeLine`.
- `apps/oversight/components/oversight/shell.tsx` — `Shell`, `PageHead`, `PageBody`.
- `apps/oversight/lib/auth/index.ts` — `OfficerSession`, `getOfficerSession()`, `requireOfficerSession()`.
- `apps/oversight/db/schema/_enums.ts` — `jurisdictionLevelEnum = [SCHOOL, DISTRICT, REGION, NATIONAL]`.

> **Tone reminder (institutional, not consumer).** This is a GES/MoE government tool. No emoji, no stock illustration, no icon substitution — glyphs are typographic (`✓`, `→`, `⊘`, `⛓`, `P`, `!`) inside styled badge boxes. Fraunces (`font-display`) with **italic gold `em`** accents for headings; Manrope for body; JetBrains Mono for ids/codes/timestamps. Failure states are **non-blaming and calm**: gold-informational, never terra/destructive, for a person who has done nothing wrong (unprovisioned, deactivated, session-expired). Terra is reserved for genuine error/destructive intent.

---

## 0. Global chrome & tokens (shared by every G surface)

All colour maps to `tokens.css` vars bound to Tailwind classes in `tailwind.config.ts`. Reuse the same token table documented in `e3-drilldown-surface-map.md §0` — it is unchanged. The classes G leans on most:

| Role | Tailwind class(es) |
|---|---|
| Deep-navy chrome (sign-in frame, sidebar, "you are inside the audited tier") | `bg-navy-deep` / `text-bg` |
| Body text / primary CTA | `text-navy` / `bg-navy text-bg` |
| Secondary / muted / meta | `text-navy-2` / `text-navy-3` |
| Gold accent (italic `em`, locks, active step, crest letter) | `text-gold` / `bg-gold` / `border-gold-soft` / `bg-gold-bg` |
| Calm informational surface (unprovisioned/deactivated/expired alerts) | `Banner tone="gold"` → `bg-gold-bg border-gold-soft` |
| Page / card surfaces | `bg-bg` / `bg-surface` |
| Success (set-up complete, approval confirmed) | `text-green` / `bg-green-bg` / `Banner tone="green"` |
| Warning (step-up prompt, pending approval) | `text-warn` / `bg-warn-bg` / `Banner tone="warn"` |
| Error / destructive (wrong code, deactivate action) | `text-terra` / `bg-terra` / `bg-terra-bg` |
| Radius: inputs/cards `rounded-md|lg`; pills `rounded-pill`; sign-in card `rounded-[18px]` (mock) | — |

**The deep-navy sign-in frame is meaningful, not decorative.** Per the onboarding mock's note: "A GES officer signing into Oversight should feel they are entering the government oversight tool, not a school's app." Keep the full-bleed gradient `navy-deep → navy → navy-2` frame with two faint gold radial circles behind a centred white card. It is the same deep navy used by the sidebar, the §6 record-head and the append-only banner — the visual signal of the audited/named tier. Port the gradient as a token-bound utility (`from-navy-deep via-navy to-navy-2`), not a literal hex.

**Fonts** are wired via `--font-display` / `--font-body` / `--font-mono` (see `tailwind.config.ts`); `.accent-italic` is the existing utility for the gold-italic `em` (used in `app/page.tsx`, `shell.tsx`).

---

## PART A — The settled sign-in visual (ported 1:1 from the onboarding mock)

These elements are the design that G must preserve. The **mechanism underneath changes** (phone-OTP → Supabase Auth + mandatory MFA — see the Owner-ratify list, item R1), but the following chrome, copy, and the provisioning model it encodes are settled.

### A.1 — The sign-in frame + card (mock §01)

- **Frame:** full-viewport deep-navy gradient, centred, min-height tall; two low-opacity gold radial circles (decorative, `aria-hidden`). Browser-bar URL in the mock: `oversight.omnischools.gh / sign-in`.
- **Card** (`bg-surface`, `rounded-[18px]`, `max-w-[480px]`, `shadow-xl`, generous padding):
  - **Crest row:** a `44px` navy square with gold Fraunces `GES`, beside two lines — `Omnischools Oversight` (Fraunces 16) / `GHANA EDUCATION SERVICE` (9px, uppercase, `tracking-[0.14em]`, `text-navy-3`).
  - **Heading** (Fraunces 24): *"Welcome, **Director.**"* — the word *Director* is the gold italic `em`. (Owner-ratify R6: the salutation is role-specific; for a regional director / national officer it should read the officer's own tier noun, not always "Director".)
  - **Sub:** *"Your Oversight account has been created by the GES Oversight administrator. Sign in with the phone number on your GES appointment record to continue."* — **revise for G's mechanism** (R1): if G uses Supabase email/OTP, this reads the registered channel; if it keeps phone-OTP as the first factor, it stands verbatim.
  - **The "provisioned-by" panel** (`.provisioned-by` — gold `P` mark in a square + text) is **the load-bearing, keep-verbatim element.** Copy: *"This account was provisioned on **{date}** by **{provisioner name}, GES Oversight Administrator ({tier})**, and bound to the **{jurisdiction}** jurisdiction. You did not register it and you cannot change its role or jurisdiction — both are set by GES."* It makes the provisioning model visible on day one and ties directly to G8's provisioning-audit history (same facts, officer-facing).
  - **There is NO "create account" / "sign up" / "forgot password → self-serve" link anywhere.** The absence is the design carrying BUILD_STACK Decision 5: Oversight officers are a GES-provisioned pool, never self-registered. First sign-in is *verification*, not registration. Recovery routes to the administrator, never to self-service.

### A.2 — The 5-step first-sign-in wizard (mock §02–§03)

Canonical vertical step-nav (`.ob-steps`): deep-navy-free white shell, left rail of steps (done = gold `✓`, active = gold number, pending = muted number + sub-label), right `.ob-main` panel. The five steps, verbatim labels:

1. **Verify identity** — sub *"GES phone & code"* → becomes *"GES credentials & MFA"* under G (R1).
2. **Confirm jurisdiction** — sub = the jurisdiction name. Panel: eyebrow *"Step 2 of 5 · confirm jurisdiction"*, h *"This is the jurisdiction **you oversee.**"*, lede *"Your account was bound to one jurisdiction when GES created it. Confirm it is correct. If it is not, stop here and contact your GES Oversight administrator — you cannot change it yourself."* A `jur-card` tagged **"GES-set · locked"** with the jurisdiction name + meta (`Municipal District · Western Region · capital Asankrangwa`) + a 4-stat detail grid (**Tier** / Schools in district / On Omnischools / District population · 2021 GSS). Acknowledgement box (gold `✓`) stating scope in plain words. Buttons: ghost **"This is not my jurisdiction"** (escape hatch to the administrator — NOT a picker) + gold **"Yes, continue to briefing →"**.
3. **Access briefing** — h *"What Oversight access **means.**"*, four numbered `brief-item` points (verbatim in the mock, lines 491–518): (1) you see schools on Omnischools; (2) almost everything is aggregate; (3) named records need a stated reason; (4) your activity is reviewable within GES. These are the trust model taught on day one — keep verbatim.
4. **Acknowledge terms** — the specific (non-blanket) acknowledgement: *"I understand that my Oversight access is **scoped to {jurisdiction}**, that **named-record access requires a logged justification**, and that **my activity is reviewable by GES regional, national, and internal-audit staff**."*
5. **Enter dashboard** — `welcome-card` (green `✓`): *"You're set up, **Director.**"* / *"Your account is active and bound to **{jurisdiction}**. Your dashboard is ready — **{N} schools, {N} pupils**, the {year} academic year. Welcome to Omnischools Oversight."* Buttons: ghost *"Review briefing again"* + gold *"Enter my {tier} dashboard →"*.

> **G reconciliation:** MFA **enrolment** (G1.b) is inserted as a sub-step of **step 1 (Verify identity)** on a first-ever sign-in, *before* step 2. It is not a new top-level wizard step — it belongs to identity verification. The wizard (A.2 steps 2–5) is a first-sign-in-only flow; returning officers skip straight from sign-in+MFA-challenge to the landing (G2). Whether onboarding steps 2–5 persist a per-officer "onboarded_at" so they show exactly once is an implementation detail (the acknowledgement in step 4 is the one with a compliance reason to be recorded — see R7).

---

## PART B — Surface specs (the eight G states)

Each is described as layout + copy + interaction states. No React. Reuse `Shell`/`PageHead`/`PageBody` and the primitives unless a surface is pre-auth (sign-in, step-up) where the deep-navy frame replaces the shell.

### G1 — Sign-in (Supabase Auth · MFA mandatory)

**Route:** `/sign-in` (pre-auth; rendered inside the A.1 deep-navy frame, **no `Shell`** — there is no officer yet, so no identity strip and no nav). Unauthenticated access to any `(oversight)` route redirects here; an already-authenticated+provisioned officer hitting `/sign-in` redirects to the landing (G2).

**G1.a — Primary-factor sign-in.** The A.1 card. Primary factor per R1 (owner-ratify). Field(s) styled as the mock's `.field-input` (JetBrains Mono, `bg-bg`, `border-border-2`), label `.field-label` (10px uppercase gold-less `text-navy-3`). Primary CTA: gold full-width **"Verify & continue →"**.

Interaction states:
- **default:** channel field pre-filled + locked where the account is bound to a GES-held channel (mock: `+233 24 ··· ·· 91`, masked); CTA enabled when the factor is complete.
- **submitting:** CTA label → *"Verifying…"*, disabled.
- **error — bad credentials:** inline terra line under the field: *"That didn't match. Check the code GES sent and try again."* (authored, R8). No account enumeration — identical copy whether the identifier exists or not.
- **rate-limited / lockout:** gold (not terra) `Banner`: *"Too many attempts. For your security, sign-in is paused for a few minutes. If you've lost access to your device, contact your GES Oversight administrator."* (authored, R8).
- **no link to self-recovery** anywhere (A.1).

**G1.b — MFA enrolment (first-time officer).** MFA is **mandatory**: an officer with no enrolled factor cannot reach the app. Shown as the enrol sub-step of wizard step 1 (A.2), inside the sign-in frame. Supabase Auth TOTP: the app calls `mfa.enroll` → renders the factor.

Layout (same white card idiom): eyebrow *"Step 1 · secure your account"*; h (Fraunces) *"Set up your **authenticator.**"*; lede (authored, R8): *"Oversight requires a second factor every time you sign in. Scan this code with an authenticator app (Google Authenticator, Microsoft Authenticator, or similar), then enter the 6-digit code it shows to confirm."* Then:
- a `bg-surface` bordered panel with the **QR code** (from Supabase `totp.qr_code`) + a monospace **manual secret** (`totp.secret`) in a copyable `.field-input` for officers who can't scan;
- a note: *"Keep this app — you'll use it at every sign-in and whenever you open a named record."* (ties forward to G7);
- the **6-digit confirm input** reusing the mock's `.otp-row` of six `.otp-box` cells (`aspect-ratio:1`, Mono 20px; `filled` = `border-gold bg-gold-bg`, `cursor` = `border-navy`);
- gold CTA **"Confirm & continue →"** (`mfa.challenge` + `mfa.verify`).

Interaction states: **default** (CTA disabled until 6 digits), **verifying**, **error** (terra line *"That code didn't verify. Codes expire quickly — enter the current one."*), **success** → advance to wizard step 2 (A.2).

> **No recovery-codes self-flow by default.** If Supabase recovery codes are offered, present them once on a post-enrol confirmation panel with copy *"Save these somewhere safe. Each code signs you in once if you lose your authenticator."* — but whether recovery is self-service or administrator-reset is **R2 (owner-ratify)**: consistent with A.1's no-self-service posture, the safer default is administrator reset.

**G1.c — MFA challenge (returning officer).** After the primary factor on every sign-in. Same card, h *"Enter your **code.**"*, lede *"Open your authenticator app and enter the current 6-digit code."*, the `.otp-row` six-box input, gold CTA **"Verify & continue →"**. States mirror G1.b (default/verifying/error). On success → landing (G2) if provisioned; else → G4/G5. No "remember this device / skip MFA" option — MFA is every-session (R3 covers how this interacts with the G6 idle/absolute timers).

### G2 — Post-sign-in landing + shell identity strip

**Landing route:** `/` (the dashboard — `app/page.tsx` today). G does not redesign the dashboard; it changes what the **shell** reads. A returning, provisioned officer lands here directly; a first-ever officer lands here only after completing the A.2 wizard.

**The identity strip (the core G change to `shell.tsx`).** Today the `(oversight)/layout.tsx` passes fallbacks (`"Not signed in"` / `"—"` / `"Ghana Education Service"`). G wires it to the real session from `getOfficerSession()`:

| Shell slot (today) | G value | Source |
|---|---|---|
| Crest sub-line under "Omnischools Oversight" | jurisdiction name | `session.jurisdictionName` |
| "Your jurisdiction" scope-chip body | jurisdiction name (+ meta where available) | `session.jurisdictionName` |
| Footer name | real officer name | `session.displayName` |
| Footer role | human role label | `session.officerRole` → display label |
| **NEW — tier** | tier badge beside/under the name | derived from `session.level` |

- **Tier display:** add a small `Pill tone="gold"` (or a line) reading the tier noun derived from `level`: `DISTRICT → "District"`, `REGION → "Region"`, `NATIONAL → "National · Ministry of Education"`. `SCHOOL` never occurs for an officer (there is no SCHOOL-tier officer — see G8 and the cross-module list). The crest sub-line and scope-chip already show "Ghana Education Service" at district/regional tier vs "Ministry of Education" at national tier per `e3 §0`; keep that distinction — at NATIONAL the sub-line reads *"Ministry of Education"*, below that tier *"Ghana Education Service"*.
- **Role label:** `session.officerRole` is a code-ish string (e.g. `NATIONAL_OVERSIGHT`). Render a human label — map `DISTRICT → "District Director"`, `REGION → "Regional Director"`, `NATIONAL → "National Oversight · MoE"` (R6: confirm the exact role nouns GES uses; the onboarding mock uses "District Director" and "GES Oversight Administrator (National)").
- **Footer** keeps *"Powered by **Omnischools**"* (existing `.accent-italic`).
- **NEW — account menu / sign-out affordance** lives in the footer identity block (G3).

The landing itself needs **no new banner** for a normally-provisioned officer. (The first-sign-in `welcome-card` lives in the A.2 wizard, not here.)

Interaction states of the strip: **normal** (all three identity facts present). There is deliberately **no "Not signed in" fallback rendered to a user** post-G — an unauthenticated request never reaches the shell (it redirects to G1), and an authenticated-but-unprovisioned request renders G4 *instead of* the dashboard (the shell may render with name present but jurisdiction/tier shown as "Pending set-up" — see G4).

### G3 — Sign-out

**Affordance:** in the sidebar footer identity block (`shell.tsx`), a quiet ghost control **"Sign out"** beneath the officer name/role/tier (not a prominent button — this is a long-session desktop tool). Optionally an account popover if more than one action is ever needed; for G, a single "Sign out" link suffices.

**Action:** calls Supabase `auth.signOut()` (server action), clears the session, redirects to `/sign-in`.

**Confirmation screen (post-sign-out):** render inside the deep-navy frame (A.1), a compact card: h *"You're signed out."*, body *"Your Oversight session has ended. Sign in again to continue."*, gold CTA **"Sign in →"** → `/sign-in`. (authored, R8). No destructive styling — signing out is routine.

Interaction states: **idle link**, **signing out** (brief), **signed-out confirmation**. If sign-out is reached because of expiry/idle, use the G6 copy instead of the neutral one.

### G4 — Authenticated but UNPROVISIONED

**Trigger:** Supabase Auth + MFA succeed, but there is **no Oversight officer record** bound to this identity (no `dim_jurisdiction` node / no provisioning row). This is the real-world first encounter when someone with a valid GES/Supabase identity has not yet been provisioned by the Omnischools admin (G8).

**It is NOT a 403 / "forbidden" / "access denied".** The person has done nothing wrong; their sign-in genuinely succeeded. Render the **calm gold** idiom, never terra.

**Route/placement:** rendered where the dashboard would be, inside the shell **but with a degraded identity strip** — footer shows the authenticated display name (from Supabase) with tier/jurisdiction replaced by a muted *"Pending set-up"*; nav items are present but inert/hidden (no jurisdiction = nothing to scope a read to). Simplest faithful option: render the shell with `jurisdictionName="Pending set-up"` and a single `PageBody` banner, no nav drill targets.

Layout: `PageHead` crumb *"Account"*, title (Fraunces) *"Almost there."* (authored), lede (authored). Then a `Banner tone="gold" glyph="⊘"`:
- **Title:** *"Your access isn't set up yet."*
- **Body (keep verbatim — owner-provided):** *"Your sign-in succeeded, but your Oversight access hasn't been set up yet. Contact the Oversight administrator."*
- **Contact detail line (PLACEHOLDER — R4):** *"Contact: {Oversight administrator contact — MoE Oversight desk / Omnischools support}."* — **owner to confirm** whether the named contact is the MoE Oversight desk or Omnischools. Until confirmed, render the placeholder label, not an invented email/phone.
- **Secondary muted line (authored):** *"This is not an error. Access is granted per person by the Oversight administrator once your appointment is on record."*
- **Action:** ghost **"Sign out"** (G3) — the only onward action; there is nothing in-app to do.

Interaction states: single static state. No retry button (retrying changes nothing); the only resolution is the administrator provisioning them (G8), after which a fresh sign-in lands at G2.

### G5 — DEACTIVATED officer

**Trigger:** an officer record exists but has been **deactivated** (withdrawn) by the admin (G8 deactivate flow). Auth + MFA still succeed (the Supabase identity is valid); the Oversight authorization is gone.

**Also NOT a 403/error** — non-blaming, past-tense, factual. Gold, not terra.

Layout (same placement as G4 — shell with degraded strip, or the deep-navy frame if we prefer to not show nav at all; **recommend the shell with a single banner** for consistency with G4): `Banner tone="gold" glyph="⊘"`:
- **Title:** *"Your Oversight access has been withdrawn."*
- **Body (keep verbatim — owner-provided stem; completed, authored tail R8):** *"Your Oversight access has been withdrawn. You can still sign in to GES systems, but you no longer have access to Oversight. If you believe this is in error, contact the Oversight administrator."*
- **Contact line:** same placeholder as G4 (R4).
- **When/by-whom line (optional, authored):** *"Access withdrawn {date}."* — show the date only if it reads from the provisioning-audit row without exposing the actor's identity gratuitously; the reason is **not** shown to the deactivated officer (R5 — confirm whether a withdrawal reason is surfaced to the officer; recommend NOT, to stay non-blaming).
- **Action:** ghost **"Sign out"** only.

Interaction states: single static state. Distinguished from G4 by tense (**has been withdrawn** = had access, lost it) vs G4 (**hasn't been set up** = never had it). Keep the two copies distinct so an officer and a support agent can tell which situation they're in.

### G6 — Session expired / idle → re-authenticate

**Triggers (recommended, owner-ratified values — R3):**
- **Absolute max-age ≈ 8h** — a session older than ~8h must re-authenticate regardless of activity (a working day).
- **Idle ≈ 30m** — no activity for ~30m ends the session.

Both are **recommended** figures the owner should ratify (R3). Enforce server-side (the authority) with a client idle-timer that proactively surfaces the prompt before a protected request fails.

**Behaviour:** when either limit is hit, the next protected navigation/action routes to a **re-authenticate** screen (deep-navy frame, A.1 idiom), NOT a silent redirect to a blank sign-in — the officer should understand why they're being asked again. Card:
- h *"Session timed out."*
- body (authored, R8) — **idle variant:** *"You've been inactive for a while, so we've signed you out to keep records secure. Sign in again to continue where you left off."*; **absolute variant:** *"For security, Oversight sessions end after {8 hours}. Sign in again to continue."*
- gold CTA **"Sign in again →"** → G1 (full primary factor **and** MFA challenge — expiry does not skip MFA).
- if the officer was mid-task, preserve the return path and show a quiet line *"We'll take you back to {page} after you sign in."* (optional; do not preserve any unsubmitted §6 justification across a re-auth — that must be re-entered, since the audit row must reflect a fresh, deliberate access).

Interaction states: **warning (optional pre-emptive)** — a client idle warning a minute before timeout (gold toast/modal: *"You'll be signed out in 1 minute due to inactivity. Stay signed in?"* with a **"Stay signed in"** button that pings the session). **expired** (the screen above). Keep the pre-emptive warning optional; the authoritative behaviour is server-side expiry.

> **Relationship to G7:** the §6 step-up (G7) has its own, much shorter **5-minute reuse window** for the MFA re-assertion. These are independent clocks: a session can be well within its 8h/30m life yet still require a fresh step-up at the gate because the last step-up was >5m ago.

### G7 — §6 step-up (fresh MFA re-assertion at the justification-gate SUBMIT)

**Where:** the §6 named-record gate (`compliance-records/new`, `gate-form.tsx`). The step-up fires at the **SUBMIT of the justification** — the existing warn CTA *"Log access & open record →"* (`gate-form.tsx` line ~203) — **before any record is opened and before the audit row's access is granted.** It is a fresh MFA assertion (AAL2 step-up), reusable for a **5-minute window** so an officer opening several records in one sitting isn't challenged on each.

**Reachability:** the §6 gate is reachable only by **DISTRICT / REGION / NATIONAL** tiers (there is no SCHOOL-tier officer, and students/aggregate need no gate). So G7 only ever renders for those three tiers. If a tier that cannot reach the gate somehow reaches submit, fail closed.

**Why re-auth here (the copy must make this legible):** opening a named record is the one irreversible, permanently-logged, individually-identifying action in Oversight. The step-up proves the person at the keyboard is still the provisioned officer — the access is about to be written against their name and reviewed by GES audit.

**Layout:** a focused step-up **modal/interstitial** over the gate (dimmed backdrop), deep-navy header strip (the audited-tier signal), white body:
- header (`bg-navy-deep text-bg`): Fraunces *"Confirm it's you."* + a `Pill`/mono line *"§6 · named-record access"*.
- body lede (authored, R8): *"You're about to open a **named individual's record**. This access is logged against your name and reviewed by GES audit. Re-enter your authenticator code to confirm it's you before the record opens."*
- the `.otp-row` six-box TOTP input (reuse G1.c).
- a quiet line echoing the stake: *"Reason: {selected reason} · {school} · this will be logged as a named-record access."*
- buttons: ghost **"Cancel"** (returns to the gate, nothing logged) + warn **"Confirm & open record →"** (same warn family as the gate submit).

Interaction states:
- **within the 5-min reuse window:** the step-up is skipped — submit proceeds directly (the previous assertion still counts). Do not show the modal.
- **reuse window expired / first open this session:** show the modal.
- **verifying / error** (terra line *"That code didn't verify. Enter the current 6-digit code."*).
- **success:** proceed to the existing gate submit → one audit row, one record render (the gate's existing contract in `gate-form.tsx`).
- **cancel:** no audit row is written (the access never happened); return to the filled-in gate form.

> **Important ordering:** the step-up gates the *grant*, but it does **not** change the §6 audit contract — the access is still written exactly once, by the existing choke point (`lib/oversight/named-record-access.ts`). The step-up is an additional AAL2 assertion in front of it, not a second log. A **failed/cancelled** step-up is not an access and is **not** written as a denial row (unlike a consent denial, which is a real boundary refusal) — nothing was attempted against the operational record. (R9: confirm whether a cancelled step-up should be recorded anywhere for security telemetry; recommend an auth-side event, not an `audit_access_log` row.)

### G8 — Admin provisioning console (Omnischools-operated)

**This is NOT a GES-officer surface.** It is the internal Omnischools operations console that creates, scopes, and withdraws officer accounts. It must be **visually and structurally distinct** from the GES Oversight app — it is operated by Omnischools staff, not GES. Recommendation: a separate `(admin)` route group (e.g. `/admin/officers`) with its **own chrome** — reuse the tokens and primitives, but the sidebar crest reads **"Omnischools · Oversight Admin"** (not the gold `GES` crest), so no one confuses it for a GES surface. (R10: confirm the admin console's home/auth — it should sit behind its own Omnischools-staff auth, distinct from the officer pool; do not reuse the GES officer sign-in.)

Four surfaces/flows:

**G8.a — Officer list.** `PageHead` crumb *"Oversight administration"*, title (Fraunces) *"Provisioned **officers.**"*, lede *"Every Oversight officer, the jurisdiction they're bound to, and their status. Accounts are provisioned here — officers never self-register."* Action: primary navy **"Provision an officer →"** (G8.b).

A `Panel` → `Table`:

| Column | Content |
|---|---|
| Officer | display name (bold) + masked contact (mono meta) |
| Jurisdiction | the bound `dim_jurisdiction` node name + meta (region/parent) |
| Tier | `Pill tone="gold"` — District / Region / National (derived from the node's `level`) |
| Role | human role label (derived from the node — see below) |
| Status | `Pill` — `green` **Active** / `muted` **Pending** / `terra`-text **Deactivated** (status pill is the exception where a withdrawn account reads terra, because this is the admin's operational truth, not a message to a blameless officer) |
| Provisioned | provisioner name + date (mono) |
| (actions) | ghost **"View"** → detail; for active officers, **"Deactivate"** (terra ghost) |

Row states: `drill` hover `bg-gold-bg`; a pending-approval row (G8.d) carries a `Pill tone="warn"` **"Awaiting approval"** and is not yet active. Empty state: *"No officers provisioned yet."*

**G8.b — Provision an officer.** A `Panel` form:
- **Officer identity:** name + the GES-held contact/identifier the account binds to (the mechanism's identifier per R1). Note line: *"This is the identity the officer will sign in with. It must match their GES appointment record."*
- **Jurisdiction node picker (the central control):** a `Select`/`Combobox` over `dim_jurisdiction`. **Critical rules the UI enforces:**
  - **Tier is DERIVED from the chosen node's `level`, never a free field.** There is no "level"/"tier" input — selecting *Wassa Amenfi West* yields tier **District**; selecting *Western Region* yields **Region**; selecting the national root yields **National**. Show the derived tier read-only beside the picker as a `Pill` the instant a node is chosen.
  - **Role is derived from the node**, shown read-only (District node → "District Director", Region node → "Regional Director", National root → "National Oversight · MoE"). (R6 for exact nouns.)
  - **SCHOOL-level nodes are NOT selectable** — there is no SCHOOL-tier officer. Filter `level = 'SCHOOL'` out of the picker entirely (don't show-then-disable, to avoid implying it's a coming option). If the admin searches for a school, show an inline note: *"Schools aren't an officer tier. Officers are provisioned at District, Region, or National."*
  - Selecting a node renders a confirmation card echoing exactly what the officer will see in A.1's "provisioned-by" panel and A.2 step 2 (the `jur-card` facts: schools-in-node, on-Omnischools, population where available) — so the admin provisions against the same numbers the officer will confirm.
- **Submit:** navy **"Provision officer"** for DISTRICT (single-admin, takes effect pending first sign-in); for **REGION / NATIONAL** the button reads **"Submit for approval"** and routes into G8.d (two-person).

Interaction states: **default** (submit disabled until a non-SCHOOL node is chosen + identity entered); **school-node chosen** (inline note, submit stays disabled); **submitting**; **success** (returns to G8.a with the new row — Active for District, "Awaiting approval" for Region/National); **duplicate** (terra line if the identity is already provisioned).

**G8.c — Deactivate.** From the officer list/detail, a terra ghost **"Deactivate"** opens a confirmation (this one legitimately uses **terra/destructive** styling — it is a deliberate withdrawal, the one place terra is right in G): h *"Withdraw this officer's access?"*, body *"{name} will no longer be able to use Oversight. Their audit history is preserved and is never deleted. This can be reversed by re-provisioning."*, optional internal reason field (admin-only, not shown to the officer — R5), buttons ghost **"Cancel"** + terra **"Withdraw access"**. On confirm: officer flips to **Deactivated** (G8.a status pill), the officer's next sign-in shows **G5**, and a provisioning-audit row is written. **Two-person for deactivation of REGION/NATIONAL?** — R11: recommend deactivation of a REGION/NATIONAL officer *also* require two-person approval (symmetry with provisioning); owner to confirm. District deactivation single-admin.

**G8.d — Two-person approval (REGION / NATIONAL).** Provisioning (and per R11, possibly deactivating) a **Region or National** officer requires a **proposer** and a **distinct approver** — the same person cannot do both. This mirrors the append-only, accountability-first posture of the audit log.
- **Proposer** completes G8.b and submits → the officer enters a **"Awaiting approval"** state (G8.a warn pill; not yet active; cannot sign in — a sign-in attempt in this window is treated as unprovisioned/G4 until approved).
- The proposal appears in an **"Awaiting approval"** panel/queue. A `Banner tone="warn" glyph="!"`: *"This provision affects a {Region/National} tier — the broadest access. It needs a second administrator to approve before it takes effect."*
- **Approver** (must be a different admin — the UI disables the approve action for the proposer, and the server enforces it) reviews a read-only summary of the proposal (officer identity, node, derived tier + role, proposer name + time) and either **"Approve & activate"** (green) or **"Reject"** (terra ghost, with a reason).
- On approve → officer becomes **Active**; two provisioning-audit rows exist (proposed, approved) naming both administrators. On reject → the proposal closes (rejected), no account activates; an audit row records the rejection + reason.

Interaction states: **proposed/awaiting**, **proposer viewing own proposal** (approve/reject disabled, note *"A different administrator must approve this."*), **approver viewing** (approve/reject enabled), **approved**, **rejected**. A proposer may **withdraw** their own pending proposal (ghost "Withdraw proposal").

**G8.e — Provisioning-audit history.** Mirror the §A2 append-only audit idiom. A `Banner tone="navy" glyph="⛓"`: *"This provisioning log is append-only. Who provisioned, approved, or withdrew which officer — and when — is recorded and cannot be edited or deleted."* Then a `Panel` → `Table`:

| Column | Content |
|---|---|
| When | mono timestamp |
| Action | `Pill` — **Provisioned** (gold) / **Approved** (green) / **Rejected** (terra) / **Deactivated** (terra) / **Re-provisioned** (gold) |
| Officer | the affected officer (name + node) |
| Tier | derived tier pill |
| Administrator | the acting Omnischools admin (proposer or approver, labelled) |
| Detail | e.g. *"bound to Western Region · approved by {name}"* |

This log is the source of truth behind the officer-facing **"provisioned-by" panel** (A.1) — same facts, one authoritative record. Append-only: a correction (e.g. wrong node) is a deactivate + re-provision pair, never an edit. `Provenance` footer: *"Written by · the provisioning console · one row per action"* / *"Append-only · entries cannot be edited or deleted"* / *"Scope · all Oversight officer accounts, all tiers"*.

---

## PART C — shadcn/ui (or hand-rolled primitive) mapping

The app has no shadcn installed yet; `primitives.tsx` satisfies the mapping in plain markup (the same convention `e3 §PART B` set). When shadcn lands, these map as:

| G element | shadcn primitive | Hand-rolled today | Notes |
|---|---|---|---|
| Sign-in / step-up / re-auth frame | — (custom) | deep-navy gradient + centred `Card` | token-bound gradient `from-navy-deep via-navy to-navy-2`. |
| Sign-in card, welcome card, jur-card | `Card` | `Panel` / bespoke card | sign-in card `rounded-[18px] shadow-xl`. |
| Field inputs | `Input` | `.field-input` markup | Mono, `bg-bg`, `border-border-2`. |
| 6-digit MFA code | `InputOTP` | `.otp-row`/`.otp-box` | `filled`=`border-gold bg-gold-bg`, `cursor`=`border-navy`. |
| QR / secret panel (enrol) | `Card` + image | bordered panel | QR from Supabase; secret in copyable mono field. |
| Onboarding wizard | — (custom stepper) | `.ob-steps` vertical nav | done `✓` gold / active gold num / pending muted. |
| Unprovisioned / deactivated / expired / step-up alerts | `Alert` | `Banner` | tone `gold` (calm) except step-up `warn`; **never `destructive`** for a blameless officer. |
| Acknowledgement boxes | `Checkbox` + label | `.ack-box` (gold `✓`) | specific, not blanket. |
| Officer list / provisioning-audit tables | `Table` | `<table>` (as in `compliance-records/page.tsx`) | row `data-state` for drill/awaiting. |
| Jurisdiction node picker | `Combobox` / `Select` | `<select>` (as in `gate-form.tsx`) | SCHOOL filtered out; tier+role derived read-only. |
| Status / tier / action pills | `Badge` | `Pill` | tier=gold, Active=green, Deactivated=terra, Awaiting=warn. |
| Sign-out, account menu | `DropdownMenu` (optional) | ghost link in shell footer | single "Sign out" suffices for G. |
| Deactivate / reject confirmations | `AlertDialog` | bespoke modal | the one place terra/destructive is correct. |
| Step-up modal | `Dialog` | bespoke overlay | deep-navy header; backdrop dim. |
| Approve / reject buttons | `Button` | styled buttons | green approve, terra reject, navy primary, warn step-up/submit. |

**Responsive:** desktop-first (a government desktop tool), matching the mocks. Sign-in/step-up cards are already narrow (`max-w-[480px]`) and center on any width. The wizard's step rail collapses above the panel under `md`. The admin tables scroll-x under `md`; the sidebar becomes a drawer under `md` (as noted in `e3 §PART B`). The §6 gate + G7 modal inherit the gate's existing responsive behaviour.

---

## Interaction-state catalogue (quick reference)

- **Sign-in (G1.a):** default (channel locked/prefilled) → submitting → error (bad credentials, enumeration-safe) → rate-limited (gold, not terra). No self-recovery link.
- **MFA enrol (G1.b):** QR+secret shown → 6-box input (disabled until full) → verifying → error (expired code) → success → wizard step 2.
- **MFA challenge (G1.c):** 6-box input → verifying → error → success → landing / G4 / G5.
- **Identity strip (G2):** normal (name + jurisdiction + tier). No user-visible "Not signed in"; unprovisioned/deactivated render G4/G5 instead of the dashboard.
- **Sign-out (G3):** idle link → signing out → signed-out confirmation (neutral) OR the G6 copy if expiry-triggered.
- **Unprovisioned (G4):** single calm gold state; only action is sign out; contact is a placeholder (R4).
- **Deactivated (G5):** single calm gold state, past-tense; only action is sign out; no reason shown to the officer (R5).
- **Session expiry (G6):** optional pre-emptive idle warning ("Stay signed in?") → expired re-auth screen (idle vs absolute copy) → full G1 (primary + MFA).
- **§6 step-up (G7):** within 5-min window = skipped (no modal); else modal → verifying → error → success (proceed to the one audit row) / cancel (nothing logged).
- **Provision (G8.b):** default (disabled) → school-node chosen (inline note, disabled) → valid node (tier+role derived read-only) → submit ("Provision" District / "Submit for approval" Region+National) → success / duplicate error.
- **Deactivate (G8.c):** terra confirmation dialog (the one correct destructive styling) → withdrawn → officer sees G5.
- **Two-person (G8.d):** proposed/awaiting → proposer-view (approve disabled, "a different administrator must approve") → approver-view (enabled) → approved/rejected; proposer may withdraw.
- **Provisioning-audit (G8.e):** append-only, immutable; a correction is deactivate + re-provision, never an edit.

---

## Cross-module references & commitments to preserve exactly

- **`getOfficerSession()` stays the single auth interface.** Feature code never touches `supabase.auth.*` directly (the comment in `lib/auth/index.ts` is a hard architectural rule). G adds the real Supabase-backed implementation *behind* it, returning the same `OfficerSession` shape (`officerId`, `officerRole`, `jurisdictionId`, `level`, `displayName`, `jurisdictionName`). The RLS helpers (`withJurisdiction`) and the audit writer both depend on this shape.
- **Fail closed.** No session ⇒ no app (redirect to G1). No provisioning ⇒ G4 (not the dashboard). Deactivated ⇒ G5. A fabricated/guessed officer identity must never reach an audit row — the existing module-load `DevBypassInProductionError` guard stays.
- **Tier is `level`.** `jurisdiction_level = [SCHOOL, DISTRICT, REGION, NATIONAL]`. Officers exist only at DISTRICT / REGION / NATIONAL. **No SCHOOL-tier officer** — the node picker (G8.b) must exclude SCHOOL, and the §6 gate (G7) is reachable only by the three officer tiers.
- **Tier and role are DERIVED from the `dim_jurisdiction` node, never free-entered** (G8.b). This is an architectural commitment: scope cannot be widened by typing a level.
- **Jurisdiction is confirmed, never chosen, by the officer** (A.2 step 2): the only officer-side options are "yes, correct" or the administrator escape hatch. A director can never widen their own scope.
- **Provisioning is never self-service** (A.1, BUILD_STACK Decision 5): no sign-up link, ever. Recovery routes to the administrator (R2).
- **Append-only audit posture extends to provisioning** (G8.e): provisioning/approval/withdrawal are logged, immutable; a correction is a new row, never an edit — mirroring `audit_access_log`.
- **The §6 step-up (G7) does not alter the §6 audit contract:** one access = one row, written by `lib/oversight/named-record-access.ts`. The step-up is an AAL2 assertion in front of the grant, not a second log; a cancelled step-up writes no `audit_access_log` row.
- **MFA is mandatory and every-session;** expiry (G6) never skips it. The G7 5-min reuse window is a separate, shorter clock from the G6 session timers.
- **The admin console (G8) is Omnischools-operated, not GES** — distinct chrome and its own auth (R10); it is not part of the GES officer pool.

---

## OWNER-RATIFY list (flagged copy & decisions the owner must confirm)

| # | Item | Why it needs ratification |
|---|---|---|
| **R1** | **Primary auth factor.** The onboarding mock uses **phone-OTP**; increment G says **Supabase Auth, MFA mandatory**. Confirm the primary factor (phone-OTP as first factor + TOTP MFA? email magic-link/password + TOTP?) — it changes the G1 field copy and the A.1 sub-line. | The mock and the increment brief diverge on mechanism; the brand ("same phone-OTP as all of Omnischools", Decision 5) argues for phone-OTP primary + TOTP second. Do not ship an invented mechanism. |
| **R2** | **MFA recovery** — self-service recovery codes vs **administrator reset**. Recommend administrator reset (consistent with the no-self-service posture). | Affects G1.b post-enrol panel and whether a "lost device" path exists at all. |
| **R3** | **Session timers** — absolute max-age **~8h**, idle **~30m** (recommended). Confirm exact values. | G6 enforces whatever is ratified; brief marks these "recommended, owner-ratified". |
| **R4** | **Unprovisioned/deactivated contact** — "Contact the Oversight administrator" is a **placeholder**: is it the **MoE Oversight desk** or **Omnischools support**? Need the exact contact string. | G4 + G5 render a placeholder label until confirmed; do not invent an email/phone. |
| **R5** | **Withdrawal reason visibility** — is a deactivation reason shown to the officer (G5) and/or recorded admin-only (G8.c)? Recommend admin-only, not shown to the officer (stay non-blaming). | Affects G5 body and G8.c form. |
| **R6** | **Role/tier nouns** — exact GES labels: "District Director" / "Regional Director" / national role noun; and the role-specific salutation in A.1 ("Welcome, Director."). | The mock uses "District Director" + "GES Oversight Administrator (National)"; confirm the regional/national officer nouns. |
| **R7** | **First-sign-in acknowledgement persistence** — is the step-4 accountability acknowledgement recorded per officer (and shown once), and where? | It has a compliance rationale (the officer acknowledges the model); may belong in the provisioning-audit or a per-officer flag. |
| **R8** | **Authored copy** — all strings marked "(authored)" in G1–G7 (error lines, timeout bodies, step-up lede, sign-out confirmation) are Lucy-drafted to match house voice, not owner-provided. Review for GES register. | Only the explicitly-quoted owner strings (G4/G5 stems) are fixed; the rest want a copy pass. |
| **R9** | **Cancelled/failed step-up telemetry** — should a cancelled G7 step-up be recorded anywhere (auth security event)? Recommend an auth-side event, **not** an `audit_access_log` row. | Keeps the §6 log "one access = one row" clean. |
| **R10** | **Admin console auth & home** — the G8 console is Omnischools-operated; confirm it sits behind its own Omnischools-staff auth (distinct from the GES officer pool) and its route group / chrome. | Must not be confused for a GES surface or reuse the officer sign-in. |
| **R11** | **Two-person for deactivation** — does withdrawing a REGION/NATIONAL officer also require two-person approval (symmetry with provisioning)? Recommend yes. | G8.c/G8.d; brief specifies two-person only for *provisioning* Region/National. |
</content>
</invoke>
