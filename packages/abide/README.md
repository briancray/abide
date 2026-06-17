# abide

**Write one function. Get a web app, a CLI, and an AI tool — from the same line of code.**

abide is an isomorphic, multimodal framework for Bun. You declare a handler once; the bundler swaps the runtime per target, so the same callable runs in-process during SSR, over `fetch` in the browser, as an MCP tool, as a CLI subcommand, and as an OpenAPI operation — no second definition, no drift. The same project ships its own reactive UI framework, a live cache, broadcast sockets, an in-app AI agent, a standalone CLI binary, and a movable desktop app — end to end, on one runtime.

- One dependency — TypeScript, for the `.abide` compile and type-check pipeline. Tailwind is an optional peer.
- One runtime — Bun (≥ 1.3) powers dev, build, the server, the compiled binary, the CLI, and the desktop bundle.

```sh
bunx abide scaffold my-app   # scaffolds, installs, and starts the dev server
```

The kitchen-sink example **is the reference** — every surface below is a working, fully documented page. Clone and run it:

```sh
git clone https://github.com/briancray/abide
cd abide && bun install
cd examples/kitchen-sink && bun run dev
```

## Define behaviour once

One declared verb fans out to every surface. This is the whole premise:

```ts
// src/server/rpc/searchProducts.ts
import { GET } from '@abide/abide/server/GET'
import { json } from '@abide/abide/server/json'
import { z } from 'zod'

// query args arrive as strings — coerce in the schema
const inputSchema = z.object({ q: z.string(), limit: z.coerce.number().default(20) })

export const searchProducts = GET(
    async ({ q, limit }) => json(await db.search(q, limit)),
    { inputSchema },
)
```

```text
        export const searchProducts = GET(fn, { inputSchema })
                                  │
   ┌───────────────┬─────────────┼──────────────┬────────────────┐
 SSR call      browser fetch    MCP tool      CLI subcommand   OpenAPI op
cache(fn)()   fetch /rpc/...  searchProducts  app search-...  /openapi.json
(in-process)  (typed proxy)  (read-only+schema) (schema→flags)  (described)
```

At boot, abide prints the exposure map — every page, socket, and verb with the surfaces it reaches — so multimodal-by-default exposure is auditable, never implicit (silence it with `DEBUG=-abide`):

```text
pages:
  page
  /
  /products/[id]
sockets:
  socket                     schema  browser  mcp  cli  publish
  chat                       ✓       ✓        ✓    ✓    ✓
rpcs:
  http                       schema  browser  mcp  cli
  GET   /rpc/searchProducts  ✓       ✓        ✓    ·
  POST  /rpc/createOrder     ✓       ·        ·    ✓
```

The `schema` column gates the machine surfaces: an input schema unlocks CLI and (for read-only verbs) MCP. A mutating verb never auto-exposes to MCP — it needs an explicit `clients: { mcp: true }`.

## The full span

One typed backend, the UI that consumes it, and every client beyond the browser — all from the same project, the same runtime, the same definitions. Each row is a runnable, documented page in the kitchen-sink.

| Define behaviour once | what it is | page |
| --- | --- | --- |
| rpc | `GET`/`POST`/`PUT`/`PATCH`/`DELETE`/`HEAD` verbs, one per file → URL | `/rpc` |
| response helpers | `json` / `jsonl` / `sse` / `error` / `redirect` / `HttpError` | `/rpc/respond` |
| request scope | `request()` / `cookies()` / `server()` via `AsyncLocalStorage` | `/rpc/request-scope` |
| sockets | one broadcast topic per file, multiplexed over one connection | `/sockets` |
| cache | isomorphic coalesce + SSR snapshot + reactive invalidation | `/cache` |
| agent | run a model engine against the app's own gated MCP surface | `/agent` |

| Build the web app | what it is | page |
| --- | --- | --- |
| components | `.abide` files — HTML + `<script>` + `<template>` control flow + scoped `<style>` | `/components` |
| reactivity | `state` / `derived` / `effect` / `prop` in scope, no import | `/components` |
| pages | folder routes, `[id]` params, userland layouts + boundaries | `/pages` |
| navigate / url | client-side routing + the typed, base-correct link builder | `/pages` |
| tail | reactive consumer for a socket or `fn.stream(args)` | `/tail` |
| probes | `pending` / `refreshing` / `online` — report, never act | `/probes` |

| Reach it beyond the browser | what it is | page |
| --- | --- | --- |
| CLI | a standalone binary — schema-derived flags, streamed output, REPL | `/cli` |
| MCP | `/__abide/mcp` serves every exposed verb and socket as a tool | `/mcp` |
| OpenAPI | `/openapi.json` describes the whole `/rpc/*` surface | `/rpc` |
| bundle | a movable desktop app — native webview, menus, connect screen | `/bundle` |

