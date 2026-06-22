import { beforeAll, describe, expect, test } from 'bun:test'
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
   plus each fragment's delta) into one id → value manifest. */
function resumeManifest(html: string): Record<string, ResumeEntry> {
    const merged: Record<string, ResumeEntry> = {}
    for (const match of html.matchAll(
        /window\.__abideResume\|\|\{\},(\{[\s\S]*?\})\)<\/script>/g,
    )) {
        Object.assign(merged, JSON.parse(match[1]))
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
            <template name="a"><span>{b()}</span></template>
            <template name="b"><Kid /></template>
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
            <template name="row$"><Kid /></template>
            <div>{row$()}</div>
        `,
            { Kid },
        ).render
        const { html } = await render()
        expect(html).toContain('<i>kid</i>')
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
                <template await={outer()}>
                    <p>outer-pending</p>
                    <template then="o">
                        <b>{o}</b>
                        <template await={inner()}>
                            <p>inner-pending</p>
                            <template then="i"><span>{i}</span></template>
                        </template>
                    </template>
                </template>
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
                <template await={outer()}>
                    <p>pending</p>
                    <template then="o">
                        <b>{o}</b>
                        <template await={inner()} then="i"><span>{i}</span></template>
                    </template>
                </template>
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

describe('slot content shares the page block-id counter (depth-first)', () => {
    /* #1: a child with a blocking await BEFORE its `<slot>`, mounted with async slot content
       (its own blocking await). The client builds slot content lazily AT the `<slot>`, so it
       numbers the child's pre-slot await first (id 0) and the slot's after (id 1). The pre-fix
       SSR eagerly pre-resolved the slot before the child render, numbering them in the OPPOSITE
       order — so the resume manifest mis-keyed and hydration adopted the wrong branch. */
    test('the child await numbers before the slot await', async () => {
        const Child = component(`
            <script>let load = () => Promise.resolve('CV')</script>
            <div>
                <template await={load()} then="v"><b>{v}</b></template>
                <slot></slot>
            </div>
        `)
        const render = component(
            `
            <script>let slotLoad = () => Promise.resolve('SV')</script>
            <Child>
                <template await={slotLoad()} then="x"><em>{x}</em></template>
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
    test('child thunk props unwrap; consumed and $children are excluded', () => {
        const rest = restProps({ a: () => 1, b: () => 2, $children: () => 'x' } as never, ['a'])
        expect(rest.b).toBe(2)
        expect('a' in rest).toBe(false)
        expect('$children' in rest).toBe(false)
    })
    test('a page/layout plain-string param map is returned as-is, not called', () => {
        const rest = restProps({ id: '42', slug: 'hi' } as never, [])
        expect(rest.id).toBe('42')
        expect(Object.keys(rest).sort()).toEqual(['id', 'slug'])
    })
})
