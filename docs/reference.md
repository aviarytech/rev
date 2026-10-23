<img src="../assets/icon.svg" width="64" height="64" alt="">

# REV

A fast approve/deny gate for GitHub Actions, powered by [TypeSafe AI's Jev](https://docs.typesafe.ai/introduction).

Supply earlier actions' evidence and optionally override the built-in policy. REV sends one typed Choice question to Jev, enforces probability and confidence thresholds, and exits successfully only on approval. It publishes step outputs and a job summary.

Node 24, with no runtime dependencies, npm install, build, container startup, or GitHub API calls. At most one inference request, with a 10-second deadline and no retries. Actual latency depends on corpus size and TypeSafe's API. The TV integration observed roughly 180–300 ms per gate execution; this is a small sample, not a latency guarantee.

## Use

Use `aviarytech/rev@main` to get started. Pin a reviewed full commit SHA for production.

This repository includes a runnable [Try REV workflow](../.github/workflows/example.yml). Add a repository secret named `TYPESAFE_API_KEY`, then dispatch **Try REV** from the Actions tab. It runs the tests, supplies their evidence, and evaluates an editable policy.

```yaml
jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - id: build
        run: |
          npm ci
          npm test
          npm run build
          echo "artifact=dist" >> "$GITHUB_OUTPUT"
      - name: Review evidence
        id: rev
        if: ${{ !cancelled() }}
        uses: aviarytech/rev@main
        with:
          api-key: ${{ secrets.TYPESAFE_API_KEY }}
          policy: >-
            Approve only if the build succeeded and produced an artifact output.
            Deny if evidence is incomplete or contradictory.
          steps: ${{ toJSON(steps) }}
          needs: ${{ toJSON(needs) }}
          inputs: ${{ toJSON(inputs) }}
          prior-inputs: '{"build":{"commands":["npm ci","npm test","npm run build"]}}'
      - name: Release
        if: ${{ success() && steps.rev.outputs.approved == 'true' }}
        run: ./scripts/release.sh
```

`!cancelled()` lets the gate inspect earlier failures. GitHub otherwise normally skips later steps after failure. Keep REV immediately before the operation it gates. A denial or error exits with code 1; do not use `continue-on-error` on a gate that must block release. Configure the gate's job as a required status check to block merging. This emits a CI decision; it does not submit a pull request review or environment approval.

## Corpus

The request's `state` contains `version`, `run` metadata, `steps`, `needs`, `inputs`, `priorInputs`, and optional file `evidence`.

- `steps: ${{ toJSON(steps) }}`: earlier steps with IDs in this job, including outcomes, conclusions, and declared outputs.
- `needs: ${{ toJSON(needs) }}`: results and declared outputs of direct dependency jobs. Add those jobs to the job's `needs` list.
- `inputs: ${{ toJSON(inputs) }}`: workflow inputs.
- `prior-inputs`: a JSON object mapping earlier step IDs to their non-secret inputs. Reuse workflow variables to keep it in sync with the actual `with` values.
- `corpus-file`: optional UTF-8 text or JSON evidence file, included verbatim as a string. Use it for captured stdout, reports, or a manifest of additional actions' inputs and outputs.

GitHub does **not** expose every earlier action's `with` inputs, stdout, unnamed step, transitive dependency, or internal state through `steps`. For complete coverage, give steps IDs, declare their outputs, supply their inputs explicitly, and capture additional evidence in a file. REV evaluates the supplied corpus; it cannot attest that it contains the entire workflow history.

For example, capture a tool's output while preserving its exit status:

```yaml
- id: scan
  shell: bash
  run: |
    set -o pipefail
    ./scripts/scan.sh 2>&1 | tee scan.txt
- id: rev
  if: ${{ !cancelled() }}
  uses: aviarytech/rev@main
  with:
    api-key: ${{ secrets.TYPESAFE_API_KEY }}
    policy: Approve only if the scan passed with no unresolved critical findings.
    steps: ${{ toJSON(steps) }}
    corpus-file: scan.txt
```

The corpus and policy are sent to TypeSafe. Only supply evidence intended for that service: GitHub log masking does not redact API payloads. REV masks its API key and avoids logging evidence or provider response bodies. A combined corpus over 1 MiB is rejected, never silently truncated. The default model has a 32k per-question token limit; the byte bound is a memory guard, not a guarantee that a request fits that token limit. Context-limit errors deny.

## Configuration

`policy` is optional (maximum 16,000 characters). By default, REV reviews completed operations using one built-in prompt, suitable before or after tests. Supply a policy to override it. Pass `api-key` from a secret, or set `TYPESAFE_API_KEY` in the step's environment. Context inputs default to `{}`.

- `model`: `jev-1.14.0` by default. Pin a tested version for consistent behavior.
- `min-probability`: `0.9`, inclusive; allowed range `0.5`–`1`.
- `min-confidence`: `0.8`, inclusive; allowed range `0`–`1`.
- `timeout-ms`: `10000`; allowed range `100`–`60000`, including response reading.

Approval requires an `approve` choice and both thresholds. Defaults are starting points, not a measured guarantee of correctness; tune them on representative cases. Confidence describes the answer distribution, not independent proof of compliance.

Before calling Jev, REV denies failed/cancelled steps (including failures masked by `continue-on-error`), unsuccessful dependency jobs (including skipped jobs), and empty evidence. Skipped individual steps remain evidence for the policy to judge. Malformed inputs/responses, invalid configuration, missing credentials, HTTP errors, and timeouts fail closed. Rate limits fail immediately instead of extending CI latency through retries.

The policy is separate from untrusted evidence, with instructions to ignore commands embedded in evidence. Model judgments can still be mistaken or influenced by hostile content. Enforce exact invariants with ordinary CI checks and use REV for judgments those checks cannot express.

## Outputs

`decision` is `approve` or `deny`; `approved` is the string `true` or `false`. `probability` is the approve probability, `confidence` is Choice confidence, `model` is the actual model ID, and `duration-ms` measures execution time. Probability, confidence, and model are empty when evaluation did not complete.

`reason` is a stable code. Normal results are `policy-satisfied`, `policy-denied`, or `below-threshold`. Local denials include `prior-step-failed`, `dependency-not-successful`, and `empty-corpus`. Errors include `invalid-policy`, `invalid-configuration`, `invalid-corpus`, `corpus-too-large`, `invalid-corpus-file`, `missing-api-key`, `invalid-step`, `invalid-step-status`, `invalid-job-status`, `invalid-response`, `response-too-large`, `api-timeout`, `api-unavailable`, `api-http-<status>`, and `internal-error`.

## Develop

```sh
npm run check
npm test
```

Tests mock the TypeSafe API, exercise the real action entrypoint and exit codes, and need no credentials. CI is configured for Linux, macOS, and Windows. Live inference accuracy and latency require validation with your TypeSafe account and workflow evidence.

Integration references: [System One API](https://docs.typesafe.ai/api/system-one), [Choice](https://docs.typesafe.ai/primitives/choice), and [models](https://docs.typesafe.ai/models).
