#!/usr/bin/env bash
#
# bean installer (fallback to the plugin marketplace).
# Copies the bean skill + command into your Claude Code config, and the skill into
# your Codex config when present. Documentation-only: no dependencies, no servers.
#
# Usage:
#   ./install.sh                 # install for the current user
#   CLAUDE_CONFIG_DIR=... ./install.sh
#
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
CODEX_DIR="${CODEX_CONFIG_DIR:-$HOME/.codex}"

install_claude() {
	mkdir -p "$CLAUDE_DIR/skills"
	rm -rf "$CLAUDE_DIR/skills/bean"
	cp -R "$REPO_DIR/skills/bean" "$CLAUDE_DIR/skills/bean"
	echo "  installed bean -> $CLAUDE_DIR/skills/bean (provides /bean)"
}

install_codex() {
	if [ -d "$CODEX_DIR" ]; then
		mkdir -p "$CODEX_DIR/skills"
		rm -rf "$CODEX_DIR/skills/bean"
		cp -R "$REPO_DIR/skills/bean" "$CODEX_DIR/skills/bean"
		echo "  installed bean -> $CODEX_DIR/skills/bean"
	else
		echo "  (Codex config dir $CODEX_DIR not found — skipping Codex install)"
	fi
}

echo "Installing bean..."
install_claude
install_codex
echo "Done. Restart your client, then invoke /bean."
