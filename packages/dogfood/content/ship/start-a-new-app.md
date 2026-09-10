---
title: Start a new app
nav: Scaffold
intent: From nothing to a running page.
covers:
  - `abide scaffold <name>`
  - `abide` · `-h` · `--help`
---

```
abide scaffold ledger
cd ledger
abide dev
```

Three commands to a page in a browser. There is no template to choose and no options to answer,
because the thing being scaffolded is the layout every abide app has.

## What it writes

| | |
| --- | --- |
| `src/ui/pages/page.abide` | the page at `/` |
| `src/ui/app.html` | the document its pages are served in |
| `src/server/app.ts` | the lifecycle hooks and the app's own route |
| `src/shared/` | the seam both sides import from |
| `package.json`, `tsconfig.json`, `biome.json` | the toolchain, configured |

The three directories are the three seams, and they are there from the first commit because the
import specifiers — `#server`, `#ui`, `#shared` — are what an app resolves through. A project
that grows into them later is a project that spends an afternoon moving files.

Nothing generated is a framework file you are asked not to edit. `app.html` is a real HTML
document, `app.ts` is a real module, and the page is a component.

Read on: [Configuration](../reference/configuration.md) ·
[Layouts](../pages/give-pages-the-same-chrome.md)

## `abide` with no command prints usage

`abide`, `abide -h` and `abide --help` all print usage **generated from the command list**. It
is generated rather than written, so a command that exists is a command the help mentions and
there is no second place for one to go missing.

Read on: [CLI](../reference/cli.md)

## Where to go from the scaffold

The scaffolded page holds a `state` and shows it. That is the whole of the first thing to
learn — a value, and markup that follows it — and everything else on this site is a name for
something you will want once that is boring.

Read on: [First page](../start/your-first-page.md) ·
[Why abide](../start/what-abide-is-for.md)

## Next

* [Dev server](run-the-app-while-you-work.md) — what `abide dev` does while you work
* [First page](../start/your-first-page.md) — the walk-through from here
* [CLI](../reference/cli.md) — every command and flag
