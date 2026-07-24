// SERVER-SIDE PAGE SSR (M5a) — abide-compiler C6 (pages/routing), C6-nav (first load = full SSR).
//
// `renderPage` assembles a `page.abide` source and renders it inside the CURRENT request scope,
// producing the inner SSR HTML. In-template RPC reads (C3) run in-proc through the cell during
// render, so the page's data lands inline in the HTML. `renderDocument` wraps that inner HTML in a
// full HTML document with the hydration-seed script placeholder.
//
// The page's stripped `import` bindings are resolved by name against an injected map merging (a) the
// app's RPC callables (keyed by route name) and (b) the standard ambient accessors a page may import
// (route/identity/request/cookies). Real module-swap resolution is M3b.
//
// The §5 hydration seed payload (`collectSeed`) records every RPC read the page resolved during SSR
// — as `{ reads: [{ name, args, value }] }`, each value trimmed to its output schema — so the client
// replays them from cache instead of re-fetching on hydration. An empty seed serialises to `{}`.

import { encode } from '../../shared/internal/codec.ts'
import type { CacheContext } from '../../shared/internal/context.ts'
import { getContext, runInContext } from '../../shared/internal/context.ts'
import { jsonSchemaOf, shapeToSchema } from '../../shared/internal/shapeToSchema.ts'
import { log } from '../../shared/log.ts'
import { route } from '../../shared/route.ts'
import type { State, StateCell } from '../../shared/state.ts'
import { state } from '../../shared/state.ts'
import { url } from '../../shared/url.ts'
import { watch } from '../../shared/watch.ts'
import { loadEmittedServer } from '../../ui/internal/emit.ts'
import { Raw } from '../../ui/internal/serverRuntime.ts'
import { createStreamScope, documentPatch, drainPatches } from '../../ui/internal/streamScope.ts'
import { cookies } from '../cookies.ts'
import { identity } from '../identity.ts'
import { request } from '../request.ts'
import type { Socket } from '../socket.ts'
import { applicableLayoutPrefixes } from './layouts.ts'
import type { Rpc } from './makeRpc.ts'
import type { AppConfig, Route } from './router.ts'

// Wrap one route as the value a page sees under its name. Under the Promise-read model the read's
// bare call IS the coalesced load (`await greet(args)` → the value); SSR awaits it into the HTML.
// `.peek()` is the sync `T | undefined` snapshot. Probe/verb methods are carried through for parity.
// Mutations are already promise-returning callables, passed through untouched.
function pageCallable(entry: Route): unknown {
    if (entry.__rpc.read !== true) return entry
    const rpc = entry as Rpc<unknown, unknown>
    const callable = (args: unknown): Promise<unknown> => rpc(args)
    return Object.assign(callable, {
        peek: rpc.peek,
        load: rpc.load,
        pending: rpc.pending,
        refreshing: rpc.refreshing,
        error: rpc.error,
        watch: rpc.watch,
        raw: rpc.raw,
        isError: rpc.isError,
        refresh: rpc.refresh,
        invalidate: rpc.invalidate,
        publish: rpc.publish,
        snapshot: rpc.snapshot,
        seed: rpc.seed,
        __rpc: rpc.__rpc,
    })
}

// Build the imports map: RPC callables by route name, socket instances by socket name, then the
// ambient accessors (added last so a standard accessor name always resolves to the accessor). A
// `.abide` that imports a socket from `server/sockets/<name>.ts` reads the REAL isomorphic `Socket`
// off `$scope` during SSR — its `[Symbol.asyncIterator]` is snapshot-then-complete under render (CS5).
function pageImports(
    routes: Record<string, Route>,
    sockets: Record<string, Socket<unknown>>,
): Record<string, unknown> {
    const imports: Record<string, unknown> = {}
    for (const [name, routeDef] of Object.entries(routes)) {
        imports[name] = pageCallable(routeDef)
    }
    for (const [name, sock] of Object.entries(sockets)) {
        imports[name] = sock
    }
    imports.route = route
    imports.url = url
    imports.identity = identity
    imports.request = request
    imports.cookies = cookies
    return imports
}

