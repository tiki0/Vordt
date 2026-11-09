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
   warning when `SCOPE.md` is missing.

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

## Output layout (in the project root)

```
<project-root>/
  SCOPE.md
  scan-structure/report.md          (+ scan-structure/history/...)  
  scan-surface/report.md            (+ scan-surface/history/...)  
  scan-vulns/report.md              (+ scan-vulns/history/...)  
  exploit/report.md                 (+ exploit/history/...)  
  exploit/poc/<vuln-ID>-<slug>/     (VALID-* only for actually validated POCs)
  report/report.md                  (+ report/history/...)
```

Each pass archives the previous report under `<option>/history/<run-id>/` before writing a
new one, so focused or repeated scans never silently erase earlier coverage.

## Before you use this

Only run these skills against code you are authorized to test. Confirm scope first and put
it in `SCOPE.md`. POCs are intended to demonstrate a vulnerability minimally and locally —
never to harm data, exfiltrate it, or contact systems outside the authorized scope. The
exploit pass documents the isolation measures it takes before executing anything; review
them and set up additional containment as your environment requires.

## Repo layout

- `.agents/skills/<name>/SKILL.md` — the five pipeline skills.
- `.agents/skills/references/workflow.md` — the shared contract every skill follows
  (evidence rules, stable IDs, source snapshots, common report header, archiving, handoff).
- `.pi/extensions/vordt.ts` — the harness companion: `/vordt-root`, SCOPE gating, and the
  bottom-left root display.