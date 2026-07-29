// SERVER-SIDE PAGE SSR (M5a) — abide-compiler C6 (pages/routing), C6-nav (first load = full SSR).
//
// `renderPage` assembles a `page.abide` source and renders it inside the CURRENT request scope,
// producing the inner SSR HTML. In-template RPC reads (C3) run in-proc through the memo during
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

import { identity } from '../../shared/identity.ts'
import { encode } from '../../shared/internal/codec.ts'
import type { HydrationSeed, SeedRead, StreamHandle } from '../../shared/internal/hydrationSeed.ts'
import type { ReactiveScope } from '../../shared/internal/reactiveScope.ts'
import {
    enterScope,
    peekReactiveScope,
    reactiveScope,
    releaseScope,
    retainScope,
} from '../../shared/internal/reactiveScope.ts'
import { jsonSchemaOf, shapeToSchema } from '../../shared/internal/shapeToSchema.ts'
import { log } from '../../shared/log.ts'
import { route } from '../../shared/route.ts'
import type { State, StateFactory } from '../../shared/state.ts'
import { state } from '../../shared/state.ts'
import { trace } from '../../shared/trace.ts'
import { url } from '../../shared/url.ts'
import { watch } from '../../shared/watch.ts'
import { loadEmittedServer } from '../../ui/internal/emit.ts'
import { HYDRATION_ELEMENT_ID } from '../../ui/internal/HYDRATION_ELEMENT_ID.ts'
import { closeRenderState, openRenderState, renderState } from '../../ui/internal/renderState.ts'
import type { ServerScopeBindings } from '../../ui/internal/SCOPE_PROVIDED.ts'
import { SITE_PATH } from '../../ui/internal/SITE_PATH.ts'
import { escapeHtml, Raw } from '../../ui/internal/serverRuntime.ts'
import {
    createRenderStream,
    documentPatch,
    documentPatchPreamble,
    drainPatches,
} from '../../ui/internal/streamScheduler.ts'
import { context } from '../context.ts'
import { cookies } from '../cookies.ts'
import { request } from '../request.ts'
import { server } from '../server.ts'
import type { Socket } from '../socket.ts'
import { applicableLayoutPrefixes } from './layouts.ts'
import type { Rpc } from './makeRpc.ts'
import type { AppConfig, Route } from './router.ts'

// Build the imports map: RPC callables by route name, socket instances by socket name. The framework
// ambients are added by `serverScopeBindings` LAST, at the point the scope is assembled, so a standard
// accessor name always resolves to the accessor rather than to an rpc that happens to share it. A
// `.abide` that imports a socket from `server/sockets/<name>.ts` reads the REAL isomorphic `Socket`
// off `$scope` during SSR — its `[Symbol.asyncIterator]` is snapshot-then-complete under render (CS5).
//
// A route is passed through AS ITSELF: under the Promise-read model a read's bare call already IS the
// coalesced load (`await greet(args)` → the value, which SSR awaits into the HTML), and `attachSurface`
// has already hung every probe/verb on the callable as an own property. Re-wrapping it would only be a
// lossy copy that has to be extended each time the `Rpc` surface grows.
function pageImports(
    routes: Record<string, Route>,
    sockets: Record<string, Socket<unknown>>,
): Record<string, unknown> {
    const imports: Record<string, unknown> = {}
    for (const [name, routeDef] of Object.entries(routes)) {
        imports[name] = routeDef
    }
    for (const [name, sock] of Object.entries(sockets)) {
        imports[name] = sock
    }
    return imports
}

