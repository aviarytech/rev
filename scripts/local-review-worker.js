#!/usr/bin/env node
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {home,review,initialize} from './local-review.js';
import {withReviewLock} from '../src/local/lock.js';
import {digest} from '../src/local/protocol.js';
import {ciStatus} from '../src/local/github.js';
const gh=path=>JSON.parse(execFileSync('gh',['api',path],{encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024}));
export const identity=(repository,pr)=>digest({repository,number:pr.number,head:pr.head.sha,base:pr.base.sha,title:pr.title,body:pr.body||''});
export const eligible=(entry,now)=>!entry || (entry.attempts<2 && now-entry.at>=3600000);
export async function tick() {
  await initialize();
  return withReviewLock(home,async()=>{
    const config=JSON.parse(await readFile(join(home,'config.json'),'utf8'));
    if(!Array.isArray(config.repositories)||config.repositories.some(r=>! /^[\w.-]+\/[\w.-]+$/.test(r)))throw Error('Invalid worker repositories');
    const statePath=join(home,'worker-state.json');
    let state={};try{state=JSON.parse(await readFile(statePath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
    for(const repository of config.repositories) {
      const api=async path=>gh(`repos/${repository}${path}`);
      try {
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
          if(!eligible(state[key],Date.now()))continue;
          if((await ciStatus(api,pr)).state!=='success')continue;
          state[key]={at:Date.now(),attempts:(state[key]?.attempts||0)+1};
          // Persist the attempt before spending allowance; crashes do not loop.
          const save=async()=>{await writeFile(`${statePath}.tmp`,JSON.stringify(state),{mode:0o600});await rename(`${statePath}.tmp`,statePath);};
          await save();
          try {await review(repository,pr.number,true);state[key].attempts=2;state[key].completed=true;}
          catch {console.error(`${repository} #${pr.number}: review failed; retry is bounded`);}
          await save();return;
        }
      } catch {console.error(`${repository}: verifier or CI not ready`);}
    }
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)tick().catch(error=>{console.error(error.message);process.exitCode=1;});
