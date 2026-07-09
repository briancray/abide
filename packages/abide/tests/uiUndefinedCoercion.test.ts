import { beforeAll, describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { computed } from '../src/lib/ui/computed.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { attr } from '../src/lib/ui/dom/attr.ts'
import { each } from '../src/lib/ui/dom/each.ts'
import { text } from '../src/lib/ui/dom/text.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { createDoc as doc } from '../src/lib/ui/runtime/createDoc.ts'
import { state } from '../src/lib/ui/state.ts'
import { installMiniDom } from './support/installMiniDom.ts'

beforeAll(() => {
    installMiniDom()
})

const RUNTIME = {
    doc,
    state,
    computed,
    effect,
    text,
    appendText,
    appendStatic,
    attr,
    each,
}

/* Mount a component on the client, threading any extra runtime values (e.g. a shared
   `state`) in by name so a test can drive its source after mount. */
function render(source: string, extra: Record<string, unknown> = {}): HTMLElement {
    const names = [...Object.keys(RUNTIME), ...Object.keys(extra)]
    const host = document.createElement('div')
    const args = names.map((name) => extra[name] ?? RUNTIME[name as keyof typeof RUNTIME])
    new Function('host', ...names, compileComponent(source))(host, ...args)
    return host
}

/* Run the component's (synchronous) SSR render to its HTML string. */
function ssr(source: string): string {
    return (
        new Function('doc', 'state', 'computed', 'effect', compileSSR(source))(
            doc,
            state,
            computed,
            effect,
        ) as { html: string }
    ).html
}

/* First descendant element with the given tag (miniDom has no querySelector). */
type DomLike = {
    childNodes: ArrayLike<unknown>
    tagName?: string
    getAttribute?: (n: string) => string | null
}
function find(node: DomLike, tag: string): DomLike | undefined {
    for (let index = 0; index < node.childNodes.length; index += 1) {
        const child = node.childNodes[index] as DomLike
        if (child.tagName === tag.toUpperCase() || child.tagName === tag) {
            return child
        }
        const nested = find(child, tag)
        if (nested !== undefined) {
            return nested
        }
    }
    return undefined
}

const UNDEFINED_STATE = `<script>import { state } from '@abide/abide/ui/state'
let v = state(undefined)</script>`

/* ADR-0032 D3: a nullish read renders the natural empty state, never the literal
   `"undefined"` — so a pending async peek (undefined-while-pending) shows nothing. */
describe('undefined coercion — bare {v}', () => {
    test('client renders empty text, not "undefined"', () => {
        const host = render(`${UNDEFINED_STATE}<p>{v}</p>`)
        expect(host.textContent).toBe('')
    })

    test('SSR renders empty text, not "undefined"', () => {
        expect(ssr(`${UNDEFINED_STATE}<p>{v}</p>`)).toBe('<p></p>')
    })
})

describe('undefined coercion — interpolated attribute', () => {
    test('client renders `title="a  b"`, not `"a undefined b"`', () => {
        const host = render(`${UNDEFINED_STATE}<a title="a {v} b">x</a>`)
        const anchor = find(host, 'a')
        expect(anchor?.getAttribute?.('title')).toBe('a  b')
    })

    test('SSR renders `title="a  b"`, not `"a undefined b"`', () => {
        expect(ssr(`${UNDEFINED_STATE}<a title="a {v} b">x</a>`)).toBe('<a title="a  b">x</a>')
    })
})

describe('undefined coercion — whole-value attribute stays absent', () => {
    test('client: a whole-value undefined removes the attribute', () => {
        const host = render(`${UNDEFINED_STATE}<a title={v}>x</a>`)
        const anchor = find(host, 'a')
        expect(anchor?.getAttribute?.('title')).toBe(null)
    })

    test('SSR: a whole-value undefined emits no attribute', () => {
        expect(ssr(`${UNDEFINED_STATE}<a title={v}>x</a>`)).toBe('<a>x</a>')
    })
})
