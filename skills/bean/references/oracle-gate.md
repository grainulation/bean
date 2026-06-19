# Reference: the oracle gate (bean 2.0)

bean 1.x converges when the ledger is **internally consistent**. That is necessary but not
sufficient: a ledger can converge cleanly on a _wrong interpretation of the task_ — a green
compile is not a correct answer. bean 2.0 adds an **external-verifier gate**: a load-bearing
claim can be required to carry a real verifier's signal, not just a self-asserted tier.

**What the gate gives you, precisely:** _auditable_ verification — what was checked, by what,
and what was punted is recorded and folded into the certificate, so over-trust and
answer-key leakage become **detectable**. It does **not** prove correctness, and it is
**not** "leakage-safe": a verifier that encodes the same misreading as you passes a wrong
claim with an external badge. Use it where a real check is _derivable from the spec and the
environment_; where none is, name an honest residual.

## Modes (`run.json` → `verification.mode`)

| Mode       | Behavior                                                                      |
| ---------- | ----------------------------------------------------------------------------- |
| `compat`   | **Default.** Identical to 1.x — the gate is off, certificates are unchanged.  |
| `advisory` | Unverified load-bearing claims raise `W_UNVERIFIED` warnings; nothing blocks. |
| `strict`   | A load-bearing claim converges only if **verified** or a **named residual**.  |

Proportionality is preserved: in `compat` (the default) 2.0 stays out of the way entirely.
Reach for `strict` on a task that earns it.

## A verifier is a command, not a package

Declare oracles up front in `run.json` (a capability model — a claim may only gate on a
registered oracle):

```json
{
	"verification": { "mode": "strict" },
	"oracles": {
		"unit": {
			"cmd": ["npm", "test"],
			"inputs": ["src/", "test/"],
			"trust": "dev_oracle"
		}
	}
}
```

A claim points at one:

```json
{
	"id": "c7",
	"type": "factual",
	"topic": "auth",
	"content": "login rejects an expired token",
	"evidence": "tested",
	"tags": ["load-bearing"],
	"verified_by": { "verifier": "unit" }
}
```

`bean-check` is a **pure adjudicator** — it reads recorded verdicts and never runs anything.
Execution lives in **`bean-verify`**, the only path that runs an oracle:

```bash
bean-verify --dir . --claim c7 --verifier unit   # runs the command, records a scrubbed verdict
bean-check  --dir .                               # reads the verdict; gates on it
```

`bean-verify` runs the command (`argv`, `shell:false`, claim JSON on stdin: exit 0 = pass,
nonzero = fail, spawn error/timeout = error), then writes a **scrubbed, committed** verdict
to `.bean/verdicts/<claim>.<verifier>.json` (hashes + verdict only — no raw output, no paths)
and a **local, gitignored** diagnostic to `.bean/verdicts-raw/`. Add `.bean/verdicts-raw/`
to your `.gitignore`.

## Convergence and exit codes

- **ready (exit 0)** — every load-bearing claim is externally verified.
- **converged-with-residuals (exit 4)** — no blockers, but some load-bearing claims rest on
  named residuals rather than verification. Converged, but **not clean** — review warranted.
- **blocked (exit 1)** / **budget-exceeded (exit 2)** / **usage error (exit 3)** — unchanged.

## Blocker codes (strict mode)

| Code                       | Means                                                             |
| -------------------------- | ----------------------------------------------------------------- |
| `E_UNVERIFIED_LOADBEARING` | load-bearing claim with no verifier and no named residual         |
| `E_ORACLE_FAILED`          | the recorded verdict is `fail`                                    |
| `E_ORACLE_STALE`           | the claim changed (or the oracle was re-pinned) after the verdict |
| `E_ORACLE_UNDECLARED`      | `verified_by` names an oracle not in the `run.json` registry      |
| `E_VERIFY_ERROR`           | no recorded verdict, or the oracle errored                        |

Warnings: `W_ORACLE_SINGLE` (every verified claim leans on one oracle — corroborate),
`W_SEALED_UNENFORCED` (a sealed-output policy is declared but `bean-check` cannot observe
file reads — it is an attestation, not an enforcement).

## Determinism

A verdict is recorded once and **replayed**, never re-run by `bean-check` — so a converged
ledger reproduces its certificate offline. A verdict is **stale** (blocks) when the claim's
content hash no longer matches the verdict's `claim_binding`, or a pinned `oracle_digest`
changed. The certificate binds the full regime (mode, load-bearing set, residual set, oracle
registry, verdicts), so two different verification regimes can never share a certificate; a
plain 1.x ledger's certificate is unchanged.

## Honest limits

- **Over-trust is the central limit**, not a footnote: a verifier testing the wrong thing
  certifies a wrong claim. Design the oracle independently; document what it does and doesn't
  cover.
- **Legitimacy is normative.** `bean-check` enforces "registered, fresh, passed"; it cannot
  _prove_ an oracle is answer-key-free (`trust` is declared, not verified). Sealed-read and
  answer-key classification are harness/normative concerns — labeled, never guaranteed.
