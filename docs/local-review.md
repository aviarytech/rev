# Local Claude Code reviews

This optional gate runs Claude Code locally using your existing Claude subscription login. GitHub Actions receives a signed report, never the subscription credential or signing key. It verifies the report against the current PR head, base, title/body, changed paths, expiry, and required PR CI jobs before publishing `REV local review`.

Automatic mode checks every five minutes while the Mac is awake. It processes one PR at a time across configured repositories, skips drafts, waits for CI, and reviews each changed revision/request once. Findings and limitations block approval and are not automatically retried. Failed invocations get at most one retry after an hour. A report expires after 24 hours; use the manual command to renew an unchanged PR when ready to merge. A new base, head, or PR description causes another automatic review.

The worker waits for `rev-local-review.yml` to be active and for its public key to match the repository variable. Stage the workflow and `.rev/local-review.json` on each default branch before enabling required checks. Keep existing gates until live approval and denial behavior has been validated. Protect workflow/policy changes through normal repository review.

## Setup

Requires Node 24+, Git, authenticated `gh`, and Claude Code logged in with `claude auth login` using your subscription. API billing fallback is disabled. Clone this repository to `~/.config/rev-local/tool`, detach at a reviewed immutable commit, then:

```sh
node scripts/local-review.js init
# Copy reviewer.pub (public key only) to REV_LOCAL_REVIEW_PUBLIC_KEY in each repo's Actions variables.
node scripts/install-local-review.js FULL_REVIEWED_COMMIT_SHA
```

The installer configures REV, TV and SDK in `~/.config/rev-local/config.json`. It installs `~/Library/LaunchAgents/com.aviarytech.rev-local-review.plist`. Stop with `launchctl bootout gui/$(id -u)/com.aviarytech.rev-local-review`. Local logs and signed reports live under `~/.config/rev-local/`. Protect and back up `reviewer.pem`; rotate repository public keys if it is compromised.

## Manual review

```sh
node ~/.config/rev-local/tool/scripts/local-review.js review onionoriginals/sdk 1003 --publish
```

Omit `--publish` for a local report only. Manual and scheduled runs share a lock. After a crash, verify the PID in `review.lock/pid` is no longer running before removing the lock directory. Clear a revision's worker-state entry to retry exhausted infrastructure errors.

## Boundaries

Claude receives PR text, the entire diff, and full before/after contents of changed regular UTF-8 files. Tools, hooks, skills and MCP are disabled; PR code is not executed locally. Reviews over 100 paths or 512 KiB, binary files, symlinks and submodules require a separate review route and cannot receive approval through this gate. Unchanged repository context is not included: insufficient context must be reported as a limitation. CI is independently verified; Claude must not claim to have run tests. No findings is review evidence, not proof of correctness.

Signed reports include findings and limitations in the `REV local attestation` check. Source snapshots stay local and are supplied to Claude under the user's Claude account. Reports are published only in the originating repository.
