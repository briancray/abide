// LAYOUT CHAIN RESOLUTION (TODO #7) — which `layout.abide`s wrap a page, and in what order.
//
// A `layout.abide` at a directory applies to every page at/below that directory. The root layout
// (`src/ui/pages/layout.abide`, prefix "/") wraps everything; a nested layout (`pages/admin/
// layout.abide`, prefix "/admin") wraps `/admin` and anything under it. For a matched page the chain
// is ordered OUTERMOST (root) → INNERMOST (nearest), so both the SSR composer (pages.ts) and the
// client bundle composer wrap page = `[rootLayout, …, nearestLayout, page]` — each layout rendering
// the next level where its template calls `{children()}`.

import { routePrefixFromRelative } from './routePrefixFromRelative.ts'

// `pages/**/layout.abide` → the directory route prefix it wraps.
export function layoutRoutePrefix(relativePath: string): string {
    return routePrefixFromRelative(relativePath, 'layout.abide')
}

// Whether a layout at `prefix` applies to a page whose route `pattern` is at/below it. The root
// prefix "/" applies to every page; otherwise the pattern must be the prefix itself or lie under it
// on a segment boundary (so "/admin" wraps "/admin" and "/admin/users" but not "/administrators").
function appliesTo(prefix: string, pattern: string): boolean {
    if (prefix === '/') return true
    return pattern === prefix || pattern.startsWith(`${prefix}/`)
}

// The layout PREFIXES applicable to `pattern`, ordered outermost → innermost (shortest prefix first).
// Exposed so callers that need the layout's origin (e.g. the client bundle resolving a layout's
// relative CSS import against its source dir) can key `layoutDirs` by the same prefix.
export function applicableLayoutPrefixes(
    pattern: string,
    layouts: Record<string, string>,
): string[] {
    const prefixes = Object.keys(layouts).filter((prefix) => appliesTo(prefix, pattern))
    prefixes.sort((a, b) => a.length - b.length)
    return prefixes
}

// The layout sources applicable to `pattern`, ordered outermost → innermost (shortest prefix first).
export function layoutChain(pattern: string, layouts: Record<string, string>): string[] {
    return applicableLayoutPrefixes(pattern, layouts).map((prefix) => {
        const source = layouts[prefix]
        if (source === undefined) throw new Error(`missing layout source for prefix: ${prefix}`)
        return source
    })
}
