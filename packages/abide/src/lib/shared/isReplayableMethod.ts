import { REPLAYABLE_METHODS } from './REPLAYABLE_METHODS.ts'
import type { ReplayableMethod } from './types/ReplayableMethod.ts'

/* Narrowing gate over REPLAYABLE_METHODS so callers get the typed method without a cast. */
export function isReplayableMethod(method: string): method is ReplayableMethod {
    return REPLAYABLE_METHODS.has(method)
}
