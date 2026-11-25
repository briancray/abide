// 51.85-51.91, 51.184 — A VALUE, OR A RANGE BETWEEN TWO THUMBS, which the native `<input type="range">`
// cannot hold: WAI-ARIA's slider and its multi-thumb variant, as parts an app spreads onto elements of
// its own. Each thumb is a scrub along the track (`scrub`) that keeps to its own side of the other, so the
// arrows, Home and End are the crosshair's, and the pointer takes the thumb nearer it and drags it while
// held. One thumb is a range of one: the same scrub, with no neighbour to keep within.

import { checkParts } from './checkParts.ts'
import { number } from './format/index.ts'
import { type Live, live } from './live.ts'
import { randomToken } from './randomToken.ts'
import { memo, type Reactive, reactive } from './reactive/index.ts'
import { scrub, type ScrubPosition } from './scrub.ts'

/** 51.184 — what a slider picks: a value, or a range's low and high end where it picks a range. */
export type SliderValue<Range extends boolean> = Range extends true
    ? readonly [low: number, high: number]
    : number

/** The value or the range picked, and the scale it is picked on. */
export type SliderOptions<Range extends boolean = false> = {
    /** The base the ids its parts write are derived from; unique on the page. One is made where none is given. */
    id?: string | undefined
    /** 51.184 — whether it picks a range between two thumbs rather than one value. Read once. */
    range?: Range | undefined
    /** The value picked, or the low and the high end of the range, where the app holds it: a `Reactive` to read and set. Held by the parts, from `min` — or from `min` to `max` for a range — and handed back as `value`, where none is given. */
    value?: Reactive<SliderValue<Range>> | undefined
    /** What is picked, as the accessible name of the thumb, or of the group holding a range's two: `'Deal amount'`. */
    label: Live<string>
    /** The least value. 0 by default. */
    min?: Live<number> | undefined
    /** The greatest value. 100 by default. */
    max?: Live<number> | undefined
    /** How far apart the values a thumb stops at are, from `min`. 1 by default. */
    step?: Live<number> | undefined
    /** A range's thumbs' accessible names, low then high. `['Minimum', 'Maximum']` by default; a function is read live. */
    labels?: Live<readonly [string, string]> | undefined
    /** Writes a value for the thumb's `aria-valuetext`: `format.money`, say. `format.number` by default. */
    format?: ((value: number) => string) | undefined
    /** The name the value is submitted under by `input`, or each end of a range, low then high (51.91); a function is read live. */
    name?: Live<string | undefined> | undefined
}

/** A thumb's parts: the thumb, and the hidden field submitting it. */
export type SliderEnd = {
    /** The thumb: its slider role, values, keys and the `style` that places it. */
    readonly thumb: Record<string, unknown>
    /** A hidden field submitting the thumb's value under `name`. */
    readonly input: Record<string, unknown>
}

/** The parts `slider` hands back, each spread onto an element: `<span {...volume.thumb} />`, or `<span {...amount.end(0).thumb} />` for a range. */
export type SliderParts<Range extends boolean = false> = {
    /** The base its parts' ids are derived from. */
    readonly id: string
    /** The root's `data-dragging`, and a range's group role and name. */
    readonly root: Record<string, unknown>
    /** The track's pointer handling: a press takes the nearer thumb and drags it. */
    readonly track: Record<string, unknown>
    /** The span from `min` to the thumb, or between a range's thumbs, as the `style` that places it. */
    readonly fill: Record<string, unknown>
    /** The value picked, or the low and the high end of the range, read and set. */
    readonly value: Reactive<SliderValue<Range>>
} & (Range extends true
    ? {
          /** One end's parts, low (`0`) or high (`1`). */
          end(which: 0 | 1): SliderEnd
      }
    : SliderEnd)

const DEFAULT_LABELS = ['Minimum', 'Maximum'] as const

