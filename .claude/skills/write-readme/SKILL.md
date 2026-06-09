---
name: write-readme
description: Regenerate the belte README. Use when the user asks to rewrite, update, or refresh the README, or after API changes the README should reflect.
---

# Writing the belte README

Reproduce the value proposition and style below faithfully, but treat the code as
the only authority for facts. The opening *sells*; the code *proves*. Every claim
that survives into the README must be backed by something you can point to in
`packages/belte/src` (or `packages/belte/package.json` for paths/footprint).

## Source of truth — non-negotiable

* **`packages/belte/src` is the SOLE source of factual / API truth.** Read it before
  you write. Do not state a behaviour, option, default, path, or guarantee that you
  have not seen in that tree. If the code doesn't back it, it doesn't go in.
* **`packages/belte/package.json` backs the meta-claims:** import paths (the
  `exports` map — pin every `@belte/belte/...` to a real key), dependency
  footprint (the `dependencies` / `peerDependencies` fields), and runtime
  (`engines`). Pin imports to real export keys so paths can't regress.
* Do **not** mine `examples/`, the current README, CHANGELOG, or docs for facts.
  `examples/` paths may only appear as literal commands in **Try it** (they are
  run instructions, not API claims). The current README is not a source — rebuild
  completely.
* Never document internal APIs (anything not in the `exports` map).
* If a claim below no longer matches the code, **change the claim, not the code** —
  the README reflects what is true today.

## Verify before you write — the claim ledger

The value proposition rests on a small set of load-bearing claims. Before writing
the opening, re-confirm each against the file in its row. If the evidence has
changed, rewrite or drop the claim.

| Claim in the opening | Verify against |
| --- | --- |
| One declared rpc becomes SSR call + browser fetch + MCP tool + CLI subcommand + OpenAPI op | `src/belteResolverPlugin.ts` + `src/lib/shared/createRemoteFunction.ts` (swap), `src/lib/mcp/dispatchMcpRequest.ts` (mcp), `src/lib/server/runtime/buildOpenApiSpec.ts` (openapi) |
| An rpc's mcp surface is also drivable by an in-app model agent, provider-swappable | `src/lib/server/agent.ts` (engine contract + frame stream; framed via `jsonl()`/`sse()`); engines ship as sibling packages `packages/anthropic`, `packages/claude-code` |
| Zero runtime dependencies; only optional peers | `package.json` — `dependencies` absent/empty; `peerDependencies` are the only deps |
| Bun-only, by design | `package.json` `engines.bun`; `bun:*` / `Bun.*` usage in `src/lib` |
| Svelte-only web surface | `src/App.svelte`, `src/lib/browser/*`, `peerDependencies.svelte` |
| "No magic strings" — the swap is a real tokenizer | `src/lib/shared/findExportCallSite.ts` (skips strings/templates/comments/regex/generics) |
| Safe by default: a mutating verb never auto-exposes to MCP | `src/lib/server/rpc/defineVerb.ts` + `src/lib/shared/resolveClientFlags.ts` + `src/lib/shared/isReadOnlyMethod.ts` |
| No umbrella `index.ts`; every name on its own path | `package.json` `exports` (no `.` barrel; one key per name) |
| The boot surface-map is real, and its exact format | `src/lib/server/runtime/logExposedSurfaces.ts` — reproduce its real output shape; gated by `DEBUG=belte` |
| Cache keys distinguish `Date`/`Map`/`Set`/`bigint` | `src/lib/shared/canonicalJson.ts` |

Treat this ledger as the floor, not the ceiling — verify every other claim in the
body the same way (each option, default, response helper, env var) against its module.

## The value proposition — reproduce this faithfully

This is the part to preserve in voice and shape. Heading is lowercase `# belte`,
followed by a bold one-line capability statement (not a slogan — a plain statement
of what one declaration becomes), the declare snippet, the surfaces diagram, the
**real** boot surface-map, then "Why it's built this way" and "Scope".

````md
# belte

**Write one function. Get a web app, a CLI, and an AI tool — from the same line of code.**

belte is an HTTP framework for Bun + Svelte where a single declared function is
*simultaneously* an SSR call, a browser fetch, an MCP tool, a CLI subcommand, and
an OpenAPI operation. You don't wire up five surfaces. You write one handler; the
bundler swaps the runtime per target.

```ts
// src/server/rpc/getPost.ts — the filename is the export, the URL, and the command name
import { GET } from '@belte/belte/server/GET'
import { json } from '@belte/belte/server/json'

export const getPost = GET<{ id: string }>(async ({ id }) => json(await db.post(id)))
```

That one file is now all of this:

[ASCII diagram: the one rpc file fanning out to browser / http / cli / mcp / openapi,
 each line a real consume form taken from the code]

Don't take the diagram's word for it — belte prints the exact map at boot:

[a fenced `sh` block showing the REAL output of logExposedSurfaces — three
 aligned tables of `✓`/`·` glyph columns, NOT an arrow list. pages = `page |
 layout | error`; sockets = `socket | schema | browser | mcp | cli | publish`;
 rpcs = method+path then `schema | browser | mcp | cli` (http/openapi are
 unconditional, folded into the `http` header). A schemaless verb shows a red `·`
 in its schema column — that one column gates the machine surfaces; there is no
 separate hint line.]

Every surface a function reaches is auditable in one place — no surface is ever
exposed by accident.

