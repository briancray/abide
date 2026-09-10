---
title: Run the app while you work
nav: Dev server
intent: The dev loop, and running a single file against your app's own modules.
covers:
  - `abide dev [--port <n>]`
  - `abide run <file> [args…]`
---

```
abide dev
```

Watches the project and keeps the app up. One process serves the pages, the handlers and the
sockets, because there is one process in production too — the runtime is the same, which is
what makes a bug you saw here a bug you can reproduce there.

## One runtime, in development and in production

The dev server does not swap in a different module resolver, a different transport or a
different renderer. `abide dev` and `abide start` differ in whether the app is rebuilt when a
file changes, and in nothing else that an app can observe.

That is worth insisting on. The alternative is a class of bug that exists in only one of them:
a value that hydrates in dev and not in prod, an import that resolves under the watcher and not
in the bundle. Those are the expensive ones.

`--port` overrides `PORT`. Everything else is `config()`.

Read on: [Config](../app/configure-the-app.md) ·
[Build & start](build-and-serve-the-app.md)

## `abide run` is one file, with your app's modules

```
abide run scripts/backfill.ts --since 2026-01-01
```

Runs a script under the abide runtime, which is what lets a one-off import `#server/database`
and `#shared/failures` without a build and without a second tsconfig.

That is the shape a backfill, a migration and a fixture loader want. They are not endpoints and
should not become endpoints just to reach the app's own modules — which is what happens in a
stack where the only thing that can import them is the server.

Arguments after the file are the script's own.

Read on: [Call a handler](call-a-handler-from-the-terminal.md)

## What the watcher notices

A `.abide` file, a `.ts` file and a stylesheet the components depend on. A stylesheet imported
from any `<script>` in a file — or from any `.ts` it reaches — is a dependency of that
component, so it is watched because the component is.

Read on: [Styles](../templates/scope-styles-to-a-component.md)

## Next

* [Checks](catch-mistakes-before-you-ship.md) — the type check the editor runs
* [Build & start](build-and-serve-the-app.md) — the same app, built
* [CLI](../reference/cli.md) — every command and flag
