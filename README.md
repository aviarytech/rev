<img src="assets/icon.svg" width="64" height="64" alt="">

# REV

**Did the agent accomplish the task?**

REV checks whether acceptance criteria cover the original request and every changed file, then evaluates those criteria and publishes one final GitHub check. It uses [TypeSafe AI's Jev](https://docs.typesafe.ai/introduction) to judge supplied code and behavioral evidence. Green CI is a prerequisite, not the answer.

**Status: experimental.** REV's mechanics are tested. Its ability to detect real agent mistakes is not established. Start with a check that is not required for merging; measure its mistakes before making it a merge gate.

## One check, an inspectable report

Example report, abbreviated:

```text
REV: deny — 1/2 acceptance criteria verified

anonymous      violated    behavior: observations.json
  Anonymous requests must return 401; supplied behavior contradicts the criterion.
authenticated  satisfied   behavior: observations.json
```

Each criterion receives `satisfied`, `violated`, or `unverified`, with evidence references for supported verdicts. Multiple sources can support a criterion together. These are model judgments and model-selected citations, not proofs. The JSON report and job summary expose the individual results.

In acceptance scope, REV approves only when every criterion is judged satisfied with sufficient confidence and supporting implementation and behavioral references, and the supplied CI results pass. Missing evidence, uncertainty, errors, or stale evidence deny. REV does not merge PRs.

## PR coverage first

Version 0.3 defaults to `scope: pull-request`. It requires the original request, a complete Git change manifest, explicit required CI jobs, and an independently reviewed contract digest. Unmapped changes, omitted jobs, changed contracts and uncertain coverage deny—even when all supplied acceptance criteria pass. Reports distinguish acceptance, coverage and overall merge readiness.

Use the [PR coverage integration guide](docs/pr-coverage.md) for the complete collector, contract and final-job setup. Existing full-SHA pins remain unchanged. Updating an integration to 0.3 requires migration; do not switch to acceptance-only mode to bypass coverage failures.

## Acceptance-only example

**1. The task.** Write observable requirements before implementation. Store them in a reviewed task manifest:

```json
{
  "version": 1,
  "task": "Protect the export endpoint.",
  "criteria": [
    { "id": "anonymous", "description": "An anonymous GET /export returns HTTP 401 and no export data." },
    { "id": "authenticated", "description": "An authenticated GET /export returns HTTP 200 with export data." }
  ]
}
```

**2. Implementation and behavior.** Supply an evidence manifest containing the PR head SHA and named code, diff, test, or behavioral observations. Include both implementation and behavioral evidence relevant to each criterion. A green test count or an author's assertion is insufficient. See the [evidence format and collector](docs/reference.md#evidence).

**3. CI results.** Put REV in a final job depending on every applicable check job:

```yaml
rev:
  name: REV
  needs: [check]
  if: ${{ !cancelled() }}
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/download-artifact@v4
      with:
        name: acceptance-evidence
    - uses: aviarytech/rev@main # Pin a reviewed full commit SHA in production.
      with:
        scope: acceptance # Narrow example only; not a PR coverage gate.
        api-key: ${{ secrets.TYPESAFE_API_KEY }}
        task-file: .rev/task.json
        evidence-file: evidence.json
        head-sha: ${{ github.event.pull_request.head.sha }}
        needs: ${{ toJSON(needs) }}
```

This snippet assumes the `check` job uploads `evidence.json` as `acceptance-evidence` and the repository supplies `.rev/task.json`. See the [integration guide](docs/integration.md) before handling untrusted PRs. If evidence collection fails, the final job fails rather than turning green through a skipped evaluation.

Save `TYPESAFE_API_KEY` as an Actions secret. Evidence is sent to TypeSafe. GitHub's log masking does not redact the request; exclude credentials and data you do not intend to send.

## Test the idea

The [export example](examples/export/task.json) and [synthetic evaluation suite](docs/evaluation.md) challenge REV with:

- A correct implementation.
- A missing authentication guard despite green CI.
- Passing tests that repeat the implementation's mistake.
- Missing behavioral evidence, an author claim, and injected approval instructions.

```sh
npm run check
npm test         # Mocked transport and deterministic behavior; no API key needed.
npm run eval    # Live Jev judgments; requires TYPESAFE_API_KEY in the environment.
```

Local unit tests do not measure model accuracy. The live suite reports false approvals, false denials, criterion mismatches and API errors. These six synthetic cases are a starting point, not a benchmark of real-world reliability. The previous acceptance policy passed 14 recorded synthetic cases. The new coverage policy has not yet been live-validated; those earlier results do not measure it.

## Small interface

One API request with request/file coverage questions, typed verdict questions and independent evidence-relationship questions per criterion, no retries, no runtime dependencies. Default deadline: 10 seconds. This acceptance evaluator has no measured latency yet; timings from REV's earlier CI-consistency prototype do not apply.

- [Input/output reference](docs/reference.md)
- [PR integration and trust boundaries](docs/integration.md)
- [Agent merge contract](docs/agents.md)
- [Evaluation methodology](docs/evaluation.md)
- [Migration from the CI-consistency prototype](docs/migration.md)

REV does not currently create acceptance criteria, run an autonomous reviewer, discover the full repository, or collect all workflow history. You supply the task and evidence; Jev evaluates them.
