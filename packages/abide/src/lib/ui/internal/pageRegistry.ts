// CLIENT PAGE REGISTRY (M5b / C6-nav) — the in-bundle map of every page the app can mount client-side.
//
// The client bundle (clientBundle.ts) ships every page's AOT-emitted client `mount`, keyed by its
// route PATTERN (`/users/[id]`), plus the app's RPC specs. On load the entry registers them here;
// `navigate()` then matches a target pathname against these patterns (matchRoute) to pick and mount
// the destination page without a full document load. Keying by pattern (not concrete path) is what
// lets a `[name]` param route resolve on both first mount and every subsequent soft-nav.

// The emitted client mount for a page: clones its template, wires reactive bindings against the
// injected `$scope` (RPC proxies + framework bindings, built by bootstrapPage), returns a disposer.
// `hydrate` has the same shape but CLAIMS the server DOM instead of cloning (Stage 2, PR7); it
// whole-page-falls-back to a fresh `mount` internally on an unrecoverable mismatch.
export type PageMount = (target: Element, scope: Record<string, unknown>) => () => void

export interface PageEntry {
    mount: PageMount
    hydrate: PageMount
}

export type RpcSpecs = Record<string, { method: string; read: boolean; shared?: boolean }>

let pages: Record<string, PageEntry> = {}
let specs: RpcSpecs = {}
let base: string | undefined

// Install the app's page map + RPC specs (+ optional mount base) for client-side navigation.
export function registerPages(
    pageMap: Record<string, PageEntry>,
    rpcSpecs: RpcSpecs,
    mountBase?: string,
): void {
    pages = pageMap
    specs = rpcSpecs
    base = mountBase
}

// The registered route patterns (page keys), in registration order — fed to matchRoute.
export function pagePatterns(): string[] {
    return Object.keys(pages)
}

// The page entry for a matched pattern, or undefined when unregistered.
export function pageEntry(pattern: string): PageEntry | undefined {
    return pages[pattern]
}

export function pageSpecs(): RpcSpecs {
    return specs
}

export function pageBase(): string | undefined {
    return base
}
