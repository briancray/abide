/* One pending await block captured during SSR: its boundary id, the promise to
   await, and the string-renderers for the resolved value / error. `blocking` (a
   `then` on the `await` tag) makes `renderToStream` settle it BEFORE the first flush,
   splicing the resolved branch into its empty boundary; absent → streamed after.
   `catch` is absent when the block has no catch branch — a rejection then surfaces
   to the stream/error path instead of rendering an empty branch. */
export type SsrAwait = {
    id: number
    blocking?: boolean
    promise: () => unknown
    then: (value: unknown) => string
    catch?: (error: unknown) => string
}

/* The result of a component's server `render()`: the pending-shell HTML, the
   serializable document snapshot for client resume, and the await blocks to
   stream. */
export type SsrRender = {
    html: string
    state: unknown
    awaits: SsrAwait[]
}
