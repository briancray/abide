import { expect, test } from 'bun:test'

import { createApp } from '@abide/abide/server'

import importDeals from '../importDeals.handler.ts'
import { dealImport } from './dealImport.server.ts'

/** What the CRM answers a press of Import, a refusal included. */
async function pressImport() {
    try {
        return await importDeals()
    } catch (refusal) {
        return refusal
    }
}

// THE REVERT: drop the `running` check, and the second press joins the import rather than being told.
test('an import asked for while one is running is refused 409', async () => {
    await using app = await createApp()
    expect(await app.run(pressImport)).toMatchObject({ running: true })
    expect(await app.run(pressImport)).toMatchObject({
        name: 'ImportRunning',
        status: 409,
    })
    // Once it ends, the next press starts another.
    await dealImport.runNow()
    expect(await app.run(pressImport)).toMatchObject({ running: true })
})
