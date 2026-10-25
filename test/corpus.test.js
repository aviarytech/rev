import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCorpus } from '../src/corpus.js';
import { task, HEAD } from '../eval/fixtures.js';
const evidence = () => ({ version: 1, headSha: HEAD, items: [{ id: 'code', kind: 'code', source: 'file.js', content: 'export default 1' }] });
test('requires actual acceptance criteria, unique IDs and known schema versions', () => {
  for (const change of [{ version: 9 }, { criteria: [] }, { criteria: [task.criteria[0], task.criteria[0]] },
    { criteria: [{ id: 'none', description: 'reserved' }] }, { task: '' },
    { criteria: Array.from({ length: 21 }, (_, i) => ({ id: `c${i}`, description: 'test' })) }]) {
    assert.throws(() => buildCorpus({ ...task, ...change }, evidence(), { scope: 'acceptance', 'head-sha': HEAD }), /invalid-task/);
  }
});
test('rejects stale evidence and never assumes GitHub merge SHA is PR head', () => {
  assert.throws(() => buildCorpus(task, evidence(), {}), /invalid-head-sha/);
  assert.throws(() => buildCorpus(task, evidence(), { scope: 'acceptance', 'head-sha': 'b'.repeat(40) }), /stale-evidence/);
  const c = buildCorpus(task, evidence(), { scope: 'acceptance', 'head-sha': HEAD }, { GITHUB_SHA: 'merge' });
  assert.equal(c.headSha, HEAD);
});
test('validates source IDs, content and contexts without exposing evidence', () => {
  for (const items of [[{ id: 'x', kind: 'made-up', source: 'file', content: 'SECRET' }], [evidence().items[0], evidence().items[0]]]) {
    assert.throws(() => buildCorpus(task, { ...evidence(), items }, { scope: 'acceptance', 'head-sha': HEAD }), /invalid-evidence/);
  }
  for (const steps of ['[]', 'null', '{SECRET']) assert.throws(() => buildCorpus(task, evidence(), { scope: 'acceptance', 'head-sha': HEAD, steps }), /invalid-context/);
});
test('aggregate evidence is bounded and never silently truncated', () => {
  const e = evidence(); e.items[0].content = 'x'.repeat(1024 * 1024);
  assert.throws(() => buildCorpus(task, e, { scope: 'acceptance', 'head-sha': HEAD }), /evidence-too-large/);
});
test('bounds the criterion-by-evidence question count', () => {
  const many = { ...task, criteria: Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, description: 'required behavior' })) };
  const items = Array.from({ length: 5 }, (_, i) => ({ id: `e${i}`, kind: 'code', source: 'file', content: 'code' }));
  assert.throws(() => buildCorpus(many, { version: 1, headSha: HEAD, items }, { scope: 'acceptance', 'head-sha': HEAD }), /too-many-assessments/);
});
