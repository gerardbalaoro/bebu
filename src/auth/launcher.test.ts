import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { release, tmpdir } from "node:os";
import nodePath from "node:path";

import * as browsers from "@puppeteer/browsers";
import * as puppeteer from "puppeteer-core";
import { PUPPETEER_REVISIONS } from "puppeteer-core/internal/revisions.js";

import { connectBrowser, launchBrowser, systemBrowserPath } from "./launcher.ts";
import { login } from "./login.ts";

const directory = await mkdtemp(nodePath.join(tmpdir(), "bebu-browser-install-"));
const previousHome = process.env.BEBU_HOME;
const previousBrowser = process.env.BEBU_BROWSER;
const previousPath = process.env.PATH;
const launchOptions = { headless: true, timeout: 1000 };
const launched = new Error("Fixture browser launched");

function installFixture(
  options: browsers.InstallOptions & { unpack?: true }
): Promise<browsers.InstalledBrowser>;
function installFixture(options: browsers.InstallOptions & { unpack: false }): Promise<string>;
async function installFixture(
  options: browsers.InstallOptions
): Promise<browsers.InstalledBrowser | string> {
  const installed = new browsers.InstalledBrowser(
    new browsers.Cache(options.cacheDir),
    browsers.Browser.CHROME,
    options.buildId,
    browsers.detectBrowserPlatform() ?? browsers.BrowserPlatform.LINUX
  );

  await mkdir(nodePath.dirname(installed.executablePath), { recursive: true });
  await writeFile(installed.executablePath, "fixture browser");

  return options.unpack === false ? installed.executablePath : installed;
}

afterEach(async () => {
  process.env.PATH = previousPath;

  if (previousHome === undefined) {
    delete process.env.BEBU_HOME;
  } else {
    process.env.BEBU_HOME = previousHome;
  }

  if (previousBrowser === undefined) {
    delete process.env.BEBU_BROWSER;
  } else {
    process.env.BEBU_BROWSER = previousBrowser;
  }

  await rm(directory, { force: true, recursive: true });
});

test("missing Chrome is installed before the saved profile is launched", async () => {
  process.env.BEBU_HOME = directory;
  delete process.env.BEBU_BROWSER;

  const discover = spyOn(puppeteer, "executablePath").mockRejectedValue(
    new Error("Chrome missing")
  );

  const install = spyOn(browsers, "install").mockImplementation(installFixture);

  const launch = spyOn(puppeteer, "launch").mockImplementation((options) => {
    if (!options?.executablePath || !existsSync(options.executablePath)) {
      throw new Error("Missing browser executable");
    }

    throw launched;
  });

  const progress = mock();

  try {
    await expect(
      launchBrowser(nodePath.join(directory, "profile"), launchOptions, progress)
    ).rejects.toBe(launched);
    expect(install).toHaveBeenCalledWith(
      expect.objectContaining({
        browser: "chrome",
        buildId: PUPPETEER_REVISIONS.chrome,
        cacheDir: nodePath.join(directory, "browsers"),
      })
    );
    await expect(
      launchBrowser(nodePath.join(directory, "profile"), launchOptions, progress)
    ).rejects.toBe(launched);
    expect(install).toHaveBeenCalledTimes(1);
    expect(progress).toHaveBeenCalledTimes(1);

    await expect(login({ progress })).rejects.toThrow("Browser sign-in failed");
    expect(launch).toHaveBeenCalledTimes(3);
  } finally {
    discover.mockRestore();
    install.mockRestore();
    launch.mockRestore();
  }
});

test("installed Chrome is reused without downloading a browser", async () => {
  delete process.env.BEBU_BROWSER;
  const executablePath = nodePath.join(directory, "installed-chrome");
  await mkdir(directory, { recursive: true });
  await writeFile(executablePath, "fixture browser");

  const discover = spyOn(puppeteer, "executablePath").mockResolvedValue(executablePath);
  const install = spyOn(browsers, "install");
  const launch = spyOn(puppeteer, "launch").mockRejectedValue(launched);

  try {
    await expect(launchBrowser("/saved/profile", launchOptions)).rejects.toBe(launched);
    expect(launch).toHaveBeenCalledWith({
      ...launchOptions,
      defaultViewport: null,
      executablePath,
      handleSIGINT: false,
      userDataDir: "/saved/profile",
    });
    expect(install).not.toHaveBeenCalled();
  } finally {
    discover.mockRestore();
    install.mockRestore();
    launch.mockRestore();
  }
});

