import { beforeAll, describe, expect, test } from 'bun:test'
import { decodeRefJson } from '../src/lib/shared/decodeRefJson.ts'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { computed } from '../src/lib/ui/computed.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { awaitBlock } from '../src/lib/ui/dom/awaitBlock.ts'
import { mount } from '../src/lib/ui/dom/mount.ts'
import { readCall } from '../src/lib/ui/dom/readCall.ts'
import { restProps } from '../src/lib/ui/dom/restProps.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { renderToStream } from '../src/lib/ui/renderToStream.ts'
import { createDoc as doc } from '../src/lib/ui/runtime/createDoc.ts'
import type { ResumeEntry } from '../src/lib/ui/runtime/RESUME.ts'
import type { SsrRender } from '../src/lib/ui/runtime/types/SsrRender.ts'
import { state } from '../src/lib/ui/state.ts'
import { installMiniDom } from './support/installMiniDom.ts'

/*
Regression guards for the SSR async-render fixes (the marker-range / blocking-await
review). Each pins a fix that lacked coverage and would fail on the pre-fix engine:

  - async-snippet detection by a fixpoint + escaped regex (a snippet that text-calls
    another async snippet, and a snippet name carrying `$`);
  - nested streaming awaits flush (a streaming `then` branch that itself streams);
  - a blocking await nested in a streaming branch seeds its resume in the fragment;
  - slot content shares the page block-id counter, allocated depth-first at the
    `<slot>` (not eagerly before the child render).
*/

beforeAll(() => {
    installMiniDom()
})

const RUNTIME = { doc, state, computed, effect, appendText, appendStatic, awaitBlock, mount }

function component(source: string, extra: Record<string, unknown> = {}) {
    const clientBody = compileComponent(source)
    const ssrBody = compileSSR(source)
    const runtime = { ...RUNTIME, ...extra }
    const names = Object.keys(runtime)
    const values = names.map((name) => runtime[name as keyof typeof runtime])
    const fn = (host: Element, props?: unknown) =>
        new Function('host', '$props', ...names, clientBody)(host, props, ...values)
    /* `$ctx` (the request-local block-id counter) threaded so a child shares the page's
       depth-first numbering; the page render passes it when inlining the child. */
    fn.render = (props?: unknown, ctx?: unknown): SsrRender | Promise<SsrRender> =>
        new Function('$props', '$ctx', ...names, ssrBody)(props, ctx, ...values) as
            | SsrRender
            | Promise<SsrRender>
    return Object.assign(fn, { build: fn })
}

async function streamToString(render: () => SsrRender | Promise<SsrRender>): Promise<string> {
    let html = ''
    for await (const chunk of renderToStream(render)) {
        html += chunk
    }
    return html
}

/* Merge every inline `__abideResume` seed script in the streamed HTML (the shell seed
   plus each fragment's delta) into one id → value manifest. Each seeded entry is a
   ref-json string, so decode it back to the ResumeEntry the manifest carries. */
function resumeManifest(html: string): Record<string, ResumeEntry> {
    const merged: Record<string, ResumeEntry> = {}
    for (const match of html.matchAll(
        /window\.__abideResume\|\|\{\},(\{[\s\S]*?\})\)<\/script>/g,
    )) {
        const encoded = JSON.parse(match[1]) as Record<string, string>
        for (const [id, entry] of Object.entries(encoded)) {
            merged[id] = decodeRefJson(entry) as ResumeEntry
        }
    }
    return merged
}

