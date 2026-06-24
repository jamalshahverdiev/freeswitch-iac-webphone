// Multi-line softphone built on sip.js SessionManager (the web multi-session
// layer underneath SimpleUser). It manages up to two concurrent calls — enough
// for consultative (attended) transfer: hold the first call, dial the transfer
// target on a second line, talk, then REFER-with-Replaces to connect them.
//
// SessionManager handles the media plumbing (per-session PeerConnection, remote
// stream attachment, hold/mute track toggling, DTMF, REFER) so we only track a
// light per-line view for the UI and drive the store from its delegate.

import { SessionManager, SessionManagerOptions, SessionDescriptionHandler } from "sip.js/lib/platform/web";
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

// One <video> pair per session, owned here and mounted into the DOM by the UI
// only for video lines (see getVideoEls). We always use a <video> as the remote
// sink — SessionManager attaches the full remote stream (audio + any video) to
// it and plays it even while detached, so audio-only calls work unmounted and a
// later mid-call video escalation renders without re-wiring the sink.
const videoEls = new Map<string, { local: HTMLVideoElement; remote: HTMLVideoElement }>();

function videoPairFor(session: Session): { local: HTMLVideoElement; remote: HTMLVideoElement } {
  let pair = videoEls.get(session.id);
  if (!pair) {
    const local = document.createElement("video");
    local.muted = true; // never echo our own mic
    local.autoplay = true;
    local.playsInline = true;
    const remote = document.createElement("video");
    remote.autoplay = true;
    remote.playsInline = true;
    pair = { local, remote };
    videoEls.set(session.id, pair);
  }
  return pair;
}

function dropMedia(id: string): void {
  const pair = videoEls.get(id);
  if (pair) {
    pair.local.srcObject = null;
    pair.remote.srcObject = null;
    videoEls.delete(id);
  }
}

function pcOf(session: Session): RTCPeerConnection | undefined {
  return (session.sessionDescriptionHandler as SessionDescriptionHandler | undefined)?.peerConnection;
}

function senderTrack(session: Session, kind: "audio" | "video"): MediaStreamTrack | undefined {
  return pcOf(session)
    ?.getSenders()
    .find((s) => s.track?.kind === kind)?.track ?? undefined;
}

// SessionManager.mute / hold toggle ALL sender tracks together, so after they
// run we must restore the camera to the user's chosen state (it isn't tracked
// by SessionManager). No-op on audio lines (no video sender).
function reassertCamera(line: Line): void {
  const v = senderTrack(line.session, "video");
  if (v) v.enabled = !line.view.cameraOff;
}

