// 51.130-51.135 — A CLOCK AND ITS CONTROLS: what drives a replay, an animation or a timeline, as parts
// an app spreads onto a play button, a scrubber, a row of speeds and a host for its keys. Composed of
// public parts: the play button is a `toggle` over `playing`, the speeds a `toggleGroup` over `rates`
// handed back whole under its name (49.18), and the keys `hotkeys`. The clock is one
// `requestAnimationFrame` loop, running only while it plays.

import { hotkeys } from './hotkeys.ts'
import { type Live, live } from './live.ts'
import { type Reactive, reactive, watch } from './reactive/index.ts'
import { reactiveOver } from './reactiveOver.ts'
import { toggle } from './toggle.ts'
import { type ToggleGroup, toggleGroup } from './toggleGroup.ts'
import { withPart } from './withPart.ts'

/** How long it runs, where it is, whether and how fast it plays, and what the keys step by. */
export type PlaybackOptions = {
    /** How long it runs, in milliseconds; a function is read live. */
    duration: Live<number>
    /** Where it is, in milliseconds from the start: a `Reactive` to read and set. Held by the parts, and handed back as `at`, where none is given. */
    at?: Reactive<number>
    /** Whether it is playing: a `Reactive` to read and set. Held by the parts, and handed back as `playing`, where none is given. */
    playing?: Reactive<boolean>
    /** How fast it plays, `1` being real time: a `Reactive` to read and set. Held by the parts, and handed back as `rate`, where none is given. */
    rate?: Reactive<number>
    /** The speeds its `toggleGroup` offers. `[0.5, 1, 2]` by default; a function is read live. */
    rates?: Live<readonly number[]>
    /** Whether it starts over at its end rather than stopping. `false` by default; a function is read live. */
    loop?: Live<boolean>
    /** The milliseconds an arrow key moves it. `5000` by default; a function is read live. */
    step?: Live<number>
}

/** The parts `playback` hands back, and where it is, whether it plays and how fast. */
export type Playback = {
    /** The element whose keys drive it: Space plays and pauses, the arrows move it. */
    readonly root: Record<string, unknown>
    /** The play button: a `toggle`'s, pressed while it plays. */
    readonly play: Record<string, unknown>
    /** The scrubber, an `<input type="range">` from the start to `duration`. */
    readonly scrubber: Record<string, unknown>
    /** The speeds: a `toggleGroup` over `rates`, handed back whole, each key the rate written as text. */
    readonly toggleGroup: ToggleGroup<number>
    /** Where it is, in milliseconds; written, it moves there. */
    readonly at: Reactive<number>
    /** Whether it is playing; written, it plays or pauses. */
    readonly playing: Reactive<boolean>
    /** How fast it plays; written, it changes speed. */
    readonly rate: Reactive<number>
}

/** A clock moving `at` while `playing`, with a play button, a scrubber, speeds and keys. */
export function playback(options: PlaybackOptions): Playback {
    const at = options.at ?? reactive(0)
    const playing = options.playing ?? reactive(false)
    const rate = options.rate ?? reactive(1)
    const duration = () => Math.max(0, live(options.duration))
    const move = (to: number): void =>
        at.set(Math.min(duration(), Math.max(0, to)))

    // 51.130, 51.131 — each frame, the time since the last times `rate`; at the end, round again or stop.
    watch(() => {
        if (!playing() || globalThis.requestAnimationFrame === undefined) return
        let frame = 0
        let last: number | undefined
        const tick = (now: number): void => {
            const passed = last === undefined ? 0 : now - last
            last = now
            const next = (at.peek() ?? 0) + passed * (rate.peek() ?? 1)
            if (next < duration()) at.set(next)
            else if (live(options.loop) === true) at.set(0)
            else {
                at.set(duration())
                playing.set(false)
                return
            }
            frame = requestAnimationFrame(tick)
        }
        frame = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(frame)
    })

    // 51.132 — playing from the end starts over.
    const pressed = reactiveOver(
        () => playing(),
        (on: boolean) => {
            if (on && (at.peek() ?? 0) >= duration()) at.set(0)
            playing.set(on)
        },
    )
    const play = withPart(withPart({}, toggle({ pressed }).button), {
        'data-playback': 'play',
        get 'aria-label'() {
            return playing() ? 'Pause' : 'Play'
        },
    })

    // 51.134 — the rate picked, as the key its button carries.
    const speeds = toggleGroup({
        items: () => live(options.rates) ?? [0.5, 1, 2],
        value: reactiveOver(
            () => String(rate()),
            (key: string | undefined) => {
                if (key !== undefined) rate.set(Number(key))
            },
        ),
        label: 'Speed',
    })

    // 51.135
    const keys = hotkeys({
        space: () => pressed.set(!playing.peek()),
        arrowleft: () => move((at.peek() ?? 0) - (live(options.step) ?? 5000)),
        arrowright: () => move((at.peek() ?? 0) + (live(options.step) ?? 5000)),
    })

    return {
        root: { 'data-playback': 'root', onkeydown: keys },
        play,
        // 51.133
        scrubber: {
            type: 'range',
            'data-playback': 'scrubber',
            min: '0',
            'aria-label': 'Position',
            get max() {
                return String(duration())
            },
            get value() {
                return String(Math.round(at()))
            },
            oninput: (event: Event) =>
                move(Number((event.currentTarget as HTMLInputElement).value)),
        },
        toggleGroup: speeds,
        at,
        playing,
        rate,
    }
}
