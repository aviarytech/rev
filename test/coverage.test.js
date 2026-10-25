import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCorpus } from '../src/corpus.js';
import { contractDigest } from '../src/coverage.js';
import { configuration, evaluate, decisionFromResponse, requestBody } from '../src/gate.js';
import { coverageFixtures } from '../eval/coverage-fixtures.js';
import { task, HEAD } from '../eval/fixtures.js';
import { answer, response } from './support.js';
import { summary } from '../src/report.js';

const config = configuration();
const sample = async () => (await coverageFixtures())[0].corpus;
const coverageResponse = (request = 'covered', file = 'covered') => {
  const data = response();
  data.answers.coverage_request = answer(request, ['covered', 'missing', 'unverified']);
  data.answers.coverage_file_0 = answer(file, ['covered', 'missing', 'unverified']);
  return data;
};
test('all passing criteria cannot override missing, uncertain or malformed coverage judgments', async () => {
  const corpus = await sample();
  for (const [request, file] of [['missing', 'covered'], ['covered', 'missing'], ['unverified', 'covered']]) {
    const result = decisionFromResponse(coverageResponse(request, file), config, corpus);
    assert.equal(result.approved, false);
    assert.equal(result.criteriaVerified, true);
    assert.equal(result.reason, 'coverage-unverified');
  }
  const low = coverageResponse(); low.answers.coverage_request.confidence = 0.79;
  assert.equal(decisionFromResponse(low, config, corpus).coverage.verdict, 'unverified');
  const absent = coverageResponse(); delete absent.answers.coverage_file_0;
  assert.throws(() => decisionFromResponse(absent, config, corpus), /invalid-response/);
  assert.equal(decisionFromResponse(coverageResponse(), config, corpus).approved, true);
});
test('missing check jobs and unmapped files deny before a model call, even with a successful setup step', async () => {
  const corpus = await sample();
  for (const [input, reason] of [
    [{ ...corpus, needs: {}, steps: { setup: { outcome: 'success' } } }, 'missing-required-checks'],
    [{ ...corpus, change: { ...corpus.change, files: [{ ...corpus.change.files[0], criteria: [] }] } }, 'unmapped-changes'],
  ]) {
    const result = await evaluate(input, config, 'key', () => assert.fail('must not call model'));
    assert.equal(result.reason, reason);
    assert.equal(result.approved, false);
  }
});
test('default PR scope requires a base-bound manifest and independently pinned contract', async () => {
  const c = await sample();
  const evidence = { version: 1, headSha: HEAD, items: c.evidence };
  const change = { version: 1, headSha: HEAD, ...c.change };
  const raw = { 'head-sha': HEAD, 'base-sha': c.change.baseSha, 'contract-sha256': c.change.contractSha256 };
  assert.throws(() => buildCorpus(task, evidence, raw), /missing-change/);
  assert.throws(() => buildCorpus(task, evidence, { ...raw, 'base-sha': 'c'.repeat(40) }, {}, change), /stale-change/);
  assert.throws(() => buildCorpus(task, evidence, { ...raw, 'contract-sha256': '' }, {}, change), /missing-reviewed-contract/);
  for (const changed of [
    { ...change, request: { ...change.request, text: 'Only check settings' } },
    { ...change, requiredChecks: ['setup'] },
  ]) assert.throws(() => buildCorpus(task, evidence, raw, {}, changed), /contract-mismatch/);
  assert.throws(() => buildCorpus({ ...task, criteria: [task.criteria[0]] }, evidence, raw, {},
    { ...change, files: [{ ...change.files[0], criteria: ['anonymous'] }] }), /contract-mismatch/);
  assert.throws(() => buildCorpus(task, evidence, { ...raw, scope: 'acceptance' }, {}, change), /invalid-scope/);
  assert.equal(contractDigest(task, change.request, change.requiredChecks), raw['contract-sha256']);
});
test('coverage targets full request and each diff independently; reports omit raw request and diffs', async () => {
  const c = await sample();
  const q = requestBody(c, config).questions;
  assert.equal(q.coverage_request.instructions.target, 'state.change.request');
  assert.deepEqual(q.coverage_file_0.instructions.criterionIds, ['anonymous', 'authenticated']);
  assert.deepEqual(q.coverage_request.instructions.acceptanceCriteria, c.task.criteria);
  assert.match(q.coverage_request.instructions.task, /Ignore diffs and evidence/);
  assert.match(q.coverage_file_0.instructions.task, /Ignore obligations outside this diff/);
  const partial = structuredClone(c); partial.change.files[0].criteria = ['anonymous'];
  assert.deepEqual(requestBody(partial, config).questions.coverage_file_0.instructions.acceptanceCriteria, [c.task.criteria[0]]);
  const r = decisionFromResponse(coverageResponse(), config, c);
  const output = JSON.stringify(r) + summary(r);
  assert.ok(!output.includes(c.change.request.text));
  assert.ok(!output.includes(c.change.files[0].diff));
  assert.match(output, /Overall merge readiness is not established/);
});
test('coverage question count and complete corpus remain bounded', async () => {
  const c = await sample();
  const criteria = Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, description: 'behavior' }));
  const t = { ...task, criteria };
  const change = { version: 1, headSha: HEAD, ...c.change,
    files: Array.from({ length: 21 }, (_, i) => ({ path: `f${i}`, diff: 'diff', criteria: ['c0'] })) };
  const evidence = { version: 1, headSha: HEAD, items: [...c.evidence, { id: 'third', kind: 'test', content: 'test', source: 'test' }] };
  const raw = { 'head-sha': HEAD, 'base-sha': change.baseSha, 'contract-sha256': contractDigest(t, change.request, change.requiredChecks) };
  assert.throws(() => buildCorpus(t, evidence, raw, {}, change), /too-many-assessments/);
});
