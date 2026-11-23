// 53.12-53.23, 53.50, 53.54, 53.55, 53.71 — THE `bind:element` ADAPTORS that close, take files, copy and follow a bottom, each bound to a bare
// element the way `bind:element` binds one: called with the node, and stopped by what it hands back.

import { afterEach, expect, test } from 'bun:test'

import { flushSync, watch } from '#shared'
import { copy } from '#shared/copy.ts'
import { dismissible } from '#shared/dismissible.ts'
import { dropzone } from '#shared/dropzone.ts'
import { followBottom } from '#shared/followBottom.ts'
import { imageFiles } from '#shared/imagePiece.ts'
import { tip } from '#shared/tooltip/tip.ts'
import { shown } from '#shared/tooltip/tips.ts'

import { bindPart } from './bindPart.ts'

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

test('a press outside closes, a press inside or on an element `inside` is spread on does not — 53.12', () => {
    const panel = element()
    const field = panel.appendChild(document.createElement('input'))
    const opener = element('button')
    const elsewhere = element('p')
    const closed: string[] = []
    const parts = dismissible((event) => closed.push(event.type))
    const stop = bindPart(parts.host, panel)
    const unbindOpener = bindPart(parts.inside, opener)
    press(field)
    press(opener)
    expect(closed).toEqual([])
    press(elsewhere)
    expect(closed).toEqual(['pointerdown'])
    unbindOpener()
    press(opener)
    expect(closed).toEqual(['pointerdown', 'pointerdown'])
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
    const stopMenu = bindPart(
        dismissible(() => {
            menuClosed = true
        }).host,
        menu,
    )
    const stopPinned = bindPart(
        dismissible(
            () => {
                pinnedClosed = true
            },
            { outside: false },
        ).host,
        pinned,
    )
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
        stop = bindPart(
            dismissible(() => closed.push('closed')).host,
            element(),
        )
    })
    press(opener)
    expect(closed).toEqual([])
    stop?.()
})

