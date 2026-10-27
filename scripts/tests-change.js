import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { readJson, MAX_BYTES } from '../src/io.js';
import { testFiles, testsContractDigest, validateChange, validateTask } from '../src/tests.js';

// Read immutable Git objects, not working-tree files. Never execute PR code.
export function collectTestsChange(baseSha, headSha, contract, task, cwd = process.cwd()) {
  if (![baseSha, headSha].every(x => /^[a-f0-9]{40}$/.test(x))) throw new Error('invalid-revision');
  validateTask(task);
  const git = args => new TextDecoder('utf-8', { fatal: true }).decode(execFileSync('git', ['--literal-pathspecs', ...args], {
    cwd, maxBuffer: MAX_BYTES, stdio: ['ignore', 'pipe', 'pipe'],
  }));
  if (git(['rev-parse', 'HEAD']).trim() !== headSha) throw new Error('head-not-checked-out');
  const mergeBaseSha = git(['merge-base', baseSha, headSha]).trim();
  const paths = git(['diff', '--no-ext-diff', '--no-textconv', '--ignore-submodules=none', '--no-renames', '--name-only', '-z', mergeBaseSha, headSha, '--'])
    .split('\0').filter(Boolean);
  const testBlobs = Object.fromEntries(testFiles(task).map(path => {
    try { return [path, git(['rev-parse', '--verify', '--end-of-options', `${headSha}:${path}`]).trim()]; }
    catch { throw new Error(`test-file-missing: ${path}`); }
  }));
  const change = { version: 2, baseSha, headSha, mergeBaseSha, request: contract?.request,
    requiredChecks: contract?.requiredChecks, paths, testBlobs };
  validateChange(task, change);
  return { change, digest: testsContractDigest(task, change) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [base, head, contractFile, taskFile, output] = process.argv.slice(2);
    if (!output) throw new Error('usage');
    const { change, digest } = collectTestsChange(base, head, await readJson(contractFile), await readJson(taskFile));
    await writeFile(output, JSON.stringify(change, null, 2) + '\n');
    console.log(`Contract SHA-256 for review with scripts/review-contract.js (not an approval): ${digest}`);
  } catch (error) {
    console.error(`Could not collect changes (${error.code || error.message}). Usage: tests-change.js BASE_SHA HEAD_SHA CONTRACT_JSON TASK_JSON OUTPUT`);
    process.exitCode = 1;
  }
}
