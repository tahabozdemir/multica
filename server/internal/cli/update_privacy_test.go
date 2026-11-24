package cli

import (
	"errors"
	"testing"
)

func TestSelfUpdateRefusedInPrivacyMode(t *testing.T) {
	t.Setenv("MULTICA_PRIVACY_MODE", "1")
	t.Setenv(releaseAPIBaseURLEnv, "")
	t.Setenv(releaseDownloadBaseURLEnv, "")

	if _, err := FetchLatestRelease(); !errors.Is(err, ErrSelfUpdatePrivacyMode) {
		t.Fatalf("FetchLatestRelease: err = %v, want ErrSelfUpdatePrivacyMode", err)
	}
	if _, err := fetchReleaseByTag("v1.0.0"); !errors.Is(err, ErrSelfUpdatePrivacyMode) {
		t.Fatalf("fetchReleaseByTag: err = %v, want ErrSelfUpdatePrivacyMode", err)
	}
	if _, err := UpdateViaDownload("v1.0.0"); !errors.Is(err, ErrSelfUpdatePrivacyMode) {
		t.Fatalf("UpdateViaDownload: err = %v, want ErrSelfUpdatePrivacyMode", err)
	}
	if _, err := UpdateViaBrew(); !errors.Is(err, ErrSelfUpdatePrivacyMode) {
		t.Fatalf("UpdateViaBrew: err = %v, want ErrSelfUpdatePrivacyMode", err)
	}
}

func TestSelfUpdateAllowedWithOwnMirrorInPrivacyMode(t *testing.T) {
	t.Setenv("MULTICA_PRIVACY_MODE", "1")
	t.Setenv(releaseAPIBaseURLEnv, "https://releases.internal.example/api")
	if err := selfUpdateAllowed(); err == nil {
		t.Fatal("an API mirror without a download mirror would still download from GitHub")
	}
	t.Setenv(releaseDownloadBaseURLEnv, "https://releases.internal.example/download")
	if err := selfUpdateAllowed(); err != nil {
		t.Fatalf("both mirrors configured: err = %v, want nil", err)
	}
}
