import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";

import { profilePath } from "./auth/browser.ts";
import { saveSession, sessionPath } from "./auth/session.ts";
import { dataHome } from "./state.ts";

test("the default data home belongs to bebu without the nodejs suffix", () => {
  const previous = process.env.BEBU_HOME;
  delete process.env.BEBU_HOME;

  try {
    if (process.platform === "win32") {
      expect(dataHome()).toBe(nodePath.join(process.env.LOCALAPPDATA ?? "", "bebu", "Data"));
    } else if (process.platform === "darwin") {
      expect(dataHome()).toEndWith("Library/Application Support/bebu");
    } else {
      expect(dataHome()).toEndWith("/bebu");
      expect(dataHome()).not.toEndWith("bebu-nodejs");
    }
  } finally {
    if (previous === undefined) {
      delete process.env.BEBU_HOME;
    } else {
      process.env.BEBU_HOME = previous;
    }
  }
});

test("BEBU_HOME places saved sessions and owned browser state in the same data folder", async () => {
  const directory = await mkdtemp(nodePath.join(tmpdir(), "bebu-home-"));
  const previous = process.env.BEBU_HOME;
  const previousSession = process.env.BEBU_SESSION_FILE;
  process.env.BEBU_HOME = directory;
  delete process.env.BEBU_SESSION_FILE;

  try {
    expect(dataHome()).toBe(directory);
    expect(sessionPath()).toBe(nodePath.join(directory, "session.json"));
    expect(profilePath()).toBe(nodePath.join(directory, "browser-profile"));
    await saveSession({
      budgetIds: [],
      expiresAt: 4_102_444_800_000,
      idToken: "fixture-token",
      importedAt: "2026-01-01T00:00:00Z",
      projectId: "beyond-budget",
      stashes: [],
      uid: "fixture",
      version: 1,
    });
    expect(JSON.parse(await readFile(nodePath.join(directory, "session.json"), "utf-8")).uid).toBe(
      "fixture"
    );
  } finally {
    if (previous === undefined) {
      delete process.env.BEBU_HOME;
    } else {
      process.env.BEBU_HOME = previous;
    }

    if (previousSession === undefined) {
      delete process.env.BEBU_SESSION_FILE;
    } else {
      process.env.BEBU_SESSION_FILE = previousSession;
    }

    await rm(directory, { force: true, recursive: true });
  }
});
