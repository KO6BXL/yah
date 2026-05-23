#!/bin/sh

set -eu

if [ -z "${HOME:-}" ]; then
    echo "No home environment"
    exit 1
fi

WORK_DIR="$HOME/.local/share/yah/local-yah"
bun build --compile --outfile "$WORK_DIR/tmp-yah" "$WORK_DIR/src/index.ts"

if command -v pgrep >/dev/null 2>&1; then
    pids="$(pgrep -x yah || true)"
else
    pids=""
fi

if [ -n "$pids" ]; then
    kill -s SIGUSR1 $pids || true
fi

if "$WORK_DIR/tmp-yah"; then
    echo "Success in running tmp-yah"
else 
    yah
fi
