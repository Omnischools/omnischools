# L1 — Signup Wizard Surface Map (INCR-33 · Module L / L1)

**Author:** Lucy (design cartographer) · **Status:** design spec, ready for the implementation engineer.
**Scope:** the three signup edits of INCR-33 on the existing `/start` onboarding wizard —
**(1) REMOVE the CSSPS school-code field, (2) ADD a password-creation step, (3) register a PROPRIETOR role (no visible wizard change).**
This maps the authored surfaces 1:1 onto the live wizard so porting is mechanical. Where a surface and the live build disagree, the drift is called out inline and collected in the **Drift / notes log** at the end.

> Replication discipline: sections, copy, fonts, colours, states 1:1. No-alpha token opacity — no Tailwind slash-opacity on the raw-hex tokens; use solid tokens / `-bg` tint tokens / `opacity-N`. Ghana voice preserved verbatim (CSSPS = SHS/TVI placement code; "Primary 1–6" not "Basic 1–6").

---

## 0. Source surfaces — role in this map

| Surface / file | Role for INCR-33 |
|---|---|
| `Surfaces/schoolup-unified-onboarding.html` | **PRIMARY — visual source of truth for the live wizard's chrome.** A 6→8-step vertical-step-nav wizard. Its **Step 1 (School identity)** and **Step 2 (School type)** are exactly what the live 2-step app renders. **This is where the CSSPS field lives.** **No password step anywhere in it.** |
| `Surfaces/schoolup-onboarding-wireframes.html` §01 "School sign-up" | **The ONLY authored surface that shows a password-creation step at signup**, AND the only one showing a **Proprietor** self-role option. Different, older single-page two-pane concept (education-level multi-selects, ministry opt-in) — *not* the live chrome. Use it as the **copy + field-order precedent for the new password fields**, not for layout. |
| `Surfaces/schoolup-oversight-onboarding.html` | **NOT school signup.** GES Oversight *director* onboarding (5-step jurisdiction confirmation, "GES-set · locked" scope). Belongs to the Oversight product / super-admin, maps loosely to `full-wizard.tsx`, not `/start`. Ignore for L1. |
| `components/onboarding/wizard.tsx` (`OnboardingWizard`) | **The live as-built wizard** at `/start`. 2-step: `type` → `identity` ("Step 1 of 2" / "Step 2 of 2"). **This is the file INCR-33 edits.** |
| `components/onboarding/full-wizard.tsx` | The unused fuller variant (identity/type/calendar/structure/staff/billing/residency/waec). It mirrors the *unified* surface's longer flow but is **not** what `/start` renders — kept for the super-admin tenant-setup portal. **Do not build the password step here.** |
| `components/auth/accept-form.tsx` (`AcceptForm`) + `app/(marketing)/accept/[token]/page.tsx` | The **existing in-app set-password screen** (staff invite acceptance). Its field styling, labels, and validation are the canonical pattern the new signup password step must match. |

---

## 1. Q1 — Which surface = the live signup, and is it 2-step or multi-step?

**The live `/start` wizard is a deliberately condensed 2-step flow whose chrome is the `schoolup-unified-onboarding.html` surface.** The authored unified surface is itself a **6→8-step** wizard, but the live app collapses it: everything past identity + type (calendar, structure, staff, billing, residency, WAEC) is **auto-seeded** by the `onboardSchool` action from tier defaults (documented in `wizard.tsx` header comment; consistent with repo memory *onboarding-inputs-cascade*). The fuller flow survives only in `full-wizard.tsx`.

Evidence the live 2-step derives 1:1 from the unified surface's first two steps:

| Live `wizard.tsx` | Unified surface |
|---|---|
| Type step `<Head>`: pill "Step 1 of 2 · School type", title **"What kind of / school are you?"** | Step 2 head: pill "Step 2 of 8 · School type — the branch point", `<h2>What kind of <em>school</em> are you?</h2>` + type cards (Basic / Senior…) |
| Identity step `<Head>`: pill "Step 2 of 2 · School identity", title **"Tell us about / your school."** | Step 1 head: pill "Step 1 of 6 · School identity", `<h2>Tell us about <em>your school</em>.</h2>` |
| Identity fields: School name, Short name/alias, GES code, **CSSPS code**, Year founded, Ownership, Region, District, Address | Step 1 `form-row`s: identical field set + labels + placeholders (`BR-SUN-018`, `ST-0741`, `1965`, `P.O. Box 18, Sunyani · GA-077-0418`) |

