package model

import (
	"errors"
	"math"
)

type Point struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}
type ShapePath struct {
	Points []Point `json:"points"`
	Paths  [][]int `json:"paths,omitempty"`
}

func ShapePaths(n *ShapePath) [][]int {
	if n.Paths != nil {
		return n.Paths
	}
	if len(n.Points) == 0 {
		return nil
	}
	p := make([]int, len(n.Points))
	for i := range p {
		p[i] = i
	}
	return [][]int{p}
}
func ClonePaths(p [][]int) [][]int {
	if p == nil {
		return nil
	}
	out := make([][]int, len(p))
	for i := range p {
		out[i] = append([]int{}, p[i]...)
	}
	return out
}
func SimplifyPath(points []Point, tolerance float64) []Point {
	if len(points) < 3 {
		return append([]Point{}, points...)
	}
	keep := make([]bool, len(points))
	keep[0] = true
	keep[len(points)-1] = true
	stack := [][2]int{{0, len(points) - 1}}
	for len(stack) > 0 {
		pair := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		a, b := pair[0], pair[1]
		pa, pb := points[a], points[b]
		dx, dy := pb.X-pa.X, pb.Y-pa.Y
		l2 := dx*dx + dy*dy
		worst, at := -1.0, -1
		for k := a + 1; k < b; k++ {
			q := points[k]
			t := 0.0
			if l2 != 0 {
				t = math.Max(0, math.Min(1, ((q.X-pa.X)*dx+(q.Y-pa.Y)*dy)/l2))
			}
			d := math.Hypot(q.X-pa.X-dx*t, q.Y-pa.Y-dy*t)
			if d > worst {
				worst, at = d, k
			}
		}
		if worst > tolerance {
			keep[at] = true
			stack = append(stack, [2]int{a, at}, [2]int{at, b})
		}
	}
	out := make([]Point, 0, len(points))
	for i, p := range points {
		if keep[i] {
			out = append(out, p)
		}
	}
	return out
}
func ValidatePaths(n *ShapePath) error {
	if n.Points == nil {
		return nil
	}
	if len(n.Points) == 0 {
		return errors.New("Invalid shape points.")
	}
	for _, p := range n.Points {
		if math.IsNaN(p.X) || math.IsInf(p.X, 0) || math.IsNaN(p.Y) || math.IsInf(p.Y, 0) {
			return errors.New("Invalid shape points.")
		}
	}
	if n.Paths == nil {
		return nil
	}
	if len(n.Paths) == 0 {
		return errors.New("Invalid shape paths.")
	}
	used := make([]bool, len(n.Points))
	for _, path := range n.Paths {
		if len(path) == 0 {
			return errors.New("Invalid shape paths.")
		}
		for _, i := range path {
			if i < 0 || i >= len(used) {
				return errors.New("Invalid shape paths.")
			}
			used[i] = true
		}
	}
	for _, u := range used {
		if !u {
			return errors.New("Shape contains unattached points.")
		}
	}
	return nil
}
func AppendPath(n *ShapePath, points []Point, anchor int) int {
	n.Paths = ClonePaths(ShapePaths(n))
	path := []int{}
	if anchor >= 0 {
		path = append(path, anchor)
	}
	for _, p := range points {
		path = append(path, len(n.Points))
		n.Points = append(n.Points, p)
	}
	n.Paths = append(n.Paths, path)
	return len(n.Paths) - 1
}
func ExtendPoint(n *ShapePath, index int, p Point, preferred int) (int, int) {
	n.Paths = ClonePaths(ShapePaths(n))
	at := -1
	if preferred >= 0 && preferred < len(n.Paths) {
		for i, v := range n.Paths[preferred] {
			if v == index {
				at = i
				break
			}
		}
	}
	if at != 0 && (at < 0 || at != len(n.Paths[preferred])-1) {
		preferred = len(n.Paths)
		n.Paths = append(n.Paths, []int{index})
		at = 0
	}
	added := len(n.Points)
	n.Points = append(n.Points, p)
	path := n.Paths[preferred]
	if at == 0 && len(path) > 1 {
		path = append([]int{added}, path...)
	} else {
		path = append(path, added)
	}
	n.Paths[preferred] = path
	return added, preferred
}
func InsertPoint(n *ShapePath, pathIndex, index int) int {
	n.Paths = ClonePaths(ShapePaths(n))
	if pathIndex < 0 || pathIndex >= len(n.Paths) {
		return -1
	}
	path := n.Paths[pathIndex]
	at := -1
	for i, v := range path {
		if v == index {
			at = i
			break
		}
	}
	if at < 0 || at == len(path)-1 {
		return -1
	}
	a, b := n.Points[index], n.Points[path[at+1]]
	point := len(n.Points)
	n.Points = append(n.Points, Point{(a.X + b.X) / 2, (a.Y + b.Y) / 2})
	path = append(path, 0)
	copy(path[at+2:], path[at+1:])
	path[at+1] = point
	n.Paths[pathIndex] = path
	return point
}
func compact(n *ShapePath) {
	used := make([]bool, len(n.Points))
	for _, p := range n.Paths {
		for _, i := range p {
			used[i] = true
		}
	}
	remap := make([]int, len(used))
	points := make([]Point, 0, len(n.Points))
	for i, p := range n.Points {
		if used[i] {
			remap[i] = len(points)
			points = append(points, p)
		}
	}
	for _, p := range n.Paths {
		for i, v := range p {
			p[i] = remap[v]
		}
	}
	n.Points = points
}
func RemovePoint(n *ShapePath, index int) bool {
	if len(n.Points) <= 1 {
		return false
	}
	paths := [][]int{}
	for _, p := range ShapePaths(n) {
		q := []int{}
		for _, v := range p {
			if v != index {
				q = append(q, v)
			}
		}
		if len(q) > 0 {
			paths = append(paths, q)
		}
	}
	n.Paths = paths
	compact(n)
	return true
}
func RemovePath(n *ShapePath, index int) bool {
	paths := ShapePaths(n)
	if len(paths) <= 1 {
		return false
	}
	n.Paths = [][]int{}
	for i, p := range paths {
		if i != index {
			n.Paths = append(n.Paths, append([]int{}, p...))
		}
	}
	compact(n)
	return true
}
