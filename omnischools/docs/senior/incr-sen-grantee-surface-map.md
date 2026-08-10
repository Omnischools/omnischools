# SEN Grantee Accommodation Surface — Surface Map (OC-SEN-TEACHER-SURFACE)

**Author:** Lucy (design cartographer) · **Status:** design spec, ready for the implementation engineer (Claude Code).
**Resolves:** `OC-SEN-TEACHER-SURFACE` — give `components/sen/sen-grantee-view.tsx` a real, considered design (it ships today as a functional placeholder).
**Scope:** the GOV-10b (R436) **grantee** view — the accommodation-only view a teacher sees when an administrator has granted them per-student SEN access. **No dedicated surface mock exists**; this card is designed from scratch, harmonised 1:1 with the shipped SEN **admin** surface's design language.

> **This surface has no analogue in the admin register's weight.** It is a *slim per-student accommodation reference*, not a dashboard. There are **no stats, no hero tiles, no census grid, no diagnosis column, no consent line, and no other students** — every one of those is admin-only and MUST NOT appear here. The teacher plans classroom support; that is all.

---

## 0. Sources (read before building)

| Source | Role |
|---|---|
| `components/sen/sen-grantee-view.tsx` | The current **placeholder** this spec replaces. Its skeleton (page frame + empty state + card grid) is broadly right; this spec upgrades card anatomy, adds the privacy strip, `level`, and the multi-category seam. |
| `lib/sen/register-data.ts` → `SenAccommodationRecord` + `getSenAccommodationsForGrantee` (R436/R437) | **The only data available.** The reader lives inside the SEN sole-content-path file and is scoped to the teacher's *live-granted* students, GRANTED rows only. |
| `lib/sen/vocab.ts` | `SEN_CATEGORY_LABEL` / `SEN_CATEGORY_PILL` / `SEN_SEVERITY_LABEL` / `SEN_SEVERITY_PILL` — **reuse verbatim**, do not re-derive colours. |
| `Surfaces/schoolup-special-needs.html` | The **admin** surface — visual source of truth for the design *language* (tokens, pill treatment, tag treatment, type scale, tone). This grantee card is its restricted sibling. |
| `app/(app)/students/special-needs/page.tsx` + `components/sen/sen-register-table.tsx` | The **shipped** token usage (`rounded-xl`, `border-border`, `bg-surface`, `bg-gold-bg`, the privacy banner, the `pillBase` / accommodation-tag / initials-avatar treatments). Match these — do not invent new patterns. |

**Enforcement already in place (do not re-implement, do not weaken):** `page.tsx` gates the view — admin → full register; else a live-grant holder (`hasAnyLiveSenGrant`) → this view (`getSenAccommodationsForGrantee`); else `notFound()`. `SenAccommodationRecord` **structurally omits** every diagnosis/consent/census field — adding one is a compile/test failure. The design must never reach for data the type does not carry.

---

## 1. The data — the ONLY fields available (R436)

```ts
type SenAccommodationRecord = {
  studentName: string;
  className: string | null;   // e.g. "JHS 3A" / "Form 2 Science" — already encodes level+section
  level: string | null;       // e.g. "JHS 3" / "Form 2" — fallback when className is null
  category: SenCategory;       // VISUAL | HEARING | PHYSICAL | INTELLECTUAL | SPEECH | OTHER
  severity: SenSeverity | null;// MILD | MODERATE | SEVERE  — NULLABLE
  supportNotes: string | null; // free text — NULLABLE
  accommodations: string[];    // tag list — may be empty
};
```

**Consequences for the design (important):**
- **No `sex`, no `age`, no `id`.** The admin table's identity meta (`className · boy · age 14`) **cannot** be reproduced — the grantee identity meta is **class/level only**. Do not fabricate sex/age.
- **No diagnosis / clinician / institution / year / consent** — the entire right-hand "Diagnosis & consent" column of the admin table is **structurally absent**. Do not add it.
- One record = one **(student × category)**. Today that is one row per student (R415). See §5 (forward-compat) for why the card is nonetheless built around a **list** of categories per student.

