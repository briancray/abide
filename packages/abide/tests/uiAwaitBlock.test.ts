import { beforeAll, describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { computed } from '../src/lib/ui/computed.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { attr } from '../src/lib/ui/dom/attr.ts'
import { awaitBlock } from '../src/lib/ui/dom/awaitBlock.ts'
import { each } from '../src/lib/ui/dom/each.ts'
import { on } from '../src/lib/ui/dom/on.ts'
import { text } from '../src/lib/ui/dom/text.ts'
import { when } from '../src/lib/ui/dom/when.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { createDoc as doc } from '../src/lib/ui/runtime/createDoc.ts'
import { state } from '../src/lib/ui/state.ts'
import { installMiniDom } from './support/installMiniDom.ts'

beforeAll(() => {
    installMiniDom()
})

function run(source: string, extra: Record<string, unknown> = {}): HTMLElement {
    const names = [
        'host',
        'doc',
        'state',
        'computed',
        'text',
        'appendText',
        'appendStatic',
        'attr',
        'on',
        'each',
        'when',
        'awaitBlock',
        'effect',
    ]
    const runtime: Record<string, unknown> = {
        doc,
        state,
        computed,
        text,
        appendText,
        appendStatic,
        attr,
        on,
        each,
        when,
        awaitBlock,
        effect,
        ...extra,
    }
    const host = document.createElement('div')
    const allNames = [...names, ...Object.keys(extra).filter((k) => !names.includes(k))]
    const args = allNames.map((name) => (name === 'host' ? host : runtime[name]))
    new Function(...allNames, compileComponent(source))(...args)
    return host
}

describe('await block', () => {
    test('shows pending, then resolves to the then branch', async () => {
        const host = run(
            `
            <script>let load = () => Promise.resolve('done')</script>
            <template await={load()}>
                <p>loading</p>
                <template then="value"><span>{value}</span></template>
                <template catch="err"><b>{err}</b></template>
            </template>
        `,
        )
        expect(host.textContent).toBe('loading') // pending shell first
        await Promise.resolve()
        await Promise.resolve()
        expect(host.textContent).toBe('done') // resolved branch
    })

    test('rejection renders the catch branch', async () => {
        const host = run(`
            <script>let load = () => Promise.reject('boom')</script>
            <template await={load()}>
                <p>loading</p>
                <template then="value"><span>{value}</span></template>
                <template catch="err"><b>{err}</b></template>
            </template>
        `)
        await Promise.resolve()
        await Promise.resolve()
        expect(host.textContent).toBe('boom')
    })

    test('a then-branch build does not leak its reactive reads into the await effect', () => {
        // The branch reads `tracker` directly during its (warm-sync) build. Without
        // untracking that build, the read subscribes the AWAIT effect, so a later
        // `tracker` change re-runs the whole block — re-suspending it. It must not.
        let promiseReads = 0
        const tracker = state(0)
        const host = run(
            `
            <script></script>
            <template await={warm()}>
                <template then="value">
                    <script>tracker.value</script>
                    <span>{value}</span>
                </template>
            </template>
        `,
            {
                warm: () => {
                    promiseReads += 1
                    return 'ready' // warm-sync (non-thenable) → branch builds synchronously
                },
                tracker,
            },
        )
        expect(promiseReads).toBe(1)
        expect(host.textContent).toBe('ready')
        tracker.value = 1 // a value the then-branch read changed
        expect(promiseReads).toBe(1) // the await did NOT re-run — no leak
    })

    test('a warm-sync value resolves immediately — no pending flash (cache contract)', () => {
        // mimics cache()'s warm read returning a settled value synchronously
        const host = run(`
            <script>let warm = () => 'cached'</script>
            <template await={warm()}>
                <p>loading</p>
                <template then="value"><span>{value}</span></template>
            </template>
        `)
        expect(host.textContent).toBe('cached') // never showed "loading"
    })

    test('re-resolving updates the then-branch IN PLACE — no rebuild, value is reactive', async () => {
        // A reactive source (`n`) in the awaited expression re-runs the await effect when it
        // changes. The then-branch must NOT be torn down and rebuilt (that flashes every node
        // it owns); instead the resolved value is a reactive cell the branch reads, so the
        // branch's own effects update in place. `<i>` is a stable marker: same node === no
        // rebuild. `builds` counts branch builds: it must stay 1.
        let builds = 0
        const n = state(0)
        const host = run(
            `
            <script></script>
            <template await={make(n.value)}>
                <template then="value">
                    <script>mark()</script>
                    <i></i><span>{value}</span>
                </template>
            </template>
        `,
            {
                make: (value: number) => Promise.resolve(value),
                n,
                mark: () => {
                    builds += 1
                },
            },
        )
        await Promise.resolve()
        await Promise.resolve()
        expect(find(host, 'span')?.textContent).toBe('0')
        expect(builds).toBe(1)
        const marker = find(host, 'i')
        n.value = 7
        await Promise.resolve()
        await Promise.resolve()
        expect(find(host, 'span')?.textContent).toBe('7') // reactive value updated
        expect(find(host, 'i')).toBe(marker) // same node → built once, updated in place
        expect(builds).toBe(1)
    })

    test('re-resolving updates a DESTRUCTURED then binding in place, per-leaf', async () => {
        // The grid awaits `Promise.all([...])` and destructures `then="[a, b]"`. A re-settle
        // must update each leaf reactively without rebuilding the branch: `<i>` keeps identity,
        // and only the leaves whose value changed repaint.
        let builds = 0
        const n = state(0)
        const host = run(
            `
            <script></script>
            <template await={make(n.value)}>
                <template then="[a, b]">
                    <script>mark()</script>
                    <i></i><span>{a}</span><b>{b}</b>
                </template>
            </template>
        `,
            {
                make: (value: number) => Promise.resolve([value, 'fixed']),
                n,
                mark: () => {
                    builds += 1
                },
            },
        )
        await Promise.resolve()
        await Promise.resolve()
        expect(find(host, 'span')?.textContent).toBe('0')
        expect(find(host, 'b')?.textContent).toBe('fixed')
        const marker = find(host, 'i')
        n.value = 9
        await Promise.resolve()
        await Promise.resolve()
        expect(find(host, 'span')?.textContent).toBe('9') // changed leaf updated
        expect(find(host, 'b')?.textContent).toBe('fixed') // unchanged leaf intact
        expect(find(host, 'i')).toBe(marker) // built once, updated in place
        expect(builds).toBe(1)
    })

    test('a then-binding named like a component state SHADOWS the state, reading the resolved value', async () => {
        // `value` is BOTH a component state and the then binding. Inside the then branch
        // `{value.label}` is a nearer lexical scope, so it must read the RESOLVED value's
        // cell (the awaited object), not `model.value` — without the block-local shadow it
        // would lower to the component state and render 'STATE'.
        const host = run(
            `
            <script>
            const value = scope().state({ label: 'STATE' })
            </script>
            <template await={make()}>
                <template then="value">
                    <span>{value.label}</span>
                </template>
            </template>
        `,
            { make: () => Promise.resolve({ label: 'RESOLVED' }) },
        )
        await Promise.resolve()
        await Promise.resolve()
        expect(find(host, 'span')?.textContent).toBe('RESOLVED')
    })
})

/* First descendant element with the given tag name (miniDom has no querySelector). */
type DomLike = { childNodes: ArrayLike<unknown>; tagName?: string; textContent?: string | null }
function find(node: DomLike, tag: string): DomLike | undefined {
    for (let index = 0; index < node.childNodes.length; index += 1) {
        const child = node.childNodes[index] as DomLike
        if (child.tagName === tag.toUpperCase() || child.tagName === tag) {
            return child
        }
        const nested = find(child, tag)
        if (nested !== undefined) {
            return nested
        }
    }
    return undefined
}
