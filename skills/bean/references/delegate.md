# Reference: delegate

Step 2 of the round. Once the compiler signal names the most decisive open front (see
[convergence.md](convergence.md)), gather the evidence — and fan it out when you can.
Fable spun up subagents readily and used whatever existed; do the same, continuously,
rather than investigating everything yourself in series.

## When to delegate

- The open front decomposes into independent investigations (corroborate a topic from
  three sources; probe three files; test two hypotheses).
- The work benefits from a fresh, uncontaminated context — especially independent
  verification, where an agent that didn't form the belief checks it.
- A loaded skill already does the investigation; invoke it instead of reimplementing.

## When not to delegate

- The next move is a single, sequential reasoning step.
- Briefing an agent costs more than just doing it.
- The front isn't well-defined yet — sharpen the question (what claim would resolve it?)
  before fanning out.

## The briefing contract

Every delegated agent gets, explicitly:

1. **Task** — the one investigation, scoped to the open front.
2. **Expected output** — the claim(s) it should return, with evidence, in a shape you can
   drop into the ledger.
3. **Save location** — where to write any artifacts.
4. **Context** — only the relevant prior claims, not the whole transcript.
5. **Boundaries** — out of scope; read-only vs. a narrow write scope.

## Independence for verification

When the round's job is to _verify_ a claim, keep the verifier independent: it judges the
raw artifact, not your summary, and didn't help form the belief. For high-stakes claims,
escalate to the cross-model blindspot lane — see [codex-blindspot.md](codex-blindspot.md).

## Runtime specifics

- Claude Code (Agent tool, parallel in one message; grainulator research subagents):
  [runtime-claude.md](runtime-claude.md)
- Codex (parallel `codex exec` lanes): [runtime-codex.md](runtime-codex.md)
