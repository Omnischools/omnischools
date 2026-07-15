# Path B Scan-and-Extract — Surface Map (INCR-2: Score Ledger Item 4)

**Author:** Lucy (design cartographer) · **Status:** design spec, ready for the implementation engineer (Claude Code).
**Scope of this map:** `Surfaces/schoolup-shs-score-ledger.html` **§2** only — the scan → extract → verify → diff workflow (Path B / `SCAN_EXTRACT`). §1 (Path A grid) and §3 (STPSHS export) are already mapped in `ledger-surface-map.md`; this map picks up where that one flagged §2 as "out of scope, colour vocabulary reused."

This is an exhaustive 1:1 map of the §2 surface. **Rule where surface and spec disagree: spec/Kofi ruling wins on logic, surface wins on visual presentation** — every drift is called out inline and collected in the drift log. States are keyed to the **INCR-2 acceptance criteria** in `senior-build-plan.md` (B1–B9, C1–C4, D1–D5, E1–E3, F1–F4, G1–G4, H1–H2) and the **Kofi rulings Q1–Q7** so the ported behaviour matches the ruled behaviour exactly.

## Source + reuse

| File | Role |
|---|---|
| `Surfaces/schoolup-shs-score-ledger.html` **§2** | **PRIMARY visual source** — scan panel, extracted grid, low-conf cell, 4 diff flags (lines 593–738; CSS 268–326). |
| `Surfaces/schoolup-shs-score-ledger-pwa.html` | **Checked — no phone variant of §2 exists.** The PWA covers card/grid view + class switcher only; the scan flow has **no** PWA surface. See §7 (Responsive/PWA). |
| `omnischools/docs/senior/ledger-surface-map.md` | Format precedent + the §1 grid/cell vocabulary this reuses (esp. §3.4 cell states, §0 token table). |
| `omnischools/components/senior/senior-ledger-grid.tsx` | **The grid component to extend** — `SeniorLedgerGrid` (`LedgerRow`, `CATS`, cell classes). The extracted grid is this grid in a read-and-verify mode; do **not** invent a new grid. |
| `omnischools/components/senior/path-chooser.tsx` | `CapturePath` type already carries `"SCAN_EXTRACT"`; Path B card currently `available:false` — flip to `true` and wire it to this screen. |
| `omnischools/app/(app)/senior/score-ledger/page.tsx` | The route that hosts the ledger; the scan screen is its `/scan` sibling (URL below). Reuses `requireSchool()`, `withSchool()`, `resolveWeights`, the hero-header idiom. |
| `omnischools/docs/senior-build-plan.md` **INCR-2** | Kofi rulings Q1–Q7 + acceptance criteria — the behavioural source of truth this map's states cite. |

---

## 0. Tokens used in §2 (subset of the §0 table in `ledger-surface-map.md`)

Use the **Tailwind token class**, never inline `var(--x)` in JSX (the surface is hand-written HTML with `var(--x)`; translate each to the class of the same token).

| Surface `var(--x)` | Hex | Tailwind class | Where it is used in §2 |
|---|---|---|---|
| `--navy` | `#1A2B47` | `text-navy` / `bg-navy` / `border-navy` | primary text, `Commit` button, diff `.df-choice.primary`, gold-icon text |
| `--navy-2` | `#2D3F5C` | `text-navy-2` | diff-flag body text, `.df-choice` label, scan-mock handwriting |
| `--navy-3` | `#5C6675` | `text-navy-3` | crumb, captions, section labels, handwritten header rule |
| `--gold` | `#C8975B` | `text-gold` / `bg-gold` / `border-gold` | h1 italic accent, corner stamp bg, **silent-accept flag border + icon** |
| `--gold-soft` | `#E8D4B8` | `border-gold-soft` | — (scan-mock inner) |
| `--gold-bg` | `#F5EBDC` | `bg-gold-bg` | **accepted extracted cell (`.manual`)** + **silent-accept flag background** |
| `--bg` | `#FAF7F2` | `bg-bg` | page bg, `.scan-image` dashed frame bg, warn/terra icon glyph colour |
| `--surface` | `#FFFFFF` | `bg-surface` | scan-mock paper, `.df-choice` bg, extracted-grid panel |
| `--green` / `--green-bg` | `#2F6B47` / `#E5EFE8` | `text-green` / `bg-green-bg` | **NOT used in the scan grid** — see §3 note (scan values are manual-origin, never `computed`) |
| `--terra` | `#B84A39` | `text-terra` / `bg-terra` / `border-terra` | **score-gone-missing flag** border + icon |
| `--terra-bg` | `#F5E1DC` | `bg-terra-bg` | **score-gone-missing flag** background |
| `--warn` | `#C58A2E` | `text-warn` / `bg-warn` / `border-warn` | **low-confidence cell** text + `?`; **review flag** (score-down / compound) border + icon |
| `--warn-bg` | `#F5E9D0` | `bg-warn-bg` | **low-confidence cell** bg; **review flag** background |
| `--border` | `#E5DFD3` | `border-border` | grid dividers, scan-mock inset border |
| `--border-2` | `#D4CCBA` | `border-border-2` | `.scan-image` dashed frame, handwritten row dots, `.df-choice` border, **blank/`—` cell colour** |

