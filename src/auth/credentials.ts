import { existsSync } from "node:fs";
import nodePath from "node:path";

import { load } from "varlock";

export class CredentialError extends Error {
  override name = "CredentialError";
}

export interface Credentials {
  username: string;
  password: string;
}

export const loadCredentials = async (): Promise<Credentials | undefined> => {
  // Installed CLIs also accept exported variables without a project-local schema.
  if (existsSync(nodePath.resolve(".env.schema"))) {
    try {
      await load();
    } catch {
      throw new CredentialError(
        "Cannot load sign-in configuration. Check .env.schema with varlock load --agent"
      );
    }
  }

  const username = process.env.BEBU_USERNAME ?? "";
  const password = process.env.BEBU_PASSWORD ?? "";

  if (!username && !password) {
    return undefined;
  }

  if (!username || !password) {
    throw new CredentialError("Set both BEBU_USERNAME and BEBU_PASSWORD for automated sign-in");
  }

  return { password, username };
};
