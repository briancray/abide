# Per-route code-splitting + content-hashed immutable assets (TODO #6)

Design record + shipped state for TODO #6 — the client is code-split per route, every artifact is
content-hashed and served immutable, and the first load ships only the matched route's chunk (+ the
shared runtime) instead of the whole app. Supersedes the "single non-minified bundle" model.

## Decisions

1. **Single loader entry + per-pattern dynamic imports (not N Bun entrypoints).** The generated loader
   entry holds a `LOADERS = { "<pattern>": () => import("<chain>") }` map. `Bun.build({ splitting: true })`
   turns each dynamic import into its own content-hashed chunk and factors the shared runtime + shared
   layouts/components into shared chunks. This is simpler than N entrypoints (Bun owns all chunk URLs)
   and keeps a single boot path.
2. **`compose` (layout chain) moves INTO the chunk.** Each route's chunk is a generated *chain module*
   that statically imports its page + layouts and `export default compose([...levels])`. So a page's
   layout modules load with it; shared layouts factor into shared chunks across routes.
3. **No back-compat — everything content-hashed + immutable.** The fixed `/__abide/client.js` +
   `/__abide/client.css` routes are gone. Every output (loader entry, per-route chunks, shared chunks,
   CSS) is named `[name]-[hash].[ext]` and served at `/__abide/chunk/<file>` with
   `cache-control: public, max-age=31536000, immutable`. The SSR document references the hashed loader
   URL for the current build.
4. **`publicPath: "/__abide/chunk/"`.** Bun rewrites every chunk URL (static + dynamic) to this prefix,
   so the router serves them from a `files` map by basename. Dev / test build in-memory on first use;
   **production `abide start` serves the artifacts written by `abide build`** — `build` writes every
   hashed file + an `index.json` (per-build) + a stable `dist/manifest.json` pointer into
   `dist/_app/<hash>/`, and `start` loads that manifest into `config.clientBuild` so the router serves
   the exact build output with **no bundler at request/boot time**. `start` auto-builds if no manifest
   is present. The `ClientBuild` shape is identical whether built in-memory or loaded from disk, so the
   router (`clientBuildFor(config)`) is blind to which produced it.
5. **Pattern matching stays synchronous + eager; only the module BODY defers.** `pagePatterns()` (the
   loader keys) ship eagerly in the loader entry, so `matchRoute` / link interception / first-mount
   matching never block. `loadPageEntry(pattern)` imports (and memoizes) a route's chunk, deduping
   concurrent loads (an in-flight `Map`) so soft-nav's early prime doesn't double-fetch.
6. **`mountPathname` is async; await the chunk BEFORE the dispose.** The destination chunk is loaded
   before the previous mount is disposed, so the dispose→hydrate window stays synchronous (no blank gap).
   A resident chunk resolves in a microtask (first load + same-route param nav are effectively sync). A
   chunk-load failure returns false → the caller falls back to a full document load.