describe('async-snippet detection (fixpoint + escaped regex)', () => {
    const Kid = component('<i>kid</i>')

    /* #4: snippet `a` only TEXT-calls snippet `b`, which inlines a child (so `b` is async).
       The pre-fix structural-only scan left `a` a plain `function` while its body emitted
       `$text(await b())` → `await` in a non-async function → SyntaxError at compile. */
    test('a snippet that text-calls an async snippet compiles and renders', async () => {
        const render = component(
            `
            {#snippet a}<span>{b()}</span>{/snippet}
            {#snippet b}<Kid />{/snippet}
            <div>{a()}</div>
        `,
            { Kid },
        ).render
        const { html } = await render()
        expect(html).toContain('<i>kid</i>')
        expect(html).not.toContain('[object Promise]')
    })

    /* #5: a snippet name containing `$` (a valid identifier char). The pre-fix unescaped
       RegExp read the `$` as an end-anchor, so the call site never matched, the `await`
       was dropped, and the Promise stringified as `[object Promise]`. */
    test('an async snippet whose name contains `$` is awaited at its call site', async () => {
        const render = component(
            `
            {#snippet row$}<Kid />{/snippet}
            <div>{row$()}</div>
        `,
            { Kid },
        ).render
        const { html } = await render()
        expect(html).toContain('<i>kid</i>')
        expect(html).not.toContain('[object Promise]')
    })

    /* An async snippet handed to a CHILD as a prop and called by its prop name. The child's
       `{item("x")}` never appears in the child's own `asyncSnippets` (item is a prop, lowered
       to a computed), so the pre-fix child dropped the `await` and rendered `[object Promise]`.
       The fix awaits calls to computed-backed bindings, which is where snippet props live. */
    test('an async snippet passed as a prop and called in the child is awaited', async () => {
        const List = component(
            `<script>import { props } from '@abide/abide/ui/props'
const { item } = props<{ item: (label: string) => unknown }>()</script><ul>{item("x")}</ul>`,
        )
        const render = component(
            `
            {#snippet row(label)}<b>{label}</b><Kid />{/snippet}
            <List item={row} />
        `,
            { Kid, List },
        ).render
        const { html } = await render()
        expect(html).toContain('<i>kid</i>') // the async snippet body rendered
        expect(html).toContain('x') // the label the child passed
        expect(html).not.toContain('[object Promise]')
    })
})

describe('nested streaming awaits flush', () => {
    /* #2: a streaming await (no `then` on the tag) whose resolved branch holds ANOTHER
       streaming await. The inner block is `$awaits.push`-ed during the outer's settle —
       after `renderToStream` snapshotted the await list — so the pre-fix drain never saw
       it and its boundary stayed pending forever. */
    test('a streaming await nested in a streaming then-branch flushes its fragment', async () => {
        const render = component(`
            <script>
                let outer = () => Promise.resolve('OUT')
                let inner = () => Promise.resolve('IN')
            </script>
            <div>
                {#await outer()}
                    <p>outer-pending</p>
                    {:then o}
                        <b>{o}</b>
                        {#await inner()}
                            <p>inner-pending</p>
                            {:then i}<span>{i}</span>
                        {/await}
                {/await}
            </div>
        `).render
        const html = await streamToString(() => render())
        expect(html).toContain('<b>OUT</b>')
        expect(html).toContain('<span>IN</span>') // nested streaming fragment flushed
        const ids = [...html.matchAll(/<abide-resolve data-id="(\d+)"/g)].map((m) => m[1]).sort()
        expect(ids).toEqual(['0', '1']) // outer streamed first (id 0), inner after (id 1)
    })
})

describe('blocking await nested in a streaming branch seeds its resume', () => {
    /* Follow-up edge: a BLOCKING await (`then` on the tag) inside a streaming branch renders
       inline during settle, writing `$resume` AFTER the shell seed was serialized. The fix
       emits the resume delta alongside the streamed fragment so hydration adopts it. */
    test("the nested blocking value rides the fragment's resume seed", async () => {
        const render = component(`
            <script>
                let outer = () => Promise.resolve('OUT')
                let inner = () => Promise.resolve('IN')
            </script>
            <div>
                {#await outer()}
                    <p>pending</p>
                    {:then o}
                        <b>{o}</b>
                        {#await inner() then i}<span>{i}</span>{/await}
                {/await}
            </div>
        `).render
        const html = await streamToString(() => render())
        expect(html).toContain('<span>IN</span>')
        const manifest = resumeManifest(html)
        // outer is streaming (id 0, in the fragment's own data block, not __abideResume);
        // inner is the blocking await (id 1), seeded via the fragment's resume delta.
        expect(manifest[1]).toEqual({ ok: true, value: 'IN' })
    })
})

