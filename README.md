# Vordt — whitebox pentesting harness for Pi

A pipeline of Pi skills for **authorized** whitebox security review of source code you are
permitted to test (e.g. an in-scope bug bounty program that provides source). Unless you
set up an explicit isolation layer yourself, analysis is local but **POC execution is not
automatically sandboxed** — you are responsible for the network, filesystem, and process
containment of anything the exploit pass runs.

## Getting started

Vordt requires a **project root** — a directory you set once per engagement — that contains
a mandatory `SCOPE.md` in that exact directory (it is never searched for anywhere else).

1. Put a `SCOPE.md` in the root of the code you are authorized to test.
2. In Pi, set the root:

   ```
   /vordt-root /path/to/target-project
   ```

   The command refuses to set a root that has no `SCOPE.md` inside it.
3. The configured root is shown in the **bottom-left footer status line**, along with a
   warning when the root/scope is invalid. `/vordt-root` with no arguments displays it;
   `/vordt-root clear` or `/vordt-root none` clears it.

**Session-scoped:** validated root state is stored in separate files under
`$PI_CODING_AGENT_DIR/vordt/sessions/` (default `~/.pi/agent/vordt/sessions/`), keyed by
session ID and working directory. There is no global cached-root fallback. Legacy
`vordt.json` roots are deliberately **not migrated**: select the engagement explicitly
after upgrading. While Pi is busy, both root selection and clearing are refused.
Persistence uses per-session locking and atomic writes; failures leave the old state intact.

## SCOPE.md

A plain Markdown file that declares the authorized scope of the engagement. Keep it at the
top level of the project root (for example `/path/to/target-project/SCOPE.md`). A useful
minimum:

```markdown
# Scope

**Program / authorization:** <bug bounty program name, ticket, or contract reference>
**Authorized tester:** <who is allowed to run this>
**In-scope:** <files, endpoints, hosts, or the whole codebase>
**Out-of-scope / do not touch:** <explicit exclusions, production, third parties>
**Rules of engagement:** <what testing is permitted, and anything prohibited>
**Contact / embargo:** <how and where to submit findings>
```

The harness injects the full contents of `SCOPE.md` into every skill invocation, and every
skill is instructed to treat it as binding scope.

## Pipeline

Run the passes in order. Each pass writes its findings to a directory of the same name
inside the project root, and keeps its summary in context for the next pass.

| # | Skill | Inputs it consumes | What it produces |
|---|-------|--------------------|------------------|
| 1 | `/skill:scan-structure` | source files | `scan-structure/report.md` — function inventory (desc, inputs, outputs, file:start–end) |
| 2 | `/skill:scan-surface` | `scan-structure/report.md` | `scan-surface/report.md` — every user/external input and how it flows into the code |
| 3 | `/skill:scan-vulns` | structure + surface reports | `scan-vulns/report.md` — candidate vulnerabilities with descriptions and locations |
| 4 | `/skill:exploit` | structure + surface + vulns | `exploit/report.md` + `exploit/poc/` workspace — POCs; working ones are `VALID`-prefixed, outcomes are `VALID`/`FAILED`/`BLOCKED`/`NOT ATTEMPTED` |
| 5 | `/skill:report` | all prior reports | `report/report.md` — consolidated report (POCs, repro steps, CVSS, remediation, exec summary) |

Every pass accepts free-text focus (e.g. `/skill:scan-vulns focus on the /admin handlers`),
which restricts or prioritizes where it works.

## Enforced gating

The companion extension (`.pi/extensions/vordt.ts`) hard-blocks `/skill:scan-structure`,
`/skill:scan-surface`, `/skill:scan-vulns`, `/skill:exploit`, and `/skill:report`:

- no project root set → blocked, with a prompt to run `/vordt-root <dir>`;
- root set but `SCOPE.md` absent from that root → blocked, with a prompt to create it;
- otherwise, the root path and `SCOPE.md` contents are injected into the invocation.

Each skill also re-checks the injected `<VORDT_SCOPE>` block as a defense-in-depth layer and
refuses to proceed if it is missing. All five skills set `disable-model-invocation: true`,
which keeps them out of automatic model routing so the gated `/skill:` commands are the
normal entry point. That flag is an agent-routing preference, **not a security boundary**:
it does not stop a sufficiently privileged model or user from reading or running the skill
files another way. Treat gating as process guidance, not as a hardwall.

The gate also refuses empty, whitespace-only, symlinked, or oversized `SCOPE.md` files, and
its checks are the single source of truth shared by `/vordt-root`, the footer status, and
the skill gate.

