#!/usr/bin/env bash
# Mechanical tier for the `conform` skill: every CLAUDE.md rule that a pattern can
# find. Prints CANDIDATES, not violations — the rule in CLAUDE.md decides.
#
#   checks.sh            counts only
#   checks.sh --details  counts plus every matching line
#   checks.sh --gate     typecheck + test only (the pre/post gate)

set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 1

DETAILS=0
GATE_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --details) DETAILS=1 ;;
    --gate) GATE_ONLY=1 ;;
  esac
done

# TS1149: the checker resolves this repo case-sensitively. Reaching it through a
# ~/code symlink fails typecheck with errors that have nothing to do with the code.
case "$PWD" in
  */Code/*) ;;
  *) echo "warn: cwd is '$PWD' — use the ~/Code casing or typecheck fails on TS1149" ;;
esac

gate() {
  echo "== gate =="
  bun run typecheck >/tmp/conform-tc.log 2>&1 \
    && echo "  typecheck  ok" \
    || { echo "  typecheck  FAIL — see /tmp/conform-tc.log"; return 1; }
  bun test >/tmp/conform-test.log 2>&1 \
    && echo "  tests      $(grep -Eo '[0-9]+ pass' /tmp/conform-test.log | tail -1), $(grep -Eo '[0-9]+ fail' /tmp/conform-test.log | tail -1)" \
    || { echo "  tests      FAIL — see /tmp/conform-test.log"; return 1; }
}

gate || exit 1
[ "$GATE_ONLY" = 1 ] && exit 0

# name | CLAUDE.md section the hits are judged against | command
CHECKS=(
  "seam escapes|seams and imports|grep -rn \"from ['\\\"]\\.\\./\\.\\./\" --include=*.ts --include=*.abide packages/abide"
  "node: imports|writing code|grep -rn \"from ['\\\"]node:\" --include=*.ts packages/abide"
  "style= props|writing code|grep -rn \"style=\" --include=*.abide --include=*.ts packages"
  "iterator chains|hot paths|grep -rnE \"\\.(map|filter)\\(.*\\)\\.(map|filter|reduce)\\(\" --include=*.ts packages/abide"
  "unguarded await|hot paths|grep -rn \"await \" --include=*.ts packages/abide/src packages/abide/compiler"
  "isThenable guards|hot paths|grep -rn \"isThenable\" --include=*.ts packages/abide/src packages/abide/compiler"
)

echo
echo "== candidates =="
printf "  %-20s %-24s %s\n" "CHECK" "JUDGED AGAINST" "HITS"
for row in "${CHECKS[@]}"; do
  IFS='|' read -r name section cmd <<<"$row"
  hits=$(eval "$cmd" 2>/dev/null | wc -l | tr -d ' ')
  printf "  %-20s %-24s %s\n" "$name" "$section" "$hits"
  if [ "$DETAILS" = 1 ] && [ "$hits" != "0" ]; then
    eval "$cmd" 2>/dev/null | sed 's/^/      /'
    echo
  fi
done

echo
echo "== dead surface =="
echo "  reminder: an export in abide's \`exports\` map is public SURFACE."
echo "  knip reporting it unused = a dogfood gap, not machinery to delete."
if bunx --bun knip --version >/dev/null 2>&1; then
  bunx --bun knip --workspace packages/abide 2>&1 | tail -40
else
  echo "  knip not installed — run: bunx knip --workspace packages/abide"
fi

echo
echo "  lint:"
bun run lint 2>&1 | grep -E "Found|Checked" | sed 's/^/    /'
