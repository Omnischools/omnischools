# Omnischools AI Build Team

A team of specialised Claude Code sub-agents that build the Omnischools platform as a
disciplined, gated loop — spec → schema/design → implementation → verification →
review → security → merge. Each agent owns one lane and hands off to the next; no code
reaches `main` without passing the three gates (Quinn, Dex, Sarah).

> The agent definitions live in `.claude/agents/*.md` (committed — `.gitignore` tracks only
> that path under `.claude/`; local `.claude` state stays ignored). Each file has YAML
> frontmatter (`name`, `description`, `tools`, `model`) plus the role's system prompt.
> The primary Claude session usually plays **Claude Code** itself and dispatches the
> specialists as sub-agents.

---

## The loop at a glance

```
        ┌── Pence (orchestrator: decompose, sequence, route rework) ──┐
        │                                                             │
   Kofi (spec/ACs) ─► Wells (schema/RLS)  ─┐                          │
        │             Lucy (design map) ───┼─► Claude Code (build) ─► Quinn (QA gate)
        │                                  │                              │
        └──────────────────────────────────┘                             ▼
                                                          Dex (architecture gate)
                                                                          │
                                                                          ▼
                                                     Sarah (security gate + MERGE)
```

**Gate order is strict:** run **Quinn first**, then **Dex**, then **Sarah**. Quinn
mutation-probes source in place, so running it at the same time as the read-only
reviewers on the same worktree makes its transient edits look like "working-tree drift."
Sarah merges **last**, and only after consuming a green Quinn and an approving Dex.

---

## The agents

### 🧭 Pence — Orchestrator / Project Manager
- **Is:** the planner and traffic controller for a build increment.
- **Does:** decomposes a milestone/spec into ordered tasks, maps dependencies and the
  critical path, decides which specialist owns each task, tracks loop state, and routes
  rework when a gate comes back RED.
- **Invoke:** at the **start** of any new module/increment, and whenever a gate fails and
  feedback needs aggregating back to the implementer.
- **Example:** *"Pence, plan the Boarding module"* · *"a gate failed on the ledger PR — route the rework."*
- **Tools:** Read, Grep, Glob, Bash, WebFetch, WebSearch. *(read-only planner)*

### 📖 Kofi — Domain / Spec Steward
- **Is:** the authority on what *correct* means for Ghanaian school operations.
- **Does:** resolves requirement ambiguity **before** implementation, rules on open
  domain questions, and produces the **acceptance criteria** QA later tests against.
- **Invoke:** before a module starts, or whenever a spec is unclear or two sources conflict.
- **Example:** *"Kofi, what are the acceptance criteria for the exeat flow?"* ·
  *"Kofi, does the 5-category weighting apply per-subject or per-school?"*
- **Tools:** Read, Grep, Glob, WebFetch, WebSearch. *(read-only spec)*

### 🗺️ Lucy — Design Cartographer
- **Is:** the surface-mapping specialist.
- **Does:** audits a `Surfaces/schoolup-*.html` mock 1:1 (sections, copy, tokens,
  interaction states) and turns it into a build-ready design specification.
- **Invoke:** at the start of any **UI** task, or when a surface's structure/copy needs cataloguing.
- **Example:** *"Lucy, map the score-ledger surface"* · *"Lucy, produce the surface map for the boarding house roster."*
- **Tools:** Read, Grep, Glob, Write, Edit, Claude Preview (start/screenshot/snapshot/inspect).

### 🗄️ Wells — Database Engineer
- **Is:** the data-layer owner.
- **Does:** all schema (DDL), Row-Level Security / tenant-isolation policies, migration
  authoring **and ordering**, indexes, constraints, and the prod-paste SQL for RLS.
- **Invoke:** whenever a task needs new tables/columns/enums or touches tenant isolation.
- **Example:** *"Wells, design the boarding schema + RLS"* · *"Wells, author the migration for the PTA tables."*
- **Tools:** Read, Grep, Glob, Edit, Write, Bash.

### 🛠️ Claude Code / `implementer` — Implementation Engineer
- **Is:** the coder who writes and runs the application against Kofi's task, Lucy's spec,
  and Wells's schema.
