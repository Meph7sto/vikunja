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

package turnstile

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"code.vikunja.io/api/pkg/config"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func enableTurnstile(t *testing.T) {
	t.Helper()
	config.InitDefaultConfig()
	config.TurnstileEnabled.Set(true)
	config.TurnstileSiteKey.Set("public-key")
	config.TurnstileSecretKey.Set("private-key")
	config.TurnstileAllowedHostnames.Set([]string{"tasks.example.com"})
	t.Cleanup(func() {
		config.TurnstileEnabled.Set(false)
		config.TurnstileSiteKey.Set("")
		config.TurnstileSecretKey.Set("")
		config.TurnstileAllowedHostnames.Set([]string{})
	})
}

func TestTurnstileVerify(t *testing.T) {
	enableTurnstile(t)
	for _, tt := range []struct {
		name   string
		body   string
		status int
		want   error
	}{
		{
			name: "success",
			body: `{"success":true,"hostname":"tasks.example.com","action":"register"}`,
		},
		{
			name: "hostname is case insensitive",
			body: `{"success":true,"hostname":"TASKS.example.com","action":"register"}`,
		},
		{
			name: "wrong action",
			body: `{"success":true,"hostname":"tasks.example.com","action":"password_reset"}`,
			want: ErrInvalidToken,
		},
		{
			name: "missing action",
			body: `{"success":true,"hostname":"tasks.example.com"}`,
			want: ErrInvalidToken,
		},
		{
			name: "wrong hostname",
			body: `{"success":true,"hostname":"evil.tasks.example.com","action":"register"}`,
			want: ErrInvalidToken,
		},
		{
			name: "missing hostname",
			body: `{"success":true,"action":"register"}`,
			want: ErrInvalidToken,
		},
		{
			name: "invalid token",
			body: `{"success":false,"error-codes":["invalid-input-response"]}`,
			want: ErrInvalidToken,
		},
		{
			name: "expired or replayed token",
			body: `{"success":false,"error-codes":["timeout-or-duplicate"]}`,
			want: ErrInvalidToken,
		},
		{
			name: "invalid secret",
			body: `{"success":false,"error-codes":["invalid-input-secret"]}`,
			want: ErrUnavailable,
		},
		{
			name: "missing secret",
			body: `{"success":false,"error-codes":["missing-input-secret"]}`,
			want: ErrUnavailable,
		},
		{
			name: "upstream internal error",
			body: `{"success":false,"error-codes":["internal-error"]}`,
			want: ErrUnavailable,
		},
		{
			name: "malformed response",
			body: `<html>unavailable</html>`,
			want: ErrUnavailable,
		},
		{
			name: "missing success field",
			body: `{}`,
			want: ErrUnavailable,
		},
		{
			name: "trailing response data",
			body: `{"success":true,"hostname":"tasks.example.com","action":"register"} {}`,
			want: ErrUnavailable,
		},
		{
			name:   "HTTP error even with success JSON",
			body:   `{"success":true,"hostname":"tasks.example.com","action":"register"}`,
			status: http.StatusServiceUnavailable,
			want:   ErrUnavailable,
		},
		{
			name: "unrecognized failure",
			body: `{"success":false,"error-codes":["new-error"]}`,
			want: ErrUnavailable,
		},
	} {
		t.Run(tt.name, func(t *testing.T) {
			calls := 0
			verifier := NewVerifier(&http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
				calls++
				assert.Equal(t, "https://challenges.cloudflare.com/turnstile/v0/siteverify", r.URL.String())
				assert.Equal(t, http.MethodPost, r.Method)
				require.NoError(t, r.ParseForm())
				assert.Equal(t, "private-key", r.PostForm.Get("secret"))
				assert.Equal(t, "test-token", r.PostForm.Get("response"))
				deadline, ok := r.Context().Deadline()
				require.True(t, ok)
				assert.LessOrEqual(t, time.Until(deadline), 10*time.Second)
				status := tt.status
				if status == 0 {
					status = http.StatusOK
				}
				return &http.Response{
					StatusCode: status,
					Body:       io.NopCloser(strings.NewReader(tt.body)),
					Header:     make(http.Header),
				}, nil
			})})
			err := verifier.Verify(context.Background(), "test-token", ActionRegister)
			if tt.want != nil {
				require.ErrorIs(t, err, tt.want)
			} else {
				require.NoError(t, err)
			}
			assert.Equal(t, 1, calls, "single-use tokens must not be retried automatically")
		})
	}
}

func TestTurnstileVerifyPreflight(t *testing.T) {
	enableTurnstile(t)
	verifier := NewVerifier(&http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		t.Fatal("preflight rejection must not contact Cloudflare")
		return nil, nil
	})})
	require.ErrorIs(t, verifier.Verify(context.Background(), "", ActionRegister), ErrInvalidToken)
	require.ErrorIs(t, verifier.Verify(context.Background(), strings.Repeat("x", 2049), ActionRegister), ErrInvalidToken)
	config.TurnstileEnabled.Set(false)
	require.NoError(t, verifier.Verify(context.Background(), "", ActionRegister))
}

func TestTurnstileVerifyCancellation(t *testing.T) {
	enableTurnstile(t)
	verifier := NewVerifier(&http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		<-r.Context().Done()
		return nil, r.Context().Err()
	})})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	require.ErrorIs(t, verifier.Verify(ctx, "test-token", ActionRegister), ErrUnavailable)
	ctx, cancel = context.WithTimeout(context.Background(), time.Millisecond)
	defer cancel()
	require.ErrorIs(t, verifier.Verify(ctx, "test-token", ActionPasswordReset), ErrUnavailable)
}
