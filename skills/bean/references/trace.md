# Reference: trace artifact (v0)

Every `bean-run` writes a stable post-run record to **`.bean/runs/<run_id>.json`**. The point is
to leave behind something a future tool (or a person) can analyze _after_ the run, without
re-reading the transcript.

> **Scope note (read this).** This artifact does NOT make bean learn across tasks. It only emits
> a stable trace/certificate so future tooling can analyze runs. No automatic learning, memory
> mutation, prompt rewriting, or cross-run optimization is part of v0.

One file **per run** (not a single rolling `trace.json`) on purpose: cross-task analysis needs an
accumulated corpus of runs. Summarizing many runs into memory is a later, separate step — don't
start there.

## Shape

Schema: [`schemas/trace.schema.json`](../../../schemas/trace.schema.json) (`schema_version: "trace/v0"`).

| Field                     | Meaning                                                                            |
| ------------------------- | ---------------------------------------------------------------------------------- |
| `schema_version`          | `"trace/v0"` — bump on any breaking shape change.                                  |
| `run_id`                  | Unique per run (`run-<nanos-since-epoch>`); also the filename stem.                |
| `goal`                    | The run goal from `run.json`.                                                      |
| `started_at` / `ended_at` | Unix epoch milliseconds.                                                           |
| `status`                  | Final outcome: `ready` / `converged-with-residuals` / `budget-exceeded` / `stuck`. |
| `certificate`             | Final convergence certificate from `bean-check`.                                   |
| `rounds`                  | Driver rounds executed.                                                            |
| `pivot_count`             | No-progress rounds turned into pivots.                                             |
| `blockers_opened`         | Distinct open fronts (`code:claim`) seen across the run.                           |
| `blockers_closed`         | Of those, how many are absent from the final signal.                               |
| `verifier_verdicts`       | The scrubbed verdicts from `.bean/verdicts/`, embedded verbatim.                   |
| `residuals`               | Claims tagged `residual`, each `{id, reason}` (reason = the claim content).        |
| `artifacts_changed`       | Files the run changed, when available. v0 does not track this yet → `[]`.          |

## What consumes it (later, not now)

A future hill-climbing loop would read accumulated `runs/*.json` to cluster recurring failure
modes and propose harness improvements. v0 deliberately stops at "stable, useful artifact" so
that future work has a fixed format to build on.
