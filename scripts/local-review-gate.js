import {readFile} from 'node:fs/promises';
import {githubClient} from './github-review.js';
import {evaluateLocal,recordLocal} from '../src/local/github.js';
const event=JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH,'utf8'));
const repository=process.env.GITHUB_REPOSITORY;
const api=githubClient(repository,process.env.GITHUB_TOKEN);
const url=`https://github.com/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`;
try {
  const publicKey=process.env.REV_LOCAL_REVIEW_PUBLIC_KEY;
  if(!publicKey)throw Error('Trusted local reviewer public key is not configured');
  if(process.env.REV_LOCAL_INGEST_ONLY==='true') {
    if(event.action!=='rev-local-review')throw Error('Only signed dispatches can be recorded');
    const number=event.client_payload?.payload?.prNumber;
    if(!Number.isSafeInteger(number)||number<1)throw Error('Invalid review PR number');
    await recordLocal(api,repository,number,publicKey,event.client_payload);
    console.log(`Recorded authenticated review for PR #${number}`);
  } else {
    // Refresh every open PR: GitHub can coalesce pending refresh jobs. Signed
    // reports are durably recorded in a separate job before this queue.
    const prs=await api('/pulls?state=open&per_page=100');
    if(prs.length>=100)throw Error('Too many PRs for one refresh');
    for(const pr of prs) {
      try {
        const result=await evaluateLocal(api,repository,pr.number,publicKey,undefined,url);
        console.log(`PR #${pr.number}: ${result.state} — ${result.reason}`);
      } catch(error) {console.error(`PR #${pr.number}: ${error.message}`);process.exitCode=1;}
    }
  }
} catch(error) {console.error(`Local review gate failed: ${error.message}`);process.exitCode=1;}
