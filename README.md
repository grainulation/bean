<p align="center">
  <img src="site/bean.png" alt="bean" width="160">
</p>

<p align="center">
  <a href="https://github.com/grainulation/bean/releases"><img src="https://img.shields.io/github/v/tag/grainulation/bean?label=version" alt="version"></a>
  <a href="https://github.com/grainulation/bean/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="license"></a>
  <a href="https://github.com/grainulation/bean/actions"><img src="https://github.com/grainulation/bean/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
</p>

<h1 align="center">bean</h1>

<p align="center"><strong>A recursive convergence loop for large tasks.</strong></p>

<p align="center">
A skill for Claude Code and Codex that runs a task the way the Fable model worked: investigate, record what you learn as evidence, let a compiler tell you what's still weak or contradictory, revise the beliefs that don't hold, and loop until the answer converges — then deliver.
</p>

---

## What it does

bean replaces "do these N phases" with "keep going until there's nothing decisive left to learn." It runs on a **runtime** — a claim ledger plus a compiler that scores convergence — and uses that signal to decide its own next move.

- **Investigate the most decisive open front** — the compiler's signal (unresolved conflict, weakest-evidence claim, coverage gap) picks the target, not a fixed plan.
- **Record evidence in a ledger** — typed claims at honest evidence tiers (`stated` → `production`). The ledger is bean's memory across rounds — its "own notes."
- **Compile** — a check that can fail at the whole-task level: conflicts, gaps, single-source topics, weak evidence, and undischarged risks.
- **Revise beliefs** — when new evidence overturns an earlier claim, supersede it ("kill the incorrect belief") rather than letting the contradiction stand.
- **Loop until converged** — stop when there are no unresolved conflicts, the evidence bar is met, and a full round adds nothing new. High-stakes work gets an independent cross-model **Codex blindspot** check before declaring done.
- **Continuous orchestration** — every round re-surveys the available skills/connectors and spins up subagents for whatever the compiler flagged next.
- **Verbose by default** — each round surfaces the ledger, the compiler signal, the next move, and any belief it revised, so you can watch the answer converge.

## Install

**Step 1** — Add the marketplace (one-time):

```bash
claude plugin marketplace add https://github.com/grainulation/bean.git
```

**Step 2** — Install:

```bash
claude plugin install bean
```

> Inside Claude Code, use `/plugin` instead of `claude plugin`.

**Requirements:** Claude Code with Node.js >= 20.

> _Pinning & updates._ bean installs into your agent's context, so treat it like any
> third-party plugin: prefer a tagged release over a moving branch (pin a `--ref`, e.g.
> `--ref v1.2.0`) and re-review on update. bean runs locally with no network surface by
> default; the only optional outbound path is the grainulator/wheat remote dashboard, which
> stays off unless you wire it in.

<details>
<summary><strong>Codex</strong></summary>

```bash
codex plugin marketplace add grainulation/bean --ref main
codex plugin add bean@bean
```

On the Codex side bean is invoked explicitly as `/bean`
(`allow_implicit_invocation: false`).

</details>

<details>
<summary><strong>Alternative: clone directly</strong></summary>

```bash
git clone https://github.com/grainulation/bean.git
cd bean && ./install.sh
```

</details>

## Use

```
/bean <your task>
/bean quiet <your task>   # run every step, report tersely (failures still surfaced)
```

bean also triggers on phrases like "do this thoroughly", "be systematic", or "deep work
mode", and when a task objectively spans multiple files, sources, or sessions. For a
trivial one-pass task it stays out of the way. See [`EXAMPLE.md`](EXAMPLE.md) for a worked
before/after.

## The loop

Frame once, then iterate until the compiler signal goes green:

| Step                  | What happens                                                                          |
| --------------------- | ------------------------------------------------------------------------------------- |
| **Frame** (once)      | State the goal; seed the ledger with known constraints. Does the task earn the loop?  |
| **1. Survey**         | Re-assess available skills/subagents/connectors this round; read real data.           |
| **2. Investigate**    | Attack the most decisive open front the compiler flagged; fan out subagents.          |
| **3. Record**         | Write findings as typed claims at honest evidence tiers into the ledger.              |
| **4. Compile**        | Score convergence: conflicts, gaps, single-source, weak evidence, undischarged risks. |
| **5. Revise beliefs** | Supersede claims that new evidence overturns; resolve conflicts.                      |
| **6. Converged?**     | No unresolved conflicts + evidence bar met + a dry round → deliver. Else loop to 1.   |

## The runtime

bean runs on a claim ledger + a compiler. It **ships its own compiler — `bean-check`** — a
zero-dependency Node CLI built from the [Bran](https://github.com/grainulation/grainulator)
core that scores convergence and **exits nonzero until it is reached** (conflicts,
undischarged risks, load-bearing claims below the evidence bar, dry-round, budget). That is
the default control plane and runs anywhere Node does. **[grainulator/wheat](https://github.com/grainulation/grainulator)**
is an optional richer backend; where neither can run, bean falls back to a hand-checked
`bean-stalk.md` ledger. With grainulator connected, bean also taps the wider stack,
degrading gracefully when a piece is absent:

- **[wheat](https://github.com/grainulation/grainulator)** — the ledger + compiler; record claims and gate convergence on `wheat compile`.
- **grainulator** — dispatch autoresearch subagents for investigation rounds.
- **deepwiki** — corroborate external claims against real repositories.
- **silo + connectors** — the canonical read surface for grounding claims in real data.
- **farmer** — route the Codex blindspot review through the dashboard.

Details: [`skills/bean/references/grainulation.md`](skills/bean/references/grainulation.md).

## Philosophy

- **Lean.** Markdown, JSON, and one zero-dependency CLI (`bean-check`). No servers, no network, no telemetry, no runtime dependencies (TypeScript is a CI-only devDependency).
- **A real gate.** `bean-check` makes convergence falsifiable — it exits nonzero until the loop honestly converges; grainulator/wheat is an optional richer backend.
- **Verbose by default.** Show the ledger, the compiler signal, and the belief revisions — watch the answer converge.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). Run `npm run format` and `npm test` before a PR.

## License

[MIT](LICENSE) © grainulation contributors.
