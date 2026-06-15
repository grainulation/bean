# Reference: the grainulator runtime (optional richer backend)

grainulator/wheat is an **optional richer backend**. bean's default control plane is its
own zero-dependency compiler, `bean-check` (see [runtime.md](runtime.md)); when
grainulator/wheat is present, bean's loop can map onto its tools instead — the same claim
model, plus a numeric confidence, richer analysis, and the wider stack (deepwiki / silo /
farmer / mill). The warning codes below (`W_ECHO_CHAMBER`, `W_TYPE_MONOCULTURE`,
`W_WEAK_EVIDENCE`) are wheat's; bean-check emits its own (`W_SINGLE_SOURCE`, `W_MONOCULTURE`).

Detect it: a `claims.json` in scope, the `wheat` MCP server connected, or the `wheat` CLI
available.

## Loop step → grainulator tool

| Loop step             | grainulator                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Frame / seed**      | `wheat init` (or an existing sprint); seed constraints as `constraint` claims                                                                                 |
| **3. Record claims**  | `wheat add-claim` (MCP) or `wheat add` (CLI) — typed, evidence-tiered, with topic + source                                                                    |
| **4. Compile**        | `wheat compile` → status, conflicts, `coverage` (per-topic types/evidence/source-count), warnings (`W_ECHO_CHAMBER`, `W_TYPE_MONOCULTURE`, `W_WEAK_EVIDENCE`) |
| **5. Revise beliefs** | `wheat resolve` (records winner/loser/reason); supersede via a higher-tier claim                                                                              |
| **6. Converged?**     | `wheat status` / compile `status: ready` with no unresolved conflicts                                                                                         |

The claim graph in `claims.json` is bean's memory across rounds and sessions — the "own
notes" mechanism. `git log claims.json` is the loop's event log.

## Investigation power-ups

- **Research rounds** → dispatch the **grainulator** autoresearch subagent
  (`subagent_type: grainulator:grainulator`): it runs multi-pass research and adds
  evidence-tiered claims itself — a self-recording investigation lane.
- **Corroboration** → **deepwiki** (`ask_question` / `read_wiki_contents`) to lift a
  single-source or `web` claim to `documented` against a real repo (e.g.
  `grainulation/grainulator`).
- **Connectors / reads** → **silo** plus the connector MCP servers are the canonical read
  surface for grounding claims.
- **Independent check** → route the cross-model blindspot lane through **farmer**
  (`codex --remote ws://127.0.0.1:8081`) so it shows on the dashboard. See
  [codex-blindspot.md](codex-blindspot.md).
- **Publish** → **mill** for self-contained HTML/PDF of the converged result.

## Why grainulator and not "just update grainulator"

grainulator's own skills (`/research`, `/brief`, …) are one-shot phased flows: run N
passes, compile, emit. bean is the **adaptive controller** that loops those primitives on
the compile signal — choosing the next front, revising beliefs, and running until
convergence. grainulator is the substrate; bean is the loop that runs on it.

When grainulator is absent, bean runs on its bundled `bean-check` compiler (the default);
only where neither can run do you hand-check via `bean-stalk.md`. Always say which control
plane you're on — see [runtime.md](runtime.md).