7. **`modulepreload` the current route's chunk (no first-load waterfall).** The build maps each pattern →
   its chunk filename (via the chain's unique index-prefixed slug); the SSR document emits
   `<link rel="modulepreload" href="/__abide/chunk/<chunk>">` for the matched route, so the browser
   fetches the page chunk in parallel with the loader instead of after it.
8. **Soft-nav primes early.** `softLoad` kicks `loadPageEntry(targetPattern)` up front so the chunk
   import overlaps the fetch + frame stream, then awaits it right before hydrate.

## Shipped

- **Build** (`server/internal/clientBundle.ts`): `buildClient(config) → { entry, cssFile, files,
  chunkByPattern }`. Generates a chain module per route + one loader entry, `Bun.build({ splitting: true,
  publicPath, naming: [hash] })`, returns all files keyed by hashed basename + the pattern→chunk map. CSS
  assets are concatenated (sorted for a stable hash) into one `style-<hash>.css`.
- **Serve** (`server/internal/router.ts`): one `/__abide/chunk/<file>` route serves any built file
  immutable; the page render threads the hashed loader + css + preload URLs into the document.
- **Boot** (`ui/internal/{bootstrap,pageRegistry}.ts`): `registerPages(loaders, specs, base)` +
  `loadPageEntry` (memo + in-flight dedup); `bootstrapApp` `void`s the async first mount.
- **Nav** (`ui/navigate.ts`): async `mountPathname` (await chunk before dispose), soft-nav early prime.
- **Document** (`server/internal/pages.ts`): `RenderDocumentOptions` gains `clientHref` / `cssHref` /
  `preloadHref`; the fixed script/link tags become hashed URLs.
- **CLI** (`cli/main.ts`, `cli/serve.ts`): `abide build` writes every hashed file + `index.json` (entry,
  css, files, chunkByPattern) to `dist/_app/<hash>/` + a stable `dist/manifest.json` pointer; the outer
  hash is a digest of the manifest. `abide start` loads that build (`loadClientBuild` → `config.clientBuild`,
  building first if absent) so the router serves the exact artifacts with no bundler at boot; the router
  resolves the client via `clientBuildFor(config)` (prebuilt if present, else in-memory).

Verified: 962 abide unit tests, `abide check packages/docs`, and the docs Playwright e2e (95) green;
tsc + biome clean. The abide browser-execution unit tests were reworked to materialize the served split
graph to a temp dir (rewriting `/__abide/chunk/` → `./`) and `await import()` the loader, so they execute
the REAL split output (happy-dom can't resolve ESM dynamic imports over HTTP; the docs e2e in real
Chromium is the authoritative split-hydration gate).

## Bonus fix surfaced by this work — SSE opens immediately (`server/sse.ts`)

Async hydration delays the socket page's `bind:element` subscribe by the chunk-load waterfall, which
exposed a latent SSE slowness: for a byte-idle socket with an empty tail, `sse()` enqueued nothing until
the first message or the 15s heartbeat, so `onopen` (and the "live" status) fired ~15s late. Fixed by
flushing a `:ok` comment prelude on connect — `onopen` now fires immediately (socket "live" dropped from
~16.8s → ~1.3s in the e2e). Comments are ignored by every EventSource; message delivery is unchanged.

## Sizes (measured)

- Docs app (34 pages), production: was a single **298 KB min / 69 KB gz** bundle every page paid. Now
  first load ships the loader entry + the matched route's chunk + shared chunks — a small fraction of the
  whole app; other routes load lazily on soft-nav. This is the dominant "much smaller" win.
- A trivial page's shared **runtime floor** is ~26 KB min / 9.5 KB gz (loader entry: bootstrap + navigate
  + registry + clientProxy + cell + runtime, factored into the entry + a shared chunk).

## Deferred — shared runtime-floor reduction (the "shrink the runtime" follow-up)

The always-shipped floor is dominated by `shared/cell.ts` (~14.6 KB min / 5.1 KB gz client closure),
which the client pulls in whole even for a page with no RPC / no state. cell drags SERVER-ONLY code into
the client: the `ReplayableStream` machinery + stream probes (client streaming is handled in `runtime.ts`,
not the cell — `.chunks`/`.done`/`.resumeStream` are dead client-side), the cross-request SHARED store +
LRU accounting, cache-tag registration, the `notify` broadcast sink, and request-scope guards. All are
already `!isBrowser`-gated at RUNTIME, but esbuild can't tree-shake them because always-live scalar paths
(`startLoad`, `coalescedLoad`, `mapRead`) reference them.

Measured ceiling: a lean client cell = **−6.6 KB min / −2 KB gz off every app** (floor −27% min).

Two ways to get it, both rejected/deferred for now:
- **(a) A parallel `cellClient.ts`** the browser build aliases to — DUPLICATES cell's scalar read/verb
  logic, so the two drift. Rejected (not worth the maintenance/divergence risk for ~2 KB gz).
- **(b) Non-duplicating `define`-gated dead-code elimination**: introduce a single build-time flag
  (`define: { __ABIDE_CLIENT__: true }` for the browser build) and gate every server-only branch AND the
  `startStream`/shared/tags helpers behind it, so esbuild proves them dead and drops them + their imports
  (ReplayableStream, sharedCache, cacheTags, scope, responseSource). Keeps ONE `cell.ts` (no drift). This
  is a moderate refactor of the most bug-prone module's hot path — worth doing as its own focused,
  well-tested change, not bolted onto the splitting work. Plain `define` with the code as-is measured
  zero effect (the branches are runtime `isBrowser` checks esbuild can't prove dead); the refactor is what
  makes DCE possible.

Also deferred: per-chunk CSS (all CSS is concatenated into one eager stylesheet today); stable-loader
caching (the loader embeds every chunk's hashed URL, so any page change re-hashes the loader — an inline
`#__abide-manifest` of pattern→URL read at runtime would keep the loader byte-stable across page changes).
