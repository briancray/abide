// 44.69 — `pairing`'s `status` READ BY NAME IN A TEMPLATE, the way an app writes it: `status?.paired`
// in a branch, an attribute and a listener, with "Connecting…" the arm for no status yet and an
// `.error()` arm for a read that failed. Three apps wrote exactly this and lost both: the in-flight
// read aborted the expression (32.23), so "Connecting…" never painted, and a failed read threw out of
// the attribute and the listener to `reportError`.
//
// A FILE OF ITS OWN, with its own type session, for `setupRead.test.ts`'s reason.

import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test'

import { flushSync } from '#shared'
import type { BridgeStatus } from '#shared/BridgeStatus.ts'
import { MUX_FOLLOWS } from '#shared/MUX_FOLLOWS.ts'

import { removeTemporaryModules } from './temporaryModule.ts'
import { closeTyped, renderPage } from './typed.ts'

afterAll(closeTyped)
afterAll(removeTemporaryModules)

const UNPAIRED: BridgeStatus = {
    paired: false,
    missing: [],
    command: 'bunx @abide/bridge@1.0.0 http://site one',
    link: 'abide-bridge://pair?code=one',
    install: 'bunx @abide/bridge@1.0.0 install',
}

// The apps' code as they wrote it before guarding every read with `ready()`.
const PANEL = `<script>
import { pairing, reactive } from '@abide/abide'

const { status, step, start } = pairing()
let dropped = reactive('none')
</script>

<main ondrop={() => { dropped = String(Boolean(status?.paired)) }}>
    <textarea disabled={!status?.paired}></textarea>
    {#if status.error()}
        <p>unavailable</p>
    {:else if status?.paired}
        <p>paired</p>
    {:else if status && step === 'install'}
        <pre>{status.install}</pre>
    {:else if status}
        <button onclick={start}>Pair</button>
    {:else}
        <p>Connecting…</p>
    {/if}
    <i>{dropped}</i>
</main>`

const realFetch = globalThis.fetch
const realReport = globalThis.reportError
const realWarn = console.warn
// What reached the app as uncaught: reported, warned as a watch that threw (12.6, 12.7), or thrown
// out of a listener.
let reported: unknown[] = []
let answer: (response: Response) => void = () => {}

beforeEach(() => {
    reported = []
    globalThis.reportError = (thrown: unknown): void => {
        reported.push(thrown)
    }
    console.warn = (...parts: unknown[]): void => {
        if (parts.map(String).join(' ').includes('abide:watch'))
            reported.push(parts)
    }
    const { promise, resolve } = Promise.withResolvers<Response>()
    answer = resolve
    globalThis.fetch = (async () => promise) as unknown as typeof fetch
    MUX_FOLLOWS.follow = () => {}
    MUX_FOLLOWS.unfollow = () => {}
})

afterEach(() => {
    globalThis.fetch = realFetch
    globalThis.reportError = realReport
    console.warn = realWarn
    MUX_FOLLOWS.follow = null
    MUX_FOLLOWS.unfollow = null
})

/** The panel's text, its textarea's `disabled`, and what was reported, as one line. */
function painted(): string {
    const text = (document.querySelector('main')?.textContent ?? '')
        .replace(/\s+/g, ' ')
        .trim()
    const disabled = document.querySelector('textarea')?.disabled
    return `${text} | disabled: ${disabled} | reported: ${reported.length}`
}

/** Drops on the panel, and flushes what the drop wrote. */
function drop(): void {
    try {
        document.querySelector('main')?.dispatchEvent(new Event('drop'))
        flushSync()
    } catch (thrown) {
        reported.push(thrown)
    }
}

/** Turns enough for `/__abide/pairing`'s answer to land in the copy and the status. */
async function settle(): Promise<void> {
    for (let turn = 0; turn < 5; turn++) await Bun.sleep(0)
    flushSync()
}

// THE REVERT: give `status` the 8ec67742 body again — in flight until the copy lands, failing with
// it, `reactive(() => read.copy())`; in flight this reads `none | disabled: false` with no
// "Connecting…" and the attribute never written, and failed `unavailable none | disabled: false |
// reported: 2` — the attribute's watch and the drop listener each threw the `HttpError`.
test('status reads as undefined while in flight and where its read failed, its failure on error() — 44.69', async () => {
    const page = await renderPage(PANEL)
    const scope = page.mount()
    const connecting = painted()
    answer(new Response('down', { status: 503 }))
    await settle()
    drop()
    const failed = painted()
    scope.stop()
    expect({ connecting, failed }).toEqual({
        connecting: 'Connecting… none | disabled: true | reported: 0',
        failed: 'unavailable false | disabled: true | reported: 0',
    })
})

test('status reads the status once /__abide/pairing answers it — 44.69', async () => {
    const page = await renderPage(PANEL)
    const scope = page.mount()
    answer(Response.json({ ...UNPAIRED, paired: true }))
    await settle()
    drop()
    const paired = painted()
    scope.stop()
    expect(paired).toBe('paired true | disabled: false | reported: 0')
})
