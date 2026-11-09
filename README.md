# wbpt — whitebox pentesting skills for Pi

A pipeline of Pi skills for **authorized** whitebox security review of source code you are
permitted to test (e.g. an in-scope bug bounty program that provides source). Analysis and
POC work are sandboxed to local files; nothing here targets production or out-of-scope
systems.

## Pipeline

Run the passes in order. Each pass writes its findings to a directory of the same name
inside the target project root, and keeps its summary in context for the next pass.

| # | Skill | Inputs it consumes | What it produces |
|---|-------|--------------------|------------------|
| 1 | `/skill:scan-structure` | source files | `scan-structure/report.md` — function inventory (desc, inputs, outputs, file:start–end) |
| 2 | `/skill:scan-surface` | `scan-structure/report.md` | `scan-surface/report.md` — every user/external input and how it flows into the code |
| 3 | `/skill:scan-vulns` | structure + surface reports | `scan-vulns/report.md` — candidate vulnerabilities with descriptions and locations |
| 4 | `/skill:exploit` | structure + surface + vulns | `exploit/report.md` + `exploit/poc/` sandbox — POCs; working ones are `VALID`-prefixed |
| 5 | `/skill:report` | all prior reports | `report/report.md` — consolidated report (POCs, repro steps, CVSS, remediation, exec summary) |

Every pass accepts free-text focus (e.g. `/skill:scan-vulns focus on the /admin handlers`),
which restricts or prioritizes where it works.

## Output layout (in the target project)

```
<target-project>/
  scan-structure/report.md
  scan-surface/report.md
  scan-vulns/report.md
  exploit/report.md
  exploit/poc/<vuln-id>-<slug>/   (VALID-* = confirmed working POCs)
  report/report.md
```

## Before you use this

Only run these skills against code you are authorized to test. Confirm scope first. POCs
are intended to demonstrate a vulnerability minimally and locally — never to harm data,
exfiltrate it, or contact systems outside the authorized scope.