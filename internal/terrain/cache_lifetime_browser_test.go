//go:build js && wasm

package terrain

import "testing"

func TestBrowserCachePagesOutliveSubmittedGather(t *testing.T) { checkCacheLifetime(t) }
