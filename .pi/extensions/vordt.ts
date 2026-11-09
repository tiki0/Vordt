/**
 * Vordt — whitebox pentesting harness companion extension.
 *
 * Responsibilities:
 *  - /vordt-root <dir>   : set the project root for THIS session (must contain SCOPE.md).
 *    - `clear` / `none`  : clear the root for this session.
 *  - Gate /skill:<vordt skill> invocations: refuse to run unless a project root is set for
 *    this session and a valid SCOPE.md exists IN that root. On success, inject the root,
 *    scope-file, scope digest, and full SCOPE.md content into the invocation.
 *  - Show the project root (and SCOPE.md presence) in the bottom-left footer status line.
 *  - Deterministic helpers the pipeline can call directly (registered as tools):
 *      vordt_ids          — highest allocated FUNC/INPUT/VORDT id across reports+history.
 *      vordt_manifest     — UTC run id, git revision, and a file->SHA-256 inventory manifest.
 *      vordt_archive      — move <option>/report.md into <option>/history/<run-id>/.
 *      vordt_validate_report — check a report for the required shared-structure markers.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  readdirSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

const APP_NAME = "Vordt";
const SCOPE_FILE = "SCOPE.md";
const CONFIG_DIR = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
const CONFIG_FILE = join(CONFIG_DIR, "vordt.json");
const LOG_FILE = join(CONFIG_DIR, "vordt.log");
const MAX_SCOPE_BYTES = 512 * 1024;
const MAX_MANIFEST_FILES = 8000;
const DEFAULT_SESSION = "__default__";

/** Skills that belong to the Vordt pipeline and require SCOPE.md. */
const VORDT_SKILLS = [
  "scan-structure",
  "scan-surface",
  "scan-vulns",
  "exploit",
  "report",
] as const;

/** Widened membership check for the pipeline options. */
const VORDT_SKILLS_SET: ReadonlySet<string> = new Set(VORDT_SKILLS);

/** TypeBox enum of the five pipeline options, for tool parameters. */
const OPTION_ENUM = Type.Union([
  Type.Literal("scan-structure"),
  Type.Literal("scan-surface"),
  Type.Literal("scan-vulns"),
  Type.Literal("exploit"),
  Type.Literal("report"),
]);

/** TypeBox enum of the stable ID families. */
const ID_TYPE_ENUM = Type.Union([
  Type.Literal("FUNC"),
  Type.Literal("INPUT"),
  Type.Literal("VORDT"),
]);

interface VordtConfig {
  /** Session id -> project root. A root is scoped to the session that set it. */
  roots: Record<string, string>;
}

/** Used while /vordt-root or a skill gate is being evaluated (light busy guard). */
let currentRoot: string | null = null;

