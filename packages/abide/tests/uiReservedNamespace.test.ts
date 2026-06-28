import { beforeAll, describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { installMiniDom } from './support/installMiniDom.ts'

beforeAll(() => {
    installMiniDom()
})

/* Mounts a component on a fresh host. Crucially injects ONLY `host` — the real
   module's scope holds the `$$`-aliased helpers (from imports) and bare `scope`,
   never bare `each`/`on`/…; uiPreload publishes those as globals. So a user var
   named `each` is NOT a `new Function` param here either, exactly as in production —
   the whole point of the reserved namespace. */
function mount(source: string): {
    childNodes: { tagName?: string; textContent?: string }[]
    textContent: string
} {
    const host = document.createElement('div')
    new Function('host', compileComponent(source))(host)
    return host as never
}

/* The whole point of the `$$` reserved namespace: codegen never occupies a bare
   helper name, so an author may freely declare a variable named after one. */
describe('reserved $$ namespace frees helper names for user variables', () => {
    test('a user var named `each` coexists with a {#for} block', () => {
        const host = mount(
            `<script>const each = 'mine'</script><p>{each}</p>{#for n of [1, 2]}<i>{n}</i>{/for}`,
        )
        // the user's `each` renders, AND the {#for} (compiled to $$each) renders its rows
        expect(host.textContent).toContain('mine')
        expect(host.textContent).toContain('1')
        expect(host.textContent).toContain('2')
    })

    test('user vars named `on` and `attr` coexist with on:click and attr bindings', () => {
        const host = mount(
            `<script>const on = 'ON'; const attr = 'A'; let hits = scope().state(0)</script>` +
                `<button on:click={hits++} title={attr}>{on}-{hits}</button>`,
        )
        const button = host.childNodes[0] as {
            textContent?: string
            getAttribute?: (n: string) => string
        }
        // the user's `on`/`attr` strings render; the directives (compiled to $$on/$$attr) still wire
        expect(button.textContent).toContain('ON')
        expect(button.getAttribute?.('title')).toBe('A')
    })

    test('a user function named `effect` does not shadow the reactive effect helper', () => {
        const host = mount(
            `<script>function effect() { return 'fn' }\nlet c = scope().state(2)</script><p>{effect()}-{c}</p>`,
        )
        expect(host.textContent).toContain('fn-2')
    })

    test('a user var named `model` coexists with reactive state (the doc base is $$model)', () => {
        const host = mount(
            `<script>const model = 'mine'\nlet n = scope().state(7)</script><p>{model}-{n}</p>`,
        )
        expect(host.textContent).toContain('mine-7')
    })
})
