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
   `const $$model = scope()` resolves to its own per-mount scope (isolated per render). */
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

/* Mounts a body that reads an externally-driven `$$model` (a scope, which mirrors the
   document data interface), returning the scope so the test can mutate it. */
function renderWithModel(source: string, initial: unknown): { host: HTMLElement; $$model: Scope } {
    const body = compileComponent(source)
    const host = document.createElement('div')
    const $$model = createScope(initial)
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
        '$$model',
        body,
    )(host, text, appendText, appendStatic, attr, on, each, when, effect, escapeKey, $$model)
    return { host, $$model }
}

describe('compileComponent — end to end', () => {
    test('renders interpolated text from state', () => {
        const host = render(`
            <script>import { state } from '@abide/abide/ui/state'

                let name = state('ada')
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
            <script>import { state } from '@abide/abide/ui/state'

                let count = state(0)
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
            <script>import { state } from '@abide/abide/ui/state'
let count = state(0)</script>
            <p>{count}</p>
        `)
        expect(body).toContain('$$model.cell("count")')
        expect(body).toContain('.get()')
    })

    test('if control flow toggles a branch and stays field-reactive', () => {
        const { host, $$model } = renderWithModel(
            `
            <div>
                {#if $$model.show}
                    <span>{$$model.label}</span>
                {/if}
            </div>
        `,
            { show: true, label: 'hi' },
        )
        const div = host.childNodes[0] as unknown as { textContent: string }
        expect(div.textContent).toBe('hi')
        $$model.replace('label', 'yo') // field-reactive while shown
        expect(div.textContent).toBe('yo')
        $$model.replace('show', false) // falsy edge → branch removed
        expect(div.textContent).toBe('')
        $$model.replace('show', true) // truthy edge → branch re-rendered
        expect(div.textContent).toBe('yo')
    })

    test('compileModule emits a mountable ES module with abide/ui imports', () => {
        const { code: module } = compileModule(`
            <script>import { state } from '@abide/abide/ui/state'
let count = state(0)</script>
            <p>{count}</p>
        `)
        expect(module).toContain("import { mount as $$mount } from '@abide/abide/ui/dom/mount'")
        expect(module).toContain("import { scope as $$scope } from '@abide/abide/ui/currentScope'")
        expect(module).toContain('export default function component(host, $props)')
        expect(module).toContain('$$mount(host, build, $props)')
        expect(module).toContain('component.build = build')
        expect(module).toContain('$$model.cell("count")')
    })

    test('keyed each renders a list and stays field-reactive', () => {
        const { host, $$model } = renderWithModel(
            `
            <ul>
                {#for key of $$model.order by key}
                    <li>{$$model.byId[key].n}</li>
                {/for}
            </ul>
        `,
            { order: ['a', 'b'], byId: { a: { n: 1 }, b: { n: 2 } } },
        )
        const list = host.childNodes[0] as unknown as { children: Element[] }
        expect(list.children.map((child) => child.textContent)).toEqual(['1', '2'])
        $$model.replace('byId/a/n', 9)
        expect(list.children[0].textContent).toBe('9')
        $$model.add('order/-', 'c')
        $$model.replace('byId/c', { n: 3 })
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

    /* A `{...expr}` on a component spreads the object's keys as props: the build
       composes a `mergeProps` of ordered layers (explicit runs + `spreadProps`),
       resolved last-wins, with the spread source passed as a thunk so it stays live. */
    test('a {...spread} compiles to mergeProps with a spreadProps layer', () => {
        const body = compileComponent(`<Card {...rest} title="Hi" />`)
        expect(body).toContain('mergeProps([')
        expect(body).toContain('spreadProps(() => (rest))')
        expect(body).toContain('{ "title": () => ("Hi") }')
        /* The spread layer precedes the explicit one (source order → last wins). */
        expect(body.indexOf('spreadProps')).toBeLessThan(body.indexOf('"title"'))
    })

    /* No spread → the plain object literal stays the path, unchanged. */
    test('a component without a spread keeps the plain prop object (no mergeProps)', () => {
        const body = compileComponent(`<Card title="Hi" />`)
        expect(body).not.toContain('mergeProps')
        expect(body).toContain('{ "title": () => ("Hi") }')
    })

    /* `{...expr}` on a native element forwards its keys as attributes via `spreadAttrs`
       (each key reactive; an `on<event>` function becomes a listener). */
    test('a {...spread} on a native element compiles to spreadAttrs', () => {
        const body = compileComponent(`<div {...rest}></div>`)
        expect(body).toContain('spreadAttrs(')
        expect(body).toContain('function spread() { return (rest) }')
    })

    /* A `<template>` directive has no attribute/prop bag, so a spread there is rejected. */
    test('a {...spread} on a <template> directive is a compile error', () => {
        expect(() =>
            compileComponent(`<template {...rest} each={xs} as={x}><b>{x}</b></template>`),
        ).toThrow(/not supported on a <template>/)
    })

    /* `const { foo, ...rest } = props()` lowers to the named computeds plus a `restProps`
       bag of the unconsumed props. */
    test('a props() rest binding lowers to restProps over the unconsumed keys', () => {
        const body = compileComponent(
            `<script>import { props } from '@abide/abide/ui/props'\nconst { foo, ...rest } = props()</script><i>{foo}</i>`,
        )
        expect(body).toContain('const rest = $$restProps($props, ["foo"])')
        expect(body).toContain('const foo = $$scope().derive("foo", () => $props["foo"]?.())')
    })

    /* A named prop type whose members share the destructured signal names must NOT be
       rewritten into the signal form (`option?: …` → `option(): …`). The `...rest` binding
       forces the type to be emitted into the build, so a mangled member would be invalid TS. */
    test('a named prop type with a rest binding survives the signal rewrite', () => {
        const body = compileComponent(
            `<script>type Props = { option?: (v: string) => unknown; size?: 'a' | 'b' }
const { option, ...rest } = props<Props>()</script><i {...rest}>{option}</i>`,
        )
        expect(body).toContain('option?: (v: string) => unknown')
        expect(body).toContain("size?: 'a' | 'b'")
        expect(body).not.toContain('option():')
    })

    /* An aliased import whose ORIGINAL name collides with a signal binding
       (`import { pending as p }` alongside a `pending` prop) must survive the
       signal rewrite — the specifier is a binding name, not a value read. */
    test('an aliased import surviving a colliding signal binding', () => {
        const { code: module } = compileModule(
            `<script>import { state } from '@abide/abide/ui/state'
import { pending as pendingProbe } from '@abide/abide/shared/pending'
const { query, pending = false } = props()
const busy = state.computed(() => pending && pendingProbe(query))</script><i>{busy}</i>`,
        )
        expect(module).toContain(
            "import { pending as pendingProbe } from '@abide/abide/shared/pending'",
        )
        expect(module).not.toContain('from ()')
        expect(module).not.toMatch(/^from;/m)
    })

    /* Dead-import elimination keeps every runtime helper the body references (never
       drops a needed one) and excludes a helper NAME that only appears inside a string
       literal (the substring regex used to over-include those). */
    test('runtime imports cover what the body uses, and exclude string-literal matches', () => {
        const { code: module } = compileModule(
            `<script>import { state } from '@abide/abide/ui/state'
const rows = state([1, 2])</script><ul>{#for r of rows by r}<li>{r}</li>{/for}</ul>`,
        )
        // the each block needs its helper imported
        expect(module).toContain("from '@abide/abide/ui/dom/each'")
        // and the module is valid (no dropped import would leave a dangling reference)
        expect(() => new Bun.Transpiler({ loader: 'ts' }).transformSync(module)).not.toThrow()

        /* `on` appears only inside static text — not as a real reference — so the event
           helper must NOT be imported (a substring match would have pulled it in). */
        const { code: staticText } = compileModule(`<i>turn it on and off</i>`)
        expect(staticText).not.toContain("from '@abide/abide/ui/dom/on'")
    })

    /* Imports hoist off the parsed tree structurally (not by a single-line regex), so a
       multi-line import lands at module scope regardless of formatting. */
    test('a multi-line import hoists to module scope', () => {
        const { code: module } = compileModule(
            `<script>import {
  Foo,
  Bar,
} from './children'
const label = 'hi'</script><i>{label}</i>`,
        )
        const buildAt = module.indexOf('function build')
        const importAt = module.indexOf("from './children'")
        expect(importAt).toBeGreaterThanOrEqual(0)
        // the import sits above the build function, i.e. at module scope
        expect(importAt).toBeLessThan(buildAt)
    })

    /* A bare `{expr}` at attribute position is a likely-mistaken spread missing its dots. */
    test('a bare {expr} attribute is a compile error pointing at spread syntax', () => {
        expect(() => compileComponent(`<Card {rest} />`)).toThrow(/write \{\.\.\.expr\}/)
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
        expect(compileComponent(`<input type="checkbox" bind:checked={agree}/>`)).toContain(
            'on(el1, "change", () => { agree = el1.checked; })',
        )
    })

    test('<select bind:value> routes to bindSelectValue (options can mount late)', () => {
        // A plain `bind:value` would set `el.value` once, before `{#for}`/async options
        // exist; `bindSelectValue` re-applies on option changes and handles `multiple`.
        expect(
            compileComponent(`<select bind:value={choice}><option>a</option></select>`),
        ).toContain(
            'bindSelectValue(el1, () => (choice), ($selectValue) => { choice = $selectValue; }, false)',
        )
        expect(
            compileComponent(`<select multiple bind:value={picks}><option>a</option></select>`),
        ).toContain(', true)')
    })

    test('numeric input bind:value writes back a number, not a string', () => {
        // regression: `el.value` is a string, silently corrupting number-typed state.
        expect(compileComponent(`<input type="number" bind:value={qty}/>`)).toContain(
            "qty = (el1.value === '' ? undefined : el1.valueAsNumber)",
        )
        expect(compileComponent(`<input type="range" bind:value={vol}/>`)).toContain(
            "vol = (el1.value === '' ? undefined : el1.valueAsNumber)",
        )
    })

    test('a bare object literal as a whole prop/attr value stays an object', () => {
        // regression: `{ a: 1 }` parsed in statement position became labeled
        // statements (`a;`), dropping all but the first pair.
        const prop = compileComponent(`<Child params={{ id: routeId, rest: '' }} />`)
        expect(prop).toContain('"params": () => ({ id: routeId, rest: \'\' })')

        const attr = compileComponent(`<b data-x={{ a: 1, b: '' }}>y</b>`)
        expect(attr).toContain(
            'attr(el1, "data-x", function attr_data_x() { return ({ a: 1, b: \'\' }) })',
        )
    })

    /* Reactive thunks are emitted as named function expressions, not anonymous arrows, so a
       stack frame reads `attr_title`/`text`/`bind_value` instead of `(anonymous)` —
       disambiguating which binding a frame is when several share a source line. The name is
       a sanitized authored label (`data-x` → `attr_data_x`); minify strips it in production. */
    test('reactive bindings emit named thunks for legible stack frames', () => {
        const body = compileComponent(
            `<script>import { state } from '@abide/abide/ui/state'
\nlet name = state('')\n</script>\n<div title={name}><span>{name}</span><input bind:value={name}/></div>`,
        )
        expect(body).toContain('attr(el1, "title", function attr_title() {')
        expect(body).toContain('appendText(el2, function text() {')
        expect(body).toContain('$$watch(function bind_value() {')
        // never the old anonymous-arrow form for these bindings
        expect(body).not.toContain('attr(el1, "title", () =>')
    })

    /* An inline object-type declaration in the script is plain TypeScript: the emitted
       module carries it, and the `ts` loader the bundler runs strips it. So it never
       reaches the build as invalid JS — guards a report where an inline `type` was
       believed to leak (it does not; moving it to a module is hygiene, not a fix). */
    test('an inline object-type alias is stripped by the build, not leaked', () => {
        const source = `<script>\ntype AppHealth = { status: 'ok' | 'down'; uptime: number }\nconst { health } = props<{ health: AppHealth }>()\n</script>\n<p>{health.status}</p>\n`
        const { code: module } = compileModule(source, { moduleId: 'x' })
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
            `<script>\nconst { option } = props()\nconst labels = ['Title'].map(option => option.toUpperCase())\n</script>\n<ul>{#for l of labels by l}<li>{l}</li>{/for}</ul>`,
        )
        // The loop variable stays a plain reference inside its callback…
        expect(body).toContain('option => option.toUpperCase()')
        // …and is never confused with the prop reader.
        expect(body).not.toContain('option().toUpperCase()')
    })

    /* A non-optional method call on a doc read routes through `readCall`, which carries
       the authored path + member so a nullish read throws `cannot call .trim() — scope
       value "draft" is undefined` instead of the engine's opaque `undefined is not an
       object`. Optional-chained calls keep their skip-if-absent semantics, so they stay
       bare — never wrapped. */
    test('a method call on a doc read lowers to the guarded `readCall`', () => {
        const body = compileComponent(
            `<script>import { state } from '@abide/abide/ui/state'
\nlet draft = state("")\nfunction go() {\n  draft.trim()\n  draft.items.map(x => x)\n  draft?.toUpperCase()\n}\n</script>\n<p>{draft}</p>`,
        )
        // Non-optional calls carry the path and member into the guard…
        expect(body).toContain('readCall($$model.read("draft"), "draft", "trim", [])')
        expect(body).toContain(
            'readCall($$model.read("draft/items"), "draft/items", "map", [x => x])',
        )
        // …while an optional-chained call keeps short-circuiting and is never guarded.
        expect(body).toContain('$$model.read("draft")?.toUpperCase()')
        expect(body).not.toContain('readCall($$model.read("draft"), "draft", "toUpperCase"')
    })

    test('the removed `prop()` reader throws a migration error pointing at props()', () => {
        expect(() =>
            compileComponent(`<script>\nlet id = prop('id')\n</script>\n<p>{id}</p>`),
        ).toThrow(/has been removed — read props by destructuring/)
    })

    test('a nested local and a function param shadow state/computed signals', () => {
        const body = compileComponent(
            `<script>import { state } from '@abide/abide/ui/state'
\nlet count = state(0)\nconst total = state.computed(() => count + 1)\nfunction reset(items) {\n  return items.map(count => count + total)\n}\nfunction nested() {\n  const count = 5\n  return count\n}\n</script>\n<div>{count}</div>`,
        )
        // The param `count` shadows the state; only the un-shadowed `total` lowers.
        expect(body).toContain('items.map(count => count + total())')
        expect(body).not.toContain('$$model.read("count") + total')
        // A nested local `count` shadows the state too — left as a plain reference.
        expect(body).toContain('const count = 5')
        expect(body).toMatch(/const count = 5;?\s*\n\s*return count;?/)
    })

    test('a plain nested-<script> local shadows a same-named component signal', () => {
        const body = compileComponent(
            `<script>import { state } from '@abide/abide/ui/state'\nlet title = state('a')\n</script>\n<div>{#if title}<script>const title = 'local'\n</script><p>{title}</p>{/if}</div>`,
        )
        // The branch's plain local `title` shadows the state — its markup reads the bare
        // local, NOT $$model.read("title").
        expect(body).toContain("const title = 'local'")
        expect(body).not.toContain('$$model.read("title")) ? true')
    })

    test('a state declaration mixed with a plain one in a single statement is rejected', () => {
        expect(() =>
            compileComponent(
                `<script>import { state } from '@abide/abide/ui/state'\nlet count = state(0), step = 5\n</script>\n<p>{count}</p>`,
            ),
        ).toThrow(/declare each reactive signal in its own statement/)
    })

    test('an aliased reactive import whose alias contains `$` is not dropped as dead', () => {
        // `effect as $e` — the dead-import regex must not read the trailing `$e` as an
        // end-anchor and drop a live import (which the bound-helper backstop would then
        // reject). Compiles cleanly = the import survived.
        const body = compileComponent(
            `<script>import { effect as $e } from '@abide/abide/ui/effect'\n$e(() => console.log('run'))\n</script>\n<p>hi</p>`,
        )
        expect(body).toContain('$e(')
    })
})
