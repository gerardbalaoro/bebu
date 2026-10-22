import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

import { spawn } from "bun";

// Exercise browser lifecycle on the installed Node runtime. A separate Playwright connection
// owns each local browser fixture and verifies that user tabs survive Puppeteer disconnects.

test("Node browser login captures sessions, renews, cancels, and redacts credentials", async () => {
  const child = spawn({
    cmd: [
      "node",
      "--import",
      "@oxc-node/core/register",
      "--test",
      fileURLToPath(new URL("login.browser.ts", import.meta.url)),
    ],
    stderr: "pipe",
    stdout: "pipe",
  });

  const [output, errors, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  if (code !== 0) {
    throw new Error(`Browser integration failed:\n${output}\n${errors}`);
  }

  expect(code).toBe(0);
}, 45_000);
