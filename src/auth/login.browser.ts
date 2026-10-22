/* oxlint-disable no-await-in-loop -- Browser teardown requires ordered awaits. */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { chromium } from "playwright-core";
import type { Browser, BrowserContext } from "playwright-core";
import * as puppeteer from "puppeteer-core";
import type { ConnectOptions } from "puppeteer-core";

import { launchBrowser } from "./launcher.ts";
import { authStatus, login, logout } from "./login.ts";
import type { LoginRuntime } from "./login.ts";
import { loadSession } from "./session.ts";

const loginInstruction = /auth login/u;

const waitForLoginTabToClose = async (context: BrowserContext): Promise<void> => {
  const page = await context.waitForEvent("page");
  await page.waitForEvent("close");
};

const authTest = (name: string, body: () => Promise<void>, timeout = 15_000): void => {
  test(name, { timeout }, body);
};

const signedInPage = `<!doctype html><script>
(async()=>{
 const seed=async(name,store,rows)=>{
  const db=await new Promise((resolve,reject)=>{const request=indexedDB.open(name);request.onupgradeneeded=()=>{const target=request.result.createObjectStore(store,{autoIncrement:true});for(const row of rows)target.put(row)};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});db.close();
 };
 await seed('firebaseLocalStorageDb','firebaseLocalStorage',[{value:{uid:'fixture-user',email:'test@example.com',stsTokenManager:{accessToken:'fixture-access-token',refreshToken:'fixture-refresh-token',expirationTime:Date.now()+3600000}}}]);
 await seed('firebase-app-check-database','firebase-app-check-store',[{value:{token:'fixture-app-check',expireTimeMillis:Date.now()+3600000}}]);
 await seed('firestore/[DEFAULT]/beyond-budget/main','remoteDocumentsV14',[{documentId:'accountsIndex',document:{name:'projects/beyond-budget/databases/(default)/documents/budgets/fixtureBudget/stashes/accountsIndex',fields:{type:{stringValue:'ACCOUNTS'}}}}]);
})();
</script>`;

const runtime = (html: string, contexts: BrowserContext[]): LoginRuntime => ({
  fetcher: (input, init) => {
    assert.equal(
      String(input),
      "https://firestore.googleapis.com/v1/projects/beyond-budget/databases/(default)/documents/budgets/fixtureBudget"
    );
    assert.equal(init?.method, "GET");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer fixture-access-token");
    assert.equal(new Headers(init?.headers).get("X-Firebase-AppCheck"), "fixture-app-check");

    return Promise.resolve(
      Response.json({
        fields: {
          availablePeriods: { mapValue: { fields: {} } },
          name: { stringValue: "Test Budget" },
          stashIdentifiers: {
            mapValue: { fields: { ACCOUNTS: { stringValue: "accountsIndex" } } },
          },
        },
        name: "projects/beyond-budget/databases/(default)/documents/budgets/fixtureBudget",
        updateTime: "2026-10-22T00:00:00Z",
      })
    );
  },
  launch: async (profile, options) => {
    const browser = await launchBrowser(profile, {
      ...options,
      headless: true,
    });

    const connection = await chromium.connectOverCDP(browser.wsEndpoint(), { noDefaults: true });
    const [context] = connection.contexts();
    assert.ok(context);

    contexts.push(context);
    await context.route("**/*", async (route) => {
      await route.fulfill({ body: html, contentType: "text/html" });
    });

    return browser;
  },
});