test("an expected Chrome path without an executable counts as a missing browser", async () => {
  const discover = spyOn(puppeteer, "executablePath").mockResolvedValue(
    nodePath.join(directory, "missing-chrome")
  );

  try {
    expect(await systemBrowserPath()).toBeUndefined();
  } finally {
    discover.mockRestore();
  }
});

test("browser download errors give a safe retry instruction and release the login lock", async () => {
  process.env.BEBU_HOME = directory;
  delete process.env.BEBU_BROWSER;

  const discover = spyOn(puppeteer, "executablePath").mockRejectedValue(
    new Error("Chrome missing")
  );

  const install = spyOn(browsers, "install").mockRejectedValue(new Error("private fixture value"));
  const launch = spyOn(puppeteer, "launch");

  try {
    await expect(login({ fresh: true })).rejects.toThrow(
      "The browser download failed. Check your internet connection"
    );
    expect(existsSync(nodePath.join(directory, "browser-profile.lock"))).toBe(false);
    expect(launch).not.toHaveBeenCalled();
  } finally {
    discover.mockRestore();
    install.mockRestore();
    launch.mockRestore();
  }
});

test.skipIf(process.platform !== "linux")(
  "WSL connects through the Windows Chrome profile debugging endpoint",
  async () => {
    const commands = nodePath.join(directory, "commands");
    const profile = nodePath.join(directory, "windows-profile");
    await mkdir(commands, { recursive: true });
    await mkdir(profile, { recursive: true });
    await writeFile(
      nodePath.join(commands, "cmd.exe"),
      "#!/bin/sh\nprintf '%s\\r\\n' 'C:\\Users\\fixture\\AppData\\Local'\n",
      { mode: 0o700 }
    );
    await writeFile(
      nodePath.join(commands, "wslpath"),
      `#!/bin/sh\n[ "$1" = "-u" ] && [ "$2" = 'C:\\Users\\fixture\\AppData\\Local\\Google\\Chrome\\User Data' ] || exit 1\nprintf '%s\\n' '${profile}'\n`,
      { mode: 0o700 }
    );
    await writeFile(
      nodePath.join(profile, "DevToolsActivePort"),
      "9222\r\n/devtools/browser/fixture-browser\r\n"
    );
    process.env.PATH = `${commands}${nodePath.delimiter}${previousPath}`;
    const connect = spyOn(puppeteer, "connect").mockRejectedValue(launched);

    try {
      await expect(connectBrowser("/mnt/c/Chrome/chrome.exe")).rejects.toBe(launched);
      expect(connect).toHaveBeenCalledWith({
        browserWSEndpoint: "ws://127.0.0.1:9222/devtools/browser/fixture-browser",
        defaultViewport: null,
        protocolTimeout: 30_000,
        wsOptions: { handshakeTimeout: 30_000 },
      });
    } finally {
      connect.mockRestore();
    }
  }
);

test.skipIf(!release().toLowerCase().includes("microsoft"))(
  "WSL Linux profiles use a downloaded Linux browser so IndexedDB can work",
  async () => {
    process.env.BEBU_HOME = directory;
    delete process.env.BEBU_BROWSER;

    const windowsBrowser = nodePath.join(directory, "chrome.exe");
    await mkdir(directory, { recursive: true });
    await writeFile(windowsBrowser, "fixture Windows browser");

    const discover = spyOn(puppeteer, "executablePath").mockResolvedValue(windowsBrowser);
    const install = spyOn(browsers, "install").mockImplementation(installFixture);
    const launch = spyOn(puppeteer, "launch").mockRejectedValue(launched);

    try {
      const profile = nodePath.join(directory, "profile");
      await expect(launchBrowser(profile, launchOptions)).rejects.toBe(launched);
      expect(install).toHaveBeenCalledTimes(1);
      expect(launch).toHaveBeenCalledWith(
        expect.objectContaining({
          executablePath: expect.stringContaining("chrome-linux"),
          userDataDir: profile,
        })
      );
    } finally {
      discover.mockRestore();
      install.mockRestore();
      launch.mockRestore();
    }
  }
);

test.skipIf(!release().toLowerCase().includes("microsoft"))(
  "Windows Chrome receives a Windows profile path when launched from WSL",
  async () => {
    process.env.BEBU_BROWSER = "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe";
    const launch = spyOn(puppeteer, "launch").mockRejectedValue(launched);

    try {
      await expect(launchBrowser("/mnt/c/bebu-fixture/profile", launchOptions)).rejects.toBe(
        launched
      );
      expect(launch).toHaveBeenCalledWith({
        ...launchOptions,
        defaultViewport: null,
        executablePath: "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe",
        handleSIGINT: false,
        userDataDir: "C:\\bebu-fixture\\profile",
      });
    } finally {
      launch.mockRestore();
    }
  }
);
