import { beforeAll, describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { computed } from '../src/lib/ui/computed.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { attr } from '../src/lib/ui/dom/attr.ts'
import { awaitBlock } from '../src/lib/ui/dom/awaitBlock.ts'
import { each } from '../src/lib/ui/dom/each.ts'
import { hydrate } from '../src/lib/ui/dom/hydrate.ts'
import { on } from '../src/lib/ui/dom/on.ts'
import { switchBlock } from '../src/lib/ui/dom/switchBlock.ts'
import { when } from '../src/lib/ui/dom/when.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { createDoc as doc } from '../src/lib/ui/runtime/createDoc.ts'
import type { SsrRender } from '../src/lib/ui/runtime/types/SsrRender.ts'
import { state } from '../src/lib/ui/state.ts'
import { installMiniDom } from './support/installMiniDom.ts'

beforeAll(() => {
    installMiniDom()
})

/* A probe a scoped <script>'s effect can call, so tests can observe effect runs
   (and confirm SSR strips them — record is never called server-side). */
let effectLog: unknown[] = []
const record = (value: unknown): void => {
    effectLog.push(value)
}

const RUNTIME = {
    doc,
    state,
    computed,
    effect,
    appendText,
    appendStatic,
    attr,
    on,
    when,
    switchBlock,
    awaitBlock,
    each,
    record,
}

function ssr(source: string, $$model: unknown): SsrRender {
    const names = [...Object.keys(RUNTIME), '$$model']
    const values = [...Object.values(RUNTIME), $$model]
    return new Function(...names, compileSSR(source))(...values) as SsrRender
}

function run(source: string, host: Element, $$model: unknown, mode: 'mount' | 'hydrate'): void {
    const names = ['host', ...Object.keys(RUNTIME), '$$model']
    const body = compileComponent(source)
    const fn = (target: Element) => {
        new Function(...names, body)(target, ...Object.values(RUNTIME), $$model)
    }
    if (mode === 'hydrate') {
        hydrate(host, fn)
    } else {
        fn(host)
    }
}

describe('scoped <script> in a control-flow branch', () => {
    /* An `if` branch declares a PLAIN local signal seeded from in-scope doc data;
       its markup auto-derefs the binding, like a `computed`. */
    const IF = `<main>{#if $$model.on}<script>let n = state($$model.base)</script><p>{n}</p><button onclick={() => (n = n + 1)}>+</button>{/if}</main>`

    test('SSR renders the branch-local signal seeded from doc data', () => {
        expect(ssr(IF, doc({ on: true, base: 5 })).html).toBe(
            '<main><!--a--><!--[--><p>5</p><button>+</button><!--]--></main>',
        )
        expect(ssr(IF, doc({ on: false, base: 5 })).html).toBe(
            '<main><!--a--><!--[--><!--]--></main>',
        )
    })

    test('client mount: the local signal is reactive, and re-seeds on re-entry', () => {
        const $$model = doc({ on: true, base: 5 })
        const host = document.createElement('div')
        run(IF, host, $$model, 'mount')
        const main = host.childNodes[0] as unknown as {
            textContent: string
            children: { dispatchEvent: (e: Event) => void }[]
        }
        const button = main.children[1] // [0] is <p>, [1] is <button> (markers excluded)
        expect(main.textContent).toBe('5+')

        button.dispatchEvent(new (globalThis as { Event: typeof Event }).Event('click'))
        expect(main.textContent).toBe('6+') // local signal mutated

        // leaving and re-entering the branch drops the old signal, re-seeds from doc
        $$model.replace('on', false)
        expect(main.textContent).toBe('')
        $$model.replace('on', true)
        expect(main.textContent).toBe('5+') // fresh signal, increment gone
    })

    test('hydration adopts the branch in place, then stays reactive', () => {
        const $$model = doc({ on: true, base: 5 })
        const host = document.createElement('div')
        host.innerHTML = ssr(IF, $$model).html
        const main = host.childNodes[0] as unknown as {
            textContent: string
            children: { dispatchEvent: (e: Event) => void }[]
        }
        const pBefore = main.children[0]

        run(IF, host, $$model, 'hydrate')
        expect(main.children[0]).toBe(pBefore) // adopted, not recreated
        expect(main.textContent).toBe('5+')

        const button = main.children[1]
        button.dispatchEvent(new (globalThis as { Event: typeof Event }).Event('click'))
        expect(main.textContent).toBe('6+')
    })

    test('a switch case carries its own scoped signal', () => {
        const SWITCH = `<main>{#switch $$model.k}{:case 'a'}<script>let label = state($$model.base + '!')</script><span>{label}</span>{:default}<b>?</b>{/switch}</main>`
        expect(ssr(SWITCH, doc({ k: 'a', base: 'hi' })).html).toBe(
            '<main><!--a--><!--[--><span>hi!</span><!--]--></main>',
        )

        const $$model = doc({ k: 'a', base: 'hi' })
        const host = document.createElement('div')
        run(SWITCH, host, $$model, 'mount')
        expect(host.textContent).toBe('hi!')
        $$model.replace('k', 'z')
        expect(host.textContent).toBe('?')
    })

    /* Each row gets its OWN scoped signal, seeded from that row's item — per-row
       local state, isolated row to row. */
    const EACH = `<ul>{#for item of $$model.items by item.id}<script>let n = state(item.base * 10)</script><li><button onclick={() => (n = n + 1)}>{n}</button></li>{/for}</ul>`

    test('SSR seeds each row independently', () => {
        expect(
            ssr(
                EACH,
                doc({
                    items: [
                        { id: 'a', base: 1 },
                        { id: 'b', base: 2 },
                    ],
                }),
            ).html,
        ).toBe(
            '<ul><!--a--><!--[--><li><button>10</button></li><!--]--><!--[--><li><button>20</button></li><!--]--></ul>',
        )
    })

    test('client mount: rows hold isolated, reactive per-row state', () => {
        const $$model = doc({
            items: [
                { id: 'a', base: 1 },
                { id: 'b', base: 2 },
            ],
        })
        const host = document.createElement('div')
        run(EACH, host, $$model, 'mount')
        const ul = host.childNodes[0] as unknown as {
            children: {
                children: { dispatchEvent: (e: Event) => void; textContent: string }[]
            }[]
        }
        // each row is a marker-bounded range; `children` skips the markers to the <li>
        const rowButton = (index: number) => ul.children[index].children[0]
        expect(rowButton(0).textContent).toBe('10')
        expect(rowButton(1).textContent).toBe('20')

        rowButton(0).dispatchEvent(new (globalThis as { Event: typeof Event }).Event('click'))
        expect(rowButton(0).textContent).toBe('11') // only row a's signal moved
        expect(rowButton(1).textContent).toBe('20')
    })

    /* A branch-scoped `effect` is owned by the branch's render scope: it runs on
       mount, re-runs on its deps, and disposes when the branch leaves. */
    const FX = `<main>{#if $$model.on}<script>let n = state($$model.base)
effect(() => record(n + ':' + $$model.base))</script><button onclick={() => (n = n + 1)}>{n}</button>{/if}</main>`

    test('client: branch effect runs, is reactive, disposes on leave, re-seeds', () => {
        effectLog = []
        const $$model = doc({ on: true, base: 5 })
        const host = document.createElement('div')
        run(FX, host, $$model, 'mount')
        expect(effectLog).toEqual(['5:5']) // ran on mount

        $$model.replace('base', 9)
        expect(effectLog).toEqual(['5:5', '5:9']) // re-ran on its doc dep

        $$model.replace('on', false) // branch leaves → effect disposed
        $$model.replace('base', 100) // a disposed effect must NOT re-run
        expect(effectLog).toEqual(['5:5', '5:9'])

        $$model.replace('on', true) // re-enter → a fresh effect, n re-seeded from base
        expect(effectLog).toEqual(['5:5', '5:9', '100:100'])
    })

    test('SSR strips the effect — it never runs server-side', () => {
        effectLog = []
        const html = ssr(FX, doc({ on: true, base: 5 })).html
        expect(html).toBe('<main><!--a--><!--[--><button>5</button><!--]--></main>') // markup still seeded
        expect(effectLog).toEqual([]) // effect body did not run
    })

    /* The headline case: a `then` branch declares state computed from the resolved
       value — the ergonomic that top-level await gave, without async ownership. */
    test('await then: scoped state seeded from the resolved value', async () => {
        const AWAIT = `<main>{#await $$model.load}<p>loading</p>{:then foo}<script>let a = state(foo.bar)</script><span>{a}</span>{/await}</main>`
        const host = document.createElement('div')
        run(AWAIT, host, doc({ load: Promise.resolve({ bar: 'ready' }) }), 'mount')
        expect(host.textContent).toBe('loading')
        await Promise.resolve()
        await Promise.resolve()
        expect(host.textContent).toBe('ready')
    })
})

describe('scoped <script> directly under a bound element (skeleton path)', () => {
    /* A nested `<script>` under a plain bound element — no control flow — builds through
       the skeleton clone: the script runs as a bind (in document order, before the later
       siblings that deref its signal), and a following sibling's reactive attr/text wire to
       located nodes. The imperative `openChild` path no longer exists, so this exercises the
       unified backend. (The signal is read by a LATER sibling, never the parent's own
       attribute — that would read it before the script's `let` runs, in either backend.) */
    const SRC = `<div><script>let open = state(false)</script><p class={open ? 'on' : 'off'}>{open}</p><button onclick={() => (open = !open)}>x</button></div>`

    test('SSR === client mount for a script under a bound element', () => {
        const server = ssr(SRC, doc({})).html
        const host = document.createElement('div')
        run(SRC, host, doc({}), 'mount')
        const client = (
            globalThis as unknown as { serializeMiniDom: (h: unknown) => string }
        ).serializeMiniDom(host)
        expect(client).toBe(server) // unified backend: server and client agree
        expect(server).toContain('class="off"') // initial signal value seeded both sides
    })

    test('client: the scoped signal stays reactive', () => {
        const host = document.createElement('div')
        run(SRC, host, doc({}), 'mount')
        const div = host.childNodes[0] as unknown as {
            children: { getAttribute: (n: string) => string; dispatchEvent: (e: Event) => void }[]
        }
        expect(div.children[0].getAttribute('class')).toBe('off') // <p>
        div.children[1].dispatchEvent(new (globalThis as { Event: typeof Event }).Event('click'))
        expect(div.children[0].getAttribute('class')).toBe('on') // class thunk re-ran off the local signal
    })

    test('hydration adopts the bound element in place, then stays reactive', () => {
        const server = ssr(SRC, doc({})).html
        const host = document.createElement('div')
        host.innerHTML = server
        run(SRC, host, doc({}), 'hydrate')
        const div = host.childNodes[0] as unknown as {
            children: { getAttribute: (n: string) => string; dispatchEvent: (e: Event) => void }[]
        }
        expect(div.children[0].getAttribute('class')).toBe('off')
        div.children[1].dispatchEvent(new (globalThis as { Event: typeof Event }).Event('click'))
        expect(div.children[0].getAttribute('class')).toBe('on')
    })
})
