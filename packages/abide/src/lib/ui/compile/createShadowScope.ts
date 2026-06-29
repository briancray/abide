import type { ShadowKind } from './types/ShadowKind.ts'
import type { ShadowScope } from './types/ShadowScope.ts'

/*
Builds a fresh `ShadowScope` — the typed, auto-popping branch-local shadow stack. One
`Set` per `ShadowKind`, reached only through `withShadow` (push on entry, pop in a
`finally`), never directly. The `finally` is the safety move: the old hand-written
pop ran after the body returned, so any throw inside the body (e.g. SSR's `await then`
TDZ path) leaked the branch's shadows into every later sibling. Here the pop is
unconditional, so a branch's shadows cannot outlive the branch.
*/
export function createShadowScope(): ShadowScope {
    const byKind: Record<ShadowKind, Set<string>> = {
        derived: new Set<string>(),
        plain: new Set<string>(),
    }

    function withShadow<T>(names: Iterable<string>, kind: ShadowKind, body: () => T): T {
        const scope = byKind[kind]
        /* Track only the names this call newly added, so a name already shadowing from an
           outer branch survives this branch's pop. */
        const added: string[] = []
        for (const name of names) {
            if (!scope.has(name)) {
                scope.add(name)
                added.push(name)
            }
        }
        try {
            return body()
        } finally {
            for (const name of added) {
                scope.delete(name)
            }
        }
    }

    return {
        withShadow,
        names: (kind) => byKind[kind],
    }
}
