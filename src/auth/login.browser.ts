/* oxlint-disable no-await-in-loop -- Browser teardown requires ordered awaits. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { chromium } from "patchright";
import type { BrowserContext } from "patchright";
import { z } from "zod";

import { browserStatus, runBrowser, stopBrowser } from "./control.ts";
import { launchBrowser } from "./launcher.ts";
import { authStatus, login, logout } from "./login.ts";
import type { LoginRuntime } from "./login.ts";
import { loadSession } from "./session.ts";
import { advanceSignIn } from "./sign-in.ts";

const loginInstruction = /bebu auth/u;

const authTest = (name: string, body: () => Promise<void>, timeout = 15_000): void => {
  void test(name, { timeout }, body);
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
  credentials: async () => {
    await Promise.resolve();
  },
  fetcher: async (input, init) => {
    assert.equal(
      new Request(input, init).url,
      "https://firestore.googleapis.com/v1/projects/beyond-budget/databases/(default)/documents/budgets/fixtureBudget"
    );
    assert.equal(init?.method, "GET");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer fixture-access-token");
    assert.equal(new Headers(init?.headers).get("X-Firebase-AppCheck"), "fixture-app-check");

    return await Promise.resolve(
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
    const context = await launchBrowser(profile, {
      ...options,
      headless: true,
    });

    contexts.push(context);
    await context.route("**/*", async (route) => {
      if (new URL(route.request().url()).hostname === "identitytoolkit.googleapis.com") {
        await route.fulfill({
          headers: { "Access-Control-Allow-Origin": "*" },
          json: {
            idToken: "fixture-access-token",
            localId: "fixture-user",
            refreshToken: "fixture-refresh-token",
          },
        });

        return;
      }

      await route.fulfill({ body: html, contentType: "text/html" });
    });

    return context;
  },
});

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

      const profileMarker = await stat(
        nodePath.join(directory, "browser-profile", ".bebu-profile")
      );

      assert.equal(profileMarker.isFile(), true);
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
      assert.deepEqual(await authStatus(), {
        authenticated: false,
        profile: {
          locked: false,
          path: nodePath.join(directory, "browser-profile"),
          state: "owned",
        },
        state: "signed-out",
      });
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

    const external = runtime(delayedPage, contexts);
    const { launch } = external;
    assert.ok(launch);
    external.launch = async (profile, options) => {
      assert.equal(options.headless, false, "manual sign-in must open a visible window");

      return await launch(profile, options);
    };

    const pending = login({ timeoutSeconds: 10 }, external);
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
          launch: () => {
            throw new Error("browser typed fixture-password");
          },
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

      const [context] = contexts;

      if (context !== undefined && context.pages().length > 0) {
        await context.waitForEvent("close", { timeout: 3000 });
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

authTest(
  "automated login submits email and password once and saves only validated tokens",
  async () => {
    const directory = await mkdtemp(nodePath.join(tmpdir(), "bebu-auto-auth-"));
    const previous = process.env.BEBU_SESSION_FILE;
    process.env.BEBU_SESSION_FILE = nodePath.join(directory, "session.json");
    const contexts: BrowserContext[] = [];
    const credentials = { password: "fixture-password", username: "test@example.com" };
    const seedScript = /<script>(?<script>[\s\S]*)<\/script>/u.exec(signedInPage)?.groups?.script;
    assert.ok(seedScript !== undefined && seedScript !== "");

    const html = `<!doctype html><button id="welcome">Continue with email</button><script>
    document.querySelector('#welcome').onclick=()=>{
      document.body.innerHTML='<label>Email<input aria-label="Email"></label><button>Continue</button>';
      document.querySelector('button').onclick=()=>{
        if(document.querySelector('input').value!=='test@example.com')throw Error('wrong email');
        document.body.innerHTML='<input type="password" aria-label="Password"><button>Sign in</button>';
        document.querySelector('button').onclick=async()=>{
          if(document.querySelector('input').value!=='fixture-password')throw Error('wrong password');
          await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fixture',{method:'POST',body:'{}'});
          document.body.innerHTML='Signed in';
          ${seedScript}
        };
      };
    };
  </script>`;

    try {
      const external = runtime(html, contexts);
      external.credentials = async () => {
        await Promise.resolve();

        return credentials;
      };

      const { launch } = external;
      assert.ok(launch);
      external.launch = async (profile, options) => {
        assert.equal(
          options.headless,
          false,
          "configured credentials must not hide the login window"
        );

        return await launch(profile, options);
      };

      const session = await login({ timeoutSeconds: 10 }, external);
      assert.equal(session.uid, "fixture-user");
      const stored = await readFile(nodePath.join(directory, "session.json"), "utf-8");
      assert.ok(!stored.includes(credentials.password));
      assert.ok(!stored.includes("fixture-refresh-token"));
    } finally {
      for (const context of contexts) {
        await context.close();
      }

      if (previous === undefined) {
        delete process.env.BEBU_SESSION_FILE;
      } else {
        process.env.BEBU_SESSION_FILE = previous;
      }

      await rm(directory, { force: true, recursive: true });
    }
  }
);

authTest(
  "an unavailable automatic sign-in control leaves the browser open for manual login",
  async () => {
    const directory = await mkdtemp(nodePath.join(tmpdir(), "bebu-manual-fallback-"));
    const previous = process.env.BEBU_SESSION_FILE;
    process.env.BEBU_SESSION_FILE = nodePath.join(directory, "session.json");
    const contexts: BrowserContext[] = [];
    const messages: string[] = [];
    const seedScript = /<script>(?<script>[\s\S]*)<\/script>/u.exec(signedInPage)?.groups?.script;
    assert.ok(seedScript !== undefined && seedScript !== "");

    try {
      const external = runtime(
        `<!doctype html><input aria-label="Email"><button>Continue</button><script>
        document.querySelector('button').onclick=()=>{
          document.body.innerHTML='<input type="password" aria-label="Password"><button id="emailSignIn.submit" hidden>Sign in</button>';
        };
      </script>`,
        contexts
      );

      external.credentials = async () =>
        await Promise.resolve({ password: "fixture-password", username: "test@example.com" });

      const session = await login(
        {
          progress: (message) => {
            messages.push(message);

            if (message.includes("continue signing in manually")) {
              const page = contexts[0]?.pages()[0];
              assert.ok(page && !page.isClosed());
              void page.evaluate(seedScript);
            }
          },
          timeoutSeconds: 10,
        },
        external
      );

      assert.equal(session.uid, "fixture-user");
      assert.equal(
        messages.filter((message) => message.includes("continue signing in manually")).length,
        1
      );
      assert.ok(!messages.join(" ").includes("fixture-password"));
    } finally {
      for (const context of contexts) {
        await context.close();
      }

      if (previous === undefined) {
        delete process.env.BEBU_SESSION_FILE;
      } else {
        process.env.BEBU_SESSION_FILE = previous;
      }

      await rm(directory, { force: true, recursive: true });
    }
  }
);

authTest(
  "CDP browser supports auth without closing agent tabs and stop releases the profile lock",
  async () => {
    const directory = await mkdtemp(nodePath.join(tmpdir(), "bebu-control-"));
    const previous = process.env.BEBU_SESSION_FILE;
    process.env.BEBU_SESSION_FILE = nodePath.join(directory, "session.json");
    const ready = Promise.withResolvers<undefined>();
    const controller = new AbortController();
    const contexts: BrowserContext[] = [];
    let endpoint = "";

    const serving = runBrowser(
      {
        ready: (status) => {
          ({ endpoint } = status);
          ready.resolve();
        },
        signal: controller.signal,
      },
      async (profile, options) => {
        const external = runtime(signedInPage, contexts);
        assert.ok(external.launch);

        const context = await launchBrowser(profile, { ...options, headless: true });

        contexts.push(context);
        await context.route("**/*", async (route) => {
          await route.fulfill({ body: signedInPage, contentType: "text/html" });
        });

        return context;
      }
    );

    const started = (async () => {
      try {
        await serving;
      } catch (error) {
        ready.reject(error);
        throw error;
      }
    })();

    try {
      await Promise.race([ready.promise, started]);
      assert.match(endpoint, /^http:\/\/127\.0\.0\.1:\d+$/u);
      const status = await browserStatus();
      assert.equal(status.running, true);
      const stateFile = nodePath.join(directory, "browser.json");
      const originalState = await readFile(stateFile, "utf-8");
      await writeFile(
        stateFile,
        originalState.replace("/devtools/browser/", "/devtools/browser/not-owned-")
      );
      assert.deepEqual(await browserStatus(), { running: false });
      await writeFile(stateFile, originalState);

      const connection = await chromium.connectOverCDP(endpoint);

      try {
        const [context] = connection.contexts();
        assert.ok(context);
        const [tab] = context.pages();
        assert.ok(tab);
        const { fetcher, credentials } = runtime(signedInPage, []);

        const session = await login(
          { headless: true, timeoutSeconds: 5 },
          { credentials, fetcher }
        );

        assert.equal(session.uid, "fixture-user");
        assert.equal(tab.isClosed(), false);
        assert.equal(context.pages().length, 1);
        await assert.rejects(login({ timeoutSeconds: 5 }, { credentials, fetcher }), /headless/u);
        assert.equal(tab.isClosed(), false);
        await assert.rejects(logout(), /Another browser login/u);
        assert.deepEqual(await stopBrowser(), { stopped: true });
        await started;
        assert.deepEqual(await browserStatus(), { running: false });
        await assert.rejects(stat(nodePath.join(directory, "browser-profile.lock")));
      } finally {
        await connection.close();
      }
    } finally {
      controller.abort();
      await started;

      if (previous === undefined) {
        delete process.env.BEBU_SESSION_FILE;
      } else {
        process.env.BEBU_SESSION_FILE = previous;
      }

      await rm(directory, { force: true, recursive: true });
    }
  }
);

authTest(
  "sign-in follows Compose shadow semantics and clicks through transparent controls",
  async () => {
    const directory = await mkdtemp(nodePath.join(tmpdir(), "bebu-compose-"));
    const context = await launchBrowser(directory, { headless: true, timeout: 30_000 });
    const [profile] = context.pages();
    assert.ok(profile);

    try {
      await context.route("**/*", async (route) => {
        await route.fulfill({
          body: `<!doctype html><div id="app"></div><script>
      const root = document.querySelector('#app').attachShadow({mode:'open'});
      const styles = '<style>.actual,.semantics{position:absolute;left:20px;top:20px;width:200px;height:40px}.semantics{opacity:0;pointer-events:none}button{top:100px!important}</style>';
      const email = () => {
        root.innerHTML=styles+'<input class="actual" aria-hidden="true"><button class="actual" aria-hidden="true"></button><div class="semantics" role="textbox" aria-label="Email" contenteditable="true"></div><div class="semantics" role="button" style="top:100px">Continue</div>';
        root.querySelector('button').onclick=()=>{
          document.documentElement.dataset.emailValue=root.querySelector('input').value;
          root.innerHTML=styles+'<input class="actual" aria-hidden="true"><button class="actual" aria-hidden="true"></button><div class="semantics" role="textbox" aria-label="Password" contenteditable="true"></div><div class="semantics" role="button" style="top:100px">Sign in</div>';
          root.querySelector('button').onclick=()=>{document.documentElement.dataset.passwordValue=root.querySelector('input').value;document.documentElement.dataset.attempts=String(Number(document.documentElement.dataset.attempts||0)+1);fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fixture',{method:'POST',body:'{}'});};
        };
      };
      root.innerHTML=styles+'<button class="actual" aria-hidden="true"></button><div class="semantics" role="button" style="top:100px">Continue with email</div>';
      root.querySelector('button').onclick=email;
    </script>`,
          contentType: "text/html",
        });
      });
      await profile.goto("https://app.beyondbudgetapp.com");
      const state = {};
      const credentials = { password: "fixture-password", username: "fixture@example.com" };
      await advanceSignIn(profile, credentials, state);
      await advanceSignIn(profile, credentials, state);
      await advanceSignIn(profile, credentials, state);
      await advanceSignIn(profile, credentials, state);
      assert.deepEqual(
        await profile.evaluate(
          "({email:document.documentElement.dataset.emailValue,password:document.documentElement.dataset.passwordValue,attempts:Number(document.documentElement.dataset.attempts)})"
        ),
        { attempts: 1, email: "fixture@example.com", password: "fixture-password" }
      );
      await profile.goto("https://example.org");
      const foreignState = {};
      await advanceSignIn(profile, credentials, foreignState);
      assert.deepEqual(foreignState, {});
      assert.deepEqual(state, {
        emailSubmitted: true,
        opened: true,
        passwordAttempted: true,
        passwordSubmitted: true,
      });
    } finally {
      await context.close();
      await rm(directory, { force: true, recursive: true });
    }
  }
);

authTest(
  "a CDP port served by another browser is rejected before its endpoint is published",
  async () => {
    const directory = await mkdtemp(nodePath.join(tmpdir(), "bebu-wrong-port-"));
    const previous = process.env.BEBU_SESSION_FILE;
    process.env.BEBU_SESSION_FILE = nodePath.join(directory, "session.json");

    const endpoint = createServer((request, response) => {
      const value =
        request.url === "/json/version"
          ? { webSocketDebuggerUrl: "ws://127.0.0.1/devtools/browser/other" }
          : [{ id: "unrelated-target" }];

      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(value));
    });

    const listening = Promise.withResolvers<undefined>();
    endpoint.once("error", (error) => {
      listening.reject(error);
    });
    endpoint.listen(0, "127.0.0.1", () => {
      listening.resolve();
    });

    try {
      await listening.promise;
      const address = z.object({ port: z.number().int().positive() }).parse(endpoint.address());
      await assert.rejects(
        runBrowser(
          {
            port: address.port,
            ready: () => {
              assert.fail("An unrelated CDP endpoint must never be published");
            },
          },
          async (profile, options) => await launchBrowser(profile, { ...options, port: 0 })
        ),
        /belongs to another browser/u
      );
      assert.deepEqual(await browserStatus(), { running: false });
      await assert.rejects(stat(nodePath.join(directory, "browser.json")));
      await assert.rejects(stat(nodePath.join(directory, "browser-profile.lock")));
    } finally {
      endpoint.closeAllConnections();
      const closed = Promise.withResolvers<undefined>();
      endpoint.close(() => {
        closed.resolve();
      });
      await closed.promise;

      if (previous === undefined) {
        delete process.env.BEBU_SESSION_FILE;
      } else {
        process.env.BEBU_SESSION_FILE = previous;
      }

      await rm(directory, { force: true, recursive: true });
    }
  }
);

