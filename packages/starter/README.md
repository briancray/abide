# Your abide app

An isomorphic, type-safe app on Bun and web standards. The same callable has the same name and the
same intent on both sides.

## Run it

```sh
bun run dev      # watch + live-reload, http://localhost:3000
bun run build    # code-split, hashed, precompressed client bundle into dist/
bun run start    # serve the built dist/ (no bundler at boot)
```

Checks:

```sh
bun run typecheck     # tsc over src/
bun run abide-check   # type-check the <script> bodies inside .abide files
```

## What is where

| Path | What it is |
| --- | --- |
| `src/ui/pages/**/page.abide` | A route. The folder IS the URL. |
| `src/ui/pages/**/layout.abide` | Wraps every page below it; renders the page through `<slot/>`. |
| `src/ui/components/*.abide` | Components. Import and invoke as a tag: `<Card title="…">…</Card>`. |
| `src/server/rpc/<name>.ts` | One RPC per file, served at `/__abide/rpc/<name>`. |
| `src/server/config.ts` | `env(...)` — typed and validated at BOOT, not per request. |
| `src/app.ts` | Per-request `middleware` plus the lifecycle hooks. |

Import across the tree with the `$server` / `$ui` / `$shared` aliases.

## The idea in one page

`src/server/rpc/greet.ts` exports a handler. `src/ui/pages/page.abide` imports it and calls it. That is
the whole boundary — no client, no fetch wrapper, no generated SDK:

```html
<script module>
  import greet from '$server/rpc/greet'
</script>
<h1>{await greet({ name: 'world' })}</h1>
```

On the server that call runs in-process; in the browser the same import resolves to a proxy that goes
over HTTP. `{await …}` blocks the SSR render, so the value is in the initial HTML *and* in the hydration
seed — the client does not re-fetch it. The read is keyed on its args, so changing them re-runs it.

Everything else follows from three isomorphic primitives — **`state`** (own), **`memo`** (load),
**`channel`** (subscribe) — and two transport laws over them: `rpc = memo + transport`,
`socket = channel + transport`.

## Free, because you wrote an RPC

Your handlers are already reachable as machine surfaces, from the same declaration:

- `GET /openapi.json` — an OpenAPI 3.1 document, input/output schemas derived from your types
- `POST /__abide/mcp` — every RPC as an MCP tool
- `GET /__abide/health` — extend it with `onHealth()` in `src/app.ts`

Narrow that with `clients` on any RPC (`{ clients: { mcp: false } }`) — that is reachability. For
authorization, use `middleware`.

## Notes that save time

- **`children` is reserved.** A component renders its children with `<slot/>`, which is the only
  spelling. Invoke a component as a TAG (`<Card/>`); the call form `{Card()}` is a compile error.
- **A `<script>` takes no `export`.** Its body is inlined into the component's setup, so there is
  nowhere for one to go. Share values across files from a `.ts` module you import.
- **`src/.abide/` is generated** (the typed `health()` companion) and gitignored. Your `tsconfig.json`
  names it explicitly in `include`, because a wildcard never descends into a dot-directory.
