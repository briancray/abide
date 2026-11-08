// 37.16, 37.17, 37.18 — the browser's `onError`, in a mounted page: which hooks hear a failure
// nothing caught, in what order, and how many times. Each hook records what it was handed, so the
// contract — once, nearest first, while its component stands — is a list compared whole.

import { afterAll, beforeAll, expect, test } from 'bun:test'

import { flushSync, reactive } from '#shared'
import { UNEXPECTED } from '#shared/UNEXPECTED.ts'

import { removeTemporaryModules } from './temporaryModule.ts'
import { closeTyped, renderPage } from './typed.ts'

afterAll(closeTyped)
afterAll(removeTemporaryModules)

// What the page reads, made here so the test writes it: a name the page binds would be lowered to
// its value (31.1) on its way out to the test.
const STATE = {
    shown: reactive(true),
    fail: reactive(false),
    heard: [] as string[],
    mounting: false,
}

type Shared = { errorState: typeof STATE }

const PAGE = `<script>
import { onError, watch } from '@abide/abide'
import Inner from './Inner.abide'

const state = (globalThis as unknown as { errorState: { shown: () => boolean; fail: () => boolean; heard: string[]; mounting: boolean } }).errorState
// The server's render of this setup shares state with the mount, and its watch would throw too.
const mounted = state.mounting
onError((error) => state.heard.push(\`outer:\${(error as Error).message}\`))
watch(() => {
    state.fail()
    return () => {
        if (mounted) throw new Error('disposer')
    }
})
</script>

<main>{#if state.shown()}<Inner/>{/if}</main>`

const INNER = `<script>
import { onError } from '@abide/abide'

const state = (globalThis as unknown as { errorState: { heard: string[] } }).errorState
onError((error) => {
    state.heard.push(\`inner:\${(error as Error).message}\`)
    if ((error as Error).message === 'loud') throw new Error('the hook threw')
})
</script>

<p>inner</p>`

// The browser's slot, which a test process with a server in it has filled with the server's.
const serverReport = UNEXPECTED.report

beforeAll(async () => {
    ;(globalThis as unknown as Shared).errorState = STATE
    const { mount } = await renderPage(PAGE, { Inner: INNER })
    UNEXPECTED.report = null
    STATE.mounting = true
    mount()
})

afterAll(() => {
    UNEXPECTED.report = serverReport
})

function heard(): string[] {
    return STATE.heard.splice(0)
}

// THE REVERTS: `unshift` the filing rather than `push` it, and the list reads outer first; drop
// the `error` listener, and it reads `[]`.
test('a throw nothing caught reaches every onError standing, nearest first — 37.17', () => {
    // The render ran each setup once on the server side of this process, and filed nothing.
    heard()
    dispatchEvent(new ErrorEvent('error', { error: new Error('uncaught') }))
    expect(heard()).toEqual(['inner:uncaught', 'outer:uncaught'])
})

// THE REVERT: drop the `unhandledrejection` listener, and the list reads `[]`.
test('a rejection nothing handled reaches onError as its reason — 37.17', () => {
    const event = new Event('unhandledrejection') as Event & { reason: unknown }
    event.reason = new Error('refused')
    dispatchEvent(event)
    expect(heard()).toEqual(['inner:refused', 'outer:refused'])
})

// A DISPOSER, NOT AN EFFECT: a disposer's throw is reported and goes no further (12.6), where an
// effect's re-throws (12.7) and `bun test` fails on what surfaces. The effect's — handed once
// though it surfaces too — is `packages/abide/e2e/onError.spec.ts`'s, in a browser.
//
// THE REVERT: drop `listen`'s fill of `UNEXPECTED.report`, and the list reads `[]`.
test('a disposer that threw reaches onError — 12.6, 37.17', () => {
    STATE.fail.set(true)
    flushSync()
    expect(heard()).toEqual(['inner:disposer', 'outer:disposer'])
})

// THE REVERT: drop the `try` around each hook in `hand`, and the inner hook's throw ends the walk:
// the list reads `inner:loud` alone.
test('a hook that throws keeps no other from hearing — 37.18', () => {
    dispatchEvent(new ErrorEvent('error', { error: new Error('loud') }))
    expect(heard()).toEqual(['inner:loud', 'outer:loud'])
})

// THE REVERT: hand `onError`'s unfiling to nothing (return it without `owned`), and the inner
// component's hook outlives it: the list reads `inner:` too.
test('a component that went takes its onError with it — 37.16', () => {
    STATE.shown.set(false)
    flushSync()
    dispatchEvent(new ErrorEvent('error', { error: new Error('after') }))
    expect(heard()).toEqual(['outer:after'])
})
