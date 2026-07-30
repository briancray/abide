// The NAV route class (C6/C6-nav) — page SSR, first load and soft nav.
//
// Two representations share one URL and differ only by request header: a first load is a full streamed
// HTML document, a soft nav is a JSONL frame stream carrying just the next page's inner HTML + seed.
// BOTH declare `Vary: Abide-Nav, Abide-Nav-Keep` for that reason — only the soft-nav half used to, which
// left a cache free to serve a page fragment to a first load (`Vary: Cookie`, the identity-scoped
// default, does not key them apart; nothing about the cookie differs between them).
//
// The MATCH is separate from the HANDLE (`matchNavRoute` / `handleNavRoute`) because the router has to
// know whether a page pattern claimed the path before it can decide this class applies at all — and the
// match is what fills `route().params`, so the handler reads the pattern off the scope rather than
// matching a second time.

import { matchRoute } from '../../shared/internal/matchRoute.ts'
import { NAV_HEADERS, NAV_VARY } from '../../shared/internal/NAV_HEADERS.ts'
import { reactiveScope } from '../../shared/internal/reactiveScope.ts'
import { log } from '../../shared/log.ts'
import type { AppConfig } from './appConfig.ts'
import { CHUNK_PREFIX } from './CHUNK_PREFIX.ts'
import { clientBuildFor } from './clientBundle.ts'
import { errorResponse } from './errorResponse.ts'
import { applicableLayoutPrefixes, sharedLayoutDepth } from './layouts.ts'
import { navKeepLevels } from './navKeepLevels.ts'
import { outcomeResponse } from './outcomeResponse.ts'
import { renderPage, streamPageDocument, streamSoftNav } from './pages.ts'
import { onRegistryRebind } from './registryDerivation.ts'
import type { RequestScope } from './requestScope.ts'

// One config's page-pattern list, derived once. `matchRoute` needs the full pattern array on every nav —
// twice on a soft nav, which also matches the `Abide-Nav` origin path — and an app's pages are fixed for
// its lifetime, so rebuilding it with `Object.keys` per request is pure allocation.
//
// Keyed on the config OBJECT, which is why the invalidation below is not optional: `abide dev` reloads by
// reassigning `config.pages` on the same object, so the key never changes and this list would otherwise
// answer with the boot's pages forever — a page added under dev never matched (404 until restart), a
// deleted one still matched and reached the "Unreachable" throw in `handleNavRoute`. It is registered as
// a DERIVED-FROM-THE-REGISTRY value rather than exposing a second invalidation hook for the dev loop to
// remember; `registryDerivation.ts` has the argument.
const PAGE_PATTERNS = new WeakMap<AppConfig, string[]>()

onRegistryRebind((config) => {
    PAGE_PATTERNS.delete(config)
})

function pagePatternsOf(config: AppConfig, pages: Record<string, string>): string[] {
    let patterns = PAGE_PATTERNS.get(config)
    if (patterns === undefined) {
        patterns = Object.keys(pages)
        PAGE_PATTERNS.set(config, patterns)
    }
    return patterns
}

// C6-nav: a soft-nav request is a GET/HEAD nav carrying the `Abide-Nav: <currentPath>` header — the
// client already has the document shell and wants only the next page's inner HTML + seed. Exported
// because the router's soft-nav redirect envelope asks the same question one layer up, on a response this
// class never produced (a middleware short-circuited before it ran).
export function isSoftNav(request: Request): boolean {
    if (request.headers.get(NAV_HEADERS.from) === null) return false
    const method = request.method.toUpperCase()
    return method === 'GET' || method === 'HEAD'
}

// C6-nav: how many outer layout levels the client says it is KEEPING (`NAV_HEADERS.keep`). Absent — an
// older browser bundle, or any non-browser caller — leaves the router's own `sharedLayoutDepth`
// derivation to stand. A malformed or negative value is treated as absent for the same reason: falling
// back renders MORE of the tree, which is always placeable, so there is no outcome worth a 400 in it.
function navKeepDeclared(request: Request): number | null {
    const raw = request.headers.get(NAV_HEADERS.keep)
    if (raw === null) return null
    // Before `Number`, because `Number('')` is `0` — an empty header would otherwise read as the most
    // consequential value the field has ("keep nothing"), which is the opposite of saying nothing.
    const text = raw.trim()
    if (text.length === 0) return null
    const value = Number(text)
    if (!Number.isInteger(value) || value < 0) return null
    return value
}

// Does a page pattern claim this path? Returns the MATCH — the pattern and its extracted params — or
// undefined.
//
// It used to answer `boolean` and write `scope.route.name`/`params` on the way past, which
// `handleNavRoute` then read back. Two things were wrong with that. The ordering ("call the matcher
// before the handler, on the same scope") was held by nothing but `resolveAppClass` happening to call
// them adjacently, and the caller could not tell a claimed path from a claimed-and-recorded one. Handing
// the match back makes the dependency an argument: the caller decides when the scope learns its route,
// which is what `resolveAppClass` now does explicitly.
export interface NavMatch {
    pattern: string
    params: Record<string, string>
}

