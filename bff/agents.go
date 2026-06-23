package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
)

// allowed mod_callcenter agent statuses a supervisor may set.
var agentStatuses = map[string]bool{
	"Available":  true,
	"On Break":   true,
	"Logged Out": true,
}

type respAgent struct {
	Name        string `json:"name"` // raw mod_callcenter id, e.g. 4201@domain
	Extension   string `json:"extension"`
	Domain      string `json:"domain"`
	DisplayName string `json:"display_name"`
	Status      string `json:"status"`
	Contact     string `json:"contact"`
}

// handleAgents returns a page of call-center agents enriched with the operator
// display name (matched by extension). Supports ?limit=&offset=; the total count
// is returned so the SPA can paginate. supervisor/admin only.
func (s *server) handleAgents(w http.ResponseWriter, r *http.Request) {
	limit := clampInt(r.URL.Query().Get("limit"), 20, 1, 200)
	offset := clampInt(r.URL.Query().Get("offset"), 0, 0, 1<<30)

	body, total, err := s.cp.getWithTotal(r.Context(),
		"/api/v1/callcenter/agents?limit="+strconv.Itoa(limit)+"&offset="+strconv.Itoa(offset))
	if err != nil {
		writeErr(w, http.StatusBadGateway, "agents lookup failed: "+err.Error())
		return
	}
	var agents []struct {
		Name    string `json:"name"`
		Status  string `json:"status"`
		Contact string `json:"contact"`
	}
	if err := json.Unmarshal(body, &agents); err != nil {
		writeErr(w, http.StatusBadGateway, "bad agents payload")
		return
	}

	names := s.operatorNames(r.Context()) // extension@domain -> display_name

	out := make([]respAgent, 0, len(agents))
	for _, a := range agents {
		ext, dom, _ := strings.Cut(a.Name, "@")
		out = append(out, respAgent{
			Name:        a.Name,
			Extension:   ext,
			Domain:      dom,
			DisplayName: names[a.Name],
			Status:      a.Status,
			Contact:     a.Contact,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"agents": out, "total": total})
}

// operatorNames builds a map of "number@domain" -> display_name from operators.
// Best-effort: on error returns an empty map (agents still render by SIP id).
func (s *server) operatorNames(ctx context.Context) map[string]string {
	m := map[string]string{}
	body, _, err := s.cp.getWithTotal(ctx, "/api/v1/operators?limit=1000")
	if err != nil {
		return m
	}
	var ops []struct {
		Domain      string `json:"domain"`
		Number      string `json:"number"`
		DisplayName string `json:"display_name"`
	}
	if json.Unmarshal(body, &ops) != nil {
		return m
	}
	for _, o := range ops {
		if o.DisplayName != "" {
			m[o.Number+"@"+o.Domain] = o.DisplayName
		}
	}
	return m
}

func clampInt(s string, def, min, max int) int {
	if s == "" {
		return def
	}
	n, err := strconv.Atoi(s)
	if err != nil || n < min {
		return def
	}
	if n > max {
		return max
	}
	return n
}

// handleSetAgentStatus sets an agent's runtime status (supervisor/admin).
// PUT /api/agents/{name}/status   body: {"status": "Available"}
func (s *server) handleSetAgentStatus(w http.ResponseWriter, r *http.Request) {
	// chi returns the path param from the raw (still %-encoded) path, e.g.
	// "4202%40192.168.48.143" — decode it before re-escaping for the upstream
	// path, otherwise the agent name reaches the control-plane double-encoded.
	name := chi.URLParam(r, "name")
	if dec, err := url.PathUnescape(name); err == nil {
		name = dec
	}
	var in struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	if !agentStatuses[in.Status] {
		writeErr(w, http.StatusBadRequest, "status must be Available | On Break | Logged Out")
		return
	}
	code, body, err := s.cp.putJSON(r.Context(),
		"/api/v1/runtime/callcenter/agents/"+url.PathEscape(name)+"/status",
		map[string]string{"status": in.Status})
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	if code < 200 || code >= 300 {
		writeErr(w, http.StatusBadGateway, "control-plane returned "+http.StatusText(code))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "raw": json.RawMessage(body)})
}
