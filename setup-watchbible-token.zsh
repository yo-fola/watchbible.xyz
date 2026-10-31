#!/bin/zsh
unsetopt XTRACE VERBOSE
# Run privately in your own Terminal; never pass a token as an argument.
set -eu
if [[ ! -t 0 ]]; then
  print -u2 -- 'Run this setup in an interactive Terminal. No token saved.'
  exit 1
fi
if (( $# )); then
  print -u2 -- 'No arguments accepted. Never pass a token on the command line.'
  exit 1
fi
cd -- "${0:A:h}"
exec /usr/bin/python3 setup_local_token.py