describe('an await binding named like the awaited expression', () => {
    /* `{#await foo then foo}` — the `then` value reuses the awaited expression's name.
       The pre-fix SSR emitted `const foo = await (foo())` in ONE scope, so the awaited
       `foo` read the `const foo` in its own temporal dead zone → ReferenceError. The fix
       awaits into a synthetic var first, then declares the binding in a nested block. */
    test('a blocking await reusing a prop name renders (no temporal-dead-zone crash)', async () => {
        const render = component(`
            <script>
                import { props } from '@abide/abide/ui/props'
                const { foo } = props()
            </script>
            {#await foo then foo}<span>{foo.label}</span>{/await}
        `).render
        const { html } = await render({ foo: () => Promise.resolve({ label: 'RESOLVED' }) })
        expect(html).toContain('<span>RESOLVED</span>')
    })

    /* The binding must SHADOW a same-named component signal — read the resolved value, not
       the (unresolved) signal it shadows. The pre-fix SSR lowered the branch body's `foo`
       to `model.read("foo/label")` (the pending promise) → `undefined`. */
    test('a blocking await reusing a scope-state name reads the resolved value', async () => {
        const render = component(
            `
            <script>import { state } from '@abide/abide/ui/state'

                const foo = state(make())
            </script>
            {#await foo then foo}<span>{foo.label}</span>{/await}
        `,
            { make: () => Promise.resolve({ label: 'RESOLVED' }) },
        ).render
        const { html } = await render()
        expect(html).toContain('<span>RESOLVED</span>')
    })

    /* Same shadow rule for the streaming form (`{:then foo}`): the settled fragment binds
       `foo` as the renderer's arrow parameter, so the body reads the value, not the signal. */
    test('a streaming await reusing a scope-state name reads the resolved value', async () => {
        const render = component(
            `
            <script>import { state } from '@abide/abide/ui/state'

                const foo = state(make())
            </script>
            {#await foo}<p>load</p>{:then foo}<span>{foo.label}</span>{/await}
        `,
            { make: () => Promise.resolve({ label: 'RESOLVED' }) },
        ).render
        const html = await streamToString(() => render())
        expect(html).toContain('<span>RESOLVED</span>')
    })

    /* The catch binding shadows a same-named signal too — it reads the caught rejection,
       not the signal. The pre-fix SSR lowered the catch body's `err` to `model.read("err")`. */
    test('a streaming await catch binding reusing a scope-state name reads the error', async () => {
        const render = component(
            `
            <script>import { state } from '@abide/abide/ui/state'

                const err = state('STATE')
            </script>
            {#await boom()}<p>load</p>{:then v}<span>{v}</span>{:catch err}<b>{err}</b>{/await}
        `,
            { boom: () => Promise.reject('BOOM') },
        ).render
        const html = await streamToString(() => render())
        expect(html).toContain('<b>BOOM</b>')
        expect(html).not.toContain('STATE')
    })

    /* `finally` does NOT bind the resolved value, so a `{:finally}` expression naming the
       same identifier as the `then` binding must read the component signal, not the resolved
       local. The pre-fix SSR rendered the blocking then-branch's finally INSIDE the `then`
       shadow (unlike the catch branch), so `foo` read the resolved value instead of the signal. */
    test('a blocking await finally reading a then-bound name reads the signal, not the value', async () => {
        const render = component(
            `
            <script>import { state } from '@abide/abide/ui/state'

                const foo = state('STATE')
            </script>
            {#await make() then foo}<span>{foo.label}</span>{:finally}<i>{foo}</i>{/await}
        `,
            { make: () => Promise.resolve({ label: 'RESOLVED' }) },
        ).render
        const { html } = await render()
        expect(html).toContain('<span>RESOLVED</span>')
        expect(html).toContain('<i>STATE</i>')
    })

    /* Same for the streaming form's settled renderer: finally is lowered OUTSIDE the binding
       shadow, so it reads the signal, not the renderer's arrow parameter. */
    test('a streaming await finally reading a then-bound name reads the signal, not the value', async () => {
        const render = component(
            `
            <script>import { state } from '@abide/abide/ui/state'

                const foo = state('STATE')
            </script>
            {#await make()}<p>load</p>{:then foo}<span>{foo.label}</span>{:finally}<i>{foo}</i>{/await}
        `,
            { make: () => Promise.resolve({ label: 'RESOLVED' }) },
        ).render
        const html = await streamToString(() => render())
        expect(html).toContain('<span>RESOLVED</span>')
        expect(html).toContain('<i>STATE</i>')
    })
})

describe('a {#try} catch binding named like a component signal', () => {
    /* Same plain-shadow rule for a sync error boundary: the `catch (err)` binding shadows a
       same-named signal and reads the caught error. The pre-fix SSR lowered the catch body to
       `model.read("err")` (the signal), client and server agreeing but both wrong. */
    test('the catch binding shadows a same-named state and reads the error', async () => {
        const render = component(
            `
            <script>import { state } from '@abide/abide/ui/state'

                const err = state('STATE')
            </script>
            {#try}<p>{boom()}</p>{:catch err}<b>{err}</b>{/try}
        `,
            {
                boom: () => {
                    throw new Error('BOOM')
                },
            },
        ).render
        const { html } = await render()
        expect(html).toContain('BOOM')
        expect(html).not.toContain('STATE')
    })
})

