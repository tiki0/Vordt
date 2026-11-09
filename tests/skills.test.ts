import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OPTIONS } from '../extensions/vordt.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
for (const name of OPTIONS) {
  const path = resolve(root, 'skills', name, 'SKILL.md');
  const text = readFileSync(path, 'utf8');
  test(`${name} frontmatter declares the matching name, description and explicit invocation`, () => {
    const fm = text.match(/^---\n([\s\S]*?)\n---\n/);
    assert.ok(fm, 'frontmatter must be closed');
    const keys = Object.fromEntries(fm[1].split('\n').map(line => {
      const m = line.match(/^([a-z-]+): (.+)$/); assert.ok(m, `invalid frontmatter line ${line}`); return [m[1], m[2]];
    }));
    assert.equal(keys.name, name);
    assert.ok(keys.description.length > 0 && keys.description.length <= 1024);
    assert.equal(keys['disable-model-invocation'], 'true');
  });
  test(`${name} includes all workflow sections and resolves bundled reference links`, () => {
    for (const section of ['Preconditions and scope', 'Required inputs', 'Allowed and prohibited actions', 'Procedure', 'Output schema', 'Completion checklist', 'Context handoff']) {
      assert.ok(text.includes(`## ${section}`), `missing ${section}`);
    }
    const refs = [...text.matchAll(/\]\(([^)]+\.md)\)/g)].map(m => m[1]);
    assert.ok(refs.includes('../references/workflow.md'));
    for (const ref of refs) assert.ok(existsSync(resolve(dirname(path), ref)), `missing reference ${ref}`);
    assert.ok(text.includes('Source manifest'), 'all output templates require a source manifest');
    assert.ok(text.includes('Handoff'), 'all outputs require handoff');
  });
}
test('workflow contract documents exact current helper contracts', () => {
  const workflow = readFileSync(resolve(root, 'skills/references/workflow.md'), 'utf8');
  for (const marker of ['shared bookkeeping under `.vordt/`', 'existingId', 'exclusions', 'Inventory', 'Source manifest']) {
    assert.ok(workflow.toLowerCase().includes(marker.toLowerCase()), `missing workflow marker ${marker}`);
  }
  assert.ok(workflow.includes('its own'));
  assert.ok(!workflow.includes('ask for the highest'));
});
