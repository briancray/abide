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
            /* Swallow a rejection: an async body that rejected (e.g. an aborted RPC) must
               not surface as an unhandled rejection when the teardown runs at dispose. */
            result.then(
                (teardown) => {
                    if (typeof teardown === 'function') {
                        teardown()
                    }
                },
                () => undefined,
            )
        }
    }
    return undefined
}
