package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
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

// fields in an event's data that identify the party it concerns.
var partyKeys = []string{"user", "account", "caller_id_number", "destination_number", "caller", "destination"}

// frameForNumber reports whether a parsed SSE frame's data names this extension.
func frameForNumber(frame []string, number string) bool {
	for _, ln := range frame {
		if !strings.HasPrefix(ln, "data:") {
			continue
		}
		var ev struct {
			Type string            `json:"type"`
			Data map[string]string `json:"data"`
		}
		if json.Unmarshal([]byte(strings.TrimSpace(ln[len("data:"):])), &ev) != nil {
			return false
		}
		for _, k := range partyKeys {
			if ev.Data[k] == number {
				return true
			}
		}
		return false
	}
	return false
}

// handleMyEvents is the agent-facing SSE stream: the control-plane events feed,
// filtered to events that concern the caller's own extension (their voicemail
// MWI, calls involving them). Authenticated but not role-gated.
func (s *server) handleMyEvents(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeErr(w, http.StatusInternalServerError, "streaming unsupported")
		return
	}

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

	sc := bufio.NewScanner(resp.Body)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	var frame []string
	for sc.Scan() {
		line := sc.Text()
		if strings.HasPrefix(line, ":") { // heartbeat comment — forward as keepalive
			if _, err := w.Write([]byte(line + "\n\n")); err != nil {
				return
			}
			flusher.Flush()
			continue
		}
		if line != "" { // accumulate frame lines until the blank separator
			frame = append(frame, line)
			continue
		}
		if len(frame) > 0 && frameForNumber(frame, op.Number) {
			for _, ln := range frame {
				if _, err := w.Write([]byte(ln + "\n")); err != nil {
					return
				}
			}
			if _, err := w.Write([]byte("\n")); err != nil {
				return
			}
			flusher.Flush()
		}
		frame = frame[:0]
	}
}
