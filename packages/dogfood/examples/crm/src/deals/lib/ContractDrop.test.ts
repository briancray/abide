import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import ContractDrop from './ContractDrop.abide'

// A drag carrying files, as a browser hands one to the element.
function drag(type: string, files: File[]): boolean {
    const event = new DragEvent(type, { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', {
        value: { types: ['Files'], files, items: [], dropEffect: 'none' },
    })
    document.querySelector('p')?.dispatchEvent(event)
    flushSync()
    return event.defaultPrevented
}

const zone = () => document.querySelector('div') as HTMLDivElement

test('a dropped PDF is attached, and a photo beside it is not', async () => {
    using _drop = await mount(ContractDrop({}))
    const contract = new File(['%PDF'], 'ledger-audit.pdf', {
        type: 'application/pdf',
    })
    const photo = new File(['jpeg'], 'signing.jpg', { type: 'image/jpeg' })
    drag('dragenter', [contract, photo])
    expect(zone().hasAttribute('data-dragging')).toBe(true)
    expect(drag('dragover', [contract, photo])).toBe(true)
    expect(drag('drop', [contract, photo])).toBe(true)
    expect(zone().hasAttribute('data-dragging')).toBe(false)
    const attached = [...document.querySelectorAll('strong')]
    expect(attached.map((each) => each.textContent)).toEqual([
        'ledger-audit.pdf',
    ])
})
