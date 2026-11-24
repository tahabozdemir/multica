package analytics

import "testing"

func TestNewFromEnvIsNoopInPrivacyMode(t *testing.T) {
	t.Setenv("MULTICA_PRIVACY_MODE", "1")
	t.Setenv("POSTHOG_API_KEY", "phc_test")
	t.Setenv("ANALYTICS_DISABLED", "")
	if _, ok := NewFromEnv().(NoopClient); !ok {
		t.Fatal("privacy mode must select the no-op client even when POSTHOG_API_KEY is set")
	}
}
