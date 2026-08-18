import { html, type TemplateResult } from 'abide'
import { GET, page, render } from 'abide/server'

/** A slot that produces over time, so the walk has something to wait FOR. */
async function* lines(): AsyncGenerator<TemplateResult> {
    for (const line of ['41 open', '7 closed', '3 waiting']) {
        await Bun.sleep(200)
        yield html`<li>${line}</li>`
    }
}

/**
 * The same walk, NOT drained: the generator is the body, so each chunk leaves as it is written.
 *
 * A chunk boundary is a SUSPENSION rather than a string segment — the walk hands over what it has
 * whenever it is about to wait — so the heading and the open tag go out before the first row exists
 * and each row follows on its own. Document order is kept either way: `render` has nowhere to patch,
 * so a region that waits holds the walk. Out-of-order arrival is `renderDocument`'s, which is what
 * `abide start` serves a page through.
 */
export const report = GET(() => page(render(html`<h1>may</h1><ul>${lines()}</ul>`)))
