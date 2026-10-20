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

package license

import (
	"testing"
	"time"

	"code.vikunja.io/api/pkg/config"
	"code.vikunja.io/api/pkg/db"
	"code.vikunja.io/api/pkg/log"
	"code.vikunja.io/api/pkg/modules/keyvalue"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSelfHostedFeaturesWithoutLicense(t *testing.T) {
	config.InitDefaultConfig()
	log.InitLogger()
	config.LicenseKey.Set("")
	t.Cleanup(func() { config.LicenseKey.Set("") })

	engine, err := db.CreateTestEngine()
	require.NoError(t, err)
	require.NoError(t, engine.Sync2(GetTables()...))
	require.NoError(t, db.InitFixtures("license_status"))
	require.NoError(t, db.LoadFixtures())

	wantFeatures := []Feature{
		FeatureAdminPanel,
		FeatureAuditLogs,
		FeatureTimeTracking,
		FeatureUserInvites,
	}
	wantNames := []string{
		"admin_panel",
		"audit_logs",
		"time_tracking",
		"user_invites",
	}

	for _, stale := range []bool{false, true} {
		name := "fresh startup"
		if stale {
			name = "previous license state is cleared"
		}
		t.Run(name, func(t *testing.T) {
			keyvalue.InitStorage()
			if stale {
				saveState(state{
					Licensed:        true,
					Features:        map[Feature]bool{FeatureAdminPanel: true},
					MaxUsers:        1,
					ExpiresAt:       time.Now().Add(-time.Hour),
					LastCheckFailed: true,
				})
				_, err := engine.ID(1).Cols("validated_at").Update(&Status{ValidatedAt: time.Now()})
				require.NoError(t, err)
			}

			Init()
			t.Cleanup(Shutdown)

			assert.Equal(t, wantFeatures, EnabledProFeatures())
			for _, feature := range wantFeatures {
				assert.True(t, IsFeatureEnabled(feature), feature.String())
			}
			assert.False(t, IsFeatureEnabled(FeatureUnknown))
			assert.False(t, IsFeatureEnabled(Feature(999)))
			assert.False(t, MaxUsersReached())

			info := CurrentInfo()
			assert.False(t, info.Licensed)
			assert.Equal(t, wantNames, info.Features)
			assert.Zero(t, info.MaxUsers)
			assert.True(t, info.ExpiresAt.IsZero())
			assert.True(t, info.ValidatedAt.IsZero())
			assert.False(t, info.LastCheckFailed)
			assert.Equal(t, "00000000-0000-0000-0000-000000000000", info.InstanceID)
		})
	}
}
