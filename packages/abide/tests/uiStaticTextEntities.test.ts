import { beforeAll, describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { decodeHtmlEntities } from '../src/lib/ui/compile/decodeHtmlEntities.ts'
import { derived } from '../src/lib/ui/derived.ts'
import { doc } from '../src/lib/ui/doc.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { attr } from '../src/lib/ui/dom/attr.ts'
import { each } from '../src/lib/ui/dom/each.ts'
import { on } from '../src/lib/ui/dom/on.ts'
import { openChild } from '../src/lib/ui/dom/openChild.ts'
import { openRoot } from '../src/lib/ui/dom/openRoot.ts'
import { text } from '../src/lib/ui/dom/text.ts'
import { when } from '../src/lib/ui/dom/when.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { state } from '../src/lib/ui/state.ts'
import { installMiniDom } from './support/installMiniDom.ts'

beforeAll(() => {
    installMiniDom()
})

/*
A template author writes HTML entities in static text to show literal markup —
`<code>&lt;script&gt;</code>`. SSR pushes that into the HTML stream where the
browser decodes it to `<script>`; the client must build a text node showing the
same glyphs, not the literal `&lt;script&gt;`. The decoder runs at parse time so
both render paths share one decoded value, and SSR re-escapes it.
*/
describe('static text HTML entities', () => {
    test('decodeHtmlEntities resolves named and numeric references', () => {
        expect(decodeHtmlEntities('&lt;script&gt; &amp; &#39;x&#x2014;y')).toBe("<script> & 'x—y")
        expect(decodeHtmlEntities('no entities here')).toBe('no entities here')
        expect(decodeHtmlEntities('&unknownentity;')).toBe('&unknownentity;') // left intact
    })

    test('SSR and client render entity text to the same decoded glyphs', () => {
        const source = `<p>shows a <code>&lt;script&gt;</code> &amp; <code>&lt;style&gt;</code></p>`

        const server = new Function('doc', 'state', 'derived', 'effect', compileSSR(source))(
            doc,
            state,
            derived,
            effect,
        ) as { html: string }

        const host = document.createElement('div')
        new Function(
            'host',
            'doc',
            'state',
            'derived',
            'text',
            'openChild',
            'openRoot',
            'appendText',
            'appendStatic',
            'attr',
            'on',
            'each',
            'when',
            'effect',
            compileComponent(source),
        )(
            host,
            doc,
            state,
            derived,
            text,
            openChild,
            openRoot,
            appendText,
            appendStatic,
            attr,
            on,
            each,
            when,
            effect,
        )
        const clientHtml = (
            globalThis as unknown as { serializeMiniDom: (h: unknown) => string }
        ).serializeMiniDom(host)

        // the entity round-trips through the HTML stream — never double-escaped
        expect(server.html).toBe(
            '<p>shows a <code>&lt;script&gt;</code> &amp; <code>&lt;style&gt;</code></p>',
        )
        expect(clientHtml).toBe(server.html) // server and client agree
    })
})
