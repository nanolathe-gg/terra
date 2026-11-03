package membudget

import "testing"

func TestMinimumBudget(t *testing.T) {
	l := FromConfig(map[string]any{"heapMB": 128, "gpuMB": 128})
	if l.Cache()+l.Working()+l.Transfer() != 128*MiB {
		t.Fatal(l)
	}
	for name, err := range map[string]error{"native 256 tile": l.Image(256, 256), "native-grid authored patch": l.Authored(256, 256), "8x8 cell fill": l.Fill(258, 264)} {
		if err != nil {
			t.Fatal(name, err)
		}
	}
	for name, err := range map[string]error{"full map image": l.Image(20480, 20480), "full authored map": l.Authored(10240, 10240), "40x40 fill": l.Fill(1281, 1281)} {
		if err == nil {
			t.Fatal(name, "must refuse before allocation")
		}
	}
}
func TestRuntimeBudgets(t *testing.T) {
	c := map[string]any{"heapBudgetBytes": 128 * MiB, "gpuBudgetBytes": 128 * MiB}
	a := FromConfig(c)
	c["heapBudgetBytes"] = 512 * MiB
	c["gpuBudgetBytes"] = 256 * MiB
	b := FromConfig(c)
	if b.Cache() != 4*a.Cache() || b.GPU != 2*a.GPU {
		t.Fatal(a, b)
	}
	if Area(int(^uint(0)>>1), 2, 256) < 0 || Area(0, 1, 4) != int64(^uint64(0)>>1) {
		t.Fatal("overflow not rejected")
	}
}
