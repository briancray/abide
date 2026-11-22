// 52.83-52.96 — WAI-ARIA's date grid, as parts an app spreads onto elements of its own: a month of
// whole weeks, a header row of weekdays, a cell per day, the month's heading and the buttons paging
// it. A day is a `YYYY-MM-DD` string and a month a `YYYY-MM` one, and every day is counted on UTC's
// calendar, which has no daylight saving to drop or repeat one; a zone is read only for which day is
// today. The server writes every attribute, so the page is the month as it stands before it hydrates.

import { checkParts } from './checkParts.ts'
import { cached } from './format/cached.ts'
import { timeZone, visitorZone } from './format/timeZone.ts'
import { type Live, live } from './live.ts'
import { LOCALE } from './LOCALE.ts'
import { randomToken } from './randomToken.ts'
import { flushSync, type Reactive, reactive } from './reactive/index.ts'
import { reactiveOver } from './reactiveOver.ts'
import { roving, stepOf } from './roving.ts'

/** The month shown, the day picked, and how the weeks are laid out. */
export type CalendarOptions = {
    /** The base the ids its parts write are derived from; unique on the page. One is made where none is given. */
    id?: string
    /** The month shown as `YYYY-MM`, where the app holds it: a `Reactive` to read and set. Held by the parts, and handed back as `month`, where none is given. */
    month?: Reactive<string | undefined>
    /** The day picked as `YYYY-MM-DD`, where the app holds it: a `Reactive` to read and set. Held by the parts, and handed back as `selected`, where none is given. */
    selected?: Reactive<string | undefined>
    /** The day a week starts on, `1` for Monday to `7` for Sunday, as `Intl.Locale` numbers them. The locale's by default. */
    firstDay?: Live<number | undefined>
    /** The BCP 47 locale the month and the weekdays are written in. `'en-US'` by default. */
    locale?: Live<string | undefined>
    /** The IANA zone today is read in, as `format.date` takes one. */
    timeZone?: Live<string | undefined>
}

/** One weekday's header cell, and its name. */
export type CalendarWeekday = {
    /** The day it is, `1` for Monday to `7` for Sunday. */
    readonly day: number
    /** Its name in full: `Monday`. */
    readonly name: string
    /** Its name shortened: `Mon`. */
    readonly short: string
    /** The header cell's attributes. */
    readonly header: Record<string, unknown>
}

/** One day of the grid: its date, its number in the month, and its cell. */
export type CalendarDay = {
    /** The day as `YYYY-MM-DD`. */
    readonly date: string
    /** Its number in its month, from 1. */
    readonly day: number
    /** The cell's attributes. */
    readonly cell: Record<string, unknown>
}

/** The parts `calendar` hands back, each spread onto an element: `<td {...day.cell}>{day.day}</td>`. */
export type Calendar = {
    /** The base its parts' ids are derived from. */
    readonly id: string
    /** The grid's attributes and its keyboard. */
    readonly grid: Record<string, unknown>
    /** The attributes of the element the month's name is written in, which names the grid. */
    readonly heading: Record<string, unknown>
    /** The month shown, in words: `November 2026`. */
    get label(): string
    /** The attributes of the button showing the month before. */
    readonly previous: Record<string, unknown>
    /** The attributes of the button showing the month after. */
    readonly next: Record<string, unknown>
    /** The attributes of the row holding the weekdays' header cells. */
    readonly header: Record<string, unknown>
    /** The attributes of a row holding a week. */
    readonly week: Record<string, unknown>
    /** The weekdays in the order a week runs. */
    get weekdays(): readonly CalendarWeekday[]
    /** The weeks the month falls in, whole, each its seven days. */
    get weeks(): readonly (readonly CalendarDay[])[]
    /** The month shown as `YYYY-MM`, read and set. */
    readonly month: Reactive<string | undefined>
    /** The day picked as `YYYY-MM-DD`, read and set. */
    readonly selected: Reactive<string | undefined>
}

const DAY = 86_400_000
const MONTH = /^\d{4}-(0[1-9]|1[0-2])/
// A Sunday, the first of the seven days a weekday's name is written from.
const SUNDAY = Date.UTC(2023, 0, 1)

/** `time`'s day on UTC's calendar, as `YYYY-MM-DD`. */
function dateOf(time: number): string {
    return new Date(time).toISOString().slice(0, 10)
}

/** The time of `date`'s midnight on UTC's calendar, a day past it moved `days` on. */
function timeOf(date: string, days = 0): number {
    return Date.UTC(
        Number(date.slice(0, 4)),
        Number(date.slice(5, 7)) - 1,
        Number(date.slice(8, 10)) + days,
    )
}

/** `date` moved `months` on, its day kept where the month has it and its last day where not. */
function monthsOn(date: string, months: number): string {
    const year = Number(date.slice(0, 4))
    const month = Number(date.slice(5, 7)) - 1 + months
    const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
    return dateOf(
        Date.UTC(year, month, Math.min(Number(date.slice(8, 10)), last)),
    )
}

