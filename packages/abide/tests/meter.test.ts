// 52.106-52.109 — `meter`, its parts read as a template reads them.

import { expect, test } from 'bun:test'

import { meter } from '#shared'

// THE REVERT: write the value's share of `max` alone, ignoring `min`, and a quota of 30 from 20 to 40
// fills 75% where 50% is due.
test('a meter fills as far as its value falls along its range, and reads it out — 52.106, 52.108', () => {
    const quota = meter({ value: 30, min: 20, max: 40, label: 'Quota' })
    expect([
        quota.meter.role,
        quota.meter['aria-valuenow'],
        quota.meter['aria-valuemin'],
        quota.meter['aria-valuemax'],
        quota.meter['aria-label'],
    ]).toEqual(['meter', 30, 20, 40, 'Quota'])
    expect(quota.fill.style).toBe('inline-size:50%')
    expect(meter({ value: 2, max: 1 }).fill.style).toBe('inline-size:100%')
})

// THE REVERT: write `aria-valuenow` as 0 where there is no value, and an unknown progress reads as none.
test('a progress bar with no value is indeterminate — 52.107', () => {
    const upload = meter({ value: undefined, role: 'progressbar' })
    expect([
        upload.meter.role,
        upload.meter['aria-valuenow'],
        upload.meter['data-indeterminate'],
        upload.fill.style,
    ]).toEqual(['progressbar', undefined, '', undefined])
})

// THE REVERT: compare against `high` first with `>=`, and a value at the band's edge reads as high.
test('a meter says whether its value is low, high or between — 52.109', () => {
    const level = (value: number) =>
        meter({ value, low: 0.25, high: 0.9 }).meter['data-level']
    expect([level(0.1), level(0.5), level(0.9), level(0.95)]).toEqual([
        'low',
        'middle',
        'middle',
        'high',
    ])
    expect(meter({ value: 0.5 }).meter['data-level']).toBeUndefined()
})

// THE REVERT: write `--fraction` from the value alone, ignoring `min` — a quota of 30 from 20 to 40
// reads 30 where 0.5 is due.
test('a meter carries how far along its range it is as --fraction — 52.117', () => {
    expect(meter({ value: 30, min: 20, max: 40 }).meter.style).toBe(
        '--fraction: 0.5',
    )
    expect(meter({ value: 2, max: 1 }).meter.style).toBe('--fraction: 1')
    expect(meter({ value: undefined }).meter.style).toBeUndefined()
})