// Render a page source to its inner SSR HTML inside the active request scope, through the AOT-emitted
// server module (`loadEmittedServer(source).render($scope)`). The server-only loader never imports
// the emitted client module, so SSR stays DOM-free and cached per source.
//
// The emitted `render($scope)` looks up each `<script>` import by its local name via `$scope[local]`,
// so the merged scope is `pageImports` plus the framework bindings a page may import (state/watch/
// props). RPC callables are the request-scoped `pageCallable`s, so in-proc reads land in the cache
// during render and `collectSeed` records them.
// The `state` binding a page sees during SSR: a recorder over the real `state`, PER-COMPONENT-LOCALIZED
// (the mirror of the client `makeSeededState`). Each `state(...)` call pushes its RAW initial
// (pre-transform) into the CURRENT component's bucket in call order, then delegates to the real cell
// factory (behaviour identical). We record the raw initial — not the post-transform value — because the
// client replays it as `state(seed, transform)`, so the transform is re-applied there; recording the
// post-transform value would double-apply it. `.computed`/`.linked` are passed through untouched (they
// carry no serializable initial and never consume a seed slot on the client), so a bucket's local ordinal
// count stays identical on both sides. `context.states` is `unknown[][]` — one bucket per component
// instance in mount order; `forComponent()` opens the next bucket and returns a recorder bound to it. The
// page + its layouts share the root bucket (bucket 0); each `<Component/>` adapter opens its own, so a
// component's `state()`-sequence divergence stays inside its bucket. See §5 / decision 10.
function makeRecordingState(): State {
    const buckets = getContext().states as unknown as unknown[][]
    function forComponent(): State {
        const bucket: unknown[] = []
        buckets.push(bucket)
        const rec = function recordState<T>(initial: T, transform?: (value: T) => T): StateCell<T> {
            bucket.push(initial)
            return state(initial, transform)
        } as State
        return Object.assign(rec, {
            computed: state.computed,
            linked: state.linked,
            shared: state.shared,
            forComponent,
        }) as State
    }
    return forComponent() // the page/root = component bucket 0
}

// Render one composed level (a layout or the page) to its inner SSR HTML. When a deeper level exists,
// inject `children` into the scope as a server component (`(props, childrenFn) => Raw`) that renders
// the NEXT level on demand — so the layout's `{children()}` component slot (templatePlan) emits it in
// place, wrapped in the paired block anchors the client hydrate walk expects. Rendering the child
// lazily (when the parent hits `{children()}`) records `state(...)` in outer→inner call order, which
// matches the client mount order so the hydration-seed ordinals line up (§5 / decision 10).
// `dirs[index]` is the source dir of `levels[index]` (a layout's or the page's `.abide` file dir),
// used to resolve that level's `.abide` component imports against the filesystem during SSR.
async function renderLevel(
    levels: string[],
    dirs: (string | undefined)[],
    index: number,
    imports: Record<string, unknown>,
): Promise<string> {
    const level = levels[index]
    if (level === undefined) throw new Error(`renderLevel: no level at index ${index}`)
    const emitted = await loadEmittedServer(level, dirs[index])
    const scope: Record<string, unknown> = {
        ...imports,
        // `imports.state` is the shared ROOT recorder (bucket 0), created once per render in renderPage —
        // page + all layout levels record into it; `<Component/>` adapters branch off via `.forComponent()`.
        state: imports.state,
        watch,
        props: () => ({}),
    }
    if (index + 1 < levels.length) {
        scope.children = async (): Promise<Raw> =>
            new Raw(await renderLevel(levels, dirs, index + 1, imports))
    }
    return emitted.render(scope)
}

