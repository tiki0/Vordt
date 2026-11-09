---
name: scan-surface
description: Map external input and trust boundaries using scan-structure. Record attacker control, authentication, ordered transformations, consumers, and terminal uses with exact source locations. Analysis only; run before scan-vulns. Accepts free-text focus.
disable-model-invocation: true
---

# scan-surface — input and trust-boundary mapping

## Preconditions and scope

Read and follow [the shared workflow contract](../references/workflow.md) first.
Require the injected `<VORDT_SCOPE>` block and verify `SCOPE.md` exactly in the configured
project root. Honor authorization and exclusions; focus text can only narrow the scope.

## Required inputs

- `scan-structure/report.md` (or explicitly selected archived snapshots covering the focus).
- Current source, user focus text, and any previous surface report/history for stable IDs.

Check upstream root, scope, source freshness, and coverage before reuse. If the required
structure analysis is missing, stale, or insufficient, write a blocked report identifying
what `/skill:scan-structure` must refresh. Do not fabricate a missing inventory.

## Allowed and prohibited actions

Perform static analysis only. Do not execute/import target code, install dependencies,
craft payloads, contact services, issue vulnerability verdicts, or modify source.
Write assessment artifacts under `scan-surface/`; shared `.vordt/` bookkeeping via
the harness tools is also permitted.

## Procedure

1. Enumerate input boundaries in the declared focus: HTTP routes, queries, bodies,
   headers, cookies, uploads, CLI/stdin, environment/config, files, databases, queues,
   sockets, callbacks, external APIs, and deserialization. Distinguish entrypoints from
   intermediate reads of previously stored input.
2. Assign/reuse `INPUT-...` IDs. Record who controls each input: unauthenticated user,
   authenticated user/role, tenant, external service, operator, or unknown. Environment
   variables and config are not automatically attacker-controlled. Document any required
   second-order write that makes a database/file value attacker-controlled.
3. Check routing, middleware, authentication, authorization, and tenant/object ownership
   controls at entry and during use. Record evidence; absence of observed validation is
   not a vulnerability conclusion in this pass.
4. Trace each input through ordered transformations and branching paths, referencing
   `FUNC-...` IDs and exact source ranges. Record validation before/after decoding,
   normalization, casting, encoding, storage, and use. Note context-specific behavior.
5. Identify trust-boundary crossings and terminal uses (query, process launch, file path,
   template/output, network destination, authorization decision, state change, etc.).
   Include ordinary consumers, not just dangerous-looking sinks. Record consumer inputs,
   outputs/side effects, and where a flow exits the inspected code.
6. Mark each edge observed, inferred, or unknown. Stop a trace at unresolved dynamic
   dispatch, missing dependency internals, or unavailable code; state the exact gap.
   Do not invent a connection to complete a source-to-sink chain.
7. Reconcile entrypoints reviewed against the structure coverage. Report untraced inputs,
   incomplete branches, and uncovered components with counts and continuation steps.

## Output schema

Write `scan-surface/report.md`, archiving the previous report before replacement.
Start with the **common report header**, then include:

```markdown
## Surface coverage
<entrypoint categories, counts, reviewed boundaries, untraced/unknown areas>

## Input points
### INPUT-001 — <name and source type>
- **Location:** <project-relative path>, lines <start>–<end> (inclusive)
- **Description:** <what the input represents and how normal code uses it>
- **Origin/expression:** <external source and exact read/entry expression>
- **Control:** <actor, controllable fields, constraints, direct/second-order, evidence>
- **Authentication/authorization:** <required identity/role/ownership; checked locations>
- **Input/output contract:** <types, defaults, parsing errors, resulting values/side effects>
- **Trust boundaries:** <crossings and control changes, with evidence>

| Step | FUNC ID / location | Transformation or use | Validation/control and order | Evidence status |
| --- | --- | --- | --- | --- |

- **Terminal uses:** <consumer FUNC IDs and ranges; use context and side effects>
- **Unresolved edges:** <exact stopping points and missing evidence; or none>

## Source manifest
<reviewed file digests and tools, per the shared contract>

## Handoff
<the four shared handoff fields>
```

Order input points by source category, then file/line. Reference the source inventory
instead of copying it wholesale. Preserve distinct branches and control assumptions.

## Completion checklist

- [ ] Upstream coverage/freshness validated; current focus and exclusions recorded.
- [ ] Input IDs stable; attacker control distinguished from operator/service control.
- [ ] Authentication, trust boundaries, transformation order, and terminal uses traced.
- [ ] Every claimed edge has evidence status and locations; unresolved edges are explicit.
- [ ] Coverage counts, archived prior report, source manifest, and handoff are present.

## Context handoff

Reply with the report path, coverage, important `INPUT` IDs and traced locations, plus
unknown edges. Recommend flows for `/skill:scan-vulns` to review without declaring them
vulnerable in this pass.
