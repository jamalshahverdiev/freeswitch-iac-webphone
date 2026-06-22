import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// getUserMedia + WebSocket work in a secure context; http://localhost counts as
// secure, so no HTTPS dev server is needed for local development. The browser
// must, however, trust the FreeSWITCH WSS certificate (import deploy/tls/ca.crt
// or visit https://<fs-host>:7443 once to accept it).
export default defineConfig({
  plugins: [react()],
  server: { host: true, port: 5173 },
});
