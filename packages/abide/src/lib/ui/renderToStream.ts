import type { ResumeEntry } from './runtime/RESUME.ts'
import type { SsrAwait, SsrRender } from './runtime/types/SsrRender.ts'

/*
Out-of-order SSR streaming. Yields the pending shell first (so the browser paints
immediately), then one resolved fragment per await block as its promise settles —
in completion order, not source order, so a slow read never blocks a fast one.
Each resolved fragment is a `<abide-resolve data-id="ID"><script type="application/json">
…</script>…</abide-resolve>` that `applyResolved` swaps into the matching
`<!--abide:await:ID-->` boundary; the leading script holds the JSON-serialized value,
registered for hydration so an `await` block adopts the resolved branch on resume
instead of re-running.

This is the await-block-streams half of the cache rule: a top-level `await` in the
script would have blocked the shell (inlined), but an await *block* flushes its
shell now and streams the value when ready. Driven by a plain `render()` result,
so it composes with any transport (HTTP chunked, a socket frame, a test).

A `then` on the `await` tag makes the block BLOCKING: it settles before the first
flush, its resolved branch spliced into its (empty) boundary and its value seeded
into the resume manifest inline — so the value is in the first paint, no pending
shell, no swap. The first yield therefore awaits all blocking blocks; only the
remaining streaming blocks flush out of order after it.
*/
// @readme plumbing
export async function* renderToStream(render: () => SsrRender): AsyncGenerator<string> {
    const { html, awaits } = render()
    /* Blocking awaits (a `then` on the `await` tag) settle BEFORE the first flush:
       their resolved branch is spliced into its empty boundary and its value registered
       inline, so the first paint already has the value — no pending, no swap. */
    const blocking = awaits.filter((block) => block.blocking === true)
    let shell = html
    const resumed: Record<number, ResumeEntry> = {}
    for (const settled of await Promise.all(blocking.map(settle))) {
        shell = spliceResolved(shell, settled.id, settled.html)
        resumed[settled.id] = settled.resume
    }
    yield shell + resumeScript(resumed)
    /* Streaming awaits flush their resolved fragment out of order as each settles. */
    const inflight = new Map<number, Promise<Settled>>()
    for (const block of awaits) {
        if (block.blocking !== true) {
            inflight.set(block.id, settle(block))
        }
    }
    while (inflight.size > 0) {
        const resolved = await Promise.race(inflight.values())
        inflight.delete(resolved.id)
        const resume = encodeResume(resolved.resume)
        yield `<abide-resolve data-id="${resolved.id}">` +
            `<script type="application/json">${resume}</script>` +
            `${resolved.html}</abide-resolve>`
    }
}

/* Inserts a blocking await's resolved markup into its (empty) boundary in the shell,
   between the open and close markers. */
function spliceResolved(shell: string, id: number, resolved: string): string {
    const open = `<!--abide:await:${id}-->`
    const close = `<!--/abide:await:${id}-->`
    /* A function replacement, so a `$&`/`$\`` etc. in the rendered value is inserted
       literally rather than interpreted as a special replacement pattern. */
    return shell.replace(`${open}${close}`, () => `${open}${resolved}${close}`)
}

/* A self-contained script seeding the resume manifest with the blocking values, so
   client hydration adopts each resolved branch instead of re-running the promise.
   Empty when no blocking awaits settled. */
function resumeScript(resumed: Record<number, ResumeEntry>): string {
    if (Object.keys(resumed).length === 0) {
        return ''
    }
    const payload = JSON.stringify(resumed).replace(/</g, '\\u003c')
    return `<script>Object.assign(window.__abideResume=window.__abideResume||{},${payload})</script>`
}

type Settled = { id: number; html: string; resume: ResumeEntry }

/* Awaits one block's promise and renders the resolved or error branch to HTML,
   capturing the value (serializable) for the resume manifest. Errors serialize as
   their message — enough for the catch branch, without leaking a stack. */
function settle(block: SsrAwait): Promise<Settled> {
    return Promise.resolve(block.promise()).then(
        (value) => ({ id: block.id, html: block.then(value), resume: { ok: true, value } }),
        (error) => {
            /* No catch branch → surface the rejection (500 before the first flush,
               mid-stream error after) instead of swallowing it into an empty fragment. */
            if (block.catch === undefined) {
                throw error
            }
            return {
                id: block.id,
                html: block.catch(error),
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
