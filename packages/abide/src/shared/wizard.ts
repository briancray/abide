// 51.141-51.144 — A TASK TAKEN IN STEPS: the step on, the ones done and the ones ahead, with a button to
// go on and one to go back and a `meter` of how far it has come, as parts an app spreads onto markup of
// its own. Going on waits on `valid`; going back is always open, to any step done.

import { type Live, live } from './live.ts'
import { type Meter, meter } from './meter.ts'
import { type Reactive, reactive } from './reactive/index.ts'
import { reactiveOver } from './reactiveOver.ts'

/** The steps, the one on, and whether the one on may be left forward. */
export type WizardOptions = {
    /** The steps' keys, in order; a function is read live. */
    steps: Live<readonly string[]>
    /** The key of the step on: a `Reactive` to read and set. Held by the parts, and handed back as `current`, where none is given. A key no step has is the first. */
    current?: Reactive<string | undefined>
    /** Whether the step a key names is done enough to go on from. Every step is by default. */
    valid?: (step: string) => boolean
}

/** The parts `wizard` hands back: `<li {...signup.step('plan')}>`, `<button {...signup.next}>`. */
export type Wizard = {
    /** A step's marker in the list of steps: current, done or ahead, and a way back where done. */
    step(key: string): Record<string, unknown>
    /** The button going on to the step after, disabled on the last or where `valid` refuses. */
    readonly next: Record<string, unknown>
    /** The button going back to the step before, disabled on the first. */
    readonly previous: Record<string, unknown>
    /** How far it has come: a `meter` of the step on among the steps. */
    readonly progress: Meter
    /** The key of the step on, the first where none is; written, it goes there. */
    readonly current: Reactive<string | undefined>
    /** Whether the step on is the last. */
    get last(): boolean
}

/** A task taken in steps, with next and previous, the steps' markers and a meter of progress. */
export function wizard(options: WizardOptions): Wizard {
    const picked = options.current ?? reactive<string | undefined>(undefined)
    const steps = () => live(options.steps)
    // 51.141 — a key no step has is the first.
    const at = (): number => Math.max(0, steps().indexOf(picked() as string))
    const key = (index: number) => steps()[index]
    const go = (index: number): void => {
        const to = key(index)
        if (to !== undefined) picked.set(to)
    }
    const valid = (step: string | undefined) =>
        step === undefined || options.valid === undefined || options.valid(step)
    return {
        // 51.143
        step: (step) => ({
            'data-wizard': 'step',
            get 'aria-current'() {
                return key(at()) === step ? 'step' : undefined
            },
            get 'data-done'() {
                const index = steps().indexOf(step)
                return index !== -1 && index < at() ? '' : undefined
            },
            onclick: () => {
                const index = steps().indexOf(step)
                if (index !== -1 && index < at()) go(index)
            },
        }),
        // 51.142
        next: {
            type: 'button',
            'data-wizard': 'next',
            get disabled() {
                return at() >= steps().length - 1 || !valid(key(at()))
            },
            onclick: () => {
                if (at() < steps().length - 1 && valid(key(at()))) go(at() + 1)
            },
        },
        previous: {
            type: 'button',
            'data-wizard': 'previous',
            get disabled() {
                return at() === 0
            },
            onclick: () => go(at() - 1),
        },
        // 51.144
        progress: meter({
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