**Type:** `font-display` = Fraunces (h1, section title, flag icon glyph `!`, scan-mock title); `font-body` = Manrope (all body, student names); `font-mono` = JetBrains Mono (all scores, corner stamp). **Empty/missing score = em-dash `—`** in `text-border-2` — never `0`/`N/A`/`null` (`design-tokens.json._conventions.empty-cells`).

**Handwriting mock font:** the surface sets `.scan-mock { font-family:'Caveat','Comic Sans MS',cursive }`. **This is mock-only.** `Caveat` is **not** in the font `<link>` (only Fraunces/Manrope/JetBrains Mono load). In production the left pane is the **uploaded photo `<img>`**, not a CSS handwriting mock — do not port the cursive font. See §2.1.

---

## 1. §2 top-to-bottom region order

The screen (route `…/scan`) is the app shell (identical sidebar to §1) + a main column with, in order:

1. **`.page-head`** — crumb, h1, lede, two actions.
2. **`.scan-panel`** (`grid-cols-[0.9fr_1.1fr] gap-4`) — **left:** uploaded photo (`.scan-image`); **right:** extracted grid + caption.
3. **Diff section label** — "Changes since mid-semester upload · 4 to review".
4. **Four `.diff-flag` rows** — in this order: compound review (warn) · silent-accept (gold) · score-down review (warn) · gone-missing (terra).

Then the right-rail `.notes` panel (design intent, not built).

