# STPSHS Printable Score Sheet — Surface Map (INCR-3: Score Ledger Item 8)

**Author:** Lucy (design cartographer) · **Status:** design spec, ready for the implementation engineer (Claude Code).
**Scope of this map:** `Surfaces/schoolup-shs-score-ledger.html` **§3** only — the "Semester end · the printable STPSHS score sheet" export (the STPSHS Capture-Per-Subject mirror). §1 (Path A grid) and §2 (Path B scan/extract) are mapped elsewhere (`ledger-surface-map.md`, `path-b-scan-surface-map.md`).

**Two artifacts, one surface.** §3 draws (a) the on-screen **host export screen** at route `…/stpshs-export` — sidebar, page-head, a readiness/gating banner, and a WYSIWYG **preview panel** — and (b) inside that panel, a mock of the **print/PDF sheet** that is the actual deliverable. **This map treats the PDF as the primary artifact** (an A4 print layout: header / table / footer, `@react-pdf/renderer`), and maps the host screen as the trigger + gating context. Where surface and owner/Kofi rulings disagree, **ruling wins on logic, surface wins on visual presentation** — every drift is called out inline and collected in the drift log (§12). States key to the **INCR-3 owner decisions (Q1/Q5, LOCKED 2026-07-15)** and the remaining Kofi questions (Q2/Q3/Q4, unruled — flagged, not resolved).

## Source + reuse

| File | Role |
|---|---|
| `Surfaces/schoolup-shs-score-ledger.html` **§3** | **PRIMARY visual source** — export screen + sheet preview (markup lines ~740–863; sheet ~808–845; CSS `.stpshs-ready`/`.panel`/`.btn` at 86–89, 117–123, 329–334; `.notes` design intent 854–862). |
| `Surfaces/schoolup-shs-score-ledger-pwa.html` | **No PWA variant of §3.** The PDF is the mobile story (a Headmaster photographs/sends it — §3 notes). No phone screen to port. |
| `lib/pdf/receipt-document.tsx` + `render-receipt.tsx` | **The pattern to clone.** `@react-pdf/renderer` `Document`/`Page`/`View`/`Text`/`StyleSheet`; hex-constant tokens; `server-only` render fn returning a `Buffer`. Header/table/footer idiom, the gold `strip`, the dashed thead/trow borders. |
| `lib/pdf/report-card-document.tsx` | **A4 precedent** (this sheet is A4, the receipt is A5). Source for: `size="A4"`, centred header block, `<View style={s.footer} fixed>` repeat-per-page footer, `fmt0`/`fmt2` null→`—` helpers, `emptyRow` empty-state. |
| `lib/pdf/fonts.ts` | Core-font stand-ins: `SERIF`=Times-Roman (Fraunces), `SANS`=Helvetica (Manrope), `MONO`=Courier (JetBrains Mono). **Glyph-coverage gotcha in §7.** |
| `app/api/receipts/[paymentId]/route.ts` | Download-route pattern (`requireSchool` + role gate + `withSchool`, streams `application/pdf`, `private, no-store`). Not read for this map — cited by the build plan as the route clone. |
| `md files/STPSHS_INTEGRATION_SPEC.md` §2/§3 | The regulator column order + the Assessment-Reference-ID story this sheet mirrors. §2: the Ref ID is *the canonical student key for the 3-year cycle*; §3: STPSHS lets scores in **only via manual Capture-Per-Subject entry** — this sheet is that entry, on paper. |
| `md files/design-tokens.json` v1.0.0 | Canonical hexes + `_conventions.empty-cells` (`—`, never `0`/`N/A`/`null`). |
| `omnischools/docs/senior-build-plan.md` **INCR-3** | Owner decisions Q1 (REF-ID → "pending") + Q5 (>100 → flag+block+cap), step table, the "**NO weighted-total column**" done-when. |
| `omnischools/docs/senior/path-b-scan-surface-map.md` | Format precedent for this map; shared app-shell/sidebar description (do not re-derive). |

---

## 0. Tokens used in §3 (PDF = hex constants, host screen = Tailwind classes)

The PDF **cannot use CSS vars or Tailwind** — declare hex constants at the top of `stpshs-score-sheet-document.tsx` exactly as `receipt-document.tsx` does. The host-screen React uses Tailwind token classes (never inline `var(--x)`).

