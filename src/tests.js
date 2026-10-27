import { GateError } from './errors.js';
import { canonicalDigest } from './coverage.js';

// Deterministic test-backed gate: no model calls, no network. The same inputs always produce the same report.
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const text = (x, max) => typeof x === 'string' && x.trim().length > 0 && x.length <= max;
const sha = x => typeof x === 'string' && /^[a-f0-9]{40}$/.test(x);
const blob = x => typeof x === 'string' && /^([a-f0-9]{40}|[a-f0-9]{64})$/.test(x);
const unique = a => new Set(a).size === a.length;
const criterionId = x => typeof x === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(x);
const relative = p => text(p, 500) && !p.startsWith('/') && !/[\x00-\x1f\\]/.test(p)
  && !p.split('/').some(s => s === '..' || s === '.' || !s);
const STATUSES = ['passed', 'failed', 'skipped'];

// Test IDs are "file > suite > ... > name", as written by scripts/junit.js.
export const testFile = testId => testId.split(' > ')[0];

// Minimal glob: ** spans directories, * and ? stay within one path segment.
export function glob(pattern) {
  let source = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      if (pattern[i + 2] === '/') { source += '(?:.*/)?'; i += 2; } else { source += '.*'; i++; }
    } else if (c === '*') source += '[^/]*';
    else if (c === '?') source += '[^/]';
    else source += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}
// A pattern without a literal segment would map every changed file to one criterion.
const pattern = p => relative(p) && !/^[*?/]*$/.test(p);

export function validateTask(task) {
  if (!object(task) || task.version !== 2 || !text(task.task, 16000)
    || !Array.isArray(task.criteria) || !task.criteria.length || task.criteria.length > 40
    || task.criteria.some(c => !object(c) || !criterionId(c.id) || !text(c.description, 4000)
      || !Array.isArray(c.tests) || !c.tests.length || c.tests.length > 50 || !unique(c.tests)
      || c.tests.some(t => !text(t, 1000) || !t.includes(' > ') || !relative(testFile(t)))
      || !Array.isArray(c.paths) || !c.paths.length || c.paths.length > 50 || !unique(c.paths)
      || c.paths.some(p => !pattern(p)))
    || !unique(task.criteria.map(c => c.id))) throw new GateError('invalid-task');
  return task;
}

export const testFiles = task => [...new Set(task.criteria.flatMap(c => c.tests.map(testFile)))].sort();

export function validateChange(task, change) {
  const files = testFiles(task);
  if (!object(change) || change.version !== 2 || !sha(change.headSha) || !sha(change.baseSha)
    || !sha(change.mergeBaseSha) || !object(change.request) || !text(change.request.text, 16000)
    || !text(change.request.source, 500) || !Array.isArray(change.requiredChecks)
    || !change.requiredChecks.length || change.requiredChecks.length > 40
    || change.requiredChecks.some(x => !text(x, 100)) || !unique(change.requiredChecks)
    || !Array.isArray(change.paths) || !change.paths.length || change.paths.length > 1000
    || change.paths.some(p => !relative(p)) || !unique(change.paths)
    || !object(change.testBlobs) || Object.keys(change.testBlobs).sort().join('\n') !== files.join('\n')
    || Object.values(change.testBlobs).some(x => !blob(x))) throw new GateError('invalid-change');
  return change;
}

// The reviewed contract binds the criteria, test mapping and exact test file contents.
// Editing a named test file after review changes the digest and requires another review.
export function testsContractDigest(task, change) {
  return canonicalDigest({ task, request: change.request, requiredChecks: change.requiredChecks, testBlobs: change.testBlobs });
}

export function validateReport(report) {
  if (!object(report) || report.version !== 1 || !sha(report.sourceSha) || !sha(report.testsSha)
    || !Array.isArray(report.tests) || report.tests.length > 50000
    || report.tests.some(t => !object(t) || !text(t.id, 1000) || !STATUSES.includes(t.status))
    || !unique(report.tests.map(t => t.id))) throw new GateError('invalid-test-report');
  return new Map(report.tests.map(t => [t.id, t.status]));
}

function context(value) {
  try {
    const parsed = JSON.parse(value || '{}');
    if (!object(parsed)) throw new Error();
    return parsed;
  } catch { throw new GateError('invalid-context'); }
}

function ciReason(change, needs) {
  if (change.requiredChecks.some(name => !Object.hasOwn(needs, name))) return 'missing-required-checks';
  for (const job of Object.values(needs)) {
    if (!object(job) || !['success', 'failure', 'cancelled', 'skipped'].includes(job.result)) throw new GateError('invalid-job-status');
    if (job.result !== 'success') return 'ci-not-successful';
  }
  return null;
}

