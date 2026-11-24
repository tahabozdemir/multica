package main

import (
	"strings"
	"testing"
)

func TestBareSetupRefusesCloudDefaultInPrivacyMode(t *testing.T) {
	t.Setenv("MULTICA_PRIVACY_MODE", "1")
	err := runSetupDefault(setupCmd, nil)
	if err == nil || !strings.Contains(err.Error(), "setup self-host") {
		t.Fatalf("runSetupDefault: err = %v, want a privacy-mode refusal pointing at setup self-host", err)
	}
}
