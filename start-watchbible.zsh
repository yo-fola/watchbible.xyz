#!/bin/zsh
unsetopt XTRACE VERBOSE
# Run this yourself in Terminal. Do not put the token in chat or this file.
set -eu
cd -- "${0:A:h}"

# Resolve the runtime before asking for a credential. Hermes' tool PATH is not
# necessarily available in the user's ordinary Terminal.
node_bin="${WATCHBIBLE_NODE:-}"
if [[ -z "$node_bin" ]]; then
  node_bin="$(command -v node || true)"
fi
if [[ -z "$node_bin" ]]; then
  # Existing runtime verified on this Mac; no installation or shell changes.
  node_bin="$HOME/.hermes/tools/node-26.12.1-darwin-arm64/bin/node"
fi
if [[ ! -x "$node_bin" ]]; then
  print -u2 -- "Node runtime unavailable. Set WATCHBIBLE_NODE to a Node executable."
  exit 1
fi

if [[ -z "${TMDB_READ_ACCESS_TOKEN:-}" ]]; then
  # Metadata only: Node reads the private credential, never shell stdout/argv.
  if [[ ! -e .watchbible/tmdb-read-access-token && ! -L .watchbible/tmdb-read-access-token ]]; then
    print -u2 -- 'No local TMDB token configured. Run: /bin/zsh setup-watchbible-token.zsh'
    exit 1
  fi
fi
export PORT="${PORT:-8766}"
exec "$node_bin" server.mjs
