// Package privacy holds this fork's single switch for outbound traffic.
//
// Privacy mode is on unless MULTICA_PRIVACY_MODE is 0, false, or off. While
// it is on, the server, daemon, and CLI make no connection to Multica Cloud,
// GitHub, or community registries unless an operator configures that
// destination explicitly. Each gated call site checks Enabled() so the fork's
// diff against upstream stays one line per feature.
package privacy

import (
	"os"
	"strings"
)

// EnvVar is the environment variable that controls privacy mode.
const EnvVar = "MULTICA_PRIVACY_MODE"

// Enabled reports whether privacy mode is on. It reads the environment on
// every call so tests can flip it with t.Setenv.
func Enabled() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(EnvVar))) {
	case "0", "false", "off", "no":
		return false
	default:
		return true
	}
}
