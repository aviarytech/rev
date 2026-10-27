import {readFile,appendFile} from 'node:fs/promises';
import {githubClient} from './github-review.js';
import {evaluateLocal,recordLocal} from '../src/local/github.js';
import {affectedPulls,benignRace} from '../src/local/events.js';
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
  } else if(process.env.REV_LOCAL_PLAN_ONLY==='true') {
    const numbers=await affectedPulls(event,api);
    await appendFile(process.env.GITHUB_OUTPUT,`numbers=${JSON.stringify(numbers)}\n`);
  } else {
    const number=Number(process.env.REV_LOCAL_PR_NUMBER);
    if(!Number.isSafeInteger(number)||number<1)throw Error('Expected a planned PR number');
    try {
      const result=await evaluateLocal(api,repository,number,publicKey,undefined,url);
      console.log(`PR #${number}: ${result.state} — ${result.reason}`);
    } catch(error) {
      if(!benignRace(error))throw error;
      console.log(`PR #${number}: changed during refresh; a later event will evaluate the new revision`);
    }
  }
} catch(error) {console.error(`Local review gate failed: ${error.message}`);process.exitCode=1;}
