package renderjob

import "sync"

// Queue retains one pending snapshot while the worker finishes its current tile.
// New pointer samples replace pending work instead of building a stale backlog.
type Queue struct {
	mu      sync.Mutex
	pending chan Request
}

func NewQueue() *Queue { return &Queue{pending: make(chan Request, 1)} }
func (q *Queue) Submit(job Request) *Request {
	var dropped *Request
	q.mu.Lock()
	defer q.mu.Unlock()
	select {
	case old := <-q.pending:
		dropped = &old
	default:
	}
	q.pending <- job
	return dropped
}
func (q *Queue) Pending() <-chan Request { return q.pending }

// FinishViewTile permits one useful image to finish while a newer view waits.
// Session changes, exports and explicit cancellation still interrupt stale work.
func FinishViewTile(activeKind string, activeSession int, next Request) bool {
	return activeKind == "view" && next.Kind == "view" && !next.RPC && activeSession == next.Session
}

// NeedsReply distinguishes awaited captures using the view pipeline from the
// replaceable viewport stream. Every displaced RPC receives a terminal reply.
func NeedsReply(job Request) bool { return job.RPC || job.Kind != "view" && job.Kind != "cancel" }
