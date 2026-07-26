// A `watch` in a component `<script>` is that component's lifecycle: setup is the script body, cleanup
// is the teardown the watch returns. There is no `onMount`/`onDestroy` in the grammar (§C4.5), so the
// only thing that makes cleanup real is the emitted `mount` OWNING the effects its setup preamble
// created — an unmount ({#if} flipping false, a nav, a keyed {#for} dropping an item) must fire them.

import { describe, expect, test } from 'bun:test'
import { state } from '../../shared/state.ts'
import { watch } from '../../shared/watch.ts'
import { type ComponentResolver, loadEmitted } from './emit.ts'

const tick = () => Promise.resolve()

const CHILD =
    `<script>` +
    `import { state } from "abide/shared/state"; ` +
    `import { watch } from "abide/shared/watch"; ` +
    `let n = state(0); ` +
    `watch(() => { const at = n; globalThis.$events.push("run:" + at); return () => globalThis.$events.push("clean:" + at) })` +
    `</script>` +
    `<button data-testid="bump" onclick={() => n++}>bump</button>`

const PAGE =
    `<script>` +
    `import { state } from "abide/shared/state"; ` +
    `import Child from "./Child.abide"; ` +
    `let show = state(true)` +
    `</script>` +
    `<div>{#if show}<Child/>{/if}</div>` +
    `<button data-testid="hide" onclick={() => show = false}>hide</button>`

const resolve: ComponentResolver = (source) => (source === './Child.abide' ? CHILD : undefined)

describe('a `<script>` watch tears down with its component', () => {
    test('teardown runs before each re-run, and again on unmount', async () => {
        const events: string[] = []
        ;(globalThis as unknown as { $events: string[] }).$events = events
        const emitted = await loadEmitted(PAGE, resolve)
        const host = document.createElement('div')
        emitted.mount(host, { state, watch })
        expect(events).toEqual(['run:0'])

        const bump = host.querySelector('[data-testid="bump"]') as HTMLButtonElement
        bump.click()
        await tick()
        await tick()
        expect(events).toEqual(['run:0', 'clean:0', 'run:1'])

        const hide = host.querySelector('[data-testid="hide"]') as HTMLButtonElement
        hide.click()
        await tick()
        await tick()
        // The component is gone: its watch is disposed, so the last teardown has fired.
        expect(events).toEqual(['run:0', 'clean:0', 'run:1', 'clean:1'])

        // And it is DETACHED — the dead component's effect never runs again.
        bump.click()
        await tick()
        await tick()
        expect(events).toEqual(['run:0', 'clean:0', 'run:1', 'clean:1'])
    })
})
