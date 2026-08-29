import { expect, test } from 'bun:test'
import { measure } from 'harness/measure'
import { getInvoice } from './files/src/server/rpc/invoices.ts'

test('the handler answers with the invoice', async () => {
    const invoice = getInvoice({ id: '42' })
    await expect(invoice).resolves.toMatchObject({ number: 'INV-0042' })
})

test('a missing invoice refuses by name, not by status alone', async () => {
    const invoice = getInvoice({ id: 'nope' })
    await invoice
    expect(invoice.isError(invoice.error(), 'NotFound')).toBe(true)
})

// The contract here is DOES LESS WORK, so the assertion is the work rather than the
// value: re-rendering with the same invoice must move no nodes. Verified by reverting
// the identity check, which takes this from 0 to 954.
test('re-rendering an unchanged invoice moves no nodes', async () => {
    const page = await measure.render('files/src/ui/pages/invoices/[id]/page.abide', { id: '42' })
    page.reset()
    await page.refresh()
    expect(page.nodesMoved).toBe(0)
})
