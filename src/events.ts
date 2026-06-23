// Read the BFF SSE stream via fetch (EventSource can't set the Authorization
// header). Parses `event:/data:` frames and calls onEvent for each.
import { bffUrl } from "./config";

export interface LiveEvent {
  type: string;
  ts: number;
  data: Record<string, string>;
}

export async function streamEvents(
  token: string,
  onEvent: (e: LiveEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const resp = await fetch(`${bffUrl}/api/events`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  if (!resp.ok || !resp.body) throw new Error(`events stream: ${resp.status}`);

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!dataLine) continue; // heartbeat (": ping") or comment
      try {
        onEvent(JSON.parse(dataLine.slice(5).trim()) as LiveEvent);
      } catch {
        /* ignore malformed frame */
      }
    }
  }
}
