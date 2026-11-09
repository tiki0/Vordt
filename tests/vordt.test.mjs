// Functional tests for the Vordt harness.
// Builds the extension with tsc, then exercises the pure helpers, the /skill:
// injection format, and the SKILL.md/reference documents.
//
// Run: npm test

import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  REPO_ROOT,
  makeTempDir,
  test,
  asyncTest,
  assert,
  assertEq,
  assertMatch,
  summary,
  finish,
  buildExtension,
} from "./lib.mjs";

const TMP = makeTempDir(tmpdir(), `vordt-tests-${process.pid}`);

// ---------------------------------------------------------------------------
// Build the extension under test
// ---------------------------------------------------------------------------

const OUT = makeTempDir(TMP, "build");
const extPath = buildExtension(OUT);
const require = createRequire(import.meta.url);
const ext = require(extPath);
const { checkScope, archiveReport, buildInventory, highestId, validateReport } = ext;

// ---------------------------------------------------------------------------
// checkScope
// ---------------------------------------------------------------------------

test("checkScope rejects a nonexistent root", () => {
  const r = checkScope(join(TMP, "does-not-exist"));
  assertEq(r.ok, false);
});

test("checkScope rejects a file as the root", () => {
  const f = join(TMP, "a-file");
  writeFileSync(f, "x");
  assertEq(checkScope(f).ok, false);
});

test("checkScope rejects a root without SCOPE.md", () => {
  const root = makeTempDir(TMP, "no-scope");
  assertEq(checkScope(root).ok, false);
});

test("checkScope rejects a directory named SCOPE.md", () => {
  const root = makeTempDir(TMP, "dir-scope");
  mkdirSync(join(root, "SCOPE.md"));
  assertEq(checkScope(root).ok, false);
});

test("checkScope rejects a symlinked SCOPE.md pointing outside the root", () => {
  const root = makeTempDir(TMP, "sym-scope");
  const outside = join(TMP, "outside-scope");
  writeFileSync(outside, "scope elsewhere");
  try {
    symlinkSync(outside, join(root, "SCOPE.md"));
  } catch {
    return; // symlinks unsupported here; skip
  }
  assertEq(checkScope(root).ok, false);
});

test("checkScope rejects an empty SCOPE.md", () => {
  const root = makeTempDir(TMP, "empty-scope");
  writeFileSync(join(root, "SCOPE.md"), "");
  assertEq(checkScope(root).ok, false);
});

test("checkScope rejects a whitespace-only SCOPE.md", () => {
  const root = makeTempDir(TMP, "ws-scope");
  writeFileSync(join(root, "SCOPE.md"), "   \n\t\n");
  assertEq(checkScope(root).ok, false);
});

test("checkScope rejects an oversized SCOPE.md", () => {
  const root = makeTempDir(TMP, "big-scope");
  writeFileSync(join(root, "SCOPE.md"), "x".repeat(600 * 1024));
  const r = checkScope(root);
  assertEq(r.ok, false);
  assertMatch(r.reason ?? "", /limit/);
});

test("checkScope accepts a valid SCOPE.md and returns its digest", () => {
  const root = makeTempDir(TMP, "valid-scope");
  writeFileSync(join(root, "SCOPE.md"), "# Scope\n\nin scope: everything\n");
  const r = checkScope(root);
  assertEq(r.ok, true);
  assertMatch(r.sha256 ?? "", /^[0-9a-f]{64}$/);
});

// ---------------------------------------------------------------------------
// archiveReport
// ---------------------------------------------------------------------------

test("archiveReport rejects an unknown option name", () => {
  const root = makeTempDir(TMP, "arch-bad-opt");
  writeFileSync(join(root, "SCOPE.md"), "# scope\n");
  const r = archiveReport(root, "scan-whatever");
  assertEq(r.ok, false);
  assertEq(r.archived, false);
});

test("archiveReport reports nothing to archive when no report exists", () => {
  const root = makeTempDir(TMP, "arch-none");
  writeFileSync(join(root, "SCOPE.md"), "# scope\n");
  const r = archiveReport(root, "scan-structure");
  assertEq(r.archived, false);
});

