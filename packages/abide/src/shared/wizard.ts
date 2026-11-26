// 51.141-51.144 — A TASK TAKEN IN STEPS: the step on, the ones done and the ones ahead, with a button to
// go on and one to go back and a `meter` of how far it has come, as parts an app spreads onto markup of
// its own. Going on waits on `valid`; going back is always open, to any step done.

import { handFocus, nearest } from './handFocus.ts'
import { keyOfItem, type KeyOption } from './itemKey.ts'
import { type Live, live } from './live.ts'
import { type Meter, meter } from './meter.ts'
import { type Reactive, reactive } from './reactive/index.ts'
import { reactiveOver } from './reactiveOver.ts'

/** The steps, how each is told apart, the one on, and whether the one on may be left forward. */
export type WizardOptions<Step> = {
    /** The steps, in order; a function is read live. */
    steps: Live<readonly Step[]>
    /** The key of the step on: a `Reactive` to read and set. Held by the parts, and handed back as `current`, where none is given. A key no step has is the first. */
    current?: Reactive<string | undefined> | undefined
    /** Whether a step is done enough to go on from. Every step is by default. */
    valid?: ((step: Step) => boolean) | undefined
} & KeyOption<Step>

/** The parts `wizard` hands back: `<li {...signup.step('plan')}>`, `<button {...signup.next}>`. */
export type Wizard<Step> = {
    /** A step's marker in the list of steps: current, done or ahead, and a way back where done. */
    step(step: Step): Record<string, unknown>
    /** The button going on to the step after, disabled on the last or where `valid` refuses. */
    readonly next: Record<string, unknown>
    /** The button going back to the step before, disabled on the first. */
    readonly previous: Record<string, unknown>
    /** How far it has come: a `meter`'s parts, of the step on among the steps (49.18). */
    readonly meter: Meter
    /** The key of the step on, the first where none is; written, it goes there. */
    readonly current: Reactive<string | undefined>
    /** Whether the step on is the last. */
    get last(): boolean
}

/** A task taken in steps, with next and previous, the steps' markers and a meter of progress. */
export function wizard<Step>(options: WizardOptions<Step>): Wizard<Step> {
    const picked = options.current ?? reactive<string | undefined>(undefined)
    const keyOf = (step: Step) => keyOfItem(options.key, step)
    const steps = reactive((): readonly string[] => {
        const written: string[] = []
        for (const step of live(options.steps)) written.push(keyOf(step))
        return written
    })
    // 51.141 — a key no step has is the first.
    const at = (): number => Math.max(0, steps().indexOf(picked() as string))
    const key = (index: number) => steps()[index]
    const go = (index: number): void => {
        const to = key(index)
        if (to !== undefined) picked.set(to)
    }
    // Whether the step at `index` may be left forward: the step itself is what `valid` is handed.
    const valid = (index: number): boolean => {
        const step = live(options.steps)[index]
        return (
            step === undefined ||
            options.valid === undefined ||
            options.valid(step)
        )
    }
    return {
        // 51.143
        step: (item) => {
            const step = keyOf(item)
            return {
                'data-wizard': 'step',
                get 'aria-current'() {
                    return key(at()) === step ? 'step' : undefined
                },
                // 49.17
                get 'data-current'() {
                    return key(at()) === step ? '' : undefined
                },
                get 'data-done'() {
                    const index = steps().indexOf(step)
                    return index !== -1 && index < at() ? '' : undefined
                },
                onclick: () => {
                    const index = steps().indexOf(step)
                    if (index !== -1 && index < at()) go(index)
                },
            }
        },
        // 51.142
        next: {
            type: 'button',
            'data-wizard': 'next',
            get disabled() {
                return at() >= steps().length - 1 || !valid(at())
            },
            // 49.15 — on the last step, focus goes to `previous`.
            onclick: (event?: MouseEvent) => {
                if (at() >= steps().length - 1 || !valid(at())) return
                go(at() + 1)
                handFocus(
                    event?.currentTarget,
                    at() >= steps().length - 1,
                    () =>
                        nearest(
                            event?.currentTarget,
                            '[data-wizard="previous"]',
                        ),
                )
            },
        },
        previous: {
            type: 'button',
            'data-wizard': 'previous',
            get disabled() {
                return at() === 0
            },
            // 49.15 — on the first step, focus goes to `next`.
            onclick: (event?: MouseEvent) => {
                go(at() - 1)
                handFocus(event?.currentTarget, at() === 0, () =>
                    nearest(event?.currentTarget, '[data-wizard="next"]'),
                )
            },
        },
        // 51.144
        meter: meter({
            value: () => at() + 1,
            min: 0,
            max: () => steps().length,
            label: 'Progress',
        }),
        current: reactiveOver(
            () => key(at()),
            (to: string | undefined) => picked.set(to),
        ),
        get last() {
            return at() >= steps().length - 1
        },
    }
}