describe('a {#for} row binding named like a component signal', () => {
    /* The same root cause as the `await` binding: SSR lowers the row body as a separate
       parse, so a row item/index name that shadows a component signal was lowered to the
       (whole-list) signal read — `model.read("row/label")` — instead of the loop variable.
       The pre-fix SSR rendered the shadowed signal; the client read the loop item, so the
       two DIVERGED. `withLocalPlain` registers the row locals so SSR reads the loop value. */
    test('the row item shadows a same-named state and reads the loop value', async () => {
        const render = component(`
            <script>import { state } from '@abide/abide/ui/state'

                const row = state('STATE')
                const rows = state([{ label: 'A' }, { label: 'B' }])
            </script>
            <ul>{#for row of rows by row.label}<li>{row.label}</li>{/for}</ul>
        `).render
        const { html } = await render()
        expect(html).toContain('<li>A</li>')
        expect(html).toContain('<li>B</li>')
        expect(html).not.toContain('STATE')
    })

    test('the row index shadows a same-named state and reads the loop position', async () => {
        const render = component(`
            <script>import { state } from '@abide/abide/ui/state'

                const i = state(99)
                const rows = state(['a', 'b'])
            </script>
            <ul>{#for r, i of rows}<li>{i}:{r}</li>{/for}</ul>
        `).render
        const { html } = await render()
        expect(html).toContain('<li>0:a</li>')
        expect(html).toContain('<li>1:b</li>')
        expect(html).not.toContain('99')
    })
})

describe('slot content shares the page block-id counter (depth-first)', () => {
    /* #1: a child with a blocking await BEFORE its `<slot>`, mounted with async slot content
       (its own blocking await). The client builds slot content lazily AT the `<slot>`, so it
       numbers the child's pre-slot await first (id 0) and the slot's after (id 1). The pre-fix
       SSR eagerly pre-resolved the slot before the child render, numbering them in the OPPOSITE
       order — so the resume manifest mis-keyed and hydration adopted the wrong branch. */
    test('the child await numbers before the slot await', async () => {
        const Child = component(`
            <script>import { props } from '@abide/abide/ui/props'
import type { Snippet } from '@abide/abide/shared/snippet'
let load = () => Promise.resolve('CV')
const { children } = props<{ children: Snippet }>()</script>
            <div>
                {#await load() then v}<b>{v}</b>{/await}
                {children()}
            </div>
        `)
        const render = component(
            `
            <script>let slotLoad = () => Promise.resolve('SV')</script>
            <Child>
                {#await slotLoad() then x}<em>{x}</em>{/await}
            </Child>
        `,
            { Child },
        ).render
        const result = await render()
        // child's await renders before the slot's, in source order.
        expect(result.html.indexOf('<b>CV</b>')).toBeLessThan(result.html.indexOf('<em>SV</em>'))
        // depth-first ids: child await = 0 (before the slot), slot await = 1.
        expect(result.resume).toEqual({
            0: { ok: true, value: 'CV' },
            1: { ok: true, value: 'SV' },
        })
    })
})

describe('readCall guards a non-callable member (#6)', () => {
    test('a present receiver whose member is not a function throws in authored terms', () => {
        expect(() => readCall({ items: 5 }, 'items', 'frobnicate', [])).toThrow(
            'abide: cannot call .frobnicate() — "items".frobnicate is not a function',
        )
    })
    test('a nullish receiver still names the scope path', () => {
        expect(() => readCall(undefined, 'draft', 'trim', [])).toThrow(
            'abide: cannot call .trim() — scope value "draft" is undefined',
        )
    })
    test('the receiver binding is preserved', () => {
        const target = {
            n: 10,
            get(this: { n: number }) {
                return this.n
            },
        }
        expect(readCall(target, 'target', 'get', [])).toBe(10)
    })
})

describe('restProps tolerates plain-value props (#9)', () => {
    test('child thunk props unwrap; consumed and children are excluded', () => {
        const rest = restProps({ a: () => 1, b: () => 2, children: () => 'x' } as never, ['a'])
        expect(rest.b).toBe(2)
        expect('a' in rest).toBe(false)
        expect('children' in rest).toBe(false)
    })
    test('a page/layout plain-string param map is returned as-is, not called', () => {
        const rest = restProps({ id: '42', slug: 'hi' } as never, [])
        expect(rest.id).toBe('42')
        expect(Object.keys(rest).sort()).toEqual(['id', 'slug'])
    })
})
