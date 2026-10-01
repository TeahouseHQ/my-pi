#!/usr/bin/env bash
set -euo pipefail

key="${LITELLM_PI_KEY:-${GRAFT_API_KEY:-}}"
if [[ -z "$key" ]]; then
  echo 'Set LITELLM_PI_KEY (or GRAFT_API_KEY) before building the graft deep tier.' >&2
  exit 1
fi

export GRAFT_PROVIDER=litellm
export GRAFT_BASE_URL="${GRAFT_BASE_URL:-http://127.0.0.1:4000/v1}"
export GRAFT_MODEL="${GRAFT_MODEL:-fast}"
export GRAFT_API_KEY="$key"

cd "$(dirname "$0")/.."
exec node --import "$PWD/scripts/graft-prompt-hook.mjs" "$(command -v graft)" build --deep "$@"
