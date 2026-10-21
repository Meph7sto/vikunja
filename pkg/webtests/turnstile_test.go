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

package webtests

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"

	"code.vikunja.io/api/pkg/config"
	"code.vikunja.io/api/pkg/db"
	"code.vikunja.io/api/pkg/license"
	"code.vikunja.io/api/pkg/modules/turnstile"
	"code.vikunja.io/api/pkg/notifications"
	"code.vikunja.io/api/pkg/user"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Keep the production URL, TLS validation and proxy-aware client, but route its connection to a local Siteverify.
func mockTurnstile(t *testing.T) *atomic.Int32 {
	t.Helper()
	calls := &atomic.Int32{}
	used := map[string]bool{}
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		assert.Equal(t, "challenges.cloudflare.com", r.Host)
		assert.Equal(t, "/turnstile/v0/siteverify", r.URL.Path)
		if !assert.NoError(t, r.ParseForm()) {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		assert.Equal(t, "private-key", r.Form.Get("secret"))
		token := r.Form.Get("response")
		w.Header().Set("Content-Type", "application/json")
		if token == "malformed" {
			_, _ = fmt.Fprint(w, "not JSON")
			return
		}
		response := map[string]any{
			"success":  true,
			"hostname": "tasks.example.com",
			"action":   turnstile.ActionRegister,
		}
		switch token {
		case "invalid", "expired":
			response = map[string]any{
				"success":     false,
				"error-codes": []string{"timeout-or-duplicate"},
			}
		case "bad-secret":
			response = map[string]any{
				"success":     false,
				"error-codes": []string{"invalid-input-secret"},
			}
		case "wrong-host":
			response["hostname"] = "evil.example.com"
		case "wrong-action":
			response["action"] = "unrelated"
		case "reset-token":
			response["action"] = turnstile.ActionPasswordReset
		}
		if used[token] {
			response = map[string]any{
				"success":     false,
				"error-codes": []string{"timeout-or-duplicate"},
			}
		}
		if response["success"] == true {
			used[token] = true
		}
		assert.NoError(t, json.NewEncoder(w).Encode(response))
	}))
	t.Cleanup(server.Close)
	serverURL, err := url.Parse(server.URL)
	require.NoError(t, err)
	transport := server.Client().Transport.(*http.Transport).Clone()
	transport.TLSClientConfig.ServerName = serverURL.Hostname()
	transport.DialContext = func(ctx context.Context, network, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, network, serverURL.Host)
	}
	original := http.DefaultTransport
	http.DefaultTransport = transport
	proxy := config.OutgoingRequestsProxyURL.GetString()
	allowPrivate := config.OutgoingRequestsAllowNonRoutableIPs.GetBool()
	config.OutgoingRequestsProxyURL.Set("")
	config.OutgoingRequestsAllowNonRoutableIPs.Set(true)
	t.Setenv("NO_PROXY", "*")
	config.TurnstileEnabled.Set(true)
	config.TurnstileSiteKey.Set("public-key")
	config.TurnstileSecretKey.Set("private-key")
	config.TurnstileAllowedHostnames.Set([]string{"tasks.example.com"})
	t.Cleanup(func() {
		transport.CloseIdleConnections()
		http.DefaultTransport = original
		config.OutgoingRequestsProxyURL.Set(proxy)
		config.OutgoingRequestsAllowNonRoutableIPs.Set(allowPrivate)
		config.TurnstileEnabled.Set(false)
		config.TurnstileSiteKey.Set("")
		config.TurnstileSecretKey.Set("")
		config.TurnstileAllowedHostnames.Set([]string{})
	})
	return calls
}

