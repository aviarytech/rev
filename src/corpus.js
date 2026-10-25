import { GateError } from './errors.js';
import { MAX_BYTES } from './io.js';
import { buildCoverage } from './coverage.js';
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const text = (x, limit) => typeof x === 'string' && x.trim().length > 0 && x.length <= limit;
const id = x => typeof x === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(x) && x !== 'none';
const sha = x => typeof x === 'string' && /^[a-f0-9]{40}$/.test(x);
function context(value) {
  try {
    const parsed = JSON.parse(value || '{}');
    if (!object(parsed)) throw new Error();
    return parsed;
  } catch { throw new GateError('invalid-context'); }
}

export function buildCorpus(task, evidence, raw = {}, env = {}, change) {
  if (!object(task) || task.version !== 1 || !text(task.task, 16000)
    || !Array.isArray(task.criteria) || !task.criteria.length || task.criteria.length > 20
    || task.criteria.some(c => !object(c) || !id(c.id) || !text(c.description, 4000))
    || new Set(task.criteria.map(c => c.id)).size !== task.criteria.length) throw new GateError('invalid-task');
  if (!object(evidence) || evidence.version !== 1 || !sha(evidence.headSha)
    || !Array.isArray(evidence.items) || evidence.items.length > 40
    || evidence.items.some(e => !object(e) || !id(e.id) || !text(e.source, 500)
      || !['diff', 'code', 'test', 'behavior', 'report'].includes(e.kind) || !text(e.content, MAX_BYTES))
    || new Set(evidence.items.map(e => e.id)).size !== evidence.items.length) throw new GateError('invalid-evidence');
  if (task.criteria.length * (evidence.items.length + 1) > 100) throw new GateError('too-many-assessments');
  if (!sha(raw['head-sha'])) throw new GateError('invalid-head-sha');
  if (raw['head-sha'] !== evidence.headSha) throw new GateError('stale-evidence');
  const scope = raw.scope || 'pull-request';
  if (!['pull-request', 'acceptance'].includes(scope)) throw new GateError('invalid-scope');
  if (scope === 'acceptance' && (change || raw['change-file'] || raw['contract-sha256'])) throw new GateError('invalid-scope');
  const coverage = scope === 'pull-request' ? buildCoverage(task, change, raw) : undefined;
  if (task.criteria.length * (evidence.items.length + 1) + (coverage ? coverage.files.length + 1 : 0) > 100) {
    throw new GateError('too-many-assessments');
  }
  const corpus = {
    version: 2,
    scope,
    ...(coverage ? { change: coverage } : {}),
    headSha: raw['head-sha'],
    task: { task: task.task, criteria: task.criteria.map(c => ({ id: c.id, description: c.description })) },
    evidence: evidence.items.map(e => ({ id: e.id, kind: e.kind, source: e.source, content: e.content })),
    steps: context(raw.steps), needs: context(raw.needs),
    run: { repository: env.GITHUB_REPOSITORY || '', id: env.GITHUB_RUN_ID || '', attempt: env.GITHUB_RUN_ATTEMPT || '' },
  };
  if (Buffer.byteLength(JSON.stringify(corpus)) > MAX_BYTES) throw new GateError('evidence-too-large');
  return corpus;
}
