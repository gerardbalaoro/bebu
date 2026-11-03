import { defineCommand } from "@crustjs/core";

import { print } from "../cli/io.ts";
import { browserStatus, runBrowser, stopBrowser } from "./control.ts";

export const browserCommand = defineCommand(
  "browser",
  { description: "Run Patchright in the foreground and publish a local CDP endpoint" },
  (command) =>
    command
      .flags(
        { description: "Show the browser window", name: "headed", type: "boolean" },
        {
          default: 0,
          description: "Local CDP port; 0 chooses an available port",
          name: "port",
          type: "number",
        }
      )
      .action(async ({ flags, signal, stdout }) => {
        await runBrowser({
          headless: flags.headed !== true,
          port: flags.port,
          ready: (status) => {
            print(stdout, { running: true, ...status });
          },
          signal,
        });
      })
      .add(
        defineCommand(
          "status",
          { description: "Show the running browser's CDP endpoint as JSON" },
          (leaf) =>
            leaf.action(async ({ stdout }) => {
              print(stdout, await browserStatus());
            })
        )
      )
      .add(
        defineCommand(
          "stop",
          { description: "Close the managed browser and release its profile" },
          (leaf) =>
            leaf.action(async ({ stdout }) => {
              print(stdout, await stopBrowser());
            })
        )
      )
);
