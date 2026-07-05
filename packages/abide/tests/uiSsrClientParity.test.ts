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
            <script>import { state } from '@abide/abide/ui/state'

                let count = state(3)
                let items = state(['x', 'y', 'z'])
                let label = state.computed(() => 'count ' + count)
            </script>
            <div class="box">
                <h1>{label}</h1>
                <ul>
                    {#for it of items by it}
                        <li>{it}</li>
                    {/for}
                </ul>
                {#if count}<p>has count</p>{/if}
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

    /* Server markup vs serialized client DOM for one component — the congruence the
       client's adopt-the-server-HTML hydration rests on. */
    function bothSides(source: string): { server: string; client: string } {
        const server = (
            new Function('doc', 'state', 'computed', 'effect', compileSSR(source))(
                doc,
                state,
                computed,
                effect,
            ) as { html: string }
        ).html
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
        const client = (
            globalThis as unknown as { serializeMiniDom: (h: unknown) => string }
        ).serializeMiniDom(host)
        return { server, client }
    }

    test('interpolated attribute renders congruently on both sides', () => {
        const { server, client } = bothSides(
            `<script>import { state } from '@abide/abide/ui/state'
let id = state(7)</script><a href="/u/{id}/profile">x</a>`,
        )
        expect(server).toBe('<a href="/u/7/profile">x</a>')
        expect(client).toBe(server)
    })

    test('interpolated class merged with a class: directive is congruent', () => {
        const { server, client } = bothSides(
            `<script>import { state } from '@abide/abide/ui/state'
let v = state('big')\nlet on = state(true)</script><div class="card {v}" class:active={on}>x</div>`,
        )
        expect(server).toBe('<div class="card big active">x</div>')
        expect(client).toBe(server)
    })

    test('interpolated style merged with a style: directive is congruent', () => {
        const { server, client } = bothSides(
            `<script>import { state } from '@abide/abide/ui/state'
let w = state('10px')\nlet c = state('red')</script><div style="width: {w}" style:color={c}>x</div>`,
        )
        expect(server).toBe('<div style="width: 10px;color:red">x</div>')
        expect(client).toBe(server)
    })
})