// Render a page (and its applicable layouts) to inner SSR HTML in the active request scope. `pattern`
// is the matched route pattern; its layout chain (root → nearest, TODO #7) wraps the page outer→inner.
// A parallel `dirs` array carries each level's source dir (layouts keyed by prefix in `layoutDirs`,
// the page by `pattern` in `pageDirs`) so each level resolves its own `.abide` component imports.
// When `streaming` is true (first-load full document), install the per-render stream scope so a
// streaming-form `{#await}` read that blocks past the deadline defers instead of holding the render —
// the returned string is the SHELL (placeholders for deferred subtrees), whose deferreds live on the
// request context for `streamPageDocument` to drain. When false (soft-nav / tests), no stream scope is
// installed → `awaitStream` awaits fully inline, so the returned string is the COMPLETE inner HTML.
export async function renderPage(
    source: string,
    config: AppConfig,
    pattern?: string,
    streaming = false,
    sharedLevels = 0,
): Promise<string> {
    log.channel('abide:ssr').trace(
        `render ${pattern ?? '(inline)'}${streaming ? ' (streaming)' : ''}`,
    )
    // Mark this request as a page render for the whole render lifetime (inline + streamed drain), so a
    // socket iterated in a `{#for await}` resolves to snapshot-then-complete instead of a live topic
    // that would hang the render (client-sockets.md CS5). Never cleared — the context dies with the request.
    getContext().rendering = true
    if (streaming) getContext().stream = createStreamScope()
    const imports = pageImports(config.routes ?? {}, config.sockets ?? {})
    // The shared ROOT state recorder (bucket 0) for this render — page + layouts record into it; each
    // `<Component/>` adapter opens its own bucket via `.forComponent()` (per-component-localized seed).
    imports.state = makeRecordingState()
    const layouts = config.layouts ?? {}
    const layoutDirs = config.layoutDirs ?? {}
    const pageDirs = config.pageDirs ?? {}
    const prefixes = pattern !== undefined ? applicableLayoutPrefixes(pattern, layouts) : []
    const levels = [
        ...prefixes.map((prefix) => {
            const layout = layouts[prefix]
            if (layout === undefined)
                throw new Error(`renderPage: missing layout for prefix ${prefix}`)
            return layout
        }),
        source,
    ]
    const dirs = [
        ...prefixes.map((prefix) => layoutDirs[prefix]),
        pattern !== undefined ? pageDirs[pattern] : undefined,
    ]
    // On a same-chain soft-nav the shared outer layouts (`[0..sharedLevels)`) stay LIVE on the client,
    // so render only the diverging suffix. The root recorder records this render only — the suffix's
    // buckets start at component 0, exactly what the client's fresh sub-hydrate seed replays.
    return renderLevel(levels.slice(sharedLevels), dirs.slice(sharedLevels), 0, imports)
}

// Pre-compile every page and layout `.abide` source at serve start so the AOT emit (parse → analyze →
// emit → temp-module import, plus each level's `.abide` component tree) happens ONCE up front rather
// than lazily on the first request that hits each page. `loadEmittedServer` only COMPILES (it never
// renders), so this needs no request scope. Priming `SERVER_MODULE_CACHE` removes the first-hit
// latency that otherwise races a parallel wave of requests (the docs Playwright e2e flaked under
// `fullyParallel` because the first workers all raced the on-demand compile — see TODO test-coverage
// gap). Compiles concurrently; a per-level failure is logged and skipped so a single broken page never
// blocks boot (the real request re-surfaces the error). No-op when the config declares no pages.
export async function warmPages(config: AppConfig): Promise<void> {
    const pages = config.pages ?? {}
    const pageDirs = config.pageDirs ?? {}
    const layouts = config.layouts ?? {}
    const layoutDirs = config.layoutDirs ?? {}
    const jobs: Promise<unknown>[] = []
    for (const [routePath, source] of Object.entries(pages)) {
        jobs.push(warmLevel(source, pageDirs[routePath], `page ${routePath}`))
    }
    for (const [prefix, source] of Object.entries(layouts)) {
        jobs.push(warmLevel(source, layoutDirs[prefix], `layout ${prefix}`))
    }
    await Promise.all(jobs)
}

async function warmLevel(source: string, dir: string | undefined, label: string): Promise<void> {
    try {
        await loadEmittedServer(source, dir)
    } catch (caught) {
        log.channel('abide:ssr').error(
            `page warmup failed for ${label}:`,
            caught instanceof Error ? caught.message : String(caught),
        )
    }
}

// One recorded SSR read for the hydration seed: the RPC route name, the args it was called with, and
// the (output-shaped) value it resolved to.
export interface SeedRead {
    name: string
    args: unknown
    value: unknown
}

