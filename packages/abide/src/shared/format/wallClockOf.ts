// What a zone's clocks read at an instant, as the one number both directions turn on: the reading
// taken as if it were UTC's, so `wallClockOf(time, zone) - time` is the zone's offset at `time`.
// `format.date`'s `'input'` style writes it, and `instantAt` searches for the instant that reads it.

import { cached } from './cached.ts'

/** The epoch milliseconds UTC's clocks would show for what `zone`'s clocks read at `time`. */
export function wallClockOf(time: number, zone: string): number {
    const parts = cached(
        `wall clock ${zone}`,
        () =>
            new Intl.DateTimeFormat('en-US', {
                timeZone: zone,
                // `h23`, or an engine writes midnight as hour 24.
                hourCycle: 'h23',
                year: 'numeric',
                month: 'numeric',
                day: 'numeric',
                hour: 'numeric',
                minute: 'numeric',
                second: 'numeric',
            }),
    ).formatToParts(time)
    let year = 0
    let month = 0
    let day = 0
    let hour = 0
    let minute = 0
    let second = 0
    for (const part of parts) {
        if (part.type === 'year') year = Number(part.value)
        else if (part.type === 'month') month = Number(part.value)
        else if (part.type === 'day') day = Number(part.value)
        else if (part.type === 'hour') hour = Number(part.value)
        else if (part.type === 'minute') minute = Number(part.value)
        else if (part.type === 'second') second = Number(part.value)
    }
    // The formatter reads whole seconds; the milliseconds past one are the same in every zone.
    const past = ((time % 1000) + 1000) % 1000
    return Date.UTC(year, month - 1, day, hour, minute, second) + past
}
