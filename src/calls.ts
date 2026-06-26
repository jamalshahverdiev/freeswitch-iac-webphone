// Supervisor call control: live channels + actions, via the BFF (role-gated).
import { bffUrl } from "./config";

export interface Channel {
  uuid: string;
  direction: string;
  created_epoch: string;
  name: string;
  state: string;
  cid_name: string;
  cid_num: string;
  dest: string;
  callstate: string;
  callee_num: string;
}

export async function fetchCalls(token: string): Promise<Channel[]> {
  const r = await fetch(`${bffUrl}/api/calls`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`calls failed (${r.status})`);
  return r.json();
}

async function act(token: string, path: string, body?: unknown): Promise<void> {
  const r = await fetch(`${bffUrl}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`action failed (${r.status})`);
}

export const hangupCall = (t: string, uuid: string) =>
  act(t, `/api/calls/${encodeURIComponent(uuid)}/hangup`);
export const parkCall = (t: string, uuid: string) =>
  act(t, `/api/calls/${encodeURIComponent(uuid)}/park`);
export const transferCall = (t: string, uuid: string, destination: string) =>
  act(t, `/api/calls/${encodeURIComponent(uuid)}/transfer`, { destination });
// Covert listen (spy): rings the supervisor's own phone into eavesdrop.
export const listenCall = (t: string, uuid: string) =>
  act(t, `/api/calls/${encodeURIComponent(uuid)}/listen`);
