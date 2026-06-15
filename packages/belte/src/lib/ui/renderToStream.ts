import type { ResumeEntry } from './runtime/RESUME.ts'
import type { SsrAwait, SsrRender } from './runtime/types/SsrRender.ts'

/*
Out-of-order SSR streaming. Yields the pending shell first (so the browser paints
immediately), then one resolved fragment per await block as its promise settles —
in completion order, not source order, so a slow read never blocks a fast one.
Each resolved fragment is a `<belte-resolve data-id="ID" data-resume="…">…</belte-resolve>`
that `applyResolved` swaps into the matching `<!--belte:await:ID-->` boundary; the
`data-resume` payload is the JSON-serialized value, registered for hydration so an
`await` block adopts the resolved branch on resume instead of re-running.

This is the await-block-streams half of the cache rule: a top-level `await` in the
script would have blocked the shell (inlined), but an await *block* flushes its
shell now and streams the value when ready. Driven by a plain `render()` result,
so it composes with any transport (HTTP chunked, a socket frame, a test).
*/
// @readme plumbing
export async function* renderToStream(render: () => SsrRender): AsyncGenerator<string> {
    const { html, awaits } = render()
    yield html
    const inflight = new Map<number, Promise<Settled>>()
    for (const block of awaits) {
        inflight.set(block.id, settle(block))
    }
    while (inflight.size > 0) {
        const resolved = await Promise.race(inflight.values())
        inflight.delete(resolved.id)
        const resume = encodeResume(resolved.resume)
        yield `<belte-resolve data-id="${resolved.id}" data-resume="${resume}">${resolved.html}</belte-resolve>`
    }
}

type Settled = { id: number; html: string; resume: ResumeEntry }

/* Awaits one block's promise and renders the resolved or error branch to HTML,
   capturing the value (serializable) for the resume manifest. Errors serialize as
   their message — enough for the catch branch, without leaking a stack. */
function settle(block: SsrAwait): Promise<Settled> {
    return Promise.resolve(block.promise()).then(
        (value) => ({ id: block.id, html: block.then(value), resume: { ok: true, value } }),
        (error) => ({
            id: block.id,
            html: block.catch(error),
            resume: { ok: false, error: String(error) },
        }),
    )
}

/* JSON for an HTML double-quoted attribute: escape `"` and `&` (and `<` for safety
   inside markup). `applyResolved`/the inline swap script decode it via the DOM. */
function encodeResume(resume: ResumeEntry): string {
    return JSON.stringify(resume)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
}
