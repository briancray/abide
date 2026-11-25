// 51.85-51.91 — A RANGE BETWEEN TWO THUMBS, which the native `<input type="range">` cannot hold:
// WAI-ARIA's multi-thumb slider, as parts an app spreads onto elements of its own. Each thumb is a scrub
// along the track (`scrub`) that keeps to its own side of the other, so the arrows, Home and End are the
// crosshair's, and the pointer takes the thumb nearer it and drags it while held.

import { checkParts } from './checkParts.ts'
import { number } from './format/index.ts'
import { type Live, live } from './live.ts'
import { randomToken } from './randomToken.ts'
import { memo, type Reactive, reactive } from './reactive/index.ts'
import { scrub, type ScrubPosition } from './scrub.ts'

/** The range picked, and the scale it is picked on. */
export type RangeOptions = {
    /** The base the ids its parts write are derived from; unique on the page. One is made where none is given. */
    id?: string | undefined
    /** The low and the high end of the range picked, where the app holds them: a `Reactive` to read and set. Held by the parts, from `min` to `max`, and handed back as `value`, where none is given. */
    value?: Reactive<readonly [number, number]> | undefined
    /** What the range is of, as the group's accessible name: `'Deal amount'`. */
    label: Live<string>
    /** The least value. 0 by default. */
    min?: Live<number> | undefined
    /** The greatest value. 100 by default. */
    max?: Live<number> | undefined
    /** How far apart the values a thumb stops at are, from `min`. 1 by default. */
    step?: Live<number> | undefined
    /** Each thumb's accessible name, low then high. `['Minimum', 'Maximum']` by default; a function is read live. */
    labels?: Live<readonly [string, string]> | undefined
    /** Writes a value for the thumb's `aria-valuetext`: `format.money`, say. `format.number` by default. */
    format?: ((value: number) => string) | undefined
    /** The name each end is submitted under by `input`, low then high (51.91); a function is read live. */
    name?: Live<string | undefined> | undefined
}

/** One end's parts, low (`0`) or high (`1`): its thumb, and the hidden field submitting it. */
export type RangeEnd = {
    /** The thumb: its slider role, values, keys and the `style` that places it. */
    readonly thumb: Record<string, unknown>
    /** A hidden field submitting the end under `name`. */
    readonly input: Record<string, unknown>
}

/** The parts `range` hands back, each spread onto an element: `<span {...amount.end(0).thumb} />`. */
export type RangeParts = {
    /** The base its parts' ids are derived from. */
    readonly id: string
    /** The group's role, name and `data-dragging`. */
    readonly root: Record<string, unknown>
    /** The track's pointer handling: a press takes the nearer thumb and drags it. */
    readonly track: Record<string, unknown>
    /** The span between the thumbs, as the `style` that places it. */
    readonly fill: Record<string, unknown>
    /** One end's parts, low (`0`) or high (`1`). */
    end(which: 0 | 1): RangeEnd
    /** The low and the high end picked, read and set. */
    readonly value: Reactive<readonly [number, number]>
}

const DEFAULT_LABELS = ['Minimum', 'Maximum'] as const

