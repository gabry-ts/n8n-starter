#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

usage() {
  echo "usage: $0 [claude|gemini|all]"
  exit 1
}

setup_claude() {
  if [[ ! -d "$ROOT_DIR/.claude/skills/n8n-skills" ]]; then
    echo "error: .claude/skills/n8n-skills/ not found"
    exit 1
  fi
  if [[ ! -f "$ROOT_DIR/CLAUDE.md" ]]; then
    echo "error: CLAUDE.md not found"
    exit 1
  fi
  echo "claude: skills and config already in place"
}

setup_gemini() {
  # create .gemini/skills/ directory
  mkdir -p "$ROOT_DIR/.gemini/skills"

  # symlink n8n-skills from claude source
  local target="$ROOT_DIR/.gemini/skills/n8n-skills"
  if [[ -L "$target" ]]; then
    rm "$target"
  elif [[ -d "$target" ]]; then
    rm -rf "$target"
  fi
  ln -s "../../.claude/skills/n8n-skills" "$target"
  echo "gemini: symlinked .gemini/skills/n8n-skills -> .claude/skills/n8n-skills"

  # generate GEMINI.md from CLAUDE.md
  sed \
    -e 's/# CLAUDE\.md/# GEMINI.md/' \
    -e 's/\.claude\/skills/\.gemini\/skills/g' \
    -e 's/\.claude\//\.gemini\//g' \
    -e 's/CLAUDE\.md/GEMINI\.md/g' \
    "$ROOT_DIR/CLAUDE.md" > "$ROOT_DIR/GEMINI.md"
  echo "gemini: generated GEMINI.md from CLAUDE.md"
}

[[ $# -lt 1 ]] && usage

case "$1" in
  claude) setup_claude ;;
  gemini) setup_gemini ;;
  all)    setup_claude && setup_gemini ;;
  *)      usage ;;
esac