// THE SERVER HALF of `SCOPE_PROVIDED`. Typed by the table, so a specifier added there without a
// binding here is a compile error rather than a `$scope["x"]` that is `undefined` at first render —
// which is what `abide/server/context` and `abide/server/server` were, listed as scope-provided and
// supplied by nobody.
function serverScopeBindings(state: unknown): ServerScopeBindings {
    return {
        // The shared ROOT recorder (bucket 0), created once per render in `renderPage` — page + all
        // layout levels record into it; `<Component/>` adapters branch off via `.forComponent()`.
        state,
        watch,
        props: () => ({}),
        route,
        url,
        identity,
        request,
        cookies,
        context,
        server,
    }
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
// (pre-transform) into the CURRENT component's bucket in call order, then delegates to the real memo
// factory (behaviour identical). We record the raw initial — not the post-transform value — because the
// client replays it as `state(seed, transform)`, so the transform is re-applied there; recording the
// post-transform value would double-apply it. `.shared` is passed through untouched (it carries no
// serializable initial and never consumes a seed slot on the client), so a bucket's local ordinal count
// stays identical on both sides.
//
// `context.states` is keyed by SITE PATH, not by mount order. A bucket's key is built from the component's
// STABLE per-module site id (assigned in `templatePlan`, read by BOTH emitters) plus, inside a loop, the
// item index — so a component instance is named by WHERE IT IS, not by WHEN IT MOUNTED. That distinction is
// the whole point: a `{#for await}` region is re-created asynchronously on the client, so a mount-order
// counter assigned every component after such a block a different id on each side and it silently replayed
// the WRONG bucket. The two path segments (`/<siteId>` for a `<Component/>` invocation, `#<index>` for a
// `{#for}` iteration) are spelled by `SITE_PATH` — the same module the client replayer joins with, so the
// two ends of this wire format cannot drift apart.
// The page + its layouts share the ROOT bucket (`""`) — `renderLevel` hands every level the same recorder
// and `compose.childComponent` is not an adapter, so composition never opens one. See §5 / decision 10.
// Inside a page render `openRenderState()` has always run, so an absent state is a framework bug, not
// a condition to branch on — say so loudly rather than silently recording seeds into a dropped bucket.
function renderStateOrThrow(): { states: Record<string, unknown[]> } {
    const state = renderState()
    if (state === undefined) throw new Error('renderState(): called outside a page render')
    return state
}

function makeRecordingState(): StateFactory {
    const buckets = renderStateOrThrow().states
    function at(sitePath: string, bucketPath: string): StateFactory {
        let bucket = buckets[bucketPath]
        if (bucket === undefined) {
            bucket = []
            buckets[bucketPath] = bucket
        }
        const owned = bucket
        const rec = function recordState<T>(initial: T, transform?: (value: T) => T): State<T> {
            owned.push(initial)
            return state(initial, transform)
        } as StateFactory
        return Object.assign(rec, {
            shared: state.shared,
            forSite(siteId: number): StateFactory {
                const next = SITE_PATH.forSite(sitePath, siteId)
                return at(next, next)
            },
            forItem(index: number): StateFactory {
                const next = SITE_PATH.forItem(sitePath, index)
                return at(next, next)
            },
        }) as StateFactory
    }
    return at(SITE_PATH.root, SITE_PATH.root) // the page/root bucket
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
        ...serverScopeBindings(imports.state),
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
// request scope for `streamPageDocument` to drain. When false (soft-nav / tests), no stream scope is
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
    reactiveScope().rendering = true
    const render = openRenderState()
    if (streaming) render.stream = createRenderStream()
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

// The SSR→client handoff contract lives in `shared/internal/hydrationSeed.ts` (ADR 0027 D10) so `ui/`
// can name it without importing `server/`. Re-exported here because this module is what WRITES the
// seed, and every server-side caller already reaches for it through `pages.ts`.
export type { HydrationSeed, SeedRead, StreamHandle }

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
    // per-component buckets KEYED BY SITE PATH (`makeRecordingState`). Empty buckets are dropped: a key is
    // computed from the template, not from position, so an absent one costs nothing and simply replays as
    // "no seed for that site". Skip the whole field when nothing recorded any state.
    const recorded = renderStateOrThrow().states
    const seed: HydrationSeed = {}
    if (reads.length > 0) seed.reads = reads
    // Encode the whole bucket map once (lossy: an unsupported initial → `null` node, never a throw) so the
    // rich codec carries non-RPC state initials the JSON seed used to flatten to `null`.
    const filled: Record<string, unknown[]> = {}
    for (const path of Object.keys(recorded)) {
        const bucket = recorded[path]
        if (bucket !== undefined && bucket.length > 0) filled[path] = bucket
    }
    if (Object.keys(filled).length > 0) seed.states = encode(filled, true)
    // Attachable `{#for await}` handoffs recorded during this render (§5). Values/args are JSON-safed
    // like state initials — a non-serializable entry drops to `null` rather than crashing the seed. The
    // decoded values leak nothing the SSR HTML did not already paint.
    const streamRecords = renderState()?.stream?.streamHandles
    if (streamRecords !== undefined && streamRecords.length > 0) {
        seed.streams = streamRecords.map((record) => ({
            name: record.name,
            args: jsonSafeState(record.args),
            done: record.done,
            values: record.values.map(jsonSafeState),
        }))
    }
    // CO2.3: hand this request's traceparent to the client so `trace()` answers in the browser. Runs
    // in the render's request scope, so it is the SAME id the response stamps as `traceresponse`. This
    // is the one seed field a read-free, state-free page still carries — the seed script is no longer
    // byte-identically `{}` for such a page, which is the deliberate cost of a trace that is a
    // property of every request rather than of whether the page happened to read something.
    const traceparent = trace()
    if (traceparent !== undefined) seed.trace = traceparent
    // AU3: hand this request's resolved principal to the client so `identity()` answers in the browser.
    // Same reasoning as the traceparent above — it is a per-request ambient the page cannot re-derive
    // (the identity cookie is HttpOnly), so it rides the seed or it does not exist client-side. Read
    // off the scope rather than through `identity()`, which THROWS outside a request by design (the
    // fail-closed guarantee): a render with no request scope should seed nothing, not fail.
    const principal = peekReactiveScope()?.identity
    if (principal !== undefined) seed.identity = principal
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
    // The boot module graph to `<link rel="modulepreload">` in `<head>`: the loader entry followed by its
    // transitive static imports (`ClientBuild.bootChunks`). Distinct from `clientHref`, which is the ONE
    // url the tail's `<script>` executes — these are the urls whose DOWNLOAD must not wait for the tail.
    bootHrefs?: string[] | undefined
    // TODO #6/#20: the content-hashed client stylesheet URL to link in `<head>`. Set only when the app
    // actually bundled CSS, so CSS-free apps emit no `<link>`.
    cssHref?: string | undefined
    // TODO #6: the matched route's code-split chunk AND its transitive static imports
    // (`ClientBuild.routeChunks`), to `<link rel="modulepreload">` — so the browser fetches them in
    // parallel with the loader instead of discovering them when the route's dynamic import resolves.
    // Absent for the byte-oracle callers.
    preloadHrefs?: string[] | undefined
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
    const title = escapeHtml(opts?.title ?? 'abide')
    const stylesheet =
        opts?.cssHref !== undefined ? `<link rel="stylesheet" href="${opts.cssHref}">` : ''
    // The boot entry is PRELOADED here even though its `<script>` tag stays in the tail. The tag has to
    // be last — it must not run before the seed element is parsed — but that meant the browser did not
    // DISCOVER the entry until `responseEnd`, so the client bundle's download was serialised behind the
    // whole streamed drain. Measured on the docs app: boot download began at 128ms on a page whose
    // `responseStart` was 7ms, and at 4494ms on one whose `responseStart` was 364ms. The head flushes
    // before the shell and is seed-independent, so preloading here decouples "when the client starts
    // downloading" from "how long this page's reads take" — which is the whole promise of streaming SSR,
    // previously honoured for paint but not for hydration.
    //
    // This is a preload, NOT a moved script: fetch is scheduled early, execution order is untouched.
    // Emitted BEFORE the route chunk because the entry is that chunk's IMPORTER — preloading the child
    // while its parent waited for the tail is what left the route chunk sitting idle (measured: route
    // chunk complete at 14ms, then unused until 128ms).
    //
    // Every chunk is named individually, on BOTH lists. A browser MAY follow a preloaded module's own
    // static imports, but the HTML spec leaves that optional and Safari declines — so preloading just
    // the entry moves the waterfall down one level rather than removing it (measured: entry at 140ms,
    // its 47KB static dependency still at 4800ms). The same holds one level further out: the route
    // chunk's own static imports were the last two left stranded until `preloadHrefs` became its whole
    // graph. What stays unpreloaded is the DYNAMIC graph — every other route's code.
    let bootPreload = ''
    for (const href of opts?.bootHrefs ?? [])
        bootPreload += `<link rel="modulepreload" href="${href}">`
    let preload = ''
    for (const href of opts?.preloadHrefs ?? [])
        preload += `<link rel="modulepreload" href="${href}">`
    return (
        `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>${stylesheet}${bootPreload}${preload}</head>` +
        `<body><div id="${HYDRATION_ELEMENT_ID.container}">`
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
        `<script type="application/json" id="${HYDRATION_ELEMENT_ID.seed}">${serialiseSeed(seed)}</script>` +
        `${clientScript}${devReload}</body></html>`
    )
}

// What a retained render writes to. `disconnected` is the ONE answer to "did the reader leave?" — the
// two transports used to ask it two different ways (a `cancel()` handler setting a flag vs. probing
// `controller.desiredSize`), and the soft-nav half had no `cancel()` handler at all, so a client that
// aborted before the first patch was invisible to it until an enqueue happened to fail.
interface RetainedRenderWriter {
    readonly disconnected: boolean
    write(chunk: string): void
}

// THE RETAIN/RELEASE DISCIPLINE FOR A REPLY THAT OUTLIVES ITS REQUEST, stated once.
//
// A streamed reply is still producing bytes after `runInScope` returns, so the request scope is held
// open past it (ADR 0026) and must be released exactly once, whatever the writer does. Both transports
// need that, and both used to spell it out: `streamPageDocument` in a `finally` — with a comment
// recording that the teardown escaping a throw had already stranded a scope once — and `streamSoftNav`
// as two bare statements after an unguarded `collectSeed`, which throws by design
// (`renderStateOrThrow`). A stranded scope keeps its effect subscriptions on module-level `state` and
// is reported only by `watchForLeakedRetain`'s 60s timer, in dev, so nothing observable through the
// response would have caught it.
//
// The writer is the argument: the two differ only in what a chunk IS (document bytes vs. a JSONL
// frame) and in whether a drain error still emits a trailer. Everything around that — retain,
// disconnect detection, close, teardown — is this module's.
function streamRetainedRender(
    ctx: ReactiveScope,
    label: string,
    body: (out: RetainedRenderWriter) => Promise<void>,
): ReadableStream<Uint8Array> {
    retainScope(ctx)
    const encoder = new TextEncoder()
    let gone = false
    // A reader can leave mid-reply — navigate on, close the tab, abort the fetch — and a streamed page
    // is open for as long as its slowest read. That is a disconnect, not a render failure, so it is
    // traced rather than logged as an error: every abandoned load of a streamed page would otherwise
    // cry wolf.
    const markGone = (): void => {
        if (gone) return
        gone = true
        log.channel('abide:stream').trace(`reader left mid-stream (${label})`)
    }
    return new ReadableStream<Uint8Array>({
        async start(controller) {
            const out: RetainedRenderWriter = {
                get disconnected(): boolean {
                    if (!gone && controller.desiredSize === null) markGone()
                    return gone
                },
                write(chunk: string): void {
                    if (out.disconnected) return
                    try {
                        controller.enqueue(encoder.encode(chunk))
                    } catch {
                        // Bun cancelled the stream between the probe and the enqueue.
                        markGone()
                    }
                },
            }
            try {
                await body(out)
                if (!out.disconnected) controller.close()
            } catch (caught) {
                if (out.disconnected) return
                log.channel('abide:stream').error(`${label} failed:`, caught)
            } finally {
                // The request's work ends HERE for a streamed reply, not at `runInScope`.
                enterScope(ctx, closeRenderState)
                releaseScope(ctx)
            }
        },
        cancel() {
            markGone()
        },
    })
}

// The streaming SSR transport (PR2). Serves `head → shell → out-of-order patches → tail` over a
// `ReadableStream`. The shell (first-load render of the SHELL string, with `<abide-slot>` placeholders
// for any read that blocked past the deadline) flushes immediately; each deferred subtree streams as a
// `<template>` + move-script patch when it resolves; the seed is collected AFTER the patches drain
// (so streamed reads are included — PR2 keeps one tail seed; PR3 splits it per-patch) and the tail
// flushes last. The drain + `collectSeed` run inside the captured request scope so they read the
// same request cache. The render-error → 500 guarantee holds: `renderPage` (which awaits blocking
// reads) has already returned before this stream is constructed.
export function streamPageDocument(
    shell: string,
    ctx: ReactiveScope,
    config: AppConfig,
    opts?: RenderDocumentOptions,
): ReadableStream<Uint8Array> {
    const stream = enterScope(ctx, () => renderState()?.stream)
    const head = documentHead(opts)
    return streamRetainedRender(ctx, 'streaming SSR drain', async (out) => {
        out.write(head)
        out.write(shell)
        if (stream !== undefined && (stream.deferred.length > 0 || stream.streamers.length > 0)) {
            // The move-scripts, once per document rather than once per patch — written only on a page
            // that actually defers something.
            out.write(documentPatchPreamble())
            await enterScope(ctx, async () => {
                for await (const patch of drainPatches(stream)) {
                    if (out.disconnected) break // client gone — stop draining
                    out.write(documentPatch(patch))
                }
            })
        }
        // A drain error skips the tail: a document missing its seed is worse than a truncated one.
        const seed = enterScope(ctx, () => collectSeed(config))
        out.write(documentTail(seed, opts))
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
// `collectSeed` in the captured request scope so they read the same request cache.
export function streamSoftNav(
    shell: string,
    ctx: ReactiveScope,
    config: AppConfig,
    urlPath: string,
    sharedLevels = 0,
): ReadableStream<Uint8Array> {
    const stream = enterScope(ctx, () => renderState()?.stream)
    // The client can navigate away / abort mid-stream (e.g. a soft-nav's background middleware confirm
    // never reads the body — it only wants the redirect envelope). That's EXPECTED, not a server fault,
    // and `out.disconnected` absorbs it.
    return streamRetainedRender(ctx, 'streaming soft-nav drain', async (out) => {
        const frame = (obj: unknown): void => out.write(`${JSON.stringify(obj)}\n`)
        // `sharedLevels` > 0: the shell is only the diverging suffix; the client keeps that many outer
        // layout instances alive and grafts this into the innermost kept layout's outlet (C6.2).
        frame({ kind: 'shell', html: shell, url: urlPath, sharedLevels })
        try {
            if (
                stream !== undefined &&
                (stream.deferred.length > 0 || stream.streamers.length > 0)
            ) {
                await enterScope(ctx, async () => {
                    for await (const patch of drainPatches(stream)) {
                        if (out.disconnected) break // client gone — stop draining
                        frame({ kind: patch.op, id: patch.id, html: patch.html }) // "fill" | "append"
                    }
                })
            }
        } catch (caught) {
            // A drain error still emits the seed — unlike first load, the client has already swapped the
            // shell in and needs the seed to hydrate what DID render.
            log.channel('abide:stream').error('streaming soft-nav drain failed:', caught)
        }
        if (!out.disconnected)
            frame({ kind: 'seed', seed: enterScope(ctx, () => collectSeed(config)) })
    })
}
