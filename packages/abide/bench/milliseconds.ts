/** Nanoseconds as milliseconds to two decimals, without a unit. */
export function milliseconds(nanoseconds: number): string {
    return (nanoseconds / 1e6).toFixed(2)
}

/** Nanoseconds as microseconds to one decimal, with the unit. */
export function microseconds(nanoseconds: number): string {
    return `${(nanoseconds / 1000).toFixed(1)} µs`
}
