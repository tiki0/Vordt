import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import type { TestContext } from 'node:test';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import vordt, { checkScope, HEADER_FIELDS, HANDOFF_FIELDS, type Option } from '../extensions/vordt.ts';

export function fixture(t: TestContext) {
  const base = mkdtempSync(join(tmpdir(), 'vordt-test-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'target');
  mkdirSync(root);
  writeFileSync(join(root, 'SCOPE.md'), '# Scope\nAuthorized local fixture. In scope: src/. No production or network testing.\n');
  return { base, root };
}
export function put(root: string, rel: string, text = 'fixture') {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return path;
}
export function report(root: string, option: Option = 'report', coverage = 'partial', runId = '2026-01-01T00-00-00-000Z-test') {
  const values: Record<string, string> = {
    'Run ID / UTC date': runId, 'Project root': root, Coverage: coverage,
    Scope: `SCOPE.md — SHA-256 ${checkScope(root).sha256}`,
  };
  const sections: Record<Option, string[]> = {
    'scan-structure': ['Architecture and normal behavior', 'Coverage inventory', 'Function inventory'],
    'scan-surface': ['Surface coverage', 'Input points'],
    'scan-vulns': ['Triage summary', 'Candidate findings', 'Rejected candidates'],
    exploit: ['Attempt summary', 'Attempts'],
    report: ['Executive summary', 'Findings', 'Remediation summary', 'Appendix'],
  };
  return `# ${option} report\n\n` + HEADER_FIELDS.map(k => `- **${k}:** ${values[k] ?? 'none — fixture'}`).join('\n') + '\n\n' +
    [...(coverage === 'blocked' ? [] : sections[option]), 'Source manifest'].map(s => `## ${s}\nnone — fixture\n`).join('\n') +
    '\n## Handoff\n' + HANDOFF_FIELDS.map(k => `- **${k}:** none — fixture`).join('\n') + '\n';
}

// A mock of Pi's registration boundary, not a reimplementation of the extension.
// Intentionally loose callbacks permit direct tests of runtime-invalid arguments too.
export function harness(base: string) {
  const handlers: Record<string, (...args: any[]) => any> = {};
  const commands: Record<string, { handler: (...args: any[]) => any }> = {};
  const tools: Record<string, { execute: (...args: any[]) => any; parameters: any }> = {};
  const messages: any[] = [], notices: any[] = [], statuses: any[] = [];
  const api = {
    on: (name: string, fn: (...args: any[]) => any) => { handlers[name] = fn; },
    registerCommand: (name: string, command: any) => { commands[name] = command; },
    registerTool: (tool: any) => { tools[tool.name] = tool; },
    sendMessage: (message: any) => { messages.push(message); },
  };
  const old = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = join(base, 'config');
  try { vordt(api as unknown as ExtensionAPI); } finally {
    if (old === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = old;
  }
  const context = (session = 'a') => ({
    cwd: base, hasUI: true, isIdle: () => true,
    sessionManager: { getSessionId: () => session },
    ui: { notify: (...x: any[]) => notices.push(x), setStatus: (...x: any[]) => statuses.push(x) },
  });
  return {
    handlers, commands, tools, messages, notices, statuses, context,
    call: (name: string, params: any, ctx: any, signal?: AbortSignal) => tools[name].execute('test', params, signal, undefined, ctx),
  };
}
