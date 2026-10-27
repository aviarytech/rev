# Deterministic tests gate

`scope: tests` decides each push in code: no API key, no model call, no network. Identical inputs produce an identical report. Jev reviews the contract once per digest, before the gate runs; it never runs per push.

| Question | Decided by | When |
| --- | --- | --- |
| Do the criteria cover the original request? | Jev (`scripts/review-contract.js`) | Once per contract digest |
| Would the named tests, if they pass, establish each criterion? Are path globs scoped? | Jev | Once per contract digest |
| Does each named test pass on head and not pass on the merge base? | Code | Every push |
| Does every changed file match a criterion's path glob? | Code | Every push |
| Did every required CI job succeed? Do head, base and contract match? | Code | Every push |

## Task (version 2)

```json
{
  "version": 2,
  "task": "Protect the export endpoint.",
  "criteria": [
    {
      "id": "anonymous",
      "description": "An anonymous GET /export returns HTTP 401 and no export data.",
      "tests": ["test/export.test.ts > export > rejects anonymous requests"],
      "paths": ["src/routes/export.ts", "test/export.test.ts"]
    }
  ]
}
```

Test IDs are `repository-relative file > suite > … > test name`, exactly as written by `scripts/junit.js`. Globs support `**`, `*` and `?`; catch-all patterns such as `**` are rejected.

## Contract

`contract.json` holds `request` (`text`, `source`) and `requiredChecks` (CI job IDs). The digest covers the task, request, required checks and the Git blob hash of every file containing a named test. Editing a criterion, glob, required check or named test file changes the digest and requires another review, so tests cannot be weakened after review without detection.

```sh
node rev/scripts/tests-change.js BASE_SHA HEAD_SHA .rev/contract.json .rev/task.json change.json
TYPESAFE_API_KEY=… node rev/scripts/review-contract.js .rev/task.json change.json --pin OWNER/REPO PR_NUMBER
```

`review-contract.js` reads named test sources from Git blobs, asks Jev about request coverage and each criterion's tests, and sets `REV_CONTRACT_PR_<n>` only if every answer is positive and meets the probability (0.9) and confidence (0.8) thresholds. It is operator-invoked; PR content never pins its own digest. Without `--pin` it prints the result only.

## Test reports

Run the named test files twice and convert each JUnit file:

1. **Head:** head sources, head tests. `junit.js CWD REPO HEAD_SHA HEAD_SHA head.json head.xml`
2. **Base:** merge-base sources with the head's named test files copied in. `junit.js CWD REPO MERGE_BASE_SHA HEAD_SHA base.json base.xml`

A test is accepted only if it passed on head and did not pass (failed, skipped or missing, for example because the file could not load) on base. Duplicate IDs take the worst status. Bun (`--reporter=junit`) and Node (`--test-reporter=junit`) produce identical IDs.

## Verdicts

| Criterion verdict | Reason |
| --- | --- |
| satisfied | Every named test passes on head and not on base. |
| violated | A named test fails on head. |
| unverified | A named test is missing or skipped on head (`test-not-run`), or passes on base (`passes-without-change`). |

The gate approves only when all required jobs succeed, every changed file is mapped, and every criterion is satisfied. Validation errors (`stale-change`, `stale-test-report`, `contract-mismatch`, `missing-reviewed-contract`, malformed input) deny.

## Trust boundary

Reports and the change manifest are produced by an unprivileged job that runs PR code, as in the other scopes. The gate job reads artifacts only. A malicious PR could forge a report; this gate checks agent work for mistakes, not for an adversarial author. A passing gate establishes that reviewed tests pin the change; it does not establish merge readiness.
