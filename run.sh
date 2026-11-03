#!/bin/sh
# Build the Go UI, GPU worker, and native helpers; serve only on localhost.
set -eu
cd "$(dirname "$0")"
terraform_assets=${ASSETS_ROOT:-/private/tmp/terraform-wgpu-run/assets}
mkdir -p web "$terraform_assets/bin"
# Publish complete files so a browser cannot fetch a partially rebuilt module.
terraform_build=$(mktemp -d web/.build.XXXXXX)
trap 'rm -f "$terraform_build/terraform.wasm" "$terraform_build/renderworker.wasm" "$terraform_build/terraform.wasm.gz" "$terraform_build/renderworker.wasm.gz" "$terraform_build/wasm_exec.js"; rmdir "$terraform_build"' 0
GOOS=js GOARCH=wasm go build -ldflags="-s -w" -o "$terraform_build/terraform.wasm" ./cmd/editor
GOOS=js GOARCH=wasm go build -ldflags="-s -w" -o "$terraform_build/renderworker.wasm" ./cmd/renderworker
gzip -n -9 -c "$terraform_build/terraform.wasm" > "$terraform_build/terraform.wasm.gz"
gzip -n -9 -c "$terraform_build/renderworker.wasm" > "$terraform_build/renderworker.wasm.gz"
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" "$terraform_build/wasm_exec.js"
for terraform_file in terraform.wasm renderworker.wasm wasm_exec.js terraform.wasm.gz renderworker.wasm.gz; do
    mv "$terraform_build/$terraform_file" "web/$terraform_file"
done
rmdir "$terraform_build"
trap - 0
go build -o "$terraform_assets/map-export" ./export
go build -o "$terraform_assets/bin/map-features" ./features
exec go run ./cmd/terraform --port "${PORT:-8891}" --assets-root "$terraform_assets" "$@"
