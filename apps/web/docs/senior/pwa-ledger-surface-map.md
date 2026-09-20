# Score Ledger PWA — Phone Form Factor · Surface Map (INCR-4: Score Ledger Item 5)

**Author:** Lucy (design cartographer) · **Status:** design spec, ready for the implementation engineer (Claude Code).
**Scope of this map:** `Surfaces/schoolup-shs-score-ledger-pwa.html` — all four phone-mockup sections: §1 online (Card/Grid view toggle), §2 class-switcher bottom sheet, §3 connection-dropped buffer state, §4 phased-connectivity roadmap panel. This is the **phone reshaping of the existing desktop ledger**, not a new product — the PWA is the regular Omnischools web app surfaced installable on the home screen (same auth, same data, same audit trail), laid out for a phone screen.

**These are phone mockups of a responsive web app, not a native app.** Map every screen as a **responsive state of the existing ledger** (`SeniorLedgerGrid` + the `/senior/score-ledger` route), not as a separate mobile codebase. Where surface and spec disagree: **INCR-4 rulings / Kofi win on logic and copy honesty; the surface wins on visual presentation** — every drift is called out inline and collected in the drift log (§10). States key to the **INCR-4 "Done when" criteria** and the **seven open questions (Q1–Q7)** + **risk flags (R1–R5)** in `senior-build-plan.md`.

**BINDING RULE, flagged on every copy string in this map (R1 · Kofi):** the product promise is **"works on your phone, handles bad connections."** It is **never "works offline."** A pending buffered score must **never** render as "saved." Every copy string is audited for this in §7.

---

## Source + reuse

| File | Role |
|---|---|
| `Surfaces/schoolup-shs-score-ledger-pwa.html` | **PRIMARY visual source.** §1 online lines 764–953; §2 class switcher 955–1067; §3 connection-dropped 1070–1167; §4 roadmap 1169–1257. PWA CSS lines 336–749. |
| `omnischools/components/senior/senior-ledger-grid.tsx` | **The grid to reshape.** `SeniorLedgerGrid` (`LedgerRow`, `CATS`, `catValue`, `total`/`provisionalTotal`, `save()`). Card view **and** Grid view are the same five-category data this component already holds — reshape it responsively; do **not** invent a new grid or a second data model. |
| `omnischools/app/(app)/senior/score-ledger/page.tsx` | The host route. Reuses `requireSchoolRole(SENIOR_LEDGER_ROLES)`, `withSchool()`, `resolveWeights`, `force-dynamic`, the class×subject×period query-param mechanism, the completion-summary + STPSHS-ready idiom. The PWA is this same route responsive-down; the bottom sheet reads the teacher's classes. |
| `omnischools/components/senior/path-chooser.tsx` | Unchanged by Item 5 — Path A/B/C selection is the same. The PWA is built for **Path C direct entry** (page-header lede) but renders whatever path the context holds. |
| `omnischools/docs/senior-build-plan.md` **INCR-4** | Behavioural source of truth: Goal / Done-when / architecture crux (buffer wraps the save actions client-side), Q1–Q7, R1–R5. This map's states cite it. |
| `omnischools/docs/senior/path-b-scan-surface-map.md` | Format precedent (this map follows its shape). Confirms **the scan/OCR/diff flow has no PWA variant** — the PWA is card/grid + switcher + buffer only. |
| `md files/design-tokens.json` v1.0.0 | Canonical token names (§0 below). |

