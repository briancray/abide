import { expect, test } from 'bun:test'

import { createApp } from '@abide/abide/server'

import importDeals from '../importDeals.server.ts'
import { dealImport, importedDeals } from './dealImport.server.ts'

/** What the CRM answers a press of Import, a refusal included. */
async function pressImport(options?: { stage?: string }) {
    try {
        return await importDeals(options)
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
    await dealImport.run()
    expect(await app.run(pressImport)).toMatchObject({ running: true })
})

// THE REVERT: call `dealImport.run()` with nothing in the handler, and all 7 deals are imported.
test('an import asked for one stage imports only the deals at it', async () => {
    await using app = await createApp()
    await dealImport.run()
    await app.run(() => pressImport({ stage: 'lead' }))
    await dealImport.run()
    expect(`imported: ${await importedDeals()}`).toBe('imported: 3')
})
