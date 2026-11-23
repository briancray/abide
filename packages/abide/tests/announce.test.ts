// 50.49, 50.50, 50.36 — WHAT A SCREEN READER IS TOLD: `announce` hands its words to the one `announce.host`
// standing, never writes them inside a request, and warns once where none stands. What the regions
// render is the CRM's tests', which mount them.

import { expect, test } from 'bun:test'

import { installServer } from '#server/installServer.ts'
import { inScope } from '#server/requestScope.ts'
import { announce, said } from '#shared/announce.ts'
import { collectWatches } from '#shared/reactive/watch.ts'

installServer()

// FIRST IN THE FILE, since the warning is given once per process.
// THE REVERT: drop `announcers.asked()` from `announce`, and a message with no `announce.host` is lost
// without a word.
test('a message with no announce.host standing warns once — 50.36', async () => {
    const warned: string[] = []
    const warn = console.warn
    console.warn = (...args: unknown[]): void => {
        const line = args.join(' ')
        if (line.includes('abide:announce')) warned.push(line)
    }
    try {
        announce('Saved')
        announce('Saved again')
        await Promise.resolve()
    } finally {
        console.warn = warn
    }
    expect(warned).toHaveLength(1)
    expect(warned[0]).toContain('announce.host()')
})

// Each message is a message of its own, though its words are not.
test('a message replaces the last, and the same words count as a new message', () => {
    announce('Saved')
    const first = said.peek()
    announce('Saved')
    expect(said.peek()?.text).toBe('Saved')
    expect(said.peek()?.politeness).toBe('polite')
    expect(said.peek()?.count).toBe((first?.count ?? 0) + 1)
    announce('Connection lost', { politeness: 'assertive' })
    expect(said.peek()?.politeness).toBe('assertive')
})

// THE REVERT: drop the `isServer` check from `announce`, and a request writes a message no person is
// there to hear.
test('announce throws inside a request — 50.50', async () => {
    await inScope(new Request('http://app/'), async () => {
        expect(() => announce('Saved')).toThrow('RULEBOOK 50.50')
    })
})

// 50.51 — THE REGIONS AS PARTS: each a live region of its politeness, and the message in the region its
// politeness names alone. THE REVERT: answer the message from `said` whatever its politeness -> the
// assertive region holds the polite message too.
test('announce.host hands back both live regions, and the message in its own region alone — 50.51', () => {
    // Stood as a component's setup stands it, and stopped after, so no host outlives the test.
    const stops: (() => void)[] = []
    const previous = collectWatches(stops)
    const regions = announce.host()
    collectWatches(previous)
    announce('Saved')
    expect([
        regions.polite.role,
        regions.polite['aria-live'],
        regions.assertive.role,
        regions.assertive['aria-live'],
    ]).toEqual(['status', 'polite', 'alert', 'assertive'])
    expect(regions.said('polite').map((message) => message.text)).toEqual([
        'Saved',
    ])
    expect(regions.said('assertive')).toEqual([])
    for (const stop of stops) stop()
})