authTest(
  "blocked browser verification reports the visible auth command without exposing credentials",
  async () => {
    const directory = await mkdtemp(nodePath.join(tmpdir(), "bebu-verification-"));
    const previous = process.env.BEBU_SESSION_FILE;
    process.env.BEBU_SESSION_FILE = nodePath.join(directory, "session.json");
    const contexts: BrowserContext[] = [];
    const external = runtime('<button id="attestationTryAgain">Try again</button>', contexts);
    external.credentials = async () => {
      await Promise.resolve();

      return { password: "fixture-private-password", username: "fixture@example.com" };
    };

    try {
      await assert.rejects(
        login({ headless: true, timeoutSeconds: 5 }, external),
        (error: Error) => {
          assert.match(error.message, /could not verify this browser/u);
          assert.match(error.message, /Run bebu auth/u);
          assert.ok(!error.message.includes("fixture-private-password"));

          return true;
        }
      );
      await assert.rejects(stat(nodePath.join(directory, "session.json")));
    } finally {
      for (const context of contexts) {
        await context.close();
      }

      if (previous === undefined) {
        delete process.env.BEBU_SESSION_FILE;
      } else {
        process.env.BEBU_SESSION_FILE = previous;
      }

      await rm(directory, { force: true, recursive: true });
    }
  }
);

