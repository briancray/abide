// EMITTER CAPABILITY COVERAGE (Stage 1, PR8).
//
// These assertions were ported from the retired interpreter test files (`renderClient.test.ts`,
// `renderServer.test.ts`, `assemble.test.ts`) at cutover. They cover capabilities NOT exercised by the
// snapshot fixture corpus (`emit.oracle.test.ts`): the two-way binds, `bind:element`, fine-grained
// node identity, reactive attribute REMOVAL / class-toggle / style / html(), keyed add-remove and
// prepend-survivor reconciliation, cleanup/teardown, mount reuse, reactive component props, the
// "must import" script guarantee, and server render reuse — all driven through the AOT-emitted module.

import { describe, expect, test } from 'bun:test'
import { effect, signal } from '../../shared/internal/reactive.ts'
import { emitModuleSource, loadEmitted, loadEmittedServer } from './emit.ts'
import type { Mountable } from './runtime.ts'

function tick(): Promise<void> {
    return Promise.resolve()
}

// Guard a maybe-absent DOM lookup: crash-on-null (as the removed `!` did) while proving non-null to tsc.
function present<T>(value: T | null | undefined, what: string): T {
    if (value === null || value === undefined) throw new Error(`expected ${what} to be present`)
    return value
}

function stripAnchors(html: string): string {
    return html.replace(/<!--\[-->|<!--\]-->|<!---->/g, '')
}

// Mount an emitted source into a fresh host and return the host + disposer.
async function mount(
    source: string,
    scope: Record<string, unknown> = {},
): Promise<{ host: HTMLElement; dispose: () => void }> {
    const emitted = await loadEmitted(source)
    const host = document.createElement('div')
    const dispose = emitted.mount(host, scope)
    return { host, dispose }
}

// A getter-backed scope entry so a bare template identifier reads a signal's CURRENT value.
function reactiveScope(
    entries: Record<string, ReturnType<typeof signal>>,
): Record<string, unknown> {
    const scope: Record<string, unknown> = {}
    for (const [name, sig] of Object.entries(entries)) {
        Object.defineProperty(scope, name, { get: () => sig(), enumerable: true })
    }
    return scope
}

describe('static nodes', () => {
    test('literal HTML comment survives', async () => {
        const { host } = await mount('<!--note-->')
        expect(present(host.firstChild, 'firstChild').nodeType).toBe(8)
    })
})

describe('fine-grained reactivity', () => {
    test('only the affected text node updates (identity preserved)', async () => {
        const a = signal('a')
        const scope = reactiveScope({ a })
        scope.b = 'static'
        const { host } = await mount('<span>{a}</span><span>{b}</span>', scope)
        const spanB = present(host.querySelectorAll('span')[1], 'span[1]')
        const textBefore = spanB.firstChild
        a.set('A')
        await tick()
        expect(present(host.querySelectorAll('span')[0], 'span[0]').textContent).toBe('A')
        expect(present(host.querySelectorAll('span')[1], 'span[1]').firstChild).toBe(textBefore)
    })

    test('falsy attribute value removes the attribute', async () => {
        const on = signal(true)
        const { host } = await mount('<input disabled={on}>', reactiveScope({ on }))
        expect(present(host.querySelector('input'), 'input').hasAttribute('disabled')).toBe(true)
        on.set(false)
        await tick()
        expect(present(host.querySelector('input'), 'input').hasAttribute('disabled')).toBe(false)
    })

    test('class:name toggles reactively', async () => {
        const active = signal(false)
        const { host } = await mount('<div class:on={active}></div>', reactiveScope({ active }))
        expect(present(host.querySelector('div'), 'div').classList.contains('on')).toBe(false)
        active.set(true)
        await tick()
        expect(present(host.querySelector('div'), 'div').classList.contains('on')).toBe(true)
    })

    test('style:prop sets a property reactively', async () => {
        const color = signal('red')
        const { host } = await mount('<div style:color={color}></div>', reactiveScope({ color }))
        expect(present(host.querySelector('div'), 'div').style.color).toBe('red')
        color.set('blue')
        await tick()
        expect(present(host.querySelector('div'), 'div').style.color).toBe('blue')
    })

    test('{html()} updates reactively', async () => {
        const markup = signal('<i>a</i>')
        const { host } = await mount('{html(markup)}', reactiveScope({ markup }))
        expect(present(host.querySelector('i'), 'i').textContent).toBe('a')
        markup.set('<u>b</u>')
        await tick()
        expect(host.querySelector('i')).toBeNull()
        expect(present(host.querySelector('u'), 'u').textContent).toBe('b')
    })
})

