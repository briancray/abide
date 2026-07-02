import { afterEach, expect, test } from 'bun:test'
import { installAmbientScopeStore } from '../src/lib/server/runtime/installAmbientScopeStore.ts'
import { requestContext } from '../src/lib/server/runtime/requestContext.ts'
import type { RequestStore } from '../src/lib/server/runtime/types/RequestStore.ts'
import { enterScope } from '../src/lib/ui/enterScope.ts'
import { exitScope } from '../src/lib/ui/exitScope.ts'
import { ambientScopeBacking } from '../src/lib/ui/runtime/ambientScopeBacking.ts'
import { scope } from '../src/lib/ui/scope.ts'
import type { Scope } from '../src/lib/ui/types/Scope.ts'

/*
Regression for the concurrent-SSR ambient-scope bleed. `compileSSR` wraps a render
that inlines an `await` in an async IIFE: `enterScope()` sets the ambient, the body
`await`s (a blocking `{#await}`, a child render, a `<slot>`, a top-level `await`),
then a post-await `scope()` read resolves it again. The ambient lived in one module
global, so two concurrent renders interleaving at their awaits clobbered it — one
render resumed to read the other's scope (the same class of hazard the block-id
counter was moved to the request-local `$ctx` to dodge).

`installAmbientScopeStore` keys the ambient off the per-request ALS store instead,
which the async context propagates across awaits, so each render reads its own scope.
The test mimics the emitted bracket exactly (enterScope → await → scope()) and forces
the interleave by controlling promise resolution.
*/

/* Restore the default (module-var) backing so this install doesn't leak into other suites. */
const defaultBacking = ambientScopeBacking.active
afterEach(() => {
    ambientScopeBacking.active = defaultBacking
})

function gate() {
    let open!: () => void
    const promise = new Promise<void>((resolve) => (open = resolve))
    return { promise, open }
}

/* Only `.currentScope` is touched by the backing, so a bare object stands in for the store. */
const store = (): RequestStore => ({}) as unknown as RequestStore

test('concurrent async SSR renders keep isolated ambient scopes across await points', async () => {
    installAmbientScopeStore()
    const a = gate()
    const b = gate()
    const captured: Record<string, { own: Scope; postAwait: Scope | undefined }> = {}

    const render = (name: string, wait: Promise<void>): Promise<void> =>
        requestContext.run(store(), async () => {
            const previous = enterScope()
            const own = scope()
            try {
                await wait
                captured[name] = { own, postAwait: scope() }
            } finally {
                exitScope(previous)
            }
        })

    const renderA = render('A', a.promise)
    const renderB = render('B', b.promise)
    /* A resumes while B is still suspended mid-render — the interleave that bled the global. */
    a.open()
    await renderA
    b.open()
    await renderB

    expect(captured.A.postAwait).toBe(captured.A.own)
    expect(captured.B.postAwait).toBe(captured.B.own)
    /* And the two renders never shared a scope. */
    expect(captured.A.own).not.toBe(captured.B.own)
})
