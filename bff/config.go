package main

import (
	"os"
	"strings"
)

// Config is the BFF runtime configuration (all from env).
type Config struct {
	Addr        string // listen address
	OIDCIssuer  string // Keycloak realm issuer URL
	CPURL       string // control-plane base URL
	CPToken     string // control-plane bearer token (server-side only)
	CPInsecure  bool   // skip TLS verify for the control-plane (dev self-signed)
	SIPWssURL   string // WSS URL handed to the SPA
	CORSOrigins []string
}

func loadConfig() Config {
	return Config{
		Addr:        env("BFF_ADDR", ":8090"),
		OIDCIssuer:  env("OIDC_ISSUER", "http://localhost:8081/realms/freeswitch"),
		CPURL:       strings.TrimRight(env("CONTROL_PLANE_URL", "https://localhost:8080"), "/"),
		CPToken:     env("CONTROL_PLANE_TOKEN", "dev-token"),
		CPInsecure:  env("CONTROL_PLANE_INSECURE", "true") == "true",
		SIPWssURL:   env("SIP_WSS_URL", "wss://192.168.48.143:7443"),
		CORSOrigins: splitCSV(env("CORS_ORIGINS", "http://localhost:5173,http://localhost:5174")),
	}
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func splitCSV(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}
