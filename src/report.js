const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replace(/[\\`*_{}\[\]()#!|]/g, '\\$&').replace(/[\r\n]/g, ' ');
export function summary(result) {
  const rows = (result.criteria || []).map(c => `| ${escape(c.id)} | ${escape(c.description)} | ${c.verdict} | ${c.reason} | ${c.evidence ? escape(`${c.evidence.id}: ${c.evidence.source}`) : 'none'} |`);
  const verified = (result.criteria || []).filter(c => c.verdict === 'satisfied').length;
  return `### REV: ${result.decision}\n\n${verified}/${result.criteria?.length || 0} acceptance criteria verified by the model. Reason: ${result.reason}.\n\nCommit: ${result.headSha || 'unknown'}\n\n| Criterion | Requirement | Verdict | Reason | Primary evidence |\n| --- | --- | --- | --- | --- |\n${rows.join('\n')}\n\nEvidence references are model-selected citations, not independent proof. This prototype has no established real-world accuracy.\n`;
}