test("archiveReport moves an existing report to history/<run-id>/report.md", () => {
  const root = makeTempDir(TMP, "arch-one");
  writeFileSync(join(root, "SCOPE.md"), "# scope\n");
  mkdirSync(join(root, "scan-structure"), { recursive: true });
  writeFileSync(join(root, "scan-structure", "report.md"), "# old\n");
  const r = archiveReport(root, "scan-structure", "RUN-1");
  assertEq(r.ok, true);
  assertEq(r.archived, true);
  assertEq(r.destination, "scan-structure/history/RUN-1/report.md");
  assert(existsSync(join(root, "scan-structure", "history", "RUN-1", "report.md")));
  assert(!existsSync(join(root, "scan-structure", "report.md")));
});

test("archiveReport never overwrites an existing archive (unique suffix)", () => {
  const root = makeTempDir(TMP, "arch-two");
  writeFileSync(join(root, "SCOPE.md"), "# scope\n");
  mkdirSync(join(root, "report"), { recursive: true });
  writeFileSync(join(root, "report", "report.md"), "# first\n");
  const r1 = archiveReport(root, "report", "RUN-9");
  assertEq(r1.destination, "report/history/RUN-9/report.md");
  // a new report exists again; a rerun with the same run id must not clobber
  writeFileSync(join(root, "report", "report.md"), "# second\n");
  const r2 = archiveReport(root, "report", "RUN-9");
  assertEq(r2.archived, true);
  assertMatch(r2.destination ?? "", /^report\/history\/RUN-9-[0-9]+\/report\.md$/);
  assertEq(
    readFileSync(join(root, "report", "history", "RUN-9", "report.md"), "utf8"),
    "# first\n",
  );
});

// ---------------------------------------------------------------------------
// highestId
// ---------------------------------------------------------------------------

function seedReports(baseDir, files) {
  const root = makeTempDir(baseDir, "ids");
  for (const [rel, text] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, text);
  }
  return root;
}

test("highestId scans report.md and history and returns per-type max", () => {
  const root = seedReports(TMP, {
    "scan-structure/report.md": [
      "### FUNC-001 — a",
      "### FUNC-002 — b",
      "### FUNC-010 — c",
      "### INPUT-003 — u",
    ].join("\n"),
    "scan-structure/history/r0/report.md": "### FUNC-007 — old\n### VORDT-042 — old",
  });
  assertEq(highestId(root, "scan-structure", "FUNC").max, 10);
  assertEq(highestId(root, "scan-structure", "FUNC").matches, 4);
  assertEq(highestId(root, "scan-structure", "INPUT").max, 3);
  assertEq(highestId(root, "scan-structure", "VORDT").max, 42);
});

test("highestId conservatively counts mentions anywhere in report/history text", () => {
  const root = seedReports(TMP, {
    "scan-vulns/report.md": "### VORDT-099 — only Vordt here\nFUNC-555 inside a paragraph",
    "source.js": "const FUNC-777 = 1;", // not a report file: never scanned
  });
  const r = highestId(root, "scan-vulns", "FUNC");
  assertEq(r.max, 555); // safe: a mention anywhere blocks reuse of that id
  assertEq(r.filesScanned, 1);
  assertEq(highestId(root, "scan-vulns", "VORDT").max, 99); // other families independent
});

// ---------------------------------------------------------------------------
// validateReport
// ---------------------------------------------------------------------------

test("validateReport reports missing file as an issue", () => {
  const root = makeTempDir(TMP, "val-missing");
  writeFileSync(join(root, "SCOPE.md"), "# scope\n");
  assert(validateReport(root, "scan-surface").length > 0);
});

test("validateReport flags missing shared markers", () => {
  const root = makeTempDir(TMP, "val-incomplete");
  writeFileSync(join(root, "SCOPE.md"), "# scope\n");
  mkdirSync(join(root, "scan-vulns"), { recursive: true });
  writeFileSync(join(root, "scan-vulns", "report.md"), "# scan-vulns report\n\nsome text\n");
  const issues = validateReport(root, "scan-vulns");
  assert(issues.some((i) => /Run ID/.test(i)));
  assert(issues.some((i) => /Handoff/.test(i)));
  assert(issues.some((i) => /Source manifest/.test(i)));
});

