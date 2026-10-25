import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { readJson, MAX_BYTES } from '../src/io.js';
import { contractDigest, buildCoverage } from '../src/coverage.js';

// Read immutable Git objects, not working-tree files. Never execute PR code.
export function collectChange(baseSha, headSha, contract, task, cwd = process.cwd()) {
  if (![baseSha, headSha].every(x => /^[a-f0-9]{40}$/.test(x))) throw new Error('invalid-revision');
  const git = args => new TextDecoder('utf-8', { fatal: true }).decode(execFileSync('git', ['--literal-pathspecs', ...args], {
    cwd, maxBuffer: MAX_BYTES, stdio: ['ignore', 'pipe', 'pipe'],
  }));
  if (git(['rev-parse', 'HEAD']).trim() !== headSha) throw new Error('head-not-checked-out');
  const mergeBaseSha = git(['merge-base', baseSha, headSha]).trim();
  const paths = git(['diff', '--no-ext-diff', '--no-textconv', '--ignore-submodules=none', '--no-renames', '--name-only', '-z', mergeBaseSha, headSha, '--']).split('\0').filter(Boolean);
  if (!paths.length || paths.length > 40) throw new Error('change-size');
  if (!contract || !contract.mappings || typeof contract.mappings !== 'object' || Array.isArray(contract.mappings)
    || Object.keys(contract.mappings).some(path => !paths.includes(path))) throw new Error('invalid-mappings');
  let bytes = 0;
  const files = paths.map(path => {
    const diff = git(['diff', '--no-color', '--no-ext-diff', '--no-textconv', '--ignore-submodules=none', '--no-renames', '--unified=20', mergeBaseSha, headSha, '--', path]);
    // A textual placeholder cannot establish coverage of an opaque binary change.
    if (/^Binary files .* differ$/m.test(diff) || /^GIT binary patch$/m.test(diff)) throw new Error('binary-change-needs-review');
    if (/^(index .* 160000|(?:new file|deleted file|old|new) mode 160000)$/m.test(diff)) throw new Error('submodule-change-needs-review');
    bytes += Buffer.byteLength(diff);
    if (bytes > MAX_BYTES) throw new Error('change-too-large');
    return { path, diff, criteria: Object.hasOwn(contract.mappings, path) ? contract.mappings[path] : [] };
  });
  const change = { version: 1, baseSha, headSha, mergeBaseSha, request: contract.request,
    requiredChecks: contract.requiredChecks, files };
  const digest = contractDigest(task, change.request, change.requiredChecks);
  buildCoverage(task, change, { 'base-sha': baseSha, 'head-sha': headSha, 'contract-sha256': digest });
  if (Buffer.byteLength(JSON.stringify(change)) > MAX_BYTES) throw new Error('change-too-large');
  return { change, digest };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [base, head, contractFile, taskFile, output] = process.argv.slice(2);
    if (!output) throw new Error();
    const { change, digest } = collectChange(base, head, await readJson(contractFile), await readJson(taskFile));
    await writeFile(output, JSON.stringify(change, null, 2) + '\n');
    console.log(`Contract SHA-256 for independent review (not an approval): ${digest}`);
  } catch {
    console.error('Could not collect complete changes. Check revisions, checkout, mappings and limits. Binary or oversized changes require independent review; never truncate them.');
    process.exitCode = 1;
  }
}
