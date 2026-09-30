import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Im Dev-Modus leitet Vite /api an den Node-Server weiter.
export default defineConfig({
  plugins: [react()],
  // MUI macht das Bundle ~0,5 MB groß – für eine lokal ausgelieferte App egal.
  build: { chunkSizeWarningLimit: 1000 },
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:3000" },
  },
});
