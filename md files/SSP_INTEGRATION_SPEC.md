# Omnischools Senior · SSP (Subject Specific Apps) Integration Specification

**Status:** Research complete. Integration design proposed. Lower-priority and lower-risk than the STPSHS spec — the SSP ecosystem is a productivity tool, not a regulatory submission system, and the integration question is correspondingly less load-bearing.

This document specifies how Omnischools Senior relates to the **Subject Specific Apps (SSP)** ecosystem — a family of AI-powered, subject-and-year-specific lesson-planning assistants built by NaCCA and CENDLOS for Ghana's 2024/25 SHS curriculum, distributed through Professional Learning Community (PLC) sessions.

It is derived from the [Ministry of Education curriculum microsite](https://curriculumresources.edu.gh/), the PLC Government Year 2 manual on curriculumresources.edu.gh, and the ethical-AI-in-education coverage published in November 2025.

---

## 1. What SSP actually is

SSP is **not one app** — it is a *family* of apps, one per **(subject × year)** combination, covering the ~30 subjects of the new SHS curriculum across Years 1, 2, and 3 (Year 3 still being phased in alongside the curriculum rollout). Each app is an AI assistant scoped to a single subject for a single year — "Mathematics Year 1," "Government Year 2," "Integrated Science Year 1," and so on.

The apps were built through a partnership between:
- **NaCCA** (National Council for Curriculum and Assessment) — content and pedagogical authority
- **CENDLOS** (Centre for Distance Learning and Open Schooling) — Ghana-side digital infrastructure
- **Playlab.ai** — a US nonprofit providing the underlying AI runtime/platform on which the apps are built
- **T-TEL** (Transforming Teaching, Education & Learning) — Ghanaian NGO supporting the rollout
- **Mastercard Foundation** — funding

The build pattern is unusual and worth understanding: in July 2025, **29 NaCCA staff were trained to build SSPs themselves on Playlab.ai's platform**. They then went on to produce subject-specific apps; 71 teachers tested early versions across 30+ subjects; 95% reported that lesson planning was significantly faster, 99% found no factual errors in the AI output. The apps are essentially **Playlab.ai-hosted, NaCCA-authored** prompts/agents trained on Ghana's curriculum, learner materials, and teacher manuals.

What each app does, based on the PLC Government Year 2 manual:

- **Generates curriculum-aligned lesson plans** for the specific subject and year, given a weekly learning indicator from the official curriculum
- **Refines draft lesson plans** that a teacher uploads — the manual instructs teachers to *"Upload your completed learning plan into the subject specific App. Have a chat with your App to verify the following and discuss their suitability to reflect the diverse needs of learners in your class"*
- **Generates essential questions, differentiated activities, and assessment items** aligned to the curriculum's standards
- **Provides scoring guides and mark schemes** for assessments
- **Suggests resources** appropriate to learners' socioeconomic context
- **Tags outputs with NTS codes** (National Teaching Standards), and references the **Student Transcript Portal** (NTS 3j, 3n) — meaning SSP outputs are aware of STPSHS and the broader assessment framework

Distribution and access:
- Apps are accessed via QR codes in the PLC handbook
- Linked from the curriculum microsite `curriculumresources.edu.gh`
- Used in **weekly PLC sessions** — Ghana's 68,000 SHS teachers meet weekly in PLCs, with 84% national attendance
- Teachers use the apps to prepare for the coming week's lesson during the PLC session itself, then refine and deliver
- A third-party hub at `subjectspecificapp.com` (operated by Dominic Nabiga) provides a directory-style index of the official apps — useful for discovery but is **not the official distribution channel**; the curriculum microsite is

## 2. The critical distinction from STPSHS

This is the single most important fact about positioning, and it shapes everything else:

| Dimension | STPSHS | SSP |
|---|---|---|
| Regulatory status | **Mandatory** for every SHS | **Encouraged, not mandatory** |
| What it captures | Continuous assessment scores (the formal record) | Lesson plans (teacher's working artefact) |
| Submission deadlines | Yes — windowed | No — used week to week as needed |
| Penalty for non-use | Cannot generate transcripts; WAEC submission blocked | None — teacher just writes their own plan |
| Data leaves school? | Yes — to WAEC | No — stays between teacher and the AI |
| Who owns the record | WAEC | The teacher |

**STPSHS is a submission system that schools cannot avoid.** SSP is a productivity tool that schools *can* avoid — and many teachers will continue planning lessons the traditional way for years, especially older teachers, schools with poor connectivity, and teachers of subjects not yet fully covered.

This changes Omnischools' integration responsibility. With STPSHS, integration is essential — a school running on Omnischools must have a clean path to STPSHS or the school cannot legally graduate students. With SSP, integration is **valuable but optional**. A teacher using Omnischools may use SSP, may not, may use it sometimes — and the system needs to gracefully support all three.

## 3. The technical integration constraint

Worse than STPSHS for integration:

- **No documented API.** Playlab.ai-hosted apps are accessed via web browser; there's no documented programmatic interface.
- **No standardised output format.** Each app's lesson-plan output is conversational AI text, structured loosely with headings — not a defined schema.
- **No documented import path.** A teacher who generates a lesson plan in SSP can copy-paste it, screenshot it, or download it as text — but there is no "export to your school's LMS" affordance.
- **Per-app authentication.** Each subject-year app is its own URL; a teacher accessing six subjects across two years is logging into twelve apps.

So integration cannot be machine-to-machine. It has to operate at the **teacher's clipboard** — Omnischools provides a workflow that the teacher uses *around* SSP, with manual paste-in as the data-transfer mechanism. This sounds primitive but is appropriate to the actual workflow: a teacher *talks to* the SSP, iteratively refines a plan in conversation, then arrives at a final version they want to keep.

## 4. What SSP deliberately does not do

Going through the SSP ecosystem the same way I went through STPSHS:

- **No persistent lesson-plan repository per teacher.** SSPs are conversational — the plan exists in the chat history with that subject's AI. There is no "my lessons" view across all subjects a teacher teaches.
- **No school-level visibility.** A Headmaster cannot see what lesson plans their teachers have prepared. A Head of Department cannot review their team's plans before delivery. The SSPs are scoped to the individual teacher.
- **No linkage to a class register.** The plan generated by Mathematics Year 1 SSP applies to *every* Mathematics Year 1 class anywhere in Ghana; it is not aware of which class the teacher will actually deliver it to.
- **No record of which plan was actually delivered.** SSP suggests; the classroom executes; no feedback loop captures whether the lesson happened, with what adaptation, to what attendance, with what student outcome.
- **No integration with STPSHS or with assessment.** SSP can generate an assessment item *aligned* to the curriculum, but the score from that assessment goes to STPSHS through a completely separate path (the teacher's manual entry).
- **No parent or student access.** SSPs are a teacher tool only.
- **No cross-subject coordination.** A Mathematics SSP doesn't know what the same student is doing in Science that week. Curriculum themes that span subjects (Ghanaian values, GESI, 21st-century skills) are present in each SSP but not coordinated across them.
- **No scheme-of-work or term-planning view.** Each plan is for a specific week's learning indicator. There is no "show me my term's worth of lessons across all subjects."
- **No archival.** Today's session is today's session. There is no documented commitment to keep a teacher's plans from 2024/25 retrievable in 2027.
- **No usage analytics for GES or Oversight.** GES cannot ask "what fraction of teachers in Wassa Amenfi West actually used SSP this term?" — the data lives at Playlab.ai, scoped to individual teacher accounts.

Every item on that list is, again, a place Omnischools can provide value SSP structurally does not.

## 5. Positioning: how Omnischools Senior relates to SSP

The positioning is parallel to STPSHS but with a meaningfully different tone, because SSP is optional and Omnischools cannot leverage a compliance argument the way it can with STPSHS:

> **SSP is the teacher's lesson-planning assistant. Omnischools is where the lesson actually lives — scheduled, delivered, observed, assessed, and tied to the student.**

The analogy I'd use: SSP is to a teacher's lesson plan what a word processor with grammar help is to a memo — a tool that makes the writing faster and better, but is not where the memo gets filed, circulated, or acted on. Omnischools is the filing cabinet, the distribution list, and the action log.

Three claims define the positioning:

**1. SSP plans flow into Omnischools as the operational record.** A teacher generates and refines a lesson plan in SSP (or doesn't — they can also write one directly in Omnischools, or upload a PDF, or skip the plan entirely). Whatever they produce lands in Omnischools, attached to the right *class*, the right *period*, the right *week* — the context SSP doesn't know about.

**2. Omnischools provides school-level visibility SSP structurally cannot.** Head of Department sees the term's lesson plans across the team. Headmaster sees scheme-of-work coverage. PLC convenors see who in the school used SSP, who used something else, who is behind on planning. This is a Head's tool, not a teacher's tool — and Heads cannot see anything in SSP itself.

**3. Omnischools closes the loop SSP doesn't.** The lesson plan SSP helped create gets delivered to a specific class, observed (perhaps), produces specific assessment scores in the Omnischools gradebook, which then feed STPSHS at the term's end. The full chain from "this week's curriculum indicator" → "this teacher's plan for it" → "this Tuesday's lesson with 1B Science" → "Ama Boateng's portfolio entry for it" → "the score that flows to STPSHS" — that whole chain lives in Omnischools. SSP only sees the first link.

What this is **not** is competing with SSP. SSP is free, government-distributed, and AI-assisted in a way Omnischools' lesson-plan module deliberately is not (more on that below). Omnischools is the school-management context around SSP, not a substitute for the AI.

## 6. Integration design

Three integration surfaces, simpler than STPSHS because the integration is shallower:

### 6.1 Quick-launch to the right SSP

Omnischools' lesson-planning module includes a directory of the official SSPs (curated against the NaCCA list, not the third-party `subjectspecificapp.com` hub). When a teacher opens lesson planning for "1B Mathematics, Week 4," Omnischools surfaces a "Plan with Mathematics Year 1 SSP →" button that opens the correct subject-year app in a new tab.

Implementation: a small `dim_ssp_app` reference table in the analytics DB (subject, year, official URL, last-verified date), refreshed when NaCCA updates the catalogue. Maintenance burden is real — the canonical list is on `curriculumresources.edu.gh` and not in a machine-readable form — so we hand-maintain it and version it.

### 6.2 Lesson-plan capture (paste-in, with structure)

After working with the SSP, the teacher returns to Omnischools and pastes the final plan. Omnischools provides a structured editor with the same sections the curriculum manual expects (essential questions, activities, assessment, differentiation, NTS codes) so the pasted text lands into named fields rather than a blob.

Crucially, Omnischools does **not** automatically parse the AI output. A naive parser would frequently misclassify content, and the trust cost of "Omnischools garbled my plan" is higher than the saved minute of structuring it. The teacher copies into the right field manually — fast, accurate, in their control.

Once captured, the plan is attached to:
- The specific class (e.g., "1B Mathematics") — context SSP didn't have
- The specific period in the timetable
- The specific week of the curriculum
- The teacher's account

### 6.3 No reverse flow — and we say so

Omnischools does **not** push the teacher's curated content back into SSP. The teacher's saved plans are not used to train the SSP's AI; they stay within the school's tenant. This is a deliberate boundary, and it is something the marketing position should state plainly — the assistant stays the assistant; the school's data stays the school's data.

## 7. The lesson-planning module Omnischools needs, given SSP's existence

Working back from SSP's existence, the Omnischools lesson-planning module changes shape:

- It is **not an AI lesson-plan generator.** That war is lost — NaCCA built the official AI, free to every teacher, with NaCCA-authored prompts. Building an Omnischools AI lesson-planner that competes would be expensive, would be worse (NaCCA has subject matter authority Omnischools cannot match), and would position Omnischools against the Ministry — exactly the political mistake the STPSHS spec warned against.
- It **is** a place where lesson plans live, are organised, are reviewed by Heads of Department, are tied to classes and assessments, and are auditable for PLC purposes.
- It supports **three input paths equally well**: paste from SSP, write directly in Omnischools, upload a PDF/Word doc of an existing plan. No teacher is forced into an SSP-only workflow.
- It supports the **Head of Department review workflow** that SSP cannot — comments on a draft, sign-off before the week starts, escalation when a plan is overdue.
- It connects to the **timetable, attendance and gradebook** in a way SSP structurally cannot — the same lesson plan that the teacher drafted with SSP's help is the one delivered on Tuesday at 10am to 1B Mathematics, captured in the attendance register, and producing the assessment scores that flow to STPSHS at term end.

This reshapes the existing Omnischools Senior surfaces in a small but real way. The current `schoolup-shs-teacher-scheme-of-work.html` surface (if I built it; if I didn't, this is the spec for it) should be reframed as the **school-side lesson-and-scheme repository**, with SSP as one of multiple input paths feeding it. The current `schoolup-shs-teacher-lesson-plan.html` (similarly) should have the SSP launch button visible from the planning step, and a structured paste-in editor below it.

## 8. Marketing implication

The landing page FAQ should gain a second curriculum-tooling question alongside the STPSHS one:

> **Q: Do Omnischools work with the Subject Specific Apps (SSP) from NaCCA?**
>
> Yes — SSP is the AI lesson-planning assistant NaCCA built for the new SHS curriculum, and it's an excellent tool. Omnischools is where the plan lives after the teacher has finished refining it: attached to the specific class and timetable slot, visible to Heads of Department, connected to the gradebook so assessments referenced in the plan flow through to scores. The teacher works with SSP to draft, then brings the finished plan into Omnischools where the school can actually run on it. We don't replace SSP — we make use of its output.

And a positioning sentence near pricing, in plain language:

> Omnischools is the layer that ties NaCCA's curriculum tools (SSP), WAEC's submission portal (STPSHS), and your school's daily operations together — so teachers work in one place and the rest of the system fits around them.

## 9. The open question that is *not* a blocker

Unlike STPSHS, there is no critical fact about SSP that gates implementation. The integration is shallow (a directory of URLs, a structured paste-in editor, no programmatic interface), and SSP itself is optional for teachers. The work can ship without verification calls to NaCCA or Playlab.

There is **one nice-to-have verification**: confirming with NaCCA that they will publish the official SSP catalogue in a machine-readable form (CSV/JSON) at some point, so the `dim_ssp_app` reference table can be maintained from a source of truth rather than scraped from the curriculum microsite. Worth asking when there's a natural touchpoint with NaCCA on something else; not urgent.

## 10. Build sequence (relative to STPSHS)

STPSHS integration should ship first — it is the load-bearing one, the one that determines whether Omnischools can be sold to an SHS at all in 2026/27.

SSP integration is **second**, and should follow naturally from the lesson-planning module work. Once Omnischools has a place for lesson plans to live, adding the SSP launch button and the structured paste-in editor is a small extension.

The two integrations together — STPSHS at the assessment end, SSP at the planning end — give Omnischools a clean story for the full curriculum-delivery loop: *plan with NaCCA's tool, deliver in Omnischools, assess in Omnischools, submit to WAEC's portal.* That is the story to tell SHS heads.

---

**End of spec. No blocking dependencies; sequenced after STPSHS integration.**
