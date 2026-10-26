import { INSTRUCTIONS, RELATION_INSTRUCTIONS } from './policy.js';
import { GateError } from './errors.js';
import { coverageQuestions } from './coverage.js';
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
    decision: 'deny', approved: false, reason, headSha: corpus.headSha, scope: corpus.scope,
    coverage: { verdict: corpus.change ? 'unverified' : 'not-assessed', reason,
      unmappedFiles: corpus.change?.files.filter(f => !f.criteria.length).map(f => f.path) || [] },
    criteria: corpus.task.criteria.map(c => ({ ...c, verdict: 'unverified', reason, evidence: [] })),
  };
}
export function preflight(corpus) {
  if (corpus.scope === 'pull-request' && !corpus.change) return blockedResult(corpus, 'missing-change');
  if (corpus.change) {
    if (corpus.change.files.some(f => !f.criteria.length)) return blockedResult(corpus, 'unmapped-changes');
    if (corpus.change.requiredChecks.some(name => !Object.hasOwn(corpus.needs, name))) return blockedResult(corpus, 'missing-required-checks');
  }
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
  const questions = coverageQuestions(corpus);
  corpus.task.criteria.forEach((criterion, i) => {
    const instructions = { ...INSTRUCTIONS, criterion, target: `state.task.criteria[${i}]` };
    questions[`criterion_${i}`] = {
      type: 'choice', instructions,
      criteria: {
        satisfied: 'Specific supplied evidence establishes the required behavior, with no unresolved contradiction.',
        violated: 'Specific supplied evidence demonstrates that the required behavior is incorrect.',
        unverified: 'The required behavior cannot be established from the supplied evidence.',
      },
    };
    corpus.evidence.forEach((item, j) => {
      questions[`support_${i}_${j}`] = {
        type: 'choice',
        instructions: {
          ...RELATION_INSTRUCTIONS, criterion, evidenceId: item.id,
          target: `state.evidence[${j}]`, requirement: `state.task.criteria[${i}]`,
        },
        criteria: {
          supports: 'This item provides concrete implementation or behavioral support for the required behavior.',
          contradicts: 'This item provides concrete evidence that the current implementation violates the requirement.',
          irrelevant: 'This item provides neither concrete support nor contradiction, or its relationship is uncertain.',
        },
      };
    });
  });
  return { model: config.model, state: corpus, questions };
}
async function boundedJson(response) {
  if (!response.body) throw new GateError('invalid-response', { issue: 'missing-response-body' });
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
    throw new GateError('invalid-response', { issue: 'invalid-json' });
  } finally {
    reader.releaseLock();
  }
}

