import { writeFile } from 'node:fs/promises';
import { configuration, evaluate } from '../src/gate.js';
import { fixtures } from './fixtures.js';
import { challengeFixtures } from './challenge-fixtures.js';
import { coverageFixtures } from './coverage-fixtures.js';
if (!process.env.TYPESAFE_API_KEY?.trim()) {
  console.error('Set TYPESAFE_API_KEY privately to run live evaluations. No model calls were made.');
  process.exitCode = 1;
} else {
  const cases = [...await fixtures(), ...await challengeFixtures(), ...await coverageFixtures()];
  const results = [];
  let falseApprovals = 0, falseDenials = 0, mismatches = 0, errors = 0;
  for (const fixture of cases) {
    try {
      const result = await evaluate(fixture.corpus, configuration({}), process.env.TYPESAFE_API_KEY);
      const actual = result.criteria.map(c => c.verdict);
      const expectedApproval = fixture.expectedApproved ?? fixture.expected.every(v => v === 'satisfied');
      const match = JSON.stringify(actual) === JSON.stringify(fixture.expected)
        && (!fixture.expectedCoverage || result.coverage.verdict === fixture.expectedCoverage)
        && result.approved === expectedApproval;
      if (!match) mismatches++;
      if (result.approved && !expectedApproval) falseApprovals++;
      if (!result.approved && expectedApproval) falseDenials++;
      results.push({ name: fixture.name, expected: fixture.expected, actual, approved: result.approved, match,
        expectedCoverage: fixture.expectedCoverage, coverage: result.coverage,
        expectedApproved: expectedApproval, criteria: result.criteria, model: result.model });
      console.log(JSON.stringify({ fixture: fixture.name, expected: fixture.expected, actual, match }));
    } catch (error) {
      errors++;
      results.push({ name: fixture.name, error: error.code || 'evaluation-error' });
      console.log(JSON.stringify({ fixture: fixture.name, error: error.code || 'evaluation-error' }));
    }
  }
  const report = { suite: 'synthetic-acceptance-and-coverage-v3', thresholds: configuration({}), cases: cases.length, falseApprovals, falseDenials, mismatches, errors, results };
  await writeFile('rev-eval-report.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ cases: cases.length, falseApprovals, falseDenials, mismatches, errors }));
  if (mismatches || errors) process.exitCode = 1;
}
