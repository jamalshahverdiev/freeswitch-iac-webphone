// Fetch the SIP session from the BFF using the Keycloak access token.
import { bffUrl } from "./config";

export interface Session {
  user: string;
  subject: string;
  roles: string[];
  sip: {
    wss_url: string;
    domain: string;
    extension: string;
    password: string;
  };
}

export async function fetchSession(accessToken: string): Promise<Session> {
  const resp = await fetch(`${bffUrl}/api/session`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.error || `BFF /api/session returned ${resp.status}`);
  }
  return resp.json();
}
