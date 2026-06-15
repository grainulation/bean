# Reference: convergence

The convergence loop replaces "do these N phases" with "keep going until there's nothing
decisive left to learn." Two questions drive every round: **what do I investigate next?**
and **am I done?** Both are answered by the compiler signal, not by a step counter.

## Picking the next move

Each round, investigate the **most decisive open front** — the one whose answer most
changes the outcome. Read it off the compiler signal, roughly in this priority:

1. **Unresolved conflict** — two claims disagree. Resolve it before building on either; a
   contradiction at the core poisons everything downstream.
2. **A load-bearing claim with weak evidence** — the conclusion rests on something only
   `stated` or `web`. Go get `documented`/`tested` evidence, or find it's false.
3. **A coverage gap** — a topic the answer needs but the ledger doesn't cover, or covers
   with only one claim type.
4. **A single-source / echo-chamber topic** — everything came from one place; corroborate
   independently.

If several are tied, prefer the one that could most cheaply prove you _wrong_. The fastest
path to a right answer is killing wrong beliefs early.

## The self-correction progression

A useful shape for each investigation — **fail → investigate → verify → distill →
consult**:

- **fail** — try the most decisive thing; expect to be partly wrong.
- **investigate** — when a check fails or a conflict appears, dig into _why_, don't paper over it.
- **verify** — confirm the fix against a real signal (a test, a source, a compile), not introspection.
- **distill** — record the resolved understanding as a claim; supersede what it overturns.
- **consult** — when stuck or the signal is ambiguous, bring in an independent view (a subagent, a connector, the cross-model blindspot lane) rather than guessing.

## Don't stop at caveats — drive each front to closure

This is the trait that separates a convergence loop from a one-shot answer with a footnote.
When a round ends with "looks done, but X is unverified / Y might be a problem," **that is
not done** — each open front must be driven to one of exactly three terminal states:

- **Confirmed non-issue** — you grounded it and it's fine (with the evidence to show it).
- **Fixed** — you closed it and verified the fix by running/rendering (`stated` → `tested`).
- **True blocker / genuine residual** — it cannot be resolved from where you are: it needs
  a human decision, an access you don't have, or a system you can't run. Name it precisely
  and say _why_ it's unreachable.

A caveat that is none of these three is just a place you stopped early. "Here are some
things to watch" is a cop-out; "here is the one thing I genuinely cannot verify, and the
exact check that would close it" is the honest end state. Keep looking where a one-shot
answer would quit — that persistence is most of bean's value.

### …but persistence is not over-engineering

The same drive, unbounded, is a known failure mode: a relentlessly proactive model will
burn a fortune building elaborate workarounds for a problem a human could have answered in
ten seconds, and ship a symptom-level band-aid it never had to. Persistence means not
abandoning a **decisive** front, not manufacturing heroics on a trivial one. Three checks
keep it honest:

- **Proportion the effort to the stakes.** A two-line fix does not earn a convergence
  loop or a browser-automation rig. If the trigger gate barely fired, do the small thing
  and stop.
- **Asking the human is a legitimate way to close a front** — it's the "consult" move, and
  it's often the cheapest. If a screenshot, a credential, or a one-word answer would save a
  long token rabbit hole, ask for it instead of engineering around the human.
- **Fix the cause, not the symptom.** "The error went away" is not the same as "I
  understand why it happened." Before calling a front closed, check you addressed the root,
  not just silenced the signal.

## Knowing when to stop

bean is **converged** when all three hold:

- **No unresolved conflicts** in the ledger.
- **Evidence bar met** — every load-bearing claim is at `documented` or better, or its gap
  is an explicit _true residual_ (not an unexamined caveat).
- **Dry round** — a full Survey → Investigate → Compile round drove no open front to a new
  terminal state.

The dry-round test prevents both premature stopping (one answer and done) and endless
spinning (re-deriving the same claims). If rounds keep adding noise but move no front to
confirmed/fixed/true-blocker, that itself is a dry round — stop.

## Guardrails against false convergence

- **Ambiguous signals don't count as convergence.** If the only reason a topic looks
  settled is that you couldn't get a real signal, that's an open front to drive, not a pass.
  (Fable's loop degraded exactly when the external signal was ambiguous; don't let "no
  signal" read as "good signal.")
- **Budget the loop.** Set a round or token ceiling up front. If you hit it before
  converging, stop and deliver what you have _with the open fronts named as open_ — never
  silently truncate, and never relabel "ran out of budget" as "done."
- **Dedup against everything seen, not just what survived.** When checking "new this
  round," compare against all claims ever raised, including rejected ones — otherwise a
  rejected idea reappears every round and the loop never converges.
