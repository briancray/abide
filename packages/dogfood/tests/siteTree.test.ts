// 40.44 — A DIRECTORY OF THE CRM AS ITS ADDRESSES, painted where the page renders: the listing answers
// at once, so a lone request's document holds it, a handler at its address and called by its verb.

import { expect, test } from 'bun:test'

import { servedDocs } from './docsPages.ts'

// THE REVERT: make `filesUnder` wait on its links again (the HEAD per page it answered after); a lone
// request renders no table, `false` where `true` is due. And read the verb off `export default GET(`
// as it was; savePhone is listed as `GET`.
test('a lone request renders the directory, each handler at its address by its verb — 40.44', async () => {
    const { base } = await servedDocs()
    const html = await (await fetch(`${base}/pages`)).text()
    expect(html.includes('class="site-tree"')).toBe(true)
    // A handler is listed by its verb, at an address with no `.server.ts` in it.
    expect(html).toMatch(/savePhone\.server\.ts<\/code><\/td>\s*<td>POST<\/td>/)
    expect(html).not.toMatch(/<code>\/[\w/]+\.server\.ts<\/code>/)
}, 60_000)
