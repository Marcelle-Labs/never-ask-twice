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
  "$(join_token linear .app)"
  "$(join_token dop pler)"
  "$(join_token fly .io)"
  "$(join_token neon .tech)"
  "$(join_token Con ductor)"
  "$(join_token Spec ' ' Writer)"
  "$(join_token Audi tor)"
  "$(join_token Advi sor)"
  "$(join_token sw arm)"
  "$(join_token Lang fuse)"
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
done < <(find . \
  -path "./.git" -prune -o \
  -path "./node_modules" -prune -o \
  -path "./dist" -prune -o \
  -path "./coverage" -prune -o \
  -path "./docs/B2B support agent memory design" -prune -o \
  -type f -print)

echo "boundary-scan: clean"