describe('two-way binding', () => {
    test('bind:value round-trips a text input', async () => {
        const model = signal('hi')
        const { host } = await mount('<input bind:value={model}>', { model })
        const input = present(host.querySelector('input'), 'input')
        expect(input.value).toBe('hi')
        input.value = 'yo'
        input.dispatchEvent(new Event('input'))
        expect(model()).toBe('yo')
        model.set('zz')
        await tick()
        expect(input.value).toBe('zz')
    })

    test('bind:value coerces number inputs', async () => {
        const model = signal(1)
        const { host } = await mount('<input type="number" bind:value={model}>', { model })
        const input = present(host.querySelector('input'), 'input')
        input.value = '42'
        input.dispatchEvent(new Event('input'))
        expect(model()).toBe(42)
    })

    test('bind:checked round-trips', async () => {
        const on = signal(false)
        const { host } = await mount('<input type="checkbox" bind:checked={on}>', { on })
        const input = present(host.querySelector('input'), 'input')
        expect(input.checked).toBe(false)
        input.checked = true
        input.dispatchEvent(new Event('change'))
        expect(on()).toBe(true)
    })

    test('bind:value over a bare state cell synthesizes a get/set accessor (client + server) (#14)', () => {
        // A bare `bind:value={cell}` over a `let cell = state(...)` used to no-op: `rewriteExpr` collapsed
        // the ref to a READ, so the bind got the value, not something writable. The plan now wraps a bare
        // cell in the same `{ get, set }` accessor the manual workaround uses — on BOTH emitters.
        const out = emitModuleSource(
            "<script>import { state } from 'abide/ui/state'; let bare = state('direct')</script><input bind:value={bare}>",
        )
        const accessor = '{ get: () => bare.read(), set: ($v) => bare.write($v) }'
        expect(out.client).toContain(accessor)
        expect(out.server).toContain(accessor)
    })

    test('bind:value with a derived {get,set}', async () => {
        const raw = signal('x')
        const derived = {
            get: () => raw().toUpperCase(),
            set: (v: unknown) => raw.set(String(v).toLowerCase()),
        }
        const { host } = await mount('<input bind:value={derived}>', { derived })
        const input = present(host.querySelector('input'), 'input')
        expect(input.value).toBe('X')
        input.value = 'YO'
        input.dispatchEvent(new Event('input'))
        expect(raw()).toBe('yo')
    })
})

describe('bind:element', () => {
    test('assigns the node to a signal cell', async () => {
        const el = signal<unknown>(undefined)
        const { host } = await mount('<input bind:element={el}>', { el })
        expect(el()).toBe(host.querySelector('input'))
    })

    test('assigns the node to a bare state() cell (node ref)', async () => {
        // TODO #22: a bare cell in `bind:element` used to collapse to `node.read()` (a value) and never
        // bind. It now wraps to a `{get,set}` accessor, so the element is written INTO the cell.
        const { state } = await import('../state.ts')
        const { host } = await mount(
            "<script>import { state } from 'abide/ui/state'\nlet node = state(null)</script><input bind:element={node}><p>{node ? node.tagName : 'none'}</p>",
            { state },
        )
        expect(host.querySelector('p')?.textContent).toBe('INPUT')
        expect(host.querySelector('input')).not.toBeNull()
    })

    test('calls an attachment function and tears it down', async () => {
        let received: unknown = null
        let tornDown = false
        const attach = (node: unknown) => {
            received = node
            return () => {
                tornDown = true
            }
        }
        const { host, dispose } = await mount('<div bind:element={attach}></div>', { attach })
        expect(received).toBe(host.querySelector('div'))
        dispose()
        expect(tornDown).toBe(true)
    })
})