void test(
  "the headed browser renders WebGL2 pixels for the native app",
  {
    skip:
      process.platform === "linux" &&
      (process.env.DISPLAY ?? "").length === 0 &&
      (process.env.WAYLAND_DISPLAY ?? "").length === 0,
    timeout: 15_000,
  },
  async () => {
    const directory = await mkdtemp(nodePath.join(tmpdir(), "bebu-webgl-"));
    const context = await launchBrowser(directory, { headless: false, timeout: 10_000 });

    try {
      const [page] = context.pages();
      assert.ok(page);

      const pixel = await page.evaluate(() => {
        const gl = document.createElement("canvas").getContext("webgl2");

        if (!gl) {
          return null;
        }

        gl.clearColor(0.25, 0.5, 0.75, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        const data = new Uint8Array(4);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, data);

        return [...data];
      });

      assert.deepEqual(pixel, [64, 128, 191, 255]);
    } finally {
      await context.close();
      await rm(directory, { force: true, recursive: true });
    }
  }
);

authTest(
  "a rejected sign-in request cannot be reported as submitted or become a session timeout",
  async () => {
    const directory = await mkdtemp(nodePath.join(tmpdir(), "bebu-login-rejection-"));
    const context = await launchBrowser(directory, { headless: true, timeout: 10_000 });

    try {
      await context.route("**/*", async (route) => {
        if (new URL(route.request().url()).hostname === "identitytoolkit.googleapis.com") {
          await route.fulfill({
            json: { error: { code: 400, message: "INVALID_LOGIN_CREDENTIALS" } },
            status: 400,
          });

          return;
        }

        await route.fulfill({
          body: `<!doctype html><input aria-label="Password"><button>Continue</button><button id="emailSignIn.submit">Sign in</button><script>
        document.getElementById('emailSignIn.submit').onclick=()=>fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fixture',{method:'POST',body:JSON.stringify({email:'fixture@example.com',password:document.querySelector('input').value})});
      </script>`,
          contentType: "text/html",
        });
      });
      const [page] = context.pages();
      assert.ok(page);
      await page.goto("https://app.beyondbudgetapp.com");
      const state = { emailSubmitted: true, opened: true, passwordSubmitted: false };
      await assert.rejects(
        advanceSignIn(
          page,
          { password: "fixture-password", username: "fixture@example.com" },
          state
        ),
        /rejected the email or password/u
      );
      assert.equal(state.passwordSubmitted, false);
    } finally {
      await context.close();
      await rm(directory, { force: true, recursive: true });
    }
  }
);

