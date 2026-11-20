// 53.12-53.23, 53.53, 53.57, 53.58 — THE `bind:element` ADAPTORS that close, take files, copy and follow a bottom, each bound to a bare
// element the way `bind:element` binds one: called with the node, and stopped by what it hands back.

import { afterEach, expect, test } from 'bun:test'

import { copy } from '#shared/copy.ts'
import { dismissible } from '#shared/dismissible.ts'
import { dropzone } from '#shared/dropzone.ts'
import { followBottom } from '#shared/followBottom.ts'
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
// THE REVERT: end the walk at a layer `outside` is off for — `menu closed: false` where `true` is due.
test('a press passes over a layer outside is off for, to close the one under it — 53.15', () => {
    const menu = element()
    const pinned = element()
    let menuClosed = false
    let pinnedClosed = false
    const stopMenu = dismissible(() => {
        menuClosed = true
    })(menu)
    const stopPinned = dismissible(
        () => {
            pinnedClosed = true
        },
        { outside: false },
    )(pinned)
    press(document.body)
    expect(`menu closed: ${menuClosed}`).toBe('menu closed: true')
    expect(pinnedClosed).toBe(false)
    stopPinned()
    stopMenu()
})

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

// THE REVERT: call `onreject` only where nothing was taken, and the photo past `multiple` and the
// contract beside an accepted photo are turned away unheard.
test('the files a drop carries and does not take are handed to onreject — 53.46', () => {
    const zone = element()
    const turnedAway: string[][] = []
    const reject = (files: File[]) =>
        turnedAway.push(files.map((file) => file.name))
    const stops = [
        dropzone(() => {}, {
            accept: 'image/*',
            multiple: false,
            onreject: reject,
        })(zone),
        dropzone(() => {}, { onreject: reject })(zone),
    ]
    drag(zone, 'drop', [CONTRACT, PHOTO, PHOTO])
    expect(turnedAway).toEqual([['ledger-audit.pdf', 'signing.png']])
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

// THE REVERT: walk `data.files` alone for what was turned away, and a paste carrying its files in
// `items` alone reaches no `onreject` — this reports `[]`. `getAsFile` hands a new `File` per call,
// as a browser's does, so the photo taken is matched only where the transfer is read once.
test('a paste carrying its files in items alone takes and turns away as a drop does — 53.20, 53.46', () => {
    const zone = element('textarea')
    const taken: string[][] = []
    const turnedAway: string[][] = []
    const stop = dropzone(
        (files) => taken.push(files.map((file) => file.name)),
        {
            paste: true,
            accept: 'image/*',
            onreject: (files) =>
                turnedAway.push(files.map((file) => file.name)),
        },
    )(zone)
    const item = (file: File) => ({
        kind: 'file',
        type: file.type,
        getAsFile: () => new File([file], file.name, { type: file.type }),
    })
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
        value: { files: [], items: [item(PHOTO), item(CONTRACT)] },
    })
    zone.dispatchEvent(event)
    expect({ taken, turnedAway }).toEqual({
        taken: [['signing.png']],
        turnedAway: [['ledger-audit.pdf']],
    })
    stop()
})

/** A clipboard recording each item written to it as `type: text` per type, until the test ends. */
function clipboardWrites(): string[][] {
    const written: string[][] = []
    Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
            write: async (items: ClipboardItem[]) => {
                for (const item of items) {
                    const types: string[] = []
                    for (const type of item.types)
                        types.push(
                            `${type}: ${await (await item.getType(type)).text()}`,
                        )
                    written.push(types)
                }
            },
        },
    })
    return written
}

/** A page with no clipboard, whose `copy` command fires the `copy` event a browser fires, and reports what landed. */
function noClipboard(landed: string[]): () => void {
    Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: undefined,
    })
    const execCommand = document.execCommand
    document.execCommand = ((command: string) => {
        const data = new DataTransfer()
        document.dispatchEvent(
            new ClipboardEvent('copy', {
                clipboardData: data,
                cancelable: true,
            }),
        )
        landed.push(
            `${command} selecting ${document.querySelector('textarea')?.value}`,
        )
        for (const type of data.types)
            landed.push(`${type}: ${data.getData(type)}`)
        return true
    }) as typeof document.execCommand
    return () => {
        document.execCommand = execCommand
    }
}

test('a click copies, marks the element copied, and the mark wears off — 53.21, 53.23', async () => {
    const written = clipboardWrites()
    let email = 'ada@engines.example'
    const button = element('button')
    const stop = copy(() => email, { copiedFor: 5 })(button)
    email = 'grace@hopper.example'
    button.click()
    await Bun.sleep(0)
    expect(written).toEqual([['text/plain: grace@hopper.example']])
    expect(button.hasAttribute('data-copied')).toBe(true)
    await Bun.sleep(20)
    expect(button.hasAttribute('data-copied')).toBe(false)
    stop()
})

