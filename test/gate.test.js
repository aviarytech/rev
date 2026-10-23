import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCorpus } from '../src/corpus.js';
import { configuration, decisionFromResponse, evaluate } from '../src/gate.js';
import { DEFAULT_POLICY } from '../src/policy.js';

const config = configuration({ policy: 'Build must pass and produce a release digest.' });
const corpus = buildCorpus({ steps: '{"build":{"outcome":"success","conclusion":"success","outputs":{"digest":"abc"}}}' }, {});
const response = (approve = 0.98, confidence = 0.96) => ({
  model: 'jev-1.14.0',
  answers: { gate: { type: 'choice', choice: approve >= 0.5 ? 'approve' : 'deny',
    probabilities: { approve, deny: 1 - approve }, confidence } },
});

test('makes one documented Choice request with the entire corpus', async () => {
  let calls = 0;
  const result = await evaluate(corpus, config, 'key', async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'Bearer key');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    const body = JSON.parse(options.body);
    assert.deepEqual(body.state, corpus);
    assert.equal(body.model, 'jev-1.14.0');
    assert.equal(body.questions.gate.type, 'choice');
    assert.equal(body.questions.gate.instructions.policy, config.policy);
    assert.deepEqual(Object.keys(body.questions.gate.criteria), ['approve', 'deny']);
    return Response.json(response());
  });
  assert.equal(calls, 1);
  assert.equal(result.decision, 'approve');
  assert.equal(result.approved, true);
});

test('requires an approve choice and both inclusive thresholds', () => {
  assert.equal(decisionFromResponse(response(0.9, 0.8), config).approved, true);
  assert.equal(decisionFromResponse(response(0.89, 0.9), config).reason, 'below-threshold');
  assert.equal(decisionFromResponse(response(0.99, 0.79), config).reason, 'below-threshold');
  assert.equal(decisionFromResponse(response(0.01), config).reason, 'policy-denied');
});

test('denies masked failures, cancelled steps, and unsuccessful dependencies without API calls', async () => {
  for (const raw of [
    { steps: '{"test":{"outcome":"failure","conclusion":"success"}}' },
    { steps: '{"test":{"outcome":"cancelled"}}' },
    ...['failure', 'cancelled', 'skipped'].map(result => ({ needs: JSON.stringify({ test: { result } }) })), {},
  ]) {
    const result = await evaluate(buildCorpus(raw, {}), config, '', () => assert.fail('must not call API'));
    assert.equal(result.approved, false);
  }
});

test('rejects malformed, inconsistent, and nonfinite API answers', () => {
  for (const mutate of [
    r => { delete r.answers; }, r => { r.answers.gate.choice = 'yes'; },
    r => { r.answers.gate.type = 'noul'; }, r => { r.answers.gate.confidence = null; },
    r => { r.answers.gate.confidence = Infinity; },
    r => { r.answers.gate.probabilities.approve = '0.99'; },
    r => { r.answers.gate.probabilities.deny = 0.5; },
    r => { r.answers.gate.probabilities.extra = 0; },
    r => { r.answers.gate.choice = 'deny'; }, r => { r.model = ''; },
  ]) {
    const data = response();
    mutate(data);
    assert.throws(() => decisionFromResponse(data, config), /invalid-response/);
  }
});

test('fails closed on HTTP, network, invalid JSON, and oversized responses without retries or body leakage', async () => {
  for (const [mock, code] of [
    [() => new Response('sensitive provider error', { status: 401 }), 'api-http-401'],
    [() => new Response('rate limited', { status: 429 }), 'api-http-429'],
    [() => { throw new Error('sensitive network message'); }, 'api-unavailable'],
    [() => new Response('not JSON'), 'invalid-response'],
    [() => new Response('x'.repeat(65537)), 'response-too-large'],
  ]) {
    let calls = 0;
    await assert.rejects(evaluate(corpus, config, 'key', async () => { calls++; return mock(); }), { message: code });
    assert.equal(calls, 1);
  }
  await assert.rejects(evaluate(corpus, config, ''), /missing-api-key/);
});

test('aborts requests at the configured deadline', async () => {
  const keepAlive = setInterval(() => {}, 1000);
  try {
    await assert.rejects(evaluate(corpus, { ...config, timeoutMs: 100 }, 'key', async (_, { signal }) => {
      return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    }), /api-timeout/);
  } finally { clearInterval(keepAlive); }
});

test('validates policy, thresholds, timeout, and status configuration', async () => {
  assert.equal(configuration({}).policy, DEFAULT_POLICY);
  assert.equal(configuration({ policy: '  ' }).policy, DEFAULT_POLICY);
  assert.equal(configuration({ policy: 'Custom condition' }).policy, 'Custom condition');
  for (const raw of [
    { policy: 'x'.repeat(16001) }, { policy: 'x', 'min-probability': 'NaN' },
    { policy: 'x', 'min-probability': '0.49' }, { policy: 'x', 'min-confidence': '2' },
    { policy: 'x', 'timeout-ms': '-1' },
  ]) assert.throws(() => configuration(raw));
  for (const raw of [{ steps: '{"x":null}' }, { steps: '{"x":{"outcome":"unknown"}}' }, { needs: '{"x":{}}' }]) {
    await assert.rejects(evaluate(buildCorpus(raw, {}), config, 'key'), /invalid-/);
  }
});
