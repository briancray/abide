import type { ASYNC_CELL } from '../ASYNC_CELL.ts'

/*
A read-only async cell — what `computed(await …)` / `computed(getStream())` produce.
It *tracks* an async source (a promise it unwrapped, or a NamedAsyncIterable whose
frames it follows) rather than holding a value. Unlike sync `Computed<T>` it has NO
`.value`; it is read through the probe family, always method-form — `peek()` (the
retained value or latest frame, or `undefined`), `pending()` (no value yet),
`refreshing()` (a value held while a fresher source is in flight), `error()` (the
last rejection), `refresh()` (re-invoke the source). The standalone probes route
here too: `peek(cell)` ≡ `cell.peek()`. Branded so those probes recognise it.
*/
export interface AsyncComputed<T> {
    readonly [ASYNC_CELL]: true
    peek(): T | undefined
    pending(): boolean
    refreshing(): boolean
    error(): unknown
    refresh(): void
}
