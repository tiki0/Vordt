/** Blackbox: Vordt-derived session-root gating and contained assessment bookkeeping.
 * Network activity and phase restrictions are agent workflow rules, not enforced here.
 * These checks are not an OS sandbox. Do not run against a concurrently hostile filesystem.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import {
  constants, closeSync, fsyncSync, fstatSync, lstatSync, mkdirSync, openSync,
  readSync, realpathSync, renameSync, unlinkSync, writeFileSync, linkSync, rmdirSync, readdirSync,
} from "node:fs";
import { open, readdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const OPTIONS = ["blackbox-enum", "blackbox-map", "blackbox-vulns", "blackbox-poc", "blackbox-report"] as const;
export type Option = typeof OPTIONS[number];
export type Family = "FUNC" | "ASSET" | "BLACKBOX";
const optionSchema = Type.Union(OPTIONS.map(x => Type.Literal(x)));
const familySchema = Type.Union([Type.Literal("FUNC"), Type.Literal("ASSET"), Type.Literal("BLACKBOX")]);
const MAX_SCOPE = 512 * 1024;
const MAX_REPORT = 16 * 1024 * 1024;
const exec = promisify(execFile);
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const code = (error: unknown) => (error as NodeJS.ErrnoException).code;

function statOrMissing(path: string) {
  try { return lstatSync(path); } catch (error) {
    if (code(error) === "ENOENT") return undefined;
    throw error;
  }
}

/** Canonical root; callers persist this value, never an unvalidated path alias. */
export function canonicalRoot(path: string): string {
  if (!isAbsolute(path)) throw new Error("Project root must be absolute");
  const root = realpathSync(path);
  if (/[\u0000-\u001f\u007f]/.test(root)) throw new Error("Control characters are not permitted in the project root");
  if (!lstatSync(root).isDirectory()) throw new Error("Project root is not a directory");
  return root;
}

/** Reject traversal, symlinks (including dangling ones), and non-directory ancestors.
 * Missing suffixes are allowed for new artifacts. Root must already be canonical.
 */
export function safePath(root: string, rel: string): string {
  if (typeof rel !== "string" || !rel || isAbsolute(rel) || rel.includes("\\") || rel.includes("\0")) {
    throw new Error("Expected a project-relative path");
  }
  if (rel.split("/").includes("..")) throw new Error("Path traversal is not permitted");
  const target = resolve(root, rel);
  const diff = relative(root, target);
  if (diff === ".." || diff.startsWith(`..${sep}`) || isAbsolute(diff)) throw new Error("Path escapes project root");
  let current = root;
  const parts = diff ? diff.split(sep) : [];
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i]);
    const st = statOrMissing(current);
    if (!st) continue;
    if (st.isSymbolicLink()) throw new Error(`Symlink path rejected: ${rel}`);
    if (i < parts.length - 1 && !st.isDirectory()) throw new Error(`Not a directory: ${rel}`);
  }
  return target;
}

export function ensureDirs(root: string, rel: string): string {
  const target = safePath(root, rel);
  let current = root;
  for (const part of relative(root, target).split(sep).filter(Boolean)) {
    current = join(current, part);
    if (!statOrMissing(current)) mkdirSync(current, { mode: 0o700 });
    safePath(root, relative(root, current));
    if (!lstatSync(current).isDirectory()) throw new Error("Artifact parent is not a directory");
  }
  return target;
}

/** Bounded, no-follow read. Check the opened descriptor, not just a preceding stat. */
export function readBounded(root: string, rel: string, max = MAX_REPORT): string {
  const path = safePath(root, rel);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    // Read at most max+1 bytes even if the file grows after opening.
    const st = fstatSync(fd);
    if (!st.isFile() || st.size > max) throw new Error(`Not a regular file or exceeds size limit: ${rel}`);
    const buffer = Buffer.alloc(Math.min(max + 1, st.size + 1));
    let size = 0;
    while (size < buffer.length) {
      const n = readSync(fd, buffer, size, buffer.length - size, null);
      if (!n) break;
      size += n;
    }
    if (size > max || size > st.size) throw new Error(`File grew while reading: ${rel}`);
    const after = fstatSync(fd);
    if (after.size !== st.size || after.mtimeMs !== st.mtimeMs || after.ctimeMs !== st.ctimeMs) throw new Error(`File changed while reading: ${rel}`);
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, size));
  } finally { closeSync(fd); }
}

