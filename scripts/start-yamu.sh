#!/bin/sh
# Native Linux launcher. Keep the sandbox and inherited Steam session environment.
set -eu
umask 077
yamu_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
yamu_state="${XDG_STATE_HOME:-$HOME/.local/state}/yamu"
mkdir -p "$yamu_state"
printf '%s launcher-start\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$yamu_state/launcher.log"
for yamu_binary in yamu chrome_crashpad_handler chrome-sandbox; do
  if [ -f "$yamu_dir/$yamu_binary" ] && [ ! -x "$yamu_dir/$yamu_binary" ]; then
    chmod u+x "$yamu_dir/$yamu_binary"
  fi
done
if "$yamu_dir/yamu" "$@"; then
  yamu_status=0
else
  yamu_status=$?
fi
printf '%s exit-code=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$yamu_status" >> "$yamu_state/launcher.log"
exit "$yamu_status"