export function evaluateTests(task, change, headReport, baseReport, raw = {}) {
  validateTask(task);
  validateChange(task, change);
  const head = validateReport(headReport);
  const base = validateReport(baseReport);
  if (!sha(raw['head-sha'])) throw new GateError('invalid-head-sha');
  if (!sha(raw['base-sha'])) throw new GateError('invalid-base-sha');
  if (change.headSha !== raw['head-sha'] || change.baseSha !== raw['base-sha']) throw new GateError('stale-change');
  // Head tests run on head sources; the same head test files run on the merge-base sources.
  if (headReport.sourceSha !== change.headSha || headReport.testsSha !== change.headSha
    || baseReport.sourceSha !== change.mergeBaseSha || baseReport.testsSha !== change.headSha) throw new GateError('stale-test-report');
  if (!/^[a-f0-9]{64}$/.test(raw['contract-sha256'] || '')) throw new GateError('missing-reviewed-contract');
  const contractSha256 = testsContractDigest(task, change);
  if (contractSha256 !== raw['contract-sha256']) throw new GateError('contract-mismatch');
  const ci = ciReason(change, context(raw.needs));

  const criteria = task.criteria.map(c => {
    const tests = c.tests.map(id => {
      const headStatus = head.get(id) || 'missing', baseStatus = base.get(id) || 'missing';
      return { id, head: headStatus, base: baseStatus, accepted: headStatus === 'passed' && baseStatus !== 'passed' };
    });
    const [verdict, reason] = tests.some(t => t.head === 'failed') ? ['violated', 'test-failed']
      : tests.every(t => t.accepted) ? ['satisfied', 'tests-pass-only-with-change']
      : tests.some(t => t.head !== 'passed') ? ['unverified', 'test-not-run']
      : ['unverified', 'passes-without-change'];
    return { id: c.id, description: c.description, verdict, reason, tests };
  });
  const files = change.paths.map(path => ({ path,
    criteria: task.criteria.filter(c => c.paths.some(p => glob(p).test(path))).map(c => c.id) }));
  const unmappedFiles = files.filter(f => !f.criteria.length).map(f => f.path);
  const coverage = { verdict: unmappedFiles.length ? 'missing' : 'covered', unmappedFiles, files };
  const criteriaVerified = criteria.every(c => c.verdict === 'satisfied');
  const approved = !ci && !unmappedFiles.length && criteriaVerified;
  return {
    decision: approved ? 'approve' : 'deny', approved,
    reason: ci || (unmappedFiles.length ? 'unmapped-changes' : criteriaVerified ? 'criteria-verified'
      : criteria.some(c => c.verdict === 'violated') ? 'criteria-violated' : 'criteria-unverified'),
    scope: 'tests', coverage, criteriaVerified, headSha: change.headSha, baseSha: change.baseSha,
    mergeBaseSha: change.mergeBaseSha, contractSha256, criteria,
  };
}

// Advisory, deterministic follow-up only: never changes a verdict.
export function testsGuidance(result) {
  if (result.approved) return { kind: 'none', steps: [], criteria: [] };
  const blocked = {
    'contract-mismatch': 'The task, request, required checks or a named test file changed since the contract was reviewed. Run scripts/review-contract.js for this PR and pin the new digest only if the review approves.',
    'missing-reviewed-contract': 'No reviewed contract digest is configured for this PR. Run scripts/review-contract.js and pin its digest through trusted repository configuration.',
    'ci-not-successful': 'Repair the failed, cancelled or skipped CI job, then rerun.',
    'missing-required-checks': 'Add every required CI job to the REV job\'s needs.',
    'stale-change': 'Collect the change manifest from the current head and base.',
    'stale-test-report': 'Regenerate both test reports: head tests on head sources, and head test files on merge-base sources.',
    'unmapped-changes': 'Map every changed file to the criterion it serves with a path glob, then review the contract again. Do not add catch-all patterns.',
  }[result.reason];
  const steps = blocked ? [blocked] : !['criteria-unverified', 'criteria-violated'].includes(result.reason)
    ? ['Inspect the reported reason; repair the task, change manifest or test reports before evaluating again.'] : [];
  const advice = {
    'test-failed': 'A named test fails on head. Fix the implementation or, if the test expectation is wrong, change the test and review the contract again.',
    'test-not-run': 'A named test is missing or skipped in the head report. Check the test ID and that the test file runs in the head report.',
    'passes-without-change': 'A named test also passes on the merge base, so it does not demonstrate this change. Strengthen it to assert the new behavior.',
  };
  return { kind: blocked || steps.length ? 'evaluation-blocked' : 'review-required', steps,
    criteria: (result.criteria || []).filter(c => c.verdict !== 'satisfied').map(c => ({ id: c.id, steps: [advice[c.reason]] })) };
}
