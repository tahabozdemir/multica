package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPrivacyModeRefusesThirdPartyFetches(t *testing.T) {
	t.Setenv("MULTICA_PRIVACY_MODE", "1")

	cases := []struct {
		name    string
		handler http.HandlerFunc
		req     *http.Request
	}{
		{"skill search", testHandler.SearchSkills, newRequest(http.MethodGet, "/api/skills/search?q=x", nil)},
		{"skill import from URL", testHandler.ImportSkill, newRequest(http.MethodPost, "/api/skills/import", map[string]any{"url": "https://clawhub.ai/o/s"})},
		{"qoder environments", testHandler.ListQoderEnvironments, newRequest(http.MethodPost, "/api/workspaces/x/qoder/environments", map[string]any{"qoder_token": "t"})},
		{"qoder agents", testHandler.ListQoderAgents, newRequest(http.MethodGet, "/api/workspaces/x/qoder/agents", nil)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			tc.handler(w, tc.req)
			if w.Code != http.StatusForbidden {
				t.Fatalf("status = %d, want 403; body %s", w.Code, w.Body.String())
			}
			var body map[string]string
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil || body["code"] != "privacy_mode" {
				t.Fatalf("body = %s, want code privacy_mode", w.Body.String())
			}
		})
	}
}
