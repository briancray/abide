// CLIENT SOFT-NAV (M5b / abide-compiler C6-nav) — SPA navigation without a full document load.
//
// `navigate(path)` pushes a history entry, then fetches `path` with the `Abide-Nav: <currentPath>`
// header. The server STREAMS the destination page as a JSONL frame stream (streaming-ssr-plan.md PR4):
// `{kind:"shell", html, url}` first, then `{kind:"patch", id, html}` per streamed subtree as it
// resolves, then `{kind:"seed", seed}` last. `softLoad` reads the frames progressively — swaps the
// shell into `#__abide-app` immediately (a slow read shows its `<abide-slot>` fallback), fills each
// placeholder slot as its patch frame arrives (in JS — a fetched body's inline scripts don't run), then
// once the stream ends HYDRATES the fully-assembled DOM (claim in place — the SAME path as first load,
// PR3 unwraps the slots). The seed primes the reads so the claim suppresses re-fetch + the initial
// write. Before hydrating it updates the reactive client route so `route()`-dependent bindings re-run.
// A middleware short-circuit still arrives as a JSON `{redirect}` envelope (handled first). Link clicks
// and back/forward drive the same path (see bootstrap.ts).
//
// CODE-SPLITTING (TODO #6): `mountPathname` is now async — it `loadPageEntry`s the destination's
// content-hashed chunk (deferring the chunk BODY, not the pattern match) before claiming. `softLoad`
// primes that chunk up front so its import overlaps the fetch/stream. Deferred: scroll restoration
// (top-scroll unless `keepScroll`).

import { matchRoute } from '../server/internal/matchRoute.ts'
import type { HydrationSeed } from '../server/internal/pages.ts'
import type { RouteInfo } from '../server/internal/scope.ts'
import { setClientRoute } from '../shared/internal/routeHolder.ts'
import { bootstrapPage, buildPageScope } from './internal/bootstrap.ts'
import type { ChainHandle, Level, LevelRecord } from './internal/compose.ts'
import {
    loadPageEntry,
    pageBase,
    pagePatterns,
    pageSocketSpecs,
    pageSpecs,
} from './internal/pageRegistry.ts'

const CONTAINER_ID = '__abide-app'

export interface NavigateOptions {
    // Replace the current history entry instead of pushing a new one.
    replace?: boolean
    // Keep the current scroll position instead of scrolling to the top on navigation.
    keepScroll?: boolean
}

// The currently mounted page's chain handle (a callable disposer that also carries per-level `records`,
// for the same-chain graft). mountPathname disposes it before mounting the next page.
let activeChain: ChainHandle | null = null
// The route pattern + applicable layout prefixes of the currently mounted page (set by mountPathname). A
// nav to the SAME pattern is a param/query-only nav (whole chain stays alive, C6.3); a nav sharing a
// leading layout prefix keeps those layouts alive and grafts only the diverging suffix (C6.2).
let currentPattern: string | null = null
let currentPrefixes: string[] | null = null
// Monotonic nav token — newest-wins. A background param-nav confirmation / a streamed cross-route graft
// checks it before acting on a stale response (a redirect or claim from a superseded nav must not fire).
let navGen = 0

// The number of leading layout levels the current route and a destination SHARE (longest common prefix
// of their applicable-layout-prefix lists) — the client mirror of the server's `sharedLayoutDepth`.
function sharedDepth(from: string[], to: string[]): number {
    let depth = 0
    while (depth < from.length && depth < to.length && from[depth] === to[depth]) depth++
    return depth
}

// Build the reactive RouteInfo for a matched destination — shared by the full mount and param-nav paths.
function routeInfoFor(pattern: string, url: URL, params: Record<string, string>): RouteInfo {
    return { kind: 'nav', name: pattern, params, url, navigating: false }
}

