# 001 — Run tests in GitHub Actions

## Clarified engineering request

Add one minimal GitHub Actions workflow that validates pull requests and `main`:

- trigger on the standard `pull_request` events, including updates pushed to an open PR branch;
- trigger on pushes to `main`;
- use the repository's supported Node.js 22 runtime;
- install the locked dependency tree with `npm ci` and run the existing `npm run check` quality gate;
- stop any job that exceeds five minutes.

Also cap duplicate work by cancelling an older in-progress run for the same PR or branch when a newer commit starts. Keep workflow permissions read-only.

**Classification:** Engineering request (CI configuration only).

## Non-goals

- No release, deployment, coverage upload, status badge, dependency-update, or scheduled workflow.
- No Node/OS version matrix; the package's declared minimum runtime on Ubuntu is sufficient for this change.
- No new npm scripts, dependencies, source changes, or dedicated tests for declarative workflow YAML.
- No path filters, because all pull requests and `main` pushes should be validated.
- No branch-protection configuration; repository administrators may make the resulting check required separately.

## Affected files/components

| File | Change |
| --- | --- |
| `.github/workflows/test.yml` | New workflow with event filters, least-privilege permissions, concurrency control, five-minute timeout, Node setup, install, and check steps. |
| `docs/implementation-plans/001-github-actions-tests.md` | This implementation plan only. |

## Implementation DAG

```text
A. Add the single CI workflow
        |
        v
B. Validate configuration and existing quality gate
```

- **A → B:** validation depends on the final workflow contents.
- No parallel tracks are needed; this is intentionally one small configuration change.

## Comprehensive todo list

### Stage A — Add the workflow

- [ ] Create `.github/workflows/test.yml` with a short, stable workflow and job name suitable for branch protection.
- [ ] Configure `pull_request` without branch filtering so opening, reopening, and pushing updates to any PR is covered.
- [ ] Configure `push.branches: [main]`; do not run a second `push` workflow for every feature branch, which would duplicate PR runs.
- [ ] Set top-level `permissions: contents: read`.
- [ ] Add workflow-level concurrency keyed by the PR number when present and otherwise by the Git ref; enable `cancel-in-progress` so superseded runs do not consume time.
- [ ] Add one Ubuntu job with `timeout-minutes: 5`.
- [ ] Use `actions/checkout@v4` and `actions/setup-node@v4` with Node 22.
- [ ] Run only `npm ci` followed by `npm run check`; reuse the lockfile and existing aggregate script rather than duplicating its commands.
- [ ] Do not add a matrix, service containers, custom shell scripts, or new dependencies.

### Stage B — Validate and finish

- [ ] Review the YAML indentation, event filters, concurrency expression, permissions, and placement of `timeout-minutes` at the job level.
- [ ] During implementation, run the existing `npm run check` suite locally; do not add standalone application tests because no application behavior changes.
- [ ] Inspect the final diff and run `git diff --check`.
- [ ] After pushing, confirm the workflow starts once for a PR update and once for a direct `main` push, uses Node 22, and exposes the intended stable check name.
- [ ] If a run is deliberately made to exceed five minutes, confirm GitHub cancels it; otherwise verify the timeout from the workflow definition rather than adding artificial delay.

## Rollout and backward compatibility

- This is additive repository automation and does not alter package runtime behavior, exports, generated `dist/` files, or published contents.
- Existing contributors still use the same `npm run check` command locally.
- The first pushed revision activates the workflow. If branch protection is later enabled, select the stable job check introduced here.
- Cancelling superseded runs affects only older CI executions; the newest commit for each PR/ref remains validated.

## Quality gates

- Workflow is valid GitHub Actions YAML with exactly the intended `pull_request` and `main` push triggers.
- Job-level `timeout-minutes` is `5`.
- Workflow permissions are read-only and no secrets are requested.
- Dependency installation is reproducible through `npm ci`.
- `npm run check` passes under Node 22.
- `git diff --check` passes.
- Final diff remains limited to the workflow and this plan.

## Execution ledger

- **Stage:** Planning/research complete; implementation has not started.
- **Reasoning level:** Standard (ordinary-risk CI configuration).
- **Escalation reason:** None.
- **Stage boundary:** Began with repository/index orientation and existing-script inspection; ended after producing and reviewing this implementation plan. Implementation starts in a fresh stage from this file and the current repository state.
