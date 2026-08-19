# Project board = single source of truth

The **Omnischools** GitHub project (org project **#1**,
`https://github.com/orgs/Omnischools/projects/1`) is where the owner, partners, and the
AI build-loop agents coordinate. Every PR and planned item lives there.

## Fields
- **Status** — `Todo` / `In progress` / `Done`.
- **Owner** (custom single-select) — the build-loop agent or person responsible:
  `Kofi` (spec) · `Wells` (DB/RLS) · `Lucy` (design) · `Claude Code` (impl) ·
  `Quinn` (QA) · `Dex` (arch) · `Sarah` (security) · `Pence` (PM) · `Wunpini` (owner) ·
  `Frederick` (payments/integration). GitHub **Assignees** stay real people only
  (`WunpiniFuseini`, `FrederickOB`) — used when a *human* action is needed
  (provisioning keys, business registration, Hubtel/Paystack).

## PR tracking = two layers (both on)
1. **Action** — `.github/workflows/pr-project-tracking.yml` adds each new PR to the board
   and posts a tracking comment. It needs a secret **`PROJECT_PAT`** (a fine-grained PAT,
   org `Omnischools`, **Projects: read+write**), added under
   *repo (or org) → Settings → Secrets and variables → Actions*. Without it the add step
   is skipped (the comment still posts).
2. **Built-in project workflows** (toggle once in the project UI →
   *⋯ menu → Workflows*):
   - **Auto-add to project** — filter `is:pr`, repo `Omnischools/omnischools`.
   - **Item added → Status: Todo** (or `In progress` for PRs).
   - **Pull request merged → Status: Done.**
   - **Item closed → Status: Done.**

These can't be enabled via the API — flip them once in the UI and they run server-side
forever after.

## Rule for all work
When a PR opens: it lands on the board (Action + auto-add). The reviewer/owner sets
**Owner** and, if a human must act, an **Assignee**. On merge, Status flips to `Done`.
Add a board item for any planned work that isn't already tracked.
