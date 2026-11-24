/**
 * This fork's privacy build switch for the desktop app. On unless the app is
 * built with VITE_MULTICA_PRIVACY_MODE=0 (or false, off, no). While on, the
 * app never falls back to Multica Cloud, never checks GitHub for updates, and
 * runs only the CLI bundled at build time.
 */
export function privacyModeFrom(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return !(normalized === "0" || normalized === "false" || normalized === "off" || normalized === "no");
}

export const PRIVACY_MODE: boolean = privacyModeFrom(
  (import.meta.env as Record<string, string | undefined>).VITE_MULTICA_PRIVACY_MODE,
);
