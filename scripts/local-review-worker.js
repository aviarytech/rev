#!/usr/bin/env node
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {home,review,initialize} from './local-review.js';
import {withReviewLock} from '../src/local/lock.js';
import {digest} from '../src/local/protocol.js';
import {ciStatus} from '../src/local/github.js';
const gh=(path,body)=>JSON.parse(execFileSync('gh',['api',path,...(body?['--method','POST','--input','-']:[])],{encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024,...(body?{input:JSON.stringify(body)}:{})})||'null');
export const identity=(repository,pr)=>digest({repository,number:pr.number,head:pr.head.sha,base:pr.base.sha,title:pr.title,body:pr.body||''});
export const eligible=(entry,now)=>!entry || (entry.attempts<2 && now-entry.at>=3600000);
export function deliveryState(entry,checks,now) {
  if(checks.some(c=>c.app?.slug==='github-actions'&&c.external_id===`rev-local:${digest(entry.envelope)}`))return 'delivered';
  if((entry.deliveries||0)>=3||Date.parse(entry.envelope.payload.expiresAt)<=now)return 'exhausted';
  return !entry.sentAt||now-entry.sentAt>=10*60000?'retry':'waiting';
}
export async function tick() {
  await initialize();
  return withReviewLock(home,async()=>{
    const config=JSON.parse(await readFile(join(home,'config.json'),'utf8'));
    if(!Array.isArray(config.repositories)||config.repositories.some(r=>! /^[\w.-]+\/[\w.-]+$/.test(r)))throw Error('Invalid worker repositories');
    const statePath=join(home,'worker-state.json');
    let state={};try{state=JSON.parse(await readFile(statePath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
    const save=async()=>{await writeFile(`${statePath}.tmp`,JSON.stringify(state),{mode:0o600});await rename(`${statePath}.tmp`,statePath);};
    for(const repository of config.repositories) {
      const api=async path=>gh(`repos/${repository}${path}`);
      try {
        await api('/contents/.github/workflows/rev-local-review.yml'); // Must exist on the default branch.
        const workflow=await api('/actions/workflows/rev-local-review.yml');
        if(workflow.state!=='active')continue;
        const variable=await api('/actions/variables/REV_LOCAL_REVIEW_PUBLIC_KEY');
        if(variable.value.trim()!==(await readFile(join(home,'reviewer.pub'),'utf8')).trim())continue;
        const prs=await api('/pulls?state=open&per_page=100');
        if(prs.length>=100)throw Error('PR discovery limit exceeded');
        for(const item of prs) {
          if(item.draft)continue;
          const pr=await api(`/pulls/${item.number}`);
          const key=identity(repository,pr);
          const deliver=async()=>{
            const entry=state[key];
            const checks=await api(`/commits/${pr.head.sha}/check-runs?check_name=REV%20local%20attestation&filter=all&per_page=100`);
            if(checks.total_count>100)throw Error('Too many attestations');
            const status=deliveryState(entry,checks.check_runs,Date.now());
            if(status==='delivered'){entry.delivered=true;await save();return false;}
            if(status!=='retry')return false;
            entry.deliveries=(entry.deliveries||0)+1;entry.sentAt=Date.now();await save();
            gh(`repos/${repository}/dispatches`,{event_type:'rev-local-review',client_payload:entry.envelope});
            return true;
          };
          if(state[key]?.envelope&&!state[key].delivered){if(await deliver())return;continue;}
          if(!eligible(state[key],Date.now()))continue;
          if((await ciStatus(api,pr)).state!=='success')continue;
          state[key]={at:Date.now(),attempts:(state[key]?.attempts||0)+1};
          // Persist the attempt before spending allowance; crashes do not loop.
          await save();
          try {state[key].envelope=await review(repository,pr.number,false);state[key].attempts=2;state[key].completed=true;await save();await deliver();}
          catch {console.error(`${repository} #${pr.number}: review failed; retry is bounded`);}
          await save();return;
        }
      } catch {console.error(`${repository}: verifier or CI not ready`);}
    }
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)tick().catch(error=>{console.error(error.message);process.exitCode=1;});
