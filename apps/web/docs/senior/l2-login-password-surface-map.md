# L2 — Login & Password / User Management Surface Map (INCR-34 · Module L / L2)

**Author:** Lucy (design cartographer) · **Status:** design spec, ready for the implementation engineer.
**Scope:** two parts of INCR-34 — **(A)** a self-service **change-password** form, and **(B)** an admin **user-management** screen (list users · reset password · block / activate accounts).
This map finds the authored home for each, reconciles against the live IA, and hands over the reusable patterns so the build is mechanical.

> **Headline finding:** neither part has a dedicated 1:1 authored surface. **No `.html` surface contains a change-password form, and none contains a user-management list/table.** Both are **net-new UI assembled from existing in-app patterns**, dropped into two homes the design system *already names*: `Settings → Login & password` (self) and `Settings → Roles & access` = the **`/staff`** page (admin). Everything below constrains that new UI tightly to existing tokens, fields, table, and the shared confirm-dialog so nothing is invented.

> Replication discipline: reuse live idioms verbatim; Ghana voice preserved (Headmistress, Accountant, Form Master, Bursar). **No-alpha token opacity** — no Tailwind slash-opacity on raw-hex tokens; solid tokens / `-bg` tints / `opacity-N` only; verify in the live preview.

---

## 0. Candidate surfaces — re-confirmed, deeper than L1

| Surface / file | Verdict for L2 | Evidence |
|---|---|---|
| `Surfaces/schoolup-2fa-enrolment.html` | **2FA enrolment ONLY.** Not a change-password form, not a user list. | Grep for `change/new/current/confirm/reset password`, `block`, `activate` → **zero matches**. Content is the authenticator-app enrolment walkthrough + QR + OTP grid + a "School-wide 2FA status" card (**"2 of 3 admins enrolled — Joyce pending"**). "Password" appears only as prose ("protects your school's records from anyone who might guess or steal your password"). Recovery is handled by a *second admin* (dual-control), cross-refs activation-segregation. |
| `Surfaces/schoolup-activation-segregation.html` | **NOT user management** — bookkeeping-module activation co-signing (`Settings → Books / Activation`). But it **names the true user-admin home**. | It references **"Staff → Permissions"** twice as the place to "**Promote a staff member to admin**" (the "Add another admin" escape-hatch card). So the role-grant / user-admin surface it points at is the **Staff** area, not this file. |
| `Surfaces/schoolup-archive-password-recovery.html` | **False friend.** "Password" = the **encryption key of a downloaded data-export ZIP**, not the login/account password. | Tier 4, "Pairs with data-export": *"Archive passwords are not recoverable by Omnischools… generate a fresh archive."* Min length **12** (account is 8 — see §3). **Do NOT** treat as the login change-password home. It **does** contribute one reusable visual (password field + strength meter + "New password / Confirm / ✓ Match") — usable if a strength meter is ever wanted, but the account pattern (accept-form) has none; see §3.3. |
| `Surfaces/schoolup-accountant-role.html` | **Role/permission model, not a user list.** | Onboarding step to enable the Accountant role + invite one person (*"They'll get an email with a secure link to set their password. You can also do this later from **Settings → Roles**."*). Gives the **permission-state vocabulary** (§5) and confirms invite = *secure set-password link*. No table, no block/activate. |
| `Surfaces/schoolup-settings.html` | **The wayfinder that names BOTH parts.** Group 04 "Access & security" has exactly two cards. | Card **"Roles & access"** — *"User accounts for headteacher, accountant, teachers…"*, state **"1 inactive user"** (warn), health tile **"8 active users"**. Card **"Login & password"** — *"Password policy, session length, 2FA for admins, login activity log."* The `Roles & access` **deep-tab exists but renders no table** (state B of the file shows the School-info tab). So even the hub does not author a user table. |
| *(searched, none exist)* `schoolup-staff-list / -users / -permissions / -roles / -members / -access-*` | **No such surface.** | Full `Surfaces/` glob (117 files) has only `schoolup-staff-record-multirole.html` (a per-person **profile**, not a list) and `schoolup-staff-compensation.html` (payroll). `oversight-access-audit.html` is the GES Oversight product, not school user-admin. |

