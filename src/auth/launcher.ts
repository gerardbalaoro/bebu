import { chromium } from "patchright";
import type { BrowserContext } from "patchright";

export interface BrowserOptions {
  headless: boolean;
  timeout: number;
  port?: number;
}

export const launchBrowser = async (
  profile: string,
  options: BrowserOptions
): Promise<BrowserContext> =>
  await chromium.launchPersistentContext(profile, {
    // Allow the system renderer on hosts such as WSL where working WebGL2 is blocklisted.
    args: [
      "--ignore-gpu-blocklist",
      "--remote-debugging-address=127.0.0.1",
      `--remote-debugging-port=${options.port ?? 0}`,
    ],
    handleSIGINT: false,
    handleSIGTERM: false,
    headless: options.headless,
    timeout: options.timeout,
    viewport: null,
  });
