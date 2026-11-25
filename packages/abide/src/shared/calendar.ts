// 52.82-52.100 — WAI-ARIA's date grid, as parts an app spreads onto elements of its own: a grid per
// month shown, each of whole weeks under its heading, a header row of weekdays, a cell per day, and
// the buttons paging them. One month is `months: 1`, not a case of its own. A day is a `YYYY-MM-DD` string and a month a `YYYY-MM` one, and every day is counted on UTC's
// calendar, which has no daylight saving to drop or repeat one; a zone is read only for which day is
// today. The server writes every attribute, so the page is the month as it stands before it hydrates.

import { checkParts } from './checkParts.ts'
import { cached } from './format/cached.ts'
import { timeZone, visitorZone } from './format/timeZone.ts'
import { wallClockOf } from './format/wallClockOf.ts'
import { type Live, live } from './live.ts'
import { LOCALE } from './LOCALE.ts'
import { randomToken } from './randomToken.ts'
import { flushSync, memo, type Reactive, reactive } from './reactive/index.ts'
import { reactiveOver } from './reactiveOver.ts'
import { roving, stepOf } from './roving.ts'

/** 52.97 — what a calendar picks: a day, or a range's start and end where it picks a range. */
export type CalendarPick<Range extends boolean> = Range extends true
    ? readonly [start: string, end: string | undefined] | undefined
    : string | undefined

/** The months shown, the day or the range picked, and how the weeks are laid out. */
export type CalendarOptions<Range extends boolean = false> = {
    /** The base the ids its parts write are derived from; unique on the page. One is made where none is given. */
    id?: string | undefined
    /** The first month shown as `YYYY-MM`, where the app holds it: a `Reactive` to read and set. Held by the parts, and handed back as `month`, where none is given. */
    month?: Reactive<string | undefined> | undefined
    /** 52.97 — whether it picks a range of days rather than one. Read once. */
    range?: Range | undefined
    /** The day picked as `YYYY-MM-DD`, or the range as `[start, end]`, where the app holds it: a `Reactive` to read and set. Held by the parts, and handed back as `selected`, where none is given. */
    selected?: Reactive<CalendarPick<Range>> | undefined
    /** How many months are shown side by side, from the first. 1 by default. */
    months?: Live<number | undefined> | undefined
    /** The day a week starts on, `1` for Monday to `7` for Sunday, as `Intl.Locale` numbers them. The locale's by default. */
    firstDay?: Live<number | undefined> | undefined
    /** The BCP 47 locale the month and the weekdays are written in. `'en-US'` by default. */
    locale?: Live<string | undefined> | undefined
    /** The IANA zone today is read in, as `format.date` takes one. */
    timeZone?: Live<string | undefined> | undefined
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

/** One month shown: its grid, its heading and its weeks. */
export type CalendarMonth = {
    /** The month as `YYYY-MM`. */
    readonly month: string
    /** The month in words: `November 2026`. */
    readonly label: string
    /** The attributes of the element the month's name is written in, which names its grid. */
    readonly heading: Record<string, unknown>
    /** The grid's attributes and its keyboard. */
    readonly grid: Record<string, unknown>
    /** The weeks the month falls in, whole, each its seven days. */
    readonly weeks: readonly (readonly CalendarDay[])[]
}

/** The parts `calendar` hands back, each spread onto an element: `<td {...day.cell}>{day.day}</td>`. */
export type Calendar<Range extends boolean = false> = {
    /** The base its parts' ids are derived from. */
    readonly id: string
    /** 52.100 — the day in the page's tab order, as `YYYY-MM-DD`. */
    get active(): string
    /** 52.100 — the id of `date`'s cell. */
    idOf(date: string): string
    /** The months shown, in order, each a grid of its own. */
    get months(): readonly CalendarMonth[]
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
    /** The first month shown as `YYYY-MM`, read and set. */
    readonly month: Reactive<string | undefined>
    /** The day picked as `YYYY-MM-DD`, or the range as `[start, end]`, read and set. */
    readonly selected: Reactive<CalendarPick<Range>>
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
    return dateOf(wallClockOf(time, zone))
}

/** The day `locale`'s weeks start on, `1` for Monday to `7` for Sunday; Sunday where the engine does not say. */
function firstDayIn(locale: string): number {
    return cached(`calendar first day ${locale}`, () => {
        // `getWeekInfo` is the standard's, `weekInfo` the accessor engines shipped first.
        const found = new Intl.Locale(locale) as Intl.Locale & {
            getWeekInfo?: (() => { firstDay: number }) | undefined
            weekInfo?: { firstDay: number } | undefined
        }
        return (found.getWeekInfo?.() ?? found.weekInfo)?.firstDay ?? 7
    })
}

// What every cell's accessors read: one record for the parts, so a cell keeps its date and this.
type Shared = {
    range: boolean
    // A day picked is its own start and end.
    start: () => string | undefined
    end: () => string | undefined
    // 52.99 — the day pointed at or focused, while a range has a start and no end.
    preview: () => string | undefined
    active: () => string
    today: () => string
}

// Whether `date` falls between `one` and `other`, both included, in either order.
function between(date: string, one: string, other: string): boolean {
    return one <= other
        ? one <= date && date <= other
        : other <= date && date <= one
}

// 52.95, 52.98 — whether `date` is picked: the day, every day of a range, or a range's start alone.
function isPicked(shared: Shared, date: string): boolean {
    const start = shared.start()
    if (start === undefined) return false
    const end = shared.end()
    return end === undefined ? date === start : between(date, start, end)
}

/** One day's record. A function of its own, so the accessors keep only what it is handed alive. */
function dayOf(
    shared: Shared,
    id: string | undefined,
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
            // 52.86 — only the active day is in the page's tab order; 52.96 — a day another grid
            // shown holds is that grid's to focus.
            get tabindex() {
                if (id === undefined) return undefined
                return shared.active() === date ? '0' : '-1'
            },
            get 'aria-selected'() {
                return isPicked(shared, date) ? 'true' : 'false'
            },
            get 'aria-current'() {
                return shared.today() === date ? 'date' : undefined
            },
            // 49.17
            get 'data-current'() {
                return shared.today() === date ? '' : undefined
            },
            get 'data-selected'() {
                return isPicked(shared, date) ? '' : undefined
            },
            // 52.98 — a range's ends.
            get 'data-range-start'() {
                return shared.range && shared.start() === date ? '' : undefined
            },
            get 'data-range-end'() {
                return shared.range && shared.end() === date ? '' : undefined
            },
            // 52.99 — the range it would pick, while it has a start and no end.
            get 'data-preview'() {
                const start =
                    shared.range && shared.end() === undefined
                        ? shared.start()
                        : undefined
                const towards =
                    start === undefined ? undefined : shared.preview()
                return towards !== undefined &&
                    between(date, start as string, towards)
                    ? ''
                    : undefined
            },
            get 'data-today'() {
                return shared.today() === date ? '' : undefined
            },
            'data-outside': outside ? '' : undefined,
        },
    }
}