// One attachable `{#for await}` stream handed off to the client (replayable-streams.md §5). `listId`
// matches the `<abide-list id>` the SSR painted; `name`/`args` identify the source RPC for a mode-B
// resume (`GET /__abide/rpc/<name>?__abide_args=…&__abide_from=<count>`); `done` picks the mode (true → adopt `values`, false
// → resume); `count` is the flushed item count (= `values.length`); `values` is the decoded transcript
// so mode A re-mounts with zero network. `values` is absent only if it wasn't JSON-serializable.
export interface StreamHandle {
    listId: string
    name: string | null
    args: unknown
    done: boolean
    count: number
    values?: unknown[]
}

// The hydration seed payload. Empty (`{}`) when the page resolved no reads and declared no state.
export interface HydrationSeed {
    reads?: SeedRead[]
    // Recorded `state(initial)` initials, grouped per component in call order, so the client seeds each
    // cell with the same value the server rendered (decision 10). Present only when the page declared
    // state. These are hydrated NON-RPC values, so — unlike the JSON-only RPC `reads`/`streams` — the
    // whole `unknown[][]` bucket structure is serialized with the rich value codec (`encode`), preserving
    // Date/Map/Set/BigInt/TypedArray and shared/circular references across the record. The field holds
    // that one `encode(...)` string; the client `decode`s it. A codec-unsupported initial (function/
    // symbol/class instance) is encoded as `null` rather than crashing the render (lossy mode).
    states?: string
    // Attachable `{#for await}` handoff records (§5). Present only when the page streamed a known-RPC
    // source; the client adopts/resumes each instead of re-invoking the source on hydrate.
    streams?: StreamHandle[]
}

// Keep a recorded state initial JSON-serializable so serialising the seed never throws (a non-JSON
// value — e.g. BigInt, circular — is dropped to `null`; documented seed-contract limitation). Returns
// the value unchanged when it round-trips, preserving the ordinal (never drops an entry).
function jsonSafeState(value: unknown): unknown {
    try {
        JSON.stringify(value)
        return value
    } catch {
        return null
    }
}

// Record every RPC read resolved during this SSR render into the hydration seed (rpc-core §5). MUST
// run inside the same request scope as `renderPage` — it reads each read-RPC's resolved cache slots
// via `snapshot()`. Values are trimmed to the declared output schema (output-shaping, §5.2) so no
// undeclared field reaches the client. Returns `{}` when nothing was read (keeping the seed script
// and soft-nav envelope byte-identical to the pre-seed behaviour for read-free pages).
export function collectSeed(config: AppConfig): HydrationSeed {
    const routes = config.routes ?? {}
    const reads: SeedRead[] = []
    for (const [name, entry] of Object.entries(routes)) {
        if (entry.__rpc.read !== true) continue
        const rpc = entry as Rpc<unknown, unknown>
        const outputSchema = jsonSchemaOf(rpc.__rpc.options.schemas?.output)
        for (const record of rpc.snapshot()) {
            reads.push({
                name,
                args: record.args,
                value: shapeToSchema(record.value, outputSchema),
            })
        }
    }
    // State initials recorded during this SSR render (same request scope as `renderPage`), grouped into
    // per-component buckets in mount order. Keep empty buckets — bucket ids are positional, so a hole
    // would shift every later component. Skip the whole field only when NO component recorded any state.
    const recorded = getContext().states as unknown as unknown[][]
    const seed: HydrationSeed = {}
    if (reads.length > 0) seed.reads = reads
    // Encode the whole bucket structure once (lossy: an unsupported initial → `null` node, never a throw)
    // so the rich codec carries non-RPC state initials the JSON seed used to flatten to `null`.
    if (recorded.some((bucket) => bucket.length > 0)) seed.states = encode(recorded, true)
    // Attachable `{#for await}` handoffs recorded during this render (§5). Values/args are JSON-safed
    // like state initials — a non-serializable entry drops to `null` rather than crashing the seed. The
    // decoded values leak nothing the SSR HTML did not already paint.
    const streamRecords = getContext().stream?.streamHandles
    if (streamRecords !== undefined && streamRecords.length > 0) {
        seed.streams = streamRecords.map((record) => ({
            listId: record.listId,
            name: record.name,
            args: jsonSafeState(record.args),
            done: record.done,
            count: record.count,
            values: record.values.map(jsonSafeState),
        }))
    }
    return seed
}