authTest(
  "existing browser login reuses its data, renews, and leaves user tabs intact after timeout and logout",
  async () => {
    const directory = await mkdtemp(nodePath.join(tmpdir(), "bebu-cdp-"));
    const userDataDir = nodePath.join(directory, "user-browser");
    const previous = process.env.BEBU_SESSION_FILE;
    process.env.BEBU_SESSION_FILE = nodePath.join(directory, "bebu", "session.json");

    const chrome = await launchBrowser(userDataDir, { headless: true, timeout: 10_000 });

    let browser: Browser | undefined;

    try {
      const endpoint = chrome.wsEndpoint();
      browser = await chromium.connectOverCDP(endpoint, { noDefaults: true });
      const [context] = browser.contexts();
      assert.ok(context);
      let html = "<!doctype html>Sign in";
      await context.route("**/*", (route) =>
        route.fulfill({ body: html, contentType: "text/html" })
      );
      const [userTab] = context.pages();
      assert.ok(userTab);
      const { fetcher } = runtime(signedInPage, []);

      const connect = async (options: ConnectOptions) => {
        assert.equal(options.channel, "chrome");
        assert.equal(options.defaultViewport, null);

        return await puppeteer.connect({
          ...options,
          browserWSEndpoint: endpoint,
          channel: undefined,
        });
      };

      const timedOutTab = waitForLoginTabToClose(context);
      await assert.rejects(login({ timeoutSeconds: 1 }, { connect, fetcher }), loginInstruction);
      await timedOutTab;
      assert.equal(userTab.isClosed(), false);
      assert.equal(context.pages().length, 1);

      const controller = new AbortController();
      const cancelledTab = waitForLoginTabToClose(context);
      context.once("page", () =>
        controller.abort(new DOMException("Cancelled fixture connection", "AbortError"))
      );
      await assert.rejects(
        login({ signal: controller.signal, timeoutSeconds: 10 }, { connect, fetcher }),
        { message: "Cancelled fixture connection", name: "AbortError" }
      );
      await cancelledTab;
      assert.equal(userTab.isClosed(), false);
      assert.equal(context.pages().length, 1);

      html = signedInPage;
      await userTab.goto("https://app.beyondbudgetapp.com");
      const signedInTab = waitForLoginTabToClose(context);
      const signedIn = await login({ timeoutSeconds: 10 }, { connect, fetcher });
      await signedInTab;
      assert.equal(signedIn.uid, "fixture-user");
      assert.deepEqual(signedIn.source, { kind: "browser-cdp" });
      assert.equal(userTab.isClosed(), false);
      assert.equal(userTab.url(), "https://app.beyondbudgetapp.com/");
      assert.equal(context.pages().length, 1);
      await assert.rejects(stat(nodePath.join(directory, "bebu", "browser-profile")));

      await writeFile(
        nodePath.join(directory, "bebu", "session.json"),
        JSON.stringify({ ...signedIn, expiresAt: 1, idToken: "stale-token" })
      );
      const renewedTab = waitForLoginTabToClose(context);
      const renewed = await loadSession({ connect, fetcher });
      await renewedTab;
      assert.equal(renewed.idToken, "fixture-access-token");
      assert.deepEqual(renewed.source, { kind: "browser-cdp" });
      await logout();
      assert.equal(userTab.isClosed(), false);
      assert.equal(context.pages().length, 1);
      assert.equal(browser.isConnected(), true);
      assert.ok(await stat(nodePath.join(userDataDir, "DevToolsActivePort")));
      await assert.rejects(stat(nodePath.join(directory, "bebu", "session.json")));
    } finally {
      if (browser?.isConnected()) {
        const channel = await browser.newBrowserCDPSession();
        await channel.send("Browser.close").catch(() => {
          // The browser can close before the protocol response arrives.
        });
        await browser.close();
      }

      await chrome.close();

      if (previous === undefined) {
        delete process.env.BEBU_SESSION_FILE;
      } else {
        process.env.BEBU_SESSION_FILE = previous;
      }

      await rm(directory, { force: true, maxRetries: 10, recursive: true, retryDelay: 100 });
    }
  },
  30_000
);

authTest(
  "browser login validates tokens, saves only the connection, and closes its profile",
  async () => {
    const directory = await mkdtemp(nodePath.join(tmpdir(), "bebu-auth-"));
    const previous = process.env.BEBU_SESSION_FILE;
    process.env.BEBU_SESSION_FILE = nodePath.join(directory, "session.json");
    const contexts: BrowserContext[] = [];

    try {
      const session = await login(
        {
          headless: true,
          timeoutSeconds: 10,
        },
        runtime(signedInPage, contexts)
      );

      assert.deepEqual(
        {
          selectedBudgetId: session.selectedBudgetId,
          selectedBudgetName: session.selectedBudgetName,
          source: session.source,
          uid: session.uid,
        },
        {
          selectedBudgetId: "fixtureBudget",
          selectedBudgetName: "Test Budget",
          source: { kind: "browser-profile" },
          uid: "fixture-user",
        }
      );
      const stored = await readFile(nodePath.join(directory, "session.json"), "utf-8");
      assert.ok(!stored.includes("fixture-refresh-token"));
      const status = await authStatus();
      assert.equal(status.authenticated, true);
      assert.equal(status.state, "connected");
      assert.equal("renewable" in status && status.renewable, true);
      const loadSessionResult = await loadSession();
      assert.equal(loadSessionResult.idToken, "fixture-access-token");
      assert.equal(contexts[0]?.pages()?.length, 0);
      assert.ok(await stat(nodePath.join(directory, "browser-profile", ".bebu-profile")));
    } finally {
      for (const context of contexts) {
        await context.close();
      }

      if (previous === undefined) {
        delete process.env.BEBU_SESSION_FILE;
      } else {
        process.env.BEBU_SESSION_FILE = previous;
      }

      await rm(directory, { force: true, maxRetries: 10, recursive: true, retryDelay: 100 });
    }
  },
  15_000
);

