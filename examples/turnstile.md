# Cloudflare Turnstile

Turnstile is optional and disabled by default. It protects local registration,
including invitation links, and requests for password reset emails. Password
login, LDAP, OIDC, CalDAV, email confirmation, setting a password with a reset
link, and administrator or CLI account creation do not require a challenge.

## Configuration

Create a Turnstile widget for the hostname where the **frontend page** is served.
Configure Vikunja using the config file or environment variables:

```yaml
turnstile:
  enabled: true
  sitekey: "your-public-site-key"
  secretkey: "your-server-side-secret-key"
  allowedhostnames:
    - tasks.example.com
```

The environment variables are `VIKUNJA_TURNSTILE_ENABLED`,
`VIKUNJA_TURNSTILE_SITEKEY`, `VIKUNJA_TURNSTILE_SECRETKEY` and
`VIKUNJA_TURNSTILE_ALLOWEDHOSTNAMES`. The last variable accepts space-separated
hostnames. Keep the secret key on the server; it is not returned by `/api/v2/info`.

If `allowedhostnames` is empty, Vikunja uses the hostname of `service.publicurl`.
For a separately hosted frontend, explicitly configure its hostname, not the API
hostname. Entries are exact hostnames, without schemes, ports, paths or wildcards.
Enabling Turnstile without both keys or a usable hostname prevents startup.

The server needs outbound HTTPS access to
`https://challenges.cloudflare.com/turnstile/v0/siteverify`. Its existing
`outgoingrequests` proxy settings apply. Verification has a maximum duration of
10 seconds and stops when the incoming request is canceled. Failed verification
never permits registration or password reset token generation.

## Browser And API Requirements

For deployments with a Content Security Policy, allow
`https://challenges.cloudflare.com` in both `script-src` and `frame-src`.
The frontend loads the Cloudflare script only when Turnstile is enabled.

`GET /api/v2/info` advertises `turnstile.enabled` and `turnstile.site_key`.
Protected v2 requests carry a `turnstile_token` field, at most 2048 characters:

| Endpoint | Widget action |
| --- | --- |
| `POST /api/v2/register` | `register` |
| `POST /api/v2/user/password/token` | `password_reset` |

The server checks the token's success, action and hostname. A token expires after
five minutes and can be used only once. After a submitted request, complete a new
challenge before retrying; keep the other form fields unchanged.

| HTTP status | Error code | Meaning |
| --- | --- | --- |
| 400 | 20001 | Missing, invalid, expired, replayed or mismatched challenge |
| 503 | 20002 | Siteverify unavailable, invalid secret or unusable upstream response |
| 403 | 20003 | Turnstile is enabled and a protected v1 endpoint was used |
| 422 | Existing validation codes | Invalid v2 request structure or field length |

The v1 request and info formats do not change. When Turnstile is enabled, the two
protected v1 endpoints return 403 and require a v2-capable client. When disabled,
their original behavior remains available.

## Rollout And Rollback

Deploy the updated API with Turnstile disabled, deploy the updated frontend, then
configure the keys and enable Turnstile. Restart Vikunja after configuration
changes. Test real keys on a staging hostname, including registration, invitation
registration, email confirmation, automatic login and password reset emails.
Verify that wrong actions and hostnames are rejected without business side
effects. Cloudflare's official test keys are useful for widget tests, but do not
replace verification of a real widget and its hostname restrictions.

To roll back the protection, set `turnstile.enabled` to `false` (or set
`VIKUNJA_TURNSTILE_ENABLED=false`) and restart. No database migration is involved.
