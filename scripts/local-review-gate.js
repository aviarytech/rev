import {readFile} from 'node:fs/promises';
import {githubClient} from './github-review.js';
import {evaluateLocal} from '../src/local/github.js';
const event=JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH,'utf8'));
const repository=process.env.GITHUB_REPOSITORY;
const api=githubClient(repository,process.env.GITHUB_TOKEN);
const url=`https://github.com/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`;
try {
  const publicKey=process.env.REV_LOCAL_REVIEW_PUBLIC_KEY;
  if(!publicKey)throw Error('Trusted local reviewer public key is not configured');
  let numbers=[];
  if(event.action==='rev-local-review') {
    const number=event.client_payload?.payload?.prNumber;
    if(!Number.isSafeInteger(number)||number<1)throw Error('Invalid review PR number');
    numbers=[number];
  } else if(event.pull_request) numbers=[event.pull_request.number];
  else if(event.workflow_run) numbers=(event.workflow_run.pull_requests||[]).map(p=>p.number);
  else {
    const prs=await api('/pulls?state=open&per_page=100');
    if(prs.length>=100)throw Error('Too many PRs for one refresh');
    numbers=prs.map(p=>p.number);
  }
  for(const number of new Set(numbers)) {
    const result=await evaluateLocal(api,repository,number,publicKey,event.action==='rev-local-review'?event.client_payload:undefined,url);
    console.log(`PR #${number}: ${result.state} — ${result.reason}`);
  }
} catch(error) {console.error(`Local review gate failed: ${error.message}`);process.exitCode=1;}
