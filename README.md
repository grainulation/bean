<p align="center">
  <img src="site/bean.png" alt="bean" width="160">
</p>

<p align="center">
  <a href="https://github.com/grainulation/bean/releases"><img src="https://img.shields.io/github/v/tag/grainulation/bean?label=version" alt="version"></a>
  <a href="https://github.com/grainulation/bean/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="license"></a>
  <a href="https://github.com/grainulation/bean/actions"><img src="https://github.com/grainulation/bean/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://deepwiki.com/grainulation/bean"><img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki"></a>
</p>

<h1 align="center">bean</h1>

<p align="center"><strong>A portable convergence gate for agent work — for Claude Code and Codex.</strong></p>

<p align="center">
bean keeps an agent from declaring a task <strong>"done"</strong> until its claims are verified, its conflicts are resolved, or its open questions are named as honest residuals. It records what the agent learns as a typed claim ledger, runs a compiler that scores whether the work has actually converged, and — installed as a runtime — blocks the agent from stopping until it has.
</p>

---

## How it works

bean replaces "do these N phases" with "keep going until there's nothing decisive left to learn." Each round the agent:

1. **Investigates the most decisive open question** the compiler flags — an unresolved conflict, a weakly-evidenced claim, a coverage gap.
2. **Records what it learns** as typed claims at honest evidence tiers (`stated` → `web` → `documented` → `tested` → `production`), in a ledger that persists across rounds.
3. **Compiles** — a check that can _fail_ for the whole task: conflicts, gaps, weak evidence, undischarged risks.
4. **Revises beliefs** — when new evidence overturns a claim, it supersedes it instead of leaving the contradiction standing.

The loop ends only when there are no unresolved conflicts, every load-bearing claim meets its evidence bar, and a full round turns up nothing new — or an open question is named as a genuine residual. bean stops on **scored evidence**, not on the agent's say-so.

| Step                  | What happens                                                                    |
| --------------------- | ------------------------------------------------------------------------------- |
| **Frame** (once)      | State the goal; seed the ledger with known constraints. Does it earn the loop?  |
| **1. Survey**         | Re-assess what's available this round — tools, sub-agents, data sources.        |
| **2. Investigate**    | Attack the most decisive open question the compiler flagged.                    |
| **3. Record**         | Write findings as typed claims at honest evidence tiers into the ledger.        |
| **4. Compile**        | Score convergence; optionally gate load-bearing claims on a real verifier.      |
| **5. Revise beliefs** | Supersede claims new evidence overturns; resolve conflicts.                     |
| **6. Converged?**     | No conflicts + evidence bar met + a dry round → deliver. Otherwise, loop again. |

## Two modes

- **Plugin-only (advisory).** The `/bean` skill gives the agent the convergence loop as guidance.
- **Installed runtime (enforced).** `./install.sh` builds the binaries and registers a native Stop hook, so `bean-check` becomes a hard gate: the agent cannot finish a bean-tracked task until the ledger converges or names its residuals.

## Install

bean ships as small static binaries (no runtime dependencies) plus the `/bean` skill and the native hook.

**From source** (needs [Rust](https://rustup.rs)):

```bash
git clone https://github.com/grainulation/bean.git
cd bean && ./install.sh
```

This builds the runtime, installs the `/bean` skill, and registers the Stop hook for Claude Code and Codex.

**Prebuilt binaries** (no Rust): download the tarball for your platform from the [latest release](https://github.com/grainulation/bean/releases) and put the binaries on your `PATH`.

## Use

```
/bean <your task>
/bean quiet <your task>   # terse — failures still surfaced
```

bean engages when a task is worth the loop — "do this thoroughly," or work that spans multiple files, sources, or sessions — and stays out of the way for a trivial one-pass task. See [`EXAMPLE.md`](EXAMPLE.md) for a worked before/after.

## The runtime

Five self-contained binaries, no install dependency:

- **`bean-check`** — the compiler and gate. Reads `.bean/claims.json` (and optional `.bean/run.json`) and exits nonzero until the loop converges: conflicts, undischarged risks, below-bar load-bearing claims, a dry round, the round budget, and the optional verifier gate. Emits a deterministic certificate.
- **`bean-verify`** — runs a declared verifier (a command, with the claim on stdin) and records a scrubbed verdict for `bean-check` to adjudicate.
- **`bean-run`** — the driver: injects the compiler's signal into the agent each round, records what it emits, enforces forward progress, and writes a per-run trace to `.bean/runs/<run_id>.json`. Works with any agent command.
- **`bean-hook`** — the native Stop hook for Claude Code and Codex; blocks the agent from finishing until the loop converges, and is inert when a project has no `.bean/` ledger.
- **`bean-lessons`** — a read-only trace analyzer: reads `.bean/runs/*.json` and writes a ranked report of recurring failure patterns to `.bean/lessons.json`. Deterministic; it proposes, never applies.

### Verifier gate

A load-bearing claim can require an external verifier — your test suite, a type check, a state assertion — instead of trusting a self-asserted evidence tier. Set the mode in `.bean/run.json` → `verification.mode`:

- `compat` (default) — no verifier required.
- `advisory` — warn on an unverified load-bearing claim.
- `strict` — require a passing verifier or a named residual.

See [`skills/bean/references/oracle-gate.md`](skills/bean/references/oracle-gate.md).

## Use it anywhere

The gate is a self-contained binary, so the same core runs in more than one place:

- **Claude Code and Codex** — as a native Stop hook (the `/bean` skill plus `bean-hook`).
- **Any agent loop or CI pipeline** — call `bean-check` / `bean-verify` as a verification step that blocks "done" until the ledger converges.

bean works standalone with local files and binaries — no network, no service, no account.

## What bean is not

- **Not an agent framework.** It rides _inside_ an agent loop as the verification layer; it complements an agent framework, it doesn't replace one.
- **Not an accuracy booster.** It doesn't make a model smarter. It reduces _silent false completion_ — turning "confidently wrong and done" into verified, fixed, or honestly blocked.

## Philosophy

- **Lean.** Static binaries, zero runtime dependencies, no network by default, no telemetry.
- **A real gate.** `bean-check` makes convergence falsifiable; the verifier gate makes it _external_ — auditable verification, not a self-graded checkmark.
- **Coupled, not advisory.** With the runtime installed, the native hook means the discipline can't be silently skipped.
- **Discipline, not a transplant.** bean shapes the procedure an agent follows; it doesn't raise the model's ceiling. A weak model with bean converges on its answer more honestly, not more brilliantly.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). Run `npm test` and `node test/conformance.mjs` before a PR.

## License

[MIT](LICENSE) © grainulation contributors.