authTest(
  "a missed form submission stays available for manual completion without automatic retries",
  async () => {
    const directory = await mkdtemp(nodePath.join(tmpdir(), "bebu-login-no-request-"));
    const context = await launchBrowser(directory, { headless: true, timeout: 10_000 });

    try {
      await context.route("**/*", async (route) => {
        await route.fulfill({
          body: `<!doctype html><input aria-label="Password"><button id="emailSignIn.submit">Sign in</button><script>
        document.getElementById('emailSignIn.submit').onclick=()=>{document.body.dataset.clicks=String(Number(document.body.dataset.clicks||0)+1);};
      </script>`,
          contentType: "text/html",
        });
      });
      const [page] = context.pages();
      assert.ok(page);
      await page.goto("https://app.beyondbudgetapp.com");
      const state = { emailSubmitted: true, opened: true, passwordSubmitted: false };
      const messages: string[] = [];
      const credentials = { password: "fixture-password", username: "fixture@example.com" };
      await advanceSignIn(page, credentials, state, (message) => {
        messages.push(message);
      });
      await advanceSignIn(page, credentials, state, (message) => {
        messages.push(message);
      });
      assert.equal(state.passwordSubmitted, false);
      assert.equal(await page.locator("body").getAttribute("data-clicks"), "1");
      assert.equal(page.isClosed(), false);
      assert.equal(
        messages.filter((message) => message.includes("no sign-in request was sent")).length,
        1
      );
    } finally {
      await context.close();
      await rm(directory, { force: true, recursive: true });
    }
  }
);

authTest(
  "forced login recovers an exited owner lock and captures a session without clearing the profile",
  async () => {
    const directory = await mkdtemp(nodePath.join(tmpdir(), "bebu-force-login-"));
    const previous = process.env.BEBU_SESSION_FILE;
    process.env.BEBU_SESSION_FILE = nodePath.join(directory, "session.json");
    const contexts: BrowserContext[] = [];

    try {
      const child = spawnSync(process.execPath, ["-e", ""]);
      assert.equal(child.status, 0);
      await writeFile(nodePath.join(directory, "browser-profile.lock"), String(child.pid));

      const session = await login(
        { force: true, headless: true, timeoutSeconds: 10 },
        runtime(signedInPage, contexts)
      );

      assert.equal(session.uid, "fixture-user");
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

      await rm(directory, { force: true, recursive: true });
    }
  }
);