export function choice(answer, options, question) {
  // Diagnostics use only local field names and finite numeric aggregates.
  // Never copy provider strings, response bodies, instructions or evidence.
  const invalid = (issue, extra = {}) => { throw new GateError('invalid-response', { question, issue, ...extra }); };
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) invalid('missing-or-invalid-answer');
  if (answer.type !== 'choice') invalid('answer-type');
  if (!options.includes(answer.choice)) invalid('unknown-choice');
  if (!probability(answer.confidence)) invalid('confidence-range');
  const p = answer.probabilities;
  if (!p || typeof p !== 'object' || Array.isArray(p) || Object.keys(p).length !== options.length
    || options.some(k => !Object.hasOwn(p, k))) invalid('probability-keys');
  if (options.some(k => !probability(p[k]))) invalid('probability-range');
  const total = options.reduce((sum, k) => sum + p[k], 0);
  if (Math.abs(total - 1) > 0.001) invalid('probability-total', { total });
  if (options.some(k => p[k] > p[answer.choice])) invalid('choice-not-maximum', {
    selectedProbability: p[answer.choice], maximumProbability: Math.max(...options.map(k => p[k])),
  });
  return answer;
}
export function decisionFromResponse(response, config, corpus) {
  if (typeof response?.model !== 'string' || !response.model.trim() || response.model.length > 200) throw new GateError('invalid-response', { issue: 'model-field' });
  const criteria = corpus.task.criteria.map((criterion, i) => {
    const verdict = choice(response.answers?.[`criterion_${i}`], ['satisfied', 'violated', 'unverified'], `criterion_${i}`);
    const enough = a => a.probabilities[a.choice] >= config.minProbability && a.confidence >= config.minConfidence;
    const assessments = corpus.evidence.map((item, j) => {
      const answer = choice(response.answers?.[`support_${i}_${j}`], ['supports', 'contradicts', 'irrelevant'], `support_${i}_${j}`);
      return { id: item.id, kind: item.kind, source: item.source, relation: answer.choice,
        probability: answer.probabilities[answer.choice], confidence: answer.confidence, accepted: enough(answer) };
    });
    const references = assessments.filter(a => a.accepted && a.relation !== 'irrelevant');
    const supporting = references.some(a => a.relation === 'supports' && ['code', 'diff'].includes(a.kind))
      && references.some(a => a.relation === 'supports' && ['behavior', 'test'].includes(a.kind));
    const contradicting = references.some(a => a.relation === 'contradicts');
    const supported = enough(verdict) && (verdict.choice === 'satisfied' ? supporting && !contradicting
      : verdict.choice === 'violated' ? contradicting : false);
    return {
      ...criterion, verdict: supported ? verdict.choice : 'unverified', modelVerdict: verdict.choice,
      reason: !enough(verdict) ? 'below-threshold'
        : verdict.choice === 'satisfied' && contradicting ? 'contradictory-evidence'
        : !supported ? 'insufficient-evidence'
        : verdict.choice === 'satisfied' ? 'evidence-supports-criterion' : 'evidence-contradicts-criterion',
      evidence: references.map(({ id, kind, source, relation }) => ({ id, kind, source, relation })),
      probability: verdict.probabilities[verdict.choice], confidence: verdict.confidence,
      evidenceAssessments: assessments,
    };
  });
  const coverageTargets = corpus.change ? [
    { question: 'coverage_request', target: 'request' },
    ...corpus.change.files.map((f, i) => ({ question: `coverage_file_${i}`, target: f.path, criteria: f.criteria })),
  ] : [];
  const assessments = coverageTargets.map(target => {
    const a = choice(response.answers?.[target.question], ['covered', 'missing', 'unverified'], target.question);
    const accepted = a.probabilities[a.choice] >= config.minProbability && a.confidence >= config.minConfidence;
    return { ...target, verdict: accepted ? a.choice : 'unverified', modelVerdict: a.choice,
      probability: a.probabilities[a.choice], confidence: a.confidence };
  });
  const coverage = { verdict: !corpus.change ? 'not-assessed'
    : assessments.every(a => a.verdict === 'covered') ? 'covered'
    : assessments.some(a => a.verdict === 'missing') ? 'missing' : 'unverified', assessments };
  const criteriaVerified = criteria.every(c => c.verdict === 'satisfied');
  const coverageVerified = !corpus.change || coverage.verdict === 'covered';
  const approved = criteriaVerified && coverageVerified;
  return {
    decision: approved ? 'approve' : 'deny', approved,
    reason: !coverageVerified ? 'coverage-unverified' : approved ? 'criteria-verified' : criteria.some(c => c.verdict === 'violated') ? 'criteria-violated' : 'criteria-unverified',
    scope: corpus.scope, coverage, criteriaVerified,
    ...(corpus.change ? { baseSha: corpus.change.baseSha, contractSha256: corpus.change.contractSha256 } : {}),
    model: response.model, headSha: corpus.headSha, criteria,
  };
}
export async function evaluate(corpus, config, apiKey, fetchImpl = fetch) {
  const blocked = preflight(corpus);
  if (blocked) return blocked;
  if (!apiKey?.trim()) throw new GateError('missing-api-key');
  const signal = AbortSignal.timeout(config.timeoutMs);
  try {
    return decisionFromResponse(await sendRequest(requestBody(corpus, config), apiKey, fetchImpl, signal), config, corpus);
  } catch (error) {
    if (signal.aborted) throw new GateError('api-timeout');
    if (error instanceof GateError) throw error;
    throw new GateError('api-unavailable');
  }
}

export async function sendRequest(body, apiKey, fetchImpl, signal) {
  const response = await fetchImpl(ENDPOINT, {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey.trim()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), redirect: 'error', signal,
  });
  if (!response.ok) {
    // Read only the existing bounded JSON envelope. Never publish provider text,
    // request echoes, URLs or arbitrary error codes. Keep HTTP failures stable.
    let issue = 'provider-rejected-request';
    if (response.status === 400) {
      try {
        const error = await boundedJson(response);
        const detail = error?.detail;
        const fields = [error?.code, detail?.code, detail?.type,
          typeof detail === 'string' ? detail : detail?.message];
        if (fields.some(value => typeof value === 'string' && /\bmax_tokens_exceeded\b/.test(value))) {
          issue = 'model-context-limit';
        }
      } catch { /* Malformed or oversized errors still report only HTTP status. */ }
    } else { await response.body?.cancel(); }
    throw new GateError(`api-http-${response.status}`, {
      issue, requestBytes: Buffer.byteLength(JSON.stringify(body)),
      stateBytes: Buffer.byteLength(JSON.stringify(body.state)),
      questions: Object.keys(body.questions).length,
    });
  }
  return boundedJson(response);
}
