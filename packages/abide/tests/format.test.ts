// THE `format` NAMESPACE — RULEBOOK 52.1-52.7. What a column of formatted figures RENDERS, and what
// it builds while it does, is the CRM's tests', which mount one.

import { expect, spyOn, test } from 'bun:test'

import { gate } from '@abide/harness/gate'

import { formatters } from '../src/shared/format/cached.ts'
import {
    bytes,
    date,
    dateParts,
    duration,
    list,
    money,
    number,
    percent,
    plural,
    relative,
} from '../src/shared/format/index.ts'
import { timeZone } from '../src/shared/format/timeZone.ts'
import { beginHydration, endHydration } from '../src/shared/hydrating.ts'

// THE REVERT: return `String(value)` for a non-number from `money`, and `null` reads `null`.
test('a formatter writes an em dash for a value it cannot format — 52.1', () => {
    for (const missing of [null, undefined, Number.NaN, 'twelve', {}])
        expect([
            money(missing),
            percent(missing),
            number(missing),
            plural(missing, 'deal'),
            date(missing),
            duration(missing),
            relative(missing),
            bytes(missing),
        ]).toEqual(['—', '—', '—', '—', '—', '—', '—', '—'])
    expect(list(null)).toBe('—')
    expect(list([])).toBe('—')
})

