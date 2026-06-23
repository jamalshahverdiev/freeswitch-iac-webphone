// OIDC (Authorization Code + PKCE) sign-in against Keycloak via oidc-client-ts.
import { UserManager, WebStorageStateStore, type User } from "oidc-client-ts";
import { oidcConfig } from "./config";

const redirect = window.location.origin + "/";

export const userManager = new UserManager({
  authority: oidcConfig.authority,
  client_id: oidcConfig.clientId,
  redirect_uri: redirect,
  post_logout_redirect_uri: redirect,
  response_type: "code", // PKCE is automatic for public clients
  scope: "openid profile",
  automaticSilentRenew: true,
  // persist the session across reloads
  userStore: new WebStorageStateStore({ store: window.localStorage }),
});

/** True when the current URL is an OIDC redirect callback (?code=&state=). */
export function isCallback(): boolean {
  const p = new URLSearchParams(window.location.search);
  return p.has("code") && p.has("state");
}

/** Complete a redirect callback and strip the params from the URL. The
 * authorization code is single-use, so guard against a double exchange (React
 * StrictMode mounts effects twice in dev, and reloads can re-enter): the code
 * is exchanged once and the same promise is reused. */
let callback: Promise<User | null> | null = null;
export function finishLogin(): Promise<User | null> {
  if (!callback) {
    callback = userManager.signinRedirectCallback().then((user) => {
      window.history.replaceState({}, document.title, redirect);
      return user;
    });
  }
  return callback;
}

export function login(): Promise<void> {
  return userManager.signinRedirect();
}

export function logout(): Promise<void> {
  return userManager.signoutRedirect();
}

export async function currentUser(): Promise<User | null> {
  const u = await userManager.getUser();
  return u && !u.expired ? u : null;
}
