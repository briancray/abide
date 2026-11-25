import { expect, test } from 'bun:test'

import { createApp } from '@abide/abide/server'

import getHeadcount from '../getHeadcount.handler.ts'
import { registryAsked } from './registryOrigin.server.ts'

// THE REVERT: drop `retries: 0`, and a slow registry is asked 3 times, the page waiting on each.
test('a registry slower than half a second leaves the headcount blank, asked once', async () => {
    await using app = await createApp()
    expect(await app.run(() => getHeadcount({ id: 'turing-trust' }))).toBe(null)
    expect(registryAsked('turing-trust')).toBe(1)
})
