import { writeFile } from 'node:fs/promises';
import { configuration, evaluate } from '../src/gate.js';
import { evaluateFocused } from '../src/focused.js';
import { fixtures } from './fixtures.js';
import { challengeFixtures } from './challenge-fixtures.js';
import { coverageFixtures } from './coverage-fixtures.js';
import { realPrFixtures } from './real-pr-fixtures.js';
import { guidance } from '../src/guidance.js';

if (!process.env.TYPESAFE_API_KEY?.trim()) throw new Error('TYPESAFE_API_KEY is required privately');
const cases = [...await fixtures(), ...await challengeFixtures(), ...await coverageFixtures()];
for (const [i, directory] of process.argv.slice(2).entries()) cases.push(...await realPrFixtures(directory, `real-${i}`));
// Both strategies receive the identical deadline, model and thresholds.
const config = configuration({ 'timeout-ms': '60000' });
const results = [];
for (const fixture of cases) {
  for (const [strategy, run] of [['baseline', evaluate], ['focused', evaluateFocused]]) {
    const start = Date.now();
    try {
      const result = await run(fixture.corpus, config, process.env.TYPESAFE_API_KEY);
      const expectedApproval = fixture.expectedApproved ?? (fixture.expected ? fixture.expected.every(v => v === 'satisfied') : undefined);
      results.push({ name: fixture.name, strategy, headSha: fixture.corpus.headSha,
        expectedApproved: expectedApproval, expectedCoverage: fixture.expectedCoverage, expected: fixture.expected,
        approved: result.approved, reason: result.reason, coverage: result.coverage,
        // Omit source contents and criterion descriptions from reports.
        criteria: result.criteria.map(({id, verdict, reason, probability, confidence}) => ({id, verdict, reason, probability, confidence})),
        guidance: guidance(result), durationMs: Date.now() - start,
        falseApproval: expectedApproval === false && result.approved,
        falseDenial: expectedApproval === true && !result.approved,
        coverageMismatch: fixture.expectedCoverage !== undefined && fixture.expectedCoverage !== result.coverage.verdict,
        criterionMismatch: fixture.expected !== undefined && JSON.stringify(fixture.expected) !== JSON.stringify(result.criteria.map(c => c.verdict)),
        reasonMismatch: fixture.expectedReason !== undefined && fixture.expectedReason !== result.reason,
      });
    } catch (error) { results.push({ name: fixture.name, strategy, error: error.code || 'evaluation-error', diagnostics: error.diagnostics, durationMs: Date.now() - start }); }
    console.log(JSON.stringify({ name: fixture.name, strategy, ...Object.fromEntries(['approved','reason','error','falseApproval','falseDenial','coverageMismatch'].map(k => [k, results.at(-1)[k]])) }));
    // Preserve partial experiments even when a later request or workflow fails.
    await writeFile('rev-comparison-report.json', JSON.stringify({ config, results }, null, 2) + '\n');
  }
}
if (results.some(r => r.strategy === 'focused' && (r.error || r.falseApproval || r.falseDenial || r.coverageMismatch || r.reasonMismatch || r.criterionMismatch))) process.exitCode = 1;
