package handler

import (
	"net/http"
	"strings"
	"testing"

	"github.com/multica-ai/multica/server/internal/testutil"
)

func TestAgentWrittenCommentIsRedactedInPrivacyMode(t *testing.T) {
	f := newAgentSteerFixture(t)
	token := "mul_" + strings.Repeat("ab", 20)

	t.Setenv("MULTICA_PRIVACY_MODE", "1")
	created := postAgentComment(t, f.issueID, f.callerAgent, f.callerTask, map[string]any{
		"content": "Logged in with " + token + " ok",
	})
	if strings.Contains(created.Content, token) || !strings.Contains(created.Content, "[REDACTED_MULTICA_TOKEN]") {
		t.Fatalf("agent comment stored %q, want the token masked", created.Content)
	}

	// A member's comment is theirs to write; only agent writes are masked.
	req := newRequest(http.MethodPost, "/api/issues/"+f.issueID+"/comments", map[string]any{"content": "member pasted " + token})
	var member CommentResponse
	testutil.Call(t, testHandler.CreateComment, withURLParam(req, "id", f.issueID)).Want(http.StatusCreated).JSON(&member)
	if !strings.Contains(member.Content, token) {
		t.Fatalf("member comment changed to %q", member.Content)
	}
}

func TestRedactAgentWriteOnlyForTaskTokensInPrivacyMode(t *testing.T) {
	secret := "AKIA" + strings.Repeat("A", 16)
	agent := newRequest(http.MethodPost, "/x", nil)
	agent.Header.Set("X-Actor-Source", "task_token")

	t.Setenv("MULTICA_PRIVACY_MODE", "1")
	if got := redactAgentWrite(agent, secret); got == secret {
		t.Fatal("task-token write was not redacted in privacy mode")
	}
	if got := redactAgentWrite(newRequest(http.MethodPost, "/x", nil), secret); got != secret {
		t.Fatalf("member write changed to %q", got)
	}
	t.Setenv("MULTICA_PRIVACY_MODE", "0")
	if got := redactAgentWrite(agent, secret); got != secret {
		t.Fatalf("privacy off: write changed to %q", got)
	}
}
