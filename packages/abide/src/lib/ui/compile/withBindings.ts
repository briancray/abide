import { destructureBindingNames } from './destructureBindingNames.ts'
import type { Binding } from './types/Binding.ts'
import type { ShadowKind } from './types/ShadowKind.ts'
import type { ShadowScope } from './types/ShadowScope.ts'

/*
The ONE shared registration path for a block's bindings, built on `withShadow`. Iterates
a plan's `Binding[]` once, derives each binding's leaf names (`destructureBindingNames` —
the single name derivation), and registers them under the `ShadowKind` the injected
`kindMapping` returns, for the duration of `body`. The back-ends differ ONLY in the
mapping they inject: the client maps `reactive → derived` (a `.value` cell, its wiring
arranged separately via `reactiveBinding`) and `plain → plain`; SSR has no cells, so it
maps every binding → `plain`. A name a block introduces therefore flows to exactly one
shadow kind, decided by the plan's classification and one mapping — `block-binding-shadow`
(a name registered on one back-end but not the other, or under the wrong kind) is designed
out, not test-caught.
*/
export function withBindings<T>(
    withShadow: ShadowScope['withShadow'],
    bindings: Binding[],
    kindMapping: (binding: Binding) => ShadowKind,
    body: () => T,
): T {
    /* Group each binding's leaf names by the kind the mapping assigns, so one `withShadow`
       per kind registers them all (nested, so both kinds shadow simultaneously). */
    const byKind = new Map<ShadowKind, string[]>()
    for (const binding of bindings) {
        const kind = kindMapping(binding)
        const names = byKind.get(kind) ?? []
        names.push(...destructureBindingNames(binding.name))
        byKind.set(kind, names)
    }
    /* Fold the per-kind `withShadow` calls around `body` — each pushes its names on entry
       and pops them in a `finally`, so no branch's shadows outlive the branch. */
    const entries = [...byKind]
    const run = (index: number): T => {
        if (index >= entries.length) {
            return body()
        }
        const [kind, names] = entries[index]
        return withShadow(names, kind, () => run(index + 1))
    }
    return run(0)
}
