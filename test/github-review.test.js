import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareReview,publishReview,githubClient} from '../scripts/github-review.js';
const HEAD='a'.repeat(40), BASE='b'.repeat(40);
function fixture() {
  const event={action:'completed',workflow_run:{id:7,run_attempt:2}};
  const policy={repository:'owner/repo',workflow:'ci.yml',jobs:{tests:'Tests pass','rev-evidence':'Collect evidence'}};
  const run={id:7,run_attempt:2,event:'pull_request',status:'completed',workflow_id:9,path:'.github/workflows/ci.yml',head_sha:HEAD,head_branch:'dependabot/test',repository:{id:1,full_name:'owner/repo'},head_repository:{id:1},pull_requests:[{number:3,head:{sha:HEAD},base:{sha:BASE,repo:{id:1}}}],run_started_at:'2026-01-01T00:00:00Z',html_url:'https://github.com/owner/repo/actions/runs/7'};
  const pr={number:3,state:'open',head:{sha:HEAD,repo:{id:1}},base:{sha:BASE,repo:{id:1}}};
  const jobs={total_count:2,jobs:Object.values(policy.jobs).map(name=>({name,status:'completed',conclusion:'success'}))};
  const artifacts={total_count:1,artifacts:[{id:11,name:'rev-acceptance-evidence',expired:false,size_in_bytes:123,created_at:'2026-01-01T00:01:00Z',workflow_run:{id:7,head_sha:HEAD}}]};
  const check={id:13,external_id:'rev:7:2',app:{slug:'github-actions'}};
  const checks={total_count:0,check_runs:[]}, latest={total_count:1,workflow_runs:[run]}, writes=[];
  const api=async(path,method='GET',body)=>{
    if(method!=='GET') {
      writes.push({path,method,body});
      if(method==='POST') {checks.total_count=1;checks.check_runs=[check];}
      return check;
    }
    if(path==='/actions/runs/7') return run;
    if(path==='/actions/workflows/ci.yml') return {id:9,path:'.github/workflows/ci.yml'};
    if(path==='/pulls/3') return pr;
    if(path.includes('/runs?')) return latest;
    if(path.includes('/check-runs?')) return checks;
    if(path.includes('/jobs?')) return jobs;
    if(path.includes('/artifacts?')) return artifacts;
    assert.fail(`unexpected API request: ${path}`);
  };
  return {api,event,policy,run,pr,jobs,artifacts,checks,latest,writes};
}
test('trusted preparation binds exact PR revisions, artifact, attempt and independently verified CI',async()=>{
  const f=fixture();const result=await prepareReview(f.api,f.event,f.policy);
  assert.deepEqual(result,{ready:true,pr_number:3,head_sha:HEAD,base_sha:BASE,run_id:7,artifact_id:11,check_id:13,needs:JSON.stringify({tests:{result:'success'},'rev-evidence':{result:'success'}})});
  assert.equal(f.writes[0].body.head_sha,HEAD);
  assert.equal(f.writes[0].body.status,'in_progress');
});
test('untrusted, stale and ambiguous run associations cannot publish a check',async()=>{
  for(const mutate of [
    f=>f.run.event='push',f=>f.run.workflow_id=8,f=>f.run.path='.github/workflows/evil.yml',
    f=>f.run.repository.full_name='other/repo',f=>f.run.run_attempt++,f=>f.run.pull_requests=[],
    f=>f.run.pull_requests.push(f.run.pull_requests[0]),f=>f.pr.state='closed',f=>f.pr.head.sha='c'.repeat(40),
    f=>f.pr.base.sha='c'.repeat(40),f=>f.pr.head.repo.id=2,
    f=>f.latest.workflow_runs.push({...f.run,id:8}),f=>f.latest.total_count=101,
  ]) {
    const f=fixture();mutate(f);
    await assert.rejects(prepareReview(f.api,f.event,f.policy));assert.equal(f.writes.length,0);
  }
});
test('failed, skipped, absent or duplicated required jobs block before model use',async()=>{
  for(const mutate of [f=>f.jobs.jobs[0].conclusion='failure',f=>f.jobs.jobs[0].conclusion='skipped',
    f=>f.jobs.jobs.pop(),f=>f.jobs.jobs.push(f.jobs.jobs[0]),f=>f.jobs.total_count=101]) {
    const f=fixture();mutate(f);const result=await prepareReview(f.api,f.event,f.policy);
    assert.equal(result.ready,false);assert.equal(f.writes.at(-1).body.conclusion,'failure');
  }
});
test('missing, stale, mismatched or ambiguous artifacts cannot be evaluated',async()=>{
  for(const mutate of [f=>f.artifacts.total_count=0,f=>f.artifacts.artifacts.push(f.artifacts.artifacts[0]),
    f=>f.artifacts.artifacts[0].expired=true,f=>f.artifacts.artifacts[0].workflow_run.id=6,
    f=>f.artifacts.artifacts[0].workflow_run.head_sha='c'.repeat(40),f=>f.artifacts.artifacts[0].created_at='2025-12-31T23:59:59Z',
    f=>f.artifacts.artifacts[0].size_in_bytes=11*1024*1024]) {
    const f=fixture();mutate(f);assert.equal((await prepareReview(f.api,f.event,f.policy)).ready,false);
    assert.equal(f.writes.at(-1).body.conclusion,'failure');
  }
});
test('start events create pending checks but late starts never overwrite completion',async()=>{
  const f=fixture();f.event.action='in_progress';f.run.status='in_progress';
  assert.equal((await prepareReview(f.api,f.event,f.policy)).ready,false);
  assert.equal(f.writes.length,1);assert.equal(f.writes[0].body.status,'in_progress');
  f.run.status='completed';await prepareReview(f.api,f.event,f.policy);assert.equal(f.writes.length,1);
});
test('publication requires an exact trusted approval and rechecks freshness after evaluation',async()=>{
  const report={approved:true,decision:'approve',scope:'pull-request',headSha:HEAD,baseSha:BASE,coverage:{verdict:'covered'}};
  for(const mutate of [r=>r,r=>null,r=>({...r,approved:false}),r=>({...r,headSha:'c'.repeat(40)}),
    r=>({...r,baseSha:'c'.repeat(40)}),r=>({...r,scope:'acceptance'}),r=>({...r,coverage:{verdict:'unverified'}})]) {
    const f=fixture();await prepareReview(f.api,f.event,f.policy);
    const input=mutate(report);const expected=input===report;
    assert.equal(await publishReview(f.api,f.event,f.policy,input,'https://github.com/owner/repo/actions/runs/99'),expected);
    assert.equal(f.writes.at(-1).body.conclusion,expected?'success':'failure');
  }
  for(const mutate of [f=>f.pr.head.sha='c'.repeat(40),f=>f.run.run_attempt++,f=>f.latest.workflow_runs.push({...f.run,id:8})]) {
    const f=fixture();await prepareReview(f.api,f.event,f.policy);mutate(f);
    await assert.rejects(publishReview(f.api,f.event,f.policy,report,'https://github.com/owner/repo/actions/runs/99'));
    assert.equal(f.writes.length,1);
  }
});
test('GitHub transport never follows redirects or exposes API bodies in errors',async()=>{
  const api=githubClient('owner/repo','fake',async(url,options)=>{
    assert.equal(url,'https://api.github.com/repos/owner/repo/actions/runs/7');
    assert.equal(options.redirect,'error');
    return new Response('secret arbitrary response',{status:403});
  });
  await assert.rejects(api('/actions/runs/7'),error=>error.message==='github-http-403');
});
