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
// and back/forward drive the same path (see bootstrap.ts). WHAT a nav response is — frame stream,
// redirect envelope, or unusable — is `internal/navResponse.ts`'s one answer for all three nav shapes;
// what to DO about an unusable one differs per shape and stays at the call site.
//
// TRACING (CO2.3): a nav fetch deliberately carries NO `traceparent`, which is the opposite of what an
// RPC call does. A navigation is a new logical operation, not a continuation of the page it left:
// propagating the live page's trace would grow ONE immortal trace for the tab's whole session, and the
// destination would report the trace id of the page BEFORE it. So every nav (full soft-nav, partial
// cross-nav, and the param/query confirm) lets the server mint a fresh trace, and the client ADOPTS it —
// from the `seed` frame where the nav hydrates, from the confirm's `traceresponse` header on a
// param/query nav. That nav drains its confirm for the seed too, but the header is readable as soon as
// the response arrives while the seed frame trails the whole render.
//
// A param/query nav is the one shape that keeps its mount, so it has no hydrate to seed through: it
// replays the confirm's seed into the client RPC memos instead (`replaySeedIntoProxies`). Without
// that, a read the nav did not MOVE — no args, no `route()` dependency, so nothing to re-fire on — kept
// serving its first-paint value while the server recomputed the page and the answer was thrown away.
//
// CODE-SPLITTING (TODO #6): `mountPathname` is now async — it `loadPageEntry`s the destination's
// content-hashed chunk (deferring the chunk BODY, not the pattern match) before claiming. `softLoad`
// primes that chunk up front so its import overlaps the fetch/stream. SCROLL: a forward nav resets to
// the top on the SHELL frame unless `keepScroll`; back/forward stays the browser's (`scrollRestoration`
// is left `'auto'`) and abide only corrects the clamp it can't see — see `settleScroll`/`stampScroll`.

import { commonPrefixLength } from '../shared/internal/commonPrefixLength.ts'
import { decodeJsonlStream } from '../shared/internal/decodeStreamResponse.ts'
import type { HydrationSeed } from '../shared/internal/hydrationSeed.ts'
import { identityAmbient } from '../shared/internal/identityAmbient.ts'
import { matchRoute } from '../shared/internal/matchRoute.ts'
import { NAV_HEADERS } from '../shared/internal/NAV_HEADERS.ts'
import { routeAmbient } from '../shared/internal/routeAmbient.ts'
import type { RouteInfo } from '../shared/internal/routeInfo.ts'
import { asSoftNavFrame, type SoftNavPatchFrame } from '../shared/internal/softNavFrame.ts'
import { traceAmbient } from '../shared/internal/traceAmbient.ts'
import { bootstrapPage, buildPageScope, replaySeedIntoProxies } from './internal/bootstrap.ts'
import type { ChainHandle, Level, LevelRecord } from './internal/compose.ts'
import { HYDRATED_ATTRIBUTE } from './internal/HYDRATED_ATTRIBUTE.ts'
import { HYDRATION_ELEMENT_ID } from './internal/HYDRATION_ELEMENT_ID.ts'
import { classifyNavResponse } from './internal/navResponse.ts'
import {
    loadPageEntry,
    pageBase,
    pagePatterns,
    pageSocketSpecs,
    pageSpecs,
} from './internal/pageRegistry.ts'
import { STREAM_SENTINEL } from './internal/STREAM_SENTINEL.ts'
import { abideAppendItem, abideFillSlot } from './internal/streamPatchDom.ts'

