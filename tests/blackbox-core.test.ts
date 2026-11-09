import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { archiveReport, buildInventory, checkScope, reserveId, safePath, validateReport, OPTIONS } from '../extensions/blackbox.ts';
import { fixture, put, report } from './blackbox-helpers.ts';

for (const kind of ['missing', 'empty', 'whitespace', 'directory', 'symlink', 'oversized']) {
  test(`scope rejects ${kind}`, t => {
    const { base } = fixture(t), root = join(base, 'scope-' + kind); mkdirSync(root);
    if (kind === 'empty') put(root, 'SCOPE.md', '');
    if (kind === 'whitespace') put(root, 'SCOPE.md', ' \n\t');
    if (kind === 'directory') mkdirSync(join(root, 'SCOPE.md'));
    if (kind === 'symlink') symlinkSync(put(base, 'outside.md', 'outside'), join(root, 'SCOPE.md'));
    if (kind === 'oversized') put(root, 'SCOPE.md', 'x'.repeat(512 * 1024 + 1));
    assert.throws(() => checkScope(root));
  });
}
test('unreadable scope is rejected', { skip: process.getuid?.() === 0 ? 'root bypasses Unix file permissions' : false }, t => {
  const { root } = fixture(t); chmodSync(join(root, 'SCOPE.md'), 0);
  assert.throws(() => checkScope(root));
});
test('safe paths reject traversal, absolute paths, and dangling symlinks', t => {
  const { root } = fixture(t);
  for (const rel of ['../escape', '/tmp/outside', 'x/../../outside', 'x\\..\\outside']) assert.throws(() => safePath(root, rel));
  symlinkSync('/missing-blackbox-path', join(root, 'blackbox-report'));
  assert.throws(() => safePath(root, 'blackbox-report/report.md'), /Symlink/);
});

test('archive rejects traversal embedded in the previous report run ID', t => {
  const { root, base } = fixture(t);
  put(root, 'blackbox-report/report.md', report(root, 'blackbox-report', 'partial', '../../../escape'));
  assert.throws(() => archiveReport(root, 'blackbox-report'), /Invalid run ID/);
  assert.ok(existsSync(join(root, 'blackbox-report/report.md')));
  assert.equal(existsSync(join(base, 'escape/report.md')), false);
});
test('archives preserve prior run identity and never overwrite previous evidence', t => {
  const { root } = fixture(t);
  const old = report(root, 'blackbox-report', 'partial', 'OLD-RUN'); put(root, 'blackbox-report/report.md', old);
  const a = archiveReport(root, 'blackbox-report');
  assert.equal(a.destination, 'blackbox-report/history/OLD-RUN/report.md');
  assert.equal(existsSync(join(root, 'blackbox-report/report.md')), false);
  put(root, 'blackbox-report/report.md', old + '\nsecond');
  const b = archiveReport(root, 'blackbox-report');
  assert.notEqual(b.destination, a.destination);
  assert.equal(readFileSync(join(root, a.destination!), 'utf8'), old);
});
test('legacy archive gets a unique fallback; no report is a harmless no-op', t => {
  const { root } = fixture(t);
  assert.equal(archiveReport(root, 'blackbox-report').archived, false);
  put(root, 'blackbox-report/report.md', '# Legacy report\n');
  assert.ok(archiveReport(root, 'blackbox-report').destination);
});
for (const rel of ['blackbox-report', 'blackbox-report/history', '.blackbox']) {
  test(`archive rejects symlinked ${rel}`, t => {
    const { root, base } = fixture(t), outside = join(base, 'outside'); mkdirSync(outside);
    put(root, 'blackbox-report/report.md', report(root));
    if (rel === 'blackbox-report') {
      // separate root to avoid replacing an existing directory
      const another = join(base, 'another'); mkdirSync(another); symlinkSync(outside, join(another, 'blackbox-report'));
      assert.throws(() => archiveReport(another, 'blackbox-report'), /Symlink/);
    } else { symlinkSync(outside, join(root, rel)); assert.throws(() => archiveReport(root, 'blackbox-report'), /Symlink/); }
    assert.equal(existsSync(join(outside, 'report.md')), false);
  });
}

