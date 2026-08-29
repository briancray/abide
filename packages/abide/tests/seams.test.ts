import { expect, test } from 'bun:test'

// The seams resolve and stay one-directional. A shell test, but it is the one that
// fails the moment #shared reaches for #server.
test('every seam entry resolves', async () => {
    await expect(import('#shared')).resolves.toBeDefined()
    await expect(import('#ui')).resolves.toBeDefined()
    await expect(import('#server')).resolves.toBeDefined()
})
