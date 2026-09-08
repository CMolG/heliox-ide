#!/bin/sh
# fake-agent.sh — a deterministic stand-in for a vendor CLI, for the e2e suite.
#
# Pointed at by FLUXOR_AGENT_BIN_CLAUDE, it exercises the whole terminal path —
# PTY spawn, output push, keystrokes back, exit code — with no LLM, no network
# and no login, so `e2e/agent-session.spec.ts` is fast and cannot flake on a
# vendor's own behaviour. Since F4 it also stands in for Claude Code's HOOKS:
# given a `--settings` argument, it finds the loopback URL inside it and POSTs
# the same payloads the real binary would.
#
# Protocol:
#   prints ARGS: <argv> on start — the launch prompt reaches a vendor through
#     argv (vendors.ts: `claude [options] [prompt]`), and printing it is the
#     only way an e2e can assert the prompt actually arrived rather than
#     assuming the spawn carried it
#   prints FAKE AGENT READY on start
#   echoes each stdin line back prefixed with "echo:"
#   the line `exit` ends it with code 0
#   the line `fail` ends it with code 3
#   the lines `stop` / `perm` / `prompt` POST one hook event each (F4)
#
# TWO THINGS THE ARGS: LINE DELIBERATELY DOES NOT DO (F4, 2026-09-08):
#   1. It does not print the `--settings` VALUE. That JSON carries this
#      session's hook token, and the endpoint's whole contract is that the
#      token is never logged — printing it here would put it in the terminal
#      AND in `userData/sessions/<id>.log`, which is a file that outlives the
#      run.
#   2. It could not afford to anyway: the settings JSON is ~840 characters,
#      which wrapped to about ten rows and pushed `ARGS:` itself out of the
#      terminal's viewport. xterm keeps only the visible rows in the DOM, so
#      `card-session.spec.ts` stopped being able to see the line it asserts on.
#      Measured, not guessed — it is how this was found.

HOOK_URL=""
ARGS_OUT=""
skip_next=0

for arg in "$@"; do
  if [ "$skip_next" = 1 ]; then
    skip_next=0
    # Keep the URL, print only how big the blob was.
    HOOK_URL=$(printf '%s' "$arg" | grep -o 'http://[^"]*' | head -1)
    ARGS_OUT="$ARGS_OUT <${#arg}b>"
    continue
  fi
  case "$arg" in
    --settings) ARGS_OUT="$ARGS_OUT --settings"; skip_next=1 ;;
    *)          ARGS_OUT="$ARGS_OUT $arg" ;;
  esac
done

# One POST, best effort: a hook that cannot be delivered must not take the
# agent down with it — which is exactly how the real binary behaves.
post() {
  [ -n "$HOOK_URL" ] || return 0
  curl -s -X POST -H 'Content-Type: application/json' -d "$1" "$HOOK_URL" >/dev/null 2>&1 || true
}

echo "ARGS:$ARGS_OUT"
echo "FAKE AGENT READY"

while IFS= read -r line; do
  # A PTY delivers Enter as CR; strip it so the comparisons below match.
  line=$(printf '%s' "$line" | tr -d '\r')
  case "$line" in
    exit) exit 0 ;;
    fail) exit 3 ;;
    stop)
      post '{"hook_event_name":"Stop","session_id":"fake-agent","stop_hook_active":false,"last_assistant_message":"done for now"}'
      echo "posted:stop"
      ;;
    perm)
      post '{"hook_event_name":"Notification","notification_type":"permission_prompt"}'
      echo "posted:perm"
      ;;
    prompt)
      post '{"hook_event_name":"UserPromptSubmit","prompt":"go"}'
      echo "posted:prompt"
      ;;
    *) echo "echo:$line" ;;
  esac
done
# stdin closed without an explicit verb — still a clean end.
exit 0
