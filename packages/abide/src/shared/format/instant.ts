/** `value` as a time in epoch milliseconds, or `undefined` where it names no time. */
export function instant(value: unknown): number | undefined {
    const time =
        value instanceof Date
            ? value.getTime()
            : typeof value === 'number'
              ? value
              : typeof value === 'string' && value !== ''
                ? Date.parse(value)
                : Number.NaN
    return Number.isFinite(time) ? time : undefined
}
