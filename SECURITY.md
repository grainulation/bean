# Security Policy

## Supported versions

The latest released minor version receives security updates.

## Reporting a vulnerability

bean is a documentation-only skill (Markdown + JSON, no runtime code, no dependencies,
no network calls). The most likely "security" concerns are prompt-injection or
misleading guidance in the skill text rather than executable vulnerabilities.

Please report any concern via GitHub Security Advisories on this repository (preferred),
or by email to security@grainulator.app.

We aim to acknowledge reports within a few business days and to resolve confirmed issues
within a 90-day disclosure window.

## Scope

In scope:

- Skill or reference text that could induce unsafe, destructive, or deceptive behavior.
- Manifest content that misrepresents what the plugin does.

Out of scope:

- The behavior of the underlying model. bean shapes procedure; it cannot constrain a
  model's raw capability.
