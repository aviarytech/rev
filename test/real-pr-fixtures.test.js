import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { coverageFixtures } from '../eval/coverage-fixtures.js';
import { realPrFixtures } from '../eval/real-pr-fixtures.js';
import { preflight } from '../src/gate.js';

test('real artifact mutations preserve originals, separate coverage labels from approval and block deterministic negatives', async () => {
  const {corpus} = (await coverageFixtures())[0];
  const dir = await mkdtemp(join(tmpdir(),'rev-real-'));
  try {
    const inputs = { task:{version:1,...corpus.task}, evidence:{version:1,headSha:corpus.headSha,items:corpus.evidence}, change:{version:1,headSha:corpus.headSha,...corpus.change} };
    for (const [name,data] of Object.entries(inputs)) await writeFile(join(dir,`${name}.json`),JSON.stringify(data));
    const cases = await realPrFixtures(dir,'fixture');
    assert.equal(cases.length,6);
    assert.equal(cases[0].expectedApproved,undefined);
    assert.deepEqual(cases[0].corpus.change.request,corpus.change.request);
    assert.ok(cases[1].corpus.change.request.text.endsWith('authentication tests.'));
    assert.equal(cases[2].corpus.change.files.length,corpus.change.files.length+1);
    for (const c of cases.slice(3)) {
      assert.equal(c.expectedApproved,false);
      assert.equal(preflight(c.corpus).reason,c.expectedReason);
    }
  } finally {await rm(dir,{recursive:true,force:true});}
});
