#!/bin/sh
# Build the Go UI, GPU worker, and native helpers; serve only on localhost.
set -eu
cd "$(dirname "$0")"
terraform_assets=${ASSETS_ROOT:-/private/tmp/terraform-wgpu-run/assets}
mkdir -p web "$terraform_assets/bin"
GOOS=js GOARCH=wasm go build -ldflags="-s -w" -o web/terraform.wasm ./cmd/editor
GOOS=js GOARCH=wasm go build -ldflags="-s -w" -o web/renderworker.wasm ./cmd/renderworker
gzip -n -9 -c web/terraform.wasm > web/terraform.wasm.gz
gzip -n -9 -c web/renderworker.wasm > web/renderworker.wasm.gz
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" web/wasm_exec.js
go build -o "$terraform_assets/map-export" ./export
go build -o "$terraform_assets/bin/map-features" ./features
exec go run ./cmd/terraform --port "${PORT:-8891}" --assets-root "$terraform_assets" "$@"
