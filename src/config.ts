// Connection settings. Defaults come from Vite env (.env); the user can override
// them at runtime in the settings form. Non-secret fields are persisted to
// localStorage; the SIP password is kept in memory only (never persisted) — it
// is re-entered each session until the Phase 1.5 auth (Keycloak/BFF) lands.

export interface Settings {
  wssUrl: string;
  domain: string;
  user: string;
}

const LS_KEY = "fswp.settings";

const env = import.meta.env;

export const defaultSettings: Settings = {
  wssUrl: env.VITE_WSS_URL ?? "wss://192.168.48.143:7443",
  domain: env.VITE_SIP_DOMAIN ?? "192.168.48.143",
  user: env.VITE_DEFAULT_USER ?? "4201",
};

// OIDC (Keycloak) + BFF endpoints for the sign-in flow.
export const oidcConfig = {
  authority: env.VITE_OIDC_AUTHORITY ?? "http://localhost:8081/realms/freeswitch",
  clientId: env.VITE_OIDC_CLIENT_ID ?? "webphone",
};
export const bffUrl = (env.VITE_BFF_URL ?? "http://localhost:8090").replace(/\/$/, "");

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return { ...defaultSettings, ...JSON.parse(raw) };
  } catch {
    /* ignore malformed storage */
  }
  return defaultSettings;
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(LS_KEY, JSON.stringify(s));
}
