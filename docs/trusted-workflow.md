# Evaluating unprivileged PR runs with repository secrets

Use a `workflow_run` workflow stored on the repository's default branch to
consume the completed PR CI run. It checks out only an immutable REV commit,
never the PR branch. Keep TypeSafe credentials exclusively on the evaluator
step. The collector runs without them, including on Dependabot PRs.

`scripts/github-review.js` provides two phases. `prepare` retrieves the source
run, workflow and PR from GitHub; verifies the workflow identity, PR/head/base,
run attempt and latest matching run; creates a pending check; then checks every
required job by its trusted display name and selects exactly one artifact from
that run. Missing or non-successful jobs, duplicate jobs, stale artifacts and
ambiguous PR associations cannot approve. Artifacts must be replaced on each
attempt (`overwrite: true`); when retrying a failed run, rerun all jobs so the
collector creates fresh evidence. Fork runs without a unique PR association
fail closed rather than guessing.

The caller downloads only the selected artifact ID into an isolated temporary
directory. The pinned REV action validates the task, evidence and change JSON
against the verified head/base and the independently configured PR contract.
Pass `needs` from `prepare`, never a status object supplied by the artifact.
Write the evaluator report outside the download directory. `publish` rechecks
source-run and PR freshness and publishes success only for an approved report
at those exact revisions. Missing/invalid reports become failure; stale events
cannot overwrite another attempt's check. Repository policies must require the
published check; the workflow job's own check is not the PR approval result.

Required permissions are `actions: read`, `contents: read`, `pull-requests: read`
and `checks: write`. The helper accepts `GITHUB_EVENT_PATH`, `GITHUB_REPOSITORY`,
`GITHUB_TOKEN`, `REV_REQUIRED_JOBS` (trusted JSON mapping job IDs to display
names), `REV_REVIEW_PHASE` (`prepare` or `publish`), and optionally
`REV_CHECK_NAME` (default `REV`). Preparation writes outputs to `GITHUB_OUTPUT`;
publication reads `REV_REPORT_FILE` and uses `GITHUB_RUN_ID` for the details link.
Use a separate runner job, immutable action pins, and no PR checkout, install,
cache restore or PR-authored script in the privileged workflow. Treat source
names, task text, file contents and all artifact JSON as untrusted evidence.
This protects credentials; it does not make PR-authored observations independent
proof that the program is correct.

Deployment requires two stages: add the trusted workflow on the default branch
while retaining the current gate, then verify its published check on a real PR
before removing the old evaluator and updating required-check policy. A new
workflow_run file on an unmerged PR cannot validate its own privileged execution.
Use a distinct check name during this transition to avoid confusing skipped or
successful checks from the old job with the trusted evaluator's result.
