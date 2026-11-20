// The `format` namespace: numbers, money and time as words, the same on the server and in the
// browser. Every formatter takes a FIXED locale rather than the runtime's, and a date a fixed time
// zone, so a page rendered on one side reads the same once the other hydrates it (52.2, 52.3). Each
// takes `unknown`, so it drops into a table column as it is, and what it cannot format reads as an
// em dash (52.1).

import { cached } from './cached.ts'

const MISSING = '—'
const LOCALE = 'en-US'
// 52.35 — the minus a signed number is written with, the width of the `+` it stands against.
const MINUS = '\u2212'

/** `value` as a number Intl can format, or `undefined` for anything else. */
function numeric(value: unknown): number | bigint | undefined {
    if (typeof value === 'number')
        return Number.isNaN(value) ? undefined : value
    return typeof value === 'bigint' ? value : undefined
}

/** `value` as a time in epoch milliseconds, or `undefined` where it names no time. */
function instant(value: unknown): number | undefined {
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

/** An amount of money: `format.money(12500)` is `$12,500.00`. */
export function money(
    value: unknown,
    options: {
        /** The ISO 4217 code of the currency the amount is in. `'USD'` by default. */
        currency?: string
        /** Whether to shorten a large amount: `$1.2M` rather than `$1,200,000.00`. */
        compact?: boolean
        /** Whether a positive amount carries a `+`, and a negative one `−`, for a change rather than a balance. */
        signed?: boolean
        /** The digits after the point, fixed. The currency's own (2 for USD) by default. */
        digits?: number
        /** The BCP 47 locale the amount is written in. `'en-US'` by default. */
        locale?: string
    } = {},
): string {
    const amount = numeric(value)
    if (amount === undefined) return MISSING
    const {
        currency = 'USD',
        compact = false,
        signed = false,
        digits,
        locale = LOCALE,
    } = options
    const written = cached(
        `money ${locale} ${currency} ${compact} ${signed} ${digits}`,
        () =>
            new Intl.NumberFormat(locale, {
                style: 'currency',
                currency,
                notation: compact ? 'compact' : 'standard',
                signDisplay: signed ? 'exceptZero' : 'auto',
                minimumFractionDigits: digits,
                maximumFractionDigits: digits,
            }),
    ).format(amount)
    return signed ? written.replace('-', MINUS) : written
}

/** A fraction as a percent: `format.percent(0.4)` is `40%`, and `format.percent(0.125)` is `12.5%`. */
export function percent(
    value: unknown,
    options: {
        /** The digits after the point, fixed. Up to 1, as needed, by default. */
        digits?: number
        /** Whether a positive fraction carries a `+`, and a negative one `−`, for a change rather than a share. */
        signed?: boolean
        /** The BCP 47 locale the percent is written in. `'en-US'` by default. */
        locale?: string
    } = {},
): string {
    const fraction = numeric(value)
    if (fraction === undefined) return MISSING
    const { digits, signed = false, locale = LOCALE } = options
    const written = cached(
        `percent ${locale} ${digits} ${signed}`,
        () =>
            new Intl.NumberFormat(locale, {
                style: 'percent',
                minimumFractionDigits: digits ?? 0,
                maximumFractionDigits: digits ?? 1,
                signDisplay: signed ? 'exceptZero' : 'auto',
            }),
    ).format(fraction)
    return signed ? written.replace('-', MINUS) : written
}

/** A number with its thousands grouped: `format.number(1200)` is `1,200`. */
export function number(
    value: unknown,
    options: {
        /** Whether to shorten a large number: `1.2K` rather than `1,200`. */
        compact?: boolean
        /** The digits after the point, fixed. Up to 3, or 1 compact, as needed, by default. */
        digits?: number
        /** The BCP 47 locale the number is written in. `'en-US'` by default. */
        locale?: string
    } = {},
): string {
    const amount = numeric(value)
    if (amount === undefined) return MISSING
    const { compact = false, digits, locale = LOCALE } = options
    return cached(
        `number ${locale} ${compact} ${digits}`,
        () =>
            new Intl.NumberFormat(locale, {
                notation: compact ? 'compact' : 'standard',
                minimumFractionDigits: digits,
                maximumFractionDigits: digits,
            }),
    ).format(amount)
}

/** A count and the word for what it counts: `format.plural(3, 'deal')` is `3 deals`. */
export function plural(
    value: unknown,
    /** The word for one: `'deal'`. */
    one: string,
    /** The word for any other count. `one` with an `s` by default. */
    many: string = `${one}s`,
    options: {
        /** The BCP 47 locale the count is written in, and whose rules pick the word. `'en-US'` by default. */
        locale?: string
    } = {},
): string {
    const amount = numeric(value)
    if (amount === undefined) return MISSING
    const { locale = LOCALE } = options
    const rules = cached(`plural ${locale}`, () => new Intl.PluralRules(locale))
    const word = rules.select(Number(amount)) === 'one' ? one : many
    return `${number(amount, { locale })} ${word}`
}

/** A list as a sentence says it: `format.list(['Ada', 'Grace', 'Alan'])` is `Ada, Grace, and Alan`. */
export function list(
    value: unknown,
    options: {
        /** The word before the last item: `'and'`, or `'or'` for a choice. `'and'` by default. */
        conjunction?: 'and' | 'or'
        /** The BCP 47 locale the list is written in. `'en-US'` by default. */
        locale?: string
    } = {},
): string {
    if (!Array.isArray(value)) return MISSING
    const items: string[] = []
    for (const item of value)
        if (item !== null && item !== undefined) items.push(String(item))
    if (items.length === 0) return MISSING
    const { conjunction = 'and', locale = LOCALE } = options
    return cached(
        `list ${locale} ${conjunction}`,
        () =>
            new Intl.ListFormat(locale, {
                type: conjunction === 'or' ? 'disjunction' : 'conjunction',
            }),
    ).format(items)
}

const DATE_STYLES = {
    day: { dateStyle: 'medium' },
    monthDay: { month: 'short', day: 'numeric' },
    month: { month: 'short', year: 'numeric' },
    time: { timeStyle: 'short' },
    hour: { hour: 'numeric' },
} as const

/** What `format.date` and `format.dateParts` take. */
type DateOptions = {
    /**
     * What of the time to write: `'day'` is `Nov 18, 2026`, `'monthDay'` is `Nov 18`, `'month'` is
     * `Nov 2026`, `'time'` is `3:04 PM`, `'hour'` is `3 PM`, and `'dateTime'` is
     * `Nov 18, 2026, 3:04 PM`. `'day'` by default.
     */
    style?: 'day' | 'monthDay' | 'month' | 'time' | 'hour' | 'dateTime'
    /** The IANA time zone the time is written in. `'UTC'` by default. */
    timeZone?: string
    /** The BCP 47 locale the date is written in. `'en-US'` by default. */
    locale?: string
}

/**
 * A date, a time or both: `format.date('2026-11-18')` is `Nov 18, 2026`. Takes a `Date`, epoch
 * milliseconds or an ISO string.
 */
export function date(value: unknown, options: DateOptions = {}): string {
    let written = ''
    for (const part of dateParts(value, options)) written += part.value
    return written
}

/**
 * 52.36 — what `format.date` writes, as the pieces `Intl` names: `{ type: 'hour', value: '3' }` and
 * the rest, so each piece can be styled on its own. A value it cannot format is one literal `—`.
 */
export function dateParts(
    value: unknown,
    options: DateOptions = {},
): Intl.DateTimeFormatPart[] {
    const time = instant(value)
    if (time === undefined) return [{ type: 'literal', value: MISSING }]
    const { style = 'day', timeZone = 'UTC', locale = LOCALE } = options
    // Two formatters joined rather than one asked for both: engines join a date and a time with
    // different words.
    if (style === 'dateTime')
        return [
            ...dateParts(time, { style: 'day', timeZone, locale }),
            { type: 'literal', value: ', ' },
            ...dateParts(time, { style: 'time', timeZone, locale }),
        ]
    return cached(
        `date ${locale} ${timeZone} ${style}`,
        () =>
            new Intl.DateTimeFormat(locale, {
                ...DATE_STYLES[style],
                timeZone,
            }),
    ).formatToParts(time)
}

const DURATION_UNITS = [
    ['days', 86_400_000],
    ['hours', 3_600_000],
    ['minutes', 60_000],
    ['seconds', 1000],
] as const

/** A length of time in milliseconds, in its two largest units: `format.duration(3_900_000)` is `1h 5m`. */
export function duration(
    value: unknown,
    options: {
        /** The BCP 47 locale the duration is written in. `'en-US'` by default. */
        locale?: string
    } = {},
): string {
    const milliseconds = numeric(value)
    if (milliseconds === undefined) return MISSING
    const { locale = LOCALE } = options
    let left = Math.abs(Number(milliseconds))
    const parts: Partial<Record<(typeof DURATION_UNITS)[number][0], number>> =
        {}
    let written = 0
    // From the largest unit the length fills, that unit and the next, the next left out at zero.
    for (const [unit, size] of DURATION_UNITS) {
        const whole = Math.floor(left / size)
        left -= whole * size
        if (written === 0 && whole === 0) continue
        if (whole > 0) parts[unit] = whole
        written += 1
        if (written === 2) break
    }
    // Under a second is `0s`, which a formatter left to drop zero units writes as nothing.
    if (written === 0) parts.seconds = 0
    const formatted = cached(
        `duration ${locale} ${written === 0}`,
        () =>
            new Intl.DurationFormat(locale, {
                style: 'narrow',
                secondsDisplay: written === 0 ? 'always' : 'auto',
            }),
    ).format(parts)
    return Number(milliseconds) < 0 ? `-${formatted}` : formatted
}

const RELATIVE_UNITS = [
    ['year', 31_536_000_000],
    ['month', 2_592_000_000],
    ['week', 604_800_000],
    ['day', 86_400_000],
    ['hour', 3_600_000],
    ['minute', 60_000],
] as const

/** How long before or after now a time is: `3 hours ago`, `yesterday`, `in 2 days`, `now`. */
export function relative(
    value: unknown,
    options: {
        /** The time it is measured from, in epoch milliseconds. `Date.now()` by default. */
        now?: number
        /** The BCP 47 locale it is written in. `'en-US'` by default. */
        locale?: string
        /** `'long'` (`12 minutes ago`), `'short'` (`12 min. ago`) or `'narrow'` (`12m ago`). `'long'` by default. */
        style?: Intl.RelativeTimeFormatStyle
    } = {},
): string {
    const time = instant(value)
    if (time === undefined) return MISSING
    const { now = Date.now(), locale = LOCALE, style = 'long' } = options
    const formatter = cached(
        `relative ${locale} ${style}`,
        () => new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style }),
    )
    const gap = time - now
    for (const [unit, size] of RELATIVE_UNITS)
        if (Math.abs(gap) >= size)
            return formatter.format(Math.round(gap / size), unit)
    return formatter.format(0, 'second')
}

