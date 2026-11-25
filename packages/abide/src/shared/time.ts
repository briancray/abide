// 52.72-52.77 — A TIME THAT STAYS CURRENT, as parts an app spreads onto a `<time>` of its own: how long
// ago or how soon it is, as `format.relative` writes it, its `datetime` for a machine and its `title` the
// date in full. One set of parts serves every time a list writes — `seen.time(row.at)` per row — and
// each `<time>` is followed by the one clock (`clock.ts`) for as long as its element is bound, so the
// clock ticks at the moment the soonest label next reads differently.

import { clock, follow } from './clock.ts'
import { date, relative } from './format/index.ts'
import { instant } from './format/instant.ts'
import { type Live, live } from './live.ts'

/** How a time is written. Each is read live where a function is given. */
export type TimeOptions = {
    /** `'long'` (`12 minutes ago`), `'short'` (`12 min. ago`) or `'narrow'` (`12m ago`). `'long'` by default. */
    style?: Live<'long' | 'short' | 'narrow'> | undefined
    /** The BCP 47 locale it is written in. `'en-US'` by default. */
    locale?: Live<string | undefined> | undefined
    /** The zone the `title` writes the date in, as `format.date` takes one. */
    timeZone?: Live<string | undefined> | undefined
}

/** One time's parts: the `<time>` holding it, and the text it reads as. */
export type TimeAt = {
    /** The `<time>`: its `datetime` and `title`, neither where it is no time, and the clock following it while bound. */
    readonly time: Record<string, unknown>
    /** How long ago or how soon it is, as the clock reads it now: `—` where it is no time. */
    get text(): string
}

/** The parts `time` hands back: `<time {...seen.at(when).time}>{seen.at(when).text}</time>`. */
export type TimeParts = {
    /** The parts of `value` — a `Date`, epoch milliseconds or an ISO string. */
    at(value: unknown): TimeAt
}

/** Times that stay current, written as `format.relative` writes them against one clock for the page. */
export function time(options: TimeOptions = {}): TimeParts {
    return {
        at(value) {
            // 52.113 — a day, or a time with no offset, is that wall clock in the zone the `title` writes in.
            const at = instant(value, live(options.timeZone))
            return {
                get time() {
                    return timeOf(at)
                },
                get text() {
                    const locale = live(options.locale)
                    return relative(at, {
                        now: clock(),
                        style: live(options.style) ?? 'long',
                        ...(locale === undefined ? {} : { locale }),
                    })
                },
            }
        },
    }

    function timeOf(at: number | undefined): Record<string, unknown> {
        if (at === undefined) return { 'data-time': 'time' }
        const timeZone = live(options.timeZone)
        const locale = live(options.locale)
        return {
            'data-time': 'time',
            datetime: new Date(at).toISOString(),
            title: date(at, {
                style: 'dateTime',
                ...(timeZone === undefined ? {} : { timeZone }),
                ...(locale === undefined ? {} : { locale }),
            }),
            // 52.73 — followed for as long as it is bound, so the clock ticks when its label next changes.
            'bind:element': () => follow(at),
        }
    }
}
