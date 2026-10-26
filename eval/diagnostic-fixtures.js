import { buildCorpus } from '../src/corpus.js';
const head='a'.repeat(40);
export function diagnosticFixtures() {
  return [false,true].map(broken=>{
    const route=broken ? (()=>({status:200})) : (user=>({status:user===null?401:200}));
    const task={version:1,task:'Reject the null-user request',criteria:[{id:'null-user',description:'Calling route(null) returns an object with status 401.'}]};
    const items=[
      {id:'implementation',kind:'code',source:'route.js',content:broken?'export const route = user => ({status: 200});':'export const route = user => ({status: user === null ? 401 : 200});'},
      {id:'probe',kind:'behavior',source:'executed route(null) probe',content:JSON.stringify({input:null,expectedStatus:401,observed:route(null)})},
    ];
    const corpus=buildCorpus(task,{version:1,headSha:head,items},{scope:'acceptance','head-sha':head,needs:'{"test":{"result":"success"}}'});
    // These are controlled diagnostic test inputs, not production/model verdicts.
    const result={approved:false,decision:'deny',reason:broken?'criteria-violated':'criteria-unverified',headSha:head,criteria:[{...task.criteria[0],verdict:broken?'violated':'unverified'}]};
    return {name:broken?'demonstrated-wrong-status':'correct-code-artificial-denial',corpus,result,expectedFinding:broken};
  });
}
