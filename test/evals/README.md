# bean behavioral evals

Static tests (`test/smoke.test.js`) prove the skill is _well-formed_. They cannot prove
the model _follows_ it — bean is a prompt, so its real test is behavioral. These evals are
prompt + rubric pairs. Run the prompt under `/bean`, then score the transcript against the
rubric. Each rubric line is a check that can **fail**.

## How to run

1. In a client with bean installed, send the eval's **Prompt**.
2. Capture the transcript.
3. Score each **Rubric** line PASS/FAIL against the transcript.
4. For an independent score, hand the transcript + rubric to a fresh agent or to Codex
   (bean's own blindspot lane) rather than self-grading — a model grading its own
   transcript shares its own blind spots.

A run passes only if every `[must]` line passes. `[should]` lines are quality signals.

---

## eval-01 — trigger discrimination (negative)

**Prompt:** `What's the capital of France?`

**Rubric:**

- [must] bean does NOT engage the full loop (no stage map for a one-shot fact).
- [must] The question is answered directly.
- [should] If bean comments at all, it names the trigger gate as the reason it declined.

## eval-02 — trigger discrimination (positive)

**Prompt:** `/bean Rename a config value that appears in 9 repos in three different forms.`

**Rubric:**

- [must] Emits a numbered stage map, each stage naming a verifiable expected output.
- [must] Runs discovery (names available skills / delegation tooling / connectors).
- [must] Each stage has a check that could fail (not "looks right").
- [must] Ends with a self-critique naming >=1 weakness, with a disposition.
- [should] Identifies that the value has multiple forms before proposing replacements.
- [should] Proposes an independent / cross-model review for the CI-affecting change.

## eval-03 — software task, failable check enforced

**Prompt:** `/bean Add input validation to the three API handlers in this service and prove it works.`

**Rubric:**

- [must] Reads the relevant handlers before writing.
- [must] Verification is a test that runs (not an assertion that it should work).
- [must] Error paths are exercised, not only the happy path.
- [must] Any stage without a real check is explicitly marked unverified.

## eval-04 — verbosity contract

**Prompt:** `/bean quiet <any multi-stage task>`

**Rubric:**

- [must] Every loop step still runs (not skipped because quiet).
- [must] Output is terse — no full stage-by-stage narration.
- [must] Any failed or unverified-but-load-bearing check is STILL surfaced.

## eval-05 — grainulation power-ups (stack present)

**Prompt:** `/bean <research task>` with a wheat sprint active.

**Rubric:**

- [must] Logs at least one typed claim with an evidence tier.
- [should] Dispatches a grainulator research subagent for the research stage.
- [should] Corroborates a load-bearing external claim via deepwiki.
- [should] Gates delivery on `wheat compile`.
- [must] If a power-up tool is absent, runs the portable path and says so (graceful
  degradation) rather than failing.
