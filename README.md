# Vordt — whitebox and blackbox pentesting workflows for Pi

Scope-gated skills and extensions for **authorized** security assessments:

- **Whitebox:** inspect source → map inputs → triage vulnerabilities → local PoCs → report.
- **Blackbox:** enumerate accessible assets → map functionality → scan vulnerabilities →
  attempt scoped PoCs → report. No target source code required.
- **Blackbox orchestrator:** coordinate a finite, user-approved plan using separate Pi
  subagents, each invoking a literal `/blackbox-<phase>` command.

Both workflows keep stable IDs, evidence manifests, archived reports, and durable handoffs.
**Neither workflow is an OS/network sandbox.** Scope interpretation and phase restrictions
are agent instructions; use external containment and supervise testing as appropriate.

## Install globally

From this repository, link both extensions and the shared skills directory:

```bash
PI_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
mkdir -p "$PI_DIR/extensions" "$PI_DIR/skills"
ln -s "$PWD/extensions/vordt.ts" "$PI_DIR/extensions/vordt.ts"
ln -s "$PWD/extensions/blackbox.ts" "$PI_DIR/extensions/blackbox.ts"
ln -s "$PWD/skills" "$PI_DIR/skills/vordt"
```

Skip links that already point here; inspect existing files before replacing them. Keep
this repository at the linked location. The Blackbox extension resolves its worker helpers
from this repository, so they do not need separate global links. The skills link includes
all five whitebox skills, five blackbox phase skills, and the coordinator skill.

Run **`/reload`** or restart Pi. Global installation makes the workflows available in other
projects; engagement roots remain explicitly selected **per session**. No project-local
installation is needed. You can load either extension independently, but each workflow
requires its matching extension.

## Scope and engagement roots

Create `SCOPE.md` yourself in the exact directory selected as the engagement root:

```markdown
# Scope

- Authorization: <program/contract/ticket, tester, testing window>
- In scope: <source paths OR exact hosts, protocols, ports, URL paths>
- Out of scope: <exclusions, production restrictions, third parties>
- Permitted methods: <enumeration, mapping, vulnerability checks, PoC effects>
- Operational limits: <rates, concurrency, request/time budgets, stop conditions>
- Test identities/data: <approved accounts, roles, owned objects, cleanup rules>
- Contact/data handling: <engagement contact, redaction and retention requirements>
```

For whitebox, select the authorized source directory:

```text
/vordt-root /path/to/source-project
```

For blackbox, select a local artifact directory; no source checkout is required:

```text
/blackbox-root /path/to/engagement
```

Both commands require a readable, nonempty `SCOPE.md` directly inside that directory.
It is never searched for elsewhere. No arguments displays the current root; `clear` or
`none` clears it. Root changes are refused while Pi is busy. Footer status shows the
selection and scope errors.

The two roots are independent, even when they refer to the same directory. State is
stored under `$PI_CODING_AGENT_DIR/{vordt,blackbox}/sessions/` (default `~/.pi/agent/`),
keyed by session ID and working directory. There is no global-root fallback; legacy
`vordt.json` roots are deliberately not migrated.

The extension injects the selected root, scope contents, and SHA-256 digest into gated
skill invocations. Skills must verify authorization and restrictions before proceeding.
**A target argument or nonempty scope file is not proof of permission.** Focus narrows
scope; discoveries, redirects, DNS names, shared IPs, and third-party links do not expand it.

## Blackbox quick start

After setting `/blackbox-root`, run individual phases manually:

| Command | Purpose | Main output |
| --- | --- | --- |
| `/blackbox-enum <target> [focus]` | Discover accessible ports, services, webpages, vhosts, subdomains; **no vulnerability testing** | `blackbox-enum/report.md` |
| `/blackbox-map [focus]` | Map normal functionality, inputs, roles, workflows and side effects; **no vulnerability testing** | `blackbox-map/report.md` |
| `/blackbox-vulns [focus]` | Perform permitted bounded checks and triage candidates | `blackbox-vulns/report.md` |
| `/blackbox-poc [IDs / constraints]` | Attempt minimal proofs for existing candidates | `blackbox-poc/report.md` + `poc/` artifacts |
| `/blackbox-report [format / focus]` | Compile existing evidence, CVSS and remediation; **no new target requests** | `blackbox-report/report.md` |

