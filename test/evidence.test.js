import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { HEAD } from './support.js';
const script = fileURLToPath(new URL('../scripts/evidence.js', import.meta.url));
test('collector preserves explicit file content and refuses missing or invalid sources', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rev-evidence-'));
  try {
    await writeFile(join(dir, 'source.js'), 'export const answer = 42;\n');
    const sources = join(dir, 'sources.json');
    const out = join(dir, 'evidence.json');
    await writeFile(sources, JSON.stringify([{ id: 'code', kind: 'code', path: 'source.js' }]));
    const collect = () => spawnSync(process.execPath, [script, HEAD, sources, out], { cwd: dir, encoding: 'utf8' });
    assert.equal(collect().status, 0);
    const evidence = JSON.parse(await readFile(out, 'utf8'));
    assert.equal(evidence.headSha, HEAD);
    assert.equal(evidence.items[0].content, 'export const answer = 42;\n');
    for (const source of [
      { id: 'code', kind: 'code', path: 'missing-secret-file' },
      { id: 'code', kind: 'invalid', path: 'source.js' },
    ]) {
      await rm(out);
      await writeFile(sources, JSON.stringify([source]));
      const result = collect();
      assert.equal(result.status, 1);
      assert.doesNotMatch(result.stdout + result.stderr, /missing-secret-file|export const/);
      await assert.rejects(readFile(out));
      await writeFile(out, 'placeholder');
    }
    await writeFile(join(dir, 'source.js'), 'x'.repeat(1024 * 1024 + 1));
    await writeFile(sources, JSON.stringify([{ id: 'code', kind: 'code', path: 'source.js' }]));
    assert.equal(collect().status, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
