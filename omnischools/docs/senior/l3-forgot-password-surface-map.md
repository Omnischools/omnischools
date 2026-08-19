# L3 — Forgot-password at Login Surface Map (INCR-36 · Module L / L3)

**Author:** Lucy (design cartographer) · **Status:** design spec, ready for the implementation engineer.
**Scope:** add a **"Forgot password?"** affordance to the live login card, and a **reset flow** that proves identity two ways (**phone OTP** or **email link**) then lets the user **set a new password**. Owner wants **both** paths.
This map finds (there is none) an authored 1:1 surface, re-confirms the two naming traps, and hands over the reusable login-card + accept-form patterns so the net-new screens are visually identical to the existing auth system.

> **Headline finding:** there is **no authored login / sign-in / forgot / reset / recovery surface** anywhere in `Surfaces/*.html` (117 files). The **only** "Forgot password?" string in the whole corpus is a **dead link in the marketing landing login _modal_** (`omnischools-landing.html`), and that modal is a mock (single email-or-phone + password form) that does **not** match the as-built login card (OTP / Password tabs). So the reset screens are **net-new**, assembled from the live **login card** (`login-form.tsx`) + the live **set-password** patterns (`accept-form.tsx`, `change-password-form.tsx`). Everything below constrains that new UI to existing tokens, fields, buttons, and states so nothing is invented.

> Replication discipline: reuse live idioms verbatim; Ghana voice preserved; console-degrade SMS (the reset OTP rides the **existing** `signInWithPhone` infra). **No-alpha token opacity** — no Tailwind slash-opacity on raw-hex tokens; solid tokens / `-bg` tints / `opacity-N` only; verify in the live preview, not the build.

---

## 0. Candidate surfaces — searched, re-confirmed

| Surface / file | Verdict for L3 | Evidence |
|---|---|---|
| *(searched, none exist)* `schoolup-login-* / -signin-* / -sign-in-* / -*forgot* / -*reset* / -*recovery* (login) / -auth-*` | **No such surface.** The login card and reset flow have **no authored `.html`.** | Full `Surfaces/` glob (117 files) + content grep for `Forgot password / Sign in / Welcome back / Phone OTP / Send code / Verify & sign / reset password` → the only hits are the two traps below, the onboarding "Sign in with Google" parent path, and the landing modal. |
| `Surfaces/omnischools-landing.html` (login modal, L1284–1307) | **The ONE authored "Forgot password?" — but a marketing mock, not the app login.** Use it **only** for the link's placement + styling precedent. | `<h2>Welcome back.</h2>` + sub *"Log in to manage your school."*; fields **"Email or phone"** + **"Password"**; then `<a class="forgot">Forgot password?</a>` (dead — no href/onclick); then **"Log in"**. It is a **single-form** login (no OTP/Password tabs), so its **body does not match** the live card; its **forgot-link position/style does** (see §2). |
| `Surfaces/schoolup-archive-password-recovery.html` | **RE-CONFIRMED false friend.** "Password" = the **encryption key of a downloaded data-export ZIP**, not the account/login password. **Not the forgot-password surface.** | `<title>Omnischools — Archive password recovery</title>`; body: *"Archive passwords are not recoverable by Omnischools… only generation of fresh"* (L425), audit reason *"Forgot password — regenerated"* (L502/521/541). It is the **data-export** archive-key flow (min-length **12**, strength meter). Do **not** treat as login reset. (Contributes nothing here except confirming what NOT to copy — no strength meter, min-8 not 12.) |
| `Surfaces/schoolup-2fa-enrolment.html` | **RE-CONFIRMED 2FA only.** Not a login/forgot/reset screen. | `<title>Omnischools — 2FA enrolment</title>`; `Settings → Security & 2FA`; authenticator-app enrolment + QR + "2 of 3 admins enrolled". "Password" appears only as prose. No forgot/reset flow. |
| `Surfaces/schoolup-onboarding-wireframes.html` §01 | **Parent portal "Sign in with Google / manual email"** onboarding — a different product path, not the staff login or its reset. | L1838/1895 "Sign in with"; Google-above-manual; "child name is the hero". Irrelevant to L3 except as the "email-as-handle" precedent (parents use email; staff use phone — see §7.2). |

