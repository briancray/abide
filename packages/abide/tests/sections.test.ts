// 51.95, 51.167, 51.168 — A JUMP INDEX SCRUBBED BY A POINTER, the alphabet down the side of a contact list.
// The index here is `virtualList`'s and `scrollSpy`'s alike: five jumps 20 pixels tall stacked in a
// host, each a real element whose click is the jump's own, and a pointer pressed and dragged down them.

import { afterEach, expect, test } from 'bun:test'

import { flushSync, scrollSpy, type Sections, virtualList } from '#shared'

afterEach(() => document.body.replaceChildren())

/** `index`'s host and a jump per section, spread as a template would spread them, stacked 20 pixels apart. */
function rendered<Section>(
    index: Sections<Section>,
    tag: 'button' | 'a',
    label: (section: Section) => string,
) {
    // The jumps clicked, by label: what a scrub does is click the jump it reaches.
    const clicked: string[] = []
    const host = document.createElement('nav')
    document.body.append(host)
    const spread = (element: Element, part: Record<string, unknown>): void => {
        for (const [name, value] of Object.entries(part)) {
            if (name.startsWith('on'))
                element.addEventListener(name.slice(2), value as EventListener)
            else if (name === 'disabled')
                (element as HTMLButtonElement).disabled = value === true
            else if (typeof value === 'string')
                element.setAttribute(name, value)
        }
    }
    spread(host, index.host)
    let row = 0
    for (const section of index.all) {
        const jump = document.createElement(tag)
        const top = row * 20
        jump.getBoundingClientRect = () =>
            ({ left: 0, right: 20, top, bottom: top + 20 }) as DOMRect
        spread(jump, index.jump(section))
        jump.addEventListener('click', () => clicked.push(label(section)))
        host.append(jump)
        row += 1
    }
    const captured: number[] = []
    host.setPointerCapture = (id: number) => {
        captured.push(id)
    }
    /** A pointer event at `y` pixels down the index, a few pixels left of it where `x` says. */
    const pointer = (type: string, y: number, x = 10): void => {
        const event = new PointerEvent(type, {
            pointerId: 1,
            button: 0,
            clientX: x,
            clientY: y,
            bubbles: true,
        })
        host.dispatchEvent(event)
        flushSync()
    }
    return { host, clicked, captured, pointer }
}

const CONTACTS = ['Ada', 'Brook', 'Dana', 'Eve']

// THE REVERT: measure every jump, the disabled among them, and a drag from B over the empty C and back
// lands on C — no jump — then jumps by B again: [B, B, D] where [B, D] is due. Or jump on every move,
// and the 5 moves inside B and D jump 5 times.
test('a drag down the index jumps once per jump it reaches, past a disabled one — 51.167', () => {
    const list = virtualList({
        items: CONTACTS,
        section: (name) => name[0] ?? '',
        labels: ['A', 'B', 'C', 'D', 'E'],
        scrub: true,
    })
    const { clicked, pointer } = rendered(
        list.sections,
        'button',
        (section) => section.label,
    )
    // Pressed on A: A's click, if released here, is the jump's own.
    pointer('pointerdown', 10)
    pointer('pointermove', 12)
    expect(clicked).toEqual([])
    pointer('pointermove', 30)
    pointer('pointermove', 35)
    // C has no contact: B is nearer than D from the middle of C, so nothing moves.
    pointer('pointermove', 50)
    pointer('pointermove', 30)
    pointer('pointermove', 70)
    // Dragged off the side of the index, the nearest jump is still D.
    pointer('pointermove', 75, 200)
    pointer('pointerup', 75)
    expect(clicked).toEqual(['B', 'D'])
})

// THE REVERT: capture the pointer and mark the host as the press lands, and a click on a jump — a press
// released where it landed — is a scrub, its own click sent to the host instead.
test('the host is marked and holds the pointer from the first jump a scrub makes until release — 51.168', () => {
    const list = virtualList({
        items: CONTACTS,
        section: (name) => name[0] ?? '',
        scrub: true,
    })
    const { captured, pointer } = rendered(
        list.sections,
        'button',
        (section) => section.label,
    )
    const marked = () => list.sections.host['data-scrubbing']
    pointer('pointerdown', 10)
    expect([marked(), captured]).toEqual([undefined, []])
    pointer('pointermove', 30)
    expect([marked(), captured]).toEqual(['', [1]])
    pointer('pointerup', 30)
    expect(marked()).toBeUndefined()
})

// THE REVERT: scrub whatever `scrub` says, and a drag across an index that never asked to be scrubbed
// jumps by each letter.
test('an index with scrub off leaves a drag alone — 51.167', () => {
    const list = virtualList({
        items: CONTACTS,
        section: (name) => name[0] ?? '',
    })
    const { clicked, pointer } = rendered(
        list.sections,
        'button',
        (section) => section.label,
    )
    pointer('pointerdown', 10)
    pointer('pointermove', 50)
    pointer('pointerup', 50)
    expect(clicked).toEqual([])
})

// THE REVERT: scrub `virtualList`'s index alone, and `scrollSpy`'s links take no drag — one option, two
// meanings.
test('a scroll spy is scrubbed as a list is, each link reached clicked — 51.167', () => {
    const spy = scrollSpy({ items: ['intro', 'pricing', 'terms'], scrub: true })
    const { clicked, pointer } = rendered(spy, 'a', (key) => key)
    pointer('pointerdown', 10)
    pointer('pointermove', 30)
    pointer('pointermove', 50)
    pointer('pointerup', 50)
    expect(clicked).toEqual(['pricing', 'terms'])
})
