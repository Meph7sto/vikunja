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
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"code.vikunja.io/api/pkg/config"
	"code.vikunja.io/api/pkg/db"
	"code.vikunja.io/api/pkg/license"
	"code.vikunja.io/api/pkg/models"
	"code.vikunja.io/api/pkg/user"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSelfHostedFeaturesAndPermissions(t *testing.T) {
	e, err := setupTestEnv()
	require.NoError(t, err)
	engine, err := db.CreateTestEngine()
	require.NoError(t, err)
	require.NoError(t, engine.Sync2(license.GetTables()...))
	config.LicenseKey.Set("")
	license.Init()
	t.Cleanup(license.ResetForTests)

	info := adminReq(t, e, http.MethodGet, "/api/v2/info", nil, "")
	require.Equal(t, http.StatusOK, info.Code, info.Body.String())
	var advertised struct {
		Features []string `json:"enabled_pro_features"`
	}
	require.NoError(t, json.Unmarshal(info.Body.Bytes(), &advertised))
	assert.Equal(t, []string{
		"admin_panel",
		"audit_logs",
		"time_tracking",
		"user_invites",
	}, advertised.Features)

	denied := adminReq(t, e, http.MethodGet, "/api/v2/admin/overview", &testuser1, "")
	assert.Equal(t, http.StatusNotFound, denied.Code)
	unauthenticated := adminReq(t, e, http.MethodGet, "/api/v2/admin/overview", nil, "")
	assert.Equal(t, http.StatusUnauthorized, unauthenticated.Code)
	admin := promoteToAdmin(t, 1)
	overview := adminReq(t, e, http.MethodGet, "/api/v2/admin/overview", admin, "")
	require.Equal(t, http.StatusOK, overview.Code, overview.Body.String())
	assert.Contains(t, overview.Body.String(), `"licensed":false`)

	entry := adminReq(t, e, http.MethodPost, "/api/v2/time-entries", &testuser1,
		`{"task_id":1,"start_time":"2020-01-01T09:00:00Z","end_time":"2020-01-01T10:00:00Z","comment":"local work"}`)
	require.Equal(t, http.StatusCreated, entry.Code, entry.Body.String())
	var saved models.TimeEntry
	require.NoError(t, json.Unmarshal(entry.Body.Bytes(), &saved))
	path := fmt.Sprintf("/api/v2/time-entries/%d", saved.ID)
	read := adminReq(t, e, http.MethodGet, path, &testuser1, "")
	require.Equal(t, http.StatusOK, read.Code, read.Body.String())
	assert.Contains(t, read.Body.String(), "local work")
	denied = adminReq(t, e, http.MethodGet, path, &testuser2, "")
	assert.Equal(t, http.StatusForbidden, denied.Code, denied.Body.String())

	denied = adminReq(t, e, http.MethodPost, "/api/v2/admin/invite-links", &testuser2, `{"name":"denied"}`)
	assert.Equal(t, http.StatusNotFound, denied.Code)
	invite := adminReq(t, e, http.MethodPost, "/api/v2/admin/invite-links", admin,
		`{"name":"local team","team_ids":[1],"max_uses":1,"skip_email_confirm":true}`)
	require.Equal(t, http.StatusCreated, invite.Code, invite.Body.String())
	var link models.UserInviteLink
	require.NoError(t, json.Unmarshal(invite.Body.Bytes(), &link))
	require.NotEmpty(t, link.ClearTextToken)
	registration := adminReq(t, e, http.MethodPost, "/api/v2/register", nil,
		fmt.Sprintf(`{"invite_token":%q,"username":"local-invite","email":"local-invite@example.com","password":"12345678"}`, link.ClearTextToken))
	require.Equal(t, http.StatusCreated, registration.Code, registration.Body.String())
	var invited user.User
	require.NoError(t, json.Unmarshal(registration.Body.Bytes(), &invited))
	db.AssertExists(t, "team_members", map[string]interface{}{
		"team_id": 1,
		"user_id": invited.ID,
	}, false)
	assert.True(t, license.IsFeatureEnabled(license.FeatureAuditLogs))
}
