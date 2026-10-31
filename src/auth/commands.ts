import { defineCommand } from "@crustjs/core";

import { compactFlag, payload, print } from "../cli/io.ts";
import { loginWithPrompts, signedInMessage } from "./login-prompt.ts";
import { authStatus, login, logout } from "./login.ts";
import {
  importSealed,
  loadSession,
  parsePlaywrightState,
  PlaywrightStateSchema,
  prepareSealedImport,
  readAgentBrowser,
  saveSession,
} from "./session.ts";

export const authCommand = defineCommand(
  "auth",
  { description: "Sign in through your browser and manage the saved connection" },
  (command) =>
    command
      .add(
        defineCommand(
          "login",
          {
            description: "Connect through your Chrome session. If necessary, wait for sign-in",
            sections: [
              {
                body: "bebu auth login\nbebu auth login --fresh\nbebu auth status\n\nTo reuse your Chrome session:\n1. Enable chrome://inspect/#remote-debugging.\n2. Approve the connection prompt.\n3. If the app requires sign-in, sign in.\n4. Open your budget.",
                title: "Examples",
              },
            ],
          },
          (leaf) =>
            leaf
              .flags(
                {
                  description: "Use the separate saved browser profile for bebu",
                  name: "fresh",
                  type: "boolean",
                },
                {
                  description: "Use the separate saved browser profile without a visible window",
                  name: "headless",
                  type: "boolean",
                },
                {
                  default: 300,
                  description: "Wait 1 to 3600 seconds for sign-in",
                  name: "timeout",
                  type: "number",
                }
              )
              .action(async ({ flags, signal, stdout, stderr }) => {
                const options = {
                  fresh: flags.fresh,
                  headless: flags.headless,
                  signal,
                  timeoutSeconds: flags.timeout,
                };

                if (process.stdout.isTTY && process.stderr.isTTY) {
                  await loginWithPrompts(options);

                  return;
                }

                const session = await login({ ...options, progress: stderr });

                stdout(
                  `${signedInMessage(session)}${session.selectedBudgetName !== undefined && session.selectedBudgetName !== "" ? `\nSelected budget: ${session.selectedBudgetName}` : ""}\n\nRead your accounts:\n  bebu accounts list`
                );
              })
        )
      )
      .add(
        defineCommand(
          "status",
          { aliases: ["whoami"], description: "Show saved connection state as JSON" },
          (leaf) =>
            leaf.action(async ({ stdout }) => {
              print(stdout, await authStatus());
            })
        )
      )
      .add(
        defineCommand(
          "logout",
          {
            description:
              "Delete local credentials and the separate bebu profile. Your Chrome profile stays intact",
          },
          (leaf) =>
            leaf.action(async ({ stdout }) => {
              await logout();
              print(stdout, { authenticated: false, loggedOut: true });
            })
        )
      )
);

export const sessionCommand = defineCommand(
  "session",
  { description: "Import authentication from a signed-in browser" },
  (command) =>
    command
      .add(
        defineCommand(
          "prepare",
          {
            description: "Prepare an encrypted session handoff without credentials in the output",
          },
          (leaf) =>
            leaf
              .flags(compactFlag, {
                description: "Write the browser expression to this file",
                name: "out",
                type: "string",
              })
              .action(async ({ flags, stdout }) => {
                print(stdout, await prepareSealedImport(flags.out), flags.compact);
              })
        )
      )
      .add(
        defineCommand(
          "import",
          {
            description: "Import one session source. Playwright state must include IndexedDB",
          },
          (leaf) =>
            leaf
              .flags(
                compactFlag,
                {
                  description: "Read the encrypted handoff from this JSON file",
                  name: "sealed",
                  type: "string",
                },
                {
                  description: "Use this named agent-browser session with an active login",
                  name: "agent-browser",
                  type: "string",
                },
                {
                  description: "Read Playwright storageState JSON that includes IndexedDB",
                  name: "playwright-state",
                  type: "string",
                }
              )
              .action(async ({ flags, stdout }) => {
                const sources = [
                  flags.sealed,
                  flags["agent-browser"],
                  flags["playwright-state"],
                ].filter((value) => value !== undefined);

                if (sources.length !== 1) {
                  throw new Error(
                    "Specify exactly one of --sealed, --agent-browser, --playwright-state"
                  );
                }

                if (flags.sealed !== undefined && flags.sealed !== "") {
                  print(stdout, await importSealed(flags.sealed), flags.compact);

                  return;
                }

                const session =
                  flags["agent-browser"] !== undefined && flags["agent-browser"] !== ""
                    ? await readAgentBrowser(flags["agent-browser"])
                    : parsePlaywrightState(
                        await payload(flags["playwright-state"] ?? "", PlaywrightStateSchema)
                      );

                print(stdout, await saveSession(session), flags.compact);
              })
        )
      )
      .add(
        defineCommand(
          "status",
          { description: "Show session expiry and budget IDs without credentials" },
          (leaf) =>
            leaf.flags(compactFlag).action(async ({ flags, stdout }) => {
              const session = await loadSession();
              print(
                stdout,
                {
                  appCheckExpiresAt:
                    session.appCheckExpiresAt !== undefined && session.appCheckExpiresAt !== 0
                      ? new Date(session.appCheckExpiresAt).toISOString()
                      : null,
                  authenticated: true,
                  budgets: session.budgetIds,
                  expiresAt: new Date(session.expiresAt).toISOString(),
                },
                flags.compact
              );
            })
        )
      )
);
