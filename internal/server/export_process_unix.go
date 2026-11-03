//go:build !windows

package server

import (
	"errors"
	"syscall"
)

// Permission failures and other unknown states keep the owner's files intact.
func exportProcessGone(pid int) bool {
	return errors.Is(syscall.Kill(pid, 0), syscall.ESRCH)
}
