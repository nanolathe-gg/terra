package server

import (
	"os"
	"os/exec"
	"testing"
)

func TestExportProcessGone(t *testing.T) {
	if exportProcessGone(os.Getpid()) {
		t.Fatal("current process is not gone")
	}
	child := exec.Command(os.Args[0], "-test.run=^$")
	if err := child.Run(); err != nil {
		t.Fatal(err)
	}
	if !exportProcessGone(child.Process.Pid) {
		t.Fatal("exited child must be gone")
	}
}
