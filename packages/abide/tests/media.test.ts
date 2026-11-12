// 23.30-23.32 — WHETHER THE DOCUMENT MATCHES A MEDIA QUERY, READ BY NAME. What a page otherwise wires
// by hand: a `matchMedia` at module level that a server render cannot run, and a `change` listener
// per component that asks.

import { afterAll, expect, test } from 'bun:test'

import { inReleasedScope } from '#server/requestScope.ts'
import { flushSync } from '#shared'
import { beginHydration, endHydration } from '#shared/hydrating.ts'
import { media } from '#shared/media.ts'

import { removeTemporaryModules } from './temporaryModule.ts'
import { closeTyped, mountPage, renderPage } from './typed.ts'
import { warningsWhile } from './warningsWhile.ts'

afterAll(closeTyped)
afterAll(removeTemporaryModules)

type Viewport = { setViewport(size: { width: number; height: number }): void }
const viewport = (width: number): void =>
    (window as unknown as { happyDOM: Viewport }).happyDOM.setViewport({
        width,
        height: 768,
    })

// 23.30 — THE BROWSER'S ANSWER, FOLLOWED: a narrowed window wakes the value. THE REVERT: drop the
// `change` listener in `media`; the value stays `false` at 500px.
test('media follows matchMedia and its change event — 23.30', () => {
    viewport(1024)
    const narrow = media('(max-width: 600px)')
    expect(narrow()).toBe(false)
    viewport(500)
    flushSync()
    expect(`narrow at 500px: ${narrow()}`).toBe('narrow at 500px: true')
    viewport(1024)
    flushSync()
    expect(narrow()).toBe(false)
})

// 23.30 — A QUERY FIRST ASKED BY A REQUEST ANSWERS THE BROWSER'S OUTSIDE IT: in a test process a page
// fetched from the app asks first, and a component mounted after it reads the same value. THE REVERT:
// build a home with `make()` in `Filed`'s constructor in `scoped.ts`; it records the request as its
// scope, its body runs there for good, and it reads `after it false, refreshed false`.
test('a query a request asked first answers the browser after it — 23.30', async () => {
    viewport(1024)
    const query = '(min-width: 640px)'
    const inRequest = await inReleasedScope(
        new Request('http://app/'),
        async () => media(query)(),
    )
    const after = media(query)
    flushSync()
    const read = after()
    after.refresh()
    flushSync()
    expect(
        `in the request ${inRequest}, after it ${read}, refreshed ${after()}`,
    ).toBe('in the request false, after it true, refreshed true')
})

// 23.32 — ONE VALUE AND ONE LISTENER PER QUERY: a component mounted fifty times asks fifty times.
// THE REVERT: drop the `queries` map in `media`; `matchMedia` is asked 50 times and each call hands
// back a value of its own.
test('media hands back one value per query, asking matchMedia once — 23.32', () => {
    const asked = { count: 0 }
    const matchMediaBefore = window.matchMedia
    window.matchMedia = (query: string) => {
        asked.count += 1
        return matchMediaBefore.call(window, query)
    }
    try {
        const first = media('(min-width: 900px)')
        let same = 0
        for (let index = 0; index < 49; index += 1)
            if (media('(min-width: 900px)') === first) same += 1
        expect(
            `matchMedia asked ${asked.count} times, ${same + 1} of 50 the same value`,
        ).toBe('matchMedia asked 1 times, 50 of 50 the same value')
    } finally {
        window.matchMedia = matchMediaBefore
    }
})

// 23.31 — A SERVER HAS NO VIEWPORT, so a render answers false whatever the browser will, and the
// mounted page answers the browser's. THE REVERT: drop `!isServer() &&` from the body; the server
// renders `true` in a test process, whose DOM matches.
test('a server render answers false, and the browser its own — 23.31', async () => {
    viewport(1024)
    const { html } = await mountPage(`<script>
import { media } from '@abide/abide'

const wide = media('(min-width: 800px)')
</script>

<p id="wide">{wide}</p>`)
    expect(html).toContain('<p id="wide">false</p>')
    flushSync()
    expect(document.getElementById('wide')?.textContent).toBe('true')
})

// 41.32 — HYDRATION READS THE SERVER'S ANSWER, so the arms the server painted for `media` and
// `online` are adopted, and the browser's answer swaps them as an update with no 41.24 warning — while
// any other value the two sides disagree on still warns. `online` was built at import, long before,
// and is written the browser's answer at the end all the same. THE REVERTS, each run: make
// `beginHydration` write nothing and `isHydrating` answer false — 2 warnings, `media`'s beside the
// other's; drop the 41.24 warning from `ArmRegion.paintedOther` — 0.
test('media and online hydrate as the server answered, and swap after without a warning — 41.32', async () => {
    viewport(1024)
    Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        get: () => false,
    })
    try {
        const { mount } = await renderPage(`<script>
import { isServer, media, online, reactive } from '@abide/abide'

const wide = media('(min-width: 700px)')
const browser = reactive(() => !isServer())
</script>

{#if wide}<p id="wide">wide</p>{:else}<p id="narrow">narrow</p>{/if}
{#if online}<p id="on">on</p>{:else}<p id="off">off</p>{/if}
{#if browser}<p id="browser">browser</p>{:else}<p id="server">server</p>{/if}`)
        expect(document.getElementById('narrow')).not.toBeNull()
        expect(document.getElementById('on')).not.toBeNull()
        const warned = warningsWhile(() => {
            beginHydration()
            try {
                mount()
            } finally {
                endHydration()
            }
            flushSync()
        }, '41.24')
        expect(`${warned.length} warnings`).toBe('1 warnings')
        expect(
            ['wide', 'off', 'browser'].map(
                (id) => document.getElementById(id) !== null,
            ),
        ).toEqual([true, true, true])
    } finally {
        delete (navigator as unknown as { onLine?: boolean }).onLine
    }
})
