# Reference

REV 0.3 defaults to PR coverage evaluation before acceptance verification. See [PR coverage](pr-coverage.md) for the reviewed contract, complete change manifest, migration and trust boundaries. The criterion/evidence formats below remain version 1.

## Task

`task-file` points to UTF-8 JSON:

```json
{
  "version": 1,
  "task": "Protect the export endpoint.",
  "criteria": [
    { "id": "anonymous", "description": "Anonymous requests return HTTP 401 with no export data." }
  ]
}
```

Supply 1–20 required criteria. Every criterion is required; approval requires all of them. Task text is limited to 16,000 characters; each description to 4,000. IDs must start with a letter and contain only letters, digits, underscores and hyphens, up to 64 characters. IDs must be unique; `none` is reserved.

Use concrete externally observable requirements. "Looks good" is not a useful criterion. The task does not establish its own completion; that comes from evidence.

## Evidence

`evidence-file` points to UTF-8 JSON:

```json
{
  "version": 1,
  "headSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "items": [
    { "id": "route", "kind": "code", "source": "src/export.js:1", "content": "if (!session) return { status: 401, body: null };" },
    { "id": "probe", "kind": "behavior", "source": "export-probe.json", "content": "Anonymous request: HTTP 401; body: null" }
  ]
}
```

The SHA must be the exact 40-character lowercase PR head SHA and match the `head-sha` action input. This rejects a mismatched label; it does not authenticate who produced evidence or prove that file contents belong to that commit. Use trusted CI collectors and artifacts from the same run. Do not relabel old evidence with a new SHA.

Up to 40 items, subject to `criteria × (items + 1) + coverage questions ≤ 100` to bound the number of model questions, with the same ID rules as criteria. Kinds: `diff`, `code`, `test`, `behavior`, `report`. `source` is a nonempty label up to 500 characters, preferably a path and line or a report identifier. It is not fetched or resolved by REV. `content` must contain the actual evidence, not a URL the model cannot access. Empty item lists deny.

The evaluator requires code/diff evidence and concrete test/behavior evidence exercising each criterion. It checks for wrong expectations and contradictions; no guarantee of detecting them is established. Each item is independently judged as supporting, contradicting, or irrelevant to each criterion. Multiple sources can support a criterion together. No generated rationale or source quotation is returned. The report combines the criterion, verdict, reason code, and references so a reviewer can inspect the original evidence.

The combined corpus is capped at 1 MiB; each input file is also bounded before parsing. Oversized inputs deny, never truncate. These are memory bounds, not guarantees of fitting the model context. Context-limit errors deny.

### Explicit file collector

The repository includes a standalone collector:

```sh
node scripts/evidence.js "$HEAD_SHA" sources.json evidence.json
```

`sources.json` is an array of `{ "id": "route", "kind": "code", "path": "src/export.js" }` entries. The collector reads those files verbatim, validates the resulting manifest, and writes `evidence.json`. It does not discover files, capture commands, redact secrets, or infer provenance. Run it from a REV checkout, or adapt the simple format in your own CI. The action does not require this helper.

See [the runnable sources example](../examples/export/sources.json). Capture command output with `set -o pipefail` and `tee` to retain a failing command's exit status. Preserve an unsuccessful `check` job as a dependency result even when evidence is missing.

## Action inputs

| Input | Default | Contract |
| --- | --- | --- |
| `scope` | `pull-request` | Require PR coverage; explicit `acceptance` checks supplied criteria only. |
| `change-file` | required in PR scope | Complete change manifest; see [PR coverage](pr-coverage.md). |
| `base-sha` | required in PR scope | Expected PR base SHA. |
| `contract-sha256` | required in PR scope | Independently reviewed task/request/required-jobs digest. |
| `task-file` | required | Task manifest path. |
| `evidence-file` | required | Evidence manifest path. |
| `head-sha` | required | Expected PR head SHA, explicitly supplied. |
| `api-key` | `TYPESAFE_API_KEY` env fallback | TypeSafe credential. |
| `needs` | `{}` | JSON direct-dependency results from `toJSON(needs)`. |
| `steps` | `{}` | JSON named prior-step results from `toJSON(steps)`. |
| `report-file` | `rev-report.json` | JSON report destination. |
| `model` | `jev-1.14.0` | Pin and reevaluate model changes. |
| `min-probability` | `0.9` | Selected-choice probability threshold, 0.5–1. |
| `min-confidence` | `0.8` | Choice confidence threshold, 0–1. |
| `timeout-ms` | `10000` | Request plus response deadline, 100–60000 ms. |

