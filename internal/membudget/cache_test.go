package membudget

import (
	"fmt"
	"testing"
)

func TestCacheRetainedDataStaysBounded(t *testing.T) {
	entries := []Entry{}
	limits := FromConfig(map[string]any{"heapMB": 128})
	retained := map[string]Entry{}
	for i := 0; i < 500; i++ {
		e := Entry{Key: fmt.Sprint(i), Bytes: 3 * MiB, Used: int64(i)}
		retained[e.Key] = e
		entries = entries[:0]
		for _, v := range retained {
			entries = append(entries, v)
		}
		for _, k := range Evictions(entries, limits.Cache()) {
			delete(retained, k)
		}
		var total int64
		for _, v := range retained {
			total += v.Bytes
		}
		if total > limits.Cache() {
			t.Fatalf("iteration %d retained %d", i, total)
		}
		if _, ok := retained[e.Key]; !ok {
			t.Fatal("latest tile evicted before oldest")
		}
	}
	entries = entries[:0]
	for _, v := range retained {
		entries = append(entries, v)
	}
	for _, k := range Evictions(entries, 0) {
		delete(retained, k)
	}
	if len(retained) != 0 {
		t.Fatal("zero cache should release every backing store")
	}
}
