---
name: scan-structure
description: Whitebox pentesting pass 1 — analyze a codebase's functionality (no exploitation). Maps every function/class/method with description, inputs, outputs, and precise location (filepath, start line, end line). Use to begin a whitebox security review of provided source code. Run this first; later passes (scan-surface, scan-vulns, exploit, report) depend on its output.
---

# scan-structure — functionality analysis (pass 1)

You are the **first** pass of a whitebox pentesting pipeline for an authorized target
(bug bounty program with source code provided). This pass is **analysis only**: understand
and document *what the code does*. Do **not** attempt exploitation, do not test for
vulnerabilities, do not craft payloads, and do not modify target code.

Armed with the user's focus text (below), map the codebase thoroughly.

## Authorization boundary

Only proceed for code the user is authorized to test (e.g. a bug bounty program in scope,
or code they own). If the request seems to target unauthorized systems, stop and ask for
scope confirmation before doing anything.

## Where to find the target

The target code is the project you were invoked inside (the current working directory
and its subdirectories), *unless* the user's message names a different directory or repo.
If the user names a target path, analyze that instead.

## Output location (required)

Write everything into a directory named after this option, inside the target project root:

```
<TARGET_PROJECT>/scan-structure/
  report.md          <- the findings report (required)
```

Create the directory if it does not exist. If a previous `report.md` exists, **overwrite**
it with the new, complete report (this pass produces a complete snapshot, not an append).
If the user supplied a focus, record it at the top of the report.

## Process

1. Inventory the codebase: list all source files (respect `.gitignore`-style irrelevant
   paths, skip vendored/build/third-party/node_modules/dependency directories unless the
   user's focus says otherwise). Note languages, frameworks, entrypoints.
2. Read the files relevant to the user's focus (or all files if no focus given).
3. For **every** function/method (and top-level class/module where meaningful), determine
   its exact location: filepath, the starting line number, and the ending line number.
   Use tools that reveal line numbers (e.g. `grep -n`, `nl`, or counting lines while
   reading). Report real line numbers from the file — do not guess.
4. Determine, for each function: what it **does** (concise plain-language description),
   its **inputs** (parameters, types, env/config/global state it reads), and its
   **outputs** (return value, side effects, writes, calls made).

## Report format

`report.md` must contain, in order:

```markdown
# scan-structure report

**Target:** `<path to target root>`
**Focus:** `<user-provided focus text, or "none (full codebase)">`
**Date:** `<date>`
**Summary:** `<2-3 sentences on what the codebase is and does>`

## Function inventory

Each entry:

### `<function/method signature>` (`<filepath>`)

- **Location:** lines `<start>`–`<end>` in `<filepath>`
- **Description:** `<what it does>`
- **Inputs:** `<parameters and external state>`
- **Outputs:** `<return value / side effects / calls>`
- **Callers/callees (optional):** `<brief>`
```

Order the inventory by file, then by line number. Group related code so the report reads
like a walkthrough of the codebase, not a bare dump. If the codebase is large and the user
gave a focus, cover the focus areas exhaustively and summarize the rest.

## Keep findings in context

After writing `report.md`, restate a concise **context summary** in your reply: the
codebase's purpose, the main components, and the key functions you documented (with their
file:line locations). This summary is what later passes will build on, so be specific.
Do not silently drop details; if the codebase is huge, note the highest-value areas you
mapped and where to look next.

## Done

End by confirming where `report.md` was written and what the next pass
(`/skill:scan-surface`) should examine, based on your summary.