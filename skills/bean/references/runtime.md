# Reference: runtime

bean's loop runs against a **runtime** — the thing that stores what bean has learned and
tells it whether it has converged. The loop is written against an interface, so it works
on any runtime that provides two capabilities:

## The runtime interface

A bean runtime provides:

1. **A claim ledger** — durable, typed memory of what bean has learned.

   - `add(claim)` — record a typed claim: `factual | constraint | risk | recommendation | estimate`, at an evidence tier `stated < web < documented < tested < production`, with a topic and source.
   - `supersede(old, new)` / `resolve(conflict)` — overturn a prior claim and record why (belief revision).
   - The ledger persists across rounds and sessions. It is bean's "own notes" — the
     mechanism behind iterative self-improvement.

2. **A compiler** — scores the ledger and returns a **convergence signal**:

   - unresolved **conflicts** between claims,
   - **coverage gaps** (topics with no claims, or only one claim type),
   - **single-source / echo-chamber** topics,
   - **weak-evidence** topics (nothing above `web`),
   - a **confidence** read.

   The compiler is the failable check at the whole-task level. bean does not decide it is
   done; the compiler's signal does.

bean reads the compiler signal to choose its next move (step 2 of the loop) and to decide
convergence (step 6). Everything else — investigation, delegation, judgment — is the
model's.

## Primary runtime: grainulator / wheat

When grainulator/wheat is present (a `claims.json`, the `wheat` MCP server, or the
`wheat` CLI), use it as the full runtime. It implements the interface directly. See
[grainulation.md](grainulation.md) for the exact tools (`wheat add-claim` / `wheat add`,
`wheat compile`, `wheat resolve`, `wheat status`) and how the loop maps onto them.

## Minimal built-in ledger (fallback)

When grainulator is absent (e.g. on Codex or a bare Claude Code install), bean runs the
same loop against a **hand-maintained ledger** — lighter, but the same shape. Keep a file
`bean-stalk.md` in the working area:

```
| id  | type        | topic        | evidence   | status   | conflicts | claim                          |
| --- | ----------- | ------------ | ---------- | -------- | --------- | ------------------------------ |
| c1  | constraint  | scope        | stated     | active   |           | must support zero downtime     |
| c2  | factual     | schema       | documented | active   |           | orders.user_id is nullable     |
| c3  | factual     | schema       | tested     | supersedes c2 | resolves c2 | user_id is NOT NULL in prod |
```

Run the compiler checks **by hand** each round — they are simple list operations:

- **Conflicts:** any two active claims on the same (topic, subject) that disagree and
  aren't linked by `supersedes`/`resolves`.
- **Coverage gaps:** load-bearing topics with no claim, or only one claim type.
- **Single-source:** a topic whose claims all came from one source.
- **Weak evidence:** a load-bearing claim with nothing above `web`.
- **New-this-round:** did this round add or change any claim?

**Converged** when: no unresolved conflicts, every load-bearing claim is at `documented`
or better (or the gap is explicitly flagged), and a full round added nothing new.

The minimal ledger is deliberately lighter than grainulator — it has no automatic
conflict detection or numeric confidence. Say so in verbose output when you're running on
it, so the weaker convergence guarantee is visible.

## Degradation, stated honestly

Always name which runtime you're on. "Running on grainulator (wheat compile)" vs "running
on the built-in ledger (hand-checked convergence)" tells the user how strong the
stop-condition actually is.
