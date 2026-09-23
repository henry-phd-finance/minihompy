import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const [playwright, pglite] = process.argv.slice(2);
if (!playwright || !pglite) throw new Error('Usage: node scripts/verify-release.mjs /path/to/playwright/index.mjs /path/to/pglite/index.js');
const root = fileURLToPath(new URL('../', import.meta.url));
const out = new URL('../docs/verification/release/', import.meta.url);
await mkdir(out, { recursive: true });
const tests = [
  ['identity'],
  ['member-navigation-state'],
  ['member-navigation-ui', playwright],
  ['author-navigation', playwright],
  ['surf-navigation', playwright],
  ['navigation-integration', playwright],
  ...['board','settings','photos','diary','guestbook','comments','profile'].map(name => [`${name}-db`, pglite]),
  ['member-writing-foundation', pglite],
  ['member-writing-setup', pglite],
  ['member-writing-session', pglite],
  ['member-writing-client'],
  ['member-guestbook', pglite],
  ['member-comments', pglite],
  ['member-writing-lifecycle', playwright],
  ...['backend','admin','settings','board-writing','photos-writing','diary-writing','guestbook-writing','comments-writing','profile-writing','profile','navigation','scale','fonts'].map(name => [name, playwright]),
];
const results = [];
for (const [name, arg] of tests) {
  const start = Date.now();
  const result = spawnSync(process.execPath, [`scripts/verify-${name}.mjs`, ...arg ? [arg] : []], { cwd: root, encoding: 'utf8', timeout: 180000 });
  const record = { name, passed: result.status === 0, seconds: (Date.now() - start) / 1000, stdout: result.stdout || '', stderr: result.stderr || '', error: result.error?.message };
  results.push(record);
  console.log(`${record.passed ? 'PASS' : 'FAIL'} ${name} (${record.seconds}s)`);
  if (!record.passed) console.log(record.stdout, record.stderr, record.error || '');
  await writeFile(new URL('results.json', out), JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2) + '\n');
}
console.log(`${results.filter(r => r.passed).length}/${results.length} passed. Local DB and mock API tests; hosted live reads are separate.`);
if (results.some(r => !r.passed)) process.exitCode = 1;
