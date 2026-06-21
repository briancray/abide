import { snippetPayload } from '../../shared/snippet.ts'
import { effect } from '../effect.ts'
import { RENDER } from '../runtime/RENDER.ts'
import { scope } from '../runtime/scope.ts'
import { scopeGroup } from '../runtime/scopeGroup.ts'
import { clearBetween } from './clearBetween.ts'
import { fillBefore } from './fillBefore.ts'
import { openMarker } from './openMarker.ts'

/*
A `{snippet(args)}` interpolation: mount the branded builder's nodes in a range
bounded by two comment markers. The content builds straight into `parent` —
sequential build order places it correctly among siblings — and its effects join
the surrounding component scope, so the body's reactive reads update fine-grained.

The CALL is reactive in its arguments: an effect re-reads `read()` so a change in
the argument expression (e.g. `{row(items())}`) tears the range down and rebuilds
with fresh args. `read()` returns a fresh builder closing over freshly-evaluated
args each call, so there is nothing to diff — the snippet re-mounts as a unit, the
same coarse model as `when`/`each` (args behave like props). The body's own reads
stay fine-grained within a single mount; the outer effect tracks only the args,
since `fillBefore` wraps the body in its own scope.

On hydrate the builder runs against the server-rendered nodes between the
`<!--abide:snippet-->`/`<!--/abide:snippet-->` markers — its `skeleton`/`appendText`
claim them in place — and the effect's first run is a no-op that only subscribes to
the args; a later argument change rebuilds fresh (the SSR markers stay as the range).
*/
// @documentation plumbing
export function appendSnippet(parent: Node, read: () => unknown): void {
    const hydration = RENDER.hydration
    /* Mount scopes register with the owner so they dispose on owner teardown, not
       only on an argument-driven rebuild via clearBetween. */
    const group = scopeGroup()
    let dispose: (() => void) | undefined

    /* The branded builder, or undefined for anything else (a non-snippet value
       mounts nothing — the range stays empty until the args yield a builder). */
    const builderOf = (): ((host: Node) => void) | undefined => {
        const payload = snippetPayload(read())
        return typeof payload === 'function' ? (payload as (host: Node) => void) : undefined
    }

    let open: Comment
    let close: Comment
    if (hydration !== undefined) {
        open = openMarker(parent, 'abide:snippet')
        const builder = builderOf()
        if (builder !== undefined) {
            dispose = group.track(scope(() => builder(parent))) // content claims the SSR nodes in place
        }
        close = openMarker(parent, '/abide:snippet')
    } else {
        open = openMarker(parent, 'abide:snippet')
        close = openMarker(parent, '/abide:snippet')
        const builder = builderOf()
        if (builder !== undefined) {
            dispose = group.track(fillBefore(close, builder))
        }
    }

    /* The initial mount is built above (create or hydrate); the first effect run only
       subscribes to the args via `builderOf`, then later argument changes rebuild. */
    let first = true
    effect(() => {
        const builder = builderOf()
        if (first) {
            first = false
            return
        }
        clearBetween(open, close, dispose)
        dispose = builder !== undefined ? group.track(fillBefore(close, builder)) : undefined
    })
}