test("validateReport passes a structurally complete report", () => {
  const root = makeTempDir(TMP, "val-complete");
  writeFileSync(join(root, "SCOPE.md"), "# scope\n");
  mkdirSync(join(root, "scan-structure"), { recursive: true });
  writeFileSync(
    join(root, "scan-structure", "report.md"),
    [
      "# scan-structure report",
      "**Run ID / UTC date:** 20260101-000000Z",
      "**Project root:** /x",
      "**Coverage:** partial",
      "## Source manifest",
      "<manifest>",
      "## Handoff",
      "- **Key facts and stable IDs:** none",
    ].join("\n"),
  );
  assertEq(validateReport(root, "scan-structure"), []);
});

test("validateReport does not require Source manifest in the final report pass", () => {
  const root = makeTempDir(TMP, "val-report-pass");
  writeFileSync(join(root, "SCOPE.md"), "# scope\n");
  mkdirSync(join(root, "report"), { recursive: true });
  writeFileSync(
    join(root, "report", "report.md"),
    [
      "# report report",
      "**Run ID / UTC date:** 20260101-000000Z",
      "**Project root:** /x",
      "**Coverage:** partial",
      "## Handoff",
      "- **Key facts and stable IDs:** none",
    ].join("\n"),
  );
  assertEq(validateReport(root, "report"), []);
});

// ---------------------------------------------------------------------------
// buildInventory
// ---------------------------------------------------------------------------

asyncTest("buildInventory writes a UTC run-id manifest excluding Vordt artifacts", () => {
  const root = makeTempDir(TMP, "manifest");
  writeFileSync(join(root, "SCOPE.md"), "# scope\n");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "app.js"), "const x = 1;\n");
  writeFileSync(join(root, "src", "secret.js"), "TOPSECRET");
  // Vordt-generated artifacts that must be excluded:
  mkdirSync(join(root, "scan-structure", "history", "r0"), { recursive: true });
  writeFileSync(join(root, "scan-structure", "history", "r0", "report.md"), "old");
  writeFileSync(join(root, "scan-structure", "report.md"), "current");
  mkdirSync(join(root, "exploit", "poc", "VORDT-001-x"), { recursive: true });
  writeFileSync(join(root, "exploit", "poc", "VORDT-001-x", "poc.js"), "pwn");
  mkdirSync(join(root, "node_modules"), { recursive: true });
  writeFileSync(join(root, "node_modules", "dep.js"), "dep");

  const inv = buildInventory(root);
  assertMatch(inv.runId, /^\d{8}-\d{6}Z$/);
  const paths = inv.files.map((f) => f.path).sort();
  assertEq(paths, ["SCOPE.md", "src/app.js", "src/secret.js"]);
  const sec = inv.files.find((f) => f.path === "src/secret.js");
  assert(sec);
  const expected = execFileSync("sha256sum", [join(root, "src", "secret.js")], { encoding: "utf8" }).split(/\s+/)[0];
  assertEq(sec.sha256, expected);
  assert(existsSync(join(root, ".vordt", "manifests", `${inv.runId}.json`)));
});

