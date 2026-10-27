export function benignRace(error) {
  return ['closed-pr','PR changed before publication'].includes(error.message);
}
export async function affectedPulls(event,api) {
  let numbers;
  if(event.action==='rev-local-review')numbers=[event.client_payload?.payload?.prNumber];
  else if(event.pull_request)numbers=[event.pull_request.number];
  else if(event.workflow_run)numbers=(event.workflow_run.pull_requests||[]).map(p=>p.number);
  else {
    const prs=await api('/pulls?state=open&per_page=100');
    if(prs.length>=100)throw Error('Too many PRs for one refresh');
    numbers=prs.map(p=>p.number);
  }
  if(numbers.some(n=>!Number.isSafeInteger(n)||n<1))throw Error('Invalid review PR number');
  return [...new Set(numbers)];
}
