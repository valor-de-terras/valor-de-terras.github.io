import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served from the org root page https://valor-de-terras.github.io/ -> base "/".
export default defineConfig({
  base: "/",
  plugins: [react()],
  build: {
    target: "es2020",
    sourcemap: false,
    chunkSizeWarningLimit: 1400,
  },
});
