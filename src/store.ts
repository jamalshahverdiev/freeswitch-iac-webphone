import { create } from "zustand";

export type Registration =
  | "unregistered"
  | "connecting"
  | "registering"
  | "registered"
  | "failed";

// Per-line lifecycle. "establishing" = outgoing, ringing at the far end;
// "ringing" = incoming, not yet answered; "active" = connected, in foreground;
// "held" = connected but on hold (far end hears MOH).
export type LineState = "establishing" | "ringing" | "active" | "held";

export interface LineView {
  id: string; // sip.js Session.id
  peer: string; // remote extension
  outgoing: boolean;
  state: LineState;
  muted: boolean;
  video: boolean; // negotiated with a camera track (renders video tiles)
  cameraOff: boolean; // local camera track disabled while on a video line
  sharing: boolean; // local video sender is a screen capture instead of camera
}

interface PhoneState {
  connected: boolean;
  registration: Registration;
  lines: LineView[];
  error?: string;

  setConnected: (v: boolean) => void;
  setRegistration: (r: Registration) => void;
  setLines: (lines: LineView[]) => void;
  setError: (e?: string) => void;
  reset: () => void;
}

export const usePhone = create<PhoneState>((set) => ({
  connected: false,
  registration: "unregistered",
  lines: [],
  error: undefined,

  setConnected: (connected) => set({ connected }),
  setRegistration: (registration) => set({ registration }),
  setLines: (lines) => set({ lines }),
  setError: (error) => set({ error }),
  reset: () =>
    set({ connected: false, registration: "unregistered", lines: [], error: undefined }),
}));
