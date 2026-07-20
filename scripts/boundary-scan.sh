#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

join_token() {
  local out=""
  for part in "$@"; do
    out+="$part"
  done
  printf '%s' "$out"
}

forbidden_patterns=(
  "$(join_token Vr eko)"
  "$(join_token Snap Back)"
  "$(join_token snap back)"
  "$(join_token @ snap back /)"
  "$(join_token @ vr eko /)"
  "$(join_token lin ear .app)"
  "$(join_token dop pler)"
  "$(join_token fly .io)"
  "$(join_token neon .tech)"
  "$(join_token Con ductor)"
  "$(join_token Spec ' ' Writer)"
  "$(join_token Audi tor)"
  "$(join_token Advi sor)"
  "$(join_token sw arm)"
  "$(join_token Lang fuse)"
  "$(join_token HAC -)"
  "$(join_token VR -)"
  "$(join_token TL - U)"
)

# Scanned as whole words AND case-sensitively (grep -w, no -i). The tracker
# name is a proper noun, so real references capitalise it (issue mentions,
# operating-rule headings); the CSS gradient function is always lowercase.
# Case is what separates them — -w alone is not enough, because a hyphen
# counts as a word boundary, so the lowercase gradient token matches -w too.
# Keep this comment free of the capitalised token or the scan flags itself.
forbidden_word_patterns=(
  "$(join_token Lin ear)"
)

allowed_secret_files=(
  ".env.example"
)

while IFS= read -r file; do
  case "$file" in
    ./.windsurf/mcp.json) continue ;;
    ./.git/*) continue ;;
    ./node_modules/*) continue ;;
    ./dist/*) continue ;;
    ./coverage/*) continue ;;
  esac

  # Skip any .env file that isn't tracked by git (local secrets, never should be scanned)
  if [[ "$(basename "$file")" == ".env" ]] && ! git ls-files --error-unmatch "${file#./}" >/dev/null 2>&1; then
    continue
  fi

  if [[ "$(basename "$file")" == ".env" ]] && git ls-files --error-unmatch "${file#./}" >/dev/null 2>&1; then
    echo "boundary-scan: forbidden file $file"
    exit 1
  fi

  for pattern in "${forbidden_patterns[@]}"; do
    if grep -Iq . "$file" && grep -Fiq "$pattern" "$file"; then
      echo "boundary-scan: forbidden token [$pattern] in $file"
      exit 1
    fi
  done

  for pattern in "${forbidden_word_patterns[@]}"; do
    if grep -Iq . "$file" && grep -Fwq "$pattern" "$file"; then
      echo "boundary-scan: forbidden token [$pattern] in $file"
      exit 1
    fi
  done
# Scope: files git actually publishes, not the whole working tree. The guard
# protects what a reader of the repo can see; untracked scratch (local logs,
# scratch demo notes, editor state) cannot leak and must not be able to hold
# the gate red. Scanning the filesystem was an implementation accident that
# produced false reds on files that never ship — and a gate that can never go
# green is the thing that pressures people into --no-verify.
done < <(git ls-files | sed 's|^|./|')

echo "boundary-scan: clean"
