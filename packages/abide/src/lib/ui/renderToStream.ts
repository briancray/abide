import { resumeSeedScript } from './resumeSeedScript.ts'
import type { ResumeEntry } from './runtime/RESUME.ts'
import type { SsrAwait, SsrRender } from './runtime/types/SsrRender.ts'

/*
Out-of-order SSR streaming. Yields the shell first (so the browser paints
immediately), then one resolved fragment per STREAMING await block as its promise
settles — in completion order, not source order, so a slow read never blocks a fast
one. Each resolved fragment is a `<abide-resolve data-id="ID"><script
type="application/json">…</script>…</abide-resolve>` that `applyResolved` swaps into
the matching `<!--abide:await:ID-->` boundary; the leading script holds the
JSON-serialized value, registered for hydration so an `await` block adopts the
resolved branch on resume instead of re-running.

This is the await-block-streams half of the cache rule: a top-level `await` in the
script would have blocked the shell (inlined), but a streaming await *block* flushes
its shell now and streams the value when ready. Driven by an async `render()` result,
so it composes with any transport (HTTP chunked, a socket frame, a test).

A `then` on the `await` tag makes the block BLOCKING: it is NOT streamed — it renders
inline during the async render pass (depth-first, matching the client) and its value
lands in `render().resume`. The shell already carries the resolved branch, so the
first yield just seeds those values into the manifest; only streaming blocks flush
out of order after it.
*/
// @documentation plumbing
export async function* renderToStream(
    render: () => SsrRender | Promise<SsrRender>,
): AsyncGenerator<string> {
    const { html, awaits, resume } = await render()
    /* The shell already contains every blocking await's resolved branch (rendered
       inline); seed their values so hydration adopts them without a refetch. */
    yield html + resumeSeedScript(resume)
    /* A BLOCKING await nested inside a streaming branch renders inline during `settle`
       (after the seed above), writing its value onto this same `$resume` object — so the
       initial seed misses it. Track which resume ids are already seeded and emit the delta
       alongside each streamed fragment, so the client adopts the nested blocking branch
       instead of refetching. (`resume` is the render body's live object, so late writes
       appear here.) */
    const seededResume = new Set<number>(Object.keys(resume).map(Number))
    const resumeDelta = (): Record<number, ResumeEntry> => {
        const delta: Record<number, ResumeEntry> = {}
        for (const [key, entry] of Object.entries(resume)) {
            const id = Number(key)
            if (!seededResume.has(id)) {
                seededResume.add(id)
                delta[id] = entry
            }
        }
        return delta
    }
    /* Streaming awaits flush their resolved fragment out of order as each settles. A
       streaming block's async resolved/error renderer may itself register NESTED streaming
       awaits — its `branchContent` runs `$awaits.push(...)` onto this same `awaits` array
       during `settle`, AFTER the initial scan. So re-scan for newly-appended blocks after
       every settle (tracking which ids are already enqueued), composing to any depth. */
    const inflight = new Map<number, Promise<Settled>>()
    const enqueued = new Set<number>()
    const enqueueNew = (): void => {
        for (const block of awaits) {
            if (!enqueued.has(block.id)) {
                enqueued.add(block.id)
                inflight.set(block.id, settle(block))
            }
        }
    }
    enqueueNew()
    while (inflight.size > 0) {
        const resolved = await Promise.race(inflight.values())
        inflight.delete(resolved.id)
        enqueueNew()
        const encoded = encodeResume(resolved.resume)
        yield resumeSeedScript(resumeDelta()) +
            `<abide-resolve data-id="${resolved.id}">` +
            `<script type="application/json">${encoded}</script>` +
            `${resolved.html}</abide-resolve>`
    }
}

type Settled = { id: number; html: string; resume: ResumeEntry }

/* Awaits one streaming block's promise and renders the resolved or error branch to
   HTML (the renderers are async so a nested `await` block composes), capturing the
   value (serializable) for the resume manifest. Errors serialize as their message —
   enough for the catch branch, without leaking a stack. */
function settle(block: SsrAwait): Promise<Settled> {
    return Promise.resolve(block.promise()).then(
        async (value) => ({
            id: block.id,
            html: await block.then(value),
            resume: { ok: true, value },
        }),
        async (error) => {
            /* No catch branch → surface the rejection (500 before the first flush,
               mid-stream error after) instead of swallowing it into an empty fragment. */
            if (block.catch === undefined) {
                throw error
            }
            return {
                id: block.id,
                html: await block.catch(error),
                resume: { ok: false, error: String(error) },
            }
        },
    )
}

/* JSON for a `<script type="application/json">` data block: script content is raw
   text, so only `<` needs neutralizing (emitted as a unicode escape) to keep a
   literal `</script>` from closing the block early — quotes stay raw. Far cheaper
   than attribute escaping (no full-string `"`/`&` passes) and JSON.parse decodes it
   back. `applyResolved`/the inline swap script read it via `.textContent`. */
function encodeResume(resume: ResumeEntry): string {
    return JSON.stringify(resume).replace(/</g, '\\u003c')
}
