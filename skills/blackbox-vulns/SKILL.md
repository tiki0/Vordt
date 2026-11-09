---
name: blackbox-vulns
description: Scan mapped blackbox functionality for candidate vulnerabilities using authorized bounded checks and counter-evidence. Consumes blackbox-enum and blackbox-map. Keeps scanner leads, confidence, and verification distinct; exploit validation belongs to blackbox-poc. Accepts free-text focus.
disable-model-invocation: true
---

# blackbox-vulns — evidence-based vulnerability scanning and triage

## Preconditions and scope

Read and follow [the shared blackbox workflow](../references/blackbox-workflow.md) first.
Require `<BLACKBOX_SCOPE>` and verify the selected root's SCOPE.md. Active vulnerability
checks must be permitted by the rules of engagement; enumeration permission is not enough.

## Required inputs

- `blackbox-enum/report.md` and `blackbox-map/report.md`, or selected archived snapshots.
- Relevant functionality/evidence, authorized test contexts, user focus/limits.
- Previous `blackbox-vulns/report.md`/history for stable finding identities.

Validate upstream target, scope, observation dates, roles, and coverage. Missing, materially
stale, or insufficient mapping means a blocked report naming what must be refreshed.
Do not invent input points, credentials, or internal source root causes.

## Allowed and prohibited actions

Perform authorized non-destructive vulnerability checks against mapped functionality.
Select installed scanners or manual requests adaptively; inspect enabled checks/templates
before running, constrain hosts/paths/roles, rates, timeouts, and request budgets, and
capture output. Disable exploit, DoS, credential-guessing, unsafe mutation, external
callback/OAST, and intrusive templates unless separately permitted and appropriate for
the PoC phase. Never run an unreviewed scanner preset against every discovered hostname.
Write only `blackbox-vulns/` and `.blackbox/` bookkeeping.

This phase identifies/triages candidates; it must not build exploit chains, obtain shells,
execute uploaded code, establish persistence, extract sensitive datasets, or use stolen
credentials. If a check needs such an effect or risky state change, stop at a candidate
and propose minimal validation for the separately invoked PoC pass. Stop a branch once
minimum sufficient evidence is obtained. Observe incidental sensitive data minimally and
redact it; do not expand access to prove impact.

## Procedure

1. Validate upstream context, obtain a run ID, archive the prior report, and create a
   functionality/check matrix. Choose applicable classes rather than assuming every
   endpoint requires every payload. Record authorized baseline/control requests.
2. Review reachable behavior for injection/output handling, upload/file access, path
   handling, authentication/session controls, authorization/tenant isolation, unsafe
   cross-origin behavior, exposed configuration, TLS/protocol settings, and business
   logic as applicable. Authorization comparisons require explicitly provided controlled
   test identities/objects. SSRF checks must not contact unapproved internal/third-party
   systems; potential callbacks and risky checks are left for scoped PoC approval.
3. Run bounded permitted checks and capture exact sanitized requests/responses and scanner
   configuration/version/template identifiers. Compare with controls: soft-404s, common
   login pages, caching, WAF challenges, reflection vs execution, client-only validation,
   and environmental errors can invalidate scanner interpretations.
4. Treat scanner hits, service banners, CVE/version matches, and generic missing-header
   warnings as leads, not proof. Check reachability, actor control, affected behavior,
   prerequisites, security property, supported impact, and counter-evidence. Correlate
   any CVE with actually supported product/version/configuration; unknown stays unknown.
5. Assign/reuse `BLACKBOX` IDs linked to `FUNC` and `ASSET`. Deduplicate supported behavior
   carefully. A backend root cause is an explicitly labeled hypothesis unless evidenced.
   Keep confidence (`high/medium/low`), tentative severity, and verification separate.
   Use verification `scanner-only`, `behavior-observed`, or `unverified`; no `VALID` PoC
   verdict here. Unexpected strong behavior remains recorded evidence for PoC review.
6. Retain rejected/false-positive leads with control evidence and reasons. A failed probe
   is not proof of safety; identify unknowns and environmental/permission blockers.
7. Reconcile the check matrix with mapped functions, including untested roles/classes
   and budget limits. Hash reviewed evidence, write the report and handoff, and validate.

## Output schema

Write `blackbox-vulns/report.md`; evidence under `blackbox-vulns/evidence/<run-id>/`.
Use the common report header, then:

```markdown
## Triage summary
<counts by tentative severity/confidence/evidence status; function/check coverage matrix>

## Candidate findings
### BLACKBOX-001 — <title / class>
- **Affected surface:** <ASSET/FUNC IDs; hostname/port/path/method/parameter/role>
- **Description/property:** <observed issue and violated security property>
- **Evidence:** <baseline vs probe, UTC, sanitized request/response/scanner artifacts>
- **Attack path:** <actor-controlled input -> observed behavior -> hypothesized effect>
- **Root-cause hypothesis:** <explicitly inferred; internal code unknown unless supported>
- **Prerequisites:** <auth, ownership, deployment/configuration, timing>
- **Impact:** <supported effect; speculative consequences labeled>
- **Counter-evidence checked:** <controls/protections and why lead persists>
- **Unresolved assumptions:** <missing proof and implications>
- **Confidence:** high | medium | low — <rationale>
- **Verification status:** scanner-only | behavior-observed | unverified
- **Tentative severity:** CRITICAL | HIGH | MEDIUM | LOW | INFO — <rationale>
- **Classification:** <supported CWE/CVE/reference or unknown>
- **Suggested validation:** <minimal measurable PoC criterion, approval/cleanup needs>

## Rejected candidates
<lead/previous ID, disproof or false-positive reason, control evidence; not safety claims>

## Evidence manifest
<reviewed artifacts/upstream digests, acquisition windows, commands/tool/template metadata>

## Handoff
<the four shared handoff fields>
```

## Completion checklist

- [ ] Upstream scope/freshness and mapped check coverage recorded.
- [ ] Bounded permitted checks only; no exploit chains or intrusive validation.
- [ ] Stable BLACKBOX IDs; supported impact, controls, and assumptions documented.
- [ ] Scanner-only leads not promoted to proven exploits; rejected leads retained.
- [ ] Archive, Evidence manifest, final Handoff, structural validation complete.

## Context handoff

Reply with report path, coverage, candidate IDs/severity/confidence, and prioritized
minimal PoC criteria for `/skill:blackbox-poc`. State untested prerequisites; do not
invoke the PoC phase automatically.