**Net:** L1's three naming traps hold. The genuine homes are (A) `Settings → Login & password` and (B) `Settings → Roles & access` → **`/staff`**. Neither authors the actual form/table — build from live patterns below.

---

## 1. Recommended HOMES (concrete routes)

### (A) Self change-password → **`/settings/security`** (the live "Login & security" page)
- Live: `app/(app)/settings/security/page.tsx` + `components/settings/security-form.tsx`. Today it renders **only** the 2FA-required toggle + a Session-length `<select>` — **no password fields**.
- The Settings hub already routes here via the **"Login & password"** card (`lib/settings-nav.ts` → group 04, key `security`, `href: "/settings/security"`, desc *"Password policy, session length, two-factor for admins and the login activity log."*).
- **Recommendation:** add a **"Change password"** card as the first block inside `SecurityForm` (above the 2FA card), so the page delivers on its own card copy. Do **not** create a new route — the home already exists and is named. Page `<h1>` stays **"Login & <em>security.</em>"**; the sub-lede can extend to mention password.

### (B) Admin user-management (list · reset · block / activate) → **`/staff`** (the live Staff list)
- The Settings **"Roles & access"** card links here: `lib/settings-nav.ts` → group 04, key `roles`, **`href: "/staff"`, `external: true`**, desc *"Staff accounts and the roles they hold — who can record payments, send announcements or see records."* This is the design commitment: **Roles & access == the Staff page.** activation-segregation's "Staff → Permissions" is the same place.
- Live: `app/(app)/staff/page.tsx` → `components/staff/staff-browser.tsx` → `staff-table.tsx` → `staff-row.tsx`. Already a **user list**: columns **Name · Phone · Email · Roles**, per-row **Edit / Invite / Delete**, per-row inline **RoleEditor** (add/remove role pills), bulk-delete, `EmptyState`.
- **Recommendation:** **extend the existing StaffTable/StaffRow** — add a **Status** column and per-row **Reset password / Block / Activate** controls. Do **not** build a parallel "users" screen (the staff list already *is* the account list — one `ref_user` per person, roles attached). This is the lazy and correct home; a second screen would duplicate the roster.
- **Do NOT** put block/activate under `/settings/security` — that page is the *self* surface (the signed-in admin's own login), and settings.html keeps "Roles & access" (accounts) and "Login & password" (own login) as **two distinct cards**. Keep them distinct.

---

## 2. (B) User-management table — mapped onto the live Staff table

No authored table exists, so the **live `StaffTable` is the base**; below is its exact current shape plus the INCR-34 additions.

### 2.1 Current columns & per-row controls (live, `staff-table.tsx` / `staff-row.tsx`) — keep 1:1
| Col | Header | Cell | Notes |
|---|---|---|---|
| 1 | *(checkbox)* | `HeaderCheckbox` / `RowCheckbox` (`components/ui/selection`) | drives bulk bar |
| 2 | **Name** | `<Link href="/staff/{userId}">` (`hover:text-gold`); inline-editable `<input>` when `editing` | opens the staff profile |
| 3 | **Phone** | `font-mono text-xs text-navy-2`; editable `type="tel"` | E.164 login handle |
| 4 | **Email** | `text-navy-2`, `—` fallback; editable `type="email"` | optional |
| 5 | **Roles** | `<RoleEditor>` — role pills (`rounded-pill bg-gold-bg text-navy`) each with `×` remove; `+ role` datalist-add | this **is** the "Staff → Permissions" grant UI |
| 6 | *(actions)* | right-aligned: **Edit** (navy-3 → hover gold) · **Invite** (navy-3 → hover gold) · **Delete** (navy-3 → hover terra) | while editing: **Save** (green) / **Cancel** (navy-3); after invite: **"Copy invite link"** → "Link copied ✓" |

Header row: `border-b border-border bg-bg text-left text-xs uppercase tracking-wide text-navy-3`; body `divide-y divide-border`; rows `align-top hover:bg-bg`. Card wrap: `overflow-hidden rounded-xl border border-border bg-surface`.

### 2.2 INCR-34 additions (net-new, prescribed)
- **New "Status" column** (insert between Roles and actions, or right of Email). Renders a **status pill** (§5). Default all existing rows **Active**.
- **New per-row actions**, appended to the actions cell in the non-editing state:
  - **Reset password** — *reuse the existing invite mechanism*: `createInvite` already returns a token and the row already surfaces **"Copy invite link"** (`/accept/{token}`, `components/auth/accept-form.tsx` sets the new password). So **"Reset password" = re-issue a set-password link** for that user. Relabel/duplicate the existing **Invite** affordance as **"Reset password"** for already-active users (same call, same copy-link UX). No new flow to design; the set-password screen (accept-form: `Set a password` / `Confirm password`, min-8) is the landing.
  - **Block** — destructive; opens the shared **ConfirmDialog** (§6). On confirm, sets the account inactive **for this school** (see §7 schema note). Style like Delete: `text-navy-3 hover:text-terra`.
  - **Activate** — shown **instead of Block** when a row is already Blocked/Inactive; positive action, non-destructive (no confirm needed, or a light gold confirm). Style `text-navy-3 hover:text-green`.
- **`last-active` column?** — **skip.** `ref_user` has no `lastLogin` field (§7) and no surface authors it. YAGNI unless product asks; the "login activity log" lives separately (`/settings/audit`, adjacent, out of L2 scope).

### 2.3 Empty state (reuse verbatim)
Live `staff/page.tsx` already renders the shared `EmptyState` (`components/ui/empty-state.tsx`) when `staff.length === 0`: icon `<Users/>`, title **"No staff yet."**, body *"Add teachers and other staff so they can take attendance, enter scores and collect fees."* Keep it. (A "no results after filter" state is handled by `StaffBrowser`, not the empty roster.)

### 2.4 Filter / header context (live `StaffBrowser`) — unchanged
The page hero (`Omnischools · Staff` eyebrow → `The people who <em>run it</em>` → gold rule → lede) + role/qualification filters + `AddStaffForm` + Compensation/Import links stay. Status becomes an additional filterable facet only if trivial; otherwise leave filtering as-is (YAGNI).

---

## 3. (A) Change-password form — new design, fully constrained

**No authored change-password form exists** (2FA surface = enrolment; archive surface = export key). Build it from the two canonical in-app patterns below; it is a *port of styling*, not a fresh design.

### 3.1 Fields, order, labels (from `components/auth/accept-form.tsx`, the live set-password screen)
For a **change** (vs first-set), add a current-password field on top:
1. **Current password** — `type="password"`. *(New: accept-form has none because it sets from an invite token. A signed-in change should verify the old one.)*
2. **New password** — `type="password"`. Accept-form label is **"Set a password"**; for change use **"New password"**.
3. **Confirm password** — `type="password"`. Label **"Confirm password"** (verbatim from accept-form).
- Submit-on-Enter (`onKeyDown … Enter`) like accept-form.

### 3.2 Validation copy (single-sourced via `passwordProblem` — do NOT re-hardcode)
`change-password-form.tsx` validates `newPassword` through **`passwordProblem` (`lib/password.ts`, PR #244)** — the same helper accept-form / set-new-password use. The rule is **min 8 + at least one letter + at least one number (max 128)**; the messages, in check order, are:
- **`"Password must be at least 8 characters"`** (< 8)
- **`"Password must include at least one letter"`** (no letter)
- **`"Password must include at least one number"`** (no digit)
- **`"Password must be at most 128 characters"`** (> 128)
- then `newPassword !== confirm` → **`"Passwords don't match."`**
- **Render:** the live inline hint (`text-[12px] text-terra`) shows the current failing rule `.`-suffixed (`{pwProblem}.`) plus the mismatch line; the submit-time error (`text-sm text-terra`) shows the raw `passwordProblem` message. No per-field red outline (design has none).
- `current` empty / wrong → server-side; surface as the same `text-terra` line (e.g. *"Current password is incorrect."* — new string, honest and minimal).

### 3.3 What NOT to add
- **No strength meter.** The archive surface has a strength meter (for its **12-char** archive key) — **do not copy it here**; the account pattern is meterless. The account rule is the shared `passwordSchema` — **min-8 + at least one letter + at least one number (max-128)** (`lib/password.ts`, PR #244), validated through `passwordProblem` — not just min-8, and not re-hardcoded per form. Adding a meter would drift from the live screens. (Flagged in §8.)
- Min-length is **8** for the account, **not** 12 (that's archive-only).

### 3.4 Field styling & container (reuse `security-form.tsx` + `accept-form.tsx`)
Put the three inputs in a card matching the surrounding SecurityForm blocks:
| Element | Class / token |
|---|---|
| Card | `rounded-xl border border-border bg-surface p-6` (same as the 2FA / session cards) |
| Label | `mb-1.5 block text-xs font-semibold text-navy-2` (accept-form `labelClass` == security-form label) |
| Input | `w-full rounded-md border border-border-2 bg-bg px-3.5 py-2.5 text-sm text-navy outline-none transition-colors focus:border-gold focus:bg-surface` (`fieldClass`, shared by both files) |
| Save button | `rounded-md bg-navy px-5 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-50` (security-form Save) |
| Save label | **"Change password"** / busy **"Saving…"**; success `text-green` **"Saved."**, error `text-terra` (mirror security-form's `msg` render) |
| Disabled-until | `disabled={busy || !dirty}` idiom from security-form (dirty = all three fields non-empty) |

### 3.5 Login-card first-login hint (INCR-AUTH-OTP / PR #243) — always shown, NOT flag-gated

Distinct surface, captured here per the sync brief: the **`/login` card** (`components/auth/login-form.tsx`, mapped in `l3-forgot-password-surface-map.md` §1) now renders a **static first-login hint on the Password tab** — always present, never varying with whether the number exists / is confirmed (enumeration-safe; **not** gated by `AUTH_OTP_LIVE`, unlike the onboarding OTP-finish step in `l1-signup-surface-map.md` §3.3). A brand-new account must verify by OTP once (which confirms the phone) before password sign-in works.
- Copy (verbatim): **"First time signing in? Verify your number on the Phone OTP tab first — your password works after that."**
- Container: `rounded-md bg-bg px-3 py-2 text-[12px] leading-relaxed text-navy-3`; the phrases **"First time signing in?"** and **"Phone OTP"** are `<b className="text-navy-2">`.
- Placement: top of the Password-tab branch, above the phone / password inputs.

---

## 4. Tokens / type (solid tokens only — no-alpha discipline)

Standard Omnischools palette (`styles/tokens.css`; use Tailwind classes, never raw `var()` in JSX):
`bg-navy #1A2B47` (buttons, primary text), `bg-navy-deep #13203A` (button hover), `text-navy-2 #2D3F5C` (labels), `text-navy-3 #5C6675` (meta/muted, `—`), `text-gold / bg-gold #C8975B` (accent, active, positive-confirm), `bg-gold-bg #F5EBDC` (role pills, filled-input tint), `bg-bg #FAF7F2` (input bg, table head), `bg-surface #FFFFFF` (cards), `text-green / bg-green-bg #2F6B47 / #E5EFE8` (Active, "Ready", success), `text-warn / bg-warn-bg #C58A2E / #F5E9D0` (Invited/Pending, warn), `text-terra / bg-terra-bg #B84A39 / #F5E1DC` (Blocked, destructive), `border-border #E5DFD3`, `border-border-2 #D4CCBA`. Type: **Fraunces** display (headings, italic-gold `<em>`), **Manrope** body/labels, **JetBrains Mono** phone/codes only (passwords are **not** mono).

---

## 5. Status vocabulary (visual states for a user)

**No formal pill set is authored.** The only user-status language in any surface is settings.html's health copy: **"8 active users"** / **"1 inactive user"** (warn), and the 2FA card's **"2 of 3 admins enrolled — Joyce pending"**. So the vocabulary below is **prescribed**, mapped to solid tokens and the existing role-pill shape (`rounded-pill … py-0.5 px-2.5 text-xs font-medium`, from `role-editor.tsx`).

| Status | When | Pill tokens (solid) | Copy |
|---|---|---|---|
| **Active** | account usable at this school | `bg-green-bg text-green` | `Active` |
| **Invited** | invite/set-password link issued, not yet accepted | `bg-warn-bg text-warn` | `Invited` |
| **Blocked** | admin has suspended the account (school-scoped) | `bg-terra-bg text-terra` | `Blocked` |
| *(optional)* **Inactive** | roles ended / left the school (settings.html "1 inactive user", e.g. Mr. Yeboah left in May) | `bg-bg text-navy-3` | `Inactive` |

- Use **`-bg` tint + matching solid text**, never slash-opacity on the hex (memory *no-alpha-token-opacity*). This is the same green/warn/terra tri-state the codebase uses for invoice/admission/attendance status and for the settings health strip (`bg-green text-surface` ✓ / `bg-warn text-surface` !).
- Keep it to **3 (+1)** states — do not invent "Suspended vs Locked vs Disabled" nuance nobody authored.

---

## 6. Confirm-dialog / destructive-action pattern

**Reuse the shared primitive — do not build a new modal.** `components/ui/confirm-dialog.tsx` (`ConfirmDialog`, built on `components/ui/modal.tsx`) is exactly this pattern and is **already wired into `staff-table.tsx`** for single + bulk delete:
- Props: `open, title, message (ReactNode — spells out consequences), confirmLabel, busyLabel, busy, error, tone, onConfirm, onClose`.
- **`tone="danger"`** → terra confirm button (`bg-terra text-bg`) for **Block** and **Delete**; **`tone="gold"`** → `bg-gold text-navy` for positive actions (use for **Activate** if you gate it behind a confirm).
- While `busy` the dialog **cannot be dismissed** (no double-fire); Cancel is `text-navy-2`; error renders `rounded-md bg-terra-bg px-3 py-2 text-sm text-terra`.

**Prescribed dialogs for INCR-34:**
- **Block** — `title="Block this account?"`, `tone="danger"`, `confirmLabel="Block"`, `busyLabel="Blocking…"`, message names the person + consequence, echoing the live delete copy's tenant-scope honesty: *"Block **{name}**? They lose access to {school} until you activate them again. Their login isn't deleted and any other schools they belong to are unaffected."*
- **Reset password** — a confirm is optional (it only issues a fresh link, non-destructive). If used: `tone="gold"`, `confirmLabel="Send reset link"`, message *"Generate a fresh set-password link for **{name}**? Their current password stops working once they set a new one."* Otherwise reuse the row's existing **"Copy invite link" → "Link copied ✓"** inline affordance (lower friction, matches today's Invite).
- **Activate** — non-destructive; either no dialog or a light `tone="gold"` confirm.

**Authored precedents for the copy *tone*** (reference, not components):
- **archive-password-recovery §3 Step 2** — the canonical *acknowledgement* pattern: a **checkbox + honest, non-alarmist copy** (no scary red) + gold CTA before a consequential/irreversible action. Mirror its calm register for Block copy (name the consequence plainly; no dark-pattern red).
- **activation-segregation** — the heavier **dual-control / co-sign** pattern (initiator + co-signer, Approvals inbox). **Overkill for block/reset** — do not adopt; it's for books activation. Noted only so it isn't mistaken for the destructive pattern.

---

## 7. Data-model flags (out of my scope — for Kofi / Claude Code)

Design mapping only; the schema calls below are the implementer's, but the surfaces constrain them:
1. **`ref_user` has no `passwordHash` and no `status`/`disabled`/`blocked`/`lastLogin` column** (`db/schema/identity.ts`: `id, phone (unique), email, fullName, createdAt`; comment: "A person who can authenticate (phone-OTP)"). So **Block/Activate needs a new state**, and change-password needs a credential store.
2. **`ref_user` is a GLOBAL, multi-school table** (one login can belong to several schools; the live delete copy says so: *"Their login isn't deleted (they may belong to other schools)"*). Therefore **Block must be school-scoped, not a global user-disable** — otherwise blocking a teacher at School A locks them out of School B (cross-tenant harm; cf. memory *global-tables-rls-no-force* / *composite-tenant-fks*). The natural school-scoped primitive already exists: **`role_assignment.endDate` (null = active)** — ending/suspending this school's assignments = the "1 inactive user" state settings.html already shows. Recommend Block = school-scoped suspension (end assignments or add a school-scoped `suspendedAt`), **not** a column on `ref_user`.
3. **"Reset password" already has a mechanism** — `createInvite` (`lib/actions/invites.ts`) issues a tokened `/accept/{token}` link that runs `accept-form.tsx` (set password, min-8). Reuse it; no new "admin sets user's password directly" path needs designing (and direct-set is worse for security anyway).
4. Whether **phone-OTP** remains a parallel login path alongside a password affects the change-password lede (accept-form footnote: *"You can also sign in with your phone via OTP"* implies coexistence). Confirm with product.

---

## 8. Drift / notes log

1. **Zero authored surfaces** for either the change-password form or the user table — both are net-new UI, but fully constrained by `accept-form.tsx` (password fields + the shared `passwordProblem` validation), `security-form.tsx` (card/field/button styling), `staff-table.tsx`/`staff-row.tsx`/`role-editor.tsx` (the list + roles + per-row actions), and `confirm-dialog.tsx` (destructive pattern). Assemble; do not invent.
2. **Both homes already exist and are named** in `lib/settings-nav.ts`: `Login & password → /settings/security` (self) and `Roles & access → /staff` (admin). Don't create new routes.
3. **Reset password = re-issue invite link.** The row's existing Invite/"Copy invite link" is the reset mechanism; relabel for active users. No separate reset flow.
4. **Block is school-scoped**, not a global `ref_user` disable — multi-school login integrity (§7.2). Strong recommendation, but the column/mechanism is the data owner's call.
5. **Status pills are prescribed, not authored** — 3 (+1) states on the green/warn/terra/(neutral) tri-state the codebase already uses; solid `-bg` tints only, no slash-opacity. Verify contrast in the live preview.
6. **No strength meter; the account rule is min-8 + a letter + a number, not min-12.** The archive surface's meter + 12-char rule are for the data-export ZIP key, a different concern; the account pattern is meterless and single-sourced in `lib/password.ts` (`passwordSchema`/`passwordProblem`, PR #244). Keep it that way.
7. **`last-active` column skipped** — no `lastLogin` field, no surface authors it. The "login activity log" is the separate `/settings/audit` (`schoolup-audit-log-viewer.html`), adjacent to but out of L2 scope.
8. **2FA stays where it is.** The existing `require2fa` toggle in `security-form.tsx` is the "2FA for admins" of the Login & password card; the change-password card sits above it on the same page. `schoolup-2fa-enrolment.html` is the (Tier-4) enrolment walkthrough, a future addition, not part of INCR-34.
9. **Login-card first-login hint (INCR-AUTH-OTP / PR #243).** The `/login` Password tab now always shows a static, enumeration-safe first-login-OTP hint (§3.5) — **not** gated by `AUTH_OTP_LIVE`. It lives on `login-form.tsx` (mapped in the L3 map §1), a different surface from L2's change-password / user-management; captured here per the sync brief. Password validation across all these forms is single-sourced in `lib/password.ts` (PR #244).

---

*Map produced against: `Surfaces/schoolup-settings.html` (the Access & security wayfinder — the only surface naming both parts), `schoolup-2fa-enrolment.html`, `schoolup-activation-segregation.html`, `schoolup-archive-password-recovery.html`, `schoolup-accountant-role.html` (re-confirmed, none author the form/table); live `app/(app)/settings/security/page.tsx`, `components/settings/security-form.tsx`, `components/auth/accept-form.tsx`, `app/(app)/staff/page.tsx`, `components/staff/{staff-browser,staff-table,staff-row,role-editor}.tsx`, `components/ui/{confirm-dialog,modal,empty-state,selection}.tsx`, `lib/{settings-nav,staff-roles}.ts`, `lib/actions/{staff,invites}.ts`, `db/schema/identity.ts`. Pairs with `docs/senior/l1-signup-surface-map.md`.*
