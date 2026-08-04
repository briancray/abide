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
//
// NAV PERSISTENCE (C6.2): mount/hydrate return a `ChainHandle` — a callable disposer (back-compat)
// that also exposes a per-level `records` array (each level's mount `parent`, its outlet `marker`, and
// a `dispose` that tears down THAT level plus everything nested below it). A same-chain soft-nav uses
// this to dispose only the diverging suffix (`records[k].dispose()`) and graft a fresh subtree into
// the kept layout's outlet, instead of rebuilding the whole tree. Populated synchronously during the
// first mount/hydrate (each layer mounts its child inline at `{children()}`), so the array is complete
// by the time compose's mount/hydrate returns.

import { endHydration, hydrateSeek, startHydration } from './runtime.ts'

// A composable emitted level: the standard emitted client module surface (mount takes an optional
// anchor so a layer can be positioned as a component child; hydrate claims a whole container).
export interface Level {
    mount(target: Node, scope: Record<string, unknown>, anchor?: Node | null): () => void
    hydrate(container: Node, scope: Record<string, unknown>): () => void
}

// One mounted level's handle: where it lives, how to tear it (and its nested children) down, and — for a
// non-root level — how to REMOUNT the diverging suffix in place. `marker` is the outlet anchor its
// content was mounted BEFORE — the kept parent layout's `{children()}` marker (null for the root, which
// mounts straight into the container). `parent` is the node its content lives under. A same-chain nav
// disposes the old suffix, grafts the destination's SSR HTML into `parent` before `marker`, and CLAIMS
// it — the kept prefix (its DOM, `state`, effects) is never touched.
export interface LevelRecord {
    index: number
    parent: Node
    marker: Node | null
    dispose: () => void
    // 2-phase suffix swap (streaming): `graftSuffix` disposes the outgoing suffix and inserts the
    // destination's SSR shell into the outlet, returning its first node; the caller then fills any streamed
    // `<abide-slot>` patches; `claimSuffix` finally CLAIMS the assembled DOM (wiring reactivity) and
    // repoints the kept parent's teardown at the new suffix. Present on every non-root record.
    graftSuffix?: (html: string) => Node | null
    claimSuffix?: (
        newLevels: Level[],
        newScope: Record<string, unknown>,
        firstNode: Node | null,
    ) => void
    // Convenience = graftSuffix + claimSuffix in one call (non-streaming / unit tests).
    remount?: (newLevels: Level[], newScope: Record<string, unknown>, html: string) => void
}

// What compose's mount/hydrate return: a callable that disposes the whole chain (back-compat with the
// bare-disposer callers), plus the per-level records a soft-nav needs to swap only the diverging suffix.
export interface ChainHandle {
    (): void
    records: LevelRecord[]
}

// WHAT A PAGE MOUNT HANDS BACK, as one type rather than as a cast at the far end.
//
// A `ChainHandle` is what `compose` builds; a HAND-BUILT `PageEntry` (a test, a fixture) may return a
// bare disposer, which is why `PageEntry.levels`/`prefixes` are already optional. So the honest return
// type is "a disposer that MAY carry the records" — and saying that here is what removes
// `navigate.ts`'s `as unknown as ChainHandle`, a double cast that was the only thing connecting
// `compose`'s output to its one consumer across two modules that had both erased it to `() => void`.
//
// The erasure was not harmless: `bootstrap.ts` declares in prose that the hydrated handle is "stamped
// AROUND … never by wrapping it", because a fresh closure returns a disposer that has lost `records` and
// the same-chain graft then silently stops swapping content on a soft-nav. A `() => void` return type
// permits exactly the wrapping that comment forbids; this one does not.
export type MountHandle = (() => void) & { records?: LevelRecord[] }

// compose's result: mount/hydrate return a ChainHandle (assignable to the bare `() => void` a Level
// expects, since ChainHandle is callable — so this stays usable everywhere a Level is).
export interface ComposedChain {
    mount(target: Node, scope: Record<string, unknown>, anchor?: Node | null): ChainHandle
    hydrate(container: Node, scope: Record<string, unknown>): ChainHandle
}

function makeHandle(dispose: () => void, records: LevelRecord[]): ChainHandle {
    const handle = (() => dispose()) as ChainHandle
    handle.records = records
    return handle
}

