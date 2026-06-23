/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WSS_URL?: string;
  readonly VITE_SIP_DOMAIN?: string;
  readonly VITE_DEFAULT_USER?: string;
  readonly VITE_OIDC_AUTHORITY?: string;
  readonly VITE_OIDC_CLIENT_ID?: string;
  readonly VITE_BFF_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
