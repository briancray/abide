import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { computed } from '../src/lib/ui/computed.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { attr } from '../src/lib/ui/dom/attr.ts'
import { awaitBlock } from '../src/lib/ui/dom/awaitBlock.ts'
import { each } from '../src/lib/ui/dom/each.ts'
import { hydrate } from '../src/lib/ui/dom/hydrate.ts'
import { mount } from '../src/lib/ui/dom/mount.ts'
import { when } from '../src/lib/ui/dom/when.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { createDoc as doc } from '../src/lib/ui/runtime/createDoc.ts'
import { state } from '../src/lib/ui/state.ts'
import { installHappyDom } from './support/installHappyDom.ts'
import { text } from './support/reactiveText.ts'

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
            <script>import { state } from '@abide/abide/ui/state'
let show = state(true)</script>
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
            <script>import { state } from '@abide/abide/ui/state'
let show = state(true)</script>
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

    /* The backstop the generationGuard does not cover: a block whose anchor is pulled out
       of the DOM by an ancestor removal that did NOT dispose this block's scope (so the
       guard's generation is never bumped and `live()` still returns true). Reproduces the
       field crash — a deep nested-await hydration where an aborted `adopt` → `rebuildCold`
       removes an inner range while its in-flight promise stays live. `place` must drop the
       settle instead of `insertBefore`-ing onto a detached anchor (NotFoundError, a
       process-fatal unhandled rejection under Bun). Driven directly against the runtime
       because the guard catches every teardown that goes through scope disposal. */
    test('a settle onto a detached anchor is dropped, not a NotFoundError crash', async () => {
        let resolveIt: (value: string) => void = () => {}
        const host = document.createElement('div')
        mount(host, (target) => {
            /* Pending promise, no pending branch → the block detaches and parks an empty
               text anchor in `target`. */
            awaitBlock(
                target,
                '1',
                () => new Promise<string>((resolve) => (resolveIt = resolve)),
                undefined,
                (parent, value) => {
                    const span = document.createElement('span')
                    span.textContent = String((value as { value: unknown }).value)
                    parent.appendChild(span)
                },
                undefined,
                null,
            )
        })
        /* Detach the parked anchor exactly as an ancestor `removeRange` would — WITHOUT
           disposing the block's scope, so its guard stays live. */
        const anchor = host.firstChild as ChildNode
        anchor.remove()

        resolveIt('LATE') // the late settle now lands on a dead anchor
        await flush()

        expect(host.textContent).not.toContain('LATE')
    })

    /* The root cause behind the detached-anchor settle: a hydration `adopt` whose build
       throws (a claim desync — the guarded fallback firstHydrate recovers from via
       `rebuildCold`) must dispose the partial branch scope it already created. Before the
       fix the throw escaped `scope()`, stranding the disposer of any inner effect/guard the
       partial build had spun up — a leaked, still-subscribed effect whose guard never bumps
       (so a late settle stays "live" and lands on the now-detached anchor). Driven white-box:
       a `renderThen` that creates an effect then throws on its FIRST (adopt) build and
       succeeds on the `rebuildCold` rebuild, so exactly one live effect must remain. */
    test('an adopt whose build throws disposes the partial branch scope (no leaked effect)', async () => {
        const sig = state(0)
        let runs = 0
        let firstBuild = true
        const renderThen = (host: Node): void => {
            effect(() => {
                void sig.value
                runs += 1
            })
            if (firstBuild) {
                firstBuild = false
                throw new Error('adopt build desync')
            }
            host.appendChild(document.createTextNode('OK'))
        }
        const host = document.createElement('div')
        /* A minimal server await boundary: open marker, close marker. The warm-sync value
           `'V'` drives firstHydrate's adopt path; the build throws, so it recovers cold. */
        host.innerHTML = '<!--abide:await:1--><!--/abide:await:1-->'
        hydrate(host, (target) => {
            awaitBlock(target, '1', () => 'V', undefined, renderThen as never, undefined, null)
        })
        await flush()
        expect(host.textContent).toContain('OK') // recovered via rebuildCold

        const before = runs
        sig.value = 1
        await flush()
        /* Only the LIVE (rebuilt) effect re-runs; the partial-build effect was disposed. A
           delta of 2 means the orphaned effect leaked. */
        expect(runs - before).toBe(1)
    })
})
