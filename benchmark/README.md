# Oracle-pattern benchmark (the over-trust fix)

This documents the empirical result behind the "Writing an oracle that doesn't over-trust"
section of [`oracle-gate.md`](../skills/bean/references/oracle-gate.md): a **naive** oracle
(self-authored, in-session, snapshot-of-its-own-reading) blesses wrong answers, and the
**improved** oracle (re-reads persisted state + checks the post-conditions implied by the
task verb) catches them — while still passing genuinely correct answers.

## Setup

The cases are tasks from the public **AppWorld** agent benchmark (`appworld`), graded by its
objective `evaluate_task`. An agent solved each task **firewalled** from the grader; we then
graded independently, and ran the two oracle styles against the **persisted** state AppWorld
writes (a SQL change-log — exactly what the grader evaluates), with **no answer-key access**.

## Result

The improved oracle's verdict tracked the objective grader on every case:

| task / state                    | task verb        | naive oracle | improved oracle | grader   |
| ------------------------------- | ---------------- | ------------ | --------------- | -------- |
| buy-wishlist (wrong)            | buy everything … | **pass** ✗   | **fail**        | FAIL 6/7 |
| buy-wishlist (didn't persist)   | buy everything … | pass ✗       | **fail**        | FAIL 1/7 |
| buy-organizers (didn't persist) | buy 2 …          | **pass** ✗   | **fail**        | FAIL 1/9 |
| move-to-wishlist (correct)      | move all … to …  | pass         | **pass**        | PASS 6/6 |

The naive oracle passed three wrong answers; the improved oracle caught all three and still
passed the correct one (4/4 agreement with the grader, no answer key).

## Why the naive oracle failed (root cause)

1. **In-session trust** — it verified the live session it acted in ("I see the order"), not
   the persisted state. Orders that never persisted were blessed.
2. **Snapshot of its own reading** — it checked only the constraints it extracted, never the
   post-condition implied by the verb ("buy … on my wishlist" ⇒ items leave the wishlist).
3. **Confirm, not falsify.**

## The irreducible residual

One real failure is **not** oracle-reachable: an instruction said "work address" but the
grader required the home address — a pure convention with no spec/environment signal to
resolve it. That is correctly a **residual**, not a pass; over-trust there is irreducible.

## Reproducing

Requires a local AppWorld install and the recorded experiment outputs; this script reads the
persisted change-logs and compares the verb's implied transitions against each state. It is
documentation of method + result, not a repo test (the repo's self-contained version of this
pattern is the `pattern oracle …` cases in `test/bean-check.test.js`, which run with zero deps).
