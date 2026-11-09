// Strict type-check of the extension against the installed Pi's type surface.
//
// Run: npm run typecheck

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { REPO_ROOT, piNodeModules, findTsc, makeTempDir } from "./lib.mjs";

const tsc = findTsc();
if (!tsc) {
  console.error("No TypeScript compiler available. Install typescript or put `tsc` on PATH.");
  process.exit(1);
}

const nm = piNodeModules();
if (!nm) {
  console.error("Pi install not found — cannot resolve @types/node.");
  process.exit(1);
}

const tmp = makeTempDir(join(REPO_ROOT, ".tmp"), "typecheck");
const srcDir = join(tmp, "src");
mkdirSync(srcDir, { recursive: true });
const copied = join(srcDir, "vordt.ts");
copyFileSync(join(REPO_ROOT, ".pi", "extensions", "vordt.ts"), copied);
const nmLink = join(srcDir, "node_modules");
if (!existsSync(nmLink)) symlinkSync(nm, nmLink, "dir"); // resolve typebox + pi types

const cfg = join(tmp, "tsconfig.json");
writeFileSync(
  cfg,
  JSON.stringify(
    {
      compilerOptions: {
        target: "es2022",
        module: "esnext",
        moduleResolution: "bundler",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        typeRoots: [join(nm, "@types")],
        types: ["node"],
      },
      files: [copied],
    },
    null,
    2,
  ),
);

try {
  const out = execFileSync(tsc, ["-p", cfg], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  console.log("Typecheck passed.");
  console.log(out.trim());
} catch (err) {
  process.stdout.write(err.stdout ?? "");
  process.stderr.write(err.stderr ?? "");
  console.error("\nTypecheck FAILED.");
  process.exit(1);
}
