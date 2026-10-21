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
	"errors"
	"net"
	"net/url"
	"strings"

	"golang.org/x/net/idna"
)

var (
	errTurnstileSiteKeyRequired = errors.New("turnstile.sitekey is required when Turnstile is enabled")
	errTurnstileSecretRequired  = errors.New("turnstile.secretkey is required when Turnstile is enabled")
	errTurnstileHostnameMissing = errors.New("set turnstile.allowedhostnames or a valid service.publicurl when Turnstile is enabled")
	errTurnstileHostnameFormat  = errors.New("turnstile.allowedhostnames must contain hostnames without schemes, ports, paths or wildcards")
	errTurnstileHostnameInvalid = errors.New("turnstile.allowedhostnames contains an invalid hostname")
)

func validateTurnstileConfig() error {
	if !TurnstileEnabled.GetBool() {
		return nil
	}
	if strings.TrimSpace(TurnstileSiteKey.GetString()) == "" {
		return errTurnstileSiteKeyRequired
	}
	if strings.TrimSpace(TurnstileSecretKey.GetString()) == "" {
		return errTurnstileSecretRequired
	}
	_, err := TurnstileHostnames()
	return err
}

// TurnstileHostnames resolves the browser hostnames allowed to solve a challenge.
func TurnstileHostnames() ([]string, error) {
	hosts := TurnstileAllowedHostnames.GetStringSlice()
	if len(hosts) == 0 {
		u, err := url.Parse(ServicePublicURL.GetString())
		if err != nil || u.Hostname() == "" || (u.Scheme != "http" && u.Scheme != "https") {
			return nil, errTurnstileHostnameMissing
		}
		hosts = []string{u.Hostname()}
	}

	normalized := make([]string, 0, len(hosts))
	seen := make(map[string]bool, len(hosts))
	for _, host := range hosts {
		host = strings.TrimSuffix(strings.TrimSpace(host), ".")
		if ip := net.ParseIP(host); ip != nil {
			host = ip.String()
		} else {
			ascii, err := idna.Lookup.ToASCII(host)
			if err != nil || ascii == "" || len(ascii) > 253 || strings.ContainsAny(ascii, ":/\\*?#@%[]") {
				return nil, errTurnstileHostnameFormat
			}
			host = strings.ToLower(ascii)
			for _, label := range strings.Split(host, ".") {
				if label == "" || len(label) > 63 {
					return nil, errTurnstileHostnameInvalid
				}
			}
		}
		if !seen[host] {
			normalized = append(normalized, host)
			seen[host] = true
		}
	}
	return normalized, nil
}
