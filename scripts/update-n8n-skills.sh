#!/usr/bin/env bash
set -euo pipefail

REPO="haunchen/n8n-skills"
DEST=".claude/skills/n8n-skills"
TMP_DIR=$(mktemp -d)

cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

# get latest release tag
TAG=$(gh release list --repo "$REPO" --limit 1 --json tagName --jq '.[0].tagName')
if [ -z "$TAG" ]; then
  echo "error: could not fetch latest release from $REPO"
  exit 1
fi

echo "downloading n8n-skills $TAG..."
gh release download "$TAG" --repo "$REPO" --pattern "*.zip" --dir "$TMP_DIR"

ZIP=$(find "$TMP_DIR" -name "*.zip" | head -1)
if [ -z "$ZIP" ]; then
  echo "error: no zip file found in release $TAG"
  exit 1
fi

unzip -qo "$ZIP" -d "$TMP_DIR/extracted"

# replace existing skills
rm -rf "$DEST"
mkdir -p "$DEST"
cp -r "$TMP_DIR/extracted/"* "$DEST/"

FILE_COUNT=$(find "$DEST" -type f | wc -l | tr -d ' ')
echo "installed n8n-skills $TAG ($FILE_COUNT files) in $DEST"
