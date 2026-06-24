// Media device (microphone / camera) enumeration and persisted selection.
// Device labels are only exposed by the browser once getUserMedia permission has
// been granted for that kind, so labels may be blank until the first call (or
// until revealLabels() is called).

export interface DevicePrefs {
  micId?: string;
  camId?: string;
}

const LS_KEY = "fswp.devices";

export function loadDevicePrefs(): DevicePrefs {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw) as DevicePrefs;
  } catch {
    /* ignore malformed storage */
  }
  return {};
}

export function saveDevicePrefs(p: DevicePrefs): void {
  localStorage.setItem(LS_KEY, JSON.stringify(p));
}

export interface DeviceList {
  mics: MediaDeviceInfo[];
  cams: MediaDeviceInfo[];
}

export async function listDevices(): Promise<DeviceList> {
  const all = await navigator.mediaDevices.enumerateDevices();
  return {
    mics: all.filter((d) => d.kind === "audioinput"),
    cams: all.filter((d) => d.kind === "videoinput"),
  };
}

/** Briefly open mic+camera to unlock device labels, then release the tracks. */
export async function revealLabels(): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
  stream.getTracks().forEach((t) => t.stop());
}