for (const option of OPTIONS) test(`valid ${option} template passes structure checks`, t => {
  const { root } = fixture(t); put(root, `${option}/report.md`, report(root, option));
  assert.deepEqual(validateReport(root, option), []);
});
test('validator rejects the old marker-only false positive, placeholders and missing manifest', t => {
  const { root } = fixture(t);
  put(root, 'blackbox-report/report.md', 'Run ID / UTC date\nProject root\nCoverage: nonsense\n## Handoff');
  assert.ok(validateReport(root, 'blackbox-report').length > 5);
  put(root, 'blackbox-report/report.md', report(root).replace('## Evidence manifest\nnone — fixture\n', ''));
  assert.ok(validateReport(root, 'blackbox-report').some(x => /Evidence manifest/.test(x)));
  put(root, 'blackbox-report/report.md', report(root).replace('- **Summary:** none — fixture', '- **Summary:** <TODO>'));
  assert.ok(validateReport(root, 'blackbox-report').some(x => /Summary/.test(x)));
});
test('validator checks coverage, current scope, root and handoff values', t => {
  const { root } = fixture(t);
  put(root, 'blackbox-report/report.md', report(root, 'blackbox-report', 'nonsense').replace(root, '/wrong').replace('- **Unresolved questions:** none — fixture', '- **Unresolved questions:**'));
  let issues = validateReport(root, 'blackbox-report');
  assert.ok(issues.some(x => /Coverage/.test(x)));
  assert.ok(issues.some(x => /root/.test(x)));
  assert.ok(issues.some(x => /Unresolved questions/.test(x)));
  put(root, 'blackbox-report/report.md', report(root)); put(root, 'SCOPE.md', 'changed scope');
  issues = validateReport(root, 'blackbox-report'); assert.ok(issues.some(x => /Scope digest/.test(x)));
});
test('blocked reports still require metadata, source manifest, and handoff but not finding sections', t => {
  const { root } = fixture(t); put(root, 'blackbox-report/report.md', report(root, 'blackbox-report', 'blocked'));
  assert.deepEqual(validateReport(root, 'blackbox-report'), []);
});
test('fenced examples cannot satisfy report sections or metadata', t => {
  const { root } = fixture(t);
  put(root, 'blackbox-report/report.md', '```markdown\n' + report(root) + '```\n');
  assert.ok(validateReport(root, 'blackbox-report').some(x => /canonical report title/.test(x)));
});

