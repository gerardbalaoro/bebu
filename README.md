# BeBu for Beyond Budget

A command-line tool for Beyond Budget accounts and transactions. bebu reads and changes your budget
through direct requests to the app. Your browser provides the session for authentication.

## Install the CLI

```sh
npm install -g https://github.com/gerardbalaoro/bebu
bebu auth login
```

Login reuses your Chrome session. Complete the steps in the terminal and browser.

## Use with an Agent

```sh
npx --yes skills add gerardbalaoro/bebu --skill bebu
```

Choose your agent in the skills.sh installer. Then start your agent. Ask it to use bebu.

The skill uses npx to run commands. You do not need a global CLI installation.

Node.js 24+ is required. An agent is optional. bebu stores its data in the OS data folder for
`bebu`.

To use another data folder, set `BEBU_HOME`.
