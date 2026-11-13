#!/bin/sh
# The default is fast Node checks. Use --help for focused integration groups.
exec node "$(dirname "$0")/check.mjs" "$@"
