# Migrating from REV 0.1

Version 0.1 judged whether completed CI operations were consistent with a policy. Version 0.2 asks whether supplied implementation and behavioral evidence establishes a task's acceptance criteria. Green checks no longer suffice.

This is a breaking change on `main`. Existing integrations pinned to an earlier commit remain on the earlier implementation. Update them deliberately; do not change a pinned reference without preparing the new inputs.

## Replace the old contract

- Replace `policy` with a reviewed `task-file` containing an explicit task and required criteria. Arbitrary policy overrides are removed.
- Replace `corpus-file` with the structured `evidence-file` manifest. A text log is now one named evidence item, not the entire evaluation contract.
- Supply `head-sha` explicitly, using the PR head SHA. Evidence from another revision denies.
- Keep `steps` or `needs` for ordinary CI results, and include all applicable dependencies. Workflow `inputs` and `prior-inputs` are no longer action inputs; include relevant context in named evidence items instead.
- Replace aggregate `probability` and `confidence` consumption with the criterion-level report. `decision`, `approved`, `reason`, `model` and `duration-ms` remain, with new reason codes. `head-sha`, `verified`, `total` and `report-file` are added.
- Remove setup-only preflight evaluations. Acceptance verification belongs at the end, when implementation and behavioral evidence are available.
- Remove the TV-specific `collect-evidence.js` collector and old CI-consistency fixtures. The optional `scripts/evidence.js` helper packages explicit source files.

Publish a separate final job named `REV`. Start with it nonrequired, preserve its report on denial, and validate its judgment against known good and bad solutions before enforcing it. This release does not migrate TV or alter any repository's branch rules automatically.
