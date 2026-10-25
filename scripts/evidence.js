import { writeFile } from 'node:fs/promises';
import { readJson, readText } from '../src/io.js';
import { buildCorpus } from '../src/corpus.js';
// Explicit files only: no automatic log scraping or claims of complete coverage.
const [headSha, sourcesFile, output] = process.argv.slice(2);
try {
  if (!headSha || !sourcesFile || !output) throw new Error();
  const sources = await readJson(sourcesFile);
  if (!Array.isArray(sources) || sources.length > 40) throw new Error();
  const items = [];
  for (const source of sources) {
    items.push({ id: source.id, kind: source.kind, source: source.path, content: await readText(source.path) });
  }
  const evidence = { version: 1, headSha, items };
  // Reuse input validation, including the aggregate size bound.
  buildCorpus({ version: 1, task: 'Validate evidence manifest', criteria: [{ id: 'validation', description: 'Validate evidence manifest' }] }, evidence, { scope: 'acceptance', 'head-sha': headSha });
  await writeFile(output, JSON.stringify(evidence) + '\n');
} catch {
  console.error('Could not collect evidence. Check the SHA, source manifest, file paths, UTF-8 encoding and 1 MiB total limit.');
  process.exitCode = 1;
}
