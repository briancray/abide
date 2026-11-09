// 37.22-37.27 — the browser's `onRefusal`, in a mounted page: which hooks hear a call refused over
// http, in what order, with what, and how many times. `fetch` answers from here, and each hook
// records what it was handed, so the contract — once, nearest first, while its component stands,
// the refusal still the value's — is a list compared whole.

import { afterAll, beforeAll, expect, test } from 'bun:test'

import { flushSync, reactive } from '#shared'
import { onRefusal } from '#shared/onRefusal.ts'
import { wire } from '#ui/wire.ts'

import { removeTemporaryModules } from './temporaryModule.ts'
import { closeTyped, renderPage } from './typed.ts'

afterAll(closeTyped)
afterAll(removeTemporaryModules)

// What the page reads, made here so the test writes it: a name the page binds would be lowered to
// its value (31.1) on its way out to the test.
const STATE = {
    shown: reactive(true),
    heard: [] as string[],
}

type Shared = { refusalState: typeof STATE }

const PAGE = `<script>
import { onRefusal } from '@abide/abide'
import Inner from './Inner.abide'

const state = (globalThis as unknown as { refusalState: { shown: () => boolean; heard: string[] } }).refusalState
onRefusal((refusal, call) => state.heard.push(\`outer:\${refusal.status} \${call.method} \${call.url}\`))
</script>

<main>{#if state.shown()}<Inner/>{/if}</main>`

const INNER = `<script>
import { onRefusal } from '@abide/abide'

const state = (globalThis as unknown as { refusalState: { heard: string[] } }).refusalState
onRefusal((refusal) => {
    state.heard.push(\`inner:\${refusal.status}\`)
    if (refusal.status === 418) throw new Error('the hook threw')
})
</script>

<p>inner</p>`

// AN ORIGIN OF THIS FILE'S OWN, so no copy an earlier file in the process loaded answers for it.
const BOARD = 'http://on-refusal.test/board'

const unstubbedFetch = globalThis.fetch
// The status the next call is answered at: a proxy's bare 401, as no handler's Problem Details.
let status = 401

let mount: () => unknown

beforeAll(async () => {
    ;(globalThis as unknown as Shared).refusalState = STATE
    globalThis.fetch = (async () =>
        new Response('', { status })) as unknown as typeof fetch
    ;({ mount } = await renderPage(PAGE, { Inner: INNER }))
})

afterAll(() => {
    globalThis.fetch = unstubbedFetch
})

const readBoard = wire('GET', BOARD) as (args: { n: number }) => {
    error(): unknown
}

let calls = 0

/** One call, answered at `status`, settled; what its value's `error` holds after. */
async function refusedCall(): Promise<{ status?: number } | undefined> {
    calls += 1
    const value = readBoard({ n: calls })
    // A read subscribes nothing here; it starts the load.
    value.error()
    await new Promise((done) => setTimeout(done, 10))
    flushSync()
    return value.error() as { status?: number } | undefined
}

function heard(): string[] {
    return STATE.heard.splice(0)
}

// THE REVERT: file in a server's render as in a browser's setup — drop the `serving()` early return
// in `BrowserHooks.file` — and the render files each hook, so the list reads both of them.
test("a server's render files no onRefusal — 37.22", async () => {
    await refusedCall()
    expect(heard()).toEqual([])
    mount()
})

// THE REVERT: drop `refused` from `answered` in `answerOf.ts`, and the list reads `[]` while the
// value still refuses — which is what the second assertion is there to show stands either way.
test('a call refused at 401 reaches every onRefusal standing once, nearest first, and still refuses — 37.24, 37.27', async () => {
    const error = await refusedCall()
    expect(heard()).toEqual(['inner:401', `outer:401 GET ${BOARD}?n=${calls}`])
    expect(error?.status).toBe(401)
})

// THE REVERT: drop the `try` around each hook in `BrowserHooks.hand`, and the inner hook's throw
// ends the walk: the list reads `inner:418` alone.
test('an onRefusal that throws keeps no other from hearing — 37.26', async () => {
    status = 418
    await refusedCall()
    status = 401
    expect(heard()).toEqual(['inner:418', `outer:418 GET ${BOARD}?n=${calls}`])
})

// THE REVERT: hand `onRefusal`'s unfiling to nothing (return it without `owned` in
// `BrowserHooks.file`), and the inner component's hook outlives it: the list reads `inner:` too.
test('a component that went takes its onRefusal with it — 37.22', async () => {
    STATE.shown.set(false)
    flushSync()
    await refusedCall()
    expect(heard()).toEqual([`outer:401 GET ${BOARD}?n=${calls}`])
})

// THE REVERT: return the no-op wherever nothing is set up, and the call below files nothing and
// says nothing.
test("an onRefusal called outside a component's setup or a render throws — 37.23", () => {
    expect(() => onRefusal(() => {})).toThrow(
        "abide: onRefusal files only in a component's <script>",
    )
})
