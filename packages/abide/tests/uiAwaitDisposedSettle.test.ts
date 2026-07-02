import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { computed } from '../src/lib/ui/computed.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { attr } from '../src/lib/ui/dom/attr.ts'
import { awaitBlock } from '../src/lib/ui/dom/awaitBlock.ts'
import { each } from '../src/lib/ui/dom/each.ts'
import { mount } from '../src/lib/ui/dom/mount.ts'
import { text } from '../src/lib/ui/dom/text.ts'
import { when } from '../src/lib/ui/dom/when.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { createDoc as doc } from '../src/lib/ui/runtime/createDoc.ts'
import { state } from '../src/lib/ui/state.ts'
import { installHappyDom } from './support/installHappyDom.ts'

/*
An await block whose enclosing scope is disposed while its promise is still in flight
must NOT settle onto its now-detached anchor. The block's `.then` guards `gen ===
generation` (a newer run supersedes an older in-flight promise), but disposal does not
bump `generation` and the raw promise callback isn't group-tracked — so before the fix
a promise that resolved AFTER an enclosing `{#if}`/`{#for}`/component teardown still
ran `settleThen` → `place`, inserting a fresh fragment before an anchor no longer in
the DOM: `insertBefore` throws `NotFoundError` (the "reference node is not a child"
DOMException). Runs under happy-dom because the mini-dom's insertBefore enforces the
same parentage invariant but this is the real-parser lane the browser uses.
*/
let reset: () => void
beforeAll(() => {
    reset = installHappyDom()
})
afterAll(() => reset())

const RUNTIME = {
    doc,
    state,
    computed,
    effect,
    appendText,
    appendStatic,
    attr,
    text,
    each,
    when,
    awaitBlock,
    mount,
}

function component(source: string, extra: Record<string, unknown> = {}) {
    const clientBody = compileComponent(source)
    const runtime = { ...RUNTIME, ...extra }
    const names = Object.keys(runtime)
    const values = names.map((n) => runtime[n as keyof typeof runtime])
    return (host: Element, props?: unknown) =>
        new Function('host', '$props', ...names, clientBody)(host, props, ...values)
}

const flush = async (): Promise<void> => {
    for (let i = 0; i < 6; i += 1) {
        await Promise.resolve()
    }
}

describe('await block: disposed-while-in-flight settle', () => {
    /* The minimal shape: an in-flight await inside an `{#if}` toggled off before the
       promise resolves — the resolution must be dropped, not crash on the dead anchor. */
    test('an {#if} toggled off mid-flight drops the late resolution instead of crashing', async () => {
        let resolveIt: (value: string) => void = () => {}
        const slow = () => new Promise<string>((resolve) => (resolveIt = resolve))
        const Comp = component(
            `
            <script>let show = scope().state(true)</script>
            {#if show}{#await slow() then value}<span>{value}</span>{/await}{/if}
            <button onclick={() => { show = false }}>toggle</button>
        `,
            { slow },
        )
        const host = document.createElement('div')
        Comp(host)

        // tear the branch down while the promise is still pending
        host.querySelector('button')?.dispatchEvent(new Event('click'))
        await Promise.resolve()

        // the late resolution lands on a disposed block — must be a no-op, not a throw
        resolveIt('LATE')
        await flush()

        expect(host.textContent).not.toContain('LATE') // the dead branch never rendered
    })

    /* A nested pair: the OUTER resolves and builds the INNER (in-flight), then the
       enclosing `{#if}` tears the whole thing out before the inner settles. */
    test('a nested inner await dropped by an enclosing teardown does not crash', async () => {
        let resolveInner: (value: string) => void = () => {}
        const outer = () => Promise.resolve('OUT')
        const inner = () => new Promise<string>((resolve) => (resolveInner = resolve))
        const Comp = component(
            `
            <script>let show = scope().state(true)</script>
            {#if show}
                {#await outer() then o}<b>{o}</b>{#await inner() then i}<span>{i}</span>{/await}{/await}
            {/if}
            <button onclick={() => { show = false }}>toggle</button>
        `,
            { outer, inner },
        )
        const host = document.createElement('div')
        Comp(host)
        await flush() // let the outer resolve and mount the inner (inner still pending)

        host.querySelector('button')?.dispatchEvent(new Event('click')) // tear it all out
        await Promise.resolve()

        resolveInner('LATE') // zombie inner settle
        await flush()

        expect(host.textContent).not.toContain('LATE')
    })
})
