---
name: scan-vulns
description: Whitebox pentesting pass 3 — vulnerability identification. Consumes scan-structure and scan-surface reports, finds likely vulnerabilities in the code (injection, authz/authn flaws, unsafe deserialization, path traversal, SSRF, RCE, logic flaws, crypto misuse, etc.), and documents each with description, affected functions, and precise location (filepath, start line, end line). Use after scan-surface, before exploit.
---

# scan-vulns — vulnerability identification (pass 3)

You are the **third** pass of a whitebox pentesting pipeline for an authorized target
(bug bounty program with source code provided). Using the prior analysis, identify and
document **candidate vulnerabilities**. This pass is **static analysis and reasoning** —
do not execute attacks, do not run exploits, do not contact remote systems, and do not
modify target code. Real exploitation is the next pass (`/skill:exploit`).

## Inputs (required reading first)

Read **both** prior reports before analyzing:

```
<TARGET_PROJECT>/scan-structure/report.md
<TARGET_PROJECT>/scan-surface/report.md
```

If either is missing, stop and tell the user to run the missing pass first.
Honor the user's focus text: narrow or prioritize your vulnerability hunting accordingly.

## Authorization boundary

Only analyze in-scope, authorized code. If scope is unclear, confirm first.

## Output location (required)

```
<TARGET_PROJECT>/scan-vulns/
  report.md          <- the findings report (required)
```

Create the directory if needed. Overwrite any previous `report.md` with the complete,
current snapshot. Record the user's focus at the top.

## Process

1. Cross-reference the input flows from `scan-surface` against the function inventory from
   `scan-structure`. For each flow, reason about whether the input can reach a dangerous
   sink unsafely or violate the code's security assumptions.
2. Consider common classes: SQL/NoSQL/command/LDAP/XPATH/expression injection,
   XSS/output-encoding gaps, path traversal, file inclusion, unsafe deserialization,
   SSRF, open redirects, broken authentication/authorization/IDOR, privilege escalation,
   missing rate limiting, weak or hardcoded secrets, crypto misuse, XXE, template injection,
   memory safety/unsafe usage (for C/C++/Rust), and application-specific logic flaws.
3. For each candidate vuln, identify the **root cause**, the **affected function(s)** and
   their filepaths, and the exact start/end line numbers (read the real lines, do not guess).
4. Triage honestly: mark each finding with a **confidence** (confirmed / likely / possible)
   and a **tentative severity**. This pass may reason, but it must not claim a finding is
   exploitable until verified in `/skill:exploit`.

## Report format

```markdown
# scan-vulns report

**Target:** `<path>`
**Focus:** `<user focus, or "none (full codebase)">`
**Date:** `<date>`
**Summary:** `<number of findings by severity; top 3 concerns>`

## Findings

Each finding:

### `<VULN-ID>-<short-slug>` — `<vulnerability class>` (`<filepath>`, lines `<start>`–`<end>`)

- **Description:** `<what the flaw is and why it is dangerous>`
- **Root cause:** `<the actual coding mistake/absence>`
- **Attack path:** `<input source -> vulnerable function(s), with file:line>`
- **Affected functions:** `<function signatures with file:start-end each>`
- **Prerequisites/conditions:** `<what must hold for exploitation>`
- **Impact:** `<what an attacker could do>`
- **Confidence:** `confirmed | likely | possible`
- **Severity (tentative):** `CRITICAL | HIGH | MEDIUM | LOW | INFO`
- **References (optional):** `<CWE, OWASP, docs>`
```

Order findings by severity (highest first), then by file/line. If the user gave a focus,
be exhaustive within it and note areas not yet reviewed.

## Keep findings in context

After writing `report.md`, restate in your reply a **context summary**: list each finding
with its ID, class, severity, and root-cause file:line. Highlight which findings are strong
exploitation candidates for `/skill:exploit` and what the POC would need to demonstrate.

## Done

Confirm where `report.md` was written and recommend the order in which to run
`/skill:exploit` against the findings.