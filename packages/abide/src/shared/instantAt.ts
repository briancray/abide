// 52.103, 52.104 — THE INSTANT A WALL CLOCK NAMES IN A ZONE, the way back from what `calendar` and
// `<input type="time">` hold to a time a server can keep. Read with `Intl` alone, since `Temporal`
// is not in every engine abide runs in, and answering as `Temporal`'s `compatible` does, so moving
// to it changes no answer.

import { timeZone, visitorZone } from './format/timeZone.ts'
import { wallClockOf } from './format/wallClockOf.ts'

const DAY = 86_400_000
// A day, or a day and a time to the minute or the second.
const WALL_CLOCK = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/

/**
 * The epoch milliseconds at which `zone`'s clocks read `wallClock`: `instantAt('2026-12-15T14:30')`.
 * A day alone is its midnight. `undefined` where it is no day or time on the calendar.
 *
 * @param wallClock `YYYY-MM-DD`, `YYYY-MM-DDTHH:MM` or `YYYY-MM-DDTHH:MM:SS`
 * @param options the zone it is read in: by default the one `format.date` writes in (52.3)
 */
export function instantAt(
    wallClock: string,
    options: { timeZone?: string } = {},
): number | undefined {
    if (!WALL_CLOCK.test(wallClock)) return undefined
    const reading = Date.UTC(
        Number(wallClock.slice(0, 4)),
        Number(wallClock.slice(5, 7)) - 1,
        Number(wallClock.slice(8, 10)),
        Number(wallClock.slice(11, 13)),
        Number(wallClock.slice(14, 16)),
        Number(wallClock.slice(17, 19)),
    )
    // `Date.UTC` rolls February 30th into March; a reading that does not write itself back is none.
    if (
        Number.isNaN(reading) ||
        new Date(reading).toISOString().slice(0, wallClock.length) !== wallClock
    )
        return undefined
    const zone = options.timeZone ?? timeZone() ?? visitorZone()
    // 52.104 — the reading by the offset a day before and a day after it: the same instant where no
    // change of offset falls between, two where the clocks read it twice, and none where they skip
    // it — and then the earlier offset's, which lands the length of the skip later.
    const byBefore =
        reading - (wallClockOf(reading - DAY, zone) - (reading - DAY))
    const byAfter =
        reading - (wallClockOf(reading + DAY, zone) - (reading + DAY))
    const beforeReads = wallClockOf(byBefore, zone) === reading
    const afterReads = wallClockOf(byAfter, zone) === reading
    if (afterReads && (!beforeReads || byAfter < byBefore)) return byAfter
    return byBefore
}