Failures and cancellations, including step failures masked by `continue-on-error`, deny before inference. All supplied dependency jobs must succeed; skipped dependencies deny. At least one successful step or dependency must be supplied. Skipped individual steps do not count as proof; include every applicable CI job in `needs`. PR scope also requires every job named in the reviewed contract to be present in `needs`. REV cannot infer jobs omitted from that contract or distinguish an ordinary successful setup step from your complete test suite.

## Model and aggregation

One POST to TypeSafe's [System One API](https://docs.typesafe.ai/api/system-one), with no retries. Each criterion has a typed Choice verdict question (`satisfied`, `violated`, `unverified`) and a separate question for every evidence item (`supports`, `contradicts`, `irrelevant`). Evidence items do not compete for a single citation slot.

Each question sees the task and full supplied corpus, but explicitly targets one criterion. Source-relation questions target one item and use their own relevance policy; they do not inherit the rule that the entire criterion needs both implementation and behavioral evidence. The whole-criterion question still requires that complete evidence. Returned distributions and choices are validated. Distributions expressed in hundredths may total 0.99–1.01 to accommodate provider rounding; other distributions retain the 0.001 total tolerance. Scores are never renormalized, and the selected choice must still be maximal and meet the unchanged probability/confidence thresholds. A satisfied verdict requires its own probability/confidence thresholds, accepted supporting implementation and behavioral references, and no accepted contradicting reference. A violated verdict requires its thresholds and at least one accepted contradiction. Each relationship must independently meet the same thresholds to be accepted. Otherwise the reported criterion is `unverified`. Approval is a deterministic conjunction of all satisfied verdicts after the CI preflight, plus covered request/file judgments in PR scope.

The report preserves raw verdicts and all relationship assessments for diagnosis. A relation's probability measures support/contradiction/irrelevance, not which of several equally useful sources is "best." Conflicting model answers prevent satisfaction. Selecting real items still does not prove that their contents support the claim; the live suite tests those judgments. Confidence and probability are not independently calibrated correctness guarantees.

## Outputs

