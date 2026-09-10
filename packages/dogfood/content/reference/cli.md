---
title: CLI
nav: CLI
intent: Every command, every flag, every exit code.
enumerates:
  - Commands
---

The **`abide`** command is the whole tool: a scaffolder, a dev server, a type checker, a build,
a runtime and a client for a running app. Every command reads the same project layout, so none
of them takes a config file argument.

## Syntax

```
abide <command> [options]
abide --help
```

### Options

* `--port <n>` — the listen port for `dev` and `start`. Defaults to `PORT`, then to the
  platform default.
* `--out <file>` — where `openapi` and `compile` write, rather than to standard output.
* `--url <origin>` — the running app `openapi`, `mcp`, `connect` and `call` talk to. Defaults
  to `ABIDE_APP_URL`, then to the local app.
* `--target`, `--platforms` — what `compile` builds for.

### Exit codes

* `0` — the command did what it was asked.
* `1` — the command failed for its own reasons: a build error, a type error, a port in use.
* `7` — a handler **refused**. The refusal is an expected answer, so it is not a fault of the
  CLI, and a script can tell the two apart without parsing anything.
* `8` — the call reached the app and the app faulted.

## Commands

| Command | Meaning |
| --- | --- |
| `abide scaffold <name>` | Writes a starter project. |
| `abide run <file> [args…]` | Runs a script under the abide runtime. |
| `abide check [dir…]` | Type-checks `.abide`, on the `.abide` line. |
| `abide dev [--port <n>]` | Watches the project and keeps the app up. |
| `abide build` | Builds the client into content-hashed chunks and a manifest. |
| `abide start [--port <n>]` | Boots the built app. |
| `abide connect [url]` | The interactive shell against a running app. |
| `abide call <address> [args]` | One call to one handler. |
| `abide openapi [--out <file>] [--url <origin>]` | The OpenAPI document written rather than served. |
| `abide mcp [--url <origin>]` | The app's MCP server over stdio. |
| `abide logs` | `abide call` on `log.records`. |
| `abide compile [--target] [--out] [--platforms]` | One standalone executable. |
| `abide bundle` | A desktop launcher for the host platform. |
| `abide lsp` | The `.abide` language server, over stdio. |
| `abide` · `-h` · `--help` | Usage, generated from the command list. |

## Description

### The commands that need a project

`scaffold`, `check`, `dev`, `build`, `start`, `compile`, `bundle` and `lsp` read `src/` and
answer about the project in the working directory. `run` is the odd one: it runs a single file
under the abide runtime, which is what makes a one-off script able to import `#server` and
`#shared` without a build.

### The commands that need a running app

`connect`, `call`, `logs`, `openapi` and `mcp` talk to an app over http. Which app is
`--url`, then `ABIDE_APP_URL`, then the local one — and `ABIDE_APP_TOKEN` is the bearer they
send, so a remote app is reachable without a second set of credentials to manage.

`openapi` and `mcp` have a local form too: `openapi --out` writes the document from the source
rather than asking a server for it, which is what a build step wants.

### `help` is generated

`abide` with no command, `-h` and `--help` all print usage generated from the command list. It
is generated rather than written, so a command that exists is a command the help mentions.

## Examples

### Start a project and run the dev server

```
abide scaffold ledger
cd ledger
abide dev
```

### Call a handler from a shell

```
abide call invoices/getInvoice '{"id": "4310"}'
```

### Write the OpenAPI document at build time

```
abide openapi --out dist/openapi.json
```

## See also

* [Scaffold](../ship/start-a-new-app.md) — what `abide scaffold` writes
* [Dev server](../ship/run-the-app-while-you-work.md) — what `abide dev` watches
* [Build & start](../ship/build-and-serve-the-app.md) — the artifact `abide build` leaves
