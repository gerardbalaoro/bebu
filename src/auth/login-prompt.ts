import type { Writable } from "node:stream";

import { cancel, intro, log, note, outro, spinner } from "@clack/prompts";

import { login } from "./login.ts";
import type { LoginOptions } from "./login.ts";
import type { Session } from "./session.ts";

export const signedInMessage = (session: Session): string => {
  const name =
    [session.displayName, session.email]
      .map((value) => value?.trim())
      .find((value) => value !== undefined && value !== "") ?? session.uid;

  return `Signed in as ${name}`;
};

export const loginWithPrompts = async (
  options: LoginOptions,
  output: Writable = process.stderr
): Promise<Session> => {
  const display = { output };
  const status = spinner({ ...display, cancelMessage: "Sign-in cancelled" });
  intro("bebu · Beyond Budget", display);

  try {
    const session = await login({
      ...options,
      progress: (message) => {
        status.clear();
        log.step(message, display);
        status.start("Connecting to Beyond Budget");
      },
    });

    status.stop(signedInMessage(session));

    if (session.selectedBudgetName !== undefined && session.selectedBudgetName !== "") {
      log.success(`Selected budget: ${session.selectedBudgetName}`, display);
    }

    note("bebu accounts list", "Read your accounts", display);
    outro("You're all set!", display);

    return session;
  } catch (error) {
    status.clear();
    cancel(options.signal?.aborted === true ? "Sign-in cancelled" : "Sign-in failed", display);

    throw error;
  }
};
