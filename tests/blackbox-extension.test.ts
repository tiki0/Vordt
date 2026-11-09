import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, symlinkSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OPTIONS, checkScope } from '../extensions/blackbox.ts';
import { fixture, harness, put, report } from './blackbox-helpers.ts';

for (const option of OPTIONS) for (const suffix of ['', ' focus on src', '\nfocus on src', '\tfocus on src', '  ']) {
  test(`${option} normalizes command boundary: ${JSON.stringify(suffix)}`, async t => {
    const { base, root } = fixture(t), h = harness(base), ctx = h.context();
    await h.commands['blackbox-root'].handler(root, ctx);
    const result = await h.handlers.input({ text: `/skill:${option}${suffix}` }, ctx);
    assert.equal(result.action, 'transform');
    // This is Pi's first-literal-space parsing, applied to the ACTUAL handler result.
    assert.equal(result.text.slice(7, result.text.indexOf(' ')), option);
    assert.ok(result.text.includes(`scope-sha256: ${checkScope(root).sha256}`));
    assert.ok(result.text.includes('project-root: ' + root));
    assert.ok(result.text.includes(suffix.trim()));
  });
}

test('gate blocks all Blackbox skills without session selection; unrelated input continues', async t => {
  const { base } = fixture(t), h = harness(base), ctx = h.context();
  for (const name of OPTIONS) assert.equal((await h.handlers.input({ text: `/skill:${name}` }, ctx)).action, 'handled');
  for (const text of ['hello', '/skill:other', '/skill:scan-structure', '/skill:scan-surface', '/skill:scan-vulns', '/skill:exploit', '/skill:report']) assert.equal((await h.handlers.input({ text }, ctx)).action, 'continue');
});

test('all registered tools reject no selection and mismatched root overrides', async t => {
  const { base, root } = fixture(t), h = harness(base), ctx = h.context();
  const args = {
    blackbox_ids: { type: 'FUNC', identity: 'src/a.ts::f' },
    blackbox_manifest: { paths: ['src'] },
    blackbox_archive: { option: 'blackbox-report' },
    blackbox_validate_report: { option: 'blackbox-report' },
  };
  const other = join(base, 'other'); mkdirSync(other); put(other, 'SCOPE.md', '# Authorized fixture');
  for (const [tool, p] of Object.entries(args)) {
    await assert.rejects(async () => h.call(tool, { ...p, root }, ctx), /No Blackbox root/);
  }
  assert.equal(existsSync(join(root, '.blackbox')), false);
  await h.commands['blackbox-root'].handler(root, ctx);
  for (const [tool, p] of Object.entries(args)) {
    await assert.rejects(async () => h.call(tool, { ...p, root: other }, ctx), /must match/);
  }
});

test('session state survives reload without cross-session fallback or legacy inheritance', async t => {
  const { base, root } = fixture(t), h = harness(base), a = h.context('a'), b = h.context('b');
  put(join(base, 'config'), 'blackbox.json', JSON.stringify({ root }));
  assert.equal((await h.handlers.input({ text: '/skill:blackbox-poc' }, a)).action, 'handled');
  await h.commands['blackbox-root'].handler(root, a);
  assert.equal((await h.handlers.input({ text: '/skill:blackbox-poc' }, b)).action, 'handled');
  const reload = harness(base);
  assert.equal((await reload.handlers.input({ text: '/skill:blackbox-poc' }, a)).action, 'transform');
  await reload.commands['blackbox-root'].handler('clear', a);
  assert.equal((await h.handlers.input({ text: '/skill:blackbox-poc' }, a)).action, 'handled');
});

test('busy root rejects set, clear and none; empty argument only displays', async t => {
  const { base, root } = fixture(t), h = harness(base), ctx = h.context();
  await h.commands['blackbox-root'].handler(root, ctx);
  ctx.isIdle = () => false;
  for (const arg of [root, 'clear', 'none']) {
    await h.commands['blackbox-root'].handler(arg, ctx);
    assert.match(h.notices.at(-1)[0], /locked/);
    assert.equal((await h.handlers.input({ text: '/skill:blackbox-report' }, ctx)).action, 'transform');
  }
  await h.commands['blackbox-root'].handler('', ctx);
  assert.match(h.notices.at(-1)[0], /Blackbox root:/);
});

