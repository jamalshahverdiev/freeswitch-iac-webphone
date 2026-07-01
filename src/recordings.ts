// Call recordings for the logged-in operator, via the BFF. Own recordings are
// scoped to the caller's extension; supervisors/admins can list all (QA).
import { bffUrl } from "./config";

export interface Recording {
  file: string;
  date: string; // YYYY-MM-DD the recording belongs to (for playback path)
  caller: string;
  dest: string;
  size: number;
  mtime: string;
  url: string;
}

export interface RecBox {
  from: string;
  to: string;
  recordings: Recording[];
}

// Fetch recordings for an inclusive date range (from..to). Supervisors/admins
// pass all=true to see everyone's; agents are scoped to their own extension.
export async function fetchRecordings(
  token: string,
  from: string,
  to: string,
  all = false,
): Promise<RecBox> {
  const path = all ? "/api/recordings/all" : "/api/recordings";
  const q = new URLSearchParams({ from, to });
  const r = await fetch(`${bffUrl}${path}?${q.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`recordings failed (${r.status})`);
  return r.json();
}

// Fetch one recording's audio with the bearer token → object URL for <audio>.
// Revoke it when done.
export async function fetchRecordingAudioUrl(
  token: string,
  date: string,
  file: string,
): Promise<string> {
  const r = await fetch(
    `${bffUrl}/api/recordings/${encodeURIComponent(date)}/${encodeURIComponent(file)}/audio`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!r.ok) throw new Error(`recording audio failed (${r.status})`);
  return URL.createObjectURL(await r.blob());
}
