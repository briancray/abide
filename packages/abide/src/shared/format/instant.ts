import { instantAt } from '../instantAt.ts'

// A day alone, which `Date.parse` reads as UTC's midnight rather than the zone's.
const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/

/**
 * `value` as a time in epoch milliseconds, or `undefined` where it names no time. A `YYYY-MM-DD` is
 * the midnight of that day in `zone`, else in the zone `format.date` writes in (52.113).
 */
export function instant(value: unknown, zone?: string): number | undefined {
    if (typeof value === 'string' && DAY_ONLY.test(value))
        return instantAt(value, zone === undefined ? {} : { timeZone: zone })
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
