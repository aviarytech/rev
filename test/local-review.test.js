import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {seal,open,digest,validateModelReview} from '../src/local/protocol.js';
import {withReviewLock} from '../src/local/lock.js';
import {eligible,identity} from '../scripts/local-review-worker.js';
import {evaluateLocal} from '../src/local/github.js';
const keys=generateKeyPairSync('ed25519');
const now=Date.now();
const expected={repository:'a/b',prNumber:1,headSha:'a'.repeat(40),baseSha:'b'.repeat(40),paths:['x.js'],requestSha256:digest({title:'change',body:''})};
const review={complete:true,reviewedPaths:['x.js'],findings:[],limitations:[],summary:'Reviewed'};
const payload={...expected,version:1,engine:'claude-code',authMethod:'claude.ai',toolVersion:'2',mergeBaseSha:'c'.repeat(40),inputSha256:digest('input'),completedAt:new Date(now).toISOString(),expiresAt:new Date(now+3600000).toISOString(),review};
test('signed review binds exact revisions, request, expiry and coverage',()=>{
 const signed=seal(payload,keys.privateKey);assert.equal(open(signed,keys.publicKey,expected,now).approved,true);
 for(const key of ['repository','prNumber','headSha','baseSha','requestSha256'])assert.throws(()=>open(signed,keys.publicKey,{...expected,[key]:'other'},now));
 assert.throws(()=>open({...signed,payload:{...payload,review:{...review,summary:'tampered'}}},keys.publicKey,expected,now));
 assert.throws(()=>open(signed,keys.publicKey,expected,now+3600000));
 assert.throws(()=>open(seal({...payload,review:{...review,reviewedPaths:[]}},keys.privateKey),keys.publicKey,expected,now));
});
test('findings and limitations block approval; invalid references are rejected',()=>{
 for(const change of [{complete:false,reviewedPaths:[]},{limitations:['Missing context']},{findings:[{path:'x.js',line:1,severity:'high',description:'Concrete defect'}]}])assert.equal(open(seal({...payload,review:{...review,...change}},keys.privateKey),keys.publicKey,expected,now).approved,false);
 assert.throws(()=>validateModelReview({...review,findings:[{path:'elsewhere',line:1,severity:'high',description:'Wrong path'}]},[{path:'x.js',before:'',after:''}]));
});
test('manual and automatic reviews serialize and release after errors',async()=>{
 const home=await mkdtemp(join(tmpdir(),'rev-lock-test-'));
 try{await withReviewLock(home,async()=>{await assert.rejects(withReviewLock(home,()=>{}),/running/);});await assert.rejects(withReviewLock(home,()=>{throw Error('failure');}));await withReviewLock(home,()=>{});}finally{await rm(home,{recursive:true,force:true});}
});
test('worker bounds retries and detects changed requests',()=>{
 assert.equal(eligible(undefined,now),true);assert.equal(eligible({attempts:1,at:now},now),false);assert.equal(eligible({attempts:1,at:now-3600000},now),true);assert.equal(eligible({attempts:2,at:0},now),false);
 const pr={number:1,head:{sha:'a'},base:{sha:'b'},title:'x'};assert.notEqual(identity('a/b',pr),identity('a/b',{...pr,title:'y'}));
});
test('gate authenticates before writing and cannot approve unavailable CI',async()=>{
 const pr={number:1,state:'open',changed_files:1,head:{sha:expected.headSha,repo:{id:1},ref:'branch'},base:{sha:expected.baseSha},title:'change',body:''};
 const writes=[],attestations=[];
 const api=async(path,method,body)=>{
  if(method){writes.push(body);if(body.name==='REV local attestation')attestations.push({id:1,output:body.output});return {};}
  if(path==='/pulls/1')return pr;
  if(path.includes('/files?'))return [{filename:'x.js'}];
  if(path.includes('check_name=REV%20local%20attestation'))return {total_count:attestations.length,check_runs:attestations};
  if(path.includes('/check-runs?'))return {total_count:0,check_runs:[]};
  throw Error('CI unavailable');
 };
 await assert.rejects(evaluateLocal(api,'a/b',1,keys.publicKey,{payload,signature:'bad'},'url',now));assert.equal(writes.length,0);
 const result=await evaluateLocal(api,'a/b',1,keys.publicKey,seal(payload,keys.privateKey),'url',now);
 assert.equal(result.state,'failure');assert.equal(writes.at(-1).conclusion,'failure');
});

test('CI verifies latest exact PR attempt, rejecting skipped jobs and newer running runs',async()=>{
 const {ciStatus}=await import('../src/local/github.js');
 const pr={number:1,head:{sha:expected.headSha,repo:{id:1},ref:'branch'},base:{sha:expected.baseSha}};
 const run={id:2,event:'pull_request',head_sha:pr.head.sha,head_repository:{id:1},head_branch:'branch',pull_requests:[{number:1,head:pr.head,base:pr.base}],status:'completed',run_attempt:2};
 let jobs=[{name:'Tests',status:'completed',conclusion:'success'}];
 const api=async path=>{
  if(path.startsWith('/contents/'))return {type:'file',encoding:'base64',size:100,content:Buffer.from(JSON.stringify({version:1,workflows:[{file:'ci.yml',jobs:['Tests']}]})).toString('base64')};
  if(path.startsWith('/actions/workflows/'))return {total_count:1,workflow_runs:[run]};
  assert.equal(path,'/actions/runs/2/attempts/2/jobs?per_page=100');return {total_count:jobs.length,jobs};
 };
 assert.equal((await ciStatus(api,pr)).state,'success');
 jobs[0].conclusion='skipped';assert.equal((await ciStatus(api,pr)).state,'failure');
 run.status='in_progress';assert.equal((await ciStatus(api,pr)).state,'pending');
 run.status='completed';run.pull_requests[0]={number:1,head:pr.head,base:{sha:'wrong'}};assert.equal((await ciStatus(api,pr)).state,'pending');
});
