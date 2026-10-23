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
    evidence: [{ id: 'src', source: '`unsafe` | file', relation: 'contradicts' }] }] });
  assert.doesNotMatch(text, /<script>|\[approve\]\(https|\n## pass/);
  assert.match(text, /&lt;script&gt;/);
});
test('summary exposes criterion and source scores without rounding at a threshold', () => {
  const text = summary({ decision: 'deny', reason: 'criteria-unverified', model: 'jev-1.14.0', 'duration-ms': 390,
    thresholds: { probability: 0.9, confidence: 0.8 }, criteria: [{ id: 'accuracy', description: 'Verify accuracy',
      verdict: 'unverified', modelVerdict: 'satisfied', probability: 0.8999, confidence: 0.88,
      reason: 'below-threshold', evidence: [], evidenceAssessments: [
        { id: 'guide', source: 'guide.md', relation: 'supports', probability: 0.95, confidence: 0.92, accepted: true },
        { id: 'scripts', source: 'package.json', relation: 'supports', probability: 0.89, confidence: 0.83, accepted: false },
      ] }] });
  assert.match(text, /accuracy \| unverified \| satisfied \| 0\.8999 \| 0\.88/);
  assert.match(text, /guide \| guide\.md \| supports \| 0\.95 \| 0\.92 \| yes/);
  assert.match(text, /scripts \| package\.json \| supports \| 0\.89 \| 0\.83 \| no/);
  assert.match(text, /probability ≥ 0\.9 · confidence ≥ 0\.8/);
  assert.match(text, /jev-1\.14\.0 · Duration: 390 ms/);
  assert.match(summary({ decision: 'deny', reason: 'missing-input', criteria: [] }), /not evaluated/);
});
