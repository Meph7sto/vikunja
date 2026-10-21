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

package config

import (
	"testing"

	"github.com/spf13/viper"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTurnstileConfig(t *testing.T) {
	for _, tt := range []struct {
		name      string
		enabled   bool
		siteKey   string
		secretKey string
		publicURL string
		hostnames []string
		wantHosts []string
		wantErr   bool
	}{
		{name: "disabled needs no credentials"},
		{
			name:    "missing keys",
			enabled: true,
			wantErr: true,
		},
		{
			name:      "missing secret",
			enabled:   true,
			siteKey:   "public-key",
			publicURL: "https://tasks.example.com/",
			wantErr:   true,
		},
		{
			name:      "missing site key",
			enabled:   true,
			secretKey: "private-key",
			publicURL: "https://tasks.example.com/",
			wantErr:   true,
		},
		{
			name:      "missing hostname",
			enabled:   true,
			siteKey:   "public-key",
			secretKey: "private-key",
			wantErr:   true,
		},
		{
			name:      "public URL hostname without port or path",
			enabled:   true,
			siteKey:   "public-key",
			secretKey: "private-key",
			publicURL: "https://TASKS.example.com:8443/prefix/",
			wantHosts: []string{"tasks.example.com"},
		},
		{
			name:      "explicit names override public URL",
			enabled:   true,
			siteKey:   "public-key",
			secretKey: "private-key",
			publicURL: "https://api.example.com/",
			hostnames: []string{" Tasks.example.com. ", "other.example.com", "tasks.example.com"},
			wantHosts: []string{"tasks.example.com", "other.example.com"},
		},
		{
			name:      "URLs are not hostnames",
			enabled:   true,
			siteKey:   "public-key",
			secretKey: "private-key",
			hostnames: []string{"https://tasks.example.com"},
			wantErr:   true,
		},
		{
			name:      "wildcards are not accepted",
			enabled:   true,
			siteKey:   "public-key",
			secretKey: "private-key",
			hostnames: []string{"*.example.com"},
			wantErr:   true,
		},
		{
			name:      "empty entries do not disable hostname checks",
			enabled:   true,
			siteKey:   "public-key",
			secretKey: "private-key",
			hostnames: []string{" "},
			wantErr:   true,
		},
	} {
		t.Run(tt.name, func(t *testing.T) {
			viper.Reset()
			t.Cleanup(viper.Reset)
			InitDefaultConfig()
			TurnstileEnabled.Set(tt.enabled)
			TurnstileSiteKey.Set(tt.siteKey)
			TurnstileSecretKey.Set(tt.secretKey)
			TurnstileAllowedHostnames.Set(tt.hostnames)
			ServicePublicURL.Set(tt.publicURL)
			err := validateTurnstileConfig()
			if tt.wantErr {
				require.Error(t, err)
				assert.NotContains(t, err.Error(), "private-key")
				return
			}
			require.NoError(t, err)
			if tt.enabled {
				hosts, err := TurnstileHostnames()
				require.NoError(t, err)
				assert.Equal(t, tt.wantHosts, hosts)
			}
		})
	}
}

func TestTurnstileEnvironment(t *testing.T) {
	t.Setenv("VIKUNJA_TURNSTILE_ENABLED", "true")
	t.Setenv("VIKUNJA_TURNSTILE_SITEKEY", "public-key")
	t.Setenv("VIKUNJA_TURNSTILE_SECRETKEY", "private-key")
	t.Setenv("VIKUNJA_TURNSTILE_ALLOWEDHOSTNAMES", "tasks.example.com other.example.com")
	initConfigFromYAML(t, "")
	assert.True(t, TurnstileEnabled.GetBool())
	assert.Equal(t, "public-key", TurnstileSiteKey.GetString())
	assert.Equal(t, "private-key", TurnstileSecretKey.GetString())
	hosts, err := TurnstileHostnames()
	require.NoError(t, err)
	assert.Equal(t, []string{"tasks.example.com", "other.example.com"}, hosts)
}
