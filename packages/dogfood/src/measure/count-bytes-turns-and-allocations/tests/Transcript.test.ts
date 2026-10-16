import { expect, test } from 'bun:test'
import { render } from '@abide/abide/server'
import { bytes } from '@abide/harness/server'
import { messagesOf } from '../lib/messages.ts'
import Transcript from '../lib/Transcript.abide'

const pageOf = async (count: number) =>
    bytes(await render(Transcript({ opening: messagesOf(count) })))

test('every message adds the same bytes at any length', async () => {
    const [twenty, forty, eighty] = await Promise.all([
        pageOf(20),
        pageOf(40),
        pageOf(80),
    ])
    expect(eighty - forty).toBe(2 * (forty - twenty))
})
