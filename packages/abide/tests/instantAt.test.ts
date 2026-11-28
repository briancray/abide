// 52.101-52.103 — a wall clock and the instant it names, both ways, held to `Temporal` where the
// runtime has it: bun does, so every half hour of a year in zones whose clocks change at 2 a.m., at
// midnight, by half an hour and not at all is checked against `compatible`, the answer `Temporal`
// gives by default.

import { expect, test } from 'bun:test'

import { format, instantAt } from '#shared'

type ZonedReading = {
    toZonedDateTime(zone: string): { epochMilliseconds: number }
}
type TemporalStandIn = {
    PlainDateTime: { from(text: string): ZonedReading }
    Instant: {
        fromEpochMilliseconds(time: number): {
            toZonedDateTimeISO(zone: string): {
                toPlainDateTime(): { toString(): string }
            }
        }
    }
}
const { Temporal } = globalThis as unknown as { Temporal: TemporalStandIn }

const ZONES = [
    'America/New_York',
    'Europe/London',
    // Its clocks skip midnight, so the day itself has no midnight once a year.
    'America/Santiago',
    // Its clocks move by half an hour.
    'Australia/Lord_Howe',
    'Asia/Kolkata',
]
const HALF_HOUR = 1_800_000
const YEAR_START = Date.UTC(2026, 0, 1)
const YEAR_END = Date.UTC(2027, 0, 1)

// 52.102, 52.103 — THE REVERT: answer the reading by the offset after it alone, and a skipped half
// hour in New York lands an hour early, and a repeated one on its later instant.
// A test per zone, so each year's sweep has a timeout of its own under a loaded `--parallel`.
test.each(ZONES)(
    "every wall clock of a year in %s names the instant Temporal's compatible names",
    (zone) => {
        for (
            let reading = YEAR_START;
            reading < YEAR_END;
            reading += HALF_HOUR
        ) {
            const wallClock = new Date(reading).toISOString().slice(0, 16)
            const expected =
                Temporal.PlainDateTime.from(wallClock).toZonedDateTime(
                    zone,
                ).epochMilliseconds
            const answered = instantAt(wallClock, { timeZone: zone })
            if (answered !== expected)
                expect({ zone, wallClock, answered }).toEqual({
                    zone,
                    wallClock,
                    answered: expected,
                })
        }
    },
)

// 52.103 — THE TWO THE WHOLE YEAR COMES DOWN TO, said outright: New York skips 2:30 on March 8th
// and reads 1:30 twice on November 1st.
test('a skipped time lands the skip later, and a time read twice the earlier', () => {
    const zone = { timeZone: 'America/New_York' }
    expect(instantAt('2026-03-08T02:30', zone)).toBe(
        Date.parse('2026-03-08T07:30:00Z'),
    )
    expect(instantAt('2026-11-01T01:30', zone)).toBe(
        Date.parse('2026-11-01T05:30:00Z'),
    )
    expect(instantAt('2026-12-15', zone)).toBe(
        Date.parse('2026-12-15T05:00:00Z'),
    )
})

// 52.102 — NO DAY OR TIME THE CALENDAR LACKS, and nothing else.
test('a day or a time the calendar lacks, or any other string, is no instant', () => {
    for (const wallClock of [
        '2026-02-30',
        '2026-13-01',
        '2026-12-15T24:00',
        '2026-12-15T14:60',
        '2026-12-15 14:30',
        '2026-12-15T14:30Z',
        'tomorrow',
        '',
    ])
        expect(instantAt(wallClock, { timeZone: 'UTC' })).toBeUndefined()
    expect(instantAt('2026-12-15T14:30:15', { timeZone: 'UTC' })).toBe(
        Date.parse('2026-12-15T14:30:15Z'),
    )
})

// 52.101 — THE WAY BACK: `'input'` writes what the zone's clocks read, in every locale, and
// `instantAt` reads it to the same instant wherever the clocks read it once.
test("format.date's input style writes the zone's wall clock, and instantAt reads it back", () => {
    for (const zone of ZONES)
        for (let time = YEAR_START; time < YEAR_END; time += HALF_HOUR * 3) {
            const written = format.date(time, {
                style: 'input',
                timeZone: zone,
                locale: 'ar-EG',
            })
            expect(written).toBe(
                Temporal.Instant.fromEpochMilliseconds(time)
                    .toZonedDateTimeISO(zone)
                    .toPlainDateTime()
                    .toString()
                    .slice(0, 16),
            )
            const back = instantAt(written, { timeZone: zone }) as number
            expect(format.date(back, { style: 'input', timeZone: zone })).toBe(
                written,
            )
        }
    expect(
        format
            .dateParts(Date.parse('2026-12-15T14:30:00Z'), {
                style: 'input',
                timeZone: 'UTC',
            })
            .map((part) => part.value)
            .join(''),
    ).toBe('2026-12-15T14:30')
})