**Implication for the implementer:** in the live app **"a step" means a step in a 2-step wizard, not the unified surface's step numbering.** "Add a password-creation step" therefore lands on the 2-step flow (see §3 for whether that is an inline sub-section or a literal 3rd step). Do **not** read INCR-33's "step 3" as the unified surface's Step 3 (Academic calendar) — that step does not exist in the live app.

---

## 2. Q2 — The CSSPS field: where it appears, and coherence after removal

### 2.1 In the PRIMARY authored surface (`schoolup-unified-onboarding.html`, Step 1 · School identity)
- **Nav subtitle** (`.wiz-step-sub` for step 1): `Name, GES code, CSSPS code, district`.
- **Section eyebrow** (§01 `.section-meta`): `Vertical nav · 8 steps visible · CSSPS code field added`.
- **The field** sits in the **second form row** (`form-row three`), middle cell, between GES code and Year founded:
  - Label: `CSSPS school code` + `?` help-icon, title `Used to log in at hm.cssps.gov.gh`.
  - Input: `form-input filled mono`, value `ST-0741`.
  - Help: `From <a>hm.cssps.gov.gh</a> · SHS/TVI only.`
  - **Not required** (no `*` — GES code is the required code; CSSPS is optional).
- **Adjacent fields in that row:** `GES school code *` (mono, `BR-SUN-018`, help "From EMIS. Format **RG-DIST-NNN**.") · `Year founded` (`1965`).
- **Design note** (right rail): *"CSSPS code field added. Single-field addition that lets SHS later flow placement lists through the admissions module from hm.cssps.gov.gh."*
- **Also echoed** in the §06 final-review card (Step 1): a `confirm-row` `CSSPS code · ST-0741`. (Review screen is authored-surface-only; the live 2-step "done" panel has no such row — nothing to clean up there.)

### 2.2 In the LIVE wizard (`components/onboarding/wizard.tsx`, `IdentityStep`)
- The CSSPS input is the **middle cell of the 3-column grid** `grid grid-cols-1 gap-4 sm:grid-cols-3` (≈ line 438–445):
  - `<Field label="CSSPS school code" help="SHS / TVI only · hm.cssps.gov.gh">` → `<input className={cn(inputCls(...), "font-mono")} placeholder="ST-0741" />` bound to `csspsCode`.
  - Row-mates: `GES school code` (req, mono, `BR-SUN-018`) and `Year founded` (`1965`).
- Schema: `OnboardSchema.csspsCode: z.string().max(40).optional().or(z.literal(""))` (`lib/onboarding.ts:331`). Optional — safe to leave in the schema/type even after the UI field is gone (data-model decision is out of my scope; flagged for Kofi/Claude Code).

### 2.3 Coherence after removal — CONFIRMED
Deleting the CSSPS `<Field>` leaves **GES school code + Year founded** in that row. The row must go from **3 columns to 2** (`sm:grid-cols-3` → `sm:grid-cols-2`) so the two survivors don't stretch. The surface has a 2-col precedent (`.form-row.two-one` and the `sm:grid-cols-[2fr_1fr]` School-name/Short-name row) so a 2-col GES+Year row is visually consistent. The step remains coherent: identity is still Name/alias → GES/Year → Ownership/Region/District → Address → owner details. **No orphaned label, help text, or required-count copy** references CSSPS in the live wizard (the "Five of seven fields required" line is authored-surface-only and is not present in the live `<Head>` lede).

---

## 3. Q3 — Password step: does the authored surface already show one?

**The PRIMARY surface (`schoolup-unified-onboarding.html`) does NOT show a password-creation step — anywhere.** Its owner/creator capture is entirely phone-first (matches the live wizard, which signs the admin in by phone/OTP). So for the surface the implementer is replicating, **there is no authored password step to copy.**

**However**, a password step *is* authored in the comparison surface `schoolup-onboarding-wireframes.html` §01, and it is the design-faithful precedent to follow. Both fields exist, side by side:

