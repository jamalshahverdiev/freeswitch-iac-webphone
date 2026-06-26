// Command bff is the webphone backend-for-frontend: it validates Keycloak access
// tokens, resolves the logged-in operator to its SIP extension via the
// control-plane, and vends SIP credentials to the SPA. The control-plane bearer
// token is held only here, never in the browser.
package main

import (
	"context"
	"log"
	"net/http"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/go-chi/chi/v5"
)

type server struct {
	cfg Config
	cp  *cpClient
}

func main() {
	cfg := loadConfig()
	verifier := mustVerifier(cfg.OIDCIssuer)
	s := &server{cfg: cfg, cp: newCPClient(cfg)}

	r := chi.NewRouter()
	r.Use(cors(cfg.CORSOrigins))
	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) })
	r.Group(func(r chi.Router) {
		r.Use(authMiddleware(verifier))
		r.Get("/api/session", s.handleSession)
		r.Get("/api/cdr", s.handleCDR)             // own call history (scoped to caller's extension)
		r.Get("/api/voicemail", s.handleVoicemail)                  // own mailbox (scoped to caller's extension)
		r.Get("/api/voicemail/{uuid}/audio", s.handleVoicemailAudio) // stream one message's .wav

		// supervisor/admin: live telephony events + agent control (proxied)
		r.Group(func(r chi.Router) {
			r.Use(requireRole("supervisor", "admin"))
			r.Get("/api/events", s.handleEvents)
			r.Get("/api/agents", s.handleAgents)
			r.Put("/api/agents/{name}/status", s.handleSetAgentStatus)
		})
	})

	log.Printf("bff listening on %s (issuer=%s, control-plane=%s)", cfg.Addr, cfg.OIDCIssuer, cfg.CPURL)
	if err := http.ListenAndServe(cfg.Addr, r); err != nil {
		log.Fatal(err)
	}
}

// mustVerifier builds an OIDC verifier, retrying until Keycloak's discovery
// endpoint is reachable (it may start after the BFF). SkipClientIDCheck: we
// validate Keycloak ACCESS tokens whose aud is "account", not our client id —
// issuer + signature + expiry are what matter for a resource server.
func mustVerifier(issuer string) *oidc.IDTokenVerifier {
	ctx := context.Background()
	for i := 0; ; i++ {
		provider, err := oidc.NewProvider(ctx, issuer)
		if err == nil {
			return provider.Verifier(&oidc.Config{SkipClientIDCheck: true})
		}
		if i == 0 {
			log.Printf("waiting for OIDC issuer %s: %v", issuer, err)
		}
		if i >= 60 {
			log.Fatalf("OIDC issuer %s unreachable after retries: %v", issuer, err)
		}
		time.Sleep(2 * time.Second)
	}
}
