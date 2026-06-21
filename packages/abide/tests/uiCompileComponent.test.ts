import { beforeAll, describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileModule } from '../src/lib/ui/compile/compileModule.ts'
import { createScope } from '../src/lib/ui/createScope.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { attr } from '../src/lib/ui/dom/attr.ts'
import { each } from '../src/lib/ui/dom/each.ts'
import { mount } from '../src/lib/ui/dom/mount.ts'
import { on } from '../src/lib/ui/dom/on.ts'
import { text } from '../src/lib/ui/dom/text.ts'
import { when } from '../src/lib/ui/dom/when.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { escapeKey } from '../src/lib/ui/runtime/escapeKey.ts'
import { scope } from '../src/lib/ui/scope.ts'
import type { Scope } from '../src/lib/ui/types/Scope.ts'
import { installMiniDom } from './support/installMiniDom.ts'

beforeAll(() => {
    installMiniDom()
})

/* Runs a compiled component body against a fresh host, under `mount` so the body's
   `const model = scope()` resolves to its own per-mount scope (isolated per render). */
function render(source: string): HTMLElement {
    const body = compileComponent(source)
    const host = document.createElement('div')
    mount(host, (target) => {
        new Function(
            'host',
            'scope',
            'text',
            'appendText',
            'appendStatic',
            'attr',
            'on',
            'each',
            'when',
            'effect',
            body,
        )(target, scope, text, appendText, appendStatic, attr, on, each, when, effect)
    })
    return host
}

/* Mounts a body that reads an externally-driven `model` (a scope, which mirrors the
   document data interface), returning the scope so the test can mutate it. */
function renderWithModel(source: string, initial: unknown): { host: HTMLElement; model: Scope } {
    const body = compileComponent(source)
    const host = document.createElement('div')
    const model = createScope(initial)
    new Function(
        'host',
        'text',
        'appendText',
        'appendStatic',
        'attr',
        'on',
        'each',
        'when',
        'effect',
        'escapeKey',
        'model',
        body,
    )(host, text, appendText, appendStatic, attr, on, each, when, effect, escapeKey, model)
    return { host, model }
}