describe('{#for} keyed reconciliation', () => {
    test('keyed add and remove', async () => {
        const items = signal([1, 2])
        const { host } = await mount(
            '{#for n of items by n}<li>{n}</li>{/for}',
            reactiveScope({ items }),
        )
        expect(host.querySelectorAll('li').length).toBe(2)
        items.set([1, 2, 3, 4])
        await tick()
        expect(host.querySelectorAll('li').length).toBe(4)
        expect(host.textContent).toBe('1234')
        items.set([2])
        await tick()
        expect(host.querySelectorAll('li').length).toBe(1)
        expect(host.textContent).toBe('2')
    })

    test('keyed reuse preserves the survivor node on prepend', async () => {
        const items = signal([{ id: 1 }])
        const { host } = await mount(
            '{#for item of items by item.id}<li>{item.id}</li>{/for}',
            reactiveScope({ items }),
        )
        const original = present(host.querySelector('li'), 'li')
        items.set([{ id: 0 }, { id: 1 }])
        await tick()
        const after = host.querySelectorAll('li')
        expect(after.length).toBe(2)
        expect(after[1]).toBe(original)
    })
})

describe('components', () => {
    // A reactive child: reads its `title` prop inside an effect (the prop is a getter, so it tracks).
    const reactiveChild = (props: Record<string, unknown>): Mountable => ({
        mount(target, anchor) {
            const span = document.createElement('span')
            const dispose = effect(() => {
                span.textContent = String(props.title)
            })
            target.insertBefore(span, anchor)
            return () => {
                dispose()
                span.remove()
            }
        },
    })

    test('a reactive prop updates the child', async () => {
        const title = signal('one')
        const scope: Record<string, unknown> = { Reactive: reactiveChild }
        Object.defineProperty(scope, 'title', { get: () => title(), enumerable: true })
        const { host } = await mount('<Reactive title={title} />', scope)
        expect(present(host.querySelector('span'), 'span').textContent).toBe('one')
        title.set('two')
        await tick()
        expect(present(host.querySelector('span'), 'span').textContent).toBe('two')
    })
})

describe('cleanup and reuse', () => {
    test('dispose removes all nodes', async () => {
        const { host, dispose } = await mount('<p>a</p><span>b</span>', {})
        expect(host.childNodes.length).toBeGreaterThan(0)
        dispose()
        expect(host.textContent).toBe('')
    })

    test('dispose stops effects (no further DOM updates)', async () => {
        const count = signal(1)
        const { host, dispose } = await mount('{count}', reactiveScope({ count }))
        expect(host.textContent).toBe('1')
        dispose()
        count.set(2)
        await tick()
        expect(host.textContent).toBe('')
    })

    test('one emitted module mounts into many hosts', async () => {
        const emitted = await loadEmitted('Hi {name}!')
        const a = document.createElement('div')
        const b = document.createElement('div')
        emitted.mount(a, { name: 'A' })
        emitted.mount(b, { name: 'B' })
        expect(a.textContent).toBe('Hi A!')
        expect(b.textContent).toBe('Hi B!')
    })
})

describe('no ambient identifiers (script)', () => {
    // A `<script>` that references a framework function it never imported keeps it a bare lexical name,
    // so it fails loudly ("state is not defined") — the "a page must import everything" guarantee. (The
    // parallel interpreter check for an unimported RPC used in the TEMPLATE is intentionally NOT ported:
    // per the emitter design a free template identifier resolves off `$scope`, so it does not throw.)
    test('state() without an import does not resolve', async () => {
        const emitted = await loadEmitted(
            '<script>let count = state(0)</script><span>{count}</span>',
        )
        await expect(emitted.render({})).rejects.toThrow(/state is not defined/)
    })
})

describe('contextual-keyword template identifiers (#18)', () => {
    // A bare template identifier whose name is an allowlisted TS *contextual keyword* (`accessor`,
    // `type`, `object`, …) tokenises as a keyword, not `Identifier`. The free-identifier pass now treats
    // the SAFE ones as identifiers so they rewrite to `$scope.<name>` and resolve at mount (previously a
    // ReferenceError). The DANGEROUS ones (`await`, `as`, `of`, …) stay keywords and are untouched.
    test('safe keyword-named references resolve via $scope', async () => {
        const { host } = await mount('<p>{accessor}|{type}|{object}</p>', {
            accessor: 'AX',
            type: 'TY',
            object: 'OB',
        })
        expect(present(host.querySelector('p'), 'p').textContent).toBe('AX|TY|OB')
    })

    test('a keyword-named binding declared in the script is left lexical (not $scope-rewritten)', async () => {
        const { host } = await mount('<script>let type = 7</script><p>{type}</p>', {})
        expect(present(host.querySelector('p'), 'p').textContent).toBe('7')
    })

    test('dangerous keywords keep their operator meaning — {await fn()} is not rewritten', () => {
        const out = emitModuleSource(
            "<script>import greet from '../rpc/greet'</script><p>{await greet()}</p>",
        )
        // `await` must NOT be treated as an identifier reference (`$scope.await` would break the expression).
        expect(out.client).not.toContain('$scope.await')
        expect(out.server).not.toContain('$scope.await')
    })
})

