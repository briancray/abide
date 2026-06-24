import { flushEffects } from './flushEffects.ts'
import { REACTIVE_CONTEXT } from './REACTIVE_CONTEXT.ts'

/*
Runs `fn` with reactive writes coalesced: effects dirtied inside queue once and
flush a single time when the outermost batch exits, so a burst of writes (e.g. an
event handler setting several signals) re-runs each dependent effect once instead
of once per write. Nests safely — only the depth-0 exit flushes — so a batched
write that calls into another batched write (a handler invoking a doc patch) still
flushes once, at the top. Same idiom `createDoc`/`clientPage` inline, factored out.
*/
export function batch<T>(fn: () => T): T {
    REACTIVE_CONTEXT.batchDepth += 1
    try {
        return fn()
    } finally {
        REACTIVE_CONTEXT.batchDepth -= 1
        if (REACTIVE_CONTEXT.batchDepth === 0) {
            flushEffects()
        }
    }
}
