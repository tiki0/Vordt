import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import type { TestContext } from 'node:test';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import blackbox, { checkScope, HEADER_FIELDS, HANDOFF_FIELDS, type Option } from '../extensions/blackbox.ts';

export function fixture(t: TestContext) {
  const base = mkdtempSync(join(tmpdir(), 'blackbox-test-'));
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
export function report(root: string, option: Option = 'blackbox-report', coverage = 'partial', runId = '2026-01-01T00-00-00-000Z-test') {
  const values: Record<string, string> = {
    'Run ID / UTC date': runId, 'Project root': root, Coverage: coverage,
    Scope: `SCOPE.md — SHA-256 ${checkScope(root).sha256}`,
  };
  const sections: Record<Option, string[]> = {
    'blackbox-enum': ['Enumeration summary', 'Coverage inventory', 'Accessible assets'],
    'blackbox-map': ['Functionality coverage', 'Functionality inventory'],
    'blackbox-vulns': ['Triage summary', 'Candidate findings', 'Rejected candidates'],
    'blackbox-poc': ['Attempt summary', 'Attempts'],
    'blackbox-report': ['Executive summary', 'Findings', 'Remediation summary', 'Appendix'],
  };
  return `# ${option} report\n\n` + HEADER_FIELDS.map(k => `- **${k}:** ${values[k] ?? 'none — fixture'}`).join('\n') + '\n\n' +
    [...(coverage === 'blocked' ? [] : sections[option]), 'Evidence manifest'].map(s => `## ${s}\nnone — fixture\n`).join('\n') +
    '\n## Handoff\n' + HANDOFF_FIELDS.map(k => `- **${k}:** none — fixture`).join('\n') + '\n';
}

// A mock of Pi's registration boundary, not a reimplementation of the extension.
// Intentionally loose callbacks permit direct tests of runtime-invalid arguments too.
export function harness(base: string, worker?: Parameters<typeof blackbox>[1]) {
  const handlers: Record<string, (...args: any[]) => any> = {};
  const commands: Record<string, { handler: (...args: any[]) => any }> = {};
  const tools: Record<string, { execute: (...args: any[]) => any; parameters: any }> = {};
  const messages: any[] = [], notices: any[] = [], statuses: any[] = [], userMessages: any[] = [];
  const listeners: Record<string, ((...args: any[]) => any)[]> = {};
  const api = {
    on: (name: string, fn: (...args: any[]) => any) => {
      (listeners[name] ??= []).push(fn);
      handlers[name] = async (event: any, ctx: any) => {
        let result: any;
        for (const listener of listeners[name]) {
          const next = await listener(event, ctx);
          if (next?.action === 'handled') return next;
          if (next?.action === 'transform') { event = { ...event, text: next.text }; result = next; }
          else if (name !== 'input' && next !== undefined) result = next;
        }
        return result ?? (name === 'input' ? { action: 'continue' } : undefined);
      };
    },
    registerCommand: (name: string, command: any) => { commands[name] = command; },
    registerTool: (tool: any) => { tools[tool.name] = tool; },
    sendMessage: (message: any) => { messages.push(message); },
    sendUserMessage: (message: any, options: any) => { userMessages.push({ message, options }); },
  };
  const old = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = join(base, 'config');
  let ready: Promise<void>;
  try { ready = blackbox(api as unknown as ExtensionAPI, worker); } finally {
    if (old === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = old;
  }
  const context = (session = 'a') => ({
    cwd: base, hasUI: true, isIdle: () => true,
    sessionManager: { getSessionId: () => session },
    ui: { notify: (...x: any[]) => notices.push(x), setStatus: (...x: any[]) => statuses.push(x) },
  });
  return {
    handlers, commands, tools, messages, notices, statuses, userMessages, context, ready,
    call: (name: string, params: any, ctx: any, signal?: AbortSignal) => tools[name].execute('test', params, signal, undefined, ctx),
  };
}
