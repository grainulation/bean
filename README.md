<p align="center">
  <img src="site/bean.png" alt="bean" width="160">
</p>

<p align="center">
  <a href="https://github.com/grainulation/bean/releases"><img src="https://img.shields.io/github/v/tag/grainulation/bean?label=version" alt="version"></a>
  <a href="https://github.com/grainulation/bean/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="license"></a>
  <a href="https://github.com/grainulation/bean/actions"><img src="https://github.com/grainulation/bean/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
</p>

<h1 align="center">bean</h1>

<p align="center"><strong>A recursive convergence loop for large tasks — for Claude Code and Codex.</strong></p>

<p align="center">
Run a task as a loop: investigate, record what you learn as typed claims, let a compiler tell you what's still weak, contradictory, or unverified, revise the beliefs that don't hold, and loop until it converges — then deliver. In 2.0 the runtime is a single Rust binary that couples to your agent natively, so the loop can't quietly stop early.
</p>

---

## What it does

bean replaces "do these N phases" with "keep going until there's nothing decisive left to learn." It runs on a **runtime** — a claim ledger plus a compiler that scores convergence — and uses that signal to decide its own next move.

- **Investigate the most decisive open front** — the compiler's signal (unresolved conflict, weakest-evidence claim, coverage gap) picks the target, not a fixed plan.
- **Record evidence in a ledger** — typed claims at honest evidence tiers (`stated` → `production`), the loop's memory across rounds.
- **Compile** — a check that can _fail_ at the whole-task level: conflicts, gaps, weak evidence, undischarged risks.
- **Gate on a real oracle (2.0)** — a load-bearing claim can require an external verifier (your test suite, a type check, a state assertion), not just a self-asserted tier. Internal consistency isn't correctness.
- **Revise beliefs** — when new evidence overturns a claim, supersede it rather than letting the contradiction stand.
- **Couple to execution (2.0)** — a native **Stop hook** in Claude Code and Codex won't let the agent finish a bean-tracked task until the loop converges. The runtime drives; the agent can't drift past it.

## Install

2.0 ships as a small **static binary** (no Node, no runtime dependencies) plus the `/bean` skill and the native hooks.

**Build from source** (needs [Rust](https://rustup.rs)):

```bash
git clone https://github.com/grainulation/bean.git
cd bean && ./install.sh
```

This builds the runtime (`bean-check`, `bean-verify`, `bean-run`, `bean-hook`), installs the `/bean` skill, and registers the native Stop hook for Claude Code and Codex.

**Prebuilt binaries** (no Rust): download the tarball for your platform from the [latest release](https://github.com/grainulation/bean/releases) and put the binaries on your `PATH`.

> The Claude Code marketplace install (`claude plugin install bean`) gives you the `/bean` skill and the hook config; the runtime binary still has to be present — build it with `./install.sh` or drop a prebuilt one in. Pin a tagged release (e.g. `v2.0.0`) and re-review on update.

## Use

```
/bean <your task>
/bean quiet <your task>   # terse — failures still surfaced
```

bean also triggers on "do this thoroughly", "be systematic", or when a task objectively spans multiple files, sources, or sessions. For a trivial one-pass task it stays out of the way. See [`EXAMPLE.md`](EXAMPLE.md) for a worked before/after.

## The loop

| Step                  | What happens                                                                         |
| --------------------- | ------------------------------------------------------------------------------------ |
| **Frame** (once)      | State the goal; seed the ledger with known constraints. Does the task earn the loop? |
| **1. Survey**         | Re-assess available skills/subagents/connectors this round; read real data.          |
| **2. Investigate**    | Attack the most decisive open front the compiler flagged; fan out subagents.         |
| **3. Record**         | Write findings as typed claims at honest evidence tiers into the ledger.             |
| **4. Compile**        | Score convergence; in strict mode, gate load-bearing claims on a real oracle.        |
| **5. Revise beliefs** | Supersede claims that new evidence overturns; resolve conflicts.                     |
| **6. Converged?**     | No unresolved conflicts + evidence bar (or oracle) met + a dry round → deliver.      |

## The runtime (four binaries)

A single self-contained binary per tool — no install dependency. (The JS `bean-check` is kept as the conformance reference; the Rust runtime must match it byte-for-byte, including certificates.)

- **`bean-check`** — the compiler/gate. Reads `.bean/claims.json` (+ optional `run.json`) and exits nonzero until the loop converges: conflicts, undischarged risks, below-bar load-bearing claims, dry-round, budget — plus the 2.0 oracle gate. Emits a deterministic certificate.
- **`bean-verify`** — the only path that runs an oracle: a declared command (argv, no shell, claim JSON on stdin); records a scrubbed verdict `bean-check` adjudicates.
- **`bean-run`** — the driver: injects the compiler signal into the agent's prompt each round, records what it emits, enforces forward progress. Model-agnostic (`--agent "claude -p"` / `"codex exec -"`).
- **`bean-hook`** — the native Stop hook for Claude Code and Codex: blocks the agent from finishing until the loop converges; inert when a project has no `.bean/` ledger.

The 2.0 oracle gate is opt-in via `run.json` → `verification.mode`: `compat` (default, == 1.x), `advisory` (warn), `strict` (require a passing oracle or a named residual). See [`skills/bean/references/oracle-gate.md`](skills/bean/references/oracle-gate.md).

**[grainulator/wheat](https://github.com/grainulation/grainulator)** is an optional richer backend; bean works fully without it.

## Philosophy

- **Lean.** One static binary, zero runtime dependencies, no network by default, no telemetry.
- **A real gate.** `bean-check` makes convergence falsifiable; the oracle gate makes it _external_ — auditable verification, not a self-graded checkmark.
- **Coupled, not advisory.** Native hooks mean the discipline can't be silently skipped — the honest end state Fable had and a plain skill can't.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). Run `npm test` (Node reference + smoke) and `node test/conformance.mjs` (Rust differential) before a PR.

## License

[MIT](LICENSE) © grainulation contributors.
