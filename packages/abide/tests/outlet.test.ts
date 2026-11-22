// 35.20-35.24 — A PLACE A LAYOUT OWNS, FILLED FROM BELOW IT: `outlet.into`'s element is written where
// the page wrote it, hidden, and moved into the `outlet.host` of its name once the browser has it.
// The CRM's tests hold the same through a layout and a page, served and navigated.

import { afterAll, expect, test } from 'bun:test'

import { flushSync } from '#shared'

import { click } from './click.ts'
import { removeTemporaryModules } from './temporaryModule.ts'
import { closeTyped, mountPage } from './typed.ts'

afterAll(closeTyped)
afterAll(removeTemporaryModules)

const texts = (selector: string): string[] => {
    const found: string[] = []
    for (const node of document.querySelectorAll(selector))
        found.push(node.textContent ?? '')
    return found
}

// THE REVERT: drop the `element.remove()` in `outlet.into`'s `Disposer`; the host still holds
// `Share` once its `{#if}` has closed — `Export,Print,Share` where `Export,Print` is due.
test('what is filled into a name stands in its host in the order it was bound, and leaves when unbound — 35.20, 35.23', async () => {
    await mountPage(`<script>
import { outlet, reactive } from '@abide/abide'

let sharing = reactive(true)
</script>

<header id="bar" {...outlet.host('toolbar')}><strong>Deals</strong></header>
<button id="toggle" onclick={() => { sharing = !sharing }}>toggle</button>
<button {...outlet.into('toolbar')}>Export</button>
<button {...outlet.into('toolbar')}>Print</button>
{#if sharing}<button {...outlet.into('toolbar')}>Share</button>{/if}`)
    flushSync()
    expect(texts('#bar > *').slice(0, 1)).toEqual(['Deals'])
    expect(texts('#bar button').filter((text) => text !== 'Share')).toEqual([
        'Export',
        'Print',
    ])
    expect(texts('#bar button')).toContain('Share')
    expect(document.querySelector('#bar button')?.hasAttribute('hidden')).toBe(
        false,
    )
    click('#toggle')
    flushSync()
    expect(texts('#bar button')).toEqual(['Export', 'Print'])
    expect(texts('button').filter((text) => text === 'Share')).toEqual([])
})

// THE REVERT: have `showing` answer the first host standing rather than the last; `Share` lands in
// `#above` and `#below` is the one marked empty.
test('of two hosts under one name the last holds what is filled, and the other is marked empty — 35.22', async () => {
    await mountPage(`<script>
import { outlet } from '@abide/abide'
</script>

<span id="above" {...outlet.host('side')}></span>
<span id="below" {...outlet.host('side')}></span>
<button {...outlet.into('side')}>Share</button>`)
    flushSync()
    expect(texts('#below button')).toEqual(['Share'])
    expect(texts('#above button')).toEqual([])
    expect(document.querySelector('#above')?.hasAttribute('data-empty')).toBe(
        true,
    )
    expect(document.querySelector('#below')?.hasAttribute('data-empty')).toBe(
        false,
    )
})

// THE REVERT: drop `hidden` from `outlet.into`'s part; the server writes the button bare.
test('the server writes what is filled where the page wrote it, hidden — 35.21', async () => {
    const { html } = await mountPage(`<script>
import { outlet } from '@abide/abide'
</script>

<header {...outlet.host('served')}></header>
<button {...outlet.into('served')}>Export</button>`)
    expect(html).toMatch(/<header[^>]*data-empty[^>]*><\/header>/)
    expect(html).toMatch(/<button[^>]*\bhidden\b[^>]*>Export<\/button>/)
})

// THE REVERT: drop the `setTimeout` `outlet.into`'s binding schedules; nothing warns.
test('a name no host stands under warns once — 35.24', async () => {
    const warned: string[] = []
    const warn = console.warn
    console.warn = (...args: unknown[]): void => {
        const line = args.join(' ')
        if (line.includes('abide:outlet')) warned.push(line)
    }
    try {
        await mountPage(`<script>
import { outlet } from '@abide/abide'
</script>

<button {...outlet.into('nowhere')}>Lost</button>
<button {...outlet.into('nowhere')}>Lost too</button>`)
        flushSync()
        await new Promise((settled) => setTimeout(settled, 5))
    } finally {
        console.warn = warn
    }
    expect(warned).toHaveLength(1)
    expect(warned[0]).toContain("outlet.host('nowhere')")
})
