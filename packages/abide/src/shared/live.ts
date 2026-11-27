// A value a headless component reads as it is used: the value itself, a function answering it, or a
// `Reactive` holding it, read live — so a component hands its props over as `() => prop`, an app hands
// a constant as is, and a `Reactive` is read wherever a function answering it would be.

import { isReactive } from './reactive/isReactive.ts'
import type { Reactive } from './reactive/Reactive.ts'

/** A value, a function answering it, or a `Reactive` holding it, read each time it is used. */
export type Live<Value> = Value | (() => Value) | Reactive<Value>

/** What `value` holds now: read where it is a `Reactive` (1.6, the brand first), called where it is a function, as it is where it is neither. */
export function live<Value>(value: Live<Value>): Value {
    if (isReactive(value)) return value.get() as Value
    return typeof value === 'function' ? (value as () => Value)() : value
}
