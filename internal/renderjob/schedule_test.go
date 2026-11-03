package renderjob

import "testing"

func TestQueueKeepsOnlyLatestPendingView(t *testing.T) {
	q := NewQueue()
	q.Submit(Request{ID: 1, Kind: "view", Session: 4})
	active := <-q.Pending()
	for i := 2; i <= 100; i++ {
		q.Submit(Request{ID: i, Kind: "view", Session: 4})
	}
	if active.ID != 1 {
		t.Fatal(active.ID)
	}
	if next := <-q.Pending(); next.ID != 100 {
		t.Fatalf("stale pending job %d", next.ID)
	}
	select {
	case job := <-q.Pending():
		t.Fatalf("backlog contains %d", job.ID)
	default:
	}
}
func TestFinishOneTileOnlyForSameSessionViews(t *testing.T) {
	for _, tc := range []struct {
		kind    string
		session int
		next    Request
		want    bool
	}{{"view", 4, Request{Kind: "view", Session: 4}, true}, {"view", 4, Request{Kind: "view", Session: 5}, false}, {"view", 4, Request{Kind: "export", Session: 4}, false}, {"export", 4, Request{Kind: "view", Session: 4}, false}, {"view", 4, Request{Kind: "cancel", Session: 4}, false}} {
		if got := FinishViewTile(tc.kind, tc.session, tc.next); got != tc.want {
			t.Fatalf("%+v: %v", tc, got)
		}
	}
}

func TestQueueReturnsSupersededRPCForCancellation(t *testing.T) {
	q := NewQueue()
	q.Submit(Request{ID: 7, Kind: "heights", Session: 4})
	dropped := q.Submit(Request{ID: 8, Kind: "view", Session: 4})
	if dropped == nil || dropped.ID != 7 || dropped.Kind != "heights" {
		t.Fatalf("missing terminal cancellation metadata: %+v", dropped)
	}
	if next := <-q.Pending(); next.ID != 8 {
		t.Fatal(next.ID)
	}
}
