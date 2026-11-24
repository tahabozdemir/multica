import { resolve } from "path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import type { Plugin } from "vite";
import { privacyModeFrom } from "./src/shared/privacy";
import { desktopContentSecurityPolicy, parseExtraOrigins } from "./src/shared/content-security-policy";

// Privacy builds ship a Content-Security-Policy in the renderer's HTML
// (src/shared/content-security-policy.ts). VITE_MULTICA_CSP_EXTRA_ORIGINS
// names non-local backends, e.g. a LAN server.
function privacyCspPlugin(): Plugin {
  return {
    name: "multica-privacy-csp",
    transformIndexHtml(html) {
      if (!privacyModeFrom(process.env.VITE_MULTICA_PRIVACY_MODE)) return html;
      const policy = desktopContentSecurityPolicy({
        extraOrigins: parseExtraOrigins(process.env.VITE_MULTICA_CSP_EXTRA_ORIGINS),
      });
      return html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`);
    },
  };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    // `@electron-toolkit/preload` must be bundled INTO the preload script:
    // the renderer windows run with `sandbox: true`, and a sandboxed preload's
    // `require` can only load `electron` plus a couple of node builtins — an
    // externalized `require("@electron-toolkit/preload")` would throw and
    // every contextBridge API would vanish. electron-vite emits preload as a
    // single CJS bundle, which is exactly what the sandbox requires.
    plugins: [externalizeDepsPlugin({ exclude: ["@electron-toolkit/preload"] })],
  },
  renderer: {
    server: {
      // Allow parallel worktrees to run `pnpm dev:desktop` side-by-side
      // (e.g. Multica Canary alongside a primary checkout) by overriding
      // the renderer port via env. Falls back to 5173 for the common case.
      port: Number(process.env.DESKTOP_RENDERER_PORT) || 5173,
      strictPort: true,
    },
    plugins: [react(), tailwindcss(), privacyCspPlugin()],
    resolve: {
      alias: {
        "@": resolve("src/renderer/src"),
      },
      dedupe: ["react", "react-dom", "@tanstack/react-query"],
    },
  },
});