// The child `children` component for the level at `index` (a layout wraps `levels[index]`). It is a
// client component `(props, childrenFn) => Mountable`; its Mountable mounts that level with the base
// scope + the NEXT level's `children` (absent for the innermost page). `$rt.component` calls it after
// seeking the cursor to the server region, then claim-mounts the returned Mountable. As it mounts, it
// records that level's `{parent, marker, dispose}` into the shared `records` array (keyed by index, so
// the deepest-returns-first order is irrelevant).
function childComponent(
    levels: Level[],
    index: number,
    scope: Record<string, unknown>,
    records: LevelRecord[],
): unknown {
    return () => ({
        mount: (parent: Node, anchor: Node | null): (() => void) => {
            // `holder.dispose` always points at the CURRENT suffix disposer. The parent layout's
            // `$rt.component` stores our returned `() => holder.dispose()` as its `inner`, and a remount
            // just retargets `holder.dispose` — so the parent's teardown always tears the live suffix, with
            // no wrapper nesting that grows per nav.
            const holder: { dispose: () => void } = { dispose: () => {} }

            // Mount `lv[index]` (recursing into its child via `{children()}`), returning the RAW disposer.
            const mountLevels = (lv: Level[], sc: Record<string, unknown>): (() => void) => {
                const level = lv[index]
                if (level === undefined) throw new Error(`compose: no level at index ${index}`)
                const childScope =
                    index + 1 < lv.length
                        ? { ...sc, children: childComponent(lv, index + 1, sc, records) }
                        : sc
                return level.mount(parent, childScope, anchor)
            }

            // Phase 1: tear the outgoing suffix (this level + everything nested; the outlet `marker`
            // belongs to the kept parent's component call, so it stays), then graft the destination's SSR
            // shell into the outlet before the marker. Returns the first grafted node (where claim starts).
            const graftSuffix = (html: string): Node | null => {
                holder.dispose()
                const template = document.createElement('template')
                template.innerHTML = html
                const first = template.content.firstChild
                if (anchor !== null) parent.insertBefore(template.content, anchor)
                else parent.appendChild(template.content)
                records.length = index + 1 // drop the stale deeper records; claim repopulates them
                return first
            }
            // Phase 2: claim the grafted (+ patch-filled) DOM, reusing the emitted mount's hydrate branch by
            // driving the module cursor ourselves, and repoint the kept parent's teardown at the new suffix.
            // On a claim MISMATCH (the grafted DOM couldn't be adopted — e.g. an SSR-streamed list the graft
            // didn't fully assemble), degrade like the emitted `hydrate`'s whole-page fallback but SCOPED to
            // the suffix: drop the grafted nodes and fresh-mount (clone) the suffix instead. The kept layouts
            // stay alive; the suffix rebuilds client-side, resolving reads/streams from the seeded scope. No
            // reload — the same graceful recovery a full-swap nav gets.
            const claimSuffix = (
                newLevels: Level[],
                newScope: Record<string, unknown>,
                firstNode: Node | null,
            ): void => {
                startHydration()
                hydrateSeek(firstNode)
                let claimed = false
                try {
                    holder.dispose = mountLevels(newLevels, newScope)
                    claimed = true
                } catch {
                    // Fall through to a fresh mount below. What the swallow does NOT leak any more is the
                    // failed attempt's `<script>` effects: the emitted `mount` disposes its own setup
                    // scope on every path that does not hand a disposer back (`emitClient.ts`), and a
                    // throw from a nested level propagates through each enclosing `$mount0`, so the whole
                    // partially-mounted chain tears itself down before we retry. Without that, the retry
                    // below left one live `watch` per level per failed claim, permanently.
                }
                endHydration()
                if (claimed) return
                for (let node = firstNode; node !== null && node !== anchor; ) {
                    const next: Node | null = node.nextSibling
                    node.parentNode?.removeChild(node)
                    node = next
                }
                holder.dispose = mountLevels(newLevels, newScope) // hydrating now false → clones before anchor
            }

            records[index] = {
                index,
                parent,
                marker: anchor,
                dispose: () => holder.dispose(),
                graftSuffix,
                claimSuffix,
                remount: (
                    newLevels: Level[],
                    newScope: Record<string, unknown>,
                    html: string,
                ): void => claimSuffix(newLevels, newScope, graftSuffix(html)),
            }
            holder.dispose = mountLevels(levels, scope)
            return () => holder.dispose()
        },
    })
}

// The scope the outermost level sees: the base scope plus its `children` (the next level), when there
// is more than one level. A lone level (no layouts) sees the base scope unchanged.
function rootScope(
    levels: Level[],
    scope: Record<string, unknown>,
    records: LevelRecord[],
): Record<string, unknown> {
    return levels.length > 1
        ? { ...scope, children: childComponent(levels, 1, scope, records) }
        : scope
}

// Compose `[rootLayout, …, nearestLayout, page]` into one mountable/hydratable unit. A single-element
// array (a page with no layouts) passes straight through, so back-compat is exact. mount/hydrate return
// a `ChainHandle` (a disposer that also carries the per-level `records`).
export function compose(levels: Level[]): ComposedChain {
    const first = levels[0]
    if (first === undefined) throw new Error('compose: requires at least one level')
    return {
        mount(target: Node, scope: Record<string, unknown>, anchor?: Node | null): ChainHandle {
            const records: LevelRecord[] = []
            const dispose = first.mount(target, rootScope(levels, scope, records), anchor)
            records[0] = { index: 0, parent: target, marker: anchor ?? null, dispose }
            return makeHandle(dispose, records)
        },
        hydrate(container: Node, scope: Record<string, unknown>): ChainHandle {
            const records: LevelRecord[] = []
            const dispose = first.hydrate(container, rootScope(levels, scope, records))
            records[0] = { index: 0, parent: container, marker: null, dispose }
            return makeHandle(dispose, records)
        },
    }
}
