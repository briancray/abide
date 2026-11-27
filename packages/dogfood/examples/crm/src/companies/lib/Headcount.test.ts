import { expect, test } from 'bun:test'

import { createApp } from '@abide/abide/server'

import { getHeadcount } from '../getHeadcount.server.ts'
import { registryAsked } from './registryOrigin.server.ts'

// THE REVERT: drop the `signal`, and the headcount waits the registry's two seconds and answers 140.
test('a registry slower than half a second leaves the headcount blank, asked once', async () => {
    await using app = await createApp()
    expect(await app.run(() => getHeadcount({ id: 'turing-trust' }))).toBe(null)
    expect(registryAsked('turing-trust')).toBe(1)
})
