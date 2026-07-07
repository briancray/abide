import { abideLog } from '../../shared/abideLog.ts'
import type { EffectResult } from './types/EffectResult.ts'
import type { Teardown } from './types/Teardown.ts'

/*
Normalises an effect/attachment body's return into a single callable teardown (or
undefined when it returned nothing). A function is the teardown itself; a promise
is wrapped so the teardown runs once it settles — chained, never awaited, so a
dispose mid-setup still tears down without blocking the caller. Shared by
`createEffectNode` (runs it on re-run + dispose) and `attach` (registers it with
the owner scope).
*/
export function toTeardown(result: EffectResult): Teardown | undefined {
    if (typeof result === 'function') {
        return result
    }
    if (result instanceof Promise) {
        return () => {
            result.then(
                (teardown) => {
                    if (typeof teardown === 'function') {
                        teardown()
                    }
                },
                (error) => {
                    /* A superseded reactive read aborts its in-flight RPC — expected, stays
                       quiet. Any OTHER rejection is a real bug in the async effect body;
                       surface it (the visibility goal) instead of silently discarding it. */
                    const aborted = (error as { name?: string } | undefined)?.name === 'AbortError'
                    if (!aborted) {
                        abideLog.error(error)
                    }
                },
            )
        }
    }
    return undefined
}
