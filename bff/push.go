package main

import (
	"encoding/json"
	"errors"
	"net/http"
)

// handlePushVAPID proxies the server VAPID public key so the SPA can subscribe.
func (s *server) handlePushVAPID(w http.ResponseWriter, r *http.Request) {
	var out json.RawMessage
	if err := s.cp.get(r.Context(), "/api/v1/push/vapid", &out); err != nil {
		writeErr(w, http.StatusBadGateway, "vapid key unavailable: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// browserSub is the PushSubscription the SPA sends (the shape of
// PushSubscription.toJSON()).
type browserSub struct {
	Endpoint string `json:"endpoint"`
	Keys     struct {
		P256dh string `json:"p256dh"`
		Auth   string `json:"auth"`
	} `json:"keys"`
}

// handlePushSubscribe binds a browser subscription to the caller's extension and
// stores it in the control-plane.
func (s *server) handlePushSubscribe(w http.ResponseWriter, r *http.Request) {
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

	var sub browserSub
	if err := json.NewDecoder(r.Body).Decode(&sub); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid subscription")
		return
	}
	if sub.Endpoint == "" || sub.Keys.P256dh == "" || sub.Keys.Auth == "" {
		writeErr(w, http.StatusBadRequest, "incomplete subscription")
		return
	}

	payload := map[string]any{
		"subject":    op.Subject,
		"domain":     op.Domain,
		"number":     op.Number,
		"endpoint":   sub.Endpoint,
		"keys":       map[string]string{"p256dh": sub.Keys.P256dh, "auth": sub.Keys.Auth},
		"user_agent": r.UserAgent(),
	}
	code, _, err := s.cp.postJSON(r.Context(), "/api/v1/push/subscriptions", payload)
	if err != nil {
		writeErr(w, http.StatusBadGateway, "subscribe failed: "+err.Error())
		return
	}
	if code >= 300 {
		writeErr(w, http.StatusBadGateway, "subscribe rejected upstream")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handlePushUnsubscribe removes a subscription by endpoint.
func (s *server) handlePushUnsubscribe(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Endpoint string `json:"endpoint"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Endpoint == "" {
		writeErr(w, http.StatusBadRequest, "endpoint is required")
		return
	}
	code, err := s.cp.deleteJSON(r.Context(), "/api/v1/push/subscriptions", map[string]string{"endpoint": req.Endpoint})
	if err != nil || code >= 300 {
		writeErr(w, http.StatusBadGateway, "unsubscribe failed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
