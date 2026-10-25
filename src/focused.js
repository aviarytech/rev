import { requestBody, preflight, decisionFromResponse, GateError } from './gate.js';

// Experimental: isolate each question's semantic inputs without selecting or
// discarding evidence. Every criterion still sees every evidence item, and every
// criterion/item relation is assessed. Production evaluate() is unchanged.
export function focusedRequests(corpus, config) {
  const full = requestBody(corpus, config);
  return Object.entries(full.questions).map(([name, original]) => {
    const question = structuredClone(original);
    let state;
    if (name === 'coverage_request') {
      state = { task: corpus.task, change: { request: corpus.change.request } };
    } else if (name.startsWith('coverage_file_')) {
      const file = corpus.change.files[Number(name.slice('coverage_file_'.length))];
      state = { task: { criteria: corpus.task.criteria.filter(c => file.criteria.includes(c.id)) }, change: { files: [file] } };
      question.instructions.target = 'state.change.files[0]';
    } else {
      const [, i, j] = name.split('_').map((v, index) => index ? Number(v) : v);
      state = { task: { criteria: [corpus.task.criteria[i]] }, evidence: j === undefined ? corpus.evidence : [corpus.evidence[j]] };
      question.instructions.target = j === undefined ? 'state.task.criteria[0]' : 'state.evidence[0]';
      if (j !== undefined) question.instructions.requirement = 'state.task.criteria[0]';
    }
    return { model: full.model, state, questions: { [name]: question } };
  });
}

export async function evaluateFocused(corpus, config, apiKey, fetchImpl = fetch) {
  const blocked = preflight(corpus);
  if (blocked) return blocked;
  if (!apiKey?.trim()) throw new GateError('missing-api-key');
  const requests = focusedRequests(corpus, config);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const answers = {};
  let next = 0, model;
  try {
    // A shared deadline and bounded concurrency; no retries or early approval.
    await Promise.all(Array.from({ length: Math.min(4, requests.length) }, async () => {
      while (next < requests.length && !controller.signal.aborted) {
        const request = requests[next++];
        const result = await send(request, apiKey, fetchImpl, controller.signal);
        if (model !== undefined && result.model !== model) throw new GateError('inconsistent-model');
        model = result.model;
        const name = Object.keys(request.questions)[0];
        answers[name] = result.answers?.[name];
      }
    }));
    if (controller.signal.aborted) throw new GateError('api-timeout');
    return decisionFromResponse({ model, answers }, config, corpus);
  } catch (error) {
    const timedOut = controller.signal.aborted;
    controller.abort();
    if (timedOut) throw new GateError('api-timeout');
    if (error instanceof GateError) throw error;
    throw new GateError('api-unavailable');
  } finally { clearTimeout(timeout); }
}

// Use the same transport, response bounds and credentials handling as production.
import { sendRequest as send } from './gate.js';
