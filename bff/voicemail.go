package main

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"

	"github.com/go-chi/chi/v5"
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

// handleVoicemailAudio streams one message's .wav. The mailbox (domain/number)
// comes from the resolved operator, so a caller can only fetch their own
// messages; the control-plane further checks the uuid belongs to that mailbox.
func (s *server) handleVoicemailAudio(w http.ResponseWriter, r *http.Request) {
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

	uuid := chi.URLParam(r, "uuid")
	path := "/api/v1/voicemail/" + url.PathEscape(op.Domain) + "/" + url.PathEscape(op.Number) +
		"/" + url.PathEscape(uuid) + "/audio"

	resp, err := s.cp.getRaw(r.Context(), path)
	if err != nil {
		writeErr(w, http.StatusBadGateway, "voicemail audio failed: "+err.Error())
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		writeErr(w, resp.StatusCode, "voicemail audio unavailable")
		return
	}
	w.Header().Set("Content-Type", "audio/wav")
	if cl := resp.Header.Get("Content-Length"); cl != "" {
		w.Header().Set("Content-Length", cl)
	}
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, resp.Body)
}