**Architecture crux (from INCR-4 — the one thing that shapes the whole build):** the pending buffer is a **client-side wrapper around the existing `saveDirectLedgerScores` / `savePortfolioScores` server actions** (React state + `online`-event retry). It is **not** a service-worker Background Sync queue (RSC action POSTs don't replay cleanly through the SW). No new schema: class list from `senior_subject_teacher`, chevron status from `ref_anomaly_rule`, view-preference + buffer in `localStorage`.

---

## 0. Tokens used across the PWA surface

Use the **Tailwind token class**, never inline `var(--x)` in JSX (the surface is hand-written HTML with `var(--x)`; translate each to the class of the same token). Every tint below is a **solid `-bg` token** — see the token-opacity trap note at the end of this section.

| Surface `var(--x)` | Hex | Tailwind class | Where it is used in the PWA |
|---|---|---|---|
| `--navy` | `#1A2B47` | `text-navy` / `bg-navy` / `border-navy` | primary text; `pwa-header` bg; view-toggle **active** bg; grid `thead` bg; ledger totals; dim-overlay base |
| `--navy-2` | `#2D3F5C` | `text-navy-2` | `pcr-label`, grid `td` scores, class-option meta bold, roadmap card body |
| `--navy-3` | `#5C6675` | `text-navy-3` | `pc-meta`, `psc-ref`, weights, captions, bottom-tab idle, sheet title, roadmap Phase 2/3 eyebrow |
| `--gold` | `#C8975B` | `text-gold` / `bg-gold` / `border-gold` | brand-mark + avatar bg; italic accents; **chevron**; view active glyph; **offline sync-strip** text; **pending-sync input border**; grid `Wt` header + `gc-wt`; active tab; "current" pill bg |
| `--gold-soft` | `#E8D4B8` | `border-gold-soft` | `filledPortfolio` input border (existing grid) |
| `--gold-bg` | `#F5EBDC` | `bg-gold-bg` | **`1 of N` pill bg**; **offline sync-strip bg**; **`pending-sync` input bg**; **`gc-score.pending` cell bg**; active class-option bg; "held locally" badge bg; roadmap Phase-1 card bg |
| `--bg` | `#FAF7F2` | `bg-bg` | phone screen; `pwa-body`; view-toggle track; bottom-tab icon; grid-foot; class-option default bg |
| `--surface` | `#FFFFFF` | `bg-surface` | `pwa-context`; student cards; bottombar; grid-wrap; bottom sheet |
| `--green` / `--green-bg` | `#2F6B47` / `#E5EFE8` | `text-green` / `bg-green-bg` | **online sync-strip** (text + bg); sync-dot; "ready" class-option pill; Phase-1 eyebrow text |
| `--warn` / `--warn-bg` | `#C58A2E` / `#F5E9D0` | `text-warn` / `bg-warn-bg` | **"behind" class-option pill**; chevron warn-dot (deferred anomaly status, §2.6) |
| `--terra` / `--terra-bg` | `#B84A39` / `#F5E1DC` | `text-terra` / `bg-terra-bg` | over-100 cell (inherited from grid; not shown on these mockups) |
| `--border` | `#E5DFD3` | `border-border` | card/context/sheet dividers, grid row lines |
| `--border-2` | `#D4CCBA` | `border-border-2` | input borders (idle), sheet handle, **empty/`—` cell colour** |

**Non-token bezel colour (mock-only, do not port):** `#0F1B30` (`.phone-frame` / `.phone-notch`) and `#232f47` (bezel ring) are **device-chrome for the mockup image only** — they are not app tokens and never appear in the running PWA (the phone frame is the user's actual device). The status bar (time / signal / battery) is **OS chrome, also not built.**

**Type:** `font-display` = Fraunces (class name `pc-class`, `ptr-val` total, roadmap titles, brand text, `gc-wt`, `pco-name`, tab icons); `font-body` = Manrope (all body, student names, labels, pills, tab labels); `font-mono` = JetBrains Mono (all scores, `psc-ref`/`gc-ref`, chevron glyph, `pcr-weight`). **Empty/missing score = em-dash `—`** in `text-border-2` — never `0`/`N/A`/`null` (`design-tokens.json._conventions.empty-cells`).

> **Token-opacity trap — verify tints in the live preview, not the build (memory `no-alpha-token-opacity`).** Every functional tint on this surface is a **solid `-bg` token**: `bg-gold-bg` (pending inputs, pending cells, offline strip, `1 of N` pill), `bg-green-bg` (online strip), `bg-warn-bg` ("behind" pill). **Never** express these as slash-opacity on a raw-hex token — `bg-gold/20`, `bg-navy/45`, `text-gold/70` **silently break** on the raw-hex token set. The surface's decorative rgba() washes — `pwa-header` border `rgba(200,151,91,0.2)`, `gc-wt` bg `rgba(200,151,91,0.06)`, `pwa-dim-overlay` `rgba(26,43,71,0.45)` — are **not** slash-opacity candidates: render them with `opacity-N` on a solid element, an arbitrary rgba value class (`bg-[rgba(26,43,71,0.45)]`), or a dedicated overlay token. The **pending-sync input tint (`bg-gold-bg`) is the single highest-risk element** — it is the load-bearing "this score is not saved yet" signal, so it must be a real solid tint, verified visible in the live preview before merge.

---

## Region order — every screen, top to bottom

All four screens share the same vertical phone chrome. From the top:

1. **`.phone-statusbar`** — OS chrome (time · signal · battery). **Not built** (real device draws it).
2. **`.pwa-header`** (`bg-navy`) — brand mark `O` + `Omnischools` (Fraunces italic) · avatar `KO`.
3. **`.pwa-context`** — the **active class**, with the **chevron + `1 of N` pill** (the class switcher trigger). Suppressed to a plain label on §4 (roadmap) and for single-class teachers.
4. **`.pwa-sync-strip`** — the trust surface. Green (synced) or gold (`.offline`, connection dropped). **Always visible.** Absent on §4.
5. **`.pwa-view-toggle`** — the Card / Grid pill. Absent on §4.
6. **`.pwa-body`** (scroll region) — Card stack **or** Grid table **or** roadmap cards.
7. **`.pwa-bottombar`** — four-tab phone nav: **Today · Classes · Ledger · More**. Replaces the desktop sidebar.

**Bottom sheet + dim overlay (§2 only)** are positioned `absolute` inside `.phone-screen`, `z-index` above the body.

### Shared chrome — copy + tokens (identical on §1/§2/§3; note §4 deltas)

| Element | Copy (verbatim) | Tokens / type |
|---|---|---|
| `pwa-header` brand mark | `O` | `bg-gold text-navy` 26px `rounded-[7px]` Fraunces italic 600 13px |
| `pwa-header` brand text | `Omnischools` | Fraunces italic 600 14px, `text-bg` |
| `pwa-header` avatar | `KO` | `bg-gold text-navy` 30px `rounded-full` Manrope 700 11px |
| `pwa-context` class | `Form 2 Science · ` + `<em>Maths</em>` + chevron `▾` + pill `1 of 2` | `pc-class` Fraunces 600 18px `text-navy`; `em` italic `text-gold`; chevron `pc-chevron` mono `text-gold` 14px; pill below |
| `pwa-context` meta | `Semester 2 · 2025/26 · 37 students` | `text-navy-3` 11px |
| `pc-class-count` pill | `1 of 2` | `bg-gold-bg text-navy` Manrope 700 9px uppercase `tracking-[0.04em]` `rounded-full` px-[7px] py-[2px] |
| bottombar tabs | `Today` · `Classes` · `Ledger` · `More` (icons `T`/`C`/`L`/`M`) | `pwa-tab` Manrope 600 9.5px `text-navy-3`; **active** `text-gold` + `pt-icon` `bg-gold text-navy`; idle `pt-icon` `bg-bg text-navy` Fraunces italic 11px |

- **Active bottom tab** is `Ledger` on §1/§2/§3. On §4 it is `More` (the roadmap is a documentation/settings-adjacent screen — see §6, it is **not a shippable app screen**).
- **`KO` / `Mr. K. Owusu`** is the same teacher identity as the desktop ledger sidebar footer (`page.tsx` shell); reuse the session user, don't hard-code.
- The **statusbar time drifts per screen** to tell the mini-story: `10:42` (§1 online), `10:43` (§2 switch), `10:47` (§3 drop), `10:42` (§4). Illustrative only — not built.

---

## 1. §1 — Online · Card view + Grid view + the toggle pill

Two phones side by side: **left = Card view (default), right = Grid view.** Same class, same sync state, same five-category data — only the layout differs. The toggle pill switches between them in one tap; the switch is **non-destructive** and the choice **persists per (teacher × subject × class × semester)** in `localStorage` (Q5).

### 1.1 The view-toggle pill (`.pwa-view-toggle`)

A two-segment segmented control directly under the sync strip, `margin: 12px 14px 0`.

| Segment | Copy | Glyph | State tokens |
|---|---|---|---|
| Card | `Card` | `▤` (Fraunces italic) | **active** `bg-navy text-bg`; idle `text-navy-3` |
| Grid | `Grid` | `▦` (Fraunces italic) | **active** `bg-navy text-bg`; idle `text-navy-3` |

Track: `bg-bg border border-border rounded-md p-[3px]`. Each `vt-btn` `flex-1` centred, Manrope 600 11px `tracking-[0.04em]`, `rounded-sm`.

- **Default is Card on first use of a (class×subject×semester); once the teacher chooses Grid, that choice sticks** for that context across sessions (Q5, `localStorage` key per teacher×subject×class×semester — no schema). A teacher who prefers Grid on a 37-roster is not pushed back to Card tomorrow (notes §1).
- The glyphs `▤`/`▦` are Unicode box glyphs rendered in Fraunces italic — **not icon-font/SVG.** Keep them as text glyphs (brand is text-forward; no icon substitution without checking).

### 1.2 Card view (`.pwa-body` → stack of `.pwa-student-card`)

One student per card; the body scrolls vertically through the roster; caption: **"Card view · one student at a time · swipe between students within the class."** ("swipe between students" is the intended gesture — Card is the marking shape: enter as you mark, with the visual confirmation this row is for *this* student.)

Per-card structure and the two demo cards verbatim:

| Card element | Card 1 | Card 2 | Tokens / type |
|---|---|---|---|
| `psc-name` | `Abena Mensah` | `Akwasi Boateng` | Manrope 700 14px `text-navy` |
| `psc-ref` | `REF-2024-0142 · 14 of 37` | `REF-2024-0143 · 15 of 37` | mono 9.5px `text-navy-3` `tracking-[0.04em]` |
| Assignments `15%` | `72` | `65` | label `pcr-label` 11.5px `text-navy-2`; weight `pcr-weight` mono 9.5px `text-navy-3`; input below |
| Mid-sem exam `15%` | `68` | `71` | " |
| End-of-sem `40%` | `81` | `69` | " |
| Project work `15%` | `75` | `80` | " |
| Portfolio `15%` | *(empty)* placeholder `—` | *(empty)* placeholder `—` | `pwa-input.empty` `text-border-2` |
| `ptr-label` | `Weighted total` | `Weighted total` | 10.5px uppercase `text-navy-3` 700 |
| `ptr-val` | `76.1` + `+ portfolio` | `70.6` + `+ portfolio` | total Fraunces 600 22px `text-navy` (`em` italic `text-gold`); suffix 11px `text-navy-3` |

- **`.pwa-cat-row`** = `grid-cols-[1fr_70px]`, label left, input right (70px fixed, large touch target).
- **`.pwa-input`** = `w-full py-2 px-2.5` mono 700 13px **center**, `border-[1.5px] border-border-2 rounded-[7px] text-navy bg-surface`; **focus** `border-gold bg-gold-bg`; `.empty` renders `text-border-2` with placeholder `—`. These map to the existing grid's `plainInput` / `emptyInput` / `filledPortfolio` classes — same tokens, **restyled larger for touch** (existing grid input is `w-16 py-1.5`; phone input is full-width `py-2`, min ~44px tap target).
- **`+ portfolio` suffix is a card-view-only provisional marker.** It signals the weighted total is provisional because portfolio is still blank — this maps to `total()`/`provisionalTotal` in `SeniorLedgerGrid` (`anyPresent` true, portfolio null). **Grid view omits the suffix** (compact). Implementer: show `+ portfolio` when the total is provisional (≥1 but <5 categories present) in Card view; drift from the existing grid, which shows the bare number — see §10.4.
- **Category labels drift slightly from `CATS`:** the card uses `Mid-sem exam` / `Project work`; the existing `CATS` labels are `Mid-sem` / `Project`. Card view has room for the fuller labels — adopt them for Card; keep the short forms for the space-constrained Grid header (§1.3). See §10.5.
- **Weights `15/15/40/15/15` are illustrative.** Real weights come from `resolveWeights(subject → school default → system)` (`page.tsx`). Render `weights[c.key]%`, never hard-code.
- **`REF-2024-0142` is the Assessment Reference ID** and "rides along on every card and every row" (notes §1) — the same ID shows in Card, Grid, desktop ledger, and STPSHS export. Reuse the existing `LedgerRow.code` (`students.studentCode`); the `REF-2024-XXXX` format is illustrative — see §10.6.
- **`14 of 37` is the card position indicator** (student N of roster total) — Card-view-only navigation affordance, not present in Grid. New for the phone.

### 1.3 Grid view (`.pwa-grid-wrap` → `.pwa-grid-table`)

The whole class as a **compact table** — the shape for scanning, spotting outliers, final review before STPSHS export. Caption: **"Grid view · whole class at a glance · scroll for more rows, tap any cell to edit."** This is the existing `SeniorLedgerGrid` reshaped to phone width: **three-letter category headers**, `sticky` navy header, sticky-left student column, vertical scroll for rows.

**Header row** (`thead` `bg-navy text-bg`, Manrope 700 9px uppercase; each header has a mono weight sub-line):

| `Student` | `Asg` `15` | `Mid` `15` | `End` `40` | `Pro` `15` | `Por` `15` | `Wt` `total` |
|---|---|---|---|---|---|---|
| left, 28% width, sticky-left | | | | | | **`bg-gold text-navy`**, 17% |

**Body rows** (8 of 37 shown — `td` mono 12px `text-navy-2` center; `gc-student` Manrope 600 11px `text-navy` left; `gc-ref` mono 8.5px `text-navy-3`):

| Student | Asg | Mid | End | Pro | Por | Wt total |
|---|---|---|---|---|---|---|
| Abena M. `0142` | 72 | 68 | 81 | 75 | `—` | 76.1 |
| Akwasi B. `0143` | 65 | 71 | 69 | 80 | `—` | 70.6 |
| Ama A. `0144` | 88 | 85 | 89 | 92 | `—` | 88.6 |
| Daniel O. `0145` | 58 | 62 | 55 | 66 | `—` | 58.7 |
| Efua A. `0146` | 79 | 74 | 82 | 78 | `—` | 79.4 |
| Emmanuel T. `0147` | 71 | 69 | 73 | 70 | `—` | 71.4 |
| Esi C. `0148` | 84 | 88 | 86 | 90 | `—` | 86.7 |
| Kojo M. `0149` | 62 | 58 | 64 | 61 | `—` | 62.1 |

- **Names abbreviate to `First L.`** in Grid (`Abena M.`) to fit width; **the ref number shortens to the tail `0142`.** Card view uses the full name + full `REF-2024-0142`. Same underlying `LedgerRow` — presentation only.
- **Empty portfolio = `—`** (`gc-score.empty` `text-navy-3 opacity-50`). Note this uses `opacity-50` on a solid colour, **not** slash-opacity on a token — acceptable (§0 trap note).
- **`Wt total` column IS present here** (unlike the scan grid, which omits it — cf. path-b map §2.2). The phone Grid keeps the weighted total, matching the desktop `SeniorLedgerGrid`. Values are provisional (portfolio blank) but shown as the bare number, **no `+ portfolio` suffix** (space).
- **`gc-wt` cell:** Fraunces italic 600 14px `text-gold` on a `rgba(200,151,91,0.06)` wash. Render the wash as an arbitrary rgba value or a faint `bg-gold-bg`, not `bg-gold/6`.
- **`.pwa-grid-foot`** (`bg-bg`): left `gf-page` = **"8 of 37 · scroll for more"** (Manrope 600); right `gf-hint` = **"tap any cell to edit"** (Fraunces italic 10px). "scroll for more" is **vertical** (more rows), and "tap any cell to edit" means Grid cells are editable in place — same read/write as Card.
- **Both views read and write the same data; switching is non-destructive** — a score typed in Card appears in Grid and vice versa (they are two renders of the same `cells` state in the reshaped `SeniorLedgerGrid`).

### 1.4 §1 design intent (notes panel — verbatim load-bearing points)

- The PWA **is** the web app on the home screen: same authentication, data, audit trail; **no separate "mobile app" with its own state to sync.** A score entered on the phone appears immediately in the web app and vice versa — the discipline a PWA gives that a native app does not. (Applies to **synced** scores only — a pending buffered score is device-local until server-confirmed, Q7 / §3.)
- Two view modes, one toggle pill, one tap; **switching is non-destructive**; last choice persists per (subject × class × semester).
- The **class chevron beside the class name is the switch between classes** — almost no teacher teaches one class (§2).
- The **green sync strip is the trust surface** — always visible, not tucked into settings; green = server-confirmed + last-synced timestamp.
- The **Assessment Reference ID rides along** on every card and row — "the phone is not a different system; it is the same record displayed differently."

---

## 2. §2 — Class-switcher bottom sheet

Trigger: **tap the chevron beside the class name.** The body dims, a bottom sheet slides up listing every class the teacher teaches this semester. Caption: **"Tap the chevron beside the class name · the bottom sheet slides up · tap a class to switch · the ledger reloads with that class's roster, scores, and progress."**

### 2.1 The trigger (`.pwa-context.tappable`)

- The whole context block is tappable. Affordances: **chevron `▾`** (`pc-chevron` mono `text-gold` 14px) + **`1 of 2` pill** (`bg-gold-bg text-navy`). Both sit inline after `Maths`.
- **`1 of N` pill** states the count of the teacher's classes for this subject/semester. Mr. Owusu → `1 of 2`. An English teacher across forms → `1 of 5` etc.
- **Single-class suppression (Q6 / Done-when):** a teacher with exactly one class sees **no chevron and no pill** — a plain class label. The affordance is suppressed when it isn't useful ("so the UI doesn't tell first-year teachers their single class is one of one").

### 2.2 Dimmed body behind the sheet

- The `.pwa-body` behind renders `filter: blur(0.5px); opacity: 0.5` (shows a partial Abena Mensah card — first three category rows). Implementer: keep the ledger mounted underneath (state preserved), apply a blur/dim, and layer:
- **`.pwa-dim-overlay`** = full-screen `rgba(26,43,71,0.45)` (navy at 45%), `z-index: 5`. **Render as arbitrary rgba (`bg-[rgba(26,43,71,0.45)]`) or `opacity` on a solid navy panel — NOT `bg-navy/45`** (§0 trap). Tapping the overlay dismisses the sheet (standard bottom-sheet behaviour — implied, add it).

### 2.3 The sheet (`.pwa-bottom-sheet`)

`bg-surface`, top corners `rounded-t-[18px]`, `shadow` above, `z-index: 10`, `max-height: 78%`, `overflow: hidden`.

| Element | Copy (verbatim) | Tokens / type |
|---|---|---|
| `pwa-bs-handle` | *(drag handle, no copy)* | `bg-border-2` 38×4 `rounded-sm` centred |
| `pwa-bs-title` | `Switch class · Mr. K. Owusu · Semester 2` | Manrope 700 10px uppercase `tracking-[0.14em]` `text-navy-3` |

**Class options** (`.pwa-class-option` — `flex gap-2.5 p-3 rounded-[10px] border`; default `bg-bg border-border`; **active** `bg-gold-bg border-gold`):

| # | `pco-name` | `pco-meta` | `pco-status` pill |
|---|---|---|---|
| 1 (active) | `Form 2 Science · ` `<em>Maths</em>` | `37 students · Path A · 4 of 5 categories · portfolio pending · STPSHS in 17 days` | `current` — `bg-gold text-navy` |
| 2 | `Form 2 General · ` `<em>Maths</em>` | `29 students · Path A · 4 of 5 categories · portfolio pending · STPSHS in 17 days` | `behind` — `bg-warn-bg text-warn` |

- `pco-name` Fraunces 600 13px `text-navy`, `em` italic `text-gold`. `pco-meta` 9.5px `text-navy-3`. `pco-status` Manrope 700 9px uppercase `tracking-[0.06em]` `rounded-full` px-[9px] py-1.
- **Per-class row content = name · student count · path used (A/B/C) · completion across the five categories · STPSHS-readiness.** All of it is available from existing data: class list from `senior_subject_teacher`; count from roster; path from `seniorLedgerPath`; completion from the same `count()` idiom `page.tsx` already computes (`4 of 5 categories`, `portfolio pending`); STPSHS window from the academic period. **No new schema** (crux).
- **Status pill vocabulary:** `current` (gold, the active class) · `ready` (`bg-green-bg text-green`, STPSHS-ready — CSS defines `.pco-status.ready` though not shown in the two demo rows) · `behind` (`bg-warn-bg text-warn`, incomplete near a deadline). Reuse the same readiness predicate as the desktop STPSHS-ready card (`rosterQualifies`).

### 2.4 Switch behaviour

- **Current class is highlighted AND is the default on open** (notes §2): opening the PWA fresh lands on the **last-touched class** — not first-alphabetical, not a "pick a class" interstitial. "Switching is the deliberate action; staying put is the default." Persist last-active class in `localStorage`.
- **Tapping an option:** sheet dismisses; the ledger view (**Card or Grid, whichever the teacher last used** — §1.1 persistence) reloads with the new class's roster, scores, progress. **Two taps end to end** (chevron → class).
- **Switching is non-destructive (Q1 / Done-when):** pending unsaved scores **stay buffered in the local queue**, sync resumes, the new class loads on top; the audit trail records the switch (who viewed which class, when — same as every class-context action); the prior class's working state (incl. cursor position) is preserved on switch-back.

### 2.5 §2 design intent (notes — load-bearing)

- Chevron + `1 of N` pill = the switch; single-class teacher sees no chevron.
- Bottom sheet lists every class this semester with path + completion + count + STPSHS pill; two taps.
- Current class highlighted + default route on open (land back in the marking, not a nav step).
- Non-destructive: buffered scores stay, sync resumes, cursor preserved, switch audited.
- **Same affordance on desktop:** the chevron becomes a **horizontal class-tab list above the grid** (each tab = class name · count · path · completion indicator; tap to switch, grid reloads). Same conceptual model across form factors.

### 2.6 Chevron anomaly status — DEFERRED (Q6 / R5 · scope-creep guard)

The notes describe a richer chevron: **gold** when an STPSHS deadline is <7 days out, and a **warn-dot** when the teacher has been inactive >14 days — "the same anomaly-rule infrastructure the Vice Headmaster's progress view uses" (`ref_anomaly_rule`). **INCR-4 Q6 rules this deferrable and R5 flags it as the balloon risk.** Ship for Item 5: **plain chevron + `1 of N` pill + bottom sheet only.** Defer the gold-chevron / warn-dot anomaly status with the rest of the VHM anomaly surfacing unless it lands cheaply. Map it here so the hook is preserved (§8 cross-module), but build the plain version. See §10.7.

---

## 3. §3 — Connection dropped · the buffer holds, the strip says so

Same Card screen, mid-entry, when the connection drops. Statusbar signal dims (`opacity: 0.25` — weak/no signal). The sync strip turns **gold** and names exactly what happened; the entered-but-unsynced scores are **pending-tinted**; a badge on the card confirms the count. Caption: **"Connection drops mid-entry · the buffer holds three pending scores · the strip and the input tint both say so plainly."**

### 3.1 The gold sync strip (`.pwa-sync-strip.offline`) — copy VERBATIM

> **`Connection lost · 3 scores held locally, will sync when reconnected`**

- Tokens: `bg-gold-bg text-gold` (was `bg-green-bg text-green` online), 11px 600; `sync-dot` `bg-gold` (was `bg-green`). Border `rgba(200,151,91,0.25)` → render solid `border-gold-soft` or `opacity`, not slash.
- **Online-state strip copy (for the transition back, §3.4), verbatim:** `All scores synced · last 2 minutes ago` (`bg-green-bg text-green`, green dot).
- **MARKETING-HONESTY FLAG (R1):** the strip says **"Connection lost … held locally, will sync when reconnected"** — it does **not** say "offline mode," is **not** a silent failure, and is **not** an optimistic "everything is fine." The count (`3`) is dynamic (buffer size). This copy is honest — it promises a **retry on reconnect**, not offline operation. Do not soften "Connection lost" to "Offline" — see §7.

### 3.2 Pending-tinted inputs (`.pwa-input.pending-sync`)

The demo card is **Ama Asante** (`REF-2024-0144 · 16 of 37`):

| Category | Value | State |
|---|---|---|
| Assignments 15% | `88` | **pending-sync** (`bg-gold-bg border-gold`) |
| Mid-sem exam 15% | `85` | **pending-sync** |
| End-of-sem 40% | `89` | **pending-sync** |
| Project work 15% | `92` | **normal** (already synced before the drop) |
| Portfolio 15% | *(empty)* `—` | empty |
| Weighted total | `88.6` `+ portfolio` | provisional |

- **`.pwa-input.pending-sync` = `bg-gold-bg border-gold`** — the three scores entered while disconnected. This is the **highest-risk token in the map**: it is the "not saved yet" signal. **Must be a solid `bg-gold-bg` tint, verified in the live preview** (§0 trap). A pending score must be visually unmistakable from a confirmed one (R4).
- **Project work `92` is NOT pending** — it was synced before the drop. The tint is **per-cell / per-score**, keyed to the buffer entry, not the whole card. Only cells the teacher touched while disconnected are gold.
- **Grid-view equivalent:** `gc-score.pending` = `bg-gold-bg text-navy font-semibold` (defined in CSS, same tint) — pending cells tint gold in Grid view too.

### 3.3 The card-level "held locally" badge

Inline strip at the bottom of the card, `bg-gold-bg rounded-[7px]`, gold dot + copy (verbatim):

> **`3 scores on this card are held locally · will save when connection returns`**

10.5px `text-navy-2`. Confirms the count per card. **MARKETING-HONESTY FLAG (R1):** "held locally · will save when connection returns" — honest, promises retry, not offline. Both this badge and the strip carry the same dynamic count.

### 3.4 Transition back on reconnect (spec-added — behaviour, not a separate mockup)

The surface pictures the dropped state only; the **return transition is required behaviour** (Done-when: "auto-sync on reconnect with no lost work and no false 'saved' state"):

1. On the `online` event, the buffer **replays the wrapped `saveDirectLedgerScores` / `savePortfolioScores` calls** (crux — client-side retry, not SW Background Sync).
2. On each server-confirmed write, the corresponding input **drops the `pending-sync` tint** (gold → normal); the badge count decrements; when the buffer empties, the strip flips **gold → green** with `All scores synced · last <n> minutes ago`.
3. **Pending stays visibly pending until the server confirms (R4 / Q7).** A score must **never** show as saved before the write returns, and a reload/app-close must **never** silently drop the buffer misread as saved. (Buffer persistence boundary — Q1: `localStorage` if it must survive a tab reload, in-memory React state if only a network drop with the tab open. Kofi's ruling on Q1 sets which; either way **no IndexedDB** — that is Item 9.)
4. If a retry **fails**, hold the score pending and keep retrying — never surface a false success, never silently drop (R4). Buffer cap is Q3 (on overflow: block entry or warn-and-keep — must not silently drop); the surface shows `3` held.

### 3.5 §3 design intent (notes — load-bearing)

- The strip turns gold and states exactly what happened — not vague, not silent, not optimistic.
- Pending inputs are **tinted, not hidden**; the teacher keeps entering, sees totals computed locally, trusts the buffer, but never mistakes pending for confirmed.
- The buffer is **small and short-lived in v1**: covers a connection drop of **a few minutes** (signal fading briefly), **not** an hour disconnected — that is Phase 2.
- **"works on your phone, handles bad connections" tells the truth; "works offline" implies extended offline v1 does not commit to — and that gap is where angry users come from.**
- **Pre-cached student rosters mean the page loads without signal** (Q2: SW caches app-shell + the **current** class×subject×semester ledger only — no historical semesters). The teacher can open the PWA, see the cards, start typing without a connection; sync happens when connectivity returns.

---

## 4. §4 — Phased-connectivity roadmap panel

Three stacked cards inside a phone frame, most-to-least prominent, naming what ships in v1 vs what is deferred. Context header is **not tappable** (`pc-class` = `Three` `<em>phases.</em>`, `pc-meta` = `Connectivity roadmap · scoped honestly`) — no chevron, no sync strip, no view toggle. Bottom tab **`More`** active. Caption: **"The marketing line is 'works on your phone, handles bad connections.' Not 'works offline.'"**

**This panel is a scope-boundary explainer for the design record — it is NOT a shippable app screen.** It documents the connectivity roadmap so the implementer builds Phase 1 and stops. Do **not** build a "roadmap" surface into the PWA (§10.1).

Roadmap card copy — **VERBATIM** (each: eyebrow · Fraunces title · body):

**Phase 1 card** (`bg-gold-bg` gradient, `border-gold` — the shipping one):
- Eyebrow (`text-green` 9px uppercase 700): `Phase 1 · ships with v1`
- Title (Fraunces 600 17px `text-navy`): `Works on your phone · handles bad connections`
- Body (11px `text-navy-2`): `PWA installable from the browser. Pre-caches the current class roster. Buffers a few minutes of pending scores when signal drops. Sync indicator is always visible. No extended offline sessions. No conflict resolution.`

**Phase 2 card** (`opacity: 0.65`, deferred):
- Eyebrow (`text-navy-3`): `Phase 2 · later · trigger = real demand`
- Title: `Extended offline sessions · single device`
- Body: `Local IndexedDB store. A teacher can enter scores for a full class with no connectivity and sync when it returns. Still single-device — no multi-device conflict logic.`

**Phase 3 card** (`opacity: 0.55`, hypothetical):
- Eyebrow (`text-navy-3`): `Phase 3 · later still · if needed`
- Title: `Multi-device with conflict resolution`
- Body: `Full offline-first. Conflict resolution when two devices edit the same cell offline. Last-write-wins rules, recovery from conflicts. Built only if real evidence shows the multi-device case matters.`

**Mapping to INCR-4 scope:** Phase 1 = **Item 5, this build.** Phase 2 (IndexedDB extended-offline, single device) = **Item 9 — out of scope.** Phase 3 (multi-device conflict resolution) = **Item 10 — out of scope.** The three cards are exactly the Item-5/9/10 boundary.

**MARKETING-HONESTY FLAG (R1) — the whole panel is the honesty artifact.** The caption is the binding line: **"works on your phone, handles bad connections," not "works offline."** Every marketing/UX string in the product must obey it (§7). Note the CSS also carries an unused `.connectivity-rail` / `.conn-card` block (lines 467–475) with a `· ships with v1` pseudo-element — **vestigial; not rendered.** The roadmap ships as the three phone cards above, not the rail.

### 4.1 §4 design intent (notes — load-bearing)

- Phase 1 ships first and delivers most of the practical value (teacher at home/staff-room/desk with intermittent connectivity).
- Phase 2 is built **on real evidence of need, not speculation** (teachers in low-connectivity areas asking after v1 has run a semester).
- Phase 3 is **hypothetical capacity, not a commitment** — multi-device conflict resolution is the most bug-prone, most subtle data-loss case.
- **Marketing follows the roadmap, not the other way around** — the expectation gap is where churn comes from.
- Same discipline as the rest of the product (Oversight coverage caveats, STPSHS "no WAEC API yet," ledger "we save you typing, you confirm the read").

---

## 5. Responsive / PWA specifics (mobile-viewport map)

These are **responsive states of the existing desktop ledger**, at phone width (~360px). The desktop route stays; the phone layout is the same route below a mobile breakpoint.

- **Layout swap by breakpoint:** desktop = sidebar + `SeniorLedgerGrid` table. Phone = `pwa-header` + `pwa-context` (chevron switcher) + sync strip + **Card/Grid toggle** + body + **bottombar**. The bottombar (Today/Classes/Ledger/More) **replaces** the sidebar at phone width; it is new phone chrome mapping to the app's primary nav.
- **Card view** is a phone-only render of the five-category data (one `LedgerRow` per card, five large inputs). **Grid view** is `SeniorLedgerGrid` reshaped: abbreviated 3-letter headers, `sticky` navy header, **sticky-left student column** (the existing grid already sets `sticky left-0 z-10` on the student `td`/`th` — keep it), vertical scroll for rows, `Wt total` retained.
- **Large touch targets:** inputs are full-width `py-2` (≈44px), not the desktop `w-16 py-1.5`. Bottom-sheet options and toggle segments are finger-sized. Keep `inputmode="numeric"` / `type="number"` for the numeric keypad.
- **Sticky-left grid on the tightest phone:** the surface fits all seven columns at 360px by abbreviating (no horizontal scroll needed — "scroll for more" is vertical). Keep the student column + navy header sticky so that if a wider phone or landscape induces horizontal scroll, names + headers stay visible. Existing `overflow-x-auto` on the grid wrapper is retained.
- **SW cache (Q2/Q3/R2/R3):** hand-rolled Cache API (no `next-pwa`, no Vercel edge/ISR/KV — R2/portability), caching **app-shell + the current (class×subject×semester) ledger only**, per-session scoped, **cleared on logout** (R3 — never serve one user's cached scores to another session; the ledger page is `force-dynamic` behind auth). This is what makes "loads with no signal" true. Historical semesters are **not** cached.
- **Install (Q4 — owner input on icons):** valid `manifest.webmanifest` + **maskable 192/512 icons** make it installable to the home screen. `public/img/` has none — owner supplies a brand mark or a Phase-1 placeholder (not merge-blocking; a placeholder makes it installable today).

---

## 6. Bottombar phone nav (new chrome)

Four tabs replace the desktop sidebar at phone width. Reuse the app's primary-nav destinations; this is a flat four-item bar (well under the twelve-item sectioned-nav threshold — flat is correct).

| Tab | Icon glyph | Maps to |
|---|---|---|
| `Today` | `T` | Today's lessons (teacher home) |
| `Classes` | `C` | Class list / registers |
| `Ledger` | `L` | Score ledger (**active on §1/§2/§3**) |
| `More` | `M` | Settings / overflow (**active on §4** — the roadmap sits here conceptually, but the roadmap itself is not a screen, §10.1) |

Tokens: `pwa-tab` Manrope 600 9.5px `text-navy-3`, active `text-gold`; `pt-icon` 22px `rounded-sm` — idle `bg-bg text-navy` Fraunces italic; active `bg-gold text-navy`. Glyphs are single letters in Fraunces italic (text-forward; no icon font).

---

## 7. Marketing-honesty audit — every copy string (R1 · BINDING)

The task requires the honesty rule flagged on **every** copy string. Full inventory with verdict:

| Screen | Copy string (verbatim) | Verdict |
|---|---|---|
| §1 sync strip (online) | `All scores synced · last 2 minutes ago` | ✅ honest — states confirmed + timestamp |
| §1 caption | `Card view · one student at a time · swipe between students within the class.` | ✅ neutral |
| §1 caption | `Grid view · whole class at a glance · scroll for more rows, tap any cell to edit.` | ✅ neutral |
| §1 grid foot | `8 of 37 · scroll for more` · `tap any cell to edit` | ✅ neutral |
| §2 sheet title | `Switch class · Mr. K. Owusu · Semester 2` | ✅ neutral |
| §2 caption | `Tap the chevron … the ledger reloads with that class's roster, scores, and progress.` | ✅ neutral |
| §3 sync strip (offline) | `Connection lost · 3 scores held locally, will sync when reconnected` | ✅ honest — "will sync when reconnected" ≠ offline. **Do NOT relabel "Connection lost" → "Offline mode."** |
| §3 card badge | `3 scores on this card are held locally · will save when connection returns` | ✅ honest — promises retry, not offline operation |
| §3 caption | `Connection drops mid-entry · the buffer holds three pending scores · the strip and the input tint both say so plainly.` | ✅ honest |
| §4 Phase-1 title | `Works on your phone · handles bad connections` | ✅ **this is the approved marketing line** |
| §4 Phase-1 body | `… Buffers a few minutes of pending scores when signal drops. … No extended offline sessions. No conflict resolution.` | ✅ honest — explicitly disclaims extended-offline |
| §4 caption | `The marketing line is "works on your phone, handles bad connections." Not "works offline."` | ✅ **the binding rule stated in-surface** |
| §4 Phase-2 title/body | `Extended offline sessions · single device` / `Local IndexedDB store …` | ✅ correctly labelled **future (Item 9)**, not a v1 claim |

**Rule for the implementer:** any new string on this surface (empty-buffer state, retry-failed state, reconnect toast, install prompt) must pass this audit — **never** the words "works offline" / "offline mode" / "offline-ready" for Phase 1; a pending score **never** renders as "saved." Quinn gates this (INCR-4 QA line: "copy never says 'offline'").

---

## 8. Cross-module hooks (design commitments, preserve them)

| Hook | Where it surfaces on the PWA | Preserve as |
|---|---|---|
| **Score ledger → STPSHS export** | Bottom-sheet `pco-meta` "STPSHS in 17 days" + `ready`/`behind` status pills; Grid view is "the shape for … final review before STPSHS export" | reuse `rosterQualifies` + the academic-period window; same readiness the desktop STPSHS-ready card computes |
| **Assessment Reference ID continuity** | Same `REF-2024-XXXX` on Card, Grid, desktop ledger, STPSHS sheet ("the phone is not a different system") | one `LedgerRow.code`, rendered in every form factor |
| **Ledger completion → VHM progress / anomaly rules** | Chevron gold (<7 days to STPSHS) + warn-dot (teacher inactive >14 days) = "the same anomaly-rule infrastructure the Vice Headmaster's progress view uses, surfaced for the teacher's own benefit" | `ref_anomaly_rule` — **deferred in Item 5 (§2.6), but keep the hook in the design** |
| **Same class-context audit trail** | Class switch is audited "who looked at which class, when … the same way every other class-context action is logged" | reuse the existing audit path; the phone adds no new audit surface |

---

## 9. Interaction-state inventory (every state on the four screens)

| Region | State | Visual / behaviour |
|---|---|---|
| View toggle | Card active / Grid active | active `bg-navy text-bg`; idle `text-navy-3`; choice persisted per teacher×subject×class×semester (`localStorage`) |
| View toggle | first-use default / persisted | Card default first use; last-chosen thereafter |
| Card input | filled / empty / focused / **pending-sync** | `bg-surface` / `text-border-2` `—` / `border-gold bg-gold-bg` / **`bg-gold-bg border-gold`** |
| Card total | provisional (`+ portfolio`) / complete | Fraunces `text-navy`, `em` gold; `+ portfolio` suffix while <5 categories present |
| Grid cell | value / empty / **pending** | mono `text-navy-2` / `text-navy-3 opacity-50` `—` / `bg-gold-bg text-navy` |
| Grid header | category / `Wt total` | `bg-navy text-bg` / **`bg-gold text-navy`** |
| Sync strip | synced (green) / **connection-lost (gold)** | `bg-green-bg text-green` "All scores synced …" / `bg-gold-bg text-gold` "Connection lost · N scores held locally, will sync when reconnected" |
| Buffer | holding / retrying / confirmed / failed | pending-tinted + badge / retry on `online` / tint clears + count decrements + strip → green / stays pending, keep retrying, never false-saved (R4) |
| Class context | single-class / multi-class | no chevron+pill / chevron `▾` + `1 of N` pill |
| Chevron status (DEFERRED) | plain / gold (<7d STPSHS) / warn-dot (>14d inactive) | Item 5 ships plain only (§2.6 / Q6 / R5) |
| Bottom sheet | closed / open | absent / dim overlay `rgba(navy,0.45)` + sheet slid up, body blurred |
| Class option | current / ready / behind | `bg-gold-bg border-gold` + `current` pill / `ready` green pill / `behind` warn pill |
| Class option (on tap) | switch | sheet dismisses; ledger reloads in last-used view; buffer + cursor preserved; switch audited |
| PWA load | with signal / **no signal (SW cache)** | live fetch / app-shell + current ledger from Cache API (current semester only) |
| Install | not installed / installed | browser tab / home-screen icon (manifest + maskable 192/512) |
| Bottom tab | Ledger active (§1–3) / More active (§4) | `text-gold` + gold icon on active |

---

## 10. Open questions / drift log

1. **The §4 roadmap panel is a design-record explainer, not a screen.** Build Phase 1 and stop; do **not** ship a "connectivity roadmap" surface in the app. The three cards map exactly to Items 5/9/10.
2. **Reconnect transition is behaviour, not a mockup.** The surface pictures only the dropped state; the auto-sync-on-reconnect flow (tint clears → count decrements → strip green) is Done-when behaviour the implementer builds (§3.4). Pending stays visibly pending until server-confirmed (R4).
3. **Buffer persistence boundary is Kofi Q1.** `localStorage` (survives tab reload/app-close) vs in-memory React state (network drop, tab open). **No IndexedDB in Phase 1** (that is Item 9) — hard line regardless of Q1's answer. Buffer cap + overflow behaviour is Q3 (block or warn-and-keep; never silently drop).
4. **Card view adds a `+ portfolio` provisional suffix; the existing grid shows the bare number.** Adopt the suffix in Card view (signals provisional total); Grid view + desktop keep the bare provisional number. Presentation only — maps to `provisionalTotal`/`anyPresent`.
5. **Category-label drift Card vs `CATS`:** Card uses `Mid-sem exam` / `Project work`; `CATS` (and the tight Grid header) use `Mid-sem`/`Mid` and `Project`/`Pro`. Adopt fuller labels where space allows (Card), short in the Grid header. Same five keys underneath.
6. **`REF-2024-XXXX` is illustrative.** Reuse `LedgerRow.code` (`students.studentCode`); render whatever the real code format is. Card shows the full code; Grid shows the tail (`0142`). The "Assessment Reference ID rides along" commitment is about **continuity of one code across surfaces**, not this exact string.
7. **Chevron anomaly status deferred (Q6/R5).** Ship plain chevron + `1 of N` + bottom sheet. Gold-chevron (<7d STPSHS) / warn-dot (>14d inactive) defer with VHM anomaly surfacing unless cheap. Hook preserved in §8.
8. **Token-opacity trap — highest risk on this surface.** Pending-sync input (`bg-gold-bg`), pending grid cell (`bg-gold-bg`), offline strip (`bg-gold-bg`), online strip (`bg-green-bg`), `1 of N` pill (`bg-gold-bg`), `behind` pill (`bg-warn-bg`) are all **solid `-bg` tokens** — never slash-opacity on raw hex. Decorative washes (dim overlay `rgba(navy,0.45)`, `gc-wt` `rgba(gold,0.06)`, strip borders) use `opacity-N`/arbitrary rgba, not `bg-navy/45`. Verify **in the live preview**, not the build (memory `no-alpha-token-opacity`). The pending-sync tint is load-bearing (it is the "not saved" signal) — verify it renders.
9. **No PWA variant of the scan/OCR/diff flow.** Confirmed against path-b map §8: the PWA is card/grid + switcher + buffer only. Do not invent a phone scan surface.
10. **Bottombar is new phone chrome.** Today/Classes/Ledger/More maps to the app's primary nav; flat four-item bar (below the twelve-item sectioned threshold). Wire to real routes; `More` = overflow/settings.
11. **Buffer wraps the save actions client-side (crux), NOT SW Background Sync.** `saveDirectLedgerScores`/`savePortfolioScores` are RSC actions that don't replay cleanly through the SW. This shapes the whole build — the buffer lives in the reshaped `SeniorLedgerGrid`'s React state + `online` listener, not in `sw.js`.
12. **SW cache scope (Q2/R3).** App-shell + current (class×subject×semester) ledger only, per-session, cleared on logout, no historical semesters. Sarah gates the cross-session/tenant leak.

---

## 11. Component mapping (surface region → build target)

| PWA region | Reuse | New / reshaping work for Item 5 |
|---|---|---|
| Phone chrome (header/context/bottombar) | `page.tsx` shell identity (teacher, class×subject×period params) | phone header + four-tab bottombar (new mobile chrome, maps to app nav) |
| Card view | `SeniorLedgerGrid` data (`LedgerRow`, `CATS`, `catValue`, `total`) | one-student-per-card render with five large inputs; `+ portfolio` provisional suffix; `N of total` position |
| Grid view | `SeniorLedgerGrid` (sticky-left student col, `Wt` column, cell states) | phone-width reshaping: 3-letter headers, sticky navy header, compact rows; **same `cells` state as Card** |
| View toggle | — | segmented `Card`/`Grid` pill; persist choice per teacher×subject×class×semester (`localStorage`, Q5) |
| Class context + chevron + `1 of N` | class×subject×period params | chevron trigger + pill; suppress for single class |
| Class-switcher bottom sheet | `senior_subject_teacher` (list), `seniorLedgerPath` (path), roster (count), `page.tsx` completion idiom, `rosterQualifies` (STPSHS pill) | bottom sheet + dim overlay; per-class row (name/subject/count/completion/status); default-to-current; non-destructive switch (buffer + cursor preserved); audit the switch |
| Sync strip | `design-tokens._conventions.connection-status` (calm pill, not alarm) | green/gold strip; always visible; dynamic count |
| Pending buffer + retry | `saveDirectLedgerScores` / `savePortfolioScores` (wrap, don't replace) | client-side buffer (React state + `online` retry); pending-tinted inputs/cells; badge; visible-pending-until-confirmed (R4); Q1 persistence boundary; Q3 cap |
| SW cache | scaffolding `public/sw.js` (no-op today), `PwaRegister` | hand-rolled Cache API: app-shell + current ledger; per-session; clear on logout (R2/R3) |
| Install | `public/manifest.webmanifest` (favicon only today) | fill manifest + maskable 192/512 icons (Q4 owner input) |
| Roadmap panel (§4) | — | **do not build** — design-record only (§10.1) |

---

*Map produced against: `Surfaces/schoolup-shs-score-ledger-pwa.html` (§1 online lines 764–953, §2 switcher 955–1067, §3 dropped 1070–1167, §4 roadmap 1169–1257; PWA CSS 336–749); `omnischools/docs/senior-build-plan.md` INCR-4 (Goal / Done-when / architecture crux / Q1–Q7 / R1–R5); `omnischools/components/senior/senior-ledger-grid.tsx`, `path-chooser.tsx`, `app/(app)/senior/score-ledger/page.tsx`; `md files/design-tokens.json` v1.0.0; format precedent `omnischools/docs/senior/path-b-scan-surface-map.md`.*
