import { makeCorpus, HEAD } from '../eval/fixtures.js';
export { HEAD };
export const corpus = () => makeCorpus([
  { id: 'code', kind: 'code', source: 'route.js', content: 'PRIVATE_EVIDENCE' },
  { id: 'probe', kind: 'behavior', source: 'probe.json', content: 'PRIVATE_EVIDENCE' },
]);
export function answer(choice, options, p = 0.98, confidence = 0.98) {
  return { type: 'choice', choice, confidence,
    probabilities: Object.fromEntries(options.map(k => [k, k === choice ? p : (1 - p) / (options.length - 1)])) };
}
export function response(verdicts = ['satisfied', 'satisfied'], citations = ['probe', 'probe']) {
  return { model: 'jev-1.14.0', answers: Object.fromEntries(verdicts.flatMap((v, i) => [
    [`criterion_${i}`, answer(v, ['satisfied', 'violated', 'unverified'])],
    [`evidence_${i}`, answer(citations[i], ['none', 'code', 'probe'])],
  ])) };
}