/** The day `time` falls on in `zone`, as `YYYY-MM-DD`. */
function dayIn(time: number, zone: string): string {
    // `en-CA` writes a day as `YYYY-MM-DD`.
    return cached(
        `calendar today ${zone}`,
        () =>
            new Intl.DateTimeFormat('en-CA', {
                timeZone: zone,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
            }),
    ).format(time)
}

/** The day `locale`'s weeks start on, `1` for Monday to `7` for Sunday; Sunday where the engine does not say. */
function firstDayIn(locale: string): number {
    return cached(`calendar first day ${locale}`, () => {
        // `getWeekInfo` is the standard's, `weekInfo` the accessor engines shipped first.
        const found = new Intl.Locale(locale) as Intl.Locale & {
            getWeekInfo?: () => { firstDay: number }
            weekInfo?: { firstDay: number }
        }
        return (found.getWeekInfo?.() ?? found.weekInfo)?.firstDay ?? 7
    })
}

// What every cell's accessors read: one record for the parts, so a cell keeps its date and this.
type Shared = {
    selected: Reactive<string | undefined>
    active: () => string
    today: () => string
}

/** One day's record. A function of its own, so the accessors keep only what it is handed alive. */
function dayOf(
    shared: Shared,
    id: string,
    date: string,
    outside: boolean,
): CalendarDay {
    return {
        date,
        day: Number(date.slice(8, 10)),
        cell: {
            role: 'gridcell',
            'data-calendar': 'day',
            id,
            // 52.87 — only the active day is in the page's tab order.
            get tabindex() {
                return shared.active() === date ? '0' : '-1'
            },
            get 'aria-selected'() {
                return shared.selected() === date ? 'true' : 'false'
            },
            get 'aria-current'() {
                return shared.today() === date ? 'date' : undefined
            },
            get 'data-selected'() {
                return shared.selected() === date ? '' : undefined
            },
            get 'data-today'() {
                return shared.today() === date ? '' : undefined
            },
            'data-outside': outside ? '' : undefined,
        },
    }
}

