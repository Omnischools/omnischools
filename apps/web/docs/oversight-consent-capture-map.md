# Oversight staff-consent capture (Settings) — Surface Map

**Author:** Lucy (design cartographer) · **Status:** design spec, ready for the implementation engineer (Claude Code).
**Scope:** the CAPTURE surface for GES individual-staff-drilldown consent — a new Settings sub-page. Basic + Senior tiers, identical.
**No dedicated Surface mock exists.** The visual source of truth is the existing `settings/retention` pattern; this map ports that chrome and adds the consent-specific sections from Kofi's ACs D1–D9 and the fixed consent copy.

> **Boundary:** this task is the CAPTURE surface + (Wells) the consent table. Do **not** build any Oversight-side read/enforcement here — that lives on branch `claude/oversight-individual-drilldown` and reads this table. This page never reads Oversight; it only writes consent state + appends the event log.

---

## 0. Route + files

| File | Kind | Purpose |
|---|---|---|
| `app/(app)/settings/oversight-consent/page.tsx` | server component | The page. Role-gate, read state, render chrome, pass props to the client panel. |
| `components/settings/oversight-consent-panel.tsx` | client component | The three-state render + grant/withdraw/re-grant interaction (mirrors `retention-form.tsx`). |
| `lib/actions/oversight-consent.ts` | `"use server"` | `grantOversightConsent()` + `withdrawOversightConsent()`. New file (distinct domain; keeps the already-large `lib/actions/settings.ts` untouched). |
| `lib/oversight-consent.ts` | pure, client/server-safe | Single-sources the canonical `CONSENT_STATEMENT_VERSION` + the statement copy blocks so page, panel, and action all agree. This is the DPA Act 843 defence — one source, no drift. |
| `lib/settings-nav.ts` | edit | Add the hub card (see §7). |

Page boilerplate (copy the retention/security page exactly):
```tsx
export const dynamic = "force-dynamic";
export const metadata = { title: "GES staff-record consent" };
```

**Do NOT add a tier gate.** No `school.schoolType` check anywhere — the page and card are identical on BASIC and SENIOR. (Contrast the `basicOnly` filter used by Sports houses in `settings/page.tsx`; do not use it here.)

---

## 1. Role gate — placement (D1)

**Page fence (presentation is downstream of it):**
```tsx
const { user, school } = await requireSchoolRole(["ADMIN", "HEADMASTER"]);
```
`requireSchoolRole` (from `@/lib/auth/server`) extends `requireSchool` (auth + school-resolve + staff gate + finance/board confinement + session-age/2FA) and redirects a non-ADMIN/HEADMASTER to `/dashboard`. This is the server-side fence — the page body is pure presentation.

**Action fence (independent, mandatory):** every server action calls `assertAnyRole(["ADMIN", "HEADMASTER"])` at the top. The page redirect does not protect the POST; a hand-crafted request must still be refused. Do not rely on the page gate alone.

Role list is tier-independent and lives in both call sites literally as `["ADMIN", "HEADMASTER"]` (both are in `KNOWN_APP_ROLES`). PROPRIETOR is **not** included — Kofi's contract names ADMIN/HEADMASTER only.

---

## 2. Data read (server component)

`ActiveSchool` from `requireSchool` does **not** carry `ownership`, so read it here alongside the consent row. All reads under `withSchool(school.id, tx => …)` (tenant-scoped RLS), exactly like `retention/page.tsx`.

```tsx
const data = await withSchool(school.id, async (tx) => {
  const [s] = await tx
    .select({ ownership: schools.ownership })   // schools.ownership = ownershipEnum, default PRIVATE
    .from(schools)
    .where(eq(schools.id, school.id));
  const [c] = await tx
    .select({
      state: oversightConsent.state,            // "GRANTED" | "REVOKED"
      grantedByName: users.fullName,
      grantedByRole: oversightConsent.grantedByRole,
      grantedAt: oversightConsent.grantedAt,
      revokedAt: oversightConsent.revokedAt,
      version: oversightConsent.consentStatementVersion,
    })
    .from(oversightConsent)
    .leftJoin(users, eq(oversightConsent.grantedByUserId, users.id))
    .where(and(
      eq(oversightConsent.schoolId, school.id),
      eq(oversightConsent.scope, "NON_GES_STAFF"),
    ));
  return { ownership: s?.ownership ?? "PRIVATE", consent: c ?? null };
});
```

