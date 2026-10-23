export const MAX_CORPUS_BYTES = 1024 * 1024;

function objectInput(name, value) {
  if (!value?.trim()) return {};
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${name} must be valid JSON`);
  }
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error(`${name} must be a JSON object`);
  }
  return parsed;
}

// No API calls or log scraping: callers explicitly supply GitHub expression
// contexts and action inputs that GitHub does not make available to later steps.
export function buildCorpus(raw = {}, env = process.env) {
  const names = ['steps', 'needs', 'inputs', 'prior-inputs'];
  const bytes = names.reduce((sum, name) => sum + Buffer.byteLength(raw[name] ?? ''), 0);
  if (bytes > MAX_CORPUS_BYTES) throw new Error('Corpus exceeds the 1 MiB limit');
  return {
    version: 1,
    run: {
      repository: env.GITHUB_REPOSITORY ?? '',
      workflow: env.GITHUB_WORKFLOW ?? '',
      id: env.GITHUB_RUN_ID ?? '',
      attempt: env.GITHUB_RUN_ATTEMPT ?? '',
      job: env.GITHUB_JOB ?? '',
      event: env.GITHUB_EVENT_NAME ?? '',
      ref: env.GITHUB_REF ?? '',
      sha: env.GITHUB_SHA ?? '',
    },
    steps: objectInput('steps', raw.steps),
    needs: objectInput('needs', raw.needs),
    inputs: objectInput('inputs', raw.inputs),
    priorInputs: objectInput('prior-inputs', raw['prior-inputs']),
  };
}
