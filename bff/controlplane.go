package main

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
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
