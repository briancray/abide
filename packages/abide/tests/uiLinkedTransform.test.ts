import { beforeAll, describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { derived } from '../src/lib/ui/derived.ts'
import { doc } from '../src/lib/ui/doc.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { attr } from '../src/lib/ui/dom/attr.ts'
import { on } from '../src/lib/ui/dom/on.ts'
import { openChild } from '../src/lib/ui/dom/openChild.ts'
import { openRoot } from '../src/lib/ui/dom/openRoot.ts'
import { text } from '../src/lib/ui/dom/text.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { linked } from '../src/lib/ui/linked.ts'
import { state } from '../src/lib/ui/state.ts'
import { installMiniDom } from './support/installMiniDom.ts'

beforeAll(() => {
    installMiniDom()
})

/* Mounts a compiled client body, returning the host and the component's `model`
   doc (declared from the plain `state(...)` slots). */
function mountClient(source: string): { host: HTMLElement; model: ReturnType<typeof doc> } {
    const host = document.createElement('div')
    const model = new Function(
        'host',
        'doc',
        'state',
        'linked',
        'derived',
        'text',
        'openChild',
        'openRoot',
        'appendText',
        'appendStatic',
        'attr',
        'on',
        'effect',
        `${compileComponent(source)}\nreturn typeof model !== 'undefined' ? model : undefined;`,
    )(
        host,
        doc,
        state,
        linked,
        derived,
        text,
        openChild,
        openRoot,
        appendText,
        appendStatic,
        attr,
        on,
        effect,
    ) as ReturnType<typeof doc>
    return { host, model }
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

describe('desugar — state(transform) / linked / derived lens', () => {
    test('plain state is a doc slot; transform/linked/lens stay runtime .value cells', () => {
        const body = compileComponent(`
            <script>
                let count = state(0)
                let qty = state(1, (n) => Math.max(1, n))
                let source = state(10)
                const draft = linked(() => source)
                const doubled = derived(() => source * 2, (v) => { source = v / 2 })
            </script>
            <p>{count}{qty}{draft}{doubled}</p>
        `)
        // plain state → serializable doc slot, no runtime state() call survives for it
        expect(body).toContain('model.replace("count", 0)')
        // transform state → runtime call kept, referenced as .value
        expect(body).toContain('let qty = state(1, (n) => Math.max(1, n))')
        expect(body).toContain('qty.value')
        // linked → runtime call kept, seed thunk derefs the upstream slot, ref as .value
        expect(body).toContain('const draft = linked(() => model.read("source"))')
        expect(body).toContain('draft.value')
        // derived lens → both args kept, set writes through to the upstream slot
        expect(body).toContain('const doubled = derived(() => model.read("source") * 2,')
        expect(body).toContain('model.replace("source", v / 2)')
    })

    test('SSR serializes only doc slots, not transform/linked cells', () => {
        const ssr = compileSSR(`
            <script>
                let source = state(10)
                let qty = state(1, (n) => Math.max(1, n))
                const draft = linked(() => source)
            </script>
            <p>{qty}{draft}{source}</p>
        `)
        // the snapshot is the doc model — transform/linked are re-derived on resume
        expect(ssr).toContain('model.snapshot()')
        expect(ssr).toContain('model.replace("source", 10)')
        expect(ssr).toContain('let qty = state(1,')
        expect(ssr).toContain('const draft = linked(')
    })
})

describe('runtime behavior in a compiled component', () => {
    test('linked reflects upstream changes through the doc', () => {
        const { host, model } = mountClient(`
            <script>
                let source = state('a')
                const draft = linked(() => source)
            </script>
            <p>{draft}</p>
        `)
        expect(host.textContent).toContain('a') // seeded from upstream
        model.replace('source', 'b') // upstream change reseeds the draft
        expect(host.textContent).toContain('b')
    })

    test('a bound input writes through state(transform), clamping the value', () => {
        const { host } = mountClient(`
            <script>
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
