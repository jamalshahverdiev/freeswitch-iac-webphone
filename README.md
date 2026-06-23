# freeswitch-iac-webphone

A custom WebRTC softphone (built on [SIP.js](https://sipjs.com)) for the
FreeSWITCH IaC Platform. See [PLAN.md](./PLAN.md) for the full roadmap.

**Status: Phase 1 (+ early Phase 2)** — register over WSS and place/receive a
one-to-one audio call, with:

- ringback (caller) and ringtone (callee), generated via Web Audio;
- a dial pad with audible DTMF touch-tones — builds the number when idle, sends
  DTMF to the far end during a call (e.g. to drive an IVR);
- mute / unmute, hold / resume, and blind transfer (REFER).

No login yet (credentials are entered in the settings form and kept in memory
only); Keycloak/RBAC auth arrives in Phase 1.5.

## Run

```bash
npm install
npm run dev          # http://localhost:5173
```

`http://localhost` is a secure browser context, so `getUserMedia` (mic) works
without an HTTPS dev server.

### One-time: trust the FreeSWITCH WSS certificate

The browser must trust the cert FreeSWITCH serves on `wss://<fs-host>:7443`.
Either import the platform CA (`deploy/tls/ca.crt` from the control-plane repo)
into your browser/OS, **or** visit `https://192.168.48.143:7443` once and accept
the warning. Without this the WebSocket connection silently fails.

## Test a call (4201 ↔ 4202)

1. Open `http://localhost:5173` in **two** browser tabs (or two machines).
2. Tab A: Extension `4201`, Domain `192.168.48.143`, Password (see the
   control-plane repo `deploy/SECRETS.md`) → **Register**. The dot turns green.
3. Tab B: register as `4202` the same way.
4. In tab A type `4202` → **Call**. Accept in tab B (**Answer**). You should have
   two-way audio. **Hang up** ends it.

The WebRTC users `4201` / `4202` (and `4100`) are provisioned in the platform
directory; `4202`/`4100` support video for later phases.

## Configuration

Defaults come from `.env` (copy `.env.example`); every field is overridable at
runtime in the settings form:

| var | meaning | default |
|---|---|---|
| `VITE_WSS_URL` | FreeSWITCH sofia WSS endpoint | `wss://192.168.48.143:7443` |
| `VITE_SIP_DOMAIN` | SIP domain / realm | `192.168.48.143` |
| `VITE_DEFAULT_USER` | extension prefilled in the form | `4201` |

## Scripts

- `npm run dev` — dev server (HMR)
- `npm run build` — typecheck + production build to `dist/`
- `npm run typecheck` — types only

## Architecture (Phase 1)

```
src/
  config.ts      settings (env defaults + localStorage; password NOT persisted)
  store.ts       Zustand: connection / registration / call state
  sip/phone.ts   sip.js SimpleUser wrapper: connect, register, call, answer, hangup
  App.tsx        UI: settings form, register status, dialer, active/incoming call
```

Phase 1 uses sip.js `SimpleUser` (the Web helper) for speed; later phases drop to
the lower-level API for DTMF / hold / transfer / video / conference.
