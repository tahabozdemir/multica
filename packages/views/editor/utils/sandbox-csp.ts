/**
 * Content-Security-Policy for untrusted HTML shown in a sandboxed srcdoc
 * iframe (```html blocks and HTML attachments). Script and style inline in
 * the document still run; nothing can be fetched from anywhere: no remote
 * script, stylesheet, image, font, media, fetch/XHR/WebSocket, frame, or
 * form target. Inline data:/blob: images, media, and fonts keep working.
 *
 * Without it, an agent-written block could load https://cdn.example/x.js
 * or beacon the document's contents to any host as soon as it scrolled
 * into view.
 */
export const SANDBOXED_HTML_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "media-src data: blob:",
  "font-src data:",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

const LEADING_DOCTYPE_RE = /^\s*<!doctype[^>]*>/i;

/**
 * Puts the policy first in the document, after a leading doctype (which must
 * stay first to keep standards mode), so it governs everything after it.
 */
export function withSandboxCsp(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${SANDBOXED_HTML_CSP}">`;
  const doctype = LEADING_DOCTYPE_RE.exec(html)?.[0];
  return doctype ? doctype + meta + html.slice(doctype.length) : meta + html;
}
