// Call tones generated with the Web Audio API (no audio assets to ship):
//   ringback — what the CALLER hears while the far end rings (US cadence)
//   ringtone — what the CALLEE hears on an incoming call
// The AudioContext must be (re)started from a user gesture (the Register/Call
// click), so call ensureAudio() from those handlers.

let ctx: AudioContext | null = null;
let cadenceTimer: number | null = null;
let active: { osc: OscillatorNode[]; gain: GainNode } | null = null;

export function ensureAudio(): void {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
}

function burst(freqs: number[], ms: number): void {
  if (!ctx) return;
  const gain = ctx.createGain();
  gain.gain.value = 0.12;
  gain.connect(ctx.destination);
  const osc = freqs.map((f) => {
    const o = ctx!.createOscillator();
    o.type = "sine";
    o.frequency.value = f;
    o.connect(gain);
    o.start();
    return o;
  });
  active = { osc, gain };
  window.setTimeout(() => {
    osc.forEach((o) => {
      try {
        o.stop();
      } catch {
        /* already stopped */
      }
    });
    gain.disconnect();
    if (active && active.gain === gain) active = null;
  }, ms);
}

function loop(freqs: number[], onMs: number, periodMs: number): void {
  const cycle = () => {
    burst(freqs, onMs);
    cadenceTimer = window.setTimeout(cycle, periodMs);
  };
  cycle();
}

/** Caller-side ringback: 440+480 Hz, 2 s on / 4 s off (US). */
export function startRingback(): void {
  stop();
  ensureAudio();
  loop([440, 480], 2000, 6000);
}

/** Callee-side incoming ring: 480+620 Hz, 1 s on / 2 s off. */
export function startRingtone(): void {
  stop();
  ensureAudio();
  loop([480, 620], 1000, 3000);
}

// DTMF (touch-tone) dual frequencies per key.
const DTMF: Record<string, [number, number]> = {
  "1": [697, 1209], "2": [697, 1336], "3": [697, 1477],
  "4": [770, 1209], "5": [770, 1336], "6": [770, 1477],
  "7": [852, 1209], "8": [852, 1336], "9": [852, 1477],
  "*": [941, 1209], "0": [941, 1336], "#": [941, 1477],
};

/** Play a short DTMF tone for local feedback (independent of ring cadence). */
export function playDtmf(key: string): void {
  const pair = DTMF[key];
  if (!pair) return;
  ensureAudio();
  if (!ctx) return;
  const gain = ctx.createGain();
  gain.gain.value = 0.15;
  gain.connect(ctx.destination);
  const osc = pair.map((f) => {
    const o = ctx!.createOscillator();
    o.type = "sine";
    o.frequency.value = f;
    o.connect(gain);
    o.start();
    return o;
  });
  window.setTimeout(() => {
    osc.forEach((o) => {
      try {
        o.stop();
      } catch {
        /* already stopped */
      }
    });
    gain.disconnect();
  }, 140);
}

export function stop(): void {
  if (cadenceTimer !== null) {
    window.clearTimeout(cadenceTimer);
    cadenceTimer = null;
  }
  if (active) {
    active.osc.forEach((o) => {
      try {
        o.stop();
      } catch {
        /* already stopped */
      }
    });
    active.gain.disconnect();
    active = null;
  }
}