// Match a pathname against the registered page patterns, LOAD the destination page's code-split chunk,
// set the reactive client route, dispose the previous mount, and mount the destination page. Async
// (TODO #6): the chunk import is awaited BEFORE the dispose so the swap stays atomic — the page is
// never torn-down/blank while a chunk downloads. A resident chunk resolves in a microtask (no network),
// so first load + same-route param nav are effectively synchronous. Returns false when no page matches
// OR the chunk fails to load (caller falls back to a full load). Used for the initial client mount (no
// `seed` → the inline seed script) AND every soft-nav (`seed` = the envelope's hydration payload).
export async function mountPathname(pathname: string, seed?: HydrationSeed): Promise<boolean> {
    // `pathname` may carry a query string (a navigate(url(…, query)) target); match on the pathname
    // alone but keep the full URL so route().url.search reflects the query.
    const targetUrl = new URL(pathname, location.origin)
    const match = matchRoute(pagePatterns(), targetUrl.pathname)
    if (match === null) return false
    const entry = await loadPageEntry(match.pattern)
    if (entry === undefined) return false

    const info = routeInfoFor(match.pattern, targetUrl, match.params)

    // Dispose the previous page mount BEFORE updating the reactive route. On a same-route sibling-param
    // nav (`[slug]` alpha → beta) the destination reuses the same page module, so the outgoing mount's
    // effects are still live and STILL subscribed to `route().params`. Publishing the new params first
    // would re-run those doomed effects against the new slug — e.g. a `{#await topic({ slug })}` block
    // would mount a SECOND resolved branch into the just-swapped DOM before it is torn down (duplicate
    // `topic`). Disposing first unsubscribes them so only the freshly-hydrated page reads the new route.
    // The chunk is already resolved above, so this dispose→hydrate window is synchronous (no blank gap).
    if (activeChain !== null) {
        activeChain()
        activeChain = null
    }
    setClientRoute(info)

    // One hydrate path for first load and soft-nav (decision 6): claim the SSR (initial) or the
    // innerHTML-swapped (soft-nav) server DOM in place rather than fresh-mounting over it.
    activeChain = bootstrapPage(
        entry.hydrate,
        pageSpecs(),
        pageBase(),
        seed,
        pageSocketSpecs(),
    ) as unknown as ChainHandle
    currentPattern = match.pattern
    currentPrefixes = entry.prefixes ?? null
    return true
}

// Dispose the currently mounted page (unmount its effects). Used by app teardown.
export function disposeActive(): void {
    if (activeChain !== null) {
        activeChain()
        activeChain = null
    }
}

// Read a JSONL byte stream as parsed frame objects, yielding each as its `\n`-terminated line
// completes — so the caller applies the shell, then each patch, progressively as they arrive.
async function* readFrames(
    body: ReadableStream<Uint8Array>,
): AsyncGenerator<Record<string, unknown>> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
        const { done, value } = await reader.read()
        if (value !== undefined) buffer += decoder.decode(value, { stream: true })
        let newline = buffer.indexOf('\n')
        while (newline !== -1) {
            const line = buffer.slice(0, newline)
            buffer = buffer.slice(newline + 1)
            if (line.length > 0) yield JSON.parse(line) as Record<string, unknown>
            newline = buffer.indexOf('\n')
        }
        if (done) break
    }
    const rest = buffer.trim()
    if (rest.length > 0) yield JSON.parse(rest) as Record<string, unknown>
}

// Fill a streamed placeholder slot with its patch HTML — the same DOM op the first-load move-script
// does, but from JS (a `fetch`ed body's inline scripts don't auto-run). Hydration later unwraps it.
function fillSlot(id: number, html: string): void {
    const slot = document.getElementById(`ab-p:${id}`)
    if (slot === null) return
    const template = document.createElement('template')
    template.innerHTML = html
    slot.replaceChildren(template.content)
}

// A same-chain CROSS-ROUTE soft-nav: stream the server's diverging-suffix shell, graft it into the kept
// layout's outlet, fill streamed patches, then CLAIM it — keeping the shared `keep` outer layouts alive.
// Owns its outcome: it completes the graft/claim, follows a middleware redirect, or hard-loads on any
// mismatch (the server disagreeing on the keep depth, a network/parse failure) so nav never dead-ends.
async function partialCrossNav(
    path: string,
    from: string,
    target: URL,
    gen: number,
    keep: number,
    levels: Level[],
    prefixes: string[],
    boundary: LevelRecord,
    dest: { pattern: string; params: Record<string, string> },
): Promise<void> {
    let response: Response
    try {
        response = await fetch(path, { headers: { 'Abide-Nav': from } })
    } catch {
        location.href = path
        return
    }
    if (gen !== navGen) return // superseded before we touch the DOM
    const contentType = response.headers.get('content-type') ?? ''
    const isStream = contentType.includes('application/jsonl')
    // A middleware short-circuit arrives as a JSON `{redirect}` envelope (not the frame stream).
    if (!isStream && contentType.includes('application/json')) {
        const envelope = (await response.json().catch(() => null)) as { redirect?: string } | null
        if (envelope?.redirect !== undefined && envelope.redirect.length > 0) {
            await navigate(envelope.redirect, { replace: true })
            return
        }
        location.href = path
        return
    }
    if (!isStream || response.body === null) {
        location.href = path
        return
    }

    let seed: HydrationSeed | undefined
    let firstNode: Node | null = null
    let grafted = false
    try {
        for await (const frame of readFrames(response.body)) {
            if (frame.kind === 'shell') {
                // The server computed the same shared prefix from `Abide-Nav`; if it disagrees, the shell is
                // not the suffix we're set up to graft → hard load to stay correct.
                if (frame.sharedLevels !== keep) {
                    location.href = path
                    return
                }
                // Dispose the outgoing suffix + graft the shell, THEN publish the new route — so the kept
                // layouts' `route()` bindings update while the just-disposed old suffix can't misfire.
                firstNode =
                    boundary.graftSuffix?.(typeof frame.html === 'string' ? frame.html : '') ?? null
                setClientRoute(routeInfoFor(dest.pattern, target, dest.params))
                grafted = true
            } else if (frame.kind === 'patch') {
                if (typeof frame.id === 'number' && typeof frame.html === 'string')
                    fillSlot(frame.id, frame.html)
            } else if (frame.kind === 'seed') {
                seed = frame.seed as HydrationSeed
            }
        }
    } catch {
        location.href = path
        return
    }
    if (!grafted) {
        location.href = path // no shell frame — not the body we expected
        return
    }

    // Claim the assembled suffix DOM with its own (partial) seed: `state` ordinals from 0, reads seeded.
    const scope = buildPageScope(seed ?? {}, pageSpecs(), pageBase(), pageSocketSpecs())
    try {
        boundary.claimSuffix?.(levels, scope, firstNode)
    } catch {
        location.href = path
        return
    }
    // Commit the new chain identity: the kept prefix + the freshly-claimed suffix are now the live chain.
    currentPattern = dest.pattern
    currentPrefixes = prefixes
}

