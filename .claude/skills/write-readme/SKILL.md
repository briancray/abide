---
name: write-readme
description: Regenerate or update the project README. Use when the user asks to rewrite, update, or refresh the README, or after API changes the README should reflect.
---

# Writing the belte README

## READ FIRST

* dont use the current README, rebuild completely based on the outline below
* Always start with heading Belte and tagline Isomorphic multimodal http framework built for humans and machines in a single Bun runtime.

## outline

belte — isomorphic multimodal HTTP framework for humans and machines, one Bun runtime
* Humans: web (Svelte) + cli
* Machines: mcp + cli
* cli serves both — humans run it, machines script it)

* What is an isomorphic multimodal framework
    * a single runtime
    * declare rpc once, use anywhere for free (browser/http, mcp, cli)
    * declaration example
    * consuming on each client + example

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
        * rpcs are commands, args/flags derived from each schema
        * defaults to full** (runs locally); `--thin` opts into the remote client
        * Downloading + authenticated downloads
        * cli/banner.txt + footer.txt

* Some details
    * app hooks
    * project layout
    * cli commands
    * public/ files
    * bundling
    * environment variables
    * logging api and DEBUG



## Scannability rules

The README is a reference, not an essay. Optimise for someone skimming for one answer.

- **Tables first** for anything enumerable: option lists, defaults, verb / content-type / parsing pairs, HTTP cache buckets, file → URL mappings, status states.
- **Bullets next** for short rules that don't fit a table (≤ one line each).
- **Prose last**, in 1–2 sentences only when transition / nuance can't be a table.
- **Snippets are minimal.** One example per concept, trimmed to what proves the point. Don't show barebones + full versions of the same thing in the same section.

## Style

- Sentence-case headings.
- Right language tag on every code block (`ts`, `svelte`, `js`, `json`, `html`, `css`, `sh`).
- Filenames and URL paths in backticks.
- No emojis, no marketing words. State what it does.
- Lift snippets from `examples/` where possible so they're real code that runs.

## After writing

Skim every snippet against source — import paths, function names, types, directory names. If a rename happened recently, the README is the last place to forget.
