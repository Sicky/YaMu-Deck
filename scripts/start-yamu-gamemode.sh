#!/bin/sh
set -eu
yamu_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
unset ELECTRON_RUN_AS_NODE
exec /bin/sh "$yamu_dir/start-yamu.sh" --steam-deck --ozone-platform=x11 --disable-gpu --fullscreen "$@"