/** The <video> elements (local + remote) for a video line, for the UI to mount. */
export function getVideoEls(id: string): { local: HTMLVideoElement; remote: HTMLVideoElement } | undefined {
  return videoEls.get(id);
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
      // Default capture is audio-only; a video call/escalation overrides
      // constraints per call/answer/addVideo so plain calls never open a camera.
      constraints: { audio: true, video: false },
      local: (session) => ({ video: videoPairFor(session).local }),
      remote: (session) => ({ video: videoPairFor(session).remote }),
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
          view: { id: session.id, peer: peerOf(session), outgoing: true, state: "establishing", muted: false, video: false, cameraOff: false },
        });
        publish();
      },
      onCallReceived: (session) => {
        lines.set(session.id, {
          session,
          view: { id: session.id, peer: peerOf(session), outgoing: false, state: "ringing", muted: false, video: false, cameraOff: false },
        });
        publish();
      },
      onCallAnswered: (session) => setState(session.id, "active"),
      onCallHold: (session, held) => {
        setState(session.id, held ? "held" : "active");
        // unhold re-enables every sender track — restore the camera choice
        const l = lines.get(session.id);
        if (!held && l) reassertCamera(l);
      },
      onCallHangup: (session) => {
        lines.delete(session.id);
        dropMedia(session.id);
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
  [...videoEls.keys()].forEach(dropMedia);
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

// Re-INVITEs (hold/unhold) must not overlap on the same dialog — a second one
// sent before the first completes glares into a 491 Request Pending and leaves
// the line stuck. Serialize them per line so e.g. a quick Hold→Resume runs the
// unhold only after the hold settles.
const reinviteChain = new Map<string, Promise<void>>();
function serialize(id: string, fn: () => Promise<void>): Promise<void> {
  const prev = reinviteChain.get(id) ?? Promise.resolve();
  const run = prev.then(fn, fn); // run regardless of how the previous op settled
  reinviteChain.set(id, run.then(() => {}, () => {}));
  return run;
}

/** Hold every established foreground line except `exceptId` (one at a time). */
async function holdOthers(exceptId?: string): Promise<void> {
  if (!sm) return;
  await Promise.all(
    [...lines.values()]
      .filter((l) => l.session.id !== exceptId && l.view.state === "active")
      .map((l) => serialize(l.session.id, () => sm!.hold(l.session)).catch(() => {})),
  );
}

/** Place an outbound call (optionally with video). Holds the foreground line. */
export async function call(target: string, video = false): Promise<void> {
  if (!sm) throw new Error("not connected");
  if (lines.size >= MAX_LINES) throw new Error("all lines in use");
  await holdOthers();
  try {
    const inviter = await sm.call(`sip:${target}@${domain}`, undefined, {
      sessionDescriptionHandlerOptions: { constraints: { audio: true, video } },
    });
    if (video) markVideo(inviter.id);
  } catch (err) {
    usePhone.getState().setError(errMsg(err));
    throw err;
  }
}

/** Answer an incoming line (optionally with video). Holds the foreground line. */
export async function answer(id: string, video = false): Promise<void> {
  if (!sm) return;
  ringer.stop();
  ringMode = "none";
  await holdOthers(id);
  await sm.answer(get(id), {
    sessionDescriptionHandlerOptions: { constraints: { audio: true, video } },
  });
  if (video) markVideo(id);
}

function markVideo(id: string): void {
  const line = lines.get(id);
  if (line) {
    line.view.video = true;
    publish();
  }
}

/** Escalate an in-progress audio call to video: re-INVITE adding a camera
 * track. Serialized so it can't glare with a concurrent hold/unhold. */
export async function addVideo(id: string): Promise<void> {
  if (!sm) return;
  const session = get(id);
  await serialize(id, () =>
    session
      .invite({ sessionDescriptionHandlerOptions: { constraints: { audio: true, video: true } } })
      .then(() => {}),
  );
  markVideo(id);
}

/** Toggle the local camera track on a video line (off = far end sees a frozen
 * frame; no renegotiation). */
export function toggleCamera(id: string): void {
  const track = pcOf(get(id))
    ?.getSenders()
    .find((s) => s.track?.kind === "video")?.track;
  if (!track) return;
  track.enabled = !track.enabled;
  const line = lines.get(id);
  if (line) {
    line.view.cameraOff = !track.enabled;
    publish();
  }
}

/** Hang up / reject / cancel a line. */
export async function hangup(id: string): Promise<void> {
  await sm?.hangup(get(id));
}

/** Resume a held line, holding whichever line is currently in the foreground. */
export async function resume(id: string): Promise<void> {
  if (!sm) return;
  await holdOthers(id);
  await serialize(id, () => sm!.unhold(get(id)));
}

/** Toggle hold/resume for a line. The hold/unhold choice is made when the
 * (serialized) re-INVITE actually runs, so it reflects the settled state. */
export async function toggleHold(id: string): Promise<void> {
  if (!sm) return;
  if (lines.get(id)?.view.state === "held") {
    await resume(id);
  } else {
    await serialize(id, () => sm!.hold(get(id)));
  }
}

/** Toggle mute of the local mic for a line. */
export function toggleMute(id: string): void {
  if (!sm) return;
  const line = lines.get(id);
  if (!line) return;
  if (line.view.muted) sm.unmute(line.session);
  else sm.mute(line.session);
  line.view.muted = !line.view.muted;
  reassertCamera(line); // mute toggled every sender track — restore camera state
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
