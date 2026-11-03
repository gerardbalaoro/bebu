import { defineCommand } from "@crustjs/core";
import type { CrustCommandContext } from "@crustjs/core";

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

const LoginFlags = [
  {
    description: "Recover a stale profile lock after its login process has exited",
    name: "force",
    type: "boolean",
  },
  {
    description: "Launch the saved profile directly; requires bebu browser to be stopped",
    name: "fresh",
    type: "boolean",
  },
  {
    description: "Run without a visible window",
    name: "headless",
    type: "boolean",
  },
  {
    description: "Show the browser for manual sign-in or challenges",
    name: "headed",
    type: "boolean",
  },
  {
    default: 300,
    description: "Wait 1 to 3600 seconds for sign-in",
    name: "timeout",
    type: "number",
  },
] as const;

type LoginContext = CrustCommandContext<
  [],
  {
    [Flag in (typeof LoginFlags)[number] as Flag["name"]]: Flag;
  }
>;

const runLogin = async ({ flags, signal, stdout, stderr }: LoginContext) => {
  let headless: boolean | undefined;

  if (flags.headed === true) {
    headless = false;
  } else if (flags.headless === true) {
    headless = true;
  }

  const options = {
    force: flags.force,
    fresh: flags.fresh,
    headless: headless ?? false,
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
};

export const authCommand = defineCommand(
  "auth",
  {
    description: "Open the browser, sign in automatically when configured, and save the connection",
  },
  (command) =>
    command
      .flags(...LoginFlags)
      .action(runLogin)
      .add(
        defineCommand(
          "login",
          {
            description: "Sign in with configured credentials through Patchright",
            sections: [
              {
                body: "Set BEBU_USERNAME and BEBU_PASSWORD in .env beside .env.schema, or export them.\n\nbebu auth\nbebu auth login\nbebu auth status\n\nThe browser is visible by default. Both configured credentials are entered automatically. Otherwise, complete sign-in manually. bebu detects completion and validates budget access.",
                title: "Examples",
              },
            ],
          },
          (leaf) => leaf.flags(...LoginFlags).action(runLogin)
        )
      )
      .add(
        defineCommand(
          "status",
          {
            aliases: ["whoami"],
            description: "Show saved connection and browser profile state as JSON",
            sections: [
              {
                body: "The profile path follows the current BEBU_HOME or BEBU_SESSION_FILE. An owned profile can be reopened with auth login --fresh; sign in if prompted. A lock means a browser operation may be active, not that it is safe to delete the lock. If the previous process crashed, verify that no bebu browser operation is running before removing the reported profile path with .lock appended. An unrecognized profile is never adopted or deleted.",
                title: "Profile recovery",
              },
            ],
          },
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
              "Delete local credentials and the managed browser profile; stop bebu browser first",
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
