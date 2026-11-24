/**
 * This fork's privacy switch, read from an injected environment map (core
 * never reads `process.env` itself). Same rule as the Go side
 * (`server/internal/privacy`): on unless MULTICA_PRIVACY_MODE is 0, false,
 * off, or no.
 */
export function privacyModeFromEnv(env: Readonly<Record<string, string | undefined>>): boolean {
  const value = env.MULTICA_PRIVACY_MODE?.trim().toLowerCase();
  return !(value === "0" || value === "false" || value === "off" || value === "no");
}
