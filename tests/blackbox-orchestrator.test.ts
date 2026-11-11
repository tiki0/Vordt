import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkScope, OPTIONS, safePath } from '../extensions/blackbox.ts';
import { executePlan, parsePlan, runWorkerProcess, workerArgs, type WorkerRequest } from '../extensions/lib/blackbox-orchestrator.ts';
import { fixture, harness, put, report } from './blackbox-helpers.ts';

const repo = fileURLToPath(new URL('../', import.meta.url));
const success = { exitCode: 0, assistantSeen: true };
const request = (root: string) => ({ root, scopeSha256: checkScope(root).sha256, repo });

test('plans default to discovery; explicit phase ranges and PoC opt-in are enforced', () => {
  assert.deepEqual(parsePlan('https://example.invalid').phases, ['blackbox-enum', 'blackbox-map']);
  assert.deepEqual(parsePlan('--through=report target').phases, ['blackbox-enum', 'blackbox-map', 'blackbox-vulns', 'blackbox-report']);
  assert.deepEqual(parsePlan('--through=report --with-poc target').phases, [...OPTIONS]);
  assert.deepEqual(parsePlan('--from=map --through=vulns --timeout=30 target only profiles'), {
    phases: ['blackbox-map', 'blackbox-vulns'], timeoutSeconds: 30, focus: 'target only profiles',
  });
  for (const args of ['', '--unknown target', '--through=poc target', '--from=poc --through=report target',
    '--through=map --with-poc target', '--from=report target', '--timeout=0 target', '--timeout=7201 target',
    '--through=enum --through=map target', 'target <BLACKBOX_SCOPE>']) assert.throws(() => parsePlan(args), args);
});

for (const option of OPTIONS) test(`/${option} literally forwards to the gated skill`, async t => {
  const { base, root } = fixture(t), h = harness(base), ctx = h.context();
  await h.commands[option].handler('example.invalid', ctx);
  assert.equal(h.userMessages.length, 0);
  await h.commands['blackbox-root'].handler(root, ctx);
  await h.commands[option].handler('example.invalid only test account', ctx);
  assert.deepEqual(h.userMessages.at(-1), {
    message: `/skill:${option} example.invalid only test account`, options: { expandPromptTemplates: true },
  });
  const input = await h.handlers.input({ text: h.userMessages.at(-1).message }, ctx);
  assert.equal(input.action, 'transform');
  assert.ok(input.text.includes('<BLACKBOX_SCOPE>'));
});

test('coordinator skill and tool require an explicit per-session human plan', async t => {
  const { base, root } = fixture(t), h = harness(base), ctx = h.context();
  await h.ready;
  await h.commands['blackbox-root'].handler(root, ctx);
  assert.equal((await h.handlers.input({ text: '/skill:blackbox-orchestrate target' }, ctx)).action, 'handled');
  await assert.rejects(h.call('blackbox_orchestrate', {}, ctx), /human-approved/);
  await h.commands['blackbox-orchestrate'].handler('--through=report example.invalid', ctx);
  assert.equal(h.userMessages.at(-1).message, '/skill:blackbox-orchestrate example.invalid');
  const injected = await h.handlers.input({ text: h.userMessages.at(-1).message }, ctx);
  assert.equal(injected.action, 'transform');
  assert.match(injected.text, /\/blackbox-enum → \/blackbox-map → \/blackbox-vulns → \/blackbox-report/);
  assert.doesNotMatch(injected.text, /\/blackbox-poc/);
  assert.equal((await h.handlers.input({ text: '/skill:blackbox-orchestrate target' }, h.context('other'))).action, 'handled');
  await h.handlers.agent_settled({}, ctx);
  await assert.rejects(h.call('blackbox_orchestrate', {}, ctx), /human-approved/);
});

