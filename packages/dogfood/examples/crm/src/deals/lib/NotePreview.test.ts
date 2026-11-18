import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import NotePreview from './NotePreview.abide'

const preview = () => document.querySelector('[aria-label=Preview]')

test('a note renders its markdown, and its HTML and its script link as text', async () => {
    using _note = await mount(NotePreview({}))
    expect(preview()?.querySelector('strong')?.textContent).toBe('Ada')
    expect(preview()?.querySelector('em')?.textContent).toBe('Friday')
    const links = [...(preview()?.querySelectorAll('a') ?? [])]
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
        'https://crm.example/b/7',
    ])
    expect(preview()?.querySelector('li:last-child')?.textContent).toBe(
        'open the quote',
    )
    expect(preview()?.querySelector('script')).toBeNull()
    expect(preview()?.textContent).toContain("<script>alert('pwned')</script>")
})

test('a heading in a note renders at the level the page gives it', async () => {
    using _note = await mount(NotePreview({}))
    const field = document.querySelector('textarea') as HTMLTextAreaElement
    field.value = '# Call notes\n\n## Pricing'
    field.dispatchEvent(new Event('input'))
    flushSync()
    expect(preview()?.querySelector('h3')?.textContent).toBe('Call notes')
    expect(preview()?.querySelector('h4')?.textContent).toBe('Pricing')
})
