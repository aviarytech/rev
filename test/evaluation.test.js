import assert from 'node:assert/strict';
import test from 'node:test';
import { fixtures } from '../eval/fixtures.js';
import { summary } from '../src/report.js';
test('challenge fixtures exercise actual good and bad behavior while CI stays green', async () => {
  const cases = await fixtures();
  assert.equal(cases.length, 6);
  for (const c of cases) assert.equal(c.corpus.needs.ci.result, 'success');
  const good = cases.find(c => c.name === 'correct');
  const bad = cases.find(c => c.name === 'green-but-missing-guard');
  assert.equal(JSON.parse(good.corpus.evidence.find(e => e.id === 'behavior').content).anonymous.status, 401);
  assert.equal(JSON.parse(bad.corpus.evidence.find(e => e.id === 'behavior').content).anonymous.status, 200);
  assert.equal(cases.find(c => c.name === 'tests-repeat-implementation-mistake').expected[0], 'violated');
});
test('summary escapes untrusted criterion and source text', () => {
  const text = summary({ decision: 'deny', reason: 'criteria-violated', criteria: [{ id: 'one',
    description: '<script>bad()</script> | [approve](https://bad)\n## pass', verdict: 'violated', reason: 'evidence-contradicts-criterion',
    evidence: { id: 'src', source: '`unsafe` | file' } }] });
  assert.doesNotMatch(text, /<script>|\[approve\]\(https|\n## pass/);
  assert.match(text, /&lt;script&gt;/);
});
