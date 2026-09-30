---
title: Ship a single binary
nav: Compile
intent: One executable with the app inside it, for one platform or several.
covers:
  - `abide compile [--target] [--out] [--platforms]`
---

```
abide compile                                     # ./ledger
abide compile --platforms linux-x64,darwin-arm64  # ./ledger-linux-x64 …
```

One standalone executable with the app inside it. No runtime to install on the target, no
`node_modules` to ship, and no start script — the file is the app.

## The three flags

| | |
| --- | --- |
| `--target` | which platform and architecture to build for — `linux-x64`, `darwin-arm64`, `windows-x64` |
| `--out` | where the executable goes — by default the app's `package.json` name, in the directory you ran the command from |
| `--platforms` | several targets in one run, comma-separated, each executable suffixed with its target |

`--platforms` exists because the common case is not one binary. A release is a matrix, and a
matrix built by one command is a matrix that cannot get one target's flags wrong. Give it or
`--target`, not both.

## What the executable holds

The built client, the server modules, the runtime. Everything an `abide start` would have
loaded, resolved at compile time — which is what makes the artifact's behaviour a property of
the build rather than of what the target machine happens to have.

Configuration is still the environment. A compiled app reads `config()` the same way, validated
at start, so the same binary runs in staging and in production and the difference is the
variables it was started with. It reads no `bunfig.toml` from where it is started.

What it does not hold is a file your own code opens while it runs. A handler that reads a path
off disk reads it on the target machine, where that path is whatever the machine has.

Read on: [Config](../app/configure-the-app.md) ·
[Build & start](build-and-serve-the-app.md)

## The executable is `abide`, for one app

```
./ledger                                  # usage
./ledger start --port 8080                # serve, with a shell on it
./ledger run scripts/backfill.ts          # a script, under the app it holds
./ledger call invoices/getInvoice id=42
```

Run with no command, it prints its usage under its own name. `start` serves the app and opens
the same shell `abide connect` opens: `call`, `handlers`, `help`, `exit`. `exit` stops the app. Where
nothing is typing — no terminal, a container started without one — the app keeps serving.

`run`, `call`, `connect`, `openapi`, `mcp` and `logs` are `abide`'s. A script `run` imports
`abide/server` and the app's handlers from the executable, so it needs no `node_modules`
beside it. What needs the source — `dev`, `build`, `check` — is not listed, and answers with
the `abide` command to run where the source is.

Read on: [Call a handler](call-a-handler-from-the-terminal.md)

## When a binary is the right shape

An app somebody else operates. A tool that runs on a machine you do not administer, a service
dropped into an image with nothing else in it, an internal utility handed to a colleague who
should not have to know what a package manager is.

`abide bundle` is the neighbouring answer for a desktop app — the same built app, wrapped as a
launcher for the host platform.

Read on: [Build & start](build-and-serve-the-app.md)

## Next

* [Build & start](build-and-serve-the-app.md) — the build this compiles
* [Config](../app/configure-the-app.md) — what a compiled app still reads at start
* [CLI](../reference/cli.md) — every command and flag
