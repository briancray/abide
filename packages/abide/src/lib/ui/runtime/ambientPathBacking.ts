/*
The swappable backing behind `CURRENT_PATH.current` — the render-path sibling of
`ambientScopeBacking`. The default is a module variable with a synchronous save/restore `run`
(correct on the client, whose mount is synchronous — the whole subtree builds and restores before
control returns, so a slot never has to survive an `await`). The server swaps in an
AsyncLocalStorage-backed `run` at boot (`installAmbientScopeStore`, ADR-0033 D1), because SSR
composes the path while `await`ing inline (the Tier-2 cell barrier, child renders) and the pushed
segment must be inherited by the render's own post-await continuation — a synchronously-restored slot
cannot follow an async continuation. `run(composed, build)` establishes the composed path for
`build`; `get()` reads the active path (`''` outside any push). Mirrors `ambientScopeBacking`.
*/
type PathBacking = {
    run: <T>(composedPath: string, build: () => T) => T
    get: () => string
}

let modulePath = ''

export const ambientPathBacking: { active: PathBacking } = {
    active: {
        run: <T>(composedPath: string, build: () => T): T => {
            const previous = modulePath
            modulePath = composedPath
            try {
                return build()
            } finally {
                modulePath = previous
            }
        },
        get: () => modulePath,
    },
}
