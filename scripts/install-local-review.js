#!/usr/bin/env node
// Run from an immutable installed checkout, after reviewing the pinned commit.
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {home,initialize} from './local-review.js';
const root=fileURLToPath(new URL('..',import.meta.url));
const sha=process.argv[2];
if(!/^[a-f0-9]{40}$/.test(sha||''))throw Error('Usage: node scripts/install-local-review.js APPROVED_COMMIT_SHA');
const git=args=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();
if(git(['rev-parse','HEAD'])!==sha||git(['status','--porcelain']))throw Error('Install requires a clean checkout at the approved commit');
if(resolve(root)!==join(home,'tool'))throw Error('Install the pinned checkout at ~/.config/rev-local/tool (or REV_LOCAL_HOME/tool)');
await initialize();
await writeFile(join(home,'config.json'),JSON.stringify({repositories:['aviarytech/rev','aviarytech/tv','onionoriginals/sdk']},null,2)+'\n',{mode:0o600});
const logs=join(home,'logs');await mkdir(logs,{recursive:true,mode:0o700});
const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const label='com.aviarytech.rev-local-review';
const agentDir=join(homedir(),'Library/LaunchAgents');await mkdir(agentDir,{recursive:true});
const plist=join(agentDir,`${label}.plist`);
const xml=`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${escape(process.execPath)}</string><string>${escape(join(root,'scripts/local-review-worker.js'))}</string></array>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${escape(process.env.PATH)}</string><key>REV_LOCAL_HOME</key><string>${escape(home)}</string></dict>
<key>RunAtLoad</key><true/><key>StartInterval</key><integer>300</integer>
<key>StandardOutPath</key><string>${escape(join(logs,'worker.log'))}</string><key>StandardErrorPath</key><string>${escape(join(logs,'worker-error.log'))}</string>
</dict></plist>`;
await writeFile(plist,xml,{mode:0o600});
const domain=`gui/${process.getuid()}`;
try{execFileSync('launchctl',['bootout',`${domain}/${label}`],{stdio:'ignore'});}catch{}
execFileSync('launchctl',['bootstrap',domain,plist]);
console.log('Automatic local review installed: checks every five minutes, one review at a time.');
