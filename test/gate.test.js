import assert from 'node:assert/strict';
import test from 'node:test';
import { configuration, evaluate, decisionFromResponse } from '../src/gate.js';
import { corpus, response } from './support.js';
const config = configuration();
test('one Choice request evaluates each requirement and selects real evidence IDs', async () => {
  let calls = 0;
  const data = corpus();
  const result = await evaluate(data, config, 'key', async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
    assert.equal(options.headers.Authorization, 'Bearer key');
    assert.equal(options.redirect, 'error');
    const body = JSON.parse(options.body);
    assert.deepEqual(body.state, data);
    assert.deepEqual(Object.keys(body.questions), ['criterion_0', 'support_0_0', 'support_0_1', 'criterion_1', 'support_1_0', 'support_1_1']);
    assert.deepEqual(Object.keys(body.questions.support_0_0.criteria), ['supports', 'contradicts', 'irrelevant']);
    assert.match(body.questions.criterion_0.instructions.rules, /Tests can encode the same mistake/);
    return Response.json(response());
  });
  assert.equal(calls, 1);
  assert.equal(result.approved, true);
  assert.equal(result.headSha, data.headSha);
  assert.deepEqual(result.criteria[0].evidence.map(e => e.id), ['code', 'probe']);
  assert.equal(JSON.stringify(result).includes('PRIVATE_EVIDENCE'), false);
});
test('a single violated or unverifiable criterion denies otherwise green CI', () => {
  for (const verdict of ['violated', 'unverified']) {
    const result = decisionFromResponse(response([verdict, 'satisfied']), config, corpus());
    assert.equal(result.approved, false);
    assert.equal(result.criteria[0].verdict, verdict);
  }
});
test('missing supporting evidence or uncertain verdicts cannot produce satisfaction', () => {
  const noSupport = response(undefined, [['irrelevant', 'irrelevant'], ['supports', 'supports']]);
  assert.equal(decisionFromResponse(noSupport, config, corpus()).approved, false);
  for (const mutate of [
    r => { r.answers.criterion_0.confidence = 0.79; },
    r => { r.answers.support_0_0.confidence = 0.79; r.answers.support_0_1.confidence = 0.79; },
    r => { r.answers.criterion_0.probabilities = { satisfied: 0.89, violated: 0.06, unverified: 0.05 }; },
  ]) {
    const r = response(); mutate(r);
    const result = decisionFromResponse(r, config, corpus());
    assert.equal(result.approved, false);
    assert.equal(result.criteria[0].verdict, 'unverified');
    assert.equal(result.criteria[0].modelVerdict, 'satisfied');
  }
  const r = response();
  for (const a of Object.values(r.answers)) {
    a.confidence = 0.8;
    a.probabilities = Object.fromEntries(Object.keys(a.probabilities).map(k => [k, k === a.choice ? 0.9 : 0.05]));
  }
  assert.equal(decisionFromResponse(r, config, corpus()).approved, true);
});
test('multiple supporting sources do not compete and a contradiction blocks approval', () => {
  const supported = decisionFromResponse(response(), config, corpus());
  assert.equal(supported.approved, true);
  assert.equal(supported.criteria[0].evidence.length, 2);
  const conflict = decisionFromResponse(response(undefined, [['supports', 'contradicts']]), config, corpus());
  assert.equal(conflict.approved, false);
  assert.equal(conflict.criteria[0].reason, 'contradictory-evidence');
  const codeOnly = decisionFromResponse(response(undefined, [['supports', 'irrelevant']]), config, corpus());
  assert.equal(codeOnly.approved, false);
  // A model violation without a concrete contradiction is not established either.
  const unsupported = decisionFromResponse(response(['violated', 'satisfied'], [['irrelevant', 'irrelevant']]), config, corpus());
  assert.equal(unsupported.criteria[0].verdict, 'unverified');
});
test('rejects missing assessments and malformed distributions', () => {
  for (const mutate of [
    r => { delete r.answers.criterion_1; }, r => { delete r.answers.support_1_1; },
    r => { r.answers.support_0_0.choice = 'invented'; },
    r => { r.answers.criterion_0.probabilities.violated = 0.5; },
    r => { r.answers.criterion_0.confidence = Infinity; },
    r => { r.answers.criterion_0.probabilities.satisfied = '0.98'; },
    r => { r.answers.criterion_0.choice = 'violated'; },
    r => { r.answers.criterion_0.probabilities.extra = 0; },
    r => { r.model = ''; },
  ]) { const r = response(); mutate(r); assert.throws(() => decisionFromResponse(r, config, corpus()), /invalid-response/); }
});
test('failed, cancelled, skipped or absent dependency CI cannot be approved', async () => {
  const inputs = [
    { steps: { test: { outcome: 'failure', conclusion: 'success' } } },
    { steps: { test: { outcome: 'cancelled' } } },
    ...['failure', 'cancelled', 'skipped'].map(result => ({ needs: { ci: { result } } })),
    { steps: {}, needs: {} }, { evidence: [] },
  ];
  for (const change of inputs) {
    const result = await evaluate({ ...corpus(), ...change }, config, '', () => assert.fail('no request'));
    assert.equal(result.approved, false);
    assert.ok(result.criteria.every(c => c.verdict === 'unverified'));
  }
});
test('invalid CI contexts are rejected rather than ignored', async () => {
  for (const change of [{ steps: { x: null } }, { steps: { x: { outcome: 'unknown' } } }, { needs: { x: {} } }]) {
    await assert.rejects(evaluate({ ...corpus(), ...change }, config, 'key'), /invalid-/);
  }
});
test('network, provider and response failures do not retry or expose response bodies', async () => {
  for (const [mock, code] of [
    [() => new Response('PRIVATE_PROVIDER_RESPONSE', { status: 401 }), 'api-http-401'],
    [() => new Response('rate limited', { status: 429 }), 'api-http-429'],
    [() => { throw new Error('PRIVATE_NETWORK_ERROR'); }, 'api-unavailable'],
    [() => new Response('bad JSON'), 'invalid-response'],
    [() => new Response('x'.repeat(65537)), 'response-too-large'],
  ]) {
    let calls = 0;
    await assert.rejects(evaluate(corpus(), config, 'key', async () => { calls++; return mock(); }), { message: code });
    assert.equal(calls, 1);
  }
  await assert.rejects(evaluate(corpus(), config, ''), /missing-api-key/);
});
test('deadline covers a stalled request', async () => {
  const keepAlive = setInterval(() => {}, 1000);
  try {
    await assert.rejects(evaluate(corpus(), { ...config, timeoutMs: 100 }, 'key', async (_, { signal }) =>
      new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))), /api-timeout/);
  } finally { clearInterval(keepAlive); }
});
test('invalid thresholds and deadlines fail closed', () => {
  for (const raw of [{ 'min-probability': 'NaN' }, { 'min-probability': '0.49' }, { 'min-confidence': '2' }, { 'timeout-ms': '0' }]) {
    assert.throws(() => configuration(raw), /invalid-configuration/);
  }
});


