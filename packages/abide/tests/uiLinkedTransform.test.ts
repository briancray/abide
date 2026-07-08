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
                import { state } from '@abide/abide/ui/state'
                let count = state(0)
                let qty = state(1, (n) => Math.max(1, n))
                let source = state(10)
                const draft = state.linked(() => source)
                const doubled = state.computed(() => source * 2)
            </script>
            <p>{count}{qty}{draft}{doubled}</p>
        `)
        // plain state → serializable doc slot, no runtime state() call survives for it
        expect(body).toContain('$$model.replace("count", 0)')
        // transform state → scope cell, referenced as .value
        expect(body).toContain('const qty = $$scope().state(1, (n) => Math.max(1, n))')
        expect(body).toContain('qty.value')
        // linked → scope cell, seed thunk derefs the upstream slot, read through the unified cell read
        expect(body).toContain('const draft = $$scope().linked(() => $$model.read("source"))')
        expect(body).toContain('$$readCell(draft)')
        // computed (read-only) → computed doc slot via derive, referenced as its reader call
        expect(body).toContain(
            'const doubled = $$scope().derive("doubled", () => $$model.read("source") * 2)',
        )
        expect(body).toContain('doubled()')
    })

    test('SSR serializes only doc slots, not transform/linked cells', () => {
        const ssr = compileSSR(`
            <script>
                import { state } from '@abide/abide/ui/state'
                let source = state(10)
                let qty = state(1, (n) => Math.max(1, n))
                const draft = state.linked(() => source)
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
                import { state } from '@abide/abide/ui/state'
                let source = state('a')
                const draft = state.linked(() => source)
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
                import { state } from '@abide/abide/ui/state'
                let qty = state(5, (n) => Math.max(1, Math.min(99, n)))
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
The imported reactive surface: `import { state } from '@abide/abide/ui/state'` + bare
`state(...)` / `state.computed(...)` / `state.linked(...)`, plus `effect` imported from
`ui/effect`. Recognised by import-binding resolution and lowered onto the ambient scope
exactly as before. `scope()` is no longer an author reactive entry — the legacy
`scope().state(...)`, captured-handle `c.state(...)`, and `const {…} = scope()` destructure
forms are withdrawn (see `importedReactiveSurface.test.ts` for the full surface).
*/
describe('imported reactive surface — inline lowering', () => {
    test('inline state/state.computed lower to the doc forms', () => {
        const body = compileComponent(`
            <script>
                import { state } from '@abide/abide/ui/state'
                const count = state(0)
                const doubled = state.computed(() => count * 2)
            </script>
            <p>{count}{doubled}</p>
        `)
        expect(body).toContain('$$model.replace("count", 0)') // plain state → doc slot
        expect(body).toContain('$$scope().derive("doubled"') // computed → read-only derive slot
        expect(body).toContain('doubled()') // computed referenced as its reader
    })

    test('a bare reactive call is the surface now — it lowers, not throws', () => {
        // bare `state(0)` is the imported surface; it lowers to a serializable slot
        expect(() =>
            compileComponent(
                `<script>import { state } from '@abide/abide/ui/state'\nconst x = state(0)</script><p>{x}</p>`,
            ),
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

    test('an imported effect passes through to the runtime effect and lowers its reads', () => {
        const body = compileComponent(`
            <script>
                import { state } from '@abide/abide/ui/state'
                import { effect } from '@abide/abide/ui/effect'
                const count = state(0)
                effect(() => console.log(count))
            </script>
            <p>{count}</p>
        `)
        expect(body).toContain('effect(') // the reaction stays a runtime call
        expect(body).toContain('$$model.read("count")') // its reads lower like any other
    })
})
