// A value a parts function reads as it is used: the value itself, or a function answering it, read
// live — so a component hands its props over as `() => prop` and an app hands a constant as is.

/** A value, or a function answering it, read each time it is used. */
export type Live<Value> = Value | (() => Value)

/** What `value` holds now: called where it is a function, as it is where it is not. */
export function live<Value>(value: Live<Value>): Value {
    return typeof value === 'function' ? (value as () => Value)() : value
}
