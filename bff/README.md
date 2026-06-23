# webphone BFF

A small Go backend-for-frontend that sits between the React SPA and the
control-plane. It is the only holder of the control-plane bearer token; the
browser never sees it.

## What it does

1. Validates the **Keycloak access token** the SPA sends as `Authorization:
   Bearer …` (OIDC discovery + JWKS; issuer = the `freeswitch` realm).
2. Reads RBAC roles from the token's `realm_access.roles`.
3. Resolves the logged-in identity to a SIP extension via the control-plane
   `operators` table (`subject` → domain/number), then fetches that user's SIP
   password — and **vends the SIP credentials** to the SPA so it can register.

## Endpoints

| method | path | auth | returns |
|---|---|---|---|
| GET | `/healthz` | none | `ok` |
| GET | `/api/session` | Keycloak Bearer | `{user, subject, roles, sip:{wss_url, domain, extension, password}}` |

`/api/session` → **401** without a valid token, **403** if the identity has no
(enabled) operator binding.

## Run

```bash
cd bff
go run .
# defaults: :8090, issuer http://localhost:8081/realms/freeswitch,
#           control-plane https://localhost:8080 (insecure), wss 192.168.48.143:7443
```

## Config (env)

| var | default | meaning |
|---|---|---|
| `BFF_ADDR` | `:8090` | listen address |
| `OIDC_ISSUER` | `http://localhost:8081/realms/freeswitch` | Keycloak realm issuer |
| `CONTROL_PLANE_URL` | `https://localhost:8080` | control-plane base URL |
| `CONTROL_PLANE_TOKEN` | `dev-token` | control-plane bearer (server-side only) |
| `CONTROL_PLANE_INSECURE` | `true` | skip TLS verify (dev self-signed CA) |
| `SIP_WSS_URL` | `wss://192.168.48.143:7443` | WSS URL handed to the SPA |
| `CORS_ORIGINS` | `http://localhost:5173,http://localhost:5174` | allowed SPA origins |

## Notes

- The SIP password is vended to the authenticated user for **their own**
  extension only — same trust model as phone provisioning. Going to production
  would add short-lived/scoped SIP credentials and a real TLS chain.
- Roles drive what the SPA shows and (later) which `/api/v1/*` calls the BFF
  proxies for supervisors/admins.
