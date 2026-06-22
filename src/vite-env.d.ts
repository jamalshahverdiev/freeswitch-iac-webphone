/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WSS_URL?: string;
  readonly VITE_SIP_DOMAIN?: string;
  readonly VITE_DEFAULT_USER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