// ---------------------------------------------------------------------------
// Hash / log / config helpers
// ---------------------------------------------------------------------------

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function logDiagnostic(msg: string): void {
  try {
    mkdirSync(CONFIG_DIR, { recursive: true });
    appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`, "utf8");
  } catch {
    /* never let logging break the extension */
  }
}

/** UI notification where possible; durable log line otherwise (print/json modes). */
function notify(ctx: { hasUI: boolean }, msg: string, level: "info" | "warning" | "error"): void {
  if (ctx.hasUI) {
    try {
      (ctx as { ui?: { notify: (m: string, l: "info" | "warning" | "error") => void } }).ui?.notify?.(msg, level);
    } catch {
      logDiagnostic(`[${level}] ${msg}`);
    }
    return;
  }
  logDiagnostic(`[${level}] ${msg}`);
}

function loadConfig(): VordtConfig {
  try {
    const raw = readFileSync(CONFIG_FILE, "utf8");
    const p = JSON.parse(raw) as { roots?: Record<string, string>; root?: unknown };
    const roots: Record<string, string> =
      p && typeof p === "object" && typeof p.roots === "object" && p.roots
        ? { ...p.roots }
        : {};
    // Migrate the old single-root layout to the default session once.
    if (typeof p?.root === "string" && p.root.length > 0 && !roots[DEFAULT_SESSION]) {
      roots[DEFAULT_SESSION] = p.root;
    }
    return { roots };
  } catch {
    return { roots: {} };
  }
}

/** Atomically persist the config (write temp, then rename). */
function saveConfig(cfg: VordtConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  const tmp = `${CONFIG_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify({ roots: cfg.roots }, null, 2) + "\n", "utf8");
  renameSync(tmp, CONFIG_FILE);
}

function sessionKey(ctx: { sessionManager?: { getSessionId?: () => string | undefined } }): string {
  return ctx.sessionManager?.getSessionId?.() ?? DEFAULT_SESSION;
}

function rootForSession(ctx: { sessionManager?: { getSessionId?: () => string | undefined } }): string | null {
  return loadConfig().roots[sessionKey(ctx)] ?? null;
}

function setRootForSession(ctx: { sessionManager?: { getSessionId?: () => string | undefined } }, root: string): void {
  const cfg = loadConfig();
  cfg.roots[sessionKey(ctx)] = root;
  saveConfig(cfg); // throws on failure so state is only updated on success
}

function clearRootForSession(ctx: { sessionManager?: { getSessionId?: () => string | undefined } }): void {
  const cfg = loadConfig();
  delete cfg.roots[sessionKey(ctx)];
  saveConfig(cfg);
}

// ---------------------------------------------------------------------------
// Scope validation (single source of truth for the gate, /vordt-root, and display)
// ---------------------------------------------------------------------------

interface ScopeCheck {
  ok: boolean;
  reason?: string;
  content?: string;
  sha256?: string;
}

function checkScope(root: string): ScopeCheck {
  let st;
  try {
    st = lstatSync(root);
  } catch {
    return { ok: false, reason: `Project root is not readable: ${root}` };
  }
  if (st.isSymbolicLink() || !st.isDirectory()) {
    return { ok: false, reason: `Not a real directory: ${root}` };
  }

  const scopePath = join(root, SCOPE_FILE);
  let sst;
  try {
    sst = lstatSync(scopePath);
  } catch {
    return { ok: false, reason: `${SCOPE_FILE} not found in ${root}` };
  }
  if (sst.isSymbolicLink()) return { ok: false, reason: `${SCOPE_FILE} must be a regular file, not a symlink` };
  if (!sst.isFile()) return { ok: false, reason: `${SCOPE_FILE} is not a regular file` };
  if (sst.size === 0) return { ok: false, reason: `${SCOPE_FILE} is empty` };
  if (sst.size > MAX_SCOPE_BYTES) {
    return { ok: false, reason: `${SCOPE_FILE} exceeds the ${Math.round(MAX_SCOPE_BYTES / 1024)} KiB limit` };
  }

  let content: string;
  try {
    content = readFileSync(scopePath, "utf8");
  } catch {
    return { ok: false, reason: `Could not read ${scopePath}` };
  }
  if (!content.trim()) return { ok: false, reason: `${SCOPE_FILE} contains only whitespace` };

  return { ok: true, content, sha256: sha256(content) };
}

function scopeStatusText(root: string | null): string {
  if (!root) return `${APP_NAME} ⎈ no project root for this session — /vordt-root <dir>`;
  const check = checkScope(root);
  return `${APP_NAME} ⎈ ${displayPath(root)}${check.ok ? "" : `  ⚠ missing/invalid SCOPE.md`}`;
}

function displayPath(p: string): string {
  const home = process.env.HOME || process.env.USERPROFILE;
  if (home) {
    const rel = relative(home, p);
    const insideHome = rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
    if (insideHome) return rel === "" ? "~" : `~/${rel}`;
  }
  return p;
}

// ---------------------------------------------------------------------------
// Manifest / archive / id helpers (shared by the registered tools)
// ---------------------------------------------------------------------------

function utcRunId(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/** Options currently under the project root whose artifacts are generated by Vordt. */
function isVordtArtifact(root: string, absPath: string): boolean {
  const relP = relative(root, absPath);
  if (!relP || relP.startsWith("..") || isAbsolute(relP)) return true;
  const parts = relP.split(/[\\/]/);
  const top = parts[0];
  if (top === ".git" || top === "node_modules" || top === ".vordt") return true;
  if (VORDT_SKILLS_SET.has(top)) {
    // Exclude known generated Vordt artifacts under an option dir.
    if (parts.length === 2 && (parts[1] === "report.md" || parts[1] === "history" || parts[1] === "poc")) return true;
    if (parts[1] === "history" || parts[1] === "poc") return true;
  }
  return false;
}

function buildInventory(root: string): {
  runId: string;
  files: { path: string; sha256: string; bytes: number }[];
  gitCommit: string | null;
  dirty: string[] | null;
  manifestPath: string;
} {
  const runId = utcRunId();
  const files: { path: string; sha256: string; bytes: number }[] = [];

  const walk = (dir: string): void => {
    if (files.length >= MAX_MANIFEST_FILES) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (files.length >= MAX_MANIFEST_FILES) break;
      const abs = join(dir, ent.name);
      if (isVordtArtifact(root, abs)) continue;
      if (ent.isDirectory()) {
        walk(abs);
      } else if (ent.isFile()) {
        try {
          const buf = readFileSync(abs);
          files.push({
            path: relative(root, abs).split(/[\\/]/).join("/"),
            sha256: createHash("sha256").update(buf).digest("hex"),
            bytes: buf.length,
          });
        } catch {
          /* skip unreadable */
        }
      }
    }
  };
  walk(root);

  let gitCommit: string | null = null;
  let dirty: string[] | null = null;
  // stdio: ['ignore','pipe','ignore'] keeps git's stderr out of the parent's
  // terminal on probes of non-git targets (e.g. "fatal: not a git repository").
  try {
    gitCommit =
      execFileSync("git", ["-C", root, "rev-parse", "--short", "HEAD"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() || null;
  } catch {
    gitCommit = null;
  }
  if (gitCommit) {
    try {
      dirty = execFileSync("git", ["-C", root, "status", "--porcelain"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      })
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
    } catch {
      dirty = null;
    }
  }

  const manifest = {
    format: 1,
    runId,
    createdAt: new Date().toISOString(),
    root,
    gitCommit,
    dirty: dirty ?? undefined,
    scope: (() => {
      const c = checkScope(root);
      return c.ok ? { sha256: c.sha256 } : { sha256: null };
    })(),
    files,
  };

  const manifestPath = join(root, ".vordt", "manifests", `${runId}.json`);
  mkdirSync(join(root, ".vordt", "manifests"), { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

  return { runId, files, gitCommit, dirty, manifestPath };
}

function highestId(root: string, option: string, type: "FUNC" | "INPUT" | "VORDT"): {
  max: number;
  matches: number;
  filesScanned: number;
} {
  const pattern = new RegExp(`\\b(${type})-([0-9]+)\\b`, "g");
  let max = 0;
  let matches = 0;
  let filesScanned = 0;

  const scanFile = (file: string): void => {
    filesScanned++;
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      return;
    }
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      matches++;
      const n = parseInt(m[2], 10);
      if (n > max) max = n;
    }
  };

  const base = join(root, option);
  const report = join(base, "report.md");
  if (existsSync(report)) scanFile(report);

  const hist = join(base, "history");
  try {
    for (const run of readdirSync(hist)) {
      if (filesScanned > 2000) break;
      const h = join(hist, run, "report.md");
      if (existsSync(h)) scanFile(h);
    }
  } catch {
    /* no history */
  }

  return { max, matches, filesScanned };
}

function archiveReport(root: string, option: string, runId?: string): {
  ok: boolean;
  archived: boolean;
  destination?: string;
  reason?: string;
} {
  if (!VORDT_SKILLS_SET.has(option)) {
    return { ok: false, archived: false, reason: `Unknown option: ${option}` };
  }
  const report = join(root, option, "report.md");
  if (!existsSync(report)) {
    return { ok: false, archived: false, reason: `No existing report at ${relative(root, report)}` };
  }
  const id = runId ?? utcRunId();
  let dir = join(root, option, "history", id);
  let target = join(dir, "report.md");
  let n = 0;
  while (existsSync(target)) {
    n++;
    dir = join(root, option, "history", `${id}-${n}`);
    target = join(dir, "report.md");
  }
  mkdirSync(dir, { recursive: true });
  renameSync(report, target);
  return { ok: true, archived: true, destination: relative(root, target) };
}

function validateReport(root: string, option: string): string[] {
  const report = join(root, option, "report.md");
  if (!existsSync(report)) {
    return [`${option}/report.md does not exist`];
  }
  let text: string;
  try {
    text = readFileSync(report, "utf8");
  } catch {
    return [`${option}/report.md is not readable`];
  }
  const required = [
    "Run ID / UTC date",
    "Project root",
    "Coverage:",
    "## Handoff",
  ];
  if (option !== "report") {
    required.push("## Source manifest");
  }
  return required.filter((marker) => !text.includes(marker))
    .map((m) => `Missing expected marker: ${m}`);
}

// ---------------------------------------------------------------------------
// Extension body
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    currentRoot = rootForSession(ctx);
    // If a persisted root for this session is now invalid, surface it loudly.
    if (currentRoot) {
      const check = checkScope(currentRoot);
      if (!check.ok) {
        notify(ctx, `${APP_NAME}: persisted root invalid for this session — ${check.reason}`, "warning");
      }
    }
    if (ctx.hasUI) ctx.ui.setStatus("vordt-root", scopeStatusText(currentRoot));
  });

  // --- /vordt-root command -------------------------------------------------
  pi.registerCommand("vordt-root", {
    description: `Set/clear the ${APP_NAME} project root for this session (a directory containing ${SCOPE_FILE})`,
    getArgumentCompletions: (prefix: string) => {
      // Directory completion is handled by pi's built-in path autocomplete after the space.
      return null;
    },
    handler: async (args, ctx) => {
      const input = (args ?? "").trim();
      const key = sessionKey(ctx);

      if (input === "clear" || input === "none" || input === "") {
        const current = currentRoot ?? rootForSession(ctx);
        if (input === "" && current) {
          notify(ctx, `Current ${APP_NAME} root for this session: ${current}`, "info");
          return;
        }
        if (current) {
          try {
            clearRootForSession(ctx);
          } catch {
            notify(ctx, `Failed to clear ${APP_NAME} root for session ${key} — see log.`, "error");
            return;
          }
          currentRoot = null;
          if (ctx.hasUI) ctx.ui.setStatus("vordt-root", scopeStatusText(null));
          notify(ctx, `${APP_NAME} root cleared for this session.`, "info");
        }
        return;
      }

      const expanded =
        input === "~" ? homedir() : input.startsWith("~/") ? join(homedir(), input.slice(2)) : input;
      const abs = resolve(ctx.cwd, expanded);

      const check = checkScope(abs);
      if (!check.ok) {
        notify(ctx, check.reason ?? "unknown reason", "error");
        return;
      }

      if (ctx.isIdle && !ctx.isIdle()) {
        notify(ctx, `${APP_NAME} root is locked while a run is in progress. Try again when idle.`, "warning");
        return;
      }

      try {
        setRootForSession(ctx, abs); // persists before we commit the in-memory change
      } catch {
        notify(ctx, `Could not persist ${APP_NAME} root (${abs}). No change was made.`, "error");
        return;
      }
      currentRoot = abs;
      if (ctx.hasUI) {
        ctx.ui.setStatus("vordt-root", scopeStatusText(abs));
        ctx.ui.notify(`${APP_NAME} root set for this session: ${abs}`, "info");
      }
    },
  });

  // --- Gate + scope injection for Vordt skill invocations ------------------
  pi.on("input", async (event, ctx) => {
    // Extension commands are checked before this handler, so only skill/text reaches us here.
    const match = event.text.match(/^\/skill:([^\s]+)/);
    if (!match) return { action: "continue" };
    const skill = match[1];
    if (!VORDT_SKILLS_SET.has(skill)) return { action: "continue" }; // not a Vordt skill

    const root = rootForSession(ctx) ?? currentRoot;
    currentRoot = root;

    if (!root) {
      notify(
        ctx,
        `No ${APP_NAME} project root set for this session. Run /vordt-root <dir> (with ${SCOPE_FILE} inside) first.`,
        "error",
      );
      return { action: "handled" };
    }

    const check = checkScope(root);
    if (!check.ok) {
      if (ctx.hasUI) ctx.ui.setStatus("vordt-root", scopeStatusText(root));
      notify(ctx, check.reason ?? "unknown reason", "error");
      return { action: "handled" };
    }

    // A literal space after the skill name keeps pi's /skill: parser from swallowing
    // the injected block as part of the skill name (it splits on the first space).
    const injected =
      `${event.text} <VORDT_SCOPE>` +
      `\nproject-root: ${root}` +
      `\nscope-file: ${join(root, SCOPE_FILE)}` +
      `\nscope-sha256: ${check.sha256}` +
      `\n\n${check.content}\n` +
      `</VORDT_SCOPE>`;

    return { action: "transform", text: injected };
  });

  // --- Deterministic helpers (callable directly by the pipeline) ----------
  const rootParam = Type.Optional(Type.String({ description: "Project root. Defaults to the current Vordt root." }));

  pi.registerTool({
    name: "vordt_ids",
    label: "Vordt: highest allocated ID",
    description:
      "Return the highest already-allocated FUNC/INPUT/VORDT numeric id for an option, across report.md and history/.",
    promptSnippet: "Ask vordt_ids for the next free FUNC/INPUT/VORDT id before assigning one.",
    promptGuidelines: [
      "Use vordt_ids before assigning a new FUNC-/, INPUT-/, or VORDT- id so stable IDs are never reused.",
    ],
    parameters: Type.Object({
      option: OPTION_ENUM,
      type: ID_TYPE_ENUM,
      root: rootParam,
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const root = params.root ?? currentRoot;
      if (!root) {
        return { content: [{ type: "text", text: "No Vordt project root set. Run /vordt-root <dir> first." }], details: {} };
      }
      const c = checkScope(root);
      if (!c.ok) {
        return { content: [{ type: "text", text: `Invalid project root: ${c.reason ?? "unknown"}` }], details: { error: c.reason } };
      }
      const res = highestId(root, params.option, params.type);
      return {
        content: [
          {
            type: "text",
            text:
              `Highest ${params.type} id in ${params.option}: ${res.max} ` +
              `(${res.matches} matches across ${res.filesScanned} report files). ` +
              `Next id: ${params.type}-${String(res.max + 1).padStart(3, "0")}.`,
          },
        ],
        details: res,
      };
    },
  });

  pi.registerTool({
    name: "vordt_manifest",
    label: "Vordt: source manifest snapshot",
    description:
      "Write a UTC run-id, git revision, dirty status, SCOPE digest, and per-file SHA-256 inventory to .vordt/manifests/<run-id>.json.",
    promptSnippet: "Ask vordt_manifest for a run id and source snapshot at the start of a pass.",
    promptGuidelines: [
      "Ask vordt_manifest at the start of each pass to record the run id, git revision, SOURCE digest, and file inventory.",
    ],
    parameters: Type.Object({ root: rootParam }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const root = params.root ?? currentRoot;
      if (!root) return { content: [{ type: "text", text: "No Vordt project root set. Run /vordt-root <dir> first." }], details: {} };
      const c = checkScope(root);
      if (!c.ok) return { content: [{ type: "text", text: `Invalid project root: ${c.reason ?? "unknown"}` }], details: { error: c.reason } };
      const inv = buildInventory(root);
      return {
        content: [
          {
            type: "text",
            text:
              `Run id: ${inv.runId}\n` +
              `Git commit: ${inv.gitCommit ?? "non-git"}\n` +
              `Dirty files: ${inv.dirty ? inv.dirty.length : "unknown"}\n` +
              `Files hashed: ${inv.files.length}\n` +
              `Manifest: ${relative(root, inv.manifestPath)}`,
          },
        ],
        details: { runId: inv.runId, files: inv.files.length, manifestPath: inv.manifestPath },
      };
    },
  });

  pi.registerTool({
    name: "vordt_archive",
    label: "Vordt: archive a previous report",
    description:
      "Move <root>/<option>/report.md into <root>/<option>/history/<run-id>/report.md before writing a new one.",
    promptSnippet: "Use vordt_archive to preserve a prior report before replacing it.",
    promptGuidelines: [
      "Use vordt_archive to preserve any existing report at <option>/report.md before writing a new one.",
    ],
    parameters: Type.Object({ option: OPTION_ENUM, root: rootParam, runId: Type.Optional(Type.String()) }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const root = params.root ?? currentRoot;
      if (!root) return { content: [{ type: "text", text: "No Vordt project root set. Run /vordt-root <dir> first." }], details: {} };
      const c = checkScope(root);
      if (!c.ok) return { content: [{ type: "text", text: `Invalid project root: ${c.reason ?? "unknown"}` }], details: { error: c.reason } };
      const res = archiveReport(root, params.option, params.runId ?? undefined);
      return {
        content: [
          {
            type: "text",
            text: res.archived
              ? `Archived prior ${params.option} report to ${res.destination}.`
              : `${res.reason ?? "Nothing archived"}`,
          },
        ],
        details: { ok: res.ok, archived: res.archived, reason: res.reason, destination: res.destination },
      };
    },
  });

  pi.registerTool({
    name: "vordt_validate_report",
    label: "Vordt: check a report for required structure",
    description:
      "Check <root>/<option>/report.md for the shared required markers (header, coverage, handoff, source manifest).",
    promptSnippet: "Ask vordt_validate_report before finalizing a report.",
    promptGuidelines: [
      "Use vordt_validate_report before finalizing a report to confirm the shared required sections are present.",
    ],
    parameters: Type.Object({ option: OPTION_ENUM, root: rootParam }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const root = params.root ?? currentRoot;
      if (!root) return { content: [{ type: "text", text: "No Vordt project root set. Run /vordt-root <dir> first." }], details: {} };
      const c = checkScope(root);
      if (!c.ok) return { content: [{ type: "text", text: `Invalid project root: ${c.reason ?? "unknown"}` }], details: { error: c.reason } };
      const issues = validateReport(root, params.option);
      return {
        content: [
          {
            type: "text",
            text: issues.length ? `Issues:\n- ${issues.join("\n- ")}` : `${params.option}/report.md is structurally complete.`,
          },
        ],
        details: { issues },
      };
    },
  });
}

// Named exports of the pure helpers so the test suite can exercise them directly.
// The extension loader only uses the default export, so these are inert in Pi.
export {
  checkScope,
  archiveReport,
  buildInventory,
  highestId,
  validateReport,
  utcRunId,
};