test("buildInventory records git revision and dirty status when available", () => {
  const root = makeTempDir(TMP, "manifest-git");
  writeFileSync(join(root, "SCOPE.md"), "# scope\n");
  writeFileSync(join(root, "a.js"), "a\n");
  try {
    execFileSync("git", ["-C", root, "init", "-q"], { stdio: "ignore" });
    execFileSync("git", ["-C", root, "add", "-A"], { stdio: "ignore" });
    execFileSync(
      "git",
      ["-C", root, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"],
      { stdio: "ignore" },
    );
  } catch {
    return; // no git on PATH; skip
  }
  const inv = buildInventory(root);
  assertMatch(inv.gitCommit ?? "", /^[0-9a-f]{7,}$/);
  assertEq(inv.dirty, []);
});

// ---------------------------------------------------------------------------
// pi /skill: expansion format (mirrors pi's _expandSkillCommand semantics)
// ---------------------------------------------------------------------------

function piExpandSkillName(text) {
  // pi: indexOf(" ")  — first literal space (not \n or tab)
  if (!text.startsWith("/skill:")) return null;
  const i = text.indexOf(" ");
  return i === -1 ? text.slice(7) : text.slice(7, i);
}

test("injected scope keeps the skill name parseable even without focus text", () => {
  const injected =
    "/skill:scan-structure <VORDT_SCOPE>\n" +
    "project-root: /x\nscope-file: /x/SCOPE.md\nscope-sha256: aaaa\n\nscope\n</VORDT_SCOPE>";
  assertEq(piExpandSkillName(injected), "scan-structure");
});

test("injected scope is parseable with focus text too", () => {
  const injected =
    "/skill:exploit focus on auth <VORDT_SCOPE>\nproject-root: /x\n\nscope\n</VORDT_SCOPE>";
  assertEq(piExpandSkillName(injected), "exploit");
});

test("a newline-injected block (old bug) would have broken the skill name", () => {
  const oldBroken = "/skill:scan-structure\n\n<VORDT_SCOPE>\nproject-root: /x\nscope-file: /x/SCOPE.md";
  const parsed = piExpandSkillName(oldBroken);
  assert(parsed !== "scan-structure", "old format must NOT parse as a plain skill name");
  assert(parsed.startsWith("scan-structure\n\n<VORDT_SCOPE>"), "old format injected junk into the name");
});

// ---------------------------------------------------------------------------
// SKILL.md / reference structure validation
// ---------------------------------------------------------------------------

const SKILLS = ["scan-structure", "scan-surface", "scan-vulns", "exploit", "report"];

for (const skill of SKILLS) {
  test(`SKILL.md frontmatter is valid for ${skill}`, () => {
    const file = join(REPO_ROOT, ".agents", "skills", skill, "SKILL.md");
    const text = readFileSync(file, "utf8");
    assert(text.startsWith("---"), "missing frontmatter opener");
    assert(/^name: \S+$/m.test(text), "missing top-level name key");
    assert(/^description: /m.test(text), "missing top-level description key");
    assert(/^disable-model-invocation: true$/m.test(text), "missing top-level disable-model-invocation: true");
    const end = text.indexOf("\n---", 3);
    assert(end > 0, "unterminated frontmatter");
  });

  test(`${skill}/SKILL.md follows the shared structure`, () => {
    const text = readFileSync(join(REPO_ROOT, ".agents", "skills", skill, "SKILL.md"), "utf8");
    for (const section of [
      "## Preconditions and scope",
      "## Required inputs",
      "## Allowed and prohibited actions",
      "## Procedure",
      "## Output schema",
      "## Completion checklist",
      "## Context handoff",
    ]) {
      assert(text.includes(section), `missing section: ${section}`);
    }
    assert(text.includes("[the shared workflow contract](../references/workflow.md)"));
    assert(/disable-model-invocation: true/.test(text));
  });
}

test("shared workflow contract exists and has the required anchors", () => {
  const wf = readFileSync(join(REPO_ROOT, ".agents", "skills", "references", "workflow.md"), "utf8");
  for (const anchor of [
    "Preconditions and scope",
    "Instruction trust and evidence",
    "Paths, locations, and identity",
    "Source snapshots and upstream freshness",
    "Common report header",
    "Coverage and reruns",
    "Completion and durable handoff",
  ]) {
    assert(wf.includes(`## ${anchor}`), `missing workflow section: ${anchor}`);
  }
});

test("no leftover Vordt-report fixture directories in the repo", () => {
  // The repo must not contain generated verbose-keyword files (see keys below).
  for (const d of readdirSync(REPO_ROOT)) {
    if (SKILLS.includes(d)) {
      throw new Error(`generated report dir ${d}/ must not live in the Vordt repo itself`);
    }
  }
});

await finish();
summary();