describe('compileComponent — end to end', () => {
    test('renders interpolated text from state', () => {
        const host = render(`
            <script>
                let name = scope().state('ada')
            </script>
            <p>Hello {name}</p>
        `)
        expect(host.textContent).toContain('Hello ada')
    })

    test('html comments are dropped, leaving no node in the output', () => {
        const host = render(`
            <!-- leading comment -->
            <p>visible<!-- inline --> text</p>
            <!-- trailing comment -->
        `)
        expect(host.textContent).toContain('visible')
        expect(host.textContent).toContain('text')
        expect(host.textContent).not.toContain('comment')
        expect(host.textContent).not.toContain('inline')
    })

    test('a counter button updates reactively through the lowered patch', () => {
        const host = render(`
            <script>
                let count = scope().state(0)
                function increment() { count += 1 }
            </script>
            <button onclick={increment}>+</button>
            <p>Count: {count}</p>
        `)
        expect(host.textContent).toContain('Count: 0')
        const button = Array.from(host.childNodes).find(
            (node) => (node as { tagName?: string }).tagName === 'button',
        ) as unknown as { dispatchEvent: (event: { type: string }) => void }
        button.dispatchEvent({ type: 'click' })
        button.dispatchEvent({ type: 'click' })
        expect(host.textContent).toContain('Count: 2')
    })

    test('compiled output uses hoisted cells for the template read', () => {
        const body = compileComponent(`
            <script>let count = scope().state(0)</script>
            <p>{count}</p>
        `)
        expect(body).toContain('model.cell("count")')
        expect(body).toContain('.get()')
    })

    test('if control flow toggles a branch and stays field-reactive', () => {
        const { host, model } = renderWithModel(
            `
            <div>
                <template if={model.show}>
                    <span>{model.label}</span>
                </template>
            </div>
        `,
            { show: true, label: 'hi' },
        )
        const div = host.childNodes[0] as unknown as { textContent: string }
        expect(div.textContent).toBe('hi')
        model.replace('label', 'yo') // field-reactive while shown
        expect(div.textContent).toBe('yo')
        model.replace('show', false) // falsy edge → branch removed
        expect(div.textContent).toBe('')
        model.replace('show', true) // truthy edge → branch re-rendered
        expect(div.textContent).toBe('yo')
    })

    test('compileModule emits a mountable ES module with abide/ui imports', () => {
        const module = compileModule(`
            <script>let count = scope().state(0)</script>
            <p>{count}</p>
        `)
        expect(module).toContain("import { mount } from '@abide/abide/ui/dom/mount'")
        expect(module).toContain("import { scope } from '@abide/abide/ui/scope'")
        expect(module).toContain('export default function component(host, $props)')
        expect(module).toContain('mount(host, (host) =>')
        expect(module).toContain('model.cell("count")')
    })

    test('keyed each renders a list and stays field-reactive', () => {
        const { host, model } = renderWithModel(
            `
            <ul>
                <template each={model.order} as="key" key="key">
                    <li>{model.byId[key].n}</li>
                </template>
            </ul>
        `,
            { order: ['a', 'b'], byId: { a: { n: 1 }, b: { n: 2 } } },
        )
        const list = host.childNodes[0] as unknown as { children: Element[] }
        expect(list.children.map((child) => child.textContent)).toEqual(['1', '2'])
        model.replace('byId/a/n', 9)
        expect(list.children[0].textContent).toBe('9')
        model.add('order/-', 'c')
        model.replace('byId/c', { n: 3 })
        expect(list.children.map((child) => child.textContent)).toEqual(['9', '2', '3'])
    })

    /* A component has no directives — every attribute is a prop under its written
       name, so `on*`/`bind:`/`attach` pass through to `mountChild` instead of
       being dropped (they'd be DOM directives only on a lowercase element). */
    test('component attributes pass through as props, including on*/bind/attach', () => {
        const body = compileComponent(`
            <Button label="Save" onclick={handleClick} bind:open={state.open} attach={register}>
                go
            </Button>
        `)
        expect(body).toContain('mountChild')
        expect(body).toContain('"label": () => ("Save")')
        expect(body).toContain('"onclick": () => (handleClick)')
        expect(body).toContain('"bind:open": () => (state.open)')
        expect(body).toContain('"attach": () => (register)')
    })

    /* A bare attribute on a component is a boolean flag: it coerces to `true`,
       unlike a native element where it serialises to `name=""`. An explicit empty
       string (`disabled=""`) stays the empty string. */
    test('a bare attribute on a component coerces to true', () => {
        const bare = compileComponent(`<Button disabled>x</Button>`)
        expect(bare).toContain('"disabled": () => (true)')

        const empty = compileComponent(`<Button disabled="">x</Button>`)
        expect(empty).toContain('"disabled": () => ("")')

        // a native element keeps the empty-string serialisation, not `true`
        const native = compileComponent(`<button disabled>x</button>`)
        expect(native).toContain('<button disabled=\\"\\">x</button>')
    })

    test('two-way bind listens on the property native event', () => {
        // regression: every generic bind listened on `input`, so `<details>`
        // (which fires `toggle`) and select/checkbox (which fire `change`) never
        // synced back.
        // These bound elements have static (or no) children, so they build through
        // the parser-backed skeleton path — the located hole is `el1` (after `sk0`).
        expect(
            compileComponent(`<details bind:open={isOpen}><summary>x</summary></details>`),
        ).toContain('on(el1, "toggle", () => { isOpen = el1.open; })')
        expect(compileComponent(`<input bind:value={name}/>`)).toContain(
            'on(el1, "input", () => { name = el1.value; })',
        )
        expect(
            compileComponent(`<select bind:value={choice}><option>a</option></select>`),
        ).toContain('on(el1, "change", () => { choice = el1.value; })')
        expect(compileComponent(`<input type="checkbox" bind:checked={agree}/>`)).toContain(
            'on(el1, "change", () => { agree = el1.checked; })',
        )
    })

    test('a bare object literal as a whole prop/attr value stays an object', () => {
        // regression: `{ a: 1 }` parsed in statement position became labeled
        // statements (`a;`), dropping all but the first pair.
        const prop = compileComponent(`<Child params={{ id: routeId, rest: '' }} />`)
        expect(prop).toContain('"params": () => ({ id: routeId, rest: \'\' })')

        const attr = compileComponent(`<b data-x={{ a: 1, b: '' }}>y</b>`)
        expect(attr).toContain('attr(el1, "data-x", () => ({ a: 1, b: \'\' }))')
    })

    /* An inline object-type declaration in the script is plain TypeScript: the emitted
       module carries it, and the `ts` loader the bundler runs strips it. So it never
       reaches the build as invalid JS — guards a report where an inline `type` was
       believed to leak (it does not; moving it to a module is hygiene, not a fix). */
    test('an inline object-type alias is stripped by the build, not leaked', () => {
        const source = `<script>\ntype AppHealth = { status: 'ok' | 'down'; uptime: number }\nconst { health } = props<{ health: AppHealth }>()\n</script>\n<p>{health.status}</p>\n`
        const module = compileModule(source, { moduleId: 'x' })
        // The emitted module is TypeScript and carries the alias verbatim…
        expect(module).toContain('type AppHealth')
        // …which the bundler's `ts` loader erases, leaving valid JS with no type.
        const built = new Bun.Transpiler({ loader: 'ts' }).transformSync(module)
        expect(built).not.toContain('AppHealth')
        expect(built).not.toContain('uptime')
    })

    /* Regression: signal-ref lowering must respect lexical scope. A callback parameter
       (or nested local) that shadows a component signal refers to the inner binding, so
       it must NOT be rewritten to the signal's doc form. Before the fix, the `option`
       loop variable below was rewritten to `option()` — `option is not a function` at
       runtime, since the array element is a string. */
    test('a callback param shadowing a prop signal is not lowered to the prop reader', () => {
        const body = compileComponent(
            `<script>\nconst { option } = props()\nconst labels = ['Title'].map(option => option.toUpperCase())\n</script>\n<ul><template each={labels} as="l" key="l"><li>{l}</li></template></ul>`,
        )
        // The loop variable stays a plain reference inside its callback…
        expect(body).toContain('option => option.toUpperCase()')
        // …and is never confused with the prop reader.
        expect(body).not.toContain('option().toUpperCase()')
    })

    test('the removed `prop()` reader throws a migration error pointing at props()', () => {
        expect(() =>
            compileComponent(`<script>\nlet id = prop('id')\n</script>\n<p>{id}</p>`),
        ).toThrow(/has been removed — read props by destructuring/)
    })

    test('a nested local and a function param shadow state/computed signals', () => {
        const body = compileComponent(
            `<script>\nlet count = scope().state(0)\nconst total = scope().computed(() => count + 1)\nfunction reset(items) {\n  return items.map(count => count + total)\n}\nfunction nested() {\n  const count = 5\n  return count\n}\n</script>\n<div>{count}</div>`,
        )
        // The param `count` shadows the state; only the un-shadowed `total` lowers.
        expect(body).toContain('items.map(count => count + total())')
        expect(body).not.toContain('model.read("count") + total')
        // A nested local `count` shadows the state too — left as a plain reference.
        expect(body).toContain('const count = 5')
        expect(body).toMatch(/const count = 5;?\s*\n\s*return count;?/)
    })
})
