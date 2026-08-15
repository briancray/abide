#!/usr/bin/env bash
# Mechanical tier for the `conform` skill: every CLAUDE.md rule that a pattern can
# find. Prints CANDIDATES, not violations — the rule in CLAUDE.md decides.
#
#   checks.sh            counts only
#   checks.sh --details  counts plus every matching line
#   checks.sh --gate     typecheck + bun test only (the fast pre/post gate)
#   checks.sh --e2e      add `bun run e2e` to the gate (slow; Phase 0 and end-of-cluster)
#   checks.sh --units    file/line counts per CLUSTERS.md unit, to catch table drift

set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 1

DETAILS=0
GATE_ONLY=0
WANT_E2E=0
UNITS_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --details) DETAILS=1 ;;
    --gate) GATE_ONLY=1 ;;
    --e2e) WANT_E2E=1 ;;
    --units) UNITS_ONLY=1 ;;
  esac
done

# TS1149: the checker resolves this repo case-sensitively. Reaching it through a
# ~/code symlink fails typecheck with errors that have nothing to do with the code.
case "$PWD" in
  */Code/*) ;;
  *) echo "warn: cwd is '$PWD' — use the ~/Code casing or typecheck fails on TS1149" ;;
esac

# The CLUSTERS.md unit table, so a stale table is one command away from being seen.
UNITS=(
  packages/abide/compiler
  packages/abide/cli
  packages/abide/src/shared
  packages/abide/src/server
  packages/abide/src/ui
  packages/harness
  packages/dogfood/demos
  packages/dogfood/test
  packages/dogfood/pages
  packages/dogfood/site
  packages/perf
)

units() {
  echo "== units =="
  printf "  %-32s %5s %8s\n" "UNIT" "FILES" "LINES"
  for unit in "${UNITS[@]}"; do
    if [ ! -d "$unit" ]; then
      printf "  %-32s %s\n" "$unit" "MISSING — CLUSTERS.md is stale"
      continue
    fi
    files=$(find "$unit" -type f \( -name '*.ts' -o -name '*.abide' \) -not -path '*/node_modules/*' | wc -l | tr -d ' ')
    lines=$(find "$unit" -type f \( -name '*.ts' -o -name '*.abide' \) -not -path '*/node_modules/*' -exec cat {} + | wc -l | tr -d ' ')
    printf "  %-32s %5s %8s\n" "$unit" "$files" "$lines"
  done
  echo
  echo "  a unit whose count moved a lot since CLUSTERS.md wrote it down may no longer"
  echo "  fit one agent's context whole — split it or say so in the round."
}

[ "$UNITS_ONLY" = 1 ] && { units; exit 0; }

# No `timeout` on darwin. CLAUDE.md: a suite that HANGS reports nothing at all — no
# failed test, no summary — so an uncapped run stalls this script with no output.
run_capped() {
  local secs=$1 log=$2
  shift 2
  "$@" >"$log" 2>&1 &
  local job=$!
  ( sleep "$secs"; kill -9 "$job" 2>/dev/null ) &
  local watchdog=$!
  wait "$job"
  local rc=$?
  kill "$watchdog" 2>/dev/null
  wait "$watchdog" 2>/dev/null
  return $rc
}

# label, seconds, logfile, command... — the cap is named ONCE, so the "killed at Ns" line cannot
# drift from the cap that actually killed it.
stage() {
  local label=$1 secs=$2 log=$3
  shift 3
  run_capped "$secs" "$log" "$@"
  local rc=$?
  [ "$rc" = 0 ] && return 0
  if [ "$rc" -ge 128 ]; then
    printf '  %-10s HANG — killed at %ss. Bisect by file, then by test with -t. See %s\n' "$label" "$secs" "$log"
  else
    printf '  %-10s FAIL — see %s\n' "$label" "$log"
  fi
  return 1
}

gate() {
  echo "== gate =="
  stage typecheck 300 /tmp/conform-tc.log bun run typecheck || return 1
  printf '  %-10s ok\n' typecheck

  stage tests 600 /tmp/conform-test.log bun test || return 1
  printf '  %-10s %s, %s\n' tests \
    "$(grep -Eo '[0-9]+ pass' /tmp/conform-test.log | tail -1)" \
    "$(grep -Eo '[0-9]+ fail' /tmp/conform-test.log | tail -1)"

  if [ "$WANT_E2E" = 1 ]; then
    stage e2e 900 /tmp/conform-e2e.log bun run e2e || return 1
    printf '  %-10s %s\n' e2e "$(grep -Eo '[0-9]+ passed' /tmp/conform-e2e.log | tail -1)"
  else
    printf '  %-10s skipped — pass --e2e for the browser gate\n' e2e
  fi
}

gate || exit 1
[ "$GATE_ONLY" = 1 ] && exit 0

# name | CLAUDE.md section the hits are judged against | command
CHECKS=(
  "seam escapes|seams and imports|grep -rn \"from ['\\\"]\\.\\./\\.\\./\" --include=*.ts --include=*.abide packages/abide"
  "alias leaks|seams and imports|grep -rn \"from ['\\\"][\$]\\(server\\|ui\\|shared\\|compiler\\)/\" --include=*.ts --include=*.abide --exclude-dir=.abide --exclude-dir=node_modules packages/harness packages/dogfood packages/perf"
  "measure graph|seams and imports|grep -rn \"from ['\\\"]abide\" packages/harness/measure.ts packages/harness/internal/assert.ts packages/harness/internal/bench.ts packages/harness/internal/dom.ts packages/harness/internal/probes.ts"
  "spawn reaches an app|seams and imports|grep -rn \"packages/\\(dogfood\\|perf\\)\" packages/harness/spawn.ts | grep -v ':[[:space:]]*\\(\\*\\|//\\)'"
  "node: imports|writing code|grep -rn \"from ['\\\"]node:\" --include=*.ts packages/abide"
  "style= props|writing code|grep -rn \"style=\" --include=*.abide --include=*.ts --exclude-dir=.abide --exclude-dir=node_modules packages"
  "lowercase constants|writing code|grep -rnE \"^const [a-z][A-Za-z0-9_]* = (['\\\"\\\`]|[0-9]|true|false)\" --include=*.ts packages/abide packages/harness"
  "iterator chains|hot paths|grep -rnE \"\\.(map|filter)\\(.*\\)\\.(map|filter|reduce)\\(\" --include=*.ts packages/abide"
  "unguarded await|hot paths|grep -rn \"await \" --include=*.ts packages/abide/src packages/abide/compiler"
  "isThenable guards|hot paths|grep -rn \"isThenable\" --include=*.ts packages/abide/src packages/abide/compiler"
  "toString as source|demos and docs|grep -rn \"Function.prototype.toString\" --include=*.ts --include=*.abide --exclude-dir=.abide --exclude-dir=node_modules packages/dogfood"
  "misnamed e2e specs|checks|find packages -name '*.spec.ts' -not -path '*/node_modules/*'"
  "perf stylesheet|directory structure|grep -rnE \"<link[^>]*stylesheet|<style|[.]css['\\\"]\" --include=*.html --include=*.ts --include=*.abide --exclude-dir=.abide --exclude-dir=node_modules packages/perf"
)

echo
echo "== candidates =="

# Every path a check names, checked to EXIST before any of them run. `eval` below swallows grep's
# "No such file", so a check pointed at a renamed directory reports 0 forever — which reads as clean.
# Five did exactly that through the abide-kit -> harness and example -> dogfood renames.
missing=$(
  for row in "${CHECKS[@]}"; do
    printf '%s\n' "${row#*|*|}" | grep -oE 'packages/[A-Za-z0-9./_-]+'
  done | sort -u | while read -r path; do [ -e "$path" ] || echo "$path"; done
)
if [ -n "$missing" ]; then
  echo "  STALE — a check names a path that does not exist, and would report 0:"
  printf '    %s\n' $missing
  echo
fi

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

cat <<'NOTE'

  three of those read backwards, and the count alone is the wrong answer:
    measure graph      — the harness MAY import abide; `harness/measure` may not, and
                         this greps only measure.ts's own graph. any hit is a violation.
    unguarded await    — a ratio against isThenable, not a list. read the per-row ones.
    perf stylesheet    — app.html's comment about NOT shipping one matches too.
NOTE

echo
echo "== dead surface =="
echo "  reminder: an export in abide's \`exports\` map is public SURFACE."
echo "  knip reporting it unused = a dogfood gap, not machinery to delete."
echo "  it also cannot see an import made from a .abide file, so a module only a page"
echo "  imports reads as unused."
if bunx --bun knip --version >/dev/null 2>&1; then
  bunx --bun knip --workspace packages/abide 2>&1 | tail -40
else
  echo "  knip not installed — run: bunx knip --workspace packages/abide"
fi

echo
echo "  lint:"
bun run lint 2>&1 | grep -E "Found|Checked" | sed 's/^/    /'

echo
units