## Deterministic helpers

The extension registers four tools the pipeline agent calls directly to remove error-prone
bookkeeping (the workflow contract explains when to use each):

| Tool | Purpose |
|------|---------|
| `vordt_manifest` | Stream hashes for explicit approved `paths`/`exclusions`; publish an exclusive UTC/UUID inventory with limits/errors recorded |
| `vordt_ids` | Atomically reserve/reuse a `type` + stable source `identity` in `.vordt/ids.json`; optionally adopt a historically backed `existingId` |
| `vordt_archive` | Archive the prior report under **its own** run ID; legacy fallback and collision-safe suffixes |
| `vordt_validate_report` | Check populated shared headers, coverage, scope, pass-specific sections, manifest and handoff—not evidence correctness |

Helpers always use the selected session root. Optional compatibility `root` arguments
must canonically match it. Artifact paths reject traversal and symlink components;
archives/manifests never overwrite existing evidence. Scope authorization is still
interpreted by the agent: inventory paths must be approved before hashing. Inventory
coverage is separate from review coverage. Missing/unreadable paths and size/file-count
limits are explicit partial results, never silently treated as complete.

In non-interactive modes (`print`/`json`), blocked commands emit a custom diagnostic
message and stderr output visible to the caller. Tool failures are signaled as errors.
These filesystem checks are not a sandbox against another process maliciously replacing
ancestors during I/O; use a controlled filesystem and OS containment for hostile code.
An abandoned bookkeeping lock fails closed; inspect it manually after confirming its
owner is no longer running.

## Output layout (in the project root)

```
<project-root>/
  SCOPE.md
  scan-structure/report.md          (+ scan-structure/history/...)
  scan-surface/report.md            (+ scan-surface/history/...)
  scan-vulns/report.md              (+ scan-vulns/history/...)
  exploit/report.md                 (+ exploit/history/...)
  exploit/poc/<vuln-ID>-<slug>/<run-id>/attempt-<N>/  (exclusive; VALID-* only after validation)
  report/report.md                  (+ report/history/...)
  .vordt/manifests/<run-id>.json     (inventory, not proof of review)
  .vordt/ids.json                   (durable ID reservations)
```

Each pass archives the previous report under `<option>/history/<run-id>/` before writing a
new one, so focused or repeated scans never silently erase earlier coverage.

## Before you use this

Only run these skills against code you are authorized to test. Confirm scope first and put
it in `SCOPE.md`. POCs are intended to demonstrate a vulnerability minimally and locally —
never to harm data, exfiltrate it, or contact systems outside the authorized scope. The
exploit pass documents the isolation measures it takes before executing anything; review
them and set up additional containment as your environment requires.

## Using Vordt on a target project

Add the harness to the code you are authorized to test:

1. Copy (or symlink) `.pi/extensions/vordt.ts` into the target project's `.pi/extensions/`.
2. Copy (or symlink) `.agents/skills/` to **`<target>/.agents/skills/`**, retaining the
   five skill directories and `references/`. Pi discovers those project-local resources
   after project trust is accepted; `/reload` (or a restart) picks them up.
3. Create `SCOPE.md` at the target root and run `/vordt-root .` inside that project.

Keep the Vordt repo itself only for development; the target project stays the artifact of
the engagement.

## Repo layout

- `.agents/skills/<name>/SKILL.md` — the five pipeline skills.
- `.agents/skills/references/workflow.md` — the shared contract every skill follows
  (evidence rules, stable IDs, source snapshots, common report header, archiving, handoff).
- `.pi/extensions/vordt.ts` — the harness companion: `/vordt-root`, SCOPE gating, scope
  injection, the bottom-left root display, and the deterministic helper tools.
- `tests/`, `tsconfig.json`, `package.json` + lockfile — `node:test` integration tests
  against the actual extension registration boundary and strict TypeScript checking.

## Development checks

Use Node.js 22.19+ and run `npm ci` followed by `npm run check`. Development dependencies
(Pi types, TypeScript, TypeBox and the TS test loader) are pinned in the lockfile; checks
do not search for a system compiler or the newest installed Pi release. `npm test` and
`npm run typecheck` may also be run separately. Tests use disposable fixtures and mocked
Pi registrations, exercise real handlers/tools, and label environment-dependent skips.
They do not run a live model or prove an OS sandbox. Host-provided Pi/TypeBox imports
remain supplied by Pi at runtime; development dependencies are not engagement payloads.