test('malformed answers expose bounded structural diagnostics without provider strings', () => {
  for (const [mutate, issue] of [
    [r => { delete r.answers.support_0_0; }, 'missing-or-invalid-answer'],
    [r => { r.answers.support_0_0.type = 'PRIVATE_RESPONSE'; }, 'answer-type'],
    [r => { r.answers.support_0_0.choice = 'PRIVATE_RESPONSE'; }, 'unknown-choice'],
    [r => { r.answers.support_0_0.confidence = 'PRIVATE_RESPONSE'; }, 'confidence-range'],
    [r => { r.answers.support_0_0.probabilities = { PRIVATE_RESPONSE: 1 }; }, 'probability-keys'],
    [r => { r.answers.support_0_0.probabilities.supports = Infinity; }, 'probability-range'],
    [r => { r.answers.support_0_0.probabilities.supports = 0.5; }, 'probability-total'],
    [r => { r.answers.support_0_0.choice = 'irrelevant'; }, 'choice-not-maximum'],
  ]) {
    const data = response(); mutate(data);
    assert.throws(() => decisionFromResponse(data, config, corpus()), error => {
      assert.equal(error.code, 'invalid-response');
      assert.equal(error.diagnostics.question, 'support_0_0');
      assert.equal(error.diagnostics.issue, issue);
      assert.doesNotMatch(JSON.stringify(error.diagnostics), /PRIVATE_RESPONSE|PRIVATE_EVIDENCE/);
      return true;
    });
  }
});