test('scope changes and busy sessions cannot start delegated work', async t => {
  const { base, root } = fixture(t), h = harness(base), ctx = h.context();
  await h.ready;
  await h.commands['blackbox-root'].handler(root, ctx);
  ctx.isIdle = () => false;
  await h.commands['blackbox-orchestrate'].handler('example.invalid', ctx);
  assert.equal(h.userMessages.length, 0);
  ctx.isIdle = () => true;
  await h.commands['blackbox-orchestrate'].handler('example.invalid', ctx);
  put(root, 'SCOPE.md', 'scope changed');
  await assert.rejects(h.call('blackbox_orchestrate', {}, ctx), /human-approved/);
});

test('worker roots are pinned, digest-bound, and cannot recursively orchestrate', async t => {
  const { base, root } = fixture(t), h = harness(base, { root, sha256: checkScope(root).sha256 }), ctx = h.context('worker');
  assert.equal((await h.handlers.input({ text: '/skill:blackbox-enum example.invalid' }, ctx)).action, 'transform');
  assert.equal(h.tools.blackbox_orchestrate, undefined);
  assert.equal(h.commands['blackbox-orchestrate'], undefined);
  await h.commands['blackbox-root'].handler('clear', ctx);
  assert.match(h.notices.at(-1)[0], /pinned/);
  assert.equal((await h.handlers.input({ text: '/skill:blackbox-enum example.invalid' }, ctx)).action, 'transform');
  put(root, 'SCOPE.md', 'changed');
  assert.equal((await h.handlers.input({ text: '/skill:blackbox-enum example.invalid' }, ctx)).action, 'handled');
});

for (const phase of OPTIONS) test(`worker /${phase} transforms the original prompt without fire-and-forget dispatch`, async t => {
  const { base, root } = fixture(t), h = harness(base, { root, sha256: checkScope(root).sha256 }), ctx = h.context('worker');
  await h.ready;
  assert.equal(h.commands[phase], undefined);
  const value = await h.handlers.input({ text: `/${phase} offline fixture` }, ctx);
  assert.equal(value.action, 'transform');
  assert.ok(value.text.startsWith(`/skill:${phase} offline fixture\n`));
  assert.ok(value.text.includes('<BLACKBOX_SCOPE>'));
  assert.equal(h.userMessages.length, 0);
});

test('worker invocation selects a single skill, literal alias, tools and inherited model', () => {
  const value: WorkerRequest = { root: '/tmp/root', scopeSha256: 'a'.repeat(64), repo, phase: 'blackbox-enum',
    focus: 'example.invalid; not a shell command', model: 'provider/model', thinking: 'high', timeoutSeconds: 60 };
  const args = workerArgs(value);
  assert.ok(args.includes('--no-extensions'));
  assert.ok(args.includes('--no-skills'));
  assert.ok(args.includes('--no-context-files'));
  assert.ok(args.includes('--no-mcp'));
  assert.ok(args.includes('--no-session'));
  assert.equal(args[args.indexOf('--skill') + 1], join(repo, 'skills/blackbox-enum/SKILL.md'));
  assert.equal(args[args.indexOf('--model') + 1], 'provider/model');
  assert.equal(args[args.indexOf('--thinking') + 1], 'high');
  assert.match(args.at(-1)!, /^\/blackbox-enum example.invalid; not a shell command/);
  assert.ok(!args[args.indexOf('--tools') + 1].includes('orchestrate'));
});

test('coordinator executes ordered workers and records durable report hashes and run IDs', async t => {
  const { root } = fixture(t), called: string[] = [];
  const result = await executePlan(request(root), parsePlan('--through=report example.invalid'), undefined, undefined,
    async worker => {
      called.push(worker.phase);
      assert.equal(worker.focus, 'example.invalid');
      put(root, `${worker.phase}/report.md`, report(root, worker.phase, 'complete', `RUN-${called.length}`));
      return success;
    });
  assert.deepEqual(called, ['blackbox-enum', 'blackbox-map', 'blackbox-vulns', 'blackbox-report']);
  assert.equal(result.status, 'complete');
  assert.equal(result.phases.length, 4);
  assert.ok(result.phases.every(x => x.status === 'complete' && /^[a-f0-9]{64}$/.test(x.report!.sha256)));
  const state = JSON.parse(readFileSync(join(root, result.statePath), 'utf8'));
  assert.equal(state.phases[1].report.runId, 'RUN-2');
  assert.equal(state.scopeSha256, checkScope(root).sha256);
  assert.equal(existsSync(join(root, '.blackbox/orchestrator.lock')), false);
});

