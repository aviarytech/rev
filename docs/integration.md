# Integrating the final REV check

Start in observation mode: publish the REV job but do not make it a required branch check yet. A denied or errored evaluation still fails its job so the visible result remains honest. Observe false approvals and false denials before enforcing it. Do not use `continue-on-error` to create a green acceptance check.

## Evidence flow

1. Define and review the task and acceptance criteria independently of implementation. A reviewed `.rev/task.json` is one option. An issue or PR description needs a deliberate conversion into the same manifest and a review of changes.
2. Run ordinary checks against the PR revision, capturing code/diff and criterion-specific behavioral evidence. Use independent expectations: a test generated alongside a mistaken implementation can repeat the mistake.
3. Package evidence with the PR head SHA. Upload it as a same-run artifact. Include relevant context beyond changed lines when necessary. If the diff is generated against the base branch, record that base revision in its content too.
4. Run a final job named `REV`, with every applicable check job declared in `needs`, and `if: ${{ !cancelled() }}`. A failed or skipped dependency must not skip the gate into apparent success.
5. Invoke the pinned external action with the reviewed task, downloaded evidence, `head-sha`, and `toJSON(needs)`. Retain `rev-report.json` as an artifact even on denial. No inference is attempted when supplied CI fails.

A runnable two-job demonstration is [Try acceptance verification](../.github/workflows/example.yml). It uses this repository's export example and a manual dispatch, not a production TV integration. Add a TypeSafe secret to REV's repository before dispatching it. The [README](../README.md) shows the external-action PR job.

## Trust boundaries

Treat PR content as untrusted. Evidence can contain prompt injection, forged logs, or mislabeled commits. The prompt instructs the model to ignore embedded instructions, but robustness is unproven.

Keep the task definition and collector under review. A PR that removes its own acceptance criteria can otherwise earn approval against a weaker task. Resolve task revisions through a trusted source or require an independent reviewer to approve them; REV does not enforce that provenance.

Do not execute untrusted PR code with a secret-bearing token or TypeSafe key. Run application tests in an unprivileged job. Use a pinned REV action in the evaluation job; do not use `uses: ./` from an untrusted PR checkout. Download data only, and read the reviewed task as data. Never introduce `pull_request_target` plus execution of PR code to expose secrets to forks. For fork PRs without credentials, keep REV nonrequired or use an explicitly reviewed, isolated evaluation process. REV denies when credentials are unavailable.

The head SHA is an equality check on caller-supplied metadata, not cryptographic evidence provenance. Ensure evidence was generated for that exact commit, from the intended base, and that the check run belongs to the same PR head. Do not reuse old artifacts or infer the head from `GITHUB_SHA`, which can be GitHub's synthetic merge commit for PR events.

## Enforcement and merging

When measured quality justifies enforcement, require the `REV` check alongside normal CI under the repository's branch rules. Repository administrators configure that; this action does not modify branch protection.

A green REV result covers only the supplied criteria and evidence. It does not establish security, complete requirements coverage, or overall readiness. Authorized humans and agents must still respect reviews, branch rules, and all other applicable checks. See the [agent merge contract](agents.md).
