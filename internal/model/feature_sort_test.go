package model

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"sort"
	"testing"
)

func TestFeatureCandidateSortMatchesTotalOrder(t *testing.T) {
	for _, n := range []int{0, 1, 8192, 8193, 40000} {
		items := make([]featureCandidate, n)
		for i := range items {
			items[i] = featureCandidate{x: i % 257, z: i / 257, rank: float64((i*997)%103) / 103}
		}
		want := append([]featureCandidate(nil), items...)
		sort.Slice(want, func(i, j int) bool { return candidateLess(want[i], want[j]) })
		if err := sortFeatureCandidates(items, nil); err != nil {
			t.Fatal(err)
		}
		if n > 0 && !reflect.DeepEqual(items, want) {
			t.Fatalf("%d candidates differ from total order", n)
		}
	}
}
func TestFeatureCandidateSortCanCancelDuringMerge(t *testing.T) {
	items := make([]featureCandidate, 40000)
	for i := range items {
		items[i] = featureCandidate{x: i, rank: float64(len(items) - i)}
	}
	stop := errors.New("canceled during merge")
	calls := 0
	err := sortFeatureCandidates(items, func() error {
		calls++
		if calls == 8 {
			return stop
		}
		return nil
	})
	if !errors.Is(err, stop) || calls != 8 {
		t.Fatalf("got %v after %d yields", err, calls)
	}
}
func TestFeatureFillSortPreservesOutput(t *testing.T) {
	defs := []FeatureDefinition{{Name: "oak", Kind: "tree", FootprintX: 1, FootprintZ: 1, Uses: 3}, {Name: "pine", Kind: "tree", FootprintX: 2, FootprintZ: 1, Uses: 2}, {Name: "metal", Kind: "deposit", FootprintX: 2, FootprintZ: 2}}
	got, err := FillFeatures(128, 128, 40, func(x, z float64) float64 { return 100 }, defs, []FeaturePlacement{{"metal", 4, 5}}, []FeaturePoint{{128, 128}}, "metal", FeatureRegion{Type: "flood", X: 40, Z: 40}, FeatureFill{Kind: "tree", Density: 30, Clustering: .5, Gap: 1, Seed: 42, Margin: 48, Radius: 100})
	if err != nil {
		t.Fatal(err)
	}
	b, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	if hash := fmt.Sprintf("%x", sha256.Sum256(b)); len(got) != 1810 || hash != "61f47cb1af14c5701e177be74bbc616885c0cafac187586fa72a9b95f4028cac" {
		t.Fatalf("fill changed: %d placements, %s", len(got), hash)
	}
}