Short commands forward to the same scope-gated `/skill:blackbox-<phase>` invocations.
Targets may be IPv4, IPv6, IP:port (bracket IPv6 when specifying a port), hostnames, URLs
with base paths, or other explicitly scoped service locators. The agent chooses installed
tools such as nmap, dig, ffuf, gobuster, curl, browsers, or protocol clients within the
phase boundary and operational limits. It does not install missing tools automatically.

### Orchestrated subagents

```text
# Default: enumeration → mapping only
/blackbox-orchestrate https://app.example.invalid

# Enumeration → mapping → vulnerability scanning → report; no PoCs
/blackbox-orchestrate --through=report https://app.example.invalid

# Full pipeline, explicitly including PoC attempts
/blackbox-orchestrate --through=report --with-poc https://app.example.invalid

# Resume after reviewing/resolving a blocker, with valid upstream reports
/blackbox-orchestrate --from=map --through=report --timeout=900 https://app.example.invalid
```

Flags precede target/focus text. `--from` and `--through` accept `enum`, `map`, `vulns`,
`poc`, or `report`. PoC delegation always requires `--with-poc`. Worker timeout defaults
to 1800 seconds per phase (allowed range: 10–7200 seconds).

The coordinator delegates through `blackbox_orchestrate` with a one-use command-approved
plan. Workers run **sequentially**, each in a separate Pi process/context, inheriting the
parent's model selection and thinking level. Each worker loads only its phase skill,
Blackbox helpers, and core read/bash/edit/write tools. Other discovered extensions, MCP,
context files, prompt templates, and project trust-gated resources are disabled. Providers
registered only by disabled extensions are not inherited. Child API usage is billed by
the provider but is not aggregated into the parent's footer totals.

The coordinator stops on failed workers, timeout/cancellation, scope changes, invalid or
unchanged reports, or partial/blocked coverage. It does not silently retry or expand the
plan. Complete PoC passes may contain FAILED/BLOCKED attempt outcomes; these are preserved
for reporting, not converted into proof of safety. Workers must stop if noninteractive
clarification is needed. Resume only after reviewing the blocker and upstream relevance.

Progress is saved to **`.blackbox/orchestrations/<run-id>/state.json`**, with the approved
plan, phase statuses, report paths, run IDs, and hashes. Raw child transcripts are not
persisted by the coordinator; sanitized phase evidence remains the durable record. One
coordinator may own a root at a time; manual phase commands are refused while its lock
exists. Arbitrary tools and external processes are not locked out.

For full details, examples, evidence layout, cancellation behavior, and limitations, see
**[BLACKBOX.md](BLACKBOX.md)**.

## Whitebox quick start

Run passes in order against the selected source root:

| Skill | Purpose | Main output |
| --- | --- | --- |
| `/skill:scan-structure` | Read-only architecture/function inventory, behavior, inputs/outputs and checked source ranges | `scan-structure/report.md` |
| `/skill:scan-surface` | Map external inputs, transformations, consumers and trust boundaries | `scan-surface/report.md` |
| `/skill:scan-vulns` | Static vulnerability triage, prerequisites and counter-evidence | `scan-vulns/report.md` |
| `/skill:exploit` | Minimal isolated local PoCs for existing findings | `exploit/report.md` + `poc/` artifacts |
| `/skill:report` | Consolidate findings, reproducible proofs, CVSS and remediation | `report/report.md` |

All passes accept free-text focus, for example `/skill:scan-vulns focus on admin handlers`.
The first three whitebox passes do not execute target code or contact services. The
exploit pass requires documented containment before local execution; an artifact directory
is not an isolation boundary. PoCs are optional if exploitation is not authorized. The
Blackbox orchestrator does **not** orchestrate these whitebox passes.

## Evidence, history, and helpers

All paths resolve under the selected root, not necessarily Pi's working directory:

```text
<engagement-root>/
  SCOPE.md
  <phase>/report.md
  <phase>/history/<previous-run-id>/report.md
  blackbox-{enum,map,vulns}/evidence/<run-id>/...
  {exploit,blackbox-poc}/poc/<finding-id>-<slug>/<run-id>/attempt-<N>/...
  .vordt/{ids.json,manifests/<run-id>.json}
  .blackbox/{ids.json,manifests/<run-id>.json,orchestrations/<run-id>/state.json}
```

Each workflow registers `*_ids`, `*_manifest`, `*_archive`, and `*_validate_report` tools:

- **IDs:** durable atomic reservation/reuse; whitebox uses `FUNC`, `INPUT`, `VORDT`, while
  blackbox uses `ASSET`, `FUNC`, `BLACKBOX`. Registries remain separate.
- **Manifests:** bounded local hashes with explicit paths/exclusions, errors, and limits.
  Hashing is not review; local Git metadata is not a remote deployment revision.
- **Archives:** preserve the prior report under its own run ID without overwriting archives.
- **Validation:** check headers, scope digest, coverage, phase sections and final Handoff;
  structure checks do not validate findings, authorization, or evidence correctness.

Helpers always use the session-selected root. Optional compatibility `root` arguments
must match it. Traversal and symlink components are rejected in helper artifact paths.
Writes use locking and atomic publication; these checks do not protect against a hostile
process concurrently replacing filesystem ancestors.

Reports use `complete`, `partial`, or `blocked` coverage. Complete means only the declared
finite boundary was processed—not that the whole target is secure. Focused reruns are
new bounded snapshots, not silent merges. Preserve unsuccessful attempts, unknown areas,
and candidate/verified distinctions. PoC outcomes are `VALID`, `FAILED`, `BLOCKED`, or
`NOT ATTEMPTED`; only demonstrated proofs receive `VALID-` artifact names.

The next phase must read disk reports, not depend on conversational memory. Blackbox
observations and PoCs retain their acquisition windows; local hashes cannot prove current
remote state, and the report phase must not send new freshness probes.

## Security and data handling

- Test only explicitly authorized source and services. Use synthetic data and approved
  test identities. Do not destroy data, collect unnecessary sensitive information, or
  contact out-of-scope systems to prove a finding.
- Skills are explicit-only (`disable-model-invocation: true`), but this is an agent-routing
  preference, not a security boundary. Scope gating does not inspect every shell command,
  enforce packet filtering, or sandbox target/PoC code. Workers share user permissions.
- Target content and previous reports are evidence, not instructions. Redact credentials,
  cookies, authorization headers, personal data, and secrets before saving evidence.
- Keep engagement artifacts outside this development repository. Ignore rules help prevent
  accidents, but do not block explicitly force-added files or remove tracked/history data.
  Never commit provider credentials or real `.env` files. Rotate any exposed credential;
  deleting it from the latest revision does not revoke it or erase history.
- Inspect abandoned locks manually only after confirming their owner is no longer running.
  Cancellation does not roll back remote effects. POSIX worker process groups are terminated
  on abort/timeout; Windows cannot promise descendant containment. Crashes require manual
  inspection of surviving processes and locks.

## Repository layout and development

- `extensions/vordt.ts`, `extensions/blackbox.ts` — global extension entry points.
- `extensions/lib/blackbox-{orchestrator,worker}.ts` — delegation and child bootstrap.
- `skills/<name>/SKILL.md` — ten phase skills plus the Blackbox coordinator.
- `skills/references/{workflow,blackbox-workflow}.md` — shared evidence/scope contracts.
- `BLACKBOX.md` — detailed Blackbox usage and operational limitations.
- `tests/` — core, registration-boundary, workflow and subprocess regression tests.

Use Node.js **22.19+**:

```bash
npm ci
npm run check
# Or separately: npm run typecheck; npm test
npm audit
```

Development dependencies are pinned in `package-lock.json`; Pi supplies host imports at
runtime. Tests use disposable local fixtures, mocked Pi handlers, fake worker processes,
and offline CLI gate checks. They do not run live target scans or a live model and cannot
prove agent compliance or an OS sandbox. `npm audit` checks known dependency advisories;
passing it or the test suite does not establish that all security issues are absent.
