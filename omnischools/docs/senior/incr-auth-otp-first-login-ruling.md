# INCR-AUTH-OTP — Ruling: OTP-mandatory first login + auto-sign-in after onboarding

**Steward:** Kofi (domain / spec) · **Status:** Ruled — buildable path. Owner said "proceed." One soft owner-preference flagged (§8), non-blocking.
**Scope:** (a) OTP-mandatory FIRST login for every account; (b) auto-sign-in after onboarding.
**Out of scope:** security headers/CSP (parallel); leaked-password + rate-limit (follow-up).
**Directive (verbatim):** "keep SMS and OTP as mandatory for first time login. subsequent logins with phone would also require OTPs, passwords login however wouldn't. Also, add the auto-sign-in after onboarding."

## 1 · The fork — RULED: **Option A** (reject B)

Option A = the onboarding OTP-verify BOTH confirms the phone AND establishes the session (the "auto-sign-in" *is* the OTP-verified session). Rationale:

1. **B contradicts the directive.** The directive says OTP is mandatory for "first time login" with no creator carve-out. B admin-confirms the creator so their first auth is a password with no OTP — the exact case forbidden. A makes every first auth (creator + invited) an OTP.
2. **A is the lazier and safer change.** A keeps `createPasswordUser` on the existing anon `signUp` (unconfirmed phone, `lib/auth/index.ts:236-251`) and drops the held branch's admin path. B *adds* a service-role path + `SUPABASE_SERVICE_ROLE_KEY` dependency + a self-blessing "confirmed on create" state. Less code, no new privileged dependency, directive met.
3. **A reuses a shipped pattern verbatim** — the L3 reset flow (`components/auth/reset-form.tsx`, `verifyResetOtp` at `lib/actions/auth.ts:129-136`) already does phone → `requestOtp` → verify (no redirect) → session → `/dashboard`.
4. **A's costs are already paid** — live SMS is a hard precondition for the whole feature regardless (invited users need it), the OTP step is gated inert until SMS is live (§5), and it has a non-blocking escape (AC-07). No superior third option: skipping auto-sign-in fails part (b); OTP-verify + admin-confirm together is incoherent.

## 2 · "First-time login" definition + enforcing signal

**First-time login = the first authentication of an account whose Supabase phone is unconfirmed (`phone_confirmed_at == null`).** Enforcement is **GoTrue-native — do NOT add an app check, do NOT admin-confirm.** `createPasswordUser` creates the account via anon `signUp` → unconfirmed phone; with Supabase "Confirm phone" ON (precondition P3), GoTrue **refuses `signInWithPassword` on an unconfirmed phone**, so the first OTP is mandatory by construction. Once confirmed, password login is natively permitted. No app-level `phone_confirmed_at` pre-check (it needs a privileged admin lookup on the hot path and buys nothing over the native block). **Never admin-confirm** in any onboarding/accept/admin path — that single line, if crossed, silently voids the whole guarantee (it is what B and the held branch do). Dependency: the native block exists only when "Confirm phone" is ON — if OFF, `signUp` auto-confirms and the guarantee evaporates (hence P3, and the pre-SMS interim keeps it OFF as the safe no-lockout state).

## 3 · Messaging (the real current defect) — enumeration-safe, no server branching

Fix with **static UI copy only** (a state-dependent message would be an existence oracle — AC-S3): a persistent static hint on the Password tab (`components/auth/login-form.tsx`) — *"First time signing in? Verify your number on the Phone OTP tab first."*; the password-failure message stays the generic *"Invalid phone or password."* (optionally with the same static line appended, shown on every failure). Accept page + `?accepted=1` banner steer to the OTP tab. `passwordLogin`/`signInWithPassword` otherwise unchanged — the password tab stays OTP-free.

## 4 · Per-question rulings