const CONTAINER_ID = HYDRATION_ELEMENT_ID.container

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
// The PATH the live mount is showing — what `Abide-Nav` must name on the next nav, so the server can
// compute `sharedLayoutDepth(from, to)` against the route being left. `navigate()` reads it off
// `location` instead, correctly: it runs BEFORE its own `pushState`. A traversal cannot — the browser
// has already moved `location` by the time `popstate` fires — so `handlePopState` reads this.
let currentPath: string | null = null
// Whether the live DOM has been CLAIMED — i.e. whether `activeChain` still describes what is on screen.
// A partial cross-nav grafts the destination's shell at the START of its frame stream and claims it at
// the END, and on a streaming destination that gap is the whole render. In between the DOM is the
// destination's while the chain is the outgoing route's, and `graftSuffix` is not re-entrant: it
// `dispose()`s a holder the claim has not yet repointed and inserts before the same anchor, so a second
// graft would double-dispose and leave BOTH suffixes in the document. So the two optimized nav shapes —
// which exist to KEEP a live mount — are unavailable while this is false, and a nav arriving in that
// window takes the full path, which rebuilds unconditionally and is therefore correct from any DOM state.
//
// Deliberately not "is a nav in flight": a nav superseded BEFORE its shell landed left the DOM alone, so
// classifying against `currentPattern` is still both correct and optimal there — that is the ordinary
// impatient-clicking case, and it keeps its optimizations.
let mountClaimed = true
// Monotonic nav token — newest-wins. A background param-nav confirmation / a streamed cross-route graft
// checks it before acting on a stale response (a redirect or claim from a superseded nav must not fire).
let navGen = 0

// Scroll to the top the moment the destination's SHELL lands — not after the frame stream drains. A
// streaming page (a `{#for await}` whose source runs for seconds) keeps the response body open long
// after its DOM is in place; scrolling at end-of-stream would leave the reader scrolled through the
// new page and then yank them to the top when the stream finally closes.
//
// `behavior: 'instant'` overrides an app's `html { scroll-behavior: smooth }` — a nav scroll reset is a
// document-load reset, not an in-page jump, and an ANIMATED one gets starved by the very render/hydrate
// work that follows, landing seconds later as the same surprise jump this scheduling fix removes.
//
// A `keepScroll` nav (back/forward) instead CORRECTS the browser's own restore — see `stampScroll`.
function settleScroll(opts?: NavigateOptions): void {
    if (typeof scrollTo !== 'function') return
    if (opts?.keepScroll === true) restoreStampedScroll()
    else scrollTo({ top: 0, left: 0, behavior: 'instant' })
}

// The scroll offset we stamp onto a history entry as we push away from it. Namespaced because it rides
// in the entry's `history.state`, which an app may one day carry its own keys in.
const SCROLL_STATE_KEY = '__abideScroll'

// Back/forward scroll is the BROWSER's job — `history.scrollRestoration` stays `'auto'`, so it keeps
// owning reload, bfcache, `#anchor` targets, and the ordinary traversal. We only CORRECT the one case it
// structurally cannot get right: it restores synchronously at traversal time, against the OUTGOING page's
// layout, while our destination content is still a fetch + frame stream away. When the remembered offset
// exceeds that outgoing page's max scroll the browser CLAMPS it (a tall page → a short page → Back lands
// short), and no later hook exists to revisit it once our content lands.
//
// So: stamp the leaving entry's offset into its own history state on the way out, and re-apply it on the
// way back once the shell lands (and again once the stream closes — a streaming page grows AFTER the
// shell, so a single pass clamps for the very same reason). Absent a stamp we do nothing and the
// browser's answer stands, so this is strictly additive.
//
// Limitation: only a PUSH stamps, so an entry left via a traversal (Back, then Forward to it) carries no
// stamp — that case keeps today's plain browser behavior. Capturing it would mean tracking scroll
// continuously and racing the restore's own scroll event, which is not worth the fragility.
function stampScroll(): void {
    if (typeof scrollY !== 'number') return
    const state = (history.state ?? {}) as Record<string, unknown>
    history.replaceState({ ...state, [SCROLL_STATE_KEY]: scrollY }, '')
}

// Re-apply the traversed-to entry's stamped offset when the browser landed somewhere else (it clamped, or
// our own content swap changed the page height under it). A no-op when there's no stamp or it already matches.
function restoreStampedScroll(): void {
    const stamped = (history.state as Record<string, unknown> | null)?.[SCROLL_STATE_KEY]
    if (typeof stamped !== 'number') return
    if (Math.round(scrollY) === Math.round(stamped)) return
    scrollTo({ top: stamped, behavior: 'instant' })
}

