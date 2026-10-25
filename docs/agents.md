# Agent contract

REV checks request/change coverage in its default PR scope and evaluates whether supplied evidence establishes the acceptance criteria. It does not authorize a merge or evaluate requirements that were omitted.

## Prepare a task

Define observable acceptance criteria before implementing. Keep their source independently reviewed. Supply relevant code or diff and concrete behavioral observations or tests for each criterion, including negative paths. Green CI alone and author assertions are insufficient. Do not weaken criteria to fit the implementation.

Label the evidence with the current PR head SHA and generate it in trusted CI for that commit. The action validates the label, not the origin of its contents. The [reference](reference.md) defines both JSON manifests.

## Read a result

Use `decision`, `approved`, `head-sha`, `verified`, `total`, and the JSON report. Each criterion is `satisfied`, `violated`, or `unverified`. Supported verdicts cite evidence items; inspect those sources when investigating. The report retains the raw model verdict and each independent evidence relationship, including uncertain judgments. Citations and verdicts are model outputs, not independent attestations.

An approval requires all of the following:

- `decision=approve` and `approved=true`.
- `scope=pull-request` and `coverage=covered`, with the current base and independently approved contract digest. Acceptance-only approval is insufficient for a PR coverage gate.
- Successful completion of the action and its containing `REV` job.
- The report's `headSha` matches the current PR head, every criterion is satisfied, and `verified=total` with at least one criterion.
- All other applicable checks, reviews, and branch rules are satisfied for the same head.

Missing reports, missing outputs, skipped evaluation, uncertainty, stale evidence, and errors block approval. A successful earlier check or an approval on an old commit does not apply to new work.

## Respond to denial

Coverage failures require comparing the original request and complete diff with the criteria. Add missing requirements through independent review and gather their behavioral evidence. Do not remap unrelated criteria, drop files, automatically approve a new contract digest, or select acceptance scope to obtain green.

- `criteria-violated`: inspect the cited contradiction, repair the implementation, and produce fresh evidence.
- `criteria-unverified`: inspect each unresolved criterion. Add relevant code and independent behavioral evidence, or clarify an ambiguous requirement through review.
- CI failures: fix the failed operation first.
- Input, credential, provider or timeout errors: repair the evaluation process; do not classify them as model judgments of the implementation.

The JSON report's `guidance` and the job summary's **Next steps** give deterministic follow-up suggestions based on the gate result. They are investigation steps, not model explanations or a guarantee of approval. Missing accepted support means the model did not accept the supplied evidence; it does not prove the code is missing.

### Review before escalating

1. Read the exact unresolved criterion, raw model choice, final reason, and every source assessment. A raw `satisfied` choice can still fail thresholds or lack accepted support. Approval requires accepted supporting code/diff and behavior/test evidence, no accepted contradiction, and a satisfied criterion choice meeting both thresholds.
2. Trace the production entry point through the control, event handler, state change and API or mutation boundary. Check each obligation and relevant invalid inputs, alternate entry paths and bypasses. Passing tests may exercise only a control or repeat the implementation's assumptions.
3. Try to reproduce an uncovered case. For example, a form's click test can pass because the browser validates required fields, while another supported submit path reaches a mutation without validation. Inspect whether that path can occur and whether the handler enforces the required behavior. Do not assume every form needs an extra guard.
4. When you find a defect, add a regression that fails before the fix and passes afterward. Assert the unwanted side effect does not happen and the valid path still performs the intended operation. Repair the implementation, then capture the actual handler, relevant surrounding source, and expected versus observed results.
5. If implementation support is missing, supply the relevant production code rather than more passing test counts. If behavioral support is missing, exercise the real path and relevant negative cases. Regenerate evidence for the current head after meaningful changes.
6. If review finds no defect, document the paths inspected and concrete reproduction results. Clarify genuinely ambiguous requirements through review. Preserve a labeled evaluation case and request human review if the evidence still contradicts REV; do not stop at “tests pass, so the evaluator is wrong.”

Do not suppress failures, lower thresholds, weaken requirements, or repeatedly rerun unchanged denials to obtain approval. If you believe a model verdict is wrong, preserve the case as a labeled evaluation example and request human review.

## Merge only when authorized

Re-read the current head, readiness and checks, then merge with a head precondition:

```sh
gh pr merge <number> --repo <owner/repo> --squash --match-head-commit <verified-head-sha>
```

Use the repository's permitted merge method. Confirm the merge and report the merge commit. If the head changes, reevaluate it. Never bypass repository rules to turn a denial into a merge.
