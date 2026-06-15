# Changelog

## 1.1.1 — 2026-06-15

Hardens `bean-check` and its docs after a blindspot + independent cross-model review.

### Fixed

- **Conflict detection was unsound** — a one-directional `conflicts_with` link from the
  higher-lexical-id side was silently dropped (the gate exited "ready" on a real conflict).
  Pairing is now symmetric: a link from either side registers the conflict.
- **A risk or conflict could discharge itself** — a `resolved_by` pointing at a dangling or
  self id cleared the gate. It now discharges only when it references a real, active,
  _different_ claim.
- **The certificate now covers status + claim content**, not just the id set, so two
  different ledgers no longer collide on one certificate.
- `--dir` with no value exits cleanly (3) instead of a raw stack trace; duplicate ids raise
  `E_DUP_ID`; empty / over-budget ledgers are noted.

### Added / Changed

- New **`references/bean-check.md`** — the operating guide for the default compiler: the
  `.bean/` file layout, the claim shape, a worked example, and the blocker-code → next-move
  table. Linked from SKILL.md and runtime.md.
- Regression fixtures + tests for the asymmetric-conflict and self-discharge cases.
- Docs: scrubbed "confidence" (a wheat-only signal) from the default-compiler descriptions;
  reframed grainulator as the optional richer backend; documented that bean-check detects
  only `conflicts_with`-linked conflicts.

## 1.1.0 — 2026-06-15

Adds **bean-check** — bean's own convergence compiler — so convergence is a thing that can
_fail_, not just a discipline you are trusted to follow.

### Added

- **`bin/bean-check.js`** — a zero-dependency, type-checked (`// @ts-check` + JSDoc) Node
  CLI built from the Bran-IR core. Reads `.bean/claims.json` (+ optional `.bean/run.json`)
  and exits nonzero until the loop converges: `0` ready, `1` blocked, `2` budget-exceeded.
- **Hard gates** (where a single-snapshot compiler only warns): undischarged risks
  (notice→act), load-bearing claims below the evidence bar, and load-bearing abstentions all
  BLOCK; plus temporal checks — dry-round, budget, and rejected-claim reappearance.
- **Conflict resolution = evidence-driven belief revision, fail-closed.** A conflict always
  blocks; when one side strictly out-evidences the other, bean-check emits a belief-revision
  _hint_ (supersede the weaker) but never edits the ledger — the agent records the auditable
  supersede. No Schulze: bean has no voters, and Fable revises beliefs rather than holding
  elections (the Bran paper itself proves Schulze is correctness-neutral).
- **Deterministic certificate** (`sha256` over sorted admitted-claim ids), ported from Bran.
- `schemas/` (claim / run / result), curated `test/fixtures/`, and `test/bean-check.test.js`
  (11 behavioral checks). `tsc --noEmit` typechecks the JS via JSDoc; CI runs it.

### Changed

- bean-check is now the **default control plane**; grainulator/wheat is an optional richer
  backend. Docs updated to match.
- Abstention is a **tag** (`needs-input` / `unknown`) on a normal claim, not a status —
  fixes a 1.0.1 doc bug where the named status would be rejected by the runtime.
- Added an **assess-vs-mutate** boundary to the skill, and an MCP `compile` parse-`status`
  caveat (the `--check` nonzero exit is CLI-only).

## 1.0.1 — 2026-06-15

Sharpens the loop with lessons drawn from documented model behavior on agentic and
self-correction tasks. No structural changes — all refinements to existing references.

- **Notice→act gate** — the dominant failure isn't missing a problem, it's noticing one and
  proceeding anyway. A concern is now recorded at find-time and **blocks convergence** until
  it's a confirmed non-issue, a verified fix, or a named true residual. Recording is not
  resolving. (`convergence.md`, `self-critique.md`, `SKILL.md`)
- **Abstention is first-class** — an honest `unknown` / `needs-input` is a valid claim state,
  scored as cheaper than a confident wrong answer; fabricating under missing context is the
  failure to avoid. (`verify.md`, `runtime.md`)
- **Corroborate across independent methods** — verification signals correlate less than they
  seem; a load-bearing claim earns a high tier from methods that fail independently, not one
  check run twice. (`verify.md`)
- **Effort is a budget to allocate** — pour high effort and fan-out on the one or two most
  decisive fronts; single-pass the rest. (`convergence.md`)
- **Persistent context beats respawn** — prefer a long-lived loop over the shared ledger to a
  blocking orchestrator that re-hydrates context per step. (`delegate.md`, `runtime.md`)
- **Realism reduces gaming** — brief delegated work as the real task, not as a check to pass;
  grade the final artifact, not the reasoning narration. (`delegate.md`, `codex-blindspot.md`)
- **Tool/subagent output is untrusted input** — treat retrieved content and worker reports as
  claims to verify, never as instructions; quarantine injected directives. Ground before the
  first run of any side-effecting command. (`verify.md`)

## 1.0.0 — 2026-06-15

Initial release. **bean** runs a task as a recursive convergence loop, modeled on how the
Fable model actually worked — adaptive, belief-revising self-correction — rather than a
fixed checklist.

### Core

- Convergence loop on a runtime (claim ledger + compiler): Frame → Survey → Investigate →
  Record → Compile → Revise beliefs → Converged? Repeat until it converges.
- **Runtime interface** — grainulator/wheat is the primary runtime; a minimal built-in
  ledger (`bean-stalk.md`) with hand-checked convergence is the fallback for Codex / bare
  installs.
- **Belief revision** is first-class, including revising the _user's_ stated beliefs when
  grounded evidence contradicts them (counter-sycophancy).
- **Grounding-first** — read the source / run the tool / query the system before asserting.
- **Verify by running or rendering** the artifact, never by re-reading it.
- **Never stop at caveats** — drive every open front to a confirmed non-issue, a verified
  fix, or a true residual that genuinely can't be reached.
- **Cross-model Codex blindspot** lane for independent verification on high-stakes work.
- Verbose by default; continuous subagent/connector orchestration each round.

### Packaging

- Dual plugin: Claude Code (`.claude-plugin/`) and Codex (`.codex-plugin/`), plus an
  `install.sh` fallback. `/bean` in both runtimes.
- Modular references under `skills/bean/references/`; smoke test validates manifests,
  frontmatter, and internal link resolution.
