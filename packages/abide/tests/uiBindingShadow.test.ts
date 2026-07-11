import { beforeAll, describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { computed } from '../src/lib/ui/computed.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { attr } from '../src/lib/ui/dom/attr.ts'
import { each } from '../src/lib/ui/dom/each.ts'
import { on } from '../src/lib/ui/dom/on.ts'
import { when } from '../src/lib/ui/dom/when.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { createDoc as doc } from '../src/lib/ui/runtime/createDoc.ts'
import type { SsrRender } from '../src/lib/ui/runtime/types/SsrRender.ts'
import { state } from '../src/lib/ui/state.ts'
import { installMiniDom } from './support/installMiniDom.ts'
import { text } from './support/reactiveText.ts'

beforeAll(() => {
    installMiniDom()
})

/*
The same-name-shadow sentinel for the single-source binding model (ADR-0013, phase 2):
every block value param — a keyed `each` item, an `await` `then` value, a `snippet` arg —
is bound under a COLLIDING name with an enclosing `state` of the SAME name. The
binding must read the LOCAL value (the loop item / resolved value / call argument), NOT the
shadowed component signal, on BOTH back-ends — and the server markup must equal the
serialized client DOM (the congruence hydration rests on). If a back-end ever registered the
name under the wrong kind (or not at all), the reference would lower to `model.read(name)`
and read the outer signal — the `block-binding-shadow` bug. With bindings flowing through one
`plan.bindings` + `withBindings` path, that drift is designed out; this corpus LOCKS it.
*/

/* Server markup + serialized client DOM for one sync component (no streaming awaits). */
function bothSides(source: string): { server: string; client: string } {
    const server = (
        new Function('doc', 'state', 'computed', 'effect', compileSSR(source))(
            doc,
            state,
            computed,
            effect,
        ) as SsrRender
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
        globalThis as unknown as { serializeMiniDom: (host: unknown) => string }
    ).serializeMiniDom(host)
    return { server, client }
}

/* The visible text of a rendered markup string, comment markers and tags stripped. */
const visibleText = (markup: string): string =>
    markup
        .replace(/<!--.*?-->/g, '')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim()

describe('binding shadow sentinel — block value params shadow an enclosing signal', () => {
    /* A keyed `each` whose item `as={row}` collides with a component `state` named
       `row`. The row must read the loop item; the outer `row` signal ('OUTER') must not leak. */
    test('keyed each item reads the loop value, not the shadowed component signal', () => {
        const source = `
            <script>import { state } from '@abide/abide/ui/state'

                let row = state('OUTER')
                let rows = state(['a', 'b', 'c'])
            </script>
            <ul>{#for row of rows by row}<li>{row}</li>{/for}</ul>
        `
        const { server, client } = bothSides(source)
        // adjacent <li> rows concatenate with no whitespace between them
        expect(visibleText(server)).toBe('abc')
        expect(visibleText(server)).not.toContain('OUTER')
        expect(client).toBe(server)
    })

    /* Sibling-adjacent: the shadowing each sits directly beside a sibling that reads the SAME
       name OUTSIDE the loop — the sibling must read the component signal ('OUTER'), the loop
       its items. A shadow that leaked past the block (or never popped) would corrupt the
       sibling; one that never registered would corrupt the loop. */
    test('sibling-adjacent: the loop shadows its name, the sibling keeps the outer signal', () => {
        const source = `
            <script>import { state } from '@abide/abide/ui/state'

                let row = state('OUTER')
                let rows = state(['a', 'b'])
            </script>
            <main><ul>{#for row of rows by row}<li>{row}</li>{/for}</ul><footer>{row}</footer></main>
        `
        const { server, client } = bothSides(source)
        // loop rows read the locals (adjacent, no whitespace); the trailing footer reads the
        // outer signal — proof the shadow covered the loop and popped before the sibling.
        expect(visibleText(server)).toBe('abOUTER')
        expect(client).toBe(server)
    })

    /* A `snippet` arg `args={label}` collides with a component `state` named `label`.
       The body must read the call argument, not the outer signal. */
    test('snippet arg reads the call argument, not the shadowed component signal', () => {
        const source = `
            <script>import { state } from '@abide/abide/ui/state'

                let label = state('OUTER')
            </script>
            {#snippet tag(label)}<span>{label}</span>{/snippet}
            <div>{tag('LOCAL')}</div>
        `
        const { server, client } = bothSides(source)
        expect(visibleText(server)).toBe('LOCAL')
        expect(visibleText(server)).not.toContain('OUTER')
        expect(client).toBe(server)
    })

    /* Block-shadows-block (not block-shadows-signal): a nested `each` whose item reuses the
       OUTER loop's binding name. The inner row must read the INNER item; the outer row content
       outside the inner loop must read the OUTER item; neither reads the component signal. A
       shadow that leaked past the inner loop would corrupt the rest of the outer row; one that
       never registered would read the outer item (or the signal) inside the inner loop. */
    test('nested each: inner item shadows the outer item of the same name, both read locals', () => {
        const source = `
            <script>import { state } from '@abide/abide/ui/state'

                let row = state('OUTER')
                let outer = state(['A', 'B'])
                let inner = state(['1', '2'])
            </script>
            <ul>{#for row of outer by row}<li>{row}{#for row of inner by row}<i>{row}</i>{/for}</li>{/for}</ul>
        `
        const { server, client } = bothSides(source)
        // outer row 'A' then its inner rows '12', outer row 'B' then '12' — no whitespace,
        // no 'OUTER' (the shadowed component signal never leaks into either loop).
        expect(visibleText(server)).toBe('A12B12')
        expect(visibleText(server)).not.toContain('OUTER')
        expect(client).toBe(server)
    })

    /* Cross-construct collision: an `each` row item and a `snippet` arg share a name, and a
       component `state` of the same name encloses both. The snippet body must read its
       call argument; the loop must read its item; the outer signal must surface nowhere — the
       row passes its item INTO the snippet, so a leaked shadow would cross the call boundary. */
    test('each item and snippet arg collide on one name; each reads its own local', () => {
        const source = `
            <script>import { state } from '@abide/abide/ui/state'
let item = state('OUTER')</script>
            {#snippet tag(item)}<b>{item}</b>{/snippet}
            <ul>{#for item of ['x', 'y'] by item}<li>{tag(item)}</li>{/for}</ul>
        `
        const { server, client } = bothSides(source)
        // the loop hands each item to the snippet, which renders it — 'xy', never 'OUTER'.
        expect(visibleText(server)).toBe('xy')
        expect(visibleText(server)).not.toContain('OUTER')
        expect(client).toBe(server)
    })

    /* A blocking `await … then v` whose `v` collides with a component `state` named
       `v`. SSR awaits inline and renders the resolved value; the resolved branch must read the
       local, not the outer signal. (Blocking SSR render is async — await the render.) */
    test('await then value reads the resolved value, not the shadowed component signal', async () => {
        const source = `
            <script>import { state } from '@abide/abide/ui/state'

                let v = state('OUTER')
            </script>
            <div>{#await Promise.resolve('LOCAL') then v}<span>{v}</span>{/await}</div>
        `
        const render = new Function(
            '$props',
            '$ctx',
            'doc',
            'state',
            'computed',
            'effect',
            compileSSR(source),
        )(undefined, new Map(), doc, state, computed, effect) as SsrRender | Promise<SsrRender>
        const server = (await render).html
        expect(visibleText(server)).toBe('LOCAL')
        expect(visibleText(server)).not.toContain('OUTER')
    })

    /* The classification is single-source: BOTH back-ends must lower the shadowed name to the
       LOCAL read (the bare loop var / resolved local / call arg), never `model.read(name)`. A
       direct codegen assertion — the seam where a wrong-kind registration would surface. */
    test('both back-ends lower a shadowed binding to the local, never the component signal', () => {
        const each = `
            <script>import { state } from '@abide/abide/ui/state'
let row = state('OUTER')\nlet rows = state(['a'])</script>
            <ul>{#for row of rows by row}<li>{row}</li>{/for}</ul>
        `
        const eachBuild = compileComponent(each)
        const eachSsr = compileSSR(each)
        // client reads the item cell (`row.value`), SSR the loop local (`$text(row)`); neither
        // reads the component signal for the shadowed name.
        expect(eachBuild).toContain('row.value')
        expect(eachBuild).not.toContain('$$model.read("row")')
        expect(eachSsr).toContain('$text(row)')
        expect(eachSsr).not.toContain('$$model.read("row")')

        const snippet = `
            <script>import { state } from '@abide/abide/ui/state'
let label = state('OUTER')</script>
            {#snippet tag(label)}<span>{label}</span>{/snippet}<div>{tag('x')}</div>
        `
        // a snippet arg is a plain local on both sides — read bare, not via the signal.
        expect(compileComponent(snippet)).not.toContain('$$model.read("label")')
        expect(compileSSR(snippet)).not.toContain('$$model.read("label")')
    })
})