- `oversightConsent` = Wells' `school_staff_oversight_consent` (table drizzle export name TBD by Wells; the surface only needs the columns in the Todo contract: `state`, `granted_by_user_id`, `granted_by_role`, `granted_at`, `revoked_at`, `consent_statement_version`, `scope`).
- **Preformat dates server-side** into strings before passing to the client (avoid TZ drift). Reuse the `when()` formatter from `settings/audit/page.tsx` (`YYYY-MM-DD HH:mm`) or a shared date util.

### State derivation (the panel receives this, not raw rows)
| Condition | `state` prop |
|---|---|
| no consent row | `"NONE"` |
| row `state === "GRANTED"` && `revokedAt == null` | `"GRANTED"` |
| row `state === "REVOKED"` (or `revokedAt != null`) | `"REVOKED"` |

Props into `<OversightConsentPanel>`:
```ts
initial: {
  schoolName: string;                 // school.name — injected into the statement's [School name] tokens
  ownership: "PUBLIC" | "PRIVATE" | "MISSION" | "INTERNATIONAL";
  state: "NONE" | "GRANTED" | "REVOKED";
  grantedByName: string | null;       // users.fullName via join (owner/actor)
  grantedByRole: string | null;       // stored granted_by_role (title-cased for display)
  grantedAt: string | null;           // preformatted
  revokedAt: string | null;           // preformatted
}
```
The current version to grant under is **not** a prop — the panel imports `CONSENT_STATEMENT_VERSION` from `lib/oversight-consent.ts` (always the canonical current version; the stored version on an old row is display-only, shown in the GRANTED state).

---

## 3. Token & type reference (reuse the Settings chrome verbatim)

Every class below already appears in `retention/page.tsx`, `security/page.tsx`, `retention-form.tsx`, or `settings/page.tsx`. Use the Tailwind token class, never inline hex.

| Element | Classes |
|---|---|
| Page wrapper | `mx-auto max-w-page` |
| Back link | `<BackLink href="/settings" label="Settings" />` |
| Hero H1 | `font-display text-3xl font-semibold text-navy` + accent `<em className="not-italic text-gold [font-style:italic]">` |
| Hero subtitle | `text-sm text-navy-3` |
| Panel / card | `rounded-xl border border-border bg-surface p-6` |
| Section eyebrow number | `font-display text-xl font-semibold italic text-gold` (as in `audit/page.tsx` §01/§02) |
| Section H2 | `font-display text-lg font-semibold text-navy` + gold `<em>` accent |
| Field label | `mb-1.5 block text-xs font-semibold text-navy-2` |
| Body copy (statement, scope) | `text-sm leading-relaxed text-navy-2` |
| Bold emphasis inside copy | `<strong className="font-semibold text-navy">` |
| Version stamp (data) | `font-mono text-[11px] text-navy-3` |
| Primary/affirmative button (Grant) | `rounded-md bg-navy px-5 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-50` |
| Destructive button (Withdraw) | `rounded-md bg-terra px-4 py-2 text-sm font-semibold text-bg transition-colors hover:opacity-90 disabled:opacity-60` |
| Inline "Cancel" text button | `text-sm font-semibold text-navy-2 hover:text-navy` |
| Success message | `text-sm text-green` · Error message | `text-sm text-terra` |
| GRANTED status card | `rounded-xl border border-green/30 bg-green-bg p-...` — **see token-opacity note below** |

**Type families:** body/labels = Manrope (default / `font-body`); the version string and the granted/withdrawn timestamps = JetBrains Mono (`font-mono`, data); headings = Fraunces (`font-display`) with the italic-gold `<em>` accent. No emoji, no icon substitutions — the check/status glyphs in the app use text (`✓` / `!` as in `settings/page.tsx`); reuse those if a status glyph is wanted, otherwise plain type.

> **Token-opacity trap (hard rule — flag in the build).** Tailwind slash-opacity on raw-hex tokens can silently no-op. `settings/page.tsx` uses `border-warn/30 bg-warn-bg/40` / `border-green/30` — those exist in the tree but are exactly the pattern that can break. For the **non-public notice (§6)** — which must be *unmissable* — use **solid** tokens (`bg-warn-bg`, `border border-warn`, heading `text-warn`, body `text-navy-2`), never `bg-warn/10`. For the GRANTED status tint, prefer solid `bg-green-bg` + `border-green` (solid) over `/30` if you want to be safe; if you keep the `/30` to match `settings/page.tsx`, **verify it in the live preview, not the build.**

