// Multi-line softphone built on sip.js SessionManager (the web multi-session
// layer underneath SimpleUser). It manages up to two concurrent calls — enough
// for consultative (attended) transfer: hold the first call, dial the transfer
// target on a second line, talk, then REFER-with-Replaces to connect them.
//
// SessionManager handles the media plumbing (per-session PeerConnection, remote
// stream attachment, hold/mute track toggling, DTMF, REFER) so we only track a
// light per-line view for the UI and drive the store from its delegate.

import { SessionManager, SessionManagerOptions } from "sip.js/lib/platform/web";
import { Invitation, Session } from "sip.js";
import type { Settings } from "../config";
import { usePhone, type LineState, type LineView } from "../store";
import * as ringer from "./ringer";

let sm: SessionManager | null = null;
let domain = "";

export const MAX_LINES = 2;

// Per-line UI metadata, keyed by Session.id. The Session objects themselves are
// owned by SessionManager; we keep a parallel view to render and to resolve a
// line id back to its Session for control actions.
interface Line {
  session: Session;
  view: LineView;
}
const lines = new Map<string, Line>();

// One detached <audio> element per session. Held lines have their receiver
// tracks disabled by SessionManager, so only the foreground line is audible
// even though every line has its own sink.
const audioEls = new Map<string, HTMLAudioElement>();

function remoteMediaFor(session: Session): { audio: HTMLAudioElement } {
  let el = audioEls.get(session.id);
  if (!el) {
    el = new Audio();
    el.autoplay = true;
    audioEls.set(session.id, el);
  }
  return { audio: el };
}

function dropAudio(id: string): void {
  const el = audioEls.get(id);
  if (el) {
    el.srcObject = null;
    audioEls.delete(id);
  }
}

function peerOf(session: Session): string {
  return session.remoteIdentity?.uri.user ?? "unknown";
}

// ---- store / ringer sync ---------------------------------------------------

function publish(): void {
  usePhone.getState().setLines([...lines.values()].map((l) => ({ ...l.view })));
  updateRinger();
}

let ringMode: "none" | "back" | "tone" = "none";
function updateRinger(): void {
  const views = [...lines.values()].map((l) => l.view);
  const mode: "none" | "back" | "tone" = views.some(
    (v) => v.outgoing && v.state === "establishing",
  )
    ? "back"
    : views.some((v) => !v.outgoing && v.state === "ringing")
      ? "tone"
      : "none";
  if (mode === ringMode) return;
  ringMode = mode;
  if (mode === "back") ringer.startRingback();
  else if (mode === "tone") ringer.startRingtone();
  else ringer.stop();
}

function setState(id: string, state: LineState): void {
  const line = lines.get(id);
  if (line) {
    line.view.state = state;
    publish();
  }
}

// ---- lifecycle -------------------------------------------------------------

/** Connect over WSS and REGISTER. Resolves once registration is sent. */
export async function start(settings: Settings, password: string): Promise<void> {
  await stop();
  domain = settings.domain;

  const s = usePhone.getState();
  s.setError(undefined);
  s.setRegistration("connecting");
  ringer.ensureAudio(); // resume the AudioContext on this user gesture

  const options: SessionManagerOptions = {
    aor: `sip:${settings.user}@${settings.domain}`,
    // Cap at two concurrent lines. SessionManager rejects an incoming INVITE
    // when managedSessions.length > maxSimultaneousSessions, so 1 means "allow
    // a second line but reject a third".
    maxSimultaneousSessions: 1,
    media: {
      constraints: { audio: true, video: false },
      remote: (session) => remoteMediaFor(session),
    },
    userAgentOptions: {
      authorizationUsername: settings.user,
      authorizationPassword: password,
      displayName: settings.user,
      userAgentString: "fswebphone/0.2.0 (SIP.js)",
      sessionDescriptionHandlerFactoryOptions: { iceGatheringTimeout: 500 },
    },
    delegate: {
      onServerConnect: () => usePhone.getState().setConnected(true),
      onServerDisconnect: () => {
        usePhone.getState().setConnected(false);
        usePhone.getState().setRegistration("unregistered");
      },
      onRegistered: () => usePhone.getState().setRegistration("registered"),
      onCallCreated: (session) => {
        // Fires for inbound and outbound; distinguish by type. Inbound is also
        // signalled via onCallReceived, so only seed outbound lines here.
        if (session instanceof Invitation) return;
        lines.set(session.id, {
          session,
          view: { id: session.id, peer: peerOf(session), outgoing: true, state: "establishing", muted: false },
        });
        publish();
      },
      onCallReceived: (session) => {
        lines.set(session.id, {
          session,
          view: { id: session.id, peer: peerOf(session), outgoing: false, state: "ringing", muted: false },
        });
        publish();
      },
      onCallAnswered: (session) => setState(session.id, "active"),
      onCallHold: (session, held) => setState(session.id, held ? "held" : "active"),
      onCallHangup: (session) => {
        lines.delete(session.id);
        dropAudio(session.id);
        publish();
      },
    },
  };

  sm = new SessionManager(settings.wssUrl, options);
  try {
    await sm.connect();
    s.setRegistration("registering");
    await sm.register();
  } catch (err) {
    s.setRegistration("failed");
    s.setError(errMsg(err));
    throw err;
  }
}

