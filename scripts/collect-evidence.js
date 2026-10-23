import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const steps = JSON.parse(process.env.REV_STEPS);
const evidence = {};
for (const step of ['setup', 'rev-tests', 'typecheck', 'test', 'build']) {
  // A later operation is not missing evidence before it has run.
  if (!steps[step] || steps[step].outcome === 'skipped') continue;
  const path = join(process.env.RUNNER_TEMP, `rev-${step}.log`);
  evidence[step] = existsSync(path) ? readFileSync(path, 'utf8') : { missing: true };
}
writeFileSync(join(process.env.RUNNER_TEMP, 'rev-evidence.json'), JSON.stringify(evidence));
