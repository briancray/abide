// BRANCH-LOCAL `<script>` AND `<style>` (spec C9.2 / C9.4).
//
// Both were parsed and then dropped: a nested `<script>` emitted NOTHING (its bindings read as
// `undefined` with no error anywhere), and a nested `<style>` was scoped with the FILE's attribute — or,
// when the file had no root `<style>` at all, with none, shipping the rules globally.
//
// The behaviours worth pinning here are the ones a correctness-shaped test can miss: that a branch's
// bindings are its OWN (a sibling branch and the root must not see them), that an iteration's are per
// ITEM, and that the scope attribute a nested `<style>` establishes reaches its subtree and stops there.

import { describe, expect, test } from 'bun:test'
import { state } from '../../shared/state.ts'
import { watch } from '../../shared/watch.ts'
import { loadEmitted, loadEmittedServer } from './emit.ts'

function tick(): Promise<void> {
    return Promise.resolve()
}

function present<T>(value: T | null | undefined, what: string): T {
    if (value === null || value === undefined) throw new Error(`expected ${what} to be present`)
    return value
}

// The scope an emitted module reads its framework primitives off — the same one the oracle builds.
function scriptScope(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return { state, watch, props: () => ({}), ...extra }
}

async function mount(
    source: string,
    scope: Record<string, unknown> = scriptScope(),
): Promise<{ host: HTMLElement; dispose: () => void }> {
    const emitted = await loadEmitted(source)
    const host = document.createElement('div')
    const dispose = emitted.mount(host, scope)
    return { host, dispose }
}

async function render(
    source: string,
    scope: Record<string, unknown> = scriptScope(),
): Promise<string> {
    const emitted = await loadEmittedServer(source)
    return await emitted.render(scope)
}

const IMPORT_STATE = "import { state } from 'abide/shared/state'"

