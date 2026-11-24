package handler

import (
	"net/http"

	"github.com/multica-ai/multica/server/internal/privacy"
	"github.com/multica-ai/multica/server/pkg/redact"
)

// redactAgentWrite masks secret-shaped substrings (redact.Text, which covers
// mat_/mul_/mdt_/mcn_ tokens, cloud keys, JWTs, and KEY=value pairs) in text
// an agent writes through its task token: comments, issue titles and
// descriptions, and chat messages. Streamed agent output already gets the
// same masking before it is stored; without this, a credential an agent
// echoed into `multica issue comment add` was stored and shown verbatim.
//
// Only requests authenticated with a task token are touched (the auth
// middleware sets X-Actor-Source and strips any client copy), and only in
// privacy mode.
func redactAgentWrite(r *http.Request, s string) string {
	if r.Header.Get("X-Actor-Source") != "task_token" || !privacy.Enabled() {
		return s
	}
	return redact.Text(s)
}

func redactAgentWritePtr(r *http.Request, s *string) *string {
	if s == nil {
		return nil
	}
	clean := redactAgentWrite(r, *s)
	return &clean
}
