import assert from 'node:assert/strict';
import test from 'node:test';
import { guidance } from '../src/guidance.js';
import { summary } from '../src/report.js';

const assessment = (kind, relation = 'supports', accepted = true) => ({ kind, relation, accepted });
function denied(assessments, extra = {}) {
  return { approved: false, decision: 'deny', reason: 'criteria-unverified',
    criteria: [{ id: 'form', verdict: 'unverified', modelVerdict: 'satisfied',
      reason: 'insufficient-evidence', evidenceAssessments: assessments, ...extra }] };
}
test('accepted tests without implementation support direct review to the mutation boundary', () => {
  const result = denied([assessment('test'), assessment('code', 'supports', false)]);
  const before = structuredClone(result);
  const advice = guidance(result);
  assert.deepEqual(result, before);
  assert.deepEqual(advice.criteria[0].missingSupport, ['implementation']);
  assert.match(advice.criteria[0].steps.join(' '), /mutation boundary/);
  assert.match(advice.steps.join(' '), /fails before the fix and passes after/);
  assert.match(advice.criteria[0].steps.join(' '), /does not prove/);
});
test('accepted code without behavior calls for production and negative-path observations', () => {
  const advice = guidance(denied([assessment('diff'), assessment('test', 'irrelevant')]));
  assert.deepEqual(advice.criteria[0].missingSupport, ['behavior']);
  assert.match(advice.criteria[0].steps.join(' '), /expected versus observed/);
});
test('low-score satisfied choices still require review even with both support kinds', () => {
  const advice = guidance(denied([assessment('code'), assessment('behavior')], { reason: 'below-threshold' }));
  assert.deepEqual(advice.criteria[0].missingSupport, []);
  assert.match(advice.criteria[0].steps.join(' '), /raw choice was satisfied/);
  assert.match(advice.steps.join(' '), /Do not lower thresholds/);
});
test('contradiction guidance applies even when the raw choice was satisfied', () => {
  for (const verdict of ['unverified', 'violated']) {
    const advice = guidance(denied([assessment('code'), assessment('test', 'contradicts')], { verdict }));
    assert.match(advice.criteria[0].steps.join(' '), /reproduce the claimed mismatch/);
  }
});
test('blocked evaluation never asks for arbitrary implementation repairs', () => {
  for (const reason of ['invalid-response', 'api-http-503', 'missing-api-key', 'ci-not-successful', 'stale-evidence']) {
    const advice = guidance({ ...denied([]), reason });
    assert.equal(advice.kind, 'evaluation-blocked');
    assert.deepEqual(advice.criteria, []);
    assert.match(advice.steps.join(' '), /does not establish an implementation defect/);
  }
});
test('approval has no remediation; satisfied criteria are omitted from denial guidance', () => {
  assert.deepEqual(guidance({ approved: true }), { kind: 'none', steps: [], criteria: [] });
  const result = denied([]);
  result.criteria.push({ id: 'done', verdict: 'satisfied' });
  assert.deepEqual(guidance(result).criteria.map(c => c.id), ['form']);
});
test('summary makes guidance visible and escapes criterion labels', () => {
  const result = denied([], { id: '<script>x</script>\n## pretend' });
  const rendered = summary(result);
  assert.match(rendered, /### Next steps/);
  assert.match(rendered, /mutation boundary/);
  assert.doesNotMatch(rendered, /<script>|\n## pretend/);
  assert.doesNotMatch(summary({ approved: true, decision: 'approve', criteria: [] }), /### Next steps/);
});
test('coverage denials expose each unresolved target and retain concurrent evidence gaps', () => {
  const result = { ...denied([]), reason:'coverage-unverified', coverage:{assessments:[
    {target:'request',verdict:'unverified',modelVerdict:'covered',probability:.62,confidence:.43},
    {target:'src/a.js',criteria:['form'],verdict:'missing',modelVerdict:'missing'},
    {target:'src/b.js',verdict:'covered',modelVerdict:'covered'},
  ]}};
  const before = structuredClone(result);
  const advice = guidance(result);
  assert.deepEqual(result,before);
  assert.deepEqual(advice.coverage.map(c=>c.reason),['below-threshold','missing-coverage']);
  assert.match(advice.coverage[0].step,/No specific missing obligation/);
  assert.deepEqual(advice.criteria[0].missingSupport,['implementation','behavior']);
  assert.match(summary(result),/request: below-threshold/);
});
