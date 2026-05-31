#!/bin/bash
DIR="${1:-all}"
CMD="${2:-all}"

sessions=(docs/frames/2026-05-29T12-47-47 docs/frames/2026-05-30T19-17-49)

run_gt() {
  echo ""
  echo "=========================================="
  echo "  GT — $(basename $1)"
  echo "=========================================="
  npx tsx scripts/test.ts gt "--dir=$1" 2>&1 | grep -v "^tracker:"
}

run_compare() {
  echo ""
  echo "=========================================="
  echo "  COMPARE — $(basename $1)"
  echo "=========================================="
  npx tsx scripts/test.ts compare "--dir=$1" 2>&1 | grep -v "^tracker:" | sed -n '/^=== DRIFT/,/^$/p'
}

if [ "$DIR" = "all" ]; then
  for s in "${sessions[@]}"; do
    if [ "$CMD" = "all" ] || [ "$CMD" = "gt" ]; then
      run_gt "$s"
    fi
    if [ "$CMD" = "all" ] || [ "$CMD" = "compare" ]; then
      run_compare "$s"
    fi
  done
else
  if [ "$CMD" = "all" ] || [ "$CMD" = "gt" ]; then
    run_gt "$DIR"
  fi
  if [ "$CMD" = "all" ] || [ "$CMD" = "compare" ]; then
    run_compare "$DIR"
  fi
fi