/** Unregister, disconnect, drop all lines. */
export async function stop(): Promise<void> {
  ringer.stop();
  ringMode = "none";
  lines.clear();
  [...audioEls.keys()].forEach(dropAudio);
  if (!sm) return;
  try {
    await sm.unregister();
    await sm.disconnect();
  } catch {
    /* best-effort teardown */
  }
  sm = null;
  usePhone.getState().reset();
}

// ---- call control ----------------------------------------------------------

function get(id: string): Session {
  const line = lines.get(id);
  if (!line) throw new Error("no such line");
  return line.session;
}

/** Hold every established foreground line except `exceptId` (one at a time). */
async function holdOthers(exceptId?: string): Promise<void> {
  if (!sm) return;
  await Promise.all(
    [...lines.values()]
      .filter((l) => l.session.id !== exceptId && l.view.state === "active")
      .map((l) => sm!.hold(l.session).catch(() => {})),
  );
}

/** Place an outbound call. Holds any current foreground line first. */
export async function call(target: string): Promise<void> {
  if (!sm) throw new Error("not connected");
  if (lines.size >= MAX_LINES) throw new Error("all lines in use");
  await holdOthers();
  try {
    await sm.call(`sip:${target}@${domain}`);
  } catch (err) {
    usePhone.getState().setError(errMsg(err));
    throw err;
  }
}

/** Answer an incoming line. Holds any current foreground line first. */
export async function answer(id: string): Promise<void> {
  if (!sm) return;
  ringer.stop();
  ringMode = "none";
  await holdOthers(id);
  await sm.answer(get(id));
}

/** Hang up / reject / cancel a line. */
export async function hangup(id: string): Promise<void> {
  await sm?.hangup(get(id));
}

/** Resume a held line, holding whichever line is currently in the foreground. */
export async function resume(id: string): Promise<void> {
  if (!sm) return;
  await holdOthers(id);
  await sm.unhold(get(id));
}

/** Toggle hold/resume for a line. */
export async function toggleHold(id: string): Promise<void> {
  if (!sm) return;
  if (lines.get(id)?.view.state === "held") await resume(id);
  else await sm.hold(get(id));
}

/** Toggle mute of the local mic for a line. */
export function toggleMute(id: string): void {
  if (!sm) return;
  const line = lines.get(id);
  if (!line) return;
  if (line.view.muted) sm.unmute(line.session);
  else sm.mute(line.session);
  line.view.muted = !line.view.muted;
  publish();
}

/** Send a DTMF digit on a line (with local tone feedback). */
export async function sendDtmf(id: string, key: string): Promise<void> {
  ringer.playDtmf(key);
  await sm?.sendDTMF(get(id), key);
}

/** Local DTMF feedback only (no signalling) — used while building a number. */
export function tone(key: string): void {
  ringer.playDtmf(key);
}

/** Blind transfer: REFER the line to a fresh target; the local leg then ends. */
export async function blindTransfer(id: string, target: string): Promise<void> {
  if (!sm) return;
  await sm.transfer(get(id), `sip:${target}@${domain}`);
}

/** Attended transfer: connect the original call to the consultation call via a
 * REFER-with-Replaces. `originalId` is the (held) call being transferred away;
 * `consultId` is the line you dialed and talked to. Both local legs end. */
export async function attendedTransfer(originalId: string, consultId: string): Promise<void> {
  if (!sm) return;
  await sm.transfer(get(originalId), get(consultId));
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
