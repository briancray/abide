import { isReactive } from '../reactive/isReactive.ts'

/**
 * What an `observe` adaptor writes, in either of its two forms: a `Reactive` takes the measurement
 * as its value, and a callback as its argument.
 *
 * THE BRAND IS READ FIRST (1.6): a `Reactive` is callable, and called it would be read rather than
 * written.
 */
export class Measured {
    target: unknown
    // What the callback form was last handed, which is what a `Reactive` holds for the other form.
    last: unknown = undefined

    constructor(target: unknown) {
        this.target = target
    }

    /** What the target holds now, read without subscribing anyone. */
    held(): unknown {
        const target = this.target
        return isReactive(target)
            ? (target as unknown as { peek(): unknown }).peek()
            : this.last
    }

    write(value: unknown): void {
        const target = this.target
        if (isReactive(target)) {
            ;(target as unknown as { set(value: unknown): void }).set(value)
            return
        }
        this.last = value
        ;(target as (value: unknown) => void)(value)
    }
}
