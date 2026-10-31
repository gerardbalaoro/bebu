import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import nodePath from "node:path";
import { promisify } from "node:util";
import type { CustomPromisify } from "node:util";

import { Browser as BrowserProduct, computeExecutablePath, install } from "@puppeteer/browsers";
import * as puppeteer from "puppeteer-core";
import type { Browser, ConnectOptions } from "puppeteer-core";
import { PUPPETEER_REVISIONS } from "puppeteer-core/internal/revisions.js";

import { dataHome } from "../state.ts";
import { BrowserSetupError } from "./browser.ts";

const ExecFile: CustomPromisify<typeof execFile.__promisify__> = execFile;
const run = promisify(ExecFile);

const isWindowsBrowser = (executablePath: string): boolean =>
  process.platform === "linux" && executablePath.toLowerCase().endsWith(".exe");

export const systemBrowserPath = async (): Promise<string | undefined> => {
  try {
    const executablePath = await puppeteer.executablePath("chrome");

    return existsSync(executablePath) ? executablePath : undefined;
  } catch {
    return undefined;
  }
};

const installBrowser = async (progress?: (message: string) => void): Promise<string> => {
  const options = {
    browser: BrowserProduct.CHROME,
    buildId: PUPPETEER_REVISIONS.chrome,
    cacheDir: nodePath.join(dataHome(), "browsers"),
  };

  const executablePath = computeExecutablePath(options);

  if (existsSync(executablePath)) {
    return executablePath;
  }

  progress?.("Downloading a compatible browser with Puppeteer...");

  try {
    const browser = await install(options);

    return browser.executablePath;
  } catch {
    throw new BrowserSetupError(
      "The browser download failed. Check your internet connection and available disk space. Then run bebu auth login"
    );
  }
};

export const connectBrowser = async (executablePath: string): Promise<Browser> => {
  let options: ConnectOptions = { channel: "chrome" };

  if (isWindowsBrowser(executablePath)) {
    const { stdout: localAppData } = await run("cmd.exe", ["/d", "/c", "echo %LOCALAPPDATA%"]);

    const windowsProfile = nodePath.win32.join(
      localAppData.trim(),
      "Google",
      "Chrome",
      "User Data"
    );

    const { stdout: profile } = await run("wslpath", ["-u", windowsProfile]);
    const portFile = await readFile(nodePath.join(profile.trim(), "DevToolsActivePort"), "utf-8");
    const [port, endpoint] = portFile.trim().split(/\r?\n/u);

    if (
      port === undefined ||
      port === "" ||
      !/^\d+$/u.test(port) ||
      Number(port) < 1 ||
      Number(port) > 65_535 ||
      endpoint?.startsWith("/devtools/browser/") !== true
    ) {
      throw new BrowserSetupError("Chrome has no valid debugging endpoint");
    }

    options = { browserWSEndpoint: `ws://127.0.0.1:${port}${endpoint}` };
  }

  return await puppeteer.connect({
    ...options,
    defaultViewport: null,
    protocolTimeout: 30_000,
    wsOptions: { handshakeTimeout: 30_000 },
  });
};

export const launchBrowser = async (
  profile: string,
  options: { headless: boolean; timeout: number },
  progress?: (message: string) => void
): Promise<Browser> => {
  const configuredBrowser = process.env.BEBU_BROWSER;

  let executablePath =
    configuredBrowser !== undefined && configuredBrowser !== ""
      ? configuredBrowser
      : await systemBrowserPath();

  let userDataDir = profile;

  if (executablePath !== undefined && executablePath !== "" && isWindowsBrowser(executablePath)) {
    const { stdout } = await run("wslpath", ["-w", profile]);
    const windowsProfile = stdout.trim();

    // Windows Chrome cannot use IndexedDB in a profile on the WSL Linux filesystem.
    if (windowsProfile.startsWith("\\\\")) {
      if (configuredBrowser !== undefined && configuredBrowser !== "") {
        throw new BrowserSetupError(
          "Windows Chrome needs a profile on a Windows drive. Set BEBU_HOME to a folder on a mounted Windows drive, or set BEBU_BROWSER to a Linux browser"
        );
      }

      executablePath = undefined;
    } else {
      userDataDir = windowsProfile;
    }
  }

  executablePath ??= await installBrowser(progress);

  return await puppeteer.launch({
    ...options,
    defaultViewport: null,
    executablePath,
    handleSIGINT: false,
    userDataDir,
  });
};