---

## 2. Token & type reference (only what this surface uses)

Use the Tailwind **token class**, never `var(--x)` or a raw hex. All confirmed present in `styles/tokens.css`.

| Token class | Hex | Used for on this surface |
|---|---|---|
| `text-navy` / `bg-navy` | `#1A2B47` | student name, primary emphasis |
| `text-navy-2` | `#2D3F5C` | support-notes body, in-copy bold |
| `text-navy-3` | `#5C6675` | eyebrow, lede, meta line, accommodation-tag text, empty-state copy |
| `text-gold` / `bg-gold` | `#C8975B` | italic title accent, eyebrow accent, privacy `!` badge, VISUAL pill text |
| `border-gold-soft` / `bg-gold-bg` | `#E8D4B8` / `#F5EBDC` | privacy strip, initials avatar bg, VISUAL pill bg |
| `bg-bg` | `#FAF7F2` | page ground, accommodation-tag bg |
| `bg-surface` | `#FFFFFF` | card bg, empty-state card |
| `text-green` / `bg-green-bg` | `#2F6B47` / `#E5EFE8` | HEARING pill, MILD severity |
| `text-terra` / `bg-terra-bg` | `#B84A39` / `#F5E1DC` | PHYSICAL pill, SEVERE severity |
| `text-warn` / `bg-warn-bg` | `#C58A2E` / `#F5E9D0` | SPEECH pill, MODERATE severity |
| `text-sen-intellectual` / `bg-sen-intellectual-bg` | `#5847B5` / `#E8E5F2` | INTELLECTUAL pill (named token — never inline the hex) |
| `border-border` | `#E5DFD3` | card border, accommodation-tag border, divider between category blocks |
| `border-border-2` | `#D4CCBA` | (available; not needed here unless a button is added) |

**Type families:** `font-display` = Fraunces (page `h1` + its italic gold `<em>`, and the initials avatar glyph). `font-body`/default = Manrope (everything else — name, meta, notes, tags, pills). No JetBrains Mono on this surface (no numeric data to render). `rounded-pill` and `max-w-page` are the shipped utility classes (present in the admin page).

> **[[no-alpha-token-opacity]] — hard rule.** Every pill/tag here uses a **solid `-bg` tint token** (`bg-gold-bg`, `bg-green-bg`, `bg-sen-intellectual-bg`, …) and a solid `text-*` token — exactly as `vocab.ts` already defines them. **Never** introduce slash-opacity on a raw-hex token (`text-navy-2/70`, `bg-navy/80`) — it silently no-ops on these tokens. `opacity-N` is fine if ever needed. Verify tints in the live preview, not the build.

---

## 3. Page frame (top-to-bottom, before the cards)

Container: `<div className="mx-auto max-w-page space-y-6">` (unchanged from the placeholder). The frame is three stacked blocks: **eyebrow + title + lede**, then the **privacy reassurance strip**, then the **card region**.

### 3.1 Eyebrow + title + lede

Mirrors the admin `page.tsx` header idiom, retitled for the teacher.

- **Eyebrow** — `text-[11px] font-semibold uppercase tracking-wide text-navy-3`:
  `Students / ` + `<span className="text-gold">Accommodations</span>`
- **Title** — `font-display text-3xl font-medium text-navy`:
  `Support ` + `<em className="italic text-gold">accommodations</em>`