export function checkScope(root: string) {
  const canonical = canonicalRoot(root);
  if (canonical !== root) throw new Error("Root must be canonical; select it again with /blackbox-root");
  const content = readBounded(root, "SCOPE.md", MAX_SCOPE);
  if (!content.trim()) throw new Error("SCOPE.md is empty or whitespace-only");
  return { content, sha256: hash(content) };
}

export function utcRunId(): string {
  return `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`;
}
function safeId(id: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(id)) throw new Error("Invalid run ID: use letters, digits, underscores or hyphens");
  return id;
}
function assertOption(option: string): asserts option is Option {
  if (!(OPTIONS as readonly string[]).includes(option)) throw new Error("Unknown pipeline option");
}

/** Same-directory temp + fsync + link gives atomic, exclusive publication; rename
 * replaces only private state while holding its lock. Never overwrite evidence.
 */
export function publish(root: string, rel: string, text: string, replace = false) {
  const target = safePath(root, rel);
  const parent = relative(root, dirname(target)) || ".";
  ensureDirs(root, parent);
  const tempRel = `${parent}/.blackbox-tmp-${randomUUID()}`;
  const temp = safePath(root, tempRel);
  const fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    try { writeFileSync(fd, text, "utf8"); fsyncSync(fd); } finally { closeSync(fd); }
    safePath(root, rel);
    if (replace) renameSync(temp, target);
    else linkSync(temp, target); // EEXIST includes dangling symlinks
  } finally { if (statOrMissing(temp)) unlinkSync(temp); }
}
function lock<T>(root: string, rel: string, fn: () => T): T {
  const path = safePath(root, rel);
  ensureDirs(root, relative(root, dirname(path)) || ".");
  try { mkdirSync(path, { mode: 0o700 }); } catch (error) {
    if (code(error) === "EEXIST") throw new Error(`Bookkeeping is locked (${rel}). Retry; inspect abandoned locks manually after a crash.`);
    throw error;
  }
  try { return fn(); } finally { rmdirSync(path); }
}

