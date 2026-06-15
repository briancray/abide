import type { SsrAwait, SsrRender } from './runtime/types/SsrRender.ts'

/*
Out-of-order SSR streaming. Yields the pending shell first (so the browser paints
immediately), then one resolved fragment per await block as its promise settles —
in completion order, not source order, so a slow read never blocks a fast one.
Each resolved fragment is a `<template data-belte-resolve="ID">…</template>` that
the client swaps into the matching `<!--belte:await:ID-->` boundary.

This is the await-block-streams half of the cache rule: a top-level `await` in the
script would have blocked the shell (inlined), but an await *block* flushes its
shell now and streams the value when ready. Driven by a plain `render()` result,
so it composes with any transport (HTTP chunked, a socket frame, a test).
*/
// @readme plumbing
export async function* renderToStream(render: () => SsrRender): AsyncGenerator<string> {
    const { html, awaits } = render()
    yield html
    const inflight = new Map<number, Promise<{ id: number; html: string }>>()
    for (const block of awaits) {
        inflight.set(block.id, settle(block))
    }
    while (inflight.size > 0) {
        const resolved = await Promise.race(inflight.values())
        inflight.delete(resolved.id)
        yield `<template data-belte-resolve="${resolved.id}">${resolved.html}</template>`
    }
}

/* Awaits one block's promise and renders the resolved or error branch to HTML. */
function settle(block: SsrAwait): Promise<{ id: number; html: string }> {
    return Promise.resolve(block.promise()).then(
        (value) => ({ id: block.id, html: block.then(value) }),
        (error) => ({ id: block.id, html: block.catch(error) }),
    )
}
