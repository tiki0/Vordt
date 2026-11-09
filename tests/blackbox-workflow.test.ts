import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture, harness, put, report } from './blackbox-helpers.ts';
import { harness as whiteboxHarness } from './helpers.ts';
import { buildInventory, reserveId, validateReport } from '../extensions/blackbox.ts';

const repo = fileURLToPath(new URL('../', import.meta.url));

test('whitebox and blackbox roots, state, artifacts and ID registries remain independent', async t => {
  const { base, root } = fixture(t), b = harness(base), w = whiteboxHarness(base);
  const ctx = b.context();
  await w.commands['vordt-root'].handler(root, ctx);
  assert.equal((await b.handlers.input({ text: '/skill:blackbox-enum' }, ctx)).action, 'handled');
  await b.commands['blackbox-root'].handler(root, ctx);
  const whiteId = await w.call('vordt_ids', { type: 'FUNC', identity: 'shared-identity' }, ctx);
  const blackId = await b.call('blackbox_ids', { type: 'FUNC', identity: 'shared-identity' }, ctx);
  assert.equal(whiteId.details.id, 'FUNC-001');
  assert.equal(blackId.details.id, 'FUNC-001');
  assert.ok(existsSync(join(root, '.vordt/ids.json')));
  assert.ok(existsSync(join(root, '.blackbox/ids.json')));
  await b.commands['blackbox-root'].handler('clear', ctx);
  assert.equal((await w.handlers.input({ text: '/skill:scan-structure' }, ctx)).action, 'transform');
  assert.equal((await b.handlers.input({ text: '/skill:blackbox-map' }, ctx)).action, 'handled');
});

for (const target of ['192.0.2.10', '192.0.2.10:8443', 'example.invalid', 'https://example.invalid/base?q=value', '[2001:db8::1]:443', 'ssh://example.invalid:2222']) {
  test(`target/focus preserved without network or automatic next-pass execution: ${target}`, async t => {
    const { base, root } = fixture(t), h = harness(base), ctx = h.context();
    await h.commands['blackbox-root'].handler(root, ctx);
    const value = await h.handlers.input({ text: `/skill:blackbox-enum ${target} only enumerate` }, ctx);
    assert.equal(value.action, 'transform');
    assert.ok(value.text.startsWith(`/skill:blackbox-enum ${target} only enumerate\n`));
    assert.ok(value.text.includes('<BLACKBOX_SCOPE>'));
    assert.equal(existsSync(join(root, 'blackbox-enum')), false);
    assert.equal(existsSync(join(root, '.blackbox')), false);
  });
}

test('all blackbox ID families have independent durable counters', t => {
  const { root } = fixture(t);
  for (const family of ['ASSET', 'FUNC', 'BLACKBOX'] as const) {
    assert.equal(reserveId(root, family, 'https://example.invalid:443/profile').id, `${family}-001`);
    assert.equal(reserveId(root, family, 'https://example.invalid:443/profile').reused, true);
    assert.equal(reserveId(root, family, 'https://example.invalid:443/upload').id, `${family}-002`);
  }
});

test('blackbox validation requires target/window/evidence metadata, not source access', t => {
  const { root } = fixture(t);
  const good = report(root, 'blackbox-enum');
  assert.ok(!good.includes('Source revision'));
  put(root, 'blackbox-enum/report.md', good.replace('- **Target:** none — fixture', '- **Target:**'));
  assert.ok(validateReport(root, 'blackbox-enum').some(x => x.includes('Target')));
  put(root, 'blackbox-enum/report.md', good.replace('- **Observation window:** none — fixture', '- **Observation window:**'));
  assert.ok(validateReport(root, 'blackbox-enum').some(x => x.includes('Observation window')));
});

test('evidence manifests hash explicitly consumed canonical and archived upstream reports', async t => {
  const { root } = fixture(t);
  put(root, 'blackbox-enum/report.md', report(root, 'blackbox-enum'));
  put(root, 'blackbox-map/history/previous/report.md', report(root, 'blackbox-map'));
  const inventory = await buildInventory(root, {
    paths: ['blackbox-enum/report.md', 'blackbox-map/history/previous/report.md'],
  });
  assert.equal(inventory.files.length, 2);
  assert.equal(inventory.coverage, 'complete');
  assert.equal(inventory.skipped.length, 0);
});

test('blackbox phase contracts explicitly separate discovery, checks, proof and reporting', () => {
  const skill = (name: string) => readFileSync(join(repo, 'skills', name, 'SKILL.md'), 'utf8');
  assert.match(skill('blackbox-enum'), /No exploitation or vulnerability testing at all/);
  assert.match(skill('blackbox-enum'), /wildcard/);
  assert.match(skill('blackbox-map'), /No vulnerability probes/);
  assert.match(skill('blackbox-map'), /State-changing workflows/);
  assert.match(skill('blackbox-vulns'), /scanner-only \| behavior-observed \| unverified/);
  assert.match(skill('blackbox-poc'), /Mock\/local simulations/);
  for (const outcome of ['VALID', 'FAILED', 'BLOCKED', 'NOT ATTEMPTED']) {
    assert.ok(skill('blackbox-poc').includes(outcome));
    assert.ok(skill('blackbox-report').includes(outcome));
  }
  assert.match(skill('blackbox-report'), /no target requests/);
  assert.match(skill('blackbox-report'), /not scored/);
});
