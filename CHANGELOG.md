# Changelog

## 1.0.0 — 2026-06-15

Initial release. **bean** runs a task as a recursive convergence loop, modeled on how the
Fable model actually worked — adaptive, belief-revising self-correction — rather than a
fixed checklist.

### Core

- Convergence loop on a runtime (claim ledger + compiler): Frame → Survey → Investigate →
  Record → Compile → Revise beliefs → Converged? Repeat until it converges.
- **Runtime interface** — grainulator/wheat is the primary runtime; a minimal built-in
  ledger (`bean-stalk.md`) with hand-checked convergence is the fallback for Codex / bare
  installs.
- **Belief revision** is first-class, including revising the _user's_ stated beliefs when
  grounded evidence contradicts them (counter-sycophancy).
- **Grounding-first** — read the source / run the tool / query the system before asserting.
- **Verify by running or rendering** the artifact, never by re-reading it.
- **Never stop at caveats** — drive every open front to a confirmed non-issue, a verified
  fix, or a true residual that genuinely can't be reached.
- **Cross-model Codex blindspot** lane for independent verification on high-stakes work.
- Verbose by default; continuous subagent/connector orchestration each round.

### Packaging

- Dual plugin: Claude Code (`.claude-plugin/`) and Codex (`.codex-plugin/`), plus an
  `install.sh` fallback. `/bean` in both runtimes.
- Modular references under `skills/bean/references/`; smoke test validates manifests,
  frontmatter, and internal link resolution.