- **Does:** business logic, routes, Server Actions, APIs, auth wiring, and opens the pull
  request. Normally played by the primary session; dispatched as a sub-agent when
  implementation should run as a discrete task.
- **Example:** *"Build the parent exeat request Server Action against Wells's schema."*
- **Tools:** Read, Grep, Glob, Edit, Write, Bash, Claude Preview (start/screenshot/snapshot/inspect/console/network/click/fill).

### ✅ Quinn — QA / Verification Gate ("does it WORK?")
- **Is:** the functional-correctness gate.
- **Does:** writes and runs unit/integration/E2E tests, verifies each PR against Kofi's
  acceptance criteria, and explicitly proves the highest-risk logic (score math, weights,
  state transitions, tenant/role isolation). Signs off **GREEN** before merge.
- **Invoke:** on every PR, after implementation lands.
- **Example:** *"Quinn, verify the ledger PR against the acceptance criteria and prove tenant isolation."*
- **Tools:** Read, Grep, Glob, Edit, Write, Bash, Claude Preview (full set).

### 🏛️ Dex — Code & Architecture Reviewer Gate ("is it WELL-BUILT?")
- **Is:** the architecture and maintainability gate.
- **Does:** reviews code quality, module boundaries, framework conventions, error
  handling, and **portability discipline** — flagging deep Vercel/Supabase lock-in
  against the planned migration path. Confirms the build honours its design and schema.
- **Invoke:** on every PR, after Quinn is green.
- **Example:** *"Dex, review the boarding PR for architecture + portability."*
- **Tools:** Read, Grep, Glob, Bash. *(read-only reviewer)*

### 🔒 Sarah — Security Auditor + Merge Gate ("is it SECURE?")
- **Is:** the security gate **and** the one who performs the merge.
- **Does:** security only — auth/authz correctness, secrets handling, injection and
  common vuln classes, cross-tenant data leakage (attacker's viewpoint), effectiveness
  (not just presence) of RLS, PII handling, dependency vulns. Merges **only** after Quinn
  is green and Dex approves, consuming their sign-offs rather than re-checking them.
- **Invoke:** as the final gate on any PR.
- **Example:** *"Sarah, security-review the ledger PR and merge if clean."*
- **Tools:** Read, Grep, Glob, Bash, GitHub MCP (`pull_request_read`, `merge_pull_request`). *(read-only auditor; merges via the GitHub MCP — this cloud env has no `gh` CLI)*
- **Note:** in this project **Sarah = security**, not QA (a common naming assumption).

---

## Gate rules & hard-won conventions

- **Sequence the gates:** Quinn → Dex → Sarah. Never run Quinn concurrently with the
  read-only reviewers on the same worktree (mutation-probe false-drift). Sarah is always last.
- **Two green + one approve to merge:** Sarah merges only on Quinn=GREEN and Dex=APPROVE.
- **Verify claims against git, not agent prose:** a sub-agent's report is text, not a
  commit. Confirm merges with `git log origin/main` and pushed tips before trusting a summary.
- **Prod RLS is manual:** new tenant tables need their RLS/functions pasted on prod by
  hand (a `prod-paste-XXXX.sql` file) — `db:policies` only configures local dev. These
  changes fail *closed* if skipped, never leaking.
- **Non-superuser verification:** the dev superuser masks RLS behaviour; RLS must be
  proven as the non-superuser app role (`db:rls-test`).

---

## Appendix — built-in generic agents

Alongside the custom team, these general-purpose Claude Code agents are available:

| Agent | Purpose |
|-------|---------|
| **general-purpose** | Catch-all for multi-step research/search tasks. |
| **Explore** | Fast read-only, fan-out codebase search — returns conclusions, not file dumps. |
| **Plan** | Software-architect agent that designs an implementation plan. |
| **code-simplifier** | Simplifies/refines recently-changed code without altering behaviour. |
| **claude-code-guide** | Answers questions about Claude Code, the Agent SDK, and the Claude API. |
| **statusline-setup** | Configures the Claude Code status line. |
