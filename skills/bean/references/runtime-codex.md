# Reference: runtime-codex

How the convergence loop runs on Codex. bean is invoked explicitly as `/bean`
(`agents/openai.yaml` sets `allow_implicit_invocation: false`), so it runs only when asked.

## Runtime

grainulator is a Claude Code plugin and is normally **not** available on Codex, so bean
runs on the **minimal built-in ledger**: a `bean-stalk.md` claims table with hand-run
compile checks. Same loop, lighter convergence guarantee (no automatic conflict detection,
no numeric confidence). See [runtime.md](runtime.md). State that you're on the built-in
ledger so the weaker stop-condition is visible.

## Survey (step 1)

- Check installed Codex plugins/skills; compose an existing one before hand-rolling.
- Delegation is parallel `codex exec`; each lane gets a fresh context.
- Read whatever sources the environment exposes (the repo, files, configured tools) before
  recording a claim.

## Investigate / delegate (step 2)

- Fan out the round's open front as separate `codex exec` invocations.
- For file-mutating parallel work, give each lane an isolated working area (e.g. a git
  worktree) so lanes don't collide; merge sequentially.
- Brief each lane per [delegate.md](delegate.md).

## Record / compile / revise (steps 3-5)

- Maintain the `bean-stalk.md` table; tier each claim honestly (`stated`…`production`).
- Run the compile checks by hand each round (conflicts, coverage gaps, single-source,
  weak-evidence, new-this-round) — see [runtime.md](runtime.md).
- Revise by superseding: mark the old row `superseded`, link the new one, record the
  reason. See [belief-revision.md](belief-revision.md).

## Independent check

The cross-model blindspot lane on Codex is a review by a _different model or a fresh
context that did not form the belief_ — judge the raw artifact, report disagreements, treat
the verdict as evidence. See [codex-blindspot.md](codex-blindspot.md).

## Notes

bean adds no tools, servers, hooks, network calls, dependencies, or telemetry on Codex.
The `bean-stalk.md` is a plain working file, not infrastructure.