export interface RenderDocumentOptions {
    title?: string
    // BP2.3: dev-only inline JS wired into the document as a `<script>` — the live-reload client.
    // Absent in production (and in every existing test), so the emitted document is unchanged there.
    devReloadScript?: string | undefined
    // The §5 hydration seed to inline into `#__abide-seed`. Absent → the empty `{}` payload.
    seed?: HydrationSeed | undefined
    // TODO #6: the content-hashed loader entry URL the document boots from (`/__abide/chunk/<loader>-
    // <hash>.js`). Absent only for the byte-identity oracle / hand-built callers that don't boot a client.
    clientHref?: string | undefined
    // TODO #6/#20: the content-hashed client stylesheet URL to link in `<head>`. Set only when the app
    // actually bundled CSS, so CSS-free apps emit no `<link>`.
    cssHref?: string | undefined
    // TODO #6: the matched route's code-split chunk URL to `<link rel="modulepreload">` — so the browser
    // fetches it in parallel with the loader (no first-load waterfall). Absent for the byte-oracle callers.
    preloadHref?: string | undefined
}

const DOCUMENT_TITLE_ESCAPE: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' }

function escapeTitle(value: string): string {
    return value.replace(/[&<>]/g, (char) => {
        const escaped = DOCUMENT_TITLE_ESCAPE[char]
        if (escaped === undefined) throw new Error(`escapeTitle: no escape for ${char}`)
        return escaped
    })
}

// Serialise the seed for embedding in a `<script type="application/json">`. `<` is escaped to its
// `<` JSON escape so a value containing `</script>` cannot break out of the script element while
// the payload stays valid JSON the client parses back verbatim.
function serialiseSeed(seed: HydrationSeed | undefined): string {
    return JSON.stringify(seed ?? {}).replace(/</g, '\\u003c')
}

// The document split around the inner SSR HTML: `documentHead` is everything up to and including the
// app container's opening tag (seed-independent, so it can flush before any read settles); the tail is
// the container close plus the hydration-seed + client scripts (needs the seed, computed only AFTER the
// shell + streamed patches). `renderDocument` (`head + inner + tail`) stays byte-identical to the
// pre-streaming output for the buffered callers/tests.
export function documentHead(opts?: RenderDocumentOptions): string {
    const title = escapeTitle(opts?.title ?? 'abide')
    const stylesheet =
        opts?.cssHref !== undefined ? `<link rel="stylesheet" href="${opts.cssHref}">` : ''
    const preload =
        opts?.preloadHref !== undefined
            ? `<link rel="modulepreload" href="${opts.preloadHref}">`
            : ''
    return (
        `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>${stylesheet}${preload}</head>` +
        `<body><div id="__abide-app">`
    )
}

export function documentTail(
    seed: HydrationSeed | undefined,
    opts?: RenderDocumentOptions,
): string {
    const devReload =
        opts?.devReloadScript !== undefined && opts.devReloadScript.length > 0
            ? `<script id="__abide-dev-reload">${opts.devReloadScript}</script>`
            : ''
    const clientScript =
        opts?.clientHref !== undefined
            ? `<script type="module" src="${opts.clientHref}"></script>`
            : ''
    return (
        `</div>` +
        `<script type="application/json" id="__abide-seed">${serialiseSeed(seed)}</script>` +
        `${clientScript}${devReload}</body></html>`
    )
}

// Wrap inner SSR HTML in a full HTML document, inlining the §5 hydration seed so the client replays
// SSR-computed reads instead of re-fetching them. Buffered/byte-identical (the seed rides in `opts`).
export function renderDocument(inner: string, opts?: RenderDocumentOptions): string {
    return documentHead(opts) + inner + documentTail(opts?.seed, opts)
}

