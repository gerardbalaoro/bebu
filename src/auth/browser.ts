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

export const withBrowserProfile = async <T>(
  operation: (profile: string) => Promise<T>
): Promise<T> => {
  const profile = profilePath();
  await mkdir(nodePath.dirname(profile), { mode: 0o700, recursive: true });
  const lockPath = `${profile}.lock`;
  let lock: FileHandle;

  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch {
    throw new BrowserSetupError(
      `Another browser login is active, or the profile directory does not accept writes. If the previous process crashed, delete ${lockPath}`
    );
  }

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
