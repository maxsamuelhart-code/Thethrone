import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  worker: { format: "es" },
  server: {
    // `npm run dev:api` serves the Worker on 8787; the app talks to it same-origin via this proxy.
    proxy: { "/api": "http://localhost:8787" },
  },
  build: { target: "es2022" },
});
