import assert from 'node:assert/strict';
import test from 'node:test';
import { challengeFixtures } from '../eval/challenge-fixtures.js';

test('challenge labels agree with executed behavior, including every injected defect', async () => {
  const cases = await challengeFixtures();
  assert.equal(cases.length, 8);
  for (const fixture of cases) {
    const observations = JSON.parse(fixture.corpus.evidence.find(e => e.id === 'execution').content);
    const matches = observations.every(o => JSON.stringify(o.observed) === JSON.stringify(o.expected));
    assert.equal(matches, fixture.expected[0] === 'satisfied', fixture.name);
  }
});
