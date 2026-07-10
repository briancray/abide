import { beforeAll, describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import type { SsrRender } from '../src/lib/ui/runtime/types/SsrRender.ts'
import { installMiniDom } from './support/installMiniDom.ts'
import { settle } from './support/settle.ts'

/*
`{await expr}` — a standalone text interpolation whose expression begins with a
top-level `await` — desugars at parse time to the EXISTING blocking-await block
`{#await expr then __awaitN}{__awaitN}{/await}`. No new node kind, codegen, or
runtime: the synthesised node flows through the same machinery the explicit block
uses. These guard the lowering equivalence, the client + SSR (baked, blocking)
runtime behaviour, the non-content position guard, and composition with `{#try}`.
*/

beforeAll(() => {
    installMiniDom()
})

/* Mounts a compiled client body. The abide-ui runtime helpers (`$$awaitBlock`,
   `$$readCell`, `$$appendText`, …) resolve to the real modules via the `uiPreload`
   globals, so only the author-script bare names (`gate`) need injecting. Returns the host. */
function mount(source: string, injected: Record<string, unknown> = {}): { host: HTMLElement } {
    const host = document.createElement('div')
    const names = Object.keys(injected)
    new Function('host', ...names, compileComponent(source))(
        host,
        ...names.map((name) => injected[name]),
    )
    return { host }
}

/* Runs a compiled SSR body as its render function, injecting the author-script helpers by
   bare name; the `$$`-prefixed runtime resolves through the uiPreload globals. */
function render(source: string, helpers: Record<string, unknown> = {}): Promise<SsrRender> {
    const names = Object.keys(helpers)
    const values = names.map((name) => helpers[name])
    return new Function('$props', '$ctx', ...names, compileSSR(source))(
        undefined,
        undefined,
        ...values,
    ) as Promise<SsrRender>
}

describe('{await expr} lowering', () => {
    /* The desugar is textually the explicit blocking-await block: compiling `{await foo()}`
       yields byte-identical client output to `{#await foo() then __await0}{__await0}{/await}`
       (the first interpolation always mints `__await0`). */
    test('lowers to the same client body as the explicit blocking-await block', () => {
        const desugared = compileComponent('<p>{await foo()}</p>')
        const explicit = compileComponent('<p>{#await foo() then __await0}{__await0}{/await}</p>')
        expect(desugared).toBe(explicit)
        // routes through the blocking-await runtime call, not a bare sync text append
        expect(desugared).toContain('$$awaitBlock(')
        expect(desugared).not.toMatch(/\$\$appendText\([^)]*await/)
    })

    /* Same equivalence on the SSR path — the inline blocking await bakes the resolved value. */
    test('lowers to the same SSR body as the explicit blocking-await block', () => {
        const desugared = compileSSR('<p>{await foo()}</p>')
        const explicit = compileSSR('<p>{#await foo() then __await0}{__await0}{/await}</p>')
        expect(desugared).toBe(explicit)
    })

    /* Each interpolation mints a distinct binding, so two in one component don't collide. */
    test('two interpolations mint distinct bindings', () => {
        const body = compileComponent('<p>{await one()}</p><p>{await two()}</p>')
        expect(body).toContain('$$awaitBlock(')
        // both blocking-await blocks compiled without a duplicate-declaration collision
        expect((body.match(/\$\$awaitBlock\(/g) ?? []).length).toBe(2)
    })
})

describe('{await expr} client runtime', () => {
    test('renders the promise resolved value after settle', async () => {
        const gate = () => Promise.resolve('RESOLVED')
        const { host } = mount('<p>{await gate()}</p>', { gate })
        await settle()
        expect(host.textContent).toContain('RESOLVED')
    })
})

describe('{await expr} SSR (blocking, bakes into the HTML)', () => {
    test('bakes the resolved value into the rendered HTML, not [object Promise]', async () => {
        const gate = () => new Promise((resolve) => setTimeout(() => resolve('BAKED'), 0))
        const { html } = await render('<p>{await gate()}</p>', { gate })
        expect(html).toContain('BAKED')
        expect(html).not.toContain('[object Promise]')
        expect(html).not.toBe('<p></p>')
    })
})

/* ADR-0032 D2/D5: a leading `await` in a value position is no longer rejected — it lifts to a
   BLOCKING peek-cell (`, false`), joining the SSR barrier, and the position reads `$$readCell`.
   `await` is syntactic, so the lift fires WITHOUT a classifier. */
describe('{await expr} value-position lift (blocking)', () => {
    test('a leading await in an attribute value lifts to a blocking peek-cell', () => {
        const lowered = compileComponent('<div class={await foo()}></div>')
        expect(lowered).toContain('$$scope().trackedComputed(async () => await (foo()), false)')
        expect(lowered).toContain('$$attr(el1, "class"')
        expect(lowered).toContain('$$readCell(__v0)')
    })

    test('a leading await in a quoted attribute value lifts to a blocking peek-cell', () => {
        const lowered = compileComponent('<div class="{await foo()}"></div>')
        expect(lowered).toContain('$$scope().trackedComputed(async () => await (foo()), false)')
        expect(lowered).toContain('$$readCell(__v0)')
    })

    test('a leading await in an {#if} head lifts to a blocking peek-cell', () => {
        const lowered = compileComponent('{#if await ready()}<p>ok</p>{/if}')
        expect(lowered).toContain('$$scope().trackedComputed(async () => await (ready()), false)')
        expect(lowered).toContain('$$when(host, () => $$readCell(__v0),')
    })

    test('a leading await in a {#for} iterable lifts to a blocking peek-cell', () => {
        const lowered = compileComponent('{#for x of await list()}<p>{x}</p>{/for}')
        expect(lowered).toContain('$$scope().trackedComputed(async () => await (list()), false)')
        expect(lowered).toContain('$$each(host, () => ($$readCell(__v0))')
    })

    test('a leading await in a {#switch} subject lifts to a blocking peek-cell', () => {
        const lowered = compileComponent('{#switch await pick()}{:case 1}<p>a</p>{/switch}')
        expect(lowered).toContain('$$scope().trackedComputed(async () => await (pick()), false)')
        expect(lowered).toContain('$$switchBlock(host, () => $$readCell(__v0),')
    })
})

describe('{await expr} composes with {#try}', () => {
    /* The blocking await has no local `:catch`, so a rejection bubbles to the enclosing
       `{#try}` boundary — which swaps to its catch branch after settle. */
    test('a rejected await surfaces through an enclosing {#try} catch branch', async () => {
        const gate = () => Promise.reject(new Error('kaboom'))
        const { host } = mount('{#try}<p>{await gate()}</p>{:catch e}<b>caught:{e}</b>{/try}', {
            gate,
        })
        await settle()
        expect(host.textContent).toContain('caught:')
    })
})
