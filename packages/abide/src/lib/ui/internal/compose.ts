// LAYOUT COMPOSITION — CLIENT (TODO #7). Ships to the browser.
//
// Wraps a page's emitted client module in its layout modules, outermost → innermost, into a single
// `{ mount, hydrate }` the page registry stores per route pattern. Composition reuses the ordinary
// component/`{children()}` runtime path: each layout's `{children()}` compiles to a `children`
// component slot (templatePlan), and this composer injects `children` into every layout's scope as
// an isomorphic client component that mounts the NEXT level. So `$rt.component` (paired block anchors
// + claimBlock hydration) drives the wrapping — no bespoke slot or cursor logic here.
//
// The base `$scope` (RPC proxies + `state`/`watch`/`props`/`route`/…, built by bootstrapPage) is
// SHARED across all layers — only augmented with each layer's `children`. Sharing the one seeded
// `state` recorder keeps ordinals aligned with the server, which records layers in the same
// outer→inner order (pages.ts renders each layout, then calls `children()` for the next level).

// A composable emitted level: the standard emitted client module surface (mount takes an optional
// anchor so a layer can be positioned as a component child; hydrate claims a whole container).
export interface Level {
    mount(target: Node, scope: Record<string, unknown>, anchor?: Node | null): () => void
    hydrate(container: Node, scope: Record<string, unknown>): () => void
}

// The child `children` component for the level at `index` (a layout wraps `levels[index]`). It is a
// client component `(props, childrenFn) => Mountable`; its Mountable mounts that level with the base
// scope + the NEXT level's `children` (absent for the innermost page). `$rt.component` calls it after
// seeking the cursor to the server region, then claim-mounts the returned Mountable.
function childComponent(levels: Level[], index: number, scope: Record<string, unknown>): unknown {
    return () => ({
        mount: (parent: Node, anchor: Node | null): (() => void) => {
            const childScope =
                index + 1 < levels.length
                    ? { ...scope, children: childComponent(levels, index + 1, scope) }
                    : scope
            const level = levels[index]
            if (level === undefined) throw new Error(`compose: no level at index ${index}`)
            return level.mount(parent, childScope, anchor)
        },
    })
}

// The scope the outermost level sees: the base scope plus its `children` (the next level), when there
// is more than one level. A lone level (no layouts) sees the base scope unchanged.
function rootScope(levels: Level[], scope: Record<string, unknown>): Record<string, unknown> {
    return levels.length > 1 ? { ...scope, children: childComponent(levels, 1, scope) } : scope
}

// Compose `[rootLayout, …, nearestLayout, page]` into one mountable/hydratable unit. A single-element
// array (a page with no layouts) passes straight through, so back-compat is exact.
export function compose(levels: Level[]): Level {
    const first = levels[0]
    if (first === undefined) throw new Error('compose: requires at least one level')
    return {
        mount(target: Node, scope: Record<string, unknown>, anchor?: Node | null): () => void {
            return first.mount(target, rootScope(levels, scope), anchor)
        },
        hydrate(container: Node, scope: Record<string, unknown>): () => void {
            return first.hydrate(container, rootScope(levels, scope))
        },
    }
}
