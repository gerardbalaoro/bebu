# BeBu for Beyond Budget

A command-line tool for Beyond Budget accounts and transactions. bebu reads and changes your budget
through direct requests to the app. Your browser provides the session for authentication.

## Install the CLI

```sh
npm install -g https://github.com/gerardbalaoro/bebu
npx patchright@1.64.3 install chromium
bebu auth
```

Set `BEBU_USERNAME` and `BEBU_PASSWORD` in a private `.env` beside `.env.schema`, or export them.
Both variables are sensitive. Varlock loads and validates them when you sign in. Use
`bun run env:check` to check repository configuration without printing secrets.

Run `bebu auth` to open a visible Patchright browser. If both credentials are configured, bebu
enters and submits them automatically. Otherwise, sign in manually. bebu detects completion,
validates budget access, and saves the session. Complete browser verification or budget selection in
the window if asked. `bebu auth login` performs the same action.

If a previous login crashed and left its profile locked, use `bebu auth --force` or
`bebu auth login --force`. This recovers locks from exited processes and preserves the saved
profile. It refuses to remove a lock held by a running process or an unidentified owner.

Use `bebu auth --headless` only when a visible window is not needed. Token renewal reuses the saved
profile automatically.

Install Chromium before the first launch with the command above. No license key or account is
required. If headless sign-in encounters a challenge, run `bebu auth` to continue in a visible
window.

## Browser Control

Run `bebu browser` in a dedicated terminal or managed background process. It stays running and
prints JSON containing `endpoint` and `webSocketDebuggerUrl`. CDP listens on loopback only. Use
`--headed` for a visible window, or `--port 9222` for a fixed port.

Connect your available CDP browser tooling to the returned endpoint. For example, with Patchright:

```js
import { chromium } from "patchright";

const browser = await chromium.connectOverCDP(endpoint);
const context = browser.contexts()[0];
// Inspect and interact with the app through this context.
await browser.close(); // Disconnect this client; the managed browser keeps running.
```

Use `bebu browser status` to retrieve the endpoint and `bebu browser stop` to close the browser.
Ctrl+C in its terminal also closes it. Disconnecting an agent client preserves the profile and
browser. For visible sign-in, start it with `bebu browser --headed`, then run `bebu auth`. Login
closes only its own tab. If the running browser is headless, stop it before running `bebu auth`.
Stop the browser before `bebu auth logout`, which deletes its profile. CDP gives clients full access
to browser data; keep the endpoint local.

Browser integration fixtures use Patchright with local test pages. Install the browser with:

```sh
PLAYWRIGHT_BROWSERS_PATH="$PWD/.local/data/playwright" bunx patchright install chromium
```

Run tests with a fresh data folder to keep durable operation records isolated between runs:

```sh
mkdir -p .local/data
test_data=$(mktemp -d "$PWD/.local/data/test.XXXXXX")
BEBU_HOME="$test_data" PLAYWRIGHT_BROWSERS_PATH="$PWD/.local/data/playwright" bun test
```

Use Patchright clients for automated control when possible. Other CDP clients can introduce
additional automation signals.

## Use with an Agent

```sh
npx --yes skills add gerardbalaoro/bebu --skill bebu
```

Choose your agent in the skills.sh installer. Then start your agent. Ask it to use bebu.

## Data

bebu stores its data in the OS data folder. To use another data folder, set `BEBU_HOME`.
