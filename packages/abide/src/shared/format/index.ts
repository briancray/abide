// The `format` namespace: numbers, money and time as words, the same on the server and in the
// browser. Every formatter takes a FIXED locale rather than the runtime's, and a date a fixed time
// zone, so a page rendered on one side reads the same once the other hydrates it (52.2, 52.3). Each
// takes `unknown`, so it drops into a table column as it is, and what it cannot format reads as an
// em dash (52.1).

import { LOCALE } from '../LOCALE.ts'
import { cached } from './cached.ts'
import { instant } from './instant.ts'
import { RELATIVE_UNITS } from './RELATIVE_UNITS.ts'
import { timeZone, visitorZone } from './timeZone.ts'
import { wallClockOf } from './wallClockOf.ts'

export { timeZone } from './timeZone.ts'

const MISSING = '—'
// 52.35 — the minus a signed number is written with, the width of the `+` it stands against.
const MINUS = '\u2212'

/** `value` as a number Intl can format, or `undefined` for anything else. */
function numeric(value: unknown): number | bigint | undefined {
    if (typeof value === 'number')
        return Number.isNaN(value) ? undefined : value
    return typeof value === 'bigint' ? value : undefined
}

/**
 * What `format.money`, `format.percent` and `format.number` take: `Intl.NumberFormat`'s own options
 * under its own names, less the `style` each formatter fixes, and the locale.
 */
type NumberOptions = Omit<Intl.NumberFormatOptions, 'style'> & {
    /** The BCP 47 locale it is written in. `'en-US'` by default. */
    locale?: string
}

// 52.6 — every option a formatter is keyed by, in a fixed order, so one set of options given in any
// order is one formatter.
const NUMBER_OPTIONS = [
    'localeMatcher',
    'currency',
    'currencyDisplay',
    'currencySign',
    'unit',
    'unitDisplay',
    'minimumIntegerDigits',
    'minimumFractionDigits',
    'maximumFractionDigits',
    'minimumSignificantDigits',
    'maximumSignificantDigits',
    'useGrouping',
    'notation',
    'compactDisplay',
    'signDisplay',
    'numberingSystem',
    'roundingMode',
    'roundingIncrement',
    'roundingPriority',
    'trailingZeroDisplay',
] as const

/**
 * The `Intl.NumberFormat` for `kind` over `options`, abide's `defaults` beneath the caller's. A
 * caller naming one bound of the fraction digits keeps the default of the other only where the two
 * agree, since `Intl` refuses a minimum above the maximum.
 */
function numberFormat(
    kind: string,
    style: Intl.NumberFormatOptions['style'],
    options: NumberOptions,
    defaults: Intl.NumberFormatOptions,
): Intl.NumberFormat {
    const locale = options.locale ?? LOCALE
    let key = `${kind} ${locale}`
    for (const name of NUMBER_OPTIONS) {
        const given = (options as Record<string, unknown>)[name]
        if (given !== undefined) key += ` ${name}=${String(given)}`
    }
    return cached(key, () => {
        const { locale: _locale, ...given } = options
        const asked: Intl.NumberFormatOptions = { ...defaults, ...given, style }
        const least = given.minimumFractionDigits
        const most = given.maximumFractionDigits
        if (
            least !== undefined &&
            most === undefined &&
            defaults.maximumFractionDigits !== undefined
        )
            asked.maximumFractionDigits = Math.max(
                least,
                defaults.maximumFractionDigits,
            )
        if (
            most !== undefined &&
            least === undefined &&
            defaults.minimumFractionDigits !== undefined
        )
            asked.minimumFractionDigits = Math.min(
                most,
                defaults.minimumFractionDigits,
            )
        return new Intl.NumberFormat(locale, asked)
    })
}

// 52.35 — a sign written beside a `+` is written as the `−` the width of it.
function signedWith(written: string, options: NumberOptions): string {
    const sign = options.signDisplay
    return sign === 'always' || sign === 'exceptZero'
        ? written.replace('-', MINUS)
        : written
}

/**
 * An amount of money: `format.money(12500)` is `$12,500.00`. Takes `Intl.NumberFormat`'s options —
 * `notation: 'compact'` for `$1.2M`, `signDisplay: 'exceptZero'` for a change,
 * `maximumFractionDigits` — with the currency `'USD'` by default.
 */
export function money(value: unknown, options: NumberOptions = {}): string {
    const amount = numeric(value)
    if (amount === undefined) return MISSING
    const written = numberFormat('money', 'currency', options, {
        currency: 'USD',
    }).format(amount)
    return signedWith(written, options)
}

/**
 * A fraction as a percent: `format.percent(0.4)` is `40%`, and `format.percent(0.125)` is `12.5%` —
 * up to one digit after the point, as needed, by default. Takes `Intl.NumberFormat`'s options.
 */
export function percent(value: unknown, options: NumberOptions = {}): string {
    const fraction = numeric(value)
    if (fraction === undefined) return MISSING
    const written = numberFormat('percent', 'percent', options, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 1,
    }).format(fraction)
    return signedWith(written, options)
}

