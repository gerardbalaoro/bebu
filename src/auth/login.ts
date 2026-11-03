/* oxlint-disable no-await-in-loop -- Each browser poll depends on the previous result and the sign-in deadline. */
import { readFile, rm } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

import type { BrowserContext, Page } from "patchright";
import { z } from "zod";

import { BeyondClient } from "../firestore/client.ts";
import type { Fetcher } from "../firestore/client.ts";
import {
  browserProfileStatus,
  BrowserSetupError,
  removeBrowserProfile,
  withBrowserProfile,
} from "./browser.ts";
import { connectManagedBrowser } from "./control.ts";
import { CredentialError, loadCredentials } from "./credentials.ts";
import type { Credentials } from "./credentials.ts";
import { launchBrowser } from "./launcher.ts";
import { browserExpression, ORIGIN, SessionSchema, saveSession, sessionPath } from "./session.ts";
import type { Session } from "./session.ts";
import { advanceSignIn, SignInError } from "./sign-in.ts";
import type { SignInState } from "./sign-in.ts";

export class AuthError extends Error {
  override name = "AuthError";
}

const pollIntervalMs = 500;
const freshnessMarginMs = 30_000;

const LoginOptionsSchema = z.object({
  force: z.boolean().default(false),
  fresh: z.boolean().default(false),
  headless: z.boolean().optional(),
  timeoutSeconds: z.number().int().min(1).max(3600).default(300),
});

export interface LoginOptions {
  force?: boolean;
  headless?: boolean;
  fresh?: boolean;
  timeoutSeconds?: number;
  signal?: AbortSignal;
  progress?: (message: string) => void;
}

export interface LoginRuntime {
  launch?: (
    profile: string,
    options: { headless: boolean; timeout: number }
  ) => Promise<BrowserContext>;
  credentials?: () => Promise<Credentials | undefined>;
  fetcher?: Fetcher;
}

interface LoginBrowser {
  context: BrowserContext;
  owned: boolean;
  close: () => Promise<void>;
}

const withLoginBrowser = async <T>(
  options: LoginOptions,
  runtime: LoginRuntime,
  operation: (connection: LoginBrowser) => Promise<T>
): Promise<T> => {
  options.signal?.throwIfAborted();

  const connection =
    runtime.launch || options.fresh === true ? null : await connectManagedBrowser();

  if (connection) {
    try {
      if (options.headless !== true && connection.headless === true) {
        throw new AuthError(
          "The running bebu browser is headless. Stop it, then run bebu auth, or restart it with bebu browser --headed"
        );
      }

      return await operation({
        close: connection.disconnect,
        context: connection.context,
        owned: false,
      });
    } finally {
      await connection.disconnect();
    }
  }

  return await withBrowserProfile(
    async (profile) => {
      options.progress?.("Opening Beyond Budget in Patchright...");

      const context = await (runtime.launch ?? launchBrowser)(profile, {
        headless: options.headless ?? false,
        timeout: 30_000,
      });

      try {
        return await operation({
          close: async () => {
            await context.close();
          },
          context,
          owned: true,
        });
      } finally {
        await context.close();
      }
    },
    { force: options.force }
  );
};

const readySession = (session: Session): boolean => {
  const cutoff = Date.now() + freshnessMarginMs;

  return (
    session.expiresAt > cutoff &&
    session.appCheckExpiresAt !== undefined &&
    session.appCheckExpiresAt > cutoff &&
    Boolean(session.appCheckToken) &&
    session.budgetIds.length > 0 &&
    (Boolean(session.selectedBudgetId) || session.budgetIds.length === 1)
  );
};

