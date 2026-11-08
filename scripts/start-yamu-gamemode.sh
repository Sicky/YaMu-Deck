#!/bin/sh
set -eu
yamu_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec /bin/sh "$yamu_dir/start-yamu.sh" --steam-deck --fullscreen "$@"