| Token | Hex | PDF const (mirror receipt) | Used in §3 for |
|---|---|---|---|
| `--navy` | `#1A2B47` | `NAVY` | sheet school-name + eyebrow value + header hairline (2px), on-screen h1/primary btn |
| `--navy-2` | `#2D3F5C` | `NAVY2` | readiness-banner body text (`.sr-text`) |
| `--navy-3` | `#5C6675` | `NAVY3` | th labels, meta line, footer legend, eyebrow label, ellipsis row, captions |
| `--gold` | `#C8975B` | `GOLD` | top `strip`, `em` accents (h1/ph-title), **pending-banner border + icon**, "Omnischools" gold em |
| `--gold-bg` | `#F5EBDC` | `GOLD_BG` | **pending (blocked) readiness-banner gradient start** |
| `--green` | `#2F6B47` | `GREEN` | **ready readiness-banner border + `✓` icon bg** |
| `--green-bg` | `#E5EFE8` | `GREEN_BG` (add) | **ready readiness-banner gradient start** |
| `--bg` | `#FAF7F2` | `BG` | **thead row background**, on-screen preview frame, ready-icon glyph colour |
| `--surface` | `#FFFFFF` | `#FFFFFF` | PDF page background, sheet paper |
| `--terra` / `--terra-bg` | `#B84A39` / `#F5E1DC` | `TERRA` / `TERRA_BG` | **over-100 flag** (Q5) on host screen; not on the drawn sheet (export is capped, so the sheet never shows >100 — §5.4) |
| `--warn` / `--warn-bg` | `#C58A2E` / `#F5E9D0` | `WARN` / `WARN_BG` | reserved for the "pending"/incomplete gating states if warn severity is chosen over gold (§3.3) |
| `--border` | `#E5DFD3` | `BORDER` | **body-row bottom borders** (`1px`), footer top border |
| `--border-2` | `#D4CCBA` | `BORDER2` (add) | **thead bottom border** (`1px`), sheet paper border (screen only) |

**Type roles (brand → core-font stand-in):** `SERIF` (Times-Roman ← Fraunces) = sheet title, eyebrow value, panel `ph-title`, section title, readiness-icon glyph, on-screen h1. `SANS` (Helvetica ← Manrope) = default body, **student-name cells**, meta lines, banner text. `MONO` (Courier ← JetBrains Mono) = **all score cells, the Assessment Ref ID, the "Page N of M" footer**.

**Empty cells = em-dash `—`** in `NAVY3`/muted — never `0`/`N/A`/`null` (`_conventions.empty-cells`; `report-card-document.tsx` `fmt0`). `—` (U+2014) is WinAnsi-safe with core fonts; the checkbox glyphs are **not** (§7).

---

## 1. §3 top-to-bottom region order

### 1.A Host export screen (route `…/stpshs-export`) — the trigger + gate
1. **Browser bar (mock):** `app.omnischools.gh / senior / ledger / form-2-science / mathematics / 2025-26-t2 / stpshs-export` → app route `/senior/score-ledger/stpshs-export?classId&subjectId&periodId` (reuse the ledger query-param mechanism).
2. **App shell / sidebar** — identical to §1/§2; **"STPSHS export" is the active nav item** under the **Semester end** group (siblings: Report cards). Do not re-derive; see §1.1.
3. **`.page-head`** — crumb, h1, lede, two actions (§1.2).
4. **`.stpshs-ready` banner** — readiness / gating strip (ready state drawn; pending/blocked state defined in CSS — §3.3).
5. **`.panel` "Preview"** — panel-head + the WYSIWYG **sheet mock** (= the PDF; §2, §4, §5).
6. Right-rail `.notes` (design intent, not built).

### 1.B The PDF sheet (the artifact) — A4 print layout
1. **Gold `strip`** (6pt) — top edge, mirror receipt/report-card.
2. **Header block** — school+code+date (left) / `Subject · Year · Sem` (right), 2px navy bottom rule.
3. **Score table** — thead (8 cols) + one row per active student; thead **repeats per page**.
4. **Footer legend** — abbrev key (left) + `Page N of M · Generated by Omnischools` (right); **repeats per page**.