test('Escape closes the top panel alone and is prevented, and a field that took it keeps it — 53.14, 53.15', () => {
    const outer = element()
    const inner = element()
    const closed: string[] = []
    const stopOuter = bindPart(
        dismissible(() => closed.push('outer')).host,
        outer,
    )
    const stopInner = bindPart(
        dismissible(() => closed.push('inner')).host,
        inner,
    )
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

// 50.25, 53.15 — AN OPEN HINT IS THE TOP LAYER: one Escape closes the hint alone and is prevented, so
// the panel under it — or a `<dialog>` — stays, and the next Escape is the panel's. A hint another
// replaced leaves no layer behind to take that Escape. THE REVERT: close the hint from a `keydown`
// listener of its own on the document, as it was — the first Escape closes the panel too.
test('Escape closes an open hint alone, then the panel under it — 50.25, 53.15', async () => {
    const panel = element()
    const closed: string[] = []
    const stopPanel = bindPart(
        dismissible(() => closed.push('panel')).host,
        panel,
    )
    const first = panel.appendChild(document.createElement('button'))
    const second = panel.appendChild(document.createElement('button'))
    const stopFirst = bindPart(tip('First', { delay: 0 }), first)
    const stopSecond = bindPart(tip('Second', { delay: 0 }), second)
    first.dispatchEvent(new MouseEvent('mouseenter'))
    await Bun.sleep(1)
    second.dispatchEvent(new MouseEvent('mouseenter'))
    await Bun.sleep(1)
    expect(shown.peek()?.anchor).toBe(second)
    expect(escape()).toBe(true)
    expect(shown.peek()).toBeUndefined()
    expect(closed).toEqual([])
    expect(escape()).toBe(true)
    expect(closed).toEqual(['panel'])
    stopSecond()
    stopFirst()
    stopPanel()
})

// THE REVERT: drop the `splice` from the disposer, and a panel already gone still takes the Escape
// meant for the one under it.
test('a disposer takes its panel off the stack — 53.16', () => {
    const closed: string[] = []
    const stopUnder = bindPart(
        dismissible(() => closed.push('under')).host,
        element(),
    )
    const stopGone = bindPart(
        dismissible(() => closed.push('gone')).host,
        element(),
    )
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

/**
 * `dropzone`'s host spread on `zone` as a template spreads it: a listener per `on…`, and
 * `data-dragging` written as it changes. Hands back the parts and the stop.
 */
function hosted(
    zone: Element,
    parts: ReturnType<typeof dropzone>,
): ReturnType<typeof dropzone> & { stop: () => void } {
    const listeners: [string, EventListener][] = []
    for (const [name, value] of Object.entries(parts.host))
        if (name.startsWith('on')) {
            zone.addEventListener(name.slice(2), value as EventListener)
            listeners.push([name.slice(2), value as EventListener])
        }
    const unwatch = watch(() => {
        if (parts.host['data-dragging'] === undefined)
            zone.removeAttribute('data-dragging')
        else zone.setAttribute('data-dragging', '')
    })
    return Object.assign(parts, {
        stop: () => {
            for (const [type, listener] of listeners)
                zone.removeEventListener(type, listener)
            unwatch()
        },
    })
}

const CONTRACT = new File(['%PDF'], 'ledger-audit.pdf', {
    type: 'application/pdf',
})
const PHOTO = new File(['png'], 'signing.png', { type: 'image/png' })

test('data-dragging stays while a drag crosses into a child, and leaves with it — 53.17', () => {
    const zone = element()
    const child = zone.appendChild(document.createElement('p'))
    const { stop } = hosted(zone, dropzone())
    drag(zone, 'dragenter', [CONTRACT])
    drag(child, 'dragenter', [CONTRACT])
    drag(zone, 'dragleave', [CONTRACT])
    flushSync()
    expect(zone.hasAttribute('data-dragging')).toBe(true)
    drag(child, 'dragleave', [CONTRACT])
    flushSync()
    expect(zone.hasAttribute('data-dragging')).toBe(false)
    stop()
})

test('a drop takes what accept takes, by type, extension or function — 53.18, 53.19', () => {
    const zone = element()
    const taken: string[][] = []
    const take = (files: File[]) => taken.push(files.map((file) => file.name))
    const stops = [
        hosted(zone, dropzone({ onfiles: take, accept: '.pdf' })).stop,
        hosted(
            zone,
            dropzone({ onfiles: take, accept: 'image/*', multiple: false }),
        ).stop,
        hosted(zone, dropzone({ onfiles: take, accept: imageFiles })).stop,
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
test('the files a drop carries and does not take are handed to onreject — 53.45', () => {
    const zone = element()
    const turnedAway: string[][] = []
    const reject = (files: File[]) =>
        turnedAway.push(files.map((file) => file.name))
    const stops = [
        hosted(
            zone,
            dropzone({ accept: 'image/*', multiple: false, onreject: reject }),
        ).stop,
        hosted(zone, dropzone({ onreject: reject })).stop,
    ]
    drag(zone, 'drop', [CONTRACT, PHOTO, PHOTO])
    expect(turnedAway).toEqual([['ledger-audit.pdf', 'signing.png']])
    for (const stop of stops) stop()
})

test('a paste of files is a drop, and words pasted alone paste — 53.20', () => {
    const zone = element('textarea')
    const taken: File[][] = []
    const { stop } = hosted(
        zone,
        dropzone({ onfiles: (files) => taken.push(files), paste: true }),
    )
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
test('a paste carrying its files in items alone takes and turns away as a drop does — 53.20, 53.45', () => {
    const zone = element('textarea')
    const taken: string[][] = []
    const turnedAway: string[][] = []
    const { stop } = hosted(
        zone,
        dropzone({
            onfiles: (files) => taken.push(files.map((file) => file.name)),
            paste: true,
            accept: 'image/*',
            onreject: (files) =>
                turnedAway.push(files.map((file) => file.name)),
        }),
    )
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

/** A pick of `files` through a file input carrying `dropzone`'s `input` part. */
function picked(
    parts: ReturnType<typeof dropzone>,
    files: File[],
): HTMLInputElement {
    const input = document.body.appendChild(document.createElement('input'))
    input.type = 'file'
    Object.defineProperty(input, 'files', { configurable: true, value: files })
    Object.defineProperty(input, 'value', {
        configurable: true,
        writable: true,
        value: files[0]?.name ?? '',
    })
    input.addEventListener('change', parts.input.onchange as EventListener)
    input.dispatchEvent(new Event('change'))
    return input
}

// 53.57 — A PICK THROUGH THE INPUT IS TAKEN AS A DROP IS: filtered by `accept`, a function's handed a
// transfer of the files picked, and the input emptied so the same file picked again is a pick again.
// THE REVERT: write the picked files into `files` unfiltered — the contract lands beside the photo.
test('a pick through the input lands in files, filtered as a drop is — 53.57', () => {
    const byType = dropzone({ accept: 'image/*' })
    const input = picked(byType, [CONTRACT, PHOTO])
    expect(byType.files().map((file) => file.name)).toEqual(['signing.png'])
    expect(byType.rejected.map((file) => file.name)).toEqual([
        'ledger-audit.pdf',
    ])
    expect(input.value).toBe('')
    expect(byType.input.accept).toBe('image/*')
    const byFunction = dropzone({ accept: imageFiles })
    picked(byFunction, [CONTRACT, PHOTO])
    expect(byFunction.files().map((file) => file.name)).toEqual(['signing.png'])
    expect(byFunction.input.accept).toBeUndefined()
})

// 53.56 — WHAT A DROP TAKES REPLACES THE FILES, one under `multiple: false`, and a drop taking nothing
// leaves them. THE REVERT: append each take to `files` — the second drop reads three files.
test('a drop replaces the files, keeps one under multiple false, and one taking none leaves them — 53.56', () => {
    const zone = element()
    const drop = hosted(zone, dropzone({ accept: '.pdf,image/*' }))
    drag(zone, 'drop', [CONTRACT, PHOTO])
    drag(zone, 'drop', [PHOTO])
    expect(drop.files().map((file) => file.name)).toEqual(['signing.png'])
    drag(zone, 'drop', [new File(['x'], 'notes.txt')])
    expect(drop.files().map((file) => file.name)).toEqual(['signing.png'])
    expect(drop.rejected.map((file) => file.name)).toEqual(['notes.txt'])
    drop.stop()
    const one = hosted(zone, dropzone({ multiple: false }))
    drag(zone, 'drop', [CONTRACT, PHOTO])
    expect(one.files().map((file) => file.name)).toEqual(['ledger-audit.pdf'])
    one.stop()
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
    const stop = bindPart(copy({ value: () => email, copiedFor: 5 }), button)
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
test('a record copies as one item holding each type it names — 53.54', async () => {
    const written = clipboardWrites()
    const button = element('button')
    const stop = bindPart(
        copy({
            value: {
                'text/html':
                    '<a href="mailto:grace@hopper.example">Grace Hopper</a>',
                'text/plain': 'Grace Hopper',
            },
        }),
        button,
    )
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
test('with a selector, a click on a button inside copies from that button, and nothing else does — 53.43, 53.44', async () => {
    const written = clipboardWrites()
    const block = element()
    // Markup no template built, as a `raw` block holds it.
    block.innerHTML =
        '<pre><code>bun add @abide/abide</code><button data-copy>Copy</button></pre>' +
        '<pre><code>bun run dev</code><button data-copy>Copy</button></pre><p>prose</p>'
    const heard: [boolean, string][] = []
    const stop = bindPart(
        copy({
            value: (clicked) =>
                clicked.closest('pre')?.querySelector('code')?.textContent ??
                '',
            selector: '[data-copy]',
            oncopied: (landed, clicked) =>
                heard.push([
                    landed,
                    clicked.previousElementSibling?.textContent ?? '',
                ]),
        }),
        block,
    )
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
        const stop = bindPart(
            copy({
                value: {
                    'text/html': '<strong>Grace Hopper</strong>',
                    'text/plain': 'Grace Hopper',
                },
            }),
            button,
        )
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
test('a value holding no string reports not copied where there is no clipboard — 53.55', async () => {
    const landed: string[] = []
    const restore = noClipboard(landed)
    try {
        const button = element('button')
        const heard: boolean[] = []
        const stop = bindPart(
            copy({
                value: {
                    'image/png': new Blob([new Uint8Array([137, 80, 78, 71])], {
                        type: 'image/png',
                    }),
                },
                oncopied: (copied) => heard.push(copied),
            }),
            button,
        )
        button.click()
        await Bun.sleep(0)
        expect({ landed, heard }).toEqual({ landed: [], heard: [false] })
        expect(button.hasAttribute('data-copied')).toBe(false)
        stop()
    } finally {
        restore()
    }
})

// THE REVERT: default `value` to the element's `textContent` alone — this reports
// `[["text/plain: Grace Hopper, engines"]]`, and the markup never reaches the clipboard.
test('with no value, a click copies the element clicked as its text and its markup — 53.71', async () => {
    const written = clipboardWrites()
    const card = element()
    card.innerHTML = '<strong>Grace Hopper</strong>, <em>engines</em>'
    const stop = bindPart(copy(), card)
    card.click()
    await Bun.sleep(0)
    expect(written).toEqual([
        [
            'text/plain: Grace Hopper, engines',
            'text/html: <strong>Grace Hopper</strong>, <em>engines</em>',
        ],
    ])
    expect(card.hasAttribute('data-copied')).toBe(true)
    stop()
})

// THE REVERT: drop the `following` check in `followBottom`'s observer — the reader scrolled up to 0
// is pulled back to 180 by the next line, and the jump never reads unseen.
test('a scroller follows its bottom until the reader scrolls up, and the jump takes them back — 53.50, 53.58-53.60', async () => {
    const log = element()
    // The emulator lays nothing out: the element is 100px tall and grows 40px a line.
    let height = 100
    Object.defineProperty(log, 'clientHeight', { get: () => 100 })
    Object.defineProperty(log, 'scrollHeight', { get: () => height })
    // The emulator scrolls nowhere: a jump lands where it was asked to, at once.
    log.scrollTo = ((to: ScrollToOptions) => {
        log.scrollTop = to.top ?? 0
        log.dispatchEvent(new Event('scroll'))
    }) as typeof log.scrollTo
    const follow = followBottom()
    const stop = (
        follow.host['bind:element'] as (element: Element) => () => void
    )(log)
    const line = async (): Promise<void> => {
        height += 40
        log.append(document.createElement('p'))
        await Bun.sleep(0)
    }
    const jump = () => ({
        hidden: follow.jump.hidden,
        unseen: follow.jump['data-unseen'],
    })
    await line()
    expect([log.scrollTop, follow.following(), jump()]).toEqual([
        140,
        true,
        { hidden: true, unseen: undefined },
    ])
    // 53.58 — scrolled up past the threshold, it stops following.
    log.scrollTop = 0
    log.dispatchEvent(new Event('scroll'))
    await line()
    // 53.59 — and the line that landed meanwhile shows the jump, unseen.
    expect([log.scrollTop, follow.following(), jump()]).toEqual([
        0,
        false,
        { hidden: false, unseen: '' },
    ])
    // 53.60 — the jump takes the reader down and follows again.
    ;(follow.jump.onclick as () => void)()
    await line()
    expect([log.scrollTop, follow.following(), jump()]).toEqual([
        height,
        true,
        { hidden: true, unseen: undefined },
    ])
    // 53.58 — scrolled back within the threshold by the reader, it follows again too.
    log.scrollTop = 0
    log.dispatchEvent(new Event('scroll'))
    log.scrollTop = height - 100
    log.dispatchEvent(new Event('scroll'))
    await line()
    expect(log.scrollTop).toBe(height)
    stop()
    await line()
    expect(log.scrollTop).toBe(height - 40)
})
