# Reference: verify (evidence + compile)

Verification in the convergence loop happens at two levels: **per claim** (the evidence
tier you record it at) and **per round** (the compiler signal). Both can fail — that's the
point. "It looks right" is not verification at either level.

## Ground before you assert

The default investigation move is to **read the source / run the tool / query the system,
then claim from that output** — never from memory or assumption. Grounding in retrieved or
observed evidence is the main thing that separates a checkable claim from a fabricated one;
even search-capable models fabricate a measurable fraction of citations when they answer
from memory. Concretely:

- Point every status claim at a tool result from _this_ session. "NOT FOUND" beats
  inference.
- Read the actual file/record/page, don't recall it. Quote or cite what you read.
- Retrieving and then ignoring the result counts as not grounding — condition the answer on
  what you found.

## Per claim: the evidence tier IS the check

When you record a claim, tier it honestly:

`stated < web < documented < tested < production`

The tier is a claim about how hard the evidence would be to falsify. `tested` means a test
actually ran; `documented` means you read the source. A hunch is `stated` — and the
compiler will treat a load-bearing `stated` claim as a weak front to attack next round.
Inflating a tier is the one move that breaks the loop: it tells the compiler you're
converged when you aren't.

## Verify by running or rendering — not by re-reading

The strongest check executes the artifact and observes the result, because **a model that
would write the bug will also miss it on re-read** — self-review reuses the same flawed
reasoning that produced the work (LLMs reliably fail to self-correct without an external
signal; DeepMind, arXiv:2310.01798). So:

- **Code:** run it / run the tests and read the actual output. Lift a claim to `tested`
  only when a real run passed, exercising error paths, not just the happy path. "Passing
  tests" is necessary, not sufficient — also diff the result against the spec's intent.
- **Visual artifacts (UI / HTML / PDF):** _render_ them and inspect (screenshot, vision
  check, or open the rendered output) — the rendered result differs from how the markup
  reads, and export/print paths differ from browser rendering. Don't certify a document by
  reading its source.
- **Anything with a live surface:** hit it (curl the URL, query the endpoint) and read the
  real response.

Provision the harness if it's missing — install the test runner, start a dev server, spin
up a preview — rather than declaring something unverifiable because the tooling wasn't
already there. But if a front genuinely _cannot_ be made verifiable (the task as written
has no observable success condition), that's a framing problem: surface it and get the
success criteria clarified with the human instead of spinning on an untestable goal.

## Per round: the compiler signal IS the failable check

`compile` is the whole-task check that can fail: it returns unresolved conflicts, coverage
gaps, single-source topics, weak-evidence topics, and confidence. The loop is not done
while that signal is red. See [runtime.md](runtime.md) for what the signal contains and
[convergence.md](convergence.md) for next-move, the never-stop-at-caveats rule, and stop.

## What counts as real evidence (by domain)

- **Software engineering** — read the code before claiming behavior; `tested` only when a
  test ran (error paths included).
- **Research / knowledge work** — a load-bearing claim is `documented` only when it traces
  to a source actually read; corroborate single-source topics before trusting them.
- **Data analysis** — understand the data shape first; a data-quality claim is `tested`
  only when an assertion ran against the real data.
- **Long-running / multi-session** — the ledger is the work log; a "done" claim is only as
  good as the written, runnable done-criteria behind it.

## High-stakes: add an independent check

For claims expensive to get wrong, a single check is thin. Escalate to an independent
adversarial / cross-model review before letting the claim count toward convergence — see
[codex-blindspot.md](codex-blindspot.md). Treat its verdict as evidence (it can raise or
lower a tier, or open a conflict), not as authority.