## Why it's built this way

- **Zero runtime dependencies.** [back with package.json + the Web/Bun APIs used]
- **No magic strings.** [back with findExportCallSite.ts]
- **Safe by default for machines.** [back with defineVerb / resolveClientFlags]

## Scope — read this before you adopt

[Bun-only + Svelte-only by design; no Node fallback; pre-1.0; core vs newer
 satellites (mcp/cli/desktop). State the trade plainly — this sets blast-radius
 expectations and pre-empts the "is it production-ready" question.]
````

Rules for the opening:
* The bold line and the five surfaces must each be true *right now* — cross them
  against the ledger. If a surface were removed from the code, remove it here.
* The boot block is a hero artifact: copy the **actual** format emitted by
  `logExposedSurfaces.ts`. Don't invent columns or surfaces it doesn't print.
* "Why it's built this way" is three bullets, each a fact with code behind it — not
  adjectives. No superlatives, no comparisons to other frameworks.
* "Scope" is honest, not apologetic: the Bun/Svelte-only bet and pre-1.0 status are
  stated as design facts.

## Outline — the rest of the document

After the opening, keep the reference dense and faithful. Order:

* **The mental model** — three ideas: one runtime (dev == build), declare once, the
  namespace marks the side (`server/*` server-only, `browser/*` client-only,
  `shared/*` isomorphic). Include the namespace table and the no-barrel note.
* **One function, every surface** — a single worked example (one schema-bearing verb)
  consumed from browser, http, cli, mcp, and openapi back-to-back. The tour proves
  the opening.
* **Server**
  * **Server / rpc** — Declaring (verb spec + options table + example; response
    helpers table — `json` / `jsonl` / `sse` / `error` / `redirect`;
    `request()` / `server()` / `cookies()`; a callout that SSR/MCP
    in-process calls forward only an allowlist of headers, extensible via
    `app.forwardHeaders`; `filesSchema` multipart; `withJsonSchema()`). Consuming
    (`fn(args)` / `.raw` / `.stream` table + examples; `HttpError`; `openapi.json`).
  * **Server / sockets** — declaring (spec + options + example), publishing (spec +
    example), consuming (AsyncIterable note, iterate example, `.tail`).
  * **Server / agent** — `agent(engine, messages)` runs a provider model engine
    against the app's own mcp surface and returns the engine's frame stream; the
    handler frames it with `jsonl()`/`sse()`, so transport is the app's choice
    (spec + the `chat` example). Engines live in provider packages
    (`@belte/anthropic`, `@belte/claude-code`) and only see the surface in / frames
    out, so swapping providers never touches the verb or UI. Permission is
    server-side: the surface is gated by each verb's `clients.mcp` plus per-call
    handler auth, not negotiated at runtime.
* **Clients**
  * **Shared** — `cache()` (spec + server/browser examples; `{#await}` vs top-level
    await for SSR mode; a note that keys distinguish `Date`/`Map`/`Set`/`bigint`,
    backed by `canonicalJson.ts`); `HttpError`.
  * **Browser** — pages (Svelte 5), layouts (nearest-only), error pages, `subscribe`
    (spec + example), `navigate` (spec + example), `page` state (table), `cache()`
    reactivity via `createSubscriber`.
  * **Mcp** — generated at `/__belte/mcp`, no module to author; tools from
    schema-bearing verbs/sockets; resources/ + example; prompts/ + example.
  * **Cli** — generated thin client; `BELTE_APP_URL` / `BELTE_APP_TOKEN`; rpcs →
    subcommands with schema-derived flags (table); downloading + authenticated
    downloads; `banner.txt` / `footer.txt`.
  * **Bundle** — movable native desktop app (unsigned — note Gatekeeper); embedded
    server or connect remote; `window.ts` (spec + example); `disconnected.svelte`;
    `onMenu`; `icon.png`.
* **Some details** — config/env/`appDataDir`; app hooks table (include
  `forwardHeaders`, `init`, `handle`, `handleError`); project layout (with `lib/`
  per surface); CLI commands table; `public/` files; bundling targets table;
  logging + `DEBUG` (note `DEBUG=belte` prints the surface map).

## Write to the right file

* Write to `packages/belte/README.md` — the canonical, npm-shipped file. The
  repo-root `README.md` is a symlink to it (GitHub renders the symlink). Never edit
  the root path or replace the symlink with a copy.

## Scannability rules

The body is a reference, not an essay. Optimise for someone skimming for one answer.

- **No internal API exposure.**
- **Tables first** for anything enumerable: options, defaults, verb/method/parsing
  pairs, content types, file → URL mappings, status states, env vars.
- **Bullets next** for short rules that don't fit a table (≤ one line each).
- **Prose last**, 1–2 sentences, only when a transition or nuance can't be a table.
- **Snippets are minimal** — one example per concept, trimmed to what proves the point.

## Style

- The title is lowercase `# belte`, immediately followed by the bold capability line.
- Section headings are sentence-case.
- The opening value proposition may be punchy, but only with claims the ledger backs.
  Everywhere else: no superlatives, no marketing, no competitor comparisons — state
  what it does.
- No emojis.
- Right language tag on every code block (`ts`, `svelte`, `js`, `json`, `html`,
  `css`, `sh`, `md`).
- Filenames and URL paths in backticks.
- Function specs: a TypeScript `type` alias declaration plus a table of args/options.
