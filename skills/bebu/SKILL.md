---
name: bebu
description:
  "Use for Beyond Budget sign-in, balance and history queries, account configuration, and
  transaction creation, metadata changes, or deletion."
metadata:
  version: "0.1.0"
---

# bebu

Before you use the app, read [the login and write rules](commands/bebu.md).

## Run commands

If bebu is installed, use the command signatures as written. Otherwise, replace the initial bebu
with npx --yes github:gerardbalaoro/bebu. A global CLI installation is not required.

## Choose a command

1. Find the command for the task in the command reference.
2. Read the Type column. Only runnable commands accept direct execution. A group without an action
   contains other commands.
3. Before you use or explain a command, read its linked reference.
4. Use only the arguments, flags, aliases, and defaults in that reference.
5. If a feature is absent, report that the reference does not document it.

## Command reference

| Command                    | Type     | Description                                                                                            | Documentation                                                      |
| -------------------------- | -------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `bebu`                     | group    | A command-line tool for Beyond Budget accounts and transactions.                                       | [commands/bebu.md](commands/bebu.md)                               |
| `bebu accounts`            | group    | Read accounts and change their configuration                                                           | [commands/accounts.md](commands/accounts.md)                       |
| `bebu accounts list`       | runnable | List account IDs and balances in integer minor units                                                   | [commands/accounts/list.md](commands/accounts/list.md)             |
| `bebu accounts show`       | runnable | Read a complete account record                                                                         | [commands/accounts/show.md](commands/accounts/show.md)             |
| `bebu accounts update`     | runnable | Change the account configuration. Use schema for the accepted JSON fields                              | [commands/accounts/update.md](commands/accounts/update.md)         |
| `bebu auth`                | group    | Sign in through your browser and manage the saved connection                                           | [commands/auth.md](commands/auth.md)                               |
| `bebu auth login`          | runnable | Connect through your Chrome session. If necessary, wait for sign-in                                    | [commands/auth/login.md](commands/auth/login.md)                   |
| `bebu auth logout`         | runnable | Delete local credentials and the separate bebu profile. Your Chrome profile stays intact               | [commands/auth/logout.md](commands/auth/logout.md)                 |
| `bebu auth status`         | runnable | Show saved connection state as JSON                                                                    | [commands/auth/status.md](commands/auth/status.md)                 |
| `bebu categories`          | group    | Read expense and payment categories                                                                    | [commands/categories.md](commands/categories.md)                   |
| `bebu categories list`     | runnable | List category IDs and types                                                                            | [commands/categories/list.md](commands/categories/list.md)         |
| `bebu payees`              | group    | Read payees                                                                                            | [commands/payees.md](commands/payees.md)                           |
| `bebu payees list`         | runnable | List IDs and usage counts for payees                                                                   | [commands/payees/list.md](commands/payees/list.md)                 |
| `bebu schema`              | runnable | Show JSON schemas for write payloads                                                                   | [commands/schema.md](commands/schema.md)                           |
| `bebu session`             | group    | Import authentication from a signed-in browser                                                         | [commands/session.md](commands/session.md)                         |
| `bebu session import`      | runnable | Import one session source. Playwright state must include IndexedDB                                     | [commands/session/import.md](commands/session/import.md)           |
| `bebu session prepare`     | runnable | Prepare an encrypted session handoff without credentials in the output                                 | [commands/session/prepare.md](commands/session/prepare.md)         |
| `bebu session status`      | runnable | Show session expiry and budget IDs without credentials                                                 | [commands/session/status.md](commands/session/status.md)           |
| `bebu skills`              | group    | Generate or install the bebu agent skill                                                               | [commands/skills.md](commands/skills.md)                           |
| `bebu skills generate`     | runnable | Generate the bebu skill and command reference                                                          | [commands/skills/generate.md](commands/skills/generate.md)         |
| `bebu skills install`      | runnable | Generate and copy the bebu skill into .agents/skills in this project                                   | [commands/skills/install.md](commands/skills/install.md)           |
| `bebu tags`                | group    | Read tags                                                                                              | [commands/tags.md](commands/tags.md)                               |
| `bebu tags list`           | runnable | List IDs and usage counts for tags                                                                     | [commands/tags/list.md](commands/tags/list.md)                     |
| `bebu transactions`        | group    | Read history and write one-off expenses or income                                                      | [commands/transactions.md](commands/transactions.md)               |
| `bebu transactions create` | runnable | Create an expense or income with all ledger changes. The command does not allocate funds automatically | [commands/transactions/create.md](commands/transactions/create.md) |
| `bebu transactions delete` | runnable | Delete a supported transaction and reverse its ledger effects atomically                               | [commands/transactions/delete.md](commands/transactions/delete.md) |
| `bebu transactions list`   | runnable | Read the complete history, including older records absent from the app cache                           | [commands/transactions/list.md](commands/transactions/list.md)     |
| `bebu transactions show`   | runnable | Read a complete transaction record                                                                     | [commands/transactions/show.md](commands/transactions/show.md)     |
| `bebu transactions update` | runnable | Change notes, color, or cleared status in the record and its indexes                                   | [commands/transactions/update.md](commands/transactions/update.md) |
