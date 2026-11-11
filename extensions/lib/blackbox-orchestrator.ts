/** Sequential phase workers: isolated Pi contexts, not OS/network sandboxes. */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmdirSync } from "node:fs";
import { basename, join } from "node:path";
import { createHash } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import {
  OPTIONS, checkScope, ensureDirs, publish, readBounded, safePath, utcRunId, validateReport,
  type Option, type WorkerScope,
} from "../blackbox.ts";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const reason = (error: unknown) => error instanceof Error ? error.message : String(error);
const phase = (name: string): Option => {
  const value = name.startsWith("blackbox-") ? name : `blackbox-${name}`;
  if (!(OPTIONS as readonly string[]).includes(value)) throw new Error(`Unknown phase: ${name}`);
  return value as Option;
};
export interface Plan { phases: Option[]; focus: string; timeoutSeconds: number; }
export function parsePlan(args: string): Plan {
  let from: Option = "blackbox-enum", through: Option = "blackbox-map", withPoc = false, timeoutSeconds = 1800;
  let rest = args.trim();
  const seen = new Set<string>();
  while (rest.startsWith("--")) {
    const match = rest.match(/^(\S+)(?:\s+|$)/)!;
    const flag = match[1];
    rest = rest.slice(match[0].length);
    const key = flag.split("=")[0];
    if (seen.has(key)) throw new Error(`Duplicate option: ${key}`);
    seen.add(key);
    if (flag.startsWith("--from=")) from = phase(flag.slice(7));
    else if (flag.startsWith("--through=")) through = phase(flag.slice(10));
    else if (flag === "--with-poc") withPoc = true;
    else if (/^--timeout=\d+$/.test(flag)) timeoutSeconds = Number(flag.slice(10));
    else throw new Error(`Unknown option ${flag}; use --from=enum|map|vulns|poc|report, --through=..., --with-poc, --timeout=seconds`);
  }
  if (!rest || rest.length > 8000) throw new Error("Supply a non-secret target/focus (1–8000 characters)");
  if (/<\/?BLACKBOX_SCOPE\b/.test(rest)) throw new Error("Scope delimiters are not permitted in focus");
  if (!Number.isSafeInteger(timeoutSeconds) || timeoutSeconds < 10 || timeoutSeconds > 7200) throw new Error("Worker timeout must be 10–7200 seconds");
  const start = OPTIONS.indexOf(from), end = OPTIONS.indexOf(through);
  if (start > end) throw new Error("--from must not follow --through");
  if ((from === "blackbox-poc" || through === "blackbox-poc") && !withPoc) throw new Error("PoC delegation requires explicit --with-poc");
  if (withPoc && (start > 3 || end < 3)) throw new Error("--with-poc requires a plan containing the poc phase");
  return { phases: OPTIONS.slice(start, end + 1).filter(x => x !== "blackbox-poc" || withPoc), focus: rest, timeoutSeconds };
}

export interface WorkerRequest {
  root: string; scopeSha256: string; phase: Option; focus: string; repo: string;
  model?: string; thinking?: string; timeoutSeconds: number;
}
export interface ProcessResult {
  exitCode: number; assistantSeen: boolean; failure?: string;
  diagnostics?: { agentStarted: boolean; jsonRecords: number; stdoutBytes: number; stderrBytes: number };
}
export interface Invocation { command: string; args: string[]; }
export function piInvocation(args: string[]): Invocation {
  // Same runtime selection as Pi's official subagent example; never invoke a shell.
  const script = process.argv[1];
  if (script && !script.startsWith("/$bunfs/root/") && existsSync(script)) return { command: process.execPath, args: [script, ...args] };
  return /^(node|bun)(\.exe)?$/i.test(basename(process.execPath)) ? { command: "pi", args } : { command: process.execPath, args };
}
export function workerArgs(request: WorkerRequest): string[] {
  const args = ["--mode", "json", "--print", "--no-session", "--no-extensions", "--no-skills",
    "--no-context-files", "--no-prompt-templates", "--no-mcp", "--no-approve",
    "--extension", join(request.repo, "extensions/lib/blackbox-worker.ts"),
    "--skill", join(request.repo, "skills", request.phase, "SKILL.md"),
    "--tools", "read,bash,edit,write,blackbox_ids,blackbox_manifest,blackbox_archive,blackbox_validate_report"];
  if (request.model) args.push("--model", request.model);
  if (request.thinking) args.push("--thinking", request.thinking);
  args.push("--", `/${request.phase} ${request.focus}\n\nDelegated by the Blackbox orchestrator. Perform only this phase. Read its bundled workflow and relevant upstream reports from disk. Never delegate or invoke another phase. If authorization, operational limits, inputs, or accounts are unclear, stop with a blocked report after accepting valid scope; do not guess or wait for interactive input. Preserve prior reports. Record exact coverage and validate the report before finishing.`);
  return args;
}