authTest(
  "login times out without persisting a session and releases its browser profile",
  async () => {
    const directory = await mkdtemp(nodePath.join(tmpdir(), "bebu-auth-timeout-"));
    const previous = process.env.BEBU_SESSION_FILE;
    process.env.BEBU_SESSION_FILE = nodePath.join(directory, "session.json");
    const contexts: BrowserContext[] = [];

    try {
      await assert.rejects(
        login({ headless: true, timeoutSeconds: 1 }, runtime("<!doctype html>Sign in", contexts)),
        loginInstruction
      );
      assert.equal(contexts[0]?.pages()?.length, 0);
      await assert.rejects(stat(nodePath.join(directory, "session.json")));
      await assert.rejects(stat(nodePath.join(directory, "browser-profile.lock")));
      assert.deepEqual(await authStatus(), { authenticated: false, state: "signed-out" });
    } finally {
      for (const context of contexts) {
        await context.close();
      }

      if (previous === undefined) {
        delete process.env.BEBU_SESSION_FILE;
      } else {
        process.env.BEBU_SESSION_FILE = previous;
      }

      await rm(directory, { force: true, maxRetries: 10, recursive: true, retryDelay: 100 });
    }
  }
);

authTest("login waits for the user to finish signing in before saving a session", async () => {
  const directory = await mkdtemp(nodePath.join(tmpdir(), "bebu-auth-wait-"));
  const previous = process.env.BEBU_SESSION_FILE;
  process.env.BEBU_SESSION_FILE = nodePath.join(directory, "session.json");
  const contexts: BrowserContext[] = [];

  try {
    const delayedPage = signedInPage
      .replace("(async()=>{", "setTimeout(async()=>{")
      .replace("})();", "}, 1200);");

    const pending = login({ timeoutSeconds: 10 }, runtime(delayedPage, contexts));
    await delay(500);
    await assert.rejects(stat(nodePath.join(directory, "session.json")));
    const session = await pending;
    assert.equal(session.uid, "fixture-user");
    assert.equal(session.selectedBudgetName, "Test Budget");
  } finally {
    for (const context of contexts) {
      await context.close();
    }

    if (previous === undefined) {
      delete process.env.BEBU_SESSION_FILE;
    } else {
      process.env.BEBU_SESSION_FILE = previous;
    }

    await rm(directory, { force: true, maxRetries: 10, recursive: true, retryDelay: 100 });
  }
});

authTest("a previously signed-in profile connects without another login", async () => {
  const directory = await mkdtemp(nodePath.join(tmpdir(), "bebu-auth-reuse-"));
  const previous = process.env.BEBU_SESSION_FILE;
  process.env.BEBU_SESSION_FILE = nodePath.join(directory, "session.json");
  const contexts: BrowserContext[] = [];

  try {
    await login({ timeoutSeconds: 10 }, runtime(signedInPage, contexts));
    await rm(nodePath.join(directory, "session.json"));

    const session = await login(
      { timeoutSeconds: 10 },
      runtime("<!doctype html>Already signed in", contexts)
    );

    assert.equal(session.uid, "fixture-user");
    assert.equal(session.selectedBudgetName, "Test Budget");
    const authStatusResult = await authStatus();
    assert.equal(authStatusResult.authenticated, true);
  } finally {
    for (const context of contexts) {
      await context.close();
    }

    if (previous === undefined) {
      delete process.env.BEBU_SESSION_FILE;
    } else {
      process.env.BEBU_SESSION_FILE = previous;
    }

    await rm(directory, { force: true, maxRetries: 10, recursive: true, retryDelay: 100 });
  }
});

