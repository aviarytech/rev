# PR coverage gate (0.3)

The default action scope is now `pull-request`. Approval requires successful required CI jobs, coverage of the original request and every changed file, and verified acceptance criteria. This prevents unrelated passing regression criteria from being sufficient for approval. Coverage is a model judgment, not proof of completeness or overall merge readiness.

## Reviewed contract

Keep the existing task manifest. Separately prepare a contract file:

```json
{
  "request": {
    "source": "Issue #123, reviewed revision",
    "text": "Preserve the full user request here, including negative paths and platform requirements."
  },
  "requiredChecks": ["check", "native"],
  "mappings": {
    "apps/mobile/src/player.ts": ["back-navigation", "source-error"]
  }
}
```

`requiredChecks` names GitHub job IDs in `needs`, not their display names. Include every applicable job. At least one is required; missing, failed, skipped or cancelled jobs deny. A successful setup step cannot substitute for a missing required job.

An independent reviewer must compare the original request, criteria and required jobs before approving the contract digest. Store the approved digest in configuration the PR cannot change, such as a controlled repository variable. Require review of changes to the trusted workflow itself. Do not compute a digest from PR content and automatically pass it back as approval. A digest verifies equality with a reviewed contract; it cannot establish that a review happened or that the reviewer chose complete requirements.

The digest is SHA-256 over compact JSON `{task, request, requiredChecks}`, recursively sorting object keys and preserving array order and all values. `task` is the complete task manifest. Formatting and object-key order do not matter. A change to criteria, request or required jobs requires a newly reviewed digest. Mappings are checked for validity and semantic coverage separately; their presence is never accepted as proof.

## Collect all changes

Run the pinned collector from a trusted REV checkout in an unprivileged job, with the application repository as the working directory. Fetch both revisions and enough history for their merge base first:

```sh
node /path/to/pinned-rev/scripts/change.js "$BASE_SHA" "$HEAD_SHA" contract.json .rev/task.json change.json
```

The collector checks the checked-out HEAD, computes the merge base, enumerates the complete three-dot PR change, and reads full patches from immutable Git objects. Renames appear as removal plus addition, so map both paths. Deleted files are included. Uncommitted working-tree changes do not alter the manifest. Unmapped files remain visible and deny before inference; unknown mapping paths fail collection. It disables external diffs, text conversion and pathspec expansion. Binary and submodule changes fail collection rather than being represented as reviewed text. Oversized changes fail without truncation. Split oversized work into reviewable PRs or use independent review; do not split this gate into partial manifests and call the result complete.

Upload `change.json`, task and behavioral evidence as data from the same run. The collector prints a candidate contract digest for independent review; printing it does not approve it. A trusted collector/workflow must guarantee the manifest is complete. The evaluator checks supplied revision labels and cannot authenticate arbitrary caller-provided manifests against GitHub by itself.

## Final job

The following assumes the approved contract digest was configured independently and the `check` job uploaded the three inputs. Replace the action placeholder with a reviewed full commit SHA containing 0.3:

```yaml
rev:
  name: REV
  needs: [check, native]
  if: ${{ !cancelled() }}
  runs-on: ubuntu-latest
  steps:
    - uses: actions/download-artifact@v4
      with:
        name: acceptance-evidence
        path: rev-input
    - uses: aviarytech/rev@<reviewed-full-commit-sha>
      with:
        scope: pull-request
        api-key: ${{ secrets.TYPESAFE_API_KEY }}
        task-file: rev-input/task.json
        evidence-file: rev-input/evidence.json
        change-file: rev-input/change.json
        head-sha: ${{ github.event.pull_request.head.sha }}
        base-sha: ${{ github.event.pull_request.base.sha }}
        contract-sha256: ${{ vars.REV_REVIEWED_CONTRACT_SHA256 }}
        needs: ${{ toJSON(needs) }}
    - uses: actions/upload-artifact@v4
      if: ${{ !cancelled() }}
      with:
        name: rev-report
        path: rev-report.json
```

A single repository variable supports one reviewed contract at a time. Repositories with concurrent tasks need a trusted PR-to-contract lookup or independently reviewed reusable workflow inputs; REV does not implement that service. The digest binds the task to its request, not to a GitHub issue identity. The `source` label is provenance for review, not a URL REV fetches or authenticates. Restrict changes to required workflows and enforce branch rules separately. Do not execute PR scripts in the secret-bearing evaluator job.

## Manifest and verdicts

The generated manifest contains `version: 1`, `headSha`, `baseSha`, `mergeBaseSha`, `request`, `requiredChecks`, and `files`. Each file has `path`, complete `diff`, and mapped criterion IDs in `criteria`. Limits: 40 files, 40 required jobs, 16,000 request characters, 500 source/path characters. Existing 1 MiB input/corpus and 100 total model-question limits include coverage. There is one original-request coverage question and one question per changed file, in addition to acceptance and source assessments.

The model compares the full request with all criteria and each diff with its mapped criteria. Coverage choices are `covered`, `missing` or `unverified`; every answer must meet the existing probability and confidence thresholds. Missing answers, malformed distributions and low confidence deny. Verified criteria cannot override uncovered changes. A missing requirement is a coverage failure, not necessarily an implementation defect.

Report version 4 adds `scope`, `coverage`, `criteriaVerified` after inference, and `mergeReadiness: "not-established"`. Coverage includes per-target raw/final verdicts and scores, but never copies the raw request or patch into the report. After inference, reports include `baseSha` and `contractSha256`. Action outputs include `scope`, `coverage`, and `merge-readiness`. The summary states the scope and coverage prominently. Overall readiness remains external because runtime evidence can be incomplete, models can err, and review/security/release obligations may extend beyond the supplied contract.

New reasons: `missing-change`, `invalid-change`, `invalid-base-sha`, `stale-change`, `missing-reviewed-contract`, `contract-mismatch`, `unmapped-changes`, `missing-required-checks`, `coverage-unverified`, `invalid-scope`.

## Compatibility and validation

Old full-SHA pins keep the old behavior. Updating to 0.3 defaults to PR scope and fails closed until its new inputs are supplied. For intentional criterion-only evaluations, set `scope: acceptance` explicitly. That mode may approve its criteria, but reports `coverage: not-assessed` and must not stand in for a PR coverage gate. Do not use acceptance mode to route around a denial.

The live suite adds four synthetic coverage cases: complete coverage, an omitted rate-limit requirement, TV playback changes graded against unrelated export criteria, and an extra unaccounted-for logging change. These are prospective development cases, not measured production accuracy. Deterministic tests verify contract tampering, absent CI dependencies, missing mappings, uncertain/missing model answers and collector completeness. Live evaluation results must be recorded before claiming model accuracy for the new coverage policy.
