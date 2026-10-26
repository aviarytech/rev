// Run only from an immutable, trusted checkout in a workflow_run workflow.
// PR artifacts are data. This module never imports or executes PR files.
import { readFile, appendFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const fail = reason => { throw new Error(reason); };
export function githubClient(repository, token, fetchImpl = fetch) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !token) fail('invalid-github-configuration');
  return async (path, method = 'GET', body) => {
    if (!path.startsWith('/')) fail('invalid-api-path');
    const response = await fetchImpl(`https://api.github.com/repos/${repository}${path}`, {
      method, redirect: 'error', headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) fail(`github-http-${response.status}`);
    return response.json();
  };
}

export async function verifyRun(api, event, policy) {
  const id = event.workflow_run?.id;
  if (!Number.isSafeInteger(id) || id < 1 || !Object.keys(policy.jobs || {}).length) fail('invalid-review-context');
  const [run, workflow] = await Promise.all([api(`/actions/runs/${id}`), api(`/actions/workflows/${encodeURIComponent(policy.workflow)}`)]);
  if (run.event !== 'pull_request' || run.workflow_id !== workflow.id || run.path !== workflow.path
    || workflow.path !== `.github/workflows/${policy.workflow}` || run.repository?.full_name !== policy.repository
    || !sha(run.head_sha) || !Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1) fail('untrusted-source-run');
  if (run.run_attempt !== event.workflow_run.run_attempt) fail('stale-run-attempt');
  const associated = (run.pull_requests || []).filter(p => p.head?.sha === run.head_sha && p.base?.repo?.id === run.repository.id);
  if (associated.length !== 1) fail('unbound-source-pr');
  const snapshot = associated[0];
  const pr = await api(`/pulls/${snapshot.number}`);
  if (pr.state !== 'open' || pr.head?.sha !== run.head_sha || pr.head?.repo?.id !== run.head_repository?.id
    || pr.base?.repo?.id !== run.repository.id || !sha(pr.base.sha) || pr.base.sha !== snapshot.base.sha) fail('stale-pr-revisions');
  const latest = await api(`/actions/workflows/${workflow.id}/runs?event=pull_request&head_sha=${run.head_sha}&per_page=100`);
  // Reject superseded runs, including retries at the same SHA. Limit ambiguity
  // rather than guessing when GitHub cannot return the complete matching set.
  if (latest.total_count > 100 || !latest.workflow_runs?.some(r => r.id === run.id)
    || latest.workflow_runs.some(r => r.id > run.id && r.head_repository?.id === run.head_repository.id && r.head_branch === run.head_branch)) fail('superseded-source-run');
  return {run, pr};
}

async function checkFor(api, context, create, name) {
  const {run, pr} = context;
  const external = `rev:${run.id}:${run.run_attempt}`;
  const list = await api(`/commits/${pr.head.sha}/check-runs?check_name=${encodeURIComponent(name)}&filter=all&per_page=100`);
  if (list.total_count > 100) fail('ambiguous-check-history');
  const matches = list.check_runs.filter(c => c.external_id === external && c.app?.slug === 'github-actions');
  if (matches.length > 1) fail('ambiguous-review-check');
  if (matches.length) return matches[0];
  if (!create) fail('missing-review-check');
  return api('/check-runs', 'POST', {name,head_sha:pr.head.sha,external_id:external,status:'in_progress',
    details_url:run.html_url, output:{title:'REV evaluation pending',summary:'Waiting for verified CI evidence and trusted evaluation.'}});
}

