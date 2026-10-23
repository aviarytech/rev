import { appendFile, open } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { buildCorpus, MAX_CORPUS_BYTES } from './corpus.js';
import { configuration, evaluate, GateError } from './gate.js';

const inputNames = ['api-key', 'policy', 'steps', 'needs', 'inputs', 'prior-inputs',
  'corpus-file', 'model', 'min-probability', 'min-confidence', 'timeout-ms'];
const escapeCommand = text => String(text).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');

async function readEvidence(path) {
  const file = await open(path, 'r');
  try {
    if (!(await file.stat()).isFile()) throw new GateError('invalid-corpus-file');
    // Read at most the limit plus one byte, even if the file grows during reading.
    const buffer = Buffer.alloc(MAX_CORPUS_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await file.read(buffer, size, buffer.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > MAX_CORPUS_BYTES) throw new GateError('corpus-too-large');
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size));
  } finally {
    await file.close();
  }
}

export async function run(env = process.env, fetchImpl = fetch) {
  const start = performance.now();
  let result;
  try {
    const raw = Object.fromEntries(inputNames.map(name => [name, env[`INPUT_${name.toUpperCase()}`] ?? '']));
    const key = raw['api-key'] || env.TYPESAFE_API_KEY;
    if (key) process.stdout.write(`::add-mask::${escapeCommand(key)}\n`);
    const config = configuration(raw);
    let corpus;
    try {
      corpus = buildCorpus(raw, env);
    } catch {
      throw new GateError('invalid-corpus');
    }
    if (raw['corpus-file'].trim()) {
      try {
        corpus.evidence = await readEvidence(raw['corpus-file'].trim());
      } catch (error) {
        if (error instanceof GateError) throw error;
        throw new GateError('invalid-corpus-file');
      }
    }
    if (Buffer.byteLength(JSON.stringify(corpus)) > MAX_CORPUS_BYTES) throw new GateError('corpus-too-large');
    result = await evaluate(corpus, config, key, fetchImpl);
  } catch (error) {
    result = { decision: 'deny', approved: false, reason: error instanceof GateError ? error.code : 'internal-error' };
  }
  result['duration-ms'] = Math.round(performance.now() - start);
  if (env.GITHUB_OUTPUT) {
    const outputs = ['decision', 'approved', 'probability', 'confidence', 'model', 'reason', 'duration-ms'];
    await appendFile(env.GITHUB_OUTPUT, outputs.map(name => {
      const delimiter = `rev_${randomUUID()}`;
      return `${name}<<${delimiter}\n${result[name] ?? ''}\n${delimiter}\n`;
    }).join(''));
  }
  if (env.GITHUB_STEP_SUMMARY) {
    await appendFile(env.GITHUB_STEP_SUMMARY,
      `### REV: ${result.decision}\n\nReason: \`${result.reason}\`\n\nApprove probability: ${result.probability ?? 'n/a'} · Confidence: ${result.confidence ?? 'n/a'} · Duration: ${result['duration-ms']} ms\n`);
  }
  process.stdout.write(`REV: ${result.decision} (${result.reason})\n`);
  if (result.probability !== undefined) {
    process.stdout.write(`REV metrics: approve-probability=${result.probability} confidence=${result.confidence} duration-ms=${result['duration-ms']}\n`);
  }
  if (!result.approved) process.stdout.write(`::error::REV denied: ${result.reason}\n`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await run();
    if (!result.approved) process.exitCode = 1;
  } catch {
    process.stdout.write('::error::REV failed to write its result\n');
    process.exitCode = 1;
  }
}
