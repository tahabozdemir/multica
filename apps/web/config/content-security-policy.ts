type RuntimeEnv = Record<string, string | undefined>;

/**
 * Same rule as `privacyModeFromEnv` in @multica/core/privacy (on unless
 * MULTICA_PRIVACY_MODE is 0/false/off/no). Duplicated because next.config.ts
 * loads this file before workspace TypeScript is transpiled.
 */
export function privacyModeEnabled(env: RuntimeEnv): boolean {
  const value = env.MULTICA_PRIVACY_MODE?.trim().toLowerCase();
  return !(value === "0" || value === "false" || value === "off" || value === "no");
}

function originOf(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

function wsTwin(origin: string): string | undefined {
  if (origin.startsWith("https://")) return `wss://${origin.slice("https://".length)}`;
  if (origin.startsWith("http://")) return `ws://${origin.slice("http://".length)}`;
  return undefined;
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

/**
 * Content-Security-Policy for the web app in privacy mode.
 *
 * It limits where the page may fetch from, not what it may run: inline
 * script (Next's bootstrap) and dev-mode eval stay allowed. Images, media,
 * fetch/XHR, WebSockets, frames, and fonts may only come from this origin,
 * the configured backend and upload origins, and a configured CDN, so a
 * remote image in a comment or a Composio logo is refused before any
 * request leaves the browser. ```html block iframes inherit the policy.
 */
export function webContentSecurityPolicy(env: RuntimeEnv, options: { dev: boolean; backendUrl?: string }): string {
  const cdn = [env.MULTICA_CDN_DOMAIN, env.CLOUDFRONT_DOMAIN]
    .map((domain) => domain?.trim())
    .filter(Boolean)
    .map((domain) => originOf(/^https?:\/\//i.test(domain!) ? domain : `https://${domain}`));
  const backend = unique([
    originOf(options.backendUrl),
    originOf(env.REMOTE_API_URL),
    originOf(env.NEXT_PUBLIC_API_URL),
    originOf(env.LOCAL_UPLOAD_BASE_URL),
    originOf(env.MULTICA_PUBLIC_URL),
    ...cdn,
  ]);
  const sockets = unique([
    originOf(env.NEXT_PUBLIC_WS_URL),
    ...backend.map(wsTwin),
    ...[originOf(env.FRONTEND_ORIGIN)].map((origin) => (origin ? wsTwin(origin) : undefined)),
  ]);
  const frames = unique([...backend, originOf(env.MULTICA_PLUGIN_SURFACE_ORIGIN)]);
  const sources = (list: string[]) => (list.length > 0 ? ` ${list.join(" ")}` : "");

  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' blob:${options.dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${sources(backend)}`,
    `media-src 'self' data: blob:${sources(backend)}`,
    "font-src 'self' data:",
    `connect-src 'self'${sources([...backend, ...sockets])}`,
    `frame-src 'self' blob: data:${sources(frames)}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}