- **4.1 Invited-user first login:** same rule. `acceptInvite` keeps anon `signUp` → unconfirmed. Accept already routes to `/login?accepted=1`, where the only working first login is the OTP tab. Already correct today; only §3 messaging changes. No admin-confirm.
- **4.2 Subsequent logins:** Phone tab → OTP (unchanged). Password tab → NO OTP once confirmed (unchanged, stays single-factor).
- **4.3 Auto-sign-in (Option A mechanics):** on `onboardSchool` success (done phase, `full-wizard.tsx:234-242`): **OTP-live ON** → auto-issue one `requestOtp` to the creator's effective admin phone (already computed at `full-wizard.tsx:225-231`), show the code step, `verifyLogin` → phone confirmed + session established → `/dashboard`. **OTP-live OFF / dev-bypass** → no OTP step, keep today's "school created — sign in" → `/login`. Impl note: with "Confirm phone" ON, GoTrue may already send a confirmation OTP at `signUp`; issue exactly ONE app-controlled `requestOtp` and tell the user to enter *the latest code* — Claude Code to verify send-at-signup on the live project.
- **4.4 Failure mid-onboarding — must not orphan/block:** the school + account are created before the OTP step (tx committed, `signUp` ran), so the OTP step is purely additive and its failure can't roll back the school. Recovery = ordinary `/login` Phone-OTP tab (identical confirm-and-sign-in). The done phase MUST always render a persistent "Sign in later" → `/login` link (AC-07).

## 5 · HARD PRECONDITION — SMS provider + safe rollout

**Two SMS layers, do not confuse:** Supabase Auth SMS provider (Twilio/MessageBird/Vonage, DEPLOY.md §1.4) sends the **OTP** — this is the precondition; Hubtel/console `sendSms` (`lib/sms/index.ts`) sends our invite/reminder messages — `HUBTEL_*` has nothing to do with OTP.

**New config — one fail-closed flag (no schema):** add `AUTH_OTP_LIVE` to `lib/env.ts` as `enum(["true","false"]).default("false")`, read only when `authIsLive()` is true; helper `otpLoginRequired()` = `authIsLive() && env.AUTH_OTP_LIVE`. It gates the app-visible pieces (onboarding OTP step §4.3, messaging §3); inert under dev-bypass; defaults OFF (fail closed, mirroring `AUTH_DEV_BYPASS` at `env.ts:49-52`). A separate flag is required because `authIsLive()` only means "Supabase auth wired" — not "SMS provider attached"; a prod with the URL set but no provider is `authIsLive()==true` yet OTP-undeliverable.

**Owner deploy prerequisites, in this exact order:** P1 configure Supabase Auth SMS provider (DEPLOY.md §1.4) → P2 confirm a real test OTP delivers to a live Ghana number (MTN/Telecel/AirtelTigo) → P3 enable "Confirm phone" in Supabase Auth (turns ON the native block) → P4 set `AUTH_OTP_LIVE=true`. **Why safe/monotonic:** before P3, `signUp` auto-confirms so password login works for everyone and OTP console-degrades — no lockout; users confirmed before P3 stay confirmed; P1/P2 land SMS before P3 makes anyone depend on it; P4 last so the app only shows OTP-first once it can complete. DEPLOY.md must gain P3 + the `AUTH_OTP_LIVE` row.

## 6 · Reconciliation with `fix/onboarding-auth-confirm` (held branch)

This increment supersedes/merges it. **KEEP** the auto-sign-in *concept* (land the creator in the app). **DROP** the switch of `createPasswordUser` to the service-role ADMIN API with `phone_confirm:true` — `createPasswordUser` stays on anon `signUp`. **CHANGE** the auto-sign-in mechanism from `signInWithPassword` to OTP-verify (§4.3) — the held branch's password auto-sign-in only worked because it admin-confirmed. Net: take only the auto-sign-in idea; re-mechanise as OTP.

## 7 · Schema / state — NONE

No migration, no `ref_user` marker — **does not pull in Wells.** The signal is Supabase-owned (`phone_confirmed_at`). Only new state is the `AUTH_OTP_LIVE` env flag (config, not schema).

## 8 · Owner open-call (soft, non-blocking)

- **Invited-user auto-sign-in parity** (inline OTP on `acceptInvite`) is directive-silent — ruling: **defer** (out of scope); invited users keep accept → `/login?accepted=1` → OTP tab. Recommend a small follow-up if the owner wants parity.
- **Onboarding OTP UX shape:** default inline OTP card on the done phase (faithful "auto-sign-in"); a primed-`/login` redirect is an acceptable lower-effort degradation but isn't truly auto. Default inline; owner-tweakable.

