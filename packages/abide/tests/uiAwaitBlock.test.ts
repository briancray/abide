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
})