/** `month`, a `YYYY-MM`, moved `months` on. */
function monthOn(month: string, months: number): string {
    return monthsOn(`${month}-01`, months).slice(0, 7)
}

/** WAI-ARIA's date grid: months of days the keys move through and pick, as parts to spread. */
export function calendar<Range extends boolean = false>(
    options: CalendarOptions<Range> = {},
): Calendar<Range> {
    // 49.11 — read once.
    const range = options.range === true
    const selected = (options.selected ??
        reactive<CalendarPick<Range>>(undefined)) as Reactive<
        string | readonly [string, string | undefined] | undefined
    >
    const picked = options.month ?? reactive<string | undefined>(undefined)
    const localeOf = () => live(options.locale) ?? LOCALE
    const base = options.id ?? `calendar-${randomToken(4, 'hex')}`
    // A grid's and a heading's ids are by their place among the months shown, so paging keeps them.
    const gridId = (index: number) => `${base}-grid-${index}`
    const headingId = (index: number) => `${base}-heading-${index}`
    // The id of the day `date`'s cell: the base, then the date.
    const cellId = (date: string) => `${base}-${date}`
    if (process.env.NODE_ENV !== 'production') checkParts('calendar', base)

    // 52.84 — today is the day it is now in the zone named, else the one `format.date` writes in.
    const today = memo(() =>
        dayIn(
            Date.now(),
            live(options.timeZone) ?? timeZone() ?? visitorZone(),
        ),
    )
    // A range's ends, or the day picked as both.
    const start = memo((): string | undefined => {
        const value = selected()
        return Array.isArray(value) ? value[0] : (value as string | undefined)
    })
    const end = memo((): string | undefined => {
        const value = selected()
        return Array.isArray(value) ? value[1] : (value as string | undefined)
    })
    // 52.85 — the first month shown: the month written, else the picked day's, else today's.
    const shown = memo((): string => {
        for (const wanted of [picked(), start()])
            if (wanted !== undefined && MONTH.test(wanted))
                return wanted.slice(0, 7)
        return today().slice(0, 7)
    })
    // 52.96 — how many months are shown, and the last of them.
    const count = memo(() => Math.max(1, Math.trunc(live(options.months) ?? 1)))
    const last = memo(() => monthOn(shown(), count() - 1))
    // Whether `date` falls in a month shown; `YYYY-MM` strings order as the months do.
    const isShown = (date: string) => {
        const month = date.slice(0, 7)
        return MONTH.test(date) && month >= shown() && month <= last()
    }
    const firstDay = memo(
        () => live(options.firstDay) ?? firstDayIn(localeOf()),
    )

    // 52.86 — the active day: the one focused last, else the one picked, else today, while it is in
    // a month shown, and the first month's first day where none is.
    const focused = reactive<string | undefined>(undefined)
    const active = memo((): string => {
        for (const wanted of [focused(), start(), today()])
            if (wanted !== undefined && isShown(wanted)) return wanted
        return `${shown()}-01`
    })
    // 52.99 — the day last pointed at in a grid, while one is.
    const pointed = reactive<string | undefined>(undefined)
    const shared: Shared = {
        range,
        start,
        end,
        preview: () => pointed() ?? focused(),
        active,
        today,
    }
    // 52.91, 52.92, 52.97 — a pick: the day, or a range's start, then its end.
    // 49.19 — whether the pick landed.
    const pick = (date: string): boolean => {
        if (!range) return selected.set(date) === undefined
        const from = start.peek()
        if (from === undefined || end.peek() !== undefined)
            return selected.set([date, undefined]) === undefined
        return (
            selected.set(date < from ? [date, from] : [from, date]) ===
            undefined
        )
    }

    // 52.82, 52.83 — `month`'s whole weeks from the week's `first` day. 52.96 — a day of another
    // month that a grid shown holds is that grid's: its copy here carries no id.
    const weeksOf = (
        month: string,
        first: number,
        lowest: string,
        highest: string,
    ) => {
        const start = timeOf(`${month}-01`)
        const lead = (new Date(start).getUTCDay() - (first % 7) + 7) % 7
        const length = new Date(
            timeOf(monthsOn(`${month}-01`, 1), -1),
        ).getUTCDate()
        const rows: CalendarDay[][] = []
        for (let index = 0; index < lead + length; index += 7) {
            const row: CalendarDay[] = []
            for (let column = 0; column < 7; column += 1) {
                const date = dateOf(
                    timeOf(`${month}-01`, index + column - lead),
                )
                const outside = !date.startsWith(month)
                const elsewhere =
                    outside &&
                    date.slice(0, 7) >= lowest &&
                    date.slice(0, 7) <= highest
                row.push(
                    dayOf(
                        shared,
                        elsewhere ? undefined : cellId(date),
                        date,
                        outside,
                    ),
                )
            }
            rows.push(row)
        }
        return rows
    }

    // 52.90 — a key moving the active day out of the months shown pages the fewest months that show it.
    // 49.19 — a refused page leaves the active day and focus where they are.
    const moveTo = (date: string): void => {
        const month = date.slice(0, 7)
        const paged =
            month < (shown.peek() as string)
                ? month
                : month > (last.peek() as string)
                  ? monthOn(month, 1 - (count.peek() as number))
                  : undefined
        if (paged !== undefined && picked.set(paged) !== undefined) return
        focused.set(date)
        flushSync()
        globalThis.document?.getElementById(cellId(date))?.focus()
    }
    // The date of the cell an event landed in, or `undefined` outside every cell with an id.
    const dateAt = (event: Event): string | undefined => {
        const cell = (event.target as Element | null)?.closest?.(
            '[role=gridcell]',
        )
        if (cell === null || cell === undefined) return undefined
        return cell.id.startsWith(`${base}-`)
            ? cell.id.slice(base.length + 1)
            : undefined
    }

    // Every grid's keyboard and pointer, one set of listeners shared by them all.
    const onkeydown = (event: KeyboardEvent) => {
        const from = active()
        const across = stepOf(event.key, 'horizontal')
        const down = stepOf(event.key, 'vertical')
        let to: string | undefined
        // 52.88 — the arrows step a day across and a week down; Home and End go to the week's ends.
        if (across !== 0) to = dateOf(timeOf(from, across))
        else if (down !== 0) to = dateOf(timeOf(from, down * 7))
        else if (event.key === 'Home' || event.key === 'End') {
            const column =
                (new Date(timeOf(from)).getUTCDay() - (firstDay() % 7) + 7) % 7
            const end = roving(
                event.key,
                'horizontal',
                () => [column, 7],
                false,
            )
            to = dateOf(timeOf(from, end - column))
        }
        // 52.89 — PageUp and PageDown step a month, a year with Shift.
        else if (event.key === 'PageUp' || event.key === 'PageDown')
            to = monthsOn(
                from,
                (event.key === 'PageUp' ? -1 : 1) * (event.shiftKey ? 12 : 1),
            )
        // 52.91 — Enter and Space pick the active day.
        else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            pick(from)
            return
        } else return
        event.preventDefault()
        moveTo(to)
    }
    // 52.92 — a click picks the day it lands in, and makes it the active one.
    const onclick = (event: MouseEvent) => {
        const date = dateAt(event)
        if (date !== undefined && pick(date)) moveTo(date)
    }
    // 52.86 — focus put on a day by any means makes it the active one.
    const onfocusin = (event: FocusEvent) => {
        const date = dateAt(event)
        if (date !== undefined) focused.set(date)
    }

    const onpointerover = (event: PointerEvent) => pointed.set(dateAt(event))
    const onpointerleave = () => pointed.set(undefined)

    // A grid's part and its heading's, by place, made once each so paging hands back the same records.
    const grids: Record<string, unknown>[] = []
    const headings: Record<string, unknown>[] = []
    const gridAt = (index: number) =>
        (grids[index] ??= {
            role: 'grid',
            'data-calendar': 'grid',
            id: gridId(index),
            // 52.94 — each grid is labelled by its heading.
            'aria-labelledby': headingId(index),
            // 52.98 — a range is many days picked.
            'aria-multiselectable': range ? 'true' : undefined,
            onkeydown,
            onclick,
            onfocusin,
            onpointerover,
            onpointerleave,
        })
    const headingAt = (index: number) =>
        (headings[index] ??= {
            id: headingId(index),
            'data-calendar': 'heading',
            'aria-live': 'polite',
        })

    // 52.82, 52.94, 52.96 — THE MONTHS SHOWN, again only when the first, the count, the week's
    // first day or the locale changes.
    const months = memo((): CalendarMonth[] => {
        const lowest = shown()
        const total = count()
        const first = firstDay()
        const locale = localeOf()
        const highest = monthOn(lowest, total - 1)
        const label = cached(
            `calendar month ${locale}`,
            () =>
                new Intl.DateTimeFormat(locale, {
                    month: 'long',
                    year: 'numeric',
                    timeZone: 'UTC',
                }),
        )
        const list: CalendarMonth[] = []
        for (let index = 0; index < total; index += 1) {
            const month = monthOn(lowest, index)
            list.push({
                month,
                label: label.format(timeOf(`${month}-01`)),
                heading: headingAt(index),
                grid: gridAt(index),
                weeks: weeksOf(month, first, lowest, highest),
            })
        }
        return list
    })

    // 52.87 — the weekdays in the order a week runs, named in the locale.
    const weekdays = memo((): CalendarWeekday[] => {
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

    // 52.93 — the buttons page the months shown by one, and leave focus where it is.
    const page = (months: number) => () =>
        picked.set(monthOn(shown.peek() as string, months))
    // Every grid the buttons page, by id.
    const controls = () => {
        const ids: string[] = []
        for (let index = 0; index < count(); index += 1) ids.push(gridId(index))
        return ids.join(' ')
    }

    const month = reactiveOver(
        () => shown() as string | undefined,
        (next: string | undefined) => picked.set(next),
    )

    return {
        id: base,
        // 52.100
        get active() {
            return active()
        },
        idOf: cellId,
        get months() {
            return months()
        },
        previous: {
            type: 'button',
            'data-calendar': 'previous',
            'aria-label': 'Previous month',
            get 'aria-controls'() {
                return controls()
            },
            onclick: page(-1),
        },
        next: {
            type: 'button',
            'data-calendar': 'next',
            'aria-label': 'Next month',
            get 'aria-controls'() {
                return controls()
            },
            onclick: page(1),
        },
        header: { role: 'row', 'data-calendar': 'header' },
        week: { role: 'row', 'data-calendar': 'week' },
        get weekdays() {
            return weekdays()
        },
        month,
        selected: selected as Reactive<CalendarPick<Range>>,
    }
}
