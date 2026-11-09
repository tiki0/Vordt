---
name: report
description: Whitebox pentesting pass 5 — final report compilation. Consumes all prior reports (scan-structure, scan-surface, scan-vulns, exploit) and produces one consolidated MD report: per-finding proof-of-concept, reproducible steps, CVSS severity, remediation guidance, and an executive summary. Use after exploit (or after scan-vulns if no exploitation was authorized/possible).
---

# report — consolidated writeup (pass 5)

You are the **final** pass of a whitebox pentesting pipeline for an authorized target
(bug bounty program with source code provided). Compile everything into a single,
submission-ready report — and stay honest about what is verified vs. theoretical.

## Inputs (required reading first)

Read all prior reports:

```
<TARGET_PROJECT>/scan-structure/report.md
<TARGET_PROJECT>/scan-surface/report.md
<TARGET_PROJECT>/scan-vulns/report.md
<TARGET_PROJECT>/exploit/report.md      (if it exists)
```

`exploit/report.md` may be absent if exploitation was not authorized or not yet run; in
that case the report still stands on `scan-vulns` findings but must clearly mark which
items lack a verified POC. Honor the user's focus text (e.g. "executive summary first",
"only HIGH+", "format for HackerOne").

## Output location (required)

```
<TARGET_PROJECT>/report/
  report.md          <- the consolidated report (required)
```

Create the directory if needed. Overwrite any previous `report.md`.

## Report format

Produce `report.md` with these sections:

```markdown
# Whitebox security assessment — <target name>

**Target:** `<path>`
**Scope / focus:** `<authorized scope and user focus>`
**Date:** `<date>`
**Assessors note:** `<pipeline passes run; honesty about verification status>`

## Executive summary

<A concise, non-technical overview: what was tested, the most important risk,
the overall posture, and the key recommendation. 1-3 short paragraphs plus, if useful,
a severity summary table with counts.>

## Findings

One section per finding, ordered by severity (highest first):

### `<VULN-ID>-<slug>` — `<title>` (`<filepath>`, lines `<start>`–`<end>`)

- **Summary:** `<1-2 sentence plain-language impact>`
- **Technical details:** `<root cause, affected functions, attack path (file:line)>`
- **Proof of concept:**
  - `<If verified> A step-by-step or code reproduction that a reviewer can run. Reference
    and include the VALID POC from exploit/poc/. Show the observed output/effect.`
  - `<If not verified> State clearly this is unverified: the hypothesized trigger and
    what still needs to be demonstrated. Do not imply it was confirmed.`
- **Reproducible steps:** `<numbered steps to reproduce from a clean checkout/environment>`
- **CVSS severity:** `<vector string, base score, and severity label, with a one-line
  justification for each metric you set>`
- **Remediation:** `<concrete, specific fix guidance tied to the root cause, including
  code-level or config-level changes and a verification/test note>`

## Remediation summary

<Group recommendations by theme/component, prioritized. Reference the finding IDs.>

## Appendix

- **Methodology:** `<the passes run, tools/harness used, and any limitations>`
- **Source inventory:** `<key files reviewed, from scan-structure>`
- **Input surface inventory:** `<summary pointer to scan-surface>`
- **Artifacts:** `<paths to the per-pass report directories>`
```

For CVSS, prefer CVSS v3.1 (or note if you use v4.0). Compute the base score from the
actual reported attributes (attack vector, complexity, privileges required, user
interaction, scope, confidentiality/integrity/availability impact). Do not invent inflated
scores; justify each metric briefly.

## Keep findings in context

After writing `report.md`, restate in your reply a **context summary** of the final report:
the top findings, their severities, which have verified POCs, and the headline remediation
recommendation.

## Done

Confirm where `report.md` was written and note anything still unverified so the user can
follow up (e.g. with `/skill:exploit`).