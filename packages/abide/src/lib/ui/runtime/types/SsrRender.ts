import type { ResumeEntry } from '../RESUME.ts'

/* One STREAMING await block captured during SSR (no `then` on the `await` tag): its
   boundary id, the promise to await, and the async string-renderers for the resolved
   value / error. `renderToStream` flushes each resolved fragment out of order. The
   renderers are async so a nested `await` block inside the branch composes. `catch`
   is absent when the block has no catch branch — a rejection then surfaces to the
   stream/error path instead of rendering an empty branch. (Blocking awaits — a `then`
   on the tag — never land here: they render inline during the async render pass and
   seed `SsrRender.resume`.) */
export type SsrAwait = {
    id: number
    promise: () => unknown
    then: (value: unknown) => Promise<string>
    catch?: (error: unknown) => Promise<string>
}

/* The result of a component's server `render()`: the pending-shell HTML, the
   serializable document snapshot for client resume, the STREAMING await blocks to
   flush out of order, and `resume` — the inline-rendered BLOCKING await values keyed
   by boundary id, seeded into the manifest so hydration adopts them without a refetch. */
export type SsrRender = {
    html: string
    state: unknown
    awaits: SsrAwait[]
    resume: Record<number, ResumeEntry>
}
