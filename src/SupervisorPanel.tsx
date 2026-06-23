import { useEffect, useRef, useState } from "react";
import { currentUser } from "./auth";
import { streamEvents, type LiveEvent } from "./events";

// Live wallboard for supervisors/admins, fed by the BFF-proxied control-plane
// SSE stream. Event-driven: reflects activity from the moment it opens.
export function SupervisorPanel() {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [agents, setAgents] = useState<Record<string, string>>({});
  const [active, setActive] = useState(0);
  const [err, setErr] = useState<string>();
  const activeCalls = useRef<Set<string>>(new Set());

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        const user = await currentUser();
        if (!user) return;
        await streamEvents(
          user.access_token,
          (e) => {
            setEvents((prev) => [e, ...prev].slice(0, 40));
            const uuid = e.data.uuid;
            if (e.type === "call.started" && uuid) {
              activeCalls.current.add(uuid);
              setActive(activeCalls.current.size);
            } else if (e.type === "call.ended" && uuid) {
              activeCalls.current.delete(uuid);
              setActive(activeCalls.current.size);
            } else if (e.type === "agent.status" && e.data.agent) {
              setAgents((a) => ({ ...a, [e.data.agent]: e.data.status }));
            }
          },
          ctrl.signal,
        );
      } catch (e) {
        if (!ctrl.signal.aborted) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => ctrl.abort();
  }, []);

  return (
    <section className="card">
      <div className="sup-head">
        <strong>Supervisor</strong>
        <span className="muted">live wallboard</span>
      </div>

      <div className="tiles">
        <div className="tile">
          <div className="tile-n">{active}</div>
          <div className="tile-l">active calls</div>
        </div>
        <div className="tile">
          <div className="tile-n">{Object.keys(agents).length}</div>
          <div className="tile-l">agents seen</div>
        </div>
      </div>

      {Object.keys(agents).length > 0 && (
        <div className="agents">
          {Object.entries(agents).map(([name, status]) => (
            <div key={name} className="agent-row">
              <span>{name}</span>
              <span className={`badge ${status === "Available" ? "ok" : ""}`}>{status}</span>
            </div>
          ))}
        </div>
      )}

      <div className="evlog">
        {events.length === 0 && <div className="muted">Waiting for events…</div>}
        {events.map((e, i) => (
          <div key={i} className="evrow">
            <span className="evtype">{e.type}</span>
            <span className="evdata">{summarize(e)}</span>
          </div>
        ))}
      </div>

      {err && <p className="error">{err}</p>}
    </section>
  );
}

function summarize(e: LiveEvent): string {
  const d = e.data;
  switch (e.type) {
    case "call.started":
    case "call.answered":
      return `${d.caller ?? "?"} → ${d.destination ?? "?"}`;
    case "call.ended":
      return `${d.cause ?? ""}${d.billsec ? ` · ${d.billsec}s` : ""}`;
    case "agent.status":
      return `${d.agent} → ${d.status}`;
    case "queue.member":
      return `${d.queue ?? ""} ${d.action ?? ""}`;
    case "voicemail.mwi":
      return `${d.account ?? ""} new=${d.new ?? "0"}`;
    default:
      return Object.values(d).join(" ");
  }
}
