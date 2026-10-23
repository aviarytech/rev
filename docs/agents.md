# Agent contract

REV evaluates whether supplied evidence establishes a specified task's acceptance criteria. It does not authorize a merge or evaluate requirements that were omitted.

## Prepare a task

Define observable acceptance criteria before implementing. Keep their source independently reviewed. Supply relevant code or diff and concrete behavioral observations or tests for each criterion, including negative paths. Green CI alone and author assertions are insufficient. Do not weaken criteria to fit the implementation.

Label the evidence with the current PR head SHA and generate it in trusted CI for that commit. The action validates the label, not the origin of its contents. The [reference](reference.md) defines both JSON manifests.

## Read a result

Use `decision`, `approved`, `head-sha`, `verified`, `total`, and the JSON report. Each criterion is `satisfied`, `violated`, or `unverified`. Supported verdicts cite a primary evidence item; inspect that source when investigating. Citations and verdicts are model outputs, not independent attestations.

An approval requires all of the following:

- `decision=approve` and `approved=true`.
- Successful completion of the action and its containing `REV` job.
- The report's `headSha` matches the current PR head, every criterion is satisfied, and `verified=total` with at least one criterion.
- All other applicable checks, reviews, and branch rules are satisfied for the same head.

Missing reports, missing outputs, skipped evaluation, uncertainty, stale evidence, and errors block approval. A successful earlier check or an approval on an old commit does not apply to new work.

## Respond to denial

- `criteria-violated`: inspect the cited contradiction, repair the implementation, and produce fresh evidence.
- `criteria-unverified`: inspect each unresolved criterion. Add relevant code and independent behavioral evidence, or clarify an ambiguous requirement through review.
- CI failures: fix the failed operation first.
- Input, credential, provider or timeout errors: repair the evaluation process; do not classify them as model judgments of the implementation.

Do not suppress failures, lower thresholds, weaken requirements, or repeatedly rerun unchanged denials to obtain approval. If you believe a model verdict is wrong, preserve the case as a labeled evaluation example and request human review.

## Merge only when authorized

Re-read the current head, readiness and checks, then merge with a head precondition:

```sh
gh pr merge <number> --repo <owner/repo> --squash --match-head-commit <verified-head-sha>
```

Use the repository's permitted merge method. Confirm the merge and report the merge commit. If the head changes, reevaluate it. Never bypass repository rules to turn a denial into a merge.
