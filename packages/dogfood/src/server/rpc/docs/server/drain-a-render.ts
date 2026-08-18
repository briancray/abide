import { html } from 'abide'
import { GET, page, render } from 'abide/server'

/**
 * The whole of `render`: a walk over a `Renderable`, handed back as an async generator of HTML.
 *
 * Nothing about it is a page — it takes what a `.abide` file compiles to (`Report()` here would be
 * the same call) and produces markup, so a route that wants a string DRAINS it, which is what the
 * loop below is. The walk is synchronous inside: a tree with nothing to wait for writes into a
 * buffer and this loop takes one chunk.
 */
export const overview = GET(async () => {
    let markup = ''
    for await (const chunk of render(html`<h1>may</h1><p>41 open · 7 closed</p>`)) markup += chunk
    return page(markup)
})
