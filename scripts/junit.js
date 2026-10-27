import { readFile, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

// Normalize Bun and Node JUnit XML into REV test reports. IDs are "file > suite > ... > name".
const unescape = s => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) => e[0] === '#'
  ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)))
  : { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()]);
const attributes = s => Object.fromEntries([...s.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, k, v]) => [k, unescape(v)]));
const RANK = { passed: 0, skipped: 1, failed: 2 };

export function parseJUnit(xml, cwd, repo = cwd) {
  // Attribute values may contain an unescaped ">", so match attributes explicitly.
  const tags = /<(\/?)(testsuite|testcase|failure|error|skipped)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g;
  const body = xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const suites = [], tests = [];
  let current;
  const file = path => {
    const absolute = isAbsolute(path) ? path : resolve(cwd, path);
    const id = relative(repo, absolute).split(sep).join('/');
    if (!id || id.startsWith('../')) throw new Error('test-file-outside-repository');
    return id;
  };
  for (const [, close, tag, attrs, selfClosing] of body.matchAll(tags)) {
    if (tag === 'testsuite') {
      if (close) suites.pop();
      else if (!selfClosing) suites.push(attributes(attrs));
    } else if (tag === 'testcase') {
      if (close) { tests.push(current); current = undefined; continue; }
      const a = attributes(attrs);
      const path = a.file || [...suites].reverse().find(s => s.file)?.file;
      if (!path || a.name === undefined) throw new Error('testcase-without-file');
      // Bun wraps each file in a suite named after the file; it is not part of the test name.
      const names = suites.filter(s => !(s.file && s.name === s.file)).map(s => s.name);
      current = { id: [file(path), ...names, a.name].join(' > '), status: 'passed' };
      if (selfClosing) { tests.push(current); current = undefined; }
    } else if (current && !close) {
      current.status = tag === 'skipped' ? (current.status === 'failed' ? 'failed' : 'skipped') : 'failed';
    }
  }
  return tests;
}

export function testReport(xmls, cwd, repo, sourceSha, testsSha) {
  const merged = new Map();
  // Duplicate IDs are ambiguous; the worst status wins so a duplicate cannot hide a failure.
  for (const t of xmls.flatMap(xml => parseJUnit(xml, cwd, repo))) {
    if (!merged.has(t.id) || RANK[t.status] > RANK[merged.get(t.id)]) merged.set(t.id, t.status);
  }
  return { version: 1, sourceSha, testsSha,
    tests: [...merged].sort(([a], [b]) => a < b ? -1 : 1).map(([id, status]) => ({ id, status })) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    // CWD is where the test runner ran; REPO is the repository root that test IDs are relative to.
    const [cwd, repo, sourceSha, testsSha, output, ...inputs] = process.argv.slice(2);
    if (!inputs.length || ![sourceSha, testsSha].every(x => /^[a-f0-9]{40}$/.test(x))) throw new Error('usage');
    const report = testReport(await Promise.all(inputs.map(f => readFile(f, 'utf8'))), await realpath(cwd), await realpath(repo), sourceSha, testsSha);
    await writeFile(output, JSON.stringify(report, null, 2) + '\n');
    console.log(`${report.tests.length} tests: ${report.tests.filter(t => t.status === 'passed').length} passed`);
  } catch (error) {
    console.error(`Usage: junit.js CWD REPO SOURCE_SHA TESTS_SHA OUTPUT JUNIT_XML... (${error.message})`);
    process.exitCode = 1;
  }
}