for (const kind of ['partial', 'blocked', 'missing', 'invalid', 'unchanged', 'reused-run-id', 'process-error', 'no-assistant', 'scope-change', 'cancel']) {
  test(`orchestration stops on ${kind} without launching downstream`, async t => {
    const { root } = fixture(t), controller = new AbortController(); let calls = 0;
    if (['unchanged', 'reused-run-id'].includes(kind)) put(root, 'blackbox-enum/report.md', report(root, 'blackbox-enum', 'complete'));
    const result = await executePlan(request(root), parsePlan('example.invalid'), controller.signal, undefined,
      async worker => {
        calls++;
        if (!['missing', 'unchanged'].includes(kind)) put(root, `${worker.phase}/report.md`, kind === 'invalid' ? '# Invalid' : report(root, worker.phase,
          ['partial', 'blocked'].includes(kind) ? kind : 'complete'));
        if (kind === 'reused-run-id') put(root, `${worker.phase}/report.md`, report(root, worker.phase, 'complete') + '\nChanged but reused run ID\n');
        if (kind === 'scope-change') put(root, 'SCOPE.md', 'changed scope');
        if (kind === 'cancel') controller.abort();
        return { exitCode: kind === 'process-error' ? 1 : 0, assistantSeen: kind !== 'no-assistant' };
      });
    assert.equal(result.status, 'stopped');
    assert.ok(result.error);
    assert.equal(calls, 1);
    assert.equal(result.phases[0].status, 'stopped');
    assert.equal(existsSync(join(root, '.blackbox/orchestrator.lock')), false);
  });
}

test('resume refuses missing upstream reports; root-wide lock rejects competing orchestrators', async t => {
  const { root } = fixture(t); let calls = 0;
  const value = await executePlan(request(root), parsePlan('--from=map example.invalid'), undefined, undefined,
    async () => { calls++; return success; });
  assert.equal(value.status, 'stopped'); assert.equal(calls, 0);
  mkdirSync(safePath(root, '.blackbox/orchestrator.lock'));
  await assert.rejects(executePlan(request(root), parsePlan('example.invalid')), /already owns/);
});

test('manual aliases and raw skill invocations cannot compete with an orchestrator lock', async t => {
  const { base, root } = fixture(t), h = harness(base), ctx = h.context();
  await h.ready;
  await h.commands['blackbox-root'].handler(root, ctx);
  mkdirSync(join(root, '.blackbox/orchestrator.lock'), { recursive: true });
  await h.commands['blackbox-enum'].handler('example.invalid', ctx);
  assert.equal(h.userMessages.length, 0);
  assert.match(h.notices.at(-1)[0], /owned by an orchestrator/);
  assert.equal((await h.handlers.input({ text: '/skill:blackbox-enum example.invalid' }, ctx)).action, 'handled');
});

test('Pi loads the orchestrator through the documented global-style single-file symlink', { skip: process.platform === 'win32' }, async t => {
  const { base, root } = fixture(t);
  const installed = join(base, 'installed/blackbox.ts');
  mkdirSync(join(base, 'installed'));
  symlinkSync(join(repo, 'extensions/blackbox.ts'), installed);
  const value = await runWorkerProcess({ command: process.execPath, args: [
    join(repo, 'node_modules/@earendil-works/pi-coding-agent/dist/cli.js'), '--offline', '--mode', 'json', '--print',
    '--no-session', '--no-extensions', '--extension', installed, '--no-skills', '--no-mcp', '--no-context-files',
    '--no-approve', '--', '/blackbox-orchestrate example.invalid',
  ] }, root, { ...process.env, PI_OFFLINE: '1', PI_CODING_AGENT_DIR: join(base, 'config') }, 20);
  assert.equal(value.assistantSeen, false);
  // A registered command blocks for the missing root; a load failure would lose this diagnostic.
  assert.equal(value.failure, 'Worker scope/command gate failed');
});

