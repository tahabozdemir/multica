package handler

import (
	"net/http"

	"github.com/multica-ai/multica/server/internal/privacy"
)

// refuseInPrivacyMode answers 403 when MULTICA_PRIVACY_MODE is on and the
// request would make the server contact a third party. It reports whether it
// wrote the response.
func refuseInPrivacyMode(w http.ResponseWriter, feature string) bool {
	if !privacy.Enabled() {
		return false
	}
	writeJSON(w, http.StatusForbidden, map[string]string{
		"code":  "privacy_mode",
		"error": feature + " is disabled in privacy mode (MULTICA_PRIVACY_MODE)",
	})
	return true
}
