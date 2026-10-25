import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { task } from '../eval/fixtures.js';
import { corpus, response, HEAD } from './support.js';
import { answer } from './support.js';
import { coverageFixtures } from '../eval/coverage-fixtures.js';
const entry = fileURLToPath(new URL('../src/index.js', import.meta.url));
function value(text, key) {
  const lines = text.split('\n');
  const at = lines.findIndex(l => l.startsWith(`${key}<<`));
  assert.notEqual(at, -1, `missing ${key}`);
  return lines[at + 1];
}
test('entrypoint reports criterion verdicts, safe summaries, errors and exit status', async t => {
  for (const scenario of ['approve', 'violated', 'unverified', 'missing-key', 'invalid-file', 'stale', 'http-error', 'invalid-response', 'missing-input', 'report-error']) {
    await t.test(scenario, async () => {
      const dir = await mkdtemp(join(tmpdir(), 'rev-'));
      try {
        await writeFile(join(dir, 'task.json'), JSON.stringify(task));
        await writeFile(join(dir, 'evidence.json'), JSON.stringify({ version: 1, headSha: HEAD, items: corpus().evidence }));
        const data = response(scenario === 'violated' ? ['violated', 'satisfied'] : scenario === 'unverified' ? ['unverified', 'satisfied'] : undefined);
        if (scenario === 'invalid-response') delete data.answers.support_0_0;
        const preload = `globalThis.fetch = async () => ${scenario === 'http-error' ? "new Response('PRIVATE_PROVIDER_RESPONSE', {status:503})" : `Response.json(${JSON.stringify(data)})`};`;
        const env = { ...process.env, TYPESAFE_API_KEY: '', 'INPUT_API-KEY': scenario === 'missing-key' ? '' : 'FAKE_TEST_KEY',
          'INPUT_TASK-FILE': scenario === 'missing-input' ? '' : join(dir, 'task.json'),
          'INPUT_EVIDENCE-FILE': join(dir, scenario === 'invalid-file' ? 'missing.json' : 'evidence.json'),
          'INPUT_HEAD-SHA': scenario === 'stale' ? 'b'.repeat(40) : HEAD,
          INPUT_SCOPE: 'acceptance', INPUT_STEPS: '{}', INPUT_NEEDS: '{"ci":{"result":"success"}}',
          'INPUT_REPORT-FILE': scenario === 'report-error' ? join(dir, 'missing', 'report') : join(dir, 'report.json'),
          GITHUB_OUTPUT: join(dir, 'output'), GITHUB_STEP_SUMMARY: join(dir, 'summary') };
        const child = spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(preload)}`, entry], { env, encoding: 'utf8', cwd: dir });
        assert.equal(child.error, undefined);
        assert.equal(child.status, scenario === 'approve' ? 0 : 1, child.stdout + child.stderr);
        if (scenario === 'report-error') {
          await assert.rejects(readFile(env.GITHUB_OUTPUT));
          return;
        }
        const output = await readFile(env.GITHUB_OUTPUT, 'utf8');
        assert.equal(value(output, 'approved'), String(scenario === 'approve'));
        const report = JSON.parse(await readFile(env['INPUT_REPORT-FILE'], 'utf8'));
        assert.equal(report.version, 4);
        assert.equal(report.mergeReadiness, 'not-established');
        assert.equal(report.coverage.verdict, 'not-assessed');
        if (scenario === 'approve') {
          assert.equal(value(output, 'verified'), '2');
          assert.equal(report.criteria[0].evidence[1].id, 'probe');
        }
        if (scenario === 'invalid-response') {
          assert.deepEqual(report.diagnostics, { question: 'support_0_0', issue: 'missing-or-invalid-answer' });
          assert.match(child.stdout, /REV diagnostics:/);
        }
        const summary = await readFile(env.GITHUB_STEP_SUMMARY, 'utf8');
        assert.match(summary, /REV: (approve|deny)/);
        assert.equal(report.guidance.kind, scenario === 'approve' ? 'none'
          : ['violated', 'unverified'].includes(scenario) ? 'review-required' : 'evaluation-blocked');
        if (scenario !== 'approve') {
          assert.match(summary, /### Next steps/);
          assert.match(child.stdout, /REV next steps:/);
        }
        assert.doesNotMatch(child.stdout + child.stderr + output + summary + JSON.stringify(report), /PRIVATE_EVIDENCE|PRIVATE_PROVIDER_RESPONSE/);
      } finally { await rm(dir, { recursive: true, force: true }); }
    });
  }
});

test('default action scope denies missing coverage and publishes explicit PR coverage results', async () => {
  const c = (await coverageFixtures())[0].corpus;
  for (const scenario of ['missing-change', 'covered', 'missing']) {
    const dir = await mkdtemp(join(tmpdir(), 'rev-pr-'));
    try {
      await writeFile(join(dir, 'task.json'), JSON.stringify(task));
      await writeFile(join(dir, 'evidence.json'), JSON.stringify({ version: 1, headSha: HEAD, items: c.evidence }));
      await writeFile(join(dir, 'change.json'), JSON.stringify({ version: 1, headSha: HEAD, ...c.change }));
      const data = response();
      data.answers.coverage_request = answer(scenario === 'missing' ? 'missing' : 'covered', ['covered', 'missing', 'unverified']);
      data.answers.coverage_file_0 = answer('covered', ['covered', 'missing', 'unverified']);
      const preload = scenario === 'missing-change'
        ? 'globalThis.fetch = () => { throw new Error("unexpected request"); };'
        : `globalThis.fetch = async () => Response.json(${JSON.stringify(data)});`;
      const env = { ...process.env, TYPESAFE_API_KEY: '', INPUT_SCOPE: '', 'INPUT_API-KEY': 'FAKE_TEST_KEY',
        'INPUT_TASK-FILE': join(dir, 'task.json'), 'INPUT_EVIDENCE-FILE': join(dir, 'evidence.json'),
        'INPUT_CHANGE-FILE': scenario === 'missing-change' ? '' : join(dir, 'change.json'),
        'INPUT_BASE-SHA': c.change.baseSha, 'INPUT_HEAD-SHA': HEAD, 'INPUT_CONTRACT-SHA256': c.change.contractSha256,
        INPUT_NEEDS: '{"ci":{"result":"success"}}', INPUT_STEPS: '{}', 'INPUT_REPORT-FILE': join(dir, 'report.json'),
        GITHUB_OUTPUT: join(dir, 'output'), GITHUB_STEP_SUMMARY: join(dir, 'summary') };
      const child = spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(preload)}`, entry], { cwd: dir, env, encoding: 'utf8' });
      assert.equal(child.status, scenario === 'covered' ? 0 : 1, child.stdout + child.stderr);
      const report = JSON.parse(await readFile(join(dir, 'report.json'), 'utf8'));
      assert.equal(report.scope, 'pull-request');
      assert.equal(report.coverage.verdict, scenario === 'missing-change' ? 'unverified' : scenario);
      assert.equal(report.mergeReadiness, 'not-established');
      if (scenario === 'missing-change') assert.equal(report.reason, 'missing-change');
      const outputs = await readFile(join(dir, 'output'), 'utf8');
      assert.equal(value(outputs, 'approved'), String(scenario === 'covered'));
      assert.equal(value(outputs, 'coverage'), report.coverage.verdict);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }
});
