package terrain

// ShapeProfile contains CPU wall-clock timings, including WebGPU command
// submission overhead, for the most recent scene render. PageMilliseconds
// includes its preparation, allocation, prefix, planning, dispatch and copy.
type ShapeProfile struct {
	SceneMilliseconds        float64
	ShapeFeedMilliseconds    float64
	GraphMilliseconds        float64
	GraphDiffMilliseconds    float64
	GraphCloneMilliseconds   float64
	FeedAllocateMilliseconds float64
	PageMilliseconds         float64
	PrepareMilliseconds      float64
	PageAllocateMilliseconds float64
	PrefixMilliseconds       float64
	PlanMilliseconds         float64
	DispatchMilliseconds     float64
	PageCopyMilliseconds     float64
	GatherMilliseconds       float64
	PageMisses               int
}
