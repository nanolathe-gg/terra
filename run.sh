#!/bin/sh
# Build both Go/WASM programs and start the isolated local editor server.
set -eu
cd "$(dirname "$0")"
mkdir -p web
GOOS=js GOARCH=wasm go build -o web/terraform.wasm ./cmd/editor
GOOS=js GOARCH=wasm go build -o web/renderworker.wasm ./cmd/renderworker
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" web/wasm_exec.js
exec go run ./cmd/terraform --port "${PORT:-8891}" --assets-root "${ASSETS_ROOT:-/private/tmp/terraform-wgpu-run/assets}" --prepared "$@"
