import { lstat, mkdir, open, readFile, readdir, rm, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import nodePath from "node:path";

import { sessionPath } from "./session.ts";

const profileSignature = "bebu browser profile v1\n";
const ownershipFile = ".bebu-profile";

export class BrowserSetupError extends Error {
  override name = "BrowserSetupError";
}

export const profilePath = (): string =>
  nodePath.join(nodePath.dirname(sessionPath()), "browser-profile");

const existingFile = async (name: string) => {
  try {
    return await lstat(name);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
};

export const browserProfileStatus = async () => {
  const path = profilePath();

  const [info, lock] = await Promise.all([existingFile(path), existingFile(`${path}.lock`)]);
  let state: "missing" | "owned" | "unrecognized" = "missing";

  if (info !== null) {
    state = "unrecognized";

    if (info.isDirectory() && !info.isSymbolicLink()) {
      try {
        if ((await readFile(nodePath.join(path, ownershipFile), "utf-8")) === profileSignature) {
          state = "owned";
        }
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
          throw error;
        }
      }
    }
  }

  return { locked: lock !== null, path, state };
};

const ensureOwnedProfile = async (profile: string): Promise<void> => {
  await mkdir(profile, { mode: 0o700, recursive: true });
  const info = await lstat(profile);

  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new BrowserSetupError("The browser profile must be a directory owned by bebu");
  }

  const entries = await readdir(profile);

  if (entries.length === 0) {
    await writeFile(nodePath.join(profile, ownershipFile), profileSignature, { mode: 0o600 });
  }

  let signature: string;

  try {
    signature = await readFile(nodePath.join(profile, ownershipFile), "utf-8");
  } catch {
    throw new BrowserSetupError(
      "bebu does not own this browser profile. Use a different BEBU_HOME directory"
    );
  }

  if (signature !== profileSignature) {
    throw new BrowserSetupError("bebu does not own this browser profile");
  }
};

const lockError = (path: string): BrowserSetupError =>
  new BrowserSetupError(
    `Another browser login is active, or the profile directory does not accept writes. If the previous process exited, run bebu auth --force to recover ${path}`
  );

const createProfileLock = async (path: string): Promise<FileHandle> => {
  try {
    return await open(path, "wx", 0o600);
  } catch {
    throw lockError(path);
  }
};

const acquireProfileLock = async (path: string, force: boolean): Promise<FileHandle> => {
  try {
    return await open(path, "wx", 0o600);
  } catch (error) {
    if (!force || !(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") {
      throw lockError(path);
    }
  }

  // Serialize recovery so two --force invocations cannot unlink each other's new lock.
  const recoveryPath = `${path}.recovery`;

  const recovery = await open(recoveryPath, "wx", 0o600).catch(() => {
    throw new BrowserSetupError(
      `Profile lock recovery is already active, or writes are denied. After a recovery process crashes, remove ${recoveryPath}`
    );
  });

  try {
    let owner: string;

    try {
      const contents = await readFile(path, "utf-8");
      owner = contents.trim();
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return await createProfileLock(path);
      }

      throw new BrowserSetupError("Cannot read the profile lock owner. The lock was preserved");
    }

    const pid = Number(owner);

    if (!/^\d+$/u.test(owner) || !Number.isSafeInteger(pid) || pid <= 0 || pid > 2_147_483_647) {
      throw new BrowserSetupError("Cannot confirm the profile lock owner. The lock was preserved");
    }

    let exited = false;

    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ESRCH") {
        exited = true;
      } else {
        throw new BrowserSetupError("Cannot check the profile lock owner. The lock was preserved");
      }
    }

    if (!exited) {
      throw new BrowserSetupError(
        `Login process ${pid} is still running. Close that login before retrying; --force only recovers locks from exited processes`
      );
    }

    await rm(path);

    return await createProfileLock(path);
  } finally {
    await recovery.close();
    await rm(recoveryPath, { force: true });
  }
};

export const withBrowserProfile = async <T>(
  operation: (profile: string) => Promise<T>,
  options: { force?: boolean } = {}
): Promise<T> => {
  const profile = profilePath();
  await mkdir(nodePath.dirname(profile), { mode: 0o700, recursive: true });
  const lockPath = `${profile}.lock`;
  const lock = await acquireProfileLock(lockPath, options.force === true);

  try {
    await lock.writeFile(String(process.pid));
    await ensureOwnedProfile(profile);

    return await operation(profile);
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
  }
};

export const removeBrowserProfile = async (profile: string): Promise<void> => {
  if (nodePath.resolve(profile) !== nodePath.resolve(profilePath())) {
    throw new BrowserSetupError(
      "The profile is outside the bebu data folder. bebu cannot delete it"
    );
  }

  await ensureOwnedProfile(profile);
  await rm(profile, { maxRetries: 10, recursive: true, retryDelay: 100 });
};
