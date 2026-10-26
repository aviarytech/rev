import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { realPrFixtures } from './real-pr-fixtures.js';
import { readJson } from '../src/io.js';
import { configuration } from '../src/gate.js';
import { diagnose } from '../src/diagnose.js';
import { summary } from '../src/report.js';
const config=configuration({'timeout-ms':'60000'});
const reports=[];
for(const [i,dir] of process.argv.slice(2).entries()) {
  const [{corpus}]=await realPrFixtures(dir,`real-${i}`);
  const result=await readJson(resolve(dir,'denial.json'));
  if(result.headSha!==corpus.headSha || result.contractSha256!==corpus.change.contractSha256 || result.approved!==false) throw Error('Replay denial must match immutable corpus');
  const before=JSON.stringify(result);
  const diagnostics=await diagnose(corpus,result,config,process.env.TYPESAFE_API_KEY);
  if(JSON.stringify(result)!==before) throw Error('Diagnostic pass mutated original verdict');
  reports.push({headSha:corpus.headSha,originalReason:result.reason,diagnostics});
  await writeFile(`rev-diagnosis-${i}.md`,summary({...result,denialDiagnostics:diagnostics}));
  await writeFile('rev-diagnosis-report.json',JSON.stringify({config,reports},null,2)+'\n');
  console.log(JSON.stringify({case:i,status:diagnostics.status,findings:diagnostics.findings.map(f=>({target:f.target,status:f.status,gap:f.gap}))}));
}
if(reports.some(r=>['unavailable','partial'].includes(r.diagnostics.status))) process.exitCode=1;
