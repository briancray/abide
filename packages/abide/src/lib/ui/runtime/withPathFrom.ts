import { CURRENT_PATH } from './CURRENT_PATH.ts'
import { escapeKey } from './escapeKey.ts'

/*
Runs `build` with the render path set to `base` + one escaped `segment`, restoring after. Unlike
`withPath` (which pushes relative to the LIVE ambient), this composes from an EXPLICIT base — for
a control-flow block that rebuilds content reactively AFTER mount, when the ambient path is no
longer on the stack. The block captures `CURRENT_PATH.current` at construction (its render-time
ancestry) and re-establishes `base/segment` for every branch/row build — initial and every later
swap — so a component or cell built on a swap still gets its full, stable id, not a bare segment.
*/
export function withPathFrom<T>(base: string, segment: string | number, build: () => T): T {
    const previous = CURRENT_PATH.current
    CURRENT_PATH.current = base === '' ? escapeKey(segment) : `${base}/${escapeKey(segment)}`
    try {
        return build()
    } finally {
        CURRENT_PATH.current = previous
    }
}
