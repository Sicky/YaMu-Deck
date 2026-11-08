#!/bin/sh
# Standalone diagnostic launcher for the existing Linux archive; no raw log file.
set -u
umask 077
yamu_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1
yamu_state="${XDG_STATE_HOME:-$HOME/.local/state}/yamu"
mkdir -p "$yamu_state" || exit 1
yamu_log="$yamu_state/gamemode-diagnostic.log"
printf '%s diagnostic-v1-start\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$yamu_log"
for yamu_name in DISPLAY WAYLAND_DISPLAY LD_PRELOAD LD_LIBRARY_PATH ELECTRON_RUN_AS_NODE; do
  case "$yamu_name" in
    DISPLAY) yamu_value=${DISPLAY:-} ;;
    WAYLAND_DISPLAY) yamu_value=${WAYLAND_DISPLAY:-} ;;
    LD_PRELOAD) yamu_value=${LD_PRELOAD:-} ;;
    LD_LIBRARY_PATH) yamu_value=${LD_LIBRARY_PATH:-} ;;
    ELECTRON_RUN_AS_NODE) yamu_value=${ELECTRON_RUN_AS_NODE:-} ;;
  esac
  if [ -n "$yamu_value" ]; then yamu_present=yes; else yamu_present=no; fi
  printf '%s-present=%s\n' "$yamu_name" "$yamu_present" >> "$yamu_log"
done
unset ELECTRON_RUN_AS_NODE
if [ ! -f "$yamu_dir/yamu" ]; then
  printf 'binary-missing: put this script beside the yamu executable\n' >> "$yamu_log"
  exit 127
fi
for yamu_binary in yamu chrome_crashpad_handler chrome-sandbox; do
  if [ -f "$yamu_dir/$yamu_binary" ] && [ ! -x "$yamu_dir/$yamu_binary" ]; then
    chmod u+x "$yamu_dir/$yamu_binary" || exit 126
  fi
done
yamu_temp=$(mktemp -d "$yamu_state/diagnostic.XXXXXX") || exit 1
yamu_fifo="$yamu_temp/output"
mkfifo "$yamu_fifo" || exit 1
yamu_pid= yamu_filter= yamu_monitor=
yamu_cleanup() {
  for yamu_child in "$yamu_pid" "$yamu_filter" "$yamu_monitor"; do
    if [ -n "$yamu_child" ]; then kill "$yamu_child" 2>/dev/null || :; fi
  done
  rm -f "$yamu_fifo"
  rmdir "$yamu_temp" 2>/dev/null || :
}
trap yamu_cleanup 0
trap 'printf "launcher-signal\n" >> "$yamu_log"; exit 143' HUP INT TERM
# Scrub in memory before any process output is written to disk. This does not
# enable verbose Chromium logging or collect the environment/command line.
awk '
  function scrub_long(s, out, part) {
    out = ""
    while (match(s, /[[:alnum:]_.~-]+/)) {
      part = substr(s, RSTART, RLENGTH)
      out = out substr(s, 1, RSTART - 1) (length(part) >= 24 ? "[long value redacted]" : part)
      s = substr(s, RSTART + RLENGTH)
    }
    return out s
  }
  {
    if (tolower($0) ~ /(authorization|cookie|oauth|access.token|refresh.token|password|secret)/) {
      print "native: [sensitive message redacted]"; fflush(); next
    }
    gsub(/https?:[^[:space:]]+/, "[url redacted]")
    print "native: " substr(scrub_long($0), 1, 600); fflush()
  }
' < "$yamu_fifo" >> "$yamu_log" &
yamu_filter=$!
printf 'native-flags=x11,disable-gpu,fullscreen; sandbox=enabled\n' >> "$yamu_log"
"$yamu_dir/yamu" --steam-deck --ozone-platform=x11 --disable-gpu --fullscreen "$@" > "$yamu_fifo" 2>&1 &
yamu_pid=$!
(
  sleep 8
  if kill -0 "$yamu_pid" 2>/dev/null; then
    printf 'native-alive-after-8s=yes\n' >> "$yamu_log"
    ps -p "$yamu_pid" -o stat=,comm= 2>/dev/null >> "$yamu_log" || :
  fi
) &
yamu_monitor=$!
if wait "$yamu_pid"; then yamu_status=0; else yamu_status=$?; fi
yamu_pid=
printf '%s native-exit-code=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$yamu_status" >> "$yamu_log"
# Let the filter flush its already-scrubbed output; cleanup stops any stragglers.
sleep 1
exit "$yamu_status"