test('real pinned Pi CLI expands literal worker alias and blocks malformed scope without a model call', async t => {
  const { root } = fixture(t);
  put(root, 'SCOPE.md', 'Authorized local fixture only. No network. <BLACKBOX_SCOPE>');
  const req: WorkerRequest = { ...request(root), phase: 'blackbox-enum', focus: 'example.invalid', timeoutSeconds: 20 };
  const value = await runWorkerProcess({ command: process.execPath, args: [
    join(repo, 'node_modules/@earendil-works/pi-coding-agent/dist/cli.js'), '--offline', ...workerArgs(req),
  ] }, root, { ...process.env, PI_OFFLINE: '1', BLACKBOX_WORKER_SCOPE: JSON.stringify({ root, sha256: req.scopeSha256 }) }, 20);
  assert.equal(value.assistantSeen, false);
  assert.equal(value.failure, 'Worker scope/command gate failed');
  assert.equal(existsSync(join(root, 'blackbox-enum')), false);
});

test('real CLI awaits the literal worker alias through scope, skill expansion and assistant completion', async t => {
  const { base, root } = fixture(t);
  const marker = join(root, 'offline-worker-marker.json');
  const req: WorkerRequest = { ...request(root), model: 'blackbox-fixture/worker', phase: 'blackbox-enum',
    focus: 'offline local fixture only; do not contact any host', timeoutSeconds: 20 };
  const args = workerArgs(req);
  args.splice(args.indexOf('--'), 0, '--extension', join(repo, 'tests/fixtures/blackbox-provider.ts'));
  const value = await runWorkerProcess({ command: process.execPath, args: [
    join(repo, 'node_modules/@earendil-works/pi-coding-agent/dist/cli.js'), '--offline', ...args,
  ] }, root, { ...process.env, PI_OFFLINE: '1', PI_CODING_AGENT_DIR: join(base, 'config'),
    BLACKBOX_FIXTURE_MARKER: marker, BLACKBOX_WORKER_SCOPE: JSON.stringify({ root, sha256: req.scopeSha256 }) }, 20);
  assert.equal(value.exitCode, 0);
  assert.equal(value.failure, undefined);
  assert.equal(value.assistantSeen, true);
  assert.deepEqual(JSON.parse(readFileSync(marker, 'utf8')), {
    phase: 'blackbox-enum', skillExpanded: true, scopeInjected: true, delegated: true,
  });
});

test('real offline CLI workers advance enum→map and persist startup diagnostics', async t => {
  const { base, root } = fixture(t);
  const value = await executePlan({ ...request(root), model: 'blackbox-fixture/worker' }, parsePlan('offline fixture only'),
    undefined, undefined, async req => {
      const reportFixture = put(root, `fixtures/${req.phase}.md`, report(root, req.phase, 'complete', `NEW-${req.phase}`));
      const args = workerArgs(req);
      args.splice(args.indexOf('--'), 0, '--extension', join(repo, 'tests/fixtures/blackbox-provider.ts'));
      return runWorkerProcess({ command: process.execPath, args: [
        join(repo, 'node_modules/@earendil-works/pi-coding-agent/dist/cli.js'), '--offline', ...args,
      ] }, root, { ...process.env, PI_OFFLINE: '1', PI_CODING_AGENT_DIR: join(base, 'config'),
        BLACKBOX_FIXTURE_PHASE: req.phase, BLACKBOX_FIXTURE_REPORT: reportFixture,
        BLACKBOX_WORKER_SCOPE: JSON.stringify({ root, sha256: req.scopeSha256 }) }, 20);
    });
  assert.equal(value.status, 'complete', value.error);
  assert.deepEqual(value.phases.map(x => [x.phase, x.status]), [['blackbox-enum', 'complete'], ['blackbox-map', 'complete']]);
  assert.ok(value.phases.every(x => x.worker?.assistantSeen && x.worker.diagnostics?.agentStarted));
  const state = JSON.parse(readFileSync(join(root, value.statePath), 'utf8'));
  assert.equal(state.phases[0].worker.diagnostics.agentStarted, true);
});