// THE REVERT: write `navigator.clipboard.writeText` with the plain text alone, as `copyText` did —
// this reports `[["text/plain: Grace Hopper"]]`, and the html never reaches the clipboard.
test('a record copies as one item holding each type it names — 53.57', async () => {
    const written = clipboardWrites()
    const button = element('button')
    const stop = copy({
        'text/html': '<a href="mailto:grace@hopper.example">Grace Hopper</a>',
        'text/plain': 'Grace Hopper',
    })(button)
    button.click()
    await Bun.sleep(0)
    expect(written).toEqual([
        [
            'text/html: <a href="mailto:grace@hopper.example">Grace Hopper</a>',
            'text/plain: Grace Hopper',
        ],
    ])
    stop()
})

// THE REVERT: copy from the element bound rather than the button clicked, and every copy is the
// container's whole text, marked on the container.
test('with a selector, a click on a button inside copies from that button, and nothing else does — 53.44, 53.45', async () => {
    const written = clipboardWrites()
    const block = element()
    // Markup no template built, as a `raw` block holds it.
    block.innerHTML =
        '<pre><code>bun add @abide/abide</code><button data-copy>Copy</button></pre>' +
        '<pre><code>bun run dev</code><button data-copy>Copy</button></pre><p>prose</p>'
    const heard: [boolean, string][] = []
    const stop = copy(
        (clicked) =>
            clicked.closest('pre')?.querySelector('code')?.textContent ?? '',
        {
            selector: '[data-copy]',
            oncopied: (landed, clicked) =>
                heard.push([
                    landed,
                    clicked.previousElementSibling?.textContent ?? '',
                ]),
        },
    )(block)
    const [first, second] = block.querySelectorAll('button')
    second?.click()
    block.querySelector('p')?.click()
    await Bun.sleep(0)
    expect(written).toEqual([['text/plain: bun run dev']])
    expect(heard).toEqual([[true, 'bun run dev']])
    expect(second?.hasAttribute('data-copied')).toBe(true)
    expect(first?.hasAttribute('data-copied')).toBe(false)
    expect(block.hasAttribute('data-copied')).toBe(false)
    stop()
})

// THE REVERT: drop the `copy` listener `writeClipboard` lays the string types on — the textarea
// alone copies, and this reports the selection without the html.
test('a page with no clipboard copies through a selected textarea, carrying every string type — 53.22', async () => {
    const landed: string[] = []
    const restore = noClipboard(landed)
    try {
        const button = element('button')
        const stop = copy({
            'text/html': '<strong>Grace Hopper</strong>',
            'text/plain': 'Grace Hopper',
        })(button)
        button.click()
        await Bun.sleep(0)
        expect(landed).toEqual([
            'copy selecting Grace Hopper',
            'text/html: <strong>Grace Hopper</strong>',
            'text/plain: Grace Hopper',
        ])
        expect(button.hasAttribute('data-copied')).toBe(true)
        expect(document.querySelector('textarea')).toBeNull()
        stop()
    } finally {
        restore()
    }
})

// THE REVERT: drop the `selected === undefined` return — an empty textarea is selected and copied,
// and this reports `["copy selecting "]` and `true`.
test('a value holding no string reports not copied where there is no clipboard — 53.58', async () => {
    const landed: string[] = []
    const restore = noClipboard(landed)
    try {
        const button = element('button')
        const heard: boolean[] = []
        const stop = copy(
            {
                'image/png': new Blob([new Uint8Array([137, 80, 78, 71])], {
                    type: 'image/png',
                }),
            },
            { oncopied: (copied) => heard.push(copied) },
        )(button)
        button.click()
        await Bun.sleep(0)
        expect({ landed, heard }).toEqual({ landed: [], heard: [false] })
        expect(button.hasAttribute('data-copied')).toBe(false)
        stop()
    } finally {
        restore()
    }
})

// THE REVERT: drop the `following` check in `followBottom` — the reader scrolled up to 0 is pulled
// back to 180 by the next line.
test('a scrolling element follows its bottom until the reader scrolls up, and again once back — 53.53', async () => {
    const log = element()
    // The emulator lays nothing out: the element is 100px tall and grows 40px a line.
    let height = 100
    Object.defineProperty(log, 'clientHeight', { get: () => 100 })
    Object.defineProperty(log, 'scrollHeight', { get: () => height })
    const stop = followBottom(log)
    const line = async (): Promise<void> => {
        height += 40
        log.append(document.createElement('p'))
        await Bun.sleep(0)
    }
    await line()
    expect(log.scrollTop).toBe(140)
    log.scrollTop = 0
    log.dispatchEvent(new Event('scroll'))
    await line()
    expect(log.scrollTop).toBe(0)
    log.scrollTop = height - 100
    log.dispatchEvent(new Event('scroll'))
    await line()
    expect(log.scrollTop).toBe(height)
    stop()
    await line()
    expect(log.scrollTop).toBe(height - 40)
})