---

## 4. Section-by-section layout (order, top to bottom)

```
mx-auto max-w-page
├─ <BackLink href="/settings" label="Settings" />
├─ HERO
│    H1:  GES staff-record <em>consent.</em>
│    P:   subtitle (see copy §5)
├─ <OversightConsentPanel initial={…} />   ← client; renders §4.1–§4.4 by state
│    ├─ §4.1  NON-PUBLIC NOTICE        (warn banner; only when ownership ≠ PUBLIC; shown in ALL states)
│    ├─ §4.2  STATE BLOCK              (NONE → grant / GRANTED → status + withdraw / REVOKED → withdrawn + re-grant)
│    │         includes the consent-statement panel (§5) where a grant is offered/recorded
│    └─ §4.3  HONEST SCOPE PANEL       (D7 "what this does / does not cover"; ALWAYS visible, all states)
```

The panel is one client component so grant/withdraw can flip the render without a full navigation (then `router.refresh()` re-reads server state, like `RetentionForm`). The scope panel (§4.3) and the non-public notice (§4.1) are state-independent and render around the state block.

---

## 5. Exact copy blocks

`[School name]` = `initial.schoolName`, rendered `<strong className="font-semibold text-navy">`. Preserve every bold span from the source. Do not simplify.

### 5.0 Hero
- **H1:** `GES staff-record` + `<em className="not-italic text-gold [font-style:italic]">consent.</em>`
- **Subtitle (`text-sm text-navy-3`):**
  > Authorise — or withdraw — GES and the Ministry of Education to view the individual record of a named non-teaching or non-register staff member through Omnischools Oversight's gated, audit-logged path. Aggregate reporting and student records are never affected.

### 5.1 The consent statement (canonical — version `v1-2026-09`)
Rendered inside a `rounded-xl border border-border bg-surface p-6` panel, body `text-sm leading-relaxed text-navy-2`, three paragraphs. **This is the DPA Act 843 defence and is stored verbatim-by-version when granted — reproduce character-for-character.**

> On behalf of **[School name]**, I authorise the Ghana Education Service (GES) and the Ministry of Education (MoE), as statutory education regulators, to view — through Omnischools Oversight's gated, audit-logged access path — the individual staff record of a named member of this school's **non-teaching staff, and of any staff member who is not on the GES establishment register**. Every such access is logged with the accessing officer, the stated reason, and the exact fields released.
>
> **This consent does NOT cover, and nothing here changes:** aggregate/statistical reporting (statutory, always in effect); any student record (students are never individually visible to GES); GES-licensed teachers on the establishment register (statutory oversight, independent of this consent).
>
> I confirm I am authorised to grant this for **[School name]**. It can be **withdrawn at any time with immediate effect** from this page.

Bold spans to preserve: `[School name]` (×2), `non-teaching staff, and of any staff member who is not on the GES establishment register`, `This consent does NOT cover, and nothing here changes:`, `withdrawn at any time with immediate effect`.

Below the statement, a version stamp (`font-mono text-[11px] text-navy-3`):
> Statement version v1-2026-09

### 5.2 Honest scope panel (D7) — always visible
A `rounded-xl border border-border bg-surface p-6` panel titled **"What this consent does — and does not — cover."** (H2, gold `<em>` on "does not"). Two labelled lists:

**This consent covers:**
- The individual record of a **named** non-teaching staff member, or any staff member **not on the GES establishment register** (e.g. many private/mission-school staff).
- Access only through Oversight's **gated, audit-logged** path — every view records the accessing officer, the stated reason, and the exact fields released.

**This consent does NOT cover — and nothing here changes:**
- **Aggregate / statistical reporting** — statutory, always in effect, with or without this consent.
- **Any student record** — students are never individually visible to GES.
- **GES-licensed teachers on the establishment register** — statutory oversight, independent of this consent.

