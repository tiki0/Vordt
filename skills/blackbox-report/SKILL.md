---
name: blackbox-report
description: Compile blackbox pipeline reports into a submission-ready assessment with executive summary, verified versus unverified findings, reproducible POCs, justified CVSS, remediation, and evidence links. Compiles existing evidence only; never silently reruns probes. PoCs optional if not authorized. Accepts free-text format/focus.
disable-model-invocation: true
---

# blackbox-report — consolidated assessment write-up

Adapted from Vordt's report generator: preserve the same evidence discipline, outcome
labels, severity justification, and durable handoff, using remote observations instead
of presumed source-code access.

## Preconditions and scope

Read and follow [the shared blackbox workflow](../references/blackbox-workflow.md) first.
Require `<BLACKBOX_SCOPE>` and verify SCOPE.md at the selected root. Compile existing
evidence; never broaden scope, invent findings, or silently refresh upstream analysis.

## Required inputs

- `blackbox-enum/report.md`, `blackbox-map/report.md`, `blackbox-vulns/report.md`, or
  explicitly selected archived snapshots covering the focus. Record exact paths, run
  IDs, observation windows, and hashes; canonical snapshots need not cover everything.
- `blackbox-poc/report.md` and its artifacts, if used. PoCs are optional when exploitation
  is not authorized: absence does not block a candidate-only assessment. Stale PoC
  evidence cannot establish current verification; qualify it with its observation window,
  omit it with limitations, or request a rerun if the deliverable depends on current proof.
- User focus (e.g. executive first, only HIGH+, HackerOne format) and prior final history.

Validate upstream scope, targets, coverage, local artifact integrity, and evidence status.
Freshness checks are local read/stat/hash only: **no target requests**, even a HEAD, DNS
lookup, TLS handshake, or screenshot refresh. Current remote state is unknown beyond
recorded observations. Missing/stale/insufficient required evidence means a blocked report
naming the pass to rerun. Do not turn a candidate into a confirmed exploit.

## Allowed and prohibited actions

- Summarize prior findings accurately. Preserve `BLACKBOX` IDs, affected locators,
  `ASSET`/`FUNC` links, confidence, observation windows, and verification limitations.
- Split verified findings backed by `VALID` target PoCs from unverified candidates and
  scanner-only leads. Failed/blocked proofs do not show a target is safe or fixed.
- Do not execute/import PoCs or contact systems for new evidence. Do not invent backend
  file/line locations or code-level causes. Recommendations may be implementation-level
  proposals but must be labeled as recommendations, not claims of source inspection.
- Write only `blackbox-report/` and shared `.blackbox/` bookkeeping. Never alter upstream
  reports, target systems, artifacts, scope, or source.

## Procedure

1. Read selected headers/handoffs, then relevant finding/function/asset/PoC sections and
   evidence. Check ID links, context, scope digests, hashes, observation dates, and proof
   criteria. Flag contradictions/gaps; do not load unrelated inventories wholesale.
2. Build the severity summary from supported impact, prerequisites, and evidence status.
   Confidence and runtime proof are separate; a proven low-impact issue stays low severity.
3. Produce the common header and required sections. Obtain a run ID and archive the old
   final report before replacement. Preserve unverified, failed, and blocked outcomes.
4. For confirmed PoCs, provide reproducible steps referencing exact target context,
   approved roles/test objects, sanitized requests/commands, versions, controls, output,
   and artifacts. Steps describe recorded tests, not permission to attack again. For
   candidates provide hypothesized triggers and missing proof, explicitly unverified;
   never imply candidate steps were successfully reproduced.
5. Rate CVSS precisely: state v3.1 or v4.0, vector, calculated numeric score, and metric
   justification grounded in recorded facts. If insufficient, write `not scored —
   insufficient evidence`; do not fabricate metrics or inflate speculative impact.
6. Give concrete remediation tied to the violated property: server-side ownership checks,
   safe APIs, input/output handling, upload isolation, configuration/library changes, or
   other supported measures. Internal implementation is normally unknown; distinguish
   suggested fixes from observed code facts. Include a retest criterion per finding.
7. Write a plain-language executive summary: tested boundary, key risks, limitations,
   evidence strength, and highest-priority recommendation. No blanket security claims.
8. Hash reviewed local evidence/reports, verify citations, retain complete limitations,
   and run structural validation. No new probes to fill report gaps.

## Output schema

Write `blackbox-report/report.md`, archiving its previous version first. Use the common
report header followed by:

```markdown
## Executive summary
<tested scope/window, top risks, evidence strength, limitations, key recommendation>

## Findings
### BLACKBOX-001 — <title> (<host:port / route / method / affected action>)
- **Finding verification:** verified | candidate (unverified)
- **POC outcome:** VALID | FAILED | BLOCKED | NOT ATTEMPTED | none — <upstream run/result>
- **Summary:** <plain-language impact>
- **Affected surface:** <ASSET/FUNC IDs, locators, input, auth/tenant context>
- **Technical details:** <observed behavior, security property, attack path, controls;
  internal root cause unknown/inferred unless independently supported>
- **Proof of concept:** <verified: artifact/command/request and observed effect;
  candidate: explicitly unverified hypothesis and missing proof>
- **Reproducible steps:** <only when VALID: recorded target/window, accounts/test data,
  versions, steps, controls, evidence hashes, safeguards/cleanup; otherwise not established>
- **CVSS severity:** <v3.1/4.0 vector/score/label and each metric's factual justification;
  or not scored — insufficient evidence>
- **Remediation:** <concrete proposed implementation/config changes and retest criterion>
- **Confidence and verification:** <upstream confidence, proof window and limitations>

## Remediation summary
<prioritized by component/theme, stable finding IDs, proposed fix and retest criteria>

## Evidence manifest
<reviewed local artifact/report digests, acquisition windows, metadata/tool references>

## Appendix
- **Methodology:** <passes/tools/checks run; observation windows and limitations>
- **Accessible asset inventory:** <pointers to blackbox-enum>
- **Functionality inventory:** <pointers to blackbox-map>
- **Evidence artifacts:** <candidate reports, PoC attempts, raw sanitized evidence>
- **Unresolved questions:** <missing proof, excluded roles/assets, drift and blockers>

## Handoff
<the four shared handoff fields>
```

Order findings by severity then affected locator without renumbering. Include no-findings
results honestly: no issues established within the tested boundary is not proof of safety.

## Completion checklist

- [ ] Upstream evidence/context validated locally; no network activity.
- [ ] Verified vs candidate and exact PoC outcomes preserved with stable IDs.
- [ ] Executive summary, findings, remediation, appendix, evidence citations complete.
- [ ] CVSS versioned/justified or not scored; no invented source locations/causes.
- [ ] Reproducible successful steps only for VALID target proofs.
- [ ] Previous archive, common header, Evidence manifest, Handoff, validator complete.

## Context handoff

Reply with report path, coverage, headline severities, which IDs have VALID proof, and
top remediation. Note unverified evidence and temporal limitations; disk is the durable
record, not chat memory.
