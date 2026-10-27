import { guidance } from './guidance.js';
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replace(/[\\`*_{}\[\]()#!|]/g, '\\$&').replace(/[\r\n]/g, ' ');
const metric = value => typeof value === 'number' && Number.isFinite(value) ? String(value) : 'n/a';
export function summary(result) {
  const criteria = result.criteria || [];
  const rows = criteria.map(c => `| ${escape(c.id)} | ${c.verdict} | ${c.modelVerdict || 'n/a'} | ${metric(c.probability)} | ${metric(c.confidence)} | ${c.reason} |`);
  const details = criteria.map(c => {
    const sources = (c.evidenceAssessments || []).map(a => `| ${escape(a.id)} | ${escape(a.source)} | ${a.relation} | ${metric(a.probability)} | ${metric(a.confidence)} | ${a.accepted ? 'yes' : 'no'} |`);
    const references = c.evidence?.length ? c.evidence.map(e => escape(`${e.id}: ${e.source} (${e.relation})`)).join('; ') : 'none';
    return `#### ${escape(c.id)}\n\n${escape(c.description)}\n\nAccepted evidence: ${references}\n\n${sources.length ? `| Source | Location | Relation | Choice probability | Confidence | Accepted |\n| --- | --- | --- | --- | --- | --- |\n${sources.join('\n')}\n` : 'No model evidence assessments were completed.\n'}`;
  });
  const advice = result.guidance || guidance(result);
  const nextSteps = advice.steps.length ? [
    '### Next steps',
    ...advice.steps.map(step => `- ${escape(step)}`),
    ...(advice.coverage || []).map(c => `- ${escape(c.target)}: ${escape(c.reason)}. ${escape(c.step)}`),
    ...advice.criteria.map(c => `#### ${escape(c.id)}

${c.steps.map(step => `- ${escape(step)}`).join('\n')}`),
  ].join('\n\n') + '\n\n' : '';
  const diagnosis = result.denialDiagnostics;
  const diagnosticSection = diagnosis ? `### Advisory denial diagnostics\n\nStatus: ${escape(diagnosis.status)}. These findings cannot change approval. Citation ranges refer to supplied evidence or diff text, not repository line numbers.\n\n${(diagnosis.findings || []).map(f => `#### ${escape(f.target)}\n\n${escape(f.message)}\n\n${f.obligation ? `Obligation: ${escape(f.obligation.source)} characters ${f.obligation.start}–${f.obligation.end}.\n\n` : ''}${f.citation ? `Citation: ${escape(f.citation.id)} (${escape(f.citation.source)}), supplied-text lines ${f.citation.startLine}–${f.citation.endLine}. References checked locally; interpretation remains advisory.\n\n` : ''}Next check: ${escape(f.nextCheck)}\n`).join('\n')}${diagnosis.omittedTargets?.length ? `Not diagnosed within the limit: ${diagnosis.omittedTargets.map(escape).join(', ')}.\n` : ''}\n` : '';
  const verified = criteria.filter(c => c.verdict === 'satisfied').length;
  const coverage = `Scope: ${escape(result.scope || 'acceptance')}. Request/change coverage: ${escape(result.coverage?.verdict || 'not-assessed')}. Overall merge readiness is not established by this check.\n\n`
    + (result.coverage?.assessments || []).map(a => `- ${escape(a.target)}: ${a.verdict} (model: ${a.modelVerdict}; probability ${metric(a.probability)}; confidence ${metric(a.confidence)})`).join('\n')
    + (result.coverage?.unmappedFiles || []).map(path => `\n- Unmapped change: ${escape(path)}`).join('') + '\n\n';
  return `### REV: ${result.decision}\n\n${coverage}${verified}/${criteria.length} acceptance criteria verified by the model. Reason: ${result.reason}.\n\nCommit: ${result.headSha || 'unknown'}\n\nModel: ${escape(result.model || 'not evaluated')} · Duration: ${metric(result['duration-ms'])} ms\n\nThresholds: choice probability ≥ ${metric(result.thresholds?.probability)} · confidence ≥ ${metric(result.thresholds?.confidence)}\n\n| Criterion | Verdict | Model choice | Choice probability | Confidence | Reason |\n| --- | --- | --- | --- | --- | --- |\n${rows.join('\n')}\n\nChoice probability and confidence refer to the raw model choice; the final verdict can be unverified when evidence or thresholds are insufficient. These scores are not measured correctness probabilities.\n\n${nextSteps}${diagnosticSection}<details>\n<summary>Requirements and evidence scores</summary>\n\n${details.join('\n')}\n</details>\n\nEvidence references are model-selected citations, not independent proof. This prototype has no established real-world accuracy.\n`;
}
export function testsSummary(result) {
  const criteria = result.criteria || [];
  const rows = criteria.map(c => `| ${escape(c.id)} | ${c.verdict} | ${c.reason} | ${(c.tests || []).map(t => `${escape(t.id)}: head ${t.head}, base ${t.base}`).join('<br>')} |`);
  const unmapped = (result.coverage?.unmappedFiles || []).map(path => `- Unmapped change: ${escape(path)}`).join('\n');
  const advice = result.guidance || { steps: [], criteria: [] };
  const steps = [...advice.steps, ...advice.criteria.flatMap(c => c.steps.map(s => `${c.id}: ${s}`))].map(s => `- ${escape(s)}`).join('\n');
  return `### REV: ${result.decision}\n\nScope: tests (deterministic, no model call). File coverage: ${escape(result.coverage?.verdict || 'unverified')}. Overall merge readiness is not established by this check.\n\n${criteria.filter(c => c.verdict === 'satisfied').length}/${criteria.length} criteria verified by named tests that pass on head and not on the merge base. Reason: ${result.reason}.\n\nCommit: ${result.headSha || 'unknown'} · Contract: ${result.contractSha256 || 'unverified'} · Duration: ${metric(result['duration-ms'])} ms\n\n${unmapped ? unmapped + '\n\n' : ''}| Criterion | Verdict | Reason | Tests |\n| --- | --- | --- | --- |\n${rows.join('\n')}\n\n${steps ? `### Next steps\n\n${steps}\n` : ''}`;
}