test('process runner distinguishes pre-agent exits from model execution failures', async t => {
  const { root } = fixture(t);
  const early = await runWorkerProcess({ command: process.execPath, args: ['-e',
    'console.log(JSON.stringify({type:"session",id:"fixture"}))'] }, root, process.env, 5);
  assert.equal(early.exitCode, 0);
  assert.equal(early.assistantSeen, false);
  assert.equal(early.diagnostics?.agentStarted, false);
  assert.match(early.failure!, /before starting an agent run/);
  const started = await runWorkerProcess({ command: process.execPath, args: ['-e',
    'console.log(JSON.stringify({type:"agent_start"}))'] }, root, process.env, 5);
  assert.equal(started.diagnostics?.agentStarted, true);
  assert.match(started.failure!, /started but produced no completed assistant/);
});

test('startup authentication diagnostics are classified without retaining raw stderr or secrets', async t => {
  const { root } = fixture(t);
  const value = await runWorkerProcess({ command: process.execPath, args: ['-e',
    'console.error("No API key found for provider private-fixture-value");process.exitCode=1'] }, root, process.env, 5);
  assert.match(value.failure!, /authentication failed/);
  assert.ok(value.diagnostics!.stderrBytes > 0);
  assert.ok(!JSON.stringify(value).includes('private-fixture-value'));
});

test('process runner reads final JSON without newline and does not forward raw output', async t => {
  const { root } = fixture(t);
  const value = await runWorkerProcess({ command: process.execPath, args: ['-e',
    'console.error("secret fixture stderr");process.stdout.write(JSON.stringify({type:"message_end",message:{role:"assistant",stopReason:"stop",content:[{type:"text",text:"secret fixture"}]}}))'] }, root, process.env, 5);
  assert.equal(value.exitCode, 0);
  assert.equal(value.assistantSeen, true);
  assert.equal(value.failure, undefined);
  assert.equal(value.diagnostics?.jsonRecords, 1);
  assert.ok(!JSON.stringify(value).includes('secret'));
});

test('process runner detects model errors and startup failures', async t => {
  const { root } = fixture(t);
  const value = await runWorkerProcess({ command: process.execPath, args: ['-e',
    'console.log(JSON.stringify({type:"message_end",message:{role:"assistant",stopReason:"error"}}));setInterval(()=>{},1000)'] }, root, process.env, 5);
  assert.match(value.failure!, /model failed/);
  const missing = await runWorkerProcess({ command: join(root, 'missing-pi'), args: [] }, root, process.env, 5);
  assert.match(missing.failure!, /Unable to spawn/);
});

for (const kind of ['timeout', 'abort', 'oversized-line']) test(`process runner bounds ${kind}`, async t => {
  const { root } = fixture(t), controller = new AbortController();
  const timer = kind === 'abort' ? setTimeout(() => controller.abort(), 100) : undefined;
  t.after(() => clearTimeout(timer));
  const value = await runWorkerProcess({ command: process.execPath, args: ['-e', kind === 'oversized-line' ?
    'process.stdout.write("x".repeat(3*1024*1024));setInterval(()=>{},1000)' : 'setInterval(()=>{},1000)'] }, root, process.env, kind === 'timeout' ? 0.2 : 5, controller.signal);
  assert.match(value.failure!, kind === 'abort' ? /cancelled/ : kind === 'timeout' ? /timeout/ : /line budget/);
});

test('coordinator skill is explicit-only and resolves its workflow reference', () => {
  const text = readFileSync(join(repo, 'skills/blackbox-orchestrate/SKILL.md'), 'utf8');
  assert.match(text, /name: blackbox-orchestrate/);
  assert.match(text, /disable-model-invocation: true/);
  assert.match(text, /calling `blackbox_orchestrate` exactly once/);
  assert.ok(existsSync(join(repo, 'skills/blackbox-orchestrate/../references/blackbox-workflow.md')));
});
