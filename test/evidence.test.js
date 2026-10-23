import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('collector grows evidence with recorded operations and preserves failures and missing logs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rev-evidence-'));
  const script = fileURLToPath(new URL('../scripts/collect-evidence.js', import.meta.url));
  const collect = async steps => {
    const child = spawnSync(process.execPath, [script], {
      env: { ...process.env, RUNNER_TEMP: dir, REV_STEPS: JSON.stringify(steps) }, encoding: 'utf8',
    });
    assert.equal(child.status, 0, child.stderr);
    return JSON.parse(await readFile(join(dir, 'rev-evidence.json'), 'utf8'));
  };
  try {
    await writeFile(join(dir, 'rev-setup.log'), 'Installation complete\n');
    assert.deepEqual(await collect({ setup: { outcome: 'success' } }), { setup: 'Installation complete\n' });
    await writeFile(join(dir, 'rev-test.log'), 'Tests 1 failed\n');
    assert.deepEqual(await collect({ setup: { outcome: 'success' }, test: { outcome: 'failure' },
      typecheck: { outcome: 'success' }, build: { outcome: 'skipped' } }), {
      setup: 'Installation complete\n', test: 'Tests 1 failed\n', typecheck: { missing: true },
    });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