(This restates the statement's second paragraph as its own scannable block per D7 — keep both.)

---

## 6. Non-public notice (D8) — logic

**Condition:** `initial.ownership !== "PUBLIC"` (i.e. PRIVATE / MISSION / INTERNATIONAL). PUBLIC schools: render nothing here.

**Placement:** top of the panel, above the state block, in **all three states** (the grant is *recorded* but not *in effect* for non-public schools, so the caveat applies whether the state is NONE, GRANTED, or REVOKED).

**Style (solid tokens — unmissable):** `rounded-xl border border-warn bg-warn-bg p-4`; a bold `text-warn` lead + body `text-sm leading-relaxed text-navy-2`.

**Exact copy:**
> This consent is recorded but will not take effect until Omnischools' Data Protection Officer confirms the lawful basis for staff of non-public schools under the Data Protection Act, 2012 (Act 843). Until then GES sees aggregates only.

**Critical behaviour:** the notice does **not** disable the Grant button. The grant is still recorded (the table captures it regardless of ownership); enforcement stays flag-off on the Oversight read side until the DPO position exists. Do not gate the write on ownership anywhere.

---

## 7. The three state renders (§4.2 detail)

### State 1 — NONE (no consent recorded)
- **Heading (H2):** `Consent not granted` (gold `<em>` on "not granted" optional).
- Render the **consent statement panel** (§5.1) in full.
- A confirm checkbox gating the button (defensive — this is a legal act, not a settings toggle):
  - Label: `I confirm I am authorised to grant this for [School name].`
  - Unchecked → Grant button `disabled` (`disabled:opacity-50`).
- **Grant button** (navy primary): `Grant consent`. On click → `grantOversightConsent()`.
- Below: success/error message slot (`text-green` / `text-terra`).

### State 2 — GRANTED
- **Status card** (`bg-green-bg` + solid `border-green`, or match `settings/page.tsx` tints — verify per §3 note): a `✓` glyph + **`Consent granted`** (`font-display font-semibold text-navy`).
- **Attribution line** (`text-sm text-navy-2`, timestamp `font-mono`):
  > Granted by **{grantedByName}** ({grantedByRole, title-cased}) on `{grantedAt}`.
  - If `grantedByName` is null (SET NULL on a deleted user), fall back to the stored role: `Granted by {grantedByRole} on {grantedAt}.`
- Version stamp: `Statement version v1-2026-09` (`font-mono text-[11px] text-navy-3`) — show the **stored** version from the row, not necessarily the current const (an old grant may be an older version; here they match, but display the stored one).
- Keep the statement (§5.1) visible below the status (collapsed-optional; default show it — porting should not hide the wording the grantor agreed to).
- **Withdraw control** (D5 — one click, immediate; a *light* inline "are you sure", not a modal):
  - Default: `Withdraw consent` button (terra).
  - On click → swap in-place to an inline row: prompt `Withdraw now? GES individual access stops immediately.` + `Withdraw now` (terra) + `Cancel` (text button). No second page/modal. `Withdraw now` → `withdrawOversightConsent()`.
  - (An inline confirm is preferred over `ConfirmDialog` here — Kofi: "no second confirmation needed to take effect… a light 'are you sure' inline is fine." If you reuse `ConfirmDialog`, tone `danger`, that is acceptable but heavier than the spec asks.)
- Non-public notice (§6) still shows above, if applicable.

### State 3 — REVOKED
- **Status card** (neutral — `bg-bg` / `border-border`, navy text, no green): **`Consent withdrawn`**.
- **Withdrawal line** (`text-sm text-navy-2`, timestamp `font-mono`):
  > Withdrawn on `{revokedAt}`. GES sees aggregates only.
- Render the statement panel (§5.1) again beneath.
- **Grant-again control:** identical to State 1 (confirm checkbox + button), button label **`Grant consent again`** → `grantOversightConsent()` (same action; it re-sets state to GRANTED, clears `revoked_at`, stamps a fresh grantor/time/version, appends a re-grant event).

All three states sit below the (conditional) non-public notice and above the honest scope panel.

---

## 8. Interaction states (client panel behaviour)

Mirror `retention-form.tsx`: `useRouter()`, `useState` for `busy` + `msg` + local UI (checkbox, inline-confirm-open). After a successful action call `router.refresh()` so the server re-reads and the state block re-derives.

| Trigger | Action call | On success | On error |
|---|---|---|---|
| Grant (State 1) | `grantOversightConsent()` | `msg = {ok:true, "Consent granted."}`; `router.refresh()` → re-renders as GRANTED | `msg = {ok:false, res.error}` |
| Withdraw now (State 2 inline confirm) | `withdrawOversightConsent()` | `msg = {ok:true, "Consent withdrawn."}`; `router.refresh()` → REVOKED | `msg = {ok:false, res.error}` |
| Grant again (State 3) | `grantOversightConsent()` | as Grant | as Grant |

- **Loading:** button shows `busy` label (`Granting…` / `Withdrawing…`) and is `disabled` while `busy` (prevents double-fire; the `retention-form` `disabled={busy}` idiom).
- **Empty/first-visit** = State 1 (NONE) — there is no separate empty state.
- **Error** = the returned `{ ok:false, error }` rendered in the message slot (`text-terra`), same as every settings form. Actions never throw to the client for the happy/expected paths; they return `{ ok, error }` (the role-assert throw is a 500 only for a forged non-admin request, which the page gate already precludes).

---

## 9. Server action contract (`lib/actions/oversight-consent.ts`)

Both actions follow the `updateRetentionPolicy` shape (`"use server"`, `requireSchool`/assert, `resolveActor`, `withSchool` upsert + `recordAudit`, `safeRevalidate`, `{ ok, error }` return). **Additionally** each appends to the immutable event log (Wells' `school_staff_oversight_consent_event`), inside the same `withSchool` tx.

```ts
const SCOPE = "NON_GES_STAFF" as const;

export async function grantOversightConsent(): Promise<{ ok: boolean; error?: string }> {
  const { school } = await requireSchool();
  await assertAnyRole(["ADMIN", "HEADMASTER"]);      // independent action fence
  const actor = await resolveActor(school.id);        // { id, role }
  try {
    await withSchool(school.id, async (tx) => {
      await tx.insert(oversightConsent).values({
        schoolId: school.id, scope: SCOPE, state: "GRANTED",
        grantedByUserId: actor.id ?? null, grantedByRole: actor.role,
        grantedAt: new Date(), revokedAt: null,
        consentStatementVersion: CONSENT_STATEMENT_VERSION,   // "v1-2026-09"
      }).onConflictDoUpdate({
        target: [oversightConsent.schoolId, oversightConsent.scope],  // UNIQUE(school_id, scope)
        set: {
          state: "GRANTED", grantedByUserId: actor.id ?? null, grantedByRole: actor.role,
          grantedAt: new Date(), revokedAt: null,
          consentStatementVersion: CONSENT_STATEMENT_VERSION,
        },
      });
      await tx.insert(oversightConsentEvent).values({          // append-only history
        schoolId: school.id, scope: SCOPE, action: "GRANTED",
        actorUserId: actor.id ?? null, actorRole: actor.role,
        consentStatementVersion: CONSENT_STATEMENT_VERSION, occurredAt: new Date(),
      });
      await recordAudit(tx, {
        schoolId: school.id, actorUserId: actor.id ?? undefined, actorRole: actor.role,
        actionType: "created", entityType: "oversight_consent", entityId: school.id,
        after: { scope: SCOPE, state: "GRANTED", version: CONSENT_STATEMENT_VERSION },
        reason: "GES individual staff-record consent granted",
      });
    });
    safeRevalidate("/settings/oversight-consent");
    safeRevalidate("/settings");
    return { ok: true };
  } catch { return { ok: false, error: "Could not record consent. Please try again." }; }
}
```

`withdrawOversightConsent()` — same shape, but:
- `set: { state: "REVOKED", revokedAt: new Date() }` — **keep** `granted_by_*` / `granted_at` (the record of who granted); only stamp `revoked_at` and flip `state`.
- No `onConflictDoInsert` needed for a fresh row (you can only withdraw an existing GRANTED row) — but be defensive: an `update … where (schoolId, scope)` is enough; if no row, return `{ ok:true }` (idempotent — nothing to withdraw).
- Event: `action: "REVOKED"`.
- Audit: `actionType: "updated"`, `reason: "GES individual staff-record consent withdrawn"`.

**Notes for the implementer:**
- Exact drizzle export names for `oversightConsent` / `oversightConsentEvent` and their columns come from Wells' `db/schema/oversight-consent.ts` — align to whatever he names them; the columns above match the Todo contract.
- The action does **not** branch on ownership. Non-public schools record consent identically; the flag-off lives on the Oversight read side.
- `entityType: "oversight_consent"` is a **new audit entity type** — check `lib/audit/redaction.ts` / any audit-classification guard (the GOV-10 build hit a guard that requires every new `entityType` to be classified). If such a guard exists, classify `oversight_consent` (it is not PII-bearing; the reason string carries no staff name — safe to leave un-redacted). Flag this to verify at build.

---

## 10. `lib/oversight-consent.ts` (single source)

```ts
// The DPA Act 843 defence — one version string, one copy source. Bump the version when the wording changes.
export const CONSENT_STATEMENT_VERSION = "v1-2026-09";
export const CONSENT_STATEMENT_PARAGRAPHS = [ /* the 3 paragraphs from §5.1, [School name] as a token */ ] as const;
```
The action imports `CONSENT_STATEMENT_VERSION`; the client panel imports both. Keeps the stored-version and the displayed-copy from ever drifting — a grant recorded under `v1-2026-09` always maps back to this exact text.

---

## 11. Settings hub card (`lib/settings-nav.ts`)

Add to group **`05` "Data & compliance"** (`num: "05"`), after the `retention` card — this is a records/compliance control:

```ts
{
  key: "oversight-consent",
  name: "GES staff",
  em: "consent",
  icon: "GC",                 // text initials — no emoji, no icon component (house style, see other cards)
  tone: "navy",
  desc: "Authorise — or withdraw — GES individual drill-down of your non-teaching and non-register staff. Gated and audit-logged; aggregate reporting and student records are never affected.",
  href: "/settings/oversight-consent",
},
```
- No `basicOnly` (both tiers). No `soon`, no `external` — it is a live `/settings` sub-page → renders the green "Ready" / "Configure →" footer automatically.
- **Card visibility:** `settings-nav.ts` has no per-role field, and the settings landing (`settings/page.tsx`) already lists role-gated pages (retention, security, users) to all staff — the page fence is authoritative. A non-admin who clicks lands on `/dashboard` via `requireSchoolRole`. Consistent with the existing pattern; per-card role-hiding is out of scope (note as an optional follow-up if the mild dead-click matters).

---

## 12. Responsive / PWA

No bespoke breakpoints — the Settings pages are single-column `mx-auto max-w-page` and reflow naturally. The scope panel's two lists stack on mobile (`grid-cols-1 sm:grid-cols-2` if you want them side-by-side on desktop; single column is fine). Buttons are full-width-friendly at the panel edge; no PWA-specific variant (Settings is not in the offline PWA scope). Print: the `BackLink` is `print:hidden` already.

---

## 13. Cross-module hooks (design commitments — preserve)

- **capture → Oversight §6 drill-down** (branch `claude/oversight-individual-drilldown`): the enforcement reads this table inside its own read-back tx, `state = 'GRANTED' AND revoked_at IS NULL` for `(school_id, 'NON_GES_STAFF')`, **no cache**, before selecting any staff column. This page is the *only* writer. Do not add a read of Oversight here.
- **consent event log ↔ audit immutability:** `school_staff_oversight_consent_event` mirrors `audit_access_log`'s posture (Postgres trigger rejecting UPDATE/DELETE — Wells owns it). Append on every grant/withdraw/re-grant. "Consent that can be silently rewritten is not consent."
- **grant/withdraw → Settings → Audit log** (`/settings/audit`): each action's `recordAudit` surfaces in the immutable audit feed as an `oversight_consent` entity event (see §9 classification note).
- **ownership (D8) → Oversight flag-off:** the non-public branch stays flag-off on the Oversight read side until the DPO lawful-basis position exists; this surface records intent regardless and says so plainly (§6).

---

## 14. Open questions / drift log

1. **Drizzle export + column names** for the consent table/event come from Wells (`db/schema/oversight-consent.ts`, concurrent on this branch). The map uses the Todo-contract column names; align at build.
2. **New audit `entityType` "oversight_consent"** may need classifying in the audit-redaction/classification guard (GOV-10 precedent). Verify `next build` / the guard passes. It is not PII-bearing → leave un-redacted.
3. **GRANTED status tint** (`border-green/30 bg-green-bg/40` vs solid): matches `settings/page.tsx` if you use the slash form, but that is the token-opacity trap — verify in the live preview or use solid `bg-green-bg`/`border-green`. The **non-public notice must be solid** (§3/§6).
4. **Confirm checkbox on grant** is a Lucy addition (defensive, not in the ACs) — the statement itself already reads "I confirm I am authorised." If Kofi prefers the click alone as the confirmation, drop the checkbox; the button then acts on the statement directly. Low-risk either way; kept because a legal grant should not be a single stray click.
5. **Withdraw confirm** is spec'd as an inline in-place confirm (lighter than `ConfirmDialog`), per Kofi's "light 'are you sure' inline is fine." `ConfirmDialog` (tone danger) is an acceptable substitute.