Version 4 adds `scope`, `coverage` and `merge-readiness` action outputs. Reports prominently distinguish `coverage: not-assessed` in acceptance scope. Overall merge readiness is always `not-established`; a green model check is not authorization to merge. See [coverage report fields and errors](pr-coverage.md#manifest-and-verdicts).

| Output | Meaning |
| --- | --- |
| `decision` | `approve` or `deny`. |
| `approved` | String `true` or `false`. |
| `reason` | Stable aggregate reason. |
| `head-sha` | Validated commit, empty if corpus validation failed. |
| `verified` / `total` | Satisfied and total criterion counts. |
| `report-file` | JSON report location. |
| `model` | Returned model ID, empty before successful inference. |
| `duration-ms` | Execution duration before report publication. |

The report has `version: 4`, the decision fields, `headSha`, and `criteria`. Action reports also record the configured probability/confidence `thresholds` when configuration validation succeeded. The GitHub summary shows criterion scores, thresholds, model and duration, with all per-source scores under “Requirements and evidence scores.” Each criterion includes `id`, `description`, `verdict`, `reason`, and an `evidence` array of accepted references (`{id, kind, source, relation}`). An empty array means no relationship met the thresholds. Model-evaluated criteria also include `modelVerdict`, its selected-choice `probability` and `confidence`, and `evidenceAssessments` with every relationship, its scores, and `accepted`. A raw verdict can be downgraded to `unverified` by the deterministic aggregator.

Action reports also include additive `guidance`: `kind` (`none`, `review-required`, or `evaluation-blocked`), shared `steps`, and unresolved `criteria` entries with `id`, `missingSupport` (`implementation` and/or `behavior`), and criterion-specific `steps`. Missing support refers to accepted supporting relationships, not proven code defects. Guidance is deterministic and advisory; it does not change decisions, thresholds, or model requests. It appears under “Next steps” in denied job summaries. See [the agent review workflow](agents.md#review-before-escalating).

Evidence content and provider response bodies are not logged or copied to reports. Criterion descriptions and source labels are included and must be suitable for publication. Protect the original evidence artifact according to your repository's access policy. Masking logs does not remove secrets from TypeSafe payloads.

Normal reasons: `criteria-verified`, `criteria-violated`, `criteria-unverified`. Criterion reasons: `evidence-supports-criterion`, `evidence-contradicts-criterion`, `insufficient-evidence`, `below-threshold`, `contradictory-evidence`.

Preflight and error reasons: `ci-not-successful`, `missing-ci-results`, `missing-evidence`, `missing-input`, `invalid-file`, `invalid-task`, `invalid-evidence`, `invalid-context`, `invalid-head-sha`, `stale-evidence`, `too-many-assessments`, `evidence-too-large`, `invalid-step`, `invalid-step-status`, `invalid-job-status`, `invalid-configuration`, `missing-api-key`, `invalid-response`, `response-too-large`, `api-timeout`, `api-unavailable`, `api-http-<status>`, `internal-error`.

Approval exits 0; denial or error exits 1. Reporting failures also exit 1 and must not be treated as approval. No arbitrary policy replacement is supported in this version: the acceptance criteria define the task, and the evaluation rules stay fixed.

### Advisory denial diagnostics (opt-in)

Set `diagnose-denials: 'true'` to diagnose model denials after the gate has already
made its decision. Up to two additional TypeSafe Choice requests share a separate
`timeout-ms` deadline. Approval, reasons, thresholds and exit status are unchanged.
Approvals, malformed inputs and deterministic CI failures do not invoke this pass.
Provider failures leave the original denial intact and report diagnostic uncertainty.

The first round selects a gap category, an exact requirement span and a supplied
source. The second selects an evidence block that grounds that particular claim,
with `none` available in both rounds. Choices must meet the existing probability
and confidence thresholds. Unknown IDs, malformed distributions and out-of-range
references are rejected. All content remains untrusted data.

Reports contain `denialDiagnostics`: advisory findings or explicit “Evaluator
uncertainty—no actionable defect identified.” Each finding includes an obligation
source with zero-based, end-exclusive character offsets, a citation with one-based
inclusive line numbers **within supplied source content**, and a concrete next
check. Evidence blocks can be grouped files or diffs; these are not repository
line numbers. Raw evidence, selected quotations and original request text are not
copied into reports. Existing source labels must still be suitable for publication.
Local validation establishes reference existence, not the truth of the model's
interpretation. A diagnostic finding is not a confirmed bug.

At most 20 unresolved targets are diagnosed per run, prioritizing criterion gaps;
remaining target IDs are explicitly listed. Each request is bounded to 1 MiB and
responses use the existing transport limits. Large inputs produce uncertainty,
never silent evidence truncation. There are no retries or automatic repairs.

HTTP rejections retain their `api-http-<status>` reason. Reports include locally
computed request/state byte counts and question count. A bounded HTTP 400 error
identifying the documented `max_tokens_exceeded` code is classified as
`model-context-limit`; otherwise it remains `provider-rejected-request`. Provider
messages, request echoes and arbitrary error codes are never copied to reports.
Byte counts are diagnostics, not token estimates. Jev 1.14's default limits are
64k tokens per request and 32k for state plus each question; REV's byte limit does
not guarantee that a request fits those token limits. Long context is off by default. Set the action input `long-context: 'true'` to
explicitly send the documented `TypeSafe-Danger-Zone-Long-Context: true` header
for both evaluation and advisory diagnostics. This preserves the complete corpus
and question set and does not change model, thresholds or response validation.
Invalid boolean values fail configuration. No automatic escalation, evidence
truncation or retry is performed. Provider limits still apply; HTTP rejections
remain denials. See https://api.typesafe.ai/openapi.json for the transport option.

A malformed diagnostic answer affects only its target. Other independently valid
findings survive, and the overall diagnostic status becomes `partial`. The affected
target retains uncertainty and safe structural validation details. Probability
normalization requirements are not relaxed: a distribution totaling 0.99 is still
rejected. Transport-wide failures remain `unavailable`. Neither status changes
the original gate decision.