**Net:** the two L1/L2 traps hold, and no new surface turns up. The genuine home is a **net-new reset flow** next to the live login, built from the patterns in §3–§5.

---

## 1. The as-built login card (reconcile against this) — exact current shape

`components/auth/login-form.tsx`, rendered by `app/(marketing)/login/page.tsx` when `authIsLive()`. Card shell + two flows, **no "Forgot password?" today**:

| Element | Copy / behaviour | Class / token (verbatim) |
|---|---|---|
| Card shell | — | `mx-auto w-full max-w-sm rounded-2xl border border-border bg-surface p-7 shadow-md` |
| Heading | **Welcome _back._** (italic-gold "back.") | `mb-1 font-display text-3xl font-semibold text-navy`; em: `not-italic text-gold [font-style:italic]` |
| Accepted banner *(if `?accepted=1`)* | **"Account ready — sign in below."** | `mb-4 rounded-md bg-green-bg px-3 py-2 text-sm font-medium text-green` |
| Tab bar | **"Phone OTP"** / **"Password"** | wrap `mb-5 flex gap-1 rounded-lg border border-border-2 p-1`; each tab `flex-1 rounded-md py-2 text-sm font-semibold`; active `bg-navy text-bg`, idle `text-navy-2 hover:bg-bg` |
| `fieldClass` (all inputs) | — | `w-full rounded-md border border-border-2 bg-bg px-3.5 py-2.5 text-sm text-navy outline-none transition-colors focus:border-gold focus:bg-surface` |
| OTP step 1 | phone `type="tel"` placeholder **"024 000 0000"** → **"Send code"** / busy **"Sending…"** | button = primary (below) |
| OTP step 2 | 6-digit input placeholder **"••••••"** → **"Verify & sign in"** / busy **"Verifying…"**; back link **"← Use a different number"** | OTP input `${fieldClass} text-center font-mono text-lg tracking-[0.3em]`, `inputMode="numeric"`; back link `w-full text-center text-sm text-navy-3 hover:text-gold` |
| Password flow | phone `type="tel"` placeholder **"Phone — 024 000 0000"** + password `type="password"` placeholder **"Password"** → **"Sign in"** / busy **"Signing in…"** | fields = `fieldClass` |
| Primary button (every step) | — | `w-full rounded-md bg-navy px-5 py-3 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-60` |
| Error (card-level) | server/action message | `mt-4 text-sm text-terra` |

**Actions wired:** `requestOtp(phone)` → `verifyLogin(phone, otp)` → redirect `/dashboard`; `passwordLogin(phone, password)` → redirect `/dashboard` (`lib/actions/auth.ts`). Phone is normalised to E.164 by `normalizeGhanaPhone` (`lib/auth/index.ts`).

---

## 2. "Forgot password?" link — placement & styling

### 2.1 Placement (authored precedent → live card)
- **Authored precedent** (landing modal): the link sits **below the Password input, above the submit button**, right-aligned. CSS `.forgot { display:block; font-size:12px; color: var(--gold); text-align:right; margin-top:-10px; margin-bottom:18px; } .forgot:hover { text-decoration:underline; }`.
- **Live card translation:** render the link **only on the Password tab** (it is meaningless on the OTP tab — that flow needs no password), in the `mode === "password"` branch of `login-form.tsx`, **between the password `<input>` and the "Sign in" `<button>`**, right-aligned. This is the exact spot the surface authored.
  - Recommended class (card-consistent, no-alpha): `mt-1 block text-right text-xs font-medium text-gold hover:underline`. (12px = `text-xs`; gold = `text-gold`; right-aligned; hover underline — a 1:1 port of `.forgot`.)
  - It is a **`Link href="/reset"`** (internal navigation), not a card-state toggle — the reset flow is its own page (§3).

