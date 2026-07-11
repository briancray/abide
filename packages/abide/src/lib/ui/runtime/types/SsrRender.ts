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
    id: string
    promise: () => unknown
    then: (value: unknown) => Promise<string>
    catch?: (error: unknown) => Promise<string>
    /* ADR-0039 (spike): a STANDALONE-UNIT boundary — a streamed child COMPONENT — carries no
       resume value of its own (its `then` returns the child's rendered html and merges the child's
       own awaits/resume for nested composition; the child re-mounts client-side rather than
       adopting a RESUME[id] value). Marks `settle` to emit an html-only fragment with no resume seed
       script, so the client never tries to decode a whole SsrRender as an await value. Absent for a
       normal await block (which seeds its resolved value). */
    htmlOnly?: boolean
}

/* The result of a component's server `render()`: the pending-shell HTML, the
   serializable document snapshot for client resume, the STREAMING await blocks to
   flush out of order, and `resume` — the inline-rendered BLOCKING await values keyed
   by boundary id, seeded into the manifest so hydration adopts them without a refetch. */
export type SsrRender = {
    html: string
    state: unknown
    awaits: SsrAwait[]
    resume: Record<string, ResumeEntry>
}