func TestTurnstilePublicAuthRejectsWithoutSideEffects(t *testing.T) {
	for _, token := range []string{"", "invalid", "expired", "wrong-host", "wrong-action", "bad-secret", "malformed"} {
		t.Run(token, func(t *testing.T) {
			mockTurnstile(t)
			e, err := setupTestEnv()
			require.NoError(t, err)
			license.SetForTests([]license.Feature{license.FeatureUserInvites})
			t.Cleanup(license.ResetForTests)
			notifications.Fake()
			t.Cleanup(notifications.Unfake)
			config.MailerEnabled.Set(true)
			t.Cleanup(func() { config.MailerEnabled.Set(false) })
			s := db.NewSession()
			defer s.Close()
			beforeTokens, err := s.Count(&user.Token{})
			require.NoError(t, err)
			status := http.StatusBadRequest
			if token == "bad-secret" || token == "malformed" {
				status = http.StatusServiceUnavailable
			}
			for _, invite := range []bool{false, true} {
				body := map[string]string{
					"username":        "turnstile-rejected",
					"email":           "turnstile-rejected@example.com",
					"password":        "12345678",
					"turnstile_token": token,
				}
				if invite {
					body["invite_token"] = "last-slot"
				}
				payload, err := json.Marshal(body)
				require.NoError(t, err)
				res := humaRequest(t, e, http.MethodPost, "/api/v2/register", string(payload), "", "")
				require.Equal(t, status, res.Code, res.Body.String())
			}
			res := humaRequest(t, e, http.MethodPost, "/api/v2/user/password/token",
				fmt.Sprintf(`{"email":"user1@example.com","turnstile_token":%q}`, token), "", "")
			require.Equal(t, status, res.Code, res.Body.String())
			db.AssertMissing(t, "users", map[string]interface{}{"username": "turnstile-rejected"})
			db.AssertExists(t, "user_invite_links", map[string]interface{}{
				"id":   2,
				"uses": 1,
			}, false)
			afterTokens, err := s.Count(&user.Token{})
			require.NoError(t, err)
			assert.Equal(t, beforeTokens, afterTokens)
			notifications.AssertNotSent(t, &user.ResetPasswordNotification{})
		})
	}
}

func TestTurnstilePublicAuthSuccessAndReplay(t *testing.T) {
	mockTurnstile(t)
	e, err := setupTestEnv()
	require.NoError(t, err)
	notifications.Fake()
	t.Cleanup(notifications.Unfake)
	body := `{"username":"turnstile-user","email":"turnstile@example.com","password":"12345678","turnstile_token":"register-token"}`
	res := humaRequest(t, e, http.MethodPost, "/api/v2/register", body, "", "")
	require.Equal(t, http.StatusCreated, res.Code, res.Body.String())
	db.AssertExists(t, "users", map[string]interface{}{"username": "turnstile-user"}, false)
	res = humaRequest(t, e, http.MethodPost, "/api/v2/login", `{"username":"turnstile-user","password":"12345678"}`, "", "")
	require.Equal(t, http.StatusOK, res.Code, res.Body.String())
	res = humaRequest(t, e, http.MethodPost, "/api/v2/register", strings.ReplaceAll(body, "turnstile-user", "replay-user"), "", "")
	require.Equal(t, http.StatusBadRequest, res.Code, res.Body.String())
	db.AssertMissing(t, "users", map[string]interface{}{"username": "replay-user"})
	config.MailerEnabled.Set(true)
	t.Cleanup(func() { config.MailerEnabled.Set(false) })
	res = humaRequest(t, e, http.MethodPost, "/api/v2/user/password/token",
		`{"email":"user1@example.com","turnstile_token":"reset-token"}`, "", "")
	require.Equal(t, http.StatusOK, res.Code, res.Body.String())
	notifications.AssertSent(t, &user.ResetPasswordNotification{})
}

func TestTurnstileInvitationWithPublicRegistrationDisabled(t *testing.T) {
	calls := mockTurnstile(t)
	config.ServiceEnableRegistration.Set(false)
	t.Cleanup(func() { config.ServiceEnableRegistration.Set(true) })
	e, err := setupTestEnv()
	require.NoError(t, err)
	license.SetForTests([]license.Feature{license.FeatureUserInvites})
	t.Cleanup(license.ResetForTests)
	res := humaRequest(t, e, http.MethodPost, "/api/v2/register",
		`{"username":"invite-turnstile","email":"invite-turnstile@example.com","password":"12345678"}`, "", "")
	require.Equal(t, http.StatusNotFound, res.Code)
	assert.Zero(t, calls.Load())
	res = humaRequest(t, e, http.MethodPost, "/api/v2/register",
		`{"invite_token":"last-slot","username":"invite-turnstile","email":"invite-turnstile@example.com","password":"12345678","turnstile_token":"invite-token"}`, "", "")
	require.Equal(t, http.StatusCreated, res.Code, res.Body.String())
	db.AssertExists(t, "user_invite_links", map[string]interface{}{
		"id":   2,
		"uses": 2,
	}, false)
}

