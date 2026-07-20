// CLIENT PAGE REGISTRY (M5b / C6-nav) — the map of every page the app can mount client-side.
//
// CODE-SPLITTING (TODO #6): the client bundle no longer ships every page's mount eagerly. The loader
// entry (clientBundle.ts) registers a per-pattern LAZY loader `() => import("<chunk>")`; the page's
// composed `mount`+`hydrate` live in a code-split chunk fetched on demand. `matchRoute` stays
// synchronous + eager off `pagePatterns()` (the pattern KEYS ride in the loader entry), so link
// interception + first-mount matching never block; only the module BODY is deferred. `loadPageEntry`
// imports (and memoizes) a pattern's chunk, deduping concurrent loads so a soft-nav that primes the
// chunk early doesn't double-fetch it.

// The emitted client mount for a page: clones its template, wires reactive bindings against the
// injected `$scope` (RPC proxies + framework bindings, built by bootstrapPage), returns a disposer.
// `hydrate` has the same shape but CLAIMS the server DOM instead of cloning (Stage 2, PR7); it
// whole-page-falls-back to a fresh `mount` internally on an unrecoverable mismatch.
export type PageMount = (target: Element, scope: Record<string, unknown>) => () => void

export interface PageEntry {
    mount: PageMount
    hydrate: PageMount
}

// A per-pattern chunk loader: imports the code-split chunk whose default export is the page's composed
// (page wrapped in its layouts) `PageEntry`. Bun rewrites each `() => import("<chain>")` specifier to
// the chunk's content-hashed `/__abide/chunk/<name>-<hash>.js` URL at build time.
export type PageLoader = () => Promise<{ default: PageEntry }>

export type RpcSpecs = Record<string, { method: string; read: boolean; shared?: boolean }>

let loaders: Record<string, PageLoader> = {}
// One promise per pattern: shared by concurrent loads (e.g. a soft-nav that primes the chunk before
// mountPathname awaits it) AND kept as the memo once resolved (a re-visit mounts without re-importing).
// A load that fails/resolves empty deletes its own entry so the next visit retries.
const loads = new Map<string, Promise<PageEntry | undefined>>()
let specs: RpcSpecs = {}
let base: string | undefined

// Install the app's per-pattern page LOADERS + RPC specs (+ optional mount base) for client navigation.
export function registerPages(
    pageLoaders: Record<string, PageLoader>,
    rpcSpecs: RpcSpecs,
    mountBase?: string,
): void {
    loaders = pageLoaders
    specs = rpcSpecs
    base = mountBase
    loads.clear()
}

// The registered route patterns (loader keys), in registration order — fed to matchRoute.
export function pagePatterns(): string[] {
    return Object.keys(loaders)
}

// Import (and memoize) a pattern's page chunk, returning its composed `PageEntry`. Resolves from the
// memo on a re-visit; shares an in-flight import across concurrent callers. Returns undefined for an
// unregistered pattern OR a failed chunk load (404/offline) so the caller can fall back to a full load.
export function loadPageEntry(pattern: string): Promise<PageEntry | undefined> {
    const cached = loads.get(pattern)
    if (cached !== undefined) return cached
    const loader = loaders[pattern]
    if (loader === undefined) return Promise.resolve(undefined)
    const promise = loader()
        .then((mod) => mod?.default)
        .catch(() => undefined)
        .then((entry) => {
            // Keep successes memoized; drop failures/empties so a later visit retries the import.
            if (entry === undefined) loads.delete(pattern)
            return entry
        })
    loads.set(pattern, promise)
    return promise
}

export function pageSpecs(): RpcSpecs {
    return specs
}

export function pageBase(): string | undefined {
    return base
}
