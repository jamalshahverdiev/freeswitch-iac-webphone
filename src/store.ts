import { create } from "zustand";

export type Registration =
  | "unregistered"
  | "connecting"
  | "registering"
  | "registered"
  | "failed";

export type CallState = "idle" | "incoming" | "outgoing" | "active";

interface PhoneState {
  connected: boolean;
  registration: Registration;
  call: CallState;
  peer?: string; // remote party (when known)
  muted: boolean;
  held: boolean;
  error?: string;

  setConnected: (v: boolean) => void;
  setRegistration: (r: Registration) => void;
  setCall: (c: CallState, peer?: string) => void;
  setMuted: (v: boolean) => void;
  setHeld: (v: boolean) => void;
  setError: (e?: string) => void;
  reset: () => void;
}

export const usePhone = create<PhoneState>((set) => ({
  connected: false,
  registration: "unregistered",
  call: "idle",
  peer: undefined,
  muted: false,
  held: false,
  error: undefined,

  setConnected: (connected) => set({ connected }),
  setRegistration: (registration) => set({ registration }),
  // a state transition always starts unmuted/unheld (toggles flip during a call)
  setCall: (call, peer) =>
    set({ call, peer: call === "idle" ? undefined : peer, muted: false, held: false }),
  setMuted: (muted) => set({ muted }),
  setHeld: (held) => set({ held }),
  setError: (error) => set({ error }),
  reset: () =>
    set({ connected: false, registration: "unregistered", call: "idle", peer: undefined, muted: false, held: false }),
}));