/** WAI-ARIA's slider: a value on a track, or a low and a high one where it picks a range, as parts to spread. */
export function slider<Range extends boolean = false>(
    options: SliderOptions<Range>,
): SliderParts<Range> {
    const range = options.range === true
    // 49.11 — read where they are used.
    const labelOf = (which: number) =>
        range
            ? (live(options.labels) ?? DEFAULT_LABELS)[which as 0 | 1]
            : live(options.label)
    const format = (each: number) => (options.format ?? number)(each)
    const min = () => live(options.min) ?? 0
    const max = () => live(options.max) ?? 100
    const step = () => live(options.step) ?? 1
    const value = (options.value ??
        reactive<SliderValue<boolean>>(
            range ? [min(), max()] : min(),
        )) as Reactive<SliderValue<boolean>>

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

    // A thumb's value, followed or as it stands: one thumb's is the value itself.
    const at = (which: number): number => {
        const now = value()
        return typeof now === 'number' ? now : now[which as 0 | 1]
    }
    const ends = (): readonly number[] => {
        const now = value.peek() as SliderValue<boolean>
        return typeof now === 'number' ? [now] : now
    }
    // 51.86 — the least and the greatest index a thumb takes: a range's low thumb stops at the high,
    // and its high one at the low.
    const lowest = (which: number) =>
        which === 1 ? indexOf(ends()[0] as number) : 0
    const highest = (which: number) =>
        range && which === 0 ? indexOf(ends()[1] as number) : last()

    function position(which: number): ScrubPosition {
        return {
            peek: () => indexOf(ends()[which] as number),
            set(index) {
                const moved = valueOf(
                    Math.min(Math.max(index, lowest(which)), highest(which)),
                )
                if (!range) return value.set(moved)
                const [low, high] = ends() as readonly [number, number]
                value.set(which === 0 ? [moved, high] : [low, moved])
            },
        }
    }
    const count = range ? 2 : 1
    const axis = {
        count: () => last() + 1,
        nearest: (fraction: number) =>
            Math.round(Math.min(1, Math.max(0, fraction)) * last()),
    }
    const positions: ScrubPosition[] = []
    const scrubs: ReturnType<typeof scrub>[] = []
    for (let which = 0; which < count; which += 1) {
        positions.push(position(which))
        scrubs.push(scrub(positions[which] as ScrubPosition, axis))
    }

    // Hydration runs setup again (41.6), and every attribute naming one is bound to it, so the ids are
    // rewritten together.
    const base = options.id ?? `range-${randomToken(4, 'hex')}`
    const thumbId = (which: number) => `${base}-${which}`
    if (process.env.NODE_ENV !== 'production') checkParts('slider', base)

    // The thumb a held pointer drags, or -1 while none is held.
    const dragging = reactive(-1)

    // 51.88 — the pointer takes the thumb nearer it, the high one where the two stand together and it
    // is above them, and holds it until it lets go.
    function press(event: PointerEvent) {
        const index = (scrubs[0] as ReturnType<typeof scrub>).indexAt(event)
        if (index === undefined) return
        // The press's own focusing would take focus back off the thumb it focuses, and select text as it drags.
        event.preventDefault()
        let which = 0
        if (range) {
            const [low, high] = [lowest(1), highest(0)]
            which =
                Math.abs(index - low) < Math.abs(index - high) ||
                (low === high && index < low)
                    ? 0
                    : 1
        }
        dragging.set(which)
        ;(event.currentTarget as Element).setPointerCapture?.(event.pointerId)
        ;(scrubs[which] as ReturnType<typeof scrub>).move(event)
        document.getElementById(thumbId(which))?.focus()
    }

    // 51.87 — Up and Right step up, Down and Left step down, Page Up and Page Down a tenth of the way.
    function key(which: number, event: KeyboardEvent) {
        const moving = positions[which] as ScrubPosition
        const from = moving.peek() ?? 0
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
        if (by === 0)
            return (scrubs[which] as ReturnType<typeof scrub>).key(event)
        event.preventDefault()
        moving.set(from + by)
    }

    const letGo = () => dragging.set(-1)

    const end = (which: number): SliderEnd => ({
        thumb: {
            id: thumbId(which),
            role: 'slider',
            'data-slider': 'thumb',
            tabindex: '0',
            'data-thumb': range ? (which === 0 ? 'low' : 'high') : undefined,
            get 'aria-label'() {
                return labelOf(which)
            },
            get 'aria-valuemin'() {
                return which === 1 ? at(0) : min()
            },
            get 'aria-valuemax'() {
                return range && which === 0 ? at(1) : max()
            },
            get 'aria-valuenow'() {
                return at(which)
            },
            get 'aria-valuetext'() {
                return format(at(which))
            },
            'aria-orientation': 'horizontal',
            // 51.90 — the thumb's computed `left` along the track.
            get style() {
                return `left: ${percent(at(which))}`
            },
            onkeydown: (event: KeyboardEvent) => key(which, event),
        },
        input: {
            type: 'hidden',
            'data-slider': 'input',
            get name() {
                return live(options.name)
            },
            get value() {
                return at(which)
            },
        },
    })

    const parts = {
        id: base,
        value,
        // 51.85, 51.184 — a range's thumbs are a group named by `label`; one thumb is named by it.
        root: {
            role: range ? 'group' : undefined,
            'data-slider': 'root',
            get 'aria-label'() {
                return range ? live(options.label) : undefined
            },
            get 'data-dragging'() {
                return dragging() === -1 ? undefined : ''
            },
        },
        track: {
            'data-slider': 'track',
            onpointerdown: press,
            onpointermove: (event: PointerEvent) => {
                const held = dragging.peek() as number
                if (held !== -1)
                    (scrubs[held] as ReturnType<typeof scrub>).move(event)
            },
            onpointerup: letGo,
            onlostpointercapture: letGo,
        },
        fill: {
            'data-slider': 'fill',
            // 51.90 — the span from `min` to the thumb, or between a range's thumbs, as the computed
            // `left` and `right` placing it.
            get style() {
                const low = range ? at(0) : min()
                const high = at(range ? 1 : 0)
                return `left: ${percent(low)}; right: ${percent(max() - high + min())}`
            },
        },
    }
    // 49.9 — one thumb's parts are members; a range's are a function of the end.
    if (range) {
        const built = [end(0), end(1)] as const
        return { ...parts, end: (which: 0 | 1) => built[which] } as never
    }
    return { ...parts, ...end(0) } as never
}
