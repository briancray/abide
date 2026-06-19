import { createScope } from './createScope.ts'
import { CURRENT_SCOPE } from './runtime/CURRENT_SCOPE.ts'
import type { Scope } from './types/Scope.ts'

/*
Establishes a fresh lexical scope for an SSR render and returns the previous one
to restore (see `exitScope`). The client gets its per-component scope from
`mount`/`hydrate`; a server render has no mount, so its body brackets itself with
`enterScope`/`exitScope` — each render (and each nested child render) owns an
isolated scope, so `scope()` and `model` don't bleed across renders. Nests via the
returned previous, like `mount`'s save/restore.
*/
// @readme plumbing
export function enterScope(): Scope | undefined {
    const previous = CURRENT_SCOPE.current
    CURRENT_SCOPE.current = createScope({}, previous, true)
    return previous
}
