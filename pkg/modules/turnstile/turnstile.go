// Vikunja is a to-do list application to facilitate your life.
// Copyright 2018-present Vikunja and contributors. All rights reserved.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

// Package turnstile verifies challenges at public HTTP entry points, not in user creation.
package turnstile

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"code.vikunja.io/api/pkg/config"
	"code.vikunja.io/api/pkg/utils"
)

const (
	ActionRegister      = "register"
	ActionPasswordReset = "password_reset"
	siteverifyURL       = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
	maxResponseBytes    = 64 * 1024
)

type Verifier struct {
	client *http.Client
}

// NewVerifier uses the configured outgoing proxy when no client is supplied.
func NewVerifier(client *http.Client) *Verifier {
	if client == nil {
		client = utils.NewSSRFSafeHTTPClient()
	}
	c := *client
	// Never forward a token or secret to a redirect target.
	c.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &Verifier{client: &c}
}

func (v *Verifier) Verify(ctx context.Context, token, action string) error {
	if !config.TurnstileEnabled.GetBool() {
		return nil
	}
	if token == "" || len(token) > 2048 {
		return ErrInvalidToken
	}
	hosts, err := config.TurnstileHostnames()
	if err != nil || config.TurnstileSecretKey.GetString() == "" || v == nil || v.client == nil {
		return ErrUnavailable
	}

	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	form := url.Values{
		"secret":   {config.TurnstileSecretKey.GetString()},
		"response": {token},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, siteverifyURL, strings.NewReader(form.Encode()))
	if err != nil {
		return ErrUnavailable
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, err := v.client.Do(req)
	if err != nil {
		return ErrUnavailable
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return ErrUnavailable
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, maxResponseBytes+1))
	if err != nil || len(body) > maxResponseBytes {
		return ErrUnavailable
	}
	var result struct {
		Success    *bool    `json:"success"`
		Hostname   string   `json:"hostname"`
		Action     string   `json:"action"`
		ErrorCodes []string `json:"error-codes"`
	}
	if json.Unmarshal(body, &result) != nil || result.Success == nil {
		return ErrUnavailable
	}
	if !*result.Success {
		if len(result.ErrorCodes) == 0 {
			return ErrUnavailable
		}
		for _, code := range result.ErrorCodes {
			switch code {
			case "missing-input-response", "invalid-input-response", "timeout-or-duplicate":
			default:
				return ErrUnavailable
			}
		}
		return ErrInvalidToken
	}
	if len(result.ErrorCodes) != 0 {
		return ErrUnavailable
	}
	hostname := strings.ToLower(strings.TrimSuffix(result.Hostname, "."))
	if result.Action != action || !slices.Contains(hosts, hostname) {
		return ErrInvalidToken
	}
	return nil
}
