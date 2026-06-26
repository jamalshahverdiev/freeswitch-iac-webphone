package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
)

// handleVoicemail returns the logged-in operator's own mailbox (messages + MWI
// counters). The domain/number come from the resolved operator binding, so an
// agent only ever sees their own mailbox.
func (s *server) handleVoicemail(w http.ResponseWriter, r *http.Request) {
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

	path := "/api/v1/voicemail/" + url.PathEscape(op.Domain) + "/" + url.PathEscape(op.Number)
	var box json.RawMessage
	if err := s.cp.get(r.Context(), path, &box); err != nil {
		// e.g. the control-plane voicemail read API needs CORE_DATABASE_URL
		writeErr(w, http.StatusBadGateway, "voicemail lookup failed: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, box)
}
