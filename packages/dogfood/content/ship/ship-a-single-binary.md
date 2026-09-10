---
title: Ship a single binary
nav: Compile
intent: One executable with the app inside it, for one platform or several.
covers:
  - `abide compile [--target] [--out] [--platforms]`
---

```
abide compile --out dist/ledger
```

One standalone executable with the app inside it. No runtime to install on the target, no
`node_modules` to ship, and no start script — the file is the app.

## The three flags

| | |
| --- | --- |
| `--target` | which platform and architecture to build for |
| `--out` | where the executable goes |
| `--platforms` | several targets in one run |

`--platforms` exists because the common case is not one binary. A release is a matrix, and a
matrix built by one command is a matrix that cannot get one target's flags wrong.

## What the executable holds

The built client, the server modules, the runtime. Everything an `abide start` would have
loaded, resolved at compile time — which is what makes the artifact's behaviour a property of
the build rather than of what the target machine happens to have.

Configuration is still the environment. A compiled app reads `config()` the same way, validated
at start, so the same binary runs in staging and in production and the difference is the
variables it was started with.

Read on: [Config](../app/configure-the-app.md) ·
[Build & start](build-and-serve-the-app.md)

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
