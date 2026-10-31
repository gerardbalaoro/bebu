import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";

import { profilePath, withBrowserProfile } from "./browser.ts";
import { logout } from "./login.ts";

test("logout clears owned browser credentials while preserving other configuration files", async () => {
  const directory = await mkdtemp(nodePath.join(tmpdir(), "bebu-logout-"));
  const previous = process.env.BEBU_SESSION_FILE;
  process.env.BEBU_SESSION_FILE = nodePath.join(directory, "session.json");

  try {
    await withBrowserProfile(async (profile) => {
      await writeFile(nodePath.join(profile, "browser-credentials"), "fixture");
    });
    await writeFile(nodePath.join(directory, "session.json"), "{}");
    await writeFile(nodePath.join(directory, "preferences.json"), "preserve");
    await logout();
    await assert.rejects(stat(nodePath.join(directory, "session.json")));
    await assert.rejects(stat(profilePath()));
    expect(await readFile(nodePath.join(directory, "preferences.json"), "utf-8")).toBe("preserve");
  } finally {
    if (previous === undefined) {
      delete process.env.BEBU_SESSION_FILE;
    } else {
      process.env.BEBU_SESSION_FILE = previous;
    }

    await rm(directory, { force: true, recursive: true });
  }
});

test("login and logout refuse a browser profile that bebu does not own", async () => {
  const directory = await mkdtemp(nodePath.join(tmpdir(), "bebu-profile-"));
  const previous = process.env.BEBU_SESSION_FILE;
  process.env.BEBU_SESSION_FILE = nodePath.join(directory, "session.json");

  try {
    await mkdir(profilePath());
    await writeFile(nodePath.join(profilePath(), "existing-data"), "preserve");
    await assert.rejects(
      withBrowserProfile(async () => await Promise.resolve("unexpected")),
      /does not own/u
    );
    await assert.rejects(logout(), /does not own/u);
    expect(await readFile(nodePath.join(profilePath(), "existing-data"), "utf-8")).toBe("preserve");
  } finally {
    if (previous === undefined) {
      delete process.env.BEBU_SESSION_FILE;
    } else {
      process.env.BEBU_SESSION_FILE = previous;
    }

    await rm(directory, { force: true, recursive: true });
  }
});

test("a second browser operation cannot race an active login or erase its profile", async () => {
  const directory = await mkdtemp(nodePath.join(tmpdir(), "bebu-profile-lock-"));
  const previous = process.env.BEBU_SESSION_FILE;
  process.env.BEBU_SESSION_FILE = nodePath.join(directory, "session.json");

  try {
    await withBrowserProfile(async () => {
      await assert.rejects(logout(), /Another browser login/u);
    });
    await assert.rejects(
      withBrowserProfile(() => {
        throw new Error("fixture failure");
      }),
      /fixture failure/u
    );
    expect(await withBrowserProfile(async () => await Promise.resolve("released"))).toBe(
      "released"
    );
  } finally {
    if (previous === undefined) {
      delete process.env.BEBU_SESSION_FILE;
    } else {
      process.env.BEBU_SESSION_FILE = previous;
    }

    await rm(directory, { force: true, recursive: true });
  }
});