// Fetch the destination page, apply its streamed frames into the container, and HYDRATE (claim the
// assembled DOM). Shared by navigate() (after a history push) and popstate (no history mutation). A
// non-stream response (a middleware `{redirect}` JSON envelope, a full HTML document, an error), a
// network failure, or an unmatched route falls back so navigation never dead-ends.
async function softLoad(path: string, from: string, opts?: NavigateOptions): Promise<void> {
    const target = new URL(path, location.origin)
    const gen = ++navGen

    // PARAM/QUERY NAV (C6.2/C6.3) — the destination is the SAME page pattern as the live mount, so the
    // whole chain (layouts AND the page) stays alive. Just publish the new route: route()-driven bindings
    // re-render and any `{#await read(route().params)}` re-awaits IN PLACE — no dispose, no DOM swap, no
    // re-hydrate (so a carousel scroll / focus / element state is preserved). The server still runs in the
    // background for middleware (follow a redirect if it short-circuits); the kept page's reads re-fire
    // reactively (slice: reads-only seed replay to avoid the re-fetch).
    const destMatch = matchRoute(pagePatterns(), target.pathname)
    if (destMatch !== null && activeChain !== null && destMatch.pattern === currentPattern) {
        setClientRoute(routeInfoFor(destMatch.pattern, target, destMatch.params))
        try {
            const confirm = await fetch(path, { headers: { 'Abide-Nav': from } })
            if (gen !== navGen) return // superseded by a newer nav
            const type = confirm.headers.get('content-type') ?? ''
            if (!type.includes('application/jsonl') && type.includes('application/json')) {
                const envelope = (await confirm.json().catch(() => null)) as {
                    redirect?: string
                } | null
                if (envelope?.redirect !== undefined && envelope.redirect.length > 0) {
                    await navigate(envelope.redirect, { replace: true })
                }
            }
        } catch {
            // Offline / network failure: the optimistic route update stands (the page is already live).
        }
        return
    }

    // CROSS-ROUTE SAME-PREFIX NAV (C6.2) — the destination shares one or more OUTER layouts with the live
    // page. Keep those layout instances alive (DOM, state, effects) and graft + claim ONLY the diverging
    // suffix into the innermost kept layout's outlet, instead of rebuilding the whole tree. Needs the
    // destination's chunk (for its `levels`/`prefixes`), which the full path below would load anyway.
    if (destMatch !== null && activeChain !== null && currentPrefixes !== null) {
        const entry = await loadPageEntry(destMatch.pattern)
        if (gen !== navGen) return
        const levels = entry?.levels
        const prefixes = entry?.prefixes
        if (levels !== undefined && prefixes !== undefined) {
            const keep = sharedDepth(currentPrefixes, prefixes)
            const boundary = activeChain.records[keep]
            if (
                keep >= 1 &&
                boundary?.graftSuffix !== undefined &&
                boundary.claimSuffix !== undefined
            ) {
                await partialCrossNav(path, from, target, gen, keep, levels, prefixes, boundary, {
                    pattern: destMatch.pattern,
                    params: destMatch.params,
                })
                if (opts?.keepScroll !== true && typeof scrollTo === 'function') scrollTo(0, 0)
                return
            }
        }
    }

    // Prime the destination's code-split chunk NOW (fire-and-forget), so the import overlaps the fetch +
    // frame stream below instead of serializing after it. `loadPageEntry` dedupes with the `await` in
    // mountPathname (one import), and swallows its own errors, so this never rejects.
    const early = matchRoute(pagePatterns(), target.pathname)
    if (early !== null) void loadPageEntry(early.pattern)

    let response: Response
    try {
        response = await fetch(path, { headers: { 'Abide-Nav': from } })
    } catch {
        location.href = path
        return
    }

    const contentType = response.headers.get('content-type') ?? ''
    const container = document.getElementById(CONTAINER_ID)

    // Check `jsonl` BEFORE `json` — "application/jsonl" contains "application/json" as a substring, so a
    // naive `.includes("application/json")` would misclassify the frame stream as a redirect envelope.
    const isStream = contentType.includes('application/jsonl')

    // A middleware short-circuit arrives as a JSON `{redirect}` envelope (not the frame stream).
    if (!isStream && contentType.includes('application/json')) {
        let envelope: { redirect?: string }
        try {
            envelope = (await response.json()) as typeof envelope
        } catch {
            location.href = path
            return
        }
        if (typeof envelope.redirect === 'string' && envelope.redirect.length > 0) {
            await navigate(envelope.redirect, { replace: true })
            return
        }
        location.href = path
        return
    }

    // Not the streamed soft-nav body (a full HTML document / error page) → real load.
    if (!isStream || response.body === null || container === null) {
        location.href = path
        return
    }

    // Dispose the previous page mount BEFORE swapping so its still-live effects don't react to the shell
    // swap / streamed patch fills (the dispose-first invariant — see mountPathname's note). `mountPathname`
    // below then re-disposes harmlessly (already null) and sets the route + hydrates.
    disposeActive()

    let seed: HydrationSeed | undefined
    let navUrl = target.pathname + target.search
    try {
        for await (const frame of readFrames(response.body)) {
            if (frame.kind === 'shell') {
                if (typeof frame.html === 'string') container.innerHTML = frame.html
                if (typeof frame.url === 'string') navUrl = frame.url
            } else if (frame.kind === 'patch') {
                if (typeof frame.id === 'number' && typeof frame.html === 'string')
                    fillSlot(frame.id, frame.html)
            } else if (frame.kind === 'seed') {
                seed = frame.seed as HydrationSeed
            }
        }
    } catch {
        location.href = path
        return
    }

    // Hydrate the fully-assembled DOM: replay this stream's recorded reads then claim in place (PR3
    // unwraps any streamed `<abide-slot>`). Awaits the destination chunk (primed above, usually already
    // resolved); a chunk-load failure returns false → fall back to a full load rather than dead-end.
    if (!(await mountPathname(navUrl, seed))) {
        location.href = path
        return
    }

    if (opts?.keepScroll !== true && typeof scrollTo === 'function') {
        scrollTo(0, 0)
    }
}

