---
name: blackbox-enum
description: Enumerate an authorized IP, IP:port, hostname, URL, or service locator. Adaptively discover accessible ports, services, webpages, DNS names, vhosts, and subdomains without any vulnerability testing or exploitation. First blackbox pass; accepts a target and free-text focus.
disable-model-invocation: true
---

# blackbox-enum — host and accessible-asset enumeration

## Preconditions and scope

Read and follow [the shared blackbox workflow](../references/blackbox-workflow.md) first.
Require `<BLACKBOX_SCOPE>` and verify the selected root's `SCOPE.md`. Establish network
boundaries and operational limits before contacting any host. Never infer authorization
from a discovery or from the target argument alone.

## Required inputs

- Target supplied in focus or unambiguously identified in scope: IP, IP:port, website,
  hostname, IPv6, or another scoped service locator. Ask if ambiguous or absent.
- User focus/constraints and previous `blackbox-enum/report.md`/history for ID continuity.
- No source code or upstream pass is required.

## Allowed and prohibited actions

Only enumerate what is accessible. Choose appropriate installed tools (nmap, ffuf,
gobuster, dig, curl, browser/protocol tooling, etc.) rather than a rigid tool list.
Gather broad evidence within the explicitly permitted boundary, using bounded benign
probes. Write only `blackbox-enum/` and shared `.blackbox/` bookkeeping.

**No exploitation or vulnerability testing at all:** no injection/traversal payloads,
authentication bypass attempts, password guessing/default-credential testing, exploit
scripts, vulnerability scanners/templates, takeover claims, or state-changing actions.
Do not use nmap aggressive/default script bundles. Benign version identification is not
permission for NSE vulnerability probes. Unexpected sensitive exposure: record minimum
redacted evidence and stop that branch; do not download entire backups or databases.

## Procedure

1. Accept scope, normalize the target without losing original ports, Host/SNI, or URL
   base path, and define a finite coverage plan: allowed hosts, TCP/UDP ports, protocols,
   DNS/wordlists, path depth, rates/concurrency, retries, and time/request budgets. Ask
   before materially expanding the plan. Obtain a run ID and archive the old report.
2. Check local tool availability/versions. Record choices and unavailable alternatives;
   do not install dependencies or escalate privileges automatically.
3. Resolve scoped names where permitted; record A/AAAA/CNAME, relevant DNS records,
   resolution time, resolver, and shared/CDN hosting. Inspect certificate names and
   passive sources only where allowed. Keep unapproved discovered names as unprobed
   leads. Do not perform zone transfers or broad DNS brute force unless scope permits.
4. Determine reachability and enumerate authorized ports/services. A failed ping does
   not prove a host down. Record open/closed/filtered/unknown with exact probe evidence;
   avoid arbitrary full-range or UDP scans when only a service/port is authorized.
   If broad port coverage is authorized, enumerate that range with documented limits.
5. For discovered in-scope services, gather benign protocol/banner/TLS metadata and
   authentication requirements without attempting credentials. Mark technology/version
   guesses inferred. Do not turn version strings into vulnerability findings.
6. For allowed web services, inventory status/headers/titles, links, public client assets,
   robots/sitemap references, and accessible paths/API descriptions. Check redirect
   destinations before following; do not execute downloaded code. Use bounded crawling
   and authorized ffuf/gobuster path/vhost/subdomain discovery when useful. Establish
   random-nonexistent baselines to distinguish wildcard DNS/vhosts, soft-404s, common
   login pages, and identical responses. Compare bodies/status/length, not 200 alone.
7. Verify candidate assets with benign requests where authorized, reserve/reuse `ASSET`
   IDs, record method/protocol/address/port/path/auth visibility and evidence. Separate
   observed-accessible assets from inferred names, unprobed leads, and failed requests.
8. Reconcile the planned/discovered/checked coverage, failures, excluded leads, and
   remaining budget-limited areas. Hash reviewed artifacts and write an honest report.
   Do not explore feature behavior here; hand that inventory to the mapping pass.

## Output schema

Write `blackbox-enum/report.md`, archiving the previous report first. Use the common
report header and evidence paths under `blackbox-enum/evidence/<run-id>/`.

```markdown
## Enumeration summary
<target normalization; observed accessible hosts/services; tool choices and constraints>

## Coverage inventory
| Boundary / technique | Planned range / budget | Checked | Result / evidence | Gaps / exclusions |
| --- | --- | --- | --- | --- |

## Accessible assets
### ASSET-001 — <service, vhost, or webpage>
- **Locator:** <protocol, hostname, resolved IP, port, path, Host/SNI>
- **Accessibility:** <observed/inferred/unknown; status/port state; UTC>
- **Service/technology:** <banner/fingerprint, evidence strength; unknowns>
- **Authentication visibility:** <public/login/role-dependent/unknown; no guessing>
- **Discovery and verification:** <parent ASSET, technique, benign probe, baseline comparison>
- **Evidence:** <sanitized command/request metadata and output artifact paths>
- **Related names/redirects:** <scope decision; unapproved leads NOT probed>
- **Limitations:** <wildcards, timeouts, unverified names, coverage gaps>

## Evidence manifest
<reviewed artifact digests, acquisition windows, tool/version/command metadata>

## Handoff
<the four shared handoff fields>
```

## Completion checklist

- [ ] Target, scope, finite budgets, and observation window recorded.
- [ ] Only discovery/benign identification performed; no vulnerability testing.
- [ ] Accessible assets distinguished from wildcard responses and unprobed leads.
- [ ] Stable ASSET IDs, raw/sanitized evidence, coverage gaps, and prior archive retained.
- [ ] Evidence manifest, final Handoff, and structural validation completed.

## Context handoff

Reply with report path, coverage, main ASSET IDs/services, and gaps. Recommend
`/skill:blackbox-map` for functionality mapping; do not invoke it automatically.
