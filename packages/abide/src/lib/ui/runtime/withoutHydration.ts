import { RENDER } from './RENDER.ts'

/*
Runs `build` with the hydration claim cursor cleared, restoring it after. The
control-flow blocks route FRESH builds through here — a pending/resolved await
branch, a try's catch branch, a fillBefore insert — so their build helpers
create nodes instead of trying to claim server DOM that isn't there. A rebuild
that fires while an outer hydrate pass is still active (e.g. a synchronous write
that flips a `when`/`switch` mid-hydrate) would otherwise make `cloneStatic` /
text claim discarded or nonexistent nodes and silently render nothing. The
`finally` restore lets a fresh build sit inside an ongoing hydrate pass without
ending it early.
*/
export function withoutHydration<T>(build: () => T): T {
    const previous = RENDER.hydration
    RENDER.hydration = undefined
    try {
        return build()
    } finally {
        RENDER.hydration = previous
    }
}