// The request headers for a nav fetch. `keep` is omitted where the client makes no claim about depth
// and the router's own `sharedLayoutDepth(from, to)` stands.
function navRequestHeaders(from: string, keep?: number): Record<string, string> {
    if (keep === undefined) return { [NAV_HEADERS.from]: from }
    return { [NAV_HEADERS.from]: from, [NAV_HEADERS.keep]: String(keep) }
}

// Build the reactive RouteInfo for a matched destination — shared by the full mount and param-nav paths.
function routeInfoFor(pattern: string, url: URL, params: Record<string, string>): RouteInfo {
    return { kind: 'nav', name: pattern, params, url, navigating: false }
}

// Match a pathname against the registered page patterns, LOAD the destination page's code-split chunk,
// set the reactive client route, dispose the previous mount, and mount the destination page. Async
// (TODO #6): the chunk import is awaited BEFORE the dispose so the swap stays atomic — the page is
// never torn-down/blank while a chunk downloads. A resident chunk resolves in a microtask (no network),
// so first load + same-route param nav are effectively synchronous. Returns false when no page matches,
// the chunk fails to load, OR `gen` names a superseded nav — the caller separates the last case from the
// others by re-checking `navGen`, since a superseded nav must stop rather than fall back to a hard load.
// Used for the initial client mount (no `seed` → the inline seed script) AND every soft-nav (`seed` =
// the envelope's hydration payload).
export async function mountPathname(
    pathname: string,
    seed?: HydrationSeed,
    gen?: number,
): Promise<boolean> {
    // `pathname` may carry a query string (a navigate(url(…, query)) target); match on the pathname
    // alone but keep the full URL so route().url.search reflects the query.
    const targetUrl = new URL(pathname, location.origin)
    const match = matchRoute(pagePatterns(), targetUrl.pathname)
    if (match === null) return false
    const entry = await loadPageEntry(match.pattern)
    if (entry === undefined) return false
    // A cold chunk is a network fetch, which is ample time for a newer nav to start. It owns the DOM now,
    // so hydrating over it here would claim nodes it is in the middle of replacing.
    if (gen !== undefined && gen !== navGen) return false

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
    routeAmbient.adopt(info)

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
    currentPath = targetUrl.pathname
    mountClaimed = true
    return true
}

// Dispose the currently mounted page (unmount its effects). Used by app teardown.
//
// This is where the hydration mark comes OFF — not in `bootstrapPage`'s disposer and not in the
// dispose-before-hydrate above. `mountPathname` disposes and re-hydrates in one synchronous window, so
// clearing the mark there would only flicker it; here the page really is going away with nothing
// replacing it, and a container still claiming to be hydrated would be a lie.
// `currentPath` is deliberately NOT cleared here. The full soft-nav path calls this before swapping the
// container, so clearing would blank the outgoing route for the whole drain that follows — and that is
// exactly when a traversal can arrive and need it for `Abide-Nav`. It stays truthful until the shell
// swap re-points it, and every mount overwrites it.
export function disposeActive(): void {
    if (activeChain !== null) {
        activeChain()
        activeChain = null
        document.getElementById(CONTAINER_ID)?.removeAttribute(HYDRATED_ATTRIBUTE)
    }
}

