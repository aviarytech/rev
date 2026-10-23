# REV merge contract

Use REV as a final decision within an existing PR workflow. An agent needs authorization to merge; a REV approval does not grant that authorization.

## Inputs and result

Supply earlier step results through `steps`, dependency job results through `needs`, and captured logs or reports through `corpus-file` when needed. Use REV's default policy unless the repository explicitly defines another policy.

Read the step outputs `decision`, `approved`, and `reason`. Approval requires `decision=approve`, `approved=true`, and successful completion of the REV step. Missing outputs, denied decisions, and failed or incomplete evaluations block merging. The containing job must also succeed.

REV is a workflow step, not a GitHub PR review. GitHub's check name comes from the containing job. Inspect the REV step's logs or outputs as well as the job result; do not infer approval from an unrelated green check.

## Merge procedure

1. Read the PR's current head SHA, base branch, draft state, and mergeability.
2. Verify REV approved in the check run associated with that head. Do not reuse a result from an earlier commit.
3. Verify every applicable check completed successfully. A skipped REV gate blocks merging. A skipped unrelated check is acceptable only when repository policy permits it. Pending, cancelled, failed, or missing required checks block merging.
4. Verify required reviews and branch rules are satisfied and the PR is ready to merge. Never use an admin bypass to turn a denial into a merge.
5. Merge using the verified head SHA as a precondition. For GitHub CLI:

   ```sh
   gh pr merge <number> --repo <owner/repo> --squash --match-head-commit <verified-head-sha>
   ```

6. Confirm the PR is merged and report its merge commit. If the head changed, reassess the new head before trying again.

Use the repository's permitted merge method if squash is unavailable. If checks are still running, use the host's monitoring integration and resume when they finish.

## Handle denial

Use `reason` to decide what to inspect:

| Reason | Next action |
| --- | --- |
| `prior-step-failed`, `dependency-not-successful` | Inspect and fix the failed operation. |
| `empty-corpus`, `invalid-corpus`, `invalid-corpus-file` | Repair evidence collection. |
| `policy-denied`, `below-threshold` | Inspect the supplied evidence and policy; resolve the underlying issue. |
| `missing-api-key`, `api-timeout`, `api-unavailable`, `api-http-<status>` | Repair configuration or investigate provider availability before rerunning. |
| Any other error or missing result | Stop the merge and inspect the gate failure. |

Do not lower thresholds, replace the policy, suppress failures, or repeatedly rerun an unchanged model denial just to obtain approval. See the [reference](reference.md#outputs) for the complete output contract.