/**
 * A number with its thousands grouped: `format.number(1200)` is `1,200`. Takes `Intl.NumberFormat`'s
 * options — `notation: 'compact'` for `1.2K`.
 */
export function number(value: unknown, options: NumberOptions = {}): string {
    const amount = numeric(value)
    if (amount === undefined) return MISSING
    return numberFormat('number', 'decimal', options, {}).format(amount)
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

/**
 * A list as a sentence says it: `format.list(['Ada', 'Grace', 'Alan'])` is `Ada, Grace, and Alan`.
 * Takes `Intl.ListFormat`'s options — `type: 'disjunction'` for a choice.
 */
export function list(
    value: unknown,
    options: Intl.ListFormatOptions & {
        /** The BCP 47 locale the list is written in. `'en-US'` by default. */
        locale?: string
    } = {},
): string {
    if (!Array.isArray(value)) return MISSING
    const items: string[] = []
    for (const item of value)
        if (item !== null && item !== undefined) items.push(String(item))
    if (items.length === 0) return MISSING
    const {
        type = 'conjunction',
        style = 'long',
        localeMatcher,
        locale = LOCALE,
    } = options
    return cached(
        `list ${locale} ${type} ${style} ${localeMatcher}`,
        () => new Intl.ListFormat(locale, { type, style, localeMatcher }),
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
     * `Nov 18, 2026, 3:04 PM`, and `'input'` is `2026-11-18T15:04`, what an
     * `<input type="datetime-local">` takes, the same in every locale. `'day'` by default.
     */
    style?:
        'day' | 'monthDay' | 'month' | 'time' | 'hour' | 'dateTime' | 'input'
    /**
     * The IANA time zone the time is written in. By default the zone `format.timeZone` pins, and
     * where none is pinned the visitor's: UTC on a server and while a page hydrates, the browser's
     * own after (52.44, 52.45).
     */
    timeZone?: string
    /** The BCP 47 locale the date is written in. `'en-US'` by default. */
    locale?: string
}

/**
 * A date, a time or both: `format.date('2026-11-18')` is `Nov 18, 2026`. Takes a `Date`, epoch
 * milliseconds or an ISO string, a `YYYY-MM-DD` being that day in the zone it writes in.
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
    const {
        style = 'day',
        timeZone: zone = timeZone() ?? visitorZone(),
        locale = LOCALE,
    } = options
    const time = instant(value, zone)
    if (time === undefined) return [{ type: 'literal', value: MISSING }]
    // 52.101 — the zone's wall clock as an `<input>` writes one, in no locale's words.
    if (style === 'input') {
        const written = new Date(wallClockOf(time, zone)).toISOString()
        return [
            { type: 'year', value: written.slice(0, 4) },
            { type: 'literal', value: '-' },
            { type: 'month', value: written.slice(5, 7) },
            { type: 'literal', value: '-' },
            { type: 'day', value: written.slice(8, 10) },
            { type: 'literal', value: 'T' },
            { type: 'hour', value: written.slice(11, 13) },
            { type: 'literal', value: ':' },
            { type: 'minute', value: written.slice(14, 16) },
        ]
    }
    // Two formatters joined rather than one asked for both: engines join a date and a time with
    // different words.
    if (style === 'dateTime')
        return [
            ...dateParts(time, { style: 'day', timeZone: zone, locale }),
            { type: 'literal', value: ', ' },
            ...dateParts(time, { style: 'time', timeZone: zone, locale }),
        ]
    return cached(
        `date ${locale} ${zone} ${style}`,
        () =>
            new Intl.DateTimeFormat(locale, {
                ...DATE_STYLES[style],
                timeZone: zone,
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
        /** `'auto'` (`yesterday`) or `'always'` (`1 day ago`). `'auto'` by default. */
        numeric?: Intl.RelativeTimeFormatNumeric
    } = {},
): string {
    const time = instant(value)
    if (time === undefined) return MISSING
    const {
        now = Date.now(),
        locale = LOCALE,
        style = 'long',
        numeric: words = 'auto',
    } = options
    const formatter = cached(
        `relative ${locale} ${style} ${words}`,
        () => new Intl.RelativeTimeFormat(locale, { numeric: words, style }),
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
    options: Pick<
        Intl.NumberFormatOptions,
        'minimumFractionDigits' | 'maximumFractionDigits'
    > & {
        /** The BCP 47 locale the size is written in. `'en-US'` by default. */
        locale?: string
    } = {},
): string {
    const size = numeric(value)
    if (size === undefined) return MISSING
    let scaled = Number(size)
    let unit = 0
    while (Math.abs(scaled) >= 1000 && unit < BYTE_UNITS.length - 1) {
        scaled /= 1000
        unit += 1
    }
    const name = BYTE_UNITS[unit] as (typeof BYTE_UNITS)[number]
    return numberFormat(`bytes ${name}`, 'unit', options, {
        unit: name,
        // `512 bytes`: the short form of the byte is `512 byte`.
        unitDisplay: name === 'byte' ? 'long' : 'short',
        minimumFractionDigits: 0,
        maximumFractionDigits: 1,
    }).format(scaled)
}