test('inventory requires explicit paths and omits excluded contents before hashing', async t => {
  const { root } = fixture(t); put(root, 'src/app.ts', 'hello'); put(root, 'private/secret', 'sensitive');
  await assert.rejects(buildInventory(root, { paths: [] }), /Explicit/);
  const inv = await buildInventory(root, { paths: ['src'], exclusions: ['private'] });
  assert.deepEqual(inv.files.map(x => x.path), ['src/app.ts']);
  assert.equal(inv.files[0].sha256, createHash('sha256').update('hello').digest('hex'));
  assert.equal(inv.coverage, 'complete');
  const wide = await buildInventory(root, { paths: ['.'], exclusions: ['private'] });
  assert.ok(wide.skipped.some(x => x.path === 'private'));
  assert.equal(wide.files.some(x => x.path.startsWith('private/')), false);
});
test('snapshot IDs remain unique within the same millisecond; evidence files remain unchanged', async t => {
  t.mock.method(Date.prototype, 'toISOString', () => '2026-01-01T00:00:00.000Z');
  const { root } = fixture(t); put(root, 'src/a', 'before');
  const first = await buildInventory(root, { paths: ['src'] });
  const old = readFileSync(join(root, first.manifestPath), 'utf8');
  put(root, 'src/a', 'after'); const second = await buildInventory(root, { paths: ['src'] });
  assert.notEqual(first.runId, second.runId);
  assert.equal(readFileSync(join(root, first.manifestPath), 'utf8'), old);
});
test('inventory limits, missing files and symlinks are explicit partial results', async t => {
  const { root, base } = fixture(t); put(root, 'src/a', 'a'); put(root, 'src/b', 'b');
  let inv = await buildInventory(root, { paths: ['src'], maxFiles: 1 });
  assert.equal(inv.truncated, true); assert.equal(inv.coverage, 'partial'); assert.ok(inv.errors.length);
  inv = await buildInventory(root, { paths: ['missing'] }); assert.equal(inv.coverage, 'partial');
  put(base, 'outside', 'outside'); symlinkSync(join(base, 'outside'), join(root, 'src/link'));
  inv = await buildInventory(root, { paths: ['src'] });
  assert.equal(inv.coverage, 'partial'); assert.ok(inv.errors.some(x => /Symlink/.test(x.reason)));
  assert.equal(inv.files.some(x => x.path.endsWith('/link')), false);
});
test('oversized files and total-byte overruns produce partial inventory', async t => {
  const { root } = fixture(t); put(root, 'src/a', '0123456789');
  const a = await buildInventory(root, { paths: ['src'], maxFileBytes: 3 });
  assert.equal(a.coverage, 'partial'); assert.equal(a.files.length, 0);
  const b = await buildInventory(root, { paths: ['src'], maxTotalBytes: 3 });
  assert.equal(b.coverage, 'partial'); assert.equal(b.files.length, 0);
});
test('cancellation publishes no success manifest', async t => {
  const { root } = fixture(t); put(root, 'src/a', 'test');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(buildInventory(root, { paths: ['src'] }, controller.signal), /abort/i);
  assert.equal(existsSync(join(root, '.blackbox/manifests')), false);
});
test('cancellation during async I/O prevents manifest publication', async t => {
  const { root } = fixture(t); mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src/large'), Buffer.alloc(8 * 1024 * 1024, 65));
  const controller = new AbortController();
  const work = buildInventory(root, { paths: ['src'] }, controller.signal);
  const timer = setImmediate(() => controller.abort());
  t.after(() => clearImmediate(timer));
  await assert.rejects(work, /abort/i);
  assert.equal(existsSync(join(root, '.blackbox/manifests')), false);
});
test('new files appear in later inventories and real option-named source is retained', async t => {
  const { root } = fixture(t); put(root, 'blackbox-report/history/code.ts', 'source'); put(root, 'blackbox-report/report.md', 'first-party source notes');
  const a = await buildInventory(root, { paths: ['blackbox-report'] });
  assert.equal(a.files.length, 2);
  put(root, 'blackbox-report/new.ts', 'new'); const b = await buildInventory(root, { paths: ['blackbox-report'] });
  assert.equal(b.files.length, 3);
});
test('git dirty status excludes recognized generated reports and metadata, not source changes', async t => {
  const { root } = fixture(t); put(root, 'src/app.ts', 'before');
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch { t.skip('Git not installed'); return; }
  execFileSync('git', ['-C', root, 'init', '-q']);
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, '-c', 'user.email=test@example.invalid', '-c', 'user.name=Test', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture']);
  put(root, 'blackbox-report/report.md', report(root)); put(root, 'src/app.ts', 'after');
  await buildInventory(root, { paths: ['src'] });
  const inv = await buildInventory(root, { paths: ['src'] });
  assert.deepEqual(inv.dirty, [' M src/app.ts']);
  assert.match(inv.gitCommit!, /^[a-f0-9]{40,64}$/);
});

