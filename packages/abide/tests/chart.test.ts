// The `chart` namespace — RULEBOOK 52.19-52.23, the arithmetic `LineChart` and `Sparkline` draw
// with. What the two components draw is the CRM's tests', which mount them.

import { expect, test } from 'bun:test'

import { nearest, path, scale, ticks } from '../src/shared/chart/index.ts'

test('ticks are round and enclose the range — 52.19', () => {
    expect(ticks(0, 100, 4)).toEqual([0, 20, 40, 60, 80, 100])
    expect(ticks(0, 1000, 2)).toEqual([0, 500, 1000])
    expect(ticks(3, 97, 5)).toEqual([0, 20, 40, 60, 80, 100])
    expect(ticks(0.1, 0.3, 2)).toEqual([0.1, 0.2, 0.3])
    expect(ticks(-25, 40, 4)).toEqual([-40, -20, 0, 20, 40])
    expect(ticks(5, 5)).toEqual([5, 6, 7])
    expect(ticks(Number.NaN, 1)).toEqual([])
})

test('scale maps a domain onto a range, and a domain of no width to its middle — 52.20', () => {
    const toY = scale([0, 100], [200, 0])
    expect([toY(0), toY(50), toY(100)]).toEqual([200, 100, 0])
    expect(scale([5, 5], [0, 10])(5)).toBe(5)
})

test('path breaks where a value is missing — 52.21', () => {
    expect(path([0, 10, 20, 30, 40], [1, 2, null, 4, 5])).toBe(
        'M0,1L10,2M30,4L40,5',
    )
    expect(path([0, 10, 20], [null, 3, undefined])).toBe('M10,3Z')
    expect(path([0, 10, 20], [1, Number.NaN, 3])).toBe('M0,1ZM20,3Z')
})

test('path closes each run down to a baseline — 52.22', () => {
    expect(path([0, 10], [1, 2], 50)).toBe('M0,1L10,2L10,50L0,50Z')
    expect(path([0, 10, 20, 30], [1, null, 3, 4], 50)).toBe(
        'M0,1L0,50L0,50ZM20,3L30,4L30,50L20,50Z',
    )
})

test('nearest finds the position nearest x — 52.23', () => {
    expect(nearest([0, 10, 20, 30], 14)).toBe(1)
    expect(nearest([0, 10, 20, 30], 15)).toBe(1)
    expect(nearest([0, 10, 20, 30], 16)).toBe(2)
    expect(nearest([0, 10, 20, 30], -5)).toBe(0)
    expect(nearest([0, 10, 20, 30], 99)).toBe(3)
    expect(nearest([], 4)).toBe(-1)
})
