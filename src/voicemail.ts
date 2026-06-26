// Voicemail mailbox for the logged-in operator, via the BFF (scoped to the
// caller's own extension). Metadata only — audio playback needs a server-side
// stream endpoint (not yet available).
import { bffUrl } from "./config";

export interface VmMessage {
  uuid: string;
  folder: string;
  cid_name: string;
  cid_number: string;
  created_epoch: number;
  read_epoch: number;
  message_len: number;
  read: boolean;
}

export interface VmBox {
  domain: string;
  number: string;
  total: number;
  unread: number;
  messages: VmMessage[];
}

export async function fetchVoicemail(token: string): Promise<VmBox> {
  const r = await fetch(`${bffUrl}/api/voicemail`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`voicemail failed (${r.status})`);
  return r.json();
}
