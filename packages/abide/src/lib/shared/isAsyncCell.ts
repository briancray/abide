import { ASYNC_CELL } from './ASYNC_CELL.ts'
import type { AsyncComputed } from './types/AsyncComputed.ts'

/*
True for an async cell's facet — the brand the probe family tests to route a cell
(`AsyncComputed`/`AsyncState`) to its own `peek`/`pending`/`refreshing`/`refresh`
methods instead of the cache/stream registries.
*/
export function isAsyncCell(value: unknown): value is AsyncComputed<unknown> {
    return typeof value === 'object' && value !== null && ASYNC_CELL in value
}