const captureSession = async (
  page: Page,
  source: Session["source"],
  options: LoginOptions,
  runtime: LoginRuntime,
  deadline: number,
  signal: AbortSignal,
  credentials?: Credentials
): Promise<Session> => {
  const signIn: SignInState = {};
  let automaticSignIn = Boolean(credentials);

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

    if (credentials && automaticSignIn) {
      try {
        await advanceSignIn(page, credentials, signIn, options.progress);
      } catch (error) {
        if (error instanceof SignInError || signal.aborted || page.isClosed()) {
          throw error;
        }

        if (options.headless === true) {
          throw new AuthError(
            "Automatic sign-in could not use the browser form. Run bebu auth to continue in a visible window"
          );
        }

        automaticSignIn = false;
        options.progress?.(
          "Automatic sign-in could not use the browser form. Please continue signing in manually."
        );
      }

      if (signIn.verificationRequired === true && options.headless === true) {
        throw new AuthError(
          "Beyond Budget could not verify this browser. Run bebu auth to continue in a visible window"
        );
      }
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
    options.headless === true
      ? "Sign-in timed out. Run bebu auth to finish sign-in in a visible browser"
      : "Sign-in timed out before a usable session was available. Complete sign-in and open your budget, then run bebu auth again"
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

  let credentials: Credentials | undefined;

  try {
    credentials = await (runtime.credentials ?? loadCredentials)();
  } catch (error) {
    throw new AuthError(
      error instanceof CredentialError ? error.message : "Cannot load browser sign-in credentials"
    );
  }

  const options = {
    ...input,
    ...parsed.data,
    headless: parsed.data.headless ?? false,
  };

  options.progress?.(
    credentials
      ? "Configured credentials found. Signing in automatically; complete any browser verification if asked."
      : "Sign in in the browser and open your budget. bebu will detect when the connection is ready."
  );

  const controller = new AbortController();
  const signal = options.signal ?? controller.signal;

  const interrupt = () => {
    controller.abort(new DOMException("Sign-in cancelled", "AbortError"));
  };

  if (!options.signal) {
    process.once("SIGINT", interrupt);
  }

  try {
    return await withLoginBrowser(
      options,
      runtime,
      async ({ context, owned, close: closeBrowser }) => {
        const timeout = options.timeoutSeconds * 1000;
        let opening: Promise<Page> | undefined;
        const deadlineController = new AbortController();
        const captureSignal = AbortSignal.any([signal, deadlineController.signal]);
        let closing: Promise<void> | undefined;

        const close = async (): Promise<void> => {
          closing ??= (async () => {
            try {
              const page = await opening;
              await page?.close();
            } finally {
              await closeBrowser();
            }
          })().catch(() => {
            // Cancellation can close the connection before cleanup completes.
          });

          await closing;
        };

        const stop = () => {
          void close();
        };

        captureSignal.addEventListener("abort", stop, { once: true });
        let timer: ReturnType<typeof setTimeout> | undefined;

        try {
          captureSignal.throwIfAborted();
          opening = owned
            ? (async () => context.pages()[0] ?? (await context.newPage()))()
            : context.newPage();
          const page = await opening;
          captureSignal.throwIfAborted();
          await page.goto(ORIGIN, { timeout: 30_000, waitUntil: "domcontentloaded" });
          timer = setTimeout(() => {
            deadlineController.abort(
              new AuthError(
                options.headless
                  ? "Sign-in timed out. Run bebu auth to finish sign-in in a visible browser"
                  : "Sign-in timed out before a usable session was available. Complete sign-in and open your budget, then run bebu auth again"
              )
            );
          }, timeout);

          const session = await captureSession(
            page,
            { kind: "browser-profile" },
            options,
            runtime,
            Date.now() + timeout,
            captureSignal,
            credentials
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
      }
    );
  } catch (error) {
    if (signal.aborted) {
      throw signal.reason;
    }

    if (error instanceof AuthError) {
      throw error;
    }

    if (error instanceof SignInError) {
      throw new AuthError(error.message);
    }

    if (error instanceof BrowserSetupError) {
      throw new AuthError(error.message);
    }

    // Browser errors can contain private page data. Return only messages that bebu controls.
    throw new AuthError(
      "Browser sign-in failed. Check Patchright setup and your sign-in configuration. Then run bebu auth login"
    );
  } finally {
    if (!options.signal) {
      process.removeListener("SIGINT", interrupt);
    }
  }
};

export const authStatus = async () => {
  const profile = await browserProfileStatus();
  let session: Session;

  try {
    session = SessionSchema.parse(JSON.parse(await readFile(sessionPath(), "utf-8")));
  } catch {
    return { authenticated: false, profile, state: "signed-out" as const };
  }

  const expired =
    session.expiresAt <= Date.now() ||
    (session.appCheckExpiresAt !== undefined && session.appCheckExpiresAt <= Date.now());

  return {
    authenticated: !expired,
    expiresAt: new Date(session.expiresAt).toISOString(),
    profile,
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