- **Lede** — `mt-1 max-w-[740px] text-sm text-navy-3` (bold spans in `text-navy-2`):
  > Classroom accommodations for the students an administrator has granted you access to · **for accommodation planning only**. You do not see diagnoses, consent records, the census, or any other students.

  (Copy retained from the placeholder, with "the census" added so the exclusion list matches the admin banner's scope. Ghanaian-operations voice: this is the teacher's-side echo of the admin banner's "visible only to school administrators … unless an administrator explicitly grants access for accommodation planning.")

### 3.2 Privacy reassurance strip (the teacher-side mirror of the admin banner) — NEW

The admin surface opens with a full 2-column gold banner ("Treated as *sensitive personal data*"). The teacher gets the **same tone and tokens, at a slimmer weight** — a single reassurance line, one badge, no hero mass. This is the requested "brief privacy reassurance line."

Structure — reuse the admin banner's exact container + badge, shorter body:
```
<div className="grid grid-cols-[28px_1fr] items-start gap-3.5 rounded-xl border border-gold-soft bg-gold-bg px-4 py-3.5">
  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gold font-display text-[13px] font-bold text-navy">!</div>
  <div className="text-xs leading-relaxed text-navy-2">
    <b className="text-navy">Confidential — treat with care.</b> An administrator granted you access
    to these students' classroom accommodations so you can plan lessons around them. This is
    <b className="text-navy"> sensitive personal data</b> — keep it to your teaching of these students,
    and do not share or copy it. You are shown support needs only, never diagnoses or medical records.
  </div>
</div>
```
- Tokens identical to the admin banner (`border-gold-soft bg-gold-bg`, the `bg-gold` `!` badge) so the two surfaces read as siblings.
- **On mobile** the 28px badge column holds; the copy wraps. No layout change needed — the `grid-cols-[28px_1fr]` is fluid.
- **Placement:** directly under the lede, above the cards — boundary before data, exactly as the admin banner sits before the register. This strip renders in **every** state, including empty (§4.1).

---

## 4. The accommodation card — anatomy

**One card = one student** (see §5 for why this matters). Card container matches the placeholder/admin card:
`rounded-xl border border-border bg-surface p-4`.

The card has three tiers, top to bottom: **(A) identity header → (B) one-or-more category blocks → (C) nothing else.** No footer, no actions, no menu — the teacher reads, does not edit (all mutation is admin-side).

### 4.A Identity header

Harmonise with the admin table's `.student-name-cell` (initials avatar + name + meta), not the placeholder's bare name+right-aligned-class. This ties the grantee card visually to the register.

```
<div className="grid grid-cols-[32px_1fr] items-center gap-2.5">
  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gold-bg font-display text-[11px] font-semibold text-navy">
    {initials(studentName)}      {/* reuse the admin table's initials() helper — first 2 words, upper */}
  </div>
  <div>
    <h2 className="text-sm font-semibold text-navy">{studentName}</h2>
    <div className="text-[11px] italic text-navy-3">{classLabel}</div>
  </div>
</div>
```
- **`classLabel` = `className ?? level ?? "Unassigned"`.** `className` (e.g. "JHS 3A" / "Form 2 Science") already encodes the level and section, so it is the primary read; `level` is the fallback for a student with no class assignment; `"Unassigned"` is the final fallback (matches the admin table's `?? "Unassigned"`). **Do not print both `className` and `level`** — it is redundant (JHS 3A already implies JHS 3).
- **`h2`** is deliberate for heading order (§7). Visual size (14px) is unrelated to semantic level.
- Avatar is the recommended treatment (matches the admin surface); it may be dropped for maximum slimness, but keep it for language parity.

### 4.B Category block(s) — the core

Render **one block per category the student carries**, in canonical `SEN_CATEGORY_ORDER` (Visual → Hearing → Physical → Intellectual → Speech → Other). Today that is exactly one block; multi-category (§5) yields several. Each block is:

```
[ category pill ] [ severity pill? ]          ← pill row
support notes paragraph (if present)          ← optional
[tag] [tag] [tag]                             ← accommodation tags (if any)
```

Between the identity header and the first block: `mt-2`. Between successive blocks (multi-category only): a hairline divider — `mt-3 border-t border-border pt-3` — so the reader sees clearly *which severity and which supports belong to which need*.

**(1) Pill row** — `flex flex-wrap items-center gap-1.5`:
- **Category pill** (always present) — `pillBase` + `SEN_CATEGORY_PILL[category]`:
  `inline-flex items-center rounded-pill px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide` + the vocab class.
  Label = `SEN_CATEGORY_LABEL[category]`. (The `OTHER` variant carries its own `border border-border bg-bg text-navy-3` — that is expected; reuse the map, do not special-case.)
- **Severity pill** (only if `severity != null`) — smaller, subordinate to the category, matching the surface's `.severity-tag` being smaller than `.category-tag`:
  `inline-flex items-center rounded-pill px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide` + `SEN_SEVERITY_PILL[severity]`.
  Label = `SEN_SEVERITY_LABEL[severity]`. **When `severity` is null, render nothing** — no dash, no "unrated" placeholder (unlike the admin *table*, which shows `—` to keep column alignment; a card has no column to align, so omission is cleaner).

**(2) Support-notes paragraph** (only if `supportNotes` is a non-empty string):
`mt-2 text-[12px] leading-relaxed text-navy-2` — the plain-English support description ("Wears prescription glasses · seated front row", "Stammer · receives weekly speech therapy"). Keeps the surface's everyday-language voice. **When null/empty, omit the paragraph entirely** (no empty `<p>`, no dash).

**(3) Accommodation tags** (only if `accommodations.length > 0`) — `mt-2 flex flex-wrap gap-1`, each tag verbatim from the admin treatment:
`rounded border border-border bg-bg px-1.5 py-0.5 text-[9px] font-semibold text-navy-3`.
These are the concrete, actionable supports ("Front-row seating", "Ground-floor classroom", "Extra time between periods", "No forced public reading"). **When the array is empty, omit the tag row.**

### 4.C Nothing else

No diagnosis text, no consent line, no "granted by / expires" metadata (that lives on the admin `SenGrantRow`, not on `SenAccommodationRecord`), no edit/withdraw buttons. The card ends after the last category block.

---

## 5. Forward-compat: multi-category per student (OC-SEN-MULTI-CATEGORY, Kofi) — IMPORTANT

A parallel ruling may let one student hold **several** support categories. The card in §4 is built for that **now**, so the same design ships whether or not multi-category lands:

- **The card is keyed by student, not by record.** §4.B renders a **list** of category blocks. With single-category data the list has length 1 and the card looks exactly like the intended slim card; with multi-category data it grows to N stacked blocks, each carrying **its own** severity / notes / tags (because in the data model `severity`, `supportNotes`, and `accommodations` are per-category columns — a merged "one severity, one notes blob" would misrepresent which support belongs to which need). No conditional redesign is required — it is a `.map`.

- **The grouping step is the only new logic.** `getSenAccommodationsForGrantee` returns `SenAccommodationRecord[]` = one row per (student × category). The view must **group rows into per-student cards** before rendering:
  ```
  type GranteeStudentCard = {
    studentName: string;
    classLabel: string;                 // className ?? level ?? "Unassigned"
    categories: {                       // sorted by SEN_CATEGORY_ORDER
      category: SenCategory;
      severity: SenSeverity | null;
      supportNotes: string | null;
      accommodations: string[];
    }[];
  };
  ```
  Today every group has exactly one entry; multi-category simply lifts that to N. Build the grouping now.

- **Grouping key — a seam to flag, not to over-engineer.** `SenAccommodationRecord` carries **no `studentId`** — only `studentName`. Grouping by name is safe *for this surface* because the grantee set is tiny (only the handful of students one teacher was granted), so a name collision within one teacher's grants is near-impossible.
  `// ponytail: group by studentName; grantee set is a handful, collisions ~impossible. Upgrade: add studentId to SenAccommodationRecord when multi-category lands, group by id.`
  Adding `studentId` to the record/reader is a **data-shape decision owned by Kofi**, not this design — flagged in the drift log (§9). Until then, group by `studentName`.

- **Card-count vs record-count today.** Because current data is one category per student, grouping is a no-op on the happy path — but the placeholder currently renders **one card per record**, which would produce two cards for one student the moment multi-category lands. Grouping-before-render is therefore a real (small) change, not cosmetic.

---

## 6. States (exhaustive)

This is a **server component** (`page.tsx` awaits the reader; `export const dynamic = "force-dynamic"`). There is **no client loading spinner and no client error state** — the whole surface is server-rendered, exactly like the admin page. Non-grantees never reach it (`notFound()` upstream). So the state matrix is content-driven only:

| State | Trigger | Render |
|---|---|---|
| **Empty (no live grants → no records)** | `records.length === 0` | Frame (§3) renders in full — **including the privacy strip** — then a single centred card: `rounded-xl border border-border bg-surface p-8 text-center text-sm text-navy-3` with copy: *"No accommodation records to show. When an administrator grants you access to a student, their classroom accommodations appear here."* (Retained from the placeholder.) No card grid. |
| **Single-category student** | group has 1 entry | §4 card, one category block. The common/only case today. |
| **Multi-category student** | group has ≥2 entries (post OC-SEN-MULTI-CATEGORY) | §4 card, N category blocks separated by the `border-t border-border` divider. |
| **Minimal (tags only)** | `severity == null` **and** `supportNotes == null`, `accommodations.length > 0` | Category pill → (no severity pill) → (no notes) → tag row. |
| **Bare (category only)** | `severity == null`, `supportNotes == null`, `accommodations.length === 0` | Just the identity header + a lone category pill. Valid and expected — a granted student with no severity, notes, or tags recorded. Nothing extra, no dashes. |

**No error/loading/skeleton states** — note this so the implementer does not scaffold them. If the reader throws, the framework error boundary handles it; there is no bespoke UI here.

---

## 7. Responsive · accessibility

**Responsive (mobile-first):**
- Card region: `grid gap-3 sm:grid-cols-2` (verbatim from the placeholder). **Mobile = single-column stack; ≥`sm` = 2-up.** Do not go 3-up — this is a slim reference; 2 columns is the ceiling so cards stay readable.
- Frame stays within `mx-auto max-w-page`. The privacy strip's `grid-cols-[28px_1fr]` is fluid and needs no breakpoint.
- Category blocks: `flex-wrap` on both the pill row and the tag row means long labels/tag sets reflow on narrow screens with no overflow.

**Accessibility:**
- **Heading order:** page `h1` (§3.1 title) → each card's student name is `h2` (§4.A). No skipped levels; no heading inside the pills/tags. The empty-state card carries no heading (it is a status message, not a section).
- **Colour is never the only signal.** Every category pill shows its **text label** (`Visual`, `Hearing`, …) and every severity pill shows `Mild`/`Moderate`/`Severe` — a colour-blind reader loses nothing. Do not remove the labels to rely on hue.
- **Contrast:** all pill/tag token pairs are the same AA-checked pairs the admin surface ships (`text-green` on `bg-green-bg`, `text-sen-intellectual` on `bg-sen-intellectual-bg`, `text-navy-3` on `bg-bg`, etc.). The 9px accommodation tags (`text-navy-3` on `bg-bg`, ≈5:1) and 10–11px pills are small but meet AA for their weight; **keep the token pairs, do not tint them lighter.**
- **No-alpha rule (repeat, because it is the classic break here):** solid tint tokens only; verify pill fills in the **live preview**, not the build — a slash-opacity slip renders transparent, not tinted.
- The card is static text (no interactive control), so no focus-order, ARIA-role, or keyboard concerns beyond normal document flow.

---

## 8. Component / build mapping

| Region | Source to match | Work for this surface |
|---|---|---|
| Page frame (eyebrow/title/lede) | admin `page.tsx` header block | retitle to "Support *accommodations*"; keep the placeholder's copy + add "the census" to the exclusion list |
| Privacy strip | admin `page.tsx` privacy banner (§3.2) | reuse container + `!` badge; **shorter teacher-side body** |
| Empty state | placeholder empty card | keep verbatim |
| Per-student grouping | — (new, small) | group `records` → `GranteeStudentCard[]` by `studentName`, sort categories by `SEN_CATEGORY_ORDER` (§5) |
| Identity header | `sen-register-table.tsx` `.student-name-cell` (avatar + name + meta) + its `initials()` | reuse `initials()`; `classLabel = className ?? level ?? "Unassigned"` |
| Category pill | `vocab.ts` `SEN_CATEGORY_PILL/LABEL` + `pillBase` | reuse verbatim |
| Severity pill | `vocab.ts` `SEN_SEVERITY_PILL/LABEL` | reuse; render only when non-null; 10px subordinate size |
| Support notes | placeholder notes `<p>` / admin support cell | `text-[12px] leading-relaxed text-navy-2`; omit when null |
| Accommodation tags | admin/​placeholder accommodation tag | `rounded border border-border bg-bg px-1.5 py-0.5 text-[9px] font-semibold text-navy-3`; omit when empty |
| Multi-category divider | — (new) | `border-t border-border pt-3 mt-3` between blocks |

All of it lives in `components/sen/sen-grantee-view.tsx` (a client-free presentational component fed by the server `page.tsx`). No new files, no new tokens, no new vocab.

---

## 9. Cross-module hooks & boundary commitments (preserve these)

- **Grant → this view (GOV-10b, R435/R436):** the *only* way a teacher reaches this surface is a **live SEN support grant** (`hasAnyLiveSenGrant`), and the *only* students shown are that teacher's `liveSenGrantStudentIds`. The design assumes — and must not widen — that scope. No "search all students", no roster, no directory.
- **De-identification-at-the-type-level:** the surface's confidentiality is enforced by `SenAccommodationRecord` **not carrying** diagnosis/consent/census fields (mirrors `lib/vlc/pastoral-flags.ts`). The design honours this by having **nowhere to render them**. If a future record shape sprouts such a field, that is a red flag to escalate, not a new card row to add.
- **Register ↔ grantee sibling:** this card and the admin register share `vocab.ts` (category/severity colour + label vocabulary). A change to a category colour or label flows to both automatically — do not fork the vocab for the teacher view.

---

## 10. Open questions / drift log

1. **`studentId` for safe grouping (Kofi / data-shape).** Per-student cards + multi-category want a stable grouping key; `SenAccommodationRecord` has none. **Recommendation:** when OC-SEN-MULTI-CATEGORY lands, add `studentId` to the record and reader and group by it. Until then, group by `studentName` (ceiling noted in §5 — safe for the small grantee set). **This is a data-model decision, not a design one — flagged for the owner of the SEN reader.**
2. **Card avatar (language-parity vs slimness).** The initials avatar (§4.A) is included to match the admin surface's identity treatment; it is the one "non-slim" element. Kept for parity. If the owner wants the leanest possible card, dropping the avatar is a one-line removal — confirm the preference; default is **keep**.
3. **Severity omission vs dash.** The admin *table* renders `—` for null severity (column alignment). This card **omits** the severity pill entirely when null (no column to align). Intentional drift from the table; called out so it is not "fixed" back to a dash.
4. **`level` is currently redundant with `className`.** The type carries both; `className` already encodes level+section, so the card shows `className` and treats `level` only as a fallback. If a future need arises to surface `level` independently (e.g. a level eyebrow), it is available — but showing both today is redundant. No action; noted so the unused `level` field is not mistaken for missing design.
5. **No loading/error/skeleton states by design (§6).** Server-rendered, `force-dynamic`, gated upstream. The implementer should **not** scaffold client states; the framework error boundary covers failure.

---

*Map produced against: `components/sen/sen-grantee-view.tsx`, `lib/sen/register-data.ts` (`SenAccommodationRecord` / `getSenAccommodationsForGrantee`), `lib/sen/vocab.ts`, `lib/sen/grants.ts`; `Surfaces/schoolup-special-needs.html`; the shipped `app/(app)/students/special-needs/page.tsx` + `components/sen/sen-register-table.tsx`; `styles/tokens.css`. No dedicated surface mock exists for this view — the card is designed from scratch, harmonised with the admin surface's language.*
