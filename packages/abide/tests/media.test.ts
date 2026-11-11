// 23.30-23.32 — WHETHER THE DOCUMENT MATCHES A MEDIA QUERY, READ BY NAME. What a page otherwise wires
// by hand: a `matchMedia` at module level that a server render cannot run, and a `change` listener
// per component that asks.

import { afterAll, expect, test } from 'bun:test'

import { flushSync } from '#shared'
import { media } from '#shared/media.ts'

import { removeTemporaryModules } from './temporaryModule.ts'
import { closeTyped, mountPage } from './typed.ts'

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
