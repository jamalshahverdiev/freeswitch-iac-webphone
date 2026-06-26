package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

var errNotFound = errors.New("not found")

// cpClient talks to the control-plane API with the server-side bearer token.
// This token never reaches the browser — the BFF is the only holder.
type cpClient struct {
	base     string
	token    string
	hc       *http.Client // short-timeout, for request/response calls
	streamHC *http.Client // no timeout, for long-lived SSE streaming
}

func newCPClient(cfg Config) *cpClient {
	tr := &http.Transport{}
	if cfg.CPInsecure {
		tr.TLSClientConfig = &tls.Config{InsecureSkipVerify: true} // dev self-signed CA
	}
	return &cpClient{
		base:     cfg.CPURL,
		token:    cfg.CPToken,
		hc:       &http.Client{Timeout: 10 * time.Second, Transport: tr},
		streamHC: &http.Client{Transport: tr}, // no Timeout: SSE is long-lived
	}
}

func (c *cpClient) get(ctx context.Context, path string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	resp, err := c.hc.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return errNotFound
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("control-plane GET %s: %d: %s", path, resp.StatusCode, string(b))
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

type cpOperator struct {
	Subject string `json:"subject"`
	Domain  string `json:"domain"`
	Number  string `json:"number"`
	Enabled bool   `json:"enabled"`
}

func (c *cpClient) operator(ctx context.Context, subject string) (*cpOperator, error) {
	var o cpOperator
	if err := c.get(ctx, "/api/v1/operators/"+url.PathEscape(subject), &o); err != nil {
		return nil, err
	}
	return &o, nil
}

// getWithTotal does a GET and returns the body plus the X-Total-Count header
// (the control-plane sets it on paginated list endpoints).
func (c *cpClient) getWithTotal(ctx context.Context, path string) ([]byte, int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+path, nil)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	resp, err := c.hc.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, 0, fmt.Errorf("control-plane GET %s: %d: %s", path, resp.StatusCode, string(body))
	}
	total, _ := strconv.Atoi(resp.Header.Get("X-Total-Count"))
	return body, total, nil
}

// getRaw does a GET and returns the raw response for streaming the body through
// (e.g. voicemail audio). Caller must close resp.Body.
func (c *cpClient) getRaw(ctx context.Context, path string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+path, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	return c.hc.Do(req)
}

// post sends a bodyless POST and returns the upstream status code.
func (c *cpClient) post(ctx context.Context, path string) (int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+path, nil)
	if err != nil {
		return 0, err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	resp, err := c.hc.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	return resp.StatusCode, nil
}

// putJSON sends a PUT with a JSON body and returns the upstream status code.
func (c *cpClient) putJSON(ctx context.Context, path string, body any) (int, []byte, error) {
	b, err := json.Marshal(body)
	if err != nil {
		return 0, nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, c.base+path, bytes.NewReader(b))
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.hc.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	out, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, out, nil
}

type cpUser struct {
	Params map[string]string `json:"params"`
}

// userPassword returns the SIP password from the directory user's params.
func (c *cpClient) userPassword(ctx context.Context, domain, number string) (string, error) {
	var u cpUser
	if err := c.get(ctx, "/api/v1/users/"+url.PathEscape(domain)+"/"+url.PathEscape(number), &u); err != nil {
		return "", err
	}
	return u.Params["password"], nil
}
