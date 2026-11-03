package membudget

import "sort"

type Entry struct {
	Key   string
	Bytes int64
	Used  int64
}

// Evictions selects oldest backing stores until retained bytes fit the new
// limit. Entries need not be sorted; a lowered live limit takes effect at once.
func Evictions(entries []Entry, limit int64) []string {
	limit = max(0, limit)
	var total int64
	for _, e := range entries {
		total += max(0, e.Bytes)
	}
	if total <= limit {
		return nil
	}
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].Used == entries[j].Used {
			return entries[i].Key < entries[j].Key
		}
		return entries[i].Used < entries[j].Used
	})
	out := []string{}
	for _, e := range entries {
		if total <= limit {
			break
		}
		total -= max(0, e.Bytes)
		out = append(out, e.Key)
	}
	return out
}