/** WAI-ARIA's multi-thumb slider: a low and a high value on one track, as parts to spread. */
export function range(options: RangeOptions): RangeParts {
    // 49.11 — read where they are used.
    const labelOf = (which: 0 | 1) =>
        (live(options.labels) ?? DEFAULT_LABELS)[which]
    const format = (each: number) => (options.format ?? number)(each)
    const min = () => live(options.min) ?? 0
    const max = () => live(options.max) ?? 100
    const step = () => live(options.step) ?? 1
    const value =
        options.value ?? reactive<readonly [number, number]>([min(), max()])

    // The values a thumb stops at, by index from `min`.
    const last = memo(() => Math.max(0, Math.floor((max() - min()) / step())))
    const indexOf = (each: number) =>
        Math.min(last(), Math.max(0, Math.round((each - min()) / step())))
    const valueOf = (index: number) => min() + index * step()
    // 51.90 — where a value stands along the track, as the share of its width from the left edge.
    const percent = (each: number) => {
        const span = max() - min()
        return `${span === 0 ? 0 : ((each - min()) / span) * 100}%`
    }

    // The two ends as they stand, read without following them: `value` always holds both.
    const ends = () => value.peek() as readonly [number, number]

    // 51.86 — a thumb stops at the other: the low one at most at the high, the high one at least at the low.
    function position(which: 0 | 1): ScrubPosition {
        return {
            peek: () => indexOf(ends()[which]),
            set(index) {
                const [low, high] = ends()
                value.set(
                    which === 0
                        ? [
                              valueOf(
                                  Math.min(Math.max(index, 0), indexOf(high)),
                              ),
                              high,
                          ]
                        : [
                              low,
                              valueOf(
                                  Math.max(
                                      Math.min(index, last()),
                                      indexOf(low),
                                  ),
                              ),
                          ],
                )
            },
        }
    }
    const positions = [position(0), position(1)] as const
    const axis = {
        count: () => last() + 1,
        nearest: (fraction: number) =>
            Math.round(Math.min(1, Math.max(0, fraction)) * last()),
    }
    const scrubs = [
        scrub(positions[0], axis),
        scrub(positions[1], axis),
    ] as const

    // Hydration runs setup again (41.6), and every attribute naming one is bound to it, so the ids are
    // rewritten together.
    const base = options.id ?? `range-${randomToken(4, 'hex')}`
    const thumbId = (which: number) => `${base}-${which}`
    if (process.env.NODE_ENV !== 'production') checkParts('range', base)

    // The thumb a held pointer drags, or -1 while none is held.
    const dragging = reactive(-1)

    // 51.88 — the pointer takes the thumb nearer it, the high one where the two stand together and it
    // is above them, and holds it until it lets go.
    function press(event: PointerEvent) {
        const index = scrubs[0].indexAt(event)
        if (index === undefined) return
        // The press's own focusing would take focus back off the thumb it focuses, and select text as it drags.
        event.preventDefault()
        const [lowValue, highValue] = ends()
        const [low, high] = [indexOf(lowValue), indexOf(highValue)]
        const which =
            Math.abs(index - low) < Math.abs(index - high) ||
            (low === high && index < low)
                ? 0
                : 1
        dragging.set(which)
        ;(event.currentTarget as Element).setPointerCapture?.(event.pointerId)
        scrubs[which].move(event)
        document.getElementById(thumbId(which))?.focus()
    }

    // 51.87 — Up and Right step up, Down and Left step down, Page Up and Page Down a tenth of the way.
    function key(which: 0 | 1, event: KeyboardEvent) {
        const at = positions[which].peek() ?? 0
        const big = Math.max(1, Math.round(last() / 10))
        const by =
            event.key === 'ArrowUp'
                ? 1
                : event.key === 'ArrowDown'
                  ? -1
                  : event.key === 'PageUp'
                    ? big
                    : event.key === 'PageDown'
                      ? -big
                      : 0
        if (by === 0) return scrubs[which].key(event)
        event.preventDefault()
        positions[which].set(at + by)
    }

    const letGo = () => dragging.set(-1)

    return {
        id: base,
        value,
        root: {
            role: 'group',
            'data-range': 'root',
            get 'aria-label'() {
                return live(options.label)
            },
            get 'data-dragging'() {
                return dragging() === -1 ? undefined : ''
            },
        },
        track: {
            'data-range': 'track',
            onpointerdown: press,
            onpointermove: (event: PointerEvent) => {
                const held = dragging.peek()
                if (held !== -1) scrubs[held as 0 | 1].move(event)
            },
            onpointerup: letGo,
            onlostpointercapture: letGo,
        },
        fill: {
            'data-range': 'fill',
            // 51.90 — the span between the thumbs, as the computed `left` and `right` placing it.
            get style() {
                const [low, high] = value()
                return `left: ${percent(low)}; right: ${percent(max() - high + min())}`
            },
        },
        end: (which) => ({
            thumb: {
                id: thumbId(which),
                role: 'slider',
                'data-range': 'thumb',
                tabindex: '0',
                'data-thumb': which === 0 ? 'low' : 'high',
                get 'aria-label'() {
                    return labelOf(which)
                },
                get 'aria-valuemin'() {
                    return which === 0 ? min() : value()[0]
                },
                get 'aria-valuemax'() {
                    return which === 0 ? value()[1] : max()
                },
                get 'aria-valuenow'() {
                    return value()[which]
                },
                get 'aria-valuetext'() {
                    return format(value()[which])
                },
                'aria-orientation': 'horizontal',
                // 51.90 — the thumb's computed `left` along the track.
                get style() {
                    return `left: ${percent(value()[which])}`
                },
                onkeydown: (event: KeyboardEvent) => key(which, event),
            },
            input: {
                type: 'hidden',
                'data-range': 'input',
                get name() {
                    return live(options.name)
                },
                get value() {
                    return value()[which]
                },
            },
        }),
    }
}
