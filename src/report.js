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
  const verified = criteria.filter(c => c.verdict === 'satisfied').length;
  return `### REV: ${result.decision}\n\n${verified}/${criteria.length} acceptance criteria verified by the model. Reason: ${result.reason}.\n\nCommit: ${result.headSha || 'unknown'}\n\nModel: ${escape(result.model || 'not evaluated')} · Duration: ${metric(result['duration-ms'])} ms\n\nThresholds: choice probability ≥ ${metric(result.thresholds?.probability)} · confidence ≥ ${metric(result.thresholds?.confidence)}\n\n| Criterion | Verdict | Model choice | Choice probability | Confidence | Reason |\n| --- | --- | --- | --- | --- | --- |\n${rows.join('\n')}\n\nChoice probability and confidence refer to the raw model choice; the final verdict can be unverified when evidence or thresholds are insufficient. These scores are not measured correctness probabilities.\n\n<details>\n<summary>Requirements and evidence scores</summary>\n\n${details.join('\n')}\n</details>\n\nEvidence references are model-selected citations, not independent proof. This prototype has no established real-world accuracy.\n`;
}
