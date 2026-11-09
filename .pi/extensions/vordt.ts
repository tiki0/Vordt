/**
 * Vordt — whitebox pentesting harness companion extension.
 *
 * Responsibilities:
 *  - /vordt-root <dir>  : set the project root (must contain SCOPE.md); no searching elsewhere.
 *  - Gate /skill:<vordt skill> invocations: refuse to run unless a project root is set and
 *    SCOPE.md exists IN that root. On success, inject the root + SCOPE.md content into the
 *    invocation so the agent has scope context.
 *  - Show the project root (and SCOPE.md presence) in the bottom-left footer status line.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

const APP_NAME = "Vordt";
const SCOPE_FILE = "SCOPE.md";
const CONFIG_DIR = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
const CONFIG_FILE = join(CONFIG_DIR, "vordt.json");

/** Skills that belong to the Vordt pipeline and require SCOPE.md. */
const VORDT_SKILLS = new Set([
  "scan-structure",
  "scan-surface",
  "scan-vulns",
  "exploit",
  "report",
]);

let currentRoot: string | null | undefined = undefined; // undefined = not yet loaded

function loadRoot(): string | null {
  try {
    const raw = readFileSync(CONFIG_FILE, "utf8");
    const parsed = JSON.parse(raw) as { root?: unknown };
    if (typeof parsed.root === "string" && parsed.root.length > 0) return parsed.root;
    return null;
  } catch {
    return null;
  }
}

function saveRoot(root: string): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify({ root }, null, 2) + "\n", "utf8");
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

function scopeStatusText(root: string | null): string {
  if (!root) return `${APP_NAME}: no project root — run /vordt-root <dir>`;
  const ok = existsSync(join(root, SCOPE_FILE));
  return `${APP_NAME} ⎈ ${displayPath(root)}${ok ? "" : "  ⚠ missing SCOPE.md"}`;
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    currentRoot = loadRoot();
    if (ctx.hasUI) {
      ctx.ui.setStatus("vordt-root", scopeStatusText(currentRoot));
    }
  });

  // --- /vordt-root command -------------------------------------------------
  pi.registerCommand("vordt-root", {
    description: `Set the ${APP_NAME} project root (a directory containing ${SCOPE_FILE})`,
    getArgumentCompletions: (prefix: string) => {
      // Directory completion is handled by pi's built-in path autocomplete after the space;
      // provide no extra completions here.
      return null;
    },
    handler: async (args, ctx) => {
      const input = (args ?? "").trim();

      if (!input) {
        const root = currentRoot ?? loadRoot();
        if (ctx.hasUI) {
          if (root) ctx.ui.notify(`Current ${APP_NAME} root: ${root}`, "info");
          else ctx.ui.notify(`No ${APP_NAME} root set. Usage: /vordt-root <dir>`, "warning");
        }
        return;
      }

      const expanded = input === "~" ? homedir() : input.startsWith("~/")
        ? join(homedir(), input.slice(2))
        : input;
      const abs = resolve(ctx.cwd, expanded);

      let stat;
      try {
        stat = statSync(abs);
      } catch {
        if (ctx.hasUI) ctx.ui.notify(`Not a directory: ${abs}`, "error");
        return;
      }
      if (!stat.isDirectory()) {
        if (ctx.hasUI) ctx.ui.notify(`Not a directory: ${abs}`, "error");
        return;
      }

      const scopePath = join(abs, SCOPE_FILE);
      if (!existsSync(scopePath)) {
        if (ctx.hasUI) {
          ctx.ui.notify(
            `${SCOPE_FILE} must exist in ${abs} before it can be used as the ${APP_NAME} project root. Create it and retry.`,
            "error",
          );
        }
        return;
      }

      currentRoot = abs;
      saveRoot(abs);
      if (ctx.hasUI) {
        ctx.ui.setStatus("vordt-root", scopeStatusText(abs));
        ctx.ui.notify(`${APP_NAME} project root set to ${abs}`, "info");
      }
    },
  });

  // --- Gate + scope injection for Vordt skill invocations ------------------
  pi.on("input", async (event, ctx) => {
    // Extension commands are checked before this handler, so only skill commands
    // reach us here in the /skill: namespace.
    const match = event.text.match(/^\/skill:([^\s]+)/);
    if (!match) return { action: "continue" };
    const skill = match[1];
    if (!VORDT_SKILLS.has(skill)) return { action: "continue" }; // not a Vordt skill

    const root = currentRoot ?? loadRoot();
    currentRoot = root;

    if (!root) {
      if (ctx.hasUI) {
        ctx.ui.notify(
          `No ${APP_NAME} project root set. Run /vordt-root <dir> (with ${SCOPE_FILE} inside) first.`,
          "error",
        );
      }
      return { action: "handled" };
    }

    const scopePath = join(root, SCOPE_FILE);
    if (!existsSync(scopePath)) {
      if (ctx.hasUI) {
        ctx.ui.setStatus("vordt-root", scopeStatusText(root));
        ctx.ui.notify(
          `${SCOPE_FILE} not found in ${root}. The ${APP_NAME} skills require it exactly there.`,
          "error",
        );
      }
      return { action: "handled" };
    }

    let scopeContent: string;
    try {
      scopeContent = readFileSync(scopePath, "utf8");
    } catch {
      if (ctx.hasUI) ctx.ui.notify(`Could not read ${scopePath}.`, "error");
      return { action: "handled" };
    }

    const injected =
      `${event.text}\n\n<VORDT_SCOPE>\n` +
      `project-root: ${root}\n` +
      `scope-file: ${scopePath}\n\n` +
      `${scopeContent}\n` +
      `</VORDT_SCOPE>`;

    return { action: "transform", text: injected };
  });
}