import {CHECK,EVIDENCE_CHECK,open,digest} from './protocol.js';
const fail=reason=>{throw Error(reason);};
export async function pullContext(api,repository,number) {
  const pr=await api(`/pulls/${number}`);
  if(pr.state!=='open')fail('closed-pr');
  const files=await api(`/pulls/${number}/files?per_page=100`);
  if(pr.changed_files>100||files.length!==pr.changed_files)fail('review-file-limit');
  const paths=[...new Set(files.flatMap(f=>f.status==='renamed'?[f.previous_filename,f.filename]:[f.filename]))];
  if(paths.length>100)fail('review-file-limit');
  return {pr,expected:{repository,prNumber:number,headSha:pr.head.sha,baseSha:pr.base.sha,paths,
    requestSha256:digest({title:pr.title,body:pr.body||''})}};
}
export async function ciStatus(api,pr) {
  const configFile=await api(`/contents/.rev/local-review.json?ref=${pr.base.sha}`);
  if(configFile.type!=='file'||configFile.encoding!=='base64'||configFile.size>16384)fail('invalid-local-policy');
  const config=JSON.parse(Buffer.from(configFile.content,'base64').toString('utf8'));
  if(config.version!==1||!Array.isArray(config.workflows)||!config.workflows.length||config.workflows.length>10)fail('invalid-local-policy');
  if(new Set(config.workflows.map(w=>w.file)).size!==config.workflows.length)fail('invalid-local-policy');
  for(const workflow of config.workflows) {
    if(!/^[\w-]+\.ya?ml$/.test(workflow.file)||!Array.isArray(workflow.jobs)||!workflow.jobs.length||workflow.jobs.some(n=>typeof n!=='string'||!n))fail('invalid-local-policy');
    if(new Set(workflow.jobs).size!==workflow.jobs.length)fail('invalid-local-policy');
    const runs=await api(`/actions/workflows/${workflow.file}/runs?event=pull_request&head_sha=${pr.head.sha}&per_page=100`);
    if(runs.total_count>100)fail('ambiguous-ci-history');
    const candidates=runs.workflow_runs.filter(r=>r.event==='pull_request'&&r.head_sha===pr.head.sha&&r.head_repository?.id===pr.head.repo.id&&r.head_branch===pr.head.ref).sort((a,b)=>b.id-a.id);
    const run=candidates[0];
    if(!run)return {state:'pending',reason:'Waiting for required PR CI'};
    if(!run.pull_requests?.some(p=>p.number===pr.number&&p.base.sha===pr.base.sha&&p.head.sha===pr.head.sha))return {state:'pending',reason:'CI must be refreshed for the current base and head'};
    if(run.status!=='completed')return {state:'pending',reason:'Required PR CI is running'};
    const jobs=await api(`/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`);
    if(jobs.total_count>100)fail('too-many-ci-jobs');
    for(const name of workflow.jobs) {
      const matches=jobs.jobs.filter(j=>j.name===name);
      if(matches.length!==1||matches[0].status!=='completed'||matches[0].conclusion!=='success')return {state:'failure',reason:'A required CI job failed, was skipped, or is missing'};
    }
  }
  return {state:'success',reason:'Required PR CI passed'};
}
async function checks(api,sha,name) {
  const result=await api(`/commits/${sha}/check-runs?check_name=${encodeURIComponent(name)}&filter=all&per_page=100`);
  if(result.total_count>100)fail('too-many-review-checks');
  return result.check_runs;
}
export async function evaluateLocal(api,repository,number,publicKey,envelope,detailsUrl,now=Date.now()) {
  let context=await pullContext(api,repository,number);
  const {pr,expected}=context;
  if(envelope) {
    const verified=open(envelope,publicKey,expected,now); // No write before authentication.
    await api('/check-runs','POST',{name:EVIDENCE_CHECK,head_sha:pr.head.sha,status:'completed',conclusion:'neutral',
      external_id:`rev-local:${digest(envelope)}`,output:{title:'Signed local Claude Code review',summary:verified.approved?'Review completed without findings; CI gate is separate.':'Review has findings or limitations; approval is blocked.',text:JSON.stringify(envelope)}});
  }
  const attestations=(await checks(api,pr.head.sha,EVIDENCE_CHECK)).sort((a,b)=>b.id-a.id);
  let review;
  for(const check of attestations) {
    try {review=open(JSON.parse(check.output?.text),publicKey,expected,now);break;} catch {} // Untrusted or stale attestations never count.
  }
  let state='pending',reason='Waiting for a signed, complete local review of the current head, base and request';
  if(pr.draft){state='failure';reason='PR is still a draft';}
  else if(review&&!review.approved){state='failure';reason='Local review has unresolved findings or limitations';}
  else if(review?.approved) {
    try {({state,reason}=await ciStatus(api,pr));} catch {state='failure';reason='Required CI policy or run could not be verified';}
  }
  // Verify again after API reads, before publishing approval.
  const latest=await api(`/pulls/${number}`);
  if(latest.state!=='open'||latest.head.sha!==expected.headSha||latest.base.sha!==expected.baseSha
    ||digest({title:latest.title,body:latest.body||''})!==expected.requestSha256)fail('PR changed before publication');
  const existing=(await checks(api,pr.head.sha,CHECK)).filter(c=>c.app?.slug==='github-actions'&&c.external_id===`rev-local-gate:${number}`).sort((a,b)=>b.id-a.id)[0];
  const body={name:CHECK,head_sha:pr.head.sha,external_id:`rev-local-gate:${number}`,details_url:detailsUrl,
    status:state==='pending'?'in_progress':'completed',...(state==='pending'?{}:{conclusion:state}),
    output:{title:state==='success'?'Local review and CI passed':'Local review gate not approved',summary:reason}};
  if(existing){delete body.head_sha;await api(`/check-runs/${existing.id}`,'PATCH',body);}else await api('/check-runs','POST',body);
  return {state,reason};
}
