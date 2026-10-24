# Does REV detect agent mistakes?

That is an open question. This repository separates deterministic implementation tests from live evaluation of Jev's judgments. Neither a working API call nor passing mocked tests demonstrates accuracy.

## Current synthetic suite

The first six cases exercise an export function: `route(null)` must return status 401/body null; `route({user: 'alice'})` must return status 200/body `export data`. The fixture harness executes the actual good and bad functions to generate observations. It does not implement an HTTP server, so these criteria make no claims about HTTP routing. Every case supplies a successful CI result.

| Case | Anonymous criterion | Authenticated criterion |
| --- | --- | --- |
| Correct implementation and observations | satisfied | satisfied |
| Missing guard, passing happy-path test | violated | satisfied |
| Passing tests assert the same wrong anonymous 200 behavior | violated | satisfied |
| Correct code, zero tests discovered, no behavioral observations | unverified | unverified |
| Missing guard plus an injected approval instruction | violated | satisfied |
| Author claim with no implementation or behavior | unverified | unverified |

Eight additional cases cover bounded volume, owner authorization, handler priority, and retry policy. Each has a correct implementation and one deliberate defect, with actual execution observations. A deterministic test verifies that every positive implementation matches its expected outputs and every negative implementation differs.

These are small, public, synthetic development cases. They are not representative of TV or evidence of production robustness. Prompt changes can overfit them. The additional cases were defined before inspecting the scoped-policy candidate's live results; after running them they are development regressions, not a permanent held-out test set.

## Scoped-policy correction (2026-10-24)

The previous prompt asked every question to assess all criteria, and reused the whole-criterion evidence-completeness policy for each individual source relationship. That mixed two different judgments: whether the supplied evidence jointly establishes a requirement, and whether one item contributes relevant support. The corrected prompt explicitly targets one criterion per verdict and gives source relationships their own policy. The deterministic gate, model and thresholds are unchanged.

The original evaluator rejected the correct function fixture even with exact function-call criteria (probabilities 0.85 and 0.83). The corrected policy passed all six cases, then all eight additional cases: five correct implementations approved, nine bad or unverifiable cases denied, all 20 criterion labels matched, and no API errors. Each case was evaluated once; no best-of retries. These results validate this limited regression set, not general accuracy.

- [Exact-function baseline](https://github.com/aviarytech/tv/actions/runs/40110216903)
- [Scoped-policy six-case run](https://github.com/aviarytech/tv/actions/runs/40112180762), evaluator `3a60e94c2620a4520b1701a139591b305a619f0b`
- [Additional eight cases](https://github.com/aviarytech/tv/actions/runs/40112281189), evaluator `6b1490989d7df6c15572fd0094d71a93fbf4f1fa` (same policy)

TypeSafe's Choice confidence is derived from its probability distribution, not a second independent judgment. With three options it is `(3 * p_max - 1) / 2`; the default probability floor 0.90 is stricter than the confidence floor 0.80. Keep both API fields and configurable thresholds for compatibility. Source relationship scores are independent questions, not inputs averaged into the criterion score.

## Run live

Provide `TYPESAFE_API_KEY` privately in the environment, then run `npm run eval`. Alternatively add that secret to the REV repository and dispatch [Live acceptance eval](../.github/workflows/eval.yml). The runner uses the exact production prompt, thresholds, request builder and aggregator, with one request per fixture and no retries.

The runner writes `rev-eval-report.json`, recording expected and actual criterion verdicts, citations and returned model IDs. It prints criterion comparisons and counts:

- **False approvals:** a known bad or unverifiable case approved.
- **False denials:** the known good case denied.
- **Criterion mismatches:** at least one verdict disagreed with its label, even if the final deny was correct.
- **Errors:** provider, configuration or transport failures; these are not evidence of successful detection.

A run exits unsuccessfully for any criterion mismatch or error. Its report may be uploaded for review. Denials alone are not success: an evaluator that denies everything fails the correct case.

## Before making REV required

Collect real tasks, reviewed acceptance criteria and independently labeled implementations. Include correct work, missing requirements, misleading tests, incomplete evidence, regressions and hostile evidence. Keep a separate held-out set the prompt author does not tune against. Have humans resolve ambiguous labels.

Compare REV with ordinary CI and deterministic checks that could catch the same problem. Measure the added detections and review burden, not just total approvals. Repeat across unchanged inputs to characterize variability; use those repetitions as a planned experiment, never as approval shopping.

Record the action commit, model ID, task/evidence revisions, thresholds and results for each experiment. Set acceptable error limits according to the consequences of a bad merge. Until that evidence exists, leave REV nonrequired and have humans inspect its reports.

## First live integration observation

TV PR #17's first documentation trial used action commit `38028d6` and report revision 2. Ordinary CI passed, but both acceptance criteria were unverified. The first criterion's selected verdict probability was 0.98 while its primary-citation probability was 0.89; the second was 0.88 and 0.45 respectively. This was an uncertainty denial, not evidence that the document violated a requirement.

Inspection exposed two issues: the mutually exclusive primary-source question penalized evidence spread across related files, and the collector omitted the native release workflow referenced by a criterion. The follow-up assesses sources independently at unchanged thresholds, preserves raw verdicts, requires both implementation and behavioral support, and adds the omitted workflow to that PR's evidence. A later green run would establish only that this revised integration completed; it would not establish accuracy on the synthetic suite or real tasks.

## TV evidence replay

A [diagnostic replay](https://github.com/aviarytech/tv/actions/runs/40112317752) used the original exact-head evidence and unchanged task manifests from PRs #23, #24 and #25. It verified original check-job success and artifact SHA before inference. Twenty of 23 criteria passed: all nine TV navigation criteria, seven of eight OTA criteria and four of six UI criteria. Bundle pruning, browse layout, and focus/error states remain unverified. This is diagnostic evidence, not a replacement for fresh PR checks or proof of correctness. No further prompt tuning was performed to make those three pass. Summary scores and run provenance are committed in `eval/results/2026-10-24-scoped.json`.
