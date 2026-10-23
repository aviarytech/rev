import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCorpus, MAX_CORPUS_BYTES } from '../src/corpus.js';

test('retains the supplied evidence and identifies the workflow run', () => {
  const corpus = buildCorpus({
    steps: '{"build":{"outcome":"success","outputs":{"digest":"abc"}}}',
    needs: '{"test":{"result":"success"}}',
    inputs: '{"environment":"production"}',
    'prior-inputs': '{"build":{"target":"release"}}',
  }, { GITHUB_RUN_ID: '123', GITHUB_SHA: 'sha' });
  assert.equal(corpus.steps.build.outputs.digest, 'abc');
  assert.equal(corpus.needs.test.result, 'success');
  assert.equal(corpus.inputs.environment, 'production');
  assert.equal(corpus.priorInputs.build.target, 'release');
  assert.equal(corpus.run.id, '123');
  assert.equal(corpus.run.sha, 'sha');
});

test('defaults missing contexts to empty objects', () => {
  assert.deepEqual(buildCorpus({}, {}).steps, {});
});

test('rejects invalid evidence without echoing its contents', () => {
  for (const steps of ['null', '[]', '"secret"', '{secret']) {
    assert.throws(() => buildCorpus({ steps }, {}), /steps must be/);
  }
});

test('bounds corpus size before parsing', () => {
  assert.throws(() => buildCorpus({ steps: ' '.repeat(MAX_CORPUS_BYTES + 1) }), /1 MiB/);
});
