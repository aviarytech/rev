import {writeFile} from 'node:fs/promises';
import {configuration} from '../src/gate.js';
import {diagnose} from '../src/diagnose.js';
import {diagnosticFixtures} from './diagnostic-fixtures.js';
const results=[];
const config=configuration({'timeout-ms':'60000'});
for(const fixture of diagnosticFixtures()) {
  const diagnostics=await diagnose(fixture.corpus,fixture.result,config,process.env.TYPESAFE_API_KEY);
  const finding=diagnostics.findings[0];
  const match=diagnostics.status==='complete' && (fixture.expectedFinding
    ? finding?.status==='advisory-finding' && finding.gap==='contradiction'
    : finding?.status==='uncertainty');
  results.push({name:fixture.name,expectedFinding:fixture.expectedFinding,match,diagnostics});
  console.log(JSON.stringify({name:fixture.name,match,status:diagnostics.status}));
  await writeFile('rev-diagnostic-fixtures.json',JSON.stringify({config,results},null,2)+'\n');
}
if(results.some(r=>!r.match)) process.exitCode=1;
