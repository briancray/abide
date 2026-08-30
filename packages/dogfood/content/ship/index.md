---
title: Shipping
nav: Overview
intent: Every command between an empty directory and a deployed app.
---

Six commands cover the distance from an empty directory to a deployed app.

| Command | Does |
| --- | --- |
| `abide scaffold <name>` | a new app |
| `abide dev` | the dev loop |
| `abide check` | type-checks the templates as well as the TypeScript |
| `abide build` then `abide start` | what you deploy |
| `abide compile` | one binary with the app inside it |

```
abide scaffold my-app        # starter project, then install and abide dev
abide check                  # the templates as well as the TypeScript
abide build && abide start   # what you deploy
```

## Getting an app running

Scaffold writes a starter project and can take you straight into the dev loop, which
keeps the app up while you work.

Read on: [Scaffold](start-a-new-app.md) · [Dev server](run-the-app-while-you-work.md)

## Catching mistakes before you ship

`abide check` type-checks the templates as well as the TypeScript, and reports each
diagnostic on the `.abide` line rather than on generated output.

Read on: [Checks](catch-mistakes-before-you-ship.md)

## Builds, and a single binary

A build produces content-hashed chunks and a manifest, and `abide start` serves them.
`abide compile` puts the whole app inside one executable instead.

Read on: [Build & start](build-and-serve-the-app.md) ·
[Compile](ship-a-single-binary.md)

## Watching what you deployed

The same log channels, tailed from your terminal against a running app.

Read on: [Logs](watch-a-running-app.md)
