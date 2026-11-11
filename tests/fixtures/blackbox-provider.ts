/** Offline CLI integration fixture. Never contacts a provider or assessment target. */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export default function fixture(pi: ExtensionAPI) {
  pi.on('before_agent_start', async (event) => {
    if (event.messageType !== 'user') throw new Error('Fixture requires a user prompt');
    // A fire-and-forget alias exits before this awaited continuation completes.
    await new Promise(resolve => setTimeout(resolve, 150));
    const expected = process.env.BLACKBOX_FIXTURE_PHASE ?? 'blackbox-enum';
    const observed = {
      phase: expected,
      skillExpanded: event.prompt.includes(`<skill name="${expected}"`),
      scopeInjected: event.prompt.includes('<BLACKBOX_SCOPE>'),
      delegated: event.prompt.includes('Delegated by the Blackbox orchestrator'),
    };
    if (!observed.skillExpanded || !observed.scopeInjected) throw new Error('Fixture did not receive gated expanded skill');
    if (process.env.BLACKBOX_FIXTURE_MARKER) writeFileSync(process.env.BLACKBOX_FIXTURE_MARKER, JSON.stringify(observed));
    if (process.env.BLACKBOX_FIXTURE_REPORT) {
      if (!['blackbox-enum', 'blackbox-map'].includes(expected)) throw new Error('Unsupported fixture report phase');
      mkdirSync(join(process.cwd(), expected), { recursive: true });
      writeFileSync(join(process.cwd(), expected, 'report.md'), readFileSync(process.env.BLACKBOX_FIXTURE_REPORT));
    }
  });
  pi.registerProvider('blackbox-fixture', {
    api: 'blackbox-fixture-api',
    apiKey: 'fixture-only-not-a-real-key',
    baseUrl: 'https://example.invalid',
    models: [{ id: 'worker', name: 'Offline worker fixture', reasoning: false, input: ['text'],
      contextWindow: 128000, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple(model) {
      const stream = createAssistantMessageEventStream();
      const message: AssistantMessage = {
        role: 'assistant', api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(),
        content: [], stopReason: 'pending',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      };
      setTimeout(() => {
        stream.push({ type: 'start', partial: message });
        message.content = [{ type: 'text', text: 'Offline worker fixture completed.' }];
        stream.push({ type: 'text_start', contentIndex: 0, partial: message });
        stream.push({ type: 'text_end', contentIndex: 0, content: 'Offline worker fixture completed.', partial: message });
        message.stopReason = 'stop';
        stream.push({ type: 'done', reason: 'stop', message });
        stream.end();
      }, 100);
      return stream;
    },
  });
}