describe('branch-local <script>', () => {
    test('its state drives the branch on both sides', async () => {
        const source = `{#if true}<script>let n = state(7)</script><span>{n}</span>{/if}`
        expect(await render(source)).toContain('<span>7<!----></span>')
        const { host } = await mount(source)
        expect(present(host.querySelector('span'), 'span').textContent).toBe('7')
    })

    test('a write from the branch is reactive', async () => {
        const { host } = await mount(
            `{#if true}<script>let n = state(0)</script>` +
                `<button onclick={() => n++}>{n}</button>{/if}`,
        )
        const button = present(host.querySelector('button'), 'button')
        expect(button.textContent).toBe('0')
        button.click()
        await tick()
        expect(button.textContent).toBe('1')
    })

    test('a sibling branch does NOT see the other branch’s bindings', async () => {
        // Both branches bind `n`. Rendering the second must show ITS value, not the first's — the two
        // sets never merge, which is the whole point of scoping them to the level.
        const source =
            `{#if flag}<script>let n = state('then')</script><i>{n}</i>` +
            `{:else}<script>let n = state('else')</script><b>{n}</b>{/if}`
        expect(await render(source, scriptScope({ flag: true }))).toContain('<i>then')
        expect(await render(source, scriptScope({ flag: false }))).toContain('<b>else')
    })

    test('it shadows a same-named root binding for its subtree only', async () => {
        const source =
            `<script>${IMPORT_STATE}\nlet n = state('root')</script>` +
            `<u>{n}</u>{#if true}<script>let n = state('branch')</script><i>{n}</i>{/if}`
        const html = await render(source)
        expect(html).toContain('<u>root')
        expect(html).toContain('<i>branch')
    })

    test('it reads the ROOT script’s bindings', async () => {
        const source =
            `<script>${IMPORT_STATE}\nlet base = state(10)</script>` +
            `{#if true}<script>let extra = state(5)</script><span>{base + extra}</span>{/if}`
        expect(await render(source)).toContain('<span>15')
    })

    test('a level nested BELOW it reads its bindings', async () => {
        // The client emits every level as a SEPARATE mount function, so this is the case a lexical `let`
        // would silently fail: `{n}` lives in a different function from the `<script>` that declared it.
        const source =
            `{#if true}<script>let n = state(3)</script>` + `{#if true}<span>{n}</span>{/if}{/if}`
        expect(await render(source)).toContain('<span>3')
        const { host } = await mount(source)
        expect(present(host.querySelector('span'), 'span').textContent).toBe('3')
    })

    test('a plain `let` stays live, not frozen at setup', async () => {
        // A reassignable binding is published as a GETTER; copying its value once would pin the subtree
        // to whatever it held when the branch mounted. It is not itself reactive (no more than a root
        // script's plain `let` is), so the read is driven by the cell in the same expression.
        const { host } = await mount(
            `{#if true}<script>let n = state(0)\nlet bonus = 0</script>` +
                `<button onclick={() => { bonus = 10; n++ }}>{n + bonus}</button>{/if}`,
        )
        const button = present(host.querySelector('button'), 'button')
        expect(button.textContent).toBe('0')
        button.click()
        await tick()
        // 1 + 10. A value copied at setup would leave `bonus` at 0 and read 1.
        expect(button.textContent).toBe('11')
    })

    test('each `{#for}` iteration gets its OWN state', async () => {
        const { host } = await mount(
            `{#for row of rows}<script>let n = state(0)</script>` +
                `<button onclick={() => n++}>{row}:{n}</button>{/for}`,
            scriptScope({ rows: ['a', 'b'] }),
        )
        const buttons = host.querySelectorAll('button')
        expect(buttons.length).toBe(2)
        present(buttons[0], 'buttons[0]').click()
        await tick()
        expect(present(buttons[0], 'buttons[0]').textContent).toBe('a:1')
        expect(present(buttons[1], 'buttons[1]').textContent).toBe('b:0')
    })

    test('a `watch` teardown runs when the branch unmounts', async () => {
        const flag = state(true)
        let torn = 0
        // The auto-tracked single-thunk form, which runs immediately — `watch(source, handler)` does not
        // call its handler on the initial read, so it would register no teardown to begin with.
        const source = `{#if flag}<script>watch(() => () => teardown())</script><span>on</span>{/if}`
        // Defined, not spread: a spread would READ the getter once and freeze the condition.
        const scope = scriptScope({
            teardown: () => {
                torn++
            },
        })
        Object.defineProperty(scope, 'flag', { get: () => flag(), enumerable: true })
        const { host } = await mount(source, scope)
        expect(present(host.querySelector('span'), 'span').textContent).toBe('on')
        flag.set(false)
        await tick()
        expect(host.querySelector('span')).toBeNull()
        expect(torn).toBe(1)
    })

    test('it reuses the root script’s imports without importing', async () => {
        const source =
            `<script>import greet from 'greet'</script>` +
            `{#if true}<script>const shout = greet('bo').toUpperCase()</script><span>{shout}</span>{/if}`
        expect(await render(source, scriptScope({ greet: (x: string) => `hi ${x}` }))).toContain(
            '<span>HI BO',
        )
    })

    test('an inline `{#component}` body owns its script PER INVOCATION', async () => {
        // The body of a `{#component}` is a block body like any other, so the same rules hold — and the
        // meaningful unit here is the INVOCATION: two `<Row/>` tags are two independent cells, not one
        // shared by the definition.
        const source =
            `{#component Row({ start })}<script>let n = state(start)</script>` +
            `<button onclick={() => n++}>{n}</button>{/component}<Row start={10}/><Row start={20}/>`
        expect(await render(source)).toContain('<button>10')

        const { host } = await mount(source)
        const buttons = host.querySelectorAll('button')
        expect([...buttons].map((b) => b.textContent)).toEqual(['10', '20'])
        present(buttons[0], 'buttons[0]').click()
        await tick()
        expect([...buttons].map((b) => b.textContent)).toEqual(['11', '20'])
    })

    test('an inline `{#component}` body owns its style, scoped to its subtree', async () => {
        const source =
            `{#component Row()}<style>.a { color: red }</style><i class="a">in</i>{/component}` +
            `<b class="a">out</b><Row/>`
        const { host } = await mount(source)
        const scoped = (selector: string): string[] =>
            present(host.querySelector(selector), selector)
                .getAttributeNames()
                .filter((name) => name.startsWith('data-ab-'))
        expect(scoped('i.a').length).toBe(1)
        expect(scoped('b.a').length).toBe(0)
    })
})

describe('branch-local <script> — gating', () => {
    const rejects = async (source: string, message: string): Promise<void> => {
        await expect(loadEmittedServer(source)).rejects.toThrow(message)
    }

    test('a second root-level <script> is an error, not a silent drop', async () => {
        await rejects(
            '<script>let a = 1</script><p>{a}</p><script>let b = 2</script><p>{b}</p>',
            'A second root-level script is not merged',
        )
    })

    test('a <script> inside an element is an error', async () => {
        await rejects(
            '{#if true}<div><script>let a = 1</script>{a}</div>{/if}',
            'has no lifetime of its own',
        )
    })

    test('a <script> that is not the block body’s first node is an error', async () => {
        await rejects(
            '{#if true}<span>x</span><script>let a = 1</script>{/if}',
            'must be the FIRST node of its block body',
        )
    })

    test('two <script>s in one block body is an error', async () => {
        await rejects(
            '{#if true}<script>let a = 1</script><script>let b = 2</script>{/if}',
            'one <script> per block body',
        )
    })

    test('a nested <script module> is an error', async () => {
        await rejects(
            '{#if true}<script module>let a = 1</script>{/if}',
            '<script module> runs once per module',
        )
    })

    test('an import in a branch-local <script> is an error', async () => {
        await rejects(
            "{#if true}<script>import { state } from 'abide/shared/state'</script>{/if}",
            'reuses the imports of the component it sits in',
        )
    })

    test('whitespace and comments before it are fine', async () => {
        const source = `{#if true}\n  <!-- setup -->\n  <script>let n = state(1)</script><i>{n}</i>{/if}`
        expect(await render(source)).toContain('<i>1')
    })
})

