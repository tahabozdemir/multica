// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";

type Handler = (...args: unknown[]) => unknown;
const ctx = vi.hoisted(() => ({
  ipcHandlers: new Map<string, Handler>(),
  checkForUpdates: vi.fn(),
  downloadUpdate: vi.fn(),
  on: vi.fn(),
}));

vi.mock("electron-updater", () => ({
  autoUpdater: {
    on: ctx.on,
    checkForUpdates: ctx.checkForUpdates,
    downloadUpdate: ctx.downloadUpdate,
    quitAndInstall: vi.fn(),
  },
}));

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp", getVersion: () => "1.0.0", on: vi.fn(), quit: vi.fn() },
  BrowserWindow: class BrowserWindow {},
  ipcMain: { handle: (channel: string, handler: Handler) => ctx.ipcHandlers.set(channel, handler) },
}));

import { setupAutoUpdater } from "./updater";

beforeEach(() => {
  ctx.ipcHandlers.clear();
  vi.useFakeTimers();
});

it("never contacts the update feed in a privacy build", async () => {
  setupAutoUpdater(() => [], { privacyMode: true });
  await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);

  const check = await ctx.ipcHandlers.get("updater:check")!({});
  expect(check).toMatchObject({ ok: false, reason: "unavailable" });
  expect(await ctx.ipcHandlers.get("updater:get-preferences")!({})).toEqual({ automaticUpdates: false });
  expect(() => ctx.ipcHandlers.get("updater:download")!({})).toThrow(/privacy build/);
  expect(ctx.checkForUpdates).not.toHaveBeenCalled();
  expect(ctx.downloadUpdate).not.toHaveBeenCalled();
  expect(ctx.on).not.toHaveBeenCalled();
});

it("is the default when the build switch is not set", async () => {
  setupAutoUpdater(() => []);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(ctx.checkForUpdates).not.toHaveBeenCalled();
});
