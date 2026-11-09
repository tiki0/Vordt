// Shared helpers for the Vordt test suite: locate the Pi install (for types and
// runtime deps), find a usable TypeScript compiler, and run a tiny assert runner.

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync, readdirSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function compareVersions(a, b) {
  const pa = a.replace(/^v/, "").split(".").map((n) => parseInt(n, 10));
  const pb = b.replace(/^v/, "").split(".").map((n) => parseInt(n, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

/**
 * Resolve the highest installed Pi release root, e.g.
 * ~/.pi/agent/install/releases/1.5.0 — or null when not found.
 */
export function piReleaseRoot() {
  const base = join(homedir(), ".pi", "agent", "install", "releases");
  let dirs;
  try {
    dirs = readdirSync(base);
  } catch {
    return null;
  }
  const versions = dirs.filter((d) => /^v?\d+\.\d+\.\d+/.test(d));
  if (!versions.length) return null;
  versions.sort((x, y) => compareVersions(x, y));
  return join(base, versions[versions.length - 1]);
}

/** node_modules of the Pi install (source of @types, typescript, typebox). */
export function piNodeModules() {
  const root = piReleaseRoot();
  return root ? join(root, "node_modules") : null;
}

/** Find a TypeScript compiler: Pi's bundled one, then system tsc, then npx. */
export function findTsc() {
  const nm = piNodeModules();
  if (nm) {
    const bundled = join(nm, "typescript", "bin", "tsc");
    if (existsSync(bundled)) return bundled;
  }
  try {
    const which = execFileSync("which", ["tsc"], { encoding: "utf8" }).trim();
    if (which && existsSync(which)) return which;
  } catch {
    /* not on PATH */
  }
  return null;
}

/**
 * Compile .pi/extensions/vordt.ts to CommonJS under <outDir> and make the Pi
 * install's node_modules resolvable next to it (symlink). Returns the filesystem
 * path of the compiled module.
 */
/**
 * Compile the extension to CJS for functional tests.
 *
 * The repo has no node_modules, so the source is copied into a build dir that
 * carries a symlink to the Pi install's node_modules; the compiled output lives
 * next to that symlink so `require("typebox")` resolves at test runtime.
 */
export function buildExtension(outDir) {
  const nm = piNodeModules();
  if (!nm) throw new Error("Pi install not found — cannot build the extension for tests.");
  const tsc = findTsc();
  if (!tsc) throw new Error("No TypeScript compiler available (checked Pi bundle and `tsc` on PATH).");

  const src = join(REPO_ROOT, ".pi", "extensions", "vordt.ts");
  const srcDir = join(outDir, "_src");
  mkdirSync(srcDir, { recursive: true });
  const copied = join(srcDir, "vordt.ts");
  copyFileSync(src, copied);

  // resolution for tsc (compile-time) and node (require-time)
  const link = join(srcDir, "node_modules");
  if (!existsSync(link)) symlinkSync(nm, link, "dir");
  const outLink = join(outDir, "node_modules");
  if (!existsSync(outLink)) symlinkSync(nm, outLink, "dir");

  execFileSync(
    tsc,
    [
      copied,
      "--ignoreConfig",
      "--target", "es2022",
      "--module", "commonjs",
      "--moduleResolution", "node10",
      "--ignoreDeprecations", "6.0",
      "--typeRoots", join(nm, "@types"),
      "--outDir", outDir,
      "--skipLibCheck",
      "--esModuleInterop",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );

  const outDirJs = join(outDir, "vordt.js");
  if (!existsSync(outDirJs)) throw new Error(`Expected compiled output at ${outDirJs}`);
  return outDirJs;
}

export function makeTempDir(base, name) {
  const dir = join(base, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

// --- tiny assert runner -----------------------------------------------------

let passed = 0;
const failures = [];

export function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.error(`FAIL  ${name}\n      ${err?.message?.split("\n")[0] ?? err}`);
  }
}

export function asyncTest(name, fn) {
  trackAsync(
    Promise.resolve()
      .then(() => fn())
      .then(
        () => {
          passed++;
          console.log(`  ok  ${name}`);
        },
        (err) => {
          failures.push({ name, err });
          console.error(`FAIL  ${name}\n      ${err?.message?.split("\n")[0] ?? err}`);
        },
      ),
  );
}

export function assert(cond, msg) {
  if (!cond) throw new Error(msg ?? "assertion failed");
}

export function assertEq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg ?? "values differ"}\n      expected ${b}\n      actual   ${a}`);
}

export function assertMatch(actual, re, msg) {
  if (!re.test(actual)) throw new Error(`${msg ?? "no match"}: ${JSON.stringify(actual)} ~= ${re}`);
}

export function summary() {
  if (failures.length) {
    console.error(`\n${failures.length} test(s) FAILED, ${passed} passed.`);
    process.exitCode = 1;
  } else {
    console.log(`\nAll ${passed} test(s) passed.`);
  }
}

const pendingAsync = [];

export function trackAsync(p) {
  pendingAsync.push(p);
}

export async function finish() {
  const results = await Promise.all(pendingAsync);
  pendingAsync.length = 0;
  return results;
}
