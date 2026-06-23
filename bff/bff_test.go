package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestBearerToken(t *testing.T) {
	cases := map[string]string{
		"Bearer abc.def.ghi": "abc.def.ghi",
		"bearer abc":         "", // case-sensitive prefix
		"":                   "",
		"Basic xxx":          "",
	}
	for h, want := range cases {
		r := httptest.NewRequest(http.MethodGet, "/", nil)
		if h != "" {
			r.Header.Set("Authorization", h)
		}
		if got := bearerToken(r); got != want {
			t.Errorf("bearerToken(%q) = %q, want %q", h, got, want)
		}
	}
}

func TestHasRole(t *testing.T) {
	id := identity{Roles: []string{"agent", "offline_access"}}
	if !hasRole(id, "agent") {
		t.Error("expected agent role")
	}
	if hasRole(id, "supervisor") {
		t.Error("did not expect supervisor role")
	}
}

func TestSplitCSV(t *testing.T) {
	got := splitCSV("a, b ,,c")
	want := []string{"a", "b", "c"}
	if len(got) != len(want) {
		t.Fatalf("got %v want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v want %v", got, want)
		}
	}
}

func TestRequireRole(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	h := requireRole("supervisor", "admin")(next)

	cases := []struct {
		roles []string
		want  int
	}{
		{[]string{"supervisor"}, http.StatusOK},
		{[]string{"admin"}, http.StatusOK},
		{[]string{"agent"}, http.StatusForbidden},
		{nil, http.StatusForbidden},
	}
	for _, c := range cases {
		r := httptest.NewRequest(http.MethodGet, "/api/events", nil)
		r = r.WithContext(context.WithValue(r.Context(), identityKey, identity{Roles: c.roles}))
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, r)
		if rec.Code != c.want {
			t.Errorf("roles=%v got %d want %d", c.roles, rec.Code, c.want)
		}
	}
}

func TestCPClient(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer tok" {
			t.Errorf("missing bearer on %s", r.URL.Path)
		}
		switch r.URL.Path {
		case "/api/v1/operators/sub-1":
			w.Write([]byte(`{"subject":"sub-1","domain":"d","number":"4201","enabled":true}`))
		case "/api/v1/users/d/4201":
			w.Write([]byte(`{"params":{"password":"s3cret","vm-password":"x"}}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	c := newCPClient(Config{CPURL: srv.URL, CPToken: "tok"})
	ctx := context.Background()

	op, err := c.operator(ctx, "sub-1")
	if err != nil || op.Number != "4201" || !op.Enabled {
		t.Fatalf("operator: %+v, err=%v", op, err)
	}
	pw, err := c.userPassword(ctx, "d", "4201")
	if err != nil || pw != "s3cret" {
		t.Fatalf("userPassword = %q, err=%v", pw, err)
	}
	if _, err := c.operator(ctx, "missing"); err != errNotFound {
		t.Fatalf("expected errNotFound, got %v", err)
	}
}
