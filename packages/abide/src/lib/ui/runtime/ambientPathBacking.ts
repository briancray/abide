/*
The swappable backing behind `CURRENT_PATH.current` — the render-path sibling of
`ambientScopeBacking`. The default is a module variable (correct on the client, one render
tree). The server swaps in an AsyncLocalStorage-backed holder at boot
(`installAmbientScopeStore`), because SSR composes the path while `await`ing inline (the Tier-2
cell barrier, child renders) between a component's `enterScope`/`exitScope` — a module global
held across those awaits would interleave across concurrent requests, so a resumed render would
read another's path. Keying off the per-request store isolates it. Mirrors `ambientScopeBacking`.
*/
type PathBacking = { get(): string; set(value: string): void }

let modulePath = ''

export const ambientPathBacking: { active: PathBacking } = {
    active: {
        get: () => modulePath,
        set: (value) => {
            modulePath = value
        },
    },
}
