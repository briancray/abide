// 51.130-51.135 — `playback`: its clock driven a frame at a time, the frame's time chosen here, and
// its parts read and pressed as a template and a browser would.

import { afterAll, beforeEach, expect, test } from 'bun:test'

import { flushSync, jsonSchema, playback, reactive } from '#shared'

// The frames asked for, run when a test says, each handed the time it names.
let queued: FrameRequestCallback[] = []
const native = {
    request: globalThis.requestAnimationFrame,
    cancel: globalThis.cancelAnimationFrame,
}
beforeEach(() => {
    queued = []
    globalThis.requestAnimationFrame = (callback) => queued.push(callback)
    globalThis.cancelAnimationFrame = () => {
        queued = []
    }
})
afterAll(() => {
    globalThis.requestAnimationFrame = native.request
    globalThis.cancelAnimationFrame = native.cancel
})
const frame = (time: number) => {
    const due = queued
    queued = []
    for (const callback of due) callback(time)
    flushSync()
}
const press = (part: Record<string, unknown>) => {
    ;(part.onclick as () => void)()
    flushSync()
}
const key = (part: Record<string, unknown>, name: string) => {
    ;(part.onkeydown as (event: KeyboardEvent) => void)(
        new KeyboardEvent('keydown', { key: name, cancelable: true }),
    )
    flushSync()
}

// THE REVERT: move `at` by the time passed alone, and a replay at twice the speed moves at real time.
test('playing moves it by the time passed times its rate, and it stops at its end — 51.130, 51.131', () => {
    const trip = playback({ duration: 1000, rate: reactive(2) })
    press(trip.play)
    frame(0)
    frame(100)
    expect(trip.at.get()).toBe(200)
    frame(500)
    expect([trip.at.get(), trip.playing.get()]).toEqual([1000, false])
    expect(queued).toHaveLength(0)
    const round = playback({ duration: 1000, loop: true })
    press(round.play)
    frame(0)
    frame(1200)
    expect([round.at.get(), round.playing.get()]).toEqual([0, true])
})

// THE REVERT: drop the start-over from `play`, and pressing it at the end plays nothing.
test('its play button is a toggle over playing, and playing from the end starts over — 51.132', () => {
    const at = reactive(1000)
    const trip = playback({ duration: 1000, at })
    expect([trip.play['aria-pressed'], trip.play['aria-label']]).toEqual([
        'false',
        'Play',
    ])
    press(trip.play)
    expect([
        trip.playing.get(),
        trip.at.get(),
        trip.play['aria-pressed'],
    ]).toEqual([true, 0, 'true'])
    press(trip.play)
    expect(trip.playing.get()).toBe(false)
})

// THE REVERT: write the scrubber's value to `at` unbounded, and a drag past its end runs past `duration`.
test('the scrubber reads and moves where it is, and the speeds pick its rate — 51.133, 51.134', () => {
    const trip = playback({ duration: 9000, rates: [1, 4] })
    expect([
        trip.scrubber.type,
        trip.scrubber.max,
        trip.scrubber.value,
    ]).toEqual(['range', '9000', '0'])
    const input = document.createElement('input')
    input.value = '12000'
    input.addEventListener('input', trip.scrubber.oninput as EventListener)
    input.dispatchEvent(new Event('input'))
    flushSync()
    expect(trip.at.get()).toBe(9000)
    press(trip.toggleGroup.item(4))
    expect([trip.rate.get(), trip.toggleGroup.item(4)['aria-checked']]).toEqual(
        [4, 'true'],
    )
})

// THE REVERT: drop the arrow bindings from `root`, and the keys move nothing.
test('Space plays and pauses, and the arrows move it by its step, kept to its length — 51.135', () => {
    const trip = playback({ duration: 8000, step: 3000 })
    key(trip.root, ' ')
    expect(trip.playing.get()).toBe(true)
    key(trip.root, ' ')
    key(trip.root, 'ArrowRight')
    key(trip.root, 'ArrowRight')
    key(trip.root, 'ArrowRight')
    expect(trip.at.get()).toBe(8000)
    key(trip.root, 'ArrowLeft')
    expect(trip.at.get()).toBe(5000)
})

// A press bubbling from a control inside the root is the control's: Space on a button presses that
// button, an arrow on a slider moves the slider. Dispatched for real, so `target` and `currentTarget`
// are a browser's. THE REVERT: bind `root.onkeydown` to the hotkeys alone, and the slider's arrow moves
// `at` to 5000 and the button's Space plays — `[5000, true]` where `[0, false]` is due.
test('a press on a control inside the root is the control’s, and a press on the root its own — 51.135', () => {
    const trip = playback({ duration: 8000 })
    const root = document.createElement('div')
    root.tabIndex = 0
    root.addEventListener('keydown', trip.root.onkeydown as EventListener)
    const thumb = document.createElement('span')
    thumb.setAttribute('role', 'slider')
    const button = document.createElement('button')
    const label = document.createElement('span')
    button.append(label)
    root.append(thumb, button)
    document.body.append(root)
    const send = (on: Element, name: string) => {
        on.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: name,
                bubbles: true,
                cancelable: true,
            }),
        )
        flushSync()
    }
    send(thumb, 'ArrowRight')
    send(label, ' ')
    expect([trip.at.get(), trip.playing.get()]).toEqual([0, false])
    send(root, 'ArrowRight')
    send(root, ' ')
    expect([trip.at.get(), trip.playing.get()]).toEqual([5000, true])
    root.remove()
})

// THE REVERT: rewind `at` before writing `playing`, and a refused play still moves it to 0 — `at` reads 0.
test('a play its playing refuses leaves where it is — 49.19', () => {
    const playing = reactive<boolean>(false, {
        schema: jsonSchema<boolean>({ enum: [false] }),
    })
    const trip = playback({ duration: 1000, at: reactive(1000), playing })
    press(trip.play)
    expect([trip.playing.get(), trip.at.get()]).toEqual([false, 1000])
})

// THE REVERT: ignore what the tick's `at` write hands back, and a refused move leaves the clock playing
// with a frame queued every frame — playing reads true and one frame is queued.
test('a move its at refuses stops the clock rather than spinning on it — 49.19', () => {
    const at = reactive<number>(0, {
        schema: jsonSchema<number>({ type: 'number', maximum: 300 }),
    })
    const trip = playback({ duration: 1000, at })
    press(trip.play)
    frame(0)
    frame(200)
    expect(trip.at.get()).toBe(200)
    frame(400)
    expect([trip.at.get(), trip.playing.get(), queued.length]).toEqual([
        200,
        false,
        0,
    ])
})
