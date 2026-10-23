import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const entry = fileURLToPath(new URL('../src/index.js', import.meta.url));
function outputValue(text, key) {
  const lines = text.split('\n');
  const start = lines.findIndex(line => line.startsWith(`${key}<<`));
  assert.notEqual(start, -1, `missing output ${key}`);
  return lines[start + 1];
}

test('real action entrypoint writes outputs, summaries, and correct exit codes', async t => {
  for (const scenario of ['approve', 'default-policy', 'deny', 'uncertain', 'http-error', 'invalid-corpus', 'missing-key', 'file-error']) {
    await t.test(scenario, async () => {
      const dir = await mkdtemp(join(tmpdir(), 'rev-'));
      const shouldApprove = scenario === 'approve' || scenario === 'default-policy';
      try {
        const evidence = join(dir, 'evidence.txt');
        await writeFile(evidence, 'Tool output: release artifact signed.');
        const preload = `
          globalThis.fetch = async (url, options) => {
            const body = JSON.parse(options.body);
            if (body.state.evidence !== 'Tool output: release artifact signed.') throw new Error('Missing evidence');
            if (${JSON.stringify(scenario)} === 'http-error') return new Response('PRIVATE_PROVIDER_RESPONSE', {status: 503});
            const approve = ${scenario === 'deny' ? 0.01 : scenario === 'uncertain' ? 0.6 : 0.99};
            return Response.json({model:'jev-1.14.0',answers:{gate:{type:'choice',choice:approve>0.5?'approve':'deny',confidence:0.98,probabilities:{approve,deny:1-approve}}}});
          };
        `;
        const env = {
          ...process.env, TYPESAFE_API_KEY: '', INPUT_POLICY: scenario === 'default-policy' ? '' : 'Release artifact must be signed.',
          'INPUT_API-KEY': scenario === 'missing-key' ? '' : 'FAKE_TEST_KEY',
          INPUT_STEPS: scenario === 'invalid-corpus' ? '{broken SECRET_EVIDENCE' : '{"build":{"outcome":"success"}}',
          INPUT_NEEDS: '{}', INPUT_INPUTS: '{}', 'INPUT_PRIOR-INPUTS': '{}',
          'INPUT_CORPUS-FILE': scenario === 'file-error' ? join(dir, 'missing') : evidence,
          GITHUB_OUTPUT: join(dir, 'output'), GITHUB_STEP_SUMMARY: join(dir, 'summary'),
        };
        const child = spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(preload)}`, entry], { env, encoding: 'utf8' });
        assert.equal(child.error, undefined);
        assert.equal(child.status, shouldApprove ? 0 : 1, child.stdout + child.stderr);
        const output = await readFile(env.GITHUB_OUTPUT, 'utf8');
        assert.equal(outputValue(output, 'decision'), shouldApprove ? 'approve' : 'deny');
        assert.equal(outputValue(output, 'approved'), String(shouldApprove));
        if (shouldApprove) {
          assert.equal(outputValue(output, 'probability'), '0.99');
          assert.match(child.stdout, /REV metrics: approve-probability=0.99 confidence=0.98 duration-ms=\d+/);
        }
        if (scenario === 'missing-key') assert.equal(outputValue(output, 'reason'), 'missing-api-key');
        const summary = await readFile(env.GITHUB_STEP_SUMMARY, 'utf8');
        assert.match(summary, /REV: (approve|deny)/);
        assert.doesNotMatch(child.stdout + child.stderr + output + summary, /PRIVATE_PROVIDER_RESPONSE|SECRET_EVIDENCE|release artifact signed/);
      } finally { await rm(dir, { recursive: true, force: true }); }
    });
  }
});
