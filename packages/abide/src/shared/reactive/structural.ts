// THE BY-VALUE COMPARATOR AN APP PASSES. Not the default: the default is the
// reference, and this is what a value whose producer RE-MATERIALISES declares —
// `reactive(() => getInvoice({ id }), { identity: structural })`. A fresh-but-equal
// payload waking every reader is why it exists at all; what it stops being is the
// price every other value pays.
//
// 5.5: it answers "not equal" wherever it cannot decide. A comparator that guessed
// would collapse a production a reader needed, and the failure is silent — the value
// stays right while the wake goes missing.
export function structural(next: unknown, previous: unknown): boolean {
    if (Object.is(next, previous)) return true
    if (
        next === null ||
        previous === null ||
        typeof next !== 'object' ||
        typeof previous !== 'object'
    )
        return false

    const nextIsArray = Array.isArray(next)
    if (nextIsArray !== Array.isArray(previous)) return false
    if (nextIsArray) {
        const one = next as unknown[]
        const two = previous as unknown[]
        if (one.length !== two.length) return false
        for (let index = 0; index < one.length; index += 1)
            if (!structural(one[index], two[index])) return false
        return true
    }

    // Anything exotic — a Map, a Date, a class instance — is where 5.5 bites. Walking
    // own enumerable keys on one of those compares nothing that decides it.
    if (
        Object.getPrototypeOf(next) !== Object.prototype ||
        Object.getPrototypeOf(previous) !== Object.prototype
    )
        return false

    // `Object.keys` ALLOCATES TWO ARRAYS PER COMPARE and it is still the fast arm.
    // Replacing both with `for...in` walks — no allocation, one counting pass for the
    // other side — measured SLOWER under JSC on the shape this runs on: 45.8 ns became
    // 48.6 ns and 56.7 ns across two runs. Per-iteration cost in `for...in` exceeds what the
    // allocation saves at this object size, so the allocation stays.
    const keys = Object.keys(next as Record<string, unknown>)
    if (keys.length !== Object.keys(previous as Record<string, unknown>).length)
        return false
    for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index] as string
        if (!Object.hasOwn(previous, key)) return false
        if (
            !structural(
                (next as Record<string, unknown>)[key],
                (previous as Record<string, unknown>)[key],
            )
        )
            return false
    }
    return true
}
