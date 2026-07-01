package main

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"

	"github.com/go-chi/chi/v5"
)

var (
	recDateRe = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	recFileRe = regexp.MustCompile(`^[A-Za-z0-9._-]+\.(wav|mp4)$`)
)

// recParties parses "<caller>_<dest>_<uuid>.wav" → caller, dest.
func recParties(file string) (string, string) {
	base := strings.TrimSuffix(strings.TrimSuffix(file, ".wav"), ".mp4")
	parts := strings.SplitN(base, "_", 3)
	if len(parts) < 3 {
		return "", ""
	}
	return parts[0], parts[1]
}

// recDateParams forwards date / from / to (single day or inclusive range) to
// the control-plane, validating each supplied date.
func recDateParams(r *http.Request, q url.Values) bool {
	for _, k := range []string{"date", "from", "to"} {
		if v := r.URL.Query().Get(k); v != "" {
			if !recDateRe.MatchString(v) {
				return false
			}
			q.Set(k, v)
		}
	}
	return true
}

// handleRecordings lists the caller's own recordings (scoped by extension),
// for a single day or a date range (?from=&to=).
func (s *server) handleRecordings(w http.ResponseWriter, r *http.Request) {
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
	q := url.Values{"number": {op.Number}}
	if !recDateParams(r, q) {
		writeErr(w, http.StatusBadRequest, "dates must be YYYY-MM-DD")
		return
	}
	proxyRecordingList(w, r, s, "/api/v1/recordings?"+q.Encode())
}

// handleRecordingsAll lists every recording (supervisor/admin only), for a
// single day or a date range (?from=&to=).
func (s *server) handleRecordingsAll(w http.ResponseWriter, r *http.Request) {
	q := url.Values{}
	if !recDateParams(r, q) {
		writeErr(w, http.StatusBadRequest, "dates must be YYYY-MM-DD")
		return
	}
	path := "/api/v1/recordings"
	if enc := q.Encode(); enc != "" {
		path += "?" + enc
	}
	proxyRecordingList(w, r, s, path)
}

func proxyRecordingList(w http.ResponseWriter, r *http.Request, s *server, path string) {
	var box json.RawMessage
	if err := s.cp.get(r.Context(), path, &box); err != nil {
		writeErr(w, http.StatusBadGateway, "recordings lookup failed: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, box)
}

// handleRecordingAudio streams one recording. An agent may only fetch a
// recording they were a party to; supervisors/admins may fetch any.
func (s *server) handleRecordingAudio(w http.ResponseWriter, r *http.Request) {
	id := identityFrom(r.Context())
	date := chi.URLParam(r, "date")
	file := chi.URLParam(r, "file")
	if !recDateRe.MatchString(date) || !recFileRe.MatchString(file) {
		writeErr(w, http.StatusBadRequest, "bad date or file name")
		return
	}

	if !hasRole(id, "supervisor") && !hasRole(id, "admin") {
		op, err := s.cp.operator(r.Context(), id.Subject)
		if err != nil {
			writeErr(w, http.StatusForbidden, "no operator binding for this identity")
			return
		}
		caller, dest := recParties(file)
		if op.Number != caller && op.Number != dest {
			writeErr(w, http.StatusForbidden, "not a party to this recording")
			return
		}
	}

	resp, err := s.cp.getRaw(r.Context(), "/api/v1/recordings/"+url.PathEscape(date)+"/"+url.PathEscape(file))
	if err != nil {
		writeErr(w, http.StatusBadGateway, "recording fetch failed: "+err.Error())
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		writeErr(w, resp.StatusCode, "recording unavailable")
		return
	}
	ct := resp.Header.Get("Content-Type")
	if ct == "" {
		ct = "audio/wav"
	}
	w.Header().Set("Content-Type", ct)
	if cl := resp.Header.Get("Content-Length"); cl != "" {
		w.Header().Set("Content-Length", cl)
	}
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, resp.Body)
}
