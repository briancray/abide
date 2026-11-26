// 50.2, 50.3 with 49.19 — `dialog`'s closes against an `open` that refuses them. The parts are spread
// by hand, as 32.11 spreads them; what a template does with them is the CRM's tests'.

import { afterEach, expect, test } from 'bun:test'

import { dialog, flushSync, reactive } from '#shared'

import { bindPart } from './bindPart.ts'

const bound: (() => void)[] = []
afterEach(() => {
    for (const release of bound.splice(0)) release()
    document.body.replaceChildren()
})

// A dialog spread on a `<dialog>`, opened, whose `open` refuses every write once `refusing` is set.
function refusing() {
    const gate = { refusing: false }
    const open = reactive<boolean>(false, {
        schema: {
            '~standard': {
                version: 1,
                vendor: 'test',
                validate: (value: unknown) =>
                    gate.refusing
                        ? { issues: [{ message: 'held open' }] }
                        : { value: value as boolean },
            },
        },
    })
    const closes: string[] = []
    const parts = dialog({ open, onclose: (returned) => closes.push(returned) })
    const element = document.createElement('dialog')
    document.body.append(element)
    for (const [name, value] of Object.entries(parts.dialog))
        if (name === 'bind:element') bound.push(bindPart(parts.dialog, element))
        else if (name.startsWith('on'))
            element.addEventListener(name.slice(2), value as EventListener)
    open.set(true)
    flushSync()
    gate.refusing = true
    return { element, open, closes }
}

// THE REVERT: let the browser close on Escape whatever `open` answered, and the cancel is not
// prevented — the element closes under an `open` still true.
test('an Escape `open` refuses leaves the dialog open — 49.19', () => {
    const { element, open, closes } = refusing()
    const escape = new Event('cancel', { cancelable: true })
    element.dispatchEvent(escape)
    flushSync()
    expect(escape.defaultPrevented).toBe(true)
    expect([element.open, open.peek(), closes]).toEqual([true, true, []])
})

// THE REVERT: report the close whatever `open` answered, and a form closing it under a refusing
// `open` leaves the element shut and `onclose` called with 'log'.
test('a close the element made that `open` refuses shows it again, unreported — 50.2, 49.19', async () => {
    const { element, open, closes } = refusing()
    element.close('log')
    await Bun.sleep(0)
    flushSync()
    expect([element.open, open.peek(), closes]).toEqual([true, true, []])
})

// THE REVERT: close the element on a backdrop click rather than writing `open`, and the refused
// click shuts the element and shows it again — one `close` where there was to be none.
test('a backdrop click `open` refuses never closes the dialog — 50.3, 49.19', async () => {
    const { element, open, closes } = refusing()
    let shut = 0
    element.addEventListener('close', () => {
        shut += 1
    })
    element.dispatchEvent(
        new MouseEvent('click', { bubbles: true, clientX: -5, clientY: -5 }),
    )
    await Bun.sleep(0)
    flushSync()
    expect([element.open, open.peek(), closes, shut]).toEqual([
        true,
        true,
        [],
        0,
    ])
})