describe('server-side bind serialization (regression: accessor not unwrapped)', () => {
    // SSR must resolve a bound value THROUGH its `{get,set}` accessor / writable signal exactly as the
    // client bind does — not stringify the accessor object. Before the fix `bind:checked={acc}` rendered
    // `checked` for any truthy object, `bind:value={acc}` rendered `value="[object Object]"`, and
    // `bind:group` emitted a literal `group="[object Object]"` attribute.
    test("bind:checked reflects the accessor's boolean, not object truthiness", async () => {
        const off = await loadEmitted('<input type="checkbox" bind:checked={acc}>')
        expect(await off.render({ acc: { get: () => false, set: () => {} } })).toBe(
            '<input type="checkbox">',
        )
        const on = await loadEmitted('<input type="checkbox" bind:checked={acc}>')
        expect(await on.render({ acc: { get: () => true, set: () => {} } })).toBe(
            '<input type="checkbox" checked>',
        )
    })

    test('bind:value serializes the resolved value, not the accessor object', async () => {
        const emitted = await loadEmitted('<input bind:value={acc}>')
        expect(await emitted.render({ acc: { get: () => 'hello', set: () => {} } })).toBe(
            '<input value="hello">',
        )
    })

    test('bind:value resolves a writable signal (callable with .set)', async () => {
        const emitted = await loadEmitted('<input bind:value={sig}>')
        const sig = Object.assign(() => 'sig-value', { set: () => {} })
        expect(await emitted.render({ sig })).toBe('<input value="sig-value">')
    })

    test('bind:group checks ONLY the radio whose value equals the group value, no `group` attr', async () => {
        const src =
            '<input type="radio" name="h" value="red" bind:group={g}>' +
            '<input type="radio" name="h" value="green" bind:group={g}>'
        const emitted = await loadEmitted(src)
        const html = await emitted.render({ g: { get: () => 'green', set: () => {} } })
        expect(html).toBe(
            '<input type="radio" name="h" value="red"><input type="radio" name="h" value="green" checked>',
        )
        expect(html).not.toContain('group=')
    })

    test('bind:element renders NO server attribute (client-only ref)', async () => {
        const emitted = await loadEmitted('<input bind:element={ref}>')
        expect(await emitted.render({ ref: () => {} })).toBe('<input>')
    })
})

describe('server render reuse', () => {
    test('one emitted server module renders repeatedly with different scopes', async () => {
        const emitted = await loadEmitted('{a}')
        expect(stripAnchors(await emitted.render({ a: 'one' }))).toBe('one')
        expect(stripAnchors(await emitted.render({ a: 'two' }))).toBe('two')
    })
})

