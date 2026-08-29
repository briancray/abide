import { expect, test } from 'bun:test'

test('the DOM preload ran', () => {
    expect(typeof document).toBe('object')
    expect(document.createElement('div').nodeName).toBe('DIV')
})

test('every lane entry resolves', async () => {
    await expect(import('harness/measure')).resolves.toBeDefined()
    await expect(import('harness/engine')).resolves.toBeDefined()
    await expect(import('harness/server')).resolves.toBeDefined()
})
