import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluateTests, glob, testsGuidance } from '../src/tests.js';
import { parseJUnit, testReport } from '../scripts/junit.js';
import { collectTestsChange } from '../scripts/tests-change.js';
import { reviewBody, reviewContract, reviewDecision } from '../scripts/review-contract.js';
import { configuration } from '../src/gate.js';
import { run } from '../src/index.js';
import { answer } from './support.js';

const ID = 'test/export.test.js > export > rejects anonymous requests';
const task = { version: 2, task: 'Protect the export endpoint.', criteria: [
  { id: 'anonymous', description: 'An anonymous GET /export returns HTTP 401.', tests: [ID], paths: ['src/**', 'test/export.test.js'] },
] };
const contract = { request: { text: 'Return 401 for anonymous exports.', source: 'issue #1' }, requiredChecks: ['tests'] };
const needs = JSON.stringify({ tests: { result: 'success' } });

async function repository() {
  const dir = await mkdtemp(join(tmpdir(), 'rev-tests-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'rev@example.com'); git('config', 'user.name', 'REV');
  await mkdir(join(dir, 'src')); await mkdir(join(dir, 'test'));
  await writeFile(join(dir, 'src/export.js'), 'export const status = () => 200;\n');
  git('add', '.'); git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD');
  await writeFile(join(dir, 'src/export.js'), 'export const status = user => user ? 200 : 401;\n');
  await writeFile(join(dir, 'test/export.test.js'), 'assert.equal(status(), 401);\n');
  git('add', '.'); git('commit', '-qm', 'head');
  return { dir, git, base, head: git('rev-parse', 'HEAD') };
}
const report = (sourceSha, testsSha, status) => ({ version: 1, sourceSha, testsSha, tests: status ? [{ id: ID, status }] : [] });

test('glob matching is anchored and segment-aware', () => {
  assert.ok(glob('src/**').test('src/a/b.js'));
  assert.ok(glob('src/**/*.ts').test('src/a.ts'));
  assert.ok(glob('src/*.ts').test('src/a.ts'));
  assert.equal(glob('src/*.ts').test('src/a/b.ts'), false);
  assert.equal(glob('src/**').test('srcx/a.js'), false);
  assert.equal(glob('a.js').test('xa.js'), false);
});

test('Bun and Node JUnit produce the same repository-relative test IDs', () => {
  const bun = `<testsuites><testsuite name="t/a.test.ts" file="t/a.test.ts"><testsuite name="export" file="t/a.test.ts">
    <testcase name="ok &amp; &lt;fine&gt;" classname="export" file="t/a.test.ts" />
    <testcase name="bad" file="t/a.test.ts"><failure message="x">boom</failure></testcase>
    <testcase name="later" file="t/a.test.ts"><skipped /></testcase></testsuite></testsuite></testsuites>`;
  const node = `<testsuites><testsuite name="export"><testcase name="ok &amp; &lt;fine>" classname="export" file="/repo/pkg/t/a.test.ts"/>
    <testcase name="bad" file="/repo/pkg/t/a.test.ts" failure="x"><failure message="x"><![CDATA[<testcase name="fake"/>]]></failure></testcase>
    <testcase name="later" file="/repo/pkg/t/a.test.ts"><skipped type="skipped" message="true"/></testcase></testsuite></testsuites>`;
  const expected = [
    { id: 'pkg/t/a.test.ts > export > ok & <fine>', status: 'passed' },
    { id: 'pkg/t/a.test.ts > export > bad', status: 'failed' },
    { id: 'pkg/t/a.test.ts > export > later', status: 'skipped' },
  ];
  assert.deepEqual(parseJUnit(bun, '/repo/pkg', '/repo'), expected);
  assert.deepEqual(parseJUnit(node, '/repo/pkg', '/repo'), expected);
  assert.throws(() => parseJUnit(node, '/repo/pkg', '/repo/pkg/t/sub'), /outside-repository/);
  const merged = testReport([bun, bun.replace('<testcase name="later" file="t/a.test.ts"><skipped />', '<testcase name="later" file="t/a.test.ts"><error />')], '/repo/pkg', '/repo', 'a'.repeat(40), 'a'.repeat(40));
  assert.equal(merged.tests.find(t => t.id.endsWith('later')).status, 'failed');
});

test('named tests that pass only with the change approve deterministically, with no model or network', async () => {
  const r = await repository();
  try {
    const { change, digest } = collectTestsChange(r.base, r.head, contract, task, r.dir);
    assert.deepEqual(change.paths, ['src/export.js', 'test/export.test.js']);
    assert.equal(change.testBlobs['test/export.test.js'], r.git('rev-parse', `${r.head}:test/export.test.js`));
    const raw = { 'head-sha': r.head, 'base-sha': r.base, 'contract-sha256': digest, needs };
    const head = report(r.head, r.head, 'passed');
    const approve = evaluateTests(task, change, head, report(change.mergeBaseSha, r.head, 'failed'), raw);
    assert.equal(approve.approved, true);
    assert.equal(approve.reason, 'criteria-verified');
    assert.deepEqual(approve, evaluateTests(task, change, head, report(change.mergeBaseSha, r.head, 'failed'), raw));
    assert.equal(evaluateTests(task, change, head, report(change.mergeBaseSha, r.head), raw).approved, true, 'missing on base counts as not passing');

    const deny = (h, b, extra = {}, t = task, c = change) => evaluateTests(t, c, h, b, { ...raw, ...extra });
    const base = report(change.mergeBaseSha, r.head, 'failed');
    assert.equal(deny(head, report(change.mergeBaseSha, r.head, 'passed')).criteria[0].reason, 'passes-without-change');
    assert.equal(deny(report(r.head, r.head, 'failed'), base).reason, 'criteria-violated');
    assert.equal(deny(report(r.head, r.head, 'skipped'), base).criteria[0].reason, 'test-not-run');
    assert.equal(deny(report(r.head, r.head), base).criteria[0].reason, 'test-not-run');
    assert.equal(deny(head, base, { needs: JSON.stringify({ tests: { result: 'failure' } }) }).reason, 'ci-not-successful');
    assert.equal(deny(head, base, { needs: '{}' }).reason, 'missing-required-checks');
    const narrow = { ...task, criteria: [{ ...task.criteria[0], paths: ['test/export.test.js'] }] };
    const unmapped = collectTestsChange(r.base, r.head, contract, narrow, r.dir);
    const result = deny(head, base, { 'contract-sha256': unmapped.digest }, narrow, unmapped.change);
    assert.equal(result.reason, 'unmapped-changes');
    assert.deepEqual(result.coverage.unmappedFiles, ['src/export.js']);
    assert.match(testsGuidance(result).steps[0], /path glob/);

    assert.throws(() => deny(report(r.base, r.head, 'passed'), base), /stale-test-report/);
    assert.throws(() => deny(head, report(r.head, r.head, 'failed')), /stale-test-report/);
    assert.throws(() => deny(head, base, { 'base-sha': r.head }), /stale-change/);
    assert.throws(() => deny(head, base, { 'contract-sha256': '' }), /missing-reviewed-contract/);
    // Editing a named test after review changes its blob and invalidates the reviewed digest.
    const weakened = { ...change, testBlobs: { 'test/export.test.js': 'f'.repeat(40) } };
    assert.throws(() => deny(head, base, {}, task, weakened), /contract-mismatch/);
    for (const paths of [['**'], ['**/*'], ['*']]) {
      assert.throws(() => deny(head, base, {}, { ...task, criteria: [{ ...task.criteria[0], paths }] }), /invalid-task/);
    }
    assert.throws(() => collectTestsChange(r.base, r.head, contract,
      { ...task, criteria: [{ ...task.criteria[0], tests: ['test/missing.test.js > x'] }] }, r.dir), /test-file-missing/);
  } finally { await rm(r.dir, { recursive: true, force: true }); }
});

test('the action runs tests scope without an API key and writes a deterministic report', async () => {
  const r = await repository();
  try {
    const { change, digest } = collectTestsChange(r.base, r.head, contract, task, r.dir);
    const files = { task, change, head: report(r.head, r.head, 'passed'), base: report(change.mergeBaseSha, r.head, 'failed') };
    for (const [name, value] of Object.entries(files)) await writeFile(join(r.dir, `${name}.json`), JSON.stringify(value));
    const env = { INPUT_SCOPE: 'tests', 'INPUT_TASK-FILE': join(r.dir, 'task.json'), 'INPUT_CHANGE-FILE': join(r.dir, 'change.json'),
      'INPUT_HEAD-REPORT': join(r.dir, 'head.json'), 'INPUT_BASE-REPORT': join(r.dir, 'base.json'),
      'INPUT_HEAD-SHA': r.head, 'INPUT_BASE-SHA': r.base, 'INPUT_CONTRACT-SHA256': digest, INPUT_NEEDS: needs,
      'INPUT_REPORT-FILE': join(r.dir, 'report.json'), GITHUB_STEP_SUMMARY: join(r.dir, 'summary.md') };
    const result = await run(env, () => assert.fail('tests scope must not call the network'));
    assert.equal(result.approved, true);
    assert.equal(result.scope, 'tests');
    assert.equal(JSON.parse(await readFile(join(r.dir, 'report.json'), 'utf8')).contractSha256, digest);
    assert.match(await readFile(join(r.dir, 'summary.md'), 'utf8'), /1\/1 criteria verified by named tests/);
    const denied = await run({ ...env, 'INPUT_CONTRACT-SHA256': 'a'.repeat(64) }, () => assert.fail());
    assert.equal(denied.reason, 'contract-mismatch');
    assert.equal(denied.approved, false);
  } finally { await rm(r.dir, { recursive: true, force: true }); }
});

test('Jev reviews the contract and exact test sources, and approves only when every target passes', async () => {
  const r = await repository();
  try {
    const { change, digest } = collectTestsChange(r.base, r.head, contract, task, r.dir);
    const reply = (request, tests) => ({ model: 'jev-1.14.0', answers: {
      coverage_request: answer(request, ['covered', 'missing', 'unverified']),
      tests_0: answer(tests, ['faithful', 'inadequate', 'unverified']),
    } });
    let sent;
    const fetchImpl = async (_, init) => { sent = JSON.parse(init.body); return new Response(JSON.stringify(reply('covered', 'faithful'))); };
    const result = await reviewContract(task, change, { apiKey: 'key', cwd: r.dir, fetchImpl });
    assert.equal(result.approved, true);
    assert.equal(result.digest, digest);
    assert.deepEqual(sent.state.sources, [{ path: 'test/export.test.js', content: 'assert.equal(status(), 401);\n' }]);
    assert.deepEqual(Object.keys(reviewBody(task, change, [], 'm').questions), ['coverage_request', 'tests_0']);
    const config = configuration();
    assert.equal(reviewDecision(reply('covered', 'inadequate'), task, config).approved, false);
    assert.equal(reviewDecision(reply('missing', 'faithful'), task, config).approved, false);
    const low = reply('covered', 'faithful'); low.answers.tests_0.confidence = 0.5;
    assert.equal(reviewDecision(low, task, config).approved, false);
    await assert.rejects(reviewContract(task, change, { cwd: r.dir, fetchImpl }), /missing-api-key/);
  } finally { await rm(r.dir, { recursive: true, force: true }); }
});
