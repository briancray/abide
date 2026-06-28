import { describe, expect, test } from 'bun:test'
import { rawHtmlString } from '../src/lib/shared/html.ts'
import { html } from '../src/lib/ui/html.ts'

/* `html` is author-facing UI vocabulary, so it lives at `abide/ui/html`; the
   internal reader (`rawHtmlString` + the registered brand) stays isomorphic
   plumbing in `shared/html`. The split must preserve the brand across the two
   modules — they share the one `Symbol.for('abide.rawHtml')`. */
describe('html relocation: ui/html call + shared/html reader', () => {
    test('a ui/html brand is read by the shared/html reader (plain + tagged)', () => {
        expect(rawHtmlString(html('<b>x</b>'))).toBe('<b>x</b>')
        expect(rawHtmlString(html`<i>${'y'}</i>`)).toBe('<i>y</i>')
    })

    test('a plain string is not branded', () => {
        expect(rawHtmlString('<b>x</b>')).toBeUndefined()
    })
})