- Section label above them: `Your details` (`.section-label`, gold, uppercase, `0.14em`).
- Field order within "Your details": **Your name\*** / **Your role\*** → **Email\*** / **Phone\*** → **Set a password\*** / **Confirm password\*** → (Ministry opt-in) → Terms → CTA.
- The two password fields, a `.row-2` (2-up grid):
  - `Set a password *` — `<input type="password">`, `.req` asterisk in `--terra`.
  - `Confirm password *` — `<input type="password">`, `.req` asterisk in `--terra`.
- **Authored rationale** (right rail note, verbatim): *"Confirm password on a desktop field is cheap insurance — admin accounts are long-lived and rarely re-authenticated; a typo here means a frustrating recovery flow on day two."* → **keep the confirm field.**
- CTA on that surface: primary `Create school account →` + secondary `Save & finish later`.

### 3.1 The canonical in-app password pattern to reuse (`components/auth/accept-form.tsx`)
This is the existing, live set-password screen — port its exact field styling, labels, and validation so the new signup step is identical:
- `labelClass = "mb-1.5 block text-xs font-semibold text-navy-2"`.
- `fieldClass = "w-full rounded-md border border-border-2 bg-bg px-3.5 py-2.5 text-sm text-navy outline-none transition-colors focus:border-gold focus:bg-surface"`.
- Labels verbatim: **`Set a password`**, **`Confirm password`** (title case, no help text on the accept screen; the wireframe adds the `*` required markers — keep them for signup).
- Both inputs `type="password"`, submit-on-Enter (`onKeyDown … Enter`).
- **Validation — single-sourced via `passwordProblem` (`lib/password.ts`, PR #244); do NOT re-hardcode:** the accept screen calls `passwordProblem(password)` and, on a non-null result, sets the error to `` `${problem}.` `` (a period is appended). The rule is **min 8 + at least one letter + at least one number (max 128)**; the messages, in check order, are:
  - **`"Password must be at least 8 characters"`** (< 8)
  - **`"Password must include at least one letter"`** (no letter)
  - **`"Password must include at least one number"`** (no digit)
  - **`"Password must be at most 128 characters"`** (> 128)
  - then `password !== confirm` → **`"Passwords don't match."`**
  - Error render: `<p className="text-sm text-terra">…</p>`.
- No strength meter — the rule is exactly `passwordSchema` (min-8 + letter + number, max-128), single-sourced in `lib/password.ts`; do not add a meter or extra rules, and do not re-hardcode the strings.
- Button: `w-full rounded-md bg-navy px-5 py-3 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-60`, label `Accept & continue →` / busy `Setting up…`.

### 3.2 Placement recommendation (design-faithful, minimal)
The live wizard's `IdentityStep` already has a **"Your details · you sign in first"** sub-section (Full name / Phone (login) / Email — optional) followed by the Terms checkbox and the `Launch school →` CTA. The wireframe surface puts password/confirm **inside that same "Your details" block, right after the contact fields and before Terms.**

- **Recommended: inline, inside "Your details"** — add a 2-col row `Set a password *` / `Confirm password *` between the phone/email grid and the Terms `<label>`. This is 1:1 with the authored precedent, keeps the flow at **2 steps** (no counter/pill changes), and reuses the AcceptForm validation. Use the live wizard's own `Field` + `inputCls` wrappers (see §4) so it matches the surrounding fields, not the accept-screen card exactly — i.e. `<Field label="Password" req help="At least 8 characters, with a letter and a number."><input type="password" className={inputCls(!!…)} /></Field>` and a confirm `<Field>`. Wire the two validators into `identityError()` before the existing `termsAccepted` check.
- **Alternative: a literal 3rd step** ("Step 3 of 3 · Create your password", standalone like the accept card). Only take this if product wants password isolated from PII entry. If so, the implementer MUST also update: the two step-pill strings, the footer meta line, and the `"Step 1 of 2"/"Step 2 of 2"` counters to `… of 3`. **No authored surface shows this** — flag before choosing. Default to inline.

Either way the password is validated **client-side before `onboardSchool`**, and `onboardSchool`/`OnboardSchema` must accept the new `adminPassword` value (schema field addition — Kofi/Claude Code's call, not mapped here).

### 3.3 Done-phase OTP-finish step (INCR-AUTH-OTP / PR #243 — **gated by `AUTH_OTP_LIVE`**)

Shipped after INCR-33: the wizard's **done phase** (`DonePanel`) branches on `result.otpLive` (= `otpLoginRequired()` = `authIsLive() && env.AUTH_OTP_LIVE`; default **OFF** — full behaviour in `docs/senior/incr-auth-otp-first-login-ruling.md`).

- **OTP-first ON (`result.otpLive` true)** — the success card's gold `Sign in →` button is **hidden**, and an OTP-finish card (`OnboardingOtpFinish`) renders below it. It auto-issues exactly **one** `requestOtp(phone)` on mount, then verify → confirms the phone + establishes the session + redirects to `/dashboard` (`verifyLogin`).
  - Container: `mt-5 rounded-xl border border-gold-soft bg-gold-bg px-6 py-5`.
  - Heading (`font-display text-base font-semibold text-navy`): **"Finish signing in — verify your number"**
  - Body (`text-[13px] leading-relaxed text-navy-2`): **"We sent a one-time code to {phone}. Enter the latest code to confirm your number and go straight to your dashboard. You'll be able to sign in with your password after this."**
  - OTP input: placeholder **"••••••"**, `inputMode="numeric"`, `w-40 … text-center font-mono text-lg tracking-[0.3em]` (mono, like the login OTP field).
  - Primary button (`bg-navy … text-bg`): **"Verify & go to dashboard"** / busy **"Verifying…"**
  - Resend link (`text-xs font-semibold text-navy-3 hover:text-navy`): **"Resend code"** → **"Code re-sent ✓"**
  - Error: `mt-2 text-sm text-terra`
- **OTP-first OFF (`result.otpLive` false — the default)** — no OTP card; the success card keeps the gold **"Sign in →"** → `/login?accepted=1`.
- **Always present (both states, AC-07 no-orphan escape)** — the terminal **"Go to sign in"** link → `/login?accepted=1` (`border border-border-2 bg-surface …`) plus the `school id · {schoolId}` mono line. The school + account are committed before the OTP step, so a failed send/verify never blocks — the same OTP tab at `/login` completes first login.

---

## 4. Q4 — Tokens / states so the new step is visually identical

All classes below are the live wizard's own (`wizard.tsx`); reuse them verbatim for the password fields. No slash-opacity anywhere (memory *no-alpha-token-opacity*).

### 4.1 Field styling (reuse `IdentityStep`'s wrappers)
| Element | Class / token |
|---|---|
| Field wrapper | `Field` helper → `flex flex-col gap-1.5` |
| Label | `labelCls = "flex items-center gap-1.5 text-xs font-semibold text-navy"` |
| Required mark | `<span className="text-terra">*</span>` |
| Help line | `helpCls = "text-[11px] leading-snug text-navy-3"` |
| Input (empty) | `inputCls(false)` → `w-full rounded-lg border border-border-2 bg-surface px-3 py-2.5 text-sm text-navy outline-none transition-colors focus:border-gold` |
| Input (filled/auto-saved tint) | `inputCls(true)` → same + `border-gold-soft bg-gold-bg` |
| Mono inputs (codes only) | add `font-mono` (GES code); **password fields are NOT mono** — normal body input |

Surface-side equivalents (for reference / the `full-wizard` variant): `.form-input` (border `--border-2`, radius 7px, `focus → border --gold`), `.form-input.filled` (`bg --gold-bg`, `border --gold-soft`), `.form-label` (12px/600/`--navy`), `.req` (`--terra`), `.form-help` (11px/`--navy-3`).

### 4.2 Step-header / progress pattern
- **Step pill** (`Head` component): `text-[10px] font-bold uppercase tracking-[0.14em] text-gold`, e.g. `Step 2 of 2 · School identity`. (Surface `.wiz-step-pill` is the same: 10px, uppercase, `0.14em`, `--gold` 700.)
- **Title**: `<h2 className="font-display text-[26px] font-medium leading-tight text-navy">` with italic gold accent `<em className="not-italic text-gold [font-style:italic]">`.
- **Lede**: `mt-2 max-w-[620px] text-[13px] leading-relaxed text-navy-3`.
- **Header underline**: the whole `Head` block is wrapped `mb-7 border-b border-border pb-5`.
- The live wizard has **no vertical step rail** (that's the unified surface's `.wiz-nav`; the live 2-step uses a single top strip `Step N of 2 · …` at `border-b border-border px-6 py-3 text-xs font-semibold text-navy-3`). If a literal 3rd step is added, this strip's string is the counter to update.

### 4.3 Error / validation states
- Wizard-level error (shared): `{error && <p className="mt-4 text-sm text-terra">{error}</p>}` — the password validators feed this same `error` state via `identityError()`.
- Field-empty visual: input stays `border-border-2 bg-surface` (no per-field red outline in this design — errors surface as the single `text-terra` line under the form, matching both the live wizard and the accept screen).
- Terms unchecked → existing string `"Please accept the Terms & Privacy Policy to continue."` (keep the password checks *before* this so a missing password reports first, mirroring `AcceptForm` order: length → match).

### 4.4 CTA styling
| Button | Class | Copy |
|---|---|---|
| Primary launch (identity step) | `rounded-lg bg-gold px-6 py-2.5 text-sm font-bold text-navy transition-colors hover:brightness-95 disabled:opacity-60` | `Launch school →` / busy `Launching…` |
| Continue (type step) | `rounded-lg bg-navy px-6 py-2.5 text-sm font-bold text-bg hover:bg-navy-deep` | `Continue →` |
| Back | `rounded-lg px-4 py-2.5 text-sm font-semibold text-navy-3 hover:text-navy disabled:opacity-60` | `← Back` |

If password becomes a literal 3rd step, its own CTA should be the **navy** `Continue →` (advance) style, reserving the **gold** `Launch school →` for the final step — consistent with the surface convention that gold = the terminal/commit action.

---

## 5. INCR-33 change-list (the mechanical port)

1. **Remove CSSPS** — delete the `CSSPS school code` `<Field>` from `IdentityStep` (`wizard.tsx` ~438–445); change that grid from `sm:grid-cols-3` to `sm:grid-cols-2` (GES code + Year founded remain). Leave `csspsCode` out of the submitted `form`; the optional schema key can stay or be dropped by the data owner. No review-row cleanup needed in the live "done" panel.
2. **Add password** — inside `IdentityStep`'s "Your details · you sign in first" block, after the name/phone/email grid and before the Terms `<label>`, add a 2-col row of `Password *` + `Confirm password *` (`type="password"`, live `Field`/`inputCls` wrappers, help "At least 8 characters, with a letter and a number."). Validate through the shared `passwordProblem` (`lib/password.ts`, PR #244) — min-8 + at least one letter + at least one number (max-128), surfaced as the failing-rule inline hint (`.`-suffixed) — plus mismatch → "Passwords don't match.", wired ahead of the terms check. Reuse `AcceptForm`'s rules exactly (same helper). Flow stays 2 steps.
3. **PROPRIETOR role** — brief says **no visible wizard change**. The live wizard has **no role picker for the creator** (they become the ADMIN by construction), so nothing renders differently. The only authored place a self-role appears is the wireframe's `Your role` select (`Headmistress / Headmaster / Proprietor / IT lead / Other`) — a *different* surface not in the live flow. Registering PROPRIETOR is an RBAC/role-model addition (see `lib/access.ts`, `lib/staff-roles.ts`), out of my cartography scope — hand to Kofi/Sarah/Claude Code. Confirmed: **no signup UI element to map for this item.**

4. **Done-phase OTP-finish (INCR-AUTH-OTP / PR #243 — gated by `AUTH_OTP_LIVE`)** — when `result.otpLive` is true, `DonePanel` hides the `Sign in →` button and renders `OnboardingOtpFinish` (auto-`requestOtp` on mount → **"Verify & go to dashboard"** → `/dashboard`); when false, the gold `Sign in →` → `/login?accepted=1` stays. The `Go to sign in` → `/login?accepted=1` link is always present (AC-07 no-orphan). Full copy/tokens in §3.3.

---

## 6. Q5 — Brief note on the L2/L3 surface homes (do NOT deep-map now)

- **`schoolup-2fa-enrolment.html`** — `Settings → Security & 2FA` ("Security & two-factor authentication", admin enrolment walkthrough, "2 of 3 admins enrolled"). **Plausible neighbour for L2** if L2 = Settings-side account security, but it is specifically **2FA enrolment**, not a user list / role-grant CRUD. Lives under Settings; Tier 4 "operational parity."
- **`schoolup-activation-segregation.html`** — **NOT user management.** It is **bookkeeping-module activation co-signing** (segregation of duties, initiator + co-signer) at `Settings → Books / Activation`. It only *references* `Staff → Permissions` ("promote a staff member to admin") as an escape hatch — so the real **L2 user-management** home is more likely the **Staff / Permissions** surfaces, not this file. **Naming trap.**
- **`schoolup-archive-password-recovery.html`** — **NOT the login forgot-password (L3) home.** "Password" here = the **encryption key of a downloaded data archive** (encrypted ZIP export, Tier 4): *"Archive passwords are not recoverable by Omnischools… generate a fresh archive."* It is about export cryptography, not account sign-in reset. L3 (login forgot-password) will be an **auth/login** surface, not this one. **Naming trap.**

**Net for later:** of the three, only `2fa-enrolment` is a genuine Settings-security surface; the other two are false friends by filename. Confirm the true L2 (Staff → Permissions / user-management) and L3 (login reset) surface homes before starting L2/L3 — likely they are *not* these three.

---

## 7. Drift / notes log

1. **Primary surface has no password step.** INCR-33's password step is *new design*, not a port — but it is fully constrained by (a) the wireframe precedent (fields, order, confirm rationale, `*` markers) and (b) the live `AcceptForm` (styling, labels, and the shared `passwordProblem` validation). The rule is **min-8 + at least one letter + at least one number (max-128)**, single-sourced in `lib/password.ts` (`passwordSchema`/`passwordProblem`, PR #244) — reuse that helper; do not add a strength meter or re-hardcode the strings.
2. **"Step" is ambiguous.** Live flow is 2 steps; unified surface is 6→8. Recommended: password **inline** in the identity step (no counter change). A literal 3rd step is allowed but unshown in any surface — if chosen, update all counter/pill strings.
3. **CSSPS is optional in schema** (`csspsCode … .optional()`). Removing the UI field is safe; whether to drop the schema/type key is a data-model decision (out of scope — Kofi/Claude Code).
4. **Phone-first login vs password.** The current admin signs in by phone/OTP ("Sign in with your phone number", `DonePanel`). Adding a password at signup is additive; confirm with product whether phone/OTP remains a parallel path (the AcceptForm footnote "You can also sign in with your phone via OTP" suggests both coexist) — affects the identity-step lede copy ("you sign in with your phone number").
5. **Proprietor role has a wireframe precedent but no live-wizard slot.** Item (3) is invisible in signup UI as briefed; the only authored `Proprietor` appears in a non-live surface's role select. Nothing to render.
6. **`full-wizard.tsx` is not the target.** It mirrors the unified surface's long flow and is used for super-admin tenant setup. Build the password step in `wizard.tsx` only.
7. **No-alpha discipline.** New password fields use `border-border-2` / `bg-gold-bg` (filled tint) / `focus:border-gold` — all solid tokens. Verify in the live preview, not the build (memory *no-alpha-token-opacity*).
8. **OTP-first is flag-gated.** The done-phase OTP-finish step (§3.3) renders only when `otpLoginRequired()` (`authIsLive() && AUTH_OTP_LIVE`) is true; default OFF, so the default done panel keeps the `Sign in →` / `Go to sign in` links to `/login?accepted=1`. The password rule (min-8 + letter + number) is single-sourced in `lib/password.ts` (PR #244). Verify both against the flag/helper, not a build snapshot — see `docs/senior/incr-auth-otp-first-login-ruling.md`.

---

*Map produced against: `Surfaces/schoolup-unified-onboarding.html` (primary), `Surfaces/schoolup-onboarding-wireframes.html` §01 (password/role precedent), `Surfaces/schoolup-oversight-onboarding.html` (excluded — Oversight product); live `components/onboarding/wizard.tsx`, `components/onboarding/full-wizard.tsx`, `components/auth/accept-form.tsx`, `app/(marketing)/accept/[token]/page.tsx`, `lib/onboarding.ts` (`OnboardSchema`, `OWNERSHIPS`); and a brief scan of `schoolup-2fa-enrolment.html`, `schoolup-activation-segregation.html`, `schoolup-archive-password-recovery.html` for L2/L3.*
