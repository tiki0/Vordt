# Blackbox — Vordt-style remote assessment workflow for Pi

A parallel, source-free workflow for **authorized** blackbox testing. Deliberately mirrors
Vordt: five manually invoked skills, a session-scoped root, mandatory `SCOPE.md`, stable
IDs, archived reports, deterministic helpers, and durable handoffs. Both extensions can
be loaded together: commands, tools, state, scope tags, and output directories are distinct.

## Installation

From this repository:

```bash
mkdir -p ~/.pi/agent/extensions ~/.pi/agent/skills
ln -s "$PWD/extensions/blackbox.ts" ~/.pi/agent/extensions/blackbox.ts
# Skip this link if Vordt's skills directory is already linked here:
ln -s "$PWD/skills" ~/.pi/agent/skills/vordt
```

Use `$PI_CODING_AGENT_DIR` instead of `~/.pi/agent` if configured. Keep this repository at
the linked location. Run `/reload` or restart Pi. The shared skill directory includes both
whitebox and blackbox skills; each set requires its matching extension. For a temporary
extension load, use `pi -e ./extensions/blackbox.ts` (skills still need discovery).

## Engagement setup

Create a local artifact directory, then write its `SCOPE.md` yourself. No target source
code is needed. Include meaningful authorization, exact target boundaries and permitted
methods, exclusions, approved identities, and operational limits. Example (replace with
actual authorization and limits, not permission for someone else's systems):

```markdown
# Scope

- Authorization: <contract/program/ticket, tester, authorized testing window>
- In scope: https://app.example.invalid:443/ and <explicit additional hosts/ports/paths>
- Out of scope: all other hosts, shared infrastructure, third-party integrations
- Enumeration: <permitted ports, DNS/vhost/path discovery, wordlist and crawl budgets>
- Functionality mapping: <approved test accounts/roles and normal state changes>
- Vulnerability checks: <allowed techniques, prohibited checks>
- PoCs: <permitted minimal effects, owned test objects, callbacks and cleanup>
- Limits: <requests/second, concurrency, total requests, timeouts, time window>
- Stop conditions/contact: <instability thresholds and engagement contact>
- Data handling: synthetic test data only; redact credentials and personal data
```

Select that artifact root in Pi:

```text
/blackbox-root /absolute/path/to/engagement
```

No arguments displays the root; `clear`/`none` clears it. Root changes are refused while
Pi is busy. A footer status shows selection/errors. State lives separately under
`$PI_CODING_AGENT_DIR/blackbox/sessions/`, keyed by session ID and cwd. Selecting a Vordt
root does not select a Blackbox root, even if the two use the same directory.

## Pipeline

Invoke each pass yourself. Free text narrows/prioritizes scope, never grants authorization.

| # | Command | Consumes | Produces |
| --- | --- | --- | --- |
| 1 | `/skill:blackbox-enum <target> [focus]` | scope + target | Accessible hosts, ports, services, webpages, vhosts, subdomains |
| 2 | `/skill:blackbox-map [focus]` | enumeration | Normal functionality, roles, inputs/outputs, workflows, side effects |
| 3 | `/skill:blackbox-vulns [focus]` | enumeration + mapping | Candidate findings, bounded check evidence, rejected leads |
| 4 | `/skill:blackbox-poc [finding IDs / constraints]` | all prior passes | Minimal target PoCs; VALID / FAILED / BLOCKED / NOT ATTEMPTED |
| 5 | `/skill:blackbox-report [format / focus]` | inventories + candidates; optional PoCs | Executive summary, findings, evidence, CVSS, remediation |

Targets may be IPv4, IPv6, IP:port (bracket IPv6 with ports), hostnames, URLs with base
paths, or another scoped service locator. For example:

```text
/skill:blackbox-enum https://app.example.invalid:8443/ only the authorized service
/skill:blackbox-map focus on uploads and profile updates
/skill:blackbox-vulns focus on the mapped upload workflow
/skill:blackbox-poc BLACKBOX-001 only, synthetic test object
/skill:blackbox-report executive first
```

The agent chooses installed tools such as nmap, ffuf, gobuster, dig, curl, browsers, or
protocol clients as appropriate. There is no fixed scan runner or automatic dependency
installer. Missing tools, credentials, permissions, or upstream reports are explicit
limitations/blockers. Source analysis is not required; inferred backend causes stay labeled.

**Phase separation:** enumeration and mapping prohibit vulnerability probes/exploitation.
Enumeration identifies accessibility only; mapping observes ordinary behavior. Normal
state changes require permission and controlled test data. Scanning runs bounded permitted
checks, not exploit chains. PoCs separately demonstrate existing candidates minimally.
Reporting makes **no new target requests**, even for freshness; proofs retain observation
windows and do not guarantee the target's current state. PoCs may be omitted for a
candidate-only assessment if exploitation is not authorized.

## Output layout

```text
<engagement-root>/
  SCOPE.md
  blackbox-enum/report.md
  blackbox-enum/evidence/<run-id>/...
  blackbox-map/report.md
  blackbox-map/evidence/<run-id>/...
  blackbox-vulns/report.md
  blackbox-vulns/evidence/<run-id>/...
  blackbox-poc/report.md
  blackbox-poc/poc/<BLACKBOX-id>-<slug>/<run-id>/attempt-<N>/...
  blackbox-report/report.md
  <each-option>/history/<previous-run-id>/report.md
  .blackbox/ids.json
  .blackbox/manifests/<run-id>.json
```

Canonical reports use complete/partial/blocked coverage, a common target/observation-window
header, phase sections, an **Evidence manifest**, and final Handoff. Evidence includes
sanitized commands/requests, tool versions, UTC windows, limits, output/errors, and hashes.
Previous reports and attempt evidence are preserved; focused reruns do not silently claim
broader historical coverage. Stable IDs: `ASSET-*`, `FUNC-*`, `BLACKBOX-*`.

## Extension helpers

| Tool | Purpose |
| --- | --- |
| `blackbox_ids` | Atomically reserve/reuse ASSET, FUNC, BLACKBOX IDs by stable identity |
| `blackbox_manifest` | Hash explicit local evidence paths; not a remote scanner or freshness proof |
| `blackbox_archive` | Preserve the prior phase report under its own run ID |
| `blackbox_validate_report` | Check headers, scope digest, coverage, phase sections and handoff |

Helpers use only the selected session root; optional compatibility `root` must match.
The manifest retains Vordt's bounded hashing/error reporting; any Git metadata describes
only the local artifact workspace, **not a remote deployment revision**. Reports use target
and observation-window fields instead of source revision/file-line requirements.

## Enforcement and limits

The extension gates all five `blackbox-*` skill commands and injects `<BLACKBOX_SCOPE>`.
Root and SCOPE checks reject empty/oversized/unreadable/symlinked scope, unsafe bookkeeping
paths, and mismatched roots. Noninteractive blocks emit diagnostic messages and stderr.
Skills are explicit-only (`disable-model-invocation: true`); they validate authorization,
upstream relevance, and phase boundaries as instructions, not hard execution controls.

**This is not a network or OS sandbox.** Like Vordt, it does not inspect every bash command
or enforce Markdown scope against arbitrary tools. The gate checks file validity, not the
legal sufficiency of its text; upstream phase dependencies and no-exploitation rules are
agent workflow requirements, not extension-enforced packet filtering. Configure external
network/process/filesystem controls and supervise runs as needed. Remote PoCs can change
remote state: local output directories do not contain their effects.

Discovery never automatically expands scope: redirects, DNS/CNAMEs, subdomains, vhosts,
certificate SANs, CDN/shared IPs, and third-party links must be separately authorized
before probing. Ban blind scanner presets and avoid noisy/unbounded defaults. Do not run
these skills against systems you are not permitted to test.

## Development

`npm run check` checks both extensions and both skill sets. Tests run disposable local
fixtures and mocked Pi registration handlers, not real scans or a live model. They cover
gating, session isolation, archives, IDs/concurrency, evidence hashing/limits, report schemas,
phase contracts, and coexistence with Vordt. Workflow-text tests do not prove agent compliance
or containment. Shared contract: `skills/references/blackbox-workflow.md`.