test('a formatter writes en-US where no locale is named — 52.2', () => {
    expect(money(12500)).toBe('$12,500.00')
    expect(money(12500, { maximumFractionDigits: 0 })).toBe('$12,500')
    expect(money(1_250_000, { notation: 'compact' })).toBe('$1.3M')
    expect(money(80, { signDisplay: 'exceptZero' })).toBe('+$80.00')
    expect(money(12500, { currency: 'EUR', locale: 'de-DE' })).toBe(
        '12.500,00 €',
    )
    expect(percent(0.4)).toBe('40%')
    expect(percent(0.125)).toBe('12.5%')
    expect(
        percent(0.4, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    ).toBe('40.0%')
    expect(percent(-0.05, { signDisplay: 'exceptZero' })).toBe('\u22125%')
    expect(number(1200)).toBe('1,200')
    expect(number(1200, { notation: 'compact' })).toBe('1.2K')
    expect(
        number(12, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    ).toBe('12.0')
    expect(plural(1, 'deal')).toBe('1 deal')
    expect(plural(1200, 'deal')).toBe('1,200 deals')
    expect(plural(2, 'company', 'companies')).toBe('2 companies')
    expect(list(['Ada', 'Grace', 'Alan'])).toBe('Ada, Grace, and Alan')
    expect(list(['Ada', 'Grace'], { type: 'disjunction' })).toBe('Ada or Grace')
})

// THE REVERT: build the formatter from abide's defaults alone, leaving out the caller's options —
// `5` where `05` is due, and `$1,234.50` where `USD 1,234.50` is. Asking for a minimum above the
// default maximum without moving the maximum throws instead.
test("a number formatter takes Intl.NumberFormat's own options under their own names — 52.37", () => {
    expect(number(5, { minimumIntegerDigits: 2 })).toBe('05')
    expect(money(1234.5, { currencyDisplay: 'code' })).toBe('USD 1,234.50')
    expect(percent(0.123, { minimumFractionDigits: 2 })).toBe('12.30%')
    expect(percent(0.4, { maximumFractionDigits: 0 })).toBe('40%')
    expect(bytes(1_500_000, { minimumFractionDigits: 2 })).toBe('1.50 MB')
    expect(list(['Ada', 'Grace'], { type: 'unit', style: 'narrow' })).toBe(
        'Ada Grace',
    )
})

// THE REVERT: key the formatter by the options in the order given — the same two options written
// the other way build a second formatter, `{ built: 1 }` where `{ built: 0 }` is due.
test('one set of options given in any order is one formatter — 52.6', () => {
    money(1, { notation: 'compact', signDisplay: 'always' })
    const built = spyOn(Intl, 'NumberFormat')
    money(1, { signDisplay: 'always', notation: 'compact' })
    const calls = built.mock.calls.length
    built.mockRestore()
    expect({ built: calls }).toEqual({ built: 0 })
})

// THE REVERT: drop the `timeZone` default, and run under `TZ=America/Los_Angeles`.
test('a date is written in UTC where no time zone is named — 52.3', () => {
    expect(date('2026-11-18')).toBe('Nov 18, 2026')
    expect(date('2026-11-18T15:04:00Z', { style: 'dateTime' })).toBe(
        'Nov 18, 2026, 3:04 PM',
    )
    expect(date(Date.UTC(2026, 10, 18), { style: 'month' })).toBe('Nov 2026')
    expect(date(new Date(Date.UTC(2026, 10, 18)), { style: 'monthDay' })).toBe(
        'Nov 18',
    )
    expect(
        date('2026-11-18T15:04:00Z', {
            style: 'time',
            timeZone: 'America/New_York',
        }),
    ).toBe('10:04 AM')
})

// THE REVERT: read a `YYYY-MM-DD` with `Date.parse`, and it is UTC's midnight — the 17th in New
// York, and 20 hours ago at Los Angeles' noon rather than 12.
test('a day alone is its midnight in the zone it is written in — 52.113', () => {
    expect(date('2026-11-18', { timeZone: 'America/New_York' })).toBe(
        'Nov 18, 2026',
    )
    expect(date('2026-11-18', { timeZone: 'Asia/Tokyo' })).toBe('Nov 18, 2026')
    expect(date('2026-02-30', { timeZone: 'America/New_York' })).toBe('—')
    try {
        timeZone.set('America/Los_Angeles')
        expect(date('2026-11-18', { style: 'dateTime' })).toBe(
            'Nov 18, 2026, 12:00 AM',
        )
        // Noon in Los Angeles is 20:00 UTC.
        const now = Date.UTC(2026, 10, 18, 20)
        expect(relative('2026-11-18', { now })).toBe('12 hours ago')
    } finally {
        timeZone.set(undefined)
    }
})

test('a duration is its two largest units — 52.4', () => {
    expect(duration(3_900_000)).toBe('1h 5m')
    expect(duration(90_061_000)).toBe('1d 1h')
    expect(duration(3_605_000)).toBe('1h')
    expect(duration(45_000)).toBe('45s')
    expect(duration(400)).toBe('0s')
    expect(duration(-3_900_000)).toBe('-1h 5m')
})

test('a relative time is measured from the now it is handed — 52.5', () => {
    const now = Date.UTC(2026, 10, 18, 12)
    expect(relative(now - 3 * 3_600_000, { now })).toBe('3 hours ago')
    expect(relative(now - 26 * 3_600_000, { now })).toBe('yesterday')
    expect(relative(now + 2 * 86_400_000, { now })).toBe('in 2 days')
    expect(relative(now - 20_000, { now })).toBe('now')
    expect(
        relative(new Date(now - 14 * 86_400_000).toISOString(), { now }),
    ).toBe('2 weeks ago')
})

// THE REVERT: key the cache by locale alone, and the second style reads the first one's formatter.
test('a relative time is written in the style it is handed — 52.32', () => {
    const now = Date.UTC(2026, 10, 18, 12)
    const ago = now - 12 * 60_000
    expect(relative(ago, { now })).toBe('12 minutes ago')
    expect(relative(ago, { now, style: 'short' })).toBe('12 min. ago')
    expect(relative(ago, { now, style: 'narrow' })).toBe('12m ago')
})

// THE REVERT: a cache that never finds what it built — every call builds its formatter again.
gate(
    'a formatter is built once per set of options — 52.6',
    {
        revert: () => {
            const get = formatters.get
            formatters.get = () => undefined
            return () => {
                formatters.get = get
            }
        },
        worth: { built: 1000 },
    },
    () => {
        money(1, { currency: 'JPY' })
        const built = spyOn(Intl, 'NumberFormat')
        for (let amount = 0; amount < 1000; amount += 1)
            money(amount, { currency: 'JPY' })
        const calls = built.mock.calls.length
        built.mockRestore()
        expect({ built: calls }).toEqual({ built: 0 })
    },
)

test('a size in bytes is in the largest unit it fills — 52.7', () => {
    expect(bytes(512)).toBe('512 bytes')
    expect(bytes(1)).toBe('1 byte')
    expect(bytes(1_500)).toBe('1.5 kB')
    expect(bytes(1_500_000)).toBe('1.5 MB')
    expect(
        bytes(2_000_000_000, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }),
    ).toBe('2.00 GB')
    expect(bytes(999_999)).toBe('1,000 kB')
})

// THE REVERT: drop the `replace('-', MINUS)` in `percent` and `money` — `-12%` where `−12%` is due.
test('a signed value writes its minus as −, and an unsigned one as Intl does — 52.35', () => {
    expect(percent(-0.12, { signDisplay: 'exceptZero' })).toBe('−12%')
    expect(percent(0.12, { signDisplay: 'exceptZero' })).toBe('+12%')
    expect(money(-5, { signDisplay: 'exceptZero' })).toBe('−$5.00')
    expect(percent(-0.12)).toBe('-12%')
})

// THE REVERT: have `dateParts` answer `format` as one literal piece rather than `formatToParts` —
// the first piece is `{ type: 'literal', value: '3 PM' }` where `{ type: 'hour', value: '3' }` is due.
test('the parts of a date join to what date writes, and an hour is written alone — 52.36', () => {
    const at = '2026-11-18T15:04:00Z'
    for (const style of ['day', 'time', 'hour', 'dateTime'] as const) {
        let joined = ''
        for (const part of dateParts(at, { style })) joined += part.value
        expect(joined).toBe(date(at, { style }))
    }
    expect(date(at, { style: 'hour' })).toBe('3 PM')
    expect(dateParts(at, { style: 'hour' })[0]).toEqual({
        type: 'hour',
        value: '3',
    })
    expect(dateParts('not a date')).toEqual([{ type: 'literal', value: '—' }])
})

// THE REVERT: default to UTC, and a pinned zone is ignored — Tokyo's morning reads as the night
// before.
test('a date names the zone the app pins where its caller names none — 52.44', () => {
    const at = Date.UTC(2026, 10, 18, 22, 30)
    try {
        timeZone.set('Asia/Tokyo')
        expect(date(at, { style: 'dateTime' })).toBe('Nov 19, 2026, 7:30 AM')
        // A zone the caller names still wins.
        expect(date(at, { style: 'time', timeZone: 'UTC' })).toBe('10:30 PM')
    } finally {
        timeZone.set(undefined)
    }
})

// THE REVERT: drop the stand-in, and the page hydrates in the browser's zone, every date written
// differently from what the server painted.
test("unpinned, a date is UTC while the page hydrates and the browser's zone after — 52.45, 41.32", () => {
    const at = Date.UTC(2026, 10, 18, 22, 30)
    // `bun test` runs in UTC, which would make the two answers one.
    const zone = process.env.TZ
    process.env.TZ = 'Asia/Tokyo'
    try {
        beginHydration()
        expect(date(at, { style: 'time' })).toBe('10:30 PM')
        endHydration()
        expect(date(at, { style: 'time' })).toBe('7:30 AM')
    } finally {
        if (zone === undefined) Reflect.deleteProperty(process.env, 'TZ')
        else process.env.TZ = zone
        endHydration()
    }
})
