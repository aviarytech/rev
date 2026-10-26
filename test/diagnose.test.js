import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnose } from '../src/diagnose.js';
import { configuration } from '../src/gate.js';
import { fixtures } from '../eval/fixtures.js';
import { summary } from '../src/report.js';
const config=configuration({});
const setup=async()=>{
  const {corpus}= (await fixtures())[0];
  return {corpus,result:{approved:false,decision:'deny',reason:'criteria-unverified',criteria:[{...corpus.task.criteria[0],verdict:'unverified'}]}};
};
function provider(select) {
  return async (_,options)=>{
    const body=JSON.parse(options.body);
    const answers=Object.fromEntries(Object.entries(body.questions).map(([key,q])=>{
      const selected=select(key,q,body);
      return [key,{type:'choice',choice:selected,confidence:1,probabilities:Object.fromEntries(Object.keys(q.criteria).map(k=>[k,k===selected?1:0]))}];
    }));
    return new Response(JSON.stringify({model:'fixture',answers}));
  };
}
const choose=key=>key.startsWith('gap')?'missing_test':key.startsWith('obligation')?'o0':key.startsWith('source')?'s0':'b0';
test('diagnostic findings reference exact input spans and evidence ranges without changing decision or copying content',async()=>{
  const {corpus,result}=await setup();const before=structuredClone(result);
  const report=await diagnose(corpus,result,config,'fake',provider(choose));
  assert.deepEqual(result,before);
  const f=report.findings[0];
  assert.equal(f.status,'advisory-finding');
  assert.equal(f.obligation.source,`criterion:${corpus.task.criteria[0].id}`);
  assert.ok(f.obligation.end<=corpus.task.criteria[0].description.length);
  assert.equal(f.citation.id,`evidence:${corpus.evidence[0].id}`);
  assert.ok(f.citation.endLine<=corpus.evidence[0].content.split('\n').length);
  assert.equal(f.citation.lineBasis,'supplied-source-content');
  assert.equal(f.obligation.text,undefined);
  assert.match(summary({...result,denialDiagnostics:report}),/Advisory denial diagnostics/);
});
test('unsupported or invented references never become findings',async()=>{
  const {corpus,result}=await setup();
  for(const bad of ['uncertainty','none','invented']) {
    const report=await diagnose(corpus,result,config,'fake',provider(key=>key.startsWith('gap')&&bad==='uncertainty'?'uncertainty':key.startsWith('location')?bad==='uncertainty'?'b0':bad:choose(key)));
    assert.equal(report.findings[0].status,'uncertainty');
    assert.equal(report.findings[0].citation,undefined);
  }
});
test('diagnostic transport errors preserve denial and give uncertainty without raw provider strings',async()=>{
  const {corpus,result}=await setup();
  const report=await diagnose(corpus,result,config,'fake',async()=>{throw Error('SECRET provider detail');});
  assert.equal(report.status,'unavailable');
  assert.equal(result.approved,false);
  assert.doesNotMatch(JSON.stringify(report),/SECRET/);
});
test('approvals and deterministic failures do not call the diagnostic provider',async()=>{
  const {corpus,result}=await setup();
  for(const input of [{...result,approved:true},{...result,reason:'ci-not-successful'}]) {
    assert.equal((await diagnose(corpus,input,config,'fake',()=>assert.fail('unexpected call'))).status,'not-applicable');
  }
});
test('diagnostic HTML and markdown labels are escaped',async()=>{
  const {corpus,result}=await setup();corpus.evidence[0].source='<script>unsafe</script>\n## forged';
  const report=await diagnose(corpus,result,config,'fake',provider(choose));
  assert.doesNotMatch(summary({...result,denialDiagnostics:report}),/<script>|\n## forged/);
});
test('low-confidence diagnostic choices cannot become actionable findings',async()=>{
  const {corpus,result}=await setup();
  const fake=provider(choose);
  const report=await diagnose(corpus,result,config,'fake',async(...args)=>{
    const data=await (await fake(...args)).json();
    for(const a of Object.values(data.answers)) a.confidence=.1;
    return new Response(JSON.stringify(data));
  });
  assert.equal(report.findings[0].status,'uncertainty');
});
test('action opt-in preserves the gate denial if the diagnostic service fails',async()=>{
  const {mkdtemp,writeFile,readFile,rm}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const {run}=await import('../src/index.js');
  const {corpus}=await setup();
  const dir=await mkdtemp(join(tmpdir(),'rev-diagnose-'));
  try {
    await writeFile(join(dir,'task.json'),JSON.stringify({version:1,...corpus.task}));
    await writeFile(join(dir,'evidence.json'),JSON.stringify({version:1,headSha:corpus.headSha,items:corpus.evidence}));
    let calls=0;
    const gate=provider(key=>key.startsWith('criterion')?'unverified':'irrelevant');
    const result=await run({'INPUT_SCOPE':'acceptance','INPUT_TASK-FILE':join(dir,'task.json'),'INPUT_EVIDENCE-FILE':join(dir,'evidence.json'),'INPUT_HEAD-SHA':corpus.headSha,'INPUT_NEEDS':JSON.stringify(corpus.needs),'INPUT_API-KEY':'test-key','INPUT_DIAGNOSE-DENIALS':'true','INPUT_REPORT-FILE':join(dir,'report.json')},async(...args)=>++calls===1?gate(...args):Promise.reject(Error('provider-secret')));
    assert.equal(calls,2);assert.equal(result.approved,false);assert.equal(result.reason,'criteria-unverified');
    assert.equal(result.denialDiagnostics.status,'unavailable');
    assert.doesNotMatch(await readFile(join(dir,'report.json'),'utf8'),/provider-secret/);
  } finally {await rm(dir,{recursive:true,force:true});}
});
test('malformed responses retain safe structural diagnostics instead of hiding the failing field',async()=>{
  const {corpus,result}=await setup();
  const report=await diagnose(corpus,result,config,'fake',provider(key=>key.startsWith('source')?'invented-source':choose(key)));
  assert.equal(report.status,'unavailable');
  assert.equal(report.validationDiagnostics.question,'source_0');
  assert.equal(report.validationDiagnostics.issue,'unknown-choice');
  assert.doesNotMatch(JSON.stringify(report),/invented-source/);
});
