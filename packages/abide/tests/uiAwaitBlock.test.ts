import { beforeAll, describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { derived } from '../src/lib/ui/derived.ts'
import { doc } from '../src/lib/ui/doc.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { attr } from '../src/lib/ui/dom/attr.ts'
import { awaitBlock } from '../src/lib/ui/dom/awaitBlock.ts'
import { each } from '../src/lib/ui/dom/each.ts'
import { on } from '../src/lib/ui/dom/on.ts'
import { text } from '../src/lib/ui/dom/text.ts'
import { when } from '../src/lib/ui/dom/when.ts'
import { effect } from '../src/lib/ui/effect.ts'
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
        'derived',
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
        derived,
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
