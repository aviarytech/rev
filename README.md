<img src="assets/icon.svg" width="64" height="64" alt="">

# REV

**An approve/deny gate for pull requests. Built for humans and agents.**

Run your checks. REV reviews the recorded results with [TypeSafe AI's Jev](https://docs.typesafe.ai/introduction) and returns one decision. A human or an authorized agent handles the merge.

## Add the gate

Save `TYPESAFE_API_KEY` as a GitHub Actions secret. Add REV as the last step of your checks job:

```yaml
- name: REV
  id: rev
  if: ${{ !cancelled() }}
  uses: aviarytech/rev@main
  with:
    api-key: ${{ secrets.TYPESAFE_API_KEY }}
    steps: ${{ toJSON(steps) }}
```

For production, replace `main` with a reviewed full commit SHA from this repository. Give earlier steps IDs so GitHub includes their results. Make the containing job a required check in your repository's branch rules to enforce the gate.

No prompt to write. REV uses the same default policy before tests and after builds: judge the operations recorded so far. Successful operations with consistent evidence approve; failures, contradictions, and missing recorded-command logs deny. Operations not yet recorded are not required.

To include captured logs or reports, add `corpus-file: path/to/evidence.txt`. For a separate final job, declare its dependencies and pass `needs: ${{ toJSON(needs) }}`. GitHub does not automatically provide every action's inputs or logs; see the [evidence reference](docs/reference.md#corpus) for complete capture.

## Read the decision

Humans get a GitHub job summary and a log line:

```text
REV: approve (policy-satisfied)
```

Agents get stable step outputs:

| Output | Meaning |
| --- | --- |
| `decision` | `approve` or `deny` |
| `approved` | `true` or `false` as a string |
| `reason` | A stable reason code, such as `policy-satisfied` or `prior-step-failed` |

Approval exits successfully. Denial and errors fail the step. Keep the normal failure behavior so the gate blocks the job.

## Merge after approval

REV supplies the decision. Your human or agent merges only after **all applicable checks pass on the current PR head**, including REV, and required reviews and branch rules are satisfied. An earlier approval does not cover new commits.

For agent integration, use the [merge contract](docs/agents.md). REV itself does not merge or submit a GitHub review.

## Small by default

One inference request, no retries, no runtime dependencies, and a 10-second default deadline. The default prompt approved both checkpoints in the TV integration in roughly 180–300 ms of gate execution; that is an observed sample, not a latency guarantee. Errors deny. Evidence is sent to TypeSafe; include only data you intend to send there.

Optional policies, thresholds, evidence capture, all outputs, and development commands live in the [reference](docs/reference.md).
