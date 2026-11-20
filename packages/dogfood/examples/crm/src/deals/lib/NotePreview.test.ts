import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import NotePreview from './NotePreview.abide'

const preview = () => document.querySelector('[aria-label=Preview]')

test('a note renders its markdown, and its HTML as text', async () => {
    using _note = await mount(NotePreview({}))
    expect(preview()?.querySelector('strong')?.textContent).toBe('Ada')
    expect(preview()?.querySelector('em')?.textContent).toBe('Friday')
    const links = [...(preview()?.querySelectorAll('a') ?? [])]
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
        'https://x.co/b7',
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

function write(text: string) {
    const field = document.querySelector('textarea') as HTMLTextAreaElement
    field.value = text
    field.dispatchEvent(new Event('input'))
    flushSync()
}

// THE REVERT: render every fence as code, and the install line has no Copy beside it.
test('a fenced sh block renders as the code with a Copy beside it, and once closed only', async () => {
    using _note = await mount(NotePreview({}))
    write('Run this first:\n\n```sh\nbun add @abide/abide')
    // Still being written: code, with no Copy yet.
    expect(preview()?.querySelector('button')).toBeNull()
    expect(preview()?.querySelector('code')?.textContent).toBe(
        'bun add @abide/abide',
    )
    write('Run this first:\n\n```sh\nbun add @abide/abide\n```\n\nThen pair.')
    expect(preview()?.querySelector('pre button')?.textContent).toBe('Copy')
    expect(preview()?.querySelector('pre code')?.textContent).toBe(
        'bun add @abide/abide',
    )
    expect(preview()?.querySelector('p:last-child')?.textContent).toBe(
        'Then pair.',
    )
})

// THE REVERT: drop the definitions, and `[the quote][q]` stays as written.
test('a reference link takes its address from a definition anywhere in the note, which shows nothing', async () => {
    using _note = await mount(NotePreview({}))
    write(
        'Send [the quote][q] and [Brief].\n\n[q]: https://x.co/q1\n[brief]: /deals/d1',
    )
    const links = [...(preview()?.querySelectorAll('a') ?? [])]
    expect(links.map((link) => link.textContent)).toEqual([
        'the quote',
        'Brief',
    ])
    expect(preview()?.textContent).not.toContain('[q]:')
    // Off the CRM: a tab of its own. Inside it: this one.
    expect(links[0]?.getAttribute('target')).toBe('_blank')
    expect(links[0]?.getAttribute('rel')).toBe('noopener noreferrer')
    expect(links[1]?.getAttribute('href')).toBe('/deals/d1')
    expect(links[1]?.hasAttribute('target')).toBe(false)
})
