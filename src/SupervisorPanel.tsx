import { useEffect, useRef, useState } from "react";
import { currentUser } from "./auth";
import { streamEvents, type LiveEvent } from "./events";
import {
  AGENT_STATUSES,
  AGENTS_PAGE_SIZE,
  agentLabel,
  fetchAgents,
  setAgentStatus,
  type Agent,
} from "./agents";
import { fetchCalls, hangupCall, listenCall, parkCall, transferCall, type Channel } from "./calls";

// Live wallboard for supervisors/admins, fed by the BFF-proxied control-plane
// SSE stream. Event-driven: reflects activity from the moment it opens.
export function SupervisorPanel() {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [agents, setAgents] = useState<Record<string, string>>({}); // live status from SSE
  const [agentList, setAgentList] = useState<Agent[]>([]); // current page
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [active, setActive] = useState(0);
  const [err, setErr] = useState<string>();
  const [calls, setCalls] = useState<Channel[]>([]);
  const [xferUuid, setXferUuid] = useState<string | null>(null);
  const [xferTo, setXferTo] = useState("");
  const activeCalls = useRef<Set<string>>(new Set());

  async function refreshCalls() {
    const user = await currentUser();
    if (!user) return;
    try {
      setCalls(await fetchCalls(user.access_token));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function callAction(fn: (t: string, uuid: string) => Promise<void>, uuid: string) {
    const user = await currentUser();
    if (!user) return;
    try {
      await fn(user.access_token, uuid);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      void refreshCalls();
    }
  }

  async function doTransfer(uuid: string) {
    const user = await currentUser();
    if (!user) return;
    try {
      await transferCall(user.access_token, uuid, xferTo.trim());
      setXferUuid(null);
      setXferTo("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      void refreshCalls();
    }
  }

  async function refreshAgents(off = offset) {
    const user = await currentUser();
    if (!user) return;
    try {
      const page = await fetchAgents(user.access_token, AGENTS_PAGE_SIZE, off);
      setAgentList(page.agents);
      setTotal(page.total);
      setOffset(off);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function changeStatus(name: string, status: string) {
    const user = await currentUser();
    if (!user) return;
    try {
      await setAgentStatus(user.access_token, name, status);
      setAgents((a) => ({ ...a, [name]: status })); // optimistic; SSE confirms
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void refreshAgents();
    void refreshCalls();
    const poll = setInterval(() => void refreshCalls(), 3000); // channels aren't pushed
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
              void refreshCalls();
            } else if (e.type === "call.ended" && uuid) {
              activeCalls.current.delete(uuid);
              setActive(activeCalls.current.size);
              void refreshCalls();
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
    return () => {
      clearInterval(poll);
      ctrl.abort();
    };
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
          <div className="tile-n">{total}</div>
          <div className="tile-l">agents</div>
        </div>
      </div>

      <div className="calls">
        <div className="tile-l">live calls</div>
        {calls.length === 0 && <div className="muted">none</div>}
        {calls.map((c) => (
          <div key={c.uuid} className="call-row">
            <div className="call-line">
              <span className="call-parties">
                {(c.cid_num || "?") + " → " + (c.dest || c.callee_num || "?")}
              </span>
              <span className="badge">{c.callstate}</span>
              <span className="agent-ctl">
                <button
                  className="ministatus"
                  onClick={() => void callAction(listenCall, c.uuid)}
                  title="Listen in (covert)"
                >
                  Listen
                </button>
                <button className="ministatus" onClick={() => void callAction(hangupCall, c.uuid)}>
                  Hangup
                </button>
                <button className="ministatus" onClick={() => void callAction(parkCall, c.uuid)}>
                  Park
                </button>
                <button
                  className="ministatus"
                  onClick={() => {
                    setXferUuid((u) => (u === c.uuid ? null : c.uuid));
                    setXferTo("");
                  }}
                >
                  Transfer
                </button>
              </span>
            </div>
            {xferUuid === c.uuid && (
              <form
                className="dialer"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (xferTo) void doTransfer(c.uuid);
                }}
              >
                <input
                  placeholder="Transfer to, e.g. 4100"
                  value={xferTo}
                  onChange={(e) => setXferTo(e.target.value)}
                  inputMode="tel"
                  autoFocus
                />
                <button type="submit" disabled={!xferTo}>
                  Go
                </button>
              </form>
            )}
          </div>
        ))}
      </div>

      {agentList.length > 0 && (
        <div className="agents">
          {agentList.map((a) => {
            const status = agents[a.name] ?? a.status; // live status overrides configured
            return (
              <div key={a.name} className="agent-row">
                <span className="agent-name" title={a.name}>{agentLabel(a)}</span>
                <span className={`badge ${status === "Available" ? "ok" : ""}`}>{status}</span>
                <span className="agent-ctl">
                  {AGENT_STATUSES.map((s) => (
                    <button
                      key={s}
                      className="ministatus"
                      disabled={status === s}
                      onClick={() => void changeStatus(a.name, s)}
                      title={`Set ${s}`}
                    >
                      {s === "Available" ? "Avail" : s === "On Break" ? "Break" : "Logout"}
                    </button>
                  ))}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {total > AGENTS_PAGE_SIZE && (
        <div className="pager">
          <button
            className="secondary"
            disabled={offset === 0}
            onClick={() => void refreshAgents(Math.max(0, offset - AGENTS_PAGE_SIZE))}
          >
            ← Prev
          </button>
          <span className="muted">
            {offset + 1}–{Math.min(offset + AGENTS_PAGE_SIZE, total)} of {total}
          </span>
          <button
            className="secondary"
            disabled={offset + AGENTS_PAGE_SIZE >= total}
            onClick={() => void refreshAgents(offset + AGENTS_PAGE_SIZE)}
          >
            Next →
          </button>
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
