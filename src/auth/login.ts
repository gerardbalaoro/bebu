/* oxlint-disable no-await-in-loop -- Each browser poll depends on the previous result and the sign-in deadline. */
import { readFile, rm } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

import type { Browser, ConnectOptions, Page } from "puppeteer-core";
import { z } from "zod";

import { BeyondClient } from "../firestore/client.ts";
import type { Fetcher } from "../firestore/client.ts";
import { BrowserSetupError, removeBrowserProfile, withBrowserProfile } from "./browser.ts";
import { connectBrowser, launchBrowser, systemBrowserPath } from "./launcher.ts";
import { browserExpression, ORIGIN, SessionSchema, saveSession, sessionPath } from "./session.ts";
import type { Session } from "./session.ts";

export class AuthError extends Error {
  override name = "AuthError";
}

const pollIntervalMs = 500;
const freshnessMarginMs = 30_000;

const LoginOptionsSchema = z.object({
  fresh: z.boolean().default(false),
  headless: z.boolean().default(false),
  timeoutSeconds: z.number().int().min(1).max(3600).default(300),
});

export interface LoginOptions {
  headless?: boolean;
  fresh?: boolean;
  timeoutSeconds?: number;
  signal?: AbortSignal;
  progress?: (message: string) => void;
}

export interface LoginRuntime {
  launch?: (profile: string, options: { headless: boolean; timeout: number }) => Promise<Browser>;
  connect?: (options: ConnectOptions) => Promise<Browser>;
  fetcher?: Fetcher;
}

interface LoginBrowser {
  browser: Browser;
  owned: boolean;
  source: Session["source"];
}

const withLoginBrowser = async <T>(
  options: LoginOptions,
  runtime: LoginRuntime,
  operation: (connection: LoginBrowser) => Promise<T>
): Promise<T> => {
  options.signal?.throwIfAborted();

  const useProfile = options.fresh || options.headless || runtime.launch;
  const systemBrowser = useProfile || runtime.connect ? undefined : await systemBrowserPath();

  const connect =
    runtime.connect ?? (systemBrowser ? () => connectBrowser(systemBrowser) : undefined);

  if (!useProfile && connect) {
    options.progress?.(
      "Connecting to Chrome.\nIf Chrome asks for permission, select Allow. Your existing login will be reused."
    );
    let browser: Browser;

    try {
      browser = await connect({
        channel: "chrome",
        defaultViewport: null,
        protocolTimeout: 30_000,
        wsOptions: { handshakeTimeout: 30_000 },
      });
    } catch {
      throw new AuthError(
        "The Chrome connection failed. Open Chrome. Enable chrome://inspect/#remote-debugging. Approve the connection. Then run bebu auth login. For a separate profile, use bebu auth login --fresh"
      );
    }

    try {
      options.progress?.(
        "Opening Beyond Budget with your Chrome data.\nSign in if asked, then open your budget."
      );

      return await operation({ browser, owned: false, source: { kind: "browser-cdp" } });
    } finally {
      await browser.disconnect();
    }
  }

  return await withBrowserProfile(async (profile) => {
    options.progress?.(
      options.headless
        ? "Reconnecting to Beyond Budget..."
        : "Opening Beyond Budget in bebu's saved profile.\nSign in if asked, then open your budget."
    );

    const launchOptions = {
      headless: options.headless ?? false,
      timeout: 30_000,
    };

    const browser = runtime.launch
      ? await runtime.launch(profile, launchOptions)
      : await launchBrowser(profile, launchOptions, options.progress);

    try {
      return await operation({ browser, owned: true, source: { kind: "browser-profile" } });
    } finally {
      await browser.close();
    }
  });
};

const readySession = (session: Session): boolean => {
  const cutoff = Date.now() + freshnessMarginMs;

  return (
    session.expiresAt > cutoff &&
    session.appCheckExpiresAt !== undefined &&
    session.appCheckExpiresAt > cutoff &&
    Boolean(session.appCheckToken) &&
    session.budgetIds.length > 0 &&
    Boolean(session.selectedBudgetId || session.budgetIds.length === 1)
  );
};

const captureSession = async (
  page: Page,
  source: Session["source"],
  options: LoginOptions,
  runtime: LoginRuntime,
  deadline: number,
  signal: AbortSignal
): Promise<Session> => {
  while (Date.now() < deadline) {
    signal.throwIfAborted();

    if (page.isClosed()) {
      throw new AuthError(
        "The sign-in window closed before the connection was ready. Run bebu auth login"
      );
    }

    if (new URL(page.url()).origin !== ORIGIN) {
      await delay(pollIntervalMs, undefined, { signal });
      continue;
    }

    let candidate: Session | undefined;

    try {
      // Keep extraction errors inside the page until the user completes sign-in.
      const value: unknown = await page.evaluate(
        `(async()=>{try{return await ${browserExpression()}}catch{return null}})()`
      );

      const parsed = SessionSchema.safeParse(value);

      if (parsed.success && readySession(parsed.data)) {
        candidate = parsed.data;
      }
    } catch {
      /* The app can require more time to load, redirect, or complete sign-in. */
    }

    if (candidate) {
      try {
        const client = new BeyondClient(candidate, { fetcher: runtime.fetcher });
        const budget = await client.discover();

        return {
          ...candidate,
          selectedBudgetId: client.budgetId,
          selectedBudgetName: z.string().safeParse(budget.data.name).data,
          source,
        };
      } catch {
        /* Wait for the app to renew tokens and load budget access. */
      }
    }

    await delay(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())), undefined, {
      signal,
    });
  }

  throw new AuthError(
    options.headless
      ? "Your saved browser session needs sign-in. Run bebu auth login"
      : "Sign-in timed out. Run bebu auth login. Sign in. Open your budget"
  );
};

