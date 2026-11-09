---
name: report
description: Compile prior pipeline reports into one submission-ready assessment. Separates verified findings from unverified candidates, preserves stable IDs and evidence links, and adds reproducible POCs, justified CVSS ratings, and concrete remediation. Compiles existing evidence; does not invent or silently rerun tests. Run after exploit (or after scan-vulns if exploitation is not authorized). Accepts free-text focus.
disable-model-invocation: true
---

# report — consolidated assessment write-up

## Preconditions and scope

Read and follow [the shared workflow contract](../references/workflow.md) first.
Require the injected `<VORDT_SCOPE>` block and verify `SCOPE.md` exactly in the configured
project root. This pass compiles existing evidence; it never broadens scope or invents new
findings.

## Required inputs

- `scan-structure/report.md`, `scan-surface/report.md`, `scan-vulns/report.md`.
- `exploit/report.md` and its `poc/` artifacts, if present.
- User focus text (e.g. "executive first", "only HIGH+", "HackerOne format"), and any
  previous final report/history for context and ID continuity.

Validate upstream scope, source freshness, coverage, and verification status. This pass
must not silently refresh stale analysis or run any new test; if an upstream report is
missing, stale, or insufficient, write a blocked report naming the pass to rerun and stop
there. Do not convert a candidate with no execution evidence into a confirmed finding.

## Allowed and prohibited actions

- Summarize and structure prior findings accurately. Preserve `VORDT-...` IDs, root-cause
  locations, confidence, and verification limitations. Never weaken or exaggerate evidence,
  and never retitle to the point of losing an ID or its meaning.
- Verify findings are clearly split: verified via a `VALID` local POC with reproducible
  steps, versus unverified candidates with hypothesized triggers and missing proof.
- Do not execute, import, or contact systems to gather new evidence. Only organize and
  reference evidence already present in the pipeline reports.
- Write only assessment artifacts under `report/`. Never alter source or prior reports.

## Procedure

1. Read all input reports and POC artifacts. Confirm IDs, locations, and verification
   status link correctly across passes. Flag contradictions or gaps.
2. Build the severity summary from supporting impact, prerequisites, and verification
   status. Confidence and runtime proof are separate inputs; do not conflate a verified
   POC with high confidence. A low-impact but proven issue stays low severity.
3. Produce the required report sections in the shared common header and pass schema.
4. For each finding, include reproducible steps only when a confirmed POC exists
   (reference the artifact path and captured output). For unverified candidates, describe
   the hypothesized trigger and what must still be demonstrated, and mark them as
   unverified. Never present a candidate as reproducible without the underlying evidence.
5. Rate CVSS precisely: state the version (3.1 or 4.0), give the vector string and
   calculated numeric result, and justify each metric with quoted facts from reports.
   Where evidence is insufficient to rate honestly, write `not scored — insufficient
   evidence` instead of an inflated number. Do not fabricate metric values.
6. Write remediation as concrete, code-level recommendations tied to each root cause,
   with a library/version, config, or verification note where applicable. Group by
   component and priority in the remediation summary.
7. Write the executive summary in plain, non-technical language: what was tested, the
   most important risks, overall posture, and the top recommendation. Do not claim
   findings verified beyond their evidence.
8. Archive the previous report before replacement and preserve the complete correct
   picture of what remains unexplained.

## Output schema

Write `report/report.md`, archiving any existing report first. Use the **common report
header** followed by:

```markdown
## Executive summary
<plain-language overview: tested scope, top risks, posture, key recommendation>

## Findings
### <VORDT-...> — <title> (<project-root-relative path>, lines <start>–<end>)
- **Status:** verified | candidate (unverified) | blocked
- **Summary:** <1-2 sentence plain-language impact>
- **Technical details:** <root cause, affected FUNC IDs/ranges, attack path with INPUT/FUNC IDs>
- **Proof of concept:** <verified: artifact path, exact command, observed output/effect;
  candidate: hypothesized trigger and missing proof, explicitly unverified>
- **Reproducible steps:** <numbered steps on a clean checkout; only when verified>
- **CVSS severity:** <v3.1/4.0 vector, score, label, per-metric justification; or not scored — insufficient evidence>
- **Remediation:** <concrete code/config changes tied to root cause, verification note>
- **Confidence and verification:** <confidence from scan-vulns; VALID evidence from exploit; or none>

## Remediation summary
<prioritized, grouped by component/theme, referencing finding IDs>

## Appendix
- **Methodology:** <pipeline passes run, tools used, limitations>
- **Source inventory:** <summary pointers to scan-structure>
- **Input surface inventory:** <summary pointers to scan-surface>
- **Evidence artifacts:** <paths to report directories and POC artifacts>
- **Unresolved questions:** <what remains unknown for each finding or scope; or none>
```

Order findings by severity (highest first), then file/line, without renumbering IDs.
Let the report's accuracy honestly reflect the pipeline's coverage and verification state.

## Completion checklist

- [ ] Upstream reports validated and archived before replacement.
- [ ] Split verified vs unverified accurately; IDs and locations carried through.
- [ ] Executive summary, findings, remediation, and appendix are complete.
- [ ] CVSS versioned, justified, or explicitly not scored.
- [ ] Reproducible steps only where a valid POC exists.
- [ ] Common header and handoff fields recorded.

## Context handoff

Reply with the report path, headline findings/severities, which have `VALID` proof, and the
top remediation action. Note anything still unverified so the user can follow up. Reports
on disk remain the durable record.