func TestTurnstileV1AndValidation(t *testing.T) {
	calls := mockTurnstile(t)
	e, err := setupTestEnv()
	require.NoError(t, err)
	for _, path := range []string{"/api/v1/register", "/api/v1/user/password/token"} {
		res := humaRequest(t, e, http.MethodPost, path,
			`{"username":"v1-turnstile","email":"user1@example.com","password":"12345678"}`, "", "")
		require.Equal(t, http.StatusForbidden, res.Code, res.Body.String())
		assert.Contains(t, res.Body.String(), "API v2")
	}
	for _, body := range []string{
		`{"username":"short","password":"1","email":"user1@example.com"}`,
		fmt.Sprintf(`{"username":"long-token","password":"12345678","email":"user1@example.com","turnstile_token":%q}`, strings.Repeat("x", 2049)),
	} {
		res := humaRequest(t, e, http.MethodPost, "/api/v2/register", body, "", "")
		require.Equal(t, http.StatusUnprocessableEntity, res.Code, res.Body.String())
	}
	assert.Zero(t, calls.Load())
	config.TurnstileEnabled.Set(false)
	res := humaRequest(t, e, http.MethodPost, "/api/v1/register",
		`{"username":"v1-turnstile","email":"v1-turnstile@example.com","password":"12345678"}`, "", "")
	require.Equal(t, http.StatusOK, res.Code, res.Body.String())
	res = humaRequest(t, e, http.MethodPost, "/api/v1/user/password/token", `{"email":"user1@example.com"}`, "", "")
	require.Equal(t, http.StatusOK, res.Code, res.Body.String())
}

func TestTurnstileInfoV2Only(t *testing.T) {
	mockTurnstile(t)
	e, err := setupTestEnv()
	require.NoError(t, err)
	for _, version := range []string{"v1", "v2"} {
		res := humaRequest(t, e, http.MethodGet, "/api/"+version+"/info", "", "", "")
		require.Equal(t, http.StatusOK, res.Code)
		assert.NotContains(t, res.Body.String(), "private-key")
		if version == "v2" {
			assert.Contains(t, res.Body.String(), `"turnstile":{"enabled":true,"site_key":"public-key"}`)
		} else {
			assert.NotContains(t, res.Body.String(), "turnstile")
		}
	}
}

func TestTurnstileDoesNotProtectBusinessTokens(t *testing.T) {
	calls := mockTurnstile(t)
	e, err := setupTestEnv()
	require.NoError(t, err)
	for _, request := range []struct {
		path string
		body string
	}{
		{
			path: "/api/v2/user/confirm",
			body: `{"token":"tiepiQueed8ahc7zeeFe1eveiy4Ein8osooxegiephauph2Ael"}`,
		},
		{
			path: "/api/v2/user/password/reset",
			body: `{"token":"passwordresettesttoken","new_password":"12345678"}`,
		},
	} {
		res := humaRequest(t, e, http.MethodPost, request.path, request.body, "", "")
		require.Equal(t, http.StatusOK, res.Code, res.Body.String())
	}
	assert.Zero(t, calls.Load())
}

func TestTurnstileRateLimitPrecedesSiteverify(t *testing.T) {
	calls := mockTurnstile(t)
	limit := config.RateLimitNoAuthRoutesLimit.GetInt64()
	config.RateLimitNoAuthRoutesLimit.Set(1)
	t.Cleanup(func() { config.RateLimitNoAuthRoutesLimit.Set(limit) })
	e, err := setupTestEnv()
	require.NoError(t, err)
	body := `{"email":"user1@example.com","turnstile_token":"invalid"}`
	res := humaRequest(t, e, http.MethodPost, "/api/v2/user/password/token", body, "", "")
	require.Equal(t, http.StatusBadRequest, res.Code, res.Body.String())
	assert.EqualValues(t, 1, calls.Load())
	res = humaRequest(t, e, http.MethodPost, "/api/v2/user/password/token", body, "", "")
	require.Equal(t, http.StatusTooManyRequests, res.Code, res.Body.String())
	assert.EqualValues(t, 1, calls.Load())
}
