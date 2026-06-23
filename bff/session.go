package main

import (
	"errors"
	"net/http"
)

type sipCreds struct {
	WssURL    string `json:"wss_url"`
	Domain    string `json:"domain"`
	Extension string `json:"extension"`
	Password  string `json:"password"`
}

type sessionResponse struct {
	User    string   `json:"user"`
	Subject string   `json:"subject"`
	Roles   []string `json:"roles"`
	SIP     sipCreds `json:"sip"`
}

// handleSession resolves the logged-in identity to its SIP credentials. The JWT
// is already verified by authMiddleware; here we map subject -> operator ->
// extension and vend the SIP password for that extension.
func (s *server) handleSession(w http.ResponseWriter, r *http.Request) {
	id := identityFrom(r.Context())

	op, err := s.cp.operator(r.Context(), id.Subject)
	if errors.Is(err, errNotFound) {
		writeErr(w, http.StatusForbidden, "no operator binding for this identity")
		return
	}
	if err != nil {
		writeErr(w, http.StatusBadGateway, "operator lookup failed: "+err.Error())
		return
	}
	if !op.Enabled {
		writeErr(w, http.StatusForbidden, "operator is disabled")
		return
	}

	password, err := s.cp.userPassword(r.Context(), op.Domain, op.Number)
	if err != nil || password == "" {
		writeErr(w, http.StatusBadGateway, "could not resolve SIP credentials")
		return
	}

	writeJSON(w, http.StatusOK, sessionResponse{
		User:    id.Username,
		Subject: id.Subject,
		Roles:   id.Roles,
		SIP: sipCreds{
			WssURL:    s.cfg.SIPWssURL,
			Domain:    op.Domain,
			Extension: op.Number,
			Password:  password,
		},
	})
}
