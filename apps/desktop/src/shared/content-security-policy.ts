/**
 * Content-Security-Policy for the desktop renderer in a privacy build.
 *
 * It limits where the renderer may fetch from, not what it may run: inline
 * script and eval stay allowed, but images, media, fonts, fetch/XHR,
 * WebSockets, frames, and workers may only come from the app bundle and a
 * backend on this machine (plus any origins named at build time). A remote
 * image in a comment, a Composio logo, or a Google avatar URL is refused
 * before any request leaves the machine, and a misconfigured
 * desktop.json pointing at a remote host cannot be reached either.
 */
// CSP host-sources cannot name an IPv6 literal, so [::1] is reached through
// "localhost" (Chromium rejects http://[::1]:* as an invalid source).
const LOCAL_ORIGINS = ["http://localhost:*", "http://127.0.0.1:*"];
const LOCAL_WS_ORIGINS = ["ws://localhost:*", "ws://127.0.0.1:*"];

export function desktopContentSecurityPolicy(options: { extraOrigins?: readonly string[] } = {}): string {
  const extra = (options.extraOrigins ?? []).filter(Boolean);
  const extraWs = extra.flatMap((origin) =>
    origin.startsWith("https://") ? [`wss://${origin.slice(8)}`] : origin.startsWith("http://") ? [`ws://${origin.slice(7)}`] : [],
  );
  const backend = [...LOCAL_ORIGINS, ...extra];
  return [
    "default-src 'self' file:",
    "script-src 'self' file: 'unsafe-inline' 'unsafe-eval' blob: " + LOCAL_ORIGINS.join(" "),
    "style-src 'self' file: 'unsafe-inline'",
    `img-src 'self' file: data: blob: ${backend.join(" ")}`,
    `media-src 'self' file: data: blob: ${backend.join(" ")}`,
    "font-src 'self' file: data:",
    `connect-src 'self' file: data: blob: ${[...backend, ...LOCAL_WS_ORIGINS, ...extraWs].join(" ")}`,
    `frame-src 'self' file: blob: data: ${backend.join(" ")}`,
    "worker-src 'self' file: blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join("; ");
}

/** Space- or comma-separated origins from VITE_MULTICA_CSP_EXTRA_ORIGINS. */
export function parseExtraOrigins(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(/[\s,]+/)
    .map((value) => value.trim().replace(/\/+$/, ""))
    .filter((value) => /^https?:\/\/[^\s/]+$/i.test(value));
}
