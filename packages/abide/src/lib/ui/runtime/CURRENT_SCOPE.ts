import type { Scope } from '../types/Scope.ts'
import { ambientScopeBacking } from './ambientScopeBacking.ts'

/*
The ambient lexical scope. The compiler establishes one per lexical level (a
component, a control-flow branch) by setting `current` around the build, so the
bare `scope()` accessor and the scope-bound primitives resolve "where they are"
with no handle threaded. Undefined outside any scope, where `scope()` mints a
detached root on first use.

`current` reads/writes through a SWAPPABLE backing (`ambientScopeBacking`) rather
than a raw field: the default is a module variable, but the server installs an
AsyncLocalStorage-backed holder so concurrent async SSR renders don't clobber one
shared global across the inline `await`s they suspend on. See `ambientScopeBacking`.
*/
export const CURRENT_SCOPE: { current: Scope | undefined } = {
    get current(): Scope | undefined {
        return ambientScopeBacking.active.get()
    },
    set current(value: Scope | undefined) {
        ambientScopeBacking.active.set(value)
    },
}
