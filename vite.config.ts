import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import type { Plugin } from "vite";

// Content Security Policy for production builds (dev needs inline scripts for hot reload).
const csp = (): Plugin => ({
  name: "rigmind-csp",
  apply: "build",
  transformIndexHtml: (html) =>
    html.replace(
      "<head>",
      `<head>\n    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'" />`
    ),
});

export default defineConfig({
  root: resolve(__dirname, "src/renderer"),
  base: "./",
  plugins: [react(), csp()],
  server: { port: 5173, strictPort: true },
  build: {
    outDir: resolve(__dirname, "dist/renderer"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "src/renderer/index.html"),
        overlay: resolve(__dirname, "src/renderer/overlay.html"),
        stress: resolve(__dirname, "src/renderer/stress.html"),
      },
    },
  },
});
