package privacy

import "testing"

func TestEnabled(t *testing.T) {
	cases := map[string]bool{
		"":      true,
		"1":     true,
		"true":  true,
		"on":    true,
		"junk":  true,
		"0":     false,
		"false": false,
		"OFF":   false,
		" no ":  false,
	}
	for raw, want := range cases {
		t.Setenv(EnvVar, raw)
		if got := Enabled(); got != want {
			t.Errorf("%s=%q: Enabled() = %v, want %v", EnvVar, raw, got, want)
		}
	}
}