/** WAI-ARIA's date grid: a month of days the keys move through and pick, as parts to spread. */
export function calendar(options: CalendarOptions = {}): Calendar {
    const selected = options.selected ?? reactive<string | undefined>(undefined)
    const picked = options.month ?? reactive<string | undefined>(undefined)
    const localeOf = () => live(options.locale) ?? LOCALE
    const base = options.id ?? `calendar-${randomToken(4, 'hex')}`
    const gridId = `${base}-grid`
    const headingId = `${base}-heading`
    // The id of the day `date`'s cell: the base, then the date.
    const cellId = (date: string) => `${base}-${date}`
    if (process.env.NODE_ENV !== 'production') checkParts('calendar', base)

    // 52.85 — today is the day it is now in the zone named, else the one `format.date` writes in.
    const today = reactive(() =>
        dayIn(
            Date.now(),
            live(options.timeZone) ?? timeZone() ?? visitorZone(),
        ),
    )
    // 52.86 — the month written, else the picked day's, else today's.
    const shown = reactive((): string => {
        for (const wanted of [picked(), selected()])
            if (wanted !== undefined && MONTH.test(wanted))
                return wanted.slice(0, 7)
        return today().slice(0, 7)
    })
    const firstDay = reactive(
        () => live(options.firstDay) ?? firstDayIn(localeOf()),
    )

    // 52.87 — the active day: the one focused last, else the one picked, else today, while it is in
    // the month shown, and the month's first day where none is.
    const focused = reactive<string | undefined>(undefined)
    const active = reactive((): string => {
        const month = shown()
        for (const wanted of [focused(), selected(), today()])
            if (wanted !== undefined && wanted.startsWith(`${month}-`))
                return wanted
        return `${month}-01`
    })
    const shared: Shared = { selected, active, today }

    // 52.83, 52.84 — THE WEEKS, again only when the month or the week's first day changes.
    const weeks = reactive(() => {
        const month = shown()
        const first = `${month}-01`
        const start = timeOf(first)
        const lead = (new Date(start).getUTCDay() - (firstDay() % 7) + 7) % 7
        const length = new Date(timeOf(monthsOn(first, 1), -1)).getUTCDate()
        const rows: CalendarDay[][] = []
        for (let index = 0; index < lead + length; index += 7) {
            const row: CalendarDay[] = []
            for (let column = 0; column < 7; column += 1) {
                const date = dateOf(timeOf(first, index + column - lead))
                row.push(
                    dayOf(shared, cellId(date), date, !date.startsWith(month)),
                )
            }
            rows.push(row)
        }
        return rows
    })

    // 52.88 — the weekdays in the order a week runs, named in the locale.
    const weekdays = reactive((): CalendarWeekday[] => {
        const locale = localeOf()
        const first = firstDay()
        const long = cached(
            `calendar weekday ${locale} long`,
            () =>
                new Intl.DateTimeFormat(locale, {
                    weekday: 'long',
                    timeZone: 'UTC',
                }),
        )
        const short = cached(
            `calendar weekday ${locale} short`,
            () =>
                new Intl.DateTimeFormat(locale, {
                    weekday: 'short',
                    timeZone: 'UTC',
                }),
        )
        const days: CalendarWeekday[] = []
        for (let column = 0; column < 7; column += 1) {
            const day = ((first - 1 + column) % 7) + 1
            const time = SUNDAY + (day % 7) * DAY
            const name = long.format(time)
            days.push({
                day,
                name,
                short: short.format(time),
                header: {
                    role: 'columnheader',
                    'data-calendar': 'weekday',
                    abbr: name,
                },
            })
        }
        return days
    })

    // 52.91 — a key moving the active day out of the month shows the month it moved into.
    const moveTo = (date: string): void => {
        focused.set(date)
        if (!date.startsWith(`${shown.peek()}-`)) picked.set(date.slice(0, 7))
        flushSync()
        globalThis.document?.getElementById(cellId(date))?.focus()
    }
    // The date of the cell an event landed in, or `undefined` outside every cell.
    const dateAt = (event: Event): string | undefined => {
        const cell = (event.target as Element | null)?.closest?.(
            '[role=gridcell]',
        )
        if (cell === null || cell === undefined) return undefined
        return cell.id.startsWith(`${base}-`)
            ? cell.id.slice(base.length + 1)
            : undefined
    }

    const grid = {
        role: 'grid',
        'data-calendar': 'grid',
        id: gridId,
        'aria-labelledby': headingId,
        onkeydown: (event: KeyboardEvent) => {
            const from = active()
            const across = stepOf(event.key, 'horizontal')
            const down = stepOf(event.key, 'vertical')
            let to: string | undefined
            // 52.89 — the arrows step a day across and a week down; Home and End go to the week's ends.
            if (across !== 0) to = dateOf(timeOf(from, across))
            else if (down !== 0) to = dateOf(timeOf(from, down * 7))
            else if (event.key === 'Home' || event.key === 'End') {
                const column =
                    (new Date(timeOf(from)).getUTCDay() -
                        (firstDay() % 7) +
                        7) %
                    7
                const end = roving(
                    event.key,
                    'horizontal',
                    () => [column, 7],
                    false,
                )
                to = dateOf(timeOf(from, end - column))
            }
            // 52.90 — PageUp and PageDown step a month, a year with Shift.
            else if (event.key === 'PageUp' || event.key === 'PageDown')
                to = monthsOn(
                    from,
                    (event.key === 'PageUp' ? -1 : 1) *
                        (event.shiftKey ? 12 : 1),
                )
            // 52.92 — Enter and Space pick the active day.
            else if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                selected.set(from)
                return
            } else return
            event.preventDefault()
            moveTo(to)
        },
        // 52.93 — a click picks the day it lands in, and makes it the active one.
        onclick: (event: MouseEvent) => {
            const date = dateAt(event)
            if (date === undefined) return
            selected.set(date)
            moveTo(date)
        },
        // 52.87 — focus put on a day by any means makes it the active one.
        onfocusin: (event: FocusEvent) => {
            const date = dateAt(event)
            if (date !== undefined) focused.set(date)
        },
    }

    // 52.94 — the buttons page the month shown, and leave focus where it is.
    const page = (months: number) => () =>
        picked.set(monthsOn(`${shown.peek()}-01`, months).slice(0, 7))

    const month = reactiveOver(
        () => shown() as string | undefined,
        (next: string | undefined) => picked.set(next),
    )

    return {
        id: base,
        grid,
        heading: {
            id: headingId,
            'data-calendar': 'heading',
            'aria-live': 'polite',
        },
        // 52.95 — the month in words, in the locale.
        get label() {
            const locale = localeOf()
            return cached(
                `calendar month ${locale}`,
                () =>
                    new Intl.DateTimeFormat(locale, {
                        month: 'long',
                        year: 'numeric',
                        timeZone: 'UTC',
                    }),
            ).format(timeOf(`${shown()}-01`))
        },
        previous: {
            type: 'button',
            'data-calendar': 'previous',
            'aria-label': 'Previous month',
            'aria-controls': gridId,
            onclick: page(-1),
        },
        next: {
            type: 'button',
            'data-calendar': 'next',
            'aria-label': 'Next month',
            'aria-controls': gridId,
            onclick: page(1),
        },
        header: { role: 'row', 'data-calendar': 'header' },
        week: { role: 'row', 'data-calendar': 'week' },
        get weekdays() {
            return weekdays()
        },
        get weeks() {
            return weeks()
        },
        month,
        selected,
    }
}