// Apply one streamed soft-nav patch frame in JS — the same DOM ops the first-load move-scripts run
// (`documentPatch` in streamScheduler.ts), but from JS since a `fetch`ed body's inline scripts don't
// auto-run. The server emits the op AS the frame `kind`: `fill` replaces a deferred `{#await}` slot's
// pending fallback (bracketed by `<!--ab-p:<id>-->` … `<template id="ab-p:<id>">`), `append` adds one
// streamed `{#for await}` item before the list's `<template id="ab-l:<id>">` sentinel. Hydration later
// drops the sentinels. There is no `complete` op: it stamped `data-ab-done` on the sentinel, which
// nothing read — `done()` lives in `shared/internal/iterableDone.ts` and has no DOM path. Returns true when the frame was a patch (so the consumer
// loops can treat every non-shell/non-seed frame uniformly). A missing anchor is a no-op. Exported for
// unit testing — the browser end-state is otherwise seed-masked (hydrate re-renders from the seed).
export function applyPatchFrame(frame: SoftNavPatchFrame): void {
    const isFill = frame.kind === 'fill'
    const template = document.createElement('template')
    template.innerHTML = frame.html
    const prefix = isFill ? STREAM_SENTINEL.pending : STREAM_SENTINEL.list
    ;(isFill ? abideFillSlot : abideAppendItem)(frame.id, template.content, prefix, document)
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
    opts?: NavigateOptions,
): Promise<void> {
    let response: Response
    try {
        response = await fetch(path, { headers: navRequestHeaders(from, keep) })
    } catch {
        location.href = path
        return
    }
    if (gen !== navGen) return // superseded before we touch the DOM
    const classified = await classifyNavResponse(response)
    if (classified.kind === 'redirect') {
        await navigate(classified.to, { replace: true })
        return
    }
    // Nothing graftable came back and this path was going to replace DOM: hard-load.
    if (classified.kind === 'unusable') {
        location.href = path
        return
    }

    let seed: HydrationSeed | undefined
    let firstNode: Node | null = null
    let grafted = false
    try {
        for await (const raw of decodeJsonlStream(classified.body)) {
            const frame = asSoftNavFrame(raw)
            if (frame === undefined) continue
            // Re-checked EVERY frame, not once after the fetch: a streamed destination holds this loop
            // open for the whole render, and a nav that started meanwhile owns the DOM. Applying a graft
            // or a patch on top of it would corrupt the newer page. Bailing after the graft leaves
            // `mountClaimed` false, which is exactly the state that routes the newer nav to the full path.
            if (gen !== navGen) return
            if (frame.kind === 'shell') {
                // No `sharedLevels !== keep` bail any more: `keep` is what we ASKED for, so the shell is
                // the suffix we are set up to graft by construction. That check existed because the two
                // sides derived the number independently and could disagree — the disagreement is now
                // unrepresentable. A server too old to honour the header is the one case left, and it
                // shows up as a shell that does not claim, which `claimSuffix` already recovers from by
                // fresh-mounting the suffix from the client's own levels.
                // Dispose the outgoing suffix + graft the shell, THEN publish the new route — so the kept
                // layouts' `route()` bindings update while the just-disposed old suffix can't misfire.
                firstNode = boundary.graftSuffix?.(frame.html) ?? null
                routeAmbient.adopt(routeInfoFor(dest.pattern, target, dest.params))
                // The DOM and `route()` ARE the destination's from here, so the bookkeeping that describes
                // them has to be too — it used to be committed at end-of-stream, which on a streaming page
                // left `currentPattern` naming a route that had already left the screen. A nav starting in
                // that window classified against it: a Back to the route just departed matched the stale
                // pattern and was taken for a param nav, so it kept a mount showing the other page.
                currentPattern = dest.pattern
                currentPrefixes = prefixes
                currentPath = target.pathname
                mountClaimed = false
                grafted = true
                settleScroll(opts)
            } else if (frame.kind === 'seed') {
                seed = frame.seed
            } else {
                applyPatchFrame(frame)
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
    if (gen !== navGen) return // superseded while the render streamed — do not claim over the newer nav

    // Claim the assembled suffix DOM with its own (partial) seed: `state` ordinals from 0, reads seeded.
    const scope = buildPageScope(seed ?? {}, pageSpecs(), pageBase(), pageSocketSpecs())
    try {
        boundary.claimSuffix?.(levels, scope, firstNode)
    } catch {
        location.href = path
        return
    }
    // The kept prefix + the freshly-claimed suffix are now a live, claimed chain again.
    mountClaimed = true
    // Second pass: the grafted suffix streamed in AFTER the shell, so the page is only now at its final
    // height. A forward nav is already at the top and must not re-scroll (that was the bug).
    if (opts?.keepScroll === true) restoreStampedScroll()
}

// Fetch the destination page, apply its streamed frames into the container, and HYDRATE (claim the
// assembled DOM). Shared by navigate() (after a history push) and popstate (no history mutation). A
// non-stream response (a middleware `{redirect}` JSON envelope, a full HTML document, an error), a
// network failure, or an unmatched route falls back so navigation never dead-ends.
async function softLoad(
    path: string,
    from: string,
    opts?: NavigateOptions,
    sameEntry = false,
): Promise<void> {
    const target = new URL(path, location.origin)
    const gen = ++navGen

    // PARAM/QUERY NAV (C6.2/C6.3) — the destination is the SAME page pattern as the live mount, so the
    // whole chain (layouts AND the page) stays alive. Just publish the new route: route()-driven bindings
    // re-render and any `{#await read(route().params)}` re-awaits IN PLACE — no dispose, no DOM swap, no
    // re-hydrate (so a carousel scroll / focus / element state is preserved). The server still runs in the
    // background for middleware (follow a redirect if it short-circuits); the kept page's reads re-fire
    // reactively (slice: reads-only seed replay to avoid the re-fetch).
    //
    // `mountClaimed` gates this and the graft below: both KEEP a live mount, and a grafted-but-unclaimed
    // subtree has no live effects to keep — nothing would re-render, and re-grafting would corrupt.
    const destMatch = matchRoute(pagePatterns(), target.pathname)
    if (
        destMatch !== null &&
        activeChain !== null &&
        mountClaimed &&
        destMatch.pattern === currentPattern
    ) {
        routeAmbient.adopt(routeInfoFor(destMatch.pattern, target, destMatch.params))
        currentPath = target.pathname
        try {
            // A nav to the URL you are ALREADY on is a refresh gesture, and the layouts are part of
            // what is on screen. Left alone the server skips every layout level here (from == to, so
            // `sharedLayoutDepth` is this route's full depth) and renders the page alone — so only the
            // page's reads reach the seed, and a LAYOUT's route-independent read would keep painting its
            // first-paint value exactly as the page's did before the seed was replayed at all. `keep: 0`
            // renders the whole tree so the seed carries those too.
            //
            // Same-URL only. A param MOVE should leave the kept layouts alone — persisting is the whole
            // point of keeping them — and it would pay for a full render on every step of a carousel.
            // This nav keeps its WHOLE chain, layouts included, so it declares every layout level it
            // has — which is what the server would derive for a same-pattern nav anyway, now said
            // rather than inferred. With the prefixes unknown it declares NOTHING and lets the
            // derivation stand: `0` there would be a false claim (it keeps the chain either way) and
            // would buy a full render for nothing.
            const keptLevels = currentPrefixes === null ? undefined : currentPrefixes.length
            const confirm = await fetch(path, {
                headers: navRequestHeaders(from, sameEntry ? 0 : keptLevels),
            })
            if (gen !== navGen) return // superseded by a newer nav
            // CO2.3: a param/query nav keeps the live mount, so it never hydrates — the confirm
            // response's `traceresponse` header is the earliest carrier for the trace of the request
            // this navigation actually made (the seed below carries the same id, but only once the
            // whole render has streamed). Without it `trace()` would keep answering with the previous
            // page's id, which is worse than a stale route: it points at the wrong span.
            traceAmbient.adopt(confirm.headers.get('traceresponse'))
            const classified = await classifyNavResponse(confirm)
            if (classified.kind === 'redirect') {
                await navigate(classified.to, { replace: true })
                return
            }
            // The one path whose `unusable` is NOT a hard load: this nav keeps its live mount, which is
            // already showing the right DOM for the new params. The confirm was for the middleware
            // verdict and the fresh reads, so an unreadable one costs those and nothing else.
            if (classified.kind === 'unusable') return
            // The confirm is a FULL render of this route — the server ran every read on it. Drain the
            // frame stream for the trailing `seed` and replay its reads/streams into the live mount's
            // memos. This body used to be discarded on the premise that "the kept page's reads have
            // already re-fetched reactively" (abide-compiler.md C6-nav), which holds only for a read the
            // nav actually MOVED: a param-keyed read lands on a new cache key and loads cold. A read
            // taking no args and reading no `route()` has nothing to re-fire on, so on a nav to the URL
            // you are already on NOTHING re-fired — the server recomputed the page and the client kept
            // painting the value it loaded on first paint.
            //
            // Only the `seed` frame is applied. The shell and the `fill`/`append` patches address the
            // server's freshly-painted DOM, which this nav deliberately did not adopt — the live DOM has
            // no matching slot sentinels, and re-rendering is the reactive graph's job once the memos hold
            // the new values.
            let seed: HydrationSeed | undefined
            for await (const raw of decodeJsonlStream(classified.body)) {
                const frame = asSoftNavFrame(raw)
                if (frame?.kind === 'seed') seed = frame.seed
            }
            if (gen !== navGen || seed === undefined) return // superseded while the render streamed
            replaySeedIntoProxies(seed, pageBase() ?? '')
            // AU3: a nav is a fresh request whose middleware may have resolved someone else. A full nav
            // re-adopts through `buildPageScope`; this path never gets there, so it was the one nav shape
            // that left `identity()` answering for the request BEFORE it. An identical re-adopt wakes nobody.
            identityAmbient.adopt(seed.identity)
        } catch {
            // Offline / network failure: the optimistic route update stands (the page is already live).
        }
        return
    }

    // CROSS-ROUTE SAME-PREFIX NAV (C6.2) — the destination shares one or more OUTER layouts with the live
    // page. Keep those layout instances alive (DOM, state, effects) and graft + claim ONLY the diverging
    // suffix into the innermost kept layout's outlet, instead of rebuilding the whole tree. Needs the
    // destination's chunk (for its `levels`/`prefixes`), which the full path below would load anyway.
    if (destMatch !== null && activeChain !== null && mountClaimed && currentPrefixes !== null) {
        const entry = await loadPageEntry(destMatch.pattern)
        if (gen !== navGen) return
        const levels = entry?.levels
        const prefixes = entry?.prefixes
        if (levels !== undefined && prefixes !== undefined) {
            const keep = commonPrefixLength(currentPrefixes, prefixes)
            const boundary = activeChain.records[keep]
            if (
                keep >= 1 &&
                boundary?.graftSuffix !== undefined &&
                boundary.claimSuffix !== undefined
            ) {
                await partialCrossNav(
                    path,
                    from,
                    target,
                    gen,
                    keep,
                    levels,
                    prefixes,
                    boundary,
                    { pattern: destMatch.pattern, params: destMatch.params },
                    opts,
                )
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
        // `keep: 0` — this path replaces the WHOLE container, so it can keep nothing, and it says so
        // rather than hoping the server's own `sharedLayoutDepth(from, to)` happens to come out 0. It
        // often does not: the reasons we are here are all invisible to the server (no live chain, a
        // boundary record without a `graftSuffix`, a mount grafted but not yet claimed), while the
        // routes involved may share every layout. The server then rendered a diverging SUFFIX for a
        // graft nobody could perform, and this path had to hard-load rather than swap a partial tree in.
        response = await fetch(path, { headers: navRequestHeaders(from, 0) })
    } catch {
        location.href = path
        return
    }
    if (gen !== navGen) return // superseded before we touch the DOM

    const container = document.getElementById(CONTAINER_ID)
    const classified = await classifyNavResponse(response)
    if (classified.kind === 'redirect') {
        await navigate(classified.to, { replace: true })
        return
    }

    // `unusable` is a full HTML document / error page / bodyless response → real load. So is a document
    // with no container to swap into, which is this path's own condition rather than the response's.
    if (classified.kind === 'unusable' || container === null) {
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
        for await (const raw of decodeJsonlStream(classified.body)) {
            const frame = asSoftNavFrame(raw)
            if (frame === undefined) continue
            if (gen !== navGen) return // superseded mid-stream — the newer nav owns the container
            if (frame.kind === 'shell') {
                // The request asked for `keep: 0`, so a TRIMMED shell means the server did not honour it
                // — a deployment older than this bundle, during a rolling deploy. Swapping a diverging
                // suffix into the container would drop every layout above it, so hard-load instead: the
                // pre-header behaviour, kept exactly where it is still the only correct answer. This is
                // the one nav shape with no `sharedLevels` agreement to check, so it checks it hardest.
                if (frame.sharedLevels > 0) {
                    location.href = path
                    return
                }
                container.innerHTML = frame.html
                if (frame.url !== '') navUrl = frame.url
                // The container IS the destination's now — keep the outgoing-route header truthful for a
                // nav that starts before this one hydrates (`handlePopState` reads it).
                currentPath = target.pathname
                settleScroll(opts)
            } else if (frame.kind === 'seed') {
                seed = frame.seed as HydrationSeed
            } else {
                applyPatchFrame(frame)
            }
        }
    } catch {
        location.href = path
        return
    }

    // Hydrate the fully-assembled DOM: replay this stream's recorded reads then claim in place (PR3
    // unwraps any streamed `<abide-slot>`). Awaits the destination chunk (primed above, usually already
    // resolved); a chunk-load failure returns false → fall back to a full load rather than dead-end.
    if (gen !== navGen) return
    if (!(await mountPathname(navUrl, seed, gen))) {
        // `false` also covers "a newer nav started while the chunk downloaded", which must NOT hard-load
        // — that would drag the tab to THIS nav's destination on top of the one the reader actually asked
        // for. Only a genuine failure (no match, dead chunk) falls back.
        if (gen !== navGen) return
        location.href = path
        return
    }
    // Second pass: patches + hydration landed after the shell, so the page is only now at its final
    // height. A forward nav is already at the top and must not re-scroll (that was the bug).
    if (opts?.keepScroll === true) restoreStampedScroll()
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
    // A nav to the URL you are ALREADY on touches history not at all. Pushing there stacks a second entry
    // on the same URL, so Back becomes a round trip that lands where it started — and a clicked-again nav
    // link fills the stack with duplicates for what is a re-navigation, not a move. Nor is it a
    // `replaceState`: the URL already IS `path`, so the only thing a replace would accomplish is wiping
    // the entry's own state, including the scroll offset `stampScroll` may have left on it. The compare
    // includes the hash, since `/page#a` → `/page#b` really is a move the reader can go Back from.
    const resolved = new URL(path, location.href)
    const sameEntry =
        resolved.pathname + resolved.search + resolved.hash ===
        location.pathname + location.search + location.hash
    // Stamp where we are onto the entry we're leaving, BEFORE pushing — that's the offset a later Back
    // wants, and the only moment we can read it uncontested by the browser's own restore. A `replace`
    // discards the current entry, so there is nothing to come back to and nothing to stamp.
    if (options?.replace === true) history.replaceState(null, '', path)
    else if (!sameEntry) {
        stampScroll()
        history.pushState(null, '', path)
    }
    await softLoad(path, from, options, sameEntry)
}

// Whether a pathname matches a known in-app page pattern. Used to decide if a link/history entry is
// abide's to soft-navigate, or a plain browser navigation (e.g. /openapi.json, /__abide/rpc/*, static files).
export function isKnownPage(pathname: string): boolean {
    return matchRoute(pagePatterns(), pathname) !== null
}

// Back/forward: re-load the page at the current location WITHOUT touching history (the browser already
// moved the entry). Registered by bootstrap. `keepScroll` — never reset to the top on a traversal: the
// browser already restored the offset, and `settleScroll` only corrects it where the browser clamped.
// If the current entry isn't an in-app page (e.g. the user is arriving back from a non-page URL), let
// the browser own it rather than soft-loading a non-envelope response.
// `Abide-Nav` names the route being LEFT — it is what the server computes `sharedLayoutDepth(from, to)`
// from. On a traversal the browser has already moved `location` to the destination before `popstate`
// fires, so `location.pathname` is the wrong end of the nav: it named the destination, the server
// answered `sharedLevels` for a from==to nav (its FULL layout depth), and the client — which computes
// `keep` from the outgoing route it actually has mounted — disagreed. `partialCrossNav` treats that
// disagreement as "this is not the suffix I am set up to graft" and hard-loads to stay correct, so every
// cross-route Back/Forward was a full document load: the whole live chain thrown away, hydration re-run,
// and the kept-layout state the graft exists to preserve gone with it. `currentPath` is the route
// actually mounted; before the first mount there is none, and `location` is then still right.
export function handlePopState(): void {
    if (!isKnownPage(location.pathname)) return
    void softLoad(location.pathname + location.search, currentPath ?? location.pathname, {
        keepScroll: true,
    })
}
