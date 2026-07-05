import { beforeAll, describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { computed } from '../src/lib/ui/computed.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { attr } from '../src/lib/ui/dom/attr.ts'
import { on } from '../src/lib/ui/dom/on.ts'
import { text } from '../src/lib/ui/dom/text.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { linked } from '../src/lib/ui/linked.ts'
import { createDoc as doc } from '../src/lib/ui/runtime/createDoc.ts'
import { state } from '../src/lib/ui/state.ts'
import { installMiniDom } from './support/installMiniDom.ts'

beforeAll(() => {
    installMiniDom()
})

/* Mounts a compiled client body, returning the host and the component's `$$model`
   doc (declared from the plain `state(...)` slots). */
function mountClient(source: string): { host: HTMLElement; $$model: ReturnType<typeof doc> } {
    const host = document.createElement('div')
    const $$model = new Function(
        'host',
        'doc',
        'state',
        'linked',
        'computed',
        'text',
        'appendText',
        'appendStatic',
        'attr',
        'on',
        'effect',
        `${compileComponent(source)}\nreturn typeof $$model !== 'undefined' ? $$model : undefined;`,
    )(
        host,
        doc,
        state,
        linked,
        computed,
        text,
        appendText,
        appendStatic,
        attr,
        on,
        effect,
    ) as ReturnType<typeof doc>
    return { host, $$model }
}

/* The mini-DOM has no querySelector; find the first <input> by walking. */
function firstInput(node: HTMLElement): HTMLInputElement | undefined {
    for (const child of (node as unknown as { childNodes: HTMLElement[] }).childNodes ?? []) {
        if ((child as unknown as { tagName?: string }).tagName === 'input') {
            return child as unknown as HTMLInputElement
        }
        const nested = firstInput(child)
        if (nested !== undefined) {
            return nested
        }
    }
    return undefined
}

describe('desugar — state(transform) / linked cells; computed doc slot', () => {
    test('plain state + computed are doc slots; transform/linked stay runtime .value cells', () => {
        const body = compileComponent(`
            <script>
                let count = scope().state(0)
                let qty = scope().state(1, (n) => Math.max(1, n))
                let source = scope().state(10)
                const draft = scope().linked(() => source)
                const doubled = scope().computed(() => source * 2)
            </script>
            <p>{count}{qty}{draft}{doubled}</p>
        `)
        // plain state → serializable doc slot, no runtime state() call survives for it
        expect(body).toContain('$$model.replace("count", 0)')
        // transform state → scope cell, referenced as .value
        expect(body).toContain('const qty = $$scope().state(1, (n) => Math.max(1, n))')
        expect(body).toContain('qty.value')
        // linked → scope cell, seed thunk derefs the upstream slot, ref as .value
        expect(body).toContain('const draft = $$scope().linked(() => $$model.read("source"))')
        expect(body).toContain('draft.value')
        // computed (read-only) → computed doc slot via derive, referenced as its reader call
        expect(body).toContain(
            'const doubled = $$scope().derive("doubled", () => $$model.read("source") * 2)',
        )
        expect(body).toContain('doubled()')
    })

    test('SSR serializes only doc slots, not transform/linked cells', () => {
        const ssr = compileSSR(`
            <script>
                let source = scope().state(10)
                let qty = scope().state(1, (n) => Math.max(1, n))
                const draft = scope().linked(() => source)
            </script>
            <p>{qty}{draft}{source}</p>
        `)
        // the snapshot is the doc $$model — transform/linked are re-computed on resume
        expect(ssr).toContain('$$model.snapshot()')
        expect(ssr).toContain('$$model.replace("source", 10)')
        expect(ssr).toContain('const qty = $$scope().state(1,')
        expect(ssr).toContain('const draft = $$scope().linked(')
    })
})

describe('runtime behavior in a compiled component', () => {
    test('linked reflects upstream changes through the doc', () => {
        const { host, $$model } = mountClient(`
            <script>
                let source = scope().state('a')
                const draft = scope().linked(() => source)
            </script>
            <p>{draft}</p>
        `)
        expect(host.textContent).toContain('a') // seeded from upstream
        $$model.replace('source', 'b') // upstream change reseeds the draft
        expect(host.textContent).toContain('b')
    })

    test('a bound input writes through state(transform), clamping the value', () => {
        const { host } = mountClient(`
            <script>
                let qty = scope().state(5, (n) => Math.max(1, Math.min(99, n)))
            </script>
            <input bind:value={qty} />
            <p>{qty}</p>
        `)
        const input = firstInput(host) as HTMLInputElement & {
            dispatchEvent: (e: { type: string }) => void
        }
        input.value = '1000'
        input.dispatchEvent({ type: 'input' })
        expect(host.textContent).toContain('99') // clamped on write
    })
})

/*
The explicit scope authoring surface: `scope().state(...)` inline, or a captured handle
`const c = scope(); c.state(...)`. Receiver-agnostic — the method name marks the binding
reactive, and since `scope()` is the ambient scope (one object per level) the explicit
form lowers exactly like the bare form. A bare call is a compile error.
*/
describe('explicit scope().X authoring surface', () => {
    test('inline scope().state/.computed lower to the doc forms', () => {
        const body = compileComponent(`
            <script>
                const count = scope().state(0)
                const doubled = scope().computed(() => count * 2)
            </script>
            <p>{count}{doubled}</p>
        `)
        expect(body).toContain('$$model.replace("count", 0)') // plain state → doc slot
        expect(body).toContain('$$scope().derive("doubled"') // computed → read-only derive slot
        expect(body).toContain('doubled()') // computed referenced as its reader
    })

    test('a captured handle (const c = scope(); c.state(...)) lowers identically', () => {
        const body = compileComponent(`
            <script>
                const c = scope()
                const count = c.state(0)
                const qty = c.state(1, (n) => Math.max(1, n))
                const draft = c.linked(() => count)
                const total = c.computed(() => count + 1)
            </script>
            <p>{count}{qty}{draft}{total}</p>
        `)
        expect(body).toContain('$$model.replace("count", 0)') // plain state → doc slot
        expect(body).toContain('const qty = $$scope().state(1, (n) => Math.max(1, n))')
        expect(body).toContain('qty.value')
        expect(body).toContain('const draft = $$scope().linked(() => $$model.read("count"))')
        expect(body).toContain('$$scope().derive("total"')
        expect(body).toContain('total()')
    })

    test('destructured scope primitives lower identically to the call form', () => {
        const body = compileComponent(`
            <script>
                const { state, computed, linked } = scope()
                const count = state(0)
                const qty = state(1, (n) => Math.max(1, n))
                const draft = linked(() => count)
                const total = computed(() => count + 1)
            </script>
            <p>{count}{qty}{draft}{total}</p>
        `)
        expect(body).toContain('$$model.replace("count", 0)') // plain state → doc slot
        expect(body).toContain('const qty = $$scope().state(1, (n) => Math.max(1, n))')
        expect(body).toContain('qty.value')
        expect(body).toContain('const draft = $$scope().linked(() => $$model.read("count"))')
        expect(body).toContain('$$scope().derive("total"')
        expect(body).toContain('total()')
    })

    test('a bare reactive call is the surface now — it lowers, not throws', () => {
        // bare `state(0)` is the imported surface; it lowers to a serializable slot
        expect(() =>
            compileComponent(`<script>const x = state(0)</script><p>{x}</p>`),
        ).not.toThrow()
        // the withdrawn `prop(...)` reader still throws with migration guidance
        expect(() => compileComponent(`<script>const id = prop('id')</script><p>{id}</p>`)).toThrow(
            /`prop\(\.\.\.\)` has been removed/,
        )
        // `props()` destructure stays the prop-reading surface
        expect(() =>
            compileComponent(`<script>const { id } = props()</script><p>{id}</p>`),
        ).not.toThrow()
    })

    test('scope().effect passes through to the runtime effect and lowers its reads', () => {
        const body = compileComponent(`
            <script>
                const count = scope().state(0)
                scope().effect(() => console.log(count))
            </script>
            <p>{count}</p>
        `)
        expect(body).toContain('$$scope().effect(') // the reaction stays a runtime call
        expect(body).toContain('$$model.read("count")') // its reads lower like any other
    })

    test('a destructured effect used bare does not trip the scope() guard', () => {
        expect(() =>
            compileComponent(
                `<script>const { effect } = scope()\neffect(() => {})</script><p>x</p>`,
            ),
        ).not.toThrow()
    })

    /* A primitive destructured from scope() at the top still lowers (legacy compat); a
       bare `state(0)` now lowers too (the imported surface), both to the same slot. */
    test('a destructured primitive used bare lowers like the bare surface', () => {
        const destructured = compileComponent(
            `<script>const { state } = scope()\nconst x = state(0)</script><p>{x}</p>`,
        )
        const bare = compileComponent(`<script>const x = state(0)</script><p>{x}</p>`)
        expect(destructured).toContain('$$model.replace("x", 0)')
        expect(bare).toContain('$$model.replace("x", 0)')
    })
})
