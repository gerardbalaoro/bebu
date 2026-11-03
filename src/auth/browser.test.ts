import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";

import { profilePath, withBrowserProfile } from "./browser.ts";
import { authStatus, logout } from "./login.ts";

test("status locates the saved profile and reports an active profile lock while signed out", async () => {
  const directory = await mkdtemp(nodePath.join(tmpdir(), "bebu-status-"));
  const previous = process.env.BEBU_SESSION_FILE;
  process.env.BEBU_SESSION_FILE = nodePath.join(directory, "session.json");

  try {
    const initial = await authStatus();
    expect(initial.profile).toEqual({ locked: false, path: profilePath(), state: "missing" });
    await withBrowserProfile(async () => {
      const active = await authStatus();
      expect(active.profile).toEqual({ locked: true, path: profilePath(), state: "owned" });
    });
    const released = await authStatus();
    expect(released.profile.locked).toBe(false);
  } finally {
    if (previous === undefined) {
      delete process.env.BEBU_SESSION_FILE;
    } else {
      process.env.BEBU_SESSION_FILE = previous;
    }

    await rm(directory, { force: true, recursive: true });
  }
});

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
    const status = await authStatus();
    expect(status.profile.state).toBe("unrecognized");
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

test("force recovers a lock left by an exited process without deleting the saved profile", async () => {
  const directory = await mkdtemp(nodePath.join(tmpdir(), "bebu-force-stale-"));
  const previous = process.env.BEBU_SESSION_FILE;
  process.env.BEBU_SESSION_FILE = nodePath.join(directory, "session.json");

  try {
    await withBrowserProfile(async (profile) => {
      await writeFile(nodePath.join(profile, "saved-browser-data"), "preserve");
    });
    const child = Bun.spawn([process.execPath, "-e", ""], { stderr: "ignore", stdout: "ignore" });
    await child.exited;
    const lock = `${profilePath()}.lock`;
    await writeFile(lock, String(child.pid));
    await assert.rejects(
      withBrowserProfile(async () => await Promise.resolve("unexpected")),
      /Another browser login/u
    );

    const value = await withBrowserProfile(
      async (profile) => {
        expect(await readFile(lock, "utf-8")).toBe(String(process.pid));

        return await readFile(nodePath.join(profile, "saved-browser-data"), "utf-8");
      },
      { force: true }
    );

    expect(value).toBe("preserve");
    await assert.rejects(stat(lock));
  } finally {
    if (previous === undefined) {
      delete process.env.BEBU_SESSION_FILE;
    } else {
      process.env.BEBU_SESSION_FILE = previous;
    }

    await rm(directory, { force: true, recursive: true });
  }
});

test("force refuses to remove a lock held by a running login", async () => {
  const directory = await mkdtemp(nodePath.join(tmpdir(), "bebu-force-active-"));
  const previous = process.env.BEBU_SESSION_FILE;
  process.env.BEBU_SESSION_FILE = nodePath.join(directory, "session.json");

  try {
    await withBrowserProfile(async () => {
      await assert.rejects(
        withBrowserProfile(async () => await Promise.resolve("unexpected"), { force: true }),
        /still running/u
      );
      expect(await readFile(`${profilePath()}.lock`, "utf-8")).toBe(String(process.pid));
    });
  } finally {
    if (previous === undefined) {
      delete process.env.BEBU_SESSION_FILE;
    } else {
      process.env.BEBU_SESSION_FILE = previous;
    }

    await rm(directory, { force: true, recursive: true });
  }
});

test("force preserves a lock whose owner cannot be identified", async () => {
  const directory = await mkdtemp(nodePath.join(tmpdir(), "bebu-force-unknown-"));
  const previous = process.env.BEBU_SESSION_FILE;
  process.env.BEBU_SESSION_FILE = nodePath.join(directory, "session.json");

  try {
    const path = `${profilePath()}.lock`;
    await writeFile(path, "unknown-owner");
    await assert.rejects(
      withBrowserProfile(async () => await Promise.resolve("unexpected"), { force: true }),
      /Cannot confirm/u
    );
    expect(await readFile(path, "utf-8")).toBe("unknown-owner");
  } finally {
    if (previous === undefined) {
      delete process.env.BEBU_SESSION_FILE;
    } else {
      process.env.BEBU_SESSION_FILE = previous;
    }

    await rm(directory, { force: true, recursive: true });
  }
});

test("concurrent forced recoveries cannot run two operations in the same profile", async () => {
  const directory = await mkdtemp(nodePath.join(tmpdir(), "bebu-force-race-"));
  const previous = process.env.BEBU_SESSION_FILE;
  process.env.BEBU_SESSION_FILE = nodePath.join(directory, "session.json");
  const release = Promise.withResolvers<undefined>();

  try {
    const child = Bun.spawn([process.execPath, "-e", ""], { stderr: "ignore", stdout: "ignore" });
    await child.exited;
    await writeFile(`${profilePath()}.lock`, String(child.pid));
    const started = Promise.withResolvers<undefined>();
    const rejected = Promise.withResolvers<undefined>();
    let active = 0;
    let peak = 0;

    const recover = async () => {
      try {
        return await withBrowserProfile(
          async () => {
            active += 1;
            peak = Math.max(peak, active);
            started.resolve();
            await release.promise;
            active -= 1;

            return "recovered";
          },
          { force: true }
        );
      } catch (error) {
        rejected.resolve();
        throw error;
      }
    };

    const completed = Promise.allSettled([recover(), recover()]);
    await started.promise;
    await rejected.promise;
    release.resolve();
    const results = await completed;
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(peak).toBe(1);
    await assert.rejects(stat(`${profilePath()}.lock`));
    await assert.rejects(stat(`${profilePath()}.lock.recovery`));
  } finally {
    release.resolve();

    if (previous === undefined) {
      delete process.env.BEBU_SESSION_FILE;
    } else {
      process.env.BEBU_SESSION_FILE = previous;
    }

    await rm(directory, { force: true, recursive: true });
  }
});
