package main

import (
	"context"
	"net/http"
	"strings"

	"github.com/coreos/go-oidc/v3/oidc"
)

type identity struct {
	Subject  string
	Username string
	Roles    []string
}

type ctxKey int

const identityKey ctxKey = 0

// tokenClaims are the Keycloak access-token claims we care about.
type tokenClaims struct {
	Subject     string `json:"sub"`
	Username    string `json:"preferred_username"`
	RealmAccess struct {
		Roles []string `json:"roles"`
	} `json:"realm_access"`
}

// authMiddleware verifies the Bearer access token against Keycloak and stores
// the resolved identity (subject + roles) in the request context.
func authMiddleware(verifier *oidc.IDTokenVerifier) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			raw := bearerToken(r)
			if raw == "" {
				writeErr(w, http.StatusUnauthorized, "missing bearer token")
				return
			}
			tok, err := verifier.Verify(r.Context(), raw)
			if err != nil {
				writeErr(w, http.StatusUnauthorized, "invalid token: "+err.Error())
				return
			}
			var c tokenClaims
			if err := tok.Claims(&c); err != nil {
				writeErr(w, http.StatusUnauthorized, "bad claims")
				return
			}
			id := identity{Subject: c.Subject, Username: c.Username, Roles: c.RealmAccess.Roles}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), identityKey, id)))
		})
	}
}

func identityFrom(ctx context.Context) identity {
	id, _ := ctx.Value(identityKey).(identity)
	return id
}

func bearerToken(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if after, ok := strings.CutPrefix(h, "Bearer "); ok {
		return strings.TrimSpace(after)
	}
	return ""
}

func hasRole(id identity, role string) bool {
	for _, r := range id.Roles {
		if r == role {
			return true
		}
	}
	return false
}
