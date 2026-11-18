// 53.12-53.23 — THE `bind:element` ADAPTORS that close, take files and copy, each bound to a bare
// element the way `bind:element` binds one: called with the node, and stopped by what it hands back.

import { afterEach, expect, test } from 'bun:test'

import { copyText } from '#shared/copyText.ts'
import { dismissible } from '#shared/dismissible.ts'
import { dropzone } from '#shared/dropzone.ts'
import { imageFiles } from '#shared/imagePiece.ts'

afterEach(() => {
    Reflect.deleteProperty(navigator, 'clipboard')
    document.body.replaceChildren()
})

function element(tag = 'div'): HTMLElement {
    const made = document.createElement(tag)
    document.body.append(made)
    return made
}

function press(target: Element) {
    target.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, cancelable: true }),
    )
}

function escape(target: Element = document.body): boolean {
    const event = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
    })
    target.dispatchEvent(event)
    return event.defaultPrevented
}

test('a press outside closes, a press inside or on what `inside` holds does not — 53.12', () => {
    const panel = element()
    const field = panel.appendChild(document.createElement('input'))
    const opener = element('button')
    const elsewhere = element('p')
    const closed: string[] = []
    const stop = dismissible((event) => closed.push(event.type), {
        inside: [opener, undefined],
    })(panel)
    press(field)
    press(opener)
    expect(closed).toEqual([])
    press(elsewhere)
    expect(closed).toEqual(['pointerdown'])
    stop()
})

// THE REVERT: bind on the document in the bubbling phase, from inside the opener's pointerdown, and
// the press that opened the panel reaches the listener and closes it as it opens.
test('the press that opened the panel closes nothing — 53.13', () => {
    const opener = element('button')
    const closed: string[] = []
    let stop: (() => void) | undefined
    opener.addEventListener('pointerdown', () => {
        stop = dismissible(() => closed.push('closed'))(element())
    })
    press(opener)
    expect(closed).toEqual([])
    stop?.()
})

test('Escape closes the top panel alone and is prevented, and a field that took it keeps it — 53.14, 53.15', () => {
    const outer = element()
    const inner = element()
    const closed: string[] = []
    const stopOuter = dismissible(() => closed.push('outer'))(outer)
    const stopInner = dismissible(() => closed.push('inner'))(inner)
    expect(escape()).toBe(true)
    expect(closed).toEqual(['inner'])
    const field = outer.appendChild(document.createElement('input'))
    field.addEventListener('keydown', (event) => event.preventDefault())
    escape(field)
    expect(closed).toEqual(['inner'])
    // A press in the outer panel closes the inner one above it, and stops there.
    press(outer)
    expect(closed).toEqual(['inner', 'inner'])
    stopInner()
    stopOuter()
})

// THE REVERT: drop the `splice` from the disposer, and a panel already gone still takes the Escape
// meant for the one under it.
test('a disposer takes its panel off the stack — 53.16', () => {
    const closed: string[] = []
    const stopUnder = dismissible(() => closed.push('under'))(element())
    const stopGone = dismissible(() => closed.push('gone'))(element())
    stopGone()
    escape()
    expect(closed).toEqual(['under'])
    stopUnder()
    expect(escape()).toBe(false)
})

/** A drag event carrying `files`, as a browser hands one over. */
function drag(target: Element, type: string, files: File[]): boolean {
    const event = new DragEvent(type, { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', {
        value: { types: ['Files'], files, items: [], dropEffect: 'none' },
    })
    target.dispatchEvent(event)
    return event.defaultPrevented
}

const CONTRACT = new File(['%PDF'], 'ledger-audit.pdf', {
    type: 'application/pdf',
})
const PHOTO = new File(['png'], 'signing.png', { type: 'image/png' })

test('data-dragging stays while a drag crosses into a child, and leaves with it — 53.17', () => {
    const zone = element()
    const child = zone.appendChild(document.createElement('p'))
    const stop = dropzone(() => {})(zone)
    drag(zone, 'dragenter', [CONTRACT])
    drag(child, 'dragenter', [CONTRACT])
    drag(zone, 'dragleave', [CONTRACT])
    expect(zone.hasAttribute('data-dragging')).toBe(true)
    drag(child, 'dragleave', [CONTRACT])
    expect(zone.hasAttribute('data-dragging')).toBe(false)
    stop()
})

test('a drop takes what accept takes, by type, extension or function — 53.18, 53.19', () => {
    const zone = element()
    const taken: string[][] = []
    const take = (files: File[]) => taken.push(files.map((file) => file.name))
    const stops = [
        dropzone(take, { accept: '.pdf' })(zone),
        dropzone(take, { accept: 'image/*', multiple: false })(zone),
        dropzone(take, { accept: imageFiles })(zone),
    ]
    expect(drag(zone, 'dragover', [CONTRACT, PHOTO])).toBe(true)
    expect(drag(zone, 'drop', [CONTRACT, PHOTO, PHOTO])).toBe(true)
    expect(taken).toEqual([
        ['ledger-audit.pdf'],
        ['signing.png'],
        ['signing.png', 'signing.png'],
    ])
    // Nothing accepted: still refused, so the tab does not open the file, and nobody is called.
    expect(drag(zone, 'drop', [new File(['x'], 'notes.txt')])).toBe(true)
    expect(taken).toHaveLength(3)
    for (const stop of stops) stop()
})

test('a paste of files is a drop, and words pasted alone paste — 53.20', () => {
    const zone = element('textarea')
    const taken: File[][] = []
    const stop = dropzone((files) => taken.push(files), { paste: true })(zone)
    const paste = (files: File[]) => {
        const event = new Event('paste', { bubbles: true, cancelable: true })
        Object.defineProperty(event, 'clipboardData', {
            value: { files, items: [] },
        })
        zone.dispatchEvent(event)
        return event.defaultPrevented
    }
    expect(paste([])).toBe(false)
    expect(paste([PHOTO])).toBe(true)
    expect(taken).toEqual([[PHOTO]])
    stop()
})

test('a click copies, marks the element copied, and the mark wears off — 53.21, 53.23', async () => {
    const copied: string[] = []
    Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async (text: string) => copied.push(text) },
    })
    let email = 'ada@engines.example'
    const button = element('button')
    const stop = copyText(() => email, { copiedFor: 5 })(button)
    email = 'grace@hopper.example'
    button.click()
    await Bun.sleep(0)
    expect(copied).toEqual(['grace@hopper.example'])
    expect(button.hasAttribute('data-copied')).toBe(true)
    await Bun.sleep(20)
    expect(button.hasAttribute('data-copied')).toBe(false)
    stop()
})

// THE REVERT: return `false` where `navigator.clipboard` is absent, and a page served over plain
// http copies nothing.
test('a page with no clipboard copies through a selected textarea — 53.22', async () => {
    Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: undefined,
    })
    const copied: string[] = []
    const execCommand = document.execCommand
    document.execCommand = ((command: string) => {
        copied.push(`${command}:${document.querySelector('textarea')?.value}`)
        return true
    }) as typeof document.execCommand
    try {
        const button = element('button')
        const stop = copyText('grace@hopper.example')(button)
        button.click()
        await Bun.sleep(0)
        expect(copied).toEqual(['copy:grace@hopper.example'])
        expect(button.hasAttribute('data-copied')).toBe(true)
        expect(document.querySelector('textarea')).toBeNull()
        stop()
    } finally {
        document.execCommand = execCommand
    }
})