test('IDs reserve durably before any report write and reuse source identity', t => {
  const { root } = fixture(t);
  assert.deepEqual(reserveId(root, 'FUNC', 'src/a::f'), { id: 'FUNC-001', reused: false });
  assert.equal(reserveId(root, 'FUNC', 'src/a::f').id, 'FUNC-001');
  assert.equal(reserveId(root, 'FUNC', 'src/a::g').id, 'FUNC-002');
  assert.equal(reserveId(root, 'ASSET', 'src/a::query').id, 'ASSET-001');
});
test('ID bootstrap scans all passes/history and adoption requires actual historical ID', t => {
  const { root } = fixture(t);
  put(root, 'blackbox-enum/report.md', 'FUNC-005\nFUNC-010');
  put(root, 'blackbox-report/history/old/report.md', 'FUNC-020');
  assert.equal(reserveId(root, 'FUNC', 'src/a::new').id, 'FUNC-021');
  assert.throws(() => reserveId(root, 'FUNC', 'src/a::missing', 'FUNC-006'), /historical/);
  assert.equal(reserveId(root, 'FUNC', 'src/a::old', 'FUNC-005').id, 'FUNC-005');
  assert.throws(() => reserveId(root, 'FUNC', 'src/a::other', 'FUNC-005'), /another identity/);
});
test('unsafe history and malformed registry fail closed rather than recycle IDs', t => {
  const { root, base } = fixture(t);
  put(base, 'outside/report.md', 'FUNC-999'); mkdirSync(join(root, 'blackbox-enum'));
  symlinkSync(join(base, 'outside'), join(root, 'blackbox-enum/history'));
  assert.throws(() => reserveId(root, 'FUNC', 'x'), /Symlink/);
  put(root, '.blackbox/ids.json', '{}');
  assert.throws(() => reserveId(root, 'FUNC', 'x'), /Invalid ID registry/);
});
test('preexisting locks fail visibly and never overwrite state', t => {
  const { root } = fixture(t); mkdirSync(join(root, '.blackbox/ids.lock'), { recursive: true });
  assert.throws(() => reserveId(root, 'FUNC', 'x'), /locked/);
  assert.equal(existsSync(join(root, '.blackbox/ids.json')), false);
});

test('concurrent processes reserve distinct IDs without lost updates', async t => {
  const { root } = fixture(t);
  const worker = async (identity: string): Promise<string> => new Promise((resolve, reject) => {
    const script = `import {reserveId} from './extensions/blackbox.ts';
      let value; for(let n=0;n<100;n++){try{value=reserveId(process.argv[1], 'FUNC', process.argv[2]);break}catch(e){if(!e.message.includes('locked'))throw e;await new Promise(r=>setTimeout(r,10));}}
      if(!value)throw Error('lock timed out');console.log(value.id);`;
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script, root, identity]);
    let out = '', err = ''; child.stdout.on('data', x => out += x); child.stderr.on('data', x => err += x);
    child.on('error', reject); child.on('exit', status => status === 0 ? resolve(out.trim()) : reject(new Error(err)));
  });
  const ids = await Promise.all(Array.from({ length: 6 }, (_, i) => worker(`src/a::f${i}`)));
  assert.equal(new Set(ids).size, 6);
  assert.equal(reserveId(root, 'FUNC', 'src/a::after').id, 'FUNC-007');
});

test('ID migration does not silently stop after 2,000 historical reports', t => {
  const { root } = fixture(t);
  for (let i = 0; i < 2005; i++) put(root, `blackbox-enum/history/run-${String(i).padStart(4, '0')}/report.md`, `FUNC-${i + 1}`);
  assert.equal(reserveId(root, 'FUNC', 'src/a::new').id, 'FUNC-2006');
});
test('unreadable historical reports prevent registry bootstrap', { skip: process.getuid?.() === 0 ? 'root bypasses Unix file permissions' : false }, t => {
  const { root } = fixture(t);
  chmodSync(put(root, 'blackbox-enum/history/old/report.md', 'FUNC-999'), 0);
  assert.throws(() => reserveId(root, 'FUNC', 'new'), /EACCES/);
  assert.equal(existsSync(join(root, '.blackbox/ids.json')), false);
});
test('unreadable inventory paths are recorded, not silently omitted', { skip: process.getuid?.() === 0 ? 'root bypasses Unix file permissions' : false }, async t => {
  const { root } = fixture(t); chmodSync(put(root, 'src/a', 'data'), 0);
  const inv = await buildInventory(root, { paths: ['src'] });
  assert.equal(inv.coverage, 'partial'); assert.match(inv.errors[0].reason, /EACCES/);
});
test('invalid UTF-8 scope is rejected rather than hashing substituted text', t => {
  const { root } = fixture(t);
  writeFileSync(join(root, 'SCOPE.md'), Buffer.from([0xff, 0xfe]));
  assert.throws(() => checkScope(root), /encoded data/);
});
