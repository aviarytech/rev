import { buildCorpus } from '../src/corpus.js';
import { HEAD } from './fixtures.js';

// Separate domains, defined before inspecting live candidate results. Each pair
// differs by one intentional defect. These are development checks, not proof of
// production accuracy or a statistically representative benchmark.
const pairs = [
  {
    name: 'bounded-volume', inputs: [-1, 0, 4, 10, 11], expected: [0, 0, 4, 10, 10],
    requirement: 'For input values -1, 0, 4, 10, and 11, run returns respectively 0, 0, 4, 10, and 10.',
    good: 'export const run = n => Math.max(0, Math.min(10, n));',
    bad: 'export const run = n => Math.min(10, n);',
  },
  {
    name: 'owner-authorization', inputs: [null, {id: 'alice'}, {id: 'bob'}], expected: [false, true, false],
    requirement: 'run returns false for a null user, true for user {id:"alice"}, and false for user {id:"bob"}. Only alice owns the record.',
    good: 'export const run = user => user?.id === "alice";',
    bad: 'export const run = user => Boolean(user);',
  },
  {
    name: 'newest-handler', inputs: [[], ['fallback'], ['fallback', 'screen']], expected: [null, 'fallback', 'screen'],
    requirement: 'run returns null for an empty handler list, "fallback" for ["fallback"], and "screen" for ["fallback", "screen"]. The last registered handler has priority.',
    good: 'export const run = handlers => handlers.at(-1) ?? null;',
    bad: 'export const run = handlers => handlers[0] ?? null;',
  },
  {
    name: 'retryable-download', inputs: ['download-error', 'boot-error', 'ready'], expected: [true, false, true],
    requirement: 'run returns true for "download-error", false for "boot-error", and true for "ready": download failure remains retryable but a failed boot does not.',
    good: 'export const run = state => state !== "boot-error";',
    bad: 'export const run = state => state === "ready";',
  },
];

export async function challengeFixtures() {
  const cases = [];
  for (const pair of pairs) {
    for (const variant of ['good', 'bad']) {
      const source = pair[variant];
      const { run } = await import(`data:text/javascript,${encodeURIComponent(source)}`);
      const observations = pair.inputs.map((input, i) => ({ input, expected: pair.expected[i], observed: run(input) }));
      const items = [
        { id: 'implementation', kind: 'code', source: `${pair.name}.js`, content: source },
        { id: 'execution', kind: 'behavior', source: 'Current-run function invocations', content: JSON.stringify(observations) },
      ];
      const corpus = buildCorpus({ version: 1, task: 'Check the specified behavior of the supplied run function.',
        criteria: [{ id: pair.name, description: pair.requirement }] }, { version: 1, headSha: HEAD, items },
      { scope: 'acceptance', 'head-sha': HEAD, needs: JSON.stringify({ ci: { result: 'success' } }) });
      cases.push({ name: `${pair.name}-${variant}`, expected: [variant === 'good' ? 'satisfied' : 'violated'], corpus });
    }
  }
  return cases;
}
