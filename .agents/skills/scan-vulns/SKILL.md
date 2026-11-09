---
name: scan-vulns
description: Identify and triage candidate vulnerabilities using structure and surface reports. Check reachability, protections, root causes, and counter-evidence; distinguish confidence from runtime verification. Static analysis only; accepts free-text focus. Run before exploit.
disable-model-invocation: true
---

# scan-vulns — evidence-based vulnerability triage

## Preconditions and scope

Read and follow [the shared workflow contract](../references/workflow.md) first.
Require the injected `<VORDT_SCOPE>` block and verify `SCOPE.md` exactly in the configured
project root. Do not broaden authorized scope to investigate an interesting lead.

## Required inputs

- `scan-structure/report.md` and `scan-surface/report.md`, or explicitly selected archived
  snapshots covering the current focus.
- Current source, user focus, and previous vulnerability reports/history for stable IDs.

Validate upstream scope, freshness, and coverage. If either required analysis is absent,
stale, or insufficient, write a blocked report naming the pass and areas to refresh.

## Allowed and prohibited actions

Perform static analysis and reasoning only. Do not execute/import target code, install
its dependencies, craft/run exploits, contact services, or modify target source.
Write assessment artifacts only under `scan-vulns/`. Runtime validation belongs to exploit.

## Procedure

1. Follow mapped inputs and security-sensitive decisions in current source. Also inspect
   non-input-driven issues such as unsafe defaults, secrets handling, cryptography,
   concurrency, lifecycle, and business invariants where relevant to scope.
2. Consider applicable vulnerability classes, not a checklist of guaranteed findings:
   injection, unsafe output/templating, traversal, deserialization, SSRF, authentication,
   authorization/IDOR/tenant isolation, memory safety, races, crypto misuse, and logic flaws.
   Explain why a missing control is security-relevant; do not report absent rate limiting
   or validation alone without an actionable attack path and impact.
3. For each candidate, trace actor control, reachability, root cause, violated security
   property, prerequisites, and impact. Reference `INPUT` and `FUNC` IDs and checked ranges.
4. Search for counter-evidence: upstream validation, middleware, authorization/ownership
   checks, framework guarantees, safe APIs, configuration, feature flags, deployment
   conditions, and unreachable code. Cite checked locations and missing evidence.
5. Separate facts from hypotheses. Assign **confidence** (`high`, `medium`, `low`) based
   on evidence strength and explain it. Set **verification status** to `static-only` for
   this pass; confidence is not runtime confirmation. Prior runtime evidence may be
   linked with its source revision, but must not be silently treated as current validation.
6. Assign/reuse `VORDT-...` IDs. Deduplicate by root cause and record multiple paths/impacts
   together where appropriate. Use tentative severity reflecting supported impact and
   prerequisites, not worst-case speculation. Keep severity independent of confidence.
7. Retain rejected candidates with rejection reasons and evidence so later agents do not
   resurrect them blindly. List unknowns and unreviewed areas. No findings means no
   findings established within this coverage—not proof of security.

## Output schema

Write `scan-vulns/report.md`, archiving the previous report before replacement.
Start with the **common report header**, then include:

```markdown
## Triage summary
<counts by tentative severity and confidence; coverage limitations>

## Candidate findings
### VORDT-001 — <title / vulnerability class>
- **Root-cause location:** <project-relative path>, lines <start>–<end> (inclusive)
- **Description:** <coding flaw and violated security property>
- **Evidence:** <checked source excerpts/references; observed vs inferred claims>
- **Attack path:** <INPUT ID -> FUNC IDs and ranges -> affected use>
- **Affected functions:** <qualified signatures and whole-function ranges>
- **Prerequisites:** <actor control, authentication, deployment/configuration conditions>
- **Impact:** <supported consequence and affected assets; speculation labeled>
- **Counter-evidence checked:** <protections considered, locations, why insufficient>
- **Unresolved assumptions:** <missing proof and how it affects the conclusion>
- **Confidence:** high | medium | low — <evidence-based rationale>
- **Verification status:** static-only
- **Tentative severity:** CRITICAL | HIGH | MEDIUM | LOW | INFO — <rationale>
- **Classification:** <CWE/reference when supported; otherwise unknown>
- **Suggested validation:** <minimal local success criterion; no attack execution here>

## Rejected candidates
<candidate/previous ID, reason, checked protection or disproof, evidence location>

## Source manifest
<reviewed file digests and tools, per the shared contract>

## Handoff
<the four shared handoff fields>
```

Order findings by tentative severity, then file/line; never renumber stable IDs to match
that order. List old IDs outside the focus as not reassessed rather than silently fixed.

## Completion checklist

- [ ] Upstream reports validated; current source and scope identified.
- [ ] Each candidate has stable ID, root-cause range, reachability, and supported impact.
- [ ] Counter-evidence checked; unknowns and rejected candidates retained.
- [ ] Confidence, severity, and verification status are separate and honest.
- [ ] Coverage, archived prior report, source manifest, and handoff are complete.

## Context handoff

Reply with the report path, coverage, candidate IDs, tentative severity, confidence, and
root-cause locations. Prioritize `/skill:exploit` candidates and state what each local
POC would need to prove, including unresolved prerequisites.