// The streaming SSR transport (PR2). Serves `head → shell → out-of-order patches → tail` over a
// `ReadableStream`. The shell (first-load render of the SHELL string, with `<abide-slot>` placeholders
// for any read that blocked past the deadline) flushes immediately; each deferred subtree streams as a
// `<template>` + move-script patch when it resolves; the seed is collected AFTER the patches drain
// (so streamed reads are included — PR2 keeps one tail seed; PR3 splits it per-patch) and the tail
// flushes last. The drain + `collectSeed` run inside the captured request context so they read the
// same request cache. The render-error → 500 guarantee holds: `renderPage` (which awaits blocking
// reads) has already returned before this stream is constructed.
export function streamPageDocument(
    shell: string,
    ctx: CacheContext,
    config: AppConfig,
    opts?: RenderDocumentOptions,
): ReadableStream<Uint8Array> {
    const stream = ctx.stream
    const encoder = new TextEncoder()
    const head = documentHead(opts)
    return new ReadableStream<Uint8Array>({
        async start(controller) {
            const enc = (chunk: string): void => controller.enqueue(encoder.encode(chunk))
            enc(head)
            enc(shell)
            try {
                if (
                    stream !== undefined &&
                    (stream.deferred.length > 0 || stream.streamers.length > 0)
                ) {
                    await runInContext(ctx, async () => {
                        for await (const patch of drainPatches(stream)) enc(documentPatch(patch))
                    })
                }
            } catch (caught) {
                log.channel('abide:stream').error('streaming SSR drain failed:', caught)
            }
            const seed = runInContext(ctx, () => collectSeed(config))
            enc(documentTail(seed, opts))
            controller.close()
            ctx.stream = undefined // per-render scope — never leak deferreds onto a reused context.
        },
    })
}

// The STREAMING soft-nav transport (PR4). An in-app navigation streams a JSONL frame stream instead of
// the old buffered `{html, seed}` JSON envelope, so a slow read shows the shell then streams in — same
// as first load. Frames (one JSON object per line): `{kind:"shell", html, url}` first (the client
// swaps it into `#__abide-app` immediately), then `{kind:"patch", id, html}` per deferred subtree as it
// resolves (the client fills the `<abide-slot>` — a `fetch`ed body's inline scripts don't run, so it
// applies patches in JS via the same DOM op the first-load move-script does), then `{kind:"seed", seed}`
// last (collected AFTER the drain so streamed reads are included). The client replays the seed and
// hydrates/claims the fully-assembled DOM once the stream ends (`ui/navigate.ts`). Runs the drain +
// `collectSeed` in the captured request context so they read the same request cache.
export function streamSoftNav(
    shell: string,
    ctx: CacheContext,
    config: AppConfig,
    urlPath: string,
    sharedLevels = 0,
): ReadableStream<Uint8Array> {
    const stream = ctx.stream
    const encoder = new TextEncoder()
    return new ReadableStream<Uint8Array>({
        async start(controller) {
            // The client can navigate away / abort mid-stream (e.g. a soft-nav's background middleware
            // confirm never reads the body — it only wants the redirect envelope). That's EXPECTED, not a
            // server fault: a cancelled controller reports `desiredSize === null`, so stop writing rather
            // than throwing/logging. Only a genuine render error surfaces below.
            let disconnected = false
            const frame = (obj: unknown): void => {
                if (disconnected || controller.desiredSize === null) {
                    disconnected = true
                    return
                }
                try {
                    controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`))
                } catch {
                    disconnected = true
                }
            }
            // `sharedLevels` > 0: the shell is only the diverging suffix; the client keeps that many outer
            // layout instances alive and grafts this into the innermost kept layout's outlet (C6.2).
            frame({ kind: 'shell', html: shell, url: urlPath, sharedLevels })
            try {
                if (
                    stream !== undefined &&
                    (stream.deferred.length > 0 || stream.streamers.length > 0)
                ) {
                    await runInContext(ctx, async () => {
                        for await (const patch of drainPatches(stream)) {
                            if (disconnected) break // client gone — stop draining
                            if (patch.op === 'complete') frame({ kind: 'complete', id: patch.id })
                            else frame({ kind: patch.op, id: patch.id, html: patch.html }) // "fill" | "append"
                        }
                    })
                }
            } catch (caught) {
                // A genuine render/drain error — a client disconnect is already absorbed by `frame`.
                log.channel('abide:stream').error('streaming soft-nav drain failed:', caught)
            }
            if (!disconnected) {
                const seed = runInContext(ctx, () => collectSeed(config))
                frame({ kind: 'seed', seed })
                try {
                    controller.close()
                } catch {
                    // Raced with a client disconnect between the guard and here — nothing to do.
                }
            }
            ctx.stream = undefined
        },
    })
}
