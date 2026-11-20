// 50.50, 50.51, 50.36 — WHAT A SCREEN READER IS TOLD: `announce` hands its words to the one `Announcer`
// standing, never writes them inside a request, and warns once where no `Announcer` stands. What the
// component renders is the CRM's tests', which mount it.

import { expect, test } from 'bun:test'

import { installServer } from '#server/installServer.ts'
import { inScope } from '#server/requestScope.ts'
import { announce, said } from '#shared/announce.ts'

installServer()

// FIRST IN THE FILE, since the warning is given once per process.
// THE REVERT: drop `announcers.asked()` from `announce`, and a message with no `Announcer` is lost
// without a word.
test('a message with no Announcer standing warns once — 50.36', async () => {
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
    expect(warned[0]).toContain('<Announcer />')
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
test('announce throws inside a request — 50.51', async () => {
    await inScope(new Request('http://app/'), async () => {
        expect(() => announce('Saved')).toThrow('RULEBOOK 50.51')
    })
})