| Configure, test, ship | what it is | page |
| --- | --- | --- |
| configuration | `env()` validates the process environment at boot | `/reference` |
| security | cross-origin mutation gate, MCP/socket Origin checks, auth seam | `/security` |
| testing | `createTestApp()` boots the real app in-process | `/reference` |
| observability | `health()` / `reachable()` / `log` / `trace` + inspector | `/health`, `/logging` |
| deploy | a single compiled binary — no Bun, no `node_modules` | `/reference` |

## A tour

### The backend

A verb is a handler wrapped by its HTTP method, one export per file under `src/server/rpc/`; the file path is the URL, the schema validates args and projects the MCP tool, CLI flags, and OpenAPI operation. The same callable is consumed differently per side — `cache(searchProducts)({ q })` in-process, the swapped `fetch` in the browser, `.raw()` for a `Response`, `.stream()` for `tail()`. Standard Schema is the contract: zod, valibot, and arktype work unadapted.

```ts
// src/server/sockets/chat.ts — one broadcast topic; every client multiplexes one connection
import { socket } from '@abide/abide/server/socket'
import { z } from 'zod'

export const chat = socket({
    schema: z.object({ from: z.string(), text: z.string() }),
    tail: 50,             // retain last 50 frames for replay on connect
    clientPublish: true,  // browsers may publish (else server-only)
})
```

### The web app

Components are `.abide` files — valid HTML with `<script>`, native `<template>` control flow, `{expr}` bindings, and component-scoped `<style>`. The reactive primitives (`state`, `derived`, `effect`, `prop`) are in scope without import; `cache()` wraps a verb with coalescing, an SSR snapshot baked into the initial HTML, and reactivity — the same line on both sides.

```html
<script>
import { cache } from '@abide/abide/shared/cache'
import { navigate } from '@abide/abide/ui/navigate'
import { getProduct } from '$server/rpc/getProduct.ts'

let id = prop('id')                              // typed via src/.abide/routes.d.ts
const product = derived(() => cache(getProduct)({ id }))
</script>

<template await={product}>
    <template then="p"><h1>{p.name}</h1></template>
</template>
<button onclick={() => navigate('/')}>home</button>
```

Folders under `src/ui/pages/` are routes; a `page.abide` is a page, `[id]` / `[...rest]` segments become params, and layouts are userland (a page imports and wraps its own). `tail()` is the reactive consumer for sockets and `fn.stream(args)`; `pending` / `refreshing` / `online` are standalone probes that report state without opening a fetch.

### Beyond the browser

abide derives a CLI from the rpc registry — every schema-carrying verb becomes a subcommand, `abide cli` builds a standalone thin client that ships the compiled server beside it. `/__abide/mcp` serves every MCP-exposed verb and socket as a tool, and an in-app agent runs a model engine against that same already-gated surface:

```ts
// src/server/rpc/chat.ts
import { agent } from '@abide/abide/server/agent'
import { jsonl } from '@abide/abide/server/jsonl'
import { engine } from '@abide/anthropic'

const chatEngine = engine({ model: 'claude-opus-4-8', apiKey: config.ANTHROPIC_API_KEY })
export const chat = POST(({ messages }) => jsonl(agent(chatEngine, messages)), { inputSchema })
```

`abide bundle` wraps the whole thing in a movable desktop app — the compiled server binary plus a native webview that boots into a connect screen.

### Configure, test, ship

`env()` validates the process environment against a Standard Schema at module load, so a bad deploy fails the boot loudly. Cross-origin browser mutations 403 by default and the MCP mount gets the same Origin check; an optional `src/app.ts` exports the blessed auth seam in front of every verb, MCP, and socket. `createTestApp()` boots the real app in-process on an ephemeral port — the full pipeline runs, not a fixture. The Dockerfile ships the **compiled binary**, which needs neither Bun nor `node_modules`.

```ts
import { createTestApp } from '@abide/abide/test/createTestApp'

await using app = await createTestApp()              // await using → auto stop + slot restore
const product = await app.rpc.searchProducts({ q: 'shoes' })
```

## Run it

| command | does |
| --- | --- |
| `abide scaffold <name>` | scaffold + install + start dev |
| `abide dev` | build + run with hot reload |
| `abide build` | build the client into `dist/_app/` |
| `abide start` | run the production server against `dist/` |
| `abide compile` | build a standalone server executable |
| `abide cli` | build the thin CLI client (ships the server) |
| `abide bundle` | build a movable desktop app bundle |
| `abide check` | type-check `.abide` templates + props |

## Full reference

Import namespaces mark the side a name runs on: `@abide/abide/server/*` is server-side, `@abide/abide/ui/*` is client-side, and `@abide/abide/shared/*` is isomorphic (same callable, same behaviour on both sides — `shared/cache`, `shared/HttpError`, `shared/url`, …).

Every surface, option, default, env var, and route is documented and runnable in the kitchen-sink example — `/components` for the full `.abide` template grammar, `/reference` for the env vars, routes, project layout, and deploy. Run it with `bun run dev` (above) and read the source alongside each page.

MIT
