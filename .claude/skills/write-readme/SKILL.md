---
name: write-readme
description: Regenerate README. Use when the user asks to rewrite, update, or refresh the README, or after API changes the README should reflect.
---

# Writing the belte README

## READ FIRST

* dont use the current README, rebuild completely based on the outline below
* use only files in packages/belte/src to understand the code. do not refer to examples or anything outside of this directory
* Always start with heading Belte and tagline Isomorphic multimodal http framework built for humans and machines in a single Bun runtime.

## outline

belte — isomorphic multimodal HTTP framework for humans and machines, one Bun runtime
* Humans: web (Svelte) + cli + bundle
* Machines: mcp + cli
* cli serves both — humans run it, machines script it)

* Try it (place right after the intro)
    * easiest way - start with  prebuilt examples
    * scaffold: `bunx @briancray/belte scaffold my-app` → `cd my-app && bun install` → `bun dev`
    * kitchen-sink (every feature in one app): clone repo url → `cd examples/kitchen-sink && bun dev`

* What is an isomorphic multimodal framework
    * a single runtime
    * declare rpc once, use anywhere for free (browser/http, mcp, cli, bundle)
    * declaration example
    * consuming on each client

* Server:
    * Server/rcp
        * Declaring
            * function spec + options
            * example
            * response helpers
            * request() and server()
        * Consuming
            * Normal call encoding + args and decoding response + example
            * .raw spec + example
            * .stream spec + example
            * httperror
            * openapi.json
    * Server/sockets
        * declaring
            * function spec + options
            * example
        * publishing
            * function spec + options
            * example
        * Consuming
            * note about AsyncInterable
            * example using AsyncIterater
            * .tail example

* Clients:
    * Browser
        * pages (svelte 5)
        * Layouts
        * cache function spec + example
        * subscribe function spec + example
        * navigate function spec + example
        * page state
    * Mcp
        * generated automatically for free
        * rpc are tools
        * resources/ + example
        * prompts/ + example
    * Cli
        * generated automatically for free
        * APP_URL and APP_TOKEN
        * rpcs are commands, args/flags derived from each schema
        * Downloading + authenticated downloads
        * cli/banner.txt + footer.txt
    * bundle
        * movable, self-contained native desktop app for the host platform
        * self server or connect remote
        * window spec + example
        * disconnected.svelte
        * onMenu
        * icon.png

* Some details
    * app hooks
    * project layout
        * also suggest lib/ folders under each surface for handling lib
    * cli commands
    * public/ files
    * bundling
    * environment variables
    * logging api and DEBUG



## Scannability rules

The README is a reference, not an essay. Optimise for someone skimming for one answer.

- **No internal api exposure** dont expose internal apis
- **Tables first** for anything enumerable: option lists, defaults, verb / content-type / parsing pairs, HTTP cache buckets, file → URL mappings, status states.
- **Bullets next** for short rules that don't fit a table (≤ one line each).
- **Prose last**, in 1–2 sentences only when transition / nuance can't be a table.
- **Snippets are minimal.** One example per concept, trimmed to what proves the point.

## Style

- Sentence-case headings.
- Right language tag on every code block (`ts`, `svelte`, `js`, `json`, `html`, `css`, `sh`).
- Filenames and URL paths in backticks.
- No emojis, no marketing words. State what it does.
- function specs should be written as a TypeScript type alias declaration and table of args
