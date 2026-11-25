import { instantAt } from '../instantAt.ts'

// A day, or a day and a time with no offset — what `Date.parse` reads in UTC or in the process's
// zone rather than the zone being written. The wall clock `instantAt` reads, and any fraction of a
// second after it.
const WALL_CLOCK =
    /^(\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?)?)(?:\.(\d+))?$/

/**
 * `value` as a time in epoch milliseconds, or `undefined` where it names no time. A `YYYY-MM-DD`,
 * or one with a time and no offset, is that wall clock in `zone`, else in the zone `format.date`
 * writes in (52.113).
 */
export function instant(value: unknown, zone?: string): number | undefined {
    if (typeof value === 'string') {
        const wallClock = WALL_CLOCK.exec(value)
        if (wallClock !== null) {
            const [, reading = '', fraction] = wallClock
            // A fraction follows a reading to the second, `YYYY-MM-DDTHH:MM:SS`.
            if (fraction !== undefined && reading.length !== 19)
                return undefined
            const at = instantAt(
                reading,
                zone === undefined ? {} : { timeZone: zone },
            )
            return at === undefined || fraction === undefined
                ? at
                : at + Number(fraction.slice(0, 3).padEnd(3, '0'))
        }
    }
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