export const login = async (
  input: LoginOptions = {},
  runtime: LoginRuntime = {}
): Promise<Session> => {
  const parsed = LoginOptionsSchema.safeParse(input);

  if (!parsed.success) {
    throw new AuthError("Provide a timeout from 1 to 3600 seconds");
  }

  const options = { ...input, ...parsed.data };
  const controller = new AbortController();
  const signal = options.signal ?? controller.signal;
  const interrupt = () => controller.abort(new DOMException("Sign-in cancelled", "AbortError"));

  if (!options.signal) {
    process.once("SIGINT", interrupt);
  }

  try {
    return await withLoginBrowser(options, runtime, async ({ browser, owned, source }) => {
      const timeout = options.timeoutSeconds * 1000;
      let opening: Promise<Page> | undefined;
      const deadlineController = new AbortController();
      const captureSignal = AbortSignal.any([signal, deadlineController.signal]);
      let closing: Promise<void> | undefined;

      const close = (): Promise<void> => {
        closing ??= (async () => {
          try {
            const page = await opening;
            await page?.close();
          } finally {
            await (owned ? browser.close() : browser.disconnect());
          }
        })().catch(() => {
          // Cancellation can close the connection before cleanup completes.
        });

        return closing;
      };

      const stop = () => {
        void close();
      };

      captureSignal.addEventListener("abort", stop, { once: true });
      let timer: ReturnType<typeof setTimeout> | undefined;

      try {
        captureSignal.throwIfAborted();
        opening = owned
          ? (async () => {
              const pages = await browser.pages();

              return pages[0] ?? (await browser.newPage());
            })()
          : browser.defaultBrowserContext().newPage({ type: "window" });
        const page = await opening;
        captureSignal.throwIfAborted();
        await page.goto(ORIGIN, { timeout: 30_000, waitUntil: "domcontentloaded" });
        timer = setTimeout(
          () =>
            deadlineController.abort(
              new AuthError(
                options.headless
                  ? "Your saved browser session needs sign-in. Run bebu auth login"
                  : "Sign-in timed out. Run bebu auth login, sign in, and open your budget"
              )
            ),
          timeout
        );

        const session = await captureSession(
          page,
          source,
          options,
          runtime,
          Date.now() + timeout,
          captureSignal
        );

        captureSignal.throwIfAborted();
        await saveSession(session);

        return session;
      } catch (error) {
        if (captureSignal.aborted) {
          throw captureSignal.reason;
        }

        throw error;
      } finally {
        clearTimeout(timer);
        captureSignal.removeEventListener("abort", stop);
        await close();
      }
    });
  } catch (error) {
    if (signal.aborted) {
      throw signal.reason;
    }

    if (error instanceof AuthError) {
      throw error;
    }

    if (error instanceof BrowserSetupError) {
      throw new AuthError(error.message);
    }

    // Browser errors can contain private page data. Return only messages that bebu controls.
    throw new AuthError(
      "Browser sign-in failed. Stop any other bebu login. Then run bebu auth login. To use the separate saved profile, run bebu auth login --fresh"
    );
  } finally {
    if (!options.signal) {
      process.removeListener("SIGINT", interrupt);
    }
  }
};

export const authStatus = async () => {
  let session: Session;

  try {
    session = SessionSchema.parse(JSON.parse(await readFile(sessionPath(), "utf-8")));
  } catch {
    return { authenticated: false, state: "signed-out" as const };
  }

  const expired =
    session.expiresAt <= Date.now() ||
    (session.appCheckExpiresAt !== undefined && session.appCheckExpiresAt <= Date.now());

  return {
    authenticated: !expired,
    expiresAt: new Date(session.expiresAt).toISOString(),
    renewable: session.source?.kind === "browser-profile" || session.source?.kind === "browser-cdp",
    selectedBudgetId: session.selectedBudgetId,
    selectedBudgetName: session.selectedBudgetName,
    state: expired ? ("expired" as const) : ("connected" as const),
  };
};

export const logout = async (): Promise<void> => {
  await withBrowserProfile(async (profile) => {
    await removeBrowserProfile(profile);
    await rm(sessionPath(), { force: true });
    await rm(`${sessionPath()}.handoff-key`, { force: true });
  });
};
