// Supervisor agent control via the BFF (role-gated server-side).
import { bffUrl } from "./config";

export interface Agent {
  name: string; // raw mod_callcenter id, e.g. 4201@192.168.48.143
  extension: string;
  domain: string;
  display_name: string;
  status: string;
  contact?: string;
}

export interface AgentsPage {
  agents: Agent[];
  total: number;
}

export async function fetchAgents(token: string, limit: number, offset: number): Promise<AgentsPage> {
  const r = await fetch(`${bffUrl}/api/agents?limit=${limit}&offset=${offset}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`agents: ${r.status}`);
  return r.json();
}

export async function setAgentStatus(token: string, name: string, status: string): Promise<void> {
  const r = await fetch(`${bffUrl}/api/agents/${encodeURIComponent(name)}/status`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!r.ok) {
    const b = await r.json().catch(() => ({}));
    throw new Error(b.error || `set status: ${r.status}`);
  }
}

/** Human label for an agent: "Display Name - 4201@domain", or just the id. */
export function agentLabel(a: Agent): string {
  return a.display_name ? `${a.display_name} - ${a.name}` : a.name;
}

export const AGENT_STATUSES = ["Available", "On Break", "Logged Out"];
export const AGENTS_PAGE_SIZE = 20;