## 9 · Acceptance criteria

**Functional (Quinn)**
- **AUTH-OTP-01** — Given a newly created account (creator or invitee) with `phone_confirmed_at==null` and "Confirm phone" ON, when it attempts password login with the correct password, the system must refuse and issue no session.
- **AUTH-OTP-02** — Given the same unconfirmed account, when it completes `requestOtp`→`verifyLogin`, the system must confirm the phone AND establish a session AND land at `/dashboard`.
- **AUTH-OTP-03** — Given `phone_confirmed_at!=null`, when it password-logs-in correctly, a session is issued with no OTP.
- **AUTH-OTP-04** — Given any account, when it uses the Phone-OTP tab, an OTP is required (unchanged).
- **AUTH-OTP-05** — Given onboarding OR invite-accept, when the account is created via `createPasswordUser`, it uses anon `signUp` (no admin API, no `phone_confirm:true`) and the phone is unconfirmed.
- **AUTH-OTP-06** — Given `otpLoginRequired()` true and `onboardSchool` ok, when the wizard reaches done, it auto-issues one `requestOtp` to the creator's admin phone, shows the code step, and on verify redirects to `/dashboard`.
- **AUTH-OTP-07** — Given the onboarding OTP step, when send/verify fails OR the user picks "sign in later," the school+account persist, a `/login` link is present, and the account is reachable via the `/login` OTP tab (no orphan/block).
- **AUTH-OTP-08** — Given `otpLoginRequired()` false, when onboarding reaches done, NO OTP step shows and the terminal card links to `/login`.
- **AUTH-OTP-09** — Given an accepted invite, when the user lands on `/login?accepted=1` and uses the OTP tab, first login succeeds; the Password tab is refused until confirmed; banner+hint steer to OTP.
- **AUTH-OTP-10** — Given the Password tab, when it renders (and on password-login failure), a static first-login-OTP hint shows that does not vary with account existence/confirmation.
- **AUTH-OTP-11** — Given this increment, when inspected, there is no new migration/`ref_user` marker; the only new config is `AUTH_OTP_LIVE` (`default "false"`, read only when `authIsLive()`).

**Security (Sarah)**
- **AUTH-OTP-S1** — No path (onboarding/accept/admin) sets `phone_confirmed_at`/auto-confirms without a real OTP verify; `createPasswordUser` uses no admin API/`phone_confirm:true`. A freshly created account MUST NOT password-login (grep + mutation).
- **AUTH-OTP-S2** — No lockout: with `AUTH_OTP_LIVE=false`/"Confirm phone" OFF, password login stays available (auto-confirmed signups); the onboarding OTP step never blocks school creation (tx commits first); flipping the flag is gated behind P1–P4.
- **AUTH-OTP-S3** — Enumeration-safety: the Password-tab error+hint are identical for unknown / registered-unconfirmed / wrong-password (no oracle); the OTP send path keeps neutral-always `{ok:true}` (INCR-38).
- **AUTH-OTP-S4** — No admin-confirm backdoor: the held branch's `phone_confirm:true` is NOT present after merge; future service-role paths must not auto-confirm phones.
- **AUTH-OTP-S5** — `AUTH_OTP_LIVE` absent/misspelled resolves false; under `AUTH_DEV_BYPASS=true`, `otpLoginRequired()` is false and no OTP step runs.
- **AUTH-OTP-S6** — No regression: the reset fresh-proof gate (R276, `completePasswordReset`) and INCR-38 OTP enumeration guard remain intact.

## 10 · Grounding index
`components/auth/login-form.tsx`; `lib/actions/auth.ts:34-42` (`passwordLogin`), `:129-136` (`verifyResetOtp`); `lib/auth/index.ts:236-251` (`createPasswordUser`), `:179-201` (`signInWithPhone`/INCR-38), `:116-118` (`authIsLive`); `components/auth/reset-form.tsx`; `lib/actions/onboarding.ts:65-523`; `components/onboarding/full-wizard.tsx:225-242`; `lib/actions/invites.ts:194-300`; `components/auth/accept-form.tsx:30`; `lib/env.ts:49-52` (`AUTH_DEV_BYPASS`); `lib/sms/index.ts`; DEPLOY.md §1.4.
