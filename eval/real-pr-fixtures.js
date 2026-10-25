import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildCorpus } from '../src/corpus.js';
import { contractDigest } from '../src/coverage.js';

// Artifacts remain in their owning repository. Never bundle private source here.
export async function realPrFixtures(directory, name) {
  const read = async file => JSON.parse(await readFile(resolve(directory, `${file}.json`), 'utf8'));
  const [task, evidence, change] = await Promise.all(['task', 'evidence', 'change'].map(read));
  const needs = Object.fromEntries(change.requiredChecks.map(id => [id, { result: 'success' }]));
  const corpus = buildCorpus(task, evidence, {
    'head-sha': change.headSha, 'base-sha': change.baseSha,
    'contract-sha256': contractDigest(task, change.request, change.requiredChecks), needs: JSON.stringify(needs),
  }, {}, change);
  // This digest only binds an OFFLINE fixture; it never provisions workflow trust.
  const cases = [{ name: `${name}-original`, corpus, expectedCoverage: 'covered',
    label: 'Coverage reviewed against the immutable request and diff. Overall approval is deliberately unlabeled: external provenance claims are not independently established by this artifact.' }];
  const add = (suffix, edit, expectedCoverage, expectedApproved = false, expectedReason) => {
    const c = structuredClone(corpus); edit(c);
    cases.push({ name: `${name}-${suffix}`, corpus: c, expectedCoverage, expectedApproved, expectedReason });
  };
  add('missing-request-obligation', c => {
    c.change.request.text += '\nAlso implement a new public HTTP endpoint GET /rev-health returning status 200 and JSON {"healthy":true}, with authentication tests.';
  }, 'missing');
  add('uncovered-file-behavior', c => {
    c.change.files.push({ path: 'src/rev-health.js', criteria: ['operator-contract'], diff: 'diff --git a/src/rev-health.js b/src/rev-health.js\nnew file mode 100644\n--- /dev/null\n+++ b/src/rev-health.js\n@@ -0,0 +1 @@\n+export const health = () => ({status: 200, body: {healthy: true}});\n' });
  }, 'missing');
  add('unmapped-file', c => { c.change.files[0].criteria = []; }, 'unverified', false, 'unmapped-changes');
  add('failed-check', c => { c.needs[c.change.requiredChecks[0]].result = 'failure'; }, 'unverified', false, 'ci-not-successful');
  add('missing-evidence', c => { c.evidence = []; }, 'unverified', false, 'missing-evidence');
  return cases;
}
