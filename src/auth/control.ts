import { readFile, rm, writeFile } from "node:fs/promises";
import nodePath from "node:path";

import { chromium } from "patchright";
import { z } from "zod";

import { BrowserSetupError, profilePath, withBrowserProfile } from "./browser.ts";
import { launchBrowser } from "./launcher.ts";
import type { BrowserOptions } from "./launcher.ts";
import { ORIGIN } from "./session.ts";

const VersionSchema = z.object({ webSocketDebuggerUrl: z.string() });

const StateSchema = VersionSchema.extend({
  endpoint: z.url(),
  headless: z.boolean().optional(),
  pid: z.number().int().positive(),
});

const TargetsSchema = z.array(z.object({ id: z.string() }));
const statePath = () => nodePath.join(nodePath.dirname(profilePath()), "browser.json");

export const browserStatus = async () => {
  try {
    const state = StateSchema.parse(JSON.parse(await readFile(statePath(), "utf-8")));
    const url = new URL(state.endpoint);

    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      !url.port ||
      url.pathname !== "/" ||
      url.username ||
      url.password
    ) {
      return { running: false as const };
    }

    process.kill(state.pid, 0);

    const response = await fetch(new URL("/json/version", url), {
      signal: AbortSignal.timeout(2000),
    });

    if (!response.ok) {
      return { running: false as const };
    }

    const version = VersionSchema.parse(await response.json());

    if (version.webSocketDebuggerUrl !== state.webSocketDebuggerUrl) {
      return { running: false as const };
    }

    return { ...state, protocol: "cdp" as const, running: true as const };
  } catch {
    return { running: false as const };
  }
};

export const connectManagedBrowser = async () => {
  const status = await browserStatus();

  if (!status.running) {
    return null;
  }

  try {
    const browser = await chromium.connectOverCDP(status.webSocketDebuggerUrl, {
      noDefaults: true,
      timeout: 5000,
    });

    const [context] = browser.contexts();

    if (!context) {
      await browser.close();
      throw new Error("Missing browser context");
    }

    return {
      context,
      disconnect: async () => {
        await browser.close();
      },
      headless: status.headless,
    };
  } catch {
    throw new BrowserSetupError("Cannot connect to the managed browser. Restart bebu browser");
  }
};

export const stopBrowser = async () => {
  const connection = await connectManagedBrowser();

  if (!connection) {
    return { stopped: false };
  }

  try {
    const browser = connection.context.browser();

    if (!browser) {
      throw new BrowserSetupError("The managed browser connection is unavailable");
    }

    const channel = await browser.newBrowserCDPSession();
    // Browser.close terminates Chrome; browser.close() on a CDP client only disconnects.
    await channel.send("Browser.close");

    return { stopped: true };
  } finally {
    await connection.disconnect();
  }
};

export const runBrowser = async (
  options: {
    headless?: boolean;
    port?: number;
    signal?: AbortSignal;
    ready: (status: {
      endpoint: string;
      webSocketDebuggerUrl: string;
      pid: number;
      protocol: "cdp";
    }) => void;
  },
  launch: (
    profile: string,
    options: BrowserOptions
  ) => ReturnType<typeof launchBrowser> = launchBrowser
): Promise<void> => {
  const port = z
    .number()
    .int()
    .min(0)
    .max(65_535)
    .safeParse(options.port ?? 0);

  if (!port.success) {
    throw new BrowserSetupError("Provide a CDP port from 0 to 65535");
  }

  options.signal?.throwIfAborted();
  await withBrowserProfile(async (profile) => {
    await rm(nodePath.join(profile, "DevToolsActivePort"), { force: true });

    const context = await launch(profile, {
      headless: options.headless ?? true,
      port: port.data,
      timeout: 30_000,
    });

    const close = () => {
      void context.close().catch(() => {
        // The browser can already be closed.
      });
    };

    const closed = Promise.withResolvers<undefined>();
    context.once("close", () => {
      closed.resolve();
    });
    options.signal?.addEventListener("abort", close, { once: true });
    process.once("SIGINT", close);
    process.once("SIGTERM", close);

    try {
      options.signal?.throwIfAborted();

      // Chromium writes its chosen port for port=0. A fixed port does not produce this file.
      const portFile =
        port.data === 0
          ? await readFile(nodePath.join(profile, "DevToolsActivePort"), "utf-8")
          : "";

      const actualPort = port.data || Number(portFile.split("\n")[0]);

      if (!Number.isInteger(actualPort) || actualPort < 1 || actualPort > 65_535) {
        throw new BrowserSetupError("Patchright did not publish a valid CDP port");
      }

      const endpoint = `http://127.0.0.1:${actualPort}`;

      const response = await fetch(`${endpoint}/json/version`, {
        signal: AbortSignal.timeout(5000),
      });

      const version = VersionSchema.parse(await response.json());

      const page = context.pages()[0] ?? (await context.newPage());
      const channel = await context.newCDPSession(page);
      const { targetInfo } = await channel.send("Target.getTargetInfo");
      await channel.detach();

      const targetsResponse = await fetch(`${endpoint}/json/list`, {
        signal: AbortSignal.timeout(5000),
      });

      const targets = TargetsSchema.parse(await targetsResponse.json());

      if (!targets.some((target) => target.id === targetInfo.targetId)) {
        throw new BrowserSetupError(
          "The CDP port belongs to another browser. Choose another --port"
        );
      }

      await writeFile(
        statePath(),
        JSON.stringify({
          endpoint,
          headless: options.headless ?? true,
          pid: process.pid,
          ...version,
        }),
        {
          mode: 0o600,
        }
      );
      await page.goto(ORIGIN, { timeout: 30_000, waitUntil: "domcontentloaded" });
      options.ready({ endpoint, pid: process.pid, protocol: "cdp", ...version });
      await closed.promise;
    } finally {
      options.signal?.removeEventListener("abort", close);
      process.removeListener("SIGINT", close);
      process.removeListener("SIGTERM", close);
      await context.close();
      await rm(statePath(), { force: true });
    }
  });
};