export function matchNavRoute(scope: RequestScope, config: AppConfig): NavMatch | undefined {
    const pages = config.pages ?? {}
    const match = matchRoute(pagePatternsOf(config, pages), scope.route.url.pathname)
    if (match === null) return undefined
    return { pattern: match.pattern, params: match.params }
}

export async function handleNavRoute(scope: RequestScope, config: AppConfig): Promise<Response> {
    const url = scope.route.url
    const pattern = scope.route.name
    log.channel('abide:router').trace(
        `page ${pattern}${scope.route.navigating ? ' (soft-nav)' : ''}`,
    )
    const pages = config.pages ?? {}
    const source = pages[pattern]
    if (source === undefined) {
        // Unreachable: the pattern came from the pages key list, so it is always a live key.
        throw new Error(`Matched page pattern has no source: ${pattern}`)
    }
    // TODO #7: an uncaught render error (a page/layout that throws with no `{#try}` boundary around it)
    // returns a controlled 500 rather than leaking Bun's default handler. A layout that WANTS to contain
    // an inner-page error still opts in by wrapping `{children()}` in `{#try}{:catch}`.
    try {
        // C6-nav soft-nav: an `Abide-Nav` header requests the inner page (not the full document),
        // STREAMED as a JSONL frame stream (streaming-ssr-plan.md PR4) — shell → out-of-order patches →
        // seed — so a slow read shows the shell then streams in, same as first load. `renderPage(…, true)`
        // awaits blocking reads (a throw still 500s below) and returns the SHELL.
        if (isSoftNav(scope.request)) {
            // C6.2: how many outer layouts the client is KEEPING (`navKeepLevels`, which owns the
            // precedence and the clamp). Render only the diverging suffix; the client grafts + claims it
            // into the innermost kept layout's outlet.
            const layoutConfig = config.layouts ?? {}
            const fromPath = scope.request.headers.get(NAV_HEADERS.from)
            const fromMatch =
                fromPath !== null
                    ? matchRoute(pagePatternsOf(config, config.pages ?? {}), fromPath)
                    : null
            const sharedLevels = navKeepLevels(
                navKeepDeclared(scope.request),
                fromMatch !== null
                    ? sharedLayoutDepth(fromMatch.pattern, pattern, layoutConfig)
                    : 0,
                applicableLayoutPrefixes(pattern, layoutConfig).length,
            )
            const shell = await renderPage(source, config, pattern, true, sharedLevels)
            const body = streamSoftNav(
                shell,
                reactiveScope(),
                config,
                url.pathname + url.search,
                sharedLevels,
            )
            return new Response(body, {
                status: 200,
                headers: { 'content-type': 'application/jsonl', vary: NAV_VARY },
            })
        }

        // First load = full SSR document (C6.4), STREAMED (streaming-ssr-plan.md PR2): `renderPage(…,
        // true)` awaits blocking reads (a throw here still returns a controlled 500 below) and returns
        // the SHELL; `streamPageDocument` flushes head → shell → out-of-order patches → seed+tail.
        const shell = await renderPage(source, config, pattern, true)
        // Boot from the content-hashed loader entry; link the client stylesheet only when the app
        // actually bundled CSS (TODO #6/#20). Both URLs are immutable + content-addressed.
        const build = await clientBuildFor(config)
        const routeChunks = build.routeChunks.get(pattern)
        const body = streamPageDocument(shell, reactiveScope(), config, {
            devReloadScript: config.devReloadScript,
            clientHref: `${CHUNK_PREFIX}${build.entry}`,
            bootHrefs: build.bootChunks.map((name) => `${CHUNK_PREFIX}${name}`),
            cssHref: build.cssFile !== undefined ? `${CHUNK_PREFIX}${build.cssFile}` : undefined,
            preloadHrefs: routeChunks?.map((name) => `${CHUNK_PREFIX}${name}`),
        })
        return new Response(body, {
            status: 200,
            // Same URL as the soft-nav JSONL response above, differing only by the `Abide-Nav` request
            // header — so BOTH representations must declare it.
            headers: { 'content-type': 'text/html; charset=utf-8', vary: NAV_VARY },
        })
    } catch (caught) {
        // A DELIBERATE outcome is not a render failure. Since an rpc's middleware now runs per READ, a
        // gated read inside a page can legitimately raise `error(403)` or `redirect('/login')` mid-render —
        // and so can the page's own script. Rethrow it so the router renders it at its own status, on the
        // same rule the rest of the framework follows: a declared 404 or a login redirect is not a bug in
        // the app. This branch used to swallow BOTH into a 500, which turned a login redirect into a broken
        // page and was already wrong for a page that called `error(404)` itself.
        if (outcomeResponse(caught) !== undefined) throw caught
        log.channel('abide:router').error(`page render failed for "${pattern}":`, caught)
        return errorResponse(500, 'Page render failed.')
    }
}
