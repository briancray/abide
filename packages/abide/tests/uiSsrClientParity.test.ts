import { beforeAll, describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { computed } from '../src/lib/ui/computed.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { attr } from '../src/lib/ui/dom/attr.ts'
import { each } from '../src/lib/ui/dom/each.ts'
import { on } from '../src/lib/ui/dom/on.ts'
import { text } from '../src/lib/ui/dom/text.ts'
import { when } from '../src/lib/ui/dom/when.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { createDoc as doc } from '../src/lib/ui/runtime/createDoc.ts'
import { state } from '../src/lib/ui/state.ts'
import { installMiniDom } from './support/installMiniDom.ts'

beforeAll(() => {
    installMiniDom()
})

/*
The hydration-correctness guarantee: the server render-to-string and the client
DOM build must produce identical markup from the same component. Both run from
the shared front-end, so this proves the two code generators agree — the property
that lets the client adopt the server's HTML.
*/
describe('SSR ↔ client parity', () => {
    test('server HTML equals serialized client DOM for the same component', () => {
        const source = `
            <script>
                let count = scope().state(3)
                let items = scope().state(['x', 'y', 'z'])
                let label = scope().computed(() => 'count ' + count)
            </script>
            <div class="box">
                <h1>{label}</h1>
                <ul>
                    <template each={items} as="it" key="it">
                        <li>{it}</li>
                    </template>
                </ul>
                <template if={count}><p>has count</p></template>
            </div>
        `

        // server render
        const server = new Function('doc', 'state', 'computed', 'effect', compileSSR(source))(
            doc,
            state,
            computed,
            effect,
        ) as { html: string; state: unknown }

        // client render into the mini-DOM, then serialize
        const host = document.createElement('div')
        new Function(
            'host',
            'doc',
            'state',
            'computed',
            'text',
            'appendText',
            'appendStatic',
            'attr',
            'on',
            'each',
            'when',
            'effect',
            compileComponent(source),
        )(host, doc, state, computed, text, appendText, appendStatic, attr, on, each, when, effect)
        const clientHtml = (
            globalThis as unknown as { serializeMiniDom: (h: unknown) => string }
        ).serializeMiniDom(host)

        // control-flow content lives in `[ … ]` comment-marked ranges (per `each` row,
        // and around the `if`), emitted identically by both back-ends. In a skeleton each
        // block is positioned by an `<!--a-->` anchor (the `<ul>`'s each, the `if`).
        expect(server.html).toBe(
            '<div class="box"><h1>count 3</h1><ul><!--a--><!--[--><li>x</li><!--]--><!--[--><li>y</li><!--]--><!--[--><li>z</li><!--]--></ul><!--a--><!--[--><p>has count</p><!--]--></div>',
        )
        expect(clientHtml).toBe(server.html) // server and client agree
        expect(server.state).toEqual({ count: 3, items: ['x', 'y', 'z'] })
    })
})
