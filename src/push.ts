// Web Push subscription: ask the BFF for the server VAPID public key, subscribe
// this browser via the service worker's PushManager, and register the
// subscription with the BFF (bound to the caller's extension). The control-plane
// then sends VAPID-signed pushes (e.g. on new voicemail) that the service
// worker shows even when the tab is closed.
import { bffUrl } from "./config";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// appServerKeyMatches reports whether an existing subscription was created with
// the given VAPID applicationServerKey (false → the server rotated keys).
function appServerKeyMatches(sub: PushSubscription, key: Uint8Array): boolean {
  const existing = sub.options.applicationServerKey;
  if (!existing) return false;
  const a = new Uint8Array(existing);
  if (a.length !== key.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== key[i]) return false;
  return true;
}

// enablePush wires up a push subscription. Safe to call repeatedly — it reuses
// an existing subscription. No-ops (returns false) when push isn't supported,
// permission isn't granted, or the server has push disabled.
export async function enablePush(token: string): Promise<boolean> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  if (!("Notification" in window) || Notification.permission !== "granted") return false;

  let vapid: string;
  try {
    const r = await fetch(`${bffUrl}/api/push/vapid`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return false; // 503 → push not configured server-side
    vapid = (await r.json()).public_key;
  } catch {
    return false;
  }
  if (!vapid) return false;

  const reg = await navigator.serviceWorker.ready;
  const appKey = urlBase64ToUint8Array(vapid);
  let sub = await reg.pushManager.getSubscription();
  // If an existing subscription was created with a different VAPID key (e.g. the
  // server rotated keys), it's permanently rejected by the push service — drop
  // it (server-side too) and re-subscribe against the current key.
  if (sub && !appServerKeyMatches(sub, appKey)) {
    try {
      await fetch(`${bffUrl}/api/push/subscribe`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
    } catch {
      /* best-effort prune */
    }
    await sub.unsubscribe();
    sub = null;
  }
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: appKey as unknown as BufferSource,
    });
  }

  const r = await fetch(`${bffUrl}/api/push/subscribe`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(sub.toJSON()),
  });
  return r.ok;
}
