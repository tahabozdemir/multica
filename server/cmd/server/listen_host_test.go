package main

import "testing"

func TestListenHost(t *testing.T) {
	cases := []struct {
		privacy, bind, want string
	}{
		{"", "", "127.0.0.1"},
		{"1", "", "127.0.0.1"},
		{"0", "", ""},
		{"1", "0.0.0.0", "0.0.0.0"},
		{"0", "192.168.1.10", "192.168.1.10"},
	}
	for _, tc := range cases {
		t.Setenv("MULTICA_PRIVACY_MODE", tc.privacy)
		t.Setenv("MULTICA_BIND_HOST", tc.bind)
		if got := listenHost(); got != tc.want {
			t.Errorf("privacy=%q bind=%q: listenHost() = %q, want %q", tc.privacy, tc.bind, got, tc.want)
		}
	}
}
