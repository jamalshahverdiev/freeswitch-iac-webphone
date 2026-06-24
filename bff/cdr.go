package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"
)

// handleCDR returns the logged-in operator's own call history. The operator's
// extension is injected as the `number` filter, so an agent only ever sees
// their own calls — the browser cannot query arbitrary numbers.
func (s *server) handleCDR(w http.ResponseWriter, r *http.Request) {
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

	limit := clampInt(r.URL.Query().Get("limit"), 50, 1, 200)
	offset := clampInt(r.URL.Query().Get("offset"), 0, 0, 1<<30)

	q := url.Values{}
	q.Set("number", op.Number)
	q.Set("limit", strconv.Itoa(limit))
	q.Set("offset", strconv.Itoa(offset))

	body, total, err := s.cp.getWithTotal(r.Context(), "/api/v1/cdr?"+q.Encode())
	if err != nil {
		writeErr(w, http.StatusBadGateway, "cdr lookup failed: "+err.Error())
		return
	}

	// Pass the CDR array through verbatim; embed total in the body (the browser
	// can't read X-Total-Count without a CORS expose-headers allowance).
	writeJSON(w, http.StatusOK, map[string]any{"cdrs": json.RawMessage(body), "total": total})
}
