# Sickbay — Notifications & Comms · Surface Map (INCR-26 · Module 4.4)

**Author:** Lucy (design cartographer) · **Status:** build-ready design spec for the implementation engineer (Claude Code).
**Increment:** INCR-26 — *the three-tier parent-notification chain + the comms thread · **console-only SMS** (D7) · **no parent portal** (D8) · `private_note` never parent-facing (F4)* · **migration NONE** (the table `sickbay_notification` was authored in the referral migration — the INCR-16→18 / authored-then-built precedent) · **lane B, close of Module 4.4 lane B** (branches off the INCR-22 trunk alongside 25; touches no chronic table).
**Source sections (three, mapped 1:1):**
- `Surfaces/schoolup-sickbay-referral-log.html` **§02-thread** — the parent comms thread (`.comms-thread`, lines **622–698**) — *and* **§03** — today's parent-notifications timeline (`.notify-timeline`, lines **750–922**).
- `Surfaces/schoolup-sickbay-visit-record.html` **§05** — communications, follow-up & cross-links (lines **930–1139**).
**Companions:** `docs/senior/sickbay-referral-surface-map.md` (INCR-25 — marked §03 **MAP-ONLY → INCR-26**; §R2.5 OMITTED the comms thread at 25; this map builds both) · `sickbay-visit-surface-map.md` (INCR-22 — §05 was omit-not-fake'd; Y4/Y5 preserved the HM card/strip copy for here) · `sickbay-surface-inventory.md` (module breadth · N/B numbering · 6 PII classes) · `sickbay-setup-surface-map.md` (INCR-21 — the **§05 three-tier policy anchor** frozen constants that key every event here, R26).
**Board:** `docs/senior-build-plan.md` → **MODULE 4.4** header (L2369), the **INCR-26 row** (L2395, *"none (table authored in 0060)"*), **D7** (Hubtel deferred → console-only SMS, L2385), **D8** (no parent portal — every sickbay table stays `parent_deny`, L2385), **F4** (`private_note` never parent-facing — schema `db/schema/sickbay.ts:1608,1634`).
**Shipped spine this map builds on (migration-free):** `db/schema/sickbay.ts` **`sickbay_notification`** (L1612–1673, authored in the referral migration) — `tier 1-3` (`smallint`, `CHECK 1..3`), `channel`/`direction`/`recipient` enums (`_enums.ts:652–664`), `trigger_label`, `body`, `private_note`, `answered`, `call_duration_seconds`, `scheduled_for`, `sent_at`, `notification_log_id` (SET NULL → shipped `notification_log`), `retry_of_id` (RESTRICT self-FK). `lib/sms/index.ts` **`sendSms()`** (the shipped console↔Hubtel abstraction; `ConsoleSmsProvider` logs and returns `{ok:true, provider:"console", id:"console-{ts}"}` — **no delivery receipt**). `lib/access.ts::SICKBAY_CLINICAL_{READ,WRITE}_ROLES` (shipped 22).

> **Migration-free.** Kofi rules the notification *domain* in parallel (tier semantics, recipient fan-out, retry policy, the setup §05 policy anchor). This map owns the **surface inventory** of what the thread, the timeline, and the §05 log actually render. The single sharpest hand-off item — a **schema-comment vs surface mismatch on what `tier` means** — is §2, flagged for Kofi.

---

## 0. Scope — three renderings of ONE shipped table

### 0.1 Section → increment → build status at INCR-26

| Source section | Title (verbatim) | Lines | Owner | Build status at INCR-26 |
|---|---|---|---|---|
| **referral §02-thread** | *Parent comms thread · A. Aidoo (mother)* | 622–698 | **INCR-26** | **BUILD** — the 7-event chronological thread: OUTBOUND/INBOUND/failed, call durations, verbatim SMS bodies, the private matron `.ct-note`. |
| **referral §03** | *Today's parent notifications · timeline* | 750–922 | **INCR-26** | **BUILD** — stats strip, filter strip, the 8-row tier timeline (7 fired + 1 scheduled/`.future`), the failure/retry panel. |
| **visit §05** | *Communications, follow-up & cross-links* | 930–1139 | **INCR-26** | **BUILD** — the 4-entry notification log, the 4 cross-link cards, the 5-step follow-up plan, the `.action-bar`. |

**No residual INCR-27 in these three sections.** (The adjacent referral §04 30-day history and §05 reconciliation are INCR-27, already mapped in the referral map — not in scope here.) The only elements gated *beyond* INCR-26 are gated on **Hubtel go-live** (an owner provisioning decision, not an increment) — see §3.

### 0.2 🔴 The three renderings are ONE entity — `sickbay_notification` — read three ways

Every row in all three sections is a `sickbay_notification`. The three surfaces differ only in **filter + density**, and INCR-26 should ship **one loader + three thin presentational variants**, not three data paths:

| View | Filter | Density | Recipients drawn | Axis the colour encodes |
|---|---|---|---|---|
| **§02-thread** (case detail card) | `WHERE referral_id = ? AND recipient = 'PARENT'` | rich, per-event narrative + private note | PARENT only (mother) | **DIRECTION** — outbound gold / inbound green / failed grey (`.ct-chan`, `.ct-tag`) |
| **§03 timeline** (day view) | `WHERE created_at::date = today` (all students/referrals/visits) | one line per event, tier-grouped | PARENT (mother/father/grandmother) — HM/headmaster rows not drawn here | **TIER** — 1 gold / 2 warn / 3 terra (`.nt-icon`, `.nt-tier`) |
| **§05 log** (visit card) | `WHERE visit_id = ?` (all recipients) | compact log + `.nr-channel` pill | PARENT ×2, HOUSEMASTER ×1, HEADMASTER/SYSTEM ×1 | **CHANNEL** — phone terra / sms gold / in-app green / system neutral (`.nr-channel`) |

**🔴 Three colour languages collide on the same data.** In §03 `terra` = Tier 3; in §05 `terra` = Phone; in §02 `green` = inbound. A phone call is terra in §05 but its tier could be gold (Tier 1) in §03. **Reconciliation ruling for the build:** the **tier colour language (gold/warn/terra) is the primary, canonical signal** (it is the module's whole point). Render **channel by glyph** (`→ ← S ×`) + a **neutral pill**, not by re-tinting phone→terra / sms→gold; drop §05's `.nr-channel` terra/gold/green fills to a neutral treatment so a colour never means "Tier 3" in one card and "Phone" in the next. Direction (§02 outbound-gold/inbound-green) is a legitimate secondary axis *within the thread*, where tier is constant (all Tier 3). Preserve it there; do not let it leak into the tier-coloured §03. **Kofi/Lucy confirm before build.**

### 0.3 What the referral map / visit map already committed here

- **Referral map §R2.5** OMITTED the whole comms-thread card at INCR-25 (Y1 boundary) — *"Do not render a partial thread at 25."* Now built. The referral map's §5-preserved thread copy had **draft drift** (it described a "15:25 · Latest" gold-italic row); **the shipped HTML has no such treatment** — row 7 (15:25) is an ordinary inbound call. **This map's verbatim copy (§C1) is from the HTML and supersedes the referral map's preservation.**
- **Visit map Y4/Y5** preserved the HM notification card (§V2.4) and the HM awareness strip (§T1.6) verbatim for INCR-26, with the binding rule **"anything an HM can see about an admission carries name + location, never condition."** §05's HM row (§C3) is that card; the rule is honoured in §7.
- **Referral map §12 / visit map §12:** *"every parent notification keys off the setup §05 three-tier policy; the referral is the Tier-3 trigger… Scheduled per-case cadence + retry/failure are new (B9)."* B9 is finally resolved here (§5) — **render-on-read + matron-triggered send, no cron**, the boarding `exeat-notify` posture.

---

## 1. Shared chrome, routes, gates, tokens, type

### 1.1 Design-doc chrome — do NOT build

Same rule as every sickbay map: build only `.app-shell` (the shipped `components/app/sidebar.tsx` + main). The `.notes` right rails are intent documentation — **port the rules, render none of the text.**

| Do NOT build | Where |
|---|---|
| every `.section-head` (`03` / `Today's parent notifications · timeline` / `14 May · 6 sent · 1 due`; visit `05` / `Communications, follow-up & cross-links` / `Parent · HM · register`) | 751–755; 932–936 |
| every `.desktop` / `.browser-bar` / `.url` / drop-shadow | per section |
| the `.notes` rails (§03 911–920 *"What the timeline reveals"*; visit §05 1128–1136 *"The two parent notifications"*) | — |
| the surface demo sub-nav (`Today's sickbay · Visit record · Chronic register · Referrals · Setup`) — **app nav wins** | 770–774 |

**Notes-panel rules to PORT (not render):**
- §03 — *"Three tiers fire visibly different — gold (Tier 1, light SMS), warn (Tier 2, call + SMS), terracotta (Tier 3, phone-first)"* (this is the tier colour contract — §2); *"Future events stay in the same timeline… with reduced opacity"* (the `.future` scheduled row — §5); *"Failure recovery is visible… the 85% delivery rate reflects the failure honestly"* (🔴 fabricated telemetry under console-only — §3); *"Cadence is per case, not per school"* (per-case, not the medication-round schedule — §5).
- visit §05 — *"A phone call is not enough on its own… the SMS gives her something to re-read"* (the call+SMS pairing is the Tier-2 policy, not two rows to invent); *"ends with 'Reply CALL to request callback' — the safe-channel back to the Matron"*; *"The HM and Headmaster notifications are medical-detail-light"* (§7, the product); *"any future Matron — or any auditor — can reach the chronic register, attendance, the boarding roll, the billing trail in one click each"* (the cross-links card is a navigation commitment).

### 1.2 Routes & navigation

- **§02-thread:** it is a **card inside the case-detail route** `/senior/sickbay/referrals/[ref]` (surface URL `…/sickbay/referrals/r-2026-05-14-0817#comms`). **Route by the referral row's server-resolved id** — the shipped `sickbay_referral` has **no `reference` column** (route-by-id was ratified; referral-map Q1 resolved). The thread is an anchored section of one page, not a sub-route.
- **§03 timeline:** `/senior/sickbay/referrals/notifications` — surface URL `asankrangwa.omnischools.gh/sickbay/referrals/notifications`. A day view; reachable from the referral log's in-page nav.
- **§05 comms:** `/senior/sickbay/visits/[ref]#communications` — surface URL `app.omnischools.gh/sickbay/visits/VR-2026-05-14-0089-001#communications`. An **in-page section of the visit route** (route by `sickbay_visit.reference`, the `VR-` idiom shipped at 22). `#communications` is a scroll anchor, not a sub-route.
- **Sidebar:** unchanged — the shipped flat nav's one Sickbay row → `/senior/sickbay/today`. **No new nav row.** Notifications is reached from within the referral module; the comms trail from within the visit record. "Student support" stays the section-nav label if the twelve-item threshold ever triggers sectioning; "pastoral" stays editorial/CSS.
- **Surface nav drift, for the record:** §03 draws `Dashboard · Students · Attendance · Boarding · Sickbay · Discipline · Communications · Reports`; visit §05 draws the same minus Reports/Attendance ordering. **App nav wins.**

### 1.3 🔴 Gates — clinical-read gated; the `private_note` may want to be tighter still

| Slice | Read | Write | Grounding |
|---|---|---|---|
| **§02-thread · §03 · §05** (the comms record) | **`SICKBAY_CLINICAL_READ_ROLES = [HEADMASTER, MATRON]`** — **NOT ADMIN, NOT HOUSEMASTER** (D2) | **`SICKBAY_CLINICAL_WRITE_ROLES = [MATRON]`** (log a call, log/queue an SMS, schedule a reminder, mark answered) | The thread renders parent-facing bodies *and* the private matron note *and* condition text (`IV antimalarial`, `SCD pain crisis`) — the module's Class-1 PII. ADMIN gets module access, **no comms detail** (server-side prop trim, the R40/Z2 rule). |
| **`private_note` (F4) inside the thread** | 🔴 **OPEN — Sarah/Kofi call.** The thread is read by both MATRON and HEADMASTER. `private_note` is *"a parent-boundary landmine"* — but is it also HM-boundary? Recommend **MATRON-only**: the HEADMASTER (a Tier-3 digest recipient, not the clinician) reads the parent-facing `body`, **not** the matron's private annotation. Trim `private_note` from any non-MATRON render server-side. | — | The schema places `private_note` adjacent to `body` (`sickbay.ts:1634`) precisely so the boundary is a render decision, not a column absence. |

**D8 binds every render here:** no parent portal in 4.4; every sickbay table stays `parent_deny` (catalog-driven, zero edits). **Nothing in these three sections is ever parent-readable** — the mother sees the SMS *on her phone*, never a portal row. The already-shipped inert parent "Sickbay" tab stays inert (board D8).

### 1.4 Token reference (per element — `styles/tokens.css` names)

Canonical file `styles/tokens.css` (`--navy #1a2b47`, `--navy-2 #2d3f5c`, `--navy-3 #5c6675`, `--gold #c8975b`, `--gold-soft #e8d4b8`, `--gold-bg #f5ebdc`, `--bg #faf7f2`, `--surface #ffffff`, `--green #2f6b47`, `--green-bg #e5efe8`, `--terra #b84a39`, `--terra-bg #f5e1dc`, `--warn #c58a2e`, `--warn-bg #f5e9d0`, `--border-1 #e5dfd3` = the surfaces' `--border`, `--border-2 #d4ccba`). **Token classes in JSX, never inline `var(--x)`.** All three sections introduce **no new named hex** — every colour resolves to a declared token; the only raw values are the alpha literals in §1.5.

**§02-thread (`.comms-*`, source CSS 166–187):**

| Element | Token / type |
|---|---|
| `.comms-row` | `grid-cols-[90px_auto_1fr] gap-[14px] py-[14px] border-t border-border items-start`; first-child `border-t-0 pt-1` |
| `.ct-time` / `.day` | `font-mono text-[11px] text-navy-2 font-semibold pt-[5px]` · day `block text-[9px] text-navy-3 font-medium mt-[2px]` **font-body (Manrope-in-mono, deliberate)** |
| `.ct-chan` (36px circle, Fraunces 600 11px) | `.call-out` **bg-gold text-navy** · `.call-in` **bg-green-bg text-green border-[1.5px] border-green** · `.sms-out` **bg-gold-bg text-gold border-[1.5px] border-gold** · `.call-fail` **bg-bg text-navy-3 border-[1.5px] border-dashed border-border-2** · `.sms-in` *(declared, unused)* **bg-[rgba(45,107,71,0.08)] text-green border-[1.5px] border-dashed border-green** — §1.5 no-alpha |
| `.ct-body` / `.ct-hdr` | `text-[12px] text-navy-2 leading-[1.5]` · hdr `font-semibold text-navy mb-[3px] flex gap-[10px] items-baseline` |
| `.ct-tag` (8px/0.1em uppercase 700, `px-[7px] py-[2px] rounded-full`) | base `text-navy-3 bg-bg border border-border` · `.outbound` **text-gold bg-gold-bg border-gold-soft** · `.inbound` **text-green bg-green-bg border-green** · `.failed` **text-navy-3 bg-bg border-dashed border-border** |
| `.ct-dur` | `font-mono text-[10px] text-navy-3 font-medium` |
| `.ct-msg` (verbatim SMS bubble) | `italic text-navy-2 px-[12px] py-[8px] bg-bg rounded-lg border-l-2 border-gold-soft mt-1`; `.fail` → `border-l-border-2 text-navy-3` |
| `.ct-note` (🔴 `private_note`) | `text-[11px] text-navy-3 mt-1`; `<b>` → `text-navy-2 font-semibold` |

**§03 timeline (`.notify-*` / `.filter-*`, source CSS 209–237):**

| Element | Token / type |
|---|---|
| `.notify-timeline` | `bg-surface border border-border rounded-[12px] overflow-hidden` |
| `.notify-row` | `py-[14px] px-[20px] border-b border-border grid-cols-[90px_36px_1fr_auto] gap-[14px] items-center`; last `border-b-0`; **`.future`** `bg-[linear-gradient(90deg,var(--bg)_0%,var(--surface)_100%)] opacity-70` |
| `.nt-time` / `.ago` | `font-mono text-[11px] text-navy-2 font-semibold` · ago `block text-[9px] text-navy-3 font-medium mt-px` **font-body**; `.ago.urgent` **text-terra font-semibold** · `.ago.future` **text-gold font-semibold italic** |
| `.nt-icon` (36px circle, Fraunces 600 13px) | `.tier-1` **bg-gold-bg text-gold** · `.tier-2` **bg-warn-bg text-warn border-[1.5px] border-warn** · `.tier-3` **bg-terra-bg text-terra border-[1.5px] border-terra** |
| `.nt-line` | `text-[12px] text-navy-2`; `<b>` → `text-navy font-semibold`; `<em>` → **`text-gold not-italic font-semibold`** (the event phrase) |
| `.nt-meta` / `.channel` | `text-[10px] text-navy-3 mt-[3px] font-medium` · channel pill `px-[6px] py-px bg-bg rounded-full text-[9px]/0.08em uppercase font-bold mr-1 border border-border` |
| `.nt-tier` (8px/0.12em uppercase 700, `px-2 py-[3px] rounded-full`) | `.t1` **text-gold bg-gold-bg** · `.t2` **text-warn bg-warn-bg** · `.t3` **text-terra bg-terra-bg** |
| `.filter-strip` / `.fs-lbl` | `flex gap-2 mb-4 flex-wrap items-center` · `text-[10px]/0.14em uppercase text-navy-3 font-bold mr-1` |
| `.filter-pill` / `.ct` | `bg-surface border border-border-2 rounded-full px-3 py-[6px] text-[11px] font-semibold text-navy-2`; `.active` **bg-navy text-bg border-navy**; `.ct` `bg-[rgba(200,151,91,0.18)] text-gold px-[6px] py-px rounded-full ml-[5px] font-mono text-[10px]` — §1.5 no-alpha; `.active .ct` `bg-[rgba(200,151,91,0.2)] text-gold-soft` |
| stats-strip (reuses `.stat`/`.s-lbl`/`.s-val`/`.unit`/`.s-trend` from §01) | 🔴 **`.s-val gold/warn/terra/green` have NO CSS rule in the file → render navy in the surface. INCR-26 MUST map them intentionally:** Tier1→`text-gold`, Tier2→`text-warn`, Tier3→`text-terra`, Delivery→`text-green` (they are unambiguously the tier counts — referral-map §1.5 flag, actioned here). |
| failure/retry panel (inline-styled 899–905) | `mt-[18px] p-[14px_18px] bg-gold-bg border-[1.5px] border-gold-soft rounded-[10px] text-[12px] text-navy-2 grid-cols-[1fr_auto] gap-[18px] items-center`; title `font-display font-semibold text-[14px] text-navy mb-1`; `<b>` navy-2 600; the `View retry log` `.btn` |

**visit §05 (`.notif-row`/`.nr-*`, `.xlink-*`, `.steps-*`, `.action-bar`, source CSS 216–273):**

| Element | Token / type |
|---|---|
| `.notif-row` | `grid-cols-[90px_1fr_auto] gap-4 py-[14px] border-b border-border items-start`; last `border-b-0` |
| `.nr-time` | `font-mono text-[11px] text-navy-2 font-semibold pt-[2px]` |
| `.nr-who` | `font-display text-[14px] font-semibold mb-[3px] tracking-[-0.005em]`; `<em>` **italic text-gold 400** |
| `.nr-detail` | `text-[11px] text-navy-3 mb-[5px]`; `<b>` → `text-navy-2 font-semibold` |
| `.nr-msg` (verbatim SMS / message) | `text-[12px] text-navy-2 italic leading-[1.5] px-[12px] py-[8px] bg-bg border-l-2 border-gold rounded-[0_6px_6px_0]` |
| `.nr-channel` (9px/0.1em uppercase 700, `px-2 py-[3px] rounded-full`) | `.phone` bg-terra-bg text-terra · `.sms` bg-gold-bg text-gold · `.in-person` bg-green-bg text-green · `.system` bg-bg text-navy-2 border border-border — 🔴 **re-tint to neutral per §0.2 to avoid the tier-colour clash** |
| `.xlink-strip` / `.xlink-card` | `grid-cols-2 gap-[14px]` (→ 1-col responsive) · card `bg-surface border border-border rounded-[10px] p-[16px_20px] grid-cols-[1fr_auto] gap-3 items-center` |
| `.xc-eyebrow` / `.xc-title` / `.xc-meta` | `text-[9px]/0.14em uppercase text-gold font-bold mb-1` · `font-display text-[14px] font-semibold`, `<em>` italic gold 400 · `text-[11px] text-navy-3`, `<b>` navy-2 600 |
| `.xlink-arrow` | `size-8 rounded-full bg-gold-bg text-gold grid place-items-center font-bold text-[14px]` |
| `.steps-list` / `.steps-row` | `py-1` · row `grid-cols-[32px_1fr] gap-[14px] py-3 border-b border-border items-start`, last none |
| `.sr-num` | **font-display italic text-[20px] font-normal text-gold** text-center `pt-[2px]` (roman numerals i–v) |
| `.sr-when` / `.sr-text` | `text-[10px]/0.12em uppercase text-navy-3 font-bold mb-[3px]`, `<b>` → **text-gold** · `text-[13px] text-navy-2 leading-[1.55]`, `<b>` navy 600 |
| `.action-bar` / `.ab-note` / `.ab-actions` | `bg-surface border-2 border-gold rounded-[14px] p-[18px_24px] mt-8 grid-cols-[1fr_auto] gap-[18px] items-center` · note `text-[12px] text-navy-3 leading-[1.55]`, `<b>` navy 600 · actions `flex gap-2` |

**Type families:** `font-display` = **Fraunces** (`.ct-chan` glyphs, `.nt-icon`, `.nr-who`, `.xc-title`, `.sr-num` italic, the failure-panel title, every gold `<em>`) · default = **Manrope** (`.day`/`.ago` sub-lines are deliberately Manrope inside a mono time cell — reproduce, do not "correct") · `font-mono` = **JetBrains Mono** (`.ct-time`/`.ct-dur`, `.nt-time`, `.nr-time`, `.filter-pill .ct`).

### 1.5 No-alpha discipline (repo memory `no-alpha-token-opacity`)

**Finding: three alpha literals, all in §03/§02; visit §05 is translucency-free.** Port each as an arbitrary value, never slash-opacity — slash-opacity on a raw-hex token renders *nothing* while `next build` passes.

| Region | Raw value | Port to (NOT slash-opacity) |
|---|---|---|
| `.comms-row .ct-chan.sms-in` (unused variant) | `rgba(45,107,71,0.08)` | `bg-[rgba(45,107,71,0.08)]` — **never** `bg-green/8`. Unused in the drawn thread; keep the class only if an inbound-SMS row ships. |
| `.filter-pill .ct` / `.active .ct` count badge | `rgba(200,151,91,0.18)` / `(0.2)` | `bg-[rgba(200,151,91,0.18)]` / `bg-[rgba(200,151,91,0.2)]` — **never** `bg-gold/18`. |
| `.notify-row.future` | `opacity:0.7` | `opacity-70` utility (safe — not a token alpha). The gradient `linear-gradient(90deg,var(--bg),var(--surface))` is two solid tokens — safe. |

**Verify in the live preview, not the build.**

### 1.6 Bespoke values — reproduce exactly

Captured inline in §1.4 (grids, radii, paddings). The only non-scale bespoke sizes: the two 36px channel/tier circles (`.ct-chan`, `.nt-icon` → `size-9`), the 32px xlink arrow (`size-8`), the `90px auto 1fr` / `90px 36px 1fr auto` / `90px 1fr auto` timeline grids (reproduce literally), and the failure panel's `1fr auto` split. The `.action-bar` `border-2 border-gold` and the `.nr-msg` `rounded-[0_6px_6px_0]` (left-flat bubble) are load-bearing.

---

## 2. 🔴 The tier-semantics reconciliation — the headline hand-off to Kofi

**The shipped schema comment and the surface disagree on what `tier` means.**

- **Schema (`sickbay.ts:1628`):** `tier: smallint // 1 parent · 2 HM · 3 headmaster/district` — i.e. tier = the **recipient escalation link**.
- **Surface §03 (every row):** tier = **contact INTENSITY toward the parent** — Tier 1 = *SMS only* (gold), Tier 2 = *call + SMS* (warn), Tier 3 = *phone-first* (terra). **Every §03 row's recipient is the PARENT** (mother/father/grandmother); the HM/headmaster/district recipients never appear in §03. The stat labels prove it: `Tier 1 today · 3 SMS`, `Tier 2 today · 1 call + SMS`, `Tier 3 today · 3 phone-first`.

The module is titled **"three-tier parent-notification chain"** — *parent*-notification. The three tiers are tiers of contacting the **parent** (SMS → call+SMS → phone-first), keyed off the setup §05 policy anchor and the event type. The **recipient enum** (`PARENT | HOUSEMASTER | HEADMASTER | DISTRICT_HEALTH`) carries the *separate* awareness fan-out (§05 draws parent, HM, headmaster-digest). Two orthogonal axes; the schema comment conflated them.

**Recommended ruling (Kofi to ratify — no migration either way):**
- **`tier` = the §03 intensity policy tier (1 SMS / 2 call+SMS / 3 phone-first).** Correct the schema comment (comment-only, no DDL). Colour: **Tier 1 → gold, Tier 2 → warn, Tier 3 → terra** — the one canonical signal across all three sections.
- **`recipient` = who this row reached** (PARENT for the thread; HOUSEMASTER/HEADMASTER/DISTRICT for §05's fan-out rows).
- The **"escalation chain"** (parent → HM → headmaster/district) is modelled by **multiple rows per event with different `recipient`**, not by `tier`.
- The tier value is **derived from the setup §05 policy** at write time (event type → intensity), then **stored** on the row (so a later policy edit does not rewrite history) — the R32 "store the resolved value, derive the label" idiom.

**If Kofi keeps the schema's recipient-escalation reading of `tier`,** then §03's Tier 1/2/3 chips are *intensity* and need a source with no column — either `trigger_label` free text or a derived (channel + event) computation. That is strictly worse (a colour with no backing) and contradicts the surface; flag it as the dispreferred branch. **This is the one ruling that blocks the loader shape.**

---

## §C1 — referral-log §02-thread · Parent comms thread

**Surface lines 622–698.** A card inside the case-detail route (§R2 of the referral map). Clinical-read gated. `recipient = PARENT`, one referral, chronological ascending.

### C1.1 Card head — exact copy

| Element | Verbatim | Binding |
|---|---|---|
| `.ch-title` | `Parent comms ` + `<em>thread</em>` + ` · A. Aidoo (mother)` | static label + derived guardian (`student_guardian` where `is_primary`, `relationship` title-cased) — ⚠️ `A. Aidoo` is demo (F13) |
| `.ch-meta` | `7 events · phone ` + `<b>+233 24 487 6612</b>` | **derive** `{n} events` (singular `1 event`); phone = guardian phone (**store full, mask at display** per the chronic-register rule) — ⚠️ fabricated number (F13) |

### C1.2 The 7 events — verbatim (the non-disclosure vocabulary is the product)

Each row: `.ct-time` (`HH:MM` + `{n}h/m ago` sub) · `.ct-chan` glyph (direction) · `.ct-body` (`.ct-hdr` = header + `.ct-tag` direction pill + `.ct-dur`; then the body; then optional `.ct-note`).

| # | Time / ago | Chan | `.ct-hdr` (+ tag · dur) | Body — `body` (parent-facing) VERBATIM | `.ct-note` — `private_note` (F4, matron-only) VERBATIM |
|---|---|---|---|---|---|
| 1 | `06:50` / `9h ago` | `call-out` `→` | `Outbound call · Matron Bediako` · tag `Tier 3 · referral` · dur `4m 12s` | `Told her Yaa had positive malaria test, was vomiting, couldn't keep meds down, and needed IV at the hospital. Explained I was going with her in the school van. Reassured no need to rush from work — would update at every reassessment.` | `Mother sounded shaken but accepted. Asked if she needed to come immediately — told her visiting hours from 17:00 if she wanted, no need before.` |
| 2 | `06:52` / `9h ago` | `sms-out` `S` | `Outbound SMS · auto-confirm` · tag `Tier 3 · auto` · dur `delivered 06:53` | *(rendered in `.ct-msg` bubble)* `Confirming: your daughter Yaa Aidoo has been referred to Asankrangwa Government Hospital. Matron Bediako accompanying. NHIS card with us. Will call with updates. — Omnischools · Asankrangwa SHS` | — |
| 3 | `07:30` / `8h ago` | `call-fail` `×` | `Outbound call · no answer` · tag `attempted` · dur `3 rings` | *(`.ct-msg.fail` bubble)* `Wanted to confirm she'd received the SMS and tell her admission was complete. Will retry.` | — |
| 4 | `08:15` / `7h ago` | `call-in` `←` | `Inbound call · A. Aidoo` · tag `Tier 3 · parent-initiated` · dur `6m 04s` | `She'd seen the SMS. Wanted to confirm the NHIS card was being used — said she didn't want any out-of-pocket. Confirmed yes, card presented at ER, IV artesunate covered, only out-of-pocket would be optional comfort items.` | `Also asked how Yaa was emotionally. Told her: scared but composed. She thanked me for staying with her.` |
| 5 | `11:00` / `4h ago` | `sms-out` `S` | `Outbound SMS · ward update` · tag `Tier 3 · update` · dur `delivered 11:01` | *(`.ct-msg` bubble)* `Update: Yaa admitted to Ward B bed 7. IV antimalarial started. Temp coming down. Doctor sees her again at 14:00. — Matron Bediako` | — |
| 6 | `14:20` / `1h ago` | `call-out` `→` | `Outbound call · Matron Bediako` · tag `Tier 3 · update` · dur `8m 31s` | `Relayed Dr Mensah's 14:00 reassessment in detail — improving, temp 37.4°C, fluids stable, plan to observe overnight and reassess at 08:00. Switched to oral meds. Likely Thursday afternoon discharge.` | `Mother said she'd come at 17:00 visiting hours. Asked if she should bring food. Told her hospital meals fine but Yaa would appreciate light soup. She said she'd bring some.` |
| 7 | `15:25` / `5m ago` | `call-in` `←` | `Inbound call · A. Aidoo · from hospital` · tag `Tier 3 · update` · dur `2m 47s` | `She's at the hospital now. Yaa eating the soup. Wanted to know if she's expected back at school tomorrow afternoon — yes, assuming morning reassessment is clear. Matron will collect; school van on standby from 11:00.` | `No further action unless overnight call. Mother has matron's direct line.` |

**Bindings per row:** `sent_at`/`created_at` → `.ct-time`; `now − sent_at` (floored, on-read) → `.ago` sub (`{n}h ago` / `{n}m ago`); `direction` (`OUTBOUND`/`INBOUND`) + `channel` (`CALL`/`SMS`) → `.ct-chan` glyph + `.ct-tag`; `answered=false` → the `call-fail`/`attempted` treatment (row 3); `call_duration_seconds` → `.ct-dur` for calls (`4m 12s` = 252s); for SMS the `.ct-dur` shows a **delivery status** (🔴 §3 — console-only cannot honestly say `delivered 06:53`); `body` → the call narration or the `.ct-msg` SMS bubble; `private_note` → `.ct-note`; `tier`+`trigger_label` → the `.ct-tag` text (`Tier 3 · referral`/`auto`/`parent-initiated`/`update`).

**Rendering rules:**
- **`body` vs `private_note` split (F4):** for a CALL, the `.ct-body > div` (what was communicated) → `body`; the `.ct-note` (matron's private observation) → `private_note`, **rendered muted (navy-3) below the body, never sent, MATRON-only per §1.3.** For an SMS, the verbatim message → `.ct-msg` bubble = `body`; no private note in this demo.
- **Append-only, chronological.** No edit/delete; a correction is a new row (the doctor-consult idiom). `created_by_user_id` = the matron.
- **The failed call (row 3)** renders `answered=false`: dashed grey `.ct-chan.call-fail` `×`, tag `attempted` (not a tier), `.ct-dur` `3 rings` (a no-answer descriptor — see §4), body in the muted `.ct-msg.fail` bubble.
- **Inbound rows (4, 7)** are **recorded parent-initiated contacts** the matron logs after the fact — `direction=INBOUND`, `recipient=PARENT`, `channel=CALL`. There is no auto-capture; the matron types what the parent said (the R21 recorded-actor idiom applied to the parent).

---

## §C2 — referral-log §03 · Today's notifications timeline

**Surface lines 750–922.** The day view: `/senior/sickbay/referrals/notifications`. Every row's recipient = PARENT.

### C2.1 Page head

| Element | Verbatim | Binding |
|---|---|---|
| section-meta | `14 May · 6 sent · 1 due` | **derive** — ⚠️ drift: 7 fired rows drawn, not 6 (§11 F14) |
| Crumb | `Sickbay` *(link)* ` · ` `Referrals` *(link)* ` · Notifications · Today` | — |
| `<h1>` | `Today's ` + `<em>notifications.</em>` | — |
| Lede | `The three-tier rule fired **seven times** today across two referrals, two admissions, and three discharges. Every event keyed off the setup-page policy anchor. One Tier 3 notification is due in 90 minutes (Y. Aidoo evening update).` | **derived + counter-drifted** (8 rows drawn; "seven times" ≠ 6 sent) → render `The three-tier rule fired {n} time{s} today…` + the derived `{n} due` clause; the `in 90 minutes` computed on-read from `scheduled_for` |
| Action 1 | `Filter by tier` | filters the list — BUILD (the filter strip below already does this) or fold in |
| Action 2 | `Export day` | **OMIT** (an export of the day's notifications carries every condition/parent phrase out of the room — the A6 print/export precedent) |
| Action 3 | `Send manual` | `.btn.primary` — **BUILD** = compose a manual parent notification (W-item; console-only send, §3) |

### C2.2 Stats strip — 4 tiles (all counts derived; colours mapped intentionally — §1.4)

| # | `.s-lbl` | `.s-val` (colour) | `.s-trend` | Derivation |
|---|---|---|---|---|
| 1 | `Tier 1 today` | `3` **SMS** (→ `text-gold`) | `Sickbay admission notify` | count `WHERE tier=1 AND today`. ⚠️ stat says 3 but only 2 Tier-1 rows drawn (F14) — derive |
| 2 | `Tier 2 today` | `1` **call + SMS** (→ `text-warn`) | `Inpatient day update` | count `WHERE tier=2` — ⚠️ 2 Tier-2 rows drawn (09:14, 15:25); derive |
| 3 | `Tier 3 today` | `3` **phone-first** (→ `text-terra`) | `2 referrals · 1 follow-up` | count `WHERE tier=3` fired (excl. the scheduled row) |
| 4 | `Delivery rate` | `85` **%** (→ `text-green`) | `**1 fail** · retried successfully` | 🔴 **OMIT at INCR-26 (D7 console-only).** The console provider emits **no delivery telemetry** — an 85% rate and a "1 fail · retried" are pure fabrication (§3). Strip drops to **3-up** until Hubtel go-live. |

### C2.3 Filter strip

`.fs-lbl` `Show` · pills (each `{label} <span class="ct">{count}</span>`, counts **derived**):

`All today` `7` *(active)* · `Tier 1` `3` · `Tier 2` `1` · `Tier 3` `3` · `Failed` `1` · `Due / queued` `1`.

- **BUILD** as client-side filters over the day's rows (or server query params). ⚠️ Every count is drift-prone — derive from the actual rows, never the drawn literal. **`Failed` `1`** and the delivery panel both depend on a failure signal the console provider never produces (§3): at INCR-26 render `Failed 0` (or omit the pill) unless a real failure state exists; `Due / queued` = rows with `scheduled_for` set and `sent_at` null.

### C2.4 The timeline — 8 rows (7 fired + 1 scheduled `.future`), verbatim

Each row: `.nt-time` (`HH:MM` + `.ago` sub) · `.nt-icon` tier (1/2/3) · `.nt-body` (`.nt-line` + `.nt-meta`) · `.nt-tier` pill.

| # | Time / ago | Tier | `.nt-line` VERBATIM | `.nt-meta` VERBATIM (channels + rule) | `.nt-tier` |
|---|---|---|---|---|---|
| 1 | `06:50` / `9h ago`·urgent | 3 | `**Y. Aidoo** · F3 Slessor · *severe malaria referral* · mother A. Aidoo notified by phone (4m 12s)` | `[Phone][SMS confirm 06:52]` `Per Tier 3 rule: phone first, SMS second within 5 min · matron-initiated` | `Tier 3 · referral` |
| 2 | `09:14` / `6h ago`·urgent | 2 | `**Adwoa Mensa** · F1 Slessor · *sickbay admission · SCD mild crisis* · mother M. Mensa notified by phone (3m 50s)` | `[Phone][SMS confirm 09:17]` `Tier 2 fires for any chronic register admission · cross-referenced with chronic plan` | `Tier 2 · admission` |
| 3 | `09:45` / `6h ago` | 1 | `**J. Manu** · F2 Aggrey · *sickbay visit · headache + appetite concern* · grandmother E. Manu SMS only` | `[SMS]` `Tier 1 because of pastoral cross-reference flag on J. Manu's record · auto · delivered 09:46` | `Tier 1 · pastoral` |
| 4 | `11:00` / `4h ago` | 3 | `**Y. Aidoo** · F3 Slessor · *ward update* · mother SMS update — IV started, fever coming down` | `[SMS]` `Tier 3 ongoing notifications continue until discharge · scheduled by matron at handoff` | `Tier 3 · update` |
| 5 | `11:45` / `4h ago` | 3 | `**K. Boateng** · F2 Aggrey · *orthopaedic referral · suspected wrist fracture* · father K. Boateng Snr notified by phone (6m 10s)` | `[Phone][SMS confirm 11:47]` `Father arrived at hospital ahead of school van · already on site by 13:00` | `Tier 3 · referral` |
| 6 | `14:30` / `1h ago` | 1 | `**J. Manu** · F2 Aggrey · *discharged from sickbay* · grandmother SMS follow-up confirmation` | `[SMS]` `Tier 1 close-out · symptoms resolved · matron flagged for VLC follow-up (no medical reason for further sickbay action)` | `Tier 1 · discharge` |
| 7 | `15:25` / `5m ago` | 2 | `**Adwoa Mensa** · F1 Slessor · *status update* · mother phone (2m 20s) — comfortable, fluids and pain meds working` | `[Phone]` `Tier 2 follow-up while still in sickbay · mother asked to come at 17:30 visiting · agreed` | `Tier 2 · update` |
| 8 **`.future`** | `17:00` / `in 1h 30m`·future | 3 | `**Y. Aidoo** · F3 Slessor · *evening status update due* · scheduled SMS — auto-fire unless matron preempts` | `[SMS]` `Tier 3 inpatient day cadence: 06:00, 11:00, 17:00, 21:00 · evening slot due` | `Due 17:00` |

**Bindings:** `.nt-line` = `<b>{shortName}</b> · {form} {House} · <em>{trigger_label}</em> · {recipient identity} {channel verb} ({duration})`; `.nt-meta` channels = `channel` (+ any paired SMS-confirm row); the trailing rule text = `trigger_label`/policy note (free text). `.nt-tier` = `Tier {tier} · {trigger_label short}` for fired rows; **`Due {HH:MM}`** for the scheduled row (`scheduled_for` set, `sent_at` null).

**Rendering rules:**
- **Tier colour is the whole point** (§2): tier-1 gold, tier-2 warn, tier-3 terra — icon + pill. The `.ago.urgent` terra treatment (rows 1, 2) is a derived "recent + high-tier" emphasis; `.ago.future` gold-italic marks the scheduled row.
- **🔴 The scheduled `.future` row (§5):** renders at its `scheduled_for` position, `opacity-70`, `Due 17:00` pill, `in {duration}` computed on-read. **Soften "auto-fire unless matron preempts"** — nothing auto-fires (no scheduler, B9). Render `scheduled — matron sends at the window`.
- **🔴 The pastoral elevation (row 3, A5):** `Tier 1 because of pastoral cross-reference flag on J. Manu's record` re-identifies J. Manu as pastoral/VLC-flagged. **VLC (module 4.5) is not built** → the pastoral-flag *mechanism* does not exist at 26. **Omit the auto-elevation logic and the "because of pastoral flag" reason string**; render the notification without exposing *why* the tier fired. The row itself (a Tier-1 SMS to the grandmother) is fine; the leak is the *reason* on a shared screen.

### C2.5 Failure / retry panel — 🔴 OMIT at INCR-26 (console-only, D7)

Verbatim (gold panel, 899–905): title `One delivery failed and was retried.` · body `Mother's first SMS at 06:52 came back as **undelivered** from MTN at 06:55 — network issue. Auto-retry at 07:02 succeeded. Failed deliveries appear in the manual-handling queue per the comms setup defaults.` · `.btn` `View retry log`.

**OMIT the whole panel + the `View retry log` control.** The console provider returns `{ok:true}` for every send and produces **no** "undelivered from MTN", no delivery timestamp, no retry. Rendering this panel asserts a delivery-failure event that cannot occur on a console-only build — the worst kind of fake on a comms surface. The schema's `retry_of_id` self-FK is authored for the day Hubtel returns real failures; **at INCR-26 nothing writes it.** (Note the panel *contradicts* the thread: §C1 row 2 says the 06:52 SMS was `delivered 06:53`; this panel says it was `undelivered` at 06:55 then retried 07:02 — the fabrication isn't even self-consistent. F16.) **Reinstatement trigger:** Hubtel go-live + a real provider failure callback.

---

## §C3 — visit-record §05 · Communications, follow-up & cross-links

**Surface lines 930–1139.** In-page section of the visit route (`#communications`). The demo case is Adwoa Mensa's admission (SCD). Draws the **recipient fan-out** (parent, HM, headmaster) — the axis §03 never shows.

### C3.1 Page head

| Element | Verbatim |
|---|---|
| section-meta | `Parent · HM · register` |
| Crumb | `Sickbay` *(link)* ` · Visit ` + `<b>VR-2026-05-14-0089-001</b>` + ` · Communications` |
| `<h1>` | `The ` + `<em>communications</em>` + ` trail.` |
| Lede | `Tier-2 admission → parent notified within **4 minutes**. Housemaster within 6. Doctor consult logged. The chronic register link sits two clicks from any future visit.` — **derived** (the `within 4 minutes` = `notified_at − admitted_at`) |
| Actions | none |

### C3.2 Notification log — 4 entries, verbatim (the recipient fan-out)

Card head `Notification ` + `<em>log</em>` · meta `4 entries · per the three-tier rule` (**derive** `{n} entries`). Each `.notif-row`: `.nr-time` · `.nr-body` (`.nr-who` + `.nr-detail` + `.nr-msg`) · `.nr-channel` pill.

| # | Time | `.nr-who` | `.nr-detail` | `.nr-msg` VERBATIM | channel · recipient / tier |
|---|---|---|---|---|---|
| 1 | `09:18` | `Mrs E. **Mensa** · mother · primary contact` | `+233 24 567 8901 · **answered on 2nd ring** · call duration **3m 12s**` | `"Adwoa is admitted to the sickbay with a mild sickle cell crisis. We are following her standing care plan. She is comfortable. I will call you again at 16:00 with discharge update. Please call us back any time if you need to."` | `Phone` · PARENT / tier 2 |
| 2 | `09:18` | `Mrs E. **Mensa** · written confirmation` | `SMS sent immediately after call · **delivered** at 09:18:47` | `Omnischools / Asankrangwa SHS: Adwoa admitted to sickbay 09:14 — mild sickle cell pain crisis, following care plan. Comfortable. Update at 16:00. Reply CALL to request callback. — Matron Bediako` | `SMS` · PARENT / tier 2 |
| 3 | `09:20` | `Mr S. **Bonsu** · Slessor housemaster` | `In-app notification + walk-over · **acknowledged** at 09:23 from house office` | `Adwoa Mensa admitted with SCD pain crisis — mild, following plan. Attendance auto-excused for today. Please flag classmates if they ask, no medical detail to share.` | `In-app` · HOUSEMASTER |
| 4 | `09:42` | `Mr P. **Asare-Mensah** · Headmaster` | `Daily sickbay summary (rolled into 09:45 admin digest) · **auto-routed**` | `Sickbay morning report · 1 admission · A. Mensa (F1 Slessor) · SCD pain crisis · mild · parent notified 09:18 · expected discharge 16:00.` | `System` · HEADMASTER |

**Bindings & rulings:**
- `.nr-who` = derived guardian/HM/headmaster identity (§11 F13 — all four names are demo; derive from `student_guardian` / `houses.hm_user_id` / the headmaster role). `.nr-detail` = phone (masked) + `answered`/`call_duration_seconds` (row 1: `answered=true`, 192s) + delivery/ack line. `.nr-msg` = `body`. `.nr-channel` = `channel` (`CALL`→Phone, `SMS`, `IN_APP`, `SYSTEM`).
- **🔴 Row 2 `delivered at 09:18:47` (console-only, §3):** OMIT the delivery timestamp — the console provider has no receipt. Render `SMS logged 09:18` (the `sent_at`), never `delivered`.
- **Row 1 `answered on 2nd ring · call duration 3m 12s`** is a **matron-logged call outcome** — REAL (`answered=true`, `call_duration_seconds=192`). Keep. `2nd ring` has no column → render `answered` only, or store as `trigger_label`/note; do not invent a ring-count column (B17).
- **Row 3 `acknowledged at 09:23`** — 🔴 **no `acknowledged_at` column** on `sickbay_notification` (B18). Nearest is `answered` (boolean). Render `acknowledged` (from `answered=true` on an `IN_APP`/HOUSEMASTER row) **without a timestamp**, or omit the ack line. The HM row's `body` is **medical-detail-light-ish but names the condition** — see §7 (the HM body must NOT carry `SCD pain crisis`).
- **Row 4 `auto-routed` digest** — a `SYSTEM`/HEADMASTER in-app digest line; **no real send** required (it is an in-app rollup), so console-only is honest here. `body` is the digest string; it **names the condition to the headmaster** — acceptable within the clinical read gate, but see §7 for the tier-3 digest boundary.

### C3.3 Cross-links — 4 cards (navigation + derived reads), verbatim

Card head `Cross-` + `<em>links</em>` · meta `where this visit connects`. 2×2 grid (`.xlink-strip`).

| Card | `.xc-eyebrow` | `.xc-title` | `.xc-meta` VERBATIM | Build at INCR-26 |
|---|---|---|---|---|
| 1 | `Chronic register` | `Sickle cell care ` + `<em>plan</em>` | `last visit **23 Jan 2026** · 2 crises this semester · plan reviewed Apr 14` | **BUILD** — link to the chronic register (INCR-23 shipped) + derived counts (`2 crises this semester`, `last visit`, `plan reviewed`). |
| 2 | `Attendance` | `Today's excuse ` + `<em>auto-applied</em>` | `**5 periods** · all classes · attendance flags "excused (sickbay)"` | **BUILD the fact, re-express the copy** — R30: `uniq_attendance_student_day` means per-period attendance does not exist. Render **one day mark** (`marked Medical · excused (sickbay)`), never `5 periods`. Links to the day's attendance. |
| 3 | `Boarding` | `Slessor ` + `<em>house roll</em>` | `marked "sickbay" on bed S-12-B · HM has read receipt` | **BUILD partial** — the boarding house-roll link is live; **`bed S-12-B` = B1, OMIT the dorm-bunk fragment** (no upper/lower axis); `HM has read receipt` = the HM notification row's `answered` (B18, render `notified`, not `read receipt` unless a real ack exists). |
| 4 | `Billing` | `School stock ` + `<em>only</em>` | `paracetamol + ORS · **no charge** · within sickbay standing supply` | **BUILD display-only** — this is the *standing-supply* path (no charge, no invoice), distinct from the referral cost lines. The `no charge` is a fact, not a billing write (D6). Render as an honest "no billing entry" line; the link target is the billing module (INCR-27 display). |

**Ruling:** the cross-links are a **navigation commitment** (*"the chronic register, today's attendance, the boarding roll, the billing trail in one click each · No re-keying · No silos"*). At INCR-26 all four targets exist (23/attendance/boarding/billing). Build them as **derived-read cards with real hrefs**; where the underlying datum is not yet real (crisis counts need chronic history, read-receipt needs an ack column) render the honest subset, never a fabricated count.

### C3.4 Follow-up plan — 5 steps, verbatim (🔴 no table — render, don't persist)

Card head `Follow-up ` + `<em>plan</em>` · meta `next 72 hours`. `.steps-list`, roman numerals i–v.

| # | `.sr-when` | `.sr-text` VERBATIM |
|---|---|---|
| i | `**16:00 today** · discharge reassessment` | `**Mrs Bediako** performs mobilisation test, reviews pain, confirms hydration. If criteria met, discharge to Slessor. Call **Mrs Mensa** with outcome.` |
| ii | `**19:00 today** · HM evening check` | `**Mr Bonsu** checks Adwoa at Slessor evening prep. Confirms comfortable, eating, no pain return. SMS to Matron with one-word ack.` |
| iii | `**Thursday 06:30** · morning round` | `Resume hydroxyurea standard dose. **Excused from morning prep run** auto-applied. Adwoa attends morning round herself; if she doesn't appear by 06:35, Sick Bay Prefect **F. Tetteh** sent to Slessor to retrieve.` |
| iv | `**Thursday 14:00** · doctor in-person review` | `**Dr Mensah** on his weekly round. Adwoa added to his list. Quick check, no formal appointment needed. Care plan reviewed if any change warranted.` |
| v | `**Friday afternoon** · close visit` | `If no further incident, close this visit record. Add to chronic register's **visit history**. Generate term-end summary line for parent.` |

**🔴 No follow-up table exists and INCR-26 is migration-free (grep confirmed: no `sickbay_task`/`follow_up`).** The 5-step plan (N28 in the referral map) **cannot** get a table here. **Ruling: render the follow-up plan as matron-authored free text** — one nullable `follow_up_plan text` is already reachable via the referral `return_note` / admission `extension_plan`-style fields, OR defer the structured task list to **INCR-28** and at 26 render the plan as a single prose block the matron types. **Do NOT** build a checkable/scheduled task list (that needs the scheduler B9 does not provide). Also trim the impossible/forward clauses: `Excused from morning prep run auto-applied` (boarding `prep_attendance` not written — the visit-map §9.1 row-2 rule) and `Resume hydroxyurea` (a med schedule = INCR-24, render as matron prose, not a queued dose).

### C3.5 Action bar — verbatim

`.ab-note`: `This record is **not yet closed**. It closes when the 16:00 discharge fires and the follow-up plan completes, or when Mrs Antwi extends admission overnight. Closing creates an immutable audit entry signed by **A. Bediako**.` · `.ab-actions`: `.btn` `Save draft` · `.btn.primary` `Mark for 16:00 reassessment`.

- **`Save draft`** — the comms trail is part of the visit record; a save writes the notification rows + the follow-up prose. Keep as the non-primary save.
- **`Mark for 16:00 reassessment`** — 🔴 this is a **scheduled reminder** (B9). It writes a `sickbay_notification`-style task with `scheduled_for = 16:00` (or a plain visit flag), **rendered as due, not auto-fired** (no cron). Reuse the §5 scheduled-row treatment. Soften the "16:00 discharge *fires*" language — nothing fires; the matron acts at the window.
- The **signed immutable audit entry** = the standard `audit_log` snapshot on close (shipped `lib/db/audit.ts`); `A. Bediako` = the acting user, never a hardcoded name.

---

## 3. 🔴 Console-only SMS presentation (D7) — the omit-not-fake inventory

**D7: Hubtel deferred → the build wires `sendSms()` (console provider), costs nothing, sends nothing real.** `ConsoleSmsProvider.send()` (`lib/sms/index.ts:24`) logs `[sms:console] → {phone}: {body}` and returns `{ok:true, provider:"console", id:"console-{ts}"}` — **there is no delivery receipt, no provider status, no failure callback.** Every surface element that asserts *delivery* is therefore fabricated telemetry. Inventory, element by element, so Claude Code renders the console truthfully — **never a fake "delivered ✓" for a message that was only logged:**

| # | Surface element | Where | What it asserts | INCR-26 render (console-only) |
|---|---|---|---|---|
| **CS-1** | `delivered 06:53` / `delivered 11:01` (`.ct-dur` on SMS) | §C1 rows 2, 5 | a delivery receipt at a timestamp | **Render the SMS as `logged {HH:MM}` / `recorded` from `sent_at`.** Never `delivered {time}` — the console has no receipt. |
| **CS-2** | `delivered at 09:18:47` (`.nr-detail`) | §C3 row 2 | a millisecond delivery receipt | **`SMS logged 09:18`** (the `sent_at`). Drop `delivered`. |
| **CS-3** | `delivered 09:46` (`.nt-meta`) | §C2 row 3 | a delivery timestamp | **`sent 09:46`** or drop the timestamp. |
| **CS-4** | `Delivery rate 85%` stat + `1 fail · retried successfully` | §C2 stat 4 | an aggregate delivery-success metric | **OMIT the tile** — no provider returns success/failure, so the rate is unbacked. Strip drops to 3-up. |
| **CS-5** | The whole failure/retry panel (`undelivered from MTN 06:55 · Auto-retry 07:02 · manual-handling queue`) | §C2 899–905 | a provider failure + auto-retry event | **OMIT entirely** (§C2.5). The console never fails; `retry_of_id` stays unwritten. |
| **CS-6** | `Failed 1` filter pill | §C2 filter | a failed-delivery bucket | **Render `Failed 0` (or omit the pill)** — no failure state exists on console. |
| **CS-7** | `SMS confirm 06:52` / `09:17` / `11:47` (auto-confirm SMS paired with a call) | §C2 rows 1, 2, 5 | an auto-confirmation SMS was delivered | **The confirm SMS is REAL as a *logged send*** (the matron/system composes it, `sendSms()` logs it). Render `SMS logged 06:52`, not `confirm delivered`. |
| **CS-8** | The SMS **body preview** (`.ct-msg` / `.nr-msg` bubbles) | §C1, §C3 | the verbatim message text | **KEEP — this is truthful.** The matron composes/reviews the exact `body`; `sendSms(to, body)` logs precisely that string. The preview of what *would/did* go out is real; only the *delivery status* is fake. |
| **CS-9** | `Send manual` / `Mark for 16:00 reassessment` / any send affordance | §C2, §C3 | pressing sends an SMS | **BUILD the control; it calls `sendSms()` → console.** The row records `sent_at` + `notification_log_id` (best-effort link to the shipped `notification_log`). No cost, no real dispatch. Copy the boarding `exeat-notify` posture verbatim (console-only, idempotent, **never provision `HUBTEL_*`**). |

**The one-line rule for the PR:** *a `sickbay_notification` on a console build has a `sent_at` (it was logged) but no delivery status — render "logged/recorded/queued", never "delivered", and never an aggregate delivery rate.* **Reinstatement of all delivery telemetry is gated on the owner's Hubtel go-live** (a provisioning decision, not an increment) — the same standing owner gate every SMS-touching module carries (boarding INCR-9/10/11). Sarah + Pence hold this; **do not provision `HUBTEL_*` creds.**

---

## 4. 🔴 OUTBOUND vs INBOUND rendering — the direction inventory

The schema's `direction` enum (`OUTBOUND | INBOUND`) drives distinct visuals. Staff-→-parent (OUTBOUND) vs a recorded parent-initiated call/SMS (INBOUND) render as follows:

| Case | `direction` / `channel` / `answered` | §C1 thread render | §C3 log render |
|---|---|---|---|
| **Staff → parent, call answered** | OUTBOUND · CALL · answered=true | `.ct-chan.call-out` **`→` gold solid**; tag `.outbound` gold; `.ct-dur` = `{m}m {s}s` from `call_duration_seconds` | `.nr-channel.phone`; `.nr-detail` = `answered on Nth ring · call duration {m}m {s}s` |
| **Staff → parent, SMS** | OUTBOUND · SMS | `.ct-chan.sms-out` **`S` gold-bg/gold outline**; tag `.outbound`; body in `.ct-msg` bubble; `.ct-dur` = *logged status* (CS-1) | `.nr-channel.sms`; body in `.nr-msg` bubble; `.nr-detail` = `SMS logged {time}` (CS-2) |
| **Staff → parent, call NO ANSWER** | OUTBOUND · CALL · answered=**false** | `.ct-chan.call-fail` **`×` bg/navy-3 dashed**; tag `.failed` `attempted` (grey, dashed); `.ct-dur` = **`{n} rings`** (a no-answer descriptor, not a duration); body in `.ct-msg.fail` (muted) | — (no failed-call row drawn in §05) |
| **Parent → staff, INBOUND call** | INBOUND · CALL · answered=true | `.ct-chan.call-in` **`←` green-bg/green outline**; tag `.inbound` **green** (`Tier 3 · parent-initiated` / `· update`); `.ct-dur` = duration; body = what the parent said (matron-transcribed) | — |
| **Parent → staff, INBOUND SMS** *(unused in demo)* | INBOUND · SMS | `.ct-chan.sms-in` **green dashed** (the declared-but-unused variant, §1.5 no-alpha) | — |

**Rulings:**
- **Direction is the §C1 thread's colour axis** (outbound gold, inbound green, failed grey) — legitimate because tier is constant (all Tier 3) inside one referral thread. Do **not** carry this into §C2 (tier-coloured) — §0.2.
- **The failed call (`answered=false`)** is the model for a no-answer: `×` glyph, `attempted` tag (**not** a tier — a no-answer never reached the parent), `{n} rings` in place of a duration. Store `answered=false`, `call_duration_seconds=null`; render `{n} rings` from a `trigger_label`/note (there is no ring-count column — B17).
- **INBOUND rows are recorded, not captured** — the matron logs a parent call/SMS after the fact (`direction=INBOUND`, `recipient=PARENT`, `created_by_user_id`=the matron). No telephony integration; the parent's words are matron-transcribed prose (R21 recorded-actor idiom).

---

## 5. 🔴 The scheduled cadence (B9) — render-on-read, matron-triggered, no cron

The `.future` timeline row (§C2 row 8) and `Mark for 16:00 reassessment` (§C3.5) are **scheduled notifications** — the shipped column is `scheduled_for` (`timestamptz`). B9 is finally resolved here, the **boarding `exeat-notify` posture:**

- **A future/scheduled notification** = a `sickbay_notification` row with `scheduled_for` set and `sent_at` null. It renders in the timeline **at its scheduled position** with `opacity-70` (`.future`), an `.ago.future` gold-italic `in {duration}` (computed **on-read**, not a ticking clock — `export const dynamic = "force-dynamic"`), and a `Due {HH:MM}` pill (not `Tier N`).
- **Nothing auto-fires.** There is no scheduler/cron in the stack (B9). **Soften every "auto-fire" / "fires" / "scheduled by matron at handoff" phrase** to a matron-driven action: the matron sees the due row and **presses send at the window** (`sendSms()` → console). The `scheduled_for` is a *reminder time*, not a trigger.
- **The per-case cadence** `06:00 · 11:00 · 17:00 · 21:00` (§C2 row 8 meta) is **editorial, NOT a stored schedule** — and it is **NOT the medication-round schedule** (`06:30/12:30/21:00`, R13; referral-map §5 flag carried). It describes *"cadence is per case, not per school"*: the matron creates individual scheduled rows per referral; do **not** build a cadence engine, do **not** seed the four times as rounds. Each scheduled row is its own `sickbay_notification` with its own `scheduled_for`.
- **Sending a scheduled row** sets `sent_at = now`, moves it out of `.future`, and (console-only) logs the SMS. **`Due / queued` filter** = rows with `scheduled_for` set, `sent_at` null.

---

## 6. 🔴 `private_note` (F4) — where the staff-only note renders

- **Render spot:** the **`.ct-note`** element in the §C1 thread — a muted (navy-3, 11px) line **below** the parent-facing `body`, on OUTBOUND/INBOUND **call** rows (§C1 rows 1, 4, 6, 7). It is visually distinct from the parent-facing `body` (the plain call narration) and from the `.ct-msg` SMS bubble (gold-soft/gold left border). It carries the matron's private observations (*"Mother sounded shaken but accepted…"*, *"No further action unless overnight call…"*).
- **Binding:** `sickbay_notification.private_note` (`sickbay.ts:1634`) — `NULL` when absent; the note renders **nothing** when null (no `—`, no placeholder).
- **The boundary (F4 + Sarah gate):** `private_note` is **NEVER parent-facing** (D8 makes this structurally safe — no parent portal reads any sickbay row). Beyond that, **recommend MATRON-only** even within the clinical gate: the HEADMASTER (a Tier-3 digest recipient) reads the parent-facing `body`, not the matron's private annotation — **trim `private_note` from any non-MATRON render server-side** (§1.3, Sarah/Kofi to confirm). The schema deliberately sits `private_note` adjacent to `body` so the boundary is a *render* decision, not a column absence.
- **Not rendered in §C2 or §C3.** The timeline and the §05 log show `body` only; the private note lives in the full thread, where the matron works.

---

## 7. PII-by-proximity / adjacency (Risk 4 — for Sarah)

The three sections are clinical-read gated (§1.3), so within-surface adjacency is acceptable to a `[HEADMASTER, MATRON]` reader. The sharp leaks are the **condition inside a notification body reaching a non-clinical or lower recipient**, and the **reason a tier fired**. Ordered by severity; continues the referral map's A-list (A1–A8).

| # | Adjacency | Where | Ruling |
|---|---|---|---|
| **A9** | **condition named in a parent-facing SMS `body`** | §C1 row 5 (`IV antimalarial` ⇒ malaria); §C3 row 2 (`mild sickle cell pain crisis`) | **The PARENT is the data subject's guardian — entitled to the condition.** BUT the `body` is stored and read by the HEADMASTER in the thread, and could route to a lower channel later. **Ruling:** (a) **auto/system-generated** parent bodies MUST be diagnosis-free — the 06:52 auto-confirm is the model (`referred to Asankrangwa Government Hospital`, no "malaria"); (b) **matron-typed** parent bodies are her clinical judgement, but recommend the diagnosis-light house style (convey the condition **by phone** — the unstored channel — not by SMS). The task's rule *"the parent-facing SMS body must NOT carry a diagnosis"* is satisfied by (a) for every generated body; (b) is a soft guideline the app cannot force. **Kofi/Sarah confirm the template set.** |
| **A10** | 🔴 **condition named in a HOUSEMASTER `body`** | §C3 row 3 (`admitted with SCD pain crisis — mild`) | **The HM body must NOT carry the diagnosis** — the product's non-disclosure copy is *"medical detail withheld"* / *"student under sickbay care"* / *"no medical detail to share"*. The demo row leaks `SCD pain crisis` to the HM. **Trim to the medical-detail-light template** (visit-map Y4/§T1.6 binding: *"anything an HM can see carries name + location, never condition"*). The `Attendance auto-excused` + `Please flag classmates… no medical detail to share` clauses stay; the condition goes. **This is a template rule, not free text, for `recipient=HOUSEMASTER`.** |
| **A11** | **condition in the HEADMASTER/district digest** | §C3 row 4 (`SCD pain crisis · mild`) | The Tier-3 headmaster digest names the condition. Within the clinical gate to the *Headmaster* this is arguably acceptable (he is a clinical-read role, D2) — but the **DISTRICT_HEALTH** recipient (the enum's 4th value, an outbreak/notifiable channel, D9) MUST be condition-light or aggregate. Ruling: headmaster digest may name the condition (gated reader); **any DISTRICT_HEALTH body is aggregate/notifiable-only**, never a named-student diagnosis. |
| **A12** | 🔴 **a pastoral flag *elevating* a tier, shown on a shared screen** | §C2 row 3 (`Tier 1 because of pastoral cross-reference flag on J. Manu's record`) | **Class-6 inferable-by-proximity.** A Tier-1 SMS firing *because of* a pastoral flag re-identifies J. Manu as pastoral/VLC-flagged on the day-view screen. **VLC (4.5) is unbuilt** → **omit the auto-elevation and the "because of pastoral flag" reason string** entirely at 26; the notification renders without exposing *why* the tier fired. (Referral-map A5, actioned here.) |
| **A13** | **student names + conditions on the day-view timeline** | §C2 all rows (`Y. Aidoo · severe malaria referral`, `Adwoa Mensa · SCD mild crisis`) | The timeline is a roll-call of who is unwell today, condition included, on a bench-side screen. **Accept within the gate** (the reader is `[HEADMASTER, MATRON]`) — the timeline is an operational log the matron needs. But it is an independent reason **`Export day` is omitted** (A6): a printed/exported day-list carries every name+condition out of the room. |
| **A14** | **private matron note beside the parent body** | §C1 `.ct-note` | §6 — `private_note` is MATRON-only (recommended), never parent-facing (F4/D8). The note contains the parent's emotional state and the child's — the most sensitive line in the thread. |

**Deliberate non-disclosure copy — preserve VERBATIM (it is the product):** *"Please flag classmates if they ask, no medical detail to share"* · *"Reply CALL to request callback"* · *"medical-detail-light"* · *"he needs to know there's a sickbay event, not the granular vitals"* · *"NHIS card with us"* (the auto-confirm's deliberate diagnosis-free framing).

---

## 8. Data bindings — INCR-26 scope

### 8.1 BACKED (no migration)

| Element | Table / column |
|---|---|
| The notification rows (thread/timeline/log) | **`sickbay_notification`** (shipped, authored in the referral migration) — see 8.2 |
| Parent/guardian identity, relationship, phone, primary | `student_guardian` where `is_primary` (mask phone at display) |
| Housemaster / headmaster identity | `houses.hm_user_id` (derived); the headmaster role |
| The referral / visit the notification hangs off | `sickbay_referral` / `sickbay_visit` (shipped 25/22) via the composite FKs on the notification |
| The SMS send | **`lib/sms/index.ts::sendSms()`** — console provider, no real send (D7); best-effort delivery link → shipped `notification_log` via `notification_log_id` |
| Attendance excuse (cross-link 2) | `attendance_record` (`MEDICAL`/`SICKBAY`, shipped 22b) — a day mark, R30 |
| Chronic register / boarding / billing cross-link targets | shipped 23 / boarding / billing routes |
| Every mutation's audit row | `audit_log` via `lib/db/audit.ts` (snapshot, not patch) |

### 8.2 The shipped `sickbay_notification` — column → surface element

**Migration-free: the table is authored; INCR-26 writes it.** (`db/schema/sickbay.ts:1612–1673`.)

| Column | Type | Feeds |
|---|---|---|
| `tier` | `smallint` `CHECK 1..3` | §C2 `.nt-icon`/`.nt-tier` colour (gold/warn/terra) — **§2: = intensity, not recipient** |
| `channel` | `SMS\|CALL\|IN_APP\|SYSTEM` | `.ct-chan` glyph, `.nr-channel` pill, `.channel` meta |
| `direction` | `OUTBOUND\|INBOUND` | §4 — thread glyph + tag colour |
| `recipient` | `PARENT\|HOUSEMASTER\|HEADMASTER\|DISTRICT_HEALTH` | §C1 filter (`PARENT`), §C3 fan-out; §7 body-template per recipient |
| `trigger_label` | text (free) | `.ct-tag`/`.nt-tier` phrase (`referral`/`auto`/`update`/`admission`/`pastoral`/`discharge`), the `.nt-meta` rule text |
| `body` | text (parent-facing) | `.ct-msg`/`.nr-msg` bubble, call narration — §7 A9/A10 template rules |
| `private_note` | text (🔴 F4, never parent-facing) | `.ct-note` — §6, MATRON-only |
| `answered` | boolean | failed call (`false` → §4 `× / attempted / {n} rings`); HM `acknowledged` (repurposed, B18) |
| `call_duration_seconds` | `smallint` | `.ct-dur` / `.nr-detail` duration (`4m 12s` = 252) |
| `scheduled_for` | `timestamptz` | §5 — the `.future` row, `Due {HH:MM}`, `Due / queued` filter |
| `sent_at` | `timestamptz` | `.ct-time`/`.nt-time`/`.nr-time`; the "logged" status (CS-1/2/3) |
| `notification_log_id` | uuid SET NULL → `notification_log` | best-effort delivery link (real only at Hubtel go-live) |
| `retry_of_id` | uuid RESTRICT self-FK | 🔴 retry chain — **unwritten at 26** (console has no failures, §C2.5) |
| `created_by_user_id` | uuid SET NULL → users | the acting matron |
| `student_id` / `visit_id` / `referral_id` | composite FKs | filters: §C1 by `referral_id`+`recipient=PARENT`, §C3 by `visit_id`, §C2 by date |

### 8.3 NEEDS SCHEMA — none new (N-items continued from the referral map's N32)

**INCR-26 introduces ZERO new NEEDS-SCHEMA items — it is migration-free.** N33 is unused. The two carry-forwards:

| N# | Shape | Status at INCR-26 |
|---|---|---|
| **N26** | `sickbay_notification` (the whole three-tier chain) | **Shipped** (authored in the referral migration). INCR-26 supplies the **write-chain + reads**, no DDL. |
| **N28** | follow-up task (visit/referral · when · owner · text · done) | **Deferred — no table (migration-free).** §C3.4 renders the 5-step plan as **matron free text**; a structured/checkable task list stays **INCR-28**. |

### 8.4 NO CLEAN BINDING (B-items — continued from the module: B1, B9, B14 carried; B15/B16 = visit map; **new: B17, B18**)

| # | Element | Resolution at INCR-26 |
|---|---|---|
| **B9** *(carried, RESOLVED)* | scheduled/future notifications, per-case cadence (`Due 17:00`) | **§5** — `scheduled_for` + render-on-read + **matron-triggered send, no cron** (boarding `exeat-notify` posture). The cadence is per-case editorial, not a stored schedule/round. |
| **B1** *(carried)* | `bed S-12-B` (§C3 cross-link 3) | `boarding_bunk` has no dorm-label axis → **OMIT the dorm fragment** (unchanged). |
| **B17** *(new)* | call **ring count** (`answered on 2nd ring`, `3 rings`) | No ring-count column. `answered` boolean only → render `answered` / `no answer`, or store the descriptor in `trigger_label`. **Do not add a column** for a demo descriptor. |
| **B18** *(new)* | HM/headmaster **acknowledgement + read receipt** (`acknowledged at 09:23`, `HM has read receipt`) | No `acknowledged_at` column. Nearest = `answered` (repurposed for `IN_APP`). Render `notified`/`acknowledged` **without a timestamp**, or omit the ack line — never fabricate a receipt. A real HM ack UI (the *"one-word ack"* of §C3.4 step ii) is INCR-28. |
| **B19** *(new)* | delivery status / provider telemetry | 🔴 **Console-only (D7) → no binding.** `notification_log_id` links a best-effort log row; real delivery status is **Hubtel-go-live** only. §3. |

---

## 9. Write actions (INCR-26 scope)

Continues the referral map's W-sequence (W1–W7); **W8+ here.** All writes: `MATRON` (`SICKBAY_CLINICAL_WRITE_ROLES`); `authorizeWrite()` first statement; `audit_log` snapshot; referral/visit id re-resolved server-side inside `withSchool` (no IDOR).

| # | Action | Surface | Writes | Notes |
|---|---|---|---|---|
| **W8** | Log outbound call | §C1, §C3 | `sickbay_notification` (`OUTBOUND`/`CALL`, `body`, `private_note`, `answered`, `call_duration_seconds`, `tier`, `recipient`, `sent_at`) | the matron records a call outcome; `answered=false` → the failed-call render (§4) |
| **W9** | Send / log outbound SMS | §C1, §C3, §C2 (`Send manual`) | row (`OUTBOUND`/`SMS`, `body`) + **`sendSms()` → console** + `sent_at` + best-effort `notification_log_id` | **console-only (D7); never provision `HUBTEL_*`.** Render `logged`, not `delivered` (§3). Auto-confirm SMS (Tier-3 policy) is the same call, system-composed. |
| **W10** | Log inbound call/SMS | §C1 | row (`INBOUND`, `recipient=PARENT`, matron-transcribed `body`) | recorded after the fact; no telephony capture (R21 idiom) |
| **W11** | Schedule a reminder | §C2 (`.future`), §C3 (`Mark for 16:00 reassessment`) | row with `scheduled_for` set, `sent_at` null | **no cron** — renders as `Due`; the matron sends at the window (§5) |
| **W12** | Send a scheduled reminder | §C2 due row | set `sent_at=now` + `sendSms()` console | moves out of `.future` |
| **W13** | HM / headmaster notify (recipient fan-out) | §C3 rows 3, 4 | rows (`recipient=HOUSEMASTER`/`HEADMASTER`, `channel=IN_APP`/`SYSTEM`, **condition-light `body`** per §7 A10/A11) | the awareness fan-out; **template-enforced diagnosis-light for HM** |
| **W14** | Save follow-up plan | §C3.4 | matron free-text (`follow_up_plan`/`return_note`) | **not** a structured task list (N28 deferred, §C3.4) |
| — | `Export day` / `View retry log` / delivery-rate | §C2 | — | **OMIT** (A13 export; §3 fabricated telemetry) |

**No write provisions Hubtel.** The build is console-only; the owner's SMS go-live is a standing gate (Sarah + Pence). Retry (`retry_of_id`) is **not written** at 26 (no console failures).

---

## 10. Interaction states

| State | §C1 thread | §C2 timeline | §C3 log |
|---|---|---|---|
| **Loading** | skeleton rows at real height (~64px), grid preserved | timeline skeleton at row height (~64px); stats/filter skeletons | 4-row skeleton + xlink/steps skeletons |
| **Empty** | **no notifications yet → "No parent contact recorded yet."** (`text-navy-3 italic`); never a fake row. A referral with no comms is legitimate early. | **no notifications today → "No notifications today."**; stats render `0`; the strip is honest at zero (calm, not broken — the common Mode-C resting state) | **no notifications → the log card renders head + "No notifications logged."**; cross-links + follow-up still render (they are visit facts) |
| **Scheduled only** | — | the `.future` row renders alone with `Due {HH:MM}`; `Due / queued 1`, all others `0` | `Mark for 16:00` pending |
| **Error (write)** | inline under the compose field; the thread does not disappear; toast for action failures | same | same |
| **Console send** | SMS row appears as `logged {time}` immediately (optimistic on `sendSms` `ok:true`); **never `delivered`** | same | same |
| **Populated** | as mapped | as mapped | as mapped |
| **Read-only actor** (HEADMASTER) | thread renders **without `private_note`** (§6); no compose/send controls | renders; no `Send manual` | log/cross-links/follow-up render; no `Save`/`Mark`/send |
| **ADMIN** | refused (server-side, D2) | refused | refused |

**Mode C (REFERRAL_ONLY):** parent notifications are **first-class in C** (R4/R29 — the referral log is the primary sickbay surface for ~49% of schools). §C1/§C2 render identically; the transcriber/sender is the health-focal `MATRON` pointer (E1). §C3 (a visit-record section) renders for any Mode-C visit; the HM/headmaster fan-out still applies.

---

## 11. Fabricated demo content (continued from the visit map's F1–F12; **F13+**)

| F# | Item | Where | Verdict |
|---|---|---|---|
| **F13** | Demo casts & phones — `A. Aidoo` (mother, `+233 24 487 6612`), `K. Boateng Snr` (father), `E. Manu` (grandmother), `M. Mensa`, `Mrs E. Mensa` (`+233 24 567 8901`), `Mr S. Bonsu` (Slessor HM), `Mr P. Asare-Mensah` (Headmaster) | §C1/§C2/§C3 | **Derive** guardians (`student_guardian`), HM (`houses.hm_user_id`), headmaster (role). Never a name/number in code. ⚠️ `Mr S. Bonsu` is the visit-map's 4-Slessor-HM drift (F1) — derive. |
| **F14** | Counter drift — lede `seven times` vs 8 rows (7 fired + 1 future); section-meta `6 sent · 1 due`; `Tier 1 today 3` vs 2 Tier-1 rows; `Tier 2 today 1` vs 2 Tier-2 rows; `7 events` (thread) vs 7 rows; `4 entries` (§05) vs 4 rows | §C1/§C2/§C3 | **Derive every count.** The module's signature defect. |
| **F15** | `J. Manu` (F2 Aggrey) + the **pastoral cross-reference flag** | §C2 rows 3, 6 | A **new demo student** + a VLC/pastoral-flag mechanism (module 4.5, **unbuilt**). Omit the auto-elevation + the reason string (A12). J. Manu himself is just a demo student (derive). |
| **F16** | **Inconsistent fabricated delivery telemetry** — thread says the 06:52 SMS was `delivered 06:53`; the §C2 failure panel says the *same* SMS was `undelivered` from MTN at 06:55, retried 07:02 | §C1 row 2 vs §C2 panel | Neither is real (console, D7). The self-contradiction is proof: **omit all delivery status** (§3). |
| **F17** | `Adwoa Mensa` (SCD anchor) | §C2, §C3 | Seed has **Abena Mensah**, not Adwoa Mensa (referral-map §5 / board Risk 9). Demo-only; recommend renaming the demo to the seeded **Abena Mensah** module-wide. Never hardcode. |
| **F18** | Per-case cadence `06:00 · 11:00 · 17:00 · 21:00` | §C2 row 8 meta | **NOT a stored schedule, NOT the medication rounds** (`06:30/12:30/21:00`, R13). Editorial only — do not seed as rounds/schedule (§5). |
| **F19** | Fabricated timestamps of *delivery/ack* — `delivered at 09:18:47`, `acknowledged at 09:23`, `auto-routed 09:42/09:45` | §C3 rows 2–4 | Delivery/ack timestamps with no backing (console; no ack column, B18). Render `logged {sent_at}`, drop the receipts. |

---

## 12. Cross-module hooks (design commitments — preserve exactly)

- **Sickbay → Comms (the tier engine — BUILT HERE):** every parent notification keys off the setup §05 three-tier policy anchor (frozen constants, R26); the referral is the Tier-3 trigger, a chronic admission the Tier-2, a routine visit the Tier-1. `tier` stores the resolved intensity (§2). Console-only send (D7); scheduled cadence + retry are new (B9 §5 / B19).
- **Sickbay → Attendance (the excuse cross-link):** §C3 cross-link 2 — the day's `MEDICAL`/`SICKBAY` mark (shipped 22b), **re-expressed as a day mark** (`5 periods` is impossible, R30). *"attendance flags 'excused (sickbay)'"* — name + fact, never diagnosis (A7).
- **Sickbay → Boarding (the HM awareness fan-out):** §C3 row 3 + cross-link 3 — the HM notification (`recipient=HOUSEMASTER`) carries **name + location, never condition** (A10, visit-map Y4 binding); the boarding house-roll link is live; `bed S-12-B` omitted (B1). The *"one-word ack"* (step ii) is INCR-28.
- **Sickbay → Chronic register:** §C3 cross-link 1 — live link to the care plan (INCR-23 shipped) + derived crisis counts.
- **Sickbay → VLC (pastoral):** §C2's Tier-1 pastoral elevation — **VLC is module 4.5, unbuilt.** Omit the auto-elevation + reason at 26 (A12); it becomes real when VLC ships.
- **Sickbay → District health (D9):** the `DISTRICT_HEALTH` recipient — a notifiable/outbreak channel, **condition-light/aggregate only** (A11); a printable/console artefact, no integration (D9). Not exercised in these three sections; the enum value is authored for INCR-27's outbreak monitor.
- **Setup §05 → Comms (policy anchor):** the three-tier rule text is the setup surface's frozen policy anchor (R26); every event *"keyed off the setup-page policy anchor"* — the tier is resolved from it, not hand-set.

---

## 13. Responsive / PWA

The referral log's one media query (`max-width:1280px`) collapses the layout grids to single column; the visit record's collapses `.xlink-strip` to 1-col (source CSS 281). Reproduce as Tailwind `lg:` breakpoints:
- **§C1 thread:** the `90px auto 1fr` grid holds on tablet; on phone (<768) the `.ct-time` column narrows and the `.ct-note`/`.ct-msg` wrap full-width. The matron reads/composes the thread bedside and on the phone — **compose + the SMS body preview must survive a phone width** (this is the surface used *while on a call*).
- **§C2 timeline:** the `90px 36px 1fr auto` grid → on phone, the `.nt-tier` pill wraps under the `.nt-line`; stats strip → 2-up. The filter strip wraps (already `flex-wrap`).
- **§C3:** `.xlink-strip` 2-col → **1-col** at ≤1280 (source rule); `.notif-row` `90px 1fr auto` → on phone the `.nr-channel` pill wraps under the body; `.steps-row` `32px 1fr` holds; the `.action-bar` `1fr auto` → stacks (actions full-width, min 44px hit target).
- **PWA:** both routes `export const dynamic = "force-dynamic"` (the `.ago`/`in {duration}` strings are on-read, no ticking client clock — the visit-map B15 rule). No PWA-specific variant is drawn; inherits the app shell. *Skipped: an offline compose queue — add when a matron reports losing a bedside message to dead signal, not before.*

---

## 14. Open questions / drift log

| # | Question | Owner | Blocks |
|---|---|---|---|
| **Q1** | 🔴 **`tier` semantics** — the schema comment (`1 parent · 2 HM · 3 headmaster`) vs the surface (intensity `1 SMS / 2 call+SMS / 3 phone-first`, recipient orthogonal). Recommend tier=intensity, correct the comment (no migration). **The loader shape depends on this.** | Kofi | §2 — the whole tier rendering |
| **Q2** | 🔴 **Console-only delivery presentation** — confirm OMIT the 85% rate, the failure/retry panel, and every `delivered {time}` (render `logged`) until Hubtel go-live. | Owner + Sarah | §3 — the honest-render rule |
| **Q3** | **`private_note` visibility** — MATRON-only (recommended) vs also-HEADMASTER within the thread. | Sarah + Kofi | §6/§1.3 |
| **Q4** | **HM/parent `body` templates** — enforce diagnosis-free for `recipient=HOUSEMASTER` (A10) and for auto-generated parent bodies (A9); matron-typed parent body stays free text. Confirm the template set + the district-health aggregate rule (A11). | Sarah + Kofi | §7 |
| **Q5** | **Follow-up plan** — matron free text at 26 (recommended, migration-free) vs a structured/checkable task list deferred to INCR-28. | Kofi | §C3.4 / N28 |
| **Q6** | **Pastoral tier-1 elevation** (A12) — omit at 26 (recommended; VLC unbuilt) vs stub. Confirm the reason string is never rendered. | Kofi | §C2.4 |
| **Q7** | **Scheduled send** — matron-triggered at the window (recommended, no cron) vs a timed job. Same posture as boarding `exeat-notify`. | Kofi | §5 / B9 |
| **Q8** | **HM ack / read receipt** (B18) — repurpose `answered` for `IN_APP` acknowledgement, or render `notified` without a timestamp. A real ack UI is INCR-28. | Kofi | §C3.2 |
| **Q9** | **AUTHORED copy needing owner sign-off:** `No parent contact recorded yet.` · `No notifications today.` · `No notifications logged.` · `SMS logged {time}` (the console-honest replacement for `delivered`) · `scheduled — matron sends at the window` (the softened auto-fire copy). | Owner | copy review before merge |

**Drift corrections recorded here:**
1. The referral map's §5-preserved thread copy described a `15:25 · Latest` gold-italic row — **the shipped HTML has no such treatment** (row 7 is an ordinary inbound call). This map's §C1 is verbatim from the HTML and supersedes it. (The gold-italic-newest treatment belongs to the *hospital-updates* card, §R2.4, INCR-25.)
2. The `tier` schema comment is the one place the shipped schema and the surface disagree — §2 / Q1.
3. The §03 stats `.s-val gold/warn/terra/green` classes have **no CSS rule** in the surface (render navy) — INCR-26 maps them intentionally to the tier colours (§1.4). Carried from referral-map §1.5, actioned.
