package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/url"

	"github.com/go-chi/chi/v5"
)

// Supervisor call control: list live calls and act on them (hangup / park /
// transfer). All routes are role-gated (supervisor/admin) in main.go.

func (s *server) handleCalls(w http.ResponseWriter, r *http.Request) {
	var raw json.RawMessage
	if err := s.cp.get(r.Context(), "/api/v1/runtime/channels", &raw); err != nil {
		writeErr(w, http.StatusBadGateway, "channels lookup failed: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, raw)
}

// relay forwards the control-plane status + body to the SPA verbatim.
func relay(w http.ResponseWriter, code int, body []byte, err error) {
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_, _ = w.Write(body)
}

func (s *server) handleCallHangup(w http.ResponseWriter, r *http.Request) {
	uuid := chi.URLParam(r, "uuid")
	code, body, err := s.cp.postJSON(r.Context(),
		"/api/v1/runtime/channels/"+url.PathEscape(uuid)+"/hangup", nil)
	relay(w, code, body, err)
}

func (s *server) handleCallPark(w http.ResponseWriter, r *http.Request) {
	uuid := chi.URLParam(r, "uuid")
	code, body, err := s.cp.postJSON(r.Context(),
		"/api/v1/runtime/channels/"+url.PathEscape(uuid)+"/park", nil)
	relay(w, code, body, err)
}

// handleCallListen makes the supervisor covertly listen to a call: the
// control-plane dials THIS supervisor's own extension into eavesdrop on the
// target, so the spy leg is the supervisor's own registered phone.
func (s *server) handleCallListen(w http.ResponseWriter, r *http.Request) {
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
	code, out, err := s.cp.postJSON(r.Context(),
		"/api/v1/runtime/channels/"+url.PathEscape(uuid)+"/eavesdrop",
		map[string]string{"extension": op.Number, "domain": op.Domain})
	relay(w, code, out, err)
}

func (s *server) handleCallTransfer(w http.ResponseWriter, r *http.Request) {
	uuid := chi.URLParam(r, "uuid")
	var body struct {
		Destination string `json:"destination"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	code, out, err := s.cp.postJSON(r.Context(),
		"/api/v1/runtime/channels/"+url.PathEscape(uuid)+"/transfer", body)
	relay(w, code, out, err)
}
