import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { collectChange } from '../scripts/change.js';

test('Git collector includes additions, removals and renames, ignores working-tree edits, and fails on opaque changes', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'rev-change-'));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const task = { version: 1, task: 'Change fixtures', criteria: [{ id: 'files', description: 'Update fixture layout' }] };
  const contract = { request: { source: 'reviewed issue', text: 'Update fixture layout' }, requiredChecks: ['test'], mappings: {} };
  try {
    git('init'); git('config', 'user.name', 'REV Test'); git('config', 'user.email', 'rev@example.invalid');
    await writeFile(join(cwd, 'old.txt'), 'old\n');
    await writeFile(join(cwd, 'removed.txt'), 'removed\n');
    git('add', '.'); git('commit', '-m', 'base');
    const base = git('rev-parse', 'HEAD');
    git('mv', 'old.txt', 'renamed.txt'); git('rm', 'removed.txt');
    await writeFile(join(cwd, 'new.txt'), 'committed\n'); git('add', '.'); git('commit', '-m', 'change');
    const head = git('rev-parse', 'HEAD');
    await writeFile(join(cwd, 'new.txt'), 'uncommitted secret\n');
    const { change } = collectChange(base, head, contract, task, cwd);
    assert.deepEqual(change.files.map(f => f.path), ['new.txt', 'old.txt', 'removed.txt', 'renamed.txt']);
    assert.ok(change.files.every(f => f.criteria.length === 0));
    assert.match(change.files[0].diff, /committed/);
    assert.doesNotMatch(JSON.stringify(change), /uncommitted secret/);
    assert.throws(() => collectChange(base, base, contract, task, cwd), /head-not-checked-out/);
    assert.throws(() => collectChange(base, head, { ...contract, mappings: { absent: ['files'] } }, task, cwd), /invalid-mappings/);
    await writeFile(join(cwd, 'binary'), Buffer.from([0, 1, 2, 3]));
    git('add', 'binary'); git('commit', '-m', 'binary');
    assert.throws(() => collectChange(base, git('rev-parse', 'HEAD'), contract, task, cwd), /binary-change-needs-review/);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
