package main

import "testing"

func TestThemeStoreFromEnvPrivacyMode(t *testing.T) {
	t.Setenv("MULTICA_PRIVACY_MODE", "1")
	t.Setenv("MULTICA_THEME_REGISTRY_URL", "")
	if themeStoreFromEnv() != nil {
		t.Fatal("privacy mode must turn off the default (GitHub) theme registry")
	}
	t.Setenv("MULTICA_THEME_REGISTRY_URL", "https://themes.internal.example/index.json")
	if themeStoreFromEnv() == nil {
		t.Fatal("an explicitly configured registry must stay available in privacy mode")
	}
	t.Setenv("MULTICA_PRIVACY_MODE", "0")
	t.Setenv("MULTICA_THEME_REGISTRY_URL", "")
	if themeStoreFromEnv() == nil {
		t.Fatal("with privacy mode off the default registry is used")
	}
}
