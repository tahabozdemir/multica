# Privacy mode (this fork)

This fork of Multica keeps a local setup from contacting anything you have not
configured yourself. One switch controls it, and it is **on by default**:

| Layer | Switch | Off |
|---|---|---|
| Server, daemon, CLI (Go) | `MULTICA_PRIVACY_MODE` | `0`, `false`, `off`, `no` |
| Web app (Next server and browser) | `MULTICA_PRIVACY_MODE` on the Next server; `privacy_mode` from `/api/config` in the browser | same |
| Desktop app | `VITE_MULTICA_PRIVACY_MODE` at **build** time | same |

Turning it off restores upstream behavior. Every gated call site is a
single check, so merges from upstream stay small.

## What privacy mode changes

**Telemetry and analytics**
- Self-host daily snapshot to `telemetry.multica.ai`: never collected or sent (also `DO_NOT_TRACK=1`).
- PostHog (server, browser, AI-visit capture) and Google Analytics: always off, even with keys set (also `ANALYTICS_DISABLED=1`).

**Multica Cloud and GitHub**
- Desktop: a missing `~/.multica/desktop.json` shows an error instead of connecting to `api.multica.ai`.
- CLI: `multica login --token` with no server configured fails instead of sending the token to Cloud. A bare `multica setup` refuses; use `multica setup self-host` (or `multica setup cloud` on purpose).
- No self-update: electron-updater is never called (the Settings → Updates tab is hidden). `multica update`, the daemon's auto-update, and the UI's "update daemon" refuse unless `MULTICA_RELEASE_API_BASE_URL` and `MULTICA_RELEASE_DOWNLOAD_BASE_URL` point at your own mirror.
- Desktop runs only the CLI bundled from this checkout (`apps/desktop/scripts/bundle-cli.mjs`). It never downloads one from GitHub Releases and never falls back to a `multica` on `PATH`.
- No GitHub star or release lookups from the UI or the landing pages.
- Server: the theme store's default registry (GitHub) is off; set `MULTICA_THEME_REGISTRY_URL` to use your own. Skill registry search, import from URL, and update-from-source (clawhub.ai, skills.sh, GitHub) answer 403; uploading a skill archive still works. Qoder Cloud Agents calls answer 403.
- Voice models download from Hugging Face only, never `hf-mirror.com`.

**Content that would load remote resources**
- Web and desktop send a Content-Security-Policy: images, media, fonts, fetch/XHR, WebSockets, frames, and workers only from the app and your backend. For a desktop backend that is not on localhost, build with `VITE_MULTICA_CSP_EXTRA_ORIGINS="https://multica.lan"`.
- Externally hosted images in comments and issues render as links.
- ```` ```html ```` blocks and HTML attachments run under `default-src 'none'`. Inline script and style work; nothing is fetched.
- Mermaid diagrams: remote `img:` URLs are blanked and `themeCSS` directives are ignored.
- Web fonts are bundled (`@fontsource-variable/*`), so `next build` and `next dev` no longer contact Google Fonts.

**Network exposure and secrets**
- Native runs listen on `127.0.0.1`: the API, `next dev`/`next start`, and collab. `MULTICA_BIND_HOST` overrides this; the Docker images set `0.0.0.0` inside the container, and compose publishes on `127.0.0.1`.
- Comments, issue titles and descriptions, and chat messages that agents write with their task token go through `redact.Text`, the same masking streamed agent output gets (`mat_`/`mul_`/`mdt_`/`mcn_` tokens, cloud keys, JWTs, `KEY=value`).

## Local configuration

In `.env` (gitignored):

```sh
MULTICA_PRIVACY_MODE=1
DO_NOT_TRACK=1
ANALYTICS_DISABLED=1
NEXT_TELEMETRY_DISABLED=1     # Next.js CLI telemetry
TURBO_TELEMETRY_DISABLED=1    # Turborepo telemetry
MULTICA_DAEMON_AUTO_UPDATE=false
# Leave empty: POSTHOG_API_KEY, GOOGLE_ANALYTICS_ID, RESEND_API_KEY, SMTP_HOST,
# GOOGLE_CLIENT_ID, MULTICA_CLOUD_URL, MULTICA_LLM_API_KEY, GITHUB_APP_*,
# MULTICA_*_SECRET_KEY, COMPOSIO_API_KEY, S3_BUCKET, CLOUDFRONT_*.
```

For the desktop app, create `~/.multica/desktop.json`:

```json
{ "schemaVersion": 1, "apiUrl": "http://localhost:8080", "appUrl": "http://localhost:3000" }
```

## Tests

Upstream test suites run with privacy mode off (`TestMain` in the affected Go
packages, `packages/views/test/setup.ts`, and per-file mocks in the desktop
app), so they keep covering upstream behavior. Tests named for privacy mode
turn it on explicitly.
