import { useEffect, useRef, useState } from "react";
import { loadSettings, saveSettings, type Settings } from "./config";
import { usePhone } from "./store";
import * as phone from "./sip/phone";

export function App() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [password, setPassword] = useState("");
  const [target, setTarget] = useState("");

  const { connected, registration, call, peer, muted, error } = usePhone();
  const registered = registration === "registered";
  const busy = call !== "idle";

  // Clean up the SIP session when the tab closes.
  useEffect(() => {
    return () => {
      void phone.stop();
    };
  }, []);

  async function onRegister(e: React.FormEvent) {
    e.preventDefault();
    saveSettings(settings); // persists non-secret fields only
    try {
      await phone.start(settings, password, audioRef.current!);
    } catch {
      /* error surfaced via store */
    }
  }

  return (
    <div className="app">
      <h1>FreeSWITCH Webphone</h1>
      <p className="sub">Phase 1 — register + audio call. SIP.js over WSS.</p>

      <section className="card">
        <div className="status">
          <span className={`dot ${registered ? "ok" : connected ? "warn" : "off"}`} />
          <strong>{labelFor(registration)}</strong>
          {connected && !registered && <span className="muted"> · socket up</span>}
        </div>

        <form className="settings" onSubmit={onRegister}>
          <label>
            WSS URL
            <input
              value={settings.wssUrl}
              onChange={(e) => setSettings({ ...settings, wssUrl: e.target.value })}
              disabled={registered}
              spellCheck={false}
            />
          </label>
          <div className="row">
            <label>
              Extension
              <input
                value={settings.user}
                onChange={(e) => setSettings({ ...settings, user: e.target.value })}
                disabled={registered}
              />
            </label>
            <label>
              Domain
              <input
                value={settings.domain}
                onChange={(e) => setSettings({ ...settings, domain: e.target.value })}
                disabled={registered}
              />
            </label>
          </div>
          <label>
            Password <span className="muted">(kept in memory only)</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={registered}
              autoComplete="off"
            />
          </label>

          {!registered ? (
            <button type="submit" disabled={!password || registration === "connecting"}>
              {registration === "connecting" || registration === "registering"
                ? "Connecting…"
                : "Register"}
            </button>
          ) : (
            <button type="button" className="secondary" onClick={() => void phone.stop()}>
              Disconnect
            </button>
          )}
        </form>
        {error && <p className="error">{error}</p>}
      </section>

      {registered && (
        <section className="card">
          {call === "idle" && (
            <>
              <form
                className="dialer"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (target) void phone.call(target.trim(), settings.domain);
                }}
              >
                <input
                  placeholder="Number to call, e.g. 4202"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  inputMode="tel"
                />
                <button type="submit" disabled={!target}>
                  Call
                </button>
              </form>
              <Dialpad
                onPress={(k) => {
                  phone.tone(k);
                  setTarget((t) => t + k);
                }}
              />
            </>
          )}

          {busy && (
            <div className="callbox">
              <div className="callstate">
                {call === "incoming" && "Incoming call…"}
                {call === "outgoing" && `Calling ${peer ?? ""}…`}
                {call === "active" && `In call${peer ? ` · ${peer}` : ""}`}
              </div>
              <div className="callbtns">
                {call === "incoming" && (
                  <button className="ok" onClick={() => void phone.answer()}>
                    Answer
                  </button>
                )}
                {call === "active" && (
                  <button className="secondary" onClick={() => phone.toggleMute()}>
                    {muted ? "Unmute" : "Mute"}
                  </button>
                )}
                <button className="danger" onClick={() => void phone.hangup()}>
                  {call === "incoming" ? "Reject" : "Hang up"}
                </button>
              </div>
              {call === "active" && <Dialpad onPress={(k) => void phone.sendDtmf(k)} />}
            </div>
          )}
        </section>
      )}

      {/* SimpleUser attaches the remote stream here */}
      <audio ref={audioRef} autoPlay />
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

function labelFor(r: string): string {
  switch (r) {
    case "registered":
      return "Registered";
    case "registering":
      return "Registering…";
    case "connecting":
      return "Connecting…";
    case "failed":
      return "Failed";
    default:
      return "Not registered";
  }
}
