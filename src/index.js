import { appendFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { buildCorpus } from './corpus.js';
import { configuration, evaluate, blockedResult, GateError } from './gate.js';
import { readJson } from './io.js';
import { summary } from './report.js';
const names = ['api-key', 'task-file', 'evidence-file', 'head-sha', 'steps', 'needs',
  'model', 'min-probability', 'min-confidence', 'timeout-ms', 'report-file'];
const escapeCommand = x => String(x).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
export async function run(env = process.env, fetchImpl = fetch) {
  const start = performance.now();
  const raw = Object.fromEntries(names.map(n => [n, env[`INPUT_${n.toUpperCase()}`] || '']));
  let result, corpus, config;
  try {
    if (!raw['task-file'] || !raw['evidence-file']) throw new GateError('missing-input');
    config = configuration(raw);
    const task = await readJson(raw['task-file']);
    const evidence = await readJson(raw['evidence-file']);
    corpus = buildCorpus(task, evidence, raw, env);
    const key = raw['api-key'] || env.TYPESAFE_API_KEY;
    if (key) process.stdout.write(`::add-mask::${escapeCommand(key)}\n`);
    result = await evaluate(corpus, config, key, fetchImpl);
  } catch (error) {
    const reason = error instanceof GateError ? error.code : 'internal-error';
    result = corpus ? blockedResult(corpus, reason) : { decision: 'deny', approved: false, reason, criteria: [] };
    if (error instanceof GateError && error.diagnostics) result.diagnostics = error.diagnostics;
  }
  if (config) result.thresholds = { probability: config.minProbability, confidence: config.minConfidence };
  result.version = 3;
  result['duration-ms'] = Math.round(performance.now() - start);
  const reportFile = raw['report-file'] || 'rev-report.json';
  // Write the report before approval outputs: a reporting failure must not publish approval.
  await writeFile(reportFile, JSON.stringify(result, null, 2) + '\n');
  if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, summary(result));
  if (env.GITHUB_OUTPUT) {
    const outputs = { decision: result.decision, approved: result.approved, reason: result.reason,
      'head-sha': result.headSha || '', verified: result.criteria.filter(c => c.verdict === 'satisfied').length,
      total: result.criteria.length, 'report-file': reportFile, model: result.model || '', 'duration-ms': result['duration-ms'] };
    await appendFile(env.GITHUB_OUTPUT, Object.entries(outputs).map(([name, value]) => {
      const delimiter = `rev_${randomUUID()}`;
      return `${name}<<${delimiter}\n${value}\n${delimiter}\n`;
    }).join(''));
  }
  if (result.diagnostics) process.stdout.write(`REV diagnostics: ${JSON.stringify(result.diagnostics)}\n`);
  process.stdout.write(`REV: ${result.decision} (${result.reason})\n`);
  if (!result.approved) process.stdout.write(`::error::REV denied: ${result.reason}\n`);
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { if (!(await run()).approved) process.exitCode = 1; }
  catch { process.stdout.write('::error::REV could not publish its report\n'); process.exitCode = 1; }
}