### 1.1 App shell / sidebar (identical to §1 — do not re-derive)
`bg-navy` Senior sidebar. Crest gold `A` + `Omnischools Senior` / `Asankrangwa SHS`. Scope chip: `Teaching` / `Mr. K. Owusu` / `Mathematics · Form 2 Science`. Nav groups **My teaching** (Today's lessons · Classes · **Score ledger [active]** · Lesson plans · Assignments) · **Students** (Class registers · Parent messages) · **Semester end** (Report cards · STPSHS export). Footer `KO` / `K. Owusu` / `Subject teacher · Maths`. `Powered by Omnischools`. **Score ledger stays the active nav item on the scan screen** (scan is a sub-route of the ledger, not its own nav entry).

### 1.2 `.page-head` (verbatim copy)
- **URL (browser bar):** `app.omnischools.gh / senior / ledger / form-2-science / mathematics / 2025-26-t2 / scan` → route `/senior/score-ledger/scan?classId&subjectId&periodId` (reuse the query-param mechanism of the ledger page).
- **Crumb:** `Senior · Mathematics · Form 2 Science · Semester 2 · Scan upload · Verify v2` (`text-navy-3 text-[11px] uppercase tracking-[0.12em]`).
- **h1:** `End-of-semester upload · <em class="italic text-gold">verify the read.</em>` (`font-display 28px 500`).
- **Lede:** `Uploaded 26 June 2026 · supersedes the 8 May mid-semester upload · 4 changes to review` (`text-navy-3 text-[13px]`).
  - **Drift (copy vs Kofi Q1):** "supersedes the 8 May mid-semester upload" reads as a version chain. **Kofi Q1 ruled diff-against-committed — no version/upload table in Item 4.** The diff baseline is the **currently-committed `senior_score_ledger` row**, not a stored "mid-semester upload." Keep the copy (it reads naturally to the teacher); the *implementation* compares against the committed row. The "8 May" date and "supersedes" wording are presentation only.
- **Actions (right):** `Re-upload page` (`.btn.ghost` = `bg-transparent border-border-2 text-navy-3`) · **`Commit verified ledger →`** (`.btn.primary` = `bg-navy text-bg font-bold`). Commit is the **atomic** write (Kofi Q6 / E2) that persists confirmed rows with `path_used = SCAN_EXTRACT` + `recordAudit`, then **discards the image** (Kofi ruling 3 / G4).

---

## 2. `.scan-panel` — photo ↔ extraction, side by side

`.scan-panel { display:grid; grid-template-columns:0.9fr 1.1fr; gap:16px; }` → `grid grid-cols-[0.9fr_1.1fr] gap-4`. The extraction column is deliberately the wider one (1.1fr).

### 2.1 Left: `.scan-image` — the uploaded photo (in-session only)
Surface markup is a **CSS mock of a handwritten page**; production renders the **actual uploaded photo**.

- Frame: `.scan-image` = `bg-bg border-[1.5px] border-dashed border-border-2 rounded-[10px] p-4 aspect-[4/3]` centred.
- **Production:** an `<img>` from an **in-memory object URL** (browser only, never persisted — Kofi ruling 3 / G1/G4). On the mock this is `.scan-mock` (`bg-surface rounded-md p-3.5`, cursive text, `::before` hairline inset `border border-border rounded-xs`).
- **Corner stamp (`.scan-corner-stamp`, absolute top-right):** `PAGE 1/2 · F2 SCI · MATHS · T2` — `font-mono text-[9px] bg-gold text-navy rounded-xs px-2 py-[3px] font-bold tracking-[0.04em]`. **This is the multi-page indicator** (page 1 of 2). Per the surface notes + build-plan dependency note, the stamp is the **Item 6 branded-ledger-book QR metadata**; **Item 4 does not read it** — class/subject/period come from the navigation context (query params). Render a page indicator, but drive it from the upload set index (Kofi Q6 / E1), not from OCR of the stamp.
- Mock content (for reference only — not built): title `Mathematics — Form 2 Science — Semester 2` (`font-display italic 13px text-navy` centred); a bold header row `Name · Asg · MS · ES · Pj · Pf` (border-bottom `1.5px navy-3`); then handwritten rows (`grid-cols-[1.5fr_repeat(5,1fr)]`, dotted `border-b border-dashed border-border-2`):

  | Handwritten name | Asg | MS | ES | Pj | Pf |
  |---|---|---|---|---|---|
  | A. Mensah | 72 | 68 | 81 | 75 | 8 |
  | A. Boateng | 65 | **74** | 69 | 80 | 7 |
  | A. Asante | 88 | 85 | 89 | 92 | 10 |
  | D. Owusu | 58 | 62 | 55 | 66 | 5 |
  | E. Adjei | 79 | 74 | 82 | 78 | 9 |
  | E. Tetteh | 71 | 69 | 73 | 70 | 7 |
  | E. Coleman | 84 | 88 | 86 | 90 | 9 |

  Note the **abbreviated names** (`A. Mensah`, `A. Boateng`) — this is exactly the roster-mapping ambiguity Kofi Q5 / D1 guards (see §5). The `Pf` column reads single digits (8, 7, 10, 5…) — this is the **denominator-scaling** case (portfolio on a /10 scale; Kofi Q1b / A1): raw `8` under portfolio denom `10` stores `80.00`, not `8`.

### 2.2 Right: extracted ledger grid + caption
- Label above grid: `Extracted ledger · sample` (`text-[10px] uppercase tracking-[0.1em] text-navy-3 font-bold`).
- Grid = `.ledger-grid` at `font-size:11px`. **Header omits the Weighted/total column** (present in §1, absent here) — the scan grid verifies the five raw category reads only; the weighted total is computed after commit. Header cells + colours (identical classes to §1): `Student` (`.student-col`, left, sticky-left) · `Asg` (`.cat-asgn` → `text-green`) · `MS` (`.cat-mid` → `text-navy-2`) · `ES` (`.cat-end` → `text-navy-2`) · `Pj` (`.cat-proj` → `text-green`) · `Pf` (`.cat-port` → `text-terra`). **Header colours are category-semantic, not confidence** — keep them.
- **Body rows** (7 of 37 shown, full names resolved from the abbreviations):

  | Student | Asg | MS | ES | Pj | Pf | cell states |
  |---|---|---|---|---|---|---|
  | Abena Mensah | 72 | 68 | 81 | 75 | 8 | all `.manual` |
  | **Akwasi Boateng** | 65 | **74** | 69 | 80 | 7 | MS = `.low-conf`; rest `.manual` |
  | Ama Asante | 88 | 85 | 89 | 92 | 10 | all `.manual` |
  | Daniel Owusu | 58 | 62 | 55 | 66 | 5 | all `.manual` |
  | Efua Adjei | 79 | 74 | 82 | 78 | 9 | all `.manual` |
  | Emmanuel Tetteh | 71 | 69 | 73 | 70 | 7 | all `.manual` |
  | Esi Coleman | 84 | 88 | 86 | 90 | 9 | all `.manual` |

- Caption (below grid, `text-[10.5px] text-navy-3 italic`): `Showing 7 of 37 students · 4 cells flagged across the full class (low-confidence OCR) · 4 differences from the mid-semester upload, below.`

---

## 3. Extracted-grid cell states — the exact vocabulary (nail these)

The scan grid reuses `SeniorLedgerGrid`'s cell classes, **but the semantic mapping differs from Path A**: scan-extracted values are **manual-origin (gold), never computed (green)**. There are three cell states, mapped to Kofi Q2 confidence bands (final constants `LOW_CONF_FLAG = 0.85`, `LOW_CONF_FLOOR = 0.60`):

| State | Surface class | Tailwind (solid tokens) | Confidence band (C1–C3) | Renders |
|---|---|---|---|---|
| **Accepted / normal** | `.score-cell.manual` | `bg-gold-bg text-navy font-bold` | **≥ 0.85** (C1) | the read value, no marker |
| **Low-confidence** | `.score-cell.low-conf` | `bg-warn-bg text-warn font-bold` + absolute `?` top-right (`content:"?"; top:2px; right:5px; text-[9px] text-warn font-bold`) | **0.60–0.85** (C2) | the read value **dim/`?`**; **must be reviewed before commit** — cannot silently commit |
| **Blank / must-enter** | `.score-cell.empty` | `text-border-2`, renders `—` | **< 0.60** dropped to blank (C3), **or** a score that went missing | `—`; teacher enters manually |

**Load-bearing rules (do not soften):**
- **`.computed` (green) is never used in a Path B / `SCAN_EXTRACT` grid.** Green means auto-compiled-from-events (Path A). A scanned number is manual-origin → **gold `.manual`**. The §1 legend's three swatches (computed-green / manual-gold / low-conf-warn) still describe the vocabulary; on this screen only manual + low-conf + empty appear.
- **`< 0.60 → blank, never a possibly-wrong number** (C3). Do not show a sub-floor guess as an accepted value.
- **`.low-conf` cell blocks commit until reviewed** (C2). The `?` is the review prompt.
- **In Path A/C context, no cell is ever `.low-conf`** (C4) — the class exists only for the scan grid.
- The demo shows only Akwasi Boateng's MS cell as `.low-conf`; the caption says **4 cells flagged across the full 37** — the state is per-cell, not per-row.

> **Token-opacity trap (verify in live preview, not build):** the three tint backgrounds are the dedicated **solid `-bg` tokens** — `bg-gold-bg` / `bg-warn-bg` / `bg-terra-bg`. **Do NOT** express any of these as slash-opacity on a raw-hex token (`bg-warn/10`, `bg-gold/20`, `text-warn/70`) — that silently breaks on the raw-hex token set (memory `no-alpha-token-opacity`). The `?` marker colour is solid `text-warn`. This is the one place §2 is most at risk of the trap because every state is a coloured tint. The existing `SeniorLedgerGrid` already uses `bg-warn-bg` solid in its legend — match it.

---

## 4. The four diff flags — verbatim copy, exact tokens, per-flag actions

Section label above the flags: `Changes since mid-semester upload · 4 to review` (`text-[10px] uppercase tracking-[0.1em] text-navy-3 font-bold`, `mb-2`).

Base component `.diff-flag` = `flex gap-3 px-4 py-[13px] rounded-[10px] mb-2.5`, with `.df-icon` (28px, `rounded-[7px]`, Fraunces italic `!` glyph), `.df-text` (`text-[11px] text-navy-2 leading-[1.55] flex-1`, bold = `text-navy`), `.df-choices` (`flex gap-1.5`). `.df-choice` = `text-[10px] px-2.5 py-[5px] rounded-md border border-border-2 bg-surface font-semibold text-navy-2`; `.df-choice.primary` = `bg-navy text-bg border-navy`.

The four rendered flags (the surface renders the four **non-unchanged** cases; "unchanged" is the fifth conceptual case that renders **no flag**):

| # | Case (Kofi Q3 / §7.2) | Severity + tokens | Icon | `.df-text` (verbatim, `**` = `<b>` `text-navy`) | Choices (left→right) · primary = `.df-choice.primary` |
|---|---|---|---|---|---|
| 1 | **Compound: changed AND low-confidence** — Akwasi Boateng | **WARN** (default `.diff-flag`): `bg-warn-bg border-warn` | `bg-warn text-bg` | **Akwasi Boateng** · Mid-sem score · mid-semester upload showed **71** · this upload shows **74**. Cell is also flagged low-confidence OCR. **Review the photo** before accepting. | `Keep 71` · **`Keep 74`** (primary) · `Enter manually` |
| 2 | **Blank → filled: silent-accept** — Kojo Mensah | **GOLD**: `bg-gold-bg border-gold` (inline override) | `bg-gold text-navy` | **Kojo Mensah** · End-of-sem score · mid-semester upload showed **—** (blank, exam hadn't happened yet) · this upload shows **64**. Expected change — new entry, accepted silently if you don't intervene. | `Accept` (single, **not** primary) |
| 3 | **Score-down: review with reason** — Mariama Iddrisu | **WARN** (default): `bg-warn-bg border-warn` | `bg-warn text-bg` | **Mariama Iddrisu** · Assignment score · mid-semester upload showed **76** · this upload shows **73**. Score went down — unusual unless re-graded. **Confirm the change with reason.** | `Keep 76` · **`Keep 73 · re-graded`** (primary) · `Enter manually` |
| 4 | **Score gone missing: highest severity** — Yaa Asantewaa | **TERRA**: `bg-terra-bg border-terra` (inline override) | `bg-terra text-bg` | **Yaa Asantewaa** · Mid-sem score · mid-semester upload showed **82** · this upload shows **blank**. **Score has gone missing** from the ledger between uploads. Re-photograph the page or enter the score manually. | `Keep 82` · `Re-upload page` · **`Enter manually`** (primary) |

**Exact flag → token mapping (the four colours the task asks for):**
- **Silent-accept (blank→filled):** `--gold-bg` bg + `--gold` border; icon `--gold` bg / `--navy` glyph. **Gold = expected, low-stakes.**
- **Unchanged:** *no flag rendered* (Kofi Q3 case B / B2 — no interaction).
- **Review (score-down, and the compound changed+low-conf):** `--warn-bg` bg + `--warn` border; icon `--warn` bg / `--bg` glyph. `.diff-flag`'s **default** colour is warn — flags 1 and 3 use no override.
- **Gone-missing (filled→blank):** `--terra-bg` bg + `--terra` border; icon `--terra` bg / `--bg` glyph. **Terra = highest severity.**

**Behaviour bindings (Kofi Q3 / B1–B9):**
- **Flag 1 (compound):** low-confidence overrides silent-accept precedence — a changed **and** low-conf cell **always forces review**, never silent (B6). A pure score-up at ≥0.85 would be review-only with **no reason** (B4/B8); here it is low-conf so it is forced-review regardless.
- **Flag 2 (silent-accept):** blank→filled at ≥0.85 commits with **no required action / no reason** (B1/B8). The single `Accept` button is a confirm affordance; if the teacher does nothing it accepts on commit.
- **Flag 3 (score-down):** requires a **reason code before the new (lower) value commits** (B3/B8). See §4.1.
- **Flag 4 (gone-missing):** **never auto-nulls a committed score** (B5). Default action is `Enter manually`; `Keep 82` retains the committed value; `Re-upload page` re-photographs. Choosing to actually remove/keep-blank requires a **reason** (Kofi Q4 — mandatory on Case D keep-blank).

### 4.1 Per-flag actions + where the reason-code picker appears

Four action verbs across the flags:

| Action | Appears on | Effect |
|---|---|---|
| **keep-old** | `Keep 71` · `Keep 76` · `Keep 82` | retain the committed value; extracted value discarded. No reason. |
| **keep-new** | `Keep 74` | accept the extracted value. Review-only, **no reason** (score-up / B4/B8). |
| **keep-new-with-reason** | `Keep 73 · re-graded` | accept the lower extracted value **with a reason code**. **This is where the reason-code picker lives.** |
| **enter-manually** | `Enter manually` (flags 1, 3, 4) | open the cell for direct typing; result is a `SCAN_EXTRACT` grid cell hand-corrected (H2, `path_used` stays `SCAN_EXTRACT`). |
| **accept** (silent) | `Accept` (flag 2) | commit the new value, no reason. |
| **re-upload** | `Re-upload page` (flag 4 + page-head) | re-photograph this page and re-extract. |

**Reason-code picker (`RE_GRADED` / `TRANSCRIPTION_ERROR` / `OTHER`) — placement (Kofi Q4 / final decision 2):**
- The surface **pre-bakes the reason into the button label**: `Keep 73 · re-graded` — the button both accepts the lower value and names `RE_GRADED` as the default reason.
- **Implementer:** render the `· re-graded` suffix as a **selectable reason** that defaults to `RE_GRADED`, with `TRANSCRIPTION_ERROR` and `OTHER` as alternatives; **`OTHER` requires mandatory free text**. Surface it inline on the score-down flag (a small dropdown/segmented control adjacent to / inside the primary choice), and again when the teacher chooses to remove a score on **Flag 4** (Case D keep-blank).
- **Reason is mandatory only on score-down and Case D keep-blank** (Q4 / B8). **Never** required on score-up, blank→filled, or unchanged.
- Reason persists to **`auditLog.reason`** (Q1/Q4 — no new column, no image reference in the payload / B9/G1).

---

## 5. Roster-mapping confirmation (name → student) — spec-added, not drawn on §2

The surface shows the **result** of mapping (handwritten `A. Mensah` → resolved `Abena Mensah` in the extracted grid) but renders **no explicit confirmation UI**. **Kofi Q5 / D1–D5 make row→student mapping a mandatory teacher-confirmed step** (roster misattribution is the highest-severity silent failure — a right mark on the wrong student is not caught by eye). This is a **spec-wins-on-logic** addition the implementer must build even though §2 doesn't picture it:

- **System proposes** a fuzzy mapping (abbreviated name → active student); **teacher confirms the full alignment before any diff/commit.**
- **Ambiguous name → block the row, never auto-pick** (D1). The demo's abbreviations (`A. Mensah`, `A. Boateng`, `A. Asante`, `E. Adjei`, `E. Tetteh`, `E. Coleman`) are exactly this hazard — e.g. `A. Boateng` where a roster could hold Akwasi **and** Abena Boateng.
- **Name not in roster → map or explicitly discard** (D2); scores don't commit until resolved.
- **Active student with no extracted row → committed row left untouched, flagged coverage-gap** (D3) — an absent row is **not** a Case D blank.
- **Two rows → one student → commit blocked** (D4). Each row maps to exactly one active student; each student to at most one row (D5).
- Suggested placement: a confirm-mapping step **before** the diff flags render (mapping must be settled first), or an inline unmapped-row banner on the extracted grid. Copy is spec-added (not on the surface) — keep the Ghanaian operational voice, defer exact wording to the implementer, flag as drift.

---

## 6. Multi-page + commit (Kofi Q6 / E1–E3)

- The corner stamp `PAGE 1/2` signals a **1..n image set**. A 37-student / 2-page class → **one merged 37-row grid, each student once** (E1). Drive the page indicator from the upload-set index, not from OCR of the stamp (§2.1).
- **Commit is atomic** — `Commit verified ledger →` writes all confirmed rows in **one transaction** (E2), sets `path_used = SCAN_EXTRACT`, `recordAudit`s, then **discards the image** (G4).
- **Partial coverage allowed but never silent** (E3): if page 2 is missing, warn, then commit only confirmed rows; **uncovered students' committed rows are never touched or blanked** and stay flagged incomplete.

---

## 7. Fallback to manual (Path C) — the error/empty grid (Kofi Q7 / H1–H2)

Not drawn on §2, but a required state: **extraction failure degrades to Path C in place — never a hard failure / dead-end.**

- **Wholesale failure** (Claude Vision down, unreadable photo) → the **same five-category grid renders blank on the same screen** for direct entry (H1). No navigation away. Reuse `SeniorLedgerGrid` with `mode="direct"` (all five cells editable) and empty `rows`.
- `path_used` records real provenance: **`DIRECT_ENTRY`** if nothing came from a scan; **`SCAN_EXTRACT`** if the grid was scan-populated even where hand-corrected (final decision 3 / F4).
- A **single** sub-0.60 cell is Q2's blank (`.empty`) inside a `SCAN_EXTRACT` grid — **not** a whole-session flip to Path C (H2).
- **Transient-image guarantee holds in the error path** (G3): no temp file, no retained base64, no base64 in logs/Sentry.
- Error copy is spec-added (not on the surface). Keep the calm operational voice; flag as drift for wording sign-off.

---

## 8. Responsive / PWA

- **No PWA phone variant of §2 exists.** `schoolup-shs-score-ledger-pwa.html` was checked end-to-end: it covers **card/grid view + the class chevron/bottom-sheet switcher only** — there is no scan/OCR/diff surface in it. The scan flow is **desktop-web only** in the surfaces. Do not invent a phone scan surface; if one is needed later it is a new design task, not a port.
- **Desktop responsive:** §2 defines no dedicated media query for `.scan-panel`. The page's global `@media (max-width:1280px)` collapses `.layout` (main + notes) to one column but leaves `.scan-panel` at `0.9fr 1.1fr`. At narrow widths the photo/grid two-up will crush — **stack the photo above the grid** (`grid-cols-1`) below the app's content breakpoint. The diff flags are already single-column `flex` and reflow; at narrow width let `.df-choices` wrap under `.df-text`.

---

## 9. Interaction-state inventory (every state in §2)

| Region | State | Visual |
|---|---|---|
| Extracted cell | accepted / low-conf / blank | `bg-gold-bg text-navy` / `bg-warn-bg text-warn` + `?` / `—` `text-border-2` |
| Confidence band → cell | ≥0.85 / 0.60–0.85 / <0.60 | accepted / low-conf (must review) / blank must-enter |
| Diff flag | silent-accept / review / gone-missing | `gold-bg + gold` / `warn-bg + warn` / `terra-bg + terra` |
| Diff flag | unchanged | **not rendered** (no flag) |
| Diff flag | compound (changed+low-conf) | warn (forced review, never silent) |
| `.df-choice` | default / primary | `bg-surface border-border-2 text-navy-2` / `bg-navy text-bg` |
| Reason picker | default `RE_GRADED` / `TRANSCRIPTION_ERROR` / `OTHER`+free-text | inline on score-down + Case D keep-blank; `OTHER` free text required |
| Roster row | mapped / ambiguous-blocked / not-in-roster / coverage-gap | proceed / block commit no auto-pick / map-or-discard / committed row untouched + flagged |
| Multi-page | full coverage / partial | atomic commit all / warn + commit confirmed only, uncovered untouched |
| Extraction | success / low-conf cell / wholesale failure | scan grid populated / `.empty` cell in `SCAN_EXTRACT` grid / blank Path C grid in place |
| Page-head action | idle Commit / Re-upload | `bg-navy text-bg` primary / `.btn.ghost` |
| Photo pane | uploaded (in-session) | `<img>` object URL, discarded on commit — never persisted |
| Path chooser (host page) | Path B card | flip `available:true` in `path-chooser.tsx`; active = `border-gold bg-gold-bg` + "Active" |

---

## 10. Component mapping (surface region → build target)

| §2 region | Reuse | New work for Item 4 |
|---|---|---|
| App shell / sidebar / `.page-head` | ledger `page.tsx` shell + hero idiom | swap copy + `/scan` crumb + Commit/Re-upload actions |
| `.scan-image` photo pane | — | `<img>` from in-session object URL; multi-page indicator from upload-set index; **never persist** |
| Extracted grid | `SeniorLedgerGrid` (`LedgerRow`, `CATS`, sticky-left, cell classes) | read-and-verify mode: no weighted column; cells `manual`/`low-conf`/`empty`; per-cell confidence prop; **never `computed`/green** |
| Low-conf cell + `?` | `.score-cell.low-conf` class (already in tokens/CSS + grid legend) | wire to confidence band `0.60–0.85`; block commit until reviewed |
| Diff flags | — (new) | 4 `.diff-flag` variants (gold/warn/terra), verbatim copy, per-flag actions |
| Reason-code picker | `components/ui/fields` (Select) | `RE_GRADED`/`TRANSCRIPTION_ERROR`/`OTHER`+free text; mandatory on score-down + Case D; persist to `auditLog.reason` |
| Roster-mapping confirm | roster/name resolution | teacher-confirmed step (Q5); ambiguity blocks; **spec-added, not on surface** |
| Denominator scaling | `lib/score-ledger/compute.ts` (`percent()`, `MAX_PERCENT` guard) | scale raw→0–100 by per-category school denominator before diff (Q1b / A1–A7); pure fn, never a DB trigger |
| Diff engine | — (new, `lib/score-ledger/`) | 4 pure diff-case functions + vitest, no DB (Q3 / B1–B9) |
| Extract API + adapter | — (new) | server route proxies base64 → Claude Vision (Haiku 4.5) behind `LedgerExtractor`; server-held key; **image never persisted** (G1–G3) |
| Fallback grid | `SeniorLedgerGrid` `mode="direct"` | render blank in place on wholesale failure (Q7 / H1) |
| Commit | `saveDirectLedgerScores`-style server action + `recordAudit` | atomic write `path_used=SCAN_EXTRACT`; drop image (Q6 / G4) |

---

## 11. Open questions / drift log

1. **"supersedes the mid-semester upload" copy vs diff-against-committed (Kofi Q1).** The lede and every flag say "mid-semester upload showed X." **No upload/version table exists in Item 4** — the diff baseline is the **committed `senior_score_ledger` row**. Copy stays (surface wins on presentation); logic reads the committed row. Item 7 adds the supersedes-chain later.
2. **Roster-mapping confirmation is not drawn on §2 but is spec-mandatory (Q5/D).** The surface shows only the resolved full names. The implementer must add the teacher-confirmed mapping step (ambiguity blocks, no auto-pick). Copy is spec-added — confirm wording with PO, keep the operational voice.
3. **Extraction-error / fallback grid + error copy not on §2 (Q7/H).** Degrade to blank Path C grid in place; error banner copy is spec-added — confirm wording.
4. **Scan grid uses `manual` (gold), never `computed` (green).** Cross-map note: the §1 legend's "computed = green" swatch does not apply to scan values. Scanned = manual-origin. Don't let a green cell appear in a `SCAN_EXTRACT` grid.
5. **Weighted/total column intentionally absent from the scan grid.** §2's extracted grid has no `Weighted` column (§1 does). The total computes after commit, not during verify — do not add it to the verify grid.
6. **Corner-stamp `PAGE 1/2` is Item 6 (branded ledger book) metadata; Item 4 does not OCR it.** Drive the page indicator from the upload-set index; take class/subject/period from the nav context (build-plan dependency note).
7. **Denominator scaling is invisible on the surface but load-bearing (Q1b / risk 🟡).** The `Pf` single-digit reads (8, 7, 10…) are /10 portfolio marks; raw `8` → stored `80.00`. The surface shows the raw read; the stored/diffed value is scaled. Ensure the diff compares **scaled** extracted vs committed, and the grid can show the raw read while storing the scaled value.
8. **Token-opacity trap (verify in live preview).** All §2 tints are solid `-bg` tokens (`bg-gold-bg`/`bg-warn-bg`/`bg-terra-bg`) + solid `text-warn`. Never slash-opacity on raw-hex tokens. §2 is high-risk here (every state is a coloured tint) — verify in the live preview, not the build (memory `no-alpha-token-opacity`).
9. **Transient image (risk 🔴 — Sarah gates).** The `.scan-image` pane holds an in-session object URL only; the base64 goes server-side (our API route, server-held `ANTHROPIC_API_KEY`), and the image is discarded on commit/complete — no Storage object, no column, no `auditLog` payload reference, no log/Sentry capture (G1–G4). Design reflects this: nothing on the surface implies a saved photo.

---

*Map produced against: `Surfaces/schoolup-shs-score-ledger.html` §2 (lines 593–738; CSS 268–326); `Surfaces/schoolup-shs-score-ledger-pwa.html` (confirmed no §2 variant); `omnischools/docs/senior-build-plan.md` INCR-2 (Kofi Q1–Q7, acceptance B/C/D/E/F/G/H, final decisions 1–4); `omnischools/docs/senior/ledger-surface-map.md` (format + §1 vocabulary); `md files/design-tokens.json` v1.0.0; existing `components/senior/senior-ledger-grid.tsx`, `path-chooser.tsx`, and `app/(app)/senior/score-ledger/page.tsx`.*
