# freeswitch-iac-webphone

A custom WebRTC softphone (built on [SIP.js](https://sipjs.com)) for the
FreeSWITCH IaC Platform. See [PLAN.md](./PLAN.md) for the full roadmap.

**Status: Phase 2** — register over WSS and place/receive calls, with:

- ringback (caller) and ringtone (callee), generated via Web Audio;
- a dial pad with audible DTMF touch-tones — builds the number when idle, sends
  DTMF to the far end during a call (e.g. to drive an IVR);
- mute / unmute, hold / resume;
- **two concurrent lines** (a second call auto-holds the first);
- **blind transfer** and **attended (consultative) transfer** — hold the call,
  dial the target, talk, then connect them via REFER-with-Replaces;
- **video calls** (Phase 3) — tick *Video* before dialing, or *Answer (video)*
  an incoming call, to negotiate a camera track and render the remote feed with
  a local self-view;
- **mid-call escalation** — *Add video* re-INVITEs an in-progress audio call to
  add a camera; *Camera off/on* toggles the local video track. Conference video
  grid, device selection and screen share come next.

Sign in with Keycloak (OIDC); the SIP credentials are vended by the BFF. The
manual settings form survives as an "advanced / bring your own PBX" option.

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

## Architecture

```
src/
  config.ts      settings (env defaults + localStorage; password NOT persisted)
  store.ts       Zustand: connection / registration / per-line state (LineView[])
  sip/phone.ts   sip.js SessionManager wrapper: register + up to two concurrent
                 lines (call/answer/hangup/hold/mute/DTMF/blind+attended transfer)
  App.tsx        UI: sign-in, register status, per-line controls + transfer flows
```

Phase 1 started on sip.js `SimpleUser` (single session); Phase 2 moved to
`SessionManager` (the multi-session layer underneath it) to support two
concurrent lines and consultative transfer. Phase 3 (video / conference) builds
on the same lower-level layer.
