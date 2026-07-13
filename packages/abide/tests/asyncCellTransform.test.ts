import { beforeAll, describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { computed } from '../src/lib/ui/computed.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { attr } from '../src/lib/ui/dom/attr.ts'
import { on } from '../src/lib/ui/dom/on.ts'
import { readCell } from '../src/lib/ui/dom/readCell.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { linked } from '../src/lib/ui/linked.ts'
import { createDoc as doc } from '../src/lib/ui/runtime/createDoc.ts'
import { state } from '../src/lib/ui/state.ts'
import { installMiniDom } from './support/installMiniDom.ts'
import { text } from './support/reactiveText.ts'
import { settle } from './support/settle.ts'

beforeAll(() => {
    installMiniDom()
})

/* Mounts a compiled client body — the async-cell variant of the linked-transform harness,
   with `readCell` (→ `$$readCell`) injected so a lowered cell read resolves. Returns the host
   and the component's `$$model` doc (from the plain `state(...)` slots). */
function mountClient(source: string): { host: HTMLElement; $$model: ReturnType<typeof doc> } {
    const host = document.createElement('div')
    const $$model = new Function(
        'host',
        'doc',
        'state',
        'linked',
        'computed',
        'readCell',
        'text',
        'appendText',
        'appendStatic',
        'attr',
        'on',
        'effect',
        `${compileComponent(source)}\nreturn typeof $$model !== 'undefined' ? $$model : undefined;`,
    )(
        host,
        doc,
        state,
        linked,
        computed,
        readCell,
        text,
        appendText,
        appendStatic,
        attr,
        on,
        effect,
    ) as ReturnType<typeof doc>
    return { host, $$model }
}

describe('async-cell wrap transform — lowering forms', () => {
    test('an `await`-seed computed routes to the eager async cell, read via $$readCell', () => {
        const body = compileComponent(`
            <script>
                import { state } from '@abide/abide/ui/state'
                const v = state.computed(await Promise.resolve(1))
            </script>
            <p>{v}</p>
        `)
        // the bare `await` expr is wrapped as an async thunk, routed to the eager async cell with
        // the BLOCKING tier flag (ADR-0042 D6: `await` present → `, false`)
        expect(body).toContain(
            'const v = $$scope().trackedComputed(async () => await Promise.resolve(1), false)',
        )
        // a blocking cell reads through the SUSPENDING cell read, NOT the lazy `v()` derive reader
        expect(body).toContain('$$readCellBlocking(v)')
        expect(body).not.toContain('v()')
    })

    test('a BARE-expression computed wraps into a sync `derive` (proves the wrap predicate)', () => {
        const body = compileComponent(`
            <script>
                import { state } from '@abide/abide/ui/state'
                let a = state(1)
                let b = state(2)
                const t = state.computed(a + b)
            </script>
            <p>{t}</p>
        `)
        // wrapped as a sync thunk over the reads → the unchanged lazy derive slot
        expect(body).toContain(
            'const t = $$scope().derive("t", () => $$model.read("a") + $$model.read("b"))',
        )
        expect(body).toContain('t()') // read as the string-free reader, not $$readCell
        expect(body).not.toContain('$$readCell(t)')
    })

    test('a literal-thunk computed passes through unchanged and stays a lazy derive', () => {
        const body = compileComponent(`
            <script>
                import { state } from '@abide/abide/ui/state'
                let a = state(1)
                let b = state(2)
                const u = state.computed(() => a + b)
            </script>
            <p>{u}</p>
        `)
        expect(body).toContain(
            'const u = $$scope().derive("u", () => $$model.read("a") + $$model.read("b"))',
        )
        expect(body).toContain('u()')
    })

    test('a bare-call computed routes to the eager `trackedComputed` (stream auto-track)', () => {
        const body = compileComponent(`
            <script>
                import { state } from '@abide/abide/ui/state'
                const frames = state.computed(getStream())
            </script>
            <p>{frames}</p>
        `)
        // a bare call (a potential stream/promise producer) → the eager classifying entry
        expect(body).toContain('const frames = $$scope().trackedComputed(() => getStream())')
        // read through the unified cell read (it peeks whatever the runtime resolved)
        expect(body).toContain('$$readCell(frames)')
        expect(body).not.toContain('frames()')
    })

    test('a linked with an `await` seed routes to a writable async cell', () => {
        const body = compileComponent(`
            <script>
                import { state } from '@abide/abide/ui/state'
                const s = state.linked(await Promise.resolve('x'))
            </script>
            <p>{s}</p>
        `)
        expect(body).toContain("const s = $$scope().linked(async () => await Promise.resolve('x'))")
        // a blocking `await` linked reads through the suspending cell read (ADR-0042)
        expect(body).toContain('$$readCellBlocking(s)')
    })
})

describe('async-cell wrap transform — runtime behavior', () => {
    test('an `await`-seed computed peeks its resolved value after settle', async () => {
        const { host } = mountClient(`
            <script>
                import { state } from '@abide/abide/ui/state'
                const v = state.computed(await Promise.resolve(1))
            </script>
            <p>{v}</p>
        `)
        await settle()
        expect(host.textContent).toContain('1')
    })

    test('an `await`-seed linked peeks its resolved value after settle', async () => {
        const { host } = mountClient(`
            <script>
                import { state } from '@abide/abide/ui/state'
                const s = state.linked(await Promise.resolve('hi'))
            </script>
            <p>{s}</p>
        `)
        await settle()
        expect(host.textContent).toContain('hi')
    })

    test('a bare-expression computed works as a normal reactive sync computed', () => {
        const { host, $$model } = mountClient(`
            <script>
                import { state } from '@abide/abide/ui/state'
                let a = state(1)
                let b = state(2)
                const t = state.computed(a + b)
            </script>
            <p>{t}</p>
        `)
        expect(host.textContent).toContain('3') // 1 + 2
        $$model.replace('a', 10) // a source change recomputes
        expect(host.textContent).toContain('12') // 10 + 2
    })
})
