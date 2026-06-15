# Security Policy

## Supported versions

The latest released minor version receives security updates.

## Reporting a vulnerability

bean is a small, dependency-free skill: Markdown + JSON plus one zero-dependency Node CLI
(`bean-check`) that reads and writes local `.bean/*.json` files. It makes no network calls
and has no telemetry or runtime dependencies. The most likely concerns are prompt-injection
or misleading guidance in the skill text rather than executable vulnerabilities; for the
CLI, the surface is local file I/O only.

Please report any concern via GitHub Security Advisories on this repository (preferred),
or by email to security@grainulator.app.

We aim to acknowledge reports within a few business days and to resolve confirmed issues
within a 90-day disclosure window.

## Installing safely

bean installs into your agent's context, so treat it like any third-party plugin: prefer a
tagged release over a moving branch (pin a `--ref`) and re-review on update. The default
ledger is local-only; the only optional outbound path is the grainulator/wheat remote
dashboard, which stays off unless you wire it in.

## Scope

In scope:

- Skill or reference text that could induce unsafe, destructive, or deceptive behavior.
- Manifest content that misrepresents what the plugin does.
- The `bean-check` CLI (`bin/bean-check.js`): local file handling and input parsing.

Out of scope:

- The behavior of the underlying model. bean shapes procedure; it cannot constrain a
  model's raw capability.