const BYTE_UNITS = [
    'byte',
    'kilobyte',
    'megabyte',
    'gigabyte',
    'terabyte',
    'petabyte',
] as const

/**
 * A size in bytes, in the largest unit it fills a whole one of, a kilobyte being 1,000 bytes:
 * `format.bytes(1_500_000)` is `1.5 MB`, and `format.bytes(512)` is `512 bytes`.
 */
export function bytes(
    value: unknown,
    options: {
        /** The digits after the point, fixed. Up to 1, as needed, by default. */
        digits?: number
        /** The BCP 47 locale the size is written in. `'en-US'` by default. */
        locale?: string
    } = {},
): string {
    const size = numeric(value)
    if (size === undefined) return MISSING
    const { digits, locale = LOCALE } = options
    let scaled = Number(size)
    let unit = 0
    while (Math.abs(scaled) >= 1000 && unit < BYTE_UNITS.length - 1) {
        scaled /= 1000
        unit += 1
    }
    const name = BYTE_UNITS[unit] as (typeof BYTE_UNITS)[number]
    return cached(
        `bytes ${locale} ${name} ${digits}`,
        () =>
            new Intl.NumberFormat(locale, {
                style: 'unit',
                unit: name,
                // `512 bytes`: the short form of the byte is `512 byte`.
                unitDisplay: name === 'byte' ? 'long' : 'short',
                minimumFractionDigits: digits ?? 0,
                maximumFractionDigits: digits ?? 1,
            }),
    ).format(scaled)
}