export async function prepareReview(api, event, policy) {
  const context = await verifyRun(api,event,policy);
  const {run,pr} = context;
  // Late start notifications must never overwrite a completed review.
  if (event.action !== 'completed' && run.status === 'completed') return {ready:false,reason:'late-start-event'};
  const check = await checkFor(api,context,true,policy.checkName || 'REV');
  if (event.action !== 'completed') return {ready:false,reason:'ci-running'};
  if (run.status !== 'completed') fail('source-run-not-completed');
  const deny = async reason => {
    await api(`/check-runs/${check.id}`,'PATCH',{status:'completed',conclusion:'failure',output:{title:'REV evaluation blocked',summary:reason}});
    return {ready:false,reason};
  };
  const jobs = await api(`/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`);
  if (jobs.total_count > 100) return deny('Too many source jobs to verify.');
  const needs = {};
  for (const [id,name] of Object.entries(policy.jobs)) {
    const matches = jobs.jobs.filter(job => job.name === name);
    if (matches.length !== 1 || matches[0].status !== 'completed' || matches[0].conclusion !== 'success') return deny(`Required CI job did not pass: ${id}`);
    needs[id] = {result:'success'};
  }
  const artifacts = await api(`/actions/runs/${run.id}/artifacts?name=rev-acceptance-evidence&per_page=100`);
  const matches = artifacts.artifacts.filter(a => a.name === 'rev-acceptance-evidence');
  if (artifacts.total_count !== 1 || matches.length !== 1 || matches[0].expired
    || matches[0].workflow_run?.id !== run.id || matches[0].workflow_run?.head_sha !== run.head_sha
    || matches[0].size_in_bytes <= 0 || matches[0].size_in_bytes > 10*1024*1024) return deny('Missing, ambiguous, expired or invalid evidence artifact.');
  // Artifacts survive reruns. The uploader must replace its artifact each attempt;
  // require that this one was created during the exact attempt being reviewed.
  if (!Number.isFinite(Date.parse(matches[0].created_at)) || !Number.isFinite(Date.parse(run.run_started_at))
    || Date.parse(matches[0].created_at) < Date.parse(run.run_started_at)) return deny('Evidence artifact belongs to an earlier run attempt. Rerun evidence collection.');
  return {ready:true,pr_number:pr.number,head_sha:pr.head.sha,base_sha:pr.base.sha,
    run_id:run.id,artifact_id:matches[0].id,check_id:check.id,needs:JSON.stringify(needs)};
}

export async function publishReview(api,event,policy,report,detailsUrl) {
  const context = await verifyRun(api,event,policy);
  const check = await checkFor(api,context,false,policy.checkName || 'REV');
  const approved = report?.approved === true && report.decision === 'approve' && report.scope === 'pull-request'
    && report.headSha === context.pr.head.sha && report.baseSha === context.pr.base.sha && report.coverage?.verdict === 'covered';
  const output = {title:approved?'REV approved':'REV denied',summary: approved
    ? 'The trusted evaluator approved the reviewed request and complete PR evidence. Overall merge readiness still requires repository policy and independent review.'
    : 'REV did not establish approval. Inspect the trusted evaluator run and its report for the cause.'};
  await api(`/check-runs/${check.id}`,'PATCH',{status:'completed',conclusion:approved?'success':'failure',details_url:detailsUrl,output});
  return approved;
}

export async function main(env=process.env) {
  const event=JSON.parse(await readFile(env.GITHUB_EVENT_PATH,'utf8'));
  const policy={repository:env.GITHUB_REPOSITORY,workflow:'ci.yml',checkName:env.REV_CHECK_NAME || 'REV',jobs:JSON.parse(env.REV_REQUIRED_JOBS)};
  const api=githubClient(policy.repository,env.GITHUB_TOKEN);
  if (env.REV_REVIEW_PHASE === 'prepare') {
    const outputs=await prepareReview(api,event,policy);
    for(const [key,value] of Object.entries(outputs)) {
      const delimiter=`rev_${randomUUID()}`;
      await appendFile(env.GITHUB_OUTPUT,`${key}<<${delimiter}\n${value}\n${delimiter}\n`);
    }
  } else if(env.REV_REVIEW_PHASE === 'publish') {
    let report;
    try {report=JSON.parse(await readFile(env.REV_REPORT_FILE,'utf8'));} catch {report=null;}
    const approved=await publishReview(api,event,policy,report,`https://github.com/${policy.repository}/actions/runs/${env.GITHUB_RUN_ID}`);
    if(!approved) process.exitCode=1;
  } else fail('invalid-review-phase');
}
if(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error=>{console.error(`REV trusted workflow: ${error.message}`);process.exitCode=1;});
}