describe('<script module> bindings reach the template (regression: docs app SSR)', () => {
    // A `<script module>`'s imports + consts must be carried out of the memoized `$ensureModule` into
    // the per-instance `render`/`mount` scope — else a template reference to a module-imported RPC
    // (`{await hello(...)}`) or a module const throws "hello is not defined". This shipped broken and
    // the docs app (dogfooding, real `<script module>` page) caught it; the fixture corpus never
    // exercised a module-scoped binding CONSUMED by the template.
    const src =
        "<script module>import greet from '../rpc/greet'; const label = 'Hi'</script>" +
        "<p>{label}: {await greet({ who: 'reader' })}</p>"
    const scope = { greet: (a: { who: string }) => `hello ${a.who}` }

    test('server render resolves a module import used in the template', async () => {
        const emitted = await loadEmitted(src)
        expect(stripAnchors(await emitted.render({ ...scope }))).toBe('<p>Hi: hello reader</p>')
    })

    test('client mount resolves a module import used in the template', async () => {
        const emitted = await loadEmitted(src)
        const host = document.createElement('div')
        emitted.mount(host, { ...scope })
        await tick()
        expect(host.textContent).toContain('Hi: hello reader')
    })

    test('a module import is re-resolved from the CURRENT scope each mount (regression: soft-nav seed)', async () => {
        // `<script module>` memoizes its DECLARATIONS once, but its IMPORTS must be re-aliased from the
        // live per-mount `$scope`. On a client soft-nav the seed installs a FRESH per-nav RPC proxy into
        // `$scope`; if the module froze the first mount's proxy, the second mount reads the stale one (the
        // `[slug]` duplicate-render bug). Two renders of ONE emitted module with different `greet` in scope
        // must each reflect their OWN scope's import.
        const emitted = await loadEmitted(
            "<script module>import greet from '../rpc/greet'</script><p>{await greet({ who: 'x' })}</p>",
        )
        expect(stripAnchors(await emitted.render({ greet: () => 'FIRST' }))).toBe('<p>FIRST</p>')
        expect(stripAnchors(await emitted.render({ greet: () => 'SECOND' }))).toBe('<p>SECOND</p>')
    })

    test('module and instance importing the SAME name do not double-declare (const collision)', async () => {
        // Both scripts import `state`; the instance's own binding must win — the module copy must NOT be
        // destructured into instance scope (that was a `const state` re-declaration SyntaxError). Distinct
        // source from seededState.test's fixture so the memoized `$module` isn't shared via loadEmitted's
        // by-source cache.
        const dual =
            "<script module>import { state } from 'abide/ui/state'; let modCell = state('MOD')</script>" +
            "<script>import { state } from 'abide/ui/state'; let instCell = state('INST')</script><p>{modCell}/{instCell}</p>"
        const emitted = await loadEmitted(dual)
        expect(
            stripAnchors(await emitted.render({ state: (v: unknown) => ({ read: () => v }) })),
        ).toBe('<p>MOD/INST</p>')
    })
})

// Quoted attribute values interpolate `{expr}` (mixed literal + interpolation), on elements AND
// component props — `title="Count: {n}"` is a reactive attribute, `{'{'}` yields a literal brace.
describe('attribute-value interpolation', () => {
    test('mixed literal + interpolation renders and stays reactive on an element', async () => {
        const { state } = await import('../state.ts')
        const src =
            "<script>import { state } from 'abide/ui/state'\nlet n = state(3)</script>" +
            "<div id='d' title='Count: {n}'><button id='b' onclick={() => n++}>x</button></div>"
        const { host, dispose } = await mount(src, { state })
        const d = host.querySelector('#d') as HTMLElement
        expect(d.getAttribute('title')).toBe('Count: 3')
        ;(host.querySelector('#b') as HTMLButtonElement).click()
        await Promise.resolve()
        expect(d.getAttribute('title')).toBe('Count: 4')
        dispose()
    })

    test("{'{'} yields a literal brace in an attribute value", async () => {
        const src = "<code id='c' title=\"{'{'}await fn(){'}'}\">x</code>"
        const { host, dispose } = await mount(src)
        expect((host.querySelector('#c') as HTMLElement).getAttribute('title')).toBe('{await fn()}')
        dispose()
    })

    test('a component prop interpolates too (label="…{x}…")', async () => {
        // Child echoes its `label` prop into an attribute; parent passes an interpolated string.
        const child =
            "<script>import { props } from 'abide/ui/props'\nconst { label = '' } = props()</script>" +
            '<span data-label={label}>{label}</span>'
        const parent =
            "<script>import Badge from './Badge.abide'\nimport { state } from 'abide/ui/state'\nlet n = state(2)</script>" +
            '<Badge label="n is {n}" />'
        const resolve = (specifier: string): string | undefined =>
            specifier === './Badge.abide' ? child : undefined
        const emitted = await loadEmitted(parent, resolve)
        const host = document.createElement('div')
        const dispose = emitted.mount(host, { state: (await import('../state.ts')).state })
        const span = host.querySelector('span[data-label]') as HTMLElement
        expect(span.getAttribute('data-label')).toBe('n is 2')
        dispose()
    })

    test('a value that is exactly {expr} matches name={expr} (no forced string concat)', () => {
        const { server } = emitModuleSource('<div title="{ok}"></div>')
        // Single interpolation → raw expr, not a `"" + (...)` concatenation.
        expect(server).toContain('$scope.ok')
        expect(server).not.toContain('"" + ')
    })
})

