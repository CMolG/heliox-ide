#!/bin/sh
# fake-agent.sh — a deterministic stand-in for a vendor CLI, for the e2e suite.
#
# Pointed at by FLUXOR_AGENT_BIN_CLAUDE, it exercises the whole terminal path —
# PTY spawn, output push, keystrokes back, exit code — with no LLM, no network
# and no login, so `e2e/agent-session.spec.ts` is fast and cannot flake on a
# vendor's own behaviour.
#
# Protocol:
#   prints FAKE AGENT READY on start
#   echoes each stdin line back prefixed with "echo:"
#   the line `exit` ends it with code 0
#   the line `fail` ends it with code 3
echo "FAKE AGENT READY"
while IFS= read -r line; do
  # A PTY delivers Enter as CR; strip it so the comparisons below match.
  line=$(printf '%s' "$line" | tr -d '\r')
  case "$line" in
    exit) exit 0 ;;
    fail) exit 3 ;;
    *) echo "echo:$line" ;;
  esac
done
# stdin closed without an explicit verb — still a clean end.
exit 0
