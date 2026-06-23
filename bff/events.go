package main

import (
	"io"
	"net/http"
)

// requireRole gates a handler to identities holding at least one of the roles.
func requireRole(roles ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			id := identityFrom(r.Context())
			for _, want := range roles {
				if hasRole(id, want) {
					next.ServeHTTP(w, r)
					return
				}
			}
			writeErr(w, http.StatusForbidden, "requires one of roles: "+joinRoles(roles))
		})
	}
}

func joinRoles(roles []string) string {
	out := ""
	for i, r := range roles {
		if i > 0 {
			out += ", "
		}
		out += r
	}
	return out
}

// handleEvents proxies the control-plane SSE stream (/api/v1/events) to the SPA,
// injecting the server-side control-plane token. Gated to supervisor/admin.
func (s *server) handleEvents(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeErr(w, http.StatusInternalServerError, "streaming unsupported")
		return
	}

	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, s.cfg.CPURL+"/api/v1/events", nil)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	req.Header.Set("Authorization", "Bearer "+s.cfg.CPToken)
	req.Header.Set("Accept", "text/event-stream")

	resp, err := s.cp.streamHC.Do(req)
	if err != nil {
		writeErr(w, http.StatusBadGateway, "events upstream: "+err.Error())
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		writeErr(w, http.StatusBadGateway, "events upstream status "+resp.Status)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	// Relay upstream bytes, flushing each chunk so SSE frames reach the browser
	// immediately. Ends when the client disconnects (ctx) or upstream closes.
	buf := make([]byte, 4096)
	for {
		n, err := resp.Body.Read(buf)
		if n > 0 {
			if _, werr := w.Write(buf[:n]); werr != nil {
				return
			}
			flusher.Flush()
		}
		if err != nil {
			if err != io.EOF {
				return
			}
			return
		}
	}
}
