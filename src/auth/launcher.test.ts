import { expect, test, spyOn } from "bun:test";
import assert from "node:assert/strict";

import { chromium } from "patchright";

import { launchBrowser } from "./launcher.ts";

test("managed browsers launch Patchright with a persistent profile and local CDP", async () => {
  const failure = new Error("fixture launch");
  const launch = spyOn(chromium, "launchPersistentContext").mockRejectedValue(failure);

  try {
    await assert.rejects(
      launchBrowser("/fixture/profile", { headless: true, port: 0, timeout: 1234 }),
      (error) => error === failure
    );
    expect(launch.mock.calls[0]).toEqual([
      "/fixture/profile",
      {
        args: [
          "--ignore-gpu-blocklist",
          "--remote-debugging-address=127.0.0.1",
          "--remote-debugging-port=0",
        ],
        handleSIGINT: false,
        handleSIGTERM: false,
        headless: true,
        timeout: 1234,
        viewport: null,
      },
    ]);
  } finally {
    launch.mockRestore();
  }
});