### 1.1 App shell / sidebar (identical to §1/§2 — do not re-derive)
`bg-navy` Senior sidebar. Crest gold `A` + `Omnischools Senior` / `Asankrangwa SHS`. Scope chip: `Teaching` / `Mr. K. Owusu` / `Mathematics · Form 2 Science`. Nav groups **My teaching** (Today's lessons · Classes · Score ledger · Lesson plans · Assignments) · **Students** (Class registers · Parent messages) · **Semester end** (Report cards · **STPSHS export [active]**). Footer `KO` / `K. Owusu` / `Subject teacher · Maths`. `Powered by Omnischools`. **Nav is flat-grouped (7 items), not sectioned-overflow** — under the 12-item threshold.

### 1.2 `.page-head` (verbatim copy)
- **Crumb:** `Senior · Mathematics · Form 2 Science · Semester 2 · STPSHS export` (`text-navy-3` eyebrow, uppercase tracking).
- **h1:** `STPSHS-ready <em class="italic text-gold">score sheet.</em>` (`.section`/page h1 = Fraunces; `em` gold italic).
- **Lede:** `Pre-filled from the verified Semester 2 ledger · 37 students · ready for manual entry into stpshs.waecgh.org` (`text-navy-3`, `13px`).
- **Actions (right):** `Re-open ledger` (`.btn.ghost` = `bg-transparent border-border-2 text-navy-3`) · **`Download PDF · 2 pages`** (`.btn.primary` = `bg-navy text-bg font-bold`). The "· 2 pages" suffix is **dynamic** — page count from the paginator (§6); a ≤32-student class reads "· 1 page". Build-plan label for this action is **"Generate STPSHS sheet →"** — reconcile: the surface says "Download PDF · N pages"; keep the surface's download-framing wording, drive the count dynamically. This button is **gated** (§3.3): disabled while the ledger is incomplete or any over-100 value is unresolved.

---

## 2. `.stpshs-ready` readiness banner — the gate (drawn: ready; defined: pending)

Surface CSS gives **two states**; §3 renders the **ready** one and defines the **pending** one in CSS (`.stpshs-ready.pending`). This banner **is the generation gate** — Q3 (which rows qualify) and Q5 (>100 blocks generation) both surface here.

`.stpshs-ready` = `grid grid-cols-[auto_1fr_auto] gap-4 items-center rounded-xl p-[16px_20px]`. Left `.sr-icon` (36px, `rounded-[9px]`, Fraunces italic glyph). Middle `.sr-text` (`12px text-navy-2 leading-[1.5]`, `<b>`=`text-navy font-bold`). Right: a `.btn.primary` CTA.

| State | Trigger | `.sr-icon` | Border / gradient | `.sr-text` (verbatim where drawn) | Right CTA |
|---|---|---|---|---|---|
| **Ready** (drawn) | ledger complete + no over-100 unresolved | `✓` glyph, `bg-green text-bg` | `border-green`, `linear-gradient(135deg, green-bg 0%, surface 70%)` | **Ledger is complete and STPSHS-ready.** All 37 students have all five categories filled. Weighted totals computed at Asankrangwa SHS's configured weights for Mathematics (15/15/40/15/15). Download the PDF, open it beside your STPSHS tab, work through the per-subject capture screen one student at a time. **STPSHS window opens 14 July 2026 — 17 days away.** | `Open print preview →` (`.btn.primary`) |
| **Pending / blocked** (CSS defined, `.pending`) | incomplete ledger (Q3) **or** ≥1 unresolved over-100 (Q5) | glyph `!` (spec-added), `bg-gold text-navy` | `border-gold`, `linear-gradient(135deg, gold-bg 0%, surface 70%)` | *spec-added copy — keep the operational voice; name what blocks: missing categories per Q3, or "N score(s) over 100 must be resolved before you can generate the STPSHS sheet" per Q5.* | download/generate **disabled** |

**Load-bearing (do not soften):**
- The **weights `(15/15/40/15/15)`** in the ready copy are the report-card weighting — they compute a weighted total that is **NOT on the sheet** (STPSHS computes GPA itself; §4). The copy mentions them for teacher context only; the sheet emits raw per-category scores.
- **Ready gradient uses `--green-bg` + `--green`; pending uses `--gold-bg` + `--gold`.** These are the dedicated solid tint tokens — never slash-opacity (§7).
- The **over-100 flag** (Q5) is a **terra** severity marker in the ledger/verify UI (build-plan step "Over-100 flag + generation gate"); the banner's job is to **block generation** until every over-100 is resolved. The flagged cell lives in the ledger grid (§1 surface), not on this sheet — by the time the sheet generates, values are ≤100 (§5.4).

### 2.1 `.panel` preview
`.panel` = `bg-surface border border-border rounded-[14px] overflow-hidden`. `.panel-head` (`p-[16px_22px_14px] border-b border-border flex items-baseline justify-between`):
- **ph-title:** `Preview · <em class="italic text-gold font-normal">STPSHS-ready score sheet</em>` (Fraunces 17px 600; `em` gold italic).
- **ph-meta:** `Matches the order of STPSHS's "Capture Per Subject" screen · tick each row as entered` (`10px uppercase tracking-[0.08em] text-navy-3 font-bold`).

Panel body = `bg-bg p-6` frame wrapping the **sheet paper** (`bg-surface border border-border-2 rounded-[4px] p-[24px_28px] max-w-[720px] mx-auto shadow`). **The paper's border/radius/shadow/`max-w-[720px]` are on-screen chrome; the PDF page is A4 white with page padding (§4.1).** The paper mock IS the PDF preview — build it once as the `@react-pdf` document and (optionally) render the same component to an on-screen `<PDFViewer>` for the preview, or accept a static WYSIWYG mock. Do not diverge the two.

---

## 3. The PDF sheet — page setup

### 3.1 Page
- `<Page size="A4" style={s.page}>` — portrait A4 (595.28 × 841.89 pt). Report-card precedent.
- `s.page`: `backgroundColor:"#FFFFFF", fontFamily: SANS, fontSize: 10, color: NAVY, padding: 0`.
- **Gold `strip`** first child: `{ height: 6, backgroundColor: GOLD }` (mirror receipt/report-card top edge).
- **Content horizontal padding ≈ 40pt** each side (report-card `marginHorizontal:40`) → content width ≈ **515pt**. (Surface paper padding is `24px 28px` at 720px width; scale to A4.)

### 3.2 `<Document>` metadata
`title={`STPSHS Score Sheet — ${subject} · ${classLabel} · ${periodLabel}`}`, `author="Omnischools"`, `subject={`STPSHS Capture-Per-Subject sheet · ${school.name}`}`. Match the receipt/report-card metadata idiom.

---

## 4. Header block (verbatim copy + tokens)

Surface markup lines 809–818: a `flex justify-between items-flex-start`, `padding-bottom:14px`, `border-bottom:2px solid var(--navy)`.

**Left column** (`View`):
| Line | Copy (verbatim, data-driven parts in `{…}`) | Font / token |
|---|---|---|
| Title | `{school.name} · STPSHS Score Sheet` → e.g. `Asankrangwa SHS · STPSHS Score Sheet` | `SERIF` 16pt, weight 600, `NAVY` |
| Meta | `School code {code} · Generated {date} from Omnischools` → e.g. `School code WR-WAW-014 · Generated 27 June 2026 from Omnischools` | `SANS` 11pt, `NAVY3`, marginTop 3 |

**Right column** (`View`, `textAlign:"right"`):
| Line | Copy | Font / token |
|---|---|---|
| Eyebrow | `Subject · Year · Sem` (literal label, uppercase) | `SANS` 10pt, `NAVY3`, letterSpacing ~0.5, uppercase, bold |
| Value | `{subject} · {yearLabel} · {semLabel}` → e.g. `Mathematics · Y2 · T2` | `SERIF` 14pt, weight 600, `NAVY`, marginTop 2 |

**Divider:** the whole header `View` gets `borderBottomWidth: 2, borderBottomColor: NAVY, paddingBottom: 14, marginBottom: 14`.

**Data notes for the builder:**
- `code` = the school's **GES/WAEC centre code** (surface: `WR-WAW-014` — Western Region · Wassa Amenfi West · 014). Rendered verbatim from the school record; label is literally **"School code"** (not "GES code").
- `date` = generation timestamp, pre-formatted **`27 June 2026`** style (day month year, no ordinal) in the data builder — the PDF component does no locale/date work (receipt/report-card discipline).
- `yearLabel`/`semLabel` = abbreviated **`Y2` / `T2`** on the eyebrow value; the crumb/lede/banner use the long form **`Semester 2`**. Builder supplies both forms; the sheet uses the short pair here only.

---

## 5. The score table

### 5.1 Column order — EXACT, 8 columns, NO weighted total

thead lines 819–831. Order is **fixed by STPSHS's Capture-Per-Subject screen** (STPSHS_INTEGRATION_SPEC §3 + build-plan done-when). Confirmed **no weighted/total column** (§1 has one; §3 deliberately omits it — STPSHS computes GPA/CGPA itself):

| # | Header label (verbatim) | Align | Cell content | Cell font |
|---|---|---|---|---|
| 1 | `✓` | left | **empty tick box** — teacher hand-ticks as entered (surface glyph `☐`) | drawn box (§7) |
| 2 | `Ass't Ref ID` | left | `{stpshsRef}` e.g. `REF-2024-0142`, or **`pending`** when null (§5.3) | `MONO` |
| 3 | `Student name` | left | `{fullName}` e.g. `Abena Mensah` | `SANS` (Manrope) |
| 4 | `Asg` | center | assignments score | `MONO` |
| 5 | `MS` | center | mid-sem score | `MONO` |
| 6 | `ES` | center | end-of-sem score | `MONO` |
| 7 | `Proj` | center | project score | `MONO` |
| 8 | `Port` | center | portfolio score (**scale flagged — §5.5**) | `MONO` |

> **Hard rule:** never add a 9th "Weighted"/"Total"/"Grade" column. The sheet is the raw five-category capture; the weighted total (report-card side, `15/15/40/15/15`) is intentionally absent.

### 5.2 thead styling (verbatim)
- Row: `backgroundColor: BG` (`#FAF7F2`).
- Each `th`: `fontSize: 9, letterSpacing: ~0.7, textTransform: "uppercase", color: NAVY3, fontWeight: bold, paddingVertical: 7, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: BORDER2` (`#D4CCBA`).
- **`fixed` — the thead `View` repeats at the top of every page** (§6). (`@react-pdf`: `<View fixed>` re-renders on each page break.)

### 5.3 tbody styling (verbatim)
- tbody font: `MONO` (Courier), `fontSize: 10.5`.
- Row `trow` (`wrap={false}` — never split a student across a page break): each `td` `paddingVertical: 5, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: BORDER` (`#E5DFD3`).
- **Tick cell (col 1):** an empty bordered box `View` (~8×8pt, `borderWidth: 1, borderColor: NAVY3`) — printed empty for the teacher to tick by hand. (Do NOT render a `☐` character — §7.)
- **Ref-ID cell (col 2):** `MONO`, `NAVY`. Value `REF-2024-XXXX`, else **`pending`** in `NAVY3` (lowercase, per Q1 — never `—`/`null`/blank here; a Ref-ID column that reads `pending` tells the teacher "not yet registered in STPSHS bio-data", distinct from a missing score).
- **Student-name cell (col 3):** override to `SANS` (Manrope) — the surface explicitly sets `font-family:'Manrope'` on this one cell inside the mono tbody. `NAVY`.
- **Score cells (cols 4–8):** `MONO`, `textAlign:"center"`, `NAVY`. Missing score → `—` (`fmt0`-style, `NAVY3`). Values are the **stored `senior_score_ledger`** per-category values, formatted `.toFixed(0)` (surface shows integers `72`, `68`; ledger stores `NUMERIC` — round for display) **and capped to ≤100 (§5.4)**.

**Body rows drawn on the surface (reference data — 5 of 37 shown, then an ellipsis row):**

| ✓ | Ass't Ref ID | Student name | Asg | MS | ES | Proj | Port |
|---|---|---|---|---|---|---|---|
| ☐ | REF-2024-0142 | Abena Mensah | 72 | 68 | 81 | 75 | 8 |
| ☐ | REF-2024-0143 | Akwasi Boateng | 65 | 74 | 69 | 80 | 7 |
| ☐ | REF-2024-0144 | Ama Asante | 88 | 85 | 89 | 92 | 10 |
| ☐ | REF-2024-0145 | Daniel Owusu | 58 | 62 | 55 | 66 | 5 |
| ☐ | REF-2024-0146 | Efua Adjei | 79 | 74 | 82 | 78 | 9 |

- **Ellipsis row (screen preview only, NOT in the PDF):** `<tr opacity:0.5>` colspan-8, centred, `SANS italic NAVY3 10px`: `… 32 more students on this page and the next`. This is a **preview truncation device** — the real PDF renders **all 37 rows** across pages. Render it in the on-screen mock if the preview is static; **never** in the generated PDF.
- Note the **REF-IDs are sequential** (`0142…0146`) and the **Port column is single-digit** (`8,7,10,5,9`) — both are load-bearing (§5.5, §12).

### 5.4 Over-100 rendering (Q5 — LOCKED)
Owner decision Q5: an over-100 category/total is **flagged in the ledger/verify UI, blocks sheet generation until resolved, and the export is capped to 100** — never silent. Consequences for **this sheet**:
- **The sheet itself only ever shows values ≤100.** By the time generation is permitted (readiness banner "ready"), every over-100 was surfaced and resolved (corrected to ≤100, or explicitly acknowledged), and the export layer clamps to 100. So a score cell renders a plain `100` at most — **no over-100 badge, no red cell, no annotation on the PDF**. The internal `senior_score_ledger` value (e.g. `110`) is unchanged; only the **export** is bounded (data builder: `Math.min(score, 100)` on the pre-formatted value).
- **The flag/block lives upstream** (ledger grid = §1 surface + the readiness banner = §3.3, terra severity). Map it there, not on the sheet.
- **Data-builder contract:** clamp per-category to `[0,100]` for the STPSHS export **only**; do not mutate the ledger. A value that reaches the sheet un-clamped is a bug (Quinn AC: "over-100 flag+block+cap").

### 5.5 Portfolio scale — Kofi's call (Q2, UNRULED) — **flag, do not resolve**
The surface renders `Port` as a **single digit** (`8, 7, 10, 5, 9`) while the other four columns are 0–100. Per INCR-2's denominator rule, the ledger **stores portfolio scaled to 0–100** (raw `8` under a `/10` denominator → stored `80.00`). So there are two candidate renderings and **the build plan leaves this to Kofi (Q2, "Resolve the scale ambiguity")**:
- **(a) Emit stored 0–100 uniformly** → `Port` prints `80` (consistent with the other columns, consistent with what the ledger holds).
- **(b) De-scale portfolio to its raw denominator** → `Port` prints `8` (matches the single digit the teacher physically types into STPSHS if STPSHS's portfolio field is `/10`).

**This map does not choose.** The renderer differs by branch: (a) is `.toFixed(0)` of the stored value; (b) needs the per-category denominator (`ref_assessment_weights` denom cols from INCR-2 Q1b) to divide before display. **Implementer: gate the `Port` cell renderer on Kofi's Q2 ruling; wire the denominator into the data builder either way so branch (b) is a one-line switch.** The other four columns are unambiguous (stored = displayed 0–100). Drift logged (§12.3).

### 5.6 Column widths + alignment (recommended; verify in preview)
Surface fixes only the tick col (`width:28px`) and centres cols 4–8; Ref-ID and name are `auto`. For **print stability** give fixed widths to everything except the flexible name column. Starting recommendation for a 515pt content width (**tune against the longest real Ghanaian name + a 13-char REF at 10.5pt Courier in the live preview — this is the calibration knob, not a fixed truth**):

| Col | Width | Align |
|---|---|---|
| ✓ | 22pt | left |
| Ass't Ref ID | 92pt (fits `REF-2024-0142` at 10.5pt Courier) | left |
| Student name | flex (remaining ≈ 149pt) | left |
| Asg / MS / ES / Proj / Port | 30pt each (150pt) | center |

If a long name overflows one line, either shrink the numeric cols to ~28pt or drop body font to 10pt — verify no name wraps to two lines (a wrapped name misaligns the row visually). Keep `wrap={false}` on the row so a near-page-bottom row pushes whole to the next page.

---

## 6. Pagination (37+ roster)

Surface footer literally reads `Page 1 of 2` and the actions button `Download PDF · 2 pages` — 37 students paginate. `@react-pdf` auto-flows rows across `Page` height; the work is **repeating chrome + page numbers**:

- **Repeat the thead per page:** mark the thead `View` `fixed` — it re-renders at the top of every page so page 2 opens with the column headers, not a headless table. (Alternative: `@react-pdf` `wrap` semantics; `fixed` on the header row is the simplest.)
- **Repeat the footer per page:** the footer `View` is `fixed` (report-card precedent, `s.footer` `fixed`), pinned bottom.
- **`Page N of M`:** `<Text fixed render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages} · Generated by Omnischools`} />` in `MONO`. This is the surface's right-hand footer string, dynamic. (The surface's static `Page 1 of 2` becomes the render-callback form.)
- **Rows never split:** `wrap={false}` per `trow` (§5.3).
- **Page count is data-driven**, not hard-coded "2" — feeds the page-head "Download PDF · N pages" label (§1.2). A ≤~32-row class = 1 page; 37 = 2.
- **The screen-preview ellipsis row is not paginated content** — it is the truncation stand-in and never appears in the multi-page PDF (§5.3).

### 6.1 Footer legend (verbatim)
Surface lines 841–844: a `View`, `borderTopWidth: 1, borderTopColor: BORDER, marginTop: 16, paddingTop: 12, flexDirection:"row", justifyContent:"space-between"`, `fontSize: 10, color: NAVY3`:
- **Left (`SANS`):** `Asg = assignments · MS = mid-sem · ES = end-of-sem · Proj = project · Port = portfolio`
- **Right (`MONO`):** `Page {N} of {M} · Generated by Omnischools`

Both halves `fixed` (repeat per page). The legend is the only footer legend on the sheet — no grade key (unlike the report card; STPSHS wants raw scores, not grades).

---

## 7. Fonts / tokens — print-safe (two gotchas)

**Fonts (`lib/pdf/fonts.ts` core stand-ins):** `SERIF`=Times-Roman (Fraunces roles: sheet title, eyebrow value, ph-title, readiness icon), `SANS`=Helvetica (Manrope: body, **student-name cells**, meta, banner), `MONO`=Courier (JetBrains Mono: **scores, Ref ID, Page N of M**). The follow-up in `fonts.ts` (register real brand TTFs) is a one-file swap and does not change this map.

**Gotcha 1 — checkbox glyphs are NOT in the core-font WinAnsi set (load-bearing).** The surface uses `✓` (U+2713, thead) and `☐` (U+2610, tbody). **Times-Roman / Helvetica / Courier only cover WinAnsi/Latin-1 — both glyphs render as blank/tofu.** So:
- **tbody tick cell:** draw an **empty bordered box `View`** (§5.3), not a `☐` character. This also reads better on paper (a clean box to tick).
- **thead `✓` label:** a literal `✓` will not render. Options: (i) leave the header cell blank (the box column is self-evident), (ii) label it `Done` / `Entered` in `SANS`, or (iii) draw a small check. **Recommendation: blank header cell + drawn boxes below** — simplest, print-clean. If the brand TTFs (fonts.ts follow-up) later include these glyphs, the literal `✓`/`☐` can return. Flag to Quinn; verify in the rendered PDF, not the JSX.
- WinAnsi-safe punctuation used elsewhere is fine: `—` (U+2014), `·` (U+00B7) both render on core fonts.

**Gotcha 2 — token-opacity trap (verify in live preview).** All §3 tints are **solid tokens**: thead `bg` = `BG`; readiness gradients use solid `GREEN_BG`/`GREEN` and `GOLD_BG`/`GOLD`; borders `BORDER`/`BORDER2`; over-100 flag `TERRA`/`TERRA_BG`. On the **PDF** side this is moot (hex constants, no Tailwind). On the **host-screen** React side, **never** express these as slash-opacity on raw-hex tokens (`bg-green/10`, `border-gold/50`, `text-navy-2/70`) — that silently breaks on the raw-hex token set (memory `no-alpha-token-opacity`). Use the dedicated `-bg` tints / solid tokens / `opacity-N`. The readiness banner's two gradient states are the highest-risk spot on this surface (both are coloured tints). Verify in the live preview, not the build.

---

## 8. Data → cell mapping (the data builder contract — `lib/data/stpshs-sheet-data.ts`)

Server-only (`import "server-only"`; imports the driver — the client button must hit the download route, never import this module). Keyed by `class × subject × period`; reads via `withSchool` (tenant-scoped) + role gate. Pre-formats **every** string so the PDF component does zero data/locale/clamp logic (receipt/report-card discipline).

| Sheet element | Source | Builder responsibility |
|---|---|---|
| Header title | school record | `${school.name} · STPSHS Score Sheet` |
| Header code | school GES/WAEC centre code | verbatim, label "School code" |
| Header date | generation `now()` | format `27 June 2026` (day month year) |
| Eyebrow value | subject + academic year + semester | `${subject} · Y${n} · T${n}` |
| Ref-ID cell | `students.stpshs_ref` (nullable, Wells **migration 0042**, Q1) | value or literal **`pending`** when null |
| Student-name cell | active-student roster | full name; **only active students**, one row each |
| Score cells (Asg/MS/ES/Proj/Port) | `senior_score_ledger` per category | `Math.min(value, 100)` clamp (Q5) → `.toFixed(0)`; null → `—`; **`Port` scale per Kofi Q2 (§5.5)** |
| Page count | row count ÷ page capacity | for the "Download PDF · N pages" label |
| Generation audit | `recordAudit`→`auditLog` | who / class×subject×period / when — **no score values in the payload** (build-plan + Sarah gate) |

**Row set = active students only, one row per student** (build-plan done-when). An inactive/withdrawn student does not appear. A student with no ledger row is a Q3 question (does the sheet include them with `—` cells, and does that keep the button gated?) — **unruled (Q3); flag (§12.4).**

---

## 9. Owner decisions reflected (Q1 / Q5, LOCKED 2026-07-15)

- **Q1 — REF-ID = nullable `stpshs_ref` on `students` (Wells migration 0042); render `pending` until the real IDs are ingested by a future STPSHS bio-data increment.** The surface shows populated `REF-2024-XXXX`; production shows `pending` for every student until ingest. Both are drawn/mapped (§5.3). Uniqueness = per student for the 3-year cycle (STPSHS spec §2). Wells is on the critical path; the PDF renders whatever the builder supplies.
- **Q5 — >100 = flag + block generation + cap to 100 (never silent).** Flag + block live on the host screen / ledger (§3.3); the **sheet only ever shows ≤100** (§5.4); the ledger value is untouched, only the export is clamped.

**Unruled (Kofi Q2/Q3/Q4 — flagged, NOT resolved here):** Q2 portfolio scale (§5.5), Q3 which rows qualify + incomplete-blank rendering + button gating (§3.3, §8), Q4 not applicable to this sheet (reason codes are an Item-4 concern). Gate the affected renderer/gating on the ruling.

---

## 10. Generation / render-state inventory (every state on §3)

| Region | State | Presentation |
|---|---|---|
| Readiness banner | ready | green border + `✓` icon + green-bg gradient; download enabled |
| Readiness banner | pending / blocked (incomplete Q3, or unresolved over-100 Q5) | gold border + `!` icon + gold-bg gradient (or warn per §3.3); download **disabled** |
| Page-head action | generate enabled / disabled | `.btn.primary` active / disabled; label "Download PDF · N pages" |
| Ref-ID cell | populated / null | `REF-2024-0142` (`MONO NAVY`) / **`pending`** (`NAVY3`) |
| Score cell | value / missing | `72` (`MONO NAVY`) / `—` (`NAVY3`) |
| Score cell | would-be over-100 | never on the sheet — capped to `100` upstream (Q5) |
| Portfolio cell | scale (a) stored 0–100 / (b) de-scaled raw | **Kofi Q2 branch — unresolved (§5.5)** |
| Tick cell | always empty | drawn bordered box (teacher hand-ticks) |
| Table | populated / empty | one row per active student / `No scores entered for this period.` empty-row (report-card `emptyRow` idiom — spec-added, verify with Q3) |
| Pagination | 1 page / N pages | `Page 1 of 1` / `Page N of M`; thead+footer repeat per page |
| Preview panel (screen) | truncated | ellipsis row `… 32 more students…` (screen only, never in PDF) |
| Preview panel (screen) | WYSIWYG | mirrors the PDF exactly (same component or matched mock) |

---

## 11. Component / build mapping (§3 region → target)

| §3 region | Reuse | New work for Item 8 |
|---|---|---|
| App shell / sidebar / page-head | ledger `page.tsx` shell + hero idiom | swap copy + `/stpshs-export` crumb + Re-open/Download actions + gating |
| Readiness banner | — | `.stpshs-ready` ready/pending states; wire to Q3 completeness + Q5 over-100 gate |
| Preview panel | — | `@react-pdf` `<PDFViewer>` of the document, or a matched static mock |
| **PDF document** | **`receipt-document.tsx` structure + `report-card-document.tsx` A4/footer** | **`lib/pdf/stpshs-score-sheet-document.tsx`** — strip, header, 8-col table, per-page thead+footer, page numbers, drawn tick boxes |
| PDF render fn | `render-receipt.tsx` | `lib/pdf/render-stpshs-sheet.tsx` — `server-only`, `renderToBuffer`, returns `Buffer` |
| Data builder | `lib/data/receipt-data.ts` shape | `lib/data/stpshs-sheet-data.ts` — server-only, tenant-scoped, pre-formatted rows, clamp 0–100, Ref `pending`, Port-scale per Q2 |
| Download route | `app/api/receipts/[paymentId]/route.ts` | keyed class×subject×period; `requireSchool` + `assertAnyRole(SENIOR_LEDGER_ROLES)` + `withSchool`; `application/pdf`, `private, no-store` |
| Audit | `recordAudit`→`auditLog` | log generation (who/what/when), **no score values in payload** |
| REF column | Wells **migration 0042** `students.stpshs_ref` | nullable; `pending` render until ingest (Q1) |
| Fonts | `lib/pdf/fonts.ts` | reuse core stand-ins; **draw tick boxes, don't use `☐`/`✓` glyphs** (§7) |

---

## 12. Open questions / drift log

1. **`✓`/`☐` checkbox glyphs are outside the core-font WinAnsi set.** Times/Helvetica/Courier render them blank. Draw an empty bordered `View` for the tick cell; blank (or `SANS` word) header cell. Load-bearing — verify in the rendered PDF, flag to Quinn (§7).
2. **Screen ellipsis row `… 32 more students…` is a preview truncation device only** — never in the generated multi-page PDF. The PDF renders all 37 rows paginated (§5.3, §6).
3. **Portfolio scale is Kofi's Q2 call — UNRULED (do not resolve).** Surface shows single-digit `Port` (`8`); ledger stores scaled 0–100 (`80`). Branch (a) emit stored 0–100, or (b) de-scale to raw denominator to match STPSHS's field. Renderer differs; wire the denominator in either way so it's a one-line switch (§5.5).
4. **Q3 (which rows qualify + incomplete rendering + button gating) is UNRULED.** Only-`STPSHS_READY` vs all-`COMPLETE` vs all-including-incomplete; how a missing category renders (`—`?) and whether the button stays gated. The readiness banner + empty-cell handling depend on this (§3.3, §8, §10). Flag, don't resolve.
5. **"NO weighted-total column" is a hard rule** (build-plan done-when; STPSHS computes GPA). §1 has a weighted column; §3 must not. The banner's `15/15/40/15/15` weights are report-card context copy only — not a sheet column (§2, §5.1).
6. **Over-100 never appears on the sheet** (Q5 caps the export upstream); the flag/block is host-screen/ledger, terra severity. The PDF cell renders `100` at most, no annotation (§5.4).
7. **REF renders `pending`, not `—`/`null`** (Q1). Distinct from a missing score (`—`): `pending` = "not yet STPSHS-registered", `—` = "no score" (§5.3).
8. **Page count is dynamic**, not hard-coded 2 — drives the "Download PDF · N pages" label and the `Page N of M` footer (§1.2, §6).
9. **Header label is "School code", value `WR-WAW-014`** (GES/WAEC centre code) — the task brief's "GES code" is this field; render the surface's literal "School code" label (§4).
10. **Token-opacity trap** — host-screen React only; PDF uses hex constants. Readiness-banner gradients are the high-risk spot; use solid `-bg`/`opacity-N`, never slash-opacity on raw-hex. Verify in live preview (§7, memory `no-alpha-token-opacity`).
11. **Server-only data builder** — `stpshs-sheet-data.ts` imports the driver; the client Download button must trigger the route, never import the module (only `pnpm build` catches the leak; memory `reports-data-is-server-only`).

---

*Map produced against: `Surfaces/schoolup-shs-score-ledger.html` §3 (markup ~740–863; sheet ~808–845; CSS 34–36, 86–89, 117–123, 329–334); `md files/STPSHS_INTEGRATION_SPEC.md` §2/§3; `md files/design-tokens.json` v1.0.0; `omnischools/docs/senior-build-plan.md` INCR-3 (owner Q1/Q5 LOCKED; Kofi Q2/Q3/Q4 unruled); existing `lib/pdf/receipt-document.tsx`, `render-receipt.tsx`, `report-card-document.tsx`, `fonts.ts`; format precedent `omnischools/docs/senior/path-b-scan-surface-map.md`.*
