// 51.95, 51.167, 51.168 — A JUMP INDEX OVER THE SECTIONS OF SOMETHING THAT SCROLLS, as parts: the index's
// host, a jump per section marked while its section is current, and — where `scrub` is on — a pointer
// dragged along the index jumping by each jump it reaches, the alphabet down the side of a contact list.
// `virtualList`'s `sections` and `scrollSpy` are this, each saying what its sections are, which is
// current and how a jump scrolls.
//
// THE JUMPS ARE MEASURED ONCE, AS THE PRESS LANDS, so a pointer moving reads no layout: the nearest is
// arithmetic over the boxes taken then. A scrub jumps by CLICKING the jump it reaches, so a jump is one
// behavior however it is reached — a disabled button takes no click, and a link scrolls as its own click
// does. A press released where it landed is the jump's own click, and a scrub takes the pointer only
// once it has moved to another jump.

import { type Live, live } from './live.ts'
import { reactive } from './reactive/index.ts'

/** A jump index over sections: its host, every section, the one in view, and a section's jump. */
export type Sections<Section> = {
    /** The index's part: what a pointer scrubs where `scrub` is on, `data-scrubbing` while it does. */
    readonly host: Record<string, unknown>
    /** Every section, in order. */
    get all(): readonly Section[]
    /** The key of the section in view. */
    get current(): string | undefined
    /** A section's jump: `aria-current` and `data-current` while its section is the one in view. */
    jump(section: Section): Record<string, unknown>
}

/** A jump's box as the press landed, and the jump. */
class Box {
    readonly jump: HTMLElement
    readonly left: number
    readonly top: number
    readonly right: number
    readonly bottom: number
    constructor(jump: HTMLElement, box: DOMRect) {
        this.jump = jump
        this.left = box.left
        this.top = box.top
        this.right = box.right
        this.bottom = box.bottom
    }
}

/** The jump whose box is nearest the point, the first of two as near. */
function nearest(
    boxes: readonly Box[],
    x: number,
    y: number,
): HTMLElement | undefined {
    let found: HTMLElement | undefined
    let least = Number.POSITIVE_INFINITY
    for (const box of boxes) {
        const across = Math.max(box.left - x, 0, x - box.right)
        const down = Math.max(box.top - y, 0, y - box.bottom)
        const distance = across * across + down * down
        if (distance < least) {
            least = distance
            found = box.jump
        }
    }
    return found
}

/** The parts of a jump index over `all`, its jumps named under `data-<name>`. */
export function sections<Section>(of: {
    /** The headless component's name in kebab case, for its `data-` attribute (49.3). */
    name: string
    /** What the host's `data-` attribute holds, and what else the host carries. */
    host: Record<string, unknown>
    all: () => readonly Section[]
    current: () => string | undefined
    keyOf: (section: Section) => string
    /** What a section's jump carries besides what every jump does: a button's type, a link's address. */
    jump: (section: Section) => Record<string, unknown>
    /** What a click on a section's jump does. */
    go: (section: Section, event: MouseEvent) => void
    scrub: Live<boolean | undefined>
}): Sections<Section> {
    const attribute = `data-${of.name}`
    const scrubbing = reactive(false)
    let boxes: Box[] = []
    let pointer: number | undefined
    // The jump the press landed on, then the jump a scrub last jumped by.
    let at: HTMLElement | undefined

    const end = (event: PointerEvent): void => {
        if (event.pointerId !== pointer) return
        pointer = undefined
        boxes = []
        at = undefined
        if (scrubbing.peek()) scrubbing.set(false)
    }

    return {
        host: {
            ...of.host,
            // 51.168
            get 'data-scrubbing'() {
                return scrubbing.get() ? '' : undefined
            },
            // 51.167 — the jumps a press can reach, measured once; a disabled one is not among them.
            onpointerdown: (event: PointerEvent) => {
                if (event.button !== 0 || live(of.scrub) !== true) return
                const host = event.currentTarget as Element
                boxes = []
                for (const jump of host.querySelectorAll<HTMLElement>(
                    `[${attribute}="jump"]`,
                )) {
                    if (
                        (jump as HTMLButtonElement).disabled === true ||
                        jump.getAttribute('aria-disabled') === 'true'
                    )
                        continue
                    boxes.push(new Box(jump, jump.getBoundingClientRect()))
                }
                pointer = event.pointerId
                at = nearest(boxes, event.clientX, event.clientY)
            },
            onpointermove: (event: PointerEvent) => {
                if (event.pointerId !== pointer) return
                const reached = nearest(boxes, event.clientX, event.clientY)
                if (reached === undefined || reached === at) return
                if (!scrubbing.peek()) {
                    ;(event.currentTarget as Element).setPointerCapture?.(
                        event.pointerId,
                    )
                    scrubbing.set(true)
                }
                at = reached
                reached.click()
            },
            onpointerup: end,
            onpointercancel: end,
        },
        get all() {
            return of.all()
        },
        get current() {
            return of.current()
        },
        jump: (section) => ({
            ...of.jump(section),
            [attribute]: 'jump',
            // 51.95
            get 'aria-current'() {
                return of.current() === of.keyOf(section) ? 'true' : undefined
            },
            // 49.17
            get 'data-current'() {
                return of.current() === of.keyOf(section) ? '' : undefined
            },
            onclick: (event: MouseEvent) => of.go(section, event),
        }),
    }
}
