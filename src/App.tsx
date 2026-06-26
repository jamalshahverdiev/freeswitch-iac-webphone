import { useEffect, useRef, useState } from "react";
import { loadSettings, saveSettings, type Settings } from "./config";
import { usePhone, type LineView } from "./store";
import * as phone from "./sip/phone";
import { MAX_LINES } from "./sip/phone";
import { currentUser, finishLogin, isCallback, login, logout } from "./auth";
import { fetchSession } from "./session";
import { SupervisorPanel } from "./SupervisorPanel";
import {
  listDevices,
  loadDevicePrefs,
  revealLabels,
  saveDevicePrefs,
  type DevicePrefs,
} from "./devices";
import { fetchCdr, type CdrRow } from "./cdr";
import {
  fetchVoicemail,
  fetchVoicemailAudioUrl,
  markVoicemailRead,
  type VmMessage,
} from "./voicemail";

type AuthStatus = "loading" | "anon" | "in";

export function App() {
  const [authStatus, setAuthStatus] = useState<AuthStatus>("loading");
  const [authUser, setAuthUser] = useState("");
  const [roles, setRoles] = useState<string[]>([]);
  const [myAddr, setMyAddr] = useState(""); // extension@domain from the session
  const [authErr, setAuthErr] = useState<string>();

  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [password, setPassword] = useState("");

  const { connected, registration, error } = usePhone();
  const registered = registration === "registered";
  // Widen the phone-narrow layout while a video call is up, so the remote feed
  // (especially a shared screen) has room.
  const hasVideo = usePhone((s) => s.lines.some((l) => l.video));

  // Bootstrap: handle the OIDC callback, then auto-register from the BFF session.
  useEffect(() => {
    // apply persisted device selection before any call is placed
    const prefs = loadDevicePrefs();
    phone.setDevices(prefs.micId, prefs.camId);
    (async () => {
      try {
        if (isCallback()) await finishLogin();
        const user = await currentUser();
        if (user) {
          await startFromSession(user.access_token);
          setAuthStatus("in");
        } else {
          setAuthStatus("anon");
        }
      } catch (e) {
        setAuthErr(e instanceof Error ? e.message : String(e));
        setAuthStatus("anon");
      }
    })();
    return () => void phone.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startFromSession(accessToken: string) {
    const s = await fetchSession(accessToken);
    setAuthUser(s.user);
    setRoles(s.roles);
    setMyAddr(`${s.sip.extension}@${s.sip.domain}`);
    await phone.start(
      { wssUrl: s.sip.wss_url, domain: s.sip.domain, user: s.sip.extension },
      s.sip.password,
    );
  }

  async function onManualRegister(e: React.FormEvent) {
    e.preventDefault();
    saveSettings(settings);
    try {
      await phone.start(settings, password);
    } catch {
      /* surfaced via store */
    }
  }

  return (
    <div className={hasVideo ? "app wide" : "app"}>
      <h1>FreeSWITCH Webphone</h1>
      <p className="sub">SIP.js over WSS · Keycloak sign-in.</p>

      {/* ---- Identity ---- */}
      <section className="card">
        {authStatus === "loading" && <div className="muted">Loading…</div>}

        {authStatus === "anon" && (
          <div className="signin">
            <button onClick={() => void login()}>Sign in with Keycloak</button>
            {authErr && <p className="error">{authErr}</p>}
          </div>
        )}

        {authStatus === "in" && (
          <div className="whoami">
            <div>
              <strong>{authUser}</strong>
              {myAddr && <span className="muted"> · {myAddr}</span>}
              <span className="roles">
                {roles
                  .filter((r) => ["agent", "supervisor", "admin"].includes(r))
                  .map((r) => (
                    <span key={r} className="chip">
                      {r}
                    </span>
                  ))}
              </span>
            </div>
            <button className="secondary" onClick={() => void logout()}>
              Sign out
            </button>
          </div>
        )}

        {authStatus === "in" && (
          <div className="status">
            <span className={`dot ${registered ? "ok" : connected ? "warn" : "off"}`} />
            <span>{labelFor(registration)}</span>
          </div>
        )}
        {error && <p className="error">{error}</p>}
      </section>

      {/* ---- Supervisor wallboard (role-gated) ---- */}
      {authStatus === "in" && (roles.includes("supervisor") || roles.includes("admin")) && (
        <SupervisorPanel />
      )}

      {/* ---- Call UI (when registered) ---- */}
      {registered && <CallPanel />}

      {/* ---- Call history (OIDC session only — needs the BFF) ---- */}
      {authStatus === "in" && registered && <HistoryPanel myExt={myAddr.split("@")[0]} />}

      {/* ---- Voicemail (OIDC session only) ---- */}
      {authStatus === "in" && registered && <VoicemailPanel />}

      {/* ---- Device selection ---- */}
      {registered && <DevicePicker />}

      {/* ---- Advanced: manual / bring-your-own-PBX (no Keycloak) ---- */}
      {!registered && (
        <details className="card advanced">
          <summary>Advanced — connect manually (bring your own PBX)</summary>
          <form className="settings" onSubmit={onManualRegister}>
            <label>
              WSS URL
              <input
                value={settings.wssUrl}
                onChange={(e) => setSettings({ ...settings, wssUrl: e.target.value })}
                spellCheck={false}
              />
            </label>
            <div className="row">
              <label>
                Extension
                <input
                  value={settings.user}
                  onChange={(e) => setSettings({ ...settings, user: e.target.value })}
                />
              </label>
              <label>
                Domain
                <input
                  value={settings.domain}
                  onChange={(e) => setSettings({ ...settings, domain: e.target.value })}
                />
              </label>
            </div>
            <label>
              Password <span className="muted">(kept in memory only)</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="off"
              />
            </label>
            <button type="submit" disabled={!password || registration === "connecting"}>
              {registration === "connecting" || registration === "registering"
                ? "Connecting…"
                : "Register"}
            </button>
          </form>
        </details>
      )}
    </div>
  );
}

/** Up to two lines, with per-line controls and blind / attended transfer. */
function CallPanel() {
  const lines = usePhone((s) => s.lines);

  const [dial, setDial] = useState("");
  const [withVideo, setWithVideo] = useState(false);
  const [conf, setConf] = useState("3500");
  const [xferMenuFor, setXferMenuFor] = useState<string | null>(null);
  const [blindFor, setBlindFor] = useState<string | null>(null);
  const [blindTo, setBlindTo] = useState("");
  // The line being transferred away during a consultative (attended) transfer.
  const [xferOriginId, setXferOriginId] = useState<string | null>(null);

  // Drop the attended-transfer origin once that line is gone (transferred/hung up).
  useEffect(() => {
    if (xferOriginId && !lines.some((l) => l.id === xferOriginId)) setXferOriginId(null);
  }, [lines, xferOriginId]);

  const canAddLine = lines.length < MAX_LINES;
  const consultingFor = xferOriginId ? lines.find((l) => l.id === xferOriginId) : undefined;
  // The far end we'd transfer the held call to: the other line, once connected.
  const consultLine = xferOriginId
    ? lines.find((l) => l.id !== xferOriginId && l.state === "active")
    : undefined;

  function startAttended(id: string) {
    setXferMenuFor(null);
    setXferOriginId(id);
    const line = lines.find((l) => l.id === id);
    if (line?.state === "active") void phone.toggleHold(id); // park the caller on MOH
  }

  return (
    <section className="card">
      {lines.length === 0 && <p className="muted">No active calls.</p>}

      {lines.map((line) => (
        <div className="callbox" key={line.id}>
          <div className="callstate">
            {stateLabel(line)} {line.muted && <span className="chip">muted</span>}
            {xferOriginId === line.id && <span className="chip">transferring…</span>}
          </div>

          {line.video && (line.state === "active" || line.state === "held") && (
            <VideoTile lineId={line.id} active={line.state === "active"} />
          )}

          <div className="callbtns">
            {line.state === "ringing" && (
              <>
                <button className="ok" onClick={() => void phone.answer(line.id)}>
                  Answer
                </button>
                <button className="ok" onClick={() => void phone.answer(line.id, true)}>
                  Answer (video)
                </button>
              </>
            )}
            {line.state === "active" && (
              <>
                <button className="secondary" onClick={() => phone.toggleMute(line.id)}>
                  {line.muted ? "Unmute" : "Mute"}
                </button>
                <button className="secondary" onClick={() => void phone.toggleHold(line.id)}>
                  Hold
                </button>
                {line.video && (
                  <>
                    <button className="secondary" onClick={() => phone.toggleCamera(line.id)}>
                      {line.cameraOff ? "Camera on" : "Camera off"}
                    </button>
                    <button
                      className="secondary"
                      onClick={() =>
                        void (line.sharing ? phone.stopShare(line.id) : phone.shareScreen(line.id))
                      }
                    >
                      {line.sharing ? "Stop sharing" : "Share screen"}
                    </button>
                  </>
                )}
                <button
                  className="secondary"
                  onClick={() => setXferMenuFor((v) => (v === line.id ? null : line.id))}
                >
                  Transfer
                </button>
              </>
            )}
            {line.state === "held" && (
              <button className="secondary" onClick={() => void phone.resume(line.id)}>
                Resume
              </button>
            )}
            <button className="danger" onClick={() => void phone.hangup(line.id)}>
              {line.state === "ringing" ? "Reject" : line.state === "establishing" ? "Cancel" : "Hang up"}
            </button>
          </div>

          {/* Transfer mode chooser */}
          {xferMenuFor === line.id && (
            <div className="callbtns">
              <button
                className="secondary"
                onClick={() => {
                  setBlindFor(line.id);
                  setBlindTo("");
                  setXferMenuFor(null);
                }}
              >
                Blind
              </button>
              <button
                className="secondary"
                onClick={() => startAttended(line.id)}
                disabled={!canAddLine}
                title={canAddLine ? "" : "Both lines are in use"}
              >
                Attended
              </button>
            </div>
          )}

          {/* Blind transfer target */}
          {blindFor === line.id && (
            <form
              className="dialer"
              onSubmit={(e) => {
                e.preventDefault();
                if (blindTo) {
                  void phone.blindTransfer(line.id, blindTo.trim());
                  setBlindFor(null);
                  setBlindTo("");
                }
              }}
            >
              <input
                placeholder="Blind transfer to, e.g. 4100"
                value={blindTo}
                onChange={(e) => setBlindTo(e.target.value)}
                inputMode="tel"
                autoFocus
              />
              <button type="submit" disabled={!blindTo}>
                Go
              </button>
            </form>
          )}

          {/* DTMF keypad for the connected line */}
          {line.state === "active" && (
            <Dialpad onPress={(k) => void phone.sendDtmf(line.id, k)} />
          )}
        </div>
      ))}

      {/* Complete an attended transfer once the consultation call is up */}
      {consultingFor && consultLine && (
        <div className="callbox">
          <div className="callstate">
            Transfer {consultingFor.peer} → {consultLine.peer}?
          </div>
          <div className="callbtns">
            <button
              className="ok"
              onClick={() => void phone.attendedTransfer(consultingFor.id, consultLine.id)}
            >
              Complete transfer
            </button>
            <button className="secondary" onClick={() => setXferOriginId(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* New call / consultation dialer */}
      {canAddLine && (
        <>
          {consultingFor && (
            <p className="muted">
              Consultation call (will transfer {consultingFor.peer} to this number):
            </p>
          )}
          <form
            className="dialer"
            onSubmit={(e) => {
              e.preventDefault();
              if (dial) {
                void phone.call(dial.trim(), withVideo);
                setDial("");
              }
            }}
          >
            <input
              placeholder="Number to call, e.g. 4202"
              value={dial}
              onChange={(e) => setDial(e.target.value)}
              inputMode="tel"
            />
            <button type="submit" disabled={!dial}>
              {withVideo ? "Video call" : "Call"}
            </button>
          </form>
          <label className="videotoggle">
            <input
              type="checkbox"
              checked={withVideo}
              onChange={(e) => setWithVideo(e.target.checked)}
            />
            Video
          </label>
          <Dialpad
            onPress={(k) => {
              phone.tone(k);
              setDial((t) => t + k);
            }}
          />
          {!consultingFor && (
            <>
              <p className="muted confhint">Join a video conference room:</p>
              <form
                className="dialer"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (conf) void phone.call(conf.trim(), true);
                }}
              >
                <input
                  placeholder="Conference room, e.g. 3500"
                  value={conf}
                  onChange={(e) => setConf(e.target.value)}
                  inputMode="tel"
                />
                <button type="submit" disabled={!conf}>
                  Join with video
                </button>
              </form>
            </>
          )}
        </>
      )}
    </section>
  );
}

/** Recent calls for the logged-in operator (own extension, served by the BFF).
 * Each row is click-to-call-back. */
function HistoryPanel({ myExt }: { myExt: string }) {
  const [rows, setRows] = useState<CdrRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string>();

  async function load() {
    setLoading(true);
    setErr(undefined);
    try {
      const user = await currentUser();
      if (!user) return;
      const { cdrs } = await fetchCdr(user.access_token, 50);
      setRows(cdrs ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <details className="card history">
      <summary>Call history</summary>
      <div className="hist-head">
        <button className="secondary" onClick={() => void load()} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>
      {err && <p className="error">{err}</p>}
      {!loading && rows.length === 0 && !err && <p className="muted">No calls yet.</p>}
      <ul className="histlist">
        {rows.map((c) => {
          const outbound = c.caller_id_number === myExt;
          const peer = (outbound ? c.destination_number : c.caller_id_number) || "?";
          const missed = !outbound && c.answer_epoch === 0;
          return (
            <li key={c.id} className="histrow">
              <span className={`dir ${outbound ? "out" : missed ? "missed" : "in"}`}>
                {outbound ? "↗" : "↙"}
              </span>
              <button className="histpeer" onClick={() => void phone.call(peer)} title="Call back">
                {peer}
              </button>
              <span className="histtime">{fmtTime(c.start_epoch)}</span>
              <span className="histdur">{missed ? "missed" : fmtDur(c.billsec)}</span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/** The logged-in operator's voicemail mailbox (metadata + MWI counts), with
 * per-message playback (audio streamed via the BFF). */
function VoicemailPanel() {
  const [msgs, setMsgs] = useState<VmMessage[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string>();
  const [playing, setPlaying] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const urlRef = useRef<string | null>(null);

  async function load() {
    setLoading(true);
    setErr(undefined);
    try {
      const user = await currentUser();
      if (!user) return;
      const box = await fetchVoicemail(user.access_token);
      setMsgs(box.messages ?? []);
      setUnread(box.unread ?? 0);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function play(uuid: string) {
    setErr(undefined);
    try {
      const user = await currentUser();
      if (!user) return;
      const url = await fetchVoicemailAudioUrl(user.access_token, uuid);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = url;
      setPlaying(uuid);
      const el = audioRef.current;
      if (el) {
        el.src = url;
        void el.play();
      }
      // Listening marks it read: update the row + unread count now, persist async.
      const wasUnread = msgs.some((m) => m.uuid === uuid && !m.read);
      if (wasUnread) {
        setMsgs((prev) => prev.map((m) => (m.uuid === uuid ? { ...m, read: true } : m)));
        setUnread((u) => Math.max(0, u - 1));
        void markVoicemailRead(user.access_token, uuid).catch(() => {});
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void load();
    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <details className="card history">
      <summary>
        Voicemail{unread > 0 && <span className="chip vm-new">{unread} new</span>}
      </summary>
      <div className="hist-head">
        <button className="secondary" onClick={() => void load()} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>
      {err && <p className="error">{err}</p>}
      <audio
        ref={audioRef}
        controls
        className="vm-player"
        style={{ display: playing ? "block" : "none" }}
      />
      {!loading && msgs.length === 0 && !err && <p className="muted">No messages.</p>}
      <ul className="histlist">
        {msgs.map((m) => (
          <li key={m.uuid} className={`histrow ${playing === m.uuid ? "vm-active" : ""}`}>
            <button className="vm-play" onClick={() => void play(m.uuid)} title="Play">
              ▶
            </button>
            <span className="histpeer">{m.cid_name || m.cid_number || "Unknown"}</span>
            {!m.read && <span className="chip vm-new">new</span>}
            <span className="histtime">{fmtTime(m.created_epoch)}</span>
            <span className="histdur">{fmtDur(m.message_len)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function fmtTime(epoch: number): string {
  if (!epoch) return "";
  return new Date(epoch * 1000).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDur(sec: number): string {
  if (!sec) return "0:00";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Pick the capture microphone / camera. Selection persists and is applied live
 * to any connected call (and to future calls) via phone.setDevices/applyDevices. */
function DevicePicker() {
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [prefs, setPrefs] = useState<DevicePrefs>(loadDevicePrefs);
  const needLabels = [...mics, ...cams].some((d) => !d.label);

  async function refresh() {
    const list = await listDevices();
    setMics(list.mics);
    setCams(list.cams);
  }

  useEffect(() => {
    void refresh();
    const onChange = () => void refresh();
    navigator.mediaDevices.addEventListener("devicechange", onChange);
    return () => navigator.mediaDevices.removeEventListener("devicechange", onChange);
  }, []);

  function update(next: DevicePrefs) {
    setPrefs(next);
    saveDevicePrefs(next);
    phone.setDevices(next.micId, next.camId);
    void phone.applyDevices();
  }

  return (
    <details className="card devices">
      <summary>Devices</summary>
      <label>
        Microphone
        <select
          value={prefs.micId ?? ""}
          onChange={(e) => update({ ...prefs, micId: e.target.value || undefined })}
        >
          <option value="">Default</option>
          {mics.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Microphone ${i + 1}`}
            </option>
          ))}
        </select>
      </label>
      <label>
        Camera
        <select
          value={prefs.camId ?? ""}
          onChange={(e) => update({ ...prefs, camId: e.target.value || undefined })}
        >
          <option value="">Default</option>
          {cams.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Camera ${i + 1}`}
            </option>
          ))}
        </select>
      </label>
      {needLabels && (
        <button className="secondary" onClick={() => void revealLabels().then(refresh)}>
          Show device names
        </button>
      )}
    </details>
  );
}

/** Mounts the line's phone-owned <video> elements (remote + local PiP) into the
 * DOM. SessionManager attaches/cleans the media streams; we just place them. */
function VideoTile({ lineId, active }: { lineId: string; active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const els = phone.getVideoEls(lineId);
    const node = ref.current;
    if (!els || !node) return;
    els.remote.className = "video-remote";
    els.local.className = "video-local";
    node.appendChild(els.remote);
    node.appendChild(els.local);
    return () => {
      if (els.remote.parentNode === node) node.removeChild(els.remote);
      if (els.local.parentNode === node) node.removeChild(els.local);
    };
    // re-mount once the line connects (elements exist only after media setup)
  }, [lineId, active]);

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void ref.current?.requestFullscreen?.();
  }

  return (
    <div className="videowrap">
      {/* the phone-owned <video> nodes are appended into this div imperatively */}
      <div className="videos" ref={ref} onDoubleClick={toggleFullscreen} />
      <button className="secondary fs-btn" onClick={toggleFullscreen}>
        ⛶ Fullscreen
      </button>
    </div>
  );
}

const DIALPAD_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

function Dialpad({ onPress }: { onPress: (key: string) => void }) {
  return (
    <div className="dialpad">
      {DIALPAD_KEYS.map((k) => (
        <button type="button" key={k} className="key" onClick={() => onPress(k)}>
          {k}
        </button>
      ))}
    </div>
  );
}

function stateLabel(line: LineView): string {
  switch (line.state) {
    case "ringing":
      return `Incoming · ${line.peer}`;
    case "establishing":
      return `Calling ${line.peer}…`;
    case "active":
      return `In call · ${line.peer}`;
    case "held":
      return `On hold · ${line.peer}`;
  }
}

function labelFor(r: string): string {
  switch (r) {
    case "registered":
      return "Registered";
    case "registering":
      return "Registering…";
    case "connecting":
      return "Connecting…";
    case "failed":
      return "Registration failed";
    default:
      return "Not registered";
  }
}
