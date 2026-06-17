import type { Teardown } from './Teardown.ts'

/*
What an effect or attachment body returns: a teardown to run before its next run
and on dispose, nothing, or — when the body is async — a promise of either. The
async case tracks only the reads before its first `await`; reads after it are not
captured by the reactive graph.
*/
export type EffectResult = void | Teardown | Promise<void | Teardown>
