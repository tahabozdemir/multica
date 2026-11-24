/**
 * Keeps a Mermaid diagram from reaching the network while it renders. Mermaid
 * draws in the host document, so an image node (`A@{ img: "https://…" }`)
 * makes the browser fetch that URL as soon as the diagram appears, and an
 * init directive's `themeCSS` could `@import` a remote stylesheet.
 */

/** 1×1 transparent GIF: the node keeps its layout, nothing is fetched. */
const BLANK_IMAGE = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";

// `img: "https://…"`, `img: 'http://…'`, `img: //host/…`, or unquoted.
const REMOTE_IMG_RE = /(\bimg\s*:\s*)(["']?)(?:https?:)?\/\/[^"'\s,}]*\2/gi;

/** Replaces every remote image URL in the diagram source with an inline blank. */
export function withoutRemoteMermaidImages(chart: string): string {
  return chart.replace(REMOTE_IMG_RE, (_match, prefix: string) => `${prefix}"${BLANK_IMAGE}"`);
}

/**
 * Mermaid's own secure keys (11.x), which directives in a diagram cannot set,
 * plus `themeCSS`, so a diagram cannot inject CSS that loads a remote URL.
 */
export const MERMAID_SECURE_KEYS = [
  "secure",
  "securityLevel",
  "startOnLoad",
  "maxTextSize",
  "suppressErrorRendering",
  "maxEdges",
  "themeCSS",
];