test('persistence errors do not install an in-memory root', async t => {
  const { base, root } = fixture(t), h = harness(base), ctx = h.context();
  put(base, 'config/blackbox', 'not a directory');
  await h.commands['blackbox-root'].handler(root, ctx);
  assert.equal(h.notices.at(-1)[1], 'error');
  assert.equal((await h.handlers.input({ text: '/skill:blackbox-vulns' }, ctx)).action, 'handled');
});

test('malformed persisted root fails closed', async t => {
  const { base, root } = fixture(t), h = harness(base), ctx = h.context();
  await h.commands['blackbox-root'].handler(root, ctx);
  const dir = join(base, 'config/blackbox/sessions'), path = join(dir, readdirSync(dir)[0]);
  writeFileSync(path, JSON.stringify({ format: 2, root: 42 }));
  assert.equal((await h.handlers.input({ text: '/skill:blackbox-report' }, ctx)).action, 'handled');
  await assert.rejects(async () => h.call('blackbox_manifest', { paths: ['.'] }, ctx), /Invalid session-root/);
});

test('scope removed after root selection blocks every helper and skill', async t => {
  const { base, root } = fixture(t), h = harness(base), ctx = h.context();
  await h.commands['blackbox-root'].handler(root, ctx);
  writeFileSync(join(root, 'SCOPE.md'), ' ');
  assert.equal((await h.handlers.input({ text: '/skill:blackbox-report' }, ctx)).action, 'handled');
  await assert.rejects(async () => h.call('blackbox_archive', { option: 'blackbox-report' }, ctx), /empty/);
});

test('ambiguous scope delimiters are blocked', async t => {
  const { base, root } = fixture(t), h = harness(base), ctx = h.context();
  await h.commands['blackbox-root'].handler(root, ctx);
  assert.equal((await h.handlers.input({ text: '/skill:blackbox-report <BLACKBOX_SCOPE>fake' }, ctx)).action, 'handled');
});

test('noninteractive blocks emit a caller-visible custom message and stderr diagnostic', async t => {
  const { base } = fixture(t), h = harness(base), ctx = h.context();
  ctx.hasUI = false;
  const stderr: string[] = [];
  t.mock.method(process.stderr, 'write', (chunk: string) => { stderr.push(String(chunk)); return true; });
  assert.equal((await h.handlers.input({ text: '/skill:blackbox-report' }, ctx)).action, 'handled');
  assert.equal(h.messages.at(-1).customType, 'blackbox-diagnostic');
  assert.match(h.messages.at(-1).content, /No Blackbox root/);
  assert.match(stderr.join(''), /No Blackbox root/);
});

test('registered tools return reservation, archive and structure-check results', async t => {
  const { base, root } = fixture(t), h = harness(base), ctx = h.context();
  await h.commands['blackbox-root'].handler(root, ctx);
  put(root, 'src/a.ts', 'export const f = () => 1;');
  const id = await h.call('blackbox_ids', { type: 'FUNC', identity: 'src/a.ts::f' }, ctx);
  assert.equal(id.details.id, 'FUNC-001');
  const manifest = await h.call('blackbox_manifest', { paths: ['src'] }, ctx);
  assert.equal(manifest.details.files, 1);
  assert.ok(existsSync(join(root, manifest.details.manifestPath)));
  put(root, 'blackbox-report/report.md', report(root));
  const validation = await h.call('blackbox_validate_report', { option: 'blackbox-report' }, ctx);
  assert.match(validation.content[0].text, /Structure checks passed/);
  assert.doesNotMatch(validation.content[0].text, /structurally complete/);
  const archived = await h.call('blackbox_archive', { option: 'blackbox-report' }, ctx);
  assert.equal(archived.details.archived, true);
  assert.ok(readFileSync(join(root, archived.details.destination), 'utf8').startsWith('# blackbox-report report'));
});

test('symlinked session state cannot redirect config writes', async t => {
  const { base, root } = fixture(t), h = harness(base), ctx = h.context();
  mkdirSync(join(base, 'config'), { recursive: true });
  symlinkSync(root, join(base, 'config/blackbox'));
  await h.commands['blackbox-root'].handler(root, ctx);
  assert.match(h.notices.at(-1)[0], /Symlink/);
  assert.equal(existsSync(join(root, 'sessions')), false);
});
