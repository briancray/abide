/* One pending await block captured during SSR: its boundary id, the promise to
   await, and the string-renderers for the resolved value / error. */
export type SsrAwait = {
    id: number
    promise: () => unknown
    then: (value: unknown) => string
    catch: (error: unknown) => string
}

/* The result of a component's server `render()`: the pending-shell HTML, the
   serializable document snapshot for client resume, and the await blocks to
   stream. */
export type SsrRender = {
    html: string
    state: unknown
    awaits: SsrAwait[]
}
