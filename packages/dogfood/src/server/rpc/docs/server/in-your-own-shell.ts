import { GET, page, render } from 'abide/server'
import Report from '#shared/demos/fixtures/Report.abide'

/**
 * A document of this route's own, for the answer that is not one of the app's pages.
 *
 * A whole html file with a `<slot></slot>` in it — the same shape `app.html` is, through the same
 * `shell()`, so the caller owns `<html>`, `<head>` and `<body>`, and a file with nowhere to render is
 * refused by the call rather than on the first chunk. What is inside the slot is a placeholder: it is
 * legible when this file is opened on its own and the render replaces it.
 *
 * Which is the case a print stylesheet, a mailed receipt or an archived copy wants: the app's own
 * document brings the app's chrome with it, and none of that belongs in a page somebody prints.
 */
const RECEIPT = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>may — filed</title><link rel="stylesheet" media="print" href="/print.css"></head>
<body class="filed"><slot>nothing filed</slot></body>
</html>`

export const receipt = GET(() => page(render(Report(), { shell: RECEIPT })))