### 2.2 Copy
- Link text: **"Forgot password?"** (verbatim, the only authored string).
- Do **not** add it to the OTP tab. If discoverability is a concern, a one-liner tooltip is out of scope (YAGNI); the OTP tab already **is** a password-free way in (see §6 note).

---

## 3. The reset flow — recommended screen sequence (BOTH paths)

**Home:** a new unauthenticated route **`app/(marketing)/reset/page.tsx`**, next to `login/`, inside the `(marketing)` group (same chrome/header as login & accept). Reuse the **login card shell** verbatim so it reads as the same product. The email path's completion lands on a **tokened** sibling **`app/(marketing)/reset/[token]/page.tsx`** (mirrors `accept/[token]/page.tsx`), because the user returns from their inbox on a link.

Three steps, one method toggle. State machine mirrors `login-form.tsx` (`mode` + `step`).

### Step 1 — Entry (prove-identity method + handle)
Reuse the login card's **tab component** verbatim, relabelled **"Phone"** / **"Email"**.

| Sub-element | Copy | Notes |
|---|---|---|
| Heading | **Reset your _password._** (italic-gold "password.") | `font-display text-3xl font-semibold text-navy` + the `[font-style:italic] text-gold` em, same as login heading |
| Sub-lede | **"Choose how you'd like to prove it's you."** | `mt-1 text-sm text-navy-3` |
| Tab bar | **"Phone"** / **"Email"** | identical tab markup/tokens to login (§1) |
| Phone tab | input `type="tel"` placeholder **"024 000 0000"** → button **"Send code"** / busy **"Sending…"** | reuses `fieldClass` + primary button; `requestOtp` mechanism |
| Email tab | input `type="email"` placeholder **"you@school.edu.gh"** → button **"Send reset link"** / busy **"Sending…"** | reuses `fieldClass` + primary button |
| Back to login | **"← Back to sign in"** | `w-full text-center text-sm text-navy-3 hover:text-gold` (same idiom as "← Use a different number") |
| Error | action message | `mt-4 text-sm text-terra` |

### Step 2 — Confirmation (enumeration-safe; identical whether or not the account exists)
The two paths diverge in shape but share **enumeration-safe copy** — the confirmation must read the same for a real and a non-existent account. Never say "no account found."

