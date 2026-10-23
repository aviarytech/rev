import { INSTRUCTIONS } from './policy.js';
import { GateError } from './errors.js';
export { GateError } from './errors.js';
const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const probability = x => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1;
function option(value, fallback, min, max) {
  const n = Number(value?.trim() || fallback);
  if (!Number.isFinite(n) || n < min || n > max) throw new GateError('invalid-configuration');
  return n;
}
export function configuration(raw = {}) {
  return {
    model: raw.model?.trim() || 'jev-1.14.0',
    minProbability: option(raw['min-probability'], 0.9, 0.5, 1),
    minConfidence: option(raw['min-confidence'], 0.8, 0, 1),
    timeoutMs: option(raw['timeout-ms'], 10000, 100, 60000),
  };
}
export function blockedResult(corpus, reason) {
  return {
    decision: 'deny', approved: false, reason, headSha: corpus.headSha,
    criteria: corpus.task.criteria.map(c => ({ ...c, verdict: 'unverified', reason, evidence: null })),
  };
}
export function preflight(corpus) {
  let success = false;
  for (const step of Object.values(corpus.steps)) {
    if (!step || typeof step !== 'object' || Array.isArray(step)) throw new GateError('invalid-step');
    if (!['success', 'failure', 'cancelled', 'skipped'].includes(step.outcome)) throw new GateError('invalid-step-status');
    for (const status of [step.outcome, step.conclusion]) {
      if (status !== undefined && !['success', 'failure', 'cancelled', 'skipped'].includes(status)) throw new GateError('invalid-step-status');
      if (status === 'failure' || status === 'cancelled') return blockedResult(corpus, 'ci-not-successful');
    }
    if (step.outcome === 'success') success = true;
  }
  for (const job of Object.values(corpus.needs)) {
    if (!job || !['success', 'failure', 'cancelled', 'skipped'].includes(job.result)) throw new GateError('invalid-job-status');
    if (job.result !== 'success') return blockedResult(corpus, 'ci-not-successful');
    success = true;
  }
  if (!success) return blockedResult(corpus, 'missing-ci-results');
  if (!corpus.evidence.length) return blockedResult(corpus, 'missing-evidence');
  return null;
}
export function requestBody(corpus, config) {
  const questions = {};
  corpus.task.criteria.forEach((criterion, i) => {
    const instructions = { ...INSTRUCTIONS, criterion };
    questions[`criterion_${i}`] = {
      type: 'choice', instructions,
      criteria: {
        satisfied: 'Specific supplied evidence establishes the required behavior, with no unresolved contradiction.',
        violated: 'Specific supplied evidence demonstrates that the required behavior is incorrect.',
        unverified: 'The required behavior cannot be established from the supplied evidence.',
      },
    };
    questions[`evidence_${i}`] = {
      type: 'choice', instructions: { ...instructions, citation: 'Select the primary evidence item that directly establishes satisfaction or violation of this criterion. Select none if no item establishes either. Review all items for contradictions.' },
      criteria: Object.fromEntries([['none', 'No supplied evidence item establishes satisfaction or violation.'],
        ...corpus.evidence.map(e => [e.id, `Evidence item ${e.id}: ${e.kind}, ${e.source}`])]),
    };
  });
  return { model: config.model, state: corpus, questions };
}
async function boundedJson(response) {
  if (!response.body) throw new GateError('invalid-response');
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 65536) {
        await reader.cancel();
        throw new GateError('response-too-large');
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    if (error instanceof GateError) throw error;
    if (error.name === 'AbortError' || error.name === 'TimeoutError') throw new GateError('api-timeout');
    throw new GateError('invalid-response');
  } finally {
    reader.releaseLock();
  }
}

function choice(answer, options) {
  const p = answer?.probabilities;
  if (answer?.type !== 'choice' || !options.includes(answer.choice) || !probability(answer.confidence)
    || !p || Object.keys(p).length !== options.length || options.some(k => !probability(p[k]))
    || Math.abs(options.reduce((sum, k) => sum + p[k], 0) - 1) > 0.001
    || options.some(k => p[k] > p[answer.choice])) throw new GateError('invalid-response');
  return answer;
}
export function decisionFromResponse(response, config, corpus) {
  if (typeof response?.model !== 'string' || !response.model.trim() || response.model.length > 200) throw new GateError('invalid-response');
  const criteria = corpus.task.criteria.map((criterion, i) => {
    const verdict = choice(response.answers?.[`criterion_${i}`], ['satisfied', 'violated', 'unverified']);
    const citation = choice(response.answers?.[`evidence_${i}`], ['none', ...corpus.evidence.map(e => e.id)]);
    const enough = a => a.probabilities[a.choice] >= config.minProbability && a.confidence >= config.minConfidence;
    const item = corpus.evidence.find(e => e.id === citation.choice);
    const supported = verdict.choice !== 'unverified' && item && enough(verdict) && enough(citation);
    return {
      ...criterion, verdict: supported ? verdict.choice : 'unverified',
      reason: !enough(verdict) || !enough(citation) ? 'below-threshold'
        : verdict.choice === 'unverified' || !item ? 'insufficient-evidence'
        : verdict.choice === 'satisfied' ? 'evidence-supports-criterion' : 'evidence-contradicts-criterion',
      evidence: supported ? { id: item.id, kind: item.kind, source: item.source } : null,
      probability: verdict.probabilities[verdict.choice], confidence: verdict.confidence,
      citationProbability: citation.probabilities[citation.choice], citationConfidence: citation.confidence,
    };
  });
  const approved = criteria.every(c => c.verdict === 'satisfied');
  return {
    decision: approved ? 'approve' : 'deny', approved,
    reason: approved ? 'criteria-verified' : criteria.some(c => c.verdict === 'violated') ? 'criteria-violated' : 'criteria-unverified',
    model: response.model, headSha: corpus.headSha, criteria,
  };
}
export async function evaluate(corpus, config, apiKey, fetchImpl = fetch) {
  const blocked = preflight(corpus);
  if (blocked) return blocked;
  if (!apiKey?.trim()) throw new GateError('missing-api-key');
  const signal = AbortSignal.timeout(config.timeoutMs);
  try {
    const response = await fetchImpl(ENDPOINT, {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey.trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody(corpus, config)), redirect: 'error', signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new GateError(`api-http-${response.status}`);
    }
    return decisionFromResponse(await boundedJson(response), config, corpus);
  } catch (error) {
    if (signal.aborted) throw new GateError('api-timeout');
    if (error instanceof GateError) throw error;
    throw new GateError('api-unavailable');
  }
}
