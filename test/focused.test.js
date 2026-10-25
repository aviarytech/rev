import test from 'node:test';
import assert from 'node:assert/strict';
import { focusedRequests, evaluateFocused } from '../src/focused.js';
import { configuration, requestBody } from '../src/gate.js';
import { coverageFixtures } from '../eval/coverage-fixtures.js';

const config = configuration({});
test('focused requests retain every question and all evidence for each criterion, isolate coverage and relations', async () => {
  const {corpus} = (await coverageFixtures())[0];
  const requests = focusedRequests(corpus, config);
  assert.deepEqual(requests.flatMap(r => Object.keys(r.questions)), Object.keys(requestBody(corpus, config).questions));
  for (const request of requests) {
    const name = Object.keys(request.questions)[0];
    if (name === 'coverage_request') {
      assert.deepEqual(request.state.task, corpus.task);
      assert.equal(request.state.evidence, undefined);
      assert.equal(request.state.change.files, undefined);
    } else if (name.startsWith('coverage_file_')) {
      assert.equal(request.state.change.files.length, 1);
      assert.equal(request.state.evidence, undefined);
    } else if (name.startsWith('criterion_')) {
      assert.deepEqual(request.state.evidence, corpus.evidence);
      assert.equal(request.state.task.criteria.length, 1);
    } else {
      assert.equal(request.state.evidence.length, 1);
      assert.equal(request.state.task.criteria.length, 1);
    }
  }
});
function answer(name, choice) {
  const options = name.startsWith('coverage_') ? ['covered','missing','unverified'] : name.startsWith('criterion_') ? ['satisfied','violated','unverified'] : ['supports','contradicts','irrelevant'];
  return {type:'choice',choice,confidence:1,probabilities:Object.fromEntries(options.map(k=>[k,k===choice?1:0]))};
}
test('focused aggregation cannot ignore a single uncovered file or contradicted item', async () => {
  const {corpus} = (await coverageFixtures())[0];
  for (const defect of ['none','coverage_file_0','support_0_0']) {
    let calls = 0;
    const fake = async (url, options) => {
      calls++;
      assert.equal(options.redirect, 'error');
      const name = Object.keys(JSON.parse(options.body).questions)[0];
      const value = name === defect ? (defect.startsWith('coverage') ? 'missing' : 'contradicts') : name.startsWith('coverage') ? 'covered' : name.startsWith('criterion') ? 'satisfied' : 'supports';
      return new Response(JSON.stringify({model:'fixture',answers:{[name]:answer(name,value)}}));
    };
    const result = await evaluateFocused(corpus, config, 'fake', fake);
    assert.equal(result.approved, defect === 'none');
    assert.equal(calls, focusedRequests(corpus, config).length);
  }
});
test('focused evaluator fails closed before calls, on missing answers, HTTP errors and deadline', async () => {
  const {corpus} = (await coverageFixtures())[0];
  const blocked = structuredClone(corpus); blocked.evidence = [];
  assert.equal((await evaluateFocused(blocked, config, 'fake', () => {throw Error('must not call');})).reason, 'missing-evidence');
  await assert.rejects(evaluateFocused(corpus, config, 'fake', async () => new Response(JSON.stringify({model:'fixture',answers:{}}))), {code:'invalid-response'});
  await assert.rejects(evaluateFocused(corpus, config, 'fake', async () => new Response('',{status:503})), {code:'api-http-503'});
  await assert.rejects(evaluateFocused(corpus, {...config,timeoutMs:10}, 'fake', async (_, {signal}) => new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted'))))), {code:'api-timeout'});
});
