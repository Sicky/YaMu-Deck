#!/bin/sh
# Launcher for Linux archives extracted from a Windows-built distribution.
set -eu
yamu_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
for yamu_binary in yamu chrome_crashpad_handler chrome-sandbox; do
  if [ -f "$yamu_dir/$yamu_binary" ] && [ ! -x "$yamu_dir/$yamu_binary" ]; then
    chmod u+x "$yamu_dir/$yamu_binary"
  fi
done
exec "$yamu_dir/yamu" "$@"
