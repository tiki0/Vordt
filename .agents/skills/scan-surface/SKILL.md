---
disable-model-invocation: true
name: scan-surface
description: Whitebox pentesting pass 2 — attack surface mapping. Consumes the scan-structure report and finds every point of user/external input and traces how that input flows into the code. Outputs per-input descriptions, the functions it touches, and precise locations (filepath, start line, end line). Use after scan-structure, before scan-vulns.
---

# scan-surface — attack surface mapping (pass 2)

You are the **second** pass of a whitebox pentesting pipeline for an authorized target
(bug bounty program with source code provided). Build the **attack surface**: find every
point where untrusted input (user, network, file, environment, external API) enters the
code and trace how it is used. This is **analysis only** — no exploitation, no payloads,
no vulnerability verdicts yet. Do not modify target code.

## Scope & project root (MANDATORY)

This skill is gated by the Vordt harness: it runs only when a project root is set
(`/vordt-root <dir>`) and `SCOPE.md` exists in that directory. The invocation includes a
`<VORDT_SCOPE>` block with the `project-root` and the full contents of `SCOPE.md`. Read it
first and treat it as binding scope. If it is missing, stop and report that the gate was
not applied.

## Inputs (required reading first)

Before mapping, read the prior pass's output:

```
<PROJECT_ROOT>/scan-structure/report.md
```

It contains the function inventory you will trace against. If it is missing, stop and
tell the user to run `/skill:scan-structure` first.

Also honor the user's focus text in this invocation — restrict or emphasize the surface
you map accordingly.

## Authorization boundary

Only proceed for code in scope per `SCOPE.md`. If scope is unclear, confirm first.

## Output location (required)

```
<PROJECT_ROOT>/scan-surface/
  report.md          <- the findings report (required)
```

Create the directory if needed. Overwrite any previous `report.md` with the complete,
current snapshot. Record the user's focus at the top.

## Process

1. From `scan-structure/report.md` and (re)reading source files, enumerate **input
   sources**: HTTP endpoints/route handlers, parameter parsing (query, body, headers,
   cookies), file uploads/reads, CLI args, env vars, config files, database reads,
   sockets/queues/event sources, imports, deserialization points (JSON/XML/YAML/binary
   parsing), etc.
2. For each input point, trace its **flow** through the functions documented in
   `scan-structure` — variable names, transformations (validation, sanitization, encoding,
   casting), and the sinks/intermediate functions that consume it. Note whether/how the
   input is validated or sanitized, but do not classify as a vuln here.
3. Record exact locations (filepath, start line, end line) for the input point and for the
   functions it reaches, using real line numbers from the files.

## Report format

```markdown
# scan-surface report

**Target:** `<path>`
**Focus:** `<user focus, or "none (full codebase)">`
**Date:** `<date>`
**Summary:** `<total input points found; categories covered>`

## Input points

Each entry:

### `<input name>` — `<source type>` (`<filepath>`, lines `<start>`–`<end>`)

- **Description:** `<where the input comes from and what it represents>`
- **Origin:** `<user/network/file/env/... and the exact entry expression>`
- **Validation/sanitization observed:** `<none | what happens and where>`
- **Flow:** `<ordered trace: input -> function A (file:line) -> function B (file:line) -> ... -> sink/use>`
- **Consumers:** `<functions that use it, with file:start-end each>`
- **Notes:** `<type assumptions, error handling, anything that affects the trace>`
```

Order by source type, then by file/line. If the user gave a focus, be exhaustive within it
and summarize the rest.

## Keep findings in context

After writing `report.md`, restate in your reply a **context summary** of the surface:
group inputs by source type, and for the highest-value inputs give the traced flow with
file:line locations. This is what `/skill:scan-vulns` will consume.

## Done

Confirm where `report.md` was written and summarize the most promising input flows for the
next pass (`/skill:scan-vulns`).