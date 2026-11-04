import { expect, test } from 'bun:test'

import { config, createApp } from '@abide/abide/server'

test('a deployment whose RETRIES is out of range does not start', async () => {
    const deployed = process.env.RETRIES
    process.env.RETRIES = '50'
    config.invalidate()
    try {
        await expect(createApp()).rejects.toMatchObject({ status: 422 })
    } finally {
        process.env.RETRIES = deployed
        config.invalidate()
    }
})