// A `<script>` is not an ES module boundary — `emitSetup` inlines its body into `$ensureModule` /
// `render` / `mount`, so an `export` lands inside a FUNCTION and the emitted module fails to parse.
// The scanner used to skip the keyword, which made `export const x = 1` bind exactly like `const x = 1`:
// every binding was right, the template read it, and the only symptom was a syntax error over generated
// source. That is why the negatives below matter as much as the rejections — the gate reads a token
// stream, and the cheap version of it (a substring/regex for `export`) rejects all three of them.
describe('<script> — the export gate', () => {
    const rejects = async (source: string): Promise<void> => {
        await expect(loadEmittedServer(source)).rejects.toThrow('not an ES module boundary')
    }

    test('an export in <script module> is an error', async () => {
        await rejects('<script module>export const shared = 1</script><p>{shared}</p>')
    })

    test('an export in the instance <script> is an error', async () => {
        await rejects('<script>export let n = 1</script><p>{n}</p>')
    })

    test('an export in a branch-local <script> is an error', async () => {
        await rejects('{#if true}<script>export const q = 2</script><p>{q}</p>{/if}')
    })

    test('export default and export type are errors too', async () => {
        await rejects('<script>export default 1</script><p>x</p>')
        await rejects('<script>export type Foo = { a: number }\nconst a = 1</script><p>{a}</p>')
    })

    test('the word export elsewhere is not', async () => {
        expect(await render('<script>const o = { export: 1 }</script><p>{o.export}</p>')).toContain(
            '<p>1',
        )
        expect(await render('<script>const s = "export const x = 1"</script><p>{s}</p>')).toContain(
            'export const x = 1',
        )
        expect(
            await render(
                '<script>function f() { const exported = 1; return exported }</script><p>{f()}</p>',
            ),
        ).toContain('<p>1')
    })
})

describe('nested <style>', () => {
    // The scope attribute of the element carrying `className`, or null when it has none.
    const scopeAttrOf = (host: HTMLElement, selector: string): string | null => {
        const element = present(host.querySelector(selector), selector)
        return element.getAttributeNames().find((name) => name.startsWith('data-ab-')) ?? null
    }

    test('it scopes its own subtree, not the whole component', async () => {
        const { host } = await mount(
            '<p class="outer">out</p>{#if true}<style>.inner { color: red }</style>' +
                '<p class="inner">in</p>{/if}',
            scriptScope(),
        )
        const inner = scopeAttrOf(host, '.inner')
        expect(inner).not.toBeNull()
        // The rule was rewritten against the SAME attribute the subtree carries…
        expect(present(host.querySelector('style'), 'style').textContent).toContain(
            `.inner[${inner}]`,
        )
        // …and an element outside the branch does not carry it.
        expect(scopeAttrOf(host, '.outer')).toBeNull()
    })

    test('a nested <style> is scoped even when the file has no root <style>', async () => {
        // This used to ship UNSCOPED: the scope attribute came only from a ROOT `<style>`, so a file
        // whose only style was nested emitted its rules globally, reaching the whole page.
        const html = await render(
            '{#if true}<style>.a { color: red }</style><i class="a">x</i>{/if}',
        )
        expect(html).toMatch(/\.a\[data-ab-[0-9a-f]+\]/)
    })

    test('an element inside carries BOTH scopes, so a root rule still reaches it', async () => {
        const { host } = await mount(
            '{#if true}<style>.inner { color: red }</style><p class="inner">in</p>{/if}' +
                '<style>p { margin: 0 }</style>',
            scriptScope(),
        )
        const attributes = present(host.querySelector('.inner'), '.inner')
            .getAttributeNames()
            .filter((name) => name.startsWith('data-ab-'))
        expect(attributes.length).toBe(2)
    })

    test('server and client agree on the scope attributes', async () => {
        const source =
            '{#if true}<style>.a { color: red }</style><i class="a">x</i>{/if}<style>i { margin: 0 }</style>'
        const html = await render(source)
        const { host } = await mount(source, scriptScope())
        const clientAttrs = present(host.querySelector('i'), 'i')
            .getAttributeNames()
            .filter((name) => name.startsWith('data-ab-'))
        for (const attribute of clientAttrs) expect(html).toContain(attribute)
        expect(clientAttrs.length).toBe(2)
    })
})
