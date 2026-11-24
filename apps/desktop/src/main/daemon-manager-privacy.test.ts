// @vitest-environment node
import { expect, it, vi } from "vitest";

const context = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  exec: vi.fn(),
  exists: vi.fn(() => false),
  install: vi.fn(),
}));
vi.mock("electron", () => ({
  app: { getAppPath: () => "/test/desktop", getPreferredSystemLanguages: () => ["en"], on: vi.fn(), quit: vi.fn(), emit: vi.fn() },
  dialog: { showMessageBox: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: {
    handle: (name: string, handler: (...args: unknown[]) => unknown) => { context.handlers.set(name, handler); },
    on: vi.fn(),
  },
}));
vi.mock("child_process", () => ({ execFile: context.exec }));
vi.mock("fs", async (original) => ({ ...await original<typeof import("fs")>(), existsSync: context.exists }));
vi.mock("fs/promises", async (original) => ({
  ...await original<typeof import("fs/promises")>(),
  readFile: vi.fn(async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); }),
  writeFile: vi.fn(), mkdir: vi.fn(),
}));
vi.mock("./cli-bootstrap", () => ({ ensureManagedCli: context.install, managedCliPath: () => "/test/managed/multica" }));
vi.mock("./daemon-port", () => ({ probeProfileHealth: vi.fn(async () => null), readDaemonPortRecord: vi.fn() }));

it("runs only the bundled CLI in a privacy build: no download, no managed or PATH copy", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const { setupDaemonManager } = await import("./daemon-manager");
  setupDaemonManager(() => null);

  expect(await context.handlers.get("daemon:is-cli-installed")!({})).toBe(false);
  expect(context.install).not.toHaveBeenCalled();
  // No `which multica` / managed-path probe either.
  expect(context.exec).not.toHaveBeenCalled();
  expect(error).toHaveBeenCalledWith(expect.stringContaining("privacy build"));
});
