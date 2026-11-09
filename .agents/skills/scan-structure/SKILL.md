---
name: scan-structure
description: Map source functionality without vulnerability testing. Document every in-scope function's behavior, inputs, returns, exceptions, side effects, and exact location. Run before scan-surface; accepts free-text focus.
disable-model-invocation: true
---

# scan-structure — functionality inventory

## Preconditions and scope

Read and follow [the shared workflow contract](../references/workflow.md) first.
Require the injected `<VORDT_SCOPE>` block and verify `SCOPE.md` exactly in the configured
project root. Stop if scope is missing, invalid, or does not permit the requested analysis.

## Required inputs

- Source within the configured root and scope.
- User focus text, if supplied; record it verbatim and define the coverage boundary.
- Previous `scan-structure/report.md` and relevant history, if present, for stable IDs
  and prior coverage. No earlier pipeline pass is required.

## Allowed and prohibited actions

Perform read-only functionality analysis. Use trusted static parsers/text tools where
available, without importing or executing target modules, build scripts, dependency
install hooks, or tests. Do not hunt vulnerabilities, craft payloads, contact target
services, or modify target code. Write only assessment artifacts under `scan-structure/`.

## Procedure

1. Inventory source files, languages, frameworks, entrypoints, and relevant config.
   Record included, excluded, and unreviewed paths with reasons. Apply the shared
   artifact exclusions; do not scan your own generated reports as application source.
2. Map modules, entrypoints, major components, and the normal control/data flow before
   describing individual functions. Identify dependencies whose internals are unavailable.
3. Enumerate every callable within the coverage boundary: functions, methods, constructors,
   accessors, nested functions, and lambdas/anonymous callbacks. Give unnamed callables a
   descriptive label and source range. Document overload declarations separately from
   implementations; count executable definitions separately. Include class/module
   descriptions where helpful, but do not count them as functions unless callable.
4. Include first-party test functions by default, labeled as tests. Exclude vendored and
   generated code by default and state the exclusion; inspect them if explicitly in scope.
   Use language-aware static enumeration if available and record parser limitations.
   A text-only enumeration cannot prove completeness; disclose uncertain constructs.
5. Read each implementation. Assign/reuse a `FUNC-...` ID and verify its project-relative,
   inclusive 1-based range. Document parameters, external state, returns, exceptions,
   and side effects separately. Mark inferred types and unresolved dispatch explicitly.
6. Reconcile the discovered callable list with documented entries. Report counts by file,
   missing entries, parse failures, and remaining work. If time/context limits intervene,
   save a partial report and a precise continuation list rather than claiming all functions.

## Output schema

Write `scan-structure/report.md`, preserving the previous report under `history/` before
replacement. Start with the **common report header**, then include:

```markdown
## Architecture and normal behavior
<codebase purpose, components, entrypoints, dependencies, major control/data flows>

## Coverage inventory
| File | Callable definitions discovered | Documented | Status / exclusions / uncertainty |
| --- | --- | --- | --- |

## Function inventory
### FUNC-001 — <qualified signature or anonymous-callable label>
- **Kind:** <function/method/constructor/accessor/lambda; production/test; declaration/implementation>
- **Location:** <project-relative path>, lines <start>–<end> (inclusive)
- **Description:** <normal behavior and responsibility>
- **Inputs:** <parameters, defaults, types; inferred types labeled; external state read>
- **Returns:** <values/types; async or generator behavior; or no return>
- **Exceptions/errors:** <raised/rejected/handled errors; or unknown>
- **Side effects:** <writes, state changes, I/O, external calls; or none observed>
- **Callers/callees:** <checked FUNC IDs and locations; unresolved/dynamic calls labeled>
- **Evidence/uncertainties:** <observed vs inferred details, relevant source references>

## Source manifest
<reviewed file digests and tools, per the shared contract>

## Handoff
<the four shared handoff fields>
```

Order functions by file and starting line. Do not omit functions merely because their
names appear routine. Distinguish known exclusions from files not yet reviewed.

## Completion checklist

- [ ] Scope, snapshot, focus boundary, and upstream/history metadata recorded.
- [ ] Architecture described; callable inventory reconciled with documented counts.
- [ ] Every documented callable has a stable ID and checked range.
- [ ] Inputs, returns, errors, and side effects are distinct; uncertainty is explicit.
- [ ] Coverage accurately says complete, partial, or blocked; previous report preserved.
- [ ] Source manifest and durable handoff written.

## Context handoff

Reply with the report path, coverage, main components, key `FUNC` IDs/locations, and gaps.
Recommend the entrypoints `/skill:scan-surface` should trace next. Do not rely on this chat
summary as the only record.
