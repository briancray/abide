import { describe, expect, test } from 'bun:test'
import { compileModule } from '../src/lib/ui/compile/compileModule.ts'
import { UI_RUNTIME_IMPORTS } from '../src/lib/ui/compile/UI_RUNTIME_IMPORTS.ts'

const LEAF = `<script>let n = scope().state(0)</script>
<button on:click={n++}>count {n}</button>`

describe('compileModule — hot mode', () => {
    const { code: hot } = compileModule(LEAF, { moduleId: 'Counter.abide', hot: true })

    test('sources the runtime from the live bundle via window.__abide', () => {
        expect(hot).toContain('= window.__abide')
        // Every runtime name the body may reference is destructured, plus hotReplace.
        for (const { name } of UI_RUNTIME_IMPORTS) {
            expect(hot).toContain(name)
        }
        expect(hot).toContain('hotReplace')
        // No static runtime imports — it must not pull a fresh copy of the graph.
        expect(hot).not.toContain("from '@abide/abide/ui")
    })

    test('hands the new factory to hotReplace, reloads if nothing swapped; no SSR/export', () => {
        expect(hot).toContain('component.__abideId = "Counter.abide"')
        expect(hot).toContain('if (!hotReplace("Counter.abide", component)) location.reload()')
        expect(hot).not.toContain('export default')
        expect(hot).not.toContain('export function render')
        expect(hot).not.toContain('hydrateInto')
    })
})

describe('compileModule — normal mode unchanged', () => {
    const { code: normal } = compileModule(LEAF, { moduleId: 'Counter.abide' })

    test('still emits static imports, the default export, and render', () => {
        expect(normal).toContain("import { mount as $$mount } from '@abide/abide/ui/dom/mount'")
        expect(normal).toContain('export default function component(host, $props)')
        expect(normal).toContain('export function render($props, $ctx)')
        expect(normal).toContain('component.__abideId = "Counter.abide"')
        expect(normal).not.toContain('window.__abide')
    })
})
