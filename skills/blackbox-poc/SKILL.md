---
name: blackbox-poc
description: Attempt minimal non-destructive proofs for existing blackbox-vulns candidates on explicitly authorized remote targets. Preserve run-specific evidence, label only demonstrated POCs VALID, and distinguish FAILED, BLOCKED, and NOT ATTEMPTED. Accepts finding selection and free-text constraints.
disable-model-invocation: true
---

# blackbox-poc — scoped POC attempts and validation evidence

## Preconditions and scope

Read and follow [the shared blackbox workflow](../references/blackbox-workflow.md) first.
Require `<BLACKBOX_SCOPE>` and verify SCOPE.md at the selected root. Unlike Vordt's local
whitebox PoCs, this phase may contact explicitly authorized remote services. Local artifact
storage does not isolate requests or make a remote test safe. Require permission for
both the target and the intended testing technique/effect.

## Required inputs

- `blackbox-enum/report.md`, `blackbox-map/report.md`, and `blackbox-vulns/report.md`, or
  explicitly selected archived snapshots covering the chosen candidates.
- Relevant evidence, permitted test accounts/objects, user finding selection/constraints.
- Prior `blackbox-poc/report.md`/history and artifacts for identity/outcome continuity.

Validate target, scope, roles, observation windows, and upstream coverage. If candidates
are absent, stale, or insufficient, write a blocked report identifying the pass to refresh;
do not improvise unrelated vulnerabilities or expand the assessment here.

## Allowed and prohibited actions

- Develop minimal non-damaging proofs for selected prior `BLACKBOX` findings only. Use
  synthetic markers, authorized test accounts, and tester-owned objects. No destruction,
  persistence, real-data exfiltration, lateral movement, or attacks outside scope. Do
  not turn a single proof into a broad exploit chain. Stop on unexpected effects.
- Before execution document a per-attempt plan: exact host/port/path/role/object, expected
  effects, request/time/resource budget, network destinations/redirect policy, local code
  isolation, remote safeguards, stop conditions, and cleanup. If effect/authorization is
  unclear or permission for mutations/callback destinations is absent, ask or block.
- Local execution of PoC scripts still needs suitable filesystem/process/network controls
  and no unrelated secrets. Document what is actually enforced; a directory or container
  name is not proof of isolation. Never execute fetched untrusted exploit code blindly.
- No external callback/OAST destination unless explicitly authorized; do not use public
  interaction services by default. No internal address probing justified by SSRF alone.
- Write only `blackbox-poc/` and `.blackbox/` bookkeeping. Remote controlled mutations are
  the explicit scoped exception and must be recorded/cleaned up only where authorized.

## Procedure

1. Read relevant candidate/evidence sections and select findings requested by the user,
   otherwise prioritize high-confidence/high-impact candidates with permitted minimal
   proof. Carry `BLACKBOX`, `FUNC`, and `ASSET` IDs unchanged. Obtain a run ID and archive
   the previous report. Baseline rechecks must themselves be within authorization.
2. Restate the hypothesis and a measurable success criterion based on existing evidence.
   Choose the least invasive demonstration and a baseline/negative control; do not
   inflate impact to require unnecessary access or sensitive data collection.
3. Document safeguards and approvals before execution. Create each attempt directory
   exclusively at `poc/<BLACKBOX-id>-<slug>/<run-id>/attempt-<N>/`; refuse collisions.
   Preserve scripts, sanitized commands/requests, tool/dependency versions, environment,
   UTC window, response/output, exit status, and control evidence. Keep secrets out of
   scripts/logs; reference approved secret sources rather than copying their values.
4. Execute only the planned bounded attempt. Evaluate the observed effect against the
   criterion and controls, not just status codes, scanner messages, or local script exit
   success. Stop once proven; record cleanup and any residual changes or failures.
5. Classify honestly:
   - `VALID`: evidence from the actual authorized target demonstrates the stated property
     violation, with relevant controls and target/context recorded. Target internals need
     not be visible, but speculation alone cannot satisfy the criterion.
   - `FAILED`: executed as designed, but the expected effect did not occur in that context.
   - `BLOCKED`: could not execute or establish the criterion (permissions, isolation,
     unavailable accounts/dependencies, unsafe effects, out-of-scope boundary, etc.).
   - `NOT ATTEMPTED`: selected but not pursued this run.
   Mock/local simulations can illustrate mechanics but never establish a remote target
   `VALID`. A failed/blocked attempt is not proof the candidate is safe or fixed.
6. Only after validation copy/rename the demonstrating artifact to `VALID-<name>`; preserve
   original evidence and failed/blocked iterations without that prefix. Do not overwrite
   evidence cited by another run. Document environment drift and proof limitations.
7. Hash reviewed artifacts, write outcomes and blockers, and validate report structure.

## Output schema

Write `blackbox-poc/report.md` and exclusive attempt directories under `blackbox-poc/poc/`.
Use the common report header, then:

```markdown
## Attempt summary
<per-finding outcomes/counts, observation windows, cleanup/residual changes>

## Attempts
### BLACKBOX-001 — <title> — attempt <N>
- **Affected surface:** <ASSET/FUNC IDs, locator/method/input/role>
- **Candidate reference:** <blackbox-vulns path/run ID/finding>
- **Hypothesis / trigger:** <what action should demonstrate what property violation>
- **Success criterion and controls:** <minimal measurable effect, baseline/negative control>
- **Authorization/safeguards:** <approved effect/destinations, isolation, budgets, stop rules>
- **Command/environment:** <exact sanitized invocation/request, versions, context, UTC>
- **Observed behavior:** <actual responses/effect/exit codes, artifact paths>
- **Relative to criterion:** <meets/does not meet; supporting/disproving control evidence>
- **Result:** VALID | FAILED | BLOCKED | NOT ATTEMPTED
- **Where it stopped / got stuck:** <blocker, missing proof, or none>
- **Artifacts:** <exclusive attempt paths; VALID artifact only after success>
- **Cleanup/residual effects:** <permitted cleanup evidence and any unresolved changes>
- **Notes/assumptions:** <target drift, context restrictions, simulation differences>

## Evidence manifest
<reviewed artifact/upstream digests, tools/commands and acquisition windows>

## Handoff
<the four shared handoff fields>
```

## Completion checklist

- [ ] Existing candidates and freshness validated; no unrelated attacks.
- [ ] Minimal criterion/controls, permission, safeguards, and stop rules documented first.
- [ ] Exclusive attempt evidence preserved; remote effects and cleanup recorded.
- [ ] VALID only for demonstrated target behavior, not mocks or scanner conclusions.
- [ ] Prior archive, Evidence manifest, Handoff, and validator complete.

## Context handoff

Reply with report path, coverage, outcomes per BLACKBOX ID, blockers, and residual effects.
Tell `/skill:blackbox-report` which proof is verified versus still a candidate. Do not
invoke it automatically.