// M3b module-swap resolution: `abide/shared|ui/*` imports that AREN'T scope-provided are emitted as
// REAL ES imports (resolved by the bundler/temp-module) rather than aliased off `$scope`; the scope
// primitives (`state`, `props`, `route`, …) still route through `$scope`.
describe('M3b pass-through framework imports', () => {
    const PAGE =
        '<script>' +
        "import { online } from 'abide/shared/online'\n" +
        "import { bundled } from 'abide/ui/bundled'\n" +
        "import { state } from 'abide/ui/state'\n" +
        'let n = state(0)\n' +
        "</script><p>{online() ? 'on' : 'off'}/{bundled() ? 'yes' : 'no'}/{n}</p>"

    test('emits online/bundled as REAL imports on both sides; state stays a $scope alias', () => {
        const { client, server } = emitModuleSource(PAGE)
        for (const out of [client, server]) {
            expect(out).toContain('import { online } from "abide/shared/online";')
            expect(out).toContain('import { bundled } from "abide/ui/bundled";')
            // Not aliased off $scope — they resolve lexically from the real import.
            expect(out).not.toContain('$scope["online"]')
            expect(out).not.toContain('$scope["bundled"]')
            // The scope-provided primitive is still injected.
            expect(out).toContain('const state = $scope["state"];')
        }
    })

    test('server render executes the real import — online() is true on the server', async () => {
        const mod = await loadEmittedServer(PAGE)
        const html = await mod.render({
            state: (v: unknown) => ({ read: () => v, write: () => {}, peek: () => v }),
        })
        expect(stripAnchors(html)).toBe('<p>on/no/0</p>')
    })
})

// done(iterable) — a reactive probe that flips true once a `{#for await}` over the SAME iterable
// object finishes streaming.
describe('done() stream-completion probe', () => {
    const DONE_PAGE =
        "<script>import { done } from 'abide/shared/done'</script>" +
        "{#for await x of stream}<span class='i'>{x}</span>{/for}" +
        "<b id='flag'>{done(stream) ? 'DONE' : 'streaming'}</b>"

    test("flips from 'streaming' to 'DONE' after the client drains a finite stream", async () => {
        async function* finite() {
            yield 'a'
            yield 'b'
            yield 'c'
        }
        const stream = finite()
        const { host, dispose } = await mount(DONE_PAGE, { stream })
        expect(host.querySelector('#flag')?.textContent).toBe('streaming')
        // Let the async iterator drain (microtask + a macrotask turn for the for-await loop).
        await new Promise((resolve) => setTimeout(resolve, 30))
        expect([...host.querySelectorAll('.i')].map((n) => n.textContent).join('')).toBe('abc')
        expect(host.querySelector('#flag')?.textContent).toBe('DONE')
        dispose()
    })

    test('done() reads false for a never-streamed / non-object value', async () => {
        const { host, dispose } = await mount(DONE_PAGE, { stream: null })
        // A null source: the for-await catches, done(null) stays false → 'streaming' (never object-tracked).
        await new Promise((resolve) => setTimeout(resolve, 10))
        expect(host.querySelector('#flag')?.textContent).toBe('streaming')
        dispose()
    })
})

// state.shared(key, initial): a writable cell shared by key across every component instance (same
// key → same backing signal). A write in one instance is observed by another sharing the key.
describe('state.shared cross-instance cell', () => {
    const SHARED_PAGE =
        "<script>import { state } from 'abide/ui/state'\n" +
        "let n = state.shared('cap-counter', 0)\n" +
        'function bump() { n = n + 1 }\n' +
        "</script><button class='bump' onclick={bump}>bump</button><b class='val'>{n}</b>"

    test("two instances sharing a key see each other's writes", async () => {
        // The real bootstrap injects `state` (via makeSeededState, which forwards `.shared`); the harness
        // scope is bare, so provide it here.
        const { state } = await import('../state.ts')
        const a = await mount(SHARED_PAGE, { state })
        const b = await mount(SHARED_PAGE, { state })
        expect(a.host.querySelector('.val')?.textContent).toBe('0')
        expect(b.host.querySelector('.val')?.textContent).toBe('0')

        // Click bump in instance A — instance B, sharing the same key, reflects the new value.
        ;(a.host.querySelector('.bump') as HTMLButtonElement).click()
        await Promise.resolve()
        expect(a.host.querySelector('.val')?.textContent).toBe('1')
        expect(b.host.querySelector('.val')?.textContent).toBe('1')

        // A fresh instance created AFTER the write starts from the shared current value, not the initial.
        const c = await mount(SHARED_PAGE, { state })
        expect(c.host.querySelector('.val')?.textContent).toBe('1')
        a.dispose()
        b.dispose()
        c.dispose()
    })
})
