import { fixtures, task, HEAD } from './fixtures.js';
import { buildCorpus } from '../src/corpus.js';
import { contractDigest } from '../src/coverage.js';
import { challengeFixtures } from './challenge-fixtures.js';

// Inspired by the TV coverage gap; synthetic, not a replay of production PRs.
export async function coverageFixtures() {
  const correct = (await fixtures())[0].corpus;
  const baseSha = 'b'.repeat(40);
  const request = { source: 'independently-reviewed-fixture', text: 'For the two specified inputs, route(null) must return status 401 and body null; route({user:"alice"}) must return status 200 and body "export data".' };
  const change = { version: 1, headSha: HEAD, baseSha, mergeBaseSha: baseSha, request, requiredChecks: ['ci'], files: [
    { path: 'route.js', criteria: ['anonymous', 'authenticated'], diff: 'diff --git a/route.js b/route.js\n--- a/route.js\n+++ b/route.js\n@@ -1 +1 @@\n-export function route(session) { return {status:200, body:"export data"}; }\n+export function route(session) { if (!session) return {status:401, body:null}; return {status:200, body:"export data"}; }' },
  ] };
  const cases = [
    { name: 'coverage-complete', change, expectedCoverage: 'covered', expectedApproved: true },
    { name: 'coverage-narrowed-request', change: { ...change, request: { ...request, text: request.text + ' Also reject requests beyond ten exports per user per minute with status 429.' } }, expectedCoverage: 'missing', expectedApproved: false },
    { name: 'coverage-tv-unrelated-regressions', change: { ...change,
      request: { ...request, text: 'Fix Android TV playback: Back must return to browsing without entering picture-in-picture, including after a source error.' },
      files: [{ path: 'player.js', criteria: ['anonymous', 'authenticated'], diff: 'diff --git a/player.js b/player.js\n--- a/player.js\n+++ b/player.js\n@@ -1 +1 @@\n-export const back = () => enterPictureInPicture();\n+export const back = () => { stopPlayback(); browse(); };' }],
    }, expectedCoverage: 'missing', expectedApproved: false },
    { name: 'coverage-extra-uncovered-change', change: { ...change, files: [...change.files,
      { path: 'logging.js', criteria: ['anonymous'], diff: 'diff --git a/logging.js b/logging.js\n--- a/logging.js\n+++ b/logging.js\n@@ -1 +1 @@\n-export const log = req => console.log(req.path);\n+export const log = req => console.log(req.headers.authorization);' },
    ] }, expectedCoverage: 'missing', expectedApproved: false },
  ];
  const result = cases.map(({ change: input, ...fixture }) => ({ ...fixture, expected: ['satisfied', 'satisfied'],
    corpus: buildCorpus(task, { version: 1, headSha: HEAD, items: correct.evidence }, {
      'head-sha': HEAD, 'base-sha': baseSha, needs: JSON.stringify({ ci: { result: 'success' } }),
      'contract-sha256': contractDigest(task, input.request, input.requiredChecks),
    }, {}, input),
  }));
  // A second domain, specified before inspecting the scoped coverage candidate.
  const volume = (await challengeFixtures()).find(f => f.name === 'bounded-volume-good');
  const volumeTask = { version: 1, ...volume.corpus.task };
  for (const missing of [false, true]) {
    const input = { ...change,
      request: { source: 'volume-coverage-fixture', text: volumeTask.criteria[0].description
        + (missing ? ' Additionally, return null for a nonnumeric string instead of coercing it.' : '') },
      files: [{ path: 'volume.js', criteria: ['bounded-volume'],
        diff: 'diff --git a/volume.js b/volume.js\n--- a/volume.js\n+++ b/volume.js\n@@ -1 +1 @@\n-export const run = n => n;\n+export const run = n => Math.max(0, Math.min(10, n));' }],
    };
    result.push({ name: missing ? 'coverage-volume-missing' : 'coverage-volume-complete',
      expected: ['satisfied'], expectedCoverage: missing ? 'missing' : 'covered', expectedApproved: !missing,
      corpus: buildCorpus(volumeTask, { version: 1, headSha: HEAD, items: volume.corpus.evidence }, {
        'head-sha': HEAD, 'base-sha': baseSha, needs: JSON.stringify({ ci: { result: 'success' } }),
        'contract-sha256': contractDigest(volumeTask, input.request, input.requiredChecks),
      }, {}, input),
    });
  }
  return result;
}
