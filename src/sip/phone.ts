// Thin wrapper around sip.js SimpleUser for Phase 1: connect, register, place /
// receive one audio call, hang up. Advanced controls (DTMF, hold, transfer,
// video, conference) come in later phases via the lower-level sip.js API.

import { SimpleUser, SimpleUserOptions } from "sip.js/lib/platform/web";
import { UserAgent } from "sip.js";
import type { Settings } from "../config";
import { usePhone } from "../store";
import * as ringer from "./ringer";

let ua: SimpleUser | null = null;

/** Connect to FreeSWITCH over WSS and REGISTER as the configured extension. */
export async function start(settings: Settings, password: string, remoteAudio: HTMLAudioElement) {
  await stop(); // tear down any previous session

  const s = usePhone.getState();
  s.setError(undefined);
  s.setRegistration("connecting");
  ringer.ensureAudio(); // resume AudioContext on this user gesture (for ringtone later)

  const options: SimpleUserOptions = {
    aor: `sip:${settings.user}@${settings.domain}`,
    media: { remote: { audio: remoteAudio } },
    userAgentOptions: {
      authorizationUsername: settings.user,
      authorizationPassword: password,
      displayName: settings.user,
      // distinct UA so this app is unmistakable in `sofia status ... reg`
      userAgentString: "fswebphone/0.1.0 (SIP.js)",
      // Don't block the SDP answer waiting for full ICE gathering — on a LAN
      // host candidates are immediate; this removes the answer/connect lag.
      sessionDescriptionHandlerFactoryOptions: {
        iceGatheringTimeout: 500,
      },
    },
    delegate: {
      onServerConnect: () => usePhone.getState().setConnected(true),
      onServerDisconnect: () => {
        usePhone.getState().setConnected(false);
        usePhone.getState().setRegistration("unregistered");
      },
      onRegistered: () => usePhone.getState().setRegistration("registered"),
      onUnregistered: () => usePhone.getState().setRegistration("unregistered"),
      // SimpleUser does not surface the caller id here; shown generically.
      onCallReceived: () => {
        usePhone.getState().setCall("incoming", "incoming call");
        ringer.startRingtone();
      },
      onCallAnswered: () => {
        usePhone.getState().setCall("active");
        ringer.stop();
      },
      onCallHangup: () => {
        usePhone.getState().setCall("idle");
        ringer.stop();
      },
      onCallHold: (held) => usePhone.getState().setHeld(held),
    },
  };

  ua = new SimpleUser(settings.wssUrl, options);
  try {
    await ua.connect();
    s.setRegistration("registering");
    await ua.register();
  } catch (err) {
    s.setRegistration("failed");
    s.setError(errMsg(err));
    throw err;
  }
}

/** Place an outbound call to a target extension in the configured domain. */
export async function call(target: string, domain: string) {
  if (!ua) throw new Error("not connected");
  usePhone.getState().setCall("outgoing", target);
  ringer.startRingback();
  try {
    await ua.call(`sip:${target}@${domain}`);
  } catch (err) {
    ringer.stop();
    usePhone.getState().setCall("idle");
    usePhone.getState().setError(errMsg(err));
    throw err;
  }
}

/** Play a local DTMF tone (feedback only, no SIP signalling). */
export function tone(key: string) {
  ringer.playDtmf(key);
}

/** Send a DTMF digit to the far end during a call, with local feedback. */
export async function sendDtmf(key: string) {
  ringer.playDtmf(key);
  await ua?.sendDTMF(key);
}

/** Toggle mute of the local microphone during a call. */
export function toggleMute() {
  if (!ua) return;
  const s = usePhone.getState();
  if (s.muted) {
    ua.unmute();
    s.setMuted(false);
  } else {
    ua.mute();
    s.setMuted(true);
  }
}

/** Toggle hold (re-INVITE). onCallHold delegate syncs the store on success. */
export async function toggleHold() {
  if (!ua) return;
  if (usePhone.getState().held) {
    await ua.unhold();
  } else {
    await ua.hold();
  }
}

/** Blind-transfer the active call to another extension (sends a REFER). The
 * local leg ends once FreeSWITCH accepts the transfer. SimpleUser doesn't expose
 * REFER, so we reach its underlying Session. */
export async function blindTransfer(target: string, domain: string) {
  if (!ua) return;
  const uri = UserAgent.makeURI(`sip:${target}@${domain}`);
  if (!uri) throw new Error("invalid transfer target");
  const session = (ua as unknown as { session?: { refer: (to: unknown) => Promise<unknown> } }).session;
  if (!session) throw new Error("no active call to transfer");
  await session.refer(uri);
}

/** Answer the current incoming call. */
export async function answer() {
  ringer.stop(); // immediate feedback: silence the ring on click, not on onCallAnswered
  await ua?.answer();
}

/** Hang up / decline the current call. */
export async function hangup() {
  await ua?.hangup();
}

/** Unregister and disconnect. */
export async function stop() {
  ringer.stop();
  if (!ua) return;
  try {
    await ua.unregister();
    await ua.disconnect();
  } catch {
    /* best-effort teardown */
  }
  ua = null;
  usePhone.getState().reset();
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