**Phone → inline OTP entry** (this IS the confirmation; mirrors login's `step === "otp"` exactly):
| Sub-element | Copy | Notes |
|---|---|---|
| Heading | **Check your _phone._** | italic-gold em |
| Sub-lede | **"If that number has an account, we've sent a 6-digit code. Enter it below."** | enumeration-safe — the "If…" hedge is deliberate; `text-sm text-navy-3` |
| OTP input | placeholder **"••••••"** | `${fieldClass} text-center font-mono text-lg tracking-[0.3em]`, `inputMode="numeric"` |
| Button | **"Verify & continue"** / busy **"Verifying…"** | primary button; on success → Step 3 (session now established by OTP verify) |
| Resend / back | **"← Use a different number"** | same back-link idiom; a "Resend code" text link (`text-gold`) is optional (YAGNI unless product asks) |

**Email → terminal "check your inbox" card** (the user leaves to click the emailed link):
| Sub-element | Copy | Notes |
|---|---|---|
| Heading | **Check your _email._** | italic-gold em |
| Body | **"If that email has an account, we've sent a link to reset your password. Open it on this device to continue."** | enumeration-safe; `text-sm text-navy-2` |
| Fine print | **"The link expires in 30 minutes. Didn't get it? Check spam, or try again."** | `mt-2 text-xs text-navy-3`; "try again" = link back to Step 1 |
| Back to login | **"← Back to sign in"** | same idiom |

*(There is no green success banner at Step 2 — nothing has changed yet; a calm neutral card, per the landing modal's register and archive-recovery's non-alarmist tone.)*

### Step 3 — Set the new password (NO current-password field)
Reuse **`change-password-form.tsx`'s New / Confirm** block **minus the "Current password" field** — identity is already proven (OTP verified, or the email token). This is the closest sibling; it already has the shared `passwordProblem` (min-8 + a letter + a number) + confirm-match live-validation UX. (The shipped build lifts this into a dedicated `components/auth/set-new-password.tsx`.)

| Field / element | Copy | Class / token (verbatim from `change-password-form.tsx`) |
|---|---|---|
| Heading | **Set a new _password._** | italic-gold em, `font-display text-2xl font-semibold text-navy` |
| Sub-lede | **"Almost done — choose a password you'll remember."** | `mt-1 text-sm text-navy-3` |
| Label | **"New password"** | `mb-1 block text-xs font-semibold text-navy` (`labelClass`) |
| Input 1 | placeholder **"At least 8 characters"** | `fieldClass`; `type="password"`; `autoComplete="new-password"` |
| Label | **"Confirm new password"** | `labelClass` |
| Input 2 | placeholder **"••••••••"** | `fieldClass`; `type="password"`; `autoComplete="new-password"`; submit-on-Enter |
| Live validation | failing rule via `passwordProblem` (`.`-suffixed): **"Password must be at least 8 characters"** / **"Password must include at least one letter"** / **"Password must include at least one number"** / **"Password must be at most 128 characters"**; mismatch: **"Passwords don't match."** | `text-[12px] text-terra` (from `set-new-password.tsx`; rule single-sourced in `lib/password.ts` — `passwordSchema`/`passwordProblem`, PR #244 — shared with `accept-form.tsx` / `change-password-form.tsx`) |
| Button | **"Set new password"** / busy **"Saving…"** | primary button; `disabled` until `!passwordProblem(next) && next === confirm` (min-8 + a letter + a number, max-128, and matching) |
| Success | → redirect **`/login?reset=1`** | login card shows a green banner **"Password updated — sign in with your new password."** (the `reset` branch of `login-form.tsx`'s banner) |
| Error | server message | `text-sm text-terra` |

**Why no "Current password":** the reset-completion user is anonymous-but-proven (OTP/token), not a signed-in session. So it is `accept-form` shaped (set-from-nothing), **not** `change-password-form` shaped (re-auth the old one). We borrow `change-password-form`'s *New/Confirm* markup because it is the newest and cleanest, but drop `current` and its `signInWithPassword` re-auth.

---

## 4. Tokens / type (solid tokens only — no-alpha discipline)

Identical palette to the login card & accept-form; every class above is Tailwind, never raw `var()` in JSX:
`bg-navy #1A2B47` (buttons, headings), `bg-navy-deep #13203A` (button hover), `text-navy-2 #2D3F5C` (body labels), `text-navy-3 #5C6675` (sub-lede/meta/back-links), `text-gold / bg-gold #C8975B` (accent, the forgot link, italic-em, resend link), `bg-bg #FAF7F2` (input bg), `bg-surface #FFFFFF` (card, focus bg), `text-green / bg-green-bg #2F6B47 / #E5EFE8` (success banner), `text-terra #B84A39` (errors/validation), `border-border #E5DFD3` (card), `border-border-2 #D4CCBA` (inputs, tab bar). Type: **Fraunces** display (headings + italic-gold `<em>`), **Manrope** body/labels, **JetBrains Mono** for the **OTP code input only** (`font-mono tracking-[0.3em]`) — passwords are **not** mono.

**No-alpha watch:** the login card, accept-form and change-password-form all already use solid tokens + `disabled:opacity-60` — copy them exactly; do not introduce `text-bg/70`, `bg-navy/80` etc. on these raw-hex tokens. Verify focus/hover/disabled in the live preview.

---

## 5. Interaction states (per step, exhaustive)

| Step | empty / idle | loading | error | populated / success |
|---|---|---|---|---|
| **1 Entry** | tabs shown, empty handle input, button enabled | button **"Sending…"**, `disabled` | invalid handle → `text-terra` line (e.g. **"Enter a valid phone number."** — verbatim from `requestOtp`; email → **"Enter a valid email."**) | phone → advance to Step 2 OTP; email → advance to Step 2 email card |
| **2 Phone (OTP)** | empty 6-digit input | button **"Verifying…"**, `disabled` | wrong/expired code → `text-terra` (**"Invalid code."** verbatim from `verifyLogin`) | session established → Step 3 |
| **2 Email** | terminal card, nothing to submit | — | — | user leaves for inbox; returns via tokened link → `reset/[token]` renders Step 3 |
| **2 Email (bad token)** | — | — | invalid/expired token → `accept/[token]`-style guard card: **"This reset link isn't valid or has expired — request a new one."** + **"Go to reset →"** (`text-gold`) | — |
| **3 Set password** | both fields empty, button `disabled` | button **"Saving…"** | failing-rule via `passwordProblem` (min-8 + letter + number) / mismatch inline (`text-[12px] text-terra`); server error `text-sm text-terra` | success → redirect `/login?reset=1` (green banner) |

**Enumeration-safety rule (states 1→2):** Step 1 must advance to Step 2 with the **same** confirmation copy **regardless** of whether the handle matches an account. Do not branch the UI on account existence. (Mechanism caveat for the implementer in §7.3.)

---

## 6. Cross-surface / cross-flow hooks

- **Reset ↔ login card** — the forgot link lives on the Password tab; success returns to the login card with `?reset=1` (a new banner branch next to `?accepted=1`). The reset flow reuses the login card's **tab**, **fieldClass**, **OTP input**, **primary button**, and **back-link** verbatim, so the two pages are visually one system.
- **Phone reset ≈ OTP login + set-password** — because the **Phone OTP** login tab already signs a user in **without a password**, a user who forgot their password can *already* get in via OTP and then use **Settings → Login & security** (`change-password-form`, L2a). The L3 phone path is that same OTP verify with a set-password step bolted on and no `/dashboard` redirect. Worth the owner knowing: the phone path is mostly a *discoverability + one-shot* convenience over an existing capability. Both paths still map as requested.
- **Set-password step ↔ accept-form / change-password-form** — the completion step is the third instance of the same New/Confirm/min-8 pattern (`accept-form` = invite; `change-password-form` = L2a self-serve; L3 = reset). Keep the three visually identical; only the presence of "Current password" and the surrounding chrome differ.
- **Email handle ↔ parent portal** — parents authenticate with **email** (onboarding "Sign in with Google/email"); staff with **phone**. `ref_user.email` is **optional**, so email reset cannot be the only path — which is exactly why both are needed (§7.2).

---

## 7. Data-model / infra flags (out of my scope — for Kofi / Claude Code / Sarah)

Design mapping only; the calls below are the implementer's, but the surfaces + live seam constrain them:

1. **Phone path is fully wired already.** `signInWithPhone` / `verifyPhoneOtp` exist (`lib/auth/index.ts`); after `verifyPhoneOtp` establishes the session, **`updatePassword(newPassword)`** (the `updateUser` seam, same one `changeOwnPassword` uses) sets the new password — but **without** the current-password re-auth (identity is proven by the OTP, not an old password). So a new action, e.g. `resetPasswordWithOtp(phone, code, newPassword)` = `verifyPhoneOtp` → `updatePassword`, no `signInWithPassword`. Min-8 guard verbatim from `changeOwnPassword`.
2. **Email path is NOT wired.** The typed `SupabaseAuthApi` (`lib/auth/index.ts` L117–141) exposes `signInWithOtp`, `verifyOtp(type:"sms")`, `signUp`, `signInWithPassword`, `updateUser`, `getUser/Session`, `signOut` — **no `resetPasswordForEmail` and no recovery-type `verifyOtp`.** Email reset is **net-new infra** (add `resetPasswordForEmail` + a recovery-token verify, land the user on `reset/[token]`). Also `ref_user.email` is **optional** (`db/schema/identity.ts`), so the email path only works for accounts that set one — the phone path is the primary/default.
3. **Enumeration-safety vs Supabase mechanism (Sarah).** The **copy** is enumeration-safe (§5), but Supabase `signInWithOtp({ phone })` may **auto-create** a user for an unknown phone, and SMS cost/rate accrues on every attempt. Confirm the phone entry does **not** silently provision accounts or leak existence via timing/rate errors. Add rate-limiting on Step 1.
4. **Console-degrade SMS.** In dev bypass, `signInWithPhone` logs `"[auth:dev] OTP requested for +233… (bypass enabled)"` and returns ok; `verifyPhoneOtp` no-ops ok; `updatePassword` no-ops ok. So the whole **phone reset path is exercisable in dev** with the console standing in for the SMS — verify the flow reaches Step 3 under `AUTH_DEV_BYPASS`.
5. **Token model for email** — mirror `invites` (`accept/[token]`): a single-use, expiring token row (30-min expiry per the Step-2 copy), consumed at Step 3. Do **not** reuse the receipt `publicToken` pattern (`r/[token]` is a read-only gate, wrong semantics).

---

## 8. Drift / notes log

1. **Zero authored login/reset surfaces.** The only "Forgot password?" is a **dead link in a marketing mock** (`omnischools-landing.html`); the two "recovery/2FA" files are re-confirmed traps (archive-ZIP key; authenticator enrolment). The reset flow is **net-new**, but fully constrained by `login-form.tsx` (card, tabs, fieldClass, OTP input, primary button, back-link) + `change-password-form.tsx` / `accept-form.tsx` (New/Confirm, min-8, verbatim validation strings). **Assemble; do not invent.**
2. **Forgot link placement is authored** — below the password input, above the submit, right-aligned, 12px gold, hover underline (`.forgot`). Port to the **Password tab only** of the live card as a `Link href="/reset"`.
3. **Both paths requested; phone is primary, email is net-new infra.** Phone reuses live OTP seams end-to-end; email needs `resetPasswordForEmail` + a recovery-token route and only serves accounts with an email on file.
4. **No "Current password" on the reset-completion step** — identity is OTP/token-proven, so it's `accept-form`-shaped (set from nothing), not `change-password-form`-shaped (re-auth old). Borrow the latter's New/Confirm markup, drop `current` + the re-auth.
5. **No strength meter; the account rule is min-8 + a letter + a number, not min-12.** The archive surface's meter + 12-char rule are the data-export ZIP key — a different concern. The account pattern is meterless and single-sourced in `lib/password.ts` (`passwordSchema`/`passwordProblem`, PR #244); keep it.
6. **Enumeration-safe copy** — Step-1→2 confirmation is identical for real and unknown handles; never "no account found." The *mechanism* (Supabase auto-create / rate leak) is a security flag for Sarah (§7.3), not a UI branch.
7. **Home:** `app/(marketing)/reset/page.tsx` (+ `reset/[token]/page.tsx` for the email landing), unauthenticated, same chrome as `login/` and `accept/`. Success → `/login?reset=1` with a green banner mirroring `?accepted=1`.
8. **Phone reset overlaps the OTP login tab** — a forgetful user can already sign in via OTP and change the password in Settings (L2a). The phone reset path is a convenience over that existing capability, not new capability; owner's call whether both paths ship at once or email lands later.

---

*Map produced against: `Surfaces/omnischools-landing.html` (login/signup modals — the only authored "Forgot password?"), `Surfaces/schoolup-archive-password-recovery.html` + `schoolup-2fa-enrolment.html` (re-confirmed traps), full `Surfaces/` glob (117 files, no login/reset surface); live `components/auth/login-form.tsx`, `accept-form.tsx`, `change-password-form.tsx`, `app/(marketing)/login/page.tsx`, `app/(marketing)/accept/[token]/page.tsx`, `app/(marketing)/r/[token]/page.tsx`, `lib/actions/auth.ts`, `lib/auth/index.ts`. Pairs with `docs/senior/l1-signup-surface-map.md` and `docs/senior/l2-login-password-surface-map.md`.*