// Client-side SPA navigation to an already-resolved `target`. Pass a plain path (`navigate('/foo')`)
// or compose a params/query-filled href with url() (`navigate(url('/users/[id]', { id }, { tab }))`)
// — navigate itself does no segment/query resolution. A URL object contributes its path+search+hash.
// Pushes (or replaces) a history entry, then soft-loads the destination. A no-op outside the browser
// so importing it under SSR is safe.
export async function navigate(target: string | URL, options?: NavigateOptions): Promise<void> {
    if (typeof document === 'undefined') return
    const path = typeof target === 'string' ? target : target.pathname + target.search + target.hash
    const from = location.pathname
    if (options?.replace === true) history.replaceState(null, '', path)
    else history.pushState(null, '', path)
    await softLoad(path, from, options)
}

// Whether a pathname matches a known in-app page pattern. Used to decide if a link/history entry is
// abide's to soft-navigate, or a plain browser navigation (e.g. /openapi.json, /__abide/rpc/*, static files).
export function isKnownPage(pathname: string): boolean {
    return matchRoute(pagePatterns(), pathname) !== null
}

// Back/forward: re-load the page at the current location WITHOUT touching history (the browser already
// moved the entry). Registered by bootstrap. keepScroll — the browser restores scroll for popstate.
// If the current entry isn't an in-app page (e.g. the user is arriving back from a non-page URL), let
// the browser own it rather than soft-loading a non-envelope response.
export function handlePopState(): void {
    if (!isKnownPage(location.pathname)) return
    void softLoad(location.pathname + location.search, location.pathname, { keepScroll: true })
}