export const HEADER_FIELDS = [
  "Run ID / UTC date", "Project root", "Target", "Observation window", "Scope", "Focus",
  "Upstream reports consumed", "Coverage", "Reviewed areas", "Excluded/unreviewed areas", "Limitations", "Summary",
];
export const HANDOFF_FIELDS = ["Key facts and stable IDs", "Evidence locations", "Unresolved questions", "Recommended next actions"];
const PASS_SECTIONS: Record<Option, string[]> = {
  "blackbox-enum": ["Enumeration summary", "Coverage inventory", "Accessible assets"],
  "blackbox-map": ["Functionality coverage", "Functionality inventory"],
  "blackbox-vulns": ["Triage summary", "Candidate findings", "Rejected candidates"],
  "blackbox-poc": ["Attempt summary", "Attempts"],
  "blackbox-report": ["Executive summary", "Findings", "Remediation summary", "Appendix"],
};
function fields(text: string) {
  const result = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:-\s+)?\*\*([^*]+):\*\*\s*(.*)$/);
    if (m) {
      if (result.has(m[1])) throw new Error(`Duplicate report field: ${m[1]}`);
      result.set(m[1], m[2].trim());
    }
  }
  return result;
}
const placeholder = (s: string) => !s || /^<.*>$/.test(s) || /^(?:TODO|TBD|\.\.\.)$/i.test(s);
export function validateReport(root: string, option: string): string[] {
  assertOption(option);
  const text = readBounded(root, `${option}/report.md`);
  const issues: string[] = [];
  // Fenced examples must not satisfy real report structure.
  const body = text.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, "");
  if (!body.startsWith(`# ${option} report\n`) && !body.startsWith(`# ${option} report\r\n`)) issues.push("Missing canonical report title");
  const firstSection = body.search(/^## /m);
  const header = fields(firstSection < 0 ? body : body.slice(0, firstSection));
  for (const name of HEADER_FIELDS) if (placeholder(header.get(name) ?? "")) issues.push(`Missing or empty header: ${name}`);
  if (!/^(complete|partial|blocked)$/.test(header.get("Coverage") ?? "")) issues.push("Invalid Coverage (complete | partial | blocked)");
  if (header.has("Project root") && header.get("Project root") !== root) issues.push("Project root does not match session root");
  const runId = header.get("Run ID / UTC date");
  if (runId) { try { safeId(runId); } catch { issues.push("Invalid run ID"); } }
  if (!/SCOPE\.md.*SHA-256\s+[a-f0-9]{64}\b/i.test(header.get("Scope") ?? "")) issues.push("Missing scope SHA-256");
  else if (!header.get("Scope")!.includes(checkScope(root).sha256)) issues.push("Scope digest does not match current SCOPE.md");
  const required = header.get("Coverage") === "blocked" ? [] : PASS_SECTIONS[option];
  for (const section of [...required, "Evidence manifest", "Handoff"]) {
    const lines = body.split(/\r?\n/);
    const indices = lines.flatMap((line, i) => line === `## ${section}` ? [i] : []);
    if (indices.length !== 1) { issues.push(`Expected exactly one ## ${section}`); continue; }
    const start = indices[0] + 1;
    const next = lines.findIndex((line, i) => i >= start && /^## /.test(line));
    const sectionBody = lines.slice(start, next < 0 ? undefined : next).join("\n").trim();
    if (placeholder(sectionBody)) issues.push(`Empty or placeholder section: ${section}`);
    if (section === "Handoff") {
      const handoff = fields(sectionBody);
      for (const name of HANDOFF_FIELDS) if (placeholder(handoff.get(name) ?? "")) issues.push(`Missing handoff field: ${name}`);
      if (next >= 0) issues.push("Handoff must be the final section");
    }
  }
  return issues;
}

export function archiveReport(root: string, option: string) {
  assertOption(option);
  return lock(root, `.blackbox/${option}-archive.lock`, () => {
    const rel = `${option}/report.md`;
    if (!statOrMissing(safePath(root, rel))) return { archived: false, reason: "No previous report" };
    const text = readBounded(root, rel);
    const headerText = text.split(/^## /m)[0];
    const id = fields(headerText).get("Run ID / UTC date");
    // Legacy reports get a unique ID. Invalid supplied IDs are rejected, not interpreted as paths.
    const previousRunId = id ? safeId(id) : utcRunId();
    let destination = `${option}/history/${previousRunId}/report.md`;
    if (statOrMissing(safePath(root, destination))) destination = `${option}/history/${previousRunId}-${randomUUID()}/report.md`;
    publish(root, destination, text);
    // Do not remove a newer canonical report written by another actor in the meantime.
    if (readBounded(root, rel) !== text) throw new Error("Report changed during archive; both copies preserved");
    unlinkSync(safePath(root, rel));
    return { archived: true, previousRunId, destination };
  });
}

interface Registry { format: 1; max: Record<Family, number>; entries: Record<string, string>; }
/** Fail closed on unreadable history, unsafe paths and malformed IDs. No silent limits. */
function historicalIds(root: string) {
  const max = { FUNC: 0, ASSET: 0, BLACKBOX: 0 };
  const ids = new Set<string>();
  const scan = (rel: string) => {
    const path = safePath(root, rel);
    const st = statOrMissing(path);
    if (!st) return;
    const text = readBounded(root, rel);
    for (const m of text.matchAll(/\b(FUNC|ASSET|BLACKBOX)-(\d+)\b/g)) {
      const n = Number(m[2]);
      if (!Number.isSafeInteger(n)) throw new Error("Unsafe numeric ID in report history");
      const family = m[1] as Family;
      max[family] = Math.max(max[family], n);
      ids.add(`${family}-${String(n).padStart(3, "0")}`);
    }
  };
  // Synchronous scan only at migration/bootstrap. All future allocations use the registry.
  for (const option of OPTIONS) {
    scan(`${option}/report.md`);
    const histRel = `${option}/history`;
    const hist = safePath(root, histRel);
    if (!statOrMissing(hist)) continue;
    // A history directory contains only run directories; refuse ambiguous content.
    for (const entry of readdirSync(hist, { withFileTypes: true })) {
      if (!entry.isDirectory()) throw new Error(`Unexpected history entry: ${histRel}/${entry.name}`);
      scan(`${histRel}/${entry.name}/report.md`);
    }
  }
  return { max, ids };
}

export function reserveId(root: string, family: Family, identity: string, existingId?: string) {
  if (!["FUNC", "ASSET", "BLACKBOX"].includes(family)) throw new Error("Invalid ID family");
  if (!identity.trim() || identity.length > 2000) throw new Error("Provide a stable, non-secret asset/functionality/finding identity (1–2000 characters)");
  const key = `${family}:${hash(identity)}`;
  return lock(root, ".blackbox/ids.lock", () => {
    let registry: Registry;
    const rel = ".blackbox/ids.json";
    if (statOrMissing(safePath(root, rel))) {
      registry = JSON.parse(readBounded(root, rel));
      if (registry.format !== 1 || !registry.max || !registry.entries || typeof registry.entries !== "object" || Array.isArray(registry.entries)) throw new Error("Invalid ID registry");
      for (const f of ["FUNC", "ASSET", "BLACKBOX"] as Family[]) {
        if (!Number.isSafeInteger(registry.max[f]) || registry.max[f] < 0) throw new Error("Invalid ID counter");
      }
      const seen = new Set<string>();
      for (const [k, v] of Object.entries(registry.entries)) {
        const m = typeof v === "string" && v.match(/^(FUNC|ASSET|BLACKBOX)-(\d+)$/);
        if (!m || !Number.isSafeInteger(Number(m[2])) || Number(m[2]) < 1 || v !== `${m[1]}-${String(Number(m[2])).padStart(3, "0")}` || !k.startsWith(`${m[1]}:`) || !/^(FUNC|ASSET|BLACKBOX):[a-f0-9]{64}$/.test(k) || seen.has(v) || Number(m[2]) > registry.max[m[1] as Family]) throw new Error("Invalid ID registry entry");
        seen.add(v);
      }
    } else registry = { format: 1, max: historicalIds(root).max, entries: {} };
    const previous = registry.entries[key];
    if (previous) {
      if (existingId && existingId !== previous) throw new Error("Identity already reserved with a different ID");
      return { id: previous, reused: true };
    }
    if (existingId) {
      const m = existingId.match(new RegExp(`^${family}-(\\d+)$`));
      if (!m || !Number.isSafeInteger(Number(m[1])) || Number(m[1]) < 1) throw new Error("Invalid existing ID");
      // Adoption is explicit after evidence/identity review; require historical backing.
      if (!historicalIds(root).ids.has(existingId)) throw new Error("Existing ID has no historical backing (use canonical zero-padding)");
      if (Object.values(registry.entries).includes(existingId)) throw new Error("Existing ID belongs to another identity");
    }
    const n = existingId ? Number(existingId.split("-")[1]) : registry.max[family] + 1;
    if (!Number.isSafeInteger(n)) throw new Error("ID counter exhausted");
    const id = existingId ?? `${family}-${String(n).padStart(3, "0")}`;
    registry.max[family] = Math.max(registry.max[family], n);
    registry.entries[key] = id;
    publish(root, rel, JSON.stringify(registry, null, 2) + "\n", true);
    return { id, reused: !!existingId };
  });
}

interface InventoryOptions {
  paths: string[];
  exclusions?: string[];
  maxFiles?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
}
/** Inventory hashes local evidence, never remote hosts. Select paths after accepting scope.
 * It never interprets Markdown authorization or treats hashes as live-target freshness.
 */
export async function buildInventory(root: string, options: InventoryOptions, signal?: AbortSignal) {
  const scope = checkScope(root);
  if (!options.paths?.length) throw new Error("Explicit approved coverage paths are required");
  const normalize = (p: string) => relative(root, safePath(root, p)).split(sep).join("/") || ".";
  const paths = [...new Set(options.paths.map(normalize))].sort();
  const exclusions = [...new Set((options.exclusions ?? []).map(normalize))].sort();
  const limits = {
    files: options.maxFiles ?? 8000,
    fileBytes: options.maxFileBytes ?? 64 * 1024 * 1024,
    totalBytes: options.maxTotalBytes ?? 512 * 1024 * 1024,
  };
  for (const n of Object.values(limits)) if (!Number.isSafeInteger(n) || n < 1) throw new Error("Invalid inventory limit");
  const runId = utcRunId();
  const files: { path: string; sha256: string; bytes: number }[] = [];
  const skipped: { path: string; reason: string }[] = [];
  const errors: { path: string; reason: string }[] = [];
  const visited = new Set<string>();
  let bytes = 0, entries = 0, truncated = false;
  const under = (p: string, prefix: string) => prefix === "." || p === prefix || p.startsWith(`${prefix}/`);
  const generated = (rel: string) => {
    if (under(rel, ".blackbox")) return true;
    if (/^(blackbox-enum|blackbox-map|blackbox-vulns|blackbox-poc|blackbox-report)\/(?:history\/[^/]+\/)?report\.md$/.test(rel)) {
      const option = rel.split("/")[0];
      if (!statOrMissing(safePath(root, rel))) return false;
      return readBounded(root, rel).startsWith(`# ${option} report\n`);
    }
    return false;
  };
  const walk = async (rel: string): Promise<void> => {
    signal?.throwIfAborted();
    if (visited.has(rel) || truncated) return;
    visited.add(rel);
    if (++entries > 100000) { truncated = true; errors.push({ path: rel, reason: "Traversal entry limit reached" }); return; }
    if (rel.split("/").includes(".git") || under(rel, ".blackbox") || exclusions.some(x => under(rel, x))) {
      skipped.push({ path: rel, reason: "Explicit exclusion or reserved metadata" }); return;
    }
    try {
      const path = safePath(root, rel);
      const st = lstatSync(path);
      if (st.isDirectory()) {
        for (const entry of (await readdir(path)).sort()) {
          await walk(rel === "." ? entry : `${rel}/${entry}`);
          if (truncated) break;
        }
        return;
      }
      if (!st.isFile()) { skipped.push({ path: rel, reason: "Non-regular file" }); return; }
      // Upstream reports are blackbox evidence: hash explicitly selected reports too.
      if (files.length >= limits.files || bytes >= limits.totalBytes) {
        truncated = true; errors.push({ path: rel, reason: "Inventory file/total-byte limit reached" }); return;
      }
      if (st.size > limits.fileBytes) { errors.push({ path: rel, reason: "File exceeds hash size limit" }); return; }
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const before = await handle.stat();
        if (!before.isFile()) throw new Error("File type changed");
        const digest = createHash("sha256");
        const buffer = Buffer.alloc(64 * 1024);
        let size = 0;
        while (true) {
          signal?.throwIfAborted();
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
          if (!bytesRead) break;
          size += bytesRead;
          bytes += bytesRead;
          if (size > limits.fileBytes || bytes > limits.totalBytes) throw new Error("Streaming hash byte limit reached");
          digest.update(buffer.subarray(0, bytesRead));
        }
        const after = await handle.stat();
        if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || size !== after.size) throw new Error("File changed while hashing");
        files.push({ path: rel, sha256: digest.digest("hex"), bytes: size });
      } finally { await handle.close(); }
    } catch (error) {
      signal?.throwIfAborted();
      errors.push({ path: rel, reason: errorText(error) });
    }
  };
  for (const path of paths) await walk(path);
  signal?.throwIfAborted();
  const git = async (args: string[]) => (await exec("git", ["-c", "core.fsmonitor=false", "-c", "status.relativePaths=true", "-C", root, ...args], {
    encoding: "utf8", signal, timeout: 10000, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  })).stdout;
  let gitCommit: string | null = null;
  let dirty: string[] | null = null;
  const gitErrors: string[] = [];
  try {
    gitCommit = (await git(["rev-parse", "HEAD"])).trim();
    const tokens = (await git(["status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames", "--", "."])).split("\0").filter(Boolean);
    dirty = tokens.filter(line => !generated(line.slice(3))).map(line => line);
  } catch (error) {
    signal?.throwIfAborted();
    gitErrors.push(errorText(error).slice(0, 1000));
  }
  if (checkScope(root).sha256 !== scope.sha256) throw new Error("Scope changed during inventory; invoke the skill again");
  signal?.throwIfAborted();
  const manifest = {
    format: 2, runId, createdAt: new Date().toISOString(), root, scope: { sha256: scope.sha256 },
    paths, exclusions, limits, gitCommit, dirty, gitErrors, files, skipped, errors, truncated,
    coverage: errors.length || truncated ? "partial" : "complete",
    purpose: "Local evidence inventory only; hashes do not establish review, live-target freshness, or correctness. Snapshot is best-effort, not filesystem-transactional.",
  };
  const manifestRel = `.blackbox/manifests/${runId}.json`;
  publish(root, manifestRel, JSON.stringify(manifest, null, 2) + "\n");
  return { ...manifest, manifestPath: manifestRel };
}

