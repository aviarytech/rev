// Advisory, deterministic follow-up only: never changes a verdict or threshold.
export function guidance(result) {
  if (result.approved) return { kind: 'none', steps: [], criteria: [] };
  if (['coverage-unverified', 'unmapped-changes', 'missing-reviewed-contract', 'contract-mismatch'].includes(result.reason)) {
    const criterionAdvice = result.reason === 'coverage-unverified'
      ? guidance({ ...result, reason: 'criteria-unverified' }).criteria : [];
    return { kind: 'review-required', coverage: (result.coverage?.assessments || [])
      .filter(a => a.verdict !== 'covered').map(a => ({
        target: a.target, criteria: a.criteria || [], modelVerdict: a.modelVerdict,
        probability: a.probability, confidence: a.confidence,
        reason: a.modelVerdict === 'covered' ? 'below-threshold' : a.verdict === 'missing' ? 'missing-coverage' : 'ambiguous-coverage',
        step: a.modelVerdict === 'covered'
          ? 'The model selected covered but did not meet the thresholds. No specific missing obligation was identified; compare this target and its criteria independently before changing code.'
          : 'Inspect this target against its mapped criteria for an omitted or ambiguous obligation. The choice alone does not identify which obligation is missing.',
      })), steps: [
      'Compare the original request and every changed file with the acceptance criteria. Add missing observable obligations and their implementation and behavioral evidence; unrelated passing regressions do not verify this PR.',
      'Have an independent reviewer approve the task, original request and required CI jobs. Supply the resulting contract digest through trusted workflow configuration. Do not compute and approve a new digest automatically from the PR.',
      'Preserve unresolved coverage findings. Do not switch to acceptance-only mode, drop changed files or narrow the request to obtain approval.',
    ], criteria: criterionAdvice };
  }
  if (!['criteria-unverified', 'criteria-violated'].includes(result.reason)) {
    const step = result.reason === 'ci-not-successful'
      ? 'Inspect the failed, cancelled or skipped CI operation, repair it, and regenerate evidence for the current head.'
      : result.reason === 'stale-evidence'
        ? 'Regenerate evidence from the current PR head and supply its matching head SHA.'
        : 'Inspect the reported reason and any diagnostics; repair the CI inputs, evidence collection, configuration or provider failure before evaluating again.';
    return { kind: 'evaluation-blocked', steps: [
      step,
      'Evaluation was blocked; this result does not establish an implementation defect. See docs/agents.md and docs/reference.md in the REV repository.',
    ], criteria: [] };
  }
  return {
    kind: 'review-required',
    steps: [
      'Review each unresolved criterion before concluding that the evaluator is wrong. A raw satisfied choice or green tests alone does not establish approval.',
      'Trace the real entry point through controls, handlers and state changes to the API or mutation boundary. Check relevant negative paths and bypasses; passing tests may omit them.',
      'If review reveals a defect, reproduce it with a regression that fails before the fix and passes after it. Include valid-path assertions and current implementation plus execution evidence.',
      'Regenerate evidence for the current head after meaningful changes. Do not lower thresholds, weaken criteria, add unjustified guards or repeatedly retry unchanged denials.',
      'If concrete review and reproduction still disagree with REV, preserve the criterion, source assessments and reproduction as a labeled evaluation case and request human review. See docs/agents.md in the REV repository.',
    ],
    criteria: (result.criteria || []).filter(c => c.verdict !== 'satisfied').map(c => {
      const assessments = c.evidenceAssessments || [];
      const supports = kinds => assessments.some(a => a.accepted && a.relation === 'supports' && kinds.includes(a.kind));
      const missingSupport = [];
      const steps = [];
      if (!supports(['code', 'diff'])) {
        missingSupport.push('implementation');
        steps.push('No implementation support was accepted. Inspect the actual handler and protection at the mutation boundary; supply relevant source or diff with enough surrounding context. This gap does not prove the protection is absent.');
      }
      if (!supports(['behavior', 'test'])) {
        missingSupport.push('behavior');
        steps.push('No behavioral support was accepted. Exercise the production path and relevant negative cases; supply expected versus observed results and assertions, not only a passing test count.');
      }
      if (assessments.some(a => a.accepted && a.relation === 'contradicts') || c.verdict === 'violated') {
        steps.push('Inspect the accepted contradicting sources and reproduce the claimed mismatch against the requirement. Repair confirmed defects or incorrect test expectations.');
      }
      if (c.reason === 'below-threshold') {
        steps.push('The criterion choice missed a probability or confidence threshold, even if the raw choice was satisfied. Review the implementation and evidence for uncovered obligations or ambiguity; the score alone does not identify a defect.');
      }
      if (!steps.length) steps.push('Inspect the raw verdict and source assessments for unresolved obligations or conflicting evidence, then reproduce the relevant behavior.');
      return { id: c.id, missingSupport, steps };
    }),
  };
}