/** Discard raw JSON/tool output rather than persist potentially secret-bearing transcripts.
 * Bound stdout/stderr/line memory; report metadata and sanitized evidence stay on disk.
 */
export async function runWorkerProcess(invocation: Invocation, cwd: string, env: NodeJS.ProcessEnv,
  timeoutSeconds: number, signal?: AbortSignal): Promise<ProcessResult> {
  signal?.throwIfAborted();
  return new Promise(resolve => {
    let assistantSeen = false, failure: string | undefined, pending = "", bytes = 0;
    let startupHint: string | undefined, stderrTail = "";
    const stdoutDecoder = new StringDecoder("utf8"), stderrDecoder = new StringDecoder("utf8");
    const diagnostics = { agentStarted: false, jsonRecords: 0, stdoutBytes: 0, stderrBytes: 0 };
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const proc = spawn(invocation.command, invocation.args, { cwd, env, shell: false,
      detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    const kill = (sig: NodeJS.Signals) => {
      try {
        if (process.platform !== "win32" && proc.pid) process.kill(-proc.pid, sig);
        else proc.kill(sig);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") proc.kill(sig); }
    };
    const stop = (message: string) => {
      if (failure) return;
      failure = message;
      kill("SIGTERM");
      killTimer = setTimeout(() => kill("SIGKILL"), 3000);
    };
    const abort = () => stop("Worker cancelled");
    const timeout = setTimeout(() => stop("Worker timeout reached"), timeoutSeconds * 1000);
    const line = (value: string) => {
      if (!value.trim()) return;
      try {
        const event = JSON.parse(value);
        diagnostics.jsonRecords++;
        if (event?.type === "agent_start") diagnostics.agentStarted = true;
        if (event.type === "message_end" && event.message?.role === "assistant") {
          assistantSeen = true;
          if (["error", "aborted"].includes(event.message.stopReason)) stop("Worker model failed or aborted");
        }
        if (event.type === "message_end" && event.message?.customType === "blackbox-diagnostic" && event.message?.details?.level === "error") stop("Worker scope/command gate failed");
      } catch { /* Ignore nonprotocol lines; never echo them into a parent prompt. */ }
    };
    proc.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      diagnostics.stdoutBytes += chunk.length;
      if (bytes > 32 * 1024 * 1024) { stop("Worker output budget exceeded"); return; }
      pending += stdoutDecoder.write(chunk);
      if (Buffer.byteLength(pending) > 2 * 1024 * 1024) { pending = ""; stop("Worker JSON line budget exceeded"); return; }
      const lines = pending.split("\n"); pending = lines.pop() ?? "";
      for (const item of lines) line(item);
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      diagnostics.stderrBytes += chunk.length;
      // Keep only a bounded in-memory tail for allowlisted classifications, never raw logs.
      stderrTail = (stderrTail + stderrDecoder.write(chunk)).slice(-8192);
      if (/No API key found|Authentication failed for|No credentials|credentials (?:have )?expired/i.test(stderrTail)) {
        startupHint = "Worker authentication failed; check the inherited provider's credentials or re-authenticate in Pi";
      } else if (/No model selected|Unknown model|Model [^\n]{0,200}not found|Could not resolve model/i.test(stderrTail)) {
        startupHint ??= "Worker model selection failed; check that the inherited model is available without other extensions";
      } else if (/Failed to load extension|Extension error [^\n]{0,200}send_user_message/i.test(stderrTail)) {
        startupHint ??= "Worker extension loading or prompt dispatch failed; check the installation and command routing";
      }
      if (bytes > 32 * 1024 * 1024) stop("Worker output budget exceeded");
    });
    proc.on("error", () => { failure ??= "Unable to spawn Pi worker; check Pi installation and credentials"; });
    proc.on("close", code => {
      pending += stdoutDecoder.end();
      if (pending) line(pending);
      clearTimeout(timeout); clearTimeout(killTimer);
      signal?.removeEventListener("abort", abort);
      if (failure) kill("SIGKILL"); // Also reap surviving POSIX process-group descendants.
      const exitCode = code ?? 1;
      if (!assistantSeen && !failure) {
        failure = startupHint ?? (diagnostics.agentStarted
          ? `Worker started but produced no completed assistant response (exit ${exitCode}); inspect model/authentication or JSON protocol handling`
          : `Worker exited before starting an agent run (exit ${exitCode}); check prompt/alias dispatch or startup configuration, not target behavior`);
      }
      resolve({ exitCode, assistantSeen, failure, diagnostics });
    });
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}
export async function runWorker(request: WorkerRequest, signal?: AbortSignal): Promise<ProcessResult> {
  const scope: WorkerScope = { root: request.root, sha256: request.scopeSha256 };
  return runWorkerProcess(piInvocation(workerArgs(request)), request.root,
    { ...process.env, BLACKBOX_WORKER_SCOPE: JSON.stringify(scope) }, request.timeoutSeconds, signal);
}

const upstream: Record<Option, Option[]> = {
  "blackbox-enum": [], "blackbox-map": ["blackbox-enum"],
  "blackbox-vulns": ["blackbox-enum", "blackbox-map"],
  "blackbox-poc": ["blackbox-enum", "blackbox-map", "blackbox-vulns"],
  "blackbox-report": ["blackbox-enum", "blackbox-map", "blackbox-vulns"],
};
function checkedReport(root: string, option: Option) {
  const issues = validateReport(root, option);
  if (issues.length) throw new Error(`${option} report failed structure checks: ${issues.slice(0, 3).join("; ")}`);
  const text = readBounded(root, `${option}/report.md`);
  const header = text.split(/^## /m)[0];
  const coverage = header.match(/^- \*\*Coverage:\*\* (.+)$/m)?.[1].trim();
  const runId = header.match(/^- \*\*Run ID \/ UTC date:\*\* (.+)$/m)?.[1].trim();
  return { path: `${option}/report.md`, runId, coverage, sha256: sha(text) };
}
export interface OrchestrationResult {
  runId: string; statePath: string; status: "running" | "complete" | "stopped";
  phases: { phase: Option; status: "running" | "complete" | "stopped"; report?: ReturnType<typeof checkedReport>; worker?: ProcessResult }[];
  error?: string;
}
export async function executePlan(request: Omit<WorkerRequest, "phase" | "focus" | "timeoutSeconds">,
  plan: Plan, signal?: AbortSignal, update?: (state: OrchestrationResult) => void,
  dispatch: typeof runWorker = runWorker): Promise<OrchestrationResult> {
  signal?.throwIfAborted();
  if (checkScope(request.root).sha256 !== request.scopeSha256) throw new Error("Scope changed before orchestration");
  ensureDirs(request.root, ".blackbox");
  const lock = safePath(request.root, ".blackbox/orchestrator.lock");
  try { mkdirSync(lock, { mode: 0o700 }); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("An orchestrator already owns this root; inspect abandoned locks manually");
    throw error;
  }
  const runId = utcRunId();
  const state: OrchestrationResult = { runId, statePath: `.blackbox/orchestrations/${runId}/state.json`, status: "running", phases: [] };
  const save = () => {
    publish(request.root, state.statePath, JSON.stringify({ ...state, root: request.root, scopeSha256: request.scopeSha256,
      plan, model: request.model, thinking: request.thinking, updatedAt: new Date().toISOString() }, null, 2) + "\n", true);
    update?.(structuredClone(state));
  };
  try {
    save();
    for (const option of plan.phases) {
      signal?.throwIfAborted();
      if (checkScope(request.root).sha256 !== request.scopeSha256) throw new Error("Scope changed during orchestration");
      for (const dependency of upstream[option]) {
        const report = checkedReport(request.root, dependency);
        if (report.coverage !== "complete") throw new Error(`${dependency} coverage is ${report.coverage}; refresh upstream before ${option}`);
      }
      const rel = `${option}/report.md`;
      const previous = existsSync(safePath(request.root, rel)) ? readBounded(request.root, rel) : undefined;
      const before = previous === undefined ? undefined : sha(previous);
      const previousRunId = previous?.split(/^## /m)[0].match(/^- \*\*Run ID \/ UTC date:\*\* (.+)$/m)?.[1].trim();
      const step: OrchestrationResult["phases"][number] = { phase: option, status: "running" };
      state.phases.push(step); save();
      const result = await dispatch({ ...request, phase: option, focus: plan.focus, timeoutSeconds: plan.timeoutSeconds }, signal);
      step.worker = result;
      signal?.throwIfAborted();
      if (checkScope(request.root).sha256 !== request.scopeSha256) throw new Error("Scope changed during worker execution");
      if (result.failure || result.exitCode !== 0 || !result.assistantSeen) throw new Error(result.failure ?? `${option} worker failed (exit ${result.exitCode}, assistant=${result.assistantSeen}); inspect phase artifacts and model configuration`);
      step.report = checkedReport(request.root, option);
      if (step.report.sha256 === before || step.report.runId === previousRunId) throw new Error(`${option} did not publish a new report/run ID`);
      if (step.report.coverage !== "complete") throw new Error(`${option} coverage is ${step.report.coverage}; orchestration stopped for review`);
      step.status = "complete"; save();
    }
    state.status = "complete";
  } catch (error) {
    state.status = "stopped"; state.error = reason(error).slice(0, 2000);
    const active = state.phases.at(-1);
    if (active?.status === "running") active.status = "stopped";
  } finally {
    try { save(); } finally { rmdirSync(lock); }
  }
  return state;
}

interface Services {
  requireRoot: (ctx: ExtensionContext) => string;
  diagnostic: (ctx: ExtensionContext, message: string, level?: "info" | "warning" | "error") => void;
  repo: string;
}
export function registerOrchestrator(pi: ExtensionAPI, services: Services) {
  const grants = new Map<string, { root: string; digest: string; plan: Plan }>();
  const key = (ctx: ExtensionContext) => JSON.stringify([ctx.sessionManager.getSessionId(), ctx.cwd]);
  pi.registerCommand("blackbox-orchestrate", {
    description: "Delegate sequential Blackbox phases. Default enum→map; --through=report [--with-poc], --from=phase, --timeout=seconds",
    handler: async (args, ctx) => {
      try {
        if (!ctx.isIdle()) throw new Error("Wait for the current run before orchestrating");
        const root = services.requireRoot(ctx), scope = checkScope(root), plan = parsePlan(args);
        grants.set(key(ctx), { root, digest: scope.sha256, plan });
        pi.sendUserMessage(`/skill:blackbox-orchestrate ${plan.focus}`, { expandPromptTemplates: true });
      } catch (error) { services.diagnostic(ctx, reason(error)); }
    },
  });
  pi.on("input", async (event, ctx) => {
    if (!/^\/skill:blackbox-orchestrate(?:\s|$)/.test(event.text)) return { action: "continue" };
    try {
      const grant = grants.get(key(ctx));
      if (!grant || services.requireRoot(ctx) !== grant.root || checkScope(grant.root).sha256 !== grant.digest) throw new Error("Start orchestration explicitly with /blackbox-orchestrate [options] <target/focus>");
      const scope = checkScope(grant.root);
      if (/<\/?BLACKBOX_SCOPE\b/.test(scope.content)) throw new Error("Ambiguous scope delimiter");
      return { action: "transform", text: `/skill:blackbox-orchestrate ${grant.plan.focus}\n\nApproved phase plan: ${grant.plan.phases.map(x => `/${x}`).join(" → ")}. Worker timeout: ${grant.plan.timeoutSeconds}s.\n<BLACKBOX_SCOPE>\nproject-root: ${grant.root}\nscope-file: ${join(grant.root, "SCOPE.md")}\nscope-sha256: ${scope.sha256}\n\n${scope.content}\n</BLACKBOX_SCOPE>` };
    } catch (error) { services.diagnostic(ctx, reason(error)); return { action: "handled" }; }
  });
  pi.on("agent_settled", async (_event, ctx) => { grants.delete(key(ctx)); });
  pi.registerTool({
    name: "blackbox_orchestrate", label: "Blackbox: orchestrate phase subagents", executionMode: "sequential",
    description: "Consume the human-approved /blackbox-orchestrate plan once. Spawn one isolated Pi worker per phase using literal /blackbox-* commands. Stop on failed, blocked, partial, missing or invalid reports. No model-selected expansion or PoC opt-in.",
    parameters: Type.Object({}, { additionalProperties: false }),
    async execute(_id, _params, signal, onUpdate, ctx) {
      const grant = grants.get(key(ctx)); grants.delete(key(ctx));
      if (!grant || services.requireRoot(ctx) !== grant.root || checkScope(grant.root).sha256 !== grant.digest) throw new Error("No current human-approved orchestration plan; use /blackbox-orchestrate");
      const state = await executePlan({ root: grant.root, scopeSha256: grant.digest, repo: services.repo,
        model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined, thinking: ctx.thinkingLevel }, grant.plan, signal,
      value => onUpdate?.({ content: [{ type: "text", text: `Orchestration ${value.status}: ${value.phases.map(x => `${x.phase}=${x.status}`).join(", ")}\n${value.statePath}` }], details: value }));
      return { content: [{ type: "text", text: `${state.status}: ${state.phases.map(x => `${x.phase}=${x.status}`).join(", ")}\nState: ${state.statePath}${state.error ? `\nStopped: ${state.error}` : ""}\nRead the phase reports and handoffs; structural success is not evidence correctness.` }], details: state, isError: state.status !== "complete" };
    },
  });
}
