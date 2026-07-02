import type { Scope } from '../types/Scope.ts'

/*
The swappable backing behind `CURRENT_SCOPE.current`. The default is a module
variable — correct on the client (one render tree) and on the server outside any
request. The server swaps in an AsyncLocalStorage-backed holder at boot
(`installAmbientScopeStore`), because SSR is partly async: a render brackets itself
with `enterScope`/`exitScope` and `await`s inline between them (blocking `{#await}`,
child renders, slots, a top-level `await`). A module global held across those awaits
interleaves across concurrent requests — one render resumes to read another's scope.
Keying the ambient off the per-request store (which the async context propagates
correctly) isolates it. Mirrors `requestScopeResolver`'s server-installed slot; the
indirection cost lands at build/effect-creation time, never on the signal hot path.
*/
type ScopeBacking = { get(): Scope | undefined; set(value: Scope | undefined): void }

let moduleCurrent: Scope | undefined

export const ambientScopeBacking: { active: ScopeBacking } = {
    active: {
        get: () => moduleCurrent,
        set: (value) => {
            moduleCurrent = value
        },
    },
}
