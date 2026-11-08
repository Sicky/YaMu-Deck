#!/bin/sh
set -eu
yamu_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
unset ELECTRON_RUN_AS_NODE
# Compatibility workaround for GPU child launch failures (1002) in Gamescope.
# Renderer processes keep their sandbox; only the GPU service moves in-process.
exec /bin/sh "$yamu_dir/start-yamu.sh" --steam-deck --ozone-platform=x11 --disable-gpu --in-process-gpu --fullscreen "$@"