authTest("browser errors containing private page state never escape to callers", async () => {
  const directory = await mkdtemp(nodePath.join(tmpdir(), "bebu-auth-error-"));
  const previous = process.env.BEBU_SESSION_FILE;
  process.env.BEBU_SESSION_FILE = nodePath.join(directory, "session.json");

  try {
    let message = "";

    try {
      await login(
        {},
        {
          launch: () => Promise.reject(new Error("browser typed fixture-password")),
        }
      );
    } catch (error) {
      message = error instanceof Error ? error.message : "unexpected error";
    }

    assert.ok(message.includes("Browser sign-in failed"));
    assert.ok(!message.includes("fixture-password"));
  } finally {
    if (previous === undefined) {
      delete process.env.BEBU_SESSION_FILE;
    } else {
      process.env.BEBU_SESSION_FILE = previous;
    }

    await rm(directory, { force: true, maxRetries: 10, recursive: true, retryDelay: 100 });
  }
});

authTest(
  "expired managed sessions reopen their profile headlessly and replace stale credentials",
  async () => {
    const directory = await mkdtemp(nodePath.join(tmpdir(), "bebu-auth-renew-"));
    const previous = process.env.BEBU_SESSION_FILE;
    process.env.BEBU_SESSION_FILE = nodePath.join(directory, "session.json");
    const contexts: BrowserContext[] = [];

    try {
      await writeFile(
        nodePath.join(directory, "session.json"),
        JSON.stringify({
          budgetIds: ["fixtureBudget"],
          expiresAt: 1,
          idToken: "expired-token",
          importedAt: "2026-01-01T00:00:00Z",
          projectId: "beyond-budget",
          source: { kind: "browser-profile" },
          stashes: [],
          uid: "fixture-user",
          version: 1,
        })
      );
      const authStatusResult1 = await authStatus();
      assert.equal(authStatusResult1.state, "expired");
      const external = runtime(signedInPage, contexts);
      const { launch } = external;

      if (!launch) {
        throw new Error("Missing fixture browser launcher");
      }

      external.launch = async (profile, options) => {
        assert.equal(options.headless, true);

        return await launch(profile, options);
      };

      const renewed = await loadSession(external);
      assert.equal(renewed.idToken, "fixture-access-token");
      const readFileResult2 = await readFile(nodePath.join(directory, "session.json"), "utf-8");
      assert.ok(!readFileResult2.includes("expired-token"));
      assert.equal(contexts[0]?.pages()?.length, 0);
    } finally {
      for (const context of contexts) {
        await context.close();
      }

      if (previous === undefined) {
        delete process.env.BEBU_SESSION_FILE;
      } else {
        process.env.BEBU_SESSION_FILE = previous;
      }

      await rm(directory, { force: true, maxRetries: 10, recursive: true, retryDelay: 100 });
    }
  },
  15_000
);

authTest(
  "cancellation during browser startup closes the context without saving credentials",
  async () => {
    const directory = await mkdtemp(nodePath.join(tmpdir(), "bebu-auth-cancel-"));
    const previous = process.env.BEBU_SESSION_FILE;
    process.env.BEBU_SESSION_FILE = nodePath.join(directory, "session.json");
    const contexts: BrowserContext[] = [];
    const controller = new AbortController();
    const reason = new DOMException("Fixture cancellation", "AbortError");

    try {
      const external = runtime(signedInPage, contexts);
      const { launch } = external;

      if (!launch) {
        throw new Error("Missing fixture browser launcher");
      }

      external.launch = async (profile, options) => {
        const context = await launch(profile, options);
        controller.abort(reason);

        return context;
      };

      await assert.rejects(login({ signal: controller.signal }, external), {
        message: "Fixture cancellation",
        name: "AbortError",
      });

      if (contexts[0]?.pages().length) {
        await contexts[0].waitForEvent("close", { timeout: 3000 });
      }

      assert.equal(contexts[0]?.pages()?.length, 0);
      await assert.rejects(stat(nodePath.join(directory, "session.json")));
      await assert.rejects(stat(nodePath.join(directory, "browser-profile.lock")));
    } finally {
      for (const context of contexts) {
        await context.close();
      }

      if (previous === undefined) {
        delete process.env.BEBU_SESSION_FILE;
      } else {
        process.env.BEBU_SESSION_FILE = previous;
      }

      await rm(directory, { force: true, maxRetries: 10, recursive: true, retryDelay: 100 });
    }
  },
  15_000
);
