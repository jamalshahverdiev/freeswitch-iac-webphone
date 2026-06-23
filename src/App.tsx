import { useEffect, useRef, useState } from "react";
import { loadSettings, saveSettings, type Settings } from "./config";
import { usePhone } from "./store";
import * as phone from "./sip/phone";
import { currentUser, finishLogin, isCallback, login, logout } from "./auth";
import { fetchSession } from "./session";
import { SupervisorPanel } from "./SupervisorPanel";

type AuthStatus = "loading" | "anon" | "in";

export function App() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus>("loading");
  const [authUser, setAuthUser] = useState("");
  const [roles, setRoles] = useState<string[]>([]);
  const [myAddr, setMyAddr] = useState(""); // extension@domain from the session
  const [authErr, setAuthErr] = useState<string>();

  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [password, setPassword] = useState("");
  const [target, setTarget] = useState("");

  const { connected, registration, call, peer, muted, error } = usePhone();
  const registered = registration === "registered";
  const busy = call !== "idle";

  // Bootstrap: handle the OIDC callback, then auto-register from the BFF session.
  useEffect(() => {
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
      audioRef.current!,
    );
  }

  async function onManualRegister(e: React.FormEvent) {
    e.preventDefault();
    saveSettings(settings);
    try {
      await phone.start(settings, password, audioRef.current!);
    } catch {
      /* surfaced via store */
    }
  }

  return (
    <div className="app">
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
      return "Registration failed";
    default:
      return "Not registered";
  }
}