interface RootConfig { format: 2; session: string; cwd: string; root: string | null; }
/** Per-session files avoid global read/modify/write races. Same-session writes are locked. */
export interface WorkerScope { root: string; sha256: string; }
export default async function blackbox(pi: ExtensionAPI, worker?: WorkerScope) {
  const configDir = resolve(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"));
  const stateRoot = () => {
    mkdirSync(configDir, { recursive: true, mode: 0o700 });
    return canonicalRoot(configDir);
  };
  const session = (ctx: ExtensionContext) => {
    const id = ctx.sessionManager.getSessionId();
    if (typeof id !== "string" || !id) throw new Error("No Pi session identity available");
    return { id, cwd: realpathSync(ctx.cwd) };
  };
  const sessionFile = (ctx: ExtensionContext) => {
    const s = session(ctx);
    return `blackbox/sessions/${hash(JSON.stringify([s.id, s.cwd]))}.json`;
  };
  const selectedRoot = (ctx: ExtensionContext): string | null => {
    if (worker) {
      if (checkScope(worker.root).sha256 !== worker.sha256) throw new Error("Delegated scope changed; stop and reinvoke from the parent");
      return worker.root;
    }
    const rel = sessionFile(ctx);
    const base = stateRoot();
    if (!statOrMissing(safePath(base, rel))) return null; // Never inherit legacy global roots.
    const data: RootConfig = JSON.parse(readBounded(base, rel, 16 * 1024));
    const s = session(ctx);
    if (data.format !== 2 || data.session !== s.id || data.cwd !== s.cwd || !(data.root === null || typeof data.root === "string" && isAbsolute(data.root))) throw new Error("Invalid session-root configuration");
    return data.root;
  };
  const requireRoot = (ctx: ExtensionContext, supplied?: string) => {
    const root = selectedRoot(ctx);
    if (!root) throw new Error("No Blackbox root for this session. Run /blackbox-root <dir> first.");
    checkScope(root);
    if (supplied !== undefined && canonicalRoot(supplied) !== root) throw new Error("Tool root must match the selected session root");
    return root;
  };
  const diagnostic = (ctx: ExtensionContext, message: string, level: "info" | "warning" | "error" = "error") => {
    if (ctx.hasUI) ctx.ui.notify(message, level);
    else {
      // A real custom message reaches print/JSON consumers; stderr also makes blocking visible.
      pi.sendMessage({ customType: "blackbox-diagnostic", content: message, display: true, details: { level } }, { triggerTurn: false });
      process.stderr.write(`Blackbox [${level}]: ${message.replace(/[\r\n]/g, " ")}\n`);
    }
  };
  const updateStatus = (ctx: ExtensionContext) => {
    try {
      const root = selectedRoot(ctx);
      if (root) checkScope(root);
      if (ctx.hasUI) ctx.ui.setStatus("blackbox-root", `Blackbox ⎈ ${root ?? "no root — /blackbox-root <dir>"}`);
    } catch (error) {
      if (ctx.hasUI) ctx.ui.setStatus("blackbox-root", "Blackbox ⚠ invalid root / SCOPE.md");
      diagnostic(ctx, errorText(error));
    }
  };
  pi.on("session_start", async (_event, ctx) => updateStatus(ctx));
  pi.registerCommand("blackbox-root", {
    description: "Set the session root; no arguments shows it; clear/none removes it",
    handler: async (args, ctx) => {
      try {
        const input = args.trim();
        if (!input) { diagnostic(ctx, `Blackbox root: ${selectedRoot(ctx) ?? "none — use /blackbox-root <dir>"}`, "info"); return; }
        if (worker) throw new Error("Delegated worker root is pinned by the orchestrator");
        if (!ctx.isIdle()) throw new Error("Root is locked while a run is in progress");
        const root = ["clear", "none"].includes(input) ? null : canonicalRoot(resolve(ctx.cwd,
          input === "~" ? homedir() : input.startsWith("~/") ? join(homedir(), input.slice(2)) : input));
        if (root) checkScope(root);
        const s = session(ctx);
        const base = stateRoot();
        const rel = sessionFile(ctx);
        lock(base, `${rel}.lock`, () => publish(base, rel, JSON.stringify({ format: 2, session: s.id, cwd: s.cwd, root }) + "\n", true));
        updateStatus(ctx);
        diagnostic(ctx, root ? `Blackbox root set: ${root}` : "Blackbox root cleared", "info");
      } catch (error) { diagnostic(ctx, errorText(error)); }
    },
  });
  for (const option of OPTIONS) {
    pi.registerCommand(option, {
      description: `Run /skill:${option} through the same scope gate`,
      handler: async (args, ctx) => {
        try {
          const root = requireRoot(ctx);
          if (!worker && statOrMissing(safePath(root, ".blackbox/orchestrator.lock"))) throw new Error("This root is owned by an orchestrator; wait before running a manual phase");
          if (!ctx.isIdle()) throw new Error("Wait for the current run before starting a phase");
          pi.sendUserMessage(`/skill:${option} ${args.trim()}`, { expandPromptTemplates: true });
        } catch (error) { diagnostic(ctx, errorText(error)); }
      },
    });
  }
  pi.on("input", async (event, ctx) => {
    const match = event.text.match(/^\/skill:([^\s]+)([\s\S]*)$/);
    if (!match || !(OPTIONS as readonly string[]).includes(match[1])) return { action: "continue" };
    try {
      const root = requireRoot(ctx);
      if (!worker && statOrMissing(safePath(root, ".blackbox/orchestrator.lock"))) throw new Error("This root is owned by an orchestrator; wait before running a manual phase");
      const scope = checkScope(root);
      const focus = match[2].trim();
      if (/<\/?BLACKBOX_SCOPE\b/.test(focus + scope.content)) throw new Error("Ambiguous BLACKBOX_SCOPE delimiter in focus or scope");
      updateStatus(ctx);
      return { action: "transform", text: `/skill:${match[1]} ${focus}\n\n<BLACKBOX_SCOPE>\nproject-root: ${root}\nscope-file: ${join(root, "SCOPE.md")}\nscope-sha256: ${scope.sha256}\n\n${scope.content}\n</BLACKBOX_SCOPE>` };
    } catch (error) { diagnostic(ctx, errorText(error)); return { action: "handled" }; }
  });

  // Retain the optional root parameter for old callers, but never use it to select a target.
  const rootParam = Type.Optional(Type.String({ description: "Optional compatibility check; must match the session root" }));
  const result = (details: unknown, text: string) => ({ content: [{ type: "text" as const, text }], details });
  pi.registerTool({
    name: "blackbox_ids", label: "Blackbox: reserve stable ID", executionMode: "sequential",
    description: "Atomically reserve/reuse an ASSET, FUNC, or BLACKBOX ID by stable non-secret identity. Existing IDs may be adopted after evidence review. No manual IDs after registry bootstrap.",
    parameters: Type.Object({ type: familySchema, identity: Type.String({ minLength: 1, maxLength: 2000 }), existingId: Type.Optional(Type.String()), root: rootParam }, { additionalProperties: false }),
    async execute(_id, params, signal, _update, ctx) {
      signal?.throwIfAborted();
      const value = reserveId(requireRoot(ctx, params.root), params.type, params.identity, params.existingId);
      return result(value, `${value.id} (${value.reused ? "reused" : "reserved"})`);
    },
  });
  pi.registerTool({
    name: "blackbox_manifest", label: "Blackbox: bounded content inventory", executionMode: "sequential",
    description: "Hash explicit local evidence paths, never network targets. Exclusions prune before reads. Records skipped paths/errors/limits. Hashing is not review or remote freshness. Summary only; full JSON on disk.",
    parameters: Type.Object({
      paths: Type.Array(Type.String(), { minItems: 1, maxItems: 1000 }),
      exclusions: Type.Optional(Type.Array(Type.String(), { maxItems: 1000 })),
      maxFiles: Type.Optional(Type.Integer({ minimum: 1, maximum: 100000 })),
      maxFileBytes: Type.Optional(Type.Integer({ minimum: 1, maximum: 1024 * 1024 * 1024 })),
      maxTotalBytes: Type.Optional(Type.Integer({ minimum: 1, maximum: 4 * 1024 * 1024 * 1024 })),
      root: rootParam,
    }, { additionalProperties: false }),
    async execute(_id, params, signal, _update, ctx) {
      const value = await buildInventory(requireRoot(ctx, params.root), params, signal);
      const details = { runId: value.runId, manifestPath: value.manifestPath, coverage: value.coverage, files: value.files.length, errors: value.errors.length, truncated: value.truncated };
      return result(details, `${JSON.stringify(details)}\nLocal evidence inventory only, not proof of review or current remote state. See JSON for exclusions/errors. Git metadata describes the workspace, not the remote target.`);
    },
  });
  pi.registerTool({
    name: "blackbox_archive", label: "Blackbox: preserve previous report", executionMode: "sequential",
    description: "Archive the prior report under its own run ID (unique fallback for legacy reports), exclusively and without escaping the session root.",
    parameters: Type.Object({ option: optionSchema, root: rootParam }, { additionalProperties: false }),
    async execute(_id, params, signal, _update, ctx) {
      signal?.throwIfAborted();
      const value = archiveReport(requireRoot(ctx, params.root), params.option);
      return result(value, JSON.stringify(value));
    },
  });
  pi.registerTool({
    name: "blackbox_validate_report", label: "Blackbox: report structure checks",
    description: "Check populated shared headers, coverage, scope digest, required pass sections and handoff. Does not validate findings or evidence correctness. Reports at most 30 issues in model-facing output.",
    parameters: Type.Object({ option: optionSchema, root: rootParam }, { additionalProperties: false }),
    async execute(_id, params, signal, _update, ctx) {
      signal?.throwIfAborted();
      const issues = validateReport(requireRoot(ctx, params.root), params.option);
      return result({ issues }, issues.length ? `Structure issues (${issues.length}):\n${issues.slice(0, 30).map(x => `- ${x}`).join("\n")}` : "Structure checks passed; evidence correctness still requires review.");
    },
  });
  if (!worker) {
    // Pi's TS loader resolves relative imports from the installed symlink path.
    // Resolve our real repository first so the documented single-file global link works.
    const repo = dirname(dirname(realpathSync(fileURLToPath(import.meta.url))));
    const { registerOrchestrator } = await import(join(repo, "extensions/lib/blackbox-orchestrator.ts"));
    registerOrchestrator(pi, { requireRoot, diagnostic, repo });
  }
